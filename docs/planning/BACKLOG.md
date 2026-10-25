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
- Completar el smoke DEV de usuario base para `sync_run_logs` cuando se libere el rate limit temporal de Supabase Auth.
- Promover el hardening de `sync_run_logs` a PROD en un release posterior, con migration y verifier, probablemente junto con onboarding.
- Auditar por separado el drift preexistente de grants amplios en DEV y decidir su corrección como cambio de contrato; no forma parte del hardening de `sync_run_logs`.
- Revisar la semántica y matriz de `admin.view_diagnostics`: `sponsor_admin` la hereda actualmente y, bajo el contrato vigente, obtiene acceso transversal a `sync_run_logs`. Resolver esta deuda sin hardcodear roles ni debilitar el enforcement por capability.
- Revisar por separado el riesgo y contrato persistente de `admin_usage_limit_overrides_v0_1` almacenado en `user_settings` antes de cambiar su autorización o almacenamiento.
- Revisar las demás superficies internas de diagnósticos y datos crudos como accesos operacionales privilegiados.

## Google consent y verification

- Diseñar la separación de consentimiento Google: Contacts + Calendar como primera autorización de datos y Gmail como autorización adicional opcional, explicando su beneficio antes de solicitarlo.
- Definir el impacto de esa separación en Connected Account, scopes efectivos, capabilities, reconnect y UX antes de implementarla.
- Mantener Google OAuth PROD en Testing y administrar los Google test users de la beta mientras esa sea la configuración vigente.
- Preparar la verificación Google y evaluar el eventual security assessment solo cuando branding, políticas y scopes finales estén estables.
- Revisar el uso de tokeninfo antes de un lanzamiento público.
- Revalidar autorización Google después de adquirir los advisory locks en las RPC de persistencia. Estado: diferido y no corregido; el owner acepta el riesgo residual para la salida inicial. Evidencia local: en Contacts y Calendar, una llamada autorizada que espera un lock puede persistir después de confirmar un deny durante la espera, mientras que las llamadas posteriores son rechazadas; no existe garantía de cancelación hasta `COMMIT` ni se demostró un límite de una sola escritura pendiente. Gmail y otras modalidades de revocación no fueron certificadas concurrentemente. El alcance se limita a las RPC de persistencia Google y no debe cambiar vCard/ICS. En el rollout previsto, Google no estará disponible para el rol base `user`; la cohorte `beta_tester` habilitada conserva este riesgo. Reevaluar antes de habilitar Google para `user`, ampliar la cohorte o ante un incidente relacionado. Una solución futura posible es revalidar completamente después de los locks y probar la visibilidad de cambios concurrentes; su implementación no está autorizada.
- Antes de ampliar Google Sync al rol `user`, realizar con Astra un diagnóstico integral de arquitectura, funcionalidad y UX. Incluir el comportamiento de duplicados, el error inicial de conexión observado manualmente y el error de persistencia Calendar observado en PROD; no atribuir causas mientras no exista evidencia que las demuestre.

## UX / permissions

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
