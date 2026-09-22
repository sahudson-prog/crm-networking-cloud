# Documentación

Este directorio contiene las fuentes de verdad especializadas de CRM Networking. La aplicación activa vive en `cloud/web`; el schema, migraciones y verificadores SQL viven en `cloud/supabase`.

Usa esta guía como mapa rápido. No es necesario leer todos los documentos para cada cambio: consulta solo el documento relacionado con la tarea y contrasta siempre con código, schema, tests y configuración actuales.

## Fuentes principales

- `PRODUCT.md`: alcance funcional vigente, experiencia de usuario y límites del producto.
- `DOMAIN_MODEL.md`: conceptos de negocio, vocabulario canónico e invariantes de dominio.
- `ARCHITECTURE.md`: runtime activo, capas, boundaries y responsabilidades técnicas.
- `DATA_MODEL.md`: modelo de datos vigente, ownership, entidades y relaciones.
- `INGESTION_SYNC.md`: importación, sincronización, previews, cursores, snapshots y errores.
- `connectors/GOOGLE.md`: particularidades del proveedor Google.
- `ACTIONS.md`: modelo vigente de acciones internas, ejecución, confirmación y trazabilidad.
- `COACH_RULES.md`: reglas Coach vigentes, prelación, gatilladores y límites.
- `SECURITY_ACCESS.md`: autenticación, RLS, roles, planes, capabilities y operaciones privilegiadas.
- `ENVIRONMENTS.md`: ambientes, despliegue, servicios externos y configuración por ambiente.
- `PRIVACY_COMPLIANCE.md`: privacidad, datos personales, controles del usuario, minimización y límites de cumplimiento.
- `UI_SYSTEM.md`: sistema visual, componentes, patrones de UI y responsive.
- `TESTING.md`: herramientas reales de validación, cobertura observada y gaps.

## Planificación

- `planning/NOW.md`: foco activo y trabajo inmediato.
- `planning/BACKLOG.md`: pendientes vigentes priorizables.

La planificación no debe duplicar diseño técnico. Cuando un item requiera detalle, debe apuntar al documento especializado correspondiente.

## Herramientas legacy

Las herramientas en `tools/legacy_migration/` son utilidades aisladas para una eventual migración de datos históricos. No son parte del runtime activo ni definen arquitectura vigente.
