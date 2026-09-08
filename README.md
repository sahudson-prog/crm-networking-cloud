# CRM Networking

CRM Networking es una aplicación web para gestionar contactos, objetivos, interacciones y sugerencias de seguimiento durante una búsqueda profesional.

## Aplicación actual

El único runtime activo del producto vive en `cloud/web`.

- Next.js / React / TypeScript.
- Supabase/Postgres como base de datos de la app.
- Google como proveedor conectado para lectura e importación/sincronización.

La antigua app local/Streamlit ya no forma parte del runtime activo. Las herramientas legacy que sigan en el repositorio están aisladas para migraciones puntuales, no para ejecutar el producto.

## Inicio rápido

```powershell
cd cloud\web
npm install
Copy-Item .env.example .env.local
npm run dev
```

Completa `.env.local` con las variables indicadas en `cloud/web/README.md`. La app abre normalmente en `http://localhost:3000`.

También existen accesos desde la raíz del repositorio:

- `abrir_app_cloud.bat`: abre la app cloud local.
- `validar_app_cloud.bat`: ejecuta validaciones básicas de la app cloud.

## Validación básica

Desde `cloud/web`:

```powershell
npm run typecheck
npm run build
```

Para pruebas por subsistema, consulta `docs/TESTING.md`.

## Estructura del repositorio

- `cloud/web/`: aplicación web cloud.
- `cloud/supabase/`: schema, migraciones y verificaciones Supabase/Postgres.
- `docs/`: documentación especializada vigente.
- `tools/dev_maintenance/`: utilidades de mantenimiento del ambiente de desarrollo.
- `tools/legacy_migration/`: herramientas aisladas para migraciones legacy hacia el modelo cloud.

## Documentación

- `AGENTS.md`: instrucciones transversales para Codex.
- `cloud/web/README.md`: configuración local y comandos del runtime web.
- `docs/README.md`: mapa de documentación especializada.
- `docs/planning/NOW.md`: foco activo.
- `docs/planning/BACKLOG.md`: pendientes vigentes.
