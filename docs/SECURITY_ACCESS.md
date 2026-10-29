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

Después de confirmar sesión, `AuthGate` consulta `current_user_app_access_status()` y solo continúa si la RPC devuelve acceso permitido. A continuación exige la aceptación legal vigente mediante `current_user_legal_acceptance_status_v1()` antes de montar onboarding o producto privado. Una intención marcada antes del login solo se materializa después de sesión y acceso válidos mediante `record_current_user_legal_acceptance_v1()`; si falta o falla esa evidencia, el gate queda cerrado. Si no hay sesión, conserva la pantalla de entrada. Si el acceso es denegado, muestra una pantalla de Coffeecito por invitación con opción de cerrar sesión. Si una verificación falla, no asume acceso.

La relación entre usuario Auth y datos de aplicación se materializa en `profiles`. La migración de acceso agrega `handle_new_auth_user_profile`, un trigger `SECURITY DEFINER` sobre `auth.users` que crea o actualiza `profiles`.

La beta cerrada incorpora `app_access_allowlist`, una allowlist por email normalizado que existe antes del signup y no modela roles, planes ni capabilities. INV-01 agrega una segunda fuente de admisión: una invitación `pending` vigente por email. Los dos controles globales de invitaciones se crean cerrados, por lo que instalar el schema no habilita altas nuevas. El Before User Created Auth Hook permite una identidad si pertenece a la allowlist legacy activa o, cuando el rollout lo autorice, si tiene una invitación pendiente vigente; el Hook nunca convierte la invitación.

El trigger de creación de perfil queda fail-closed: si el email está autorizado en allowlist, crea o actualiza `user_access_profiles` como `active`/`approved` y asigna el rol base `user`; si no está autorizado, crea perfil y access profile pendiente, sin aprobar acceso efectivo ni asignar rol base automático. Para una invitación, un bootstrap autenticado separado exige email verificado, deriva identidad desde `auth.uid()`, vuelve a validar vigencia, controles y bloqueos, y convierte transaccionalmente `pending` en `registered` con plan `free` y rol `user`. Una revocación legacy o un perfil `paused`, `closed` o `blocked` prevalecen; la beta legacy no se degrada. Para identidades ya registradas o allowlisted solo devuelve acceso si el perfil está `active`/`approved`; al asegurar el rol base considera `is_active`, `starts_at` y `expires_at`.

La Cuenta conectada Google es otra cosa. Se registra en `connected_accounts` y sirve para lectura/importación/sincronización de datos del proveedor. Login Google no equivale a cuenta conectada para datos; conectar Google tampoco equivale por sí solo a tener permisos internos de la app. Las operaciones relevantes siguen validando sesión, RLS y/o capabilities.

La finalización de esa cuenta conectada no acepta desde el navegador `user_id`, email externo, scopes efectivos, capabilities ni status. El navegador solo entrega el `provider_token` temporal y el access token Supabase de sesión. La ruta server-side valida el JWT con Supabase Auth, verifica acceso efectivo de Coffeecito, consulta Google UserInfo y tokeninfo, y recién entonces persiste por RPC interna con service role.

## Aislamiento por usuario y RLS

El patrón predominante de RLS es ownership por usuario:

- `profiles`: `auth.uid() = id`;
- tablas de configuración, contactos, métodos de contacto, snapshots externos, interacciones, participantes, referidos, objetivos, ToDos, cursores, logs, métricas y uso: `auth.uid() = user_id`.

Para la beta cerrada, ese ownership debe combinarse con `current_user_has_app_access()`. Así, un usuario revocado o no autorizado no puede operar sobre datos app-owned aunque conserve una sesión Supabase válida y aunque el `user_id` coincida.

Ese patrón aparece en tablas app-owned como `contacts`, `contact_emails`, `contact_phones`, `interactions`, `interaction_participants`, `external_contact_ids`, `external_contact_snapshots`, `external_interaction_sources`, `referrals`, `todos`, `todo_configs`, `sync_cursors`, `audit_log`, `metric_snapshots`, `usage_events`, `usage_limits`, `objectives`, `contact_objective_assignments` y `object_review_state`.

`sync_run_logs` aplica un contrato más estrecho: el usuario autenticado puede insertar solo filas propias mientras conserve acceso efectivo, pero no puede leerlas por ownership. La lectura requiere la capability efectiva `admin.view_diagnostics` y habilita diagnóstico transversal sobre logs de usuarios. Los clientes no reciben `UPDATE` ni `DELETE`; el reset propio conserva el borrado mediante su RPC `SECURITY DEFINER`.

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

La elegibilidad de rollout de un proveedor es una excepción deliberadamente más estrecha. Para Google, `connectors.google.use` solo puede provenir de un grant vigente de rol o plan; un override positivo no habilita el rollout y un override `deny` activo sí lo bloquea. Esta regla permite ampliar el rollout mediante catálogos sin reescribir los guards del conector.

La RPC mínima `current_user_app_access_status()` devuelve solo `allowed` y `reason` para el usuario actual. `AuthGate` usa esa decisión efectiva sin consultar manualmente allowlist, profiles, roles, planes o capabilities. La razón puede servir para diagnóstico interno, pero no se expone como detalle técnico al usuario final.

En el frontend, `checkCurrentUserCapability` llama a `current_user_has_capability` y `requireCurrentUserCapability` detiene operaciones cuando la capacidad falta. Las capacidades tipadas en código incluyen administración, importación Google, gestión de contactos, uso/automatización de Coach, exportación y borrado/reset de datos. La navegación y las rutas de Sistema resuelven las capacidades administrativas efectivas, sin depender de nombres de roles: diagnóstico protege Guía y Logs, administración de acceso protege Mantención, administración de maestros protege HeadHunter y `admin.manage_contact_requests` protege la bandeja de solicitudes. Cuenta permanece disponible para todo usuario con acceso efectivo a la aplicación.

OBJ-02 R1 no abre `UPDATE` general sobre `profiles`. `current_user_starting_point_v1()` y `save_current_user_starting_point_v1(...)` derivan identidad de `auth.uid()`, exigen acceso efectivo, no aceptan un `user_id` arbitrario y solo son ejecutables por `authenticated`. La escritura estrecha actualiza los campos propios aprobados y la clave existente `Fecha_Inicio_Networking` en una transacción; no inicia importaciones ni sync. Un trigger estrecho valida también las escrituras históricas directas sobre esa clave sin revocar los permisos necesarios para las demás preferencias. No se introduce un permiso por rol para un paso obligatorio disponible a todo usuario admitido.

La administración de acceso beta se realiza mediante RPCs estrechas, no como CRUD genérico desde la UI. Las operaciones administrativas verifican `admin.manage_access` en SQL, usan `SECURITY DEFINER` con `search_path` fijo cuando necesitan consultar `auth.users`, y no exponen metadata Auth completa, tokens, identidades crudas ni datos de contraseña.

Las invitaciones usan el mismo modelo de capabilities. `invitations.authorize` se concede a `user` y `beta_tester`; cada RPC deriva al actor desde `auth.uid()` y vuelve a comprobar acceso efectivo. Las tablas de configuración, lifecycle y eventos tienen RLS habilitado y ningún rol cliente recibe DML directo. La consulta y autorización propias, el bootstrap y las operaciones administrativas se exponen mediante RPCs estrechas; la cancelación, los controles globales, el levantamiento de bloqueos y la depuración de PII requieren `admin.manage_access`.

La evidencia legal se conserva en `legal_acceptances`, sin grants directos para roles cliente. Las RPCs de consulta y registro no reciben `user_id`, versiones ni hashes: derivan identidad desde `auth.uid()`, exigen acceso efectivo y fijan server-side el contrato legal vigente. Solo `authenticated` puede ejecutarlas.

Las operaciones disponibles son listar allowlist con estado seguro, autorizar o reautorizar un email, revocar autorización y diagnosticar acceso de un usuario registrado. Autorizar un email no crea `auth.users`. Revocar no borra usuario, datos, roles ni cuentas conectadas; el bloqueo ocurre porque la decisión central de acceso deja de permitir entrada.

Cuando un usuario ya registrado quedó solamente en el estado inicial `beta_pending`/`pending`, autorizarlo desde Mantención puede promoverlo a `active`/`approved` y asegurar el rol base `user`. La operación no reactiva estados administrativos más fuertes, como cuenta `closed` o beta `blocked`.

## Autorización de operaciones

La autorización está distribuida.

El contrato SEC-GOOGLE-01 se publica mediante un cutover `expand -> runtime -> contract`. Las reglas siguientes describen el estado objetivo versionado y no demuestran por sí solas que un ambiente haya completado las tres fases; ese estado debe verificarse durante cada release.

Algunas operaciones hacen check explícito de capability antes de actuar:

- iniciar o finalizar autorización Google de datos: rollout `connectors.google.use` y la capability operativa de cada servicio solicitado, sin exigir todavía scopes de una cuenta conectada inexistente;
- leer y persistir contactos de una cuenta conectada: `contacts.sync_external`;
- leer y persistir Gmail de una cuenta conectada: `interactions.sync_email`;
- leer y persistir Calendar de una cuenta conectada: `interactions.sync_calendar`;
- `contacts.import_google` e `interactions.import_google` permanecen temporalmente en catálogo por compatibilidad, pero no son el enforcement operativo nuevo;
- administrar accesos: `admin.manage_access`;
- administrar maestro de empresas headhunter: `admin.manage_global_masters`;
- autorizar y consultar invitaciones propias: `invitations.authorize`, además de los controles globales del programa;
- reiniciar datos propios: `data.delete_account`.

Otras operaciones dependen principalmente de sesión, filtros `user_id` y RLS. Esto incluye muchas lecturas y escrituras de contactos, interacciones, referidos, objetivos y sugerencias. En `sync_run_logs`, RLS separa el `INSERT` propio de la lectura administrativa por capability.

OBJ-02 R2-B restringe creación/configuración/cierre de ciclos y escritura de Prioridades/asociaciones a RPCs `SECURITY DEFINER` estrechas con `auth.uid()`, acceso efectivo, ownership y contexto versionado del ciclo activo (incluido `none` y la configuración legacy). Los triggers exigen ese contexto desde la instalación, bloquean mutaciones de ciclos cerrados, borrado físico ordinario de Prioridades y cambios de estado/foco desde pestañas antiguas; las ediciones globales de identidad de contactos permanecen disponibles. Las tablas de observación al cierre solo permiten SELECT al dueño con acceso efectivo. El merge autenticado usa `merge_contacts_deep_r2b`; el entry point anterior pierde EXECUTE para `authenticated`. El gate privado de rollout pasa de `paused` a `test_only` y luego a `open` mediante SQL privilegiado; las políticas de acceso efectivo también lo aplican. El reset de datos propios sigue siendo una operación separada con su capability y frase de confirmación.

El candidato local `Avísame` añade lectura `SELECT` de solicitudes propias solo con acceso efectivo. No concede DML directo a roles cliente. Las RPCs `request_networking_plan_notice_v1` y `withdraw_networking_plan_notice_v1` aceptan únicamente modalidad, derivan usuario y correo de Auth server-side, comprueban acceso efectivo y son idempotentes. La tabla de modalidades no expone lectura ni escritura a cliente; el cierre operacional es SQL privilegiado manual. El cambio aún requiere migration y verifier por ambiente antes de desplegar su UI.

Las rutas de Sistema usan `AuthGate` y un guard frontend compartido que falla cerrado antes de montar su contenido privado. Este guard controla navegación y montaje de vistas, pero no sustituye el enforcement backend. El enforcement backend depende del contrato de autorización de cada operación, que puede combinar RPC, RLS, policies y checks explícitos de capability.

## Operaciones privilegiadas

El runtime web normal usa cliente Supabase público y RLS. Las excepciones acotadas vigentes son la ruta server-side de finalización Google Connected Account y la recepción pública de solicitudes de contacto después de validar Turnstile. Ambas requieren `SUPABASE_SERVICE_ROLE_KEY` solo del lado servidor y no lo exponen al browser. La ruta de contacto valida una sesión opcional antes de asociar `user_id`; el formulario nunca envía ese identificador.

Sí existen funciones SQL con `SECURITY DEFINER`:

- `handle_new_auth_user_profile`, para crear perfil, perfil de acceso y rol base al crearse un usuario Auth;
- `current_user_has_capability`, para consultar capacidades desde tablas de acceso y ser usada por frontend y policies;
- funciones de validación de storage/sync y maestro headhunter, orientadas a diagnóstico de estructura.

`current_user_legal_acceptance_status_v1` y `record_current_user_legal_acceptance_v1` son fronteras estrechas para el gate legal. Ambas exigen `auth.uid()` y acceso efectivo; la segunda inserta de forma idempotente el contrato vigente sin aceptar identidad o versiones desde el navegador.

`reset_current_user_app_data_v0_1` y `merge_contacts_deep` son funciones `SECURITY DEFINER` estrechas: exigen `auth.uid()`, verifican la capability correspondiente y limitan cada operación al `user_id` autenticado. Su owner esperado es `postgres`, los roles cliente no pueden alterarlas y solo `authenticated` recibe `EXECUTE`.

Las RPCs INV-01 mantienen una frontera equivalente. La autorización serializa el cupo personal y la capacidad global; el bootstrap no acepta `user_id` ni email del cliente; y las acciones admin vuelven a comprobar `admin.manage_access` después de adquirir sus locks. El reset propio está disponible para el plan `free`, pero no borra invitaciones ni eventos autoritativos y no recupera cupos consumidos por registros.

El bootstrap del primer `system_admin` está en SQL manual. Requiere ejecución controlada desde Supabase o un contexto con privilegios suficientes; no existe ruta de auto-promoción admin desde la app.

## Google y credenciales externas

Google login y Google Connected Account son intents distintos. El login autentica identidad con scopes mínimos y no registra una fila de `connected_accounts`.

La integración Google para datos usa el `provider_token` de la sesión Supabase para llamar APIs de Google desde el runtime actual, pero solo si existe una cuenta conectada activa y el token actual fue aceptado por la finalización server-side de datos. Los scopes recordados en `sessionStorage` son solo intención temporal de OAuth; no se persisten como permisos concedidos.

El inicio/finalización OAuth y el uso posterior de una cuenta ya conectada son decisiones separadas. La primera exige rollout Google y la capability operativa de cada servicio solicitado, pero no scopes persistidos antes de que exista la conexión. La segunda vuelve a exigir rollout, capability operativa del servicio, ownership de la cuenta, estado activo y capability derivada del scope verificado. Una conexión que pierde elegibilidad se conserva, pero queda inoperativa.

`connected_accounts` mantiene SELECT para que el usuario vea su conexión, pero la escritura directa de INSERT/UPDATE/DELETE desde roles cliente queda cerrada. La creación o actualización de Google Connected Account ocurre mediante una RPC interna invocable solo por `service_role`; la desvinculación self-service ocurre mediante una RPC estrecha para usuarios autenticados.

La persistencia de resultados Google se realiza por RPCs `SECURITY DEFINER` estrechas que derivan usuario desde `auth.uid()`, fijan `provider='google'`, verifican cuenta y operación en cada elemento y escriben la fuente externa de forma transaccional. La fase `contract` retira INSERT/UPDATE directo de roles cliente sobre `external_contact_ids`, `external_contact_snapshots` y `external_interaction_sources`; las operaciones manuales y las importaciones locales vCard/ICS no dependen de esas capabilities Google.

Desde el forward-fix R2-B, el sync de contactos Google entra por `apply_google_contact_sync_change_r2b` con `cycle_id` esperado y token versionado, incluido `none:<último cierre>` cuando no hay ciclo. La RPC toma el bloqueo de usuario antes de delegar en el escritor Google existente; ese escritor V1 ya no tiene EXECUTE para roles cliente. El merge interno solo recibe el contexto `merge:` tras validar ownership, acceso efectivo y versión. Cada cambio seleccionado sigue siendo una transaction; un fallo no avanza el cursor del lote.

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

No hay backend privilegiado general para encapsular todas las operaciones sensibles. Las fronteras privilegiadas implementadas son flujos estrechos: finalización verificada de Google Connected Account, persistencia transaccional de resultados Google y recepción validada de solicitudes públicas de contacto.

Las organizations y sponsorships existen en schema, pero no se observa que otorguen acceso automático a datos privados de otros usuarios.

Algunas tablas históricas o de migración pueden existir fuera del runtime normal. Este documento se enfoca en fronteras vigentes de la aplicación cloud.
