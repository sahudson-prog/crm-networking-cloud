# Current data model

Este documento describe el modelo de datos actual usado por la app. No contiene pendientes ni ideas futuras.

## Fuente actual

La app usa Google Sheets como base de datos. El rango principal de contactos es `CRM_Contactos_Extra!A:Y`.

Antes de migrar o cambiar columnas, contrastar este documento con los encabezados reales de la planilla.

## CRM_Contactos_Extra

| Columna | Que representa | Uso principal | Formato requerido |
|---|---|---|---|
| `Google_ID` | ID legacy usado por el codigo actual como llave operativa | Compatibilidad con interacciones, referidos, ToDos y sync existentes | Texto no vacio. Externo actual: `people/...`; nativo app legacy: `APP_CONTACT_...` |
| `Contact_ID` | ID propio de la app para el contacto | Identidad canonica futura del contacto, independiente de Google/Apple/Microsoft/CSV | Texto `APP_CONTACT_...`; se infiere si esta vacio |
| `Provider` | Fuente principal que origino o actualizo el contacto | Separar identidad app de fuentes externas | `Google`, `App`, `Manual` u otro proveedor futuro |
| `Provider_Contact_ID` | ID del contacto en la fuente externa | Vincular/importar/exportar hacia servicios conectados | `people/...` para Google; vacio si es creado solo en la app |
| `Nombre_Visual` | Nombre mostrado al usuario | Tablas, ficha y busqueda | Texto |
| `Emails_Concatenados` | Emails del contacto en una celda | Sync Gmail, dominio HH, reasignacion | Emails separados por `;` si hay varios |
| `Telefonos` | Telefonos del contacto | Match alternativo y visualizacion | Texto, varios separados por `;` |
| `Empresa_Google` | Empresa importada o editada | Tabla, filtros y dashboard | Texto |
| `Cargo_Google` | Cargo/rol del contacto | Tabla y ficha | Texto |
| `Scope_Networking` | Si esta en foco activo de networking | Filtro principal de contactos | `TRUE` o `FALSE` |
| `Nivel_Cercania` | Nivel de cercania con el contacto | Priorizacion futura | Numero/texto simple |
| `Es_Headhunter` | Marca si el contacto es headhunter | Dashboard HH y filtros | `TRUE` o `FALSE` |
| `Dominios_Headhunter` | Dominios/empresas HH asociados | Agrupar empresas headhunter | Dominios separados por `;`, ejemplo `@empresa.cl` |
| `Estado_CRM` | Estado oficial de networking | Pipeline, filtros, ToDos y KPIs | Uno de los estados oficiales |
| `Estado_Sync` | Resultado/estado de sincronizacion | Diagnostico visible | Texto controlado por la app |
| `Estado_Contacto` | Si el contacto esta activo/desactivado | Evitar borrar historial | `Activo` o `Desactivado` |
| `F_Pendiente` | Fecha legacy del hito pendiente | Historial/mapeo legacy | Fecha o vacio |
| `F_Promesa_Cafe` | Fecha legacy de promesa cafe | Historial/mapeo legacy | Fecha o vacio |
| `F_Propuesta_Cita` | Fecha legacy de propuesta de cita | Historial/mapeo legacy | Fecha o vacio |
| `F_Cita_Creada` | Fecha legacy de cita creada | Historial/mapeo legacy | Fecha o vacio |
| `F_Cita_Concretada` | Fecha legacy de cita concretada | Historial/mapeo legacy | Fecha o vacio |
| `F_Agradecimiento` | Fecha legacy de agradecimiento | Historial/mapeo legacy | Fecha o vacio |
| `F_Propone_Lead` | Fecha legacy de referido propuesto | Flujo legacy de referidos | Fecha o vacio |
| `F_Nuevo_Lead_Contactado` | Fecha legacy de referido contactado | Flujo legacy de referidos | Fecha o vacio |
| `Minuta_Reunion` | Nota historica ligada al contacto | Informacion manual legacy | Texto |

## Interacciones

| Columna | Que representa | Uso principal | Formato requerido |
|---|---|---|---|
| `Google_ID` | Contacto asociado | Timeline, dashboard, KPIs | Texto, normalmente `people/...` |
| `ID_Entrada` | ID unico interno de la interaccion | Evitar duplicados y editar registros | Texto unico |
| `Fecha` | Fecha/hora de la interaccion | Orden, KPIs, ultimo contacto | Fecha parseable |
| `Tipo` | Tipo de interaccion | Timeline, filtros, reglas | Email, Reunion/Cita, Llamada, WhatsApp, Nota u otro tipo controlado |
| `Asunto_Titulo` | Titulo o asunto | Timeline y evidencia | Texto |
| `De_Hacia_Contacto` | Direccion de la interaccion | Saber si fue saliente/entrante | Texto, idealmente controlado |
| `Detalle_Fuente` | Contenido original importado | Referencia no editable | Texto original |
| `Notas_Usuario_Crudo` | Version editable por usuario | Fuente principal futura para IA | Texto editable |
| `Resumen_IA` | Resumen generado por IA | Campo reservado/uso futuro | Texto |
| `ID_Fuente` | ID original de Gmail/Calendar | Dedupe contra fuente externa | Texto |
| `Thread_ID` | ID de hilo Gmail | Dedupe de recomendaciones por hilo | Texto, ejemplo `GMAIL_THREAD_...` |
| `Email_Asociado` | Email que vincula interaccion/contacto | Reasignacion si email cambia de contacto | Email normalizado |
| `Rol_Email` | Rol del email/contacto en Gmail | Filtrar CC y participacion | From, To, Cc u otro valor controlado |

Estandar KPI: para computar contactos realizados y empresas headhunter realizadas, la direccion debe venir estructurada desde origen. `Rol_Email` debe indicar `TO`, `CC`, `BCC`, `FROM` o `MANUAL`; `De_Hacia_Contacto` es texto visible/legacy y no debe usarse como fallback permanente de calculo. Si un registro antiguo no trae `Rol_Email`, el dato debe completarse desde la fuente original antes de considerarlo confiable para KPI.

Estandar de fecha KPI: los periodos se calculan usando la fecha calendario de la interaccion segun la fuente/configuracion del usuario. Una fecha `01/04/2026` debe caer en abril, sin moverse a marzo por conversion de zona horaria del navegador o de UTC.

Nota legacy: registros antiguos pueden tener `Rol_Email` vacio. La app local aun conserva una inferencia transicional desde `De_Hacia_Contacto` para no perder historial mientras se hace backfill; esa inferencia no es el estandar futuro.

## CRM_Relaciones

Relaciona contactos con apuntes de referidos. El codigo actual lee `CRM_Relaciones!A:Q` y normaliza tanto la estructura legacy `A:D` como la estructura ampliada. Si la hoja todavia tiene solo las cuatro columnas legacy, la app las completa en memoria para mantener compatibilidad.

Columnas legacy obligatorias:

| Columna | Que representa | Uso principal | Formato requerido |
|---|---|---|---|
| `Google_ID_Origen` | Contacto que refiere o menciona al referido | Mostrar referidos en ficha del contacto origen | Texto, normalmente `people/...` |
| `Nombre_Referido` | Nombre libre del referido | Mostrar el apunte de referido aunque no exista contacto vinculado | Texto |
| `Google_ID_Referido` | Contacto vinculado al referido | Abrir ficha y conectar el apunte con un contacto real | Texto `people/...` o vacio |
| `Notas_Relacion` | Apunte libre sobre el referido o la relacion | Contexto visible en tarjetas de referidos | Texto |

Columnas ampliadas soportadas por el codigo actual:

| Columna | Que representa | Uso principal | Formato requerido |
|---|---|---|---|
| `Referido_ID` | ID estable del apunte de referido | Editar, borrar o vincular sin depender del nombre | Texto unico generado por la app |
| `Quien_Refiere_ID` | Alias explicito del contacto que refiere | Preparar migracion futura a modelo agnostico de fuente | Texto, hoy equivalente a `Google_ID_Origen` |
| `Empresa_Referido` | Empresa escrita libremente para el referido | Preservar dato aunque no exista contacto vinculado | Texto |
| `Cargo_Referido` | Cargo escrito libremente para el referido | Preservar dato aunque no exista contacto vinculado | Texto |
| `Telefono_Referido` | Telefono escrito libremente para el referido | Crear/contactar/vincular contacto futuro | Texto normalizado cuando sea posible |
| `Email_Referido` | Email escrito libremente para el referido | Crear/contactar/vincular contacto futuro | Email o vacio |
| `Notas_Referido` | Notas libres propias del referido | Reemplaza progresivamente `Notas_Relacion` | Texto |
| `Contacto_Vinculado_ID` | Alias explicito del contacto vinculado | Preparar migracion futura a modelo agnostico de fuente | Texto, hoy equivalente a `Google_ID_Referido` |
| `Estado_Referido` | Estado interno del referido | Filtrar o cerrar referidos a futuro | Texto, default `Abierto` |
| `Fecha_Creacion` | Fecha de creacion del referido | Auditoria y orden | `dd/mm/yyyy hh:mm:ss` |
| `Fecha_Actualizacion` | Ultima edicion del referido | Auditoria y sync futuro | `dd/mm/yyyy hh:mm:ss` |
| `Origen` | Fuente de creacion del referido | Distinguir manual, importado o sugerido por Coach | Texto, default `Manual` |
| `Activo` | Marca de vigencia logica | Desactivar sin perder historial | `TRUE`/`FALSE` |

Nota: `Google_ID_Origen`, `Quien_Refiere_ID`, `Google_ID_Referido`, `Contacto_Vinculado_ID`, `Notas_Relacion` y `Notas_Referido` se mantienen espejados por compatibilidad hasta reemplazar el popup legacy.

## CRM_Config

Configuracion general. El codigo lee `CRM_Config!A2:B2`.

Uso conocido:

- fecha historica de inicio para importaciones o sincronizaciones.

## CRM_Sync_State

Estado de sincronizacion incremental. El codigo usa `CRM_Sync_State!A:C`.

| Columna esperada | Que representa | Uso principal | Formato requerido |
|---|---|---|---|
| Clave/fuente | Fuente o proceso de sync | Identificar cursor | Texto |
| Valor/cursor | Cursor o fecha de sync | Sincronizacion incremental | Texto/API token/fecha |
| Ultima actualizacion | Momento de escritura | Diagnostico | Fecha/hora |

## Cloud dev: diagnostico de lecturas externas

En Supabase cloud dev existe la tabla `external_interaction_read_diagnostics` para diagnosticar lecturas de proveedores antes de convertirlas en interacciones de la app. En v1 se usa para Google Calendar: guarda un resumen tecnico acotado del evento, emails detectados, contactos mapeados, estado (`candidate`, `not_mapped`, `filtered_out`) y motivo de exclusion. No guarda descripcion/cuerpo crudo del evento, no es fuente de verdad operacional y no reemplaza `interactions` ni `external_interaction_sources`.

Tambien existe `sync_run_logs` como bitacora operativa de sincronizaciones/importaciones por usuario. Guarda una fila por paso relevante (`provider`, `resource_type`, `operation`, `scope_label`, `step`, `status`, `detail`, `metadata`, `created_at`) y se usa para diagnosticar flujos de contactos, correos, calendario y futuras fuentes sin mezclar mensajes tecnicos en la UI de Cuenta. Antes de escribir, la app redacta correos, telefonos, tokens y claves sensibles de `metadata`. No reemplaza `audit_log`: `audit_log` sigue siendo historial de cambios de negocio; `sync_run_logs` es observabilidad del proceso.

## Cloud dev: cuentas, privacidad y seguridad

Base vigente antes del sprint multiusuario:

| Tabla | Alcance | Que representa | Estado |
|---|---|---|---|
| `profiles` | Usuario | Perfil minimo asociado a `auth.users` | Existe, pero aun no contiene rol, plan, estado beta ni preferencias avanzadas |
| `connected_accounts` | Usuario | Cuentas externas conectadas por proveedor, email, scopes conocidos, capacidades, estado y revocacion interna | Existe y la UI Cuenta ya lo usa como fuente persistente de conexion; permite marcar una cuenta como revocada sin borrar datos importados. Los botones de importacion exigen conexion activa mas token OAuth fresco de sesion; el token por si solo no basta si la cuenta fue desvinculada. Permiso renovable aun requiere definir refresh tokens cifrados |
| `service_connectors` | Global | Catalogo de proveedores y servicios disponibles | Existe como catalogo base; debe conectarse a capabilities por plan y permisos reales |
| `usage_limits` | Usuario | Limites configurables por usuario | Existe como base; falta relacionarlo con plan/capabilities y enforcement completo |
| `usage_events` | Usuario | Eventos de consumo de cuotas | Existe como base; falta registrar todos los flujos relevantes |
| `sync_run_logs` | Usuario | Bitacora tecnica de sync/importacion | Existe con redaccion central de datos sensibles; falta definir retencion antes de beta |
| `audit_log` | Usuario | Historial de cambios de negocio o seguridad | Existe; debe cubrir acciones sensibles de cuenta, permisos, roles y conexiones |

Brechas para beta:

- Falta modelo persistente de roles, planes, capabilities, organizaciones, membresias y entitlements.
- Falta reemplazar el gate admin beta por permisos reales respaldados por backend/RLS.
- Falta definir estrategia aprobada para tokens OAuth renovables: cifrado, revocacion, auditoria y quien puede descifrarlos.
- Falta documentar y probar derechos del titular: acceso, rectificacion, supresion, oposicion, portabilidad y bloqueo.
- Falta definir retencion y permisos finales de visores admin; los logs de sync ya pasan por redaccion central y Calendar diagnostico ya guarda payload acotado, no descripcion cruda.

Auditoria tecnica 2026-08-26:

| Area | Estado observado | Implicancia |
|---|---|---|
| Tablas privadas de usuario | Tienen `user_id` y policies por `auth.uid()` en el schema base | Buen punto de partida para beta; falta prueba real con dos usuarios |
| `connected_accounts` | Existe con proveedor, scopes conocidos, capacidades, estado y revocacion | La UI Cuenta ya lo lee como fuente persistente de conexion y permite desvincular una cuenta en la app; falta cerrar persistencia segura de tokens renovables |
| Admin UI | `adminAccess.ts` consulta `current_user_has_capability` | Mejor punto de partida beta; falta ejecutar modelo SQL y probar que usuarios normales no acceden |
| Maestros globales | `headhunter_companies` y dominios son globales | Correcto como alcance global; la escritura debe quedar restringida a `admin.manage_global_masters` con `restrict_headhunter_master_admin_writes_v0_1.sql` |
| Roles y planes | No hay tablas formales de roles, planes, organizaciones, membresias ni entitlements | Bloquea beta escalable, tiers de servicio, sponsors y permisos finos |

Primer corte v0.1 ejecutado y verificado en Supabase dev:

| Tabla propuesta | Alcance | Proposito |
|---|---|---|
| `app_capabilities` | Global | Catalogo de capacidades accionables, como importar contactos, usar Coach o administrar accesos |
| `app_roles` | Global | Roles base: usuario, beta tester, soporte admin, administrador sistema y administrador sponsor |
| `app_role_capabilities` | Global | Relacion entre roles y capacidades incluidas |
| `subscription_plans` | Global | Tiers o planes comerciales: beta personal, gratis, pro, premium y patrocinado base |
| `subscription_plan_capabilities` | Global | Capacidades disponibles por plan, con limites configurables por capacidad |
| `user_access_profiles` | Usuario | Estado de acceso, plan vigente y estado beta por usuario |
| `user_role_assignments` | Usuario/Sistema | Roles asignados a usuarios con vigencia y trazabilidad |
| `user_capability_overrides` | Usuario/Sistema | Excepciones para otorgar, bloquear o limitar una capacidad puntual |
| `organizations` | Global/Sistema | Empresas sponsor, outplacement, partners o internas |
| `organization_memberships` | Usuario/Sistema | Vinculo entre usuarios y organizaciones, sin acceso automatico a datos privados |
| `user_plan_sponsorships` | Usuario/Sistema | Plan financiado por una organizacion para un usuario |

El modelo incluye la funcion `current_user_has_capability(capability_code)`, pensada como resolvedor central para que UI, acciones internas, Coach, sync y RLS consulten la misma fuente de permisos. La app cloud ya tiene helpers cliente para consultar y exigir esta capability antes de acciones sensibles.

Funcion de reinicio de datos personales:

| Funcion | Alcance | Proposito | Que conserva |
|---|---|---|---|
| `reset_current_user_app_data_v0_1('BORRAR MIS DATOS')` | Usuario | Borra los datos operativos del usuario autenticado para partir la app desde cero | Conserva `auth.users`, `profiles`, plan, roles, capabilities, organizaciones y maestros globales |

La funcion exige capability `data.delete_account` y confirmacion literal. En beta, esa capability queda disponible para `system_admin` y para el plan `beta_personal`; si falta en una base existente, aplicar `cloud/supabase/grant_reset_data_capability_v0_1.sql`. Borra contactos, medios de contacto, snapshots externos, IDs externos, interacciones, participantes, fuentes externas, diagnosticos, referidos, objetivos, ToDos, configuracion personal, cursores, limites/uso, logs de sync, auditoria y cuentas externas conectadas del usuario. No borra datos de otros usuarios ni datos globales.

Tablas que borra explicitamente, siempre filtrando por `user_id = auth.uid()` y en el mismo orden definido en `cloud/supabase/reset_current_user_app_data_v0_1.sql`:

| Orden | Tabla | Que borra |
|---|---|---|
| 1 | `metric_snapshots` | Metricas guardadas del usuario |
| 2 | `usage_events` | Eventos de uso/cuotas del usuario |
| 3 | `usage_limits` | Limites configurados para el usuario |
| 4 | `data_exports` | Registros de exportaciones del usuario |
| 5 | `import_batches` | Registros de importaciones del usuario |
| 6 | `sync_run_logs` | Logs operativos de sincronizacion/importacion |
| 7 | `sync_cursors` | Cursores de sincronizacion incremental |
| 8 | `external_interaction_read_diagnostics` | Lecturas diagnosticas crudas de interacciones externas |
| 9 | `object_review_state` | Punteros de revision de objetos por Coach/sync |
| 10 | `action_invocations` | Acciones internas invocadas por UI, Coach o sistema |
| 11 | `todos` | Sugerencias/pendientes del Coach |
| 12 | `todo_configs` | Configuracion personal de reglas/sugerencias |
| 13 | `referrals` | Referidos del usuario |
| 14 | `contact_objective_assignments` | Vinculos entre contactos y objetivos |
| 15 | `objectives` | Objetivos profesionales del usuario |
| 16 | `external_interaction_sources` | Fuentes externas vinculadas a interacciones |
| 17 | `interaction_participants` | Participantes de interacciones |
| 18 | `interactions` | Interacciones propias de la app |
| 19 | `contact_emails` | Correos de contactos |
| 20 | `contact_phones` | Telefonos de contactos |
| 21 | `external_contact_snapshots` | Espejo de contactos desde proveedores como Google |
| 22 | `external_contact_ids` | IDs externos vinculados a contactos |
| 23 | `contacts` | Contactos locales de la app |
| 24 | `connected_accounts` | Cuentas externas conectadas en la app |
| 25 | `user_settings` | Configuracion personal del usuario |
| 26 | `audit_log` | Auditoria operativa asociada al usuario |

Tablas/datos que conserva explicitamente:

| Dato o tabla | Motivo |
|---|---|
| `auth.users` | Mantiene la cuenta de acceso/login |
| `profiles` | Mantiene el perfil minimo del usuario |
| `user_access_profiles` | Mantiene estado de acceso, beta y plan |
| `user_role_assignments` | Mantiene roles asignados |
| `user_capability_overrides` | Mantiene excepciones de permisos si existen |
| `app_capabilities`, `app_roles`, `app_role_capabilities` | Catalogo global de capacidades y roles |
| `subscription_plans`, `subscription_plan_capabilities` | Catalogo global de planes y capacidades por plan |
| `organizations`, `organization_memberships`, `user_plan_sponsorships` | Estructura de organizaciones, membresias y patrocinios |
| `service_connectors` | Catalogo global de proveedores/conectores |
| `headhunter_companies`, `headhunter_company_domains` | Maestro global de empresas headhunter y dominios |

Si se agrega una tabla nueva con datos personales del usuario, debe decidirse explicitamente si queda dentro de esta funcion de reinicio y actualizar este listado junto con el SQL.

Nota de bootstrap: el primer `system_admin` debe asignarse manualmente desde Supabase/service role despues de ejecutar la migracion. No debe existir una ruta de auto-promocion admin desde la app.

Archivos operativos del corte:

| Archivo | Proposito |
|---|---|
| `cloud/supabase/add_account_access_model_v0_1.sql` | Crea tablas, seeds, policies, funcion de capability, trigger de alta de usuario y backfill inicial |
| `cloud/supabase/bootstrap_first_system_admin_v0_1.sql` | Asigna o reactiva manualmente `system_admin`, `beta_tester` y `user` al primer administrador por email |
| `cloud/supabase/grant_reset_data_capability_v0_1.sql` | Agrega `data.delete_account` al rol `system_admin` y al plan `beta_personal` en bases existentes |
| `cloud/supabase/verify_account_access_model_v0_1.sql` | Verifica tablas, RLS, seeds, funcion y trigger del modelo de acceso |
| `cloud/supabase/verify_multiuser_readiness_v0_1.sql` | Verifica preparacion estructural multiusuario sin leer datos: tablas privadas con columna de dueno, RLS/policies, tablas globales sin `user_id`, resolvedor de capacidades y trigger de alta |
| `tools/dev_maintenance/supabase/restore_system_admin_by_email_v0_1.sql` | Recupera en dev un usuario administrador por email cuando una prueba dejo desactivado su rol admin |

Manual de referencia: `docs/PRIVACY_SECURITY_COMPLIANCE.md`.

## Cloud dev: maestro de empresas headhunter

En Supabase cloud dev existe el primer corte del maestro de empresas headhunter:

| Tabla | Que representa | Uso principal |
|---|---|---|
| `headhunter_companies` | Catalogo global de empresas headhunter oficiales de la app | Nombre canonico para agrupar contactos headhunter |
| `headhunter_company_domains` | Catalogo global de dominios asociados a una empresa headhunter | Resolver empresa por email/dominio y evitar agrupaciones sueltas |

Regla vigente: este maestro es transversal a todos los usuarios y no lleva `user_id`. El maestro no modifica contactos por si solo. Sirve como referencia para que proximos pasos del editor/tablero puedan sugerir completar empresa, detectar ambiguedades y agrupar tarjetas por empresa oficial. La lectura es para usuarios autenticados; la escritura debe quedar reservada a administradores con capability `admin.manage_global_masters`.

Columnas vigentes:

| Tabla | Columna | Formato | Uso |
|---|---|---|---|
| `headhunter_companies` | `id` | `uuid` | Identificador interno de la empresa headhunter oficial |
| `headhunter_companies` | `display_name` | `text`, no vacio | Nombre visible canonico de la empresa |
| `headhunter_companies` | `normalized_name` | `text`, no vacio, unico si `is_active = true` | Nombre normalizado para comparar sin depender de mayusculas, acentos o espacios |
| `headhunter_companies` | `notes` | `text`, default vacio | Nota administrativa sobre origen o correcciones del registro |
| `headhunter_companies` | `is_active` | `boolean` | Permite desactivar una empresa sin borrar historial del maestro |
| `headhunter_companies` | `created_at`, `updated_at` | `timestamptz` | Auditoria tecnica basica del registro |
| `headhunter_company_domains` | `id` | `uuid` | Identificador interno del dominio |
| `headhunter_company_domains` | `company_id` | `uuid` hacia `headhunter_companies.id` | Empresa oficial a la que pertenece el dominio |
| `headhunter_company_domains` | `domain` | `text`, formato `@dominio.com` | Dominio visible guardado |
| `headhunter_company_domains` | `normalized_domain` | `text`, formato `@dominio.com`, unico si `is_active = true` | Dominio normalizado para resolver contactos por email |
| `headhunter_company_domains` | `is_primary` | `boolean` | Marca el dominio principal cuando una empresa tiene varios |
| `headhunter_company_domains` | `is_active` | `boolean` | Permite desactivar un dominio sin borrar historial del maestro |
| `headhunter_company_domains` | `created_at`, `updated_at` | `timestamptz` | Auditoria tecnica basica del registro |

Poblamiento inicial aprobado: usar solo datos propios de la app que ya tengan marca headhunter, contacto activo y empresa no vacia. Los dominios se toman desde correos/dominios registrados, excluyendo dominios personales como Gmail/Hotmail/iCloud. Si un dominio apunta a mas de una empresa, no se carga automaticamente y queda para revision manual. Los SQL de apoyo son `cloud/supabase/preview_headhunter_company_master_seed_from_contacts_v0_1.sql` y `cloud/supabase/seed_headhunter_company_master_from_contacts_v0_1.sql`.

Fuente complementaria aprobada: `Listado Headhunters Lukkap Chile.csv`, usada como base externa confiable para enriquecer el maestro. Los SQL `cloud/supabase/preview_headhunter_company_master_seed_lukkap_csv_v0_1.sql` y `cloud/supabase/seed_headhunter_company_master_lukkap_csv_v0_1.sql` cargan solo empresa y dominios corporativos derivados de correos. Dominios personales quedan fuera. `Mandomedio` se carga como empresa unica para `@mandomedio.com`; si cargas previas dejaron variantes como `Mando Medio` o `Insigni - Mandomedio`, el SQL `cloud/supabase/fix_headhunter_master_mandomedio_v0_1.sql` las consolida en una sola empresa activa. `@headhunter.cl` queda como `GDAHeadhunter`. Si el maestro fue creado con `user_id`, ejecutar `cloud/supabase/make_headhunter_company_master_global_v0_2.sql` para convertirlo en catalogo global. Para cerrar la escritura beta abierta, ejecutar despues `cloud/supabase/restrict_headhunter_master_admin_writes_v0_1.sql`.

## Cloud dev: objetivos de busqueda profesional

Primer corte propuesto. La migracion esta preparada en `cloud/supabase/add_objectives_v0_1.sql`, pero no debe considerarse ejecutada hasta confirmarlo en Supabase dev.

| Tabla | Alcance | Que representa | Uso principal |
|---|---|---|---|
| `objectives` | Usuario | Objetivos profesionales declarados por el usuario | Mantener empresas, industrias, cargos y funciones objetivo como entidades propias |
| `contact_objective_assignments` | Usuario | Relacion many-to-many entre contactos y objetivos | Asociar contactos a objetivos sin usar hashtags libres |

Columnas propuestas:

| Tabla | Columna | Formato | Uso |
|---|---|---|---|
| `objectives` | `id` | `uuid` | Identificador interno del objetivo |
| `objectives` | `user_id` | `uuid` hacia `profiles.id` | Dueño del objetivo |
| `objectives` | `objective_name` | `text`, no vacio | Nombre visible del objetivo |
| `objectives` | `objective_name_normalized` | `text`, no vacio | Nombre normalizado para evitar duplicados dentro del mismo tipo |
| `objectives` | `objective_type` | `COMPANY`, `INDUSTRY`, `ROLE`, `FUNCTION` | Tipo de objetivo |
| `objectives` | `priority_level` | `HIGH`, `MEDIUM`, `LOW` | Prioridad declarada por el usuario |
| `objectives` | `objective_description` | `text`, default vacio | Nota opcional del objetivo |
| `objectives` | `is_active` | `boolean` | Permite ocultar/desactivar sin perder asociaciones historicas |
| `objectives` | `created_at`, `updated_at` | `timestamptz` | Auditoria tecnica basica |
| `contact_objective_assignments` | `id` | `uuid` | Identificador interno de la asociacion |
| `contact_objective_assignments` | `user_id` | `uuid` hacia `profiles.id` | Dueño de la asociacion |
| `contact_objective_assignments` | `contact_id` | `uuid` hacia `contacts.id` | Contacto asociado |
| `contact_objective_assignments` | `objective_id` | `uuid` hacia `objectives.id` | Objetivo asociado |
| `contact_objective_assignments` | `assigned_by_actor` | `user`, `coach`, `system`, `import` | Origen de la asociacion |
| `contact_objective_assignments` | `assigned_at` | `timestamptz` | Momento funcional de la asociacion |
| `contact_objective_assignments` | `created_at`, `updated_at` | `timestamptz` | Auditoria tecnica basica |

Regla vigente del diseno: en el MVP, los contactos solo seleccionan objetivos previamente declarados en la vista `Objetivos`. No existe tag libre paralelo. El filtro global de Contactos/Dashboard usa objetivos por ID.

Metricas derivadas vigentes: no existe una tabla nueva para KPIs de objetivos en este corte. El resumen por objetivo se calcula desde `objectives`, `contact_objective_assignments`, `contacts`, `interaction_participants` e `interactions`. Reglas:

- La capa de metricas calcula objetivos activos aunque tengan cero contactos; la UI los oculta por defecto cuando no tienen contactos ni cafes para los filtros activos.
- `Contactos` cuenta contactos activos asociados al objetivo.
- `Cafes` cuenta interacciones unicas tipo `calendar` o `call` asociadas a uno o mas contactos del objetivo; si dos contactos del mismo objetivo participan en la misma cita/llamada, se cuenta una sola vez para ese objetivo.
- `Ultima actividad` usa la fecha mas reciente de esos cafes.
- `Mayor estado` usa el estado networking mas avanzado entre los contactos asociados al objetivo.
- El orden inicial es prioridad alta, media, baja; luego tipo, cantidad de contactos y nombre.
- En Dashboard, las metricas se acotan a `Fecha_Inicio_Networking`.
- Por defecto, la tabla oculta objetivos sin contactos ni cafes para los filtros activos. El usuario puede activar `Mostrar objetivos sin actividad`.

Si mas adelante se requiere historico, comparacion entre periodos o performance para muchos usuarios, se evaluara persistir snapshots en `metric_snapshots` o una tabla especifica con nombres descriptivos.

## CRM_ToDos

| Columna | Que representa | Uso principal | Formato requerido |
|---|---|---|---|
| `Todo_ID` | ID unico del pendiente | Identificar y actualizar ToDo | Texto unico |
| `Fecha_Creacion` | Fecha de creacion | Orden y antiguedad | Fecha/hora |
| `Fecha_Actualizacion` | Ultima modificacion | Auditoria ligera | Fecha/hora |
| `Estado_ToDo` | Estado del pendiente | Filtrar pendientes | Texto controlado |
| `Tipo_ToDo` | Tipo de sugerencia | Configuracion y motor | Texto controlado |
| `Prioridad` | Prioridad del pendiente | Orden visual | Texto/numero |
| `Origen` | Regla, hibrido o IA | Explicar fuente | Texto controlado |
| `Confianza` | Confianza de la sugerencia | Decidir si confirmar | Numero/texto |
| `Objeto_Tipo` | Tipo de objeto afectado | Saber que cambia | Contacto, interaccion, etc. |
| `Objeto_ID` | ID del objeto afectado | Ejecutar accion | Texto |
| `Objeto_Label` | Nombre visible del objeto | Mostrar al usuario | Texto |
| `Cambio_Tipo` | Tipo de cambio sugerido | Describir accion | Texto controlado |
| `Estado_Actual_JSON` | Estado antes del cambio | Comparar cambio | JSON texto |
| `Estado_Sugerido_JSON` | Estado propuesto | Ejecutar cambio | JSON texto |
| `Evidencia_JSON` | Evidencia usada | Explicar recomendacion | JSON texto |
| `Acciones_JSON` | Acciones disponibles | Botones/links futuros | JSON texto |
| `Dedup_Key` | Clave anti duplicados | Evitar sugerencias repetidas | Texto deterministico |
| `Notas` | Comentarios adicionales | Contexto | Texto |

## CRM_ToDo_Config

| Columna | Que representa | Uso principal | Formato requerido |
|---|---|---|---|
| `Tipo_ToDo` | Tipo de sugerencia o regla concreta configurable | Configurar comportamiento | Texto controlado. Solo deben existir tipos aprobados e implementados para el MVP, por ejemplo `RULE_STATUS_TO_CONTACTED` |
| `Descripcion` | Explicacion del tipo | UI/configuracion | Texto |
| `Motor_Tipo` | Regla, hibrido o IA | Ordenar complejidad | RULE, HYBRID o AI |
| `Modo_Ejecucion` | Como se ejecuta | Preguntar/auto/desactivar | `Preguntar`, `Automatico` o `Desactivado` |
| `Permite_Auto_Aplicar` | Si puede automatizarse | Seguridad | TRUE/FALSE |
| `Requiere_Confirmacion` | Si pide confirmacion | Seguridad | TRUE/FALSE |
| `Fuentes_Requeridas` | Datos necesarios | Control de procesamiento | Texto separado por `;` |
| `Ventana_Dias` | Ventana temporal | Reglas de fecha | Numero o vacio |
| `Criterio_Dedupe` | Criterio anti duplicado | Evitar repeticion | Texto |
| `Actualizado_En` | Fecha de config | Auditoria | Fecha/hora |

## CRM_Object_Review_State

Controla que reglas o IA no revisen dos veces objetos sin cambios.

| Columna | Que representa | Uso principal | Formato requerido |
|---|---|---|---|
| `Processor_ID` | Motor/regla que reviso | Separar procesadores | Texto |
| `Objeto_Tipo` | Tipo de objeto revisado | Minuta, email, contacto, etc. | Texto |
| `Objeto_ID` | ID del objeto revisado | Encontrar revision | Texto |
| `Objeto_Updated_At` | Fecha de ultima edicion del objeto | Saber si cambio | Fecha/hora |
| `Reviewed_At` | Fecha de revision | Evitar reproceso | Fecha/hora |
| `Input_Hash` | Huella del input | Detectar cambios | Texto hash |
| `Output_Hash` | Huella del output | Detectar repeticion | Texto hash |
| `Todo_IDs_Generados` | ToDos creados | Trazabilidad | Texto/JSON |
| `Estado_Revision` | Resultado de revision | Diagnostico | Texto controlado |
| `Error` | Error si fallo | Diagnostico | Texto |
| `Notas` | Contexto adicional | Diagnostico | Texto |

## Export espejo local

La app local puede generar un ZIP de respaldo/migracion desde opciones avanzadas de Contactos. Este export no modifica datos y lee las hojas actuales para generar:

- tablas normalizadas segun los esquemas actuales documentados;
- snapshots raw opcionales de las hojas originales;
- `manifest.json` con conteos y hashes;
- `validation_report.json` con duplicados, referencias rotas y advertencias.

El export contiene datos personales y minutas. No debe subirse a GitHub ni compartirse por chat.

## Historial

- 2026-07-15: Renombrado desde `SHEETS_SCHEMA_CURRENT` y ampliado con uso/formato por columna.
- 2026-07-15: Se documenta fallback legacy para detectar interacciones salientes cuando `Rol_Email` esta vacio.
- 2026-07-28: Se define estandar KPI sin fallback permanente: direccion estructurada obligatoria y fecha calendario sin corrimiento por zona horaria.
- 2026-07-22: `Google_ID` pasa a documentarse como ID tecnico transicional: puede venir de la fuente conectada actual o ser nativo de la app.
- 2026-07-22: `CRM_Contactos_Extra` se amplia a `A:Y` con `Contact_ID`, `Provider` y `Provider_Contact_ID`; `Google_ID` queda como llave legacy hasta migrar referencias.
- 2026-07-20: `CRM_ToDo_Config.Tipo_ToDo` admite reglas configurables granulares para el Coach IA, separadas del tipo base almacenado en `CRM_ToDos`.
- 2026-07-22: Se documenta `CRM_Relaciones` actual A:D como modelo legacy de referidos, incluyendo su limitacion frente al nuevo diseno futuro.
- 2026-07-22: El codigo queda compatible con `CRM_Relaciones!A:Q` y normaliza columnas legacy/ampliadas sin migracion masiva automatica.
- 2026-07-22: Se documenta export espejo local como lectura de respaldo/migracion sin modificacion de datos.
- 2026-08-26: Se agrega seccion de cuentas, privacidad y seguridad y se registra auditoria tecnica inicial: RLS privado existe como base, pero faltan roles/capabilities persistentes, gate admin real y `connected_accounts` como fuente de verdad operativa.
- 2026-08-26: Se documenta la propuesta no ejecutada `add_account_access_model_v0_1.sql` para modelo de acceso beta multiusuario.
