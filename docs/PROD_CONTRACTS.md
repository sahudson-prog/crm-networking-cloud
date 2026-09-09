# Contratos persistentes de PROD

## Propósito y alcance

Proteger el estado persistente de Coffeecito al promover versiones completas de software. Este documento define clasificación y revisión de cambios; no congela todo el schema ni reemplaza los documentos de datos, seguridad o arquitectura.

Los contratos se identificaron en código y SQL locales. Esto no certifica el estado de DEV remoto ni presupone que PROD ya esté creado. Los controles automáticos descritos abajo son propuestas, todavía no implementadas.

## Qué se promueve y qué permanece

- Se promueve una revisión aprobada e identificable de código, dependencias y assets de `cloud/web`. DEV continúa evolucionando; nunca se convierte físicamente en PROD.
- PROD conserva su proyecto Supabase, usuarios Auth, IDs, datos personales, configuraciones de usuario, allowlist, asignaciones administrativas, conexiones y registros operativos. Nunca se reemplazan por un dump de DEV.
- Catálogos globales también persisten: sus actualizaciones deben ser explícitas y preservar referencias y ajustes productivos; no se restauran indiscriminadamente con cada release.
- Secrets, configuración Auth/OAuth, redirects y cualquier Storage existente pertenecen al ambiente. No se copian desde DEV ni se reinicializan al desplegar software.
- DEV y PROD comparten arquitectura lógica, con datos y configuración separados. Las variables públicas de Next.js se incorporan al build: promover una revisión no significa reutilizar un `.next` construido contra DEV.
- Los cambios de DB se aplican mediante evoluciones controladas sobre PROD existente. Antes de una release relevante debe existir backup recuperable y rollback definido. Una ventana nocturna puede bloquear temporalmente el uso si el cambio lo exige.

## Contratos identificados

### Identidad y acceso

`auth.users.id`, `profiles.id`, `auth.uid()` y las referencias `user_id` sostienen el ownership. No recrear identidades ni reasignar UUIDs al desplegar. La elegibilidad utiliza el email canónico de Auth, la allowlist normalizada y `user_access_profiles`, sin convertir el email en sustituto del ID interno.

Son sensibles los códigos de roles, planes y capabilities, su precedencia y asignaciones; `current_user_app_access_status()` devuelve `allowed`/`reason`, y `current_user_has_capability(p_capability_code)` decide permisos. El trigger `handle_new_auth_user_profile` y el hook `hook_enforce_app_access_allowlist` mantienen altas fail-closed. Crear la función SQL no equivale a habilitar el hook en Dashboard.

Evidencia: [acceso efectivo](../cloud/web/lib/appAccess.ts), [administración](../cloud/supabase/add_app_access_admin_v0_1.sql) y [seguridad](SECURITY_ACCESS.md).

### Datos consumidos y relaciones

Los nombres, tipos, nulabilidad, valores persistidos y unicidad usados por consultas y upserts son interfaces, no detalles internos intercambiables. Casos críticos:

- `contacts`: `id`, `user_id`, `display_name`, `company`, `role`, `networking_status`, `networking_focus`, `is_headhunter` y marcas de ciclo de vida; métodos en `contact_emails`/`contact_phones` enlazados por `contact_id`.
- `interactions` y `interaction_participants`: conservar identidad y asociaciones; `referrals` conserva contacto referente y contacto vinculado opcional.
- `objectives` y `contact_objective_assignments`: preservar IDs, relaciones y unicidad contacto/objetivo.
- `external_contact_ids`, `external_contact_snapshots`, `external_interaction_sources`, `sync_cursors` y `sync_change_suppressions`: sus claves y referencias sostienen deduplicación y continuidad de sincronización, no son datos descartables de despliegue.
- `user_settings`, `todos`, `object_review_state` y `action_invocations`: claves y payloads persistidos consumidos por la app requieren compatibilidad de lectura, no solo existencia de tabla.
- `headhunter_companies`/`headhunter_company_domains` y catálogos de acceso: IDs, códigos y relaciones globales deben sobrevivir actualizaciones de semillas.

Esta lista identifica fronteras, no enumera todas las columnas. Para cada cambio, contrastar consultas afectadas con [SQL real](../cloud/supabase) y [modelo de datos](DATA_MODEL.md), incluidas FKs, cascadas y claves usadas por `onConflict`.

### RPC y permisos efectivos

Conservar nombre, parámetros, tipos, respuesta, errores esperados y autorización de las RPC consumidas. Además de acceso efectivo, son críticas:

- `admin_list_app_access_allowlist`, `admin_authorize_app_access_email`, `admin_revoke_app_access_email` y `admin_get_app_access_diagnostic`: administración estrecha, `admin.manage_access`, auditoría y guard de auto-revocación. No sustituirlas por CRUD cliente de allowlist.
- `merge_contacts_deep` y `reset_current_user_app_data_v0_1`: alcance sobre datos existentes, confirmación y ownership. Cambiar sus tablas afectadas requiere revisión explícita de efectos destructivos.
- `validate_contact_sync_storage_v0_1`: respuesta de diagnóstico consumida por importación.

RLS habilitado, policies, grants de tabla/función, rol invocador, `SECURITY DEFINER`/`INVOKER` y `search_path` constituyen un contrato conjunto. Una policy existente con RLS deshabilitado no protege; una función invoker puede fallar si otra migration retira grants que necesita. Validar permisos efectivos con roles reales, no solo texto SQL.

Evidencia: [acciones administrativas](../cloud/web/lib/betaAccessAdminActions.ts), [merge](../cloud/web/lib/contactMergeActions.ts), [reset](../cloud/supabase/reset_current_user_app_data_v0_1.sql) y [acciones](ACTIONS.md).

### Google Connected Account

Login de identidad y autorización Google de datos son flujos separados. La cuenta actual debe coincidir con el email canónico normalizado de la sesión; los scopes efectivos requieren verificación, no intención declarada por el cliente.

`connected_accounts` conserva SELECT de `authenticated` sujeto a RLS, sin INSERT/UPDATE/DELETE directos del cliente. `finalize_google_connected_account_verified(uuid,text,text[])` es ejecutable por `service_role`, no por roles cliente; `disconnect_current_user_google_connected_account(uuid)` permite la operación propia autenticada, validando acceso y ownership.

La ruta `/api/google/connected-account/finalize` verifica sesión, app access y evidencia Google antes de persistir. Sus respuestas, la unicidad canónica y las FKs hacia la cuenta son contratos. Un deploy no revoca conexiones ni reinicia permisos; no reejecutar scripts históricos que deduplican o invalidan autorizaciones como si fueran inicialización inocua.

Evidencia: [migration canónica](../cloud/supabase/canonical_google_connected_account_v0_1.sql), [ruta server-side](../cloud/web/app/api/google/connected-account/finalize/route.ts) y [conector](connectors/GOOGLE.md).

### Configuración de ambiente y Storage

La [plantilla de ambiente](../cloud/web/.env.example) declara URL/clave pública Supabase, site key Turnstile, `SUPABASE_SERVICE_ROLE_KEY` y `GOOGLE_OAUTH_CLIENT_ID`. El cliente admite también `NEXT_PUBLIC_SUPABASE_ANON_KEY` como alternativa a la publishable key. Service role es secreto server-only; el Client ID usado por la verificación es configuración server-side, no una secret key.

URL y claves deben corresponder al mismo proyecto; audiencia Google al client configurado. Preservar por ambiente Site URL/redirects de Supabase, callback autorizado de Google, proveedores habilitados, hook, CAPTCHA y entrega de magic links. Los secrets Google y Turnstile se configuran fuera del frontend. Cambios estructurales o rotaciones necesitan coordinación, no copiar valores DEV.

No se identificó uso funcional de buckets/objetos Storage en el runtime inspeccionado; aparece una previsión de cuota. No afirmar que Storage remoto esté vacío: inventariarlo antes de un cambio de infraestructura y preservar cualquier objeto/policy existente.

## Clasificación del cambio

- **GREEN: cambio normal.** No afecta contratos persistentes: copy, layout o refactor interno que conserva interfaces y comportamiento de acceso/datos. Validación proporcional, sin exigir migration.
- **YELLOW: evolución compatible.** Añade estructura sin romper lectores/escritores actuales: columna opcional, índice o nueva RPC sin retirar la anterior. Requiere migration y verificación de compatibilidad; revisar defaults, locks y coste de ejecución. Una adición no es automáticamente inocua.
- **RED: PROD CONTRACT CHANGE.** Altera identidad, datos existentes, permisos o compatibilidad: renombrar/eliminar campos consumidos, cambiar tipos/valores/IDs, firmas RPC, RLS/grants, almacenamiento, canonización de cuentas u OAuth persistente. También un cambio solo en código puede ser RED.

El nivel depende del efecto, no únicamente de la carpeta modificada. El schema puede evolucionar: preferir expandir primero y retirar después de migrar consumidores y datos.

## Regla para agentes y aprobación

La instrucción permanente mínima vive en [AGENTS.md](../AGENTS.md); este documento conserva el detalle para no cargar cada tarea con un manual de release.

Antes de implementar un RED, presentar `PROD CONTRACT CHANGE` con: contrato afectado; necesidad; impacto sobre PROD/datos; compatibilidad con versión anterior; migration requerida; rollback; backup y mantenimiento necesarios, o justificación de que no aplican. No incluirlo silenciosamente en una tarea normal. Una autorización explícita de ese alcance permite avanzar; un riesgo material nuevo debe informarse.

Rollback de software no deshace una migration ni recupera datos. Debe seguir funcionando la versión anterior con la DB resultante, o existir recuperación ensayada con ventana y pérdida potencial de datos explicitadas. Nunca sustituir PROD por DEV como rollback.

## Controles propuestos, todavía no instalados

- **Warning por diff sensible:** comparar revisión candidata con la revisión productiva aprobada e identificada; señalar SQL, Auth, ruta Google, permisos y configuración. En revisión local incluir archivos nuevos. No bloquear por nombre de carpeta ni inferir RED solo por coincidencia de texto.
- **Warning de contrato:** solicitar clasificación y evidencia de impacto cuando cambia una interfaz o configuración sensible; derivar al owner correspondiente sin auditar toda la documentación.
- **Fallo por integridad:** una vez creada la baseline y el registro de migrations aplicadas, comparar hashes y rechazar edición de una migration ya desplegada. Evoluciones nuevas se añaden, no reescriben historia aplicada.
- **Fallo por incompatibilidad demostrada:** en Supabase desechable ejecutar bootstrap y evolución con fixtures sintéticas, verificar firmas/respuestas consumidas, integridad y aislamiento; probar usuario permitido, revocado, otro propietario, anon y privilegios administrativos. Comprobar también permisos de RPC internas y operaciones invoker como reset. El runner debe devolver error si cualquier assertion falla, aunque SQL haya terminado sin excepción.
- **Fallo por exposición confirmada:** revisar diffs/artefactos para claves secretas, service role cliente, `.env.local` versionado o seeds con datos personales; detectar nombres `NEXT_PUBLIC_*` sensibles. Los valores ambiguos generan revisión, no se imprimen. No marcar una publishable/site key pública como secreto por su nombre.
- **Gate de release propuesto:** RED sin aprobación/plan de recuperación impide promover a PROD, no editar DEV. Builds y ensayos no ejecutan operaciones remotas ni despliegues automáticos.

## Documentación y siguiente paso

Mantener [ARCHITECTURE.md](ARCHITECTURE.md) como arquitectura lógica compartida; no crear una copia `PROD_ARCHITECTURE.md`. Proponer después `PROD_ENVIRONMENT.md` para configuración por ambiente sin valores sensibles y `RELEASE_RUNBOOK.md` para promoción, mantenimiento, backup y rollback. Inicialmente recuperación puede ser una sección del runbook; separar `DATA_RECOVERY.md` cuando haya procedimientos de restauración detallados y ensayados. Esos documentos futuros no se crean en esta tarea.

Antes de automatizar, acordar revisión base de comparación, registro de migrations desplegadas y criterios de recuperación. El repo por sí solo no demuestra paridad remota. El siguiente paso es aprobar el manifiesto de bootstrap 0B: estructuras ordenadas, semillas globales separadas, verificadores y exclusión de datos/operaciones DEV; luego ensayarlo en Supabase desechable, sin tocar DEV remoto.
