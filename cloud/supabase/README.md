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

## Fuera del bootstrap automático

Después del bootstrap se configuran manualmente: primer email PROD en allowlist, primer `system_admin`, Before User Created Hook, Site URL y redirects, Google OAuth, Turnstile, SMTP y secretos. Tampoco se migran automáticamente usuarios ni datos personales.

Los SQL históricos que permanecen junto a estas carpetas son fuentes auditables u operaciones específicas; no forman parte de esta cadena consolidada salvo que este README lo indique expresamente.
