# CRM Networking Cloud Web

Runtime web activo de CRM Networking.

## Stack

- Next.js / React / TypeScript.
- Supabase/Postgres.
- Google como proveedor conectado para lectura e importación/sincronización.

## Configuración local

1. Copiar `.env.example` a `.env.local`.
2. Completar:
   - `NEXT_PUBLIC_SUPABASE_URL`
   - `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`
   - `NEXT_PUBLIC_TURNSTILE_SITE_KEY`, solo si se habilita el fallback por email
3. Instalar dependencias:

```powershell
npm install
```

4. Ejecutar en desarrollo:

```powershell
npm run dev
```

La app abre normalmente en `http://localhost:3000`.

También puedes usar el acceso de la raíz del proyecto:

```text
abrir_app_cloud.bat
```

## Variables para runtime y despliegue

Variables públicas:

- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`, alternativa de compatibilidad
- `NEXT_PUBLIC_TURNSTILE_SITE_KEY`, requerida para habilitar el fallback por email

Variables server-only de Google Connected Account:

- `SUPABASE_SERVICE_ROLE_KEY`
- `GOOGLE_OAUTH_CLIENT_ID`

No subir claves secretas, connection strings, contraseñas ni exports con datos personales. La separación DEV/PROD, los servicios externos y el alcance de cada variable se documentan en [ENVIRONMENTS.md](../../docs/ENVIRONMENTS.md).

## Comandos disponibles

```powershell
npm run typecheck
npm run build
npm run start
npm run test:kpis
npm run test:rules
npm run test:headhunter-master
npm run test:logs
npm run test:google-adapter
npm run test:sync
```

El detalle de cobertura y gaps vive en `docs/TESTING.md`.

## Documentación relacionada

- `docs/README.md`: mapa de documentación vigente.
- `docs/ARCHITECTURE.md`: arquitectura del runtime cloud.
- `docs/DATA_MODEL.md`: modelo de datos.
- `docs/INGESTION_SYNC.md`: importación y sincronización.
- `docs/connectors/GOOGLE.md`: conector Google.
