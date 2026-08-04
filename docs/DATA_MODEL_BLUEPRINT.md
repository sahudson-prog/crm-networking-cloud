# Data model blueprint

Este documento es un diseno futuro. No describe necesariamente la base actual. Sirve como referencia para implementar una base relacional en Postgres/Supabase o Cloud SQL.

## Principios

- Todo dato privado debe pertenecer a un `user_id`.
- Una interaccion puede estar asociada a varios contactos.
- Un contacto puede tener varios emails y telefonos.
- Un referido es un objeto propio, no solo una relacion entre contactos.
- Un referido puede existir sin contacto vinculado y conservar sus datos libres aunque despues se vincule a un contacto.
- Un email puede moverse entre contactos sin perder historial.
- Los contactos no deben borrarse si tienen historial; deben desactivarse.
- Los motores de reglas/IA deben registrar que objetos revisaron para no reprocesar sin cambios.
- El modelo interno debe ser agnostico a la fuente: Google, Apple, Microsoft, CSV/Excel u otra fuente deben transformarse al mismo esquema.
- La arquitectura debe considerar una capa de integracion extensible para servicios externos, no solo fuentes de datos. Ejemplos: mensajeria, IA, notificaciones moviles, almacenamiento, calendario, email y contactos.
- Los IDs externos deben guardarse como identificadores de proveedor, no como ID principal del contacto de la app.
- En el MVP cloud, Google es el unico proveedor activo. El modelo debe quedar listo para v2 multi-proveedor, pero sin construir conectores Apple/Microsoft antes de tiempo.
- Los datos derivados, como KPIs y segmentos, deben poder recalcularse desde eventos/fuentes base y exportarse sin depender de la UI.
- Las capacidades por plan deben ser configurables por tipo de sugerencia, automatizacion, accion interna y sincronizacion. No deben quedar hardcodeadas en pantallas.
- El modelo debe soportar usuarios individuales y usuarios con membresia patrocinada por una empresa, permitiendo upgrades personales sobre el plan patrocinado.
- La analitica agregada debe separarse de los datos operativos personales y disenarse para privacidad, anonimato y consentimiento.

## Entidades blueprint

| Entidad | Proposito | Campos clave sugeridos |
|---|---|---|
| `users` | Usuario de la app | `id`, `email`, `name`, `created_at`, `last_login_at` |
| `plans` | Catalogo de tiers comerciales | `id`, `code`, `name`, `rank`, `is_active`, `billing_metadata_json` |
| `plan_entitlements` | Capacidades disponibles por plan | `id`, `plan_id`, `capability_type`, `capability_key`, `availability`, `max_automation_mode`, `limit_json` |
| `organizations` | Empresas cliente, por ejemplo outplacement | `id`, `name`, `type`, `billing_status`, `created_at` |
| `organization_memberships` | Relacion empresa-usuario y plan patrocinado | `id`, `organization_id`, `user_id`, `sponsored_plan_id`, `status`, `starts_at`, `ends_at` |
| `user_subscriptions` | Plan efectivo del usuario | `id`, `user_id`, `personal_plan_id`, `sponsored_plan_id`, `effective_plan_id`, `upgrade_source`, `status`, `renews_at` |
| `connected_accounts` | Cuenta externa conectada por usuario | `id`, `user_id`, `provider`, `account_email`, `oauth_refresh_token_encrypted`, `scopes`, `capabilities`, `revoked_at` |
| `service_connectors` | Catalogo de proveedores/servicios externos disponibles | `id`, `provider`, `service_type`, `capabilities`, `auth_type`, `enabled`, `config_schema_json` |
| `user_service_connections` | Conexion activa de un usuario a un servicio externo | `id`, `user_id`, `service_connector_id`, `account_label`, `credential_ref`, `scopes`, `status`, `connected_at`, `revoked_at` |
| `contacts` | Contacto CRM principal | `id`, `user_id`, `display_name`, `given_name`, `family_name`, `company`, `role`, `birthday`, `networking_status`, `networking_focus`, `is_headhunter`, `is_active` |
| `external_contact_ids` | Identificadores del contacto en fuentes externas | `id`, `user_id`, `contact_id`, `provider`, `external_id`, `account_id`, `last_seen_at`, `is_active` |
| `sync_change_suppressions` | Cambios de sincronizacion que el usuario decidio no volver a sugerir | `id`, `user_id`, `provider`, `resource_type`, `object_type`, `object_id`, `external_id`, `change_type`, `field_name`, `field_value_hash`, `reason`, `created_by`, `created_at`, `is_active` |
| `contact_emails` | Emails del contacto | `id`, `user_id`, `contact_id`, `email`, `domain`, `is_primary` |
| `contact_phones` | Telefonos del contacto | `id`, `user_id`, `contact_id`, `phone`, `normalized_phone` |
| `referrals` | Referidos apuntados por el usuario | `id`, `user_id`, `referred_by_contact_id`, `linked_contact_id`, `referral_name`, `referral_company`, `referral_role`, `referral_email`, `referral_phone`, `notes`, `source`, `status`, `is_active`, `created_at`, `updated_at` |
| `interactions` | Interacciones propias de la app: emails, citas, llamadas, mensajes y notas visibles/editables por el usuario | `id`, `user_id`, `type`, `subject`, `occurred_at`, `user_notes_raw`, `is_deleted`, `deleted_at`, `prevent_reimport` |
| `interaction_participants` | Contactos/emails involucrados en una interaccion | `id`, `user_id`, `interaction_id`, `contact_id`, `email`, `role` |
| `external_interaction_sources` | Objetos externos vinculados a una interaccion de la app | `id`, `user_id`, `interaction_id`, `provider`, `source_service`, `external_object_type`, `external_id`, `external_thread_id`, `external_url`, `source_detail`, `content_hash`, `sync_status`, `prevent_reimport` |
| `todos` | Pendientes sugeridos o acciones | `id`, `user_id`, `type`, `engine`, `object_type`, `object_id`, `current_value`, `suggested_value`, `status`, `reason`, `evidence`, `dedup_key`, `actions_json` |
| `todo_related_objects` | Objetos donde una sugerencia unica debe aparecer | `id`, `user_id`, `todo_id`, `object_type`, `object_id`, `relation_role`, `created_at` |
| `todo_configs` | Configuracion por tipo de pendiente | `id`, `user_id`, `todo_type`, `enabled`, `auto_apply`, `requires_confirmation` |
| `action_invocations` | Intentos y ejecuciones de acciones internas | `id`, `user_id`, `action_name`, `actor_type`, `status`, `source_todo_id`, `object_type`, `object_id`, `input_json`, `output_json`, `requires_confirmation`, `executed_at` |
| `object_review_state` | Control anti reproceso reglas/IA | `id`, `user_id`, `processor_id`, `processor_type`, `object_type`, `object_id`, `object_updated_at`, `last_reviewed_at`, `last_fingerprint`, `result_json` |
| `sync_cursors` | Cursores de sync incremental por usuario/proveedor/recurso | `id`, `user_id`, `connected_account_id`, `provider`, `resource_type`, `cursor_label`, `cursor_value`, `last_synced_at`, `status`, `metadata` |
| `usage_limits` | Limites configurables por usuario/plan | `id`, `user_id`, `limit_type`, `period`, `limit_value`, `used_value`, `reset_at`, `is_enabled` |
| `usage_events` | Registro de consumo relevante | `id`, `user_id`, `event_type`, `provider`, `units`, `object_type`, `object_id`, `created_at` |
| `analytics_events` | Eventos anonimizables para analitica de producto | `id`, `user_id`, `event_type`, `event_date`, `properties_json`, `privacy_scope`, `created_at` |
| `analytics_aggregates` | Agregados privacy-first para reportes/benchmarks | `id`, `metric_key`, `period_type`, `period_start`, `segment_json`, `value`, `privacy_threshold`, `calculated_at` |
| `imports` | Cargas CSV/Excel | `id`, `user_id`, `file_name`, `file_type`, `status`, `rows_total`, `rows_imported` |
| `data_exports` | Respaldos/exportaciones desde app local o cloud | `id`, `user_id`, `schema_version`, `source_app`, `generated_at`, `file_name`, `status`, `counts_json` |
| `import_batches` | Importaciones de archivos espejo o fuentes manuales | `id`, `user_id`, `schema_version`, `source_app`, `file_name`, `status`, `started_at`, `finished_at`, `counts_json` |
| `audit_log` | Historial de cambios relevantes | `id`, `user_id`, `actor`, `action`, `object_type`, `object_id`, `before_json`, `after_json`, `created_at` |
| `metric_snapshots` | Snapshots opcionales de KPIs calculados | `id`, `user_id`, `metric_key`, `period_type`, `period_start`, `value`, `breakdown_json`, `calculated_at` |

## Flujos blueprint

### Contrato export/import espejo v0.1

Objetivo: permitir que la app local exporte toda la data necesaria y que la app cloud la importe para quedar como replica comparable, sin apagar ni modificar la app local.

Formato recomendado:

- Archivo unico `.zip`.
- Nombre sugerido: `crm-networking-export-YYYYMMDD-HHMMSS.zip`.
- Codificacion interna: UTF-8.
- Fechas en metadatos: ISO 8601.
- Valores de tablas: conservar como texto cuando vengan desde Sheets, para evitar conversiones silenciosas.

Estructura del `.zip`:

| Archivo | Contenido | Obligatorio | Uso |
|---|---|---|---|
| `manifest.json` | Version, fecha, app origen, usuario origen, conteos, hashes y lista de archivos | Si | Validar integridad antes de importar |
| `tables/crm_contactos_extra.jsonl` | Filas de `CRM_Contactos_Extra` normalizadas a columnas maestras actuales | Si | Poblar contactos y referencias externas |
| `tables/interacciones.jsonl` | Filas de `Interacciones` con columnas actuales | Si | Poblar interacciones y participantes |
| `tables/crm_relaciones.jsonl` | Filas de `CRM_Relaciones` normalizadas a estructura ampliada A:Q | Si | Poblar referidos y vinculos |
| `tables/crm_todos.jsonl` | Filas de `CRM_ToDos` | Si, aunque este vacio | Poblar Coach/pendientes |
| `tables/crm_todo_config.jsonl` | Filas de `CRM_ToDo_Config` | Si, aunque este vacio | Poblar preferencias de automatizacion |
| `tables/crm_object_review_state.jsonl` | Filas de `CRM_Object_Review_State` | Si, aunque este vacio | Mantener control anti reproceso |
| `tables/crm_sync_state.jsonl` | Filas de `CRM_Sync_State` | Si, aunque este vacio | Mantener cursores/estado de sync |
| `tables/crm_config.jsonl` | Filas relevantes de `CRM_Config` | Si | Mantener fecha inicio networking y parametros globales |
| `raw_sheets/*.jsonl` | Snapshot literal opcional de hojas originales | Recomendado | Respaldo y auditoria ante transformaciones |
| `validation_report.json` | Conteos, columnas faltantes, duplicados y advertencias | Si | Decidir si el import es seguro |

Contenido minimo de `manifest.json`:

| Campo | Descripcion |
|---|---|
| `schema_version` | Version del contrato, ejemplo `crm_networking_export_v0_1` |
| `generated_at` | Fecha/hora de generacion |
| `source_app` | `streamlit_local` |
| `source_version` | Version/hito si existe; si no, fecha y hash disponible |
| `export_mode` | `mirror_full` para export completo |
| `user_label` | Identificador descriptivo no sensible, por ejemplo `owner` |
| `tables` | Lista de tablas exportadas, conteos, columnas y hash por archivo |
| `warnings` | Advertencias no bloqueantes |
| `blocking_errors` | Errores que impiden import seguro |

Reglas de seguridad:

- El export contiene datos personales y minutas. No debe subirse a GitHub ni compartirse por chat.
- El export no debe incluir `credentials.json`, `token.json`, secretos OAuth, claves Supabase, contrasenas ni variables `.env`.
- Si se necesita identificar la cuenta Google origen, usar etiqueta o hash, no exponer correo completo en logs compartidos.
- El boton de export local no debe escribir ni modificar datos; solo leer, empaquetar y generar el archivo.
- El import cloud debe mostrar preview con conteos antes de insertar o reemplazar datos.

Reglas de integridad:

- Cada archivo de tabla debe declarar o inferir columnas esperadas desde el contrato.
- Si faltan columnas, el export debe agregarlas vacias cuando sean columnas soportadas por la app actual.
- Si aparecen columnas nuevas no documentadas, deben incluirse en `raw_sheets` y reportarse como advertencia.
- `Contact_ID` debe existir o inferirse para todos los contactos antes de importar a cloud.
- `Google_ID` se conserva como llave legacy y se migra a referencia externa cuando aplique.
- Interacciones deben conservar `ID_Entrada`, `ID_Fuente`, `Thread_ID`, `Email_Asociado` y `Rol_Email` para dedupe y reasignacion futura.
- Referidos deben conservar `Referido_ID`; si falta, se genera con la logica local vigente antes del export.
- ToDos deben conservar `Dedup_Key` y `Estado_ToDo` para no duplicar recomendaciones al migrar.
- `CRM_Object_Review_State` debe importarse para evitar que reglas/IA reprocesen objetos ya revisados.
- `CRM_Sync_State` se importa como historico, pero la app cloud debe decidir si reutiliza cursores o inicia cursores propios por seguridad.

Validaciones minimas antes de permitir import cloud:

- Conteo de contactos exportados vs filas de `CRM_Contactos_Extra`.
- Conteo de interacciones exportadas vs filas de `Interacciones`.
- Conteo de referidos exportados vs filas de `CRM_Relaciones`.
- Duplicados de `Contact_ID`, `Google_ID`, `ID_Entrada`, `Referido_ID` y `Todo_ID`.
- Interacciones sin contacto asociado.
- Referidos cuyo `Quien_Refiere_ID` no existe en contactos.
- Referidos cuyo `Contacto_Vinculado_ID` no existe en contactos, si no esta vacio.
- ToDos activos cuyo `Objeto_ID` no existe en la tabla esperada.
- Columnas esperadas ausentes o columnas desconocidas.

Herramienta transicional:

- `cloud/importer/preview_export.py` ejecuta una primera validacion local del ZIP espejo antes de construir la UI/carga real.
- `cloud/importer/load_export.py` transforma el ZIP espejo a filas cloud y permite dry-run o carga real controlada con `--apply`.
- El preview no imprime datos personales; solo version, integridad, errores/advertencias y conteos.
- La carga real a Supabase reutiliza estas validaciones antes de insertar datos, exige usuario Auth y aborta si el usuario destino ya tiene datos.

Regla de import:

- Primer import cloud debe ser destructivo solo dentro del usuario cloud destino recien creado o vacio.
- Para un usuario con datos existentes, el import debe crear un `import_batch`, mostrar diferencias y pedir confirmacion antes de reemplazar, fusionar o ignorar.
- Cada fila importada debe quedar asociada a `user_id`.
- Cada import debe dejar registro en `import_batches` y, cuando corresponda, `audit_log`.

### Schema Postgres v0.1

Archivo de referencia: `cloud/supabase/schema_v0_1.sql`.

Objetivo: crear una base Supabase/Postgres vacia para importar el ZIP espejo local y comparar la replica cloud contra la app actual, sin ejecutar cambios sobre Google Sheets ni servicios Google.

Tablas incluidas:

| Grupo | Tablas |
|---|---|
| Usuario y configuracion | `profiles`, `user_settings` |
| Integraciones | `service_connectors`, `connected_accounts`, `external_contact_ids`, `external_interaction_sources`, `sync_cursors` |
| Contactos | `contacts`, `contact_emails`, `contact_phones` |
| Interacciones | `interactions`, `interaction_participants` |
| Referidos | `referrals` |
| Coach, reglas y acciones | `todo_configs`, `todos`, `action_invocations`, `object_review_state` |
| Import/export | `import_batches`, `data_exports` |
| Uso, auditoria y KPIs | `usage_limits`, `usage_events`, `audit_log`, `metric_snapshots` |

Decisiones del schema v0.1:

- `contacts.id` es el ID propio de la app; `legacy_google_id` y otros IDs externos son referencias, no la fuente de verdad.
- Los medios de contacto viven separados en `contact_emails` y `contact_phones`.
- Las interacciones soportan multiples participantes mediante `interaction_participants`.
- `interactions.id` debe ser el ID propio de la app para el evento visible/editable por el usuario. Los IDs de Gmail, Calendar, Apple, Microsoft u otros proveedores deben vivir como referencias externas, idealmente en `external_interaction_sources`, para no mezclar la fuente de verdad de la app con objetos importados.
- El contenido original importado debe conservarse separado de la minuta editable. `source_detail` o una tabla externa equivalente conserva el dato crudo del proveedor; `user_notes_raw` es la version editable por el usuario y la fuente principal para Coach.
- Las referencias externas de interacciones deben guardar, cuando exista: proveedor, cuenta conectada, tipo de objeto externo, ID externo, thread/conversation ID, URL de apertura, hash/version del contenido, fecha de ultima sincronizacion y preferencia de reimportacion si el usuario elimino la interaccion local.
- Las sugerencias del Coach deben poder relacionarse con multiples contactos u objetos sin duplicar el ToDo. Si una sugerencia nace de una interaccion con varios participantes, debe existir un solo `todo` y multiples filas en `todo_related_objects`; ejecutarla, descartarla o auto-resolverla afecta a todas las fichas donde aparece.
- La eliminacion de interacciones debe modelarse como archivo/soft-delete, no como borrado fisico. Campos previstos: `is_deleted`, `deleted_at`, `deleted_by`, `delete_reason`. Las vistas, KPIs y reglas deben leer solo interacciones no eliminadas; el sync debe detectar si una interaccion eliminada localmente reaparece desde el proveedor y pedir restauracion o mantenerla oculta segun configuracion futura.
- Los telefonos guardan `normalized_phone_last8` para detectar posibles consolidaciones por ultimos 8 digitos. La app debe complementar ese dato con una capa reusable de identidad de telefonos por pais/formato, para comparar numeros con o sin codigo internacional sin duplicarlos visualmente.
- `action_invocations` registra solicitudes, confirmaciones, ejecuciones y errores de acciones internas para que UI, reglas e IA usen el mismo camino.
- El modelo incluye `usage_limits` y `usage_events` desde el inicio para poder aplicar guardrails de costo/uso.
- Todas las tablas privadas tienen `user_id` y RLS por usuario.
- El script usa indices, policies y triggers rerunnable para entorno de desarrollo.

Mapeo inicial export v0.1 a Postgres:

| Archivo exportado | Destino cloud principal | Nota |
|---|---|---|
| `tables/crm_contactos_extra.jsonl` | `contacts`, `contact_emails`, `contact_phones`, `external_contact_ids` | `Contact_ID`/legacy se conserva como compatibilidad; Google pasa a referencia externa |
| `tables/interacciones.jsonl` | `interactions`, `interaction_participants`, futuro `external_interaction_sources` | `Thread_ID`, `ID_Fuente`, `Email_Asociado` y `Rol_Email` alimentan dedupe, participantes y vinculo externo |
| `tables/crm_relaciones.jsonl` | `referrals` | Mantiene referido como objeto propio y vinculo opcional a contacto |
| `tables/crm_todos.jsonl` | `todos` | Conserva estado, evidencia, dedupe y acciones |
| `tables/crm_todo_config.jsonl` | `todo_configs` | Configuracion por tipo de sugerencia |
| `tables/crm_object_review_state.jsonl` | `object_review_state` | Evita reproceso de reglas/IA ya evaluadas |
| `tables/crm_sync_state.jsonl` | `sync_cursors` | Se importa como historico usando `cursor_label`, `cursor_value`, `last_synced_at`, `status` y `metadata`; la nube puede iniciar cursores propios si corresponde |
| `tables/crm_config.jsonl` | `user_settings` | Parametros globales como fecha de inicio de networking |
| `manifest.json`, `validation_report.json` | `import_batches` | Registro, conteos, hashes y validaciones del import |

### Catalogo de acciones internas

Objetivo: permitir que una misma accion de negocio sea usada por la UI, reglas duras, Coach IA o automatizaciones sin duplicar codigo ni depender de una pantalla especifica.

Regla de arquitectura:

- La UI llama acciones internas.
- El Coach IA sugiere o solicita acciones internas con parametros estructurados.
- La app valida permisos, datos y configuracion de usuario.
- Si corresponde, pide confirmacion.
- La app ejecuta una unica funcion oficial.
- El resultado queda registrado en `action_invocations` y, si modifica datos, tambien en `audit_log`.

Contrato minimo de cada accion:

| Campo | Descripcion |
|---|---|
| `action_name` | Nombre tecnico estable, por ejemplo `contact.update_networking_status` |
| `display_name` | Texto humano, por ejemplo `Cambiar estado de networking` |
| `description` | Que hace y cuando se usa |
| `input_schema` | Campos esperados, tipos, obligatorios y opcionales |
| `output_schema` | Resultado esperado y datos devueltos |
| `validations` | Reglas antes de ejecutar |
| `affected_objects` | Tablas/objetos que puede modificar |
| `requires_confirmation_default` | Si debe preguntar siempre por defecto |
| `allowed_actors` | `user`, `rule`, `ai`, `system` segun corresponda |
| `plan_required` | Basica, Pro o futuro plan superior si aplica |
| `audit_policy` | Que se registra en `action_invocations` y `audit_log` |

Acciones candidatas iniciales:

| Accion | Proposito | Confirmacion default |
|---|---|---|
| `contact.create` | Crear contacto propio de la app | Si |
| `contact.update` | Editar datos principales de un contacto | Si |
| `contact.deactivate` | Desactivar contacto sin borrar historial | Si |
| `contact.update_networking_status` | Cambiar estado oficial de networking | Si, configurable por tipo de regla |
| `contact.set_networking_focus` | Activar/desactivar foco networking | Si |
| `contact.set_headhunter` | Marcar/desmarcar headhunter | Si |
| `referral.create` | Crear referido como apunte propio | Si |
| `referral.update` | Editar datos libres de referido | Si |
| `referral.link_contact` | Vincular referido con contacto existente | Si |
| `interaction.create_manual` | Crear interaccion manual | Si |
| `interaction.update_user_notes` | Editar minuta/notas de usuario | Si |
| `interaction.dismiss` | Ocultar/archivar interaccion preservando historial y minutas | Si |
| `interaction.open_external_source` | Abrir el correo, cita o mensaje original cuando exista link del proveedor | No modifica datos |
| `interaction.prevent_reimport` | Marcar un objeto externo para no recrear la interaccion tras sync | Si |
| `sync.contacts.read` | Leer/importar cambios desde proveedor de contactos | Si |
| `sync.contacts.apply_preview` | Aplicar cambios seleccionados desde el preview de contactos y guardar cursor solo si no quedan pendientes | Si |
| `sync.activity.read` | Leer/importar actividad de email/calendario | Si |

Las acciones que escriban en servicios externos, como enviar correo o crear cita en Google, quedan fuera de v1 salvo aprobacion explicita futura.

### Plataforma cloud MVP

Principios del primer despliegue:

- Mantener la app local operativa y usarla como comparador.
- Crear un export completo desde local y un import cloud que deje la base espejo.
- Usar Supabase/Postgres como base inicial recomendada, salvo que una validacion posterior indique otro proveedor.
- Activar primero un solo usuario y, como maximo inicial, un segundo usuario beta.
- Google v1 solo debe leer/importar/sincronizar: contactos, Gmail y Calendar. No debe escribir en servicios Google.
- Guardar tokens OAuth como secretos cifrados/referencias seguras, nunca en texto plano ni en el repositorio.
- Usar row-level security por `user_id` desde el inicio, incluso si solo existe un usuario.
- Registrar uso de sync, APIs e IA para evitar costos inesperados y facilitar diagnostico.
- La UI cloud debe construirse con componentes globales: botones, iconos, filtros, tablas, graficos, Coach, tarjetas y acciones internas reutilizables.

### Capa de integracion

La logica interna consume objetos normalizados y capacidades, no APIs externas directamente.

Para cada conector:

- `provider`: por ejemplo `google`.
- `service_type`: contactos, email, calendario, archivo, IA, mensajeria o notificaciones.
- `capabilities`: acciones disponibles como `read_contacts`, `read_email_metadata`, `read_email_body`, `read_calendar_events`, `send_email`, `create_event`.
- `scopes`: permisos OAuth solicitados.
- `rate_limits`: limites por usuario/proyecto cuando aplique.
- `sync_strategy`: historica, incremental por cursor, incremental por fecha o manual.

En v1 solo se implementa Google. Los demas proveedores quedan como diseno compatible para no bloquear v2.

### KPIs y datos derivados

Los KPIs deben vivir en una capa comun, no dentro de la vista.

Reglas:

- Calcular desde datos base normalizados: contactos, medios, interacciones, participantes, referidos y ToDos.
- Mantener funciones/queries con nombres claros y tests.
- Permitir recalculo completo y calculo incremental cuando el volumen crezca.
- Permitir exportar resultados o datos base para analisis externo.
- Evitar hardcodear filtros visuales dentro de las queries; los filtros deben llegar como parametros.

### Editor oficial de contacto

Debe existir una funcion/componente unico para crear o editar contactos. La UI puede llamarlo desde Contactos, Ficha, Referidos, Coach IA u otros contextos.

Responsabilidades:

- Crear contacto nuevo.
- Editar contacto existente.
- Validar emails y telefonos.
- Detectar posibles duplicados por email normalizado y telefono normalizado.
- Guardar datos propios del contacto, no datos libres de referidos.
- Devolver el `contact_id` creado o editado al flujo que lo invoco.

Campos base de entrada:

- Nombre.
- Empresa.
- Cargo.
- Emails, uno o mas.
- Telefonos, uno o mas.
- Estado de networking.
- Foco networking.
- Marca headhunter.

Validaciones:

- Email: formato valido o vacio.
- Telefono: normalizable o vacio.
- Duplicado por email exacto normalizado.
- Duplicado por telefono normalizado, idealmente comparando ultimos digitos relevantes cuando aplique.
- Si existe posible duplicado, el flujo debe advertir y pedir decision antes de crear un contacto nuevo.

### Editor oficial de referido

Debe existir una funcion/componente unico para crear o editar referidos.

Responsabilidades:

- Crear referido con `referred_by_contact_id` obligatorio.
- Permitir datos libres de referido: nombre, empresa, cargo, email, telefono y notas.
- Guardar referido sin contacto vinculado.
- Vincular referido a contacto existente.
- Crear contacto nuevo desde datos del referido usando el editor oficial de contacto.
- Editar contacto vinculado usando el editor oficial de contacto.
- Mantener separados los datos apuntados del referido y los datos oficiales del contacto.

Campos base de entrada:

- Quien refiere.
- Nombre del referido.
- Empresa del referido.
- Cargo del referido.
- Email del referido.
- Telefono del referido.
- Notas adicionales.
- Contacto vinculado opcional.

Reglas:

- `referred_by_contact_id` es obligatorio.
- Para guardar un referido debe existir al menos un dato adicional del referido: nombre, empresa, cargo, email, telefono o notas.
- Si se abre desde una ficha de contacto, `referred_by_contact_id` viene preseleccionado y puede quedar bloqueado o editable segun contexto.
- Si se abre desde contexto global, el usuario debe seleccionar quien refiere.
- El selector de contacto vinculado debe partir con `Sin vinculo`.
- Si hay contacto vinculado seleccionado, sus campos se muestran como lectura.
- Si no hay contacto vinculado, se puede crear contacto usando los datos del referido como prellenado inicial.
- Al guardar un contacto creado desde referido, el flujo vuelve al referido con `linked_contact_id` ya seleccionado.
- Al editar contacto vinculado, el flujo vuelve al referido sin perder cambios no guardados del referido.
- Mientras se crea o edita contacto dentro del flujo de referido, la zona de referido queda temporalmente deshabilitada.

### Relacion entre referido y contacto

- `linked_contact_id` es opcional.
- Si existe, apunta al contacto real.
- Si no existe, el referido sigue siendo un apunte accionable.
- Crear o editar un contacto desde un referido no debe borrar ni pisar automaticamente los campos libres del referido.
- Si se crea un contacto desde referido, el contacto hereda inicialmente nombre, empresa, cargo, email y telefono del referido, pero desde ese momento contacto y referido siguen vidas separadas.

## Decisiones abiertas

- Proveedor final: Supabase/Postgres o Google Cloud SQL/Postgres.
- Estrategia exacta de cifrado de tokens OAuth.
- Nivel de auditoria necesario para beta vs producto comercial.
- Si Streamlit se mantiene como UI principal o se reemplaza despues por frontend separado.
- Alcance inicial de conectores: Google primero; Apple y Microsoft/Outlook pueden requerir capacidades distintas por restricciones de API.
- Alcance futuro de servicios externos: mensajeria, IA, notificaciones moviles, almacenamiento y automatizaciones deben conectarse con la misma logica de adaptadores/capacidades.
- Formato exacto del archivo espejo exportado por la app local.
- Umbrales exactos de alertas/limites por servicio para beta cerrada.
- Si el MVP usa solo consultas en vivo para KPIs o combina consultas con snapshots.
- Herramienta final de hosting web junto a Supabase, si no se usa una plataforma integrada.

## Historial

- 2026-07-15: Renombrado desde `DATA_MODEL_TARGET` para aclarar que es un blueprint futuro.
- 2026-07-20: Se vuelve el modelo agnostico a fuente externa y se agregan export/import espejo.
- 2026-07-20: Se amplia la vision de conectores a una capa de integracion para servicios externos, no solo fuentes de datos.
- 2026-07-22: Se agrega `referrals` como entidad propia y se documentan los contratos del editor oficial de contacto y del editor oficial de referido.
- 2026-07-22: La base local inicia transicion hacia identidad propia de contacto con `Contact_ID`, `Provider` y `Provider_Contact_ID`.
- 2026-07-22: Se ajusta blueprint cloud MVP: Google-only v1, Supabase/Postgres recomendado, guardrails de uso, OAuth read-only, RLS desde el inicio, capa de integracion y KPIs como capa comun/exportable.
- 2026-07-22: Se define contrato export/import espejo v0.1 como ZIP con manifest, tablas normalizadas, snapshots raw opcionales, reporte de validacion y reglas de seguridad/integridad.
- 2026-07-27: Se agrega schema Supabase/Postgres v0.1 en `cloud/supabase/schema_v0_1.sql`, con contactos propios de la app, referencias externas, import/export, reglas, KPIs, guardrails de uso y RLS por usuario.
- 2026-07-27: Se agrega el concepto de catalogo de acciones internas y la tabla `action_invocations` para que UI, reglas y Coach IA ejecuten funciones con contratos estructurados y trazabilidad.
- 2026-07-27: Se agrega preview tecnico de import en `cloud/importer/preview_export.py`, validado contra ZIP real sin errores bloqueantes.
- 2026-07-27: Se agrega cargador controlado `cloud/importer/load_export.py`, probado en dry-run contra ZIP real.
- 2026-07-29: Se agregan entidades blueprint para planes, entitlements por capability, organizaciones/outplacement, membresias patrocinadas, suscripciones efectivas y analitica agregada privacy-first.
