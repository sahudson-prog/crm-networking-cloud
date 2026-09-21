# CRM Networking

CRM Networking es una aplicación para ordenar y accionar una búsqueda profesional basada en red de contactos. Ayuda al usuario a centralizar contactos, objetivos, interacciones, referidos y sugerencias de seguimiento en un solo lugar.

El producto busca convertir información dispersa, como contactos, correos, citas y notas, en una vista operativa: a quién contactar, qué conversaciones ya ocurrieron, qué seguimiento corresponde hacer y qué oportunidades o referidos aparecieron durante el proceso.

## Propósito

El propósito de CRM Networking es ayudar a una persona en búsqueda profesional activa a gestionar su networking con continuidad y foco.

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

La experiencia normal del usuario se organiza en cuatro áreas principales:

- Dashboard.
- Contactos.
- Objetivos.
- Cuenta.

El Dashboard concentra la gestión diaria. Contactos permite operar la base de personas. Objetivos permite declarar prioridades profesionales y vincularlas a contactos. Cuenta concentra perfil, servicios conectados, permisos e importaciones.

La aplicación también incluye capacidades administrativas restringidas para operar la beta, mantener parámetros, revisar logs de sincronización y gestionar maestros globales necesarios para el funcionamiento del producto.

La aplicación actual funciona como producto cloud con autenticación de usuario y acceso cerrado por invitación. La entrada visible principal es Google login con scopes mínimos de identidad, manteniendo magic link por email como alternativa técnica. Tener una sesión activa no basta para entrar: la app valida el acceso efectivo antes de mostrar la experiencia privada.

Google también es el proveedor conectado disponible hoy para lectura e importación/sincronización de contactos, correos y citas. Google login y Google Connected Account son intents distintos: entrar con Google no conecta datos Google. Otros proveedores no forman parte del alcance vigente.

## Gestión de contactos

La sección Contactos permite buscar, filtrar, revisar y actualizar la base de contactos del usuario.

El usuario puede:

- buscar contactos con un buscador universal;
- filtrar por foco networking;
- filtrar por marca headhunter;
- filtrar por estado de networking;
- filtrar por objetivos asociados;
- ordenar la tabla por columnas visibles;
- seleccionar contactos;
- aplicar acciones masivas;
- abrir la ficha individual de un contacto;
- revisar contactos en un tablero por estado;
- mover contactos entre estados;
- agrupar contactos headhunter por empresa cuando corresponde.

Las acciones masivas permiten cambiar marcas o estados sobre los contactos seleccionados. También permiten asociar objetivos a varios contactos al mismo tiempo.

El tablero de contactos permite trabajar visualmente el avance de networking. Al mover una tarjeta entre estados, el cambio representa una actualización real del estado del contacto. Cuando se agrupan headhunters, la tarjeta representa a la empresa o grupo asociado y el movimiento aplica al conjunto correspondiente.

La ficha de contacto concentra la información individual de una persona. Desde ahí el usuario puede ver datos de contacto, estado de networking, foco, marca headhunter, objetivos, últimas interacciones, referidos y sugerencias del Coach asociadas a ese contacto.

## Objetivos de búsqueda

La sección Objetivos permite mantener las prioridades profesionales del usuario.

Los objetivos vigentes se organizan en cuatro tipos:

- Industrias.
- Empresas.
- Cargos.
- Funciones.

El usuario puede crear, editar, activar, desactivar, eliminar, priorizar y asociar objetivos a contactos. La prioridad se puede ajustar de forma rápida desde la vista de objetivos.

Un contacto puede estar asociado a uno o más objetivos. Esto permite filtrar contactos por objetivos y construir indicadores sobre el avance de la búsqueda profesional.

El Dashboard muestra un resumen por objetivo según los filtros actuales. Ese resumen permite ver, entre otros datos, cuántos contactos están asociados, cuánta actividad existe, cuándo fue la última actividad y cuál es el mayor estado observado dentro del objetivo.

Por defecto, el producto prioriza la lectura operativa de objetivos vigentes. Las vistas avanzadas de gestión, scoring o análisis estratégico por objetivo no forman parte del alcance funcional actual.

## Interacciones y seguimiento

Las interacciones representan actividad relevante con contactos: correos, citas, reuniones, llamadas, mensajes o registros manuales, según esté disponible en la aplicación.

El usuario puede ver interacciones desde el Dashboard y desde la ficha de cada contacto. En la ficha individual, las interacciones aparecen como historial asociado al contacto.

La aplicación permite importar correos y citas desde el proveedor conectado vigente. Antes de guardar cambios, el usuario revisa una vista previa de resultados, con elementos nuevos, modificados u omitidos cuando corresponde.

La fecha de inicio de networking define desde cuándo se consideran interacciones para importaciones históricas e indicadores. Esa fecha se administra desde Cuenta y afecta la lectura de actividad e indicadores del Dashboard.

La actualización de actividad puede ejecutarse de manera global para contactos en foco o desde la ficha de un contacto específico. La actualización desde una ficha se acota al contexto de ese contacto.

## Referidos

El producto permite registrar contactos referidos desde la ficha de un contacto.

Un referido puede contener datos propios, como nombre, empresa, cargo, correo, teléfono y notas. También puede quedar vinculado a un contacto ya existente o a un contacto creado a partir de esos datos.

El referido no reemplaza automáticamente la información del contacto vinculado. Sirve para conservar el apunte recibido y permitir que el usuario decida cómo convertirlo en contacto gestionable dentro del CRM.

En el Dashboard se muestran referidos según los filtros actuales, permitiendo revisar oportunidades o personas recomendadas dentro del proceso de networking.

## Coach

El Coach presenta sugerencias accionables para ayudar al usuario a avanzar su networking.

Actualmente puede mostrar sugerencias asociadas a contactos o al Dashboard general. Las sugerencias pueden seleccionarse, ejecutarse o descartarse. También pueden agruparse o revisarse de manera individual cuando existen varias recomendaciones similares.

Las sugerencias se presentan con lenguaje de acción, por ejemplo cambios de estado o marcas relevantes para el seguimiento. Cuando corresponde, incluyen acceso al contacto relacionado.

El usuario mantiene control sobre las acciones. El Coach sugiere y la aplicación ejecuta solo cuando el usuario confirma o activa la acción correspondiente según la configuración disponible.

## Cuenta y servicios conectados

La sección Cuenta concentra información personal operativa, plan, seguridad, servicios conectados e importaciones.

Desde Cuenta el usuario puede:

- ver su perfil y plan;
- revisar servicios conectados;
- conectar o desvincular Google;
- ver permisos disponibles para contactos, correos y calendario;
- ajustar la fecha de inicio de networking;
- importar contactos;
- importar correos;
- importar citas de calendario;
- revisar datos antes de guardarlos;
- reiniciar sus datos personales dentro de la aplicación.

La desvinculación de un servicio conectado corta la conexión en la aplicación. No implica por sí sola borrar los datos ya importados.

El reinicio de datos personales borra el espacio de trabajo del usuario dentro de la app, incluyendo contactos, interacciones, objetivos, sugerencias, conexiones, logs y configuración personal. No borra por sí solo el usuario ni su plan.

Las importaciones desde Cuenta son acciones sensibles porque pueden traer o actualizar datos desde una fuente externa. Por eso el producto muestra una revisión previa antes de guardar cambios relevantes.

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
