# Current plan

Este documento contiene el plan de trabajo priorizado. El backlog contiene todas las ideas; este documento contiene lo que vamos a ejecutar o preparar proximamente.

## Objetivo actual

Profesionalizar el proyecto sin frenar el avance funcional: mantener la app local operativa como referencia, aislar acceso a datos y construir una app cloud gradual sobre Postgres/Supabase con Google como unico conector v1. La app cloud debe tener base propia limpia; la continuidad desde la app anterior queda como migracion separada y posterior.

## Estado de fases

| Fase | Nombre | Estado | Resultado esperado |
|---|---|---|---|
| 0 | Orden y control | En cierre | Documentacion minima, backlog estructurado y reglas claras |
| 1 | Aislar datos y fuentes | Siguiente | UI local funcionando igual, pero con acceso a datos e integraciones centralizados y duplicidades identificadas |
| 2 | Base cloud limpia y migraciones | En curso | App cloud opera con datos propios y conectores; migraciones de continuidad quedan separadas del runtime |
| 3 | Sandbox Supabase/Postgres | En curso | Probar modelo nuevo sin afectar datos actuales ni generar costos sorpresivos |
| 4 | Replica cloud comparable | En curso | App cloud funciona sobre modelo propio y fuentes conectadas, sin depender de adaptaciones de datos anteriores |
| 5 | Login y Google conectado | Pendiente | Uno o dos usuarios entran con login propio y conectan Google en modo lectura |
| 6 | Deploy controlado web responsive | Pendiente | Beta cerrada online con limites de uso, alertas y rollback |
| 7 | Producto escalable | Pendiente | Preparar crecimiento, observabilidad, planes, monetizacion y v2 multi-proveedor |

## Plataformas base

Estado reportado por usuario al 2026-07-22:

| Plataforma | Estado | Uso previsto | Nota |
|---|---|---|---|
| GitHub | Listo: repo `crm-networking-cloud` | Repositorio de la futura app cloud | Mantener privado y sin secretos |
| Supabase | Listo: proyecto `crm-networking-dev`, region Americas | Postgres/Auth/Storage de desarrollo | Plan Free; definir guardrails antes de uso intensivo |
| Vercel | Listo | Hosting web responsive/PWA | No importar proyecto hasta crear estructura cloud |
| Google Cloud | Listo: proyecto `crm-networking-dev`, APIs activadas | OAuth y APIs Google read-only | Consent screen casi listo; `gmail.readonly` queda pendiente de validar/agregar |

## Plan inmediato

El foco inmediato es cerrar las ultimas pruebas reales de importacion/sync de contactos, correos y citas con el usuario actual, sin introducir cambios de arquitectura mientras esas pruebas estan en curso. Una vez cerradas, el siguiente bloque prioritario sera robustecer multiusuario, cuenta y conexiones externas antes de sumar otro usuario real.

### Cierre de pruebas actual

| Orden | Trabajo | Resultado esperado | Criterio de cierre |
|---|---|---|---|
| 1 | Importar contactos desde Google | Contactos nuevos quedan creados con ID interno app, referencia externa Google y foco networking apagado por defecto | Al volver a revisar, los contactos importados quedan fuera del modal si no tienen cambios, o aparecen como `Modificaciones` reales, no como falsos nuevos/duplicados |
| 2 | Probar modificaciones y eliminaciones de Google Contacts | Cambios de contactos ya enlazados se detectan por ID externo/snapshot; eliminaciones aparecen solo cuando corresponde | Casos de prueba creados por usuario quedan clasificados correctamente y el preview no fusiona duplicados durante importacion |
| 3 | Probar importacion de correos | Correos de contactos en foco se muestran en preview antes de aplicar, respetan fecha de inicio de networking y no pisan minutas | Una segunda revision no vuelve a proponer como nuevo lo ya aplicado |
| 4 | Probar importacion de citas | Citas de contactos en foco se muestran en preview antes de aplicar, respetan fecha de inicio de networking y no generan falsas modificaciones de fecha | Citas aplicadas quedan vinculadas a origen externo y no reaparecen como modificadas si no cambiaron |
| 5 | Registrar hallazgos | Diferencias reales quedan anotadas como bug, deuda o decision de producto | No queda cambio pendiente critico antes de pasar a multiusuario/conexiones |

### Siguiente bloque: multiusuario y conexiones

Antes de habilitar un segundo usuario real o una beta cerrada, la app debe separar con claridad la cuenta de acceso de las cuentas conectadas para importar datos:

- `auth.users`/`profiles`: identidad para entrar a la app.
- `connected_accounts`: fuente de verdad de cuentas externas conectadas por usuario, proveedor, email, scopes, estado y revocacion.
- tokens OAuth: persistencia segura/cifrada o alternativa aprobada; no depender solo del token temporal de la sesion.
- UI Cuenta: mostrar `Vinculado`, `permiso activo`, `permiso pendiente` y `desvincular` desde datos persistentes, no desde inferencias visuales.
- RLS/permisos: validar que cada usuario solo ve y modifica sus propios datos.
- roles/capacidades: dejar gate admin/beta antes de exponer Mantencion admin, limites y acciones delicadas.
- privacidad y cumplimiento: usar `docs/PRIVACY_SECURITY_COMPLIANCE.md` como gate del sprint. La beta debe disenar desde ya para Ley 19.628 y cambios de Ley 21.719 con entrada principal el 01-12-2026: finalidad clara, minimizacion, consentimiento, derechos de acceso/rectificacion/supresion/oposicion/portabilidad/bloqueo, seguridad, confidencialidad, logs acotados y separacion entre datos privados, datos agregados y reportes futuros.

### Sprint cuentas, usuarios y privacidad

| Orden | Trabajo | Resultado esperado | Criterio de cierre |
|---|---|---|---|
| 1 | Auditoria multiusuario actual | Mapa de tablas, RLS, rutas y acciones que ya estan aisladas por `user_id`, mas brechas reales | Se identifican accesos que aun dependen solo de UI/env/localhost |
| 2 | Modelo de acceso v0.1 | Tablas y contratos para roles, planes, capabilities, organizaciones, membresias y entitlements | No quedan permisos comerciales hardcodeados por pantalla |
| 3 | Cuentas conectadas persistentes | `connected_accounts` pasa a ser fuente de verdad de proveedor, email, scopes, estado, expiracion y revocacion | Cuenta distingue login de permiso para importar datos |
| 4 | Resolvedor central de capacidades | Una funcion comun decide si un usuario puede ejecutar una accion o ver una vista | Acciones, Coach, sync, Cuenta y Sistema consultan la misma fuente |
| 5 | Gate admin real | Mantencion admin, maestros globales, limites y visores sensibles quedan protegidos por rol/capability y RLS | Un usuario normal no puede invocar acciones admin aunque conozca la ruta |
| 6 | Privacidad operativa | Logs, auditoria, exportacion/eliminacion futura y scopes read-only quedan documentados y testeables | QA valida que no se exponen tokens, minutas, correos o telefonos en logs innecesarios |
| 7 | Prueba con dos usuarios | Dos cuentas reales/beta prueban aislamiento, OAuth, cuotas y acciones sensibles | Usuario A no ve ni modifica datos de usuario B |

Auditoria inicial del 2026-08-26:

- La mayoria de tablas privadas cloud ya tienen `user_id` y RLS por `auth.uid()`, incluyendo contactos, interacciones, referidos, objetivos, logs, uso, cursores y cuentas conectadas.
- La pantalla Cuenta ya lee `connected_accounts` como fuente persistente para saber si Google esta vinculado; el permiso activo todavia depende del token OAuth fresco de la sesion hasta definir persistencia segura de refresh tokens.
- El acceso admin cloud ya no usa `NEXT_PUBLIC_ADMIN_EMAILS` ni localhost como gate. `Sistema > Mantencion admin` y el maestro headhunter consultan capabilities persistentes mediante `current_user_has_capability`.
- Los maestros globales, como empresas headhunter, son legibles globalmente. Queda preparado `cloud/supabase/restrict_headhunter_master_admin_writes_v0_1.sql` para cerrar escritura solo a usuarios con `admin.manage_global_masters`.
- Los logs de sync pasan por redaccion central antes de guardarse y el diagnostico Calendar guarda un payload acotado sin descripcion/cuerpo crudo. Falta definir retencion y permisos finales del visor antes de beta amplia.
- La prueba real con dos usuarios queda pendiente de entorno/cuenta beta. Mientras tanto, `cloud/supabase/verify_multiuser_readiness_v0_1.sql` queda como preflight no destructivo para revisar estructura antes de invitar un segundo usuario.
- Falta el modelo formal de roles, planes, capabilities, organizaciones, membresias y entitlements para separar usuario normal, administrador, beta tester, sponsor/outplacement y tiers comerciales.
- Implementacion ejecutada y verificada en Supabase dev: `cloud/supabase/add_account_access_model_v0_1.sql` crea el primer modelo formal de roles, planes, capacidades, organizaciones y patrocinios; `cloud/supabase/bootstrap_first_system_admin_v0_1.sql` asigna manualmente el primer administrador; `cloud/supabase/verify_account_access_model_v0_1.sql` valida tablas, seeds, RLS, funcion y trigger.
- El primer `system_admin` requiere bootstrap controlado desde Supabase/service role; la app no permite auto-asignarse permisos admin.

Corte implementado localmente el 2026-08-26/27:

- Resolvedor comun `checkCurrentUserCapability` para consultar permisos reales desde Supabase.
- Helper comun `requireCurrentUserCapability` para bloquear acciones sensibles con el mismo mensaje de permiso.
- Gate admin reemplazado en Mantencion admin y maestro headhunter.
- Mantenedor inicial de accesos en Mantencion admin para ver usuarios, planes y roles.
- Cuenta distingue conexion Google persistente de permiso OAuth temporal activo.
- Cuenta registra scopes conocidos por el flujo OAuth iniciado, muestra permisos Google por tipo y permite desvincular Google dentro de la app sin borrar datos importados.
- Ficha, Cuenta y botones de actividad usan `readCurrentGoogleConnectionState`: un token temporal de sesion no basta para importar si la cuenta fue desvinculada; si existe conexion activa pero falta token fresco, se solicita reconexion.
- Cuenta agrega accion delicada `Reiniciar datos` para borrar el espacio operativo del usuario y partir de cero, conservando login, plan, roles y maestros globales.
- Se corrige la matriz de permisos para que `data.delete_account` quede asignada a `system_admin` y `beta_personal`; bases ya creadas deben aplicar `cloud/supabase/grant_reset_data_capability_v0_1.sql`.
- Visor universal de datos agrega tablas del modelo de acceso para diagnostico, filtro por alcance real de tabla (`Usuario`, `Sistema`, `Global`), resumen de cantidad de filas por tabla y filtros/orden por columnas visibles.
- Importacion de contactos, importacion de correos/citas, actualizacion de actividad y actualizacion de datos de contacto validan capabilities antes de revisar o aplicar.
- Acciones internas del mantenedor de accesos validan `admin.manage_access`; la UI pide confirmacion antes de cambiar plan, asignar rol o activar/desactivar rol, y bloquea desactivar el ultimo `system_admin`.
- Existe SQL manual de recuperacion admin por email para dev si un usuario admin queda sin acceso por pruebas: `tools/dev_maintenance/supabase/restore_system_admin_by_email_v0_1.sql`.
- Creacion de empresas headhunter valida `admin.manage_global_masters`.
- El schema base del maestro headhunter queda solo con lectura autenticada; la escritura admin se activa con `cloud/supabase/restrict_headhunter_master_admin_writes_v0_1.sql`, que tambien verifica que no queden policies beta de escritura abierta.
- Pendiente de cierre: ejecutar restriccion RLS del maestro headhunter en Supabase dev, definir prueba con segundo usuario cuando exista entorno beta y definir persistencia segura de tokens renovables.

### Rediseño ficha de contacto

| Orden | Backlog ID | Trabajo | Resultado | Riesgo |
|---|---|---|---|---|
| 1 | CONTACT-002 | Bloque datos y acciones | Implementado en primera version; pendiente ajuste visual fino | Medio |
| 2 | CONTACT-003 | Interacciones compactas | Implementado en primera version; pendiente validar expansion/edicion con usuario | Medio |
| 3 | CONTACT-004 | Referidos en tarjetas | Implementado en primera version; pendiente probar con contactos que tengan referidos | Bajo |
| 4 | CONTACT-005 | Coach contextual | Implementado en primera version; pendiente ajustar densidad/alineacion | Medio |
| 5 | DEBT-005 | Componentes reutilizables UI | En curso: Coach y referidos empiezan a usar helpers comunes; falta extraer mas vistas | Medio |
| 6 | CONTACT-006 | Robot compacto alineado | Implementado; pendiente validacion visual del usuario | Medio |
| 7 | CONTACT-007 | Bloque info blanco y bordes | Implementado; pendiente validacion visual del usuario | Bajo |
| 8 | DATA-006 | Modelo ampliado de referidos | Implementado en capa transicional; pendiente validar datos reales tras primera escritura aprobada | Medio |
| 9 | CONTACT-010 | Editor oficial de contacto | Implementado como popup global conectado desde referidos; pendiente validar UX y reutilizar en otros contextos | Medio |
| 10 | CONTACT-011 | Editor oficial de referido | Implementado popup oficial con vinculo opcional y llamada al editor de contacto; pendiente validacion visual/funcional | Medio |
| 11 | CONTACT-008 | Flujo crear/vincular referidos en ficha | Implementado en codigo; pendiente prueba con usuario en ficha real | Medio |

### Profesionalizacion y cloud

| Orden | Backlog ID | Trabajo | Resultado | Riesgo |
|---|---|---|---|---|
| 1 | DOC-001 | Reordenar documentacion base | Documentos con responsabilidades claras | Bajo |
| 2 | CLOUD-009 | Definir guardrails de costos y cuotas | Limites iniciales, alertas y criterios de apagado antes de consumir servicios cloud | Medio |
| 3 | DATA-005 | Herramienta transicional de continuidad | Schema JSON/ZIP historico de salida local, versionado, conteos y validaciones | Medio |
| 4 | DATA-005 | Implementar export local espejo | Implementado y descarga validada por usuario; preview automatizado del ZIP real ejecutado sin errores bloqueantes | Medio |
| 5 | DATA-002 | Disenar schema Postgres inicial | Hecho: schema v0.1 ejecutado en Supabase dev; 22 tablas, 22 policies y RLS activo verificados por CSV | Medio |
| 6 | DATA-005 | Herramientas transicionales de continuidad | Historico: herramientas movidas a `tools/legacy_migration`; no forman parte del producto cloud ni del modelo vigente | Bajo |
| 7 | DATA-010 | Base cloud limpia | Hecho: runtime, UI y schema base sin `legacy_*`; reset dev confirmado con datos y columnas heredadas en 0 | Medio |
| 8 | CLOUD-006 | Crear app web cloud base | En curso: `cloud/web` creado con Next/React, Supabase Auth, Dashboard, Contactos, Ficha de contacto, Sistema y Cuenta; typecheck/build ok; primera capa comun de lectura lista; Dashboard reordenado para comparabilidad con Streamlit; AuthGate evita carga infinita | Medio |
| 9 | CLOUD-012 | Definir design system cloud | En curso: tokens CSS, paneles, botones, iconos, estados, metricas, KPIs, Coach preview, empresas headhunter, tarjetas y layouts responsivos nacen como componentes globales; anexo visual cloud creado | Bajo |
| 10 | CLOUD-003 / CLOUD-010 | Cuenta y OAuth Google v1 | Cuenta concentra perfil, plan, conexiones y sync delicado; OAuth Google v1 mantiene scopes minimos de lectura/importacion, sin escritura en contactos, correos ni calendario. Sync/export saliente hacia Google queda fuera de prioridad v1 | Medio |
| 11 | CLOUD-007 | Definir capa de integracion/adaptadores v1 | Google queda como primer conector, sin amarrar la app a Google ni limitar servicios futuros | Medio |
| 12 | TECH-001 | Centralizar nombres de hojas y columnas | Menos strings dispersos en `app.py` | Bajo |
| 13 | TECH-002 | Crear capa inicial de datos para contactos | Contactos leidos/escritos desde una funcion estable | Medio |
| 14 | TECH-003 | Crear capa inicial de datos para interacciones | Interacciones centralizadas antes de migrar | Medio |
| 15 | TECH-004 | Crear capa inicial de datos para ToDos/config | Motor de sugerencias menos acoplado a Sheets | Medio |
| 16 | TECH-006 | Catalogo de acciones internas | Contratos para que UI, reglas y Coach IA usen las mismas funciones accionables | Medio |
| 17 | DEBT-004 | Auditar duplicidades antes de migrar | Mapa de funciones reutilizables, duplicadas y candidatas a extraer | Bajo |
| 18 | CLOUD-011 | Web responsive/PWA primero | Evitar costo/mantencion de app nativa hasta validar necesidad real | Bajo |
| 19 | DASH-003 | Separar calculos KPI | En curso cloud: motor `kpiCalculations` separado de UI; tests KPI base implementados; falta comparacion visual/datos contra local y futuros tests agregados | Medio |
| 20 | QA-001 | Agregar pruebas simples de reglas criticas | Menos riesgo al refactorizar | Bajo |

## Plan cloud MVP propuesto

El MVP cloud sera "la app actual, pero ordenada". No se cambia la app local hasta que la replica online pueda compararse contra ella.

| Etapa | Objetivo | Entregable | Criterio de avance |
|---|---|---|---|
| A | Contrato funcional MVP | Listado cerrado de vistas y funciones actuales a replicar: Dashboard, Contactos, Ficha, Referidos, Coach reglas, KPIs, sync Google y export/import | La app local sigue siendo la referencia |
| B | Guardrails | Matriz de limites Supabase, Google APIs, hosting y IA; alertas y switches de apagado | No hay servicio pago sin limite/alerta definida |
| C | Capa de diseno y componentes | Tokens, botones, tablas, filtros, cards, Coach, referidos y graficos como componentes reutilizables y probados en desktop/mobile web | Un cambio visual comun se hace en un solo lugar |
| D | Modelo interno | Contactos propios de la app, medios de contacto, interacciones, participantes, referidos, ToDos, configs, cursores y auditoria en Postgres | Los IDs Google son referencias externas |
| E | Export local | Boton local para exportar data completa con version de schema y conteos | Export no modifica datos y puede repetirse |
| F | Carga inicial cloud | Carga inicial controlada sobre modelo nuevo | Datos cargados desde fuentes conectadas o migracion controlada calzan con el modelo cloud sin exigir fallbacks legacy |
| G | Replica web responsive | Web cloud con vistas actuales, primero para 1 usuario y luego 2 usuarios beta, validada en desktop y mobile web | Comparacion local vs cloud aprobada |
| H | Google v1 read-only | Login y conexion Google para leer contactos, Gmail y Calendar; sin escribir en Google ni exportar contactos hacia Google | Sync incremental y logs visibles |
| I | Cierre beta | QA, backups descargables, monitoreo de uso y decision de corte parcial o mantener paralelo | Costos bajo control y rollback posible |

## Replica cloud por modulos

Cada modulo se replica triangulando tres fuentes: codigo local, vista real del usuario y vision/diseno aprobado. La decision por modulo no es copiar todo: se define que se conserva, que se mejora, que se elimina y que queda como deuda o backlog.

| Orden | Modulo | Referencia local a revisar | Que debe replicarse | Logica a cuestionar antes de migrar | Criterio de cierre |
|---|---|---|---|---|---|
| 1 | Dashboard: KPIs | `mostrar_vista_dashboard`, funciones de periodos, series KPI y fecha inicio networking | 3 graficos: total cafes, contactos realizados y contactos headhunter realizados; selector semanal/mensual; acumulados; maximo 12 periodos | Si los calculos deben vivir en UI, servicio cloud o queries agregadas; como contar primera interaccion, contactos distintos, headhunter y salientes; asegurar fecha calendario sin corrimiento por zona horaria | Cloud calza contra local en conteos, periodos y acumulados, con diferencias explicadas |
| 2 | Dashboard: Coach IA | Panel de ToDos, configuracion de reglas, burbujas, acciones y mascota del Coach | Coach conversacional, sugerencias activas, seleccion multiple, ejecutar seleccion, buscar nuevas sugerencias, configuracion por tipo de sugerencia y controles para silenciar/pedir confirmacion/autoaplicar | Separar reglas duras, hibridas e IA; evitar duplicados; cerrar sugerencias cuando ya no aplican; preparar acciones ejecutables por UI/regla/agente; no dejar botones visuales sin contrato de accion. No copiar reglas legado en bloque: migrarlas una por una con aprobacion del usuario, tier minimo y contrato completo | En curso funcional: `CoachModule` global muestra la mascota del Coach, burbujas, evidencia, links cortos y colores oficiales; por defecto muestra burbujas individuales y permite alternar a vista agrupada por tipo de sugerencia; permite seleccionar multiples sugerencias existentes, ejecutar cambios de estado `NETWORKING_STATUS_CHANGE`, completar empresa con `HEADHUNTER_COMPANY_DETECTED`, descartar sugerencias, configurar tipos con `todo_configs`, buscar sugerencias RULE de estado networking/maestro headhunter, autoejecutar reglas seguras configuradas como "Ejecutar sin preguntar", consultar historial colapsable del Coach y gatillar revision acotada por contacto tras cambios relevantes de contacto/interaccion o sync/import aplicado. Pendiente para cierre: reglas HYBRID/IA, accion de revertir desde historial y ampliar catalogo de acciones solo regla por regla |
| 3 | Dashboard: Empresas headhunter | Agrupacion por dominio/empresa headhunter y filtros asociados | Tabla superior de empresas headhunter, agrupacion por dominio o sin email, ultimo contacto y estado mas avanzado | Fuente oficial del dominio, manejo de varios emails, `sin email`, y relacion con filtros de interacciones | Base cloud implementada: seleccion por empresa filtra Ultimas interacciones sin recarga completa; maestro headhunter iniciado como catalogo global con tablas, pantalla base, helper de resolucion por empresa/dominio, SQL conservador de preview/aplicacion para poblar desde contactos ya marcados como headhunter y desde base Lukkap confiable, indicador en Contactos, autocompletado del editor de contacto y regla Coach `Registra a {contacto} como headhunter, en {empresa}` para completar empresa cuando hay dominio unico. Falta conectar el agrupador del tablero al maestro como fuente definitiva y validar casos multiples/no email |
| 4 | Dashboard: Ultimas interacciones | Buckets de ultimo contacto, tabla de interacciones/contactos y links a ficha | Bloques de ultimo contacto, conteos MECE, tabla de contactos/interacciones y acceso a ficha | Calculo real de ultima interaccion, contactos sin interaccion, participantes multiples y direccion de email/mensaje | Conteos y filas calzan con local para los mismos filtros |
| 5 | Dashboard: Referidos sugeridos | Lectura de relaciones/referidos y reglas de accion | Lista de referidos accionables con contacto origen, vinculo y estado | Definir que hace accionable un referido; evitar duplicar flujo de referidos; usar objeto `referral` propio | Muestra los mismos casos relevantes y abre el flujo global de referido/contacto |
| 6 | Contactos: filtros, pipeline y tabla | Filtro global, pipeline, tabla y acciones masivas | Pipeline como filtro, filtros de tabla, orden, seleccion multiple, tabla con links a ficha | Mantener estado de filtros sin resets; default foco networking desde UI; no hardcodear filtros en codigo | En curso cloud: vista Contactos agrega filtro global fuera del panel blanco con buscador universal, selectores triestado foco/headhunter, `Mas filtros` por estado multi-seleccionable/hashtag placeholder, toolbox de acciones masivas oficiales, tabla ordenable con link a ficha y primer tablero visual por estados con drag/drop optimista, guardado diferido, columnas con fondos suaves oficiales y agrupacion opcional de empresas headhunter; la tabla ya no muestra columna de dominio headhunter y usa indicador compacto junto a empresa/cargo, conectado al maestro cuando esta disponible. El editor de contacto usa el mismo maestro para autocompletar empresas mientras se escribe, sin campo manual de dominios. Falta validar visualmente, conectar maestro al agrupador, decidir si se persiste orden de tarjetas y comparar contra legacy |
| 7 | Contactos: acciones | Acciones de foco, headhunter, estado, desactivar, opciones avanzadas | Acciones compactas globales, cambio masivo y confirmaciones | Acciones deben invocar contratos comunes, no logica de pantalla; registrar auditoria cuando corresponda | La accion masiva y la accion individual usan el mismo contrato |
| 7B | Objetivos: prioridades de busqueda | Placeholder `/objetivos`, filtro hashtag pendiente y vision de producto | Mantenedor de objetivos por Empresa, Industria, Cargo y Funcion; selector reutilizable en contacto; chips visibles, filtro global por objetivos y resumen inicial de metricas | No crear tags libres ni duplicar filtros; objetivo debe ser entidad propia por usuario y contacto-objetivo una relacion many-to-many por ID | En curso cloud: SQL preparado `cloud/supabase/add_objectives_v0_1.sql`; `objectiveActions.ts` centraliza lectura/guardado/asociacion; `/objetivos` muestra CRUD minimalista en cuatro columnas, permite seleccionar un objetivo y vincular contactos desde un modal con buscador universal/checks; editor/ficha de contacto usan selector/chips reutilizables; Contactos y Dashboard filtran por objetivos cuando existen asociaciones; Dashboard agrega tabla compacta por objetivo usando `objectiveMetrics` derivado de contactos, participantes e interacciones, con scroll interno de unas 6 filas, cafes como `calendar` + `call`, mayor estado y toggle para mostrar objetivos sin actividad. Pendiente: validar datos reales, RLS y QA visual desktop/mobile |
| 8 | Ficha: datos y estado | Bloque de identidad, datos, toggles, estado y botones de contacto | Bloque superior blanco, emails/telefonos, toggles foco/headhunter, selector de estado y acciones futuras de mail/telefono/WhatsApp | IDs propios de la app vs IDs externos; campos editables; mobile/responsive | Primer corte cloud read-only implementado desde `ContactProfile`; pendiente acciones de edicion y ajuste fino contra maqueta/local |
| 9 | Ficha: interacciones | Timeline compacto, expansion, minuta editable, eliminacion segura y sync individual | Filas compactas por tipo, colores oficiales, expansion directa, editar minuta y eliminar con confirmacion | Modelo de participantes, contenido fuente vs minuta editable, hilos de correo, eventos sin contacto, soft-delete vs restauracion por sync | Cloud conecta lapiz y `+` con `InteractionEditorDialog`; usa `interactionActions.ts` para editar minuta y crear interaccion manual con auditoria; al crear, `sentido` parte como `Sin definir`; pendiente `interaction.dismiss` con soft-delete, sync individual y comparacion fina |
| 10 | Ficha: referidos | Tarjetas de referidos y popup `Referidos y contactos` | Tarjetas compactas, vinculo opcional, crear/editar referido y contacto | Usar editor oficial, validar duplicados, no mezclar apunte de referido con contacto real | Cloud conecta tarjetas con `ReferralEditorDialog`: crear/editar referido, vincular/desvincular contacto y abrir editor global de contacto; pendiente validacion UX |
| 11 | Ficha: Coach contextual | Coach filtrado al contacto | Misma burbuja/accion que Dashboard, filtrada al contacto | Si conviene embebido o flotante; mantener componente unico reutilizable | Implementado en cloud reutilizando `CoachModule` con `contactId`, variante y tamano; pendiente ajuste visual de densidad/acciones en modo ficha |
| 12 | Sync, conectores y migraciones | Sync Google contactos/Gmail/Calendar read-only y migraciones separadas para continuidad | Carga facil de contactos desde proveedores conectados, sync read-only Google, cursores, logs y derivacion posterior a Fusionar contactos cuando haya duplicados | Capa de adaptadores; no depender de Google como fuente unica; limites de uso/costos; no fusionar contactos durante la importacion inicial; exportar contactos hacia Google/proveedores no es prioridad v1 y debe quedar como capability premium futura | Datos se pueden refrescar sin romper la app local ni exceder cuotas. La importacion de contactos queda basada solo en ID externo: ID enlazado va a `Modificaciones` o `Sin cambios`; ID no enlazado va a `Nuevos` aunque coincida correo/telefono. Primer corte de snapshots externos implementado: `external_contact_snapshots` guarda la foto cruda por proveedor y `googleContactSyncFlow` compara Google actual contra esa foto, no contra telefonos/correos locales normalizados. `prepare_contact_sync_storage_v0_1.sql` y `validate_contact_sync_storage_v0_1` protegen la importacion antes de escribir. `Fusionar contactos` ya tiene contrato, workspace global, modal productivo y revision local/manual de duplicados en Cuenta; la seleccion manual de contactos vive dentro del modal con `Agregar contacto guardado`. `ContactDuplicateReviewPanel` usa `contact.merge_deep`/`merge_contacts_deep` para fusionar contactos guardados. RPC `merge_contacts_deep` ejecutada y verificada en Supabase dev. En la ficha, `ContactDataSyncButton` actualiza datos de un contacto ya vinculado desde Google Contacts y `ActivitySyncButton` queda reservado para interacciones Gmail/Calendar. Para interacciones, `ActivitySyncButton` agrega entrada global incremental para contactos en foco y entrada individual en ficha con cursor propio por contacto; ambas muestran preview antes de aplicar, respetan la fecha global de inicio para Gmail y Calendar y muestran estados intermedios de conexion/revision/reconexion en la ficha sin pintar permiso vencido como error rojo si pueden iniciar reconexion Google. Cuenta concentra reconstruccion historica Gmail/Calendar read-only con revision dry-run acotada a contactos en foco, preview reutilizable y aplicacion confirmada. Gmail incremental usa `historyId` oficial y Calendar usa `syncToken`; si un cursor vence, se marca y se reintenta lectura historica acotada. El flujo de actividad aplica un corte interno posterior a la lectura para que no pasen correos/citas anteriores a la fecha base, normaliza IDs externos igual que el guardado para no reabrir como nuevas interacciones ya vinculadas y compara fechas por instante real para evitar falsas modificaciones. Calendar deduplica participantes por identidad. Si el foco esta inflado, la app corta Gmail/Calendar y pide acotar foco para evitar lecturas amplias. Falta log detallado, frozen preview para no re-leer Google al aplicar, alerta de duplicados pendientes antes de actividad y validacion con cuenta real |
| 13 | Acciones internas y automatizacion | Cambios de estado, editores, desactivacion, ToDos ejecutables | Catalogo de acciones para UI, reglas, Coach y futuro agente IA | Inputs/outputs claros, permisos, confirmaciones, auditoria y errores | Cada accion importante se puede invocar desde UI o regla sin duplicar codigo |
| 14 | Sistema visual y mobile | Guia UI, `/sistema/diseno`, componentes cloud y ficha local aprobada | Paleta, tipografia, botones, iconos, tablas, paneles, graficos y layout responsive | Detectar estilos hardcoded; asegurar que mobile no infle botones secundarios | Un ajuste de estilo comun se cambia en un solo lugar y pasa QA desktop/mobile |

### Checklist por modulo

Antes de cerrar cualquier modulo cloud:

1. Comparar contra la vista local real y contra la vision de producto.
2. Leer las funciones locales que alimentan esa seccion.
3. Marcar decision por pieza: replicar, mejorar, eliminar o dejar pendiente.
4. Confirmar si existe componente o funcion global reutilizable antes de crear otra.
5. Validar datos cargados contra la fuente definida para el ciclo, con conteos o muestras.
6. Probar desktop y mobile web.
7. Actualizar documentacion viva y backlog si aparece deuda o mejora futura.

## Migracion de continuidad

Estado: herramientas historicas separadas del producto.

Resumen:

- La carga inicial usada durante desarrollo queda como antecedente, no como modelo de producto.
- La base cloud debe poder reiniciarse limpia y poblarse desde conectores Google, sin depender de campos ni reglas de la app anterior.
- La continuidad de datos que no venga de Google, como minutas, referidos y estados, se resolvera despues con una migracion separada que adapte datos al modelo nuevo.

Herramientas historicas movidas fuera del producto:

- Carpeta: `tools/legacy_migration`.
- ZIP revisado: `crm-networking-export-20260727-114755.zip`.
- Resultado: version ok, archivos requeridos ok, hashes ok, 0 errores bloqueantes, 2 advertencias no bloqueantes.
- Conteos origen: 1357 contactos, 302 interacciones, 6 referidos, 22 ToDos, 18 configs de ToDos, 3 cursores sync y 1 parametro global.
- Estimacion destino: 1357 contactos, 434 emails, 1463 telefonos, 302 interacciones, 302 participantes, 6 referidos, 22 ToDos, 18 configs, 3 cursores y 1 `import_batch`.
- Dry-run de carga: ok. Conteos planeados deduplicados: 1357 contactos, 434 emails, 1463 telefonos, 232 interacciones unicas, 233 participantes, 6 referidos, 22 ToDos, 18 configs, 3 cursores, 1 setting y 1 `import_batch`.
- Carga real ejecutada: 1357 contactos, 434 emails, 1463 telefonos, 232 interacciones unicas, 233 participantes, 6 referidos, 22 ToDos, 18 configs, 3 cursores, 1 setting y 1 `import_batch`.
- Esa carga queda como dato historico de desarrollo; no debe condicionar el runtime ni el schema final de la app cloud.

## Schema Supabase/Postgres v0.1

Estado: ejecutado en Supabase dev `crm-networking-dev`.

Archivo: `cloud/supabase/schema_v0_1.sql`.

Verificacion post-ejecucion: `cloud/supabase/verify_schema_v0_1.sql`.

Incluye:

- contactos propios de la app y referencias externas por proveedor;
- emails, telefonos e interacciones con participantes;
- referidos como objeto propio;
- ToDos, configuraciones y control anti reproceso del Coach;
- registro de acciones internas solicitadas o ejecutadas por usuario, reglas, IA o sistema;
- cursores de sync, import/export, auditoria, KPIs y limites de uso;
- RLS por `user_id` para aislar usuarios desde el inicio.

Siguiente paso antes de correrlo en Supabase:

- tablas verificadas: CSV exportado muestra 22 tablas existentes;
- RLS verificado: CSV exportado muestra 22 tablas con RLS activo;
- policies verificadas: CSV exportado muestra 22 policies creadas;
- preparar una prueba chica de import con preview de conteos, sin tocar la app local.

## Guardrails iniciales de costo

- Supabase Free alcanza para un uso personal/beta chica si el volumen se mantiene dentro de sus limites de base, storage y egress. Antes de pasar a Pro, revisar costo mensual esperado y activar Spend Cap.
- La app debe tener limites propios aunque el proveedor tenga plan gratis: maximo de sync manual por dia, maximo de ventanas historicas por sync, backoff ante errores, logs de consumo y boton para pausar conectores.
- Google APIs deben usarse con sync incremental cuando exista cursor/historial. Las importaciones historicas completas deben quedar en opciones avanzadas y con confirmacion.
- IA queda fuera del MVP cloud inicial salvo reglas duras; cuando se active IA, debe tener limite diario/semanal por usuario y cache/control anti reproceso.
- Web responsive/PWA es el camino inicial para mobile. Cada vista nueva debe probarse en pantalla chica, evitando botones secundarios a ancho completo y layouts que se deformen. Expo/native queda como decision futura si aparecen necesidades reales como push nativo, share sheet, almacenamiento local avanzado o distribucion en stores.

## Permisos OAuth Google v1

Objetivo: leer/importar/sincronizar, no escribir.

Scopes candidatos a validar en implementacion:

- Perfil/login: `openid`, `email`, `profile`.
- Contactos: `https://www.googleapis.com/auth/contacts.readonly`.
- Calendario: `https://www.googleapis.com/auth/calendar.readonly`.
- Gmail: idealmente partir con `https://www.googleapis.com/auth/gmail.metadata` si alcanza para busqueda/deteccion; usar `https://www.googleapis.com/auth/gmail.readonly` solo si necesitamos cuerpo del correo para minutas/preview.

No usar en v1 sin aprobacion explicita: `contacts`, `gmail.modify`, `gmail.compose`, `gmail.send`, scopes de Calendar con escritura o el scope amplio `mail.google.com`.

Nota operativa: si `gmail.readonly` no aparece en el buscador de scopes del consent screen, se valida al crear el cliente OAuth y se puede agregar pegando el scope completo o solicitandolo desde la app. No bloquea el trabajo de export/import ni el diseno de base.

## Referencias externas a revalidar

Estos limites/precios son baseline de planificacion y deben revisarse en fuentes oficiales antes de activar billing, deploy o una beta con otro usuario:

- Supabase Pricing y Cost Control: Free para beta chica; Pro desde USD 25/mes; Spend Cap disponible en Pro y con cobertura parcial de items de uso.
- Expo/EAS Pricing: Free con builds/updates limitados; util solo si se decide empaquetar app nativa o usar Expo en el futuro.
- Google APIs: revisar cuotas vigentes de Gmail, Calendar y People API; usar sync incremental, backoff y limites por usuario.
- Google OAuth scopes: priorizar scopes read-only y granular consent.

## Criterio para cerrar Fase 0

- Documentos renombrados y con objetivo claro.
- Backlog convertido a tabla priorizable.
- Plan actual conectado al backlog.
- `AGENTS.md` consolidando reglas de trabajo para Codex.

## Criterio para cerrar Fase 1

- Contactos, interacciones, ToDos y sync tienen funciones/capa de datos centralizada.
- Las integraciones externas pasan por una capa de adaptadores con interfaces comunes.
- Google queda implementado como primer proveedor, no como supuesto unico del producto.
- Existe un mapa de funciones relevantes, duplicidades y decisiones de refactor antes de construir la replica cloud.
- La nueva plataforma no copia acoplamientos innecesarios de `app.py`; separa UI, datos, integraciones, reglas, KPIs, ToDos y autenticacion.
- La app funciona igual que antes.
- Las escrituras directas a Sheets estan reducidas o localizadas.
- Existe una estrategia clara para migrar esa capa a Postgres.

## Criterio para cerrar Fase 2

- La app local tiene un boton de exportar data completa.
- El export incluye contactos, emails, telefonos, interacciones, participantes, minutas/notas editables, relaciones, ToDos, configuracion, cursores y auditoria disponible.
- El archivo exportado tiene version de schema y fecha de generacion.
- La app cloud puede importar el archivo y quedar como espejo funcional de la app local.
- Existe una validacion de conteos y muestras entre local y cloud.

## Principios de migracion cloud

- La app local sigue funcionando durante toda la transicion.
- La nube se construye primero como replica comparable, no como reemplazo inmediato.
- No se corta Google Sheets hasta que la nube replique datos, vistas principales y resultados clave.
- Las fuentes y servicios externos se conectan mediante adaptadores: Google, Apple, Microsoft/Outlook, CSV/Excel, mensajeria, IA, notificaciones y futuras integraciones.
- Para el MVP cloud solo se implementa Google como conector activo. Apple, Microsoft/Outlook y otros servicios quedan disenados en la capa, pero no construidos en v1.
- El modelo interno debe usar contactos, medios de contacto, interacciones y participantes como conceptos propios de la app, no conceptos exclusivos de Google.
- Cada usuario cloud debe tener datos aislados, cuentas conectadas propias y posibilidad de descargar respaldo.
- Cada paso cloud debe pasar por revision de arquitectura: que se reutiliza, que se mejora, que duplicidad se elimina y que documentos se actualizan.
- Los cambios con impacto en datos, permisos, OAuth, costos o privacidad requieren explicacion previa y confirmacion del usuario.
- La app debe preferir responsive web/PWA antes que app nativa para reducir mantencion. No bloquear una futura app mobile, pero no asumirla como requisito del MVP.

## Historial

- 2026-08-26: Se agrega `docs/PRIVACY_SECURITY_COMPLIANCE.md` como manual vivo y gate del sprint de cuentas, usuarios y privacidad. El siguiente bloque multiusuario debe validar privacidad chilena, roles/capabilities, RLS, OAuth persistente, logs y pruebas con dos usuarios antes de beta.
- 2026-08-26: Se completa auditoria inicial del sprint multiusuario. Hallazgos principales: RLS de usuario existe en la mayoria de tablas privadas, pero falta modelo formal de acceso; Cuenta aun depende de sesion OAuth temporal para Google; admin y maestros globales siguen con gates beta demasiado permisivos.
- 2026-08-26: Se prepara `cloud/supabase/add_account_access_model_v0_1.sql` como propuesta revisable, no ejecutada, para roles, planes, capabilities, organizaciones, membresias y patrocinios.
- 2026-08-27: Se avanza privacidad operativa: `syncRunLog` centraliza redaccion de correos, telefonos, tokens y metadata sensible; `external_interaction_read_diagnostics` deja de guardar descripcion cruda de Calendar y pasa a guardar resumen tecnico acotado. Validado con `npm run test:logs` y `npm run typecheck`.
- 2026-08-27: Se agrega `cloud/supabase/verify_multiuser_readiness_v0_1.sql` como preflight estructural de beta multiusuario. Revisa metadata de tablas privadas/globales, RLS/policies, resolvedor de capacidades y trigger de alta sin leer ni modificar datos de usuarios.
- 2026-07-15: Se renombra `TRANSITION_PLAN` a `CURRENT_PLAN` y se enfoca en plan de trabajo actual conectado al backlog.
- 2026-07-20: Se ajusta plan cloud para mantener app local como referencia y crear capa agnostica de fuentes/servicios.
- 2026-07-20: Se agrega criterio de migracion prolija: auditar duplicidades, separar responsabilidades y pedir permisos ante impactos sensibles.
- 2026-07-21: Se agrega rediseño modular de ficha de contacto como tramo funcional previo a seguir con plataforma cloud.
- 2026-07-21: Se implementa primera version activa de la ficha modular basada en maqueta y queda pendiente revision visual fina.
- 2026-07-21: Se agrega trabajo de componentes reutilizables UI al plan inmediato; Coach y referidos inician esa migracion.
- 2026-07-22: Se reordena la revision de ficha: punto 6 robot compacto, punto 7 bloque info, punto 8 flujo crear/vincular referidos.
- 2026-07-22: Se implementan ajustes de punto 6 y 7 en ficha: robot mini con dimensiones reales, botones estandar y tarjetas de correo/telefono con borde.
- 2026-07-22: Se redefine el punto de referidos: primero modelo ampliado, luego editor oficial de contacto, editor oficial de referido y finalmente reemplazo del flujo de ficha.
- 2026-07-22: DATA-006 avanza con soporte de lectura/escritura normalizada para referidos legacy/ampliados; proximos pasos: CONTACT-010 y CONTACT-011.
- 2026-07-22: CONTACT-010 avanza con editor global de contacto, validaciones y proteccion de contactos nativos de la app.
- 2026-07-22: CONTACT-011 avanza con helper oficial de referido y el popup legacy pasa a delegar en esa escritura centralizada.
- 2026-07-22: Se reemplaza el popup legacy por `Referidos y contactos`, con referido editable, contacto vinculado opcional y editor de contacto reutilizable.
- 2026-07-22: Se agrega identidad app transicional para contactos (`Contact_ID`) y metadatos de proveedor, paso previo a separar proveedores externos de la fuente de verdad de la app.
- 2026-07-22: Se ajusta plan cloud MVP: todo lo actual pero ordenado, Google-only v1, app local viva, guardrails de costo, OAuth read-only y web responsive/PWA antes que app nativa.
- 2026-07-22: Se agrega validacion obligatoria desktop/mobile web para interfaz, con foco en botones compactos, toolbars y layouts que no se deformen en pantalla chica.
- 2026-07-22: Usuario deja listas las plataformas base: GitHub repo `crm-networking-cloud`, Supabase `crm-networking-dev` en Americas, Vercel y Google Cloud `crm-networking-dev` con APIs activadas; queda pendiente validar/agregar `gmail.readonly`.
- 2026-07-22: Se define herramienta transicional de continuidad y el siguiente paso pasa a ser implementar el boton local de export ZIP sin modificar datos.
- 2026-07-22: Se implementa boton `Exportar` en opciones avanzadas de Contactos para generar ZIP espejo local; queda pendiente validar descarga/contenido con datos reales.
- 2026-07-22: Usuario confirma descarga exitosa del ZIP espejo local usado para continuidad inicial durante desarrollo.
- 2026-07-27: Se crea schema Supabase/Postgres v0.1 local en `cloud/supabase/schema_v0_1.sql`; queda pendiente aprobacion y ejecucion controlada en Supabase dev.
- 2026-07-27: Se agrega TECH-006 para catalogar acciones internas ejecutables por UI, reglas y Coach IA, con contratos, confirmacion y trazabilidad.
- 2026-07-27: Se agrega `cloud/supabase/verify_schema_v0_1.sql` para validar tablas, RLS y policies despues de ejecutar el schema.
- 2026-07-27: Usuario ejecuta `schema_v0_1.sql` en Supabase dev con exito. CSVs exportados confirman 22 tablas existentes, 22 policies creadas y RLS activo en las 22 tablas. DATA-002 queda cerrado.
- 2026-07-27: Se crean herramientas transicionales para continuidad de datos y se prueban contra un ZIP real.
- 2026-07-27: Se corrige import para JSONB y para consolidar interacciones duplicadas como una interaccion con participantes. Usuario ejecuta carga real con `--apply` y Supabase recibe los conteos planeados.
- 2026-08-11: Las herramientas transicionales se mueven a `tools/legacy_migration`; la app cloud deja de tratarlas como parte del producto.
- 2026-07-27: Usuario confirma verificacion SQL post-import; se crea `cloud/web` como primera app Next/React conectable a Supabase en modo solo lectura, con dependencias instaladas, typecheck/build ok y pendiente configurar `.env.local` para validar en navegador.
- 2026-07-27: `cloud/web` se valida en navegador con datos reales. Se agrega capa comun de lectura y se corrige Contactos para cargar todos los contactos activos en vez de una muestra inicial.
- 2026-07-27: Se agrega anexo visual cloud `/sistema/diseno` y componentes UI globales para iconos, botones y tarjetas metricas.
- 2026-07-28: Dashboard cloud inicia rediseño modular read-only con componentes globales para panel, pipeline, Coach preview y tarjetas recientes; se prueba en desktop y mobile web.
- 2026-07-28: Dashboard cloud se reordena para calzar con el Dashboard local: KPIs superiores, Coach IA, Empresas headhunter, Ultimas interacciones y Referidos sugeridos.
- 2026-07-28: Coach cloud deja de ser solo lectura para cambios de estado: permite seleccionar ToDos activos, ejecutar los soportados, actualizar el estado del contacto, marcar el ToDo como `done`, descartar sugerencias como `dismissed` y registrar acciones. No se migra aun generacion/revision de reglas ni configuracion por tipo.
- 2026-07-28: Coach cloud agrega configuracion por tipo de sugerencia desde `todo_configs`, con modos `confirm_always`, `execute_without_asking` y `do_not_suggest`.
- 2026-08-21: Se corrige el alcance de configuracion del Coach: la UI y el sembrado automatico quedan limitados a reglas aprobadas e implementadas. Las ideas HYBRID/IA no aparecen en `todo_configs` hasta que el usuario apruebe cada regla con condicion, accion, evidencia y tier.
- 2026-07-28: Coach cloud agrega motor `RULE` inicial para cambios de estado networking: revisa contactos/interacciones en Supabase, respeta foco/contacto activo, aplica prelacía documentada, crea o mantiene una sugerencia por contacto, cierra sugerencias inferiores o no vigentes y guarda `object_review_state`. El boton del Coach "Buscar sugerencias" queda conectado.
- 2026-07-28: Coach cloud agrega autoejecucion para reglas seguras marcadas como "Ejecutar sin preguntar" al correr la revision de sugerencias, usando la misma accion interna que la ejecucion manual.
- 2026-07-28: Historial del Coach cloud se simplifica como log de sugerencias no vigentes: lee `todos` cerrados (`done`, `dismissed`, `expired`, `auto_resolved`), muestra el mismo mensaje de la burbuja activa, stamp de estado/autor/fecha, filtros por estado y detalle colapsable con motivo de cierre, regla, evidencia legible y link al contacto.
- 2026-07-28: Se agrega plan de replica cloud por modulos, triangulando codigo local, vista real y vision/diseno antes de decidir que replicar, mejorar o eliminar.
- 2026-07-29: Se inicia la Ficha de contacto cloud como bloque madre read-only: tabla de Contactos abre `/contactos?contactId=...`, `ContactProfile` muestra datos, interacciones, referidos y Coach contextual reutilizando `CoachModule`.
- 2026-07-30: Ficha cloud conecta referidos al flujo global `Referidos y contactos`, reutilizando `ContactEditorDialog` para crear/editar contactos vinculados.
- 2026-07-30: Ficha cloud conecta interacciones al flujo global `InteractionEditorDialog` para editar minutas y crear interacciones manuales desde el contacto.
- 2026-07-30: Se implementa primera version cloud de eliminacion segura de interacciones: `interaction.dismiss` archiva via `metadata`, escribe columnas soft-delete si existen, registra `action_invocations`/`audit_log`, y ficha/Dashboard/Coach filtran interacciones archivadas. Queda pendiente ejecutar/formalizar migracion SQL y configurar bloqueo/restauracion de reimportacion por sync.
- 2026-07-30: Se prepara el modelo app+origen externo para interacciones: schema y sync agregan `external_interaction_sources` para guardar IDs externos, thread, detalle fuente, hash, estado de sync y control de relectura. Pendiente validar UI/iconos/link al origen con datos limpios.
- 2026-07-30: Se prepara diagnostico de interacciones duplicadas por origen externo y se define regla de Coach multi-contacto: una sugerencia compartida aparece en varias fichas pero sigue siendo un solo ToDo.
- 2026-07-30: Ficha cloud agrega indicador informativo de interaccion compartida: usa `interaction_participants`, icono `users` y tooltip con participantes por rol (`De`, `Para`, `CC`, `CCO`) sin convertirlo en boton de accion.
- 2026-07-30: Ficha cloud agrega indicador de origen externo para interacciones vinculadas a proveedor: lee `external_interaction_sources`, muestra icono Google y abre Gmail si hay ID usable; Calendar queda como origen vinculado sin link hasta poblar `htmlLink`.
- 2026-07-30: Se crea capa comun agnostica de sync de interacciones externas (`externalInteractionSync.ts`): los adaptadores de proveedor entregaran objetos normalizados y esta capa crea/actualiza interacciones, origen externo, participantes y punteros de revision sin depender directamente de Google.
- 2026-07-30: Se crea adaptador Google de interacciones (`googleInteractionAdapter.ts`) con pruebas: mapea Gmail/Calendar al formato comun, soporta `TO`/`CC`/`BCC`, descarta correos de terceros donde usuario/contacto solo estan copiados y conserva `htmlLink` de Calendar.
- 2026-07-30: Se crea orquestador comun de sincronizacion cloud (`syncOrchestrator.ts`): expone funciones reutilizables para mail/calendario con inputs/outputs de lote, conteos, errores, dry-run, alcance y objetos afectados. Contactos queda con contrato seguro que exige preview/confirmacion antes de aplicar cambios.
- 2026-07-31: Se crea preview global de sincronizacion cloud (`SyncPreviewDialog`) y tipos `SyncPreviewChange`: la UI agrupa nuevos/modificados/consolidaciones/desactivaciones/eliminados en tarjetas seleccionables y devuelve al flujo llamador que aplicar, sin escribir datos por si misma.
- 2026-07-31: `SyncPreviewDialog` pasa a pestanas por tipo de cambio: `Nuevos`, `Modificaciones`, `Duplicados fusionables`, `Duplicados complejos` y `Eliminaciones`; cada pestana accionable maneja su propia seleccion/aplicacion y la pestana de eliminaciones deja preparada la accion `No eliminar ni volver a sugerir`. Desde 2026-08-14, `Sin cambios` deja de mostrarse como pestana y queda solo como conteo diagnostico fuera del modal.
- 2026-07-31: Se agrega `contactSyncPreview.ts`, motor puro de comparacion app vs fuente conectada para contactos. Genera preview sin escribir datos y valida reglas clave: campos vacios de fuente no eliminan datos locales, enriquecimiento de campos vacios, eliminacion multivalor solo si el dato era conocido desde esa fuente y soporte de supresiones.
- 2026-08-12: Se completa limpieza de huellas de migracion anterior en cloud. La app deja de usar columnas heredadas como respaldo de pareo, Coach/KPIs/interacciones cloud dejan de leer IDs/textos heredados, el lenguaje visible cambia a `Fuente conectada`/version cloud, el schema base queda sin `legacy_*`, las herramientas antiguas quedan fuera de `cloud/` y se preparan scripts de reset/verificacion dev. Usuario ejecuta reset Supabase dev, elimina tablas backup antiguas y confirma verificacion final con datos y `legacy_columns` en 0. Siguiente paso: cargar contactos/interacciones desde Google.
- 2026-07-31: Se agrega `ContactSyncPreviewSandbox` en `/sistema/diseno` para probar el preview de contactos con datos reales de la app y una fuente simulada, sin escritura ni Google real.
- 2026-07-31: Se agrega `googleContactAdapter.ts` para normalizar personas de Google People API al contrato externo comun de contactos, incluyendo `deleted` y `previousResourceNames`, sin conectar aun OAuth ni llamar APIs reales.
- 2026-07-31: Se agrega `googleContactsClient.ts`, cliente read-only para People API `people/me/connections`: soporta paginacion, `requestSyncToken`, `syncToken`, `nextSyncToken`, limite de paginas y error explicito cuando Google informa `EXPIRED_SYNC_TOKEN`.
- 2026-07-31: Se agrega `syncCursorStore.ts`, helper global para leer, guardar y marcar cursores vencidos en Supabase. Siguiente paso: conectar el flujo real de contactos Google para leer incremental, generar preview y guardar `nextSyncToken` solo despues de aplicar o cerrar correctamente la revision.
- 2026-07-31: Se agrega `googleContactSyncFlow.ts`, que prepara el preview real de Google Contacts conectando app contacts, referencias externas, valores conocidos por fuente, cursor guardado y cliente Google read-only. Si el cursor vence, marca el cursor como vencido y reintenta lectura completa. Pendiente: aplicar cambios seleccionados y guardar el nuevo cursor al cerrar correctamente el flujo.
- 2026-07-31: Se agrega `contactSyncApply.ts`, accion oficial para aplicar cambios seleccionados del preview de contactos. Guarda el cursor nuevo solo cuando se aplico todo lo revisado sin errores; si el usuario deja cambios sin seleccionar, quedan pendientes para la siguiente sincronizacion.
- 2026-07-31: El sandbox de `/sistema/diseno` ahora usa el aplicador oficial de preview de contactos en modo simulado. Permite probar seleccion, cambios pendientes y cursor sin escribir datos reales; siguiente paso es conectar esta misma accion al flujo real de Google Contacts/OAuth.
- 2026-07-31: Se conecta en `Sistema` una primera UI real para Google Contacts: boton de conexion OAuth read-only, revision incremental/completa, preview con seleccion y aplicacion confirmada en Supabase cloud. Pendiente validar configuracion OAuth real y mover el acceso final a ubicacion de producto cuando este estable.
- 2026-08-03: Se crea `/cuenta` como ubicacion de producto para perfil, plan, conexiones y sync delicado; Google Contacts sale de `Sistema` y OAuth retorna a Cuenta.
- 2026-08-03: Se pausa `No eliminar ni volver a sugerir` por confusion de usabilidad. La tabla dev queda creada, pero la app no la usa hasta redisenar esa decision como accion separada.
- 2026-07-31: Sync de contactos cloud agrega tipo interno `Sin cambios` y fusiona varios objetos externos que apuntan al mismo contacto app en una sola linea de preview, conservando todos los IDs externos para enlazarlos al aplicar. Desde 2026-08-14, ese tipo no se muestra como pestana visual para evitar confundir la revision.
- 2026-08-12: Se revierte la fusion dentro de la importacion de contactos. El preview queda basado solo en ID externo: si Google trae un ID no enlazado, el contacto entra como `Nuevo` aunque coincida por correo o telefono; esos duplicados se resuelven despues con `Revision de duplicados`. La base permite correos/telefonos repetidos entre contactos y `contactSyncApply` enlaza el ID externo temprano para que una interrupcion no convierta el mismo contacto en duplicado falso.
- 2026-08-12: Se agrega preparacion unica de almacenamiento para sync de contactos: `prepare_contact_sync_storage_v0_1.sql` crea/valida snapshots externos e indices por contacto, y `contactSyncApply` ejecuta `validate_contact_sync_storage_v0_1` antes de escribir. Los scripts de reset/verificacion dev incluyen `external_contact_snapshots` para poder repetir cargas limpias desde Google.
- 2026-08-03: `Fusionar contactos` deja de ser solo maqueta: se crea contrato `contactMerge`, workspace global, modal `ContactMergeDialog` y conexion desde `SyncPreviewDialog` en `Nuevos` y `Modificaciones`; el aplicador guarda el resultante definido por el usuario al crear o modificar el contacto. El preview de sync remueve localmente los cambios aplicados y conserva pendientes sin releer el proveedor.
- 2026-08-04: Se habia explorado separar duplicados dentro del preview de sync; el criterio queda deprecado para importacion inicial. La deteccion por correo/telefono vive ahora en `Revision de duplicados`, despues de importar.
- 2026-08-03: Se prepara `contact.merge_deep`: wrapper `contactMergeActions.ts`, pruebas de normalizacion y SQL `merge_contacts_deep_v0_2.sql` para fusion transaccional de contactos app. `contactSyncApply` ya detecta propuestas con mas de un contacto guardado y las deriva a esta accion profunda.
- 2026-08-04: Usuario ejecuta y verifica `merge_contacts_deep_v0_2.sql` en Supabase dev. `verify_merge_contacts_deep_v0_2.sql` confirma `public.merge_contacts_deep(p_target_contact_id uuid, p_source_contact_ids uuid[], p_result jsonb, p_source text)`, `security_definer=false`, `volatility=v`. Pendiente validar con caso real controlado.
- 2026-08-04: Cuenta agrega `Revision de duplicados`: `contactDuplicateReview` detecta duplicados guardados por correo/telefono normalizado, incluidos grupos indirectos, y `ContactDuplicateReviewPanel` reutiliza `ContactMergeDialog` y `merge_contacts_deep` para fusionar grupos detectados o una fusion manual iniciada desde boton simple. La busqueda de contactos se mueve al modal global (`Agregar contacto guardado`, maximo 3). En sync, `Duplicados complejos` permite abrir ese mismo modal desde el conteo de guardados cuando hay 2 o 3 contactos internos.
- 2026-08-04: Sync cloud de interacciones avanza en capa tecnica: `googleInteractionClient.ts` lee Gmail/Calendar read-only con limites y errores controlados, y `googleInteractionSyncFlow.ts` conecta lectura, adaptadores, cursores y orquestador comun de interacciones en modo incremental/dry-run. Queda pendiente conectar OAuth real, UI de Cuenta, preview/log y validacion con una cuenta real antes de activarlo para usuario.
- 2026-08-10: Se baja prioridad a exportar/sincronizar contactos hacia Google u otros proveedores. Importar contactos hacia la app sigue siendo prioritario para reducir friccion de entrada; exportar contactos queda como capacidad premium futura con reglas anti-abuso, cuotas y condiciones comerciales por definir. Coach IA no debe copiar reglas legacy en bloque: cada regla se revisara y migrara una por una con confirmacion del usuario, tier minimo y contrato completo.
- 2026-08-11: Cuenta agrega panel beta `GoogleInteractionsSyncPanel` para Gmail/Calendar: reutiliza `syncGoogleInteractions`, solicita scopes read-only junto con contactos, corre revision dry-run sin escribir, limita a 200 correos o 200 eventos por corrida, y solo escribe interacciones al presionar `Aplicar sincronizacion`. Luego se agrega resumen visible reutilizable (`InteractionSyncResultSummary` + `interactionSyncText`) para explicar encontrados en Google, posibles, nuevos, modificados y omitidos sin duplicar wording con el boton global. El 2026-08-13 se separa la interfaz de Cuenta en `Revisar correos` y `Revisar citas`, manteniendo un solo motor parametrizado por recurso para evitar duplicar logica. Calendar no usa reglas especiales de busqueda por contacto: lee eventos desde la fecha base y filtra al mapear participantes. Falta log persistente visible, frozen preview para aplicar sin releer proveedor y validacion final con cuenta real.
- 2026-08-11: Sync de actividad se separa por entrada de uso: `Cuenta` queda para reconstruccion historica desde `Fecha_Inicio_Networking` sin mover cursores; la barra superior agrega accion incremental rapida para contactos en foco; la ficha agrega accion individual para un contacto, usando query por correo y sin guardar cursores globales. Todo reutiliza `syncGoogleInteractions`.
- 2026-08-13: Cuenta expone `Fecha_Inicio_Networking` como `Fecha de inicio de networking`, con campo de fecha y confirmacion antes de guardar. La vista evita explicaciones duplicadas; el impacto sobre correos/citas historicas y KPIs se advierte en la confirmacion.
- 2026-08-13: Sistema agrega `Mantencion admin` como consola beta para seguros de uso: muestra parametros editables de app, limite asociado del proveedor, ventana de reseteo y acumulado interno con barra. Las metricas se agrupan por servicio, manteniendo arriba lo mas critico dentro de cada bloque, y las cuotas por usuario ajustan su indicador agregado con la cantidad de usuarios considerados. Se incorpora primera referencia real de Supabase desde pantallazos del dashboard: base 34.2 MB, egress 132 MB, MAU 2, storage 0, realtime 0 y Edge Functions 0. Los topes por corrida de Google Contacts, Gmail y Calendar quedan visibles y conectados al sync real desde `usageLimitSettings`. Queda como vista operativa inicial; antes de produccion debe conectarse a enforcement real, eventos de uso completos y perfilamiento/RLS admin.
- 2026-08-13: Cuenta ajusta el idioma de sync de actividad: `Importar actividad` queda como carga pesada por tipo (`Importar correos`, `Importar citas`) sin mover cursores y los botones corrientes se nombran como actualizacion de interacciones para no confundirlos con Google Contacts. Se limpia `Servicios conectados` para mostrar conectores sin bloques explicativos y se remueven acciones redundantes fuera del popup. Calendar, cuando trabaja por foco/contacto sin `syncToken`, ahora consulta por emails del alcance y deduplica eventos antes de mapear participantes, para evitar perder citas por limites de lectura amplia.
- 2026-08-20: Ficha contacto separa sync de datos y sync de interacciones. La cabecera del contacto usa `ContactDataSyncButton` para actualizar datos de ese contacto desde Google Contacts si ya tiene ID externo vinculado; el bloque `Ultimas interacciones` usa `ActivitySyncButton` para Gmail/Calendar. El editor `Editar datos` del preview permite guardar propuestas de contacto nuevo con una sola fuente y su accion principal pasa a `Guardar cambios`.
- 2026-08-14: Los flujos de revisar/importar contactos, correos y citas abren siempre la ventana de resultado en modo revision, incluso cuando no hay cambios aplicables. Esto evita que una lectura valida parezca no haber hecho nada y deja visible el resumen para pruebas. Cuenta deja de mostrar textos tecnicos persistentes de resultado; los pasos operativos pasan a `sync_run_logs`, visibles desde `Sistema > Logs`.
- 2026-08-14: Sistema agrega `Logs` como visor de ultimas sincronizaciones del usuario y Mantencion admin agrega `Datos crudos` como visor universal de tablas permitidas, con selector de tabla y busqueda por texto. Esto reduce la necesidad de armar SQL ad hoc durante diagnosticos.
- 2026-08-21: `Datos crudos` en Mantencion admin amplia su catalogo de tablas permitidas para cubrir las tablas operativas principales del schema cloud, incluidos maestros de empresas headhunter y dominios. Se mantienen fuera columnas sensibles como tokens OAuth.
- 2026-08-21: Maestro headhunter se corrige como catalogo global transversal: schema, acciones, seeds y visor de datos dejan de tratarlo como tabla por usuario. Se agrega migracion `make_headhunter_company_master_global_v0_2.sql` para bases ya creadas con `user_id`.
- 2026-08-21: Se agrega regla de nomenclatura de datos: tablas, columnas y salidas SQL de diagnostico deben usar nombres descriptivos; se corrigen previews/seeds del maestro headhunter para no mostrar `section`, `key`, `value` ni `metric` como encabezados.
- 2026-08-21: El editor global de contacto queda conectado al maestro headhunter: al marcar un contacto como headhunter, el campo empresa ofrece autocompletado propio desde el catalogo global mientras se escribe. Se elimina el campo manual `Empresas headhunter`; los dominios internos existentes se preservan al guardar, y la deteccion positiva por dominio pasa a la regla Coach `HEADHUNTER_COMPANY_DETECTED`.
- 2026-08-21: Coach agrega gatillos por contacto despues de cambios en contacto/interacciones y despues de aplicar sync/import de contactos o interacciones; la configuracion de automatizaciones se asegura por usuario desde `todo_configs` sin depender de carga previa.
- 2026-08-21: Se agrega `cleanup_unapproved_coach_configs_v0_1.sql` para eliminar configuraciones no aprobadas del Coach y cerrar sugerencias activas de tipos no aprobados.
- 2026-08-21: Configuracion del Coach pasa a agruparse por variable afectada (`Estado networking`, `Empresa headhunter`) y el Coach general agrupa sugerencias activas por tipo/cambio, con opcion de expandir a burbujas individuales.
- 2026-08-14: Diagnostico de Google Contacts agrega consulta read-only por nombre/email para verificar contacto local, medios, ID externo Google y snapshot. Se ajusta `googleContactsClient` para pedir `requestSyncToken` solo en la primera pagina de una lectura completa; las paginas siguientes solo usan `pageToken`, evitando pedir cursores repetidamente durante una misma paginacion.
- 2026-08-14: Se corrige falso `Nuevo` en Google Contacts cuando hay mas de 1000 contactos enlazados. `googleContactSyncFlow` ahora pagina la lectura interna de enlaces y snapshots en Supabase; el caso Alienor mostro que el contacto y su Google ID estaban correctos, pero el preview solo leia una parte de las referencias por el tope de filas de la API.
- 2026-08-14: Google Contacts agrega diagnostico visible por checkpoints durante la importacion. Si Google rechaza una lectura completa al solicitar cursor incremental futuro, la app reintenta la misma lectura sin pedir ese cursor; asi puede preparar/aplicar la importacion aunque el cursor quede pendiente para una pasada posterior.
- 2026-08-13: Se agrega diagnostico crudo de lecturas Calendar en `external_interaction_read_diagnostics`: las revisiones dry-run pueden guardar todos los eventos que Google devolvio, aunque no queden como interacciones posibles, para comparar participantes, match de emails, fecha, asunto y motivo de descarte sin tocar minutas ni interacciones internas.
- 2026-08-13: Se corrige guardia de Calendar en revisiones acotadas por foco/contacto: si no se puede construir una busqueda por emails dentro del limite beta, la app avisa y no cae a lectura amplia ordenada desde la fecha inicial, evitando cortes falsos como quedar solo hasta abril.
- 2026-08-13: El plan inmediato se reordena: primero cerrar pruebas reales de contactos, correos y citas con el usuario actual; despues robustecer multiusuario y conexiones. El proximo bloque debe hacer que `connected_accounts` sea la fuente persistente de verdad para cuentas externas, scopes, estado de permiso y revocacion, separando login de Google de permisos de importacion y preparando RLS/roles/tokens seguros antes de sumar otro usuario real.
- 2026-08-20: Cabecera cloud ajustada para priorizar `Dashboard`, `Contactos` y `Objetivos` a la izquierda, dejando `Sistema`, `Cuenta` y sync global como iconos secundarios con tooltip. La ficha usa icono de actualizar para datos del contacto y tooltips diferenciados para datos vs interacciones. `syncGoogleInteractions` tolera permiso parcial Gmail/Calendar: si un servicio falla por permiso pero el otro funciona, abre preview con lo disponible y registra advertencia.
- 2026-08-20: Botones de sync en ficha dejan de depender del token Google cacheado al cargar la pagina. Antes de revisar datos de contacto o interacciones, leen la sesion Google vigente; si falta permiso, derivan a reconectar en vez de requerir un segundo clic ambiguo. Si Google devuelve 401/403, limpian el token local e inician reconexion en el mismo flujo.
- 2026-08-25: Se incorpora Objetivos al plan cloud como modulo propio. Se valida que hoy solo existe placeholder `/objetivos` y placeholder de hashtag en filtros; no hay modelo funcional duplicado. Se prepara SQL `add_objectives_v0_1.sql` con `objectives` y `contact_objective_assignments`, se documenta el alcance MVP y se agregan items OBJ-001 a OBJ-004 al backlog.
- 2026-08-25: Primer corte de Objetivos implementado en cloud: ruta `/objetivos`, acciones globales, selector reusable en editor, chips en ficha, filtro global por objetivo en Contactos/Dashboard y visor admin para tablas nuevas. Tras cargar objetivos reales, se ajusta la lectura de asociaciones por lotes para no romper Contactos/Dashboard con muchos contactos y se prepara `fix_objective_assignment_rls_v0_1.sql` para simplificar RLS de lectura si Supabase bloquea asociaciones.
- 2026-08-25: Vista Objetivos ajustada a cuatro columnas en orden Industrias, Empresas, Cargos y Funciones. Cada objetivo muestra acciones solo al seleccionarlo y agrega modal para vincular/desvincular contactos con buscador universal y checks, escribiendo en la misma relacion `contact_objective_assignments` que usa el editor de contacto.
- 2026-08-26: UX Objetivos refinada: modal de vinculacion ordena contactos seleccionados arriba, filtros globales de objetivos usan logica OR entre objetivos, se elimina boton `Todos` en estados, chips de objetivos ocupan el ancho disponible sin superponerse y cada objetivo permite cambiar prioridad rapido con estrellas sin abrir el editor.
- 2026-08-26: Contactos incorpora asignacion masiva de objetivos desde el toolbox de la tabla: selector multiobjetivo compacto, objetivos seleccionados arriba y aplicacion sobre todos los contactos marcados sin borrar objetivos existentes. El filtro expandido de objetivos se ajusta como franja horizontal scrolleable para evitar superposiciones entre categorias.
- 2026-08-27: Cuenta avanza `connected_accounts` como fuente persistente: los flujos Google centralizan OAuth, registran scopes conocidos, muestran permisos por tipo y permiten desvincular Google dentro de la app sin borrar datos importados. Refresh tokens siguen fuera del runtime hasta aprobar estrategia de cifrado/revocacion/auditoria.
- 2026-08-27: Se centraliza `readCurrentGoogleConnectionState` para que Cuenta, importadores y botones de ficha separen conexion persistente de token temporal. Esto evita que una cuenta desvinculada siga importando solo porque la sesion OAuth del navegador aun tiene token.
- 2026-08-27: Se prepara `reset_current_user_app_data_v0_1.sql` y boton `Reiniciar datos` en Cuenta para que el usuario borre sus datos operativos y parta de cero sin borrar login, plan, roles ni maestros globales. La accion exige capability `data.delete_account` y confirmacion literal.
- 2026-08-27: `Datos crudos` en Mantencion admin agrega filtro por alcance, resumen de filas por tabla y filtros/orden por columnas visibles, sin crear metadata adicional en base.
- 2026-08-27: Se corrige matriz de permisos para `Reiniciar datos`, agregando `data.delete_account` a `system_admin` y `beta_personal`; se deja SQL puntual para bases existentes. El maestro headhunter queda preparado para cerrar escritura solo a `admin.manage_global_masters`, sin policy beta abierta en schema base.
