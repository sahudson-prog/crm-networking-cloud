# Operating model

Este documento orquesta como usar el resto de la documentacion. No contiene reglas detalladas para Codex; esas viven en `AGENTS.md`.

## Sistema documental minimo

| Documento | Rol | Tipo | Cuándo se actualiza |
|---|---|---|---|
| `AGENTS.md` | Reglas de comportamiento para Codex | Vivo | Cuando cambia como debe trabajar la IA |
| `docs/PRODUCT_DETAIL_AND_VISION.md` | Producto, experiencia y vision | Vivo | Cuando cambia o nace una funcionalidad visible |
| `docs/BACKLOG.md` | Ideas y pendientes granularizados | Vivo | Cada vez que entra, cambia o se prioriza trabajo |
| `docs/CURRENT_PLAN.md` | Plan de trabajo priorizado | Vivo | Al revisar prioridades o cerrar hitos |
| `docs/RULES_MASTER.md` | Maestro de reglas del Coach IA | Vivo | Cuando cambia una regla, condicion, variable o trigger |
| `docs/CURRENT_DATA_MODEL.md` | Modelo de datos actual | Referencia viva | Solo si cambian tablas, columnas o formatos actuales |
| `docs/DATA_MODEL_BLUEPRINT.md` | Diseno futuro de datos | Blueprint | Si cambia la arquitectura de datos objetivo |
| `docs/ARCHITECTURE_CURRENT.md` | Arquitectura e inventario de funciones actual | Referencia viva | Si cambia la estructura del codigo |
| `docs/QA_CHECKLIST.md` | Validaciones minimas | Vivo | Si aparece una validacion nueva o un riesgo recurrente |

## Flujo agil del proyecto

1. La vision nace en `PRODUCT_DETAIL_AND_VISION.md`.
2. Todo lo pendiente se baja a filas pequenas en `BACKLOG.md`.
3. Lo priorizado se ordena en `CURRENT_PLAN.md`.
4. Las reglas programables del Coach IA se definen en `RULES_MASTER.md`.
5. Codex implementa siguiendo `AGENTS.md`.
6. QA se valida con `QA_CHECKLIST.md`.
7. Al aprobar cambios, se actualizan los documentos de estado real: producto, arquitectura, modelo actual, reglas o plan.

## Control anti duplicidad

Antes de agregar una funcionalidad, ajuste de diseno, regla, componente, tabla, accion interna, documento o item de backlog, Codex debe revisar si ya existe algo igual, similar o contradictorio.

Fuentes a revisar segun el tipo de pedido:

| Tipo de pedido | Revisar primero |
|---|---|
| Producto, UX o flujo visible | `PRODUCT_DETAIL_AND_VISION.md`, `BACKLOG.md`, `CURRENT_PLAN.md` |
| Diseno visual o componentes UI | `UI_STYLE_GUIDE.md`, vista oculta `/?page=iconos`, `ARCHITECTURE_CURRENT.md` |
| Regla del Coach IA | `RULES_MASTER.md`, `DATA_MODEL_BLUEPRINT.md`, `BACKLOG.md` |
| Datos, tablas o schema futuro | `CURRENT_DATA_MODEL.md`, `DATA_MODEL_BLUEPRINT.md`, `cloud/supabase/schema_v0_1.sql` |
| Arquitectura o funciones | `ARCHITECTURE_CURRENT.md`, `AGENTS.md`, codigo actual |
| Backlog o plan | `BACKLOG.md`, `CURRENT_PLAN.md` |

Si aparece algo similar, Codex debe informar:

- que elemento similar encontro;
- donde esta documentado o implementado;
- por que puede ser duplicidad, solapamiento o contradiccion;
- recomendacion concreta: reutilizar, fusionar, extender, renombrar, reemplazar o crear separado.

Solo se crea una pieza nueva cuando hay una diferencia clara de proposito, alcance, datos o comportamiento. Si no, se actualiza lo existente y se registra el cambio en el historial correspondiente.

## Regla de componentes reutilizables

- Antes de ajustar un objeto visible, revisar si aparece o podria aparecer en mas de una vista.
- Si puede reutilizarse, crear o modificar un componente global con parametros de contexto, tamaño o variante.
- Las vistas deben orquestar componentes, no duplicar diseño ni logica visual.
- Excepciones: prototipos rapidos o comportamientos experimentales pueden vivir localmente, pero deben pasar al backlog como deuda si se mantienen.

## Reglas para backlog y plan

- El backlog guarda posibilidades, pendientes e ideas. No es necesariamente compromiso.
- El plan actual guarda lo que se va a ejecutar proximamente. Si algo no esta priorizado, debe vivir solo en backlog.
- Una misma idea grande puede generar varias filas de backlog.
- El plan debe referenciar items del backlog cuando sea posible.
- En cada revision de hito, se decide que entra, que sale y que cambia de prioridad.

## Cierre de hito

En un cierre de hito se revisa:

- que quedo implementado;
- que quedo pendiente;
- que riesgos aparecieron;
- que documentos deben actualizarse;
- que items del backlog cambian de estado;
- que entra al siguiente plan.

## Versionado documental

Cuando se actualicen documentos relevantes, registrar el cambio en la seccion `Historial` del documento afectado o en `CURRENT_PLAN.md` si es un cambio de plan.

## Historial

- 2026-07-21: Se agrega regla de componentes reutilizables para evitar ajustar el mismo objeto visual por separado en cada vista.
- 2026-07-27: Se agrega control anti duplicidad para revisar codigo y documentos antes de crear nuevas funciones, reglas, componentes o items de backlog.
