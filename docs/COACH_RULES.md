# Coach Rules

## Propósito

Este documento describe las reglas vigentes del Coach en la aplicación cloud. Su foco es explicar qué sugerencias se generan, con qué datos se evalúan y qué acciones internas pueden ejecutar.

La fuente de verdad operacional es el código actual en `cloud/web/lib/coachRuleEngine.ts`, `cloud/web/lib/coachConfig.ts`, `cloud/web/lib/coachActions.ts` y el schema de Supabase. Este documento no define reglas futuras ni reemplaza el contrato de acciones internas.

## Modelo actual

El Coach funciona hoy como un sistema de reglas determinísticas. Revisa contactos e interacciones, genera sugerencias en `todos` y puede ejecutar acciones internas ya soportadas.

La evaluación principal vive en `reviewNetworkingStatusSuggestions`. Puede revisar todos los contactos del usuario o una lista específica de contactos. Aunque su nombre menciona estado de networking, también evalúa la regla de empresa headhunter detectada.

Las sugerencias se guardan como ToDos con:

- `todo_type`;
- `engine_type`;
- `status`;
- `object_type` y `object_id`;
- estado actual y estado sugerido;
- resumen, razón y evidencia;
- acciones estructuradas en `actions_json`;
- `dedup_key`;
- `source_fingerprint`.

## Reglas vigentes

### Cambio a Contactado

Propone pasar un contacto a `Contactado` cuando:

- el contacto está activo;
- el contacto está marcado como foco de networking;
- su estado actual está por debajo de `Contactado`;
- existe al menos una interacción de tipo `email` o `message` con dirección `outbound`.

Tipo de sugerencia: `NETWORKING_STATUS_CHANGE`.

Regla interna: `STATUS_CONTACTED_FROM_OUTBOUND_MESSAGE`.

Acción propuesta: `contact.update_networking_status`.

### Cambio a Agendado

Propone pasar un contacto a `Agendado` cuando:

- el contacto está activo;
- el contacto está marcado como foco de networking;
- su estado actual está por debajo de `Agendado`;
- existe una interacción de tipo `calendar` con fecha futura.

Tipo de sugerencia: `NETWORKING_STATUS_CHANGE`.

Regla interna: `STATUS_SCHEDULED_FROM_FUTURE_EVENT`.

Acción propuesta: `contact.update_networking_status`.

### Cambio a Cita concretada por cita pasada

Propone pasar un contacto a `Cita concretada` cuando:

- el contacto está activo;
- el contacto está marcado como foco de networking;
- su estado actual está por debajo de `Cita concretada`;
- existe una interacción de tipo `calendar` con fecha igual o anterior al momento de revisión.

Tipo de sugerencia: `NETWORKING_STATUS_CHANGE`.

Regla interna: `STATUS_MEETING_DONE_FROM_PAST_EVENT`.

Acción propuesta: `contact.update_networking_status`.

### Cambio a Cita concretada por minuta

Propone pasar un contacto a `Cita concretada` cuando:

- el contacto está activo;
- el contacto está marcado como foco de networking;
- su estado actual está por debajo de `Cita concretada`;
- existe una interacción de tipo `calendar` pasada con minuta registrada en `user_notes_raw`.

Tipo de sugerencia: `NETWORKING_STATUS_CHANGE`.

Regla interna: `STATUS_MEETING_DONE_FROM_MINUTE`.

Acción propuesta: `contact.update_networking_status`.

### Cambio a Agradecimiento enviado

Propone pasar un contacto a `Agradecimiento enviado` cuando:

- el contacto está activo;
- el contacto está marcado como foco de networking;
- su estado actual es al menos `Cita concretada` y está por debajo de `Agradecimiento enviado`;
- existe una cita pasada;
- existe un mensaje saliente posterior a esa cita.

Tipo de sugerencia: `NETWORKING_STATUS_CHANGE`.

Regla interna: `STATUS_THANK_YOU_FROM_POST_MEETING_MESSAGE`.

Acción propuesta: `contact.update_networking_status`.

### Empresa headhunter detectada

Propone completar la empresa de un contacto headhunter cuando:

- el contacto está activo;
- el contacto está marcado como headhunter;
- el campo empresa está vacío;
- algún dominio de correo del contacto coincide con una única empresa del maestro de empresas headhunter.

Tipo de sugerencia: `HEADHUNTER_COMPANY_DETECTED`.

Regla interna: `HEADHUNTER_COMPANY_DETECTED`.

Acción propuesta: `contact.update_company`.

Esta regla no reemplaza una empresa existente. Si el contacto ya tiene empresa, no genera sugerencia.

## Prelación

Para reglas de estado de networking, el revisor elige una sola sugerencia por contacto. Si más de una condición se cumple, se usa esta prioridad interna:

1. `STATUS_THANK_YOU_FROM_POST_MEETING_MESSAGE`;
2. `STATUS_MEETING_DONE_FROM_MINUTE`;
3. `STATUS_MEETING_DONE_FROM_PAST_EVENT`;
4. `STATUS_SCHEDULED_FROM_FUTURE_EVENT`;
5. `STATUS_CONTACTED_FROM_OUTBOUND_MESSAGE`.

La regla de empresa headhunter se evalúa aparte. Por eso un contacto puede tener simultáneamente una sugerencia de cambio de estado y una sugerencia para completar empresa.

No existe hoy un motor común de prelación entre familias de reglas. La prelación confirmada aplica dentro de las reglas de estado.

## Configuración vigente

La configuración por usuario vive en `todo_configs`. Si faltan configuraciones base, la app las crea con:

- `engine_type`: `RULE`;
- `action_scope`: `in_app`;
- `enabled`: `true`;
- `user_mode`: `confirm_always`.

Los modos disponibles son:

- `confirm_always`: mostrar sugerencia y pedir confirmación antes de ejecutar;
- `execute_without_asking`: ejecutar automáticamente cuando la regla lo permite y la acción es interna;
- `do_not_suggest`: desactivar la sugerencia para ese usuario.

El schema permite `HYBRID`, `AI` y `external_action`, pero no hay reglas vigentes de esos tipos en el motor actual. La configuración visible filtra las reglas aprobadas en código.

## Ciclo de vida de sugerencias

El Coach crea o actualiza ToDos activos. Cada sugerencia tiene un `dedup_key` para evitar duplicados del mismo caso.

Cuando una sugerencia equivalente ya existe como activa, la app actualiza su contenido en lugar de crear otra fila nueva.

Cuando una sugerencia activa ya no corresponde, el revisor la cierra como:

- `auto_resolved`, si el contacto ya cumple el estado o dato sugerido;
- `expired`, si la condición dejó de aplicar y no está resuelta.

Cuando una sugerencia con el mismo `dedup_key` ya fue marcada como `done` o `dismissed`, el revisor no la vuelve a abrir.

La tabla `object_review_state` registra el resultado de revisiones por objeto y procesador. En el código actual sirve como registro de revisión; no se observa que sea usada para saltarse evaluaciones futuras.

## Gatilladores confirmados

La revisión de reglas se puede ejecutar desde:

- el panel del Coach, al pedir revisión manual;
- cambios masivos de contactos en la tabla;
- cambios de estado desde el tablero de contactos;
- acciones de contacto guardadas desde la app;
- acciones de interacción que afectan contactos;
- aplicación de previews de sincronización que devuelven contactos afectados;
- orquestación de sincronización de actividad cuando identifica contactos afectados.

Estos gatilladores son llamadas de aplicación. No se observa un trigger de base de datos que ejecute el Coach automáticamente ante cualquier cambio.

## Acciones ejecutables

El Coach puede ejecutar hoy solo acciones internas implementadas en `coachActions`:

- `contact.update_networking_status`, para cambiar el estado de networking de un contacto;
- `contact.update_company`, para completar empresa cuando la sugerencia corresponde;
- `todo.dismiss`, para descartar sugerencias seleccionadas.

Las ejecuciones registran `action_invocations` y `audit_log`. Si una sugerencia no corresponde a un tipo soportado, la ejecución queda como no soportada.

La definición completa de acciones, permisos, confirmaciones y auditoría pertenece a `ACTIONS.md`.

## Límites actuales

El Coach no genera texto libre con IA en el modelo vigente observado.

El Coach no escribe en proveedores externos.

El Coach no crea contactos, no fusiona contactos y no importa datos desde proveedores.

El Coach no reemplaza manualmente la revisión humana salvo que el usuario configure una regla permitida como `execute_without_asking`.

El Coach no contiene hoy un sistema general de expiración temporal, score probabilístico, familias dinámicas ni resolución avanzada de conflictos entre reglas.

## Deuda factual

El nombre `reviewNetworkingStatusSuggestions` es más estrecho que su responsabilidad actual, porque también revisa empresa headhunter.

El schema ya contempla motores `HYBRID` y `AI`, pero el motor vigente confirmado es de reglas determinísticas.

`object_review_state` se escribe durante las revisiones, pero no se observa utilizado para omitir reevaluaciones futuras.

Algunas familias y agrupaciones existen en UI/configuración, pero la lógica de decisión sigue codificada de forma concreta en el revisor actual.
