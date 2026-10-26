# INV-01 - Invitaciones V1

## Estado y autoridad

- Status: COMPLETED. PR #39 y PR #40 están integrados en la release b5f37cf78254de556bfe5f66d50c2fce5f515676; la activación futura sigue requiriendo una decisión separada.
- Este documento conserva el contrato funcional V1 aprobado y el diseño técnico mínimo recomendado para invitaciones.
- SQL 202610250001 y 202610250002 están aplicadas y verificadas en DEV y PROD. El smoke real de invitación y registro en PROD fue PASS. PROD mantiene ambos controles en false y capacidad 10; DEV mantiene ambos controles en false. Los invitados quedan free/user sin Google Sync.
- El smoke real de Magic Link en PROD fue PASS como modalidad existente de acceso; no es un requisito de INV-01 V1. Google Login de un invitado y Web Share nativo no quedaron certificados por ese smoke.
- Antes de implementar, cualquier cambio persistente o de acceso debe tratarse como PROD CONTRACT CHANGE según docs/PROD_CONTRACTS.md.
## Contrato funcional V1 aprobado

### Acceso e identidad

- Una invitación es una autorización temporal por email alternativa a la allowlist administrativa existente.
- No existe un rol temporal de invitado ni un sistema Auth paralelo.
- La autenticación funcional de Invitaciones V1 utiliza Google Login existente. Magic Link no se implementa ni se exige para INV-01; la alternativa de email preexistente no se amplía por este contrato. Google Login no concede autorización para Google Sync.
- La invitación solo se convierte de `pending` a `registered` después de una primera autenticación válida del email invitado y con email verificado.
- La conversión ocurre mediante un bootstrap autenticado y transaccional, antes de los gates de aceptación legal y onboarding.
- Una identidad Auth creada pero nunca autenticada y verificada no consume definitivamente un cupo ni convierte la invitación en registro.
- Un registro confirmado conserva acceso aunque posteriormente se cumplan las 120 horas desde la autorización.
- Una invitación vencida no abre el signup ni concede acceso por sí sola, pero tampoco bloquea un futuro registro público del mismo email ni exige una nueva invitación únicamente por haber vencido. La capacidad global y la suspensión de registros del programa Beta de invitaciones no restringen ese futuro registro público.
- Los bloqueos administrativos explícitos de seguridad prevalecen en cualquier modalidad de admisión. Una invitación nunca reactiva automáticamente una cuenta `blocked`, `closed` o revocada.
- La beta cerrada existente conserva su acceso, plan y rol. El flujo de invitaciones no degrada ni reescribe usuarios legacy.

### Estados y vigencia

- El ciclo mínimo distingue `pending`, `registered`, `expired` y `cancelled`.
- Una autorización `pending` es válida durante exactamente 120 horas desde `authorized_at`.
- Al vencer sin registro, libera automáticamente su reserva global y devuelve el cupo personal al invitador, una sola vez.
- La expiración se calcula al leer o mutar estado; no requiere cron ni contadores redundantes.
- La cancelación anticipada solo aplica a invitaciones `pending` y requiere `admin.manage_access`.
- Cancelar libera la reserva global y el cupo personal una sola vez. No afecta usuarios ya registrados.
- Una cancelación administrativa por seguridad no puede eludirse mediante una reinvitación ordinaria inmediata; su liberación posterior requiere una decisión administrativa explícita.
- Reabrir el `mailto` de una invitación pendiente no crea otra invitación, no consume otro cupo y no renueva su vigencia.

### Cupos personales y capacidad global

- Cada usuario elegible dispone de 5 cupos personales.
- Los usuarios registrados mediante invitación también pueden invitar con el mismo máximo de 5.
- Un cupo personal se ocupa por una invitación pendiente vigente o por una invitación convertida en registro.
- Una invitación `registered` consume definitivamente el cupo personal del invitador.
- Una invitación vencida sin registro o cancelada devuelve el cupo una sola vez.
- Reiniciar datos propios no restablece cupos consumidos por registros ni altera la capacidad global.
- Revocar o bloquear a un usuario registrado no libera automáticamente el cupo personal ni la capacidad global. Esto no anticipa decisiones legales de eliminación o retención.
- La capacidad global inicial de 500 pertenece exclusivamente al programa Beta de invitaciones y debe ser editable desde Mantención.
- La capacidad usada equivale a usuarios registrados por invitación más invitaciones pendientes vigentes.
- Las reservas pendientes vigentes se consideran antes de autorizar una nueva invitación para no sobrepasar la capacidad.
- Al alcanzar la capacidad se bloquean nuevas invitaciones con un mensaje positivo que indica que se podrá volver a invitar cuando se liberen cupos.
- Las invitaciones pendientes conservan su validez y los usuarios registrados conservan su acceso al alcanzar el máximo.

### Controles operativos

- Existen dos controles globales independientes:
  - pausar nuevas invitaciones;
  - suspender nuevos registros por invitación.
- Pausar invitaciones impide nuevas autorizaciones, sin invalidar pendientes ni accesos registrados.
- Suspender registros impide conversiones nuevas de `pending` a `registered`, sin afectar beta legacy ni usuarios ya registrados.
- La pausa y la suspensión pertenecen exclusivamente al programa Beta de invitaciones y no restringen un futuro registro público.
- La reanudación no extiende ni renueva invitaciones vencidas durante una suspensión.
- La autorización, conversión, expiración materializada y cancelación requieren enforcement server-side, atomicidad y auditoría.

### Planes, roles y capacidades

- Un nuevo usuario registrado por invitación recibe plan `free` y rol `user`.
- Los usuarios de la beta cerrada conservan su plan, acceso y rol `beta_tester`.
- La capacidad de invitar debe estar disponible para `user` y `beta_tester` mientras los controles operativos lo permitan.
- Durante esta etapa, la importación y sincronización de datos Google quedan disponibles solo para `beta_tester`.
- Antes del rollout es obligatorio demostrar y aplicar el enforcement de Google exclusivo de `beta_tester` en grants persistidos, overrides y todas las operaciones server-side relevantes.
- Los límites comerciales de `free` se auditan y deciden por separado. El valor catalogado actual `max_contacts = 200` no demuestra enforcement efectivo y no debe asumirse como límite aplicado por el runtime.

## UX V1 aprobada

- La cabecera muestra una acción con icono de café y contador de cupos personales disponibles.
- La acción abre un diálogo compacto con:
  - disponibles de 5;
  - campo email;
  - título `Invitar a Coffeecito`, campo `Email` y acción `Autorizar`.
- Autorizar reserva cupo y capacidad de forma server-side antes de ofrecer opciones para compartir.
- Tras autorizar: `Invitación autorizada. Avísale a tu contacto usando este link!`. `este link!` es un botón inline accesible ligado a la invitación confirmada, independiente de cambios posteriores en Email.
- Compartir comienza desde un gesto nuevo del usuario mediante Web Share, con fallback Correo (`mailto`), WhatsApp y Copiar enlace. Nunca se abre automáticamente después de esperar la RPC ni se afirma envío, entrega o lectura. El enlace público no incluye email, identidad ni token y no concede acceso por sí mismo.
- El diálogo incluye una lista simple de invitaciones pendientes y registradas.
- Las pendientes muestran su vencimiento.
- Reabrir `mailto` reutiliza la autorización existente sin consumir otro cupo ni renovar la vigencia.
- Deben existir mensajes distintos para:
  - cupos personales agotados;
  - cupos que se recuperarán próximamente por vencimiento;
  - capacidad global completa.
- No se incluye dashboard, gestor avanzado, edición de invitaciones, reenvío gestionado ni mensajería interna.

## Diseño técnico mínimo recomendado

Este diseño documenta la dirección técnica V1 implementada. Cualquier cambio posterior de nombres, SQL o comportamiento requiere una tarea contratada y su gate de contrato persistente correspondiente.

### Persistencia autoritativa

- Agregar una entidad de invitaciones con, como mínimo: identidad, `inviter_user_id`, email normalizado, `authorized_at`, `expires_at`, estado, `registered_user_id`, `registered_at`, datos de cancelación y timestamps de lifecycle.
- `expires_at` debe derivarse server-side como `authorized_at + interval '120 hours'`.
- Mantener una única invitación pendiente vigente por email y evitar que un mismo usuario registrado se asocie a más de una conversión activa.
- Agregar configuración global autoritativa para capacidad máxima, pausa de invitaciones y suspensión de registros.
- No persistir contadores de cupos ni capacidad. Calcularlos desde filas `pending` vigentes y `registered` bajo la misma transacción que autoriza o convierte.
- Conservar evidencia mínima de lifecycle para hacer idempotentes expiración y cancelación y para auditar sin registrar contenido de correos ni secretos.

### Frontera Auth y acceso

- Extender el Before User Created Hook para admitir una identidad cuando el email pertenezca a la allowlist legacy activa o tenga una invitación `pending` vigente y los registros por invitación no estén suspendidos. El hook no convierte la invitación ni consume definitivamente el cupo.
- Después de obtener una sesión válida, ejecutar un bootstrap autenticado antes de consultar el gate de acceso privado.
- El bootstrap deriva `auth.uid()` y el email desde Auth; no acepta `user_id` ni email autoritativo enviados por el cliente.
- Debe exigir email verificado y coincidencia exacta con el email normalizado de la invitación.
- La conversión `pending` -> `registered`, la asignación `free`/`user` y la habilitación del acceso deben ocurrir en una sola transacción.
- El bootstrap debe ser idempotente para el mismo usuario y no debe reactivar perfiles `blocked`, `closed` o revocados.
- El resolver de acceso debe aceptar dos fuentes durables sin confundirlas: allowlist legacy activa para beta existente o invitación `registered` para el nuevo flujo.
- Una invitación vencida no debe producir un rechazo permanente por email: deja de ser una fuente de autorización, pero no exige una nueva invitación para un registro público futuro, que no queda sujeto a la capacidad ni a la suspensión del programa Beta de invitaciones. Una cancelación administrativa por seguridad requiere una resolución administrativa explícita antes de permitir una reinvitación ordinaria.

### Concurrencia y locks

- Mantener un orden de locks estable: configuración global, invitación o identidad normalizada y perfil de acceso afectado.
- Obtener el instante transaccional único para evaluar las 120 horas después de adquirir los locks pertinentes y usar ese mismo instante en toda la decisión transaccional.
- Antes de contar reservas, materializar semánticamente como no vigentes las pendientes cuyo `expires_at` ya se cumplió.
- La autorización debe validar atómicamente capability del invitador, sus 5 cupos, capacidad global, pausa y duplicados.
- La conversión debe bloquear la invitación y volver a validar vigencia, suspensión de registros, email verificado y bloqueos administrativos.
- Convertir `pending` a `registered` no incrementa la capacidad usada: transforma una reserva ya contada.
- Expiración y cancelación deben ser idempotentes para que dos transacciones no liberen dos veces el mismo cupo.

### RPCs, RLS y superficie cliente

- Exponer RPCs estrechas para:
  - listar invitaciones y cupos del usuario actual;
  - autorizar una invitación del usuario actual;
  - ejecutar el bootstrap de acceso del usuario autenticado;
  - cancelar pendientes y cambiar controles globales desde administración.
- Derivar ownership desde `auth.uid()` y comprobar capabilities dentro de cada RPC `SECURITY DEFINER` con owner, `search_path` y grants canónicos.
- No conceder DML directo a roles cliente sobre invitaciones o configuración global.
- La cancelación y configuración operativa requieren `admin.manage_access`.
- La capability de invitar debe resolverse mediante el modelo existente de roles, planes y overrides, sin checks hardcoded de UI como control de seguridad.
- El reset de datos propios no debe borrar invitaciones autoritativas, restaurar cupos ni modificar la capacidad global.

## Migrations y verifiers necesarios

La foundation siguiente fue consolidada en 202610250001_invitation_access_v1.sql por PR #39 y complementada por 202610250002_invitation_admin_state_v1.sql en PR #40. Ambas están aplicadas y verificadas en DEV y PROD; no se reescriben.

1. **Fundación de invitaciones, inicialmente inerte**
   - tablas, constraints, índices, configuración global y capability;
   - RLS habilitado, sin DML directo de cliente;
   - RPCs de consulta, autorización y administración estrechas;
   - controles globales creados en estado seguro para impedir activación accidental.
2. **Bootstrap y evolución compatible del acceso**
   - Before User Created Hook compatible con allowlist legacy e invitación pendiente vigente;
   - bootstrap autenticado transaccional;
   - resolver de acceso compatible con beta legacy y registros por invitación;
   - asignación `free`/`user` sin degradar `beta_tester` ni reactivar bloqueados.
3. **Entitlements obligatorios antes de rollout**
   - capability de invitaciones para `user` y `beta_tester`;
   - separación efectiva de Google import/sync para `beta_tester` en grants persistidos, overrides y operaciones server-side;
   - auditoría separada de límites comerciales Free, sin asumir que el catálogo actual aplique `max_contacts = 200` en runtime.

Cada migration requiere verifier estructural para existencia, constraints, owners, RLS, policies, grants, `SECURITY DEFINER`, `search_path` y superficie `EXECUTE`. Los verifiers de comportamiento deben cubrir:

- 5 cupos personales y capacidad 500 bajo concurrencia real;
- frontera exacta de 120 horas;
- expiración y cancelación con liberación única;
- conversión idempotente y carrera expiración/registro;
- Google Login con email verificado;
- identidad Auth creada pero nunca autenticada;
- email existente, invitación repetida y `mailto` reabierto;
- pausa de invitaciones y suspensión de registros;
- beta legacy intacta;
- bloqueados, cerrados y revocados sin reactivación;
- aislamiento cross-user y rechazo de IDs manipulados;
- reset sin restitución de cupos ni alteración global;
- rollback completo ante fallos.

La prueba de concurrencia debe usar sesiones PostgreSQL reales; una secuencia de llamadas no certifica carreras.

## Secuencia de implementación completada

1. PR #39 integrado: backend inerte, schema, configuración cerrada, RLS, RPCs, Hook, bootstrap y resolver compatibles.
2. PR #40 integrado: interfaz, compartir, lista compacta, bootstrap previo al gate y Mantención. Google Login es el recorrido funcional V1; Google Sync mantiene su elegibilidad separada.
3. Promoción completada: SQL 001 + 002, verificadores y smoke real de invitación/registro PASS en PROD. Los controles globales permanecen cerrados; la capacidad PROD es 10.
## Riesgos y decisiones operacionales pendientes

- La capability `invitations.authorize` y su enforcement efectivo están implementados en PR 1; verificar asignaciones reales por ambiente antes de activar, sin inferirlas del seed.
- Auditar y aprobar los límites efectivos de `free`; el catálogo actual no demuestra por sí solo enforcement completo del runtime ni permite asumir que `max_contacts = 200` esté aplicado.
- Google Login de un invitado y su `email_confirmed_at` no quedaron certificados por el smoke Magic Link; crear `auth.users` no basta como prueba de primera autenticación.
- PR 1 implementa levantamiento explícito mediante `admin.manage_access`, actor, fecha y justificación; no autoriza una nueva invitación por sí mismo. Validar el recorrido administrativo DEV antes de activar.
- PR #39 conserva lifecycle y eventos autoritativos fuera del reset y ofrece depuración de PII prescindible a 90 días. La automatización operacional de retención sigue pendiente; no se contrata eliminación de cuenta.
- La suspensión no renueva pendientes: pueden vencer mientras los registros están suspendidos. Mantener esa semántica en el smoke DEV.
- Levantar un preflight de usuarios beta existentes, planes y roles antes de cualquier backfill para evitar degradaciones o reactivaciones.

La interfaz integrada no activa los controles. Cualquier activación futura permanece sujeta a revisión y autorización separadas.

### Integración de interfaz entregada

- El bootstrap autenticado resuelve antes de consultar acceso central, aceptación legal y onboarding. Un fallo inicial mantiene el contenido privado desmontado y permite reintentar; los motivos internos no se exponen al invitado.
- Cupos, capacidad, flags y vencimientos provienen de las RPCs. La interfaz no conserva contadores autoritativos ni infiere permisos a partir del rol.
- Mantención consume admin_invitation_program_state_v1, admin_update_invitation_program_v1, admin_cancel_invitation_v1 y admin_lift_invitation_email_block_v1. La lectura administrativa expone solo configuración y conteos agregados, depende exclusivamente de admin.manage_access y no activa nada al montar la pantalla.
- La RPC de lectura administrativa se instaló mediante la migration aditiva 202610250002_invitation_admin_state_v1.sql, ya aplicada y verificada en ambos ambientes. No reescribe 202610250001 ni modifica los controles cerrados.
- La promoción aplicó SQL 202610250001 y 202610250002, verificadores focales y 202610250001_verify_access_invitation_composed.sql antes del runtime PR #40. No se debe reordenar ni reescribir esa secuencia en ambientes futuros.
- PROD CONTRACT CHANGE: 002 agregó una RPC sin modificar datos, flags ni RPCs previas. Captura, backup y aprobación precedieron la promoción. Un rollback de software no restaura la base; retirar SQL o recuperar datos sigue requiriendo un procedimiento separado.
- Smoke real de invitación y registro PROD PASS; Magic Link también fue PASS como modalidad existente de acceso. Google Login de un invitado y Web Share nativo no quedaron certificados. La revisión de mensajes para modalidades de acceso queda como pendiente separado; cualquier activación futura requiere sus propios gates.
## Owner docs al contratar

- `docs/SECURITY_ACCESS.md`
- `docs/DATA_MODEL.md`
- `docs/PRODUCT.md`
- `docs/UI_SYSTEM.md`
- `docs/PRIVACY_COMPLIANCE.md`
- `docs/PROD_CONTRACTS.md`
