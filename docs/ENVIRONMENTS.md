# Ambientes

## Propósito

Este documento define los ambientes operativos de Coffeecito, sus fronteras y la configuración que pertenece a cada uno.

No contiene secretos ni valores sensibles. Los project refs, project IDs, nombres de proyectos y URLs públicas identifican servicios, pero no otorgan acceso privilegiado.

Los estados se distinguen así:

- **Confirmado en repo:** demostrado por código o configuración versionada.
- **Confirmado operativamente:** comprobado en el servicio externo correspondiente.
- **Pendiente:** todavía no configurado o no comprobado.

## Principios

- Existe un único repositorio GitHub y la rama productiva aprobada es `main`.
- DEV y PROD nunca comparten proyecto Supabase ni configuración OAuth Google.
- DEV no se convierte físicamente en PROD.
- Los datos, usuarios, allowlists, cuentas conectadas, secrets y configuración externa pertenecen al ambiente.
- Un build Next.js pertenece al ambiente cuyas variables públicas se usaron al construirlo.
- Preview Deployments no son un ambiente soportado y nunca deben recibir credenciales PROD.
- Google login y Google Connected Account son intents distintos.
- Turnstile protege únicamente el fallback passwordless por email.
- Los cambios persistentes de PROD siguen `PROD_CONTRACTS.md`.

## Repositorio y promoción

Confirmado operativamente:

- GitHub: `sahudson-prog/crm-networking-cloud`.
- Rama productiva aprobada: `main`.
- Desarrollo: branches y pull requests hacia `main`.
- No existe un repositorio DEV separado.

Confirmado en repo:

- Runtime web: `cloud/web`.
- Runtime de datos: `cloud/supabase`.
- No hay workflows CI/CD versionados.

Un merge en Git no demuestra por sí solo que una revisión esté desplegada. El despliegue y sus smoke tests son operaciones del ambiente.

## Runtime local

La aplicación se ejecuta normalmente desde `cloud/web`:

```powershell
cd cloud\web
npm install
Copy-Item .env.example .env.local
npm run dev
```

La URL habitual es `http://localhost:3000`. El runtime requiere Node `22.x`.

`.env.local` no se versiona. Puede apuntar accidentalmente a PROD; antes de iniciar la aplicación, quien desarrolla debe comprobar que sus variables usan exclusivamente servicios DEV.

`abrir_app_cloud.bat` prepara una copia local fuera de OneDrive y ejecuta el mismo runtime. No constituye un ambiente independiente.

## Supabase local desechable

La baseline puede ensayarse sobre una instancia local y desechable mediante `cloud/supabase/README.md`.

Este entorno sirve para probar bootstrap, migrations y verificadores. No sustituye a DEV, no debe contener datos personales DEV o PROD y no debe usar credenciales remotas por inferencia.

No existe un `supabase/config.toml` versionado en este repositorio.

## DEV

### Runtime y hosting

Confirmado operativamente:

- Runtime web: local.
- URL habitual: `http://localhost:3000`.
- No existe Vercel DEV permanente.
- No existe dominio DEV administrado por Cloudflare/NIC.cl.

Si en el futuro existe Vercel DEV, deberá consumir exclusivamente servicios DEV.

### Supabase DEV

Confirmado operativamente:

- Project name: `crm-networking-dev`.
- Project ref: `wwlbxrdnrojqkhdxkzdx`.
- URL: `https://wwlbxrdnrojqkhdxkzdx.supabase.co`.

El runtime local debe usar la URL y publishable key de este proyecto. Sus datos, usuarios, Auth, allowlist, roles y cuentas conectadas son independientes de PROD.

### Google DEV

Confirmado operativamente:

- Google Cloud project ID: `crm-networking-dev`.
- OAuth client: `Coffeecito DEV Web`.
- Authorized JavaScript origin: `http://localhost:3000`.
- Google callback: `https://wwlbxrdnrojqkhdxkzdx.supabase.co/auth/v1/callback`.
- El Client ID configurado en Supabase DEV coincide con el client DEV.
- El callback PKCE `http://localhost:3000/auth/callback` está autorizado y Google login PKCE fue probado con sesión persistente y URL limpia.

Pendiente:

- confirmar la disponibilidad local de `SUPABASE_SERVICE_ROLE_KEY` y `GOOGLE_OAUTH_CLIENT_ID` para finalizar Google Connected Account.

### Turnstile DEV

Confirmado operativamente:

- Turnstile no se configura en DEV por ahora.
- Google login DEV no depende de Turnstile.

Sin `NEXT_PUBLIC_TURNSTILE_SITE_KEY`, el fallback por email queda deshabilitado explícitamente. No debe implementarse un bypass silencioso para simular CAPTCHA.

## PROD

### Hosting, dominio y DNS

Confirmado operativamente:

- Vercel project: `coffeecito-prod`.
- Root Directory: `cloud/web`.
- Production Branch: `main`.
- Dominio canónico: `https://coffeecito.cl`.
- `https://www.coffeecito.cl` redirige a `https://coffeecito.cl`.
- Dominio y HTTPS: operativos.
- NIC.cl es el registrador y Cloudflare administra DNS de `coffeecito.cl`.

Las variables públicas Supabase de Vercel están scoped solamente a Production. Preview Deployments no son un ambiente funcional soportado y no deben recibir variables ni secrets PROD.

### Supabase PROD

Confirmado operativamente:

- Project name: `coffeecito-prod`.
- Project ref: `ppowxoglqspwvsgyxlft`.
- URL: `https://ppowxoglqspwvsgyxlft.supabase.co`.
- Región: `sa-east-1`.
- Auth Site URL: `https://coffeecito.cl`.
- Before User Created Hook: habilitado.
- La baseline fue aplicada y pasaron `verify_structure`, `verify_access`, `verify_google` y `verify_reset_merge`.

La baseline inicial no debe ejecutarse nuevamente sobre este proyecto. Las evoluciones posteriores se agregan como migrations incrementales.

El callback PKCE `https://coffeecito.cl/auth/callback` está autorizado en Supabase PROD y Google login fue probado end-to-end.

### Google PROD

Confirmado operativamente:

- Google Cloud project ID: `coffeecito-prod`.
- OAuth client: `Coffeecito PROD Web`.
- Authorized JavaScript origin: `https://coffeecito.cl`.
- Google callback: `https://ppowxoglqspwvsgyxlft.supabase.co/auth/v1/callback`.
- Audience: `External`.
- Publishing status: `Testing`.
- Existe al menos un test user operativo.
- Supabase Google Provider usa el OAuth client del proyecto PROD.
- People API, Gmail API y Google Calendar API están habilitadas.

El código solicita los scopes de identidad mediante los aliases `openid email profile`. Google Auth Platform puede mostrarlos canónicamente como:

- `openid`;
- `https://www.googleapis.com/auth/userinfo.email`;
- `https://www.googleapis.com/auth/userinfo.profile`.

Son los mismos permisos de identidad, no dos configuraciones distintas.

Los scopes de datos son:

- `https://www.googleapis.com/auth/contacts.readonly`;
- `https://www.googleapis.com/auth/gmail.readonly`;
- `https://www.googleapis.com/auth/calendar.readonly`.

Mientras Google permanezca en modo Testing, el acceso está limitado por su configuración y test users autorizados. Todo usuario beta que use Google debe estar autorizado también como Google test user, además de cumplir la allowlist de Coffeecito.

### Google login y Google Connected Account PROD

Google login se ejecuta mediante Supabase Auth con los scopes mínimos de identidad. No depende de Turnstile ni equivale a autorizar Contacts, Gmail o Calendar.

Google Connected Account solicita consentimiento separado para datos y se finaliza mediante `/api/google/connected-account/finalize`.

Todos los ingresos Supabase Auth usan PKCE y regresan primero a `/auth/callback`. El callback intercambia el código mediante el SDK, limpia la URL y recién después vuelve al destino interno. Los callbacks de Google Cloud hacia Supabase permanecen en `/auth/v1/callback`; no son la misma URL que el retorno final de Supabase hacia la aplicación.

Confirmado operativamente:

- `SUPABASE_SERVICE_ROLE_KEY` y `GOOGLE_OAUTH_CLIENT_ID` están configuradas en Vercel Production.
- Google Connected Account fue probado end-to-end.
- Contacts, Gmail y Calendar fueron probados con preview y aplicación de cambios.

`GOOGLE_OAUTH_CLIENT_ID` debe corresponder exactamente al OAuth client PROD usado por Supabase y Google.

### Turnstile y acceso por email PROD

Confirmado operativamente:

- Turnstile PROD está configurado y operativo.
- `NEXT_PUBLIC_TURNSTILE_SITE_KEY` está configurada en Vercel Production.
- CAPTCHA Turnstile está configurado en Supabase Auth.
- Magic link/email fue probado end-to-end.

Turnstile protege exclusivamente `signInWithOtp`. Google login no depende de Turnstile.

La site key pública se configura en Vercel Production y el secret se configura en Supabase Auth. El secret nunca se almacena en Git ni usa prefijo `NEXT_PUBLIC_`.

## Variables por ambiente

### Públicas del runtime web

- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`, alternativa de compatibilidad
- `NEXT_PUBLIC_TURNSTILE_SITE_KEY`

Las variables `NEXT_PUBLIC_*` son visibles al navegador. No son secrets, pero una combinación DEV/PROD incorrecta puede conectar un build al ambiente equivocado.

### Server-only

- `SUPABASE_SERVICE_ROLE_KEY`
- `GOOGLE_OAUTH_CLIENT_ID`

`SUPABASE_SERVICE_ROLE_KEY` es secreto y nunca debe exponerse al cliente. El OAuth Client ID no es un secreto, pero este runtime lo mantiene server-only para validar la audiencia del token Google.

OAuth Client Secrets, Turnstile secrets, connection strings, contraseñas y tokens no se almacenan en el repositorio.

### Operacionales de base de datos

- `COFFEECITO_BOOTSTRAP_DATABASE_URL`
- `COFFEECITO_ALLOW_EMPTY_DB_BOOTSTRAP`

Estas variables pertenecen al harness de bootstrap, no al runtime web ni a Vercel. La URL de conexión contiene credenciales y es sensible.

## Preview y staging

No existe actualmente un ambiente staging.

Preview Deployments no son un ambiente soportado. No deben recibir variables públicas, secrets ni credenciales PROD, y no deben usarse como una ruta funcional hacia Supabase, Google o Turnstile hasta que exista una política explícita de aislamiento.

## Fronteras entre ambientes

Antes de ejecutar o desplegar, comprobar en conjunto:

- revisión Git;
- URL web;
- proyecto Supabase;
- publishable key y service role del mismo proyecto;
- Site URL y redirect allowlist;
- OAuth client Google y callback hacia el Supabase correcto;
- `GOOGLE_OAUTH_CLIENT_ID` coherente con la audiencia esperada;
- site key y secret Turnstile del mismo ambiente;
- ausencia de credenciales PROD en DEV y Preview.

Una URL pública correcta no compensa una key, secret, OAuth client o redirect perteneciente a otro ambiente.

## Nomenclatura

El nombre visible del producto es `Coffeecito`.

Persisten identificadores técnicos `CRM Networking`:

- repositorio: `crm-networking-cloud`;
- Supabase DEV: `crm-networking-dev`;
- Google Cloud DEV: `crm-networking-dev`.

Estos nombres no deben reemplazarse masivamente si forman parte de rutas, storage keys, paquetes o contratos persistentes. Para nuevas superficies operativas debe preferirse `Coffeecito`, salvo que se nombre un identificador técnico existente.

## Fuentes relacionadas

- `PROD_CONTRACTS.md`
- `ARCHITECTURE.md`
- `SECURITY_ACCESS.md`
- `connectors/GOOGLE.md`
- `cloud/web/README.md`
- `cloud/supabase/README.md`
