# OBS-BETA-01 - Monitoreo de beta

## Estado y autoridad

- Status: `NOT CONTRACTED / DECISION REQUIRED`.
- Este documento conserva el diseño funcional aprobado para observabilidad operativa de la beta.
- No autoriza acceso a contenido privado, nuevas tablas, cambios de permisos ni implementación.

## Decisiones funcionales aprobadas

### Superficie

- Existirá una nueva vista `/sistema/monitoreo`.
- Es independiente de Mantención.
- Su UX será minimalista y orientada a tablas y filtros.
- Tendrá pestañas: `Resumen`, `Usuarios`, `Invitaciones` e `Incidentes`.

### Filtros y detalle

- Debe permitir filtrar por fechas, cohorte, plan, roles, estados y búsqueda de usuario.
- El detalle por usuario mostrará solo conteos agregados.
- No mostrará contenido privado de contactos, interacciones, correos, citas ni otros datos personales no necesarios.

### Métricas propias

La vista puede consolidar métricas propias de Coffeecito sobre:

- registros;
- cupos;
- reservas;
- invitaciones;
- activación;
- onboarding;
- contactos;
- objetivos;
- actividad;
- errores.

### Límites de la observabilidad

- No debe replicar métricas disponibles en Supabase, Google Cloud o Vercel.
- Debe enlazar hacia esos dashboards externos cuando corresponda.
- Deben auditarse y retirarse indicadores redundantes o históricos.
- Deben preservarse los límites operativos que realmente gobiernan el runtime.
- Los permisos de consulta y administración se mantienen separados.

## Pendientes de auditoría y diseño técnico

Antes de contratar implementación deben definirse:

- qué métricas son propias de Coffeecito y cuáles deben delegarse a dashboards externos;
- fuentes, ventanas temporales, cohortes y semántica de cada métrica;
- agregaciones mínimas que impidan exponer contenido privado;
- permisos, capabilities y enforcement server-side para consulta frente a administración;
- relación con los diagnósticos y logs existentes;
- indicadores redundantes o históricos que pueden retirarse sin eliminar límites operativos reales;
- UX de filtros, paginación, empty states y enlaces externos;
- criterios de aceptación, retención, auditoría y pruebas.

## Owner docs probables al contratar

- `docs/SECURITY_ACCESS.md`
- `docs/DATA_MODEL.md`
- `docs/PRODUCT.md`
- `docs/UI_SYSTEM.md`
- `docs/INGESTION_SYNC.md` para métricas de actividad y errores de sync
