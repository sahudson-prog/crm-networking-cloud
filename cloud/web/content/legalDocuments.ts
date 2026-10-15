export const LEGAL_DOCUMENT_VERSION = "1.0";
export const LEGAL_DOCUMENT_EFFECTIVE_DATE = "15 de octubre de 2026";

export type LegalDocumentKey = "terms" | "privacy";

export type LegalDocument = {
  content: string;
  description: string;
  effectiveDate: string;
  slug: LegalDocumentKey;
  version: string;
};

export const legalDocuments: Record<LegalDocumentKey, LegalDocument> = {
  terms: {
    content: `
# Términos de Servicio de Coffeecito

**Versión 1.0 — 15 de octubre de 2026**

Estos Términos de Servicio regulan el acceso y uso de Coffeecito.

Coffeecito es operado por **Sergio Hudson, persona natural en Chile**, en adelante “Coffeecito”.

## 1. Aceptación

Para utilizar Coffeecito debes aceptar estos Términos de Servicio.

La autenticación técnica en la aplicación no implica por sí sola aceptación de estos Términos. Si no los aceptas, no podrás acceder a las funcionalidades protegidas de Coffeecito y podrás cerrar tu sesión.

La Política de Privacidad, disponible en **\`/privacidad\`**, explica cómo se tratan los datos personales relacionados con el servicio. La aceptación de estos Términos no significa, por sí sola, que estés otorgando un consentimiento general para todos los tratamientos descritos en dicha Política.

## 2. El servicio

Coffeecito es una aplicación cloud orientada a la gestión de networking y relaciones profesionales. Permite organizar, entre otros elementos, contactos, objetivos, estados de networking, interacciones, reuniones, notas, minutas y referidos, así como utilizar determinadas funciones de importación o conexión con servicios externos.

Coffeecito se encuentra en etapa **Early Access / Beta**. El acceso puede estar limitado por invitación, autorización previa u otros controles de habilitación.

Las funcionalidades pueden evolucionar, incorporarse, modificarse o dejar de estar disponibles. Cuando un cambio afecte materialmente los derechos u obligaciones contractuales del Usuario, se informará de manera adecuada y, cuando corresponda, se solicitará una nueva aceptación.

## 3. Cuenta y seguridad

Eres responsable de utilizar Coffeecito mediante tus propios mecanismos de autenticación y de adoptar medidas razonables para proteger el acceso a tu cuenta.

Debes entregar información razonablemente veraz y mantener actualizados los datos de tu perfil que sean necesarios para operar el servicio.

Debes informar mediante **\`/contacto\`** si detectas un acceso no autorizado o un problema de seguridad relacionado con tu cuenta.

## 4. Uso permitido

Debes utilizar Coffeecito de forma lícita y compatible con su finalidad profesional.

No puedes utilizarlo para acceder ilícitamente a información de terceros, vulnerar derechos de otras personas, distribuir contenido ilícito, eludir controles de seguridad, interferir con el funcionamiento del servicio ni utilizar información personal para finalidades contrarias a la legislación aplicable.

Coffeecito es una herramienta de organización y apoyo. No garantiza resultados profesionales, comerciales, laborales o de networking.

## 5. Información incorporada por el Usuario

Mantienes los derechos que te correspondan sobre los contenidos propios que incorpores a Coffeecito.

Otorgas a Coffeecito únicamente las facultades necesarias para alojar, organizar, procesar y mostrar esos contenidos con el propósito de prestar las funcionalidades que solicites.

El hecho de almacenar datos personales de terceros no significa que el Usuario sea “dueño” de esos datos personales. Cuando determines las finalidades para las que incorporas o utilizas información de terceros, eres responsable de contar con una base jurídica que permita dicho tratamiento y de respetar los derechos de esas personas.

## 6. Google e importación iCalendar

Coffeecito puede conectarse, mediante autorización del Usuario, con Google Contacts, Gmail y Google Calendar.

Las integraciones actuales utilizan permisos de solo lectura. Coffeecito puede importar información obtenida de esas fuentes para las funciones que el Usuario active o confirme. En Gmail, la información puede incluir no solo metadatos sino también contenido textual relevante de mensajes que se utilice como detalle de una interacción. En Calendar puede incluir información de eventos, participantes, organizadores, asunto, fecha, descripción, ubicación y enlaces.

Desconectar Google dentro de Coffeecito detiene el uso posterior de esa conexión por Coffeecito y desactiva localmente la cuenta conectada. Esa acción no equivale necesariamente a revocar el permiso directamente ante Google ni elimina automáticamente la información que ya haya sido importada.

Coffeecito también permite importar archivos iCalendar \`.ics\`. Esta es una importación puntual y no constituye una conexión persistente con el proveedor del calendario de origen.

Los servicios externos mantienen sus propios términos y políticas.

## 7. Tratamiento de datos por cuenta del Usuario

Cuando el Usuario determina las finalidades y medios del tratamiento de datos personales de terceros incorporados a su CRM y Coffeecito se limita a procesarlos por cuenta e instrucciones del Usuario, el Usuario actúa como responsable y Coffeecito actúa como tercero mandatario o encargado del tratamiento.

Para estos tratamientos, las partes acuerdan lo siguiente:

**Objeto del encargo.** Coffeecito alojará, organizará y procesará la información necesaria para entregar las funcionalidades de CRM, networking, importación, sincronización, búsqueda, visualización y gestión solicitadas por el Usuario.

**Duración.** El encargo se mantendrá mientras la relación de servicio esté vigente y los datos permanezcan en Coffeecito, sin perjuicio de los períodos adicionales que resulten jurídicamente necesarios.

**Finalidad.** Los datos serán tratados únicamente para ejecutar las funcionalidades e instrucciones lícitas del Usuario y para las operaciones técnicas estrictamente necesarias para prestar y proteger el servicio.

**Tipos de datos.** El encargo puede comprender nombres, correos electrónicos, teléfonos, empresa, cargo, identificadores externos, información profesional, datos de contactos, interacciones, comunicaciones, reuniones, calendarios, notas, referidos y otros datos que el Usuario incorpore legítimamente al CRM.

**Categorías de titulares.** Pueden incluir contactos profesionales del Usuario, remitentes o destinatarios de comunicaciones, participantes u organizadores de reuniones, personas referidas y otras personas relacionadas con la actividad profesional gestionada por el Usuario.

**Instrucciones y limitación de finalidad.** Coffeecito tratará estos datos de acuerdo con estos Términos, las funcionalidades activadas por el Usuario y sus instrucciones lícitas. No los utilizará por cuenta del Usuario para una finalidad incompatible con el encargo.

**Confidencialidad y seguridad.** Coffeecito aplicará medidas técnicas y organizativas adecuadas al riesgo y limitará el acceso a quienes lo necesiten para la prestación, seguridad o soporte del servicio.

**Derechos de los titulares.** El Usuario deberá atender los derechos que le correspondan como responsable. Coffeecito prestará la colaboración razonablemente necesaria cuando, por su función de encargado, deba intervenir para ejecutar una solicitud legítima.

**Incidentes.** Si Coffeecito detecta una vulneración de seguridad que afecte datos tratados como encargado y deba ser comunicada al Usuario conforme a la legislación aplicable, realizará dicha comunicación para permitirle cumplir sus obligaciones como responsable.

**Subencargados.** En la medida en que procesen información por cuenta del Usuario, éste autoriza específicamente la utilización de **Supabase** para infraestructura de datos y servicios asociados, y de **Vercel** para alojamiento y ejecución de la aplicación web. Coffeecito deberá sujetar estos tratamientos a las obligaciones contractuales y legales aplicables. La incorporación de otro subencargado material para este encargo requerirá la autorización que exija la legislación aplicable.

**Finalización.** Terminado el encargo, los datos tratados exclusivamente por cuenta del Usuario serán suprimidos cuando corresponda, salvo que exista un fundamento jurídico que exija o permita conservarlos.

Estas estipulaciones forman parte del contrato de tratamiento por encargo entre el Usuario y Coffeecito. No es necesario celebrar un anexo separado mientras este contrato resulte suficiente para el tratamiento correspondiente.

## 8. Disponibilidad y etapa Beta

Coffeecito busca mantener el servicio disponible y seguro, pero no garantiza funcionamiento ininterrumpido ni ausencia absoluta de errores.

Pueden existir interrupciones por mantenimiento, incidencias técnicas, cambios del producto o fallas de proveedores externos.

La condición Beta o Early Access no limita las obligaciones legales de Coffeecito ni los derechos irrenunciables que correspondan al Usuario.

## 9. Precio

Coffeecito es actualmente gratuito.

La gratuidad actual no constituye una promesa de gratuidad permanente. Si en el futuro se ofrecen planes o funcionalidades pagadas, sus precios y condiciones se informarán antes de efectuar cualquier cobro y el Usuario deberá contratar las condiciones correspondientes.

## 10. Suspensión y término

Coffeecito podrá limitar o suspender el acceso cuando sea razonablemente necesario para proteger la seguridad del servicio, responder a un uso ilícito o abusivo, cumplir una obligación legal o administrar el acceso de la etapa Beta.

Cuando sea razonablemente posible y no exista un impedimento legal o de seguridad, se informará al Usuario de una suspensión material.

El Usuario puede dejar de utilizar Coffeecito en cualquier momento. Las solicitudes relativas a eliminación de cuenta o datos personales pueden realizarse mediante **\`/contacto\`**.

La función “Reiniciar datos”, cuando esté disponible en la aplicación, elimina datos operativos de la cuenta en el alcance que indique la interfaz, pero no debe entenderse como eliminación completa de la identidad de autenticación o de toda información que legalmente deba conservarse.

## 11. Propiedad intelectual

Coffeecito, su software, diseño, marca y elementos propios están protegidos por los derechos de propiedad intelectual que correspondan.

Estos Términos no transfieren al Usuario derechos de propiedad sobre el software o la marca.

Nada en esta cláusula altera los derechos que correspondan al Usuario o a terceros sobre la información o contenidos incorporados legítimamente al servicio.

## 12. Privacidad y datos personales

El tratamiento de datos personales se describe en la Política de Privacidad disponible en **\`/privacidad\`**.

La Política de Privacidad cumple una función informativa y no constituye, por sí sola, una autorización general para tratar datos personales.

### Régimen transitorio hasta el 30 de noviembre de 2026

Mientras resulte aplicable el régimen de la Ley N.º 19.628 vigente hasta el 30 de noviembre de 2026, al aceptar expresamente estos Términos mediante el mecanismo electrónico dispuesto por Coffeecito, el Usuario autoriza por escrito el tratamiento de **sus propios datos personales** que sea necesario para crear y administrar su cuenta, prestar las funcionalidades que solicite, gestionar sus conexiones e importaciones, brindar soporte, mantener la seguridad del servicio y cumplir las finalidades informadas en la Política de Privacidad.

Esta autorización no habilita finalidades distintas de las informadas ni constituye consentimiento otorgado en nombre de terceras personas cuyos datos el Usuario incorpore al CRM.

Cuando un tratamiento opcional o una finalidad nueva requiera un consentimiento específico, éste deberá solicitarse de forma separada.

Esta cláusula transitoria deja de operar como fundamento general de licitud a partir del **1 de diciembre de 2026**, fecha desde la cual cada tratamiento se apoyará en la base jurídica que corresponda conforme a la legislación entonces vigente.

## 13. Responsabilidad

Coffeecito no garantiza resultados profesionales ni que la información importada desde servicios externos sea siempre completa, exacta o actualizada.

El Usuario es responsable de las decisiones profesionales que adopte utilizando la información organizada mediante Coffeecito y del uso lícito que haga de los datos que incorpore.

Nada en estos Términos excluye o limita responsabilidades que no puedan excluirse o limitarse conforme a la legislación aplicable.

## 14. Cambios de estos Términos

Coffeecito puede actualizar estos Términos para reflejar cambios del servicio, de la legislación o de la relación contractual.

Los cambios materiales que afecten derechos u obligaciones del Usuario serán informados antes de que pasen a regir para él y requerirán una nueva aceptación cuando corresponda.

Correcciones formales, aclaraciones o cambios que no alteren materialmente la relación contractual podrán publicarse mediante una nueva versión sin exigir una nueva aceptación, sin perjuicio de informar al Usuario cuando sea pertinente.

El mero uso continuado del servicio no será utilizado para sustituir una aceptación expresa cuando ésta sea necesaria.

## 15. Ley aplicable y controversias

Estos Términos se rigen por las leyes de la República de Chile.

Las controversias serán conocidas por los tribunales competentes conforme a la legislación aplicable, sin perjuicio de los derechos o competencias imperativas que la ley otorgue al Usuario.

## 16. Contacto

Para soporte, consultas, privacidad, ejercicio de derechos o reporte de problemas, utiliza:

**\`/contacto\`**
`,
    description: "Términos de Servicio de Coffeecito.",
    effectiveDate: LEGAL_DOCUMENT_EFFECTIVE_DATE,
    slug: "terms",
    version: LEGAL_DOCUMENT_VERSION
  },
  privacy: {
    content: `
# Política de Privacidad de Coffeecito

**Versión 1.0 — 15 de octubre de 2026**

Esta Política explica cómo se tratan los datos personales en Coffeecito.

## 1. Responsable y contacto

Coffeecito es operado por **Sergio Hudson, persona natural en Chile**.

Respecto de los tratamientos cuyas finalidades y medios determina Coffeecito, Sergio Hudson actúa como responsable de datos.

El canal para consultas, privacidad y ejercicio de derechos es:

**\`/contacto\`**

## 2. Cuándo Coffeecito actúa como responsable y cuándo como encargado

Coffeecito actúa como **responsable** respecto de tratamientos propios relacionados, entre otros, con:

- creación y administración de la cuenta;
- autenticación y control de acceso;
- habilitación de usuarios de Early Access o Beta;
- prestación y administración del servicio;
- soporte;
- seguridad, prevención de abuso y diagnóstico;
- gestión de configuraciones;
- cumplimiento de obligaciones legales;
- defensa o ejercicio de derechos.

Cuando un Usuario incorpora datos personales de terceros a su CRM para sus propias finalidades profesionales y Coffeecito se limita a procesarlos siguiendo sus instrucciones, el Usuario puede actuar como responsable de esos tratamientos y Coffeecito como **tercero mandatario o encargado**.

La relación de tratamiento por encargo se regula en los Términos de Servicio.

## 3. Personas y datos que pueden ser tratados

Coffeecito puede tratar información relativa a Usuarios y a otras personas incorporadas legítimamente al CRM, como contactos profesionales, remitentes o destinatarios de comunicaciones, participantes de reuniones, organizadores, referidos y otras relaciones profesionales.

Las categorías de datos pueden incluir:

- datos de cuenta y perfil, como nombre y correo electrónico;
- información de habilitación o autorización de acceso;
- información profesional, como empresa y cargo;
- nombres, correos electrónicos y teléfonos de contactos;
- estados y atributos de networking;
- contactos marcados como Foco;
- objetivos profesionales;
- reuniones e interacciones;
- asuntos, participantes y contenido relevante de mensajes o correos importados;
- notas y minutas;
- referidos;
- datos de calendario;
- identificadores y referencias externas;
- información técnica de conexiones con proveedores;
- configuraciones de la aplicación;
- registros técnicos, diagnósticos, eventos de seguridad y auditoría operacional.

Coffeecito no solicita que el Usuario incorpore información sensible de terceros que no sea necesaria para su finalidad profesional. Si el Usuario incorpora esa información, deberá contar con la habilitación jurídica que corresponda.

## 4. Fuentes de los datos

Los datos pueden provenir:

- directamente del Usuario;
- de información que el Usuario crea o registra en Coffeecito;
- de Google Contacts, Gmail o Google Calendar cuando el Usuario conecta voluntariamente su cuenta y utiliza las funciones correspondientes;
- de archivos iCalendar \`.ics\` que el Usuario importe;
- de operaciones técnicas generadas por el uso, seguridad, soporte o funcionamiento del servicio;
- de fuentes legítimas que el propio Usuario utilice para incorporar información a su CRM bajo su responsabilidad.

## 5. Finalidades y bases jurídicas

Coffeecito trata datos únicamente para finalidades determinadas y bajo una base jurídica aplicable.

### Cuenta y prestación del servicio

Los datos necesarios para crear la cuenta, autenticar al Usuario, administrar el acceso y prestar las funcionalidades solicitadas se utilizan para establecer y ejecutar la relación con el Usuario.

A partir del **1 de diciembre de 2026**, estos tratamientos podrán fundarse, cuando corresponda, en la celebración o ejecución del contrato o en medidas precontractuales solicitadas por el titular.

### Funcionalidades solicitadas por el Usuario

Los datos introducidos, conectados o importados se utilizan para organizar contactos, relaciones profesionales, objetivos, interacciones, reuniones, comunicaciones, notas, referidos y demás funciones que el Usuario decida utilizar.

Cuando la información corresponda a terceros y Coffeecito actúe únicamente por cuenta del Usuario, el tratamiento se realizará como encargado conforme a sus instrucciones y a los Términos de Servicio.

### Seguridad y funcionamiento

Coffeecito puede tratar datos técnicos y operacionales para proteger cuentas y sistemas, detectar o investigar problemas, prevenir abuso, mantener la continuidad del servicio y gestionar incidentes.

Desde el 1 de diciembre de 2026, estos tratamientos podrán basarse, según el caso, en la ejecución del contrato, obligaciones legales, el interés legítimo en proteger el servicio y a sus usuarios —siempre que no prevalezcan los derechos y libertades de los titulares— o la formulación, ejercicio o defensa de derechos.

### Cumplimiento legal

Coffeecito podrá tratar o conservar información cuando sea necesario para cumplir una obligación legal o una orden válida de una autoridad competente.

### Consentimiento

Cuando la ley exija consentimiento para una finalidad determinada, éste se solicitará de forma libre, específica, informada e inequívoca y podrá retirarse utilizando medios adecuados, sin afectar la licitud de los tratamientos realizados antes de su retiro.

La lectura o reconocimiento de esta Política de Privacidad no sustituye ese consentimiento específico.

### Régimen vigente hasta el 30 de noviembre de 2026

Mientras resulte aplicable la versión actualmente vigente de la Ley N.º 19.628, el tratamiento de los datos personales propios del Usuario que requiera autorización se realizará de acuerdo con la autorización expresa incorporada en los Términos de Servicio y aceptada electrónicamente por el Usuario.

## 6. Google e iCalendar

Si el Usuario conecta Google, Coffeecito puede acceder en modo de solo lectura a información de Google Contacts, Gmail y Google Calendar según los permisos habilitados.

Google Contacts puede aportar nombres, correos, teléfonos, organizaciones, cumpleaños e información asociada.

Gmail puede aportar encabezados, fechas, participantes, dirección de la comunicación, snippets y contenido textual relevante. Parte de ese contenido puede conservarse en Coffeecito como detalle de una interacción. Por ello, el acceso a Gmail no se describe como acceso únicamente a “metadatos”.

Google Calendar puede aportar información sobre eventos, asistentes, organizador, asunto, fecha y hora, descripción, ubicación y enlaces relacionados.

Coffeecito no utiliza actualmente estos permisos para escribir cambios en Google.

Desconectar Google dentro de Coffeecito desactiva localmente la conexión y detiene su uso posterior por Coffeecito. No equivale necesariamente a revocar el permiso directamente en la cuenta de Google y no elimina automáticamente los datos que ya hayan sido importados a Coffeecito.

La importación de un archivo \`.ics\` es puntual. Coffeecito no mantiene por ese solo hecho una conexión persistente con el servicio desde el cual provino el archivo.

## 7. Proveedores y destinatarios

Coffeecito utiliza proveedores tecnológicos para operar el servicio, actualmente entre ellos:

- **Supabase**, para infraestructura de datos, autenticación y servicios asociados;
- **Vercel**, para alojamiento y ejecución de la aplicación web;
- **Google**, cuando el Usuario utiliza el conector y las funciones asociadas a sus servicios.

Estos proveedores solo deben recibir o procesar los datos que sean necesarios para la función correspondiente y quedan sujetos a las condiciones contractuales y jurídicas aplicables a su intervención.

Coffeecito también podrá comunicar información cuando exista una obligación legal, una orden válida de autoridad competente o sea necesario formular, ejercer o defender un derecho.

Actualmente Coffeecito no vende datos personales, no utiliza los datos del CRM para publicidad dirigida y no utiliza los datos del CRM para entrenar modelos externos de inteligencia artificial.

## 8. Transferencias internacionales

Coffeecito utiliza proveedores tecnológicos cuya infraestructura puede implicar tratamiento de datos personales fuera de Chile.

El proyecto productivo de **Supabase** utilizado por Coffeecito se encuentra actualmente alojado en **São Paulo, Brasil**. Determinados servicios auxiliares, operacionales o de soporte del proveedor pueden implicar tratamiento en otras jurisdicciones conforme a sus condiciones aplicables.

La aplicación web utiliza **Vercel**. Las funciones productivas de Coffeecito se ejecutan actualmente en **Washington D.C., Estados Unidos**, y determinados servicios de red y distribución pueden utilizar infraestructura internacional.

Cuando el Usuario utiliza las funciones de **Google**, determinada información puede ser procesada mediante la infraestructura internacional de Google.

Cuando estas operaciones constituyan transferencias internacionales de datos personales, Coffeecito aplicará los mecanismos y garantías exigidos por la legislación chilena aplicable. Esta información se actualizará si cambia materialmente la infraestructura o los proveedores utilizados.

## 9. Conservación de los datos

Coffeecito conserva datos únicamente durante el período necesario para las finalidades correspondientes.

En particular:

- los datos necesarios para administrar la cuenta y la relación con Coffeecito se conservarán mientras la cuenta o relación se mantenga activa;
- los datos del CRM se conservarán mientras el Usuario los mantenga en Coffeecito y sean necesarios para las funcionalidades que utiliza, hasta que sean eliminados, se reinicien los datos, termine la relación o deje de existir la finalidad que justificaba su tratamiento;
- los datos ya importados desde Google o desde archivos \`.ics\` pueden permanecer en Coffeecito aunque posteriormente se desconecte Google o termine la importación de origen, hasta que sean eliminados conforme a los controles o solicitudes aplicables;
- los registros técnicos, de seguridad, diagnóstico y auditoría se conservarán únicamente mientras resulten necesarios para proteger y operar el servicio, investigar incidentes, cumplir obligaciones legales o formular, ejercer o defender derechos;
- terminadas las finalidades anteriores, los datos serán suprimidos o anonimizados, salvo que una norma autorice o exija conservarlos durante un período adicional.

Coffeecito procurará minimizar la información conservada una vez que deje de ser necesaria para la finalidad original.

## 10. Derechos de los titulares

Los titulares pueden ejercer los derechos reconocidos por la legislación aplicable mediante **\`/contacto\`**.

Según corresponda, estos derechos incluyen acceso, rectificación, supresión, oposición, portabilidad y bloqueo.

A partir del 1 de diciembre de 2026, Coffeecito acusará recibo de las solicitudes y las resolverá dentro de los plazos establecidos por la Ley N.º 19.628. Si una solicitud es rechazada o no es respondida oportunamente, el titular podrá ejercer los mecanismos de reclamación ante la Agencia de Protección de Datos Personales previstos por la ley.

### Supresión y eliminación de cuenta

La función “Reiniciar datos” elimina una parte amplia de la información operacional asociada al Usuario, pero no constituye por sí sola una eliminación completa de la cuenta de autenticación o de toda la identidad estructural.

Una persona puede solicitar mediante **\`/contacto\`** la supresión de sus datos personales o el cierre y eliminación de su cuenta. La solicitud se evaluará y ejecutará en el alcance que corresponda legalmente, sin perjuicio de la información que exista obligación o fundamento jurídico para conservar.

No es necesario que exista un botón automático de eliminación para ejercer este derecho.

### Portabilidad

No existe actualmente una función general de exportación de todo el CRM.

Esto no limita el derecho legal de portabilidad cuando corresponda. La portabilidad se refiere a los datos personales que conciernen al propio titular y que cumplen los requisitos legales aplicables; no significa automáticamente que el Usuario tenga derecho, bajo esa figura, a exportar como propios todos los datos personales de terceros almacenados en su CRM.

Las solicitudes pueden realizarse mediante **\`/contacto\`**.

### Retiro del consentimiento

Cuando un tratamiento se funde en consentimiento, éste podrá retirarse sin efecto retroactivo mediante **\`/contacto\`** o mediante un mecanismo equivalente que Coffeecito habilite.

## 11. Seguridad e incidentes

Coffeecito aplica medidas técnicas y organizativas orientadas a proteger la confidencialidad, integridad y disponibilidad de los datos, considerando la naturaleza del tratamiento y sus riesgos.

Estas medidas incluyen controles de acceso, separación del acceso a información privada, restricciones para funciones privilegiadas, registros y controles operacionales y otras medidas destinadas a prevenir acceso, alteración, pérdida o tratamiento no autorizado.

Ningún sistema puede garantizar seguridad absoluta.

Un incidente técnico no equivale automáticamente a una vulneración de datos personales que deba notificarse a todas las personas. Cuando ocurra una vulneración de seguridad, Coffeecito realizará las comunicaciones a la autoridad y a los titulares que correspondan conforme al riesgo, tipo de datos afectados y demás requisitos de la legislación aplicable.

## 12. Prácticas actuales sobre uso comercial de datos

Actualmente Coffeecito:

- no vende datos personales;
- no utiliza datos personales del CRM para publicidad dirigida;
- no utiliza los datos del CRM para entrenar modelos externos de inteligencia artificial.

Si estas prácticas cambiaran de forma que implicaran una nueva finalidad, una nueva base jurídica o un consentimiento específico, Coffeecito deberá informar el cambio y obtener el consentimiento que corresponda antes de iniciar dicho tratamiento.

## 13. Decisiones automatizadas

Coffeecito puede utilizar reglas, indicadores o sugerencias para apoyar la organización del networking del Usuario.

Estas funciones no adoptan por sí mismas decisiones con efectos jurídicos sobre las personas ni sustituyen las decisiones profesionales del Usuario.

Si en el futuro se implementan decisiones exclusivamente automatizadas que deban informarse conforme a la legislación aplicable, esta Política se actualizará antes de utilizarlas.

## 14. Cambios de esta Política

Coffeecito mantendrá públicamente identificada la fecha y versión vigente de esta Política.

Los cambios que solo aclaren o actualicen información podrán comunicarse al Usuario sin requerir que “acepte” nuevamente la Política.

Cuando un cambio implique una modificación material de los Términos de Servicio, se solicitará una nueva aceptación contractual cuando corresponda.

Si una nueva finalidad de tratamiento requiere consentimiento específico, ese consentimiento se solicitará separadamente y no se presumirá por el mero uso continuado de Coffeecito.

## 15. Contacto

Para consultas sobre privacidad, ejercicio de derechos, eliminación de datos o cuenta, soporte o reporte de problemas, utiliza:

**\`/contacto\`**
`,
    description: "Política de Privacidad de Coffeecito.",
    effectiveDate: LEGAL_DOCUMENT_EFFECTIVE_DATE,
    slug: "privacy",
    version: LEGAL_DOCUMENT_VERSION
  }
};
