# Backlog

Este backlog conserva solo trabajo pendiente vigente. No es una fuente de verdad técnica: cada item debe apoyarse en el documento especializado correspondiente cuando se diseñe o implemente.

## Beta / onboarding / branding

- Diseñar e implementar onboarding de primera sesión: propósito, configuración inicial, fecha de inicio de networking, conexión de datos y primer resultado útil.
- Ejecutar beta cerrada por cohortes, incluyendo smoke multiusuario y captura de feedback sobre activación, comprensión, confianza y uso recurrente.
- Mejorar landing pública, branding, logo, naming visible y primera impresión del producto.
- Separar claramente importación inicial, actualización incremental global y actualización por contacto en UI y documentación operativa.

## Core producto y sincronización

- Validar y mejorar, según evidencia de beta, el resumen de métricas por objetivo: contactos, cafés, última actividad, prioridad, mayor estado y filtros. Referencia: `docs/PRODUCT.md`, `docs/DOMAIN_MODEL.md`, `docs/DATA_MODEL.md`.
- Validar la ergonomía y casos límite de revisión de duplicados locales y merge manual de contactos. Referencia: `docs/INGESTION_SYNC.md`, `docs/ACTIONS.md`.
- Robustecer diagnósticos de Gmail y Calendar cuando no aparecen interacciones esperadas.
- Evaluar durante la beta el ruido de sugerencias Coach y ajustar agrupación o presentación solo si la evidencia lo justifica.
- Revisar automatización futura de reglas por plan/capability.

## Privacy / security / compliance

- Auditar la realidad técnica y operacional del tratamiento de datos personales y los controles existentes.
- Determinar el cumplimiento aplicable en Chile mediante revisión competente, sin declarar cumplimiento anticipadamente.
- Preparar Privacy Policy y Terms & Conditions coherentes con el comportamiento efectivo del producto.
- Planificar los gaps documentados de exportación, eliminación completa de cuenta, retención, consentimiento versionado y revocación real de permisos Google.
- Revisar el acceso interno a logs, diagnósticos y datos crudos como superficies operacionales privilegiadas.

## Google consent y verification

- Diseñar la separación de consentimiento Google: Contacts + Calendar como primera autorización de datos y Gmail como autorización adicional opcional, explicando su beneficio antes de solicitarlo.
- Definir el impacto de esa separación en Connected Account, scopes efectivos, capabilities, reconnect y UX antes de implementarla.
- Mantener Google OAuth PROD en Testing y administrar los Google test users de la beta mientras esa sea la configuración vigente.
- Preparar la verificación Google y evaluar el eventual security assessment solo cuando branding, políticas y scopes finales estén estables.
- Revisar el uso de tokeninfo antes de un lanzamiento público.

## UX / permissions

- Restringir la navegación de Sistema por capabilities efectivas: hoy un usuario base puede ver Guía visual cloud, Cuenta y conexiones, Mantención admin y Logs. Antes de implementar, auditar qué capability corresponde a cada acceso y si alguno pertenece realmente a usuario final. Criterio de aceptación: un usuario sin la capability requerida no ve ni puede navegar a cada acceso; un usuario autorizado sí conserva su acceso. Seguridad: ocultar la UI no reemplaza enforcement en rutas, RPC ni RLS/backend.
- Validar que las rutas administrativas fallen cerradas aunque un usuario intente navegarlas directamente.
- Completar mantenedores admin para roles, planes, capacidades y parámetros operativos sin edición dura de código.

## Integraciones futuras

- Evaluar Microsoft, WhatsApp u otros proveedores solo después de validar activación, recurrencia y valor del core Google. No diseñar ni implementar integraciones nuevas todavía.

## Testing / operación

- Crear un script npm que ejecute toda la suite automatizada relevante.
- Integrar `tests/objectiveMetrics.test.ts` a un script npm estándar.
- Definir si se agregará lint y CI.
- Evaluar pruebas de UI/E2E. Referencia: `docs/TESTING.md`.

## Migración legacy aislada

- Mantener herramientas de migración legacy separadas del runtime cloud hasta decidir la carga final de datos históricos.
