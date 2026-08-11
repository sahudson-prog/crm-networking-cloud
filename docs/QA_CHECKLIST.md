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
- Links a ficha abren correctamente.

### Ficha de contacto

- Timeline carga interacciones.
- Editar nota no pisa `Detalle_Fuente`.
- Sync de contacto actualiza primero Google Contacts y luego interacciones.
- Relaciones/vinculos no generan claves duplicadas en Streamlit.

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
- En cloud, `npm run test:google-adapter` tambien debe validar Google Contacts: nombre, empresa, cargo, correos, telefonos, contactos sin nombre visible, `deleted` y `previousResourceNames`.
- En cloud, `npm run test:google-adapter` debe validar que Google Contacts use el telefono visible (`value`) antes que `canonicalForm`, para evitar numeros truncados cuando Google intenta canonizar valores mal escritos.
- En cloud, `npm run test:google-adapter` debe validar cliente read-only de Google Contacts: paginacion, `nextSyncToken`, `syncToken`, `EXPIRED_SYNC_TOKEN` y limite de paginas.
- En cloud, `npm run test:google-adapter` debe validar cliente read-only de Gmail/Calendar: paginacion acotada, lectura full de mensajes Gmail, uso de `syncToken` Calendar, deteccion de permisos invalidos y cursor Calendar vencido.
- En cloud, `npm run test:google-adapter` debe validar el flujo `syncGoogleInteractions`: mapea Gmail/Calendar a lotes agnosticos, asocia participantes por email, guarda cursores solo cuando corresponde y no guarda cursores en dry-run.
- En cloud, `npm run test:sync` debe validar el contrato de sincronizacion por lote: creados, actualizados, omitidos, errores, dry-run, wrapper mail/calendario y proteccion de contactos mediante preview obligatorio.
- En cloud, `npm run test:sync` debe validar cursores de sincronizacion: lectura por usuario/proveedor/recurso/etiqueta, guardado con upsert por clave unica y marcado de cursor vencido sin conservar `cursor_value`.
- En cloud, `npm run test:sync` debe validar el flujo de preview real de Google Contacts: usa cursor guardado, genera preview sin guardar cursor nuevo, marca cursor vencido y reintenta lectura completa.
- En cloud, `npm run test:sync` debe validar aplicacion de preview de contactos: aplica seleccion completa y guarda cursor, no guarda cursor si quedan cambios pendientes, no guarda cursor si falla algun cambio, distingue `appliedChangeIds`/`failedChangeIds` cuando una seleccion se aplica parcialmente y conserva detalle de errores estructurados de Supabase/PostgREST con `externalId`/`objectId` cuando no existe aun contacto app.
- En cloud, el preview de sincronizacion debe mostrar nuevos, modificados, consolidaciones, desactivaciones y eliminaciones como tarjetas seleccionables; los cambios desmarcados no se aplican y deben reaparecer en una revision posterior si siguen vigentes.
- En cloud, `SyncPreviewDialog` debe permitir entrar a pestanas vacias y mostrar un mensaje vacio especifico, sin redirigir automaticamente a otra pestana.
- En cloud, `SyncPreviewDialog` debe mantener altura estable al cambiar de pestana, con listado scrolleable y footer fijo.
- En cloud, `SyncPreviewDialog` debe aplicar en una sola accion la seleccion total de todas las pestanas, mostrando resumen inferior por tipo de cambio y total pendiente.
- En cloud, `SyncPreviewDialog` no debe escribir datos por si mismo; solo devuelve seleccion al flujo que lo invoco.
- En cloud, no debe aparecer `No eliminar ni volver a sugerir` dentro del footer principal de `SyncPreviewDialog` hasta que exista una UX separada y validada para supresiones.
- En cloud, `contactSyncPreview.ts` debe probar que un campo vacio de la fuente conectada no borra un dato local enriquecido, y que eliminaciones de correos/telefonos solo se sugieren si el valor era conocido como importado desde esa misma fuente.
- En cloud, `contactSyncPreview.ts` debe probar que `Modificaciones` y `Duplicados fusionables` no reemplazan Nombre, Empresa ni Cargo ya guardados; solo completan esos campos si estan vacios en la app. En `Modificaciones`, los reemplazos detectados pero no aplicados deben mostrarse con `apply: false` para que la UI agregue `(no aplicado)`.
- En cloud, `contactSyncPreview.ts` debe probar que un contacto externo sin ID enlazado, pero con correo o telefono ya existente en la app, se propone como consolidacion/enlace y no como contacto nuevo.
- En cloud, `contactSyncPreview.ts` debe probar que varios objetos externos que apuntan al mismo contacto destino se muestran como una sola linea y que los contactos revisados sin diferencias aparecen en `Sin cambios`, sin bloquear el cursor ni contar como pendientes accionables.
- En cloud, `contactSyncPreview.ts` debe probar que duplicados conectados por un dato comun se separan en `Duplicados fusionables` solo cuando hay 2 o 3 contactos origen en total y exactamente 1 contacto guardado.
- En cloud, `contactSyncPreview.ts` debe probar que duplicados conectados que superan 3 contactos origen, o que tienen multiples contactos guardados, se separan como `Duplicados complejos`: no se fusionan en el preview, los contactos importables aparecen como filas independientes y vienen desmarcados por defecto.
- En cloud, `SyncPreviewDialog` debe mostrar `Duplicados complejos` agrupados por el mejor dato comun disponible: correo compartido, luego nombre compartido, luego telefono normalizado; el encabezado debe incluir conteo de duplicados guardados/importados.
- En cloud, `contactSyncPreview.ts` debe probar que telefonos equivalentes con distinto formato o codigo de pais no generan falsos agregados; ejemplos validados: `2 2618 8346` en la app y `+56226188346` desde Google quedan como `Sin cambios`, y un movil chileno con `9` duplicado despues de `+56` no se propone como telefono nuevo.
- En cloud, `contactSyncPreview.ts` debe probar que telefonos equivalentes repetidos dentro del mismo contacto de proveedor se deduplican antes de crear o modificar un contacto.
- En cloud, `contactSyncPreview.ts` debe probar que placeholders como `sin dato`, `sin datos` y `null` textual se tratan como vacios reales y no generan cambios de empresa/cargo.
- En cloud, `phoneIdentity.ts` debe probar equivalencias de telefonos para Chile, Peru, Argentina, Colombia, Mexico, Brasil y USA, incluyendo prefijo internacional `00`, movil chileno con `9` duplicado y evitando matches cuando los ultimos digitos no coinciden.
- En cloud, una futura funcion `Fusionar contactos` debe probar 2 y 3 contactos origen, seleccion de nombre/empresa/cargo, seleccion de correos/telefonos, switches foco/headhunter por defecto TRUE si algun origen es TRUE, estado networking por defecto al mas avanzado y reasignacion de interacciones/referidos/ToDos/IDs externos.
- Antes de probar `contact.merge_deep` con datos reales, ejecutar `cloud/supabase/merge_contacts_deep_v0_2.sql` en Supabase dev y verificar con `cloud/supabase/verify_merge_contacts_deep_v0_2.sql`. Luego probar solo un caso controlado de 2 contactos guardados + 1 importado, revisando que el origen quede desactivado y que interacciones/referidos/ToDos/IDs externos se muevan al resultante.
- En cloud, `contactDuplicateReview.ts` debe probar duplicados guardados por correo, duplicados indirectos por telefono/correo y que los contactos inactivos no participen en grupos.
- En Cuenta, `Revision de duplicados` debe abrir `ContactMergeDialog` solo para grupos de hasta 3 contactos o una fusion manual iniciada desde el boton principal. La seleccion manual debe hacerse dentro del modal con `Agregar contacto guardado`, maximo 3 contactos, y el listado debe refrescarse despues de fusionar.
- En sync de contactos, una fila de `Duplicados complejos` con 2 o 3 contactos guardados debe permitir abrir `ContactMergeDialog` desde el conteo `guardados`, con esos contactos preseleccionados. Al guardar, debe fusionar los contactos internos con `merge_contacts_deep` y pedir volver a revisar cambios para recalcular el preview.
- En `/sistema/diseno`, el sandbox de preview de contactos debe seguir siendo seguro: puede leer contactos, simular fuente externa y probar `contactSyncApply` con dependencias simuladas, pero no debe modificar Supabase ni llamar Google real.
- En `Cuenta`, el panel Google Contacts debe pedir OAuth con scope `contacts.readonly`, preparar preview real sin escribir, aplicar solo seleccion confirmada en Supabase cloud y no guardar cursor cuando quedan cambios pendientes.
- En `Cuenta`, perfil/plan, servicios conectados, datos/respaldo y seguridad deben verse como secciones de usuario final; las acciones delicadas no deben aparecer dispersas en `Sistema`.

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
- En cloud, `npm run test:rules` debe validar la prelacía basica de reglas de estado networking.

### Acciones internas

- Cada accion ejecutable tiene contrato documentado: inputs, outputs, validaciones, objetos afectados y confirmacion por defecto.
- UI, reglas y Coach IA llaman la misma accion interna cuando hacen el mismo cambio.
- La accion valida datos antes de escribir.
- La accion registra resultado o error en una traza auditable.
- Ninguna accion de IA escribe en servicios externos sin aprobacion explicita.

### Cloud / plataforma

- La app local sigue funcionando despues de cada cambio preparatorio.
- Cada modulo cloud revisa antes de cerrar: codigo local antiguo, vista local real y documentacion viva.
- Cada modulo cloud declara explicitamente que se replica, que se mejora, que se descarta y que queda pendiente.
- Para modulos medianos o criticos, considerar agente QA auxiliar para contrastar diferencias, pruebas y duplicidades en paralelo.
- El schema Supabase/Postgres se revisa localmente antes de ejecutarse.
- El schema solo se ejecuta inicialmente en el proyecto dev aprobado, no en produccion.
- Despues del schema, ejecutar `cloud/supabase/verify_schema_v0_1.sql` y revisar que no falten tablas, RLS ni policies.
- Cada tabla privada cloud tiene `user_id` y RLS habilitado.
- Policies, indices y triggers del schema son rerunnable o tienen manejo explicito de recreacion.
- Los IDs externos quedan como referencias de proveedor; el contacto mantiene ID propio de la app.
- `action_invocations` registra solicitudes/ejecuciones de acciones internas por usuario, regla, IA o sistema.
- No se suben a GitHub exports, backups, `credentials.json`, `token.json`, `.env` ni claves Supabase.
- Export local completo no modifica datos y genera conteos por tabla/recurso.
- Export local no incluye `credentials.json`, `token.json`, `.env`, claves Supabase, OAuth client secret ni otros secretos.
- Export local genera `manifest.json`, tablas normalizadas y `validation_report.json`.
- Antes del import cloud, ejecutar `cloud/importer/preview_export.py` sobre el ZIP espejo.
- El preview debe confirmar version esperada, archivos requeridos, hashes ok y 0 errores bloqueantes.
- El preview no debe imprimir nombres, correos, telefonos, minutas ni otros datos personales.
- Ejecutar `cloud/importer/load_export.py` sin `--apply` antes de cargar datos reales.
- La carga real solo se ejecuta con `--apply`, `CRM_NETWORKING_DATABASE_URL` local y `user_id` Auth confirmado.
- La carga real debe abortar si el usuario destino ya tiene datos en tablas privadas.
- Si la conexion directa de Supabase resuelve solo IPv6 o falla desde Windows, usar connection string de Transaction/Session pooler.
- Despues de cargar, ejecutar `cloud/supabase/verify_import_counts_v0_1.sql` y confirmar conteos esperados.
- Para `cloud/web`, copiar `.env.example` a `.env.local`, completar URL/anon key de Supabase, ejecutar `npm install`, `npm run typecheck` y `npm run dev`.
- Validar que la app cloud muestre solo datos del usuario autenticado y que no existan botones de escritura en la primera version.
- Las interacciones duplicadas por `ID_Entrada` deben importarse como una interaccion unica con participantes asociados.
- Validar duplicados de `Contact_ID`, `Google_ID`, `ID_Entrada`, `Referido_ID` y `Todo_ID`.
- Validar referencias rotas: interacciones sin contacto, referidos sin origen, referidos vinculados a contacto inexistente y ToDos activos con objeto inexistente.
- Import cloud espejo valida conteos y muestras contra la app local.
- Cada consulta cloud queda filtrada por `user_id`.
- Google v1 usa permisos de lectura/importacion y no puede escribir contactos, correos ni calendarios.
- Sync historico requiere confirmacion y sync incremental registra cursor, fecha, conteo y errores.
- Existen limites o alertas antes de activar servicios con riesgo de cobro.
- Los componentes visuales nuevos usan tokens/helpers globales de `docs/UI_STYLE_GUIDE.md`.
- La replica cloud se prueba como web desktop y web mobile antes de considerarse comparable.
