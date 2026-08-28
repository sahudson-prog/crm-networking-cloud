# Rules master

Este documento define el maestro vivo de reglas del Coach IA. Su foco inicial son reglas `RULE`, es decir, reglas programables sin lectura IA.

## Principios

- Cada regla tiene una sola condicion booleana principal.
- Si la condicion es `TRUE` y no existe ToDo activo, se crea la sugerencia.
- Si la condicion es `TRUE` y ya existe ToDo activo, se mantiene activa.
- Si la condicion pasa a `FALSE` y existe ToDo activo, se cierra con motivo.
- Los triggers se derivan de las variables requeridas: si cambia una variable usada por una regla, se debe reevaluar esa regla para el objeto afectado.
- La revision periodica al cargar Dashboard funciona como red de seguridad, no como unico mecanismo.
- Este documento distingue reglas implementadas de reglas catalogadas aun no implementadas.
- En cloud no se deben copiar automaticamente todas las reglas existentes en la app legado. Cada regla debe revisarse una por una, definir condicion booleana, variables, evidencia, accion, prelacion, tier minimo y modo de automatizacion permitido, y migrarse solo con confirmacion explicita del usuario.

## Estados de cierre sugeridos

| Estado cierre | Cuando usarlo |
|---|---|
| `Auto-completado` | La accion sugerida ya ocurrio por otra via, por ejemplo el usuario cambio manualmente el estado. |
| `Obsoleto` | La sugerencia ya no aplica porque cambio el contexto, por ejemplo contacto desactivado o fuera de foco. |
| `Reemplazado` | Una regla mas avanzada aplica para el mismo objeto y vuelve innecesaria la sugerencia anterior. |
| `Descartado` | El usuario descarto manualmente la sugerencia. |
| `Error` | La regla no pudo revisarse por datos corruptos o falla tecnica. |

## Variables comunes

| Variable | Fuente actual | Uso |
|---|---|---|
| `contact.Google_ID` | Contactos consolidados | Identificar contacto y unir con interacciones. |
| `contact.Estado_CRM` | Contactos consolidados / Sheet | Estado oficial de networking. |
| `contact.Scope_Networking` | Contactos consolidados / Sheet | Determina si participa del flujo activo. |
| `contact.Estado_Contacto` | Contactos consolidados / Sheet | Permite excluir contactos desactivados. |
| `interaction.Google_ID` | Interacciones | Asociar interaccion al contacto. |
| `interaction.Tipo` | Interacciones | Distinguir email, mensaje, WhatsApp, cita/reunion, llamada, etc. |
| `interaction.Fecha` | Interacciones | Evaluar temporalidad y evidencia. |
| `interaction.Rol_Email` | Interacciones | Identificar direccion saliente en emails/mensajes. |
| `interaction.De_Hacia_Contacto` | Interacciones legacy | Fallback para identificar direccion saliente. |
| `interaction.ID_Entrada` | Interacciones | Guardar evidencia en el ToDo. |
| `interaction.Thread_ID` | Interacciones Gmail | Contexto para hilos y deduplicacion futura por thread si aplica. |

## Funciones logicas existentes

| Funcion | Uso |
|---|---|
| `normalizar_estado_networking(estado)` | Normaliza estados legacy al modelo oficial. |
| `nivel_estado_networking(estado)` | Compara avance relativo entre estados. |
| `parse_fecha_interaccion(valor)` | Convierte fecha de interaccion a fecha comparable. |
| `es_interaccion_saliente(row)` | Determina si email/mensaje/WhatsApp fue saliente. |

## Guard comun de contacto

Las reglas de estado de networking deben partir por este guard:

```text
contact.Google_ID != ""
AND contact.Estado_Contacto != "Desactivado"
AND contact.Scope_Networking == TRUE
```

Si un ToDo activo deja de cumplir este guard:

- `Estado_Contacto == "Desactivado"` -> cerrar como `Obsoleto`, motivo `contacto desactivado`.
- `Scope_Networking != TRUE` -> cerrar como `Obsoleto`, motivo `contacto fuera de foco`.
- `Google_ID == ""` -> cerrar como `Error` u `Obsoleto`, segun si es falla de datos o contacto no gestionable.

## Reglas RULE implementadas

Estas reglas existen hoy en `sugerir_estado_networking_para_contacto`.

## Prelacion de reglas de estado

Cuando mas de una regla cumple condiciones para el mismo contacto, el motor debe crear o mantener solo la sugerencia de mayor prelacion. Si ya existe una sugerencia abierta de menor prelacion para el mismo contacto y mismo estado sugerido, se reemplaza por la superior.

| Prelacion | Regla | Resultado sugerido | Motivo |
|---|---|---|---|
| 10 | `STATUS_THANK_YOU_FROM_POST_MEETING_MESSAGE` | `Agradecimiento enviado` | Estado mas avanzado del flujo. |
| 20 | `STATUS_MEETING_DONE_FROM_MINUTE` | `Cita concretada` | Minuta cargada es evidencia mas fuerte que solo fecha vencida. |
| 30 | `STATUS_MEETING_DONE_FROM_PAST_EVENT` | `Cita concretada` | Fecha de cita ya paso. |
| 40 | `STATUS_SCHEDULED_FROM_FUTURE_EVENT` | `Agendado` | Hay cita futura. |
| 50 | `STATUS_CONTACTED_FROM_OUTBOUND_MESSAGE` | `Contactado` | Hay mensaje/correo saliente. |

## Familias de reglas

Las familias se definen por el objeto principal y el campo/accion de negocio que la regla intenta modificar. Esto evita que dos reglas compitan solo porque ambas aplican al mismo contacto, cuando en realidad actualizan cosas distintas.

| Familia | Objeto | Campo/accion afectada | Regla de competencia |
|---|---|---|---|
| `contact.networking_status` | Contacto | Estado oficial de networking | Solo debe quedar una sugerencia activa por contacto. Si cumplen varias reglas, gana la de mayor prelacion. |
| `contact.company_from_headhunter_master` | Contacto | Empresa del contacto marcada por maestro headhunter | Puede coexistir con una sugerencia de estado, porque no modifica la misma variable. |

Toda regla nueva debe declarar, antes de implementarse: `family_key`, objeto principal, variable o accion afectada, condicion booleana, variables trigger, evidencia, accion interna, dedupe, cierre, prelacion dentro de la familia, tipo de configuracion usuario y tier minimo.

La configuracion visible del Coach debe agruparse por estas familias, no por tecnologia interna (`RULE`, `HYBRID`, `AI`). Las categorias visibles actuales son:

| Categoria visible | Familia |
|---|---|
| Estado networking | `contact.networking_status` |
| Empresa headhunter | `contact.company_from_headhunter_master` |

### STATUS_CONTACTED_FROM_OUTBOUND_MESSAGE

| Campo | Definicion |
|---|---|
| Tipo_ToDo | `NETWORKING_STATUS_CHANGE` |
| Tipo config usuario | `RULE_STATUS_TO_CONTACTED` |
| Motor_Tipo | `RULE` |
| Objeto principal | `Contacto` |
| Accion sugerida | Cambiar `Estado_CRM` a `Contactado` |
| Condicion booleana | `COMMON_CONTACT_GUARD AND nivel(contact.Estado_CRM) < nivel("Contactado") AND exists interaction where interaction.Google_ID == contact.Google_ID AND parse_fecha_interaccion(interaction.Fecha) is valid AND es_interaccion_saliente(interaction) == TRUE` |
| Variables trigger | `contact.Google_ID`, `contact.Estado_CRM`, `contact.Scope_Networking`, `contact.Estado_Contacto`, `interaction.Google_ID`, `interaction.Tipo`, `interaction.Fecha`, `interaction.Rol_Email`, `interaction.De_Hacia_Contacto` |
| Evidencia | Hasta 3 `interaction.ID_Entrada` salientes mas recientes. |
| Dedup_Key actual | `NETWORKING_STATUS_CHANGE\|STATUS_CONTACTED_FROM_OUTBOUND_MESSAGE\|contact.Google_ID\|Contactado` |
| Si pasa a FALSE | Si `nivel(contact.Estado_CRM) >= nivel("Contactado")`, cerrar `Auto-completado`. Si falla el guard, cerrar segun motivo comun. Si no existe interaccion saliente, cerrar `Obsoleto` por evidencia no vigente. |

### STATUS_SCHEDULED_FROM_FUTURE_EVENT

| Campo | Definicion |
|---|---|
| Tipo_ToDo | `NETWORKING_STATUS_CHANGE` |
| Tipo config usuario | `RULE_STATUS_TO_SCHEDULED` |
| Motor_Tipo | `RULE` |
| Objeto principal | `Contacto` |
| Accion sugerida | Cambiar `Estado_CRM` a `Agendado` |
| Condicion booleana | `COMMON_CONTACT_GUARD AND nivel(contact.Estado_CRM) < nivel("Agendado") AND exists interaction where interaction.Google_ID == contact.Google_ID AND interaction.Tipo in ["cita", "reunion"] AND parse_fecha_interaccion(interaction.Fecha) > today` |
| Variables trigger | `contact.Google_ID`, `contact.Estado_CRM`, `contact.Scope_Networking`, `contact.Estado_Contacto`, `interaction.Google_ID`, `interaction.Tipo`, `interaction.Fecha`, `today` |
| Evidencia | Hasta 3 `interaction.ID_Entrada` de citas futuras mas proximas. |
| Dedup_Key actual | `NETWORKING_STATUS_CHANGE\|STATUS_SCHEDULED_FROM_FUTURE_EVENT\|contact.Google_ID\|Agendado` |
| Si pasa a FALSE | Si `nivel(contact.Estado_CRM) >= nivel("Agendado")`, cerrar `Auto-completado`. Si la cita paso y aplica `STATUS_MEETING_DONE_FROM_PAST_EVENT`, cerrar `Reemplazado`. Si falla el guard, cerrar segun motivo comun. Si no existe cita futura, cerrar `Obsoleto` por evidencia no vigente. |

### STATUS_MEETING_DONE_FROM_PAST_EVENT

| Campo | Definicion |
|---|---|
| Tipo_ToDo | `NETWORKING_STATUS_CHANGE` |
| Tipo config usuario | `RULE_STATUS_TO_MEETING_DONE` |
| Motor_Tipo | `RULE` |
| Objeto principal | `Contacto` |
| Accion sugerida | Cambiar `Estado_CRM` a `Cita concretada` |
| Condicion booleana | `COMMON_CONTACT_GUARD AND nivel(contact.Estado_CRM) < nivel("Cita concretada") AND exists interaction where interaction.Google_ID == contact.Google_ID AND interaction.Tipo in ["cita", "reunion"] AND parse_fecha_interaccion(interaction.Fecha) <= today` |
| Variables trigger | `contact.Google_ID`, `contact.Estado_CRM`, `contact.Scope_Networking`, `contact.Estado_Contacto`, `interaction.Google_ID`, `interaction.Tipo`, `interaction.Fecha`, `today` |
| Evidencia | Hasta 3 `interaction.ID_Entrada` de citas pasadas mas recientes. |
| Dedup_Key actual | `NETWORKING_STATUS_CHANGE\|STATUS_MEETING_DONE_FROM_PAST_EVENT\|contact.Google_ID\|Cita concretada` |
| Si pasa a FALSE | Si `nivel(contact.Estado_CRM) >= nivel("Cita concretada")`, cerrar `Auto-completado`. Si falla el guard, cerrar segun motivo comun. Si no existe cita pasada, cerrar `Obsoleto` por evidencia no vigente. |

### STATUS_MEETING_DONE_FROM_MINUTE

| Campo | Definicion |
|---|---|
| Tipo_ToDo | `NETWORKING_STATUS_CHANGE` |
| Tipo config usuario | `RULE_STATUS_TO_MEETING_DONE` |
| Motor_Tipo | `RULE` |
| Objeto principal | `Contacto` |
| Accion sugerida | Cambiar `Estado_CRM` a `Cita concretada` |
| Condicion booleana | `COMMON_CONTACT_GUARD AND nivel(contact.Estado_CRM) < nivel("Cita concretada") AND exists interaction where interaction.Google_ID == contact.Google_ID AND interaction.Tipo in ["cita", "reunion"] AND parse_fecha_interaccion(interaction.Fecha) <= today AND trim(interaction.Notas_Usuario_Crudo) != ""` |
| Variables trigger | `contact.Google_ID`, `contact.Estado_CRM`, `contact.Scope_Networking`, `contact.Estado_Contacto`, `interaction.Google_ID`, `interaction.Tipo`, `interaction.Fecha`, `interaction.Notas_Usuario_Crudo`, `today` |
| Evidencia | Hasta 3 `interaction.ID_Entrada` de citas pasadas con minuta cargada. |
| Dedup_Key actual | `NETWORKING_STATUS_CHANGE\|STATUS_MEETING_DONE_FROM_MINUTE\|contact.Google_ID\|Cita concretada` |
| Si pasa a FALSE | Si `nivel(contact.Estado_CRM) >= nivel("Cita concretada")`, cerrar `Auto-completado`. Si falla el guard, cerrar segun motivo comun. Si la minuta se vacia o la cita deja de ser pasada, cerrar `Obsoleto`. |

### STATUS_THANK_YOU_FROM_POST_MEETING_MESSAGE

| Campo | Definicion |
|---|---|
| Tipo_ToDo | `NETWORKING_STATUS_CHANGE` |
| Tipo config usuario | `RULE_STATUS_TO_THANK_YOU` |
| Motor_Tipo | `RULE` |
| Objeto principal | `Contacto` |
| Accion sugerida | Cambiar `Estado_CRM` a `Agradecimiento enviado` |
| Condicion booleana | `COMMON_CONTACT_GUARD AND nivel(contact.Estado_CRM) >= nivel("Cita concretada") AND nivel(contact.Estado_CRM) < nivel("Agradecimiento enviado") AND exists past_meeting where past_meeting.Google_ID == contact.Google_ID AND past_meeting.Tipo in ["cita", "reunion"] AND parse_fecha_interaccion(past_meeting.Fecha) <= today AND exists outbound_after_meeting where outbound_after_meeting.Google_ID == contact.Google_ID AND parse_fecha_interaccion(outbound_after_meeting.Fecha) >= parse_fecha_interaccion(latest_past_meeting.Fecha) AND es_interaccion_saliente(outbound_after_meeting) == TRUE` |
| Variables trigger | `contact.Google_ID`, `contact.Estado_CRM`, `contact.Scope_Networking`, `contact.Estado_Contacto`, `interaction.Google_ID`, `interaction.Tipo`, `interaction.Fecha`, `interaction.Rol_Email`, `interaction.De_Hacia_Contacto`, `today` |
| Evidencia | `ID_Entrada` de la ultima cita pasada y hasta 3 interacciones salientes posteriores. |
| Dedup_Key actual | `NETWORKING_STATUS_CHANGE\|STATUS_THANK_YOU_FROM_POST_MEETING_MESSAGE\|contact.Google_ID\|Agradecimiento enviado` |
| Si pasa a FALSE | Si `nivel(contact.Estado_CRM) >= nivel("Agradecimiento enviado")`, cerrar `Auto-completado`. Si falla el guard, cerrar segun motivo comun. Si no existe cita pasada o mensaje posterior, cerrar `Obsoleto` por evidencia no vigente. Si `Estado_CRM` baja de `Cita concretada`, cerrar `Obsoleto` por prerequisito no vigente. |

## Ideas RULE no implementadas

Estas existen solo como ideas de diseno. No deben existir en `todo_configs`, no deben aparecer en la configuracion del Coach y no deben crear sugerencias hasta que el usuario apruebe cada una con condicion, evidencia, accion, prelacion, tier y pruebas.

| Tipo_ToDo | Estado | Nota |
|---|---|---|
| `CALENDAR_ACTION` | Catalogada | Falta definir reglas concretas de crear, revisar o confirmar cita. |
| `DATA_CONFLICT_REVIEW` | Catalogada | Falta definir conflictos especificos entre fuentes. |
| `SYNC_REVIEW` | Catalogada | Falta definir cambios de sync que generan revision. |

## Regla RULE implementada para maestro headhunter

### HEADHUNTER_COMPANY_DETECTED

| Campo | Definicion |
|---|---|
| Tipo_ToDo | `HEADHUNTER_COMPANY_DETECTED` |
| Tipo config usuario | `HEADHUNTER_COMPANY_DETECTED` |
| Motor_Tipo | `RULE` |
| Objeto principal | `Contacto` |
| Accion sugerida | Registrar al contacto como headhunter en la empresa oficial detectada, completando `Empresa`. |
| Condicion booleana | `contact.Estado_Contacto != "Desactivado" AND contact.Marca_Headhunter == TRUE AND trim(contact.Empresa) == "" AND exactly_one(master_company where contact email/domain matches company domain)` |
| Variables trigger | `contact.Empresa`, `contact.Marca_Headhunter`, `contact.Estado_Contacto`, `contact_emails.email`, `contact_emails.domain`, `headhunter_companies`, `headhunter_company_domains` |
| Evidencia | Dominio coincidente y empresa oficial del maestro. |
| Mensaje usuario | `Registra a {contacto} como headhunter, en {empresa}` |
| Dedup_Key actual | `HEADHUNTER_COMPANY_DETECTED\|contact.id\|headhunter_company.id\|domain` |
| Si pasa a FALSE | Si `Empresa` ya coincide con la sugerida, cerrar `Auto-completado`. Si el contacto deja de ser headhunter o queda ambiguo/no resuelto, cerrar `Obsoleto`. |

## Ideas ubicadas fuera del Coach por ahora

Estas ideas existen solo en documentacion/backlog, pero no se implementan como reglas del Coach en este ciclo para evitar mezclar responsabilidades.

| Idea | Donde vive por ahora | Motivo |
|---|---|---|
| `HH_DOMAIN_REVIEW` | UI de contactos/editor y maestro headhunter | La regla vigente es simple: si un contacto marcado como headhunter no calza con el maestro, mostrar warning visual; si calza, mostrar icono headhunter. |
| `CONTACT_ADD_EMAIL` | Preview de sincronizacion y edicion de contacto | Agregar correos detectados viene del flujo de importacion/sync, no de una recomendacion conversacional del Coach por ahora. |
| `FOLLOW_UP_REMINDER` | Dashboard, por definir | Los recordatorios de seguimiento se revisaran dentro del diseno del Dashboard, no como burbujas individuales del Coach en este sprint. |

## Modelo de evaluacion propuesto

Para cada regla y objeto afectado:

```text
condition_result = evaluate(rule.boolean_condition, object_context)

IF condition_result == TRUE AND no active todo for rule/object/dedup:
    create todo

IF condition_result == TRUE AND active todo exists:
    keep todo active and update last_review

IF condition_result == FALSE AND active todo exists:
    close todo with close_status and failed_condition_detail
```

## Triggers derivados

El motor no deberia mantener una lista manual de botones o pantallas. Debe usar dependencias:

Estado cloud actual: la app ya usa estas dependencias para revisar reglas cuando el usuario ejecuta la revision del Coach y tambien dispara revisiones acotadas al contacto afectado despues de cambios relevantes en contactos, interacciones o aplicaciones de sync/import desde fuentes conectadas. La revision periodica/manual sigue existiendo como red de seguridad.

| Si cambia | Reglas candidatas |
|---|---|
| `contact.Estado_CRM` | Reglas de estado de networking del contacto. |
| `contact.Scope_Networking` | Reglas que usan foco/scope. |
| `contact.Estado_Contacto` | Reglas que excluyen desactivados. |
| Nueva/actualizada interaccion email, mensaje o WhatsApp | Reglas que usan interacciones salientes. |
| Nueva/actualizada cita/reunion | Reglas de agendado, cita concretada y agradecimiento. |
| Cambio en correos, marca headhunter, empresa o maestro de empresas headhunter | Reglas de empresa headhunter detectada y revision de ambiguedades. |
| Cambio de fecha actual (`today`) | Reglas dependientes del paso del tiempo, revisadas periodicamente. |

## Historial

- 2026-07-17: Se crea maestro inicial con las cuatro reglas `RULE` implementadas para cambios de estado de networking.
- 2026-07-20: Se agrega separacion entre `Tipo_ToDo` base y `Tipo config usuario` para configurar reglas concretas desde la UI.
- 2026-07-20: Se agrega regla `STATUS_MEETING_DONE_FROM_MINUTE` para sugerir cita concretada cuando una cita pasada tiene minuta cargada.
- 2026-07-20: Se documenta prelacion explicita de reglas de estado y reemplazo de sugerencias inferiores abiertas.
- 2026-07-28: Se porta la primera version cloud del motor `RULE` de estados a `cloud/web/lib/coachRuleEngine.ts`, usando datos disponibles en Supabase, dedupe estable, prelacía y `object_review_state`.
- 2026-08-21: Se implementa `HEADHUNTER_COMPANY_DETECTED` para mover la deteccion positiva por dominio al Coach, en vez de mostrarla dentro del editor de contacto.
- 2026-08-21: Se explicita el concepto de familias de reglas por objeto/campo afectado, para separar prelacía de estado networking de reglas que modifican otros datos como empresa headhunter.
- 2026-08-21: Cloud agrega gatillos acotados por contacto despues de editar datos/contacto, foco, marca headhunter, estado networking, crear/editar interacciones, archivar interacciones o aplicar sync/import de contactos/interacciones; las opciones de automatizacion se aseguran desde `todo_configs` por usuario.
- 2026-08-21: La configuracion del Coach pasa a agruparse por familia/variable afectada: Estado networking y Empresa headhunter.
