# INV-01 - Invitaciones beta

## Estado y autoridad

- Status: `NOT CONTRACTED / DECISION REQUIRED`.
- Este documento conserva las decisiones funcionales aprobadas para invitaciones beta.
- No autoriza implementación, cambios de schema, migrations, configuración remota ni cambios de proveedores.

## Decisiones funcionales aprobadas

### Cadena y cupos

- Cada usuario elegible dispone de hasta 5 invitaciones.
- Los usuarios registrados mediante invitación también pueden invitar, con el mismo máximo de 5 invitaciones.
- Los 5 cupos personales se ocupan por invitaciones pendientes vigentes o convertidas en registro.
- Las invitaciones convertidas en registro consumen definitivamente el cupo personal del invitador.
- El flujo debe mantenerse simple; no se aprueba todavía un gestor complejo de estados o edición de invitaciones.

### Autorización y envío

- La autorización se concede por email.
- El envío es manual mediante `mailto`.
- El producto no debe afirmar que un correo fue enviado ni entregado.

### Vigencia y liberación

- Una invitación conserva vigencia de 5 días exactos desde su autorización.
- Un registro válido conserva su acceso aunque posteriormente venza la vigencia de la invitación.
- Al vencer sin registro, una invitación libera su reserva de capacidad global y restaura automáticamente el cupo del invitador, una sola vez.

### Capacidad global y controles operativos

- La capacidad global inicial de 500 equivale a usuarios registrados por invitación más invitaciones autorizadas, pendientes y vigentes.
- Este máximo debe ser editable desde Mantención.
- Al alcanzar 500, se bloquean nuevas invitaciones y se muestra un mensaje positivo: podrán volver a invitar cuando se liberen cupos.
- Las invitaciones pendientes conservan su validez y los usuarios ya registrados conservan su acceso.
- Deben existir dos controles globales independientes:
  - pausar nuevas invitaciones;
  - suspender nuevos registros por invitación.

### Acceso, roles y plan

- Los nuevos invitados reciben plan `free` y rol `user`.
- Los usuarios ya pertenecientes a la beta cerrada conservan su plan, acceso y rol `beta_tester`.
- Google login y acceso por email siguen disponibles.
- Durante esta etapa, importación y sincronización Google quedan disponibles solo para `beta_tester`.

### Seguridad y operación

- La capacidad de invitar debe existir para `user` y `beta_tester`.
- Los cupos, reservas, controles globales y registro de auditoría requieren enforcement server-side y operaciones atómicas.
- Reiniciar datos propios no restablece cupos consumidos por registros ni altera el contador global.
- Revocar o bloquear a un usuario registrado tampoco libera automáticamente su cupo global.
- Estas reglas no anticipan decisiones legales de eliminación o retención.
- Deben revisarse los límites efectivos del plan Free antes de implementación.

## Límites y no decisiones

- No se afirma envío, entrega ni lectura de correos.
- No se cambian los contratos existentes de acceso beta cerrado hasta que se apruebe la implementación.
- No se define todavía la estructura persistente exacta, el nombre de capabilities, las RPCs ni las policies.
- No se define todavía el detalle visual del flujo, fuera de `mailto` como mecanismo manual de compartir.

## Pendientes de auditoría y diseño técnico

Antes de contratar implementación deben resolverse, con evidencia del repo y de los contratos de acceso actuales:

- modelo persistente de invitación, reserva, expiración y registro;
- semántica exacta de autorización por email normalizado;
- orden atómico entre cupos del invitador, capacidad global, expiración única y alta del usuario;
- relación con `app_access_allowlist`, Before User Created Hook, perfiles de acceso, planes y roles existentes;
- comportamiento de email ya autorizado, usuario existente, invitación repetida, expiración y registro concurrente;
- definición de las capabilities y separación entre operaciones de usuario y administración;
- auditoría mínima sin exponer contenido sensible;
- límites efectivos de Free y su interacción con importación y sync Google;
- mensajes de producto y manejo de `mailto` sin afirmar entrega;
- criterios de aceptación, rollout, pruebas y recuperación operativa.

## Owner docs probables al contratar

- `docs/SECURITY_ACCESS.md`
- `docs/DATA_MODEL.md`
- `docs/PRODUCT.md`
- `docs/UI_SYSTEM.md`
- `docs/PROD_CONTRACTS.md` si el diseño propone cambios persistentes
