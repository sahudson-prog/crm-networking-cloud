# Product detail and vision

Este documento describe el producto desde la perspectiva del usuario. No explica como esta construido por dentro.

## Proposito

CRM de networking para busqueda laboral. Ayuda al usuario a organizar contactos, acciones pendientes, conversaciones, citas, seguimiento y oportunidades derivadas de su red.

## Usuario objetivo

Persona que esta buscando trabajo o gestionando networking profesional activo. Necesita recordar a quien contactar, que se converso, que accion viene despues y que oportunidades o referidos aparecieron.

## Promesa del producto

Convertir contactos dispersos, correos, citas y notas en una vista accionable de networking: que personas mover, que relaciones cuidar, que seguimientos hacer y que oportunidades no olvidar.

## Funcionalidades actuales

### Dashboard

Vista de gestion diaria.

Incluye:

- KPIs de actividad reciente: total cafes, contactos realizados y contactos HH realizados, con barras de primera vez cuando aplica.
- Selector semanal/mensual para KPIs, limitado por fecha global de inicio de networking y maximo 12 periodos.
- Ultimas interacciones.
- Empresas headhunter.
- Contactos sin interaccion reciente.
- Panel Coach IA con sugerencias basadas en reglas o IA.

### Contactos

Vista para gestionar la base de contactos.

Incluye:

- Tabla de contactos.
- Filtro global con pipeline, busqueda, categorias y orden de tabla.
- Seleccion multiple.
- Acciones masivas.
- Marca de foco networking.
- Marca de headhunter.
- Cambio masivo de estado.
- Acceso a ficha individual.

### Ficha de contacto

Vista individual de un contacto.

Incluye:

- Bloque superior de identidad, datos y acciones del contacto.
- Correos y telefonos visibles como datos limpios, con acciones compactas para enviar correo, llamar o abrir mensajeria cuando la plataforma lo permita.
- Estado de networking, foco networking y marca headhunter gestionados con los mismos controles compactos usados en la vista Contactos, pero aplicados solo al contacto actual.
- Timeline de interacciones.
- Edicion de notas del usuario.
- Sincronizacion de contacto e interacciones.
- Relaciones o contactos vinculados.
- Coach contextual filtrado al contacto actual, como version compacta del panel conversacional del Dashboard.

Direccion de diseno aprobada para la ficha:

- Cada bloque debe ser un componente reutilizable y mantenible: datos/acciones, interacciones, contactos referidos y Coach contextual.
- El bloque de datos y acciones reemplaza el boton grande de cambio de estado por controles compactos alineados.
- Las interacciones se muestran como filas limpias con fecha, mini icono de tipo y titulo. Al expandir, se muestra directamente la minuta editable o el contenido editable de la interaccion.
- Los colores de interacciones respetan el estandar actual: email blanco/gris, cita/reunion azul claro, mensaje/WhatsApp verde claro y llamada amarillo claro.
- Si una interaccion tiene mas de un participante, debe mostrar un indicador pequeno de personas. Al pasar el mouse, explica que es una interaccion compartida y muestra participantes por rol (`De`, `Para`, `CC`, `CCO`), sin duplicar la interaccion en la UI.
- Contactos referidos usa tarjetas compactas: nombre manual en negrita, apunte libre en gris, separacion visual sutil y zona inferior para vinculo. Si existe contacto vinculado, se muestra su nombre y debajo el estado networking con punto de color oficial; si no existe, esa zona queda vacia y solo aparece `Vincular`. Los controles `Vinculado`, `Vincular` y `Agregar` deben abrir un mismo flujo global para crear o editar referidos.
- Coach contextual aparece sobre contactos referidos, con la mascota del Coach pequena a la izquierda y sugerencias filtradas al contacto, reutilizando el mismo lenguaje visual de burbujas del Dashboard.
- Las marcas binarias como foco networking y headhunter deben preferir switches/toggles por claridad y compatibilidad futura con mobile.

### Referidos y contactos

El producto distingue entre dos objetos:

- Contacto: persona real administrada por la app, con estado de networking, datos de contacto, foco, marca headhunter e historial.
- Referido: apunte estructurado de una persona recomendada por un contacto. Puede existir sin contacto vinculado y luego convertirse o vincularse a un contacto real.

Un referido debe guardar al menos:

- Quien refiere.
- Nombre del referido.
- Empresa.
- Cargo.
- Telefono.
- Email.
- Notas adicionales.
- Contacto vinculado, opcional.

Los datos del referido son apuntes libres y siempre editables. No reemplazan automaticamente los datos del contacto vinculado. Cuando existe un contacto vinculado, la ficha puede mostrar ambos mundos: lo que se apunto como referido y el contacto real asociado.

Direccion funcional aprobada para el flujo global:

- Debe existir una funcion oficial para crear o editar contactos. Esta funcion sera usada por Contactos, Ficha, Referidos y Coach IA cuando corresponda.
- Debe existir una funcion oficial para crear o editar referidos. Esta funcion permite guardar el referido sin vinculo, vincularlo a un contacto existente, crear un contacto nuevo desde los datos del referido o editar el contacto vinculado.
- Si el flujo se abre desde la ficha de un contacto, `quien refiere` viene preseleccionado con ese contacto.
- Si el flujo se abre sin contexto, el usuario debe seleccionar manualmente quien refiere.
- Si se selecciona un contacto existente, sus datos se muestran como contacto vinculado y no se editan desde los campos del referido.
- Si no hay contacto vinculado, el usuario puede prellenar un nuevo contacto desde los datos del referido.
- La creacion/edicion de contacto valida email y telefono, y alerta posibles duplicados antes de guardar.
- La desactivacion de contactos debe pedir confirmacion y no debe borrar minutas, interacciones, referidos ni historial; solo marca el contacto como `Desactivado` y lo saca del foco networking.
- Mientras se crea o edita un contacto desde el flujo de referido, la edicion del referido queda deshabilitada temporalmente para mantener foco.
- El Coach IA podra usar este mismo flujo en el futuro para proponer crear o vincular referidos detectados en minutas o interacciones.

Estado actual implementado: existe una primera version del popup `Referidos y contactos` con referido editable, contacto vinculado opcional, creacion/edicion de contacto desde el flujo y retorno automatico al referido. En cloud, la ficha ya abre este flujo desde `+`, `Vincular` y `Vinculado`, reutilizando el editor oficial de contacto. Queda pendiente validacion visual/funcional fina con datos reales.

### Empresas headhunter

Agrupacion de contactos headhunter por empresa/dominio para facilitar seguimiento a empresas de seleccion.

### Coach IA y pendientes

Panel de sugerencias accionables.

Incluye:

- Cambios de estado sugeridos.
- Evidencia asociada.
- Confirmacion manual antes de ejecutar.
- Configuracion por regla concreta de sugerencia, con opciones para no volver a sugerir, ejecutar sin consultar o pedir confirmacion siempre.
- Mascota original del Coach IA ubicada a la izquierda de la conversacion, con animacion suave.
- Sugerencias presentadas como conversacion compacta en lenguaje humano, agrupadas por tipo de motor, con cerca de cuatro mensajes visibles y scroll propio para el resto.
- Acciones contextuales dentro de cada sugerencia, por ejemplo ir a la ficha del contacto o agregar minuta desde una cita concretada.
- Historial simple de sugerencias que ya no estan vigentes, filtrable por `done`, `dismissed`, `expired` y `auto resolved`, con motivo de cierre, regla, evidencia y acceso directo al contacto para investigar que paso.

Si una sugerencia nace de una interaccion compartida por varios contactos, por ejemplo un correo con varios destinatarios, debe existir una sola sugerencia. Esa sugerencia puede aparecer en todas las fichas relacionadas, pero al ejecutarla, descartarla o resolverse desaparece de todas porque es el mismo objeto de Coach.

### Modelo de suscripcion previsto

La experiencia del Coach IA debe poder habilitar capacidades por nivel de suscripcion:

- Basica: sugerencias basadas en reglas duras, sin uso de IA generativa. Ejemplos: cambios de estado por correos, mensajes, citas futuras o citas ya realizadas.
- Pro: todo lo anterior, mas sugerencias con apoyo IA. Ejemplos: lectura de minutas editables, deteccion de proximas acciones, referidos u oportunidades mencionadas.
- Networking Goat: vision futura. Ademas de sugerir, podria ayudar a ejecutar acciones asistidas como redactar mensajes, preparar correos, crear citas, crear recordatorios o abrir flujos externos con informacion precompletada. Estas acciones deben mantener control del usuario y confirmacion cuando corresponda.

El producto debe separar claramente las sugerencias por capacidad disponible, para que el usuario entienda que esta incluido en su plan y que queda como mejora posible.
La mascota del Coach IA debe ser original y evolucionar visualmente por plan, evitando copiar personajes protegidos o personas reales.

El modelo de planes no debe ser rigido. La plataforma debe poder marcar cada tipo de sugerencia, automatizacion, accion interna y capacidad de sincronizacion segun el tier donde estara disponible. Esto permite combinaciones flexibles: una sugerencia puede estar disponible en Basica pero sin autoejecucion, otra puede requerir Pro para aparecer, y otra puede aparecer en Pro pero solo automatizarse en Networking Goat.

Los tipos de sugerencia y automatizacion deben poder cambiar de tier sin reprogramar la logica central. La configuracion por usuario, como no volver a sugerir, pedir confirmacion siempre o ejecutar sin preguntar, debe respetar primero el plan disponible y luego la preferencia del usuario.

En el end game, los planes comerciales deben alimentar un mantenedor de perfiles/capacidades mas amplio. Ese mantenedor define vistas disponibles, permisos, conectores, cuotas, limites de sync/import, acciones automatizables, exportaciones y auditoria. El perfil efectivo del usuario puede combinar plan personal, patrocinio de empresa, upgrades, permisos especiales y configuracion individual.

### Monetizacion y clientes outplacement

El producto puede servir tanto a usuarios individuales como a empresas de outplacement que compran membresias para sus candidatos.

Vision de monetizacion:

- B2C: el usuario paga directamente por su plan.
- B2B: una empresa de outplacement paga un tier base para uno o mas usuarios.
- Upgrade individual: si una empresa paga un tier base, el usuario puede pagar por separado el diferencial para subir a un tier superior, si quiere y puede hacerlo.

El usuario siempre debe entender que capacidades tiene disponibles, que capacidades estan patrocinadas por una empresa y cuales podria habilitar pagando un upgrade. El modelo comercial no debe afectar la privacidad: una empresa patrocinadora no obtiene acceso automatico al detalle privado de contactos, correos, minutas o networking del usuario salvo un consentimiento y alcance explicito futuro.

### Analitica agregada y privacidad

La plataforma debe poder generar analisis derivados de contactos, interacciones, estados, uso y tiempos de transicion, siempre resguardando privacidad.

Ejemplos de analitica futura:

- Estadisticas de uso de la app y del Coach.
- Curvas de avance de networking por etapa.
- Tiempos de busqueda laboral o desempleo, si el usuario entrega ese contexto.
- Benchmarks agregados para entender patrones de seguimiento, citas y conversion.
- Analitica para clientes outplacement con datos agregados y anonimizados.

Principios:

- Los datos personales identificables del usuario no deben exponerse en reportes agregados.
- Los reportes para empresas deben partir por agregados anonimizados, no por trazas individuales.
- Cualquier uso avanzado de datos debe tener consentimiento, control y explicacion clara.
- Las metricas deben poder recalcularse desde datos base y no depender de calculos dispersos en la UI.

## Estados oficiales de networking

- Pendiente: contacto aun no accionado.
- Contactado: ya hubo correo, mensaje o llamada saliente.
- Agendado: existe cita futura.
- Cita concretada: la cita ya ocurrio.
- Agradecimiento enviado: se envio mensaje posterior a la cita.

## Principios de experiencia

- Menos texto, mas accion.
- Tablas accionables y ordenables.
- Filtros cerca de las tablas.
- Acciones compactas con iconos claros.
- La web debe verse bien en desktop y mobile. En mobile, evitar botones secundarios gigantes a ancho completo; priorizar controles compactos, tactiles y faciles de escanear.
- Confirmaciones solo cuando el cambio puede afectar muchos datos.
- La app debe sugerir, pero el usuario mantiene control.

## Vision pendiente por materializar

### Onboarding

El usuario entra, conecta Google, importa contactos o sube un CSV/Excel, y queda listo para operar sin configuraciones tecnicas.

### Contactos como fuente propia

La app debe tener su propia identidad de contacto. Google, Apple, Microsoft, CSV/Excel u otros servicios son proveedores conectados para importar, actualizar o exportar datos, pero no deben ser la fuente unica de verdad del contacto.

### Interacciones como fuente propia

La app tambien debe ser autocontenida para interacciones. Un usuario debe poder crear contactos, llamadas, notas, mensajes o citas manuales sin conectar ningun proveedor externo.

Cuando una interaccion venga desde un servicio externo, la app debe distinguir dos capas:

- Interaccion de la app: lo que el usuario ve, edita y usa para Coach, KPIs y seguimiento.
- Objeto externo vinculado: correo, evento de calendario, mensaje u otro elemento importado desde un proveedor como Google, Apple o Microsoft.

La app debe mostrar la interaccion propia, no el objeto crudo del proveedor. Al importar un correo o cita, la app crea o actualiza una interaccion equivalente con titulo, fecha, tipo, participantes y minuta editable. La minuta editable es el texto que puede modificar el usuario y la fuente principal que lee Coach; el detalle original del proveedor debe conservarse separado para trazabilidad y sync.

El Coach debe revisar la version editable de la interaccion de la app, no el correo o evento crudo. Para evitar reprocesos, cada motor/regla registra en `object_review_state` que version de la interaccion ya reviso, usando fecha de actualizacion y fingerprint del contenido relevante.

Las interacciones vinculadas a proveedores deben mostrar iconos compactos del servicio conectado, igual que los contactos. El icono indica que existe un vinculo externo y puede servir para abrir el objeto original, sincronizar cambios o revisar el origen segun permisos disponibles.

La sincronizacion no debe depender de botones especificos de una vista. Deben existir funciones oficiales reutilizables para sincronizar contactos, mail, calendario y futuros mensajes, con inputs claros (proveedor, cuenta, alcance, modo, cursores, limites) y outputs claros (conteos, errores, objetos afectados, cursores resultantes). Asi un boton, la ficha de un contacto, el Dashboard, Coach IA o una automatizacion pueden invocar el mismo flujo sin duplicar logica.

Cuando una sincronizacion detecte cambios que pueden modificar datos de la app, debe existir una etapa de revision previa. Esa revision muestra cambios nuevos, modificados, enlaces/combinaciones sugeridas, desactivaciones o eliminaciones, con tarjetas claras y checkboxes para elegir que aplicar. Los cambios desmarcados no se aplican y quedan pendientes para la proxima sincronizacion mientras la diferencia siga vigente. Solo una accion explicita de supresion, como `No eliminar ni volver a sugerir`, impide que ese cambio especifico vuelva a aparecer.

En contactos nuevos, modificaciones y enlaces/combinaciones, el usuario debe poder aceptar la propuesta por defecto o abrir `Editar datos` antes de aplicar. Esa edicion funciona como borrador dentro del preview: para un contacto nuevo permite ajustar el contacto que se va a crear, para una modificacion permite elegir que datos aceptar, y para un enlace/combinacion permite definir el contacto resultante. Nada se guarda hasta que el usuario presiona `Aplicar seleccion`. Por eso, el boton principal del popup debe decir `Ajustar propuesta` y al volver al preview la tarjeta debe quedar marcada como `Propuesta ajustada`.

Si el usuario aplica solo una parte de los cambios revisados, la app debe quitar del preview actual lo que se aplico correctamente y mantener visible lo que quedo pendiente, sin volver a leer Google u otro proveedor. Si la aplicacion falla, el preview no debe ocultarse, para que el usuario pueda revisar o reintentar.

En contactos, la app es la fuente principal una vez que el dato esta dentro del producto. Las fuentes externas enriquecen o proponen cambios, pero un campo vacio en la fuente conectada no borra automaticamente un dato local. Las eliminaciones se revisan aparte, al final del flujo, y deben permitir ignorar ese cambio a futuro cuando el usuario decide conservar el dato local.

Cuando existan duplicados o conflictos de identidad, el producto debe usar una funcion global de Fusionar contactos. Esta funcion puede ser invocada por sync, por el usuario o por Coach IA, y debe recibir 2 o 3 contactos maximo. La interfaz muestra los contactos origen lado a lado y un contacto resultante. El usuario decide que nombre, empresa, cargo, correos, telefonos y otros datos conservar. Los campos binarios de la app, como foco networking y headhunter, no se eligen desde una columna: aparecen como switches del contacto resultante, por defecto activos si cualquiera de los contactos origen los tenia activos. El estado de networking parte por defecto en el estado mas avanzado entre los contactos origen, pero el usuario puede cambiarlo antes de guardar. El mismo patron puede usarse como editor de borrador dentro del preview de sincronizacion, incluso si hay una sola fuente importada.

Al confirmar una fusion, la app debe mover interacciones, referidos, sugerencias/ToDos, IDs externos y datos relacionados al contacto resultante, dejando trazabilidad y sin borrar historial. La fusion implicita durante sync solo debe usarse cuando no hay conflicto; si hay conflicto de datos o varios contactos posibles, debe derivar a esta funcion.

Al eliminar una interaccion vinculada a un proveedor, el usuario debe entender que si el objeto externo sigue existiendo podria volver a importarse en una sincronizacion futura. La app debe ofrecer una opcion para prevenir futuras importaciones de ese objeto, reversible desde configuracion de sync.

### Importador flexible

Uploader con mapeo visual de columnas para cargar contactos desde CSV/Excel.

### Backups

Descarga de respaldo completa por usuario.

Estado actual: la app local incorpora un export espejo desde opciones avanzadas de Contactos. Genera un ZIP para respaldo/migracion cloud con contactos, interacciones, referidos, ToDos, configuraciones, cursores y reporte de validacion. El archivo contiene datos personales y no debe subirse a GitHub ni compartirse por chat.

### Cuenta

La seccion Cuenta debe concentrar las funciones sensibles del usuario:

- Credenciales y sesion.
- Plan suscrito y capacidades disponibles.
- Conexiones con servicios externos, partiendo por Google en v1.
- Estado de sincronizacion por fuente.
- Acciones delicadas de sync, como revisar cambios desde contactos conectados antes de aplicar.
- Backups y exportaciones de datos.
- Eliminacion o desactivacion de cuenta, con confirmacion y explicacion de impacto.

Las vistas operativas, como Contactos o Ficha, pueden invocar funciones de sincronizacion en contexto cuando haga sentido, pero la administracion principal de conexiones, permisos y sincronizaciones delicadas debe vivir en Cuenta para que el usuario entienda que afectan datos y autorizaciones.

### Coach IA avanzado

La app lee minutas editables, detecta proximas acciones, sugiere referidos, propone correos o abre links a Gmail/WhatsApp/Calendar.

Las sugerencias del Coach deben poder transformarse en acciones concretas de la app cuando corresponda. Ejemplos: cambiar estado de networking, crear referido, vincular contacto, abrir editor de minuta o desactivar una sugerencia. Estas acciones deben usar funciones oficiales reutilizables, mostrar confirmacion cuando corresponda y dejar registro de lo ejecutado.

El usuario debe poder revisar que hizo el Coach despues de ejecutar o autoejecutar acciones. El historial debe priorizar lenguaje simple: que cambio hizo, sobre que contacto, cuando ocurrio, si fallo y como volver al contacto para ajustar manualmente.

### Planes y capacidades

El producto debe evolucionar hacia planes de uso que controlen que sugerencias, automatizaciones, acciones internas y sincronizaciones estan disponibles para cada usuario. El primer corte funcional es Basica, Pro y Networking Goat, manteniendo siempre la posibilidad de operar manualmente los contactos y el historial.

La definicion de capacidades por plan debe ser administrable por tipo de sugerencia o accion, no hardcodeada en pantallas. Tambien debe contemplar membresias patrocinadas por empresas y upgrades pagados por el usuario final.

### Explotacion responsable de datos

La plataforma puede generar valor adicional a partir de datos agregados, anonimizados y consentidos. Esto no reemplaza el objetivo principal de la app, que es ayudar al usuario a gestionar su networking, pero puede habilitar reportes de progreso, benchmarks y analitica para outplacement.

Este camino requiere diseÃ±o de privacidad desde el inicio: separar datos operativos personales, eventos de uso, metricas agregadas y reportes compartibles.

### Multiusuario

Cada usuario accede con su cuenta, conecta sus datos Google y ve solo su informacion.

### Plataforma online

La app corre en nube, con limites de uso, seguridad, respaldos y capacidad de escalar.

Direccion aprobada para MVP cloud:

- El MVP cloud replica todo lo actual, pero ordenado y modularizado.
- La app local sigue funcionando en paralelo hasta aprobar comparacion de datos, vistas y KPIs.
- Google sera el unico proveedor conectado en v1. Apple, Microsoft/Outlook y otros proveedores quedan para v2.
- La app no debe escribir en contactos, correos ni calendarios Google en v1; solo leer, importar y sincronizar.
- La fuente de verdad de contactos debe ser la app. Google queda como origen conectado, no como dueno permanente del contacto.
- Debe existir exportacion local completa e importacion cloud espejo para poder migrar sin perder continuidad.
- La experiencia inicial debe ser web responsive/PWA para evitar la mantencion extra de una app nativa mientras el producto todavia esta evolucionando. Cada vista relevante se debe probar tambien en formato mobile web.
- Los costos deben estar controlados desde el primer deploy: limites de sync, pruebas acotadas, alertas, logs y posibilidad de pausar conectores.

### App movil futura

La experiencia debe diseñarse desde ahora con componentes faciles de transformar a mobile: toggles para estados binarios, acciones compactas, listas expandibles, tabs y flujos tactiles. La version web responsive/PWA es la base recomendada para el MVP. En mobile, la app debe evitar patrones actuales que se ven torpes, como botones secundarios ocupando todo el ancho de pantalla sin necesidad. Una app iOS/Android nativa solo se evaluara si aparece una necesidad clara como notificaciones push nativas, compartir contenido desde otras apps, uso offline avanzado, integracion mas profunda con telefono/contactos o distribucion via stores.

## Historial

- 2026-07-15: Se separa la descripcion de producto/vision de los documentos tecnicos y de plan.
- 2026-07-15: Se actualizan KPIs del Dashboard a total cafes, contactos realizados y contactos HH realizados.
- 2026-07-15: Se agregan barras/etiquetas de primera vez en KPIs de contactos y empresas HH.
- 2026-07-15: Los KPIs respetan fecha global de inicio de networking y muestran maximo 12 semanas/meses.
- 2026-07-17: Contactos usa un filtro global que integra pipeline, filtros de tabla y orden.
- 2026-07-20: Se agrega vision de niveles de suscripcion para Coach IA: Basica, Pro y Networking Goat.
- 2026-07-20: Coach IA pasa a tener mascota original animada junto a una conversacion compacta con scroll propio.
- 2026-07-20: Configuracion de Coach IA pasa de categorias tecnicas a reglas concretas en lenguaje de usuario.
- 2026-07-20: Sugerencias de cita concretada agregan accion contextual para abrir la ficha con la cita expandida y editable.
- 2026-07-21: Se aprueba direccion de diseno modular para la ficha de contacto: datos/acciones, interacciones, referidos y Coach contextual.
- 2026-07-21: Se implementa primera version activa de la ficha modular basada en maqueta: bloque de datos/acciones, interacciones compactas expandibles, Coach contextual lateral y referidos en tarjetas. Queda pendiente revision visual fina con usuario.
- 2026-07-21: Se agrega criterio de diseño preparado para futura app movil.
- 2026-07-21: Ficha de contacto cambia foco networking y headhunter a toggles; Coach y referidos avanzan hacia componentes reutilizables.
- 2026-07-21: Se ajusta comparativa visual ficha/maqueta: fondos mas limpios, ancho global mas usable, Coach contextual proporcional y referidos con estado networking visible.
- 2026-07-22: Se ajusta vision de referidos: tarjetas separan apunte y vinculo, no muestran estado cuando no hay contacto vinculado y queda pendiente consolidar el flujo crear/vincular.
- 2026-07-22: Se redefine referido como objeto propio separado de contacto y se aprueba un flujo global que usa un editor oficial de contacto para crear, editar o vincular contactos desde referidos.
- 2026-07-30: Cloud conecta la ficha de contacto al flujo global de referidos y contactos, manteniendo separados el apunte libre del referido y el contacto oficial vinculado.
- 2026-07-30: Se extiende la vision autocontenida a interacciones: la app debe tener interacciones propias y vincularlas a objetos externos importados, conservando fuente cruda separada de minuta editable, links al origen, control de reimportacion tras eliminacion y funciones oficiales de sync reutilizables por vista, Coach, reglas o automatizaciones.
- 2026-07-31: Se define preview de sincronizacion como etapa comun antes de aplicar cambios externos: tarjetas seleccionables por tipo de cambio, campos modificados destacados y cambios desmarcados reaparecen mientras sigan vigentes.
- 2026-08-03: Se define Cuenta como ubicacion principal para credenciales, plan, conexiones externas, sincronizaciones delicadas, backups y eliminacion/desactivacion de cuenta.
- 2026-08-03: El preview de sincronizacion permite usar `Editar datos` como borrador antes de aplicar contactos nuevos, modificaciones y enlaces/combinaciones, reutilizando el patron global de contacto resultante.
- 2026-07-22: Se implementa primera version funcional del flujo `Referidos y contactos`.
- 2026-07-22: Editor oficial de contacto agrega desactivacion con confirmacion y preservacion de historial.
- 2026-07-22: Se incorpora la vision de contactos con identidad propia de la app y proveedores externos como conectores.
- 2026-07-22: Se define MVP cloud como replica ordenada de lo actual, Google-only v1, app local paralela, export/import espejo, OAuth read-only y web responsive/PWA primero.
- 2026-07-22: Se explicita que la interfaz se probara como web desktop y web mobile, evitando botones secundarios a ancho completo y componentes que se deformen en pantalla chica.
- 2026-07-22: Se agrega export espejo local como primer paso visible de respaldo/migracion cloud.
- 2026-07-27: Se agrega vision de acciones internas ejecutables para que Coach IA, reglas y UI puedan usar las mismas funciones oficiales con confirmacion y trazabilidad.
- 2026-07-27: Se inicia la replica cloud visible con una web en modo lectura para Dashboard, Contactos y Sistema, pensada para comparar datos importados antes de reemplazar la app local.
- 2026-07-29: Se amplia vision de planes para incluir matriz flexible de capacidades por tier, automatizaciones/sync por plan, membresias patrocinadas por outplacement, upgrades individuales y analitica agregada con privacidad.
- 2026-07-30: Se agrega vision de mantenedor de perfiles/capacidades como capa superior a planes comerciales: vistas, permisos, cuotas, conectores, automatizaciones, exportaciones y auditoria.
