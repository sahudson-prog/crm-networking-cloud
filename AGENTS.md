# Reglas para Codex en CRM Networking

Este archivo contiene solo instrucciones transversales para trabajar en este repositorio. No es manual de producto, arquitectura, datos, UI, QA ni planificación.

## Fuente de verdad

- La aplicación activa vive en `cloud/web`.
- El backend usa Supabase/Postgres; schema, migraciones y verificadores viven en `cloud/supabase`.
- Código, schema, migrations, tests y configuración actuales prevalecen sobre documentación desactualizada.
- La documentación especializada se consulta solo cuando es relevante para la tarea.
- La antigua app local/Streamlit no forma parte del runtime activo. Cualquier herramienta legacy debe tratarse como migración aislada, no como arquitectura vigente.

## Forma de trabajo

- Trabajar en cambios pequeños, acotados, reversibles y verificables.
- Antes de crear una función, componente, tabla, regla o flujo nuevo, revisar si ya existe algo reutilizable en el contexto directamente relacionado.
- Preferir extender, parametrizar o corregir piezas existentes antes que duplicar lógica.
- No hacer refactors amplios, limpiezas colaterales ni cambios de alcance si no son necesarios para el objetivo.
- Si una contradicción documental se resuelve contrastando código, schema, tests o configuración, continuar. Informar antes de actuar solo si persiste una ambigüedad material sobre arquitectura, datos, seguridad, permisos o una operación irreversible.

## Seguridad y efectos externos

- No exponer secretos, tokens, variables `.env`, credenciales, cuerpos de correos, minutas, teléfonos, correos personales ni datos sensibles.
- Editar código local, migrations o adaptadores puede ser parte normal de una tarea autorizada.
- Ejecutar efectos sobre sistemas remotos o datos reales requiere autorización explícita cuando no esté implícito en la tarea: migrations remotas, cambios productivos, permisos reales, OAuth real, escritura a proveedores externos u operaciones destructivas.
- Si el usuario ya autorizó explícitamente una operación, no pedir confirmación de nuevo salvo que aparezca un riesgo material no evidente.
- Antes de implementar un cambio incompatible o sensible sobre contratos persistentes, marcarlo como `PROD CONTRACT CHANGE` y presentar impacto, compatibilidad, migration, rollback y necesidad de backup/mantenimiento según `docs/PROD_CONTRACTS.md`. No incorporarlo silenciosamente a una tarea normal; requiere aprobación de ese alcance.

## Validación

- Validar proporcionalmente al riesgo y alcance del cambio.
- Ejecutar primero la validación más específica y barata relacionada con el cambio.
- Ampliar a `npm run typecheck`, tests más amplios o `npm run build` cuando el alcance o riesgo lo justifique.
- Si no se puede ejecutar una validación importante, reportarlo claramente junto con el riesgo residual.

## Git y archivos

- No revertir cambios del usuario salvo solicitud explícita.
- No usar comandos destructivos como reset, clean o borrados masivos sin autorización clara.
- Antes de editar archivos, entender el contexto cercano y mantener los cambios limitados al objetivo.
- No hacer commit, push, merge, rebase o cambio de rama salvo que el usuario lo pida explícitamente.

## Routing documental

Consulta documentación adicional solo según el tipo de tarea:

- Producto: `docs/PRODUCT.md`.
- Dominio y vocabulario: `docs/DOMAIN_MODEL.md`.
- Arquitectura: `docs/ARCHITECTURE.md`.
- Datos y schema: `docs/DATA_MODEL.md` y `cloud/supabase`.
- Importación/sincronización: `docs/INGESTION_SYNC.md`.
- Google: `docs/connectors/GOOGLE.md`.
- Acciones internas: `docs/ACTIONS.md`.
- Coach: `docs/COACH_RULES.md`.
- Auth, RLS, roles y permisos: `docs/SECURITY_ACCESS.md`.
- Compatibilidad de releases y estado persistente PROD: `docs/PROD_CONTRACTS.md`.
- Privacidad y datos personales: `docs/PRIVACY_COMPLIANCE.md`.
- UI: `docs/UI_SYSTEM.md`.
- Testing: `docs/TESTING.md`.
- Planificación: `docs/planning/NOW.md` o `docs/planning/BACKLOG.md`.
