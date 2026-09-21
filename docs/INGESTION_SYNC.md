# Ingestión y sincronización

## Propósito

Este documento describe cómo CRM Networking lee datos externos, los convierte en estructuras internas o propuestas de cambio, y mantiene continuidad entre proveedor, cuenta conectada, identidad externa, snapshot externo y objeto local.

La aplicación vigente tiene Google como proveedor implementado. Los conceptos de este documento son agnósticos cuando el código lo permite, pero se distinguen los comportamientos que hoy pertenecen al conector implementado y no deben elevarse automáticamente a contrato universal.

No documenta scopes, endpoints, parámetros concretos de APIs, diseño visual, permisos comerciales, contratos completos de acciones ni reglas del Coach. Esos temas pertenecen a documentos especializados.

## Conceptos y responsabilidades

Proveedor es el sistema externo desde el que se leen datos.

Cuenta conectada representa una conexión de un usuario con una cuenta de un proveedor. Permite acceder a datos externos dentro del alcance autorizado, pero no reemplaza la cuenta de acceso a la app.

Identidad externa es la referencia persistente a un objeto del proveedor. En contactos vive en `external_contact_ids`. En interacciones vive en `external_interaction_sources`.

Snapshot externo es una representación conocida de un objeto externo. Hoy existe snapshot explícito para contactos en `external_contact_snapshots`.

Objeto local es el objeto propio de CRM Networking, como contacto o interacción. Su identidad principal es un UUID interno de la app, no el ID del proveedor.

Propuesta de cambio es el resultado de comparar lectura externa, vínculos conocidos, snapshots y datos locales antes de aplicar cambios. Una propuesta no modifica por sí sola los datos locales.

## Patrón general observado

El patrón general observado es:

    Lectura externa
      ↓
    Adaptación y normalización
      ↓
    Comparación contra vínculos, snapshots o datos locales
      ↓
    Preview cuando el flujo requiere confirmación
      ↓
    Aplicación de selección confirmada
      ↓
    Persistencia de objeto local, vínculos, snapshots, logs y cursores

Este patrón no significa que exista un pipeline único universal. Contactos e interacciones comparten ideas, pero usan implementaciones distintas.

Contactos tienen una separación explícita entre cálculo de preview y aplicación. Interacciones también pueden usar preview, pero su continuidad principal se apoya en fuentes externas vinculadas a interacciones locales.

## Sincronización de contactos

El flujo de contactos lee objetos externos, contactos locales activos, vínculos externos existentes, snapshots conocidos y cursores cuando corresponde.

Un contacto externo se considera conocido si su identidad externa aparece vinculada a una ficha local mediante `external_contact_ids`. Un conector también puede aportar identificadores o aliases anteriores para reconocer continuidad externa cuando el proveedor lo soporta. Ese mecanismo es específico del conector y no forma parte del contrato genérico.

Si el contacto externo no tiene vínculo persistente, el flujo actual lo clasifica como nuevo. Una coincidencia de correo o teléfono puede ser evidencia para revisión posterior, pero no convierte la importación en una fusión automática.

`external_contact_snapshots` representa el estado conocido del proveedor. Ayuda a distinguir cambios reales del proveedor frente a normalizaciones locales o ediciones del usuario. En el código observado se usa especialmente para recordar correos y teléfonos conocidos del proveedor.

El preview de contactos puede generar propuestas de nuevos, modificaciones, eliminaciones o sin cambios. El tipo técnico soporta otras categorías históricas o auxiliares, pero la importación actual de contactos no usa coincidencias de segundo orden como merge automático.

La aplicación procesa solo cambios seleccionados y accionables. Un nuevo externo crea contacto local, medios de contacto, identidad externa y snapshot. Un externo conocido modificado actualiza operaciones aplicables y luego refresca identidad externa y snapshot.

Después de aplicar cambios de creación o modificación, se registran vínculos externos y snapshots, se audita el cambio y se gatilla revisión acotada del Coach para contactos afectados.

El cursor de contactos se guarda solo si la aplicación termina sin errores, existe cursor nuevo y no quedan cambios pendientes del preview. Si quedan cambios sin aplicar, el cursor no avanza.

## Eliminación de contactos externos

En lectura completa o histórica, si una ficha local tiene identidad externa vinculada y esa identidad no aparece en la lectura externa, el flujo genera una propuesta de eliminación/desactivación.

En lectura incremental, la ausencia dentro del lote no elimina el contacto. Para generar propuesta de eliminación en incremental, el objeto externo debe llegar con una señal explícita de eliminado desde el conector.

La eliminación detectada requiere preview y selección/confirmación igual que otros cambios accionables. No se aplica silenciosamente al calcular diferencias.

Al aplicar una propuesta de eliminación, el código observado actualiza `contacts.is_active = false` y `contacts.sync_status = "missing_from_source"` para el contacto local afectado.

No se observó que esa rama de aplicación desactive o modifique `external_contact_ids`. Tampoco se observó que actualice `external_contact_snapshots` al aplicar la eliminación. La rama solo desactiva el contacto local y audita el cambio.

Si la ficha local tiene datos editados manualmente, la eliminación sigue desactivando la ficha completa si el usuario confirma esa propuesta. No se observó una protección especial para preservar activo un contacto por tener edición manual.

Si una ficha tiene más de una identidad externa, el flujo de preview evalúa vínculos por identidad externa y proveedor. No se observó una regla explícita que impida desactivar el contacto cuando falta una identidad externa pero existe otra identidad externa activa asociada al mismo contacto.

No contemplado explícitamente en el flujo observado: política de eliminación cuando el contacto local tiene múltiples identidades externas activas y solo una desaparece del proveedor.

## Matching, dedupe y merge

External identity matching es reconocer continuidad mediante un vínculo persistido de proveedor. En contactos usa `external_contact_ids`; en interacciones usa `external_interaction_sources`.

Contact matching es detectar señales de posible equivalencia, como correo o teléfono. En el flujo actual de contactos, esa señal no basta para fusionar ni para tratar el objeto externo como conocido.

Duplicate detection es la revisión de coincidencias entre fichas locales. Vive fuera del pipeline principal de importación.

Merge es una acción explícita que combina fichas locales. Sync puede convivir con herramientas de merge, pero matching no implica merge automático.

## Precedencia y propuestas de cambio

Durante sync de contactos, la regla observada preserva datos locales no vacíos.

Para nombre, empresa y cargo, el proveedor puede completar campos vacíos. Si el contacto local ya tiene un valor distinto, el cambio puede mostrarse como diferencia, pero queda no aplicado por defecto.

Los valores vacíos se limpian antes de comparar. Nulos, textos equivalentes a ausencia de dato y valores sin contenido se tratan como vacío funcional.

Para correos y teléfonos, el proveedor puede agregar valores que no existan en la ficha local. La comparación usa normalización para evitar falsos cambios por formato.

La eliminación de correos o teléfonos previamente conocidos desde el proveedor puede mostrarse como propuesta no aplicada. El flujo no borra por defecto datos locales solo porque ya no aparecen en la lectura externa.

Cumpleaños de contactos externos se conservan actualmente como dato externo/snapshot. No se observó reflejo automático en un campo local editable.

En interacciones, la fuente externa puede actualizar datos técnicos de la interacción vinculada, como fecha, asunto, tipo, dirección o detalle de origen. Las notas del usuario no son espejo del proveedor. En el código observado, la actualización desde fuente externa no reemplaza `user_notes_raw`.

## Sincronización de interacciones

Las interacciones se procesan como objetos externos adaptados a una estructura interna antes de compararse o persistirse.

Las fuentes actuales de interacción incluyen correo y calendario del proveedor implementado. Sus estrategias de lectura son distintas, pero ambas terminan en el patrón de interacción externa hacia interacción local.

El alcance puede ser general, acotado a contactos en foco o acotado a un contacto específico, según el entry point actual. El flujo usa correos de contactos locales para mapear participantes y determinar relevancia.

El preview compara cada objeto externo contra fuentes externas ya persistidas. Si no existe fuente activa, se propone como nuevo. Si existe fuente activa y hay diferencias reales, se propone como modificado. Si la fuente está bloqueada para reimportación, se omite.

Al aplicar, se persisten solo los objetos externos seleccionados. Si existe una fuente externa activa, se actualiza la interacción local asociada. Si no existe, se crea o encuentra una interacción local y se registra la fuente externa.

Los participantes se agregan por contacto local o identidad de correo. El flujo agrega participantes faltantes, pero no elimina participantes previos solo porque una nueva lectura venga con menos datos.

`external_interaction_sources` mantiene identidad externa, vínculo local, estado de sync, huella de contenido y flags de lifecycle/reimportación.

No se observó una política universal cerrada para propagar eliminaciones en origen sobre interacciones locales.

## Identidad externa e idempotencia

La idempotencia busca que reintentar una lectura conocida no cree duplicados.

En contactos, el mecanismo principal es `external_contact_ids`. El snapshot complementa la comparación y ayuda a distinguir cambios externos reales frente a normalización local.

En interacciones, el mecanismo principal es `external_interaction_sources`. Si la fuente externa activa ya existe, el flujo actualiza la interacción asociada en vez de crear una nueva.

Los medios de contacto tienen unicidad dentro de cada contacto por valor normalizado. Esa regla evita duplicados dentro de una ficha, pero no impide que dos fichas compartan correo o teléfono.

Los hashes de contenido ayudan a registrar estado de fuente externa, pero no reemplazan la identidad externa persistida.

Idempotencia no es dedupe. Idempotencia evita repetir el mismo objeto externo; dedupe detecta posibles duplicados locales.

## Cursores e incrementalidad

`sync_cursors` guarda marcas de avance por usuario, proveedor, recurso y etiqueta de cursor.

La unicidad vigente es por `user_id`, `provider`, `resource_type` y `cursor_label`. Aunque existe `connected_account_id`, esa columna no participa en la clave única actual.

Los cursores permiten pedir o procesar cambios incrementales cuando el conector lo soporta. Si no hay cursor válido, el flujo puede caer a lectura completa según recurso y conector.

En contactos, el cursor no se guarda al preparar preview. Solo puede guardarse después de aplicar exitosamente y cuando no quedan pendientes.

En interacciones, algunos entry points usan incrementalidad y persisten cursor; otros fuerzan lectura completa y no avanzan cursor. Esa diferencia existe hoy y debe mantenerse explícita hasta que se formalice un contrato común.

El cursor no debe avanzar durante una revisión sin aplicación ni cuando quedan cambios pendientes o fallidos.

## Eliminación y reimportación

Contactos usan desactivación local para representar ausencia o eliminación confirmada desde proveedor. No se observó borrado físico como comportamiento normal de sync.

Interacciones usan soft delete local y pueden marcarse para evitar reimportación.

`prevent_reimport` existe en interacciones y fuentes externas. Cuando una fuente externa está bloqueada para reimportación, el flujo de interacción la omite.

No existe una política única aplicable a todos los recursos. Contactos e interacciones tienen lifecycle distinto.

Si un objeto eliminado puede reaparecer depende del recurso y de si conserva identidad externa activa, snapshot, fuente externa o bloqueo de reimportación. No se observó una regla universal.

## Logs y diagnósticos

`sync_run_logs` registra pasos técnicos de una ejecución. Ayuda a responder qué se intentó, con qué recurso, en qué alcance y dónde falló.

`external_interaction_read_diagnostics` guarda evidencia diagnóstica de lecturas externas que pueden o no transformarse en interacciones. Ayuda a explicar por qué un objeto leído no llegó al preview o quedó filtrado.

`audit_log` registra auditoría de negocio sobre cambios aplicados a objetos. No reemplaza al log técnico de sync.

`action_invocations` registra trazabilidad de acciones internas ejecutadas o fallidas, incluidas aplicaciones de sync.

Existe sanitización de logs técnicos. Los detalles sensibles del mecanismo de sanitización pertenecen a seguridad y privacidad.

## Preview y confirmación

Contactos usan preview antes de modificar datos locales. La aplicación solo procesa selección confirmada.

Interacciones también pueden producir preview para actividad externa. La aplicación usa la selección para persistir únicamente objetos elegidos.

El preview puede incluir nuevos, modificados, omitidos o sin cambios según recurso. La UI puede ocultar categorías no accionables, pero la lógica puede conservarlas para conteo o diagnóstico.

Calcular una propuesta no debe equivaler a aplicar cambios. Esta frontera es central para flujos que afectan datos del usuario.

## Suppressions

`sync_change_suppressions` existe como tabla persistente.

No se encontró escritura persistente activa hacia esa tabla en los flujos revisados.

No se encontró lectura persistente activa desde esa tabla en los flujos revisados.

`contactSyncPreview` acepta `suppressedChangeKeys` en memoria y puede omitir ciertos cambios si el caller los entrega.

No debe presentarse “no volver a sugerir” como funcionalidad vigente hasta que exista flujo cerrado de lectura, escritura y experiencia de usuario.

## Errores y recuperación

Los flujos observados capturan errores de lectura, errores parciales, cambios fallidos y cambios pendientes.

Cuando hay fallos o pendientes relevantes, los cursores no avanzan en los casos donde avanzar cursor podría ocultar trabajo no confirmado.

La aplicación puede devolver resultados parciales: algunos objetos aplicados, otros fallidos y otros pendientes.

No se observó una cola background, backoff automático ni retry genérico programado. La recuperación actual es principalmente un reintento explícito desde un entry point de la app, apoyado por logs y diagnósticos.

Los detalles de autenticación, tokens, permisos y reconexión del proveedor implementado pertenecen al documento del conector.

## Imports no conectados

`import_batches` existe como estructura persistente para registrar lotes de importación.

No se observó un flujo funcional completo vigente de importación por archivo comparable al conector actual.

Por lo tanto, este documento no declara CSV, Excel, vCard u otros archivos como imports implementados. Cuando exista ese flujo, deberá documentar lectura, validación, preview, aplicación, idempotencia y auditoría.

## Provider-agnostic vs Google

Los conceptos de sync son provider-agnostic: proveedor, cuenta conectada, identidad externa, snapshot externo, fuente externa, preview, cursor y objeto local.

Google es la implementación actual.

Distintos servicios dentro de un conector pueden tener estrategias de lectura distintas.

Las particularidades del proveedor actual no son contrato universal para conectores futuros.

Antes de sumar otros proveedores, falta formalizar un contrato común de adapter que precise entradas, salidas, garantías y diferencias permitidas.

## Boundaries

El objeto externo no reemplaza la identidad local.

La identidad externa sirve para continuidad con un proveedor, no como ID primario del producto.

Un snapshot externo no es la ficha local.

Normalizar un valor no debe interpretarse como cambio real del proveedor.

Matching por correo o teléfono no implica merge automático.

Dedupe local y sync contra proveedor son procesos distintos.

Preview y apply deben mantenerse separados en flujos que requieren confirmación.

Reintentar un objeto externo conocido no debe crear duplicados.

Sync no debe depender conceptualmente de una pantalla concreta.

Datos específicos del proveedor no deben propagarse al dominio como conceptos universales.

Observabilidad técnica no reemplaza auditoría de negocio.

Los logs de sync deben ayudar al diagnóstico sin exponer secretos o contenido sensible.

## Deuda y ambigüedades vigentes

No existe todavía un contrato común plenamente formalizado para adapters de proveedor.

Contactos e interacciones comparten patrón conceptual, pero sus pipelines no están unificados.

Las claves únicas de `external_contact_ids`, `external_contact_snapshots`, `external_interaction_sources` y `sync_cursors` no incluyen `connected_account_id`.

La eliminación confirmada de contacto desactiva la ficha local, pero no se observó actualización equivalente de `external_contact_ids` ni `external_contact_snapshots` en esa rama.

No se observó manejo explícito para contactos con múltiples identidades externas activas cuando solo una identidad desaparece del proveedor.

`sync_change_suppressions` existe como infraestructura, pero no se observó flujo funcional cerrado.

`interactions` conserva campos específicos de proveedor además de `external_interaction_sources`.

Parte de la orquestación de sync sigue próxima a algunos entry points.

La semántica de imports por archivo no está cerrada aunque exista `import_batches`.

La eliminación en origen para interacciones no tiene una política universal observada comparable a contactos.
