# Backlog

Este backlog conserva solo trabajo pendiente vigente. No es una fuente de verdad técnica: cada item debe apoyarse en el documento especializado correspondiente cuando se diseñe o implemente.

## Producto y experiencia

- Completar la vista de objetivos con métricas accionables por objetivo: contactos asociados, cafés, última actividad, prioridad y filtros. Referencia: `docs/PRODUCT.md`, `docs/DOMAIN_MODEL.md`, `docs/DATA_MODEL.md`.
- Definir la experiencia final para gestión de duplicados locales y merge manual de contactos. Referencia: `docs/INGESTION_SYNC.md`, `docs/ACTIONS.md`.

## Sincronización e importación

- Separar claramente importación inicial, actualización incremental global y actualización por contacto en UI y documentación operativa.
- Robustecer diagnósticos de Gmail/Calendar cuando no aparecen interacciones esperadas.

## Coach y acciones

- Agrupar sugerencias repetitivas por tipo para reducir ruido visual sin perder detalle individual.
- Revisar automatización futura de reglas por plan/capability.

## Seguridad y cuentas

- Probar el modelo multiusuario con más de un usuario real.
- Completar mantenedores admin para roles, planes, capacidades y parámetros operativos sin edición dura de código.
- Revisar política de privacidad, términos, consentimiento OAuth y proceso de borrado/exportación.

## Testing y operación

- Crear un script npm que ejecute toda la suite automatizada relevante.
- Integrar `tests/objectiveMetrics.test.ts` a un script npm estándar.
- Definir si se agregará lint y CI.
- Evaluar pruebas de UI/E2E. Referencia: `docs/TESTING.md`.

## Migración legacy aislada

- Mantener herramientas de migración legacy separadas del runtime cloud hasta decidir la carga final de datos históricos.
