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

- Última release cerrada: PR #26, release runbook y canonical Git workflow (`docs-only`).
- Last completed product release SHA: `14c11c37d1e1fcf10517c6d55416e25a2f939ca6`.
- Estado PROD: migrations `202610150002` y `202610150003` aplicadas; verifiers focales PASS; `verify_access` canónico PASS; PR #23 merged; Vercel Production PASS; smoke PROD PASS.
- Contrato legal vigente: Terms 1.1, Privacy 1.1 y `acceptance_method = explicit_web`.
- Secuencia privada: auth -> beta/app access -> legal acceptance -> onboarding -> app.
- Fase activa: `ONB-01 — Mandatory first-run onboarding`.
- Estado de la fase activa: `IN PROGRESS`.
- Deuda conocida fuera de alcance: DEV mantiene el grant directo preexistente de `anon` sobre `public.app_capabilities`. No corregirlo oportunistamente en features no relacionadas.

## Deuda / pre-Early-Access gate

- Pendiente una revisión explícita de seguridad de dependencias antes de abrir Early Access.
- El `npm audit` del clone limpio detectó 1 vulnerabilidad critical y 4 high; `next` es una dependencia productiva directa afectada.
- No existe evidencia suficiente para declarar explotabilidad en PROD. Esta deuda no bloquea REL-01 ni ONB-01.
- Esta nota no autoriza `npm audit fix` ni una actualización de dependencias; cualquier corrección requiere una tarea aprobada por separado.

## Checkpoint de tarea activa

- Current phase: `ONB-01 — Mandatory first-run onboarding`.
- Status: `IN PROGRESS`.
- Baseline: `c1bee9d5672bcf38f1fd58bfbc7b19d770365bf0`.
- Current branch/worktree: `codex/onboarding-mandatory-first-run`.
- Completed in current task:
  - REL-01 cerrado;
  - implementación ONB-01 completada;
  - mandatory first-run enforcement implementado;
  - replay opcional para usuarios `completed` preservado;
  - carreras de completion corregidas manteniendo fail-closed;
  - `test:onboarding` 37/37 PASS;
  - `test:legal` 15/15 PASS;
  - `test:system-access` 11/11 PASS;
  - typecheck PASS;
  - build PASS;
  - `git diff --check` PASS;
  - smoke manual previo confirmó enforcement first-run, bloqueo por URL y replay completed dismissible;
  - escenario A-completed → B-incompleto: automated coverage PASS / manual NOT RUN;
  - implementación publicada en `d5209167bdb20710bc253e2fd1404c420f52928b`;
  - FINAL POST-FIX TESTER VALIDATION: PENDING — POST-DEPLOY PROD GATE.
- Still pending:
  - PR manual;
  - review/checks;
  - merge manual;
  - verificar SHA integrado en main;
  - verificar Production deployment real y SHA desplegado;
  - tester validation en PROD de la versión final;
  - aprobación del tester/PROD smoke gate;
  - post-release canonical sync;
  - cierre ONB-01.
- Blockers: None confirmed.
- Gate de cierre:
  - tester validation no es un gate previo al merge porque los testers operan sobre PROD; su ausencia no bloquea por sí sola PR ni merge;
  - ONB-01 no puede marcarse `COMPLETED` hasta que tester validation / smoke PROD posterior al deployment sea PASS;
  - si tester validation PROD detecta un defecto bloqueante, ONB-01 permanece `IN PROGRESS` y requiere una corrección/release posterior.
- Manual/remote actions already executed:
  - fetch read-only de `origin/main`;
  - canonical `main` sincronizado por fast-forward;
  - worktree de ONB-01 creado;
  - branch `codex/onboarding-mandatory-first-run` publicada.
- Immediate next action:
  - abrir PR manual;
  - revisar checks;
  - autorizar merge;
  - después del deployment ejecutar tester validation en PROD.
- Stop boundary:
  - no crear PR desde Codex;
  - no mergear;
  - no cambios en servicios.
- Deuda UX fuera de alcance:
  - las transiciones entre rutas pueden repetir “Preparando recorrido...” / “Cargando...”;
  - requiere una auditoría separada de persistencia de Shell/Coach y loading states.

Actualizar este bloque durante una tarea en curso cuando cambie materialmente su checkpoint.

## Pipeline confirmado

`OPS-LOCAL-01` → `REL-01` → `ONB-01`

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

**Status:** `IN PROGRESS`

**Objetivo**

Hacer obligatorio el onboarding inicial sin alterar el comportamiento dismissible del tutorial reproducido posteriormente desde "Ver tutorial".

**Dependencias**

- OPS-LOCAL-01 completado.
- REL-01 completado.
- Aceptación legal V1.1 cerrada y desplegada.
- Preservar la secuencia privada: auth -> beta/app access -> legal acceptance -> mandatory onboarding -> app.
- Reutilizar la persistencia y arquitectura de estado actuales si permiten cumplir el contrato.

**Decisiones cerradas**

- Mantener el lenguaje visual actual del onboarding.
- El intro pasa de tres a cuatro slides.
- Slides 1 y 2 conservan su contenido actual.
- Slide 3 conserva el contenido sobre gestionar la red y sus preguntas, pero elimina: "Coffeecito se encarga de la gestión. Tú del café y la conversación."
- Slide 4 es un cierre limpio y centrado con: "Coffeecito se encarga de la gestión. Tú del café y la conversación."
- CTA de slide 4: "Empecemos".
- Eliminar la barra global inferior de acciones del intro.
- Slides 1-3 mantienen navegación Previous/Next.
- El mandatory first-run no tiene "Ahora no", defer ni bypass equivalente.
- El tutorial guiado no puede cerrarse durante mandatory first-run.
- Un replay posterior iniciado desde "Ver tutorial" sigue siendo opcional y se puede cerrar.
- No modificar la aceptación legal.
- No se espera cambio de schema.

**Decisiones pendientes**

- Cambios mínimos exactos para distinguir mandatory first-run de replay, pendientes de auditoría del repositorio.
- Ubicación exacta del redirect/guard para impedir acceso a rutas privadas antes de completar, pendiente de verificar el provider y routing actuales.
- Cualquier persistencia nueva: `NOT CONTRACTED / DECISION REQUIRED`. Si el repositorio demuestra esa necesidad, detenerse antes de implementar.

**Criterios de aceptación**

- Un usuario first-run no puede llegar a la app antes de completar onboarding.
- No existe "Ahora no" ni bypass equivalente en mandatory mode.
- Completar onboarding permite entrar normalmente a la app.
- El replay posterior sigue siendo opcional y dismissible.
- El legal gate sigue inmediatamente antes de onboarding.
- Tests focales, typecheck, build y smoke pasan.

**In scope**

- Composición y navegación del intro requeridas por las decisiones anteriores.
- Comportamiento first-run versus replay.
- Enforcement de rutas/gates necesario para volver obligatorio el first-run.
- Cobertura focal de regresión.

**Out of scope**

- Cambiar aceptación legal o su contrato.
- Agregar contenido de producto fuera de las cuatro slides definidas.
- Crear una segunda máquina de estado si la arquitectura actual puede extenderse.
- Cambiar schema o persistencia sin una decisión separada.
- Limpiezas no relacionadas de producto, sync, seguridad o UI.

**Owner docs relevantes**

- `docs/SECURITY_ACCESS.md` solo si cambia la secuencia AuthGate/acceso.
- `docs/DATA_MODEL.md` solo si cambia persistencia o una invariante de datos.
- `docs/UI_SYSTEM.md` solo para restricciones vigentes del sistema visual.
- `docs/TESTING.md` para validación proporcional.

**Gates manuales y remotos**

- Diseño e implementación local no requieren cambios remotos.
- Antes del merge: aprobar diff, ejecutar tests focales/typecheck/build y revisar checks. Después del deployment PROD: ejecutar tester validation / smoke funcional obligatorio; ONB-01 se cierra solo después de ese PASS.
- Cualquier cambio de contrato persistente PROD debe seguir `docs/PROD_CONTRACTS.md` y no está preautorizado por esta fase.

**Relación con otras fases**

- ONB-01 es la tercera fase del pipeline confirmado: OPS-LOCAL-01 → REL-01 → ONB-01.
- Ningún candidato futuro tiene orden comprometido respecto de este pipeline salvo que un checkpoint posterior lo establezca.

## Candidatos futuros no contratados

El trabajo siguiente está sustentado por planificación u owner docs actuales, pero todavía no forma una secuencia aprobada. Cada candidato permanece `NOT CONTRACTED / DECISION REQUIRED`; no iniciarlo solo porque aparece aquí.

### SEC-DEV-01 - Resolver drift amplio de grants DEV

- Status: `NOT CONTRACTED / DECISION REQUIRED`.
- Objetivo: auditar y decidir la corrección del drift preexistente de grants DEV, incluido el privilegio directo conocido de `anon` sobre `public.app_capabilities`.
- Dependencias: contrato canónico de seguridad, inventario DEV fresco y aprobación explícita de cualquier cambio persistente.
- Decisiones cerradas: no mezclar esta deuda con features no relacionadas ni usar revokes globales como arreglo oportunista.
- Decisiones pendientes: objetos afectados, matriz canónica, alcance de migration y estrategia de promoción.
- Criterios de aceptación: no contratados; deben definirse desde una auditoría fresca.
- Out of scope: releases de producto y rediseño general de autorización.
- Owner docs: `docs/SECURITY_ACCESS.md`, `docs/PROD_CONTRACTS.md`.
- Gates manuales/remotos: preflight read-only DEV/PROD, aprobación de migration, verifiers y smoke.
- Relación: independiente de ONB-01 salvo dependencia directa demostrada.

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

- `docs/planning/NOW.md` y `docs/planning/BACKLOG.md` conservan estado dinámico anterior a PR #23, incluidas referencias a beta cerrada y trabajo legal ya cerrado. Tratarlo como contexto histórico de planificación, no como checkpoint actual.
- La existencia de un item en `NOW.md` o `BACKLOG.md` no autoriza su implementación ni lo incorpora al pipeline confirmado.
- `docs/PROD_CONTRACTS.md` ya proponía crear `docs/RELEASE_RUNBOOK.md` para promoción, mantenimiento, backup y rollback; ese pendiente nunca se ejecutó y ahora está contratado como REL-01.
- Este checkpoint explícito no reescribe contratos estables. Actualizar los documentos de planificación anteriores es una tarea separada.
- Si una auditoría futura demuestra que main, PROD o un owner contract difieren de este checkpoint, detenerse y actualizarlo solo después de resolver la discrepancia.

## Reglas de mantención

- Actualizar el checkpoint cuando cambien materialmente fase activa, baseline, trabajo completado, pendientes, blockers, acciones remotas o next action.
- Al cerrar una fase, condensarla a resultado estable más PR, SHA integrado, deployment y smoke.
- Mover verdades estables al owner doc directamente responsable cuando corresponda; conservar aquí solo estado de ejecución.
- Git preserva el detalle histórico. No usar este documento como diario.
- No sobrescribir decisiones no tomadas. Marcarlas `NOT CONTRACTED / DECISION REQUIRED`.
- Antes de iniciar un candidato, promoverlo al pipeline confirmado con contrato y criterios de aceptación aprobados.
- Ante contradicción material entre este documento, un owner doc y el repositorio, detenerse y reportarla antes de implementar.
