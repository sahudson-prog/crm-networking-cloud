# Checklist de QA

## Antes de tocar datos

- Crear respaldo si el cambio modifica Sheets, importaciones, estados o interacciones.
- Confirmar columnas/rangos afectados.
- Probar primero con pocos registros si es posible.

## Validacion tecnica minima

```powershell
venv\Scripts\python.exe -m py_compile app.py
```

## Flujos criticos

### Autenticacion

- La app abre sin error si `token.json` es valido.
- Si el token expira, ofrece reautorizar.
- No muestra secretos ni trazas innecesarias al usuario.

### Dashboard

- Cargan KPIs.
- Cargan empresas headhunter.
- Filtros no rompen ultimas interacciones.
- Coach IA muestra sugerencias y permite configurarlas.

### Contactos

- Filtro de foco networking funciona desde UI.
- Seleccion multiple no resetea la tabla innecesariamente.
- Acciones masivas actualizan los contactos correctos.
- Acciones masivas de objetivos agregan objetivos seleccionados a los contactos marcados sin borrar asociaciones previas.
- Links a ficha abren correctamente.
- Cuando Objetivos este activo en cloud, el filtro global debe filtrar por objetivos usando IDs, no texto libre, y debe seguir mostrando el conteo `Mostrando X de Y contactos`.
- Cuando se seleccionan varios objetivos en el filtro global, se aplica logica OR y las categorias/chips no se superponen; si no caben, aparece scroll horizontal.
- El resumen de objetivos en Dashboard debe ordenar por prioridad, contar contactos activos asociados y contar cafes unicos por objetivo (`calendar` + `call`) aunque una misma cita/llamada tenga varios participantes del mismo objetivo.
- El resumen de objetivos debe ocultar por defecto objetivos sin contactos ni cafes para los filtros activos, y mostrarlos solo al activar `Mostrar objetivos sin actividad`.
- Las metricas de objetivos del Dashboard deben respetar `Fecha_Inicio_Networking`.
- La tabla resumen de objetivos debe mantener unas 6 filas visibles con scroll interno, sin empujar el resto del Dashboard.

### Ficha de contacto

- Timeline carga interacciones.
- Editar nota no pisa `Detalle_Fuente`.
- Sync de contacto actualiza primero Google Contacts y luego interacciones.
- Relaciones/vinculos no generan claves duplicadas en Streamlit.
- Cuando Objetivos este activo en cloud, la ficha debe mostrar objetivos asociados como chips y el editor debe seleccionar/deseleccionar solo objetivos previamente creados.

### UI responsive

- La vista afectada se revisa en desktop y en ancho mobile.
- Botones secundarios compactos no ocupan todo el ancho de la pantalla en mobile.
- Toolbars, filtros y acciones hacen wrap ordenado o pasan a una opcion compacta.
- No hay textos superpuestos, botones deformados ni scroll horizontal accidental.
- Tablas o listas densas siguen siendo usables en mobile mediante columnas minimas, cards, filas expandibles o scroll controlado.

### Sincronizacion

- Gmail no duplica interacciones existentes.
- Calendar no duplica eventos existentes.
- Interacciones se reasignan si un email cambia de contacto.
- Correos de hilos usan `Thread_ID` para deduplicacion de recomendaciones.
- En cloud, `npm run test:google-adapter` debe validar mapeo Gmail/Calendar, participantes `TO`/`CC`/`BCC` y descarte de correos de terceros donde usuario/contacto solo estan copiados.
- En cloud, `npm run test:google-adapter` debe validar que Calendar no duplique el mismo participante si Google lo entrega como organizador y asistente del mismo evento.
- En cloud, `npm run test:google-adapter` tambien debe validar Google Contacts: nombre, empresa, cargo, correos, telefonos, contactos sin nombre visible, `deleted` y `previousResourceNames`.
- En cloud, `npm run test:google-adapter` debe validar que Google Contacts use el telefono visible (`value`) antes que `canonicalForm`, para evitar numeros truncados cuando Google intenta canonizar valores mal escritos.
- En cloud, `npm run test:google-adapter` debe validar cliente read-only de Google Contacts: paginacion, `nextSyncToken`, `syncToken`, `EXPIRED_SYNC_TOKEN` y limite de paginas.
- En cloud, `npm run test:google-adapter` debe validar cliente read-only de Gmail/Calendar: paginacion acotada, lectura full de mensajes Gmail, uso de `syncToken` Calendar, deteccion de permisos invalidos y cursor Calendar vencido.
- En cloud, `npm run test:google-adapter` debe validar el flujo `syncGoogleInteractions`: mapea Gmail/Calendar a lotes agnosticos, asocia participantes por email, guarda cursores solo cuando corresponde y no guarda cursores en dry-run.
- En cloud, `npm run test:sync` debe validar que el preview de actividad normaliza IDs externos igual que el guardado, para que `CALENDAR_...`/`calendar_...` y `GMAIL_...`/`gmail_...` no generen falsos nuevos al revisar nuevamente.
- En cloud, `npm run test:sync` debe validar que el preview de actividad compare fechas por instante real y no por texto, para que formatos equivalentes como `+00` y `Z` no generen falsas modificaciones.
- En cloud, `npm run test:sync` debe validar que Gmail y Calendar respeten la fecha global de inicio tambien como filtro interno posterior a la lectura desde Google, incluso si el proveedor devuelve objetos antiguos por cursor o historia incremental.
- En cloud, los botones de actividad de Cuenta, accion global y Ficha deben usar preview antes de aplicar cambios; ningun boton debe aplicar correos o citas a ciegas sin mostrar los objetos seleccionables.
- En cloud, la actualizacion individual de actividad debe buscar Gmail por `from`/`to`/`cc`/`bcc` de los correos del contacto. Calendar debe buscar por emails del contacto/foco cuando no hay `syncToken`, incluir invitaciones ocultas, deduplicar eventos por ID y despues vincular por participantes mapeados o por el email exacto que produjo el match de busqueda; si hay cursor incremental, debe respetar que Google no permite combinar `syncToken` con query.
- En cloud, si Calendar esta acotado por contactos en foco o por un contacto especifico y no puede armar una busqueda por emails dentro del limite beta, debe detenerse con advertencia; no debe caer a una lectura amplia silenciosa porque puede cortar por limite antes de llegar a citas recientes.
- En cloud, Calendar debe revisar citas futuras hasta 3 meses adelante ademas del historico desde la fecha de inicio de networking. Cuando la lectura esta acotada por contactos, debe leer primero la ventana futura y luego el historico para que el limite por corrida no tape las proximas citas.
- En cloud, `npm run test:sync` debe validar que Calendar no descarte una cita devuelta por `q=email` aunque Google no entregue ese email en `attendees` u `organizer`; el participante debe quedar con rol `MATCH`.
- En cloud, `npm run test:sync` debe validar que Calendar incremental con `syncToken` pueda vincular una cita devuelta si el JSON del evento menciona un email en foco, sin pedir query a Google.
- En cloud, `npm run test:google-adapter` debe validar que el cliente de Calendar envie `showHiddenInvitations=true` tanto en lectura historica como incremental para no omitir invitaciones ocultas/no visibles.
- En cloud, cuando se ejecute una revision dry-run de Calendar con diagnostico activo, `external_interaction_read_diagnostics` debe guardar todos los eventos leidos desde Google, incluidos los que no quedan como posibles interacciones, con estado `candidate`, `not_mapped` o `filtered_out` y motivo revisable por SQL. El payload diagnostico debe ser acotado: no guardar descripcion/cuerpo crudo del evento.
- En cloud, `npm run test:sync` debe validar el contrato de sincronizacion por lote: creados, actualizados, omitidos, errores, dry-run, wrapper mail/calendario y proteccion de contactos mediante preview obligatorio.
- En cloud, `npm run test:sync` debe validar cursores de sincronizacion: lectura por usuario/proveedor/recurso/etiqueta, guardado con upsert por clave unica y marcado de cursor vencido sin conservar `cursor_value`.
- En cloud, `npm run test:sync` debe validar el flujo de preview real de Google Contacts: usa cursor guardado, genera preview sin guardar cursor nuevo, marca cursor vencido y reintenta lectura completa.
- En cloud, `npm run test:sync` debe validar aplicacion de preview de contactos: aplica seleccion completa y guarda cursor, no guarda cursor si quedan cambios pendientes, no guarda cursor si falla algun cambio, distingue `appliedChangeIds`/`failedChangeIds` cuando una seleccion se aplica parcialmente y conserva detalle de errores estructurados de Supabase/PostgREST con `externalId`/`objectId` cuando no existe aun contacto app.
- En cloud, el preview de importacion de contactos debe mostrar nuevos, modificados y eliminaciones como tarjetas seleccionables; los cambios desmarcados no se aplican y deben reaparecer en una revision posterior si siguen vigentes. Los objetos sin cambios no deben aparecer como pestana ni tarjeta seleccionable.
- En cloud, `SyncPreviewDialog` debe permitir entrar a pestanas vacias y mostrar un mensaje vacio especifico, sin redirigir automaticamente a otra pestana.
- En cloud, `SyncPreviewDialog` debe mantener altura estable al cambiar de pestana, con listado scrolleable y footer fijo.
- En cloud, `SyncPreviewDialog` debe aplicar en una sola accion la seleccion total de todas las pestanas, mostrando resumen inferior por tipo de cambio y total pendiente.
- En cloud, `SyncPreviewDialog` no debe escribir datos por si mismo; solo devuelve seleccion al flujo que lo invoco.
- En cloud, no debe aparecer `No eliminar ni volver a sugerir` dentro del footer principal de `SyncPreviewDialog` hasta que exista una UX separada y validada para supresiones.
- En cloud, `contactSyncPreview.ts` debe probar que un campo vacio de la fuente conectada no borra un dato local enriquecido, y que eliminaciones de correos/telefonos solo se sugieren si el valor era conocido desde esa misma fuente.
- En cloud, `contactSyncPreview.ts` debe probar que `Modificaciones` no reemplaza Nombre, Empresa ni Cargo ya guardados; solo completa esos campos si estan vacios en la app. Los reemplazos detectados pero no aplicados deben mostrarse con `apply: false` para que la UI agregue `(no aplicado)`.
- En cloud, `contactSyncPreview.ts` debe probar que un contacto externo sin ID enlazado entra como `Nuevo`, aunque tenga correo o telefono existente en la app; la coincidencia se revisa despues en duplicados.
- En cloud, `contactSyncPreview.ts` debe probar que un contacto externo con ID ya enlazado en `external_contact_ids` no se propone como `Duplicado fusionable` aunque comparta correo o telefono con otros contactos; debe quedar como `Modificaciones` o `Sin cambios` segun corresponda.
- En cloud, `contactSyncPreview.ts` debe probar que varios objetos externos que apuntan al mismo contacto destino se manejan como una sola revision y que los contactos revisados sin diferencias quedan como `Sin cambios` interno, sin mostrarse en el modal, bloquear el cursor ni contar como pendientes accionables.
- En cloud, `contactSyncPreview.ts` debe probar que dos contactos externos con IDs distintos entran como dos `Nuevos`, aunque compartan correo o telefono.
- En cloud, `contactSyncApply.ts` debe permitir crear contactos nuevos aunque otro contacto tenga el mismo correo o telefono normalizado; esos casos se resuelven despues con `contactDuplicateReview`.
- En cloud, `contactSyncApply.ts` debe confirmar que cada ID externo aplicado queda activo y apuntando al contacto destino; no debe reportar exito si el enlace proveedor-contacto no queda verificable.
- En cloud, `contactSyncPreview.ts` debe probar que telefonos equivalentes con distinto formato o codigo de pais no generan falsos agregados; ejemplos validados: `2 2618 8346` en la app y `+56226188346` desde Google quedan como `Sin cambios`, y un movil chileno con `9` duplicado despues de `+56` no se propone como telefono nuevo.
- En cloud, `contactSyncPreview.ts` debe probar que telefonos equivalentes repetidos dentro del mismo contacto de proveedor se deduplican antes de crear o modificar un contacto.
- En cloud, `contactSyncPreview.ts` debe probar que placeholders como `sin dato`, `sin datos` y `null` textual se tratan como vacios reales y no generan cambios de empresa/cargo.
- En cloud, `phoneIdentity.ts` debe probar equivalencias de telefonos para Chile, Peru, Argentina, Colombia, Mexico, Brasil y USA, incluyendo prefijo internacional `00`, movil chileno con `9` duplicado y evitando matches cuando los ultimos digitos no coinciden.
- En cloud, una futura funcion `Fusionar contactos` debe probar 2 y 3 contactos origen, seleccion de nombre/empresa/cargo, seleccion de correos/telefonos, switches foco/headhunter por defecto TRUE si algun origen es TRUE, estado networking por defecto al mas avanzado y reasignacion de interacciones/referidos/ToDos/IDs externos.
- Antes de probar `contact.merge_deep` con datos reales, ejecutar `cloud/supabase/merge_contacts_deep_v0_2.sql` en Supabase dev y verificar con `cloud/supabase/verify_merge_contacts_deep_v0_2.sql`. Luego probar solo un caso controlado de 2 contactos guardados + 1 contacto de fuente conectada, revisando que el origen quede desactivado y que interacciones/referidos/ToDos/IDs externos se muevan al resultante.
- En cloud, `contactDuplicateReview.ts` debe probar duplicados guardados por correo, duplicados indirectos por telefono/correo y que los contactos inactivos no participen en grupos.
- En Cuenta, `Revision de duplicados` debe abrir `ContactMergeDialog` solo para grupos de hasta 3 contactos o una fusion manual iniciada desde el boton principal. La seleccion manual debe hacerse dentro del modal con `Agregar contacto guardado`, maximo 3 contactos, y el listado debe refrescarse despues de fusionar.
- En sync de contactos, una fila de `Duplicados complejos` con 2 o 3 contactos guardados debe permitir abrir `ContactMergeDialog` desde el conteo `guardados`, con esos contactos preseleccionados. Al guardar, debe fusionar los contactos internos con `merge_contacts_deep` y pedir volver a revisar cambios para recalcular el preview.
- En `/sistema/diseno`, el sandbox de preview de contactos debe seguir siendo seguro: puede leer contactos, simular fuente externa y probar `contactSyncApply` con dependencias simuladas, pero no debe modificar Supabase ni llamar Google real.
- En `Cuenta`, el panel Google Contacts debe pedir OAuth con scope `contacts.readonly`, preparar preview real sin escribir, aplicar solo seleccion confirmada en Supabase cloud y no guardar cursor cuando quedan cambios pendientes.
- En cloud, `googleContactSyncFlow.ts` debe probar que el mapa de pareo proveedor-contacto usa solo `external_contact_ids`; no debe leer campos legacy como respaldo.
- En cloud, `googleContactSyncFlow.ts` debe leer correos/telefonos conocidos desde `external_contact_snapshots`, no desde `contact_emails`/`contact_phones`; el objetivo es comparar proveedor actual contra la foto anterior del proveedor y evitar falsos cambios por normalizacion local.
- En cloud, `contactSyncApply.ts` debe guardar `external_contact_snapshots` solo despues de aplicar correctamente un cambio de contacto, con `provider`, `external_id`, nombre, empresa, cargo, correos, telefonos, cumpleanos/metadata y `last_seen_at`.
- En Supabase dev, antes de probar el nuevo sync de contactos, ejecutar `cloud/supabase/prepare_contact_sync_storage_v0_1.sql`; luego `cloud/supabase/verify_schema_v0_1.sql` debe mostrar `external_contact_snapshots`, indices por contacto para correos/telefonos y la funcion `validate_contact_sync_storage_v0_1`.
- En cloud, `contactSyncApply.ts` debe llamar `validate_contact_sync_storage_v0_1` antes de escribir contactos. Si falta tabla, indice o queda un indice unico antiguo, debe fallar antes de crear filas parciales.
- En cloud web, las lecturas runtime de Contactos, Interacciones, Coach y KPIs no deben consultar columnas `legacy_*`; cualquier dato de la app anterior debe entrar por una herramienta de migracion separada y adaptarse al modelo nuevo antes de quedar disponible para la app.
- Antes de reiniciar Supabase dev para una carga limpia desde Google, ejecutar solo con confirmacion `tools/dev_maintenance/supabase/reset_dev_user_for_clean_google_load_v0_2.sql`, reemplazando el placeholder por el `user_id` correcto. El reset debe limpiar tambien `external_contact_snapshots`.
- Despues del reset dev, ejecutar `tools/dev_maintenance/supabase/verify_clean_cloud_user_v0_2.sql`; todos los conteos de datos del usuario, incluido `external_contact_snapshots`, deben quedar en `0` y `legacy_columns` debe quedar en `0`.
- En `Cuenta`, perfil/plan, servicios conectados, fecha de inicio de networking, revision de duplicados y seguridad deben verse como secciones de usuario final minimalistas; no debe existir bloque visible de permisos, datos/respaldo ni textos duplicados.
- En `Cuenta`, `Servicios conectados` debe agrupar por proveedor: logo/estado de conexion, acciones de importar contactos/correos/citas con conteos vinculados y botones de borrar importados como placeholders no destructivos hasta definir politica de conservacion de notas/minutas.
- En `Cuenta`, el estado de Google debe distinguir cuenta vinculada de permiso activo. Los botones de importar no deben cambiar su nombre a `Conectar Google`; si falta permiso, la accion de conectar/actualizar permiso debe estar a nivel del proveedor.
- En `Cuenta`, `Revision de duplicados` debe mostrarse como resumen + boton; el listado y fusion manual deben abrirse en modal y reutilizar `ContactMergeDialog`.

### ToDos

- Reglas generan sugerencias descriptivas.
- La deduplicacion evita recomendaciones repetidas.
- Reset de sugerencias pide confirmacion.
- Configuracion por tipo de ToDo se guarda correctamente.
- En cloud, el panel de configuracion lista tipos en lenguaje usuario, agrupados por RULE, HYBRID e IA.
- En cloud, `Ejecutar sin preguntar` queda deshabilitado cuando el tipo no permite autoaplicacion segura.
- En cloud, guardar la configuracion de automatizacion no debe ejecutar cambios por si sola; la ejecucion ocurre solo al correr revision de sugerencias o al ejecutar seleccion manualmente.
- Las acciones sugeridas por ToDos usan nombres de accion estructurados y parametros validables.
- Si una accion modifica datos, pide confirmacion salvo que el usuario haya configurado lo contrario para ese tipo.
- En cloud, seleccionar sugerencias no debe ejecutar cambios hasta presionar el boton de ejecucion.
- En cloud, ejecutar un ToDo de cambio de estado debe actualizar el contacto, marcar el ToDo como `done`, refrescar la vista y registrar la accion/auditoria.
- En cloud, descartar ToDos seleccionados debe marcarlos como `dismissed`, refrescar la vista y registrar la accion/auditoria sin tocar contactos.
- En cloud, ToDos no soportados por la accion actual deben omitirse con mensaje claro, sin romper el resto de la seleccion.
- En cloud, el boton "Buscar sugerencias" del Coach debe revisar reglas `RULE` sobre Supabase sin tocar Google ni la app local.
- En cloud, la revision de reglas debe crear una sola sugerencia activa por contacto segun prelacía y cerrar sugerencias inferiores o no vigentes.
- En cloud, una regla segura marcada como "Ejecutar sin preguntar" debe aplicar el cambio con la misma accion interna que usa la ejecucion manual, cerrar el ToDo como `done` y registrar `action_invocations`/`audit_log`.
- En cloud, el historial del Coach debe mostrar solo sugerencias no vigentes de `todos` (`done`, `dismissed`, `expired`, `auto_resolved`), con filtros por estado, maximo visual cercano a 6 filas con scroll, mensaje igual a la burbuja activa, stamp de estado + autor + fecha, detalle colapsable con motivo/regla/evidencia y link directo al contacto afectado.
- En cloud, la regla `HEADHUNTER_COMPANY_DETECTED` debe crear sugerencia solo si el contacto esta activo, marcado como headhunter, no tiene empresa y un dominio coincide con una unica empresa del maestro; al ejecutarse debe completar `contacts.company`, cerrar el ToDo y registrar accion/auditoria.
- En cloud, `npm run test:rules` debe validar la prelacía basica de reglas de estado networking y la regla de empresa headhunter detectada.

### Acciones internas

- Cada accion ejecutable tiene contrato documentado: inputs, outputs, validaciones, objetos afectados y confirmacion por defecto.
- UI, reglas y Coach IA llaman la misma accion interna cuando hacen el mismo cambio.
- La accion valida datos antes de escribir.
- La accion registra resultado o error en una traza auditable.
- Ninguna accion de IA escribe en servicios externos sin aprobacion explicita.

### Cloud / plataforma

- La app local sigue funcionando despues de cada cambio preparatorio.
- Antes de abrir beta multiusuario, revisar `docs/PRIVACY_SECURITY_COMPLIANCE.md` y validar que el sprint cubre finalidad, minimizacion, consentimiento, derechos del titular, seguridad, confidencialidad, roles/capabilities, RLS y logs acotados.
- Antes de cerrar el sprint de cuentas, ejecutar una prueba con dos usuarios reales: usuario A no puede leer, buscar, modificar, sincronizar ni auditar datos del usuario B.
- Antes de ejecutar la prueba con dos usuarios reales, correr `cloud/supabase/verify_multiuser_readiness_v0_1.sql`. Debe devolver `ok` para tablas privadas, tablas globales, resolvedor de capacidades y trigger de alta; cualquier `revisar` se corrige antes de invitar un segundo usuario.
- Antes de cerrar el sprint de cuentas, la pantalla Cuenta debe leer conexiones externas desde `connected_accounts`; no basta con detectar un token temporal de sesion.
- Antes de cerrar el sprint de cuentas, Mantencion admin, logs sensibles, limites y maestros globales deben validar rol/capability persistente y no depender de `NEXT_PUBLIC_ADMIN_EMAILS`, localhost o links ocultos.
- Antes de probar el nuevo gate admin, ejecutar en Supabase dev `cloud/supabase/add_account_access_model_v0_1.sql`, luego `cloud/supabase/bootstrap_first_system_admin_v0_1.sql` con el email del primer admin, y finalmente `cloud/supabase/verify_account_access_model_v0_1.sql`.
- Despues del bootstrap, un usuario con rol `system_admin` debe poder abrir `Sistema > Mantencion admin`, ver el mantenedor de accesos, cambiar plan y asignar/desactivar roles; un usuario normal debe quedar bloqueado aunque conozca la URL.
- En Mantencion admin, cambiar plan, asignar rol o activar/desactivar rol debe pedir confirmacion visible antes de guardar. Si el usuario intenta desactivar el ultimo `system_admin`, la app debe bloquearlo.
- Si un admin queda sin acceso durante pruebas, recuperarlo solo por SQL manual controlado (`tools/dev_maintenance/supabase/restore_system_admin_by_email_v0_1.sql` o bootstrap equivalente) y luego verificar que `system_admin` quede activo.
- El primer usuario creado despues de activar el trigger `on_auth_user_created_profile` debe recibir `profile`, `user_access_profile` beta personal y rol `user`, sin permisos admin.
- Un usuario sin capability `contacts.import_google` no debe poder preparar ni aplicar importacion de contactos desde Cuenta o Ficha, aunque tenga Google conectado.
- Un usuario sin capability `interactions.import_google` no debe poder preparar ni aplicar importacion/sync de Gmail o Calendar desde Cuenta, Dashboard o Ficha.
- Las acciones internas de Mantencion admin deben validar `admin.manage_access`, no solo la ruta visible.
- El maestro global de empresas headhunter debe permitir lectura a usuarios autenticados, pero insertar/modificar/desactivar empresas o dominios solo con `admin.manage_global_masters`.
- Despues de ejecutar `cloud/supabase/restrict_headhunter_master_admin_writes_v0_1.sql`, validar que existen las policies `Headhunter companies are admin writable` y `Headhunter company domains are admin writable`, y que ya no existe escritura abierta tipo beta.
- El estado de Google en Cuenta debe quedar como `Vinculado` si existe una fila activa en `connected_accounts`, pero debe pedir actualizar permiso si no hay token OAuth fresco para importar.
- Al desvincular Google desde Cuenta, la fila de `connected_accounts` debe quedar `revoked` y la UI debe mostrar Google como no vinculado sin borrar contactos, correos, citas, minutas ni snapshots ya importados.
- Si el usuario desvincula Google pero la sesion OAuth temporal sigue vigente, la app no debe reactivar `connected_accounts` automaticamente; solo puede volver a vincularse tras una accion explicita de conectar/autorizar.
- Los botones de importar contactos, importar correos/citas, actualizar datos del contacto y actualizar interacciones no deben usar `provider_token` directamente como autorizacion suficiente: primero debe existir una conexion activa en `connected_accounts`; si falta token fresco, deben iniciar reconexion.
- Al reconectar Google desde Contactos, Correos, Citas, Ficha o Cuenta, la app debe registrar los scopes conocidos del flujo solicitado y no inventar permisos que el usuario no haya pedido.
- La UI y el codigo cloud no deben contener `NEXT_PUBLIC_ADMIN_EMAILS` ni reglas de admin por `localhost` como criterio de seguridad.
- Cada modulo cloud revisa antes de cerrar: codigo local antiguo, vista local real y documentacion viva.
- Cada modulo cloud declara explicitamente que se replica, que se mejora, que se descarta y que queda pendiente.
- Para modulos medianos o criticos, considerar agente QA auxiliar para contrastar diferencias, pruebas y duplicidades en paralelo.
- El schema Supabase/Postgres se revisa localmente antes de ejecutarse.
- El schema solo se ejecuta inicialmente en el proyecto dev aprobado, no en produccion.
- Despues del schema, ejecutar `cloud/supabase/verify_schema_v0_1.sql` y revisar que no falten tablas, RLS ni policies.
- Cada tabla privada cloud tiene `user_id` y RLS habilitado.
- Cada tabla global cloud, como el maestro de empresas headhunter, no tiene `user_id`, queda identificada como `Global` en el visor de datos crudos y no se mezcla con datos privados del usuario.
- Antes de ejecutar `cloud/supabase/add_objectives_v0_1.sql`, revisar que `objectives` y `contact_objective_assignments` tengan RLS por usuario, indices de busqueda/asociacion y nombres descriptivos de columnas.
- En cloud, al editar un contacto marcado como headhunter, el campo empresa debe mostrar una lista propia de empresas coincidentes desde el maestro global mientras el usuario escribe. No debe mostrarse el campo manual `Empresas headhunter`, y la deteccion positiva por dominio debe quedar para Coach, no para el editor.
- Policies, indices y triggers del schema son rerunnable o tienen manejo explicito de recreacion.
- Los IDs externos quedan como referencias de proveedor; el contacto mantiene ID propio de la app.
- `action_invocations` registra solicitudes/ejecuciones de acciones internas por usuario, regla, IA o sistema.
- No se suben a GitHub exports, backups, `credentials.json`, `token.json`, `.env` ni claves Supabase.
- Export local completo no modifica datos y genera conteos por tabla/recurso.
- Export local no incluye `credentials.json`, `token.json`, `.env`, claves Supabase, OAuth client secret ni otros secretos.
- Export local genera `manifest.json`, tablas normalizadas y `validation_report.json`.
- Si se ejecuta una migracion de continuidad, usar herramientas fuera del runtime cloud y hacer preview antes de escribir.
- El preview debe confirmar version esperada, archivos requeridos, hashes ok y 0 errores bloqueantes.
- El preview no debe imprimir nombres, correos, telefonos, minutas ni otros datos personales.
- La carga real solo se ejecuta con confirmacion explicita, conexion local segura y `user_id` Auth confirmado.
- La carga real debe abortar si el usuario destino ya tiene datos en tablas privadas, salvo que exista plan de fusion aprobado.
- Si la conexion directa de Supabase resuelve solo IPv6 o falla desde Windows, usar connection string de Transaction/Session pooler.
- Despues de una migracion, ejecutar verificacion de conteos y confirmar resultados esperados.
- Para `cloud/web`, copiar `.env.example` a `.env.local`, completar URL/anon key de Supabase, ejecutar `npm install`, `npm run typecheck` y `npm run dev`.
- Validar que la app cloud muestre solo datos del usuario autenticado y que no existan botones de escritura en la primera version.
- Las interacciones duplicadas por origen externo deben quedar como una interaccion unica con participantes asociados.
- Validar duplicados por contacto, correo, telefono, origen externo, referido y sugerencia.
- Validar referencias rotas: interacciones sin contacto, referidos sin origen, referidos vinculados a contacto inexistente y ToDos activos con objeto inexistente.
- Toda migracion de continuidad valida conteos y muestras contra su fuente antes de escribir.
- Cada consulta cloud queda filtrada por `user_id`.
- Google v1 usa permisos de lectura/importacion y no puede escribir contactos, correos ni calendarios.
- Antes de sumar un segundo usuario real, `connected_accounts` debe ser la fuente persistente de verdad para cuentas externas por usuario/proveedor/email/scopes/estado/revocacion; la UI no debe depender solo del token temporal de sesion para decir si Google esta conectado.
- Antes de sumar un segundo usuario real, validar con dos usuarios de prueba que contactos, interacciones, cursores, previews, conexiones, limites y auditoria no se cruzan entre cuentas.
- Antes de persistir refresh tokens o permisos renovables, debe existir estrategia aprobada de cifrado/revocacion/auditoria; si no existe, la app solo puede usar permisos temporales de sesion para pruebas controladas.
- Antes de exponer `Sistema > Mantencion admin` fuera de desarrollo, el acceso debe estar protegido por rol/capability real y por politicas o acciones de servidor; no basta `NEXT_PUBLIC_ADMIN_EMAILS`, hostname local ni ocultar links.
- Antes de guardar logs de sync o auditoria en beta, confirmar que no contienen tokens OAuth, cuerpos completos de correos, minutas completas, telefonos/correos innecesarios ni secretos.
- En cloud, `npm run test:logs` debe validar que `sync_run_logs` redacta correos, telefonos, tokens y claves sensibles, y que el diagnostico Calendar no persiste descripcion/cuerpo crudo del evento.
- Antes de habilitar empresas patrocinadoras u organizaciones, confirmar que una organizacion no puede acceder automaticamente a datos privados del usuario; cualquier reporte debe ser agregado, anonimizado o contar con consentimiento y alcance explicito.
- Antes de habilitar automatizaciones del Coach por plan, confirmar que cada regla tiene condicion, evidencia, accion, tier minimo, modo de confirmacion y auditoria esperada.
- Antes de habilitar borrado/desactivacion de cuenta, documentar que se elimina, que se conserva por auditoria minima, como se desvinculan proveedores y como se atiende exportacion/portabilidad.
- La accion `Reiniciar datos` en Cuenta debe exigir capability `data.delete_account`, doble confirmacion y frase exacta `BORRAR MIS DATOS`.
- Antes de probar `Reiniciar datos` en una base existente, confirmar que `data.delete_account` esta asignada al rol `system_admin` o al plan `beta_personal`; si no, ejecutar `cloud/supabase/grant_reset_data_capability_v0_1.sql`.
- Al ejecutar `Reiniciar datos`, deben borrarse contactos, correos/telefonos, IDs externos, snapshots, interacciones, participantes, fuentes externas, diagnosticos, referidos, objetivos, ToDos, cursores, logs, configuracion personal y cuentas conectadas del usuario autenticado.
- Al ejecutar `Reiniciar datos`, deben conservarse login, perfil basico, plan, roles/capabilities, organizaciones y maestros globales como empresas headhunter.
- Un usuario no debe poder reiniciar datos de otro usuario, ni desde UI ni llamando la RPC directamente.
- Sync historico requiere confirmacion y sync incremental registra cursor, fecha, conteo y errores.
- Existen limites o alertas antes de activar servicios con riesgo de cobro.
- La consola `Sistema > Mantencion admin` muestra seguros app, limites de proveedor, ventana de reseteo y acumulado; cualquier uso productivo requiere roles/RLS admin reales y eventos de uso completos.
- En `Sistema > Mantencion admin`, el visor `Datos crudos` debe permitir filtrar tablas por alcance (`Usuario`, `Sistema`, `Global`, `Todos`), mostrar conteos por tabla y filtrar/ordenar usando solo columnas reales visibles de la tabla seleccionada.
- Los componentes visuales nuevos usan tokens/helpers globales de `docs/UI_STYLE_GUIDE.md`.
- La replica cloud se prueba como web desktop y web mobile antes de considerarse comparable.
