# CRM Networking

Web app en Streamlit para administrar networking durante una busqueda laboral.

## Estado actual

La aplicacion principal vive en `app.py`. Integra Google Contacts, Google Sheets, Gmail y Google Calendar para mantener un CRM personal con contactos, estados, interacciones, relaciones/referidos, empresas headhunter y sugerencias de accion.

El resumen entregado por herramientas externas se usa solo como contexto inicial. La fuente confiable para continuar el desarrollo es el codigo actual, la planilla conectada y el comportamiento real de Streamlit.

## Ejecucion local

```powershell
cd "C:\Users\Sergio\OneDrive\Documentos\CRM Networking"
.\venv\Scripts\activate
streamlit run app.py
```

## Instalacion

```powershell
python -m venv venv
venv\Scripts\python.exe -m pip install -r requirements.txt
```

## Verificacion minima

```powershell
venv\Scripts\python.exe -m py_compile app.py
```

La verificacion funcional completa requiere ejecutar Streamlit con credenciales Google validas y acceso a la planilla.

## Archivos locales sensibles

Estos archivos deben existir localmente para usar las integraciones de Google, pero no deben subirse ni compartirse:

- `credentials.json`
- `token.json`

## Documentacion del proyecto

La documentacion se mantiene minima y con proposito claro.

Documentos vivos:

- `AGENTS.md`: reglas de trabajo para Codex.
- `docs/PRODUCT_DETAIL_AND_VISION.md`: detalle de producto, experiencia y vision futura.
- `docs/BACKLOG.md`: ideas y pendientes en formato priorizable.
- `docs/CURRENT_PLAN.md`: plan de trabajo actual conectado al backlog.
- `docs/OPERATING_MODEL.md`: como se usan y mantienen los documentos.
- `docs/QA_CHECKLIST.md`: checklist de validacion.

Documentos de referencia que solo se actualizan cuando cambia la arquitectura o el modelo:

- `docs/ARCHITECTURE_CURRENT.md`: arquitectura actual e inventario de funciones.
- `docs/CURRENT_DATA_MODEL.md`: modelo de datos actual en Google Sheets.
- `docs/DATA_MODEL_BLUEPRINT.md`: blueprint futuro de datos para Postgres.

## Piezas principales

- `app.py`: aplicacion Streamlit completa.
- `tools/`: scripts auxiliares de respaldo/migracion.
- `backups/`: respaldos locales creados antes de cambios relevantes.
- `Planificacion.docx`: documento inicial de planificacion.
- `CODEX_PROJECT_CONTEXT.md`: notas verificadas de contexto historico.

## Direccion tecnica

La app actual usa Google Sheets como base de datos. La direccion objetivo es una plataforma multiusuario con:

- Postgres como base principal.
- Login por usuario.
- OAuth Google por usuario.
- Importadores Google/CSV/Excel.
- Backups descargables.
- Despliegue en nube con limites de uso.
