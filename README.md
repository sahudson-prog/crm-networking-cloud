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

## Estructura del repositorio

- `cloud/web/`: aplicación web cloud.
- `cloud/supabase/`: schema, migraciones y verificaciones Supabase/Postgres.
- `docs/`: documentación especializada del producto, arquitectura, datos, UI, QA, privacidad y plan.
- `tools/dev_maintenance/`: utilidades de mantenimiento del ambiente de desarrollo.
- `tools/legacy_migration/`: herramientas aisladas para migraciones legacy hacia el modelo cloud.

## Documentación

- `AGENTS.md`: reglas de trabajo para Codex en este repositorio.
- `cloud/web/README.md`: configuración local y alcance técnico de la app cloud.
- `docs/PRODUCT_DETAIL_AND_VISION.md`: producto, experiencia y visión.
- `docs/CURRENT_PLAN.md`: plan vigente de trabajo.
- `docs/BACKLOG.md`: pendientes e ideas priorizables.
- `docs/ARCHITECTURE_CURRENT.md`: arquitectura e inventario técnico actual.
- `docs/CURRENT_DATA_MODEL.md`: modelo de datos actual.
- `docs/DATA_MODEL_BLUEPRINT.md`: diseño de datos objetivo.
- `docs/RULES_MASTER.md`: reglas de Coach y lógicas de negocio.
- `docs/UI_STYLE_GUIDE.md`: guía visual y componentes reutilizables.
- `docs/QA_CHECKLIST.md`: validaciones funcionales y técnicas.
- `docs/PRIVACY_SECURITY_COMPLIANCE.md`: privacidad, seguridad y cumplimiento.
- `docs/OPERATING_MODEL.md`: uso y mantenimiento de la documentación.
