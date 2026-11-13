# Coffeecito

Coffeecito es una aplicación para ordenar y accionar una búsqueda profesional basada en red de contactos. Ayuda al usuario a centralizar contactos, objetivos, interacciones, referidos y sugerencias de seguimiento en un solo lugar.

El producto busca convertir información dispersa, como contactos, correos, citas y notas, en una vista operativa: a quién contactar, qué conversaciones ya ocurrieron, qué seguimiento corresponde hacer y qué oportunidades o referidos aparecieron durante el proceso.

## Propósito

El propósito de Coffeecito es ayudar a una persona en búsqueda profesional activa a gestionar su networking con continuidad y foco.

La aplicación permite:

- mantener una base propia de contactos;
- distinguir contactos en foco;
- registrar o importar interacciones relevantes;
- asociar contactos a objetivos profesionales;
- seguir el avance de cada contacto por estado;
- identificar empresas headhunter y contactos relacionados;
- registrar referidos;
- recibir sugerencias accionables del Coach;
- revisar cambios importados antes de guardarlos.

La aplicación está pensada para que el usuario mantenga control sobre sus datos. Los servicios conectados ayudan a importar o actualizar información, pero los cambios relevantes se revisan antes de aplicarse.

## Usuario objetivo

El usuario objetivo es una persona que está buscando trabajo, explorando oportunidades profesionales o gestionando activamente su red.

Necesita recordar con quién hablar, qué se conversó, qué contactos requieren seguimiento, qué oportunidades surgieron y cómo se relacionan sus contactos con empresas, industrias, cargos o funciones objetivo.

Los roles administrativos, perfiles beta, permisos internos o planes comerciales no definen por sí mismos a la persona objetivo del producto. Son mecanismos de operación, acceso o configuración.

## Producto vigente

La experiencia privada integrada se organiza en cinco vistas: Inicio (`/`), Producir (`/registrar-avances`), Planificar (`/planificar`), Contactos (`/contactos`) y Objetivos (`/objetivos`). La navegación persistente muestra Inicio, Producir, Planificar y Más; este menú abre Contactos, Objetivos y el tutorial. Cuenta y las superficies administrativas autorizadas se abren desde el header. `/dashboard` permanece como ruta profunda compatible.

- **Inicio:** «Información y novedades» (BF-12), pirámide de avance y evolución de contactos Coffeecitados en bloques independientes. El feed editorial usa contenido público configurado del lado servidor y muestra un estado de respaldo si falta la fuente.
- **Producir:** estados de networking, tablero de Oportunidades y últimas interacciones.
- **Planificar:** progreso de Prioridades y último contacto con empresas headhunter, con tablas ordenables.
- **Contactos:** tabla y tablero de personas, tabla Empresas (BF-11) y Referidos; las empresas se agrupan según los contactos filtrados, con conteo, Estado más avanzado y Última interacción.
- **Objetivos:** ciclo de búsqueda profesional y gestión de Prioridades.
- **Cuenta:** perfil, configuración, importación de datos, preferencias de actualización, servicios conectados y sesión.

El shell ofrece búsqueda global para abrir fichas de contactos y un solo panel visual de filtros. La búsqueda global no modifica indicadores. Los filtros conservan efectos distintos: en Contactos afectan personas y Empresas, no Referidos; en Producir afectan Estados de networking, no Oportunidades ni Últimas interacciones; en Planificar Foco=Sí es obligatorio, Headhunter/Prioridades afectan los resúmenes y el texto solo empresas. En las demás vistas el panel explica que no se aplican. BF-06B tiene selector Headhunter propio. No hay una semántica única de filtro para todos los bloques.

La aplicación funciona como producto cloud con autenticación y control de acceso. Google login usa scopes de identidad y no conecta datos Google; Connected Account requiere consentimiento separado. El usuario conserva el control de operaciones de importación o actualización según los gates de cada flujo.

## Gestión de contactos

La sección Contactos permite buscar, filtrar, revisar y actualizar la base de contactos del usuario.

El usuario puede:

- buscar y filtrar personas dentro de Contactos; la búsqueda global del shell abre una ficha sin filtrar indicadores;
- filtrar por foco networking;
- filtrar por marca headhunter;
- filtrar por estado de networking;
- filtrar por objetivos asociados;
- ordenar la tabla por columnas visibles;
- seleccionar contactos;
- aplicar acciones masivas;
- eliminar uno o varios contactos de la red activa;
- abrir la ficha individual de un contacto;
- revisar contactos en un tablero por estado;
- mover contactos entre estados;
- agrupar contactos headhunter por empresa cuando corresponde;
- seleccionar una o varias filas de BF-11 Empresas para restringir la tabla de personas dentro de sus filtros vigentes.

Las acciones masivas permiten cambiar marcas o estados sobre los contactos seleccionados. También permiten asociar objetivos a varios contactos al mismo tiempo.

Eliminar un contacto lo desactiva y lo retira de las superficies operativas; no borra físicamente su ficha, interacciones, referidos ni historial. La acción está disponible desde la ficha y como acción masiva, siempre con confirmación. Una importación posterior puede volver a proponer o incorporar esa persona mediante su preview normal.

El tablero de contactos permite trabajar visualmente el avance de networking. Al mover una tarjeta entre estados, el cambio representa una actualización real del estado del contacto. Cuando se agrupan headhunters, la tarjeta representa a la empresa o grupo asociado y el movimiento aplica al conjunto correspondiente.

La ficha de contacto concentra la información individual de una persona. Desde ahí el usuario puede ver datos de contacto, estado de networking, foco, marca headhunter, objetivos, últimas interacciones, referidos y sugerencias del Coach asociadas a ese contacto.

## Mi objetivo y Prioridades

La sección Prioridades permite mantener las prioridades profesionales del ciclo activo de Búsqueda laboral. `Mi objetivo` permite crear explícitamente el ciclo con nombre, inicio y zona horaria; un ciclo legacy se completa sin inventar datos pasados. Al finalizar, el usuario indica fecha/hora y resultado. El cierre conserva la red y las Prioridades históricas; no inicia otro ciclo ni modifica la situación laboral. La interfaz no muestra listados de ciclos anteriores.

Los objetivos vigentes se organizan en cuatro tipos:

- Industrias.
- Empresas.
- Cargos.
- Funciones.

Durante el ciclo activo, el usuario puede crear, editar, activar, desactivar, archivar, priorizar y asociar Prioridades a contactos. La prioridad se puede ajustar de forma rápida desde su vista. Al crear un nuevo ciclo, las Prioridades comienzan vacías; el usuario puede elegir, por separado y sin selección inicial, reiniciar estados a Pendiente o limpiar foco de contactos activos, incluidos headhunters.

Un contacto puede estar asociado a uno o más objetivos. Esto permite filtrar contactos por objetivos y construir indicadores sobre el avance de la búsqueda profesional.

Planificar muestra progreso por Prioridad según los filtros aplicables, con oportunidades, cafés y contactos; la tabla de empresas headhunter presenta el último contacto. Estas tablas se ordenan por valores de datos, no por texto formateado.

Por defecto, el producto prioriza la lectura operativa de objetivos vigentes. Las vistas avanzadas de gestión, scoring o análisis estratégico por objetivo no forman parte del alcance funcional actual.

## Interacciones y seguimiento

Las interacciones representan actividad relevante con contactos: correos, citas, reuniones, llamadas, mensajes o registros manuales, según esté disponible en la aplicación.

El usuario puede ver últimas interacciones en Producir y el historial asociado en cada ficha de contacto.

La importación histórica de correos y citas conserva flujos de revisión cuando están habilitados por sus gates; Gmail está deshabilitado en el runtime público y la importación Calendar histórica no se ofrece actualmente en Cuenta. Calendar V2 es una actualización global independiente de esa importación histórica.

La política UX-DATE-01 integrada usa el inicio del ciclo en Objetivos. Los ciclos nuevos admiten el horizonte histórico configurado (default 6 meses, administrable entre 1 y 12); un ciclo legacy sin fecha permite completar su inicio real una vez. La importación histórica requiere ciclo activo e inicio conocido. El sync periódico conserva su contrato independiente.

La actualización global se inicia desde el control y popup Sync existente. Calendar V2 se ejecuta únicamente mediante Actualizar global, en un flujo manual admin-only independiente de Gmail, con elegibilidad y consentimiento propios. La ficha ofrece una actualización contextual de datos de Google Contacts, separada del Sync Calendar V2. Abrir una vista o el popup no ejecuta Sync. La verificación focal de Calendar posterior a UI-STRUCT-02 sigue pendiente, sin invalidar el release Calendar ya aprobado.

## Referidos

El producto permite registrar contactos referidos desde la ficha de un contacto.

Un referido puede contener datos propios, como nombre, empresa, cargo, correo, teléfono y notas. También puede quedar vinculado a un contacto ya existente o a un contacto creado a partir de esos datos.

El referido no reemplaza automáticamente la información del contacto vinculado. Sirve para conservar el apunte recibido y permitir que el usuario decida cómo convertirlo en contacto gestionable dentro del CRM.

Referidos se muestra en Contactos como bloque propio; los filtros superiores de personas/Empresas no lo restringen.

## Coach

El Coach presenta sugerencias accionables para ayudar al usuario a avanzar su networking.

El shell ofrece Coach global expandido y la ficha presenta sugerencias contextuales del contacto. Las sugerencias pueden seleccionarse, ejecutarse o descartarse, según las acciones disponibles y confirmaciones del usuario. El Coach del tutorial guía el recorrido, sin ejecutar sugerencias de negocio.

Las sugerencias se presentan con lenguaje de acción, por ejemplo cambios de estado o marcas relevantes para el seguimiento. Cuando corresponde, incluyen acceso al contacto relacionado.

El usuario mantiene control sobre las acciones. El Coach sugiere y la aplicación ejecuta solo cuando el usuario confirma o activa la acción correspondiente según la configuración disponible.

## Cuenta y servicios conectados

La sección Cuenta concentra información personal operativa, plan, seguridad, servicios conectados e importaciones.

Desde Cuenta el usuario puede:

- ver su perfil y plan;
- revisar servicios conectados;
- conectar o desvincular Google;
- ver permisos disponibles para contactos, correos y calendario;
- editar nombre y situación profesional; el inicio del proceso se establece en Objetivos, no en Cuenta;
- abrir el mismo modal de «Importar contactos» que Contactos y tutorial: archivo `.vcf` para todos los perfiles elegibles, Google Contacts solo cuando sus permisos efectivos lo habilitan;
- seleccionar correos históricos de Gmail cuando esa capacidad está habilitada;
- gestionar la opción de Citas, cuyo importador `.ics` permanece condicionado por su feature gate;
- revisar datos antes de guardarlos;
- reiniciar sus datos personales dentro de la aplicación.

La desvinculación de un servicio conectado corta la conexión en la aplicación. No implica por sí sola borrar los datos ya importados.

El reinicio de datos personales borra el espacio de trabajo del usuario dentro de la app, incluyendo contactos, interacciones, objetivos, sugerencias, conexiones, logs y configuración personal. No borra por sí solo el usuario ni su plan.

La pestaña de archivo del modal abre el selector nativo desde «Subir archivo»; un archivo válido pasa al preview, selección y confirmación antes de aplicar contactos. Cancelar el selector no cambia datos. El método Google reutiliza su gate y preview. Importar manualmente contactos y actualizar mediante Sync son acciones distintas; el modal no ejecuta Sync global. En Cuenta y tutorial permanecen las categorías Contactos, Citas y Correos, incluso si alguna acción está disponible solo como placeholder o bajo gate.

El login Google sirve para autenticar identidad con scopes mínimos. La conexión Google para datos requiere consentimiento explícito posterior y scopes de lectura de Contacts, Gmail o Calendar.

## Administración restringida

La aplicación incluye capacidades administrativas restringidas para operar y mantener la beta.

Estas capacidades permiten:

- ajustar parámetros operativos y límites internos;
- administrar la allowlist de acceso beta;
- diagnosticar si una cuenta registrada puede entrar;
- administrar accesos, planes y roles disponibles;
- revisar logs de importación y sincronización;
- mantener el maestro global de empresas headhunter.

Estas herramientas no son parte del flujo normal del usuario final. Su propósito es permitir operación controlada, soporte y diagnóstico durante la beta.

El maestro de empresas headhunter permite mantener empresas y dominios reconocidos. Esa información se usa para apoyar la clasificación de contactos headhunter, advertir inconsistencias y agrupar contactos cuando corresponde.

## Límites funcionales vigentes

El producto vigente tiene límites funcionales importantes:

- Google es el único proveedor conectado disponible actualmente.
- Google login no equivale a Google Connected Account.
- La aplicación lee e importa datos desde Google; no escribe cambios hacia contactos, Gmail o Calendar.
- Los cambios importados se revisan antes de guardarse cuando afectan datos relevantes.
- La exportación masiva o sincronización saliente hacia proveedores externos no está habilitada.
- Los proveedores Apple, Microsoft u otros no están implementados.
- Las capacidades avanzadas de planes, monetización, analítica agregada y automatizaciones completas no forman parte del alcance funcional vigente.
- La administración de permisos y roles existe como base operativa, pero no reemplaza una definición comercial completa de planes.
- Las herramientas administrativas están orientadas a operación controlada de la beta.
