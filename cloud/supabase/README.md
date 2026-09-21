# Supabase bootstrap

Esta carpeta contiene la baseline reproducible para crear **una sola vez** el schema inicial de Coffeecito sobre una base Supabase vacía. No debe ejecutarse sobre DEV, PROD ni otra base ya inicializada. Los cambios posteriores deben agregarse como migrations incrementales nuevas.

## Orden

1. `bootstrap/preflight_empty.sql` rechaza una base total o parcialmente inicializada.
2. `migrations/` crea, en orden, core schema, access schema, access functions, RPC de aplicación y RLS/grants finales.
3. `seeds/` carga solo catálogos globales: acceso y maestro headhunter.
4. `verifiers/` comprueba estructura, datos iniciales, RLS, grants, funciones y contratos de reset/merge.

`run_prod_bootstrap.ps1` ejecuta ese orden con `psql` y `ON_ERROR_STOP=1`. Requiere que quien opera configure en su sesión:

```powershell
$env:COFFEECITO_ALLOW_EMPTY_DB_BOOTSTRAP = 'YES'
$env:COFFEECITO_BOOTSTRAP_DATABASE_URL = '<database connection string>'
./cloud/supabase/run_prod_bootstrap.ps1
```

La URL no se guarda en el repositorio ni se pasa como argumento del proceso. Para demostrar reproducibilidad, ejecutar el mismo harness contra una segunda base Supabase local o desechable, también vacía.

La conexión debe usar el rol `postgres` del proyecto Supabase. El preflight lo exige porque las funciones `SECURITY DEFINER` quedan explícitamente bajo ese owner; los roles cliente no son propietarios y no pueden alterar esas funciones.

## Validación local con Docker

Cuando el entorno Supabase local tiene `psql` solo dentro de su contenedor PostgreSQL, el mismo harness puede enviar cada SQL por stdin con `-DockerContainer`. El nombre del contenedor debe pasarse explícitamente; el script no busca ni elige contenedores por su cuenta.

```powershell
$env:COFFEECITO_ALLOW_EMPTY_DB_BOOTSTRAP = 'YES'
./cloud/supabase/run_prod_bootstrap.ps1 -DockerContainer '<contenedor-postgres-local>'
```

Este modo es exclusivo para una base local y desechable. Ejecutar el bootstrap contra Supabase PROD remoto requiere autorización explícita y no se habilita mediante este parámetro.

## Bootstrap remoto con psql en Docker

Tras autorizar expresamente el bootstrap de una base Supabase PROD vacía, se puede usar una imagen PostgreSQL que ya exista en Docker. `-DockerPsqlImage` es incompatible con `-DockerContainer`; no descarga imágenes y conserva el mismo preflight, orden y verificación que el modo nativo. La URL se lee exclusivamente de `COFFEECITO_BOOTSTRAP_DATABASE_URL`, se entrega al contenedor como variable de entorno y no se incluye en los argumentos de `docker run`. Este modo exige SSL mediante `PGSSLMODE=require` salvo que la URL establezca explícitamente otra configuración.

```powershell
$env:COFFEECITO_BOOTSTRAP_DATABASE_URL = ConvertFrom-SecureString (Read-Host 'URL de conexion PROD con contrasena' -AsSecureString) -AsPlainText
$env:COFFEECITO_ALLOW_EMPTY_DB_BOOTSTRAP = 'YES'
try {
  ./cloud/supabase/run_prod_bootstrap.ps1 -DockerPsqlImage 'public.ecr.aws/supabase/postgres:17.6.1.167'
} finally {
  Remove-Item Env:COFFEECITO_BOOTSTRAP_DATABASE_URL, Env:COFFEECITO_ALLOW_EMPTY_DB_BOOTSTRAP -ErrorAction SilentlyContinue
}
```

La URL debe ser la cadena de conexión del Session pooler PROD ya comprobada, con usuario, contraseña y base incluidos. El preflight verifica que la base esté vacía antes de aplicar el primer SQL de Coffeecito. No ejecutar este procedimiento sobre una base inicializada.

## Fuera del bootstrap automático

Después del bootstrap se configuran manualmente: primer email PROD en allowlist, primer `system_admin`, Before User Created Hook, Site URL y redirects, Google OAuth, Turnstile, SMTP y secretos. Tampoco se migran automáticamente usuarios ni datos personales.

Los SQL históricos que permanecen junto a estas carpetas son fuentes auditables u operaciones específicas; no forman parte de esta cadena consolidada salvo que este README lo indique expresamente.
