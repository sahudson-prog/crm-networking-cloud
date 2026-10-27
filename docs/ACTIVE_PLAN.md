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

- Último PR integrado en `main`: PR #41, checkpoint documental de OBJ-02, SHA `661e65ed0005beecff11026e5c7499d373386217`.
- Última release de producto completada: PR #40, Invitaciones V1.
- Last completed product release SHA: `b5f37cf78254de556bfe5f66d50c2fce5f515676`.
- Release histórica conservada: PR #29, desacople del sync periódico respecto del límite histórico de networking.
- Estado PROD: migrations `202610150002` y `202610150003` aplicadas; verifiers focales PASS; `verify_access` canónico PASS; PR #23 merged; Vercel Production PASS; smoke PROD PASS.
- Contrato legal vigente: Terms 1.1, Privacy 1.1 y `acceptance_method = explicit_web`.
- Secuencia privada: auth -> beta/app access -> legal acceptance -> onboarding -> app.
- Publicación operacional `SEC-DEV-01` completada: PR #37 integrado en `cd6eb1014b64ed4f2fb21e23733dbd93ac57c3f7`; Vercel Production confirmado por el owner. La remediación SQL se ejecutó solo en DEV.
- ONB-01 cerrado: PR #27 y PR #28 integrados, Vercel success reportado y validación funcional PROD PASS confirmada por el owner el 20-10-2026.
- `SYNC-INC-01` cerrado: PR #29 integrado, Vercel Production success y smoke funcional PROD PASS.
- Resultado estable de SYNC-INC-01: el límite histórico de 12 meses se mantiene para importaciones históricas; una `Fecha_Inicio_Networking` antigua ya no bloquea el sync periódico; Gmail y Calendar conservan sus ventanas rolling/incrementales acotadas.
- `SEC-DEV-01`: reconciliación de grants y funciones de validación verificada en DEV; verificadores SQL y smoke de lectura PASS. No hubo cambios PROD.
- `SEC-GOOGLE-01`: expand/runtime integrados y desplegados. El riesgo de una operación ya autorizada que persiste después de un deny mientras espera un lock fue aceptado y diferido para la cohorte inicial; no está corregido. Calendar PROD continúa con persistencia no declarada PASS y diagnóstico diferido. El contract permanece separado en `NO-GO`, sin autorización nueva en INV-01.

- INV-01 cerrado: PR #39 y PR #40 integrados; release b5f37cf78254de556bfe5f66d50c2fce5f515676; SQL 202610250001 y 202610250002 aplicadas y verificadas en PROD; smoke real de invitación y registro PASS. El invitado queda free/user sin Google Sync. PROD conserva ambos controles en false y capacidad 10; DEV conserva ambos controles en false. La retención operacional de PII sigue pendiente.

## Deuda / pre-Early-Access gate

- Pendiente una revisión explícita de seguridad de dependencias antes de abrir Early Access.
- El `npm audit` del clone limpio detectó 1 vulnerabilidad critical y 4 high; `next` es una dependencia productiva directa afectada.
- No existe evidencia suficiente para declarar explotabilidad en PROD. Esta deuda no bloquea REL-01 ni ONB-01.
- Esta nota no autoriza `npm audit fix` ni una actualización de dependencias; cualquier corrección requiere una tarea aprobada por separado.

## Checkpoint de tarea activa

- Current phase: OBJ-02 - Nuevos Objetivos.
- Status: R1 SQL VERIFICADO EN DEV Y PROD; RUNTIME PENDIENTE DE MERGE, DEPLOYMENT Y SMOKE PROD.
- Verified local baseline: 661e65ed0005beecff11026e5c7499d373386217.
- Current branch/worktree: `codex/obj-02-r1-starting-point` en worktree aislado.
- Completed:
  - INV-01 integrado, desplegado y validado en PROD mediante PR #39 y PR #40;
  - SQL 001 + 002 y verificadores PROD PASS;
  - smoke real de invitación y registro PASS con controles cerrados;
  - auditoría focal de arquitectura, schema y UX de OBJ-02 completada;
  - contrato funcional, recomendaciones técnicas y releases incrementales consolidados en `docs/planning/OBJ-02.md`;
  - decisiones de campos, obligatoriedad y compatibilidad V1 de R1 aprobadas;
  - PR #42 publicado con runtime, migration y verifiers de `Tu punto de partida`;
  - según evidencia operacional confirmada por el owner, DEV: preflight/captura PASS, migration aplicada, tres verifiers PASS y smoke autenticado de Cuenta, persistencia, tutorial, Coach, navegación, responsive 320 px y teclado/foco PASS;
  - según evidencia operacional confirmada por el owner, PROD: preflight/captura PASS, backup lógico íntegro y restauración local aislada PASS para schema/datos, migration aplicada y tres verifiers PASS;
  - comprobación focal reportada por el owner: seis triggers y cero señales de llamadas externas.
- Pending:
  - revisión y autorización explícita de merge para PR #42;
  - merge manual, verificación del SHA integrado y deployment efectivo de Vercel Production;
  - smoke PROD autenticado del runtime R1; el first-run con usuario nuevo permanece diferido con cobertura automatizada;
  - resolver por separado las decisiones abiertas de ciclos, `Avísame`, Oportunidades y Seguimiento antes de sus respectivas releases.
- Blockers: R1 sigue siendo `PROD CONTRACT CHANGE`; aunque los gates SQL fueron reportados PASS por el owner, no se autoriza merge ni runtime hasta verificar el SHA integrado, deployment Production y smoke PROD. La restauración local del backup no certifica ACL, roles ni configuración externa.
- Manual/remote actions already executed: según confirmación del owner, gates SQL DEV/PROD de R1 completados; no hay merge, deployment ni smoke PROD de runtime R1.
- Immediate next action: revisar PR #42 y obtener autorización separada para merge manual; no adelantar deployment ni smoke.
- Stop boundary: no aplicar SQL remoto, desplegar R1 ni implementar releases posteriores sin autorización separada.
## Pipeline confirmado

`OPS-LOCAL-01` → `REL-01` → `ONB-01` → `INV-01` (COMPLETED) → `OBJ-02 R1` (SQL DEV/PROD VERIFICADO; RUNTIME NO DESPLEGADO)

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

- ONB-01 no activa una fase de implementación nueva al cerrarse. INV-01 está cerrada; OBJ-02 es la siguiente auditoría focal y los demás candidatos permanecen `NOT CONTRACTED / DECISION REQUIRED` hasta contratación explícita.
- Se preserva la deuda UX fuera de alcance: las transiciones pueden repetir “Preparando recorrido...” / “Cargando...” y requieren auditoría separada de Shell, Coach y loading states.

## Iniciativa activa y candidatos futuros

OBJ-02 es la iniciativa activa y únicamente R1 está contratada hasta sus gates de runtime pendientes. Las demás entregas de OBJ-02 y las demás iniciativas de esta sección permanecen NOT CONTRACTED / DECISION REQUIRED, salvo INV-01 que está cerrada; no iniciar implementación solo porque una iniciativa aparece aquí.
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

- Status: `NOT CONTRACTED / DECISION REQUIRED`.
- Objetivo: definir una variante temporal BETA para comunicar acceso anticipado sin reemplazar los recursos originales de Coffeecito.
- Especificación funcional durable: `docs/planning/BRAND-BETA-01.md`.
- Decisiones cerradas: preservar assets originales en Git; añadir una variante sin sobrescribir isotipo ni composiciones; aplicarla en landing, onboarding y cabecera; comunicar posibles restricciones o planes pagados futuros.
- Decisiones pendientes: composición y assets derivados, copy final, activación y retirada, accesibilidad, pruebas visuales y compatibilidad con la identidad vigente.
- Relación: sin orden comprometido respecto de los candidatos existentes.

### OBJ-02 - Nuevos Objetivos

- Status: R1 SQL VERIFICADO EN DEV Y PROD; RUNTIME PENDIENTE DE MERGE, DEPLOYMENT Y SMOKE PROD.
- Objetivo: evolucionar Objetivos hacia planes/ciclos, Prioridades, Oportunidades y Seguimiento mediante releases compatibles y separadas.
- Especificación funcional durable: docs/planning/OBJ-02.md.
- Decisiones cerradas: tres planes no simultáneos; solo Búsqueda de un nuevo trabajo disponible; modalidades futuras como `Próximamente` con `Avísame`; Prioridades/IDs, networking e historia preservados; R1 se limita a `Tu punto de partida` compartido entre onboarding y Cuenta; importación del tutorial solo de contactos; Dashboard futuro renombrado y desocultado como Seguimiento con `¿Cómo voy?`, Total cafés y columna Oportunidades.
- R1 contratado: nuevo paso `Tu punto de partida` después de la introducción y antes de Objetivos; nombre, situación profesional estructurada y `Fecha_Inicio_Networking` obligatorios para nuevos usuarios; Cuenta comparte la misma fuente; completed no se reabre, in_progress no se reinicia y replay no escribe al navegar.
- Decisiones posteriores: contrato persistente de ciclos/backfill, privacidad de `Avísame`, máquina de estados/resultados, relaciones, lifecycle y semántica temporal de Seguimiento.
- Estado de R1: según evidencia confirmada por el owner, migration y tres verifiers ya PASS en DEV y PROD; el runtime permanece sin desplegar hasta merge autorizado, deployment verificado y smoke PROD.
- Out of scope actual: aplicar migrations o desplegar; implementar ciclos, Oportunidades, `Avísame` o Seguimiento; confundir OBJ-02 con PRODUCT-EVAL-01.
- Relación: siguiente iniciativa después del cierre INV-01.
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
