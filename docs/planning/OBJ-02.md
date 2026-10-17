# OBJ-02 - Nuevos Objetivos

## Estado y autoridad

- Status: `NOT CONTRACTED / DECISION REQUIRED`.
- Este documento conserva el diseño funcional aprobado y las decisiones pendientes de OBJ-02 hasta que la iniciativa sea promovida explícitamente al pipeline de ejecución.
- No autoriza implementación, cambios de schema, migrations ni cambios remotos.
- Los contratos estables de producto, dominio y datos se actualizarán en sus owner docs solo cuando OBJ-02 sea aprobado para implementación.

## Visión de producto

Coffeecito puede servir a tres necesidades de networking:

1. Búsqueda de un nuevo trabajo.
2. Generación de negocios.
3. Posicionamiento o marca personal.

La experiencia debe evolucionar hacia el concepto superior de un **objetivo de networking**. En la primera versión funcional solo estará habilitado `Búsqueda de nuevo trabajo`. Los otros dos tipos pueden mostrarse como futuros o no disponibles, pero no deben implementarse funcionalmente todavía.

La sección actual `Objetivos` se divide conceptualmente en dos niveles:

- `Mi objetivo`: el objetivo de networking activo del usuario.
- `Prioridades`: evolución nominal del bloque actual de Objetivos, conservando sus etiquetas estructuradas de empresas, industrias, cargos y funciones.

## Decisiones funcionales aprobadas

### Un objetivo activo y ciclos históricos

- Solo puede existir un objetivo de networking activo por usuario a la vez.
- El objetivo activo debe modelarse como un ciclo o instancia, no como un campo efímero.
- Reiniciar el mismo objetivo o cambiar a otro tipo en el futuro debe cerrar o archivar el ciclo anterior y crear uno nuevo.
- La historia no se elimina destructivamente.
- Para el usuario, Prioridades, Oportunidades y su gestión asociada vuelven a comenzar dentro del nuevo ciclo.
- Contactos e interacciones permanecen como patrimonio general de la red del usuario.
- En el futuro, la disponibilidad de otros tipos de objetivo puede depender del plan contratado. Esa lógica comercial no forma parte de la primera implementación.

### Mi objetivo

`Mi objetivo` debe permitir:

- seleccionar el tipo de objetivo;
- habilitar solo `Búsqueda de nuevo trabajo` en V1;
- definir una fecha de inicio editable;
- confirmar el objetivo.

La fecha de inicio del objetivo es conceptualmente distinta de `Fecha_Inicio_Networking`, que ya tiene contrato con importación histórica, sincronización e indicadores.

- Ambas fechas pueden inicializarse juntas durante onboarding si posteriormente se decide que conviene.
- Reiniciar o cambiar el objetivo no debe alterar la frontera histórica de importación.
- La fecha del objetivo requiere persistencia propia.

### Prioridades

- El concepto actual visible como `Objetivos` pasa a llamarse `Prioridades`.
- Conserva los tipos estructurados actuales: empresa, industria, cargo y función.
- Conserva su rol como etiquetas operativas asociables a contactos.
- Las Prioridades también podrán vincularse a Oportunidades.
- Deben pertenecer al ciclo de objetivo correspondiente para no mezclar etapas históricas distintas.

### Oportunidades

Se incorpora el objeto de dominio `Oportunidad`.

En `JOB_SEARCH`, una oportunidad representa una oportunidad o postulación laboral concreta. Debe incluir, al menos:

- nombre o título;
- link externo opcional;
- relación con varias Prioridades;
- relación con varios contactos desde V1;
- etapa o estado actual;
- timestamps relevantes;
- historial de cambios de estado.

Una Oportunidad debe relacionarse con varias personas desde el inicio. El diseño debe poder representar recruiter, headhunter, hiring manager, referido y otras personas relevantes. La UX y los roles exactos de estas relaciones siguen pendientes.

### Relación con interacciones

- Las Oportunidades deben poder vincular interacciones desde V1.
- Debe ser posible atribuir correos, cafés, reuniones u otras interacciones a una Oportunidad cuando corresponda.
- La relación explícita evita depender solamente de inferencias por contacto.
- La cardinalidad exacta y la UX de asociación siguen pendientes de arquitectura.
- La integración no debe romper el modelo actual de interacciones ni duplicar una interacción por Oportunidad.

### Flujo reutilizable de creación

- Debe existir un flujo visible y reutilizable para crear Oportunidades desde distintos contextos.
- Los contextos iniciales contemplados incluyen vista general, lista de contactos y ficha de contacto; deben poder agregarse otros en el futuro.
- El mismo flujo debe recibir contexto y prepoblar relaciones cuando corresponda.
- Si se crea una Oportunidad desde una ficha de contacto, ese contacto puede venir preseleccionado.
- No deben existir formularios divergentes por pantalla.

### Analítica futura

El modelo debe permitir analítica futura por Prioridad y por funnel, incluyendo:

- contactos;
- interacciones;
- cafés;
- referidos;
- oportunidades;
- ofertas;
- resultados exitosos;
- conversiones entre etapas.

El rediseño del Dashboard no forma parte de OBJ-02 en esta etapa. Sin embargo, schema, relaciones e historial temporal no deben impedir ese análisis posterior.

### Situación profesional del usuario

El usuario tendrá un atributo estructurado de situación profesional actual, editable desde onboarding y Cuenta, para inteligencia de negocio.

Valores iniciales previstos:

- `En transición / Desempleado`;
- `Empleado activo`;
- `Consultor / Independiente`.

Este atributo pertenece al usuario, no al ciclo de objetivo, y debe ser estructurado en vez de texto libre.

### Referidos

- `Referido` conserva su semántica actual: una persona recomendada por un contacto referente.
- No es un alias para una persona que aún no fue creada como contacto.
- El flujo de Oportunidad debe respetar esa semántica.
- Sigue pendiente diseñar cómo vincular un referido existente, convertir o crear un contacto cuando corresponda y asociarlo a una Oportunidad sin desnaturalizar el objeto Referral.

### Cierre, reinicio y cambio de objetivo

- Cerrar o reiniciar un objetivo afecta el espacio operativo de su ciclo: Prioridades, Oportunidades, asociaciones y derivados de gestión del ciclo.
- No debe borrar contactos, interacciones ni otros datos generales de la red.
- Si una interacción está vinculada a una Oportunidad de un ciclo cerrado, la interacción continúa existiendo y su relación queda histórica.
- Este comportamiento no debe reutilizar ni confundirse con `reset_current_user_app_data_v0_1`, cuyo propósito y perímetro son diferentes.

## Propuesta pendiente: estados de Oportunidad

La máquina de estados no está aprobada todavía.

La propuesta de trabajo actual separa `etapa` de `resultado` para no mezclar progreso con cierre:

`Identificada` -> `Postulado` -> `En proceso/entrevistas` -> `Oferta recibida` -> `Cerrada`

Al cerrar, se registraría un resultado separado, por ejemplo:

- éxito;
- rechazo de la empresa;
- retirada por el usuario;
- oferta declinada;
- sin avance;
- otro;
- razón opcional.

Esta propuesta debe revisarse y aprobarse antes de implementar. También sigue abierto si una oferta será solo una etapa o evento de Oportunidad, o si posteriormente requerirá un objeto propio.

## Realidad actual que debe auditarse

Estos puntos describen la base conocida y deben verificarse contra repo y schema cuando OBJ-02 sea contratado:

- `objectives` representa hoy las prioridades profesionales mediante tipos persistidos `COMPANY`, `INDUSTRY`, `ROLE` y `FUNCTION`, con prioridad `HIGH`, `MEDIUM` o `LOW`.
- `contact_objective_assignments` relaciona contactos y objetivos many-to-many.
- No se ha decidido si las tablas físicas deben renombrarse. El contrato visible sí debe denominar el concepto `Prioridades`.
- Debe evaluarse si conviene una evolución compatible de las estructuras actuales o una migration más profunda.
- `Fecha_Inicio_Networking` vive en `user_settings` y no debe reinterpretarse como fecha del objetivo activo.
- Las interacciones son objetos locales con participantes y fuentes externas; la relación con Oportunidades debe integrarse sin duplicarlas.

## Decisiones pendientes

Antes de implementar deben resolverse explícitamente:

- máquina de etapas y resultados de una Oportunidad laboral;
- semántica y roles de las relaciones Oportunidad-Contacto;
- cardinalidad Oportunidad-Interacción y UX de asociación;
- versionado y archivo de Prioridades y Oportunidades por ciclo;
- estrategia de migración para los `objectives` actuales;
- comportamiento exacto al reiniciar el mismo objetivo;
- comportamiento al cambiar de tipo de objetivo en el futuro;
- reglas de unicidad y lifecycle;
- presentación del selector de los tres objetivos en onboarding y `Mi objetivo`;
- ubicación del estado profesional del usuario: `profiles` u otra estructura;
- métricas y funnel mínimos necesarios para asegurar trazabilidad sin diseñar todavía el Dashboard;
- tratamiento de referidos al vincular personas con Oportunidades;
- si una oferta requiere en el futuro un objeto propio.

## Alcance previsto de la primera implementación

### Incluido

- Solo el objetivo `Búsqueda de nuevo trabajo`.
- Ciclo de objetivo único y activo.
- Prioridades asociadas al ciclo.
- Oportunidades laborales.
- Relaciones de Oportunidades con múltiples contactos e interacciones.
- Historial suficiente para preservar ciclos y habilitar analítica futura.
- Situación profesional estructurada del usuario.

### Excluido

- Generación de negocios.
- Posicionamiento o marca personal.
- Rediseño del Dashboard.
- Múltiples objetivos activos simultáneos.
- Eliminación destructiva de historia al cambiar o reiniciar objetivo.
- Reinterpretar `Fecha_Inicio_Networking` como fecha del objetivo.
- Monetización o planes, más allá de no impedir un gating futuro.
- Migrations remotas o cambios PROD sin un gate separado.

## Próximo paso antes de contratar implementación

Realizar una auditoría focal de arquitectura y schema que revise la implementación real de:

- `objectives` y sus asignaciones;
- contactos e interacciones;
- referidos;
- onboarding;
- user settings;
- RLS y contratos de escritura.

La auditoría debe proponer un contrato mínimo compatible para ciclos de objetivo, Prioridades, Oportunidades, relaciones con contactos e interacciones e historial de estados. No debe implementar. Después de revisar esa propuesta, OBJ-02 podrá dividirse en releases pequeños y recién entonces contratar implementación por fases.

Owner docs probables para esa auditoría: `docs/PRODUCT.md`, `docs/DOMAIN_MODEL.md`, `docs/DATA_MODEL.md`, `docs/SECURITY_ACCESS.md`, `docs/PROD_CONTRACTS.md` si se propone un cambio persistente.
