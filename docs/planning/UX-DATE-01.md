# UX-DATE-01 - Una fecha visible para networking y ciclo

## Estado y objetivo

- Status: `PLANNED / NOT CONTRACTED` para implementación; tercera en el orden beta, independiente de UX-ONB-COPY-01.
- Retirar la configuración independiente de `Fecha_Inicio_Networking` del onboarding, Cuenta y otras superficies visibles, para ofrecer una única fecha comprensible vinculada al inicio del ciclo de Objetivos.

## Decisiones aprobadas

- Evaluar que crear un ciclo establezca automáticamente la fecha interna de networking y que ambas permanezcan sincronizadas.
- Limitar a un máximo de un año hacia atrás el horizonte histórico de importación que corresponda; no modificar por ello el sync periódico ya desacoplado.
- Preservar datos existentes, ciclos históricos, RPCs, importaciones y sincronización periódica. No asumir que `Fecha_Inicio_Networking` solo gobierna importación.
- No alterar silenciosamente contratos persistentes PROD.

## Contrato pendiente y gates

- Decisión abierta principal: cuál será la única fecha visible y editable, con semántica precisa frente a inicio de ciclo y referencia interna de networking.
- Resolver explícitamente ausencia de ciclo activo, ciclos históricos, inicio/reinicio de ciclos y edición posterior; no atribuir fechas legacy inventadas ni sobrescribir datos sin decisión.
- Auditar todos los lectores/escritores y ventanas históricas antes de diseñar cambios. Hipótesis, no decisión: sincronizar la fecha interna mediante operación server-side transaccional.
- Puede requerir schema, RPC y migrations. Cualquier cambio incompatible es `PROD CONTRACT CHANGE`: compatibilidad, preflight de legacy, migration forward-only, verifiers, backup/recuperación y gates DEV/PROD separados.
- Excluye cambios del texto editorial del tutorial y reparación de Google Sync.
- Owner docs: `docs/PROD_CONTRACTS.md`, `docs/DATA_MODEL.md`, `docs/INGESTION_SYNC.md`, `docs/PRODUCT.md`.
