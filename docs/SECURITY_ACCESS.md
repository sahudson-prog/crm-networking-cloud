# Seguridad y acceso

## Propósito

Este documento describe cómo funcionan hoy autenticación, autorización y aislamiento de datos en la aplicación cloud de CRM Networking.

La fuente de verdad operacional es el schema de Supabase, sus policies RLS, las funciones SQL de autorización y los helpers de sesión/capabilities del frontend. Este documento no define privacidad regulatoria, contratos de acciones ni arquitectura general.

## Modelo actual

La aplicación usa Supabase Auth y Supabase/Postgres como frontera principal de identidad y datos. El frontend crea un cliente Supabase con variables públicas `NEXT_PUBLIC_SUPABASE_URL` y `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` o `NEXT_PUBLIC_SUPABASE_ANON_KEY`.

La separación DEV/PROD de proyectos, redirects, variables y servicios externos se documenta en [ENVIRONMENTS.md](ENVIRONMENTS.md).

El runtime web normal opera con la sesión Supabase del usuario y con RLS en base de datos. La excepción vigente es una ruta Next server-side mínima para finalizar Google Connected Account; esa frontera usa service role solo del lado servidor después de validar sesión, acceso efectivo y evidencia OAuth.

El usuario propietario de datos se identifica con `auth.uid()`. En la app, ese identificador corresponde a `profiles.id` y a la columna `user_id` en la mayoría de tablas de datos del usuario.

No existe un tenant formal separado. El aislamiento multiusuario actual se basa principalmente en `user_id`, RLS, filtros explícitos desde el código y algunas funciones RPC que vuelven a consultar `auth.uid()`.

## Autenticación

La entrada visible principal usa Supabase Auth con Google login (`signInWithOAuth`) y scopes mínimos de identidad: `openid`, `email` y `profile`. El magic link por correo (`signInWithOtp`) se conserva como alternativa técnica. Ambos usan PKCE y regresan a `/auth/callback`, donde el SDK intercambia el código, persiste la sesión y elimina el código de la URL antes de entrar a la app. Cuando CAPTCHA está habilitado, las solicitudes de magic link se protegen con Cloudflare Turnstile y el token se envía a Supabase Auth para validación nativa. `AuthGate` lee la sesión con `supabase.auth.getSession()` y escucha cambios con `onAuthStateChange()`.

Turnstile protege la solicitud passwordless contra abuso automatizado, pero no reemplaza la elegibilidad de beta cerrada. La allowlist y el acceso efectivo siguen resolviéndose en Supabase/Auth Hook/RPC, sin consulta de allowlist desde el formulario.

Después de confirmar sesión, `AuthGate` consulta `current_user_app_access_status()` y solo muestra la app si la RPC devuelve acceso permitido. Si no hay sesión, conserva la pantalla de entrada. Si el acceso es denegado, muestra una pantalla de Coffeecito por invitación con opción de cerrar sesión. Si la RPC falla, no asume acceso y muestra un error recuperable con reintento y cierre de sesión.

La relación entre usuario Auth y datos de aplicación se materializa en `profiles`. La migración de acceso agrega `handle_new_auth_user_profile`, un trigger `SECURITY DEFINER` sobre `auth.users` que crea o actualiza `profiles`.

La beta cerrada incorpora `app_access_allowlist`, una allowlist por email normalizado que existe antes del signup y no modela roles, planes ni capabilities. El Before User Created Auth Hook preparado en SQL permite bloquear altas no autorizadas antes de que exista `auth.users`, una vez configurado en Supabase.

El trigger de creación de perfil queda fail-closed: si el email está autorizado en allowlist, crea o actualiza `user_access_profiles` como `active`/`approved` y asigna el rol base `user`; si no está autorizado, crea perfil y access profile pendiente, sin aprobar acceso efectivo ni asignar rol base automático.

La Cuenta conectada Google es otra cosa. Se registra en `connected_accounts` y sirve para lectura/importación/sincronización de datos del proveedor. Login Google no equivale a cuenta conectada para datos; conectar Google tampoco equivale por sí solo a tener permisos internos de la app. Las operaciones relevantes siguen validando sesión, RLS y/o capabilities.

La finalización de esa cuenta conectada no acepta desde el navegador `user_id`, email externo, scopes efectivos, capabilities ni status. El navegador solo entrega el `provider_token` temporal y el access token Supabase de sesión. La ruta server-side valida el JWT con Supabase Auth, verifica acceso efectivo de Coffeecito, consulta Google UserInfo y tokeninfo, y recién entonces persiste por RPC interna con service role.

## Aislamiento por usuario y RLS

El patrón predominante de RLS es ownership por usuario:

- `profiles`: `auth.uid() = id`;
- tablas de configuración, contactos, métodos de contacto, snapshots externos, interacciones, participantes, referidos, objetivos, ToDos, cursores, logs, métricas y uso: `auth.uid() = user_id`.

Para la beta cerrada, ese ownership debe combinarse con `current_user_has_app_access()`. Así, un usuario revocado o no autorizado no puede operar sobre datos app-owned aunque conserve una sesión Supabase válida y aunque el `user_id` coincida.

Ese patrón aparece en tablas app-owned como `contacts`, `contact_emails`, `contact_phones`, `interactions`, `interaction_participants`, `external_contact_ids`, `external_contact_snapshots`, `external_interaction_sources`, `referrals`, `todos`, `todo_configs`, `sync_cursors`, `sync_run_logs`, `audit_log`, `metric_snapshots`, `usage_events`, `usage_limits`, `objectives`, `contact_objective_assignments` y `object_review_state`.

Además de RLS, el código suele filtrar explícitamente por `user_id` al leer o escribir. Esto no reemplaza RLS; opera como defensa adicional y como forma de construir consultas específicas.

Las excepciones relevantes son catálogos y datos administrativos:

- `service_connectors` es legible si `enabled = true`;
- `headhunter_companies` y `headhunter_company_domains` son catálogos globales legibles por usuarios autenticados cuando están activos;
- las escrituras del maestro headhunter quedan restringidas por capability `admin.manage_global_masters`;
- catálogos de acceso como roles, planes y capabilities son legibles, pero administrables solo con `admin.manage_access`;
- perfiles de acceso, roles de usuario, overrides, organizaciones y patrocinios combinan visibilidad de propietario con visibilidad/gestión administrativa.

## Roles, planes y capabilities

El modelo efectivo no es RBAC clásico puro. Es un modelo centrado en capabilities, alimentado por tres fuentes:

- roles asignados al usuario;
- plan vigente del usuario;
- overrides directos por usuario.

La función SQL `current_user_has_capability(p_capability_code)` decide si el usuario actual tiene una capacidad. Usa `auth.uid()`, considera `user_capability_overrides`, `user_role_assignments`, `app_role_capabilities`, `user_access_profiles`, `subscription_plans` y `subscription_plan_capabilities`.

En la beta cerrada, `current_user_has_capability` devuelve `false` si `current_user_has_app_access()` no permite acceso efectivo.

La regla efectiva observada es:

- debe existir usuario autenticado;
- debe existir acceso efectivo a Coffeecito;
- un override `deny` activo bloquea la capacidad;
- un override `grant` o `limit` activo puede concederla;
- un rol activo puede concederla;
- un plan activo puede concederla si la cuenta está `active` y la beta `approved`.

La RPC mínima `current_user_app_access_status()` devuelve solo `allowed` y `reason` para el usuario actual. `AuthGate` usa esa decisión efectiva sin consultar manualmente allowlist, profiles, roles, planes o capabilities. La razón puede servir para diagnóstico interno, pero no se expone como detalle técnico al usuario final.

En el frontend, `checkCurrentUserCapability` llama a `current_user_has_capability` y `requireCurrentUserCapability` detiene operaciones cuando la capacidad falta. Las capacidades tipadas en código incluyen administración, importación Google, gestión de contactos, uso/automatización de Coach, exportación y borrado/reset de datos. La navegación y las rutas de Sistema resuelven las capacidades administrativas efectivas, sin depender de nombres de roles: diagnóstico protege Guía y Logs, administración de acceso protege Mantención y administración de maestros protege HeadHunter. Cuenta permanece disponible para todo usuario con acceso efectivo a la aplicación.

La administración de acceso beta se realiza mediante RPCs estrechas, no como CRUD genérico desde la UI. Las operaciones administrativas verifican `admin.manage_access` en SQL, usan `SECURITY DEFINER` con `search_path` fijo cuando necesitan consultar `auth.users`, y no exponen metadata Auth completa, tokens, identidades crudas ni datos de contraseña.

Las operaciones disponibles son listar allowlist con estado seguro, autorizar o reautorizar un email, revocar autorización y diagnosticar acceso de un usuario registrado. Autorizar un email no crea `auth.users`. Revocar no borra usuario, datos, roles ni cuentas conectadas; el bloqueo ocurre porque la decisión central de acceso deja de permitir entrada.

Cuando un usuario ya registrado quedó solamente en el estado inicial `beta_pending`/`pending`, autorizarlo desde Mantención puede promoverlo a `active`/`approved` y asegurar el rol base `user`. La operación no reactiva estados administrativos más fuertes, como cuenta `closed` o beta `blocked`.

## Autorización de operaciones

La autorización está distribuida.

Algunas operaciones hacen check explícito de capability antes de actuar:

- importar o actualizar contactos Google: `contacts.import_google`;
- importar o actualizar interacciones Google: `interactions.import_google`;
- administrar accesos: `admin.manage_access`;
- administrar maestro de empresas headhunter: `admin.manage_global_masters`;
- reiniciar datos propios: `data.delete_account`.

Otras operaciones dependen principalmente de sesión, filtros `user_id` y RLS. Esto incluye muchas lecturas y escrituras de contactos, interacciones, referidos, objetivos, sugerencias y logs.

Las rutas de Sistema usan `AuthGate` y un guard frontend compartido que falla cerrado antes de montar su contenido privado. Este guard controla navegación y montaje de vistas, pero no sustituye el enforcement backend. El enforcement backend depende del contrato de autorización de cada operación, que puede combinar RPC, RLS, policies y checks explícitos de capability.

## Operaciones privilegiadas

El runtime web normal usa cliente Supabase público y RLS. La excepción acotada vigente es la ruta server-side de finalización Google Connected Account, que requiere `SUPABASE_SERVICE_ROLE_KEY` solo del lado servidor y no lo expone al browser.

Sí existen funciones SQL con `SECURITY DEFINER`:

- `handle_new_auth_user_profile`, para crear perfil, perfil de acceso y rol base al crearse un usuario Auth;
- `current_user_has_capability`, para consultar capacidades desde tablas de acceso y ser usada por frontend y policies;
- funciones de validación de storage/sync y maestro headhunter, orientadas a diagnóstico de estructura.

`reset_current_user_app_data_v0_1` y `merge_contacts_deep` son funciones `SECURITY DEFINER` estrechas: exigen `auth.uid()`, verifican la capability correspondiente y limitan cada operación al `user_id` autenticado. Su owner esperado es `postgres`, los roles cliente no pueden alterarlas y solo `authenticated` recibe `EXECUTE`.

El bootstrap del primer `system_admin` está en SQL manual. Requiere ejecución controlada desde Supabase o un contexto con privilegios suficientes; no existe ruta de auto-promoción admin desde la app.

## Google y credenciales externas

Google login y Google Connected Account son intents distintos. El login autentica identidad con scopes mínimos y no registra una fila de `connected_accounts`.

La integración Google para datos usa el `provider_token` de la sesión Supabase para llamar APIs de Google desde el runtime actual, pero solo si existe una cuenta conectada activa y el token actual fue aceptado por la finalización server-side de datos. Los scopes recordados en `sessionStorage` son solo intención temporal de OAuth; no se persisten como permisos concedidos.

`connected_accounts` mantiene SELECT para que el usuario vea su conexión, pero la escritura directa de INSERT/UPDATE/DELETE desde roles cliente queda cerrada. La creación o actualización de Google Connected Account ocurre mediante una RPC interna invocable solo por `service_role`; la desvinculación self-service ocurre mediante una RPC estrecha para usuarios autenticados.

La tabla tiene una columna `oauth_refresh_token_encrypted`, pero este flujo no escribe ni lee refresh tokens persistentes. En la práctica vigente, si no hay `provider_token` utilizable o si el token actual no corresponde a una autorización de datos verificada, la UI pide reconectar Google.

Los scopes, APIs y detalles propios del conector pertenecen a `docs/connectors/GOOGLE.md`.

## Datos sensibles y configuración

La configuración pública del frontend usa variables `NEXT_PUBLIC_*`. Las variables con ese prefijo son visibles al cliente por diseño y no constituyen un mecanismo para custodiar secretos con privilegios elevados.

La ruta server-side de finalización Google requiere variables server-only para service role y Google OAuth Client ID. Esos valores no deben exponerse al browser, no deben escribirse en variables `NEXT_PUBLIC_*` y no deben agregarse al repositorio.

Los datos app-owned persistidos se aíslan principalmente mediante RLS y ownership por usuario. El token Google efectivo usado por el runtime vive en la sesión Supabase del cliente y no depende de RLS. La política regulatoria de consentimiento, finalidad, retención, exportación y eliminación pertenece a `PRIVACY_COMPLIANCE.md`.

## Límites actuales

La autorización no está centralizada en una sola capa. Combina RLS, checks explícitos de capability, filtros `user_id`, RPCs y gating de componentes.

El modelo de roles, planes y capabilities existe, pero la app no aplica capabilities de forma uniforme a todas las operaciones de negocio.

La foundation de allowlist y el enforcement de acceso se preparan en dos pasos para evitar lockout: primero se instala la allowlist y el hook preparado; luego, tras autorizar al admin existente, se activa `current_user_has_app_access()`, capabilities fail-closed, trigger fail-closed y RLS reforzado.

No hay backend privilegiado general para encapsular todas las operaciones sensibles. La excepción implementada es la finalización Google Connected Account verificada, acotada a ese flujo.

Las organizations y sponsorships existen en schema, pero no se observa que otorguen acceso automático a datos privados de otros usuarios.

Algunas tablas históricas o de migración pueden existir fuera del runtime normal. Este documento se enfoca en fronteras vigentes de la aplicación cloud.
