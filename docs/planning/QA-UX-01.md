# QA-UX-01 - Entorno aislado de auditoría UX

## Estado y objetivo

- Status: `PLANNED / NOT CONTRACTED` para implementación; cuarta en el orden beta.
- Permitir a Codex recorrer visualmente Coffeecito sin recibir credenciales reales y detectar regresiones de experiencia.

## Decisiones aprobadas

- Evaluar un entorno aislado con componentes reales, fixtures sintéticos, navegación y flujos interactivos; reutilizar los harnesses de navegador existentes.
- Medir latencia, capturar pantallas, revisar responsive, interacciones, errores y estados de carga.
- Complementar, cuando sea necesario, con pruebas autenticadas contra DEV iniciadas manualmente por el owner.
- No crear bypass de Auth/RLS en el backend DEV ni conectar fixtures a PROD.

## Hipótesis, pendientes y gates

- Hipótesis: reutilizar harnesses actuales y fixtures sintéticos ofrece cobertura suficiente antes de añadir infraestructura nueva.
- Pendiente: inventariar harnesses y superficies, definir aislamiento, métricas de latencia y qué flujos requieren autenticación real en DEV.
- Excluye acceso autónomo a sesiones reales, datos personales y sustitución del smoke del owner.
- Gate: probar aislamiento/red, fidelidad de componentes y flujos, reproducibilidad, capturas desktop/móvil y ausencia de datos reales.
- Owner docs: `docs/TESTING.md`, `docs/UI_SYSTEM.md`, `docs/SECURITY_ACCESS.md`, `docs/ENVIRONMENTS.md`.
