# Modelo de Dominio

Este documento define la semántica estable de CRM Networking. Su objetivo es mantener un vocabulario común para producto, código y documentación, sin entrar en tablas, columnas, APIs, pantallas o algoritmos concretos.

El modelo de dominio describe qué significan los conceptos centrales, cómo se relacionan y qué reglas deben preservarse aunque cambie la interfaz, el proveedor conectado o la implementación técnica.

## Propósito

CRM Networking ayuda a una persona a gestionar su búsqueda profesional mediante contactos, objetivos, interacciones, referidos y sugerencias accionables.

El dominio protege una idea central: la aplicación tiene su propio modelo local de networking. Los servicios externos pueden aportar información, pero no reemplazan silenciosamente la identidad ni el criterio del usuario dentro del CRM.

## Principios del dominio

La aplicación mantiene una fuente propia de verdad para el trabajo de networking del usuario.

Los objetos locales, como contactos, interacciones, objetivos, referidos y sugerencias, pertenecen al espacio de trabajo de un usuario.

Los proveedores externos complementan el modelo local. Pueden servir para importar, actualizar o reconocer información, pero no definen por sí solos la identidad principal de los objetos de la aplicación.

Cuando un concepto pueda confundirse con otro, el dominio debe preferir nombres explícitos: contacto no es empresa, proveedor no es cuenta conectada, referido no es contacto, y sugerencia Coach no es interacción.

## Usuario

Un usuario es la persona que usa CRM Networking para gestionar su búsqueda profesional y su red.

El usuario es dueño funcional de sus contactos, objetivos, interacciones, referidos, sugerencias y configuraciones personales.

Los roles, permisos, planes y capacidades administrativas controlan acceso y operación, pero no forman parte del núcleo semántico de este documento. Solo importa aquí que los datos privados de networking pertenecen al usuario correspondiente.

## Contactos

Un contacto representa una persona administrada dentro del CRM.

Un contacto no debe usarse como término genérico para empresas, organizaciones, proveedores o cuentas externas.

Un contacto puede tener nombre, empresa, cargo, medios de contacto, estado de networking, marca de foco, marca headhunter, objetivos asociados, interacciones, referidos relacionados y sugerencias Coach.

El contacto local tiene identidad propia dentro de la aplicación. Esa identidad no depende de un proveedor externo ni debe ser reemplazada silenciosamente por una identidad externa.

Un contacto puede estar activo o dejar de formar parte de la operación cotidiana. Desactivar un contacto no equivale a eliminar su historial.

## Datos de contacto

Un dato de contacto es un medio para contactar a una persona, como correo electrónico o teléfono.

Empresa, cargo, estado de networking, foco networking y marca headhunter no son datos de contacto. Son atributos o clasificaciones del contacto.

Los datos de contacto ayudan a identificar, buscar, contactar y relacionar personas, pero no son por sí solos el contacto completo.

Un mismo correo o teléfono puede ser relevante para detectar posibles duplicados o vínculos, pero una coincidencia en un dato de contacto no debe confundirse automáticamente con una fusión definitiva de identidad local.

Los datos de contacto pueden venir de edición manual, importación o sincronización. Una vez incorporados al contacto local, forman parte del espacio de trabajo del usuario.

## Proveedores, cuentas conectadas e identidades externas

Un proveedor es un servicio externo soportado conceptualmente por la aplicación.

Una cuenta conectada es una conexión concreta entre un usuario y un proveedor. Representa que ese usuario autorizó a la aplicación a leer o sincronizar cierto alcance de información desde una cuenta externa específica.

La cuenta de acceso a CRM Networking y una cuenta conectada no son lo mismo. Un usuario puede iniciar sesión en la aplicación y, separadamente, conectar o desvincular un servicio externo.

Una identidad externa permite reconocer un objeto dentro de una cuenta conectada y relacionarlo con un objeto local. Puede corresponder a un contacto externo, correo, cita u otro objeto externo soportado.

La identidad externa no es la identidad primaria del objeto local. Sirve para reconocer continuidad frente al proveedor, no para sustituir el modelo propio de la app.

## Interacciones y participantes

Una interacción es un objeto propio de la aplicación que representa actividad relevante para el networking.

Puede corresponder a un correo, cita, reunión, llamada, mensaje o registro manual, según el tipo de actividad disponible.

Una interacción puede existir sin proveedor externo. Por ejemplo, el usuario puede registrar actividad manualmente dentro de la app.

Una interacción también puede estar vinculada a un origen externo. En ese caso, el objeto externo ayuda a poblar o actualizar la interacción, pero la interacción local sigue siendo el objeto que usa el CRM para seguimiento, métricas y Coach.

Un participante es la relación entre una interacción y una persona involucrada. Normalmente el participante se vincula a un contacto local, pero puede existir información de participante que todavía no esté completamente asociada a un contacto.

Una interacción puede involucrar varios participantes. Esto permite representar correos, reuniones o actividades compartidas sin perder la relación de cada persona con la misma interacción.

## Referidos

Un referido es un objeto propio del dominio.

Representa una persona recomendada por un contacto dentro del proceso de networking. No es simplemente una relación entre dos contactos.

Todo referido tiene un contacto referente: la persona que entrega, menciona o recomienda al referido.

Un referido puede existir sin contacto local vinculado. Esto permite guardar una recomendación aunque todavía no se haya creado o identificado el contacto correspondiente en el CRM.

Un referido puede vincularse posteriormente a un contacto local. Ese contacto vinculado representa a la persona gestionada dentro del CRM.

El referido y el contacto vinculado mantienen identidad y datos propios. Los datos anotados en el referido no reemplazan automáticamente los datos del contacto vinculado.

## Objetivos

Un objetivo representa una prioridad profesional declarada por el usuario.

Los tipos vigentes de objetivo son empresa, industria, cargo y función.

Un objetivo no es un hashtag libre. Es una entidad estructurada que permite ordenar búsqueda, filtrar contactos y construir indicadores.

Un contacto puede estar asociado a cero, uno o varios objetivos. Un objetivo puede agrupar varios contactos.

La asociación entre contacto y objetivo debe preservar la identidad del objetivo, aunque cambie su nombre visible.

La prioridad de objetivo expresa importancia relativa para el usuario. Sus valores semánticos son baja, media y alta. La forma visual de representar esa prioridad pertenece al sistema de interfaz, no al dominio.

## Networking

El estado de networking representa la etapa de avance de un contacto dentro del proceso del usuario.

Los estados vigentes son:

- Pendiente.
- Contactado.
- Agendado.
- Cita concretada.
- Agradecimiento enviado.

Estos estados tienen un orden conceptual de avance. Ese orden permite resumir progreso y determinar cuál es el estado más avanzado en ciertos contextos.

Foco networking es una marca que indica que un contacto forma parte del universo activo de seguimiento del usuario.

Un contacto fuera de foco puede seguir existiendo en el CRM, conservar datos e historial, y volver a entrar en foco si el usuario lo decide.

## Headhunters

Contacto headhunter es una clasificación aplicada a un contacto. Un contacto marcado como headhunter sigue siendo un contacto: una persona gestionada por el usuario.

Empresa headhunter es un concepto distinto. Representa una empresa o firma relacionada con búsqueda ejecutiva o selección.

Una empresa headhunter puede tener dominios reconocidos que ayudan a asociar contactos con esa empresa.

La relación entre un contacto headhunter y una empresa headhunter puede estar reconocida, incompleta o requerir revisión. La existencia de una marca headhunter en el contacto no garantiza por sí sola que la empresa esté correctamente identificada.

Agrupar contactos headhunter por empresa es una operación sobre contactos relacionados por una empresa reconocida. No convierte la empresa en contacto ni elimina la identidad de las personas agrupadas.

## Coach y sugerencias

Una sugerencia Coach es una recomendación accionable generada para ayudar al usuario a mantener o avanzar su proceso de networking.

Una sugerencia Coach puede apuntar a un contacto, interacción u otro objeto relevante. Puede tener evidencia, estado actual, estado sugerido, explicación y acciones posibles.

Una sugerencia puede requerir atención del usuario. También puede dejar de requerirla porque fue ejecutada, descartada o dejó de ser aplicable.

El término canónico de dominio es Sugerencia Coach. En implementación o textos internos pueden existir objetos llamados ToDo, pendientes, recomendaciones o acciones sugeridas. Documentalmente, esos términos no deben usarse como conceptos separados salvo que se defina una diferencia explícita.

Las reglas concretas que generan sugerencias, su prelación, gatillantes, deduplicación y automatización pertenecen a la documentación de reglas del Coach, no a este modelo.

## Métricas de dominio

Las métricas de dominio resumen información derivada de contactos, interacciones, objetivos y estados.

Una métrica no necesariamente es una entidad propia. Puede ser un cálculo sobre objetos existentes.

Café es una métrica derivada. Representa interacciones clasificadas funcionalmente como cita/reunión o llamada.

Última actividad, contactos asociados, contactos en foco y mayor estado son ejemplos de métricas derivadas que ayudan a interpretar objetivos, contactos o grupos.

Las métricas deben preservar el significado funcional aunque cambie su forma de cálculo o visualización.

## Relaciones principales

Un usuario tiene contactos, objetivos, interacciones, referidos, sugerencias y cuentas conectadas dentro de su espacio de trabajo.

Una cuenta conectada pertenece a un usuario y se asocia a un proveedor.

Una identidad externa relaciona un objeto externo con un objeto local, pero no reemplaza su identidad local.

Una interacción puede tener uno o varios participantes, y cada participante puede vincular esa interacción con un contacto local.

Un referido tiene un contacto referente y puede tener un contacto vinculado opcional.

Un contacto puede estar asociado a varios objetivos y un objetivo puede reunir varios contactos.

Un contacto headhunter puede relacionarse con una empresa headhunter cuando existe una asociación reconocida.

## Invariantes transversales

Un contacto local conserva identidad propia independiente de cualquier proveedor externo.

Una identidad externa nunca debe ser el identificador principal del objeto local.

Un proveedor y una cuenta conectada son conceptos distintos.

La cuenta de acceso a CRM Networking y una cuenta conectada son conceptos distintos.

Un referido puede existir sin contacto local vinculado.

Un referido y su contacto vinculado no son el mismo objeto.

Una interacción puede existir sin origen externo.

Una interacción puede involucrar varios participantes.

Una interacción local y un objeto externo vinculado no son conceptualmente lo mismo.

Los datos privados de networking pertenecen al usuario correspondiente.

Un objetivo debe conservar identidad propia aunque cambie su nombre visible.

Una empresa headhunter y un contacto headhunter no son la misma entidad.

Foco networking define alcance operativo, no existencia del contacto.

Desactivar un contacto no equivale a eliminar su historial.

Las políticas concretas de importación, sincronización, resolución de conflictos, deduplicación o prelación de reglas no son invariantes de dominio. Deben respetar estas invariantes, pero se documentan aparte.

## Vocabulario canónico

Usar Proveedor, no Provider, cuando se hable del concepto de dominio.

Usar Cuenta conectada, no Connected Account, cuando se hable del concepto de dominio.

Usar Identidad externa, no ID externo, cuando se hable del vínculo conceptual con objetos de un sistema externo.

Usar Estado de networking, no Estado CRM, para describir la etapa de avance de un contacto.

Usar Sugerencia Coach para el concepto funcional visible. ToDo, pendiente, recomendación o acción sugerida no deben usarse como conceptos separados salvo aclaración explícita.

Usar Contacto headhunter para una persona clasificada como headhunter.

Usar Empresa headhunter para la entidad de empresa o firma headhunter.
