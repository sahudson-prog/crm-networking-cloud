# Conector Google

## Propósito
Este documento describe el conector Google implementado para CRM Networking.
Su foco es documentar particularidades reales del proveedor: OAuth, scopes, APIs, formatos y cursores.
La lógica general de importación, preview, aplicación de cambios, precedencia entre datos locales y externos, datos espejo y sincronización genérica pertenece a `docs/INGESTION_SYNC.md`.

## Estado actual
Google es el único proveedor conectado implementado actualmente.
Servicios implementados:
- Contacts mediante People API.
- Gmail mediante Gmail API.
- Calendar mediante Calendar API.
El conector opera en modo lectura/importación/sincronización hacia CRM Networking. No escribe cambios hacia Google Contacts, Gmail ni Google Calendar.
El uso del conector también está sujeto a autorización interna de la app.

## OAuth y cuenta conectada
Google login y Google Connected Account son intents distintos.

El login Google se inicia desde `AuthGate` usando Supabase Auth con provider `google` y scopes mínimos de identidad: `openid`, `email` y `profile`. Este login no registra ni actualiza `connected_accounts`, no solicita Contacts, Gmail ni Calendar, y no sirve por sí solo como consentimiento para leer datos Google.

La conexión de datos con Google también usa `supabase.auth.signInWithOAuth`, con provider `google`, redirect de regreso y scopes de datos normalizados, deduplicados y unidos en un string separado por espacios.
Antes de iniciar OAuth de datos, la app recuerda temporalmente los scopes solicitados y un intent de conexión de datos en `sessionStorage`. Esos scopes son intención de OAuth, no evidencia de permisos concedidos.
Al volver desde Google, si el intent, nonce y fingerprint del token son coherentes, el navegador llama `POST /api/google/connected-account/finalize` con el `provider_token` temporal y el access token Supabase de la sesión.
La ruta server-side valida sesión Supabase, acceso efectivo de Coffeecito, Google UserInfo, tokeninfo, audience/client binding, expiración y scopes efectivos. Solo después de esa verificación persiste la conexión local.
La conexión local se guarda en `connected_accounts` con proveedor, email Google verificado, últimos scopes efectivos verificados, capacidades derivadas, estado `active`, `revoked_at` vacío y metadata de verificación de scopes.
Para operar, la app exige una fila activa de `connected_accounts`, un `session.provider_token` disponible en la sesión actual y un fingerprint de token marcado como autorización de datos aceptada en esa sesión.
Una cuenta puede estar vinculada, pero sin permiso activo si la sesión actual no trae token utilizable o si el login Google normal posterior no pasó por autorización explícita de datos.

### Conectar y reconectar
Conectar y reconectar usan el mismo mecanismo OAuth.
Si ya existe una cuenta Google no revocada para el mismo usuario y email normalizado, la app actualiza esa fila canónica. Si no existe, crea una fila nueva.
Al reconectar, los scopes persistidos se reemplazan por los scopes efectivos observados en el token actual verificado. No se combinan ciegamente con scopes históricos.
El flujo efectivo usa una cuenta Google activa por email canónico del usuario. Las filas históricas o revocadas pueden permanecer, pero no representan la cuenta conectada actual.

### Desconectar
La desconexión actual es local dentro de CRM Networking.
Al desvincular Google, la app invoca una RPC estrecha de self-service que cambia `status` a `revoked`, registra `revoked_at` y limpia scopes recordados temporalmente.
La desconexión actual no borra la fila.
La desconexión actual no llama a un endpoint de revocación de Google.
La desconexión actual no ejecuta `supabase.auth.signOut`.
La desconexión actual no elimina tokens en Google.
La desconexión actual no cierra la cuenta de acceso a CRM Networking.
La desconexión actual no borra contactos, correos, citas, interacciones ni datos ya importados.

## Scopes
Scopes de login:
- Identidad: `openid email profile`.

Scopes técnicos observados por API:
- Contacts: `https://www.googleapis.com/auth/contacts.readonly`
- Gmail: `https://www.googleapis.com/auth/gmail.readonly`
- Calendar: `https://www.googleapis.com/auth/calendar.readonly`
Cómo se solicitan actualmente:
- Autorizar acceso solicita Contacts + Gmail + Calendar junto con los scopes de identidad que requiere el flujo.
- Importar/revisar contactos usa Contacts si la capability efectiva `contacts_read` está activa.
- Actualizar datos de un contacto usa Contacts si la capability efectiva `contacts_read` está activa.
- Importar actividad desde Cuenta solicita Contacts + Gmail + Calendar.
- Actualizar actividad global solicita Contacts + Gmail + Calendar.
- Actualizar actividad de un contacto solicita Contacts + Gmail + Calendar.
- La página Cuenta solicita Contacts + Gmail + Calendar al conectar o renovar acceso.
Consentimiento parcial debe funcionar: Contacts, Gmail y Calendar se habilitan por separado según los scopes efectivos verificados por tokeninfo.
Contacts aparece en entry points de actividad por coupling de implementación de la conexión Google compartida. Gmail y Calendar no requieren técnicamente Contacts para leer mensajes o eventos.

## Contacts
Contacts usa Google People API.
Lectura masiva:
- recurso `people/me/connections`;
- fuente `READ_SOURCE_TYPE_CONTACT`;
- paginación mediante `nextPageToken`;
- página máxima de 1000 contactos en el cliente;
- máximo operativo configurable desde la app.
Lectura puntual:
- recurso individual por `resourceName`;
- usada para actualizar datos Google de un contacto ya vinculado.
Campos solicitados:
- `names`;
- `emailAddresses`;
- `phoneNumbers`;
- `organizations`;
- `birthdays`;
- `metadata`.
La identidad externa de Google Contacts es `resourceName`, con formato conceptual `people/...`.
El adaptador convierte cada persona Google a un contacto externo normalizado con nombre, empresa, cargo, correos, teléfonos, cumpleaños como metadata, metadata Google, señal de borrado externo y resource names anteriores.
Normalizaciones específicas observadas:
- correos en minúsculas y sin duplicados;
- teléfonos desde el valor visible cuando existe;
- `canonicalForm` solo como fallback si no hay valor visible;
- nombre desde `displayName` o composición de nombre y apellido;
- fallback de nombre desde email, teléfono o texto operativo;
- empresa y cargo desde la primera organización útil;
- cumpleaños ordenados con el primario primero y conservados en metadata.
Metadata Google conservada:
- `google_deleted`;
- `google_etag`;
- `google_birthdays`;
- `google_primary_birthday`;
- `missing_display_name`;
- `previous_resource_names`.
`metadata.deleted` se interpreta como señal de contacto eliminado en Google.
`previousResourceNames` permite reconocer contactos cuyo identificador externo cambió o fue reemplazado por Google.
Para preview, precedencia de datos y aplicación de cambios, ver `docs/INGESTION_SYNC.md`.

## Gmail
Gmail usa Gmail API.
Lectura histórica:
- lista mensajes del usuario `me`;
- usa una búsqueda Gmail;
- lee cada mensaje seleccionado en formato `full`;
- puede usar fecha mínima mediante `after:<timestamp>`;
- puede acotar por emails de contactos cuando el flujo está en scope de foco o contacto específico.
Lectura incremental:
- usa Gmail History API;
- parte desde `historyId` guardado;
- considera cambios tipo `messageAdded`;
- lee completos los mensajes encontrados por history.
El cursor Gmail persistido por la app es `historyId`.
Si una carga histórica no trae mensajes, el cliente puede leer el perfil Gmail para obtener un `historyId` base.
Datos leídos y usados:
- `messageId`;
- `threadId`;
- `historyId`;
- headers;
- `internalDate`;
- snippet;
- payload MIME.
El adaptador conserva asunto, fecha, participantes, dirección, cuerpo de texto plano, texto extraído desde HTML como fallback, snippet como fallback final y URL de Gmail.
La fecha viene del header `Date`, con fallback a `internalDate`.
La dirección es `outbound` si el remitente es el usuario e `inbound` si el remitente es un contacto conocido.
El cuerpo se recorta a 45.000 caracteres antes de persistirse.
El adaptador no conserva adjuntos, labels, estado leído/no leído, estrellas, importancia ni estructura MIME completa.
Identificadores externos generados y persistidos por el flujo:
- `GMAIL_{messageId}` se persiste como `external_id` del mensaje.
- `GMAIL_THREAD_{threadId}` se persiste como `external_thread_id` cuando existe.
Un correo solo se convierte en interacción si puede vincularse con al menos un contacto local conocido por email.

## Calendar
Calendar usa Google Calendar API.
El calendario actual es `primary`.
Lectura histórica:
- usa Events API;
- usa `singleEvents=true`;
- ordena por `startTime`;
- usa `timeMin`;
- puede usar `timeMax`;
- usa `showHiddenInvitations=true`;
- puede buscar por email mediante `q`.
Lectura incremental:
- usa `syncToken`;
- cuando hay `syncToken`, no envía `timeMin`, `timeMax`, `orderBy` ni `singleEvents`.
Datos leídos y usados:
- event ID;
- estado del evento;
- organizador;
- asistentes;
- summary;
- start date/dateTime;
- description;
- location;
- `htmlLink`;
- fechas de creación/actualización para diagnóstico.
El adaptador conserva asunto desde `summary`, fecha desde `start.dateTime` o `start.date`, descripción como detalle, ubicación agregada al detalle, URL externa desde `htmlLink`, participantes y metadata con ID de evento Google.
La identidad externa generada y persistida por el flujo es `CALENDAR_{eventId}` como `external_id`.
Un evento solo se convierte en interacción si puede vincularse con al menos un contacto local conocido.
El flujo puede mirar una ventana histórica desde la fecha de inicio de networking y una ventana futura para encontrar citas próximas relevantes.

## Mapping hacia estructuras internas
Contacts produce contactos externos normalizados que luego entran al flujo genérico de contactos.
Gmail y Calendar producen interacciones externas normalizadas que luego entran al flujo genérico de interacciones.
Las interacciones externas conservan proveedor, servicio de origen, tipo de objeto externo, identidad externa, hilo externo, URL externa, fecha, asunto, detalle, participantes, metadata y hash de contenido.
La persistencia final mantiene la interacción local y su fuente externa asociada, para actualizar datos llegados desde Google sin perder datos internos de CRM Networking.

## Incrementalidad y cursores Google

### Contacts
Contacts puede devolver `nextSyncToken`.
La app usa ese valor como cursor para lecturas incrementales posteriores.
Condiciones especiales observadas:
- si Google devuelve razón `EXPIRED_SYNC_TOKEN`, el cursor se considera vencido;
- si se usa sync token y Google responde 400, el cursor se considera incompatible;
- si una lectura completa inicial con solicitud de cursor falla con `invalid argument`, la app reintenta lectura completa sin pedir cursor.
Fallback implementado:
- marcar cursor vencido o incompatible en la app;
- repetir lectura completa controlada.

### Gmail
Gmail usa `historyId`.
La app obtiene el cursor desde mensajes leídos o desde el perfil Gmail cuando necesita una base inicial.
Condiciones especiales observadas:
- status 410 se trata como history vencido;
- status 404 en Gmail también se trata como history vencido.
Fallback implementado:
- marcar cursor vencido en la app;
- repetir lectura completa usando búsqueda y fecha mínima cuando corresponde.

### Calendar
Calendar usa `syncToken`.
La app guarda `nextSyncToken` cuando Calendar lo entrega y la corrida aplica cambios con cursores habilitados.
Condición especial observada:
- status 410 se trata como sync token vencido.
Fallback implementado:
- marcar cursor vencido en la app;
- repetir lectura completa controlada con el scope correspondiente.

## Errores y recuperación
Branches especiales observados:
- Contacts 401 o 403: la implementación los trata como autorización o permiso Google no utilizable y deriva a reconexión.
- Contacts con razón `EXPIRED_SYNC_TOKEN`: cursor vencido; activa fallback a lectura completa.
- Contacts 400 usando sync token: cursor incompatible; activa fallback a lectura completa.
- Contacts 400 `invalid argument` sin cursor guardado: reintento full read sin pedir cursor incremental.
- Gmail 401 o 403: la implementación los trata como autorización o permiso Google no utilizable.
- Gmail 404 o 410: history vencido; activa fallback a lectura completa.
- Calendar 401 o 403: la implementación los trata como autorización o permiso Google no utilizable.
- Calendar 410: sync token vencido; activa fallback a lectura completa.
No hay branch especial observado para 429; se propaga como error HTTP genérico.
No hay branch especial observado para API deshabilitada; si llega como 401/403 cae en autorización o permiso no utilizable, y si llega con otro status cae como error HTTP genérico.
No hay branch especial observado para scope faltante más allá del tratamiento 401/403.
Cuando Gmail y Calendar se ejecutan juntos, el flujo puede continuar con el servicio autorizado cuando el otro no está disponible por error de permiso. Si ningún servicio solicitado logra ejecutarse, el error de permiso permanece como error efectivo.

## Límites operativos
Límites internos actuales usados por la app:
- Contacts: máximo 20 páginas por revisión.
- Gmail: máximo 250 correos por revisión.
- Gmail: máximo 3 páginas por revisión.
- Calendar: máximo 2500 eventos por revisión.
- Calendar: máximo 2 páginas por revisión.
Estos son límites internos de operación de CRM Networking. No son cuotas teóricas de Google.
En el cliente Google también existen máximos por página:
- Contacts limita page size a 1000.
- Gmail limita max results por página a 500.
- Calendar limita max results por página a 2500.
Los límites operativos pueden cargarse desde configuración interna de uso para ajustar corridas sin cambiar el código.

## Diagnóstico y datos sensibles
Los flujos Google escriben observabilidad mediante la infraestructura genérica de logs de sincronización.
Calendar tiene diagnóstico adicional de lectura para investigar eventos leídos, candidatos y descartados.
Los logs pasan por sanitización antes de guardarse.
El conector debe tratar OAuth, mensajes y eventos como material sensible. El detalle de seguridad, acceso y privacidad pertenece a documentación especializada.

## Boundaries
Este documento no define:
- reglas genéricas de preview y apply;
- precedencia entre datos locales y externos;
- modelo de datos completo;
- matriz de roles, planes o permisos internos;
- cumplimiento legal y privacidad;
- diseño UI;
- reglas de Coach;
- planificación de proveedores futuros.
Referencias de ownership:
- sincronización genérica: `docs/INGESTION_SYNC.md`;
- modelo de datos: `docs/DATA_MODEL.md`;
- seguridad y acceso: `docs/SECURITY_ACCESS.md`;
- privacidad y cumplimiento: `docs/PRIVACY_COMPLIANCE.md`;
- pruebas: `docs/TESTING.md`.

## Deuda y ambigüedades vigentes
Deuda específica del conector Google:
- dependencia del `session.provider_token` de Supabase y ausencia observada de refresh server-side robusto;
- existencia de `oauth_refresh_token_encrypted` en schema sin uso efectivo observado en el flujo actual;
- tokeninfo se acepta en esta beta como mecanismo de introspección de effective scopes; antes de lanzamiento público debe revisarse porque Google lo caracteriza principalmente como mecanismo diagnóstico y puede estar sujeto a throttling;
- coupling de scopes: los entry points de autorización solicitan Contacts junto con Gmail y Calendar para simplificar la beta;
- Calendar limitado actualmente al calendario `primary`;
- diagnóstico adicional disponible para Calendar, pero no equivalente para Gmail;
- no hay refresh token persistente ni background refresh en esta fase;
- logout y login Google normal posterior no reactivan permiso de datos sin nueva autorización explícita.
