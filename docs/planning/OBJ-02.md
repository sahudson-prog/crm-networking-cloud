# OBJ-02 - Nuevos Objetivos

## Estado y autoridad

- Status: R1 EN IMPLEMENTACIÓN LOCAL; MIGRATION Y RUNTIME NO DESPLEGADOS.
- Este documento conserva el diseño funcional aprobado, las conclusiones de la auditoría focal y las decisiones pendientes de OBJ-02. La entrega activa se limita a `Tu punto de partida` y su edición compartida entre onboarding y Cuenta.
- R1 autoriza implementación y validación locales. No autoriza aplicar migrations, desplegar, ni iniciar releases posteriores.
- Los contratos estables de producto, dominio y datos se actualizan junto con R1 sin presentar el candidato local como ya desplegado.
## Visión de producto

Coffeecito puede servir a tres necesidades de networking:

1. Búsqueda de un nuevo trabajo.
2. Generación de negocios.
3. Posicionamiento o marca personal.

La experiencia debe evolucionar hacia el concepto superior de un **plan de networking**. Cada uno de los tres grandes objetivos corresponde a un plan distinto y solo puede existir un plan activo por usuario, sin simultaneidad. En la primera versión funcional solo estará disponible `Búsqueda de un nuevo trabajo`. `Generación de negocios` y `Posicionamiento o marca personal` se muestran como `Próximamente`, con la acción `Avísame`, sin selector ni activación.

Los planes de networking son un concepto funcional distinto de los planes comerciales persistidos en `subscription_plans` y `plan_code`. Separarlos es la recomendación técnica vigente para preservar permisos y capabilities actuales, pero requiere aprobación como parte del futuro contrato persistente.

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
- En el futuro, la disponibilidad de otros planes de networking puede depender del plan comercial contratado. Esa lógica comercial no forma parte de las primeras entregas y no debe acoplarse anticipadamente a roles o capabilities actuales.

### Mi objetivo

`Mi objetivo` debe presentar los tres planes sin selector: `Búsqueda de un nuevo trabajo` es el único disponible y los otros dos aparecen como `Próximamente`, con `Avísame`. No se puede activar un plan futuro desde esta experiencia.

Cuando se contrate la entrega de ciclos, el plan disponible debe permitir definir una fecha de inicio editable y confirmar el ciclo activo. Solo puede existir un ciclo activo por usuario.

La fecha de inicio del objetivo es conceptualmente distinta de `Fecha_Inicio_Networking`, que ya tiene contrato con importación histórica, sincronización e indicadores.

- Ambas fechas pueden inicializarse juntas durante onboarding si posteriormente se decide que conviene.
- Reiniciar o cambiar el objetivo no debe alterar la frontera histórica de importación.
- La fecha del objetivo requiere persistencia propia.

### R1 - Tu punto de partida

R1 se limita a un paso inicial del tutorial llamado `Tu punto de partida` y a la edición de los mismos datos desde Cuenta:

- nombre para personalización;
- situación profesional;
- `Fecha_Inicio_Networking`.

`Tu punto de partida` es un paso nuevo después de la introducción y antes de la pantalla existente de Objetivos; no la reemplaza. Reutiliza el Coach, su burbuja, navegación y composición responsive del tutorial.

Onboarding y Cuenta comparten una única fuente de verdad y el mismo contrato estrecho de lectura/escritura. Para usuarios nuevos son obligatorios nombre, situación profesional y confirmación explícita de `Fecha_Inicio_Networking`. El catálogo aprobado usa códigos internos estables para `Con empleo`, `Sin empleo`, `Independiente / emprendiendo`, `Estudiando`, `Otra situación` y `Prefiero no indicar`.

Los valores existentes se precargan y nunca se sustituyen mediante defaults. `product_onboarding_v1` conserva su versión: usuarios `completed` mantienen acceso sin reabrir el first-run; recorridos `in_progress` conservan paso y datos sin reinicio; replay sigue siendo opcional y navegar no escribe automáticamente. En first-run, `Siguiente` valida y persiste antes de avanzar a Objetivos; un error mantiene el paso y permite reintentar. Guardar estos datos no inicia importaciones ni sync.

La etapa de importación del tutorial se dedica exclusivamente a contactos. Esta decisión no elimina las importaciones o sincronizaciones disponibles en Cuenta ni autoriza nuevos scopes o capacidades de proveedor.

### Avísame

Para cada modalidad futura, `Avísame` abre un popup con el texto:

> Confirma que quieres dejarnos tu correo para avisarte novedades o pruebas de esta modalidad.

El popup muestra el correo y la modalidad, con acciones `Confirmar` y `Cancelar`. Solo `Confirmar` persiste la modalidad, el correo vigente en ese momento y la identidad/fecha técnicas mínimas. Correo e identidad se derivan server-side de la autenticación; la modalidad debe ser válida, el acceso es privado y existe una sola solicitud por usuario/modalidad.

La primera versión no incluye panel, envíos, campañas, seguimiento de cambios de correo ni un sistema general de suscripciones. La consulta será SQL manual futura por el owner. Cancelar no persiste nada. Retirada, retención, eliminación de cuenta y eventual ejecución de avisos siguen siendo decisiones de contrato pendientes; esta finalidad no constituye consentimiento de marketing.

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
- Los contextos iniciales son vista general de Oportunidades, Prioridades y ficha de contacto; deben poder agregarse otros en el futuro sin saturar el listado de contactos.
- El mismo flujo debe recibir contexto y prepoblar relaciones cuando corresponda.
- Si se crea una Oportunidad desde una ficha de contacto, ese contacto puede venir preseleccionado.
- No deben existir formularios divergentes por pantalla.

### Seguimiento y ¿Cómo voy?

La vista actualmente llamada Dashboard pasa a llamarse `Seguimiento` y debe volver a la navegación visible. Su módulo `KPIs` se reemplaza por `¿Cómo voy?`:

- a la izquierda, una pirámide o embudo visual;
- a la derecha, el gráfico actual `Total cafés`, conservando las vistas semanal y mensual;
- los gráficos `Contactos realizados` y `Contactos headhunter realizados` se retiran de esta vista;
- el Coach se oculta solo en Seguimiento, sin eliminar su código ni impedir su reutilización futura en otra vista;
- la tabla visible de Objetivos/Prioridades incorpora `Oportunidades` inmediatamente después de `Prioridad`.

La pirámide tiene, de abajo hacia arriba:

1. `Contactados`: contactos únicos con estado `Contactado` o superior; excluye `Pendiente`.
2. `Cafés`: unión distinta de contactos únicos con estado `Cita concretada` o superior, o al menos un café válido de tipo cita/llamada. No suma condiciones ni cuenta eventos.
3. `Oportunidades`: oportunidades distintas no eliminadas, incluidas las cerradas.
4. `Ofertas totales`: oportunidades que efectivamente alcanzaron `Oferta recibida` u `Oferta exitosa`; excluye cierres sin oferta.
5. `Ofertas exitosas`: oportunidades con estado/resultado explícito `Oferta exitosa`; un cierre genérico no basta.

Se muestran las razones `% cafés/contactados`, `% oportunidades/cafés`, `% ofertas/oportunidades` y `% ofertas exitosas/ofertas`. Un denominador cero se presenta como `Sin base`. Los valores superiores a 100% no se truncan: los niveles mezclan unidades distintas y no deben presentarse como probabilidad estadística ni cohorte homogénea.

Un único toggle permite agrupar headhunters solo en `Contactados` y `Cafés`. Debe reutilizar la clasificación vigente y la clave canónica de empresa/dominio empleada en Contactos. Cada grupo cuenta una vez por nivel si al menos un miembro cumple la condición. El toggle no fusiona datos ni modifica Oportunidades, ofertas o el gráfico lateral.

Para preservar el hecho histórico de una oferta, la representación mínima recomendada es un historial de transiciones o eventos que diferencie `Oferta recibida` y `Oferta exitosa`: cada oportunidad cuenta una sola vez en ofertas totales si alcanzó cualquiera de ambas, y un cierre posterior no elimina ese hecho. Esta recomendación no aprueba por sí sola la máquina de estados completa ni autoriza inferir una oferta por el ordinal de `Cerrada` o inventar etapas/fechas.

La columna `Oportunidades` cuenta oportunidades abiertas distintas relacionadas explícitamente con cada Prioridad y el ciclo correspondiente. Una oportunidad puede aparecer en más de una fila; un total global debe usar la unión distinta y no la suma de filas.

Siguen abiertas la ventana temporal de cada nivel y la elegibilidad exacta de citas/llamadas. Deben quedar visibles y consistentes antes de publicar Seguimiento, pero no bloquean R1. Las discrepancias entre estado del contacto e interacciones no actualizan estados automáticamente.

### Situación profesional del usuario

El usuario tendrá una situación profesional actual editable desde onboarding y Cuenta y compartida por una única fuente de verdad.

El catálogo estructurado aprobado para R1 es:

- `employed`: `Con empleo`;
- `unemployed`: `Sin empleo`;
- `independent`: `Independiente / emprendiendo`;
- `studying`: `Estudiando`;
- `other`: `Otra situación`;
- `prefer_not_to_say`: `Prefiero no indicar`.

El atributo pertenece al perfil del usuario, no al ciclo. Es nullable para preservar perfiles legacy, aunque el first-run de usuarios nuevos exige confirmarlo.

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

Esta propuesta debe revisarse y aprobarse antes de implementar. Para Seguimiento se requiere distinguir explícitamente `Oferta recibida` y `Oferta exitosa`, conservar el hecho histórico de la oferta después del cierre y excluir cierres sin oferta. Sigue abierto si esto se representa mediante etapas/resultados, eventos de historial o, posteriormente, un objeto Oferta propio.

## Realidad actual auditada

- `objectives` representa las Prioridades mediante tipos `COMPANY`, `INDUSTRY`, `ROLE` y `FUNCTION`, con prioridad `HIGH`, `MEDIUM` o `LOW`; `contact_objective_assignments` las relaciona many-to-many con contactos. No existen ciclos ni Oportunidades persistidas.
- Los IDs de `objectives` y sus asociaciones son contratos usados por filtros, contactos y métricas. La evolución debe preservarlos. El borrado actual de un objetivo es físico y no sirve como cierre histórico.
- `Fecha_Inicio_Networking` vive en `user_settings` y nombre vive en `profiles`. Según evidencia operacional confirmada por el owner, R1 aplicó y verificó en DEV y PROD la columna nullable `profiles.professional_situation_code`, sus RPCs estrechas y el trigger de fecha; el runtime R1 continúa pendiente de merge, deployment y smoke PROD.
- El onboarding persistido usa `product_onboarding_v1` con estados `not_started`, `in_progress`, `dismissed` y `completed`, pasos conocidos y replay separado. Cambiar su versión o pasos sin transición compatible puede devolver usuarios al inicio.
- Las interacciones son objetos globales del usuario con participantes y fuentes externas. Las Oportunidades deben vincularlas sin duplicarlas. Merge de contactos y reset usan perímetros nominales que deberán evolucionar en las entregas correspondientes.
- `/dashboard` existe detrás de los gates privados, pero está oculto de la navegación, monta el Coach y calcula KPIs en cliente sobre lecturas con límites. Desocultarlo como Seguimiento requiere adaptar navegación, semántica y cobertura; no basta con reactivar código existente.
- El KPI actual `Contactos realizados` cuenta contactos con mensajes/correos, no contactos cuyo estado sea `Contactado` o superior. `Total cafés` cuenta interacciones calendar/call. Ninguno implementa todavía la pirámide aprobada.

## Recomendaciones técnicas pendientes de aprobación

- Separar tipos de planes de networking de `subscription_plans` y `plan_code` para conservar permisos actuales.
- Usar el modelo mínimo tipo de plan + ciclo; justificar cualquier entidad adicional por una cardinalidad o lifecycle real.
- Conservar `objectives` e IDs como Prioridades y añadir su pertenencia a ciclo mediante evolución compatible.
- Realizar un backfill conservador: preservar prioridades existentes, no inventar fecha de ciclo ni historial y distinguir usuarios nuevos, existentes con prioridades y existentes sin prioridades.
- Implementar cierre/archivo no destructivo; no reutilizar `deleteObjective` ni confundir cierre con `reset_current_user_app_data_v0_1`.
- Separar inicio de networking, inicio de ciclo y límites de recuperación por fuente.
- Entregar Oportunidades, relaciones e historial juntos para mantener transiciones y asociaciones coherentes y atómicas.
- Usar un formulario compartido desde ficha de contacto, Prioridades y vista general de Oportunidades.
- Calcular Oportunidades abiertas distintas por relación explícita Prioridad/ciclo y no sumar filas como total global.
- Modelar `Avísame` con unicidad usuario/modalidad, correo canónico server-side y acceso administrativo agregado, sin construir un sistema general de suscripciones.

## Decisiones pendientes por entrega

### R1 - Tu punto de partida

- el owner reportó PASS de preflight/captura, migration y tres verifiers en DEV y PROD; DEV también tiene smoke autenticado PASS de Cuenta, persistencia, tutorial, Coach, navegación, responsive 320 px y teclado/foco;
- el backup lógico PROD fue restaurado localmente con PASS para schema/datos, sin certificar ACL, roles ni configuración externa;
- first-run con usuario nuevo permanece diferido con cobertura automatizada;
- PR #42 permanece abierto: falta revisión/autorización de merge, deployment efectivo de Vercel y smoke PROD del runtime R1;
- no activar ni declarar R1 desplegado antes de completar esos gates.

### Planes, ciclos y Avísame

- aprobación del modelo persistente tipo de plan + ciclo y de la convención de backfill;
- semántica exacta al cerrar, reiniciar o cambiar de plan en el futuro;
- fecha de inicio desconocida para ciclos migrados y reglas de unicidad/lifecycle;
- retirada, retención y eliminación de solicitudes `Avísame`, además del procedimiento autorizado para un aviso futuro;
- compatibilidad de reset y eliminación de cuenta.

### Oportunidades

- máquina de etapas/resultados, saltos, reapertura y correcciones;
- representación mínima de `Oferta recibida` y `Oferta exitosa`, y si una Oferta será un objeto propio;
- roles de relaciones Oportunidad-Contacto;
- cardinalidad y UX Oportunidad-Interacción;
- tratamiento de referidos al vincular personas;
- versionado, archivo, merge y reset.

### Seguimiento

- universo temporal de cada nivel de la pirámide;
- elegibilidad exacta de una cita/llamada como café válido;
- comportamiento de filtros y ciclo seleccionado;
- fuente completa de agregaciones sin límites silenciosos;
- semántica visible de razones que mezclan contactos, eventos y oportunidades.

Estas decisiones de Seguimiento no bloquean R1.

## Releases funcionales previstos

1. **R1 - Tu punto de partida:** nombre, situación profesional y `Fecha_Inicio_Networking` compartidos entre onboarding y Cuenta; importación del tutorial solo de contactos. Preserva onboarding V1, completed, in_progress, replay y todos los datos existentes. No incluye ciclos, Oportunidades, Avísame ni Seguimiento.
2. **Planes, ciclos y Prioridades:** persistencia y backfill compatible, un único ciclo activo, archivo histórico y adaptación de consumidores. `Avísame` puede salir como subentrega independiente cuando estén aprobadas privacidad y retención.
3. **Oportunidades:** entidad, relaciones, historial y formulario compartido en una misma entrega, junto con las extensiones necesarias de merge/reset.
4. **Seguimiento:** navegación visible, `¿Cómo voy?`, gráfico `Total cafés`, toggle headhunter, columna Oportunidades y retiro focal del Coach y de los dos gráficos reemplazados.

Cada release persistente exige clasificación `PROD CONTRACT CHANGE`, migration/verifiers nuevos, compatibilidad con el runtime anterior, backup/recuperación ensayados y gates DEV/PROD separados. No se agrupa todo el schema en R1.

## Próxima fase

R1 tiene su contrato persistente verificado en DEV y PROD según evidencia confirmada por el owner. La próxima fase, si se autoriza, es el merge manual de PR #42, la comprobación del deployment efectivo y el smoke PROD del runtime. Los releases posteriores continúan fuera de alcance.

Owner docs relevantes para R1: `docs/UI_SYSTEM.md`, `docs/DATA_MODEL.md`, `docs/SECURITY_ACCESS.md`, `docs/TESTING.md` y `docs/PROD_CONTRACTS.md` si se aprueba un cambio persistente.
