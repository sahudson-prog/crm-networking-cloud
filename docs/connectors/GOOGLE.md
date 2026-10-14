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

Los OAuth clients, callbacks, redirects y su separación por ambiente se documentan en [ENVIRONMENTS.md](../ENVIRONMENTS.md).

El login Google se inicia desde `AuthGate` usando Supabase Auth con provider `google` y scopes mínimos de identidad: `openid`, `email` y `profile`. Usa PKCE y vuelve a `/auth/callback`, donde el SDK intercambia el código antes de entrar a la app. Este login no registra ni actualiza `connected_accounts`, no solicita Contacts, Gmail ni Calendar, y no sirve por sí solo como consentimiento para leer datos Google.

La conexión de datos con Google también usa `supabase.auth.signInWithOAuth`, con provider `google`, PKCE, callback explícito y scopes de datos normalizados, deduplicados y unidos en un string separado por espacios. Cuenta inicia este OAuth desde la acción concreta de Contacts, Gmail o Calendar y solicita únicamente el scope readonly de ese servicio. Las ampliaciones usan consentimiento incremental de Google (`include_granted_scopes=true`) para que el token efectivo nuevo conserve los grants anteriores.
Antes de iniciar OAuth de datos, la app recuerda temporalmente los scopes solicitados y un intent de conexión de datos en `sessionStorage`. Esos scopes son intención de OAuth, no evidencia de permisos concedidos.
Al volver desde Google, si el intent, nonce y fingerprint del token son coherentes, el navegador llama `POST /api/google/connected-account/finalize` con el `provider_token` temporal y el access token Supabase de la sesión.
La ruta server-side valida sesión Supabase, acceso efectivo de Coffeecito, Google UserInfo, tokeninfo, audience/client binding, expiración y scopes efectivos. Solo después de esa verificación persiste la conexión local.
La conexión local se guarda en `connected_accounts` con proveedor, email Google verificado, últimos scopes efectivos verificados, capacidades derivadas, estado `active`, `revoked_at` vacío y metadata de verificación de scopes.
Para operar, la app exige una fila activa de `connected_accounts`, un `session.provider_token` disponible en la sesión actual y un fingerprint de token marcado como autorización de datos aceptada en esa sesión.
Una cuenta puede estar vinculada, pero sin permiso activo si la sesión actual no trae token utilizable o si el login Google normal posterior no pasó por autorización explícita de datos.

### Conectar y reconectar
Conectar y reconectar usan el mismo mecanismo OAuth.
Si ya existe una cuenta Google no revocada para el mismo usuario y email normalizado, la app actualiza esa fila canónica. Si no existe, crea una fila nueva.
Al reconectar, los scopes persistidos se reemplazan por los scopes efectivos observados en el token actual verificado. No se combinan ciegamente con scopes históricos: la preservación de capacidades anteriores depende del token efectivo emitido por Google mediante consentimiento incremental y vuelve a verificarse server-side.
El flujo efectivo usa una cuenta Google activa por email canónico del usuario. Las filas históricas o revocadas pueden permanecer, pero no representan la cuenta conectada actual.

### Desconectar
Cuenta no expone una acción de desconexión o revocación Google. Desactivar Gmail o Calendar solo cambia la preferencia de sincronización: no revoca permisos, no desconecta Google y no borra datos ya importados.

## Scopes
Scopes de login:
- Identidad: `openid email profile`.

Scopes técnicos observados por API:
- Contacts: `https://www.googleapis.com/auth/contacts.readonly`
- Gmail: `https://www.googleapis.com/auth/gmail.readonly`
- Calendar: `https://www.googleapis.com/auth/calendar.readonly`
Cómo se solicitan actualmente:
- Importar/revisar Google Contacts solicita solo Contacts si falta la capability efectiva `contacts_read`.
- Actualizar datos de un contacto usa Contacts si la capability efectiva `contacts_read` está activa.
- Importar histórico Gmail solicita solo Gmail si falta `gmail_read`.
- Activar la preferencia Google Gmail solicita solo Gmail si falta `gmail_read`.
- Activar la preferencia Google Calendar solicita solo Calendar si falta `calendar_read`.
- Las acciones globales y de ficha consumen únicamente los servicios habilitados y sus capabilities ya verificadas; si falta una, derivan a Cuenta.
Consentimiento parcial debe funcionar: Contacts, Gmail y Calendar se habilitan por separado según los scopes efectivos verificados por tokeninfo.

Las preferencias de producto para mantener actividad sincronizada se guardan por usuario en `user_settings` bajo `interaction_sync_preferences_v1`, con flags independientes `gmailEnabled` y `calendarEnabled`. La ausencia de la preferencia equivale a ambos servicios desactivados; scopes, capabilities o una cuenta conectada no implican activación. Habilitar un servicio ya autorizado solo persiste la preferencia. Si falta su capability, Cuenta reutiliza el OAuth de datos existente y persiste `ON` únicamente después de verificar el retorno. Deshabilitarlo no revoca OAuth, no desconecta Google y no borra datos ni cursores.

Los botones manuales global y de ficha consideran solo servicios habilitados. Si un servicio elegible está habilitado pero no autorizado antes de comenzar, la corrida completa se bloquea y deriva a `Cuenta → Importación y sincronización`. Superado ese preflight, Gmail y Calendar completan Review, Apply y persistencia de cursor/timestamp como unidades independientes: un fallo runtime conserva el resultado válido del otro servicio, y el marcador conjunto `global_activity_success` se escribe solo si todos los servicios solicitados terminan correctamente. Gmail y Calendar en ficha están limitados a contactos Foco; Google Contacts no participa en estos botones. El Historical Bootstrap de Gmail permanece independiente de estas preferencias.

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
- usa una o más búsquedas Gmail;
- lee cada mensaje encontrado en formato `full` antes de construir el preview seleccionable;
- puede usar fecha mínima mediante `after:<timestamp>`;
- desde Cuenta, el Historical Bootstrap exige una etiqueta Gmail de usuario (`type=user` en la respuesta de la API) elegida por el usuario y combina su `labelId` con la fecha de inicio de networking;
- el Historical Bootstrap captura un `historyId` base antes de leer, conserva un snapshot normalizado solo en memoria y aplica la selección sin volver a consultar Gmail;
- el cursor Gmail global se inicializa después del Apply únicamente cuando la lectura fue completa y todos los elementos seleccionados se aplicaron sin error;
- puede acotar por emails de contactos cuando el flujo está en scope de foco o contacto específico;
- en lectura histórica scoped, divide los emails únicos en búsquedas de hasta 20 direcciones y deduplica por `messageId` antes de leer el detalle entre búsquedas;
- el máximo de correos se aplica tanto al total consolidado como al total de lecturas de detalle de la revisión. El presupuesto de páginas se comparte de forma conservadora, reservando al menos la primera página necesaria para cada búsqueda scoped.
Lectura incremental:
- usa Gmail History API;
- el sync global parte desde el `historyId` global (`cursor_label=''`) solo cuando pertenece a la cuenta Google conectada actual;
- considera cambios tipo `messageAdded`;
- pagina completamente `history.list`, deduplica IDs y lee completos los mensajes encontrados;
- conserva en memoria los mensajes normalizados y el cursor candidato durante la lectura; el sync global del Shell aplica directamente todos los correos Foco elegibles usando ese snapshot, sin volver a consultar Gmail;
- solo persiste interacciones vinculables con contactos activos marcados como Foco;
- avanza el cursor al `historyId` devuelto por la lectura incremental completa únicamente después de aplicar sin fallos todos los correos Foco elegibles.
El cursor Gmail persistido por la app es `historyId`.
Si una carga histórica no trae mensajes, el cliente puede leer el perfil Gmail para obtener un `historyId` base.
Si el sync global no tiene cursor, el cursor pertenece a otra cuenta o Gmail lo informa vencido, captura primero el `historyId` actual y recupera solamente los últimos 14 días para los emails Foco. Ese recovery no usa la fecha de inicio de networking ni una etiqueta Gmail, y guarda el baseline capturado solo después de una lectura completa y un Apply exitoso. Sin contactos Foco o emails utilizables, el recovery no recorre mensajes y puede inicializar el baseline como no-op exitoso.
El botón global del Shell ejecuta Review y Apply como una sola acción sin preview visible. El Historical Bootstrap de Cuenta conserva Review, selección y Apply explícitos.
En la ficha, Gmail ejecuta un backfill directo de los últimos 14 días para todos los emails utilizables del contacto, únicamente cuando está marcado como Foco. Conserva el snapshot normalizado entre Review y Apply, no muestra preview, no usa `history.list`, etiqueta histórica ni `Fecha_Inicio_Networking`, y no lee ni escribe cursores Gmail globales o `contact:<contactId>`.
En la ficha, Calendar consulta directamente una ventana móvil desde 7 días antes de la corrida hasta 30 días después para los emails utilizables del contacto Foco. No lee ni escribe cursores `contact:<contactId>` y no modifica la frescura global.
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
Fuera del Historical Bootstrap, un correo solo se convierte en interacción si puede vincularse con al menos un contacto local conocido por email. El Bootstrap puede conservar correos delimitados por la etiqueta elegida aunque todavía no exista un contacto asociado; sus participantes se guardan por email normalizado y los contactos existentes siguen vinculándose por coincidencia exacta.

## Calendar
Calendar usa Google Calendar API.
El calendario actual es `primary`.
El sync periódico manual global consulta solo contactos activos Foco y sus emails utilizables. El sync periódico de ficha consulta solo el contacto Foco actual. Ambos leen una vez el calendario `primary` dentro de una ventana móvil desde 7 días antes de la corrida hasta 30 días después, paginan esa lectura y filtran localmente por asistentes u organizador que coincidan con emails Foco. La cantidad de requests depende de las páginas de la ventana y no del número de emails Foco. No usan `syncToken` ni `Fecha_Inicio_Networking`, y deduplican eventos por ID antes de aplicar idempotentemente.
Lectura por ventana:
- usa Events API;
- usa `singleEvents=true`;
- ordena por `startTime`;
- usa `timeMin`;
- puede usar `timeMax`;
- usa `showHiddenInvitations=true`;
- puede buscar por email mediante `q`.
El flujo histórico legacy de Cuenta conserva temporalmente lectura incremental:
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
La UI de Cuenta no ofrece la importación Calendar histórica legacy: presenta `.ics` como opción futura y mantiene Google Calendar únicamente como preferencia de sync periódico. La implementación legacy puede permanecer internamente mientras no sea necesaria para la ruta principal.

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
- para el sync global, ejecutar recovery acotado a 14 días sobre el Foco actual;
- para otros scopes existentes, conservar su fallback específico mientras no migren al contrato global.

### Calendar
El sync periódico global y de ficha no usa `syncToken`. La fila global Calendar (`cursor_label=''`) conserva `cursor_value=null` y registra `connected_account_id` y `last_synced_at` solo después de una lectura completa y un Apply exitoso; un no-op por ausencia de contactos Foco o emails también cuenta como éxito. La ficha no lee ni escribe cursores Calendar y no modifica esa fila global.
El flujo histórico legacy de Cuenta todavía puede usar `syncToken`, guardar `nextSyncToken` y aplicar su fallback mientras no sea reemplazado por importación `.ics`.
Condición especial observada:
- status 410 se trata como sync token vencido.
Fallback implementado:
- marcar cursor vencido en la app;
- repetir lectura completa controlada con el scope correspondiente.

El popover Sync del Shell usa como fuente primaria `last_synced_at` de los cursores globales (`cursor_label=''`) de cada servicio habilitado: `resource_type='mail'` para Gmail y `resource_type='calendar'` para Calendar. Muestra freshness individual por servicio, omite servicios deshabilitados y marca pendiente de primera actualización cuando el cursor correspondiente todavía no registra un éxito. La marca user-scoped `global_activity_success` (`resource_type='messages'`, `cursor_value=null`) se conserva como dato auxiliar y no reemplaza los cursores Gmail o Calendar. El icono global solo distingue ejecución, autorización requerida, error técnico y feedback transitorio de éxito; el detalle y la acción explícita viven en el popover.

Cuando un servicio habilitado carece de capability efectiva, la acción del popover solicita únicamente los scopes faltantes de Gmail o Calendar mediante el OAuth incremental existente, conserva grants previos y guarda una intención efímera de `sync now`. Solo un retorno OAuth válido que confirma todas las capabilities solicitadas reanuda automáticamente la corrida; una cancelación, un fallo o permisos incompletos conservan las preferencias y no ejecutan el sync. Contacts no participa de esta autorización contextual.

## Errores y recuperación
Branches especiales observados:
- Contacts 401 o 403: la implementación los trata como autorización o permiso Google no utilizable y deriva a reconexión.
- Contacts con razón `EXPIRED_SYNC_TOKEN`: cursor vencido; activa fallback a lectura completa.
- Contacts 400 usando sync token: cursor incompatible; activa fallback a lectura completa.
- Contacts 400 `invalid argument` sin cursor guardado: reintento full read sin pedir cursor incremental.
- Gmail 401 o 403 sin señal de cuota: la implementación los trata como autorización o permiso Google no utilizable.
- Gmail 403 con razón `rateLimitExceeded` o `userRateLimitExceeded`, y HTTP 429: aplica reintentos con backoff exponencial truncado y, si persiste, devuelve un error temporal explícito sin invalidar la autorización Google.
- Gmail 404 o 410: history vencido; activa fallback a lectura completa.
- Calendar 401 o 403: la implementación los trata como autorización o permiso Google no utilizable.
- Calendar 410: sync token vencido; activa fallback a lectura completa.
El mensaje útil devuelto por Google para límites temporales se conserva sin convertir el error en una solicitud de reconexión.
No hay branch especial observado para API deshabilitada; si llega como 401/403 cae en autorización o permiso no utilizable, y si llega con otro status cae como error HTTP genérico.
No hay branch especial observado para scope faltante más allá del tratamiento 401/403.
Cuando Gmail y Calendar se ejecutan juntos, el flujo puede continuar con el servicio autorizado cuando el otro no está disponible por error de permiso. Si ningún servicio solicitado logra ejecutarse, el error de permiso permanece como error efectivo.

## Límites operativos
Límites internos actuales usados por la app:
- Contacts: máximo 20 páginas por revisión.
- Gmail: máximo 250 correos por revisión.
- Gmail: presupuesto base máximo de 3 páginas por revisión. En lectura histórica scoped se reserva al menos una primera página por batch, por lo que scopes de más de 60 emails pueden superar ese total únicamente para cubrir cada batch una vez.
- Gmail: presupuesto interno de 3000 unidades por ventana móvil de 60 segundos y corrida. Cada `messages.list` reserva 5 unidades, cada `messages.get` 20, `getProfile` 1, `history.list` 2 y `labels.list` 1. Si la siguiente llamada excedería el presupuesto, la corrida espera hasta la siguiente capacidad disponible sin ampliar el máximo total de correos.
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
- Calendar limitado actualmente al calendario `primary`;
- diagnóstico adicional disponible para Calendar, pero no equivalente para Gmail;
- no hay refresh token persistente ni background refresh en esta fase;
- logout y login Google normal posterior no reactivan permiso de datos sin nueva autorización explícita.
