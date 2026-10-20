# INV-01 - Invitaciones V1

## Estado y autoridad

- Status: `NOT CONTRACTED / DECISION REQUIRED`.
- Este documento conserva el contrato funcional V1 aprobado y el diseño técnico mínimo recomendado para invitaciones.
- No autoriza implementación, cambios de schema, migrations, configuración remota ni rollout.
- Antes de implementar, cualquier cambio persistente o de acceso debe tratarse como `PROD CONTRACT CHANGE` según `docs/PROD_CONTRACTS.md`.

## Contrato funcional V1 aprobado

### Acceso e identidad

- Una invitación es una autorización temporal por email alternativa a la allowlist administrativa existente.
- No existe un rol temporal de invitado ni un sistema Auth paralelo.
- Google login y magic link siguen siendo los mecanismos de autenticación disponibles.
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
  - acción `Autorizar y preparar invitación`.
- Autorizar reserva cupo y capacidad de forma server-side antes de ofrecer opciones para compartir.
- El compartir se realiza mediante `mailto`; Coffeecito nunca afirma que el correo fue enviado, entregado o leído.
- El diálogo incluye una lista simple de invitaciones pendientes y registradas.
- Las pendientes muestran su vencimiento.
- Reabrir `mailto` reutiliza la autorización existente sin consumir otro cupo ni renovar la vigencia.
- Deben existir mensajes distintos para:
  - cupos personales agotados;
  - cupos que se recuperarán próximamente por vencimiento;
  - capacidad global completa.
- No se incluye dashboard, gestor avanzado, edición de invitaciones, reenvío gestionado ni mensajería interna.

## Diseño técnico mínimo recomendado

Este diseño cierra la dirección técnica V1, pero sus nombres finales y SQL deben validarse durante una tarea de implementación contratada.

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

No escribir estas migrations hasta contratar la implementación y aprobar el `PROD CONTRACT CHANGE`.

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
- magic link y Google con email verificado;
- identidad Auth creada pero nunca autenticada;
- email existente, invitación repetida y `mailto` reabierto;
- pausa de invitaciones y suspensión de registros;
- beta legacy intacta;
- bloqueados, cerrados y revocados sin reactivación;
- aislamiento cross-user y rechazo de IDs manipulados;
- reset sin restitución de cupos ni alteración global;
- rollback completo ante fallos.

La prueba de concurrencia debe usar sesiones PostgreSQL reales; una secuencia de llamadas no certifica carreras.

## Secuencia de implementación por PR

1. **PR de fundación persistente inerte**: schema, configuración segura, RLS, RPCs y verifiers, sin habilitar signup por invitación.
2. **PR de Auth y bootstrap**: hook compatible, bootstrap, acceso durable y tests Auth locales; mantener ambos controles globales cerrados.
3. **PR de capabilities y límites**: cerrar auditoría de Free y garantizar que Google import/sync quede solo para `beta_tester` antes de incorporar usuarios `free`.
4. **PR de UX V1**: cabecera, diálogo, lista simple, mensajes y `mailto`, consumiendo exclusivamente RPCs server-side.
5. **Rollout controlado**: aplicar migrations y verifiers en DEV, probar concurrencia/Auth, smoke multiusuario, preflight PROD, backup y promoción; habilitar primero registros y luego invitaciones mediante controles separados.

Gates obligatorios:

- aprobación explícita del cambio de contrato persistente;
- PostgreSQL/Supabase local con verifiers y dos sesiones para concurrencia;
- pruebas reales de Google y magic link en DEV sin identidades productivas;
- inventario y preservación de beta legacy;
- enforcement Google exclusivo de `beta_tester` en grants, overrides y operaciones server-side, más auditoría separada de Free;
- compatibilidad de la app anterior con cada migration;
- rollback de aplicación y apagado inmediato mediante ambos controles;
- smoke DEV y PROD de invitador, invitado, beta legacy, bloqueado y capacidad completa.

## Riesgos y decisiones pendientes antes de implementar

- Confirmar el código final de la capability de invitar y la matriz exacta de roles/planes/overrides.
- Auditar y aprobar los límites efectivos de `free`; el catálogo actual no demuestra por sí solo enforcement completo del runtime ni permite asumir que `max_contacts = 200` esté aplicado.
- Verificar en Supabase local el momento exacto en que Google y magic link marcan `email_confirmed_at`; crear `auth.users` no basta como prueba de primera autenticación.
- Definir la resolución administrativa y la eventual reautorización posterior a una cancelación por seguridad. Mientras no exista esa decisión explícita, una reinvitación ordinaria no puede eludirla; el vencimiento no comparte este bloqueo.
- Definir retención y acceso administrativo del historial de invitaciones de acuerdo con privacidad, sin anticipar decisiones de eliminación de cuenta.
- Confirmar si la auditoría mínima cabe en el lifecycle de invitación más `audit_log` o requiere una entidad append-only que sobreviva al reset.
- Validar la semántica exacta del control `suspender registros`: una pendiente puede vencer durante la suspensión y no se renueva al reanudar.
- Levantar un preflight de usuarios beta existentes, planes y roles antes de cualquier backfill para evitar degradaciones o reactivaciones.

No hay contradicción funcional conocida entre estas decisiones y el modelo vigente, pero la implementación modifica Auth, acceso persistente, RLS y grants; por ello permanece no contratada hasta aprobar ese alcance.

## Owner docs al contratar

- `docs/SECURITY_ACCESS.md`
- `docs/DATA_MODEL.md`
- `docs/PRODUCT.md`
- `docs/UI_SYSTEM.md`
- `docs/PRIVACY_COMPLIANCE.md`
- `docs/PROD_CONTRACTS.md`
