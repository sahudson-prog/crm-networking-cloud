# Acciones internas

Este documento describe el estado actual de las acciones internas de CRM Networking cloud. Su objetivo es ordenar lo que existe hoy, no diseñar una plataforma nueva.

## Hallazgo central

No existe todavía un contrato común completo y aplicado uniformemente para las acciones internas.

Sí existe un patrón parcial alrededor de:

- funciones compartidas de negocio en `cloud/web/lib`;
- algunas RPCs de Supabase para operaciones profundas;
- registros parciales en `action_invocations`;
- registros parciales en `audit_log`;
- logs operativos de sincronización en `sync_run_logs`;
- autorización mediante capacidades en algunos flujos;
- confirmación distribuida principalmente por UI o por la propia operación;
- reutilización parcial desde Coach.

Por lo tanto, este documento debe leerse como una fotografía del modelo actual, con sus inconsistencias explícitas.

## Qué se considera acción interna

En la práctica actual, una acción interna es una operación que cambia datos de la app y representa una intención de negocio reconocible: crear o editar un contacto, cambiar un estado, fusionar contactos, descartar una interacción, aplicar una importación revisada o ejecutar una sugerencia del Coach.

No todas las escrituras a Supabase están modeladas con el mismo nivel de formalidad. Algunas son acciones con invocación y auditoría; otras son mutaciones directas desde helpers específicos.

## Componentes observados

Las acciones actuales se apoyan principalmente en:

- helpers de negocio en `cloud/web/lib/*Actions.ts`;
- `contactSyncApply.ts` para aplicar previews de contactos;
- `externalInteractionSync.ts` para crear o actualizar interacciones desde fuentes externas;
- `coachActions.ts` para ejecutar sugerencias soportadas;
- RPCs en `cloud/supabase` para operaciones transaccionales;
- componentes UI que solicitan confirmación antes de llamar la acción.

Las tablas relacionadas son:

- `action_invocations`, usada por varios flujos para registrar intención, ejecución o falla;
- `audit_log`, usada por varios flujos para registrar cambios de negocio;
- `sync_run_logs`, usada para diagnóstico paso a paso de importaciones y sincronizaciones;
- `todos`, usada para persistir sugerencias o tareas del Coach.

`sync_run_logs` tiene un propósito técnico distinto: ayuda a diagnosticar una corrida de sincronización, pero no reemplaza por sí sola la auditoría de negocio.

## Familias reales

### Mutaciones de negocio

Incluyen crear y editar contactos, interacciones manuales, referidos, objetivos y asignaciones de objetivos.

Contactos, interacciones y referidos tienen una trazabilidad más completa: suelen crear `action_invocations`, escribir `audit_log` y marcar la invocación como ejecutada o fallida.

Objetivos y asignaciones existen como acciones reales en `objectiveActions.ts`, pero no tienen todavía la misma cobertura de `action_invocations` y `audit_log`.

### Operaciones transaccionales o de alto impacto

Incluyen operaciones que afectan muchas relaciones o borran datos del usuario.

Hoy destacan dos RPCs:

- `merge_contacts_deep`, para fusionar contactos guardados;
- `reset_current_user_app_data_v0_1`, para reiniciar los datos personales de app del usuario autenticado.

Ambas están implementadas como RPCs de base de datos y concentran cambios sobre varias tablas.

### Aplicación de sincronización

La sincronización distingue revisión y aplicación.

En contactos, `applyContactSyncPreview` aplica los cambios seleccionados desde un preview. Registra una invocación general de `sync.contacts.apply_preview`, actualiza contactos y vínculos externos, guarda snapshots de proveedor y escribe auditoría por cambio aplicado.

En correos y calendario, el flujo termina en interacciones externas. `syncExternalInteraction` crea o actualiza interacciones y fuentes externas, agrega participantes faltantes y registra una invocación de sistema con `interaction.sync_external`.

El detalle de preview, cursores, proveedores y lectura incremental pertenece a `INGESTION_SYNC.md`.

### Acciones ejecutables desde Coach

Coach persiste sugerencias como ToDos. Algunas sugerencias contienen acciones estructuradas que pueden ejecutarse desde `coachActions.ts`.

Hoy las acciones soportadas son:

- cambiar el estado de networking de un contacto;
- completar la empresa de un contacto headhunter cuando corresponde a una empresa detectada.

Cuando ejecuta una sugerencia soportada, Coach actualiza el objeto de negocio, cierra o actualiza el ToDo asociado y registra trazabilidad en los flujos implementados.

Las condiciones de reglas, precedencia, agrupación, deduplicación y configuración detallada pertenecen a `COACH_RULES.md`.

### Administración y configuración

Incluye cambios de plan, roles, maestros globales, ajustes de usuario y cuentas conectadas.

Algunas operaciones verifican capacidades como `admin.manage_access`, `admin.manage_global_masters` o `data.delete_account`. La cobertura de auditoría no es uniforme en toda esta familia.

El modelo completo de permisos y perfiles pertenece a `SECURITY_ACCESS.md`.

## Confirmación y autorización

No existe una compuerta central universal de confirmación.

La realidad actual es mixta:

- algunos flujos confirman en la UI con diálogos o prompts;
- algunas invocaciones guardan `requires_confirmation` y `confirmed_at`;
- algunas RPCs validan frases o condiciones propias;
- algunas acciones validan capacidades antes de ejecutarse;
- otras dependen de precondiciones del helper o de RLS.

El borrado de datos personales combina confirmación en UI con una frase exacta validada por la RPC. Las aplicaciones de sync se confirman mediante selección y botón de aplicación en el preview.

## merge_contacts_deep

`merge_contacts_deep` fusiona contactos guardados del mismo usuario.

Inputs importantes:

- `p_target_contact_id`: contacto resultante;
- `p_source_contact_ids`: contactos origen;
- `p_result`: resultado elegido para nombre, empresa, cargo, estado, foco, headhunter, correos y teléfonos;
- `p_source`: texto de origen del flujo.

La función acepta máximo tres contactos en total: un contacto resultante y hasta dos contactos origen.

Validaciones reales:

- debe existir usuario autenticado;
- debe existir contacto resultante;
- debe existir al menos un origen;
- el resultante no puede repetirse como origen;
- todos los contactos deben pertenecer al usuario;
- el nombre resultante es obligatorio;
- el estado de networking debe estar dentro de la lista oficial;
- correos y teléfonos seleccionados no pueden pertenecer a contactos fuera del grupo fusionado.

Efectos reales:

- actualiza el contacto resultante;
- reemplaza correos y teléfonos del grupo por los elegidos;
- reasigna identidades externas al resultante;
- reasigna participantes de interacciones;
- elimina participantes duplicados que queden tras la reasignación;
- reasigna referidos donde los contactos origen eran referentes o contactos vinculados;
- reasigna ToDos de contacto;
- mueve o elimina estados de revisión asociados al contacto cuando corresponde;
- desactiva los contactos origen;
- registra `action_invocations` con `contact.merge_deep`;
- registra `audit_log` con `contact.merge_deep`.

Al ser una función PostgreSQL invocada como una sola operación, sus cambios se ejecutan dentro de la transacción de esa llamada. Si falla antes de completar, la operación no queda parcialmente aplicada.

## reset_current_user_app_data_v0_1

`reset_current_user_app_data_v0_1` reinicia los datos de app del usuario autenticado.

La RPC exige:

- usuario autenticado;
- frase exacta `BORRAR MIS DATOS`;
- capability literal `data.delete_account`.

Aunque la capability se llama `data.delete_account`, la función no elimina la cuenta de autenticación.

Elimina datos del usuario en categorías principales como contactos, correos y teléfonos de contacto, identidades y snapshots externos, interacciones, participantes, fuentes externas, objetivos, referidos, ToDos, cursores, logs de sincronización, límites/eventos de uso, exports, batches, ajustes de usuario, cuentas conectadas, `action_invocations` y `audit_log`.

Sí elimina `connected_accounts` del usuario.

Conserva:

- `auth.users`;
- `profiles`;
- roles;
- planes;
- auspicios;
- organizaciones y membresías;
- maestros globales.

El flujo UI agrega una confirmación visual previa y luego pide escribir la frase exacta.

No se observa una invocación o auditoría persistente propia del reset después de ejecutarlo. La función borra las filas del usuario en `action_invocations` y `audit_log`, y el wrapper actual no crea un registro posterior separado.

Como función PostgreSQL invocada en una sola llamada RPC, opera dentro de la transacción de esa llamada.

## Límites actuales del modelo

- `action_invocations` no es registro universal.
- `audit_log` no cubre todas las mutaciones.
- La confirmación está distribuida por flujo.
- La autorización está distribuida entre capabilities, RLS y validaciones locales.
- Los nombres, inputs y outputs de acciones no siguen una convención única en todo el código.
- Algunas familias, especialmente objetivos y administración, tienen menor trazabilidad que contactos, interacciones y referidos.
