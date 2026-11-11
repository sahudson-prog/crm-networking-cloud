# Conector Google

## Candidato local: Calendar independiente

SQL 001-005, sus verificadores y finalize en DEV: PASS confirmado por el owner; no se repitieron controles remotos. El owner certifico qa-admin permitido y qa-user rechazado en finalize (403/calendar_admin_required), sync (403/42501) y Cuenta. Turnstile DEV real restaurado. El runtime posterior a 005 y su smoke funcional estan PASS segun el owner; PROD permanece pendiente. La causa original del incidente del admin no se da por certificada. OAuth independiente conserva `calendar.events.owned.readonly` para `primary`, validacion server-side de identidad/audience/scopes, capability efectiva y denies. El flujo Calendar exige perfil `system_admin` vigente, `admin.manage_access` e `interactions.sync_calendar`; UI, finalize y RPC de sync comprueban el gate. Google login no depende de Calendar. No incorpora scopes de Contacts/Gmail, refresh tokens ni renovacion silenciosa. Gmail sigue deshabilitado en el runtime publico, incluido Historico/admin; no se revocan permisos remotos.

Solo Actualizar en cabecera inicia la ejecucion. OAuth, recarga, navegacion y fichas no sincronizan. El coordinador compartido permite navegar y cancelar entre operaciones; cancelar no revierte transacciones confirmadas. La ficha conserva interacciones sin controles de sync.

### Una ejecucion completa por clic (v2)

- Cambios: inicializacion acotada con `events.list`, ventana -7/+30 y limite legacy valido. Ausencia de clave legacy no bloquea; un valor invalido se informa. `syncToken` posterior sin timeMin/timeMax/orderBy/q. Mantener singleEvents=true, showDeleted=true, showHiddenInvitations=true y fields estables. El token es un cursor del proveedor, no un token OAuth.
- Descubrimiento: una lectura agrupada de la ventana completa en cada ejecucion, para detectar entrada en horizonte o Foco sin cambios Google. Solo crea citas de contactos activos en Foco; SQL vuelve a derivar participantes elegibles al aplicar. No es importacion historica. Historico y su politica UX-DATE-01 permanecen separados.
- Paginacion: continuar automaticamente hasta agotar nextPageToken, incluso paginas vacias. Paginas de 250; lotes transaccionales de hasta 50. No hay corte por 20 elementos ni limite de diez paginas por clic. El progreso se muestra sin exponer citas; no hay continuacion programada tras cerrar la app.
- Unificar eventos por ID exacto y version; versiones discrepantes sin orden demostrable requieren lectura puntual. Los cambios de Google actualizan fuentes ya vinculadas aunque salgan de ventana/Foco. Huellas de contenido y asociaciones locales evitan reescribir eventos sin cambios y detectan cambios locales de Foco/identidades/vinculos.
- ID excepcional: adopcion inicial de fuentes previas, recuperacion tras 410 o evidencia ambigua. Nunca barrer rutinariamente las citas ausentes de la ventana. Un 410 reinicializa el cursor, no borra interacciones ni notas. Puede requerir comprobar muchos IDs previamente vinculados fuera de ventana; ese coste excepcional no se presenta como el coste normal del clic.
- 403/404 no cancelan: conservar datos, diferir la fuente 24 horas y continuar las demas. Una respuesta normal recibida elimina esa espera. Mientras exista trabajo exigible inaccesible, no certificar exito completo ni adelantar cursor. Reintentos transitorios acotados con backoff/jitter; 401 solicita reconexion, sin OAuth automatico.

Cancelacion solo con status=cancelled del ID/ocurrencia exacto. Un tombstone minimo con id/status es valido: no exige fecha, asistentes ni titulo. Conservar recurringEventId/originalStartTime en la evidencia transitoria; no cancelar una serie a partir de una excepcion. Reutiliza deleted_at_source: conservar internamente interaccion, fuente, notas y ultima fecha, pero excluirla del timeline/listado normal y de sus contadores antes de paginar. No mostrar una fila "Cancelada en Google Calendar". Una reaparicion valida reconcilia el mismo ID y vuelve a ser visible sin duplicarlo; un clic sin cambios no reactiva tombstones. Las vistas releen tras un nuevo ultimo exito Calendar confirmado, no al cambiar el progreso o expirar el feedback. El helper SQL privado de reconciliacion conserva vinculos manuales/legacy ambiguos y los protegidos por Oportunidades; su contador visible excluye canceladas sin eliminar los IDs tecnicos al editar. Solo retira procedencia Calendar acreditada con asistentes completos. Fuentes compartidas ambiguas siguen requiriendo revision, nunca reparacion automatica. Esta visibilidad no cambia SQL ni la persistencia del lifecycle.

### Persistencia, recuperacion y cutover

`calendar_manual_sync_v2` aísla usuario/cuenta/primary/flujo 2 en tablas privadas con RLS y sin DML cliente. Lease de cinco minutos renovado dentro de la ejecucion; otro dispositivo no puede iniciar mientras este vigente, y un run desplazado no puede escribir ni confirmar. Recibos idempotentes por lote y resultado final permiten repetir una solicitud cuya respuesta se perdio. Cursor, ultimo exito y conteos se confirman juntos. No se persisten payloads completos de Calendar ni credenciales OAuth en estas tablas; solo cursor, hashes, IDs operacionales, conteos y tiempos. Borrado de cuenta/fuente respeta las FKs de cascada.

003 revoca EXECUTE cliente de las cuatro RPC de reconciliacion 002, reutilizadas internamente por el nuevo escritor. 005 cierra ademas la entrada Calendar por periodic/history: el wrapper compartido queda limitado a Gmail/email; discovery usa un nucleo privado con validacion de identidad/interaccion/fuentes bajo locks. Los aliases ambiguos o recursos cruzados producen STOP antes de escribir, no se reasignan. No hay flags/GUC cliente de bypass. El reconciliador frontend v1 y sus mensajes de continuacion manual se retiran; los helpers SQL aun consumidos por v2 no se eliminan. No retirar estas protecciones como rollback. Los scopes y los contratos Gmail/Historico para sus recursos no se amplian.

DEV 001-005 y smoke post-005 cerrados por confirmacion del owner. No repetir SQL, verifiers, grants o smokes ya acreditados sin evidencia de regresion. Para ambientes pendientes, la secuencia sigue siendo: drenar operaciones Google admitidas -> preflight -> migration autorizada -> verifier -> runtime -> smoke. Mantener test_only/Data API ON sin cambios globales por defecto; los locks y su timeout abortan ante contencion, pero no sustituyen el drenaje de solicitudes antiguas. Runtime v2/004 compatible; Calendar pre-v2 falla cerrado y Gmail/Historico conserva sus recursos. No cambiar gate, tester, Data API ni Google Cloud. En PROD: backup recuperable/restore PASS, cadena 001 -> 002 -> 003 -> 004 -> 005 y gates separados de SQL, deployment y smoke. No incluir SQL DEV-only multi-tester.

Fallo antes de COMMIT revierte. Despues: conservar datos/recibos, corregir hacia adelante o mantener Calendar inhabilitado operacionalmente; rollback de runtime no recupera funcionalidad de sync y no autoriza reotorgar RPCs. Verificacion OAuth publica y E2E real siguen siendo gates manuales.

Smoke confirmado por el owner: conexion/reconexion Calendar admin, no-admin rechazado, sin habilitar Gmail/Contacts; un clic completo; segundo clic sin novedades; reprogramacion fuera de ventana y cancelacion fuera del timeline. Post-005: primer y segundo clic PASS, sin duplicados, errores ni continuaciones manuales. La cobertura de paginacion/lotes, cero GET rutinarios, Foco/horizonte, notas, errores intermedios, respuestas perdidas, concurrencia, abandono y ataques legacy proviene de pruebas locales sinteticas con PostgreSQL aislado; no se presenta como smoke remoto ni certificacion de cuotas o consentimiento publico.

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

La aplicación de cambios de Google Contacts en R2-B usa `apply_google_contact_sync_change_r2b`, con ownership, acceso efectivo y versión esperada del ciclo, también cuando no hay ciclo activo. Se mantienen los scopes de solo lectura y la revisión previa; la RPC anterior de contactos no está disponible para roles cliente tras el forward-fix.
El uso del conector también está sujeto a autorización interna de la app.

## OAuth y cuenta conectada
Google login y Google Connected Account son intents distintos.

El contrato SEC-GOOGLE-01 se promueve por fases `expand -> runtime -> contract`. Las reglas de rollout y persistencia descritas a continuación representan el estado objetivo del repositorio; el estado efectivo de cada ambiente debe verificarse durante su release.

Los OAuth clients, callbacks, redirects y su separación por ambiente se documentan en [ENVIRONMENTS.md](../ENVIRONMENTS.md).

El login Google se inicia desde `AuthGate` usando Supabase Auth con provider `google` y scopes mínimos de identidad: `openid`, `email` y `profile`. Usa PKCE y vuelve a `/auth/callback`, donde el SDK intercambia el código antes de entrar a la app. Este login no registra ni actualiza `connected_accounts`, no solicita Contacts, Gmail ni Calendar, y no sirve por sí solo como consentimiento para leer datos Google.

La conexión de datos con Google también usa `supabase.auth.signInWithOAuth`, con provider `google`, PKCE, callback explícito y scopes de datos normalizados, deduplicados y unidos en un string separado por espacios. Cuenta inicia este OAuth desde la acción concreta de Contacts, Gmail o Calendar y solicita únicamente el scope readonly de ese servicio. Las ampliaciones usan consentimiento incremental de Google (`include_granted_scopes=true`) para que el token efectivo nuevo conserve los grants anteriores. Iniciar y finalizar este OAuth exige la elegibilidad de rollout `connectors.google.use` y la capability operativa de cada servicio solicitado; esta decisión no depende de scopes persistidos antes de crear la cuenta conectada. Google Login básico permanece independiente.
Antes de iniciar OAuth de datos, la app recuerda temporalmente los scopes solicitados y un intent de conexión de datos en `sessionStorage`. Esos scopes son intención de OAuth, no evidencia de permisos concedidos.
Al volver desde Google, si el intent, nonce y fingerprint del token son coherentes, el navegador llama `POST /api/google/connected-account/finalize` con el `provider_token` temporal y el access token Supabase de la sesión.
La ruta server-side valida sesión Supabase, acceso efectivo de Coffeecito, elegibilidad de rollout, capabilities operativas solicitadas, Google UserInfo, tokeninfo, audience/client binding, expiración y scopes efectivos. La RPC de persistencia vuelve a comprobar rollout y filtra cada scope por su capability operativa antes de crear o actualizar la conexión local.
La conexión local se guarda en `connected_accounts` con proveedor, email Google verificado, últimos scopes efectivos verificados, capacidades derivadas, estado `active`, `revoked_at` vacío y metadata de verificación de scopes.
Para operar, la app exige una fila activa de `connected_accounts`, un `session.provider_token` disponible en la sesión actual y un fingerprint de token marcado como autorización de datos aceptada en esa sesión.
Una cuenta puede estar vinculada, pero sin permiso activo si la sesión actual no trae token utilizable o si el login Google normal posterior no pasó por autorización explícita de datos.

Una cuenta también puede permanecer vinculada pero inoperativa si pierde rollout o la capability interna del servicio. Contacts exige `contacts.sync_external`, Gmail exige `interactions.sync_email` y Calendar exige `interactions.sync_calendar`; cada operación combina esa capability con el scope efectivo persistido de la cuenta. El rollout inicial se concede a `beta_tester` y puede ampliarse más adelante mediante grants de rol o plan, sin cambiar los guards. Un override positivo no habilita rollout y un `deny` activo prevalece.

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
- desde Cuenta, el Historical Bootstrap exige una etiqueta Gmail de usuario (`type=user` en la respuesta de la API) elegida por el usuario y combina su `labelId` con el límite histórico; en el candidato UX-DATE-01 este límite viene del ciclo activo y la política global, no de la clave legacy;
- el Historical Bootstrap captura un `historyId` base antes de leer, conserva un snapshot normalizado solo en memoria y aplica la selección sin volver a consultar Gmail;
- el cursor Gmail global se inicializa después del Apply únicamente cuando la lectura fue completa y todos los elementos seleccionados se aplicaron sin error;
- puede acotar por emails de contactos cuando el flujo está en scope de foco o contacto específico;
- en lectura histórica scoped, divide los emails únicos en búsquedas de hasta 20 direcciones y deduplica por `messageId` antes de leer el detalle entre búsquedas;
- el máximo de correos se aplica tanto al total consolidado como al total de lecturas de detalle de la revisión. El presupuesto de páginas se comparte de forma conservadora, reservando al menos la primera página necesaria para cada búsqueda scoped.
UX-DATE-01 (solo candidato local) conserva el contexto/revisión de la ventana entre Review y Apply y lo envía en cada escritura histórica a `apply_google_history_v1`. La ruta periódica usa `apply_google_periodic_v1` sin imponer el máximo histórico. Ambas delegan al núcleo Google ya existente; no cambian scopes, OAuth, cuenta conectada ni permisos de operación. No se prueba server-side la procedencia histórica/incremental del lote: esa ampliación fue expresamente excluida. Detalle y compatibilidad en INGESTION_SYNC y PROD_CONTRACTS.

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
Si el sync global no tiene cursor, el cursor pertenece a otra cuenta o Gmail lo informa vencido, captura primero el `historyId` actual y recupera como máximo los últimos 14 días para los emails Foco, respetando además una fecha de inicio de networking posterior si está configurada. No usa una etiqueta Gmail y guarda el baseline capturado solo después de una lectura completa y un Apply exitoso. Sin contactos Foco o emails utilizables, el recovery no recorre mensajes y puede inicializar el baseline como no-op exitoso.
El botón global del Shell ejecuta Review y Apply como una sola acción sin preview visible. El Historical Bootstrap de Cuenta conserva Review, selección y Apply explícitos.
En la ficha, Gmail ejecuta un backfill directo de como máximo los últimos 14 días para todos los emails utilizables del contacto, únicamente cuando está marcado como Foco. Una fecha de inicio de networking posterior acorta ese período. Conserva el snapshot normalizado entre Review y Apply, no muestra preview, no usa `history.list` ni etiqueta histórica, y no lee ni escribe cursores Gmail globales o `contact:<contactId>`.
En la ficha, Calendar consulta directamente una ventana móvil de como máximo 7 días antes de la corrida hasta 30 días después para los emails utilizables del contacto Foco; una fecha de inicio de networking posterior acorta el límite inferior. No lee ni escribe cursores `contact:<contactId>` y no modifica la frescura global.
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
El sync periódico manual global consulta solo contactos activos Foco y sus emails utilizables. El sync periódico de ficha consulta solo el contacto Foco actual. Ambos leen una vez el calendario `primary` dentro de una ventana móvil de como máximo 7 días antes de la corrida hasta 30 días después; una fecha de inicio de networking posterior acorta el límite inferior. Paginan esa lectura y filtran localmente por asistentes u organizador que coincidan con emails Foco. La cantidad de requests depende de las páginas de la ventana y no del número de emails Foco. No usan `syncToken` y deduplican eventos por ID antes de aplicar idempotentemente.
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
Contacts produce contactos externos normalizados que luego entran al flujo genérico de revisión de contactos.
Gmail y Calendar producen interacciones externas normalizadas que luego entran al flujo genérico de revisión de interacciones.
Las interacciones externas conservan proveedor, servicio de origen, tipo de objeto externo, identidad externa, hilo externo, URL externa, fecha, asunto, detalle, participantes, metadata y hash de contenido.
La persistencia final Google usa RPCs transaccionales específicas que revalidan rollout, capability operativa, ownership, estado de la cuenta y scope antes de cada elemento. Las RPCs fijan el proveedor en servidor y mantienen el contacto o interacción local junto con su fuente externa; una revocación efectiva detiene elementos posteriores sin confiar en provenance enviado por el cliente. vCard, iCalendar y ediciones manuales siguen rutas independientes.

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
