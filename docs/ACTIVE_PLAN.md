# Plan activo

## Propósito y autoridad

Este documento es la fuente de continuidad para el pipeline de ejecución y el checkpoint activo de Coffeecito. Una tarea nueva debe leerlo antes de planificar o implementar trabajo de producto o release y luego inspeccionar el repositorio y los owner docs directamente relevantes para obtener el detalle técnico.

Aquí se registra estado dinámico de ejecución. Los contratos estables de producto, seguridad, datos, sincronización, privacidad, ambientes y releases siguen perteneciendo a sus documentos especializados. Código, schema, migrations, tests y configuración actual siguen siendo la fuente factual de la implementación.

Si este documento contradice el repositorio o un owner doc sobre un contrato estable, detenerse y reportar la contradicción antes de implementar. No resolver una contradicción material eligiendo silenciosamente una fuente.

## Resume protocol

Al retomar el trabajo desde un chat nuevo, Codex debe:

- leer `AGENTS.md` y `docs/ACTIVE_PLAN.md`;
- verificar `origin/main` en vez de confiar en un SHA dinámico antiguo;
- reportar el estado del repositorio canónico local;
- reportar si `OPS-LOCAL-01` está pendiente o completo;
- si `REL-01` está cerrado, verificar y reportar que `docs/RELEASE_RUNBOOK.md` existe;
- inspeccionar la branch y el worktree actuales si la tarea está `IN PROGRESS`;
- consultar solo los owner docs marcados como relevantes para la fase;
- usar Git y el repositorio para reconstruir el detalle técnico de una tarea parcialmente ejecutada;
- antes de implementar, reportar phase, status, verified baseline, current branch/worktree, completed, pending, blockers, manual/remote actions, immediate next action y contradictions;
- detenerse ante cualquier contradicción material.

Prompt de recuperación copy/paste-safe:

> Retoma Coffeecito desde `docs/ACTIVE_PLAN.md`. Sigue `AGENTS.md`. Verifica `origin/main`, el estado del repositorio canónico local y, si la fase está IN PROGRESS, la branch/worktree actuales. Reporta si `OPS-LOCAL-01` está pendiente o completo y, si `REL-01` está cerrado, confirma que `docs/RELEASE_RUNBOOK.md` existe. Consulta solo los owner docs relevantes indicados para la fase y usa Git/repo para reconstruir trabajo parcial. Antes de implementar, reporta phase, status, verified baseline, current branch/worktree, completed, pending, blockers, manual/remote actions, immediate next action y contradictions. STOP ante cualquier contradicción material.

## Checkpoint actual

**Vigente al 23-11-2026.** `origin/main` verificado en
`d670adeefbb54031baec73764eab96007b417600` (PR #62). Canonical `main`
permanece limpio en `dddb6b10410d1f07ac72ed5e27fdb10787ddb2b0`:
el fast-forward post-release exige todavía evidencia de Production
Ready/Current para el SHA integrado. Esta reconciliación se prepara en un
worktree documental separado desde `origin/main`.

**Integrado en Git:** #56 INT-01 (`604d4a89`), #57 GAM-HOTFIX-01
(`30f842a0`), #58 GAM-HOTFIX-02 (`460a77eb`), #59 PERF-HOME-01
(`be921e3f`), #60 PERF-VIEWS-01 (`cf274a07`), #61 UX-ACCOUNT-01
(`dddb6b10`) y #62 REG-OPEN-01 (`d670adee`). El owner confirmó
Production Ready/Current y smoke PROD PASS de #61. Para #62, GitHub registra
Vercel `success` del commit integrado, no evidencia de que siga Current.

**Controles PROD #62 acreditados por el owner:** preflights 1 y 2 PASS;
BACKUP CAPTURE PASS del 21-11-2026 en `obj02-pr47-20261121-144223Z` y
RESTORE GATE PASS local; los diez pasos SQL, incluidas ambas migrations y los
verifiers R2-B/Calendar, PASS. La verificación SQL final dejó Registro libre
OFF. El smoke DEV ON/OFF pasó y terminó en OFF.

**Smoke PROD #62 acreditado por el owner:** PASS con login existente, landing,
navegación y Registro libre OFF. Este smoke no prueba un alta pública nueva.

**Pendiente operacional #62:** confirmar Production Ready/Current del SHA
integrado; GitHub solo informa Vercel `success`. El alta pública Google/email
sigue NOT TESTED y requiere una autorización y
ventana ON global separadas; no es parte del smoke OFF. Procedimiento:
[REG-OPEN-01-PROD-CUTOVER](planning/REG-OPEN-01-PROD-CUTOVER.md).

**Siguiente decisión:** ninguna iniciativa nueva está contratada. Se conservan
OPS-SYNC-01, GGL-01, PRIV-01, QA-01, PRODUCT-EVAL-01 y la deuda vigente.
`docs/planning/NOW.md` resume el estado actual; `BACKLOG.md` conserva candidatos.

## Antecedentes de releases cerradas

INT-01, los dos hotfixes GAM, PERF-HOME-01, PERF-VIEWS-01 y UX-ACCOUNT-01
están integrados en `main` mediante PR #56-#61. Sus evidencias y limitaciones
focales permanecen en Git y sus owner docs; integración no sustituye smoke
operacional. UI-STRUCT-02 (#54), Calendar V2, OBJ-02, Beta UX V1, INV-01 y
LEGAL-01 conservan los cierres ya acreditados. La verificación focal Calendar
posterior a UI-STRUCT, el E2E Google histórico/periódico y la retención PII
continúan pendientes, sin reabrir aquellos releases.

## Deuda / pre-Early-Access gate

- Pendiente una revisión explícita de seguridad de dependencias antes de abrir Early Access.
- El `npm audit` del clone limpio anterior detectó 1 vulnerabilidad critical y 4 high; fue un diagnóstico histórico, no el estado certificado del árbol actual. Next.js pasó de 16.4.2 a 16.4.6 en INT-01 y dejó de bloquear el build con SecurityFatalError. Esto no declara cero advisories en el árbol completo.
- No existe evidencia suficiente para declarar explotabilidad en PROD. Esta nota no autoriza `npm audit fix` ni actualizaciones adicionales de dependencias; cualquier corrección adicional requiere alcance aprobado.

## Pipeline histórico

`OPS-LOCAL-01` → `REL-01` → `ONB-01` → `INV-01` (COMPLETED) → `OBJ-02` (COMPLETED) → `Beta UX V1` (COMPLETED). Calendar V2 independiente, UI-STRUCT-01 y UI-STRUCT-02 se integraron después. `QA-UX-01` conserva su estado `NOT CONTRACTED`; este cierre no lo declara completado ni altera el resto del backlog.

Orden de preparación beta aprobado: `BRAND-BETA-01` → `UX-ONB-COPY-01` → `UX-DATE-01` → `QA-UX-01` → `UX-SAVE-01` → `UX-COPY-01` → resto del backlog. Las tres primeras se integraron en Beta UX V1. El orden no contrata las restantes ni desplaza gates de seguridad, privacidad y operación.

### OPS-LOCAL-01 - Canonical local Git cutover

**Status:** `COMPLETED`

**Resultado estable**

- Nuevo canonical clone limpio fuera de carpetas sincronizadas.
- Canonical `main` y raíz de worktrees separados.
- `HEAD`, `main` y `origin/main` alineados al cierre.
- `npm ci`, typecheck y build completados correctamente.
- Repositorios históricos preservados únicamente como fuentes de recovery.
- GitHub confirmado como fuente durable de verdad.

### REL-01 - Release runbook

**Status:** `COMPLETED`

**Resultado estable**

- PR #26 merged.
- SHA integrado: `c1bee9d5672bcf38f1fd58bfbc7b19d770365bf0`.
- Vercel Production success.
- Smoke funcional: `N/A — docs-only`.
- Post-release canonical sync: PASS.
- `docs/RELEASE_RUNBOOK.md` establecido como owner operacional.
- Single canonical clone + worktrees formalizados.

### ONB-01 - Mandatory first-run onboarding

**Status:** `COMPLETED`

**Resultado estable implementado**

- PR #27 merged: mandatory first-run onboarding, integrado en `26ec207818609f8e8732d1431538c38fca5b42c7`.
- PR #28 merged: corrección focal de navegación mobile/replay, integrada en `6ec6506661753ddb26c19375ea2d5f9426b7d71f`.
- La implementación actual conserva la secuencia privada: auth -> beta/app access -> legal acceptance -> mandatory onboarding -> app.
- El primer ingreso queda cerrado hasta `completed`; el intro tiene cuatro slides y no ofrece bypass; completar persiste antes de admitir producto; el replay desde "Ver tutorial" sigue siendo opcional y dismissible.
- Vercel reportó success para ambas entregas, confirmando deployment exitoso reportado.
- El owner confirmó validación funcional PROD PASS el 20-10-2026 en seis criterios: primer ingreso, cuatro slides, ausencia de bypass, finalización, persistencia y replay opcional.

**Relación con otras fases**

- Al cierre de ONB-01, esa fase no activó otra por sí sola. INV-01 y OBJ-02 quedaron cerradas después; el pipeline y los estados actuales de Beta UX V1 figuran arriba.
- Se preserva la deuda UX fuera de alcance: las transiciones pueden repetir “Preparando recorrido...” / “Cargando...” y requieren auditoría separada de Shell, Coach y loading states.

## Candidatos futuros sin prioridad aprobada

OBJ-02 está integrado, desplegado y validado en PROD según el owner. PR #46 está cerrado sin merge; Avísame se integró junto con Oportunidades y Seguimiento mediante PR #47. INV-01 y Beta UX V1 están cerradas; QA-UX-01 y posteriores mantienen su contratación independiente.

### OPS-SYNC-01 - Revalidar hardening de diagnósticos de sync

- Status: `NOT CONTRACTED / DECISION REQUIRED`.
- Objetivo: revalidar el hardening pendiente de `sync_run_logs` descrito en planificación y decidir si aún requiere promoción PROD.
- Dependencias: comparación fresca contra main y PROD; el texto de planificación precede releases recientes.
- Decisiones cerradas: el acceso diagnóstico es por capability y no debe ampliarse durante una promoción.
- Decisiones pendientes: trabajo realmente restante, migrations/verifiers y matriz de `admin.view_diagnostics`.
- Criterios de aceptación: no contratados; requieren evidencia fresca de repo y ambiente.
- Out of scope: convergencia general de grants y checks hardcoded por rol.
- Owner docs: `docs/SECURITY_ACCESS.md`, `docs/INGESTION_SYNC.md`, `docs/ACTIONS.md`, `docs/PROD_CONTRACTS.md`.
- Gates manuales/remotos: smoke DEV, preflight PROD, cutover aprobado y smoke de diagnósticos.
- Relación: sin orden comprometido después de ONB-01.

### GGL-01 - Separación de consentimiento y preparación de verificación Google

- Status: `NOT CONTRACTED / DECISION REQUIRED`.
- Objetivo: decidir el contrato técnico y de producto para Contacts + Calendar versus Gmail opcional y preparar OAuth para usuarios externos cuando scopes y branding estén estables.
- Dependencias: OAuth incremental actual, verificación de Connected Account y scope set público confirmado.
- Decisiones cerradas: Google login y autorización de datos son intents distintos; scopes efectivos se verifican server-side; PROD opera con OAuth en Testing.
- Decisiones pendientes: UX de consentimiento, reconnect, impacto en capabilities, revisión/reemplazo de tokeninfo y requisitos de verification/security assessment.
- Criterios de aceptación: no contratados.
- Out of scope: agregar proveedores o cambiar scopes sin aprobar antes el contrato.
- Owner docs: `docs/connectors/GOOGLE.md`, `docs/SECURITY_ACCESS.md`, `docs/ENVIRONMENTS.md`, `docs/PRIVACY_COMPLIANCE.md`.
- Gates manuales/remotos: configuración/revisión Google Cloud, redirects, smoke DEV/PROD y proceso externo de verificación cuando corresponda.
- Relación: candidato independiente; puede depender de onboarding y copy público estables.

### PRIV-01 - Completar controles del ciclo de vida de datos

- Status: `NOT CONTRACTED / DECISION REQUIRED`.
- Objetivo: cerrar gaps documentados de exportación, eliminación completa/retención y revocación real de permisos Google.
- Dependencias: revisión legal, contrato de retención, comportamiento del proveedor y realidad de reset/export actual.
- Decisiones cerradas: la aceptación legal actual es versionada e inmutable; el reset vigente no equivale automáticamente a todas las obligaciones futuras de eliminación/retención.
- Decisiones pendientes: alcance exigido, plazos, eliminación de cuenta versus workspace, formato de exportación y semántica de revocación.
- Criterios de aceptación: no contratados.
- Out of scope: declarar cumplimiento completo antes de validación legal y técnica.
- Owner docs: `docs/PRIVACY_COMPLIANCE.md`, `docs/SECURITY_ACCESS.md`, `docs/DATA_MODEL.md`, `docs/connectors/GOOGLE.md`.
- Gates manuales/remotos: revisión legal, aprobación de contrato persistente, verificación DEV/PROD y smoke de lifecycle.
- Relación: sin orden comprometido después de ONB-01.

### QA-01 - Estandarizar pipeline de validación

- Status: `NOT CONTRACTED / DECISION REQUIRED`.
- Objetivo: decidir e implementar un comando agregado de tests y, por separado, si incorporar lint, CI y cobertura browser/E2E.
- Dependencias: inventario de scripts reales y suites focales existentes.
- Decisiones cerradas: usar scripts reales del repo; no asumir que existe un `npm test` genérico.
- Decisiones pendientes: composición, proveedor CI, política lint y alcance E2E.
- Criterios de aceptación: no contratados.
- Out of scope: ejecutar todas las suites no relacionadas para cada cambio acotado.
- Owner docs: `docs/TESTING.md`, `docs/ENVIRONMENTS.md`.
- Gates manuales/remotos: CI y settings del repositorio requieren aprobación separada.
- Relación: puede apoyar fases posteriores, pero no bloquea la validación focal de ONB-01.

### PRODUCT-EVAL-01 - Refinamientos del core basados en evidencia

- Status: `NOT CONTRACTED / DECISION REQUIRED`.
- Objetivo: evaluar métricas por objetivo, ergonomía de duplicados/merge, diagnósticos de sync y ruido del Coach usando evidencia real antes de seleccionar cambios.
- Dependencias: uso observado y contrato de producto separado para cada refinamiento elegido.
- Decisiones cerradas: matching no implica merge automático; el usuario conserva control sobre cambios de preview y acciones Coach.
- Decisiones pendientes: problema con evidencia suficiente, prioridad, alcance y criterios de aceptación.
- Criterios de aceptación: no contratados para implementación; el primer resultado sería una decisión focal sustentada.
- Out of scope: agrupar métricas, duplicados, sync y Coach en una sola release.
- Owner docs: `docs/PRODUCT.md`, `docs/DOMAIN_MODEL.md`, `docs/INGESTION_SYNC.md`, `docs/ACTIONS.md`, `docs/COACH_RULES.md`.
- Gates manuales/remotos: decisión de producto y checkpoint propio de implementación/release si se selecciona trabajo.
- Relación: sin orden comprometido después de ONB-01.

### INV-01 - Invitar a alguien a Coffeecito

- Status: COMPLETED.
- Objetivo: permitir que usuarios elegibles, incluidos quienes se registraron mediante invitación, puedan invitar a otras personas a Coffeecito.
- Especificación funcional durable: docs/planning/INV-01.md.
- Decisiones cerradas: invitaciones en cadena para usuarios elegibles; autorización temporal por email alternativa a la allowlist legacy, sin Auth paralelo; bootstrap autenticado y transaccional antes de legal/onboarding; 5 cupos por usuario y capacidad global editable de 500 calculados desde pendientes vigentes más registros; expiración exacta a las 120 horas sin cron ni contadores; bloqueos administrativos prevalecen; cancelación de pendientes solo con admin.manage_access; controles separados para pausar invitaciones y suspender registros; nuevos invitados free/user, beta legacy preserva beta_tester; Google import/sync solo para beta_tester; UX V1 acotada con cabecera, diálogo, lista simple y mailto sin afirmar envío.
- Resultado estable: PR #39 y PR #40 integrados en b5f37cf78254de556bfe5f66d50c2fce5f515676; SQL 001 + 002 y verificadores PROD PASS; smoke real de invitación y registro PASS; invitado free/user sin Google Sync; PROD mantiene ambos controles en false y capacidad 10, y DEV ambos controles en false.
- Pendiente operacional diferido: automatizar la retención de PII conforme a la política de 90 días. No reabre la implementación ni habilita controles.
- Out of scope: dashboards, gestor avanzado, edición de invitaciones, correo gestionado, cron de expiración y contadores persistidos.
- Owner docs: docs/SECURITY_ACCESS.md, docs/DATA_MODEL.md, docs/PRODUCT.md, docs/PROD_CONTRACTS.md si requiere schema o migration.
- Relación: fase cerrada; los refinamientos posteriores requieren contratación explícita.
### OBS-BETA-01 - Monitoreo de beta

- Status: `NOT CONTRACTED / DECISION REQUIRED`.
- Objetivo: diseñar una vista operativa `/sistema/monitoreo`, separada de Mantención, con métricas propias de beta, tablas y filtros sin exponer contenido privado.
- Especificación funcional durable: `docs/planning/OBS-BETA-01.md`.
- Decisiones cerradas: pestañas Resumen, Usuarios, Invitaciones e Incidentes; filtros de fechas, cohorte, plan, roles, estados y usuario; permisos de consulta separados de administración; no replicar métricas de Supabase, Google Cloud o Vercel; preservar límites que gobiernan el runtime.
- Decisiones pendientes: fuentes y semántica de métricas, agregaciones seguras, capabilities, relación con diagnósticos/logs, indicadores redundantes y criterios de aceptación.
- Relación: sin orden comprometido respecto de los candidatos existentes.

### BRAND-BETA-01 - Variante de marca beta

- Status: integrado en Beta UX V1 mediante PR #50.
- Objetivo: variante BETA discreta y profesional junto a Coffeecito, reversible, accesible y responsive, sin sustituir recursos originales.
- Especificación funcional durable: `docs/planning/BRAND-BETA-01.md`.
- Decisiones cerradas según el owner: distintivo BETA reversible y favicon aprobados; sin mensajes adicionales.
- Pendiente: retirada futura del distintivo al finalizar beta.
- Relación: primera del orden beta aprobado, integrada junto con COPY y DATE.

### Iniciativas UX planificadas para beta

COPY y DATE están integrados en Beta UX V1; las restantes siguen `NOT CONTRACTED` para implementación. El orden no equivale a autorización de la siguiente iniciativa.

| Orden | Iniciativa | Contrato de planificación |
| --- | --- | --- |
| 2 | `UX-ONB-COPY-01` | [Revisión editorial del tutorial](planning/UX-ONB-COPY-01.md), sin cambiar mecánicas. |
| 3 | `UX-DATE-01` | [Una fecha visible](planning/UX-DATE-01.md); integrada en Beta UX V1, cutover PROD completado según el owner. |
| 4 | `QA-UX-01` | [Entorno de auditoría visual](planning/QA-UX-01.md), aislado y sintético. |
| 5 | `UX-SAVE-01` | [Persistencia transversal](planning/UX-SAVE-01.md), arquitectura preliminar sin tecnología elegida. |
| 6 | `UX-COPY-01` | [Comunicación transversal](planning/UX-COPY-01.md), posterior al tutorial. |

Después continúa el resto del backlog, incluidas `UX-NAV-01`, `OPS-SYNC-01`, `GGL-01`, `PRIV-01`, `QA-01`, `OBS-BETA-01` y `PRODUCT-EVAL-01`, sin declararlas resueltas. Los gates de seguridad de dependencias, privacidad/retención y operación conservan prioridad obligatoria antes de ampliar el acceso real, aunque no sean una etapa de este orden editorial/UX.

### OBJ-02 - Nuevos Objetivos

- Status: COMPLETED operacionalmente según el owner; PR #47 integrado en `4f28f46c2c817f5c6ca23572605bcf44f1000421`, siete migrations/verificadores PROD, backup/restore aislado, deployment Ready/Current y smoke PROD PASS el 2026-11-02. PR #48 documenta este cierre.
- Objetivo: evolucionar Objetivos hacia planes/ciclos, Prioridades, Oportunidades y Seguimiento mediante releases compatibles y separadas.
- Especificación funcional durable: docs/planning/OBJ-02.md.
- Decisiones cerradas: tres planes no simultáneos; solo Búsqueda de un nuevo trabajo disponible; modalidades futuras como `Próximamente` con `Avísame`; Prioridades/IDs, networking e historia preservados; R1 se limita a `Tu punto de partida` compartido entre onboarding y Cuenta; importación del tutorial solo de contactos; Dashboard renombrado y desocultado como Seguimiento con `¿Cómo voy?`, Total cafés y columna Oportunidades.
- Resultado R1: nuevo paso `Tu punto de partida` después de la introducción y antes de Objetivos; nombre, situación profesional estructurada y `Fecha_Inicio_Networking` obligatorios para nuevos usuarios; Cuenta comparte la misma fuente; completed no se reabre, in_progress no se reinicia y replay no escribe al navegar.
- R2-A contratado: fundación expand-only de ciclos, pertenencia de Prioridades, snapshot/transiciones de situación profesional, ledger mínimo de estado/foco de contactos y atribución temporal interna de interacciones sin `cycle_id`.
- Resultado R2-A: según el owner, instalado y validado en DEV/PROD. Los checkpoints anteriores de este archivo no actualizaban ese estado.
- La semántica de Seguimiento está cerrada en OBJ-02.md: foco actual, evidencia del ciclo, HH canónico, primeras fechas y métricas vigentes de Oportunidades. Se integró en PR #47 y el owner confirmó smoke PROD PASS, sin reabrir los contratos de ciclos, Avísame u Oportunidades.
- Estado de R1: PR #42 integrado en `56a25e5d241799b2fd6129258b06f7d67d89cad6`; según evidencia confirmada por el owner, SQL y tres verifiers PASS en DEV/PROD, runtime PROD Ready / Current y smoke PASS. First-run real diferido con cobertura automatizada.
- Out of scope actual: aplicar SQL remoto o desplegar runtime, reparar Google Sync o confundir OBJ-02 con PRODUCT-EVAL-01.
- Relación: iniciativa completada; la siguiente permanece sin seleccionar.
### UX-NAV-01 - Transiciones de navegación

- Status: `NOT CONTRACTED / DECISION REQUIRED`.
- Objetivo: corregir la repetición visible de estados intermedios durante navegación entre vistas: "Preparando recorrido" -> "Cargando" -> "Preparando recorrido".
- Contexto conocido: es deuda UX independiente de ONB-01; probablemente requiere revisar persistencia/montaje de Shell, Coach y loading states; no hay causa raíz confirmada.
- Decisiones pendientes: reproducción exacta, causa raíz, estados de carga necesarios, contrato UX final y alcance de la corrección.
- Criterios de aceptación: no contratados.
- Out of scope: implementar o especular sobre la solución en ausencia de auditoría.
- Owner docs: `docs/UI_SYSTEM.md`, `docs/PRODUCT.md`, `docs/TESTING.md`.
- Relación: independiente de ONB-01 y sin orden comprometido respecto de los demás candidatos.

### Iniciativas diferidas

- Mantenedores admin para roles, planes, capabilities y parámetros: `NOT CONTRACTED / DECISION REQUIRED`; owner doc `docs/SECURITY_ACCESS.md`.
- Microsoft, WhatsApp y otros proveedores: `NOT CONTRACTED / DECISION REQUIRED`; diferidos hasta validar activación y valor recurrente del core Google.
- Migración final de datos legacy: `NOT CONTRACTED / DECISION REQUIRED`; mantener tooling legacy aislado del runtime cloud.

## Fases cerradas necesarias para continuidad

### LEGAL-01 - Aceptación legal versionada V1.1

- Resultado: Terms 1.1 y Privacy 1.1 son el contrato vigente; V1.0 permanece reconstruible; la aceptación es explícita, server-timestamped, inmutable e idempotente por contrato.
- Release: PR #23.
- SHA integrado: `14c11c37d1e1fcf10517c6d55416e25a2f939ca6`.
- Estado persistente: migrations `202610150002` y `202610150003` aplicadas en PROD; verifiers focales y `verify_access` canónico PASS.
- Entrega: Vercel Production y smoke PROD PASS.
- Detalle estable: `docs/SECURITY_ACCESS.md`, `docs/DATA_MODEL.md`, `docs/PRIVACY_COMPLIANCE.md`; Git conserva la historia de implementación.

## Discrepancias de planificación a considerar

- El cierre operacional PROD de REG-OPEN-01 solo requiere todavía evidencia de deployment Ready/Current del SHA integrado. El owner confirmó backup/restore, SQL/verifiers y smoke OFF PASS; GitHub `success` no demuestra por sí solo el estado Current.
- La existencia de un item en `NOW.md` o `BACKLOG.md` no autoriza su implementación ni lo incorpora al pipeline confirmado.
- Las referencias de `docs/PROD_CONTRACTS.md` a crear un runbook son antecedentes: `docs/RELEASE_RUNBOOK.md` existe y REL-01 está cerrado. Los textos históricos de implementación no sustituyen este checkpoint operacional.
- Si una auditoría futura demuestra que main, PROD o un owner contract difieren de este checkpoint, detenerse y actualizarlo solo después de resolver la discrepancia.

## Reglas de mantención

- Actualizar el checkpoint cuando cambien materialmente fase activa, baseline, trabajo completado, pendientes, blockers, acciones remotas o next action.
- Al cerrar una fase, condensarla a resultado estable más PR, SHA integrado, deployment y smoke.
- Mover verdades estables al owner doc directamente responsable cuando corresponda; conservar aquí solo estado de ejecución.
- Git preserva el detalle histórico. No usar este documento como diario.
- No sobrescribir decisiones no tomadas. Marcarlas `NOT CONTRACTED / DECISION REQUIRED`.
- Antes de iniciar un candidato, promoverlo al pipeline confirmado con contrato y criterios de aceptación aprobados.
- Ante contradicción material entre este documento, un owner doc y el repositorio, detenerse y reportarla antes de implementar.
