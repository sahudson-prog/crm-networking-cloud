# Now

## Estado vigente

No hay una nueva iniciativa de producto contratada. PR #56-#62 están integrados
en `origin/main` (`d670adeefbb54031baec73764eab96007b417600`).
LANDING-01, ONBOARDING-01 y GAM-01 llegaron mediante INT-01 y sus ajustes
posteriores; PERF-HOME-01, PERF-VIEWS-01 y UX-ACCOUNT-01 también están en Git.
La integración y el smoke PROD PASS de #62 no acreditan por sí solos el estado
Production Current del SHA integrado.

## Cierre operacional de REG-OPEN-01

REG-OPEN-01: el owner confirmó preflights PROD 1 y 2 PASS, BACKUP CAPTURE
PASS del 21-11-2026 (`obj02-pr47-20261121-144223Z`), RESTORE GATE PASS local
y los diez pasos SQL PROD PASS, incluidas ambas migrations y los verifiers
R2-B/Calendar. La verificación SQL final dejó Registro libre OFF.

El owner confirmó smoke PROD PASS de login existente, landing, navegación y
Registro libre OFF. Solo falta confirmar Production Ready/Current del SHA
integrado. El estado Vercel `success` de GitHub no certifica que el deployment
siga Current.

El registro nuevo Google/email permanece NOT TESTED; requiere identidad
autorizada y prueba real separada, con ventana ON global aprobada. Seguir el
orden y los STOP de
`docs/planning/REG-OPEN-01-PROD-CUTOVER.md` y `docs/RELEASE_RUNBOOK.md`.

Canonical `main` permanece limpio en `dddb6b10410d1f07ac72ed5e27fdb10787ddb2b0`.
El fast-forward a `origin/main` espera la confirmación de deployment del runbook.

## Decisión siguiente

Tras acreditar el cierre operacional, el owner puede priorizar de forma
independiente OPS-SYNC-01, GGL-01, PRIV-01, QA-01, PRODUCT-EVAL-01 u otro
candidato vigente de `BACKLOG.md`. Antes de ampliar el acceso real, revisar
seguridad de dependencias, privacidad/retención y los controles de abuso del
registro abierto. Ningún candidato queda autorizado por esta lista.
