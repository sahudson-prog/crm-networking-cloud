# Privacidad y cumplimiento

## Propósito

Este documento describe el estado operativo vigente de privacidad y control de datos en CRM Networking cloud.

Su foco es explicar qué datos personales procesa la app, para qué los usa, qué controles reales existen hoy, qué borrados o desconexiones están implementados y qué límites no deben presentarse como resueltos.

Este documento no declara cumplimiento legal. No reemplaza una revisión legal formal ni convierte decisiones de producto en consentimiento jurídico.

Seguridad, roles, planes, capabilities y RLS pertenecen a `docs/SECURITY_ACCESS.md`. Modelo persistente pertenece a `docs/DATA_MODEL.md`. Sincronización pertenece a `docs/INGESTION_SYNC.md`. Particularidades de Google pertenecen a `docs/connectors/GOOGLE.md`. Contratos de acciones internas pertenecen a `docs/ACTIONS.md`.

## Alcance real actual

La aplicación vigente es la app cloud en `cloud/web`, con Supabase/Postgres como persistencia principal.

Los datos privados operativos se modelan principalmente como datos del usuario mediante `user_id` y RLS.

Google es el único proveedor externo implementado. La app lee/importa/sincroniza desde Google Contacts, Gmail y Calendar hacia CRM Networking. No se observó escritura desde la app hacia Google.

La app distingue cuenta de acceso, perfil interno, cuenta conectada, datos locales, identidades externas, snapshots de proveedor, logs técnicos y auditoría de negocio.

Los maestros globales, como empresas headhunter, no están asociados mediante user_id a un usuario específico.

## Datos personales tratados

Datos de cuenta y perfil: email, nombre de perfil, plan, roles, capacidades, estado de acceso y configuración personal.

Datos de autorización beta: email normalizado en allowlist, fecha de autorización, fecha de revocación, usuario administrador que autorizó o revocó cuando se registre, y nota administrativa opcional. La allowlist no almacena roles, planes ni perfiles duplicados.

Datos de contactos: nombre, empresa, cargo, correos, teléfonos, estado de networking, marca de foco, marca de contacto headhunter, objetivos asociados y ciclo de vida local.

Datos de proveedor conectado: proveedor, email de la cuenta conectada, scopes conocidos, capacidades derivadas, estado de conexión, fecha de conexión y fecha de revocación local.

Identidades externas: IDs de contactos, correos, hilos o eventos del proveedor, vínculos con objetos locales, URLs externas cuando el conector las entrega y metadata técnica asociada.

Snapshots externos de contactos: última representación conocida del proveedor, incluyendo nombre, empresa, cargo, correos, teléfonos, cumpleaños, señal de eliminado en origen y metadata del proveedor.

Interacciones: tipo, dirección, fecha, asunto, detalle de origen, notas del usuario, estado de eliminación lógica y marca para evitar reimportación.

Participantes de interacciones: contacto local vinculado, identidad de correo y rol funcional dentro de la interacción.

Referidos: contacto que refiere, contacto vinculado opcional, nombre, empresa, cargo, correo, teléfono, notas y estado.

Objetivos profesionales: nombre, tipo, prioridad, descripción y asociaciones con contactos.

Datos operativos: sugerencias Coach, configuraciones de reglas, acciones internas, logs de sincronización, diagnósticos, cursores, límites de uso, eventos de uso, métricas y auditoría.

## Finalidad funcional observada

Los datos se usan para gestionar networking profesional: organizar contactos, objetivos, interacciones, referidos, estado de avance, sugerencias Coach e indicadores internos.

Los datos de proveedores conectados se usan para poblar o actualizar datos dentro de CRM Networking, previa revisión cuando el flujo lo requiere.

Los datos técnicos se usan para continuidad de sincronización, idempotencia, diagnóstico, auditoría y control operativo.

En los flujos revisados no se observó uso implementado para vender datos, compartir datos identificables con terceros, entrenar modelos externos, reportar información personal a patrocinadores ni escribir cambios hacia proveedores externos.

## Proveedores y minimización

Google opera actualmente en modo lectura. Los scopes observados son `contacts.readonly`, `gmail.readonly` y `calendar.readonly`.

Contacts lee nombre, correos, teléfonos, organizaciones, cumpleaños y metadata necesarios para identidad externa y comparación.

Gmail lee headers, fecha, snippet y payload MIME. El adaptador persiste asunto, fecha, participantes, dirección y detalle de texto; el contenido se trunca antes de guardarse.

Calendar lee evento, asistentes, organizador, asunto, fecha, descripción, ubicación y link externo. El diagnóstico de Calendar guarda un payload reducido, no el evento completo.

No se observó persistencia efectiva de refresh tokens en el código revisado, aunque el schema contiene una columna preparada para eso.

Los logs técnicos de sincronización aplican sanitización antes de guardarse: redactan correos, teléfonos, tokens y claves sensibles conocidas.

La auditoría de negocio y las invocaciones de acciones pueden conservar antes/después, inputs u outputs con datos personales. Están aisladas por usuario, pero no deben tratarse como logs anonimizados.

## Controles del usuario

El usuario puede ver y editar contactos, correos, teléfonos, estados, marcas, objetivos, interacciones manuales, notas y referidos mediante las pantallas actuales.

Los flujos de importación/sincronización con preview no guardan cambios solo por revisar. La persistencia ocurre al aplicar la selección.

El usuario puede descartar interacciones. En el modelo vigente esto se implementa como eliminación lógica y puede marcar prevención de reimportación.

El usuario puede desvincular Google dentro de CRM Networking. Esa acción cambia la cuenta conectada local a estado revocado y registra `revoked_at`.

Desvincular Google no borra datos ya importados, no elimina el login de la app, no cierra sesión y no revoca permisos directamente en Google según el código observado.

Existe una acción de `Reiniciar datos` en Cuenta para borrar datos operativos del usuario dentro de la app conservando usuario y plan.

El botón visible de `Borrar cuenta` está pendiente y no ejecuta eliminación real de la cuenta de autenticación.

Los botones de borrar importados por tipo aparecen como placeholders no destructivos; no deben documentarse como funcionalidad efectiva.

La revocación de allowlist es un control administrativo de acceso, no un borrado de datos. Bloquea el acceso efectivo, pero conserva `auth.users`, `profiles`, datos app-owned, roles, plan y Connected Accounts para permitir reautorización posterior o tratamiento separado de datos.

## Exportación

No se observó un flujo funcional completo de exportación de datos del usuario en la app cloud.

Sí existen una capability `data.export` y una tabla `data_exports`, pero eso representa infraestructura o intención de control, no una función disponible de portabilidad/exportación.

Mientras no exista acción, UI, archivo generado y registro funcional verificado, la app no debe afirmar que ofrece exportación o portabilidad implementada.

## Borrado y reset

`reset_current_user_app_data_v0_1` reinicia los datos operativos del usuario autenticado.

La operación exige sesión activa, capability `data.delete_account` y confirmación literal `BORRAR MIS DATOS`.

La función borra datos user-owned como contactos, correos y teléfonos, identidades externas, snapshots, interacciones, participantes, fuentes externas, diagnósticos, referidos, objetivos, ToDos, cursores, logs, límites/eventos de uso, export records, import batches, configuraciones personales, cuentas conectadas, invocaciones de acciones y auditoría.

La función conserva `auth.users`, `profiles`, roles, planes, organizaciones, patrocinios, memberships y maestros globales.

La operación no elimina la cuenta de autenticación ni implementa anonimización posterior observada.

Como la función borra también `audit_log` y `action_invocations` del usuario, no queda observada una auditoría persistente posterior del propio reset dentro del espacio borrado.

## Consentimiento, retención y políticas

OAuth Google confirma autorización técnica para scopes de proveedor. No equivale por sí solo a consentimiento legal general para todos los usos posibles de datos.

El Before User Created Auth Hook de Supabase, cuando se active, usará la allowlist para impedir altas no autorizadas. Ese bloqueo no revela el contenido de la allowlist al usuario.

Los previews, confirmaciones UI y prompts destructivos son controles de producto. No se observó un registro formal de consentimiento, versiones de política aceptadas o historial de consentimiento.

No se observó una política automática de retención, expiración o limpieza por antigüedad para contactos, interacciones, logs, diagnósticos o auditoría.

No se observó flujo completo para solicitud de acceso, rectificación formal, portabilidad, oposición, bloqueo, anonimización o eliminación total de cuenta.

No se observó política cerrada para conservar evidencia mínima después de un reset o cierre de cuenta.

## Diagnóstico y acceso interno

`sync_run_logs` permite revisar pasos recientes de sincronización y está diseñado para no ensuciar la vista Cuenta con mensajes técnicos. El usuario final puede generar registros propios, pero no leerlos directamente; la capability efectiva `admin.view_diagnostics` permite lectura transversal para soporte. Aunque el runtime aplica sanitización de correos, teléfonos, tokens y metadata sensible conocida antes de insertar, estos registros deben tratarse como datos operacionales potencialmente sensibles.

`external_interaction_read_diagnostics` permite investigar lecturas de Calendar, mapeos, descartes y candidatos. Puede contener emails de participantes y datos técnicos de eventos.

`DataDiagnosticsPanel` permite inspeccionar tablas crudas desde Mantención admin. Muestra datos de usuario, sistema y maestros globales según tablas configuradas y lo que permitan RLS/capabilities.

Estas herramientas son útiles para soporte y diagnóstico, pero aumentan sensibilidad operacional. Deben tratarse como acceso interno privilegiado, no como interfaz normal de usuario final.

## Límites del estado actual

No existe una política legal final dentro del repositorio.

No existe eliminación real de cuenta de autenticación desde la UI.

No existe exportación funcional verificada.

No existe revocación real contra Google al desvincular desde la app.

No existe retención automática observada.

No existe consentimiento versionado observado.

No existe cobertura uniforme de auditoría para todas las mutaciones.

## Ambigüedades vigentes

La columna `oauth_refresh_token_encrypted` existe, pero no se observó uso efectivo en el runtime web revisado.

La frontera futura entre borrar datos operativos, cerrar cuenta, anonimizar y conservar evidencia mínima no está cerrada.

El alcance final de exportación/portabilidad no está implementado ni definido operacionalmente.

La política de retención de logs, diagnósticos, auditoría e interacciones eliminadas no está implementada.
