# Modelo de datos

## Propósito

Este documento describe el modelo persistente vigente de CRM Networking en la aplicación cloud.

Su objetivo es explicar entidades, identidad, ownership, relaciones, cardinalidades relevantes, estructuras de soporte e invariantes estructurales. No reemplaza el schema SQL ni documenta algoritmos de sincronización, reglas de Coach, diseño UI, contratos de acciones internas ni seguridad detallada.

Las fuentes usadas para este corte son el schema y migrations en `cloud/supabase`, más el código actual en `cloud/web` cuando fue necesario confirmar uso real.

## Convenciones e identidad

La base persistente es Supabase/Postgres.

Las entidades locales usan IDs internos `uuid`. El ID interno de un contacto, interacción, referido u objetivo pertenece a la app y no debe confundirse con IDs de proveedores externos.

Los IDs externos viven en tablas puente o de fuente externa. Esto permite que una ficha local conserve identidad propia aunque cambien, se agreguen o se revoquen conexiones externas.

El modelo usa soft delete o desactivación en varias entidades mediante campos como `is_active`, `is_deleted`, estados o marcas equivalentes. La semántica exacta depende de cada entidad.

Los campos JSON se usan para datos flexibles, diagnósticos o estructuras derivadas. Cuando un JSON define reglas funcionales, su contrato debe documentarse en el documento de la funcionalidad correspondiente.

## Ownership y categorías de datos

El modelo separa tres categorías principales.

Datos del usuario: tablas con `user_id`, aisladas por Row Level Security. Incluyen contactos, medios de contacto, objetivos, referidos, interacciones, cuentas conectadas, sugerencias, logs y configuraciones personales.

Datos globales: catálogos compartidos por la app, como conectores disponibles, roles, capacidades, planes y maestro de empresas headhunter.

Datos técnicos de soporte: estructuras para sincronización, diagnóstico, acciones, auditoría, métricas, límites y exportaciones. Algunas son centrales para operación interna, pero no necesariamente representan una funcionalidad visible completa.

## Usuarios y configuración

`profiles` representa el perfil interno asociado a un usuario de Supabase Auth. Su identidad principal es `id`, que referencia `auth.users(id)`. Conserva datos básicos como `email` y `full_name`.

`user_settings` guarda preferencias por usuario. Usa `user_id`, `setting_key`, `setting_value` y `value_json`. El código actual observado usa `setting_value` para la lectura y escritura funcional; `value_json` permanece disponible en el schema. Existe unicidad por usuario y clave de configuración.

El perfil interno no reemplaza la autenticación. La autenticación vive en Supabase Auth; `profiles` y tablas relacionadas agregan datos propios de la aplicación.

## Contactos y medios de contacto

`contacts` representa la ficha local editable de una persona dentro del CRM.

Campos estructurales principales:

- `id`: identidad local del contacto.
- `user_id`: dueño del contacto.
- `display_name`: nombre visible.
- `company` y `role`: empresa y cargo locales.
- `networking_status`: estado de networking.
- `networking_focus`: marca de foco.
- `is_headhunter`: marca de contacto headhunter.
- `headhunter_domains`: dominios asociados guardados en la ficha.
- `is_active`: ciclo de vida del contacto.
- `sync_status`: estado técnico de sincronización cuando aplica.

Los estados de networking persistidos son:

- `Pendiente`
- `Contactado`
- `Agendado`
- `Cita concretada`
- `Agradecimiento enviado`

`contact_emails` representa correos asociados a contactos. Su identidad es propia y se relaciona con `contacts` mediante `contact_id`. Guarda `email`, `normalized_email`, `domain`, `is_primary` y `source`.

`contact_phones` representa teléfonos asociados a contactos. Se relaciona con `contacts` mediante `contact_id`. Guarda `phone`, `normalized_phone`, `normalized_phone_last8`, `is_primary` y `source`.

La unicidad de correos y teléfonos está definida dentro de cada contacto, no globalmente entre contactos. Por eso dos contactos pueden compartir un mismo correo o teléfono y seguir existiendo como fichas separadas.

## Objetivos y asignaciones

`objectives` representa objetivos profesionales declarados por el usuario.

Campos estructurales principales:

- `id`: identidad local del objetivo.
- `user_id`: dueño.
- `objective_name`: nombre visible.
- `objective_name_normalized`: nombre para comparación.
- `objective_type`: tipo de objetivo.
- `priority_level`: prioridad.
- `objective_description`: descripción opcional.
- `is_active`: ciclo de vida del objetivo.

Tipos persistidos:

- `COMPANY`
- `INDUSTRY`
- `ROLE`
- `FUNCTION`

Prioridades persistidas:

- `HIGH`
- `MEDIUM`
- `LOW`

Existe unicidad activa por usuario, tipo y nombre normalizado.

`contact_objective_assignments` representa la relación many-to-many entre contactos y objetivos. Usa `contact_id`, `objective_id`, `user_id`, `assigned_by_actor` y `assigned_at`.

Un contacto puede estar asociado a muchos objetivos. Un objetivo puede estar asociado a muchos contactos. La relación es por ID, no por texto libre.

## Referidos

`referrals` representa una persona recomendada por un contacto dentro del proceso de networking.

Campos estructurales principales:

- `id`: identidad local del referido.
- `user_id`: dueño.
- `referred_by_contact_id`: contacto que refiere.
- `linked_contact_id`: contacto local vinculado, opcional.
- datos descriptivos del referido: `referred_name`, `referred_company`, `referred_role`, `referred_email`, `referred_phone`.
- `notes`: notas del referido.
- `status`: ciclo de vida del referido.

Estados persistidos:

- `active`
- `dismissed`
- `converted`

El referido puede existir sin ficha local vinculada. Si posteriormente se crea o identifica un contacto, `linked_contact_id` permite relacionarlos.

## Interacciones y participantes

`interactions` representa una interacción local registrada en la app.

Campos estructurales principales:

- `id`: identidad local.
- `user_id`: dueño.
- `interaction_type`: tipo de interacción.
- `direction`: dirección, si aplica.
- `occurred_at`: fecha de ocurrencia.
- `subject`: asunto o título.
- `source_detail`: detalle de origen.
- `user_notes_raw`: notas del usuario.
- `is_deleted`: eliminación lógica.
- `deleted_at`, `deleted_by`, `delete_reason`: datos de eliminación lógica.
- `prevent_reimport`: marca para evitar recreación automática desde una fuente externa.

Tipos persistidos:

- `email`
- `calendar`
- `call`
- `message`
- `manual`

Direcciones persistidas:

- `inbound`
- `outbound`
- `internal`
- `unknown`

La tabla conserva actualmente campos específicos de proveedor, como `provider`, `provider_event_id` y `provider_thread_id`. La relación normalizada con objetos externos vive en `external_interaction_sources`. La eventual consolidación de esos campos es una ambigüedad vigente, no una decisión tomada por este documento.

`interaction_participants` relaciona interacciones con contactos o identidades de participantes. Usa `interaction_id`, `contact_id`, `email_identity` y `role`.

Una interacción puede tener múltiples participantes. Un participante puede estar vinculado a un contacto local o existir solo como identidad de correo.

## Cuentas conectadas e identidades externas

`service_connectors` es un catálogo global de conectores disponibles. Sus campos estructurales incluyen `provider`, `service_type`, `capabilities`, `auth_type`, `enabled` y `config_schema_json`.

`connected_accounts` representa una cuenta externa conectada por un usuario.

Campos estructurales principales:

- `id`: identidad local de la conexión.
- `user_id`: dueño.
- `provider`: proveedor.
- `account_email`: cuenta externa visible.
- `scopes` y `capabilities`: permisos efectivos verificados y capacidades derivadas cuando el flujo lo confirma.
- `status`: estado de la conexión.
- `connected_at` y `revoked_at`: ciclo de vida de la conexión.
- `effective_scopes_verified_at` y `effective_scopes_verification_method`: evidencia temporal y método de verificación de scopes efectivos cuando aplica.

Para Google, la semántica vigente es que `scopes` contiene últimos scopes de datos efectivos verificados, no scopes meramente solicitados. `capabilities` se deriva de esos scopes efectivos.

Para Google existe unicidad canónica de una cuenta no revocada por usuario, proveedor y email normalizado. Las filas revocadas pueden permanecer como historia, pero no representan una conexión activa.

La tabla puede almacenar material sensible necesario para mantener la conexión. Los detalles de OAuth, tokens, scopes y protección pertenecen a documentación de conectores y seguridad.

`external_contact_ids` vincula una ficha local con una identidad de contacto en un proveedor. Usa `contact_id`, `connected_account_id`, `provider`, `external_id`, `is_active` y `last_seen_at`.

Existe unicidad por usuario, proveedor e ID externo.

`external_contact_snapshots` guarda la última foto conocida de un contacto externo. Incluye `provider`, `external_id`, `display_name`, `company`, `role`, `emails`, `phones`, `birthdays`, `content_hash`, `is_deleted` y `last_seen_at`.

El snapshot permite comparar lo recibido desde el proveedor contra la última versión conocida del proveedor, sin confundirlo con normalizaciones o ediciones de la ficha local.

`external_interaction_sources` vincula una interacción local con un objeto externo. Usa `interaction_id`, `connected_account_id`, `provider`, `source_service`, `external_object_type`, `external_id`, `external_thread_id`, `external_url`, `source_subject`, `source_detail`, `content_hash`, `sync_status`, `prevent_reimport`, `is_active`, `last_seen_at` y `last_synced_at`.

Estados persistidos de fuente externa:

- `imported`
- `synced`
- `deleted_at_source`
- `error`
- `ignored`

Existe unicidad activa por usuario, proveedor, servicio e ID externo.

## Estructuras de sync e importación

Estas tablas soportan procesos de lectura, importación, diagnóstico y control. No definen por sí solas la experiencia completa de sincronización.

`sync_cursors` guarda cursores o marcas de avance por usuario, cuenta conectada, proveedor, recurso y etiqueta de cursor. Sus campos estructurales incluyen `provider`, `resource_type`, `cursor_label`, `cursor_value`, `last_synced_at` y `status`.

`sync_run_logs` guarda una bitácora técnica por pasos de una ejecución. Usa `run_id`, `provider`, `resource_type`, `operation`, `scope_label`, `step_order`, `step`, `status` y `detail`.

`external_interaction_read_diagnostics` guarda lecturas externas para diagnóstico, incluyendo `provider`, `source_service`, `external_id`, `occurred_at`, `subject`, `participant_emails`, `matched_emails`, `mapped_contact_ids`, `candidate_status`, `exclusion_reason` y `read_context`.

`sync_change_suppressions` existe como estructura para registrar cambios de sync suprimidos por usuario, proveedor, recurso, objeto, campo y hash de valor. Su semántica funcional activa debe documentarse en sincronización, no en este modelo.

`import_batches` registra lotes de importación mediante `source_type`, `source_filename`, `manifest_json`, `validation_report_json`, `status` e `imported_at`.

## Coach, acciones y auditoría

`todos` representa sugerencias o tareas generadas para el usuario.

Campos estructurales principales:

- `id`: identidad local.
- `user_id`: dueño.
- `todo_type`: tipo de sugerencia.
- `engine_type`: origen lógico.
- `status`: ciclo de vida.
- `priority`: prioridad.
- `object_type` y `object_id`: objeto afectado.
- `current_state` y `suggested_state`: cambio propuesto, cuando aplica.
- `summary`, `reason` y `evidence`: explicación persistida.
- `actions_json`: acciones estructuradas asociadas.
- `dedup_key`: clave para evitar duplicados.
- `source_fingerprint`: huella de origen.
- `supersedes_todo_id`: relación con sugerencia anterior reemplazada.

`engine_type` admite `RULE`, `HYBRID` y `AI`.

`status` admite `active`, `done`, `dismissed`, `expired` y `auto_resolved`.

`todo_configs` configura sugerencias por usuario y `todo_type`. Incluye `engine_type`, `action_scope`, `user_mode`, `enabled`, `display_name`, `description` y `rule_json`.

`object_review_state` guarda el estado de revisión de un objeto por procesador. Usa `processor_id`, `processor_type`, `object_type`, `object_id`, `object_updated_at`, `last_reviewed_at`, `last_fingerprint` y `result_json`.

`action_invocations` registra acciones internas solicitadas o ejecutadas. Usa `action_name`, `actor_type`, `status`, `source_todo_id`, `object_type`, `object_id`, `input_json`, `output_json`, `error_message`, `requires_confirmation`, `confirmed_at` y `executed_at`.

`audit_log` registra eventos auditables de negocio mediante `actor`, `action`, `object_type`, `object_id`, `before_json` y `after_json`.

## Acceso y configuración comercial

El modelo de acceso existe como estructura persistente, pero su resolución detallada pertenece a `SECURITY_ACCESS.md`.

Familias principales:

- allowlist de beta cerrada: `app_access_allowlist`.
- catálogos globales de capacidades, roles y planes: `app_capabilities`, `app_roles`, `subscription_plans`.
- relaciones globales entre roles, planes y capacidades: `app_role_capabilities`, `subscription_plan_capabilities`.
- perfil de acceso por usuario: `user_access_profiles`.
- asignaciones y excepciones por usuario: `user_role_assignments`, `user_capability_overrides`.
- organizaciones y membresías: `organizations`, `organization_memberships`, `user_plan_sponsorships`.

`app_access_allowlist` representa emails normalizados autorizados para la beta cerrada. Es una entidad previa al signup y no reemplaza `auth.users`, `profiles`, roles, planes ni capabilities. Su semántica activa es: un email está autorizado si existe en la tabla y `revoked_at` es `NULL`.

Campos estructurales principales:

- `email_normalized`: email en minúsculas y sin espacios externos; es la clave primaria.
- `authorized_at`: fecha de autorización.
- `authorized_by_user_id`: admin que autorizó, nullable.
- `revoked_at`: fecha de revocación, nullable.
- `revoked_by_user_id`: admin que revocó, nullable.
- `note`: nota administrativa opcional.

La función SQL real para consultar capacidades es `current_user_has_capability(p_capability_code text)`. En la beta cerrada, esa función queda subordinada al acceso efectivo calculado por `current_user_has_app_access()`.

La administración operativa de la allowlist se expone mediante RPCs específicas: `admin_list_app_access_allowlist`, `admin_authorize_app_access_email`, `admin_revoke_app_access_email` y `admin_get_app_access_diagnostic`. Estas funciones no agregan una entidad nueva; son contrato administrativo sobre `app_access_allowlist`, `auth.users`, `user_access_profiles`, roles, capabilities y `audit_log`.

Las mutaciones administrativas de allowlist registran auditoría en `audit_log` con actor `admin` y acciones como `app_access_authorize`, `app_access_reauthorize` y `app_access_revoke`.

## Maestros globales

`headhunter_companies` representa empresas headhunter oficiales compartidas por la app. Sus campos estructurales incluyen `display_name`, `normalized_name`, `notes` e `is_active`.

`headhunter_company_domains` representa dominios asociados a empresas headhunter. Se relaciona con `headhunter_companies` mediante `company_id` y usa `domain`, `normalized_domain`, `is_primary` e `is_active`.

Los dominios normalizados tienen formato `@dominio`.

El contacto local también conserva `is_headhunter` y `headhunter_domains`. La relación exacta entre ese campo local y el maestro global queda como ambigüedad vigente mientras el código siga usando ambas fuentes.

## Soporte operacional

Estas tablas existen en el schema, pero no son el centro del modelo de dominio.

`usage_limits` y `usage_events` soportan medición y control de uso por usuario.

`metric_snapshots` permite persistir cortes de métricas por usuario, métrica y período.

`data_exports` registra exportaciones mediante tipo, manifiesto y hash de archivo.

Estas estructuras deben documentarse en detalle solo cuando se cierre su contrato funcional o comercial.

## Unicidad y consistencia

El modelo usa índices y constraints para proteger identidades y relaciones importantes.

`service_connectors` es único por `provider` y `service_type`.

`external_contact_ids` y `external_contact_snapshots` son únicos por usuario, proveedor e ID externo.

`contact_emails` y `contact_phones` son únicos por usuario, contacto y valor normalizado. Esa regla evita duplicados dentro de la misma ficha, pero no impide coincidencias entre fichas distintas.

`external_interaction_sources` es único por usuario, proveedor, servicio e ID externo mientras la fuente está activa.

`contact_objective_assignments` es único por contacto y objetivo.

`object_review_state` es único por usuario, procesador, tipo de objeto y objeto.

`sync_cursors` es único por usuario, proveedor, recurso y etiqueta de cursor.

`todos` puede deduplicarse por `dedup_key` cuando esa clave existe.

Para Google Connected Account existe además un índice único parcial sobre `connected_accounts(user_id, provider, lower(btrim(account_email)))`, limitado a provider `google`, filas no revocadas y emails no vacíos.

## Relaciones principales

Un usuario autenticado tiene un perfil en `profiles`.

Un usuario puede tener muchas configuraciones, cuentas conectadas, contactos, objetivos, referidos, interacciones, sugerencias, logs y métricas.

Un contacto puede tener muchos correos y muchos teléfonos.

Un contacto puede tener muchas identidades externas.

Un proveedor externo puede tener snapshots de contactos vinculados o no vinculados a fichas locales.

Un contacto puede tener muchos objetivos y un objetivo puede tener muchos contactos mediante `contact_objective_assignments`.

Un referido tiene un contacto referente obligatorio y puede tener un contacto vinculado opcional.

Una interacción puede tener múltiples participantes.

Un participante puede apuntar a un contacto local o quedar solo como identidad externa.

Una interacción puede estar vinculada a objetos externos mediante `external_interaction_sources`.

Una sugerencia Coach puede apuntar a un objeto de dominio y puede originar acciones internas.

Los catálogos globales se comparten entre usuarios; las asignaciones y datos operativos se guardan por usuario.

## Invariantes estructurales

La identidad local del producto no depende de IDs externos.

Los IDs externos de contactos se separan en `external_contact_ids`.

Los snapshots externos de contactos se separan de la ficha local en `external_contact_snapshots`.

Los medios de contacto pertenecen a una ficha local específica.

Correos y teléfonos no son únicos globalmente entre contactos.

Los objetivos son entidades persistentes propias del usuario.

La relación contacto-objetivo es many-to-many.

El referido conserva siempre un contacto referente y puede vincularse opcionalmente a una ficha local.

La interacción local se separa de sus fuentes externas normalizadas.

Las interacciones soportan eliminación lógica.

Las fuentes externas de interacción tienen estado propio y pueden desactivarse sin borrar la interacción local.

Las tablas user-owned usan `user_id` donde aplica.

Los maestros globales no pertenecen a un usuario específico.

Una Google Connected Account activa no basta para asumir permiso actual de lectura: la autorización operativa depende también del token de sesión actual y de una verificación server-side reciente del flujo de datos.

## Lifecycle y borrado lógico

El modelo usa varias formas de lifecycle persistente.

`is_active` aparece en entidades que pueden desactivarse sin eliminación física, como contactos, objetivos, identidades externas, fuentes externas y maestros.

`is_deleted` aparece en interacciones y snapshots externos para representar eliminación lógica o estado eliminado en origen.

`prevent_reimport` aparece en interacciones y fuentes externas para conservar la intención de no recrear automáticamente ciertos objetos desde proveedores externos.

Existe una operación RPC real llamada `reset_current_user_app_data_v0_1` para reiniciar datos user-owned de una cuenta conservando identidad y catálogos globales. Su procedimiento operativo no pertenece a este documento.

Existe una operación RPC real llamada `merge_contacts_deep` que soporta reasignar relaciones durante una fusión transaccional de contactos, manteniendo integridad referencial. Su contrato de acción no pertenece a este documento.

## Ambigüedades vigentes

`interactions` conserva campos específicos de proveedor mientras `external_interaction_sources` implementa la relación normalizada con objetos externos. El repo no declara todavía una consolidación definitiva.

`contacts.headhunter_domains` sigue existiendo y es leído por código actual junto con el maestro global de empresas headhunter. No queda cerrada en este documento la fuente canónica final para todos los casos.

`sync_change_suppressions` existe como tabla, pero su comportamiento de producto activo debe confirmarse en la documentación de sincronización.

Algunas tablas operacionales existen antes de que su experiencia final esté cerrada. Deben tratarse como infraestructura persistente disponible, no como promesa de funcionalidad visible completa.
