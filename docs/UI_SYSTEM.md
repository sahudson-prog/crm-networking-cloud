# Sistema de UI

## Estado actual

La UI vigente de CRM Networking cloud está construida en `cloud/web` con Next.js, React y TypeScript. El styling se apoya principalmente en CSS global: `app/globals.css` importa `styles/tokens.css` y `styles/components.css`.

No existe un design system formal completo. Sí existe una base visual compartida con variables CSS, clases reutilizadas y algunas primitives React. La implementación combina patrones comunes con estilos específicos por módulo.

El shell privado integrado usa cabecera Cream, fondo general Warm White y bloques funcionales blancos. Los tokens CRM anteriores siguen presentes dentro de formularios, tablas y estados; la paleta de marca no sustituye automáticamente todos los colores funcionales. Predominan superficies simples, bordes discretos y contenedores sin tarjetas blancas anidadas innecesarias.

El criterio visual permanente es un acabado premium y preciso, comparable en cuidado a Apple Human Interface Guidelines: proporciones, alineación, espaciado, tipografía e iconografía coherentes a tamaño real en desktop y móvil. Usar iconos profesionales de un mismo sistema para conjuntos relacionados; evitar trazados SVG improvisados, badges decorativos y controles desproporcionados. Validar visualmente los cambios en ambos tamaños antes de darlos por terminados.

La fuente visual es Inter con fallback a fuentes del sistema.

La iconografía combina `components/ui/Icon.tsx` (SVG lineal interno), importaciones individuales de `lucide-react` en el shell, bloques, tablas y planes, y `components/ui/ProviderIcon.tsx` para proveedores. En el menú del shell, los SVG miden 18 px y usan trazo 2; controles compactos del header usan 18 px. Conservar escala y grosor coherentes por contexto, sin asumir que todos los iconos provienen de una sola librería. Un icono de proveedor no implica conector implementado.

## Identidad de marca

La marca se llama exactamente `Coffeecito`. Esta sección define el contrato visual estable aplicado a las superficies de producto.

### Paleta de marca

- Espresso: `#3B261B`. Principal de marca; se usa en wordmark, trazos principales y alto énfasis.
- Coffee: `#8B5A3C`. Marrón secundario para detalles y elementos secundarios.
- Terracotta: `#C7774C`. Acento cálido principal.
- Apricot: `#E3B18C`. Acento suave o secundario.
- Cream: `#FAF4EC`. Fondo cálido principal.
- Warm White: `#FFFDFB`. Superficies claras y blanco de marca.

### Wordmark

- Texto exacto: `Coffeecito`.
- Tipografía: Lato.
- Peso: 900 / Heavy.
- Color: Espresso `#3B261B`.
- Letter spacing: `-0.015em`.
- Capitalización: `Coffeecito`.

La tipografía del wordmark no redefine la tipografía general vigente de la interfaz, que continúa siendo Inter hasta una decisión de producto posterior.

### Sistema de logo

- La variante principal es horizontal: isotipo a la izquierda y wordmark a la derecha. Es el default para header y producto. Su referencia aprobada usa un isotipo de ancho equivalente a `2.32x` el tamaño tipográfico del wordmark: `102px` de isotipo para un wordmark de `44px`, equivalente al `+50%` evaluado frente a la composición inicial.
- La variante secundaria es apilada: isotipo arriba y wordmark abajo. Se usa en hero, bienvenida y piezas donde la marca tenga mayor protagonismo.
- La variante compacta usa solo el isotipo para favicon, app icon, avatar y espacios reducidos.
- Se permite una variante micro o simplificada solo si el isotipo pierde legibilidad en tamaños muy pequeños.
- El wordmark principal siempre usa Espresso. El isotipo usa únicamente colores de la paleta aprobada; no hay combinaciones obligatorias adicionales aprobadas todavía.
- El clear space, los tamaños mínimos y las proporciones de la variante apilada quedan pendientes de aprobación visual. No deben inventarse antes de esa decisión.

### Asset oficial

El isotipo oficial está versionado en `cloud/web/public/brand/coffeecito-isotipo.svg`, que es su fuente de verdad y usa fondo transparente. No debe reconstruirse ni sustituirse por aproximaciones.

`cloud/web/app/icon.svg` es el favicon/app icon derivado: reutiliza las formas, trazos y colores del isotipo maestro, pero emplea un lienzo y `viewBox` cuadrados con escala proporcional para aprovechar el espacio sin recortes. No incorpora el distintivo BETA. Ante cambios futuros del maestro, actualizar el derivado desde esa fuente y volver a validar 16, 32 y 48 px.

### Landing de acceso

La entrada no autenticada usa una composición centrada sobre una fotografía cálida de networking, con overlay Cream para legibilidad, el lockup horizontal oficial, headline y subtítulo de producto. Google es la acción principal en Espresso y el acceso por email permanece como alternativa colapsable con su verificación vigente. La composición no usa una tarjeta envolvente y mantiene el fondo en una capa independiente del contenido.

## Tokens y estilos base

`app/globals.css` importa `styles/tokens.css`, `styles/components.css`, `styles/invitations.css`, `styles/tracking.css` y `styles/shell.css`. Los tokens reales de marca son `--brand-espresso`, `--brand-coffee`, `--brand-terracotta`, `--brand-apricot`, `--brand-cream` y `--brand-warm-white`, con los HEX de la paleta anterior. `shell.css` aplica Cream a la región completa de header, navegación y búsqueda/filtros; Warm White al fondo de las vistas privadas. Los bloques funcionales siguen blancos mediante `--crm-surface`.

También continúan los tokens funcionales `--crm-bg`, `--crm-surface`, `--crm-border`, `--crm-border-strong`, `--crm-text`, `--crm-muted`, `--crm-empty-value`, `--crm-primary`, `--crm-accent`, `--crm-positive`, `--crm-danger` y `--crm-warning`. No equivalen todos a la paleta de marca: por ejemplo, `--crm-bg` es `#f6f7fb`, `--crm-surface` es `#ffffff` y `--crm-primary` es `#111827`. Los estados de networking conservan sus colores y fondos suaves propios; no se recolorean como estados empresariales. `--crm-radius`, `--crm-radius-sm`, `--crm-section-gap`, `--crm-shadow-soft` y `--crm-shadow-panel` cubren radio, separación de secciones y sombras. No hay una escala completa de espaciado, tipografía o breakpoints tokenizada.

La tipografía general sigue siendo Inter con fallback de sistema; Lato Heavy 900 se reserva al wordmark. El CTA de importación usa Espresso sólido; las tabs principales activas también. Las acciones secundarias del modal usan Warm White o Cream y bordes suaves. Los focos visibles del shell usan outline de `--crm-primary`; hover, foco, activo y deshabilitado se expresan según el componente. El filtro activo conserva una indicación animada que se desactiva con `prefers-reduced-motion: reduce`; no describirla como un color de marca oficial.

## Layout y navegación

`ApplicationFrame` mantiene `AuthGate`; `Shell`, `ApplicationShellContent`, `WorkspaceProvider` y `ShellChrome` componen el shell privado persistente sin montar providers adicionales por vista. `WorkspaceNavigation` ofrece Inicio (`/`), Producir (`/registrar-avances`) y Planificar (`/planificar`), más un menú para Objetivos (`/objetivos`), Contactos (`/contactos`) y Tutorial. Desktop ubica la navegación en la región superior; mobile la fija abajo con safe area y destinos equivalentes. El header conserva marca, `ActivitySyncButton` y su popup existente, Coach global y menú Cuenta/Sistema según capability. `/dashboard` conserva compatibilidad como ruta profunda.

La búsqueda de `ShellToolbar` abre fichas de contactos; no filtra indicadores. El shell muestra un solo botón y panel visual de filtros. Contactos aplica Foco, Headhunter, Estado, Prioridades y texto a Contactos/Empresas, no a Referidos. Producir los aplica al bloque de Estados de networking, no a Oportunidades ni Últimas interacciones. Planificar conserva Foco=Sí obligatorio, Headhunter y Prioridades para resumen/empresas y texto solo para empresas; Estado aparece deshabilitado. En Inicio, Objetivos, Cuenta, Sistema y fichas, el catálogo se muestra deshabilitado con explicación. BF-06B mantiene su selector Headhunter independiente. Los estados internos de filtros se conservan por contexto; no hay un efecto global unificado sobre todos los bloques.

El candidato local INT-01 usa `Panel` y dispone Inicio en cuatro filas: Ruta/Cifras a todo el ancho; Metas a la izquierda y Racha a la derecha; Información y novedades a todo el ancho; pirámide y evolución debajo. Mobile conserva ese orden. Ruta mantiene cinco cajas uniformes; con 5/5 pasa a cuatro cifras con iconos laterales. Entrevistas y variaciones comparativas permanecen omitidas por falta de fuente suficiente. No es un estado publicado en main.

Información y novedades conserva el componente y estilos internos del baseline local `6ab1913` (antecedente PR #54): controles originales, tracker, rotación de siete segundos, pausas, enlaces y modal. En el grid integrado cambia su posición y, desde 1024 px, ocupa el ancho completo sin la proporción exterior 4:3; conserva 480 px de altura. No se certifica equivalencia con PROD actual mediante esta comprobación local. `useHomeCarousel`, puntos y pausa manual por el resto de la visita pertenecen exclusivamente a Metas. Ambos respetan movimiento reducido y visibilidad. Metas y Racha comparten filas de igual altura, determinada por su contenido, sin recortes; cumplimiento se alinea a la derecha del título del desafío y envuelve cuando falta espacio.

Racha conserva semanas civiles; el promedio móvil de hasta 28 días aparece solo en su popover y normaliza por días cubiertos cuando hay menos. `selectFirstCoffee` es la atribución compartida por GAM, embudo y gráfico: estado Cita concretada/Agradecimiento enviado, primera cita válida pasada global o primera transición histórica a Cita concretada. Un primer café por contacto, filtros particulares posteriores; una cita registrada después puede modificar la fecha retroactivamente. Sin fecha suficiente se conserva el acumulado y la insuficiencia se limita a cálculos temporales. No se usan fechas estimadas ni `updated_at` como evidencia. Detalles y cobertura en `DATA_MODEL.md` y `planning/GAM-01.md`.

La portada pública usa `ProductSlideshow` con Swiper, tres assets locales derivados de componentes reales, loop de cinco segundos y sin botones ni indicadores. Conserva drag/touch y teclado al recibir foco, pausas por hover/foco/visibilidad y movimiento reducido. Es independiente de EditorialFeed. La tercera composición muestra Cifras, Metas y Racha de `GamificationPanel` con datos sintéticos; no la pirámide anterior. `/ingresar` conserva AuthGate y el login existente. El Coach del asset mantiene la boca abierta sin modificar el avatar productivo.

Cuenta y onboarding comparten StartingPointFields, presentación, “¿Cómo te llamas?” y “Situación profesional”; Dependiente/En búsqueda activa conservan employed/unemployed. Las pills sin máximo y mínimo una selección son exclusivas de onboarding. Objetivos normal conserva su módulo de Prioridades y popup; solo las tarjetas de planes comparten compactación, acciones centradas y verde pálido activo. No cambia la persistencia ni las acciones normales de cierre/Avísame.

## Primitives compartidas

`ReadOnlyDashboard` y `ReadOnlyContacts` componen los bloques distribuidos por vista. Inicio presenta «Información y novedades» (BF-12), pirámide de avance y evolución de contactos; Producir reúne estados de networking, oportunidades y últimas interacciones; Planificar muestra resumen por prioridad y empresas headhunter; Contactos presenta personas, Empresas (BF-11) y Referidos; Objetivos conserva ciclo y Prioridades. `Panel`, tablas, tableros y timelines reutilizan sus primitives. La lectura de estado y detalle conserva contenido durante refresh/error cuando corresponde; las pruebas sintéticas no sustituyen el smoke autenticado.

`Button` es la primitive principal para botones. Usa clase `.button`, tonos `primary`, `secondary`, `ghost`, `danger` y `positive`, variante cuadrada e iconos opcionales.

`Panel` encapsula secciones con título, caption opcional y acción opcional.

`Icon` centraliza iconos SVG lineales internos. `ProviderIcon` y `ProviderButton` centralizan iconos de proveedores.

`EmptyValue` encapsula textos de ausencia de dato mediante `.empty-value`.

`ProgressBar` define barras determinadas o indeterminadas, con tonos neutral, primary, success, warning y danger.

`StatusBadge` presenta estados de networking con clase `.status` y color derivado de `statusClass`.

Estas primitives son compartidas, pero no cubren toda la UI. Muchos módulos todavía usan clases CSS locales y composición propia.

## Carga de vistas operacionales

Contactos, Producir, Planificar y Objetivos mantienen sus paneles y encabezados durante la lectura inicial. `ViewSkeleton` y `styles/view-loading.css` son la primitive compartida: variantes tabla, lista, tablero (columnas explicitas) e inline. No contienen datos ficticios, conteos cero ni textos tecnicos visibles de espera. El nombre accesible y `aria-busy` comunican la lectura sin animaciones obligatorias.

- Initial/loading: reservar la geometria en el propio bloque; no agregar una franja de carga encima de toda la vista. Los estados vacios requieren una lectura confirmada.
- Ready/empty: reemplazar solamente el interior del bloque. Conservar los encabezados, controles y estados vacios reales de cada superficie.
- Refreshing: conservar contenido compatible montado, filtros y seleccion; revalidar sin textos de "Actualizando" ni skeletons recurrentes. La cache es en memoria, por usuario, con invalidacion por mutaciones y Calendar; no persiste datos entre sesiones.
- Error: mostrar el error y una accion de reintento; no convertirlo en cero o lista vacia. Si existe una lectura anterior compatible, conservarla. Bloquear acciones dependientes de una lectura fallida cuando corresponda.
- Coordinacion: las lecturas independientes comienzan en paralelo. Planificar puede presentar los indicadores principales antes del detalle suplementario; las actualizaciones posteriores del par snapshot/detalle se publican juntas y descartan respuestas de generaciones anteriores. Avisos de planes futuros y oportunidades no bloquean toda la vista Objetivos.
- Los guards de contexto/ciclo de las escrituras siguen vigentes. Un cambio incompatible de contacto o ciclo no autoriza mostrar otro registro como si fuera el actual.

`OperationStatus` reserva 28 x 28 px inmediatamente despues del titulo del bloque,
directamente o mediante `Panel.status`. Antes de la primera lectura confirmada y
durante lecturas, mutaciones o reconciliaciones muestra spinner; una lectura vigente
sin pendientes muestra check verde durante tres segundos tras una nueva confirmacion
(primera lectura o guardado/reconciliacion explicitamente acreditados, o recuperacion
de un error); despues deja el espacio sin icono. Los adaptadores distinguen una
operacion explicita mediante `confirming`; una revalidacion ordinaria muestra spinner
durante la lectura pero no vuelve a emitir el check al terminar.
Montar datos ya confirmados de cache o un render ordinario no reinicia ese plazo.
El temporizador vive exclusivamente en la primitiva y se cancela ante otra operacion
explicita, error o desmontaje. Una relectura durante el check conserva el vencimiento
original, no inicia otros tres segundos. Si vence con foco o detalle abierto, oculta el icono sin retirar
el control activo; al salir queda solo el espacio reservado.
Un error real o resultado incierto
prevalece sobre ambos y conserva detalle y reintento de lectura en un popover.
No usa temporizadores para declarar exito. El control es un boton con nombre
accesible, estado polite y aria-busy; respeta movimiento reducido.

Lo reutilizan Contactos/Empresas/Referidos, Estados/Oportunidades/Interacciones,
Prioridades/Headhunters, el ciclo de Objetivos y las tablas/tableros del tutorial.
Los mensajes normales de espera o de movimientos guardados no ocupan una franja.
Los formularios, importaciones, sincronizaciones y confirmaciones explicitas mantienen
su feedback especifico; Inicio/GAM no cambia. Los gates previos al acceso mantienen
geometria neutra, nunca un check ni contenido privado antes de autorizar.
La validacion sintetica de estados no acredita por si sola scroll, foco, contraste
o geometria en un navegador real.

Los movimientos explícitos de tarjetas de Contactos y Oportunidades inician el
guardado al confirmar el drop, sin debounce. La posición es optimista y conserva
el indicador ocupado hasta confirmar. Una cola en memoria por usuario y entidad
continúa durante navegación SPA/desmontaje, serializa movimientos consecutivos y
relee el estado real antes de retirar el overlay. Invalida las lecturas al terminar.
Ante fallo o respuesta incierta no repite la escritura ni los movimientos siguientes
ya encolados: muestra error y ofrece reconciliación de solo lectura. El tutorial
acredita Pendiente → Contactado únicamente con confirmación del escritor, no con
el gesto ni con una lectura que coincida después de una respuesta perdida.
La advertencia de recarga/cierre existe solo mientras hay operaciones activas;
no escribe durante unload ni garantiza supervivencia a cierre forzado, caída del
navegador o pérdida de red. Otros formularios conservan su patrón de guardado.

## Formularios

El patrón de formulario más visible usa `.field`, `.field-row`, inputs, selects y textareas con borde claro, fondo blanco, altura compacta y foco azul.

Los labels suelen aparecer como texto pequeño en mayúscula o semibold, según contexto. Los placeholders usan el estilo de ausencia de dato cuando corresponde.

Los errores usan principalmente `.danger-text` o `.form-error`. Los mensajes positivos usan `.form-success` o texto meta. La consistencia es parcial: algunos mensajes aún viven dentro de cada componente.

Los formularios observados usan botones Cancelar/Guardar en el footer del modal o al cierre del bloque. Los estados loading suelen cambiar el texto del botón y deshabilitar acciones.

El alta de contacto presenta nombre obligatorio, empresa/cargo y un correo/teléfono
opcionales; los controles compactos junto a correo/teléfono permiten añadir medios
adicionales. `Más detalles` conserva estado, Foco, Headhunter y Prioridades.
El diálogo nativo mantiene el foco, lo devuelve al disparador y pide confirmación
antes de descartar cambios. Nombre valida solo después del primer intento de crear;
los correos validan al salir del campo o intentar guardar y los teléfonos, al
intentar guardar. Se admite teléfono vacío y números nacionales o internacionales
de 7 a 15 dígitos, con prefijo + o 00 y separadores habituales; el error se muestra
por campo y no descarta el valor ingresado. Cabecera, cuerpo
desplazable y pie son regiones separadas; en móvil se presenta como hoja inferior.
La acción de alta es `Crear contacto`, sin proveedores placeholder.

La ficha prioriza identidad, estado/Foco, chips de Prioridades y `Registrar
interacción`. `Citar café` reutiliza el enlace Google Calendar existente, sin nueva
integración; cada dirección conserva sus acciones individuales compactas. La
sincronización individual se oculta hasta confirmar su habilitación con el gate
existente de Google Contacts. Prioridades usa un disparador punteado Editar/Agregar y
un popover modal con búsqueda y selección múltiple, el lector compartido y el escritor
de asignaciones existente; los errores conservan la selección y permiten reintentar.
Tab y Shift+Tab permanecen en el popover; Escape lo cierra y devuelve el foco al
disparador. El cierre ocupa una fila propia, separada de la búsqueda.
Historia precede a Referidos en móvil, conserva colores por tipo y edición separada,
y muestra títulos completos y hasta dos líneas de nota contraída. Registrar
interacción es el único acceso de alta en la ficha. Los atajos Hoy/Ayer y el campo
de fecha (entrada explícita `dd/mm/aaaa`, con validación de fecha civil) se separan
de los selectores de hora y minutos, que permiten todos los
valores sin redondear. Una edición sin cambios temporales conserva el timestamp
original. La persistencia manual exige un timestamp: no se ofrece una falsa opción
de hora desconocida ni se modifica el contrato de datos.

## Tablas, listas y selección

Las tablas usan `.table` dentro de `.table-wrap`, con encabezados compactos, filas separadas por borde y scroll horizontal cuando el contenido lo requiere.

La tabla de contactos incluye selección por checkbox, orden por columnas visibles, acciones masivas, tablero de estado y vínculos al perfil del contacto.

Las acciones masivas de contactos están agrupadas por tipo: Seleccionar, Foco, Headhunter, Estado y Objetivos. Usan botones de icono compactos y selectores.

Las listas de interacciones usan `InteractionTimelineList`, basado en `details/summary`. Se conserva en fichas y en «Últimas interacciones» de Producir, además de otros consumidores.

Objetivos usa bloques por tipo, filas seleccionables, acciones contextuales visibles al seleccionar y estrellas para prioridad. BF-07 y BF-09 en Planificar permiten ordenación ascendente/descendente por columnas de datos. BF-11 reutiliza convenciones de `ContactTable`: selección múltiple, Empresa, Contactos, Estado más avanzado y Última interacción, calculados sobre los contactos filtrados antes de seleccionar empresas.

## Dialogs y feedback

La importación de contactos usa un único `ContactImportDialog` desde Contactos, Cuenta → Configuración y el paso Importar datos del tutorial. Su caja estable apunta a 720 px de ancho, mínimo aproximado de 520 px y máximo de 85dvh; el contenido excedente desplaza el cuerpo interno, manteniendo fijo el footer. Si Google Contacts está habilitado por permisos efectivos, ofrece «Desde archivo» y «Desde Google»; en caso contrario solo archivo. «Subir archivo» abre el selector nativo y la elección de un `.vcf` válido inicia el preview existente; selección y confirmación preceden a aplicar cambios. Cancelar el selector conserva el modal. `VCardHelp` ofrece instrucciones de Google, iCloud, iPhone y Samsung en tabs secundarias; Cuenta y tutorial conservan Contactos, Citas y Correos. La superficie Warm White, CTA Espresso, bordes suaves y tabs de proveedor discretas evitan protagonismo secundario. El lector, validaciones, duplicados y persistencia permanecen en sus componentes.

El patrón modal compartido usa `.modal-backdrop` y `.modal-card`, con header, cuerpo y footer de acciones. Los diálogos se adaptan por clases específicas como editor de contacto, editor de interacción, preview de sync o fusión de contactos.

Los botones principales suelen ir a la derecha del footer, con acción primaria oscura. Las acciones destructivas usan tono rojo cuando están implementadas como botón o texto de advertencia.

Algunas confirmaciones usan `window.confirm`; otras usan modal propio. No hay una primitive única para confirmación destructiva.

El feedback aparece como texto inline, franja dentro de panel, mensaje de modal o barra de progreso según componente. Hay patrones compartidos, pero no un sistema único centralizado de notificaciones.

## Sync y fusión

`SyncPreviewDialog` es el patrón visual de los flujos Review/Apply para revisar cambios antes de aplicar; el clic global de Calendar V2 ejecuta la operación completa sin este preview. Muestra tabs, conteos, tarjetas seleccionables, descripción por sección, botón de edición de datos, footer con resumen de selección y progreso opcional.

La edición de datos dentro del preview reutiliza `ContactMergeDialog` y `ContactMergeWorkspace`. Visualmente compara fuentes, deja construir un resultante y vuelve al preview sin guardar hasta aplicar selección.

La lógica de matching, cursores, precedencia y persistencia no pertenece a este documento.

## Coach

`CoachPreview` y `CoachModule` presentan sugerencias como burbujas compactas junto a una mascota visual. Permiten seleccionar sugerencias, ejecutar, descartar, buscar nuevas sugerencias y abrir configuración o historial. Suggestions y onboarding comparten un único frame visual para la mascota, la burbuja, su borde y su punta responsive; cada modo aporta únicamente su contenido y controles propios.

El shell muestra Coach global en un popover expandido con contador; en ficha puede presentar sugerencias contextuales filtradas al contacto actual. `WorkspaceProvider` refresca lecturas después de acciones del Coach. El tutorial reutiliza el modo `onboarding` sin ejecutar sugerencias automáticamente.

Las burbujas usan `details/summary`, fecha visible, texto compacto, vínculos al contacto y checkbox externo. La semántica de reglas no pertenece a este documento.

La misma envolvente visual del Coach admite un modo `onboarding`. Conserva la mascota y la burbuja amplia, exclusivamente con la explicación del paso; no contiene progreso, encabezados duplicados, navegación ni acciones de sugerencias. El tracker permanece en el header exclusivo del tutorial y la navegación debajo del contenido funcional. La mascota usa el estado visual de habla; la punta se reubica sobre la burbuja en pantallas estrechas.

## Onboarding inicial

El recorrido guiado vive exclusivamente bajo `/onboarding/*`. Después de sesión, acceso a la aplicación y aceptación legal vigentes, el first-run es obligatorio hasta que `product_onboarding_v1` quede en estado `completed`; las rutas privadas no montan su header ni contenido mientras ese gate se resuelve. Los estados históricos `not_started`, `in_progress` y `dismissed`, además de un setting ausente o inválido, permanecen dentro del onboarding. Un recorrido `in_progress` reanuda su `lastStep` persistido y una URL arbitraria no adelanta el flujo.

La introducción es una pantalla privada y editorial sobre fotografía, independiente del `Shell` y del Coach. Sus cuatro slides permanecen intactas: las tres primeras presentan concepto, beneficios y práctica; la cuarta centra el cierre y `Empecemos`. La introducción first-run no ofrece salida. Los tres pasos guiados sí ofrecen `Saltar el tour`: guarda `completed`, conserva datos y vuelve al Inicio real (`/`). `Ver tutorial` sigue abriendo un replay opcional sin deshacer el estado persistente `completed`.

ONBOARDING-01 presenta `Tu objetivo`, `Carga tu red` y `Tu tablero`. El primer paso reúne el formulario real de nombre/situación profesional, el panel vigente de ciclo y chips de Prioridades. No agrega una fecha independiente: el inicio se configura mediante el diálogo real del ciclo; las acciones de gestión posteriores se ocultan solo en el tutorial. Los chips crean inmediatamente prioridades reales `MEDIUM` (nivel 2), reutilizan existentes sin cambiar nivel y desactivan sin borrar asociaciones. No hay máximo de selecciones entre categorías. Avanzar exige perfil válido, ciclo configurado, al menos una prioridad y ningún guardado pendiente/fallido.

Onboarding y Objetivos comparten tarjetas de objetivo compactas, acciones centradas y estado activo verde pálido con sombra suave. Los encabezados usan `panel-title`, iconos oficiales de 20 px y separación de 8 px; Prioridades usa `Icon name="tag"`. Objetivos conserva Finalizar proceso y Avísame. Situación profesional muestra `Dependiente` y `En búsqueda activa` desde el catálogo compartido de onboarding/Cuenta, sin cambiar los códigos persistidos `employed` y `unemployed`.

El segundo paso reutiliza la tabla, importador y editor reales de Contactos, sin filtros ni contactos precargados; avanzar requiere un contacto. La tabla vacía del tutorial oculta sus encabezados y destaca el estado vacío. El tercero reutiliza el kanban y sus tarjetas de cinco estados sin Agrupar headhunters, sin selector por tarjeta ni navegación a la ficha, con altura compacta y scroll interno. La confirmación real de un guardado `Pendiente -> Contactado` habilita la felicitación y `Empezar!`; el gesto optimista no basta. `OperationStatus` representa lectura/guardado sin la franja textual transitoria. La variante no cambia Contactos normal. El header guiado no monta navegación principal, Sync, Cuenta ni Coach global. Al completar se vuelve al Inicio.

El avance sigue en `product_onboarding_v1`; el campo opcional `boardExerciseCompleted` conserva el ejercicio al volver/recargar. Los pasos legacy `starting_point`, `contact` y `final` se interpretan como objetivo o tablero, sin borrar datos ni reabrir usuarios completados. En replay, editar perfil, prioridades o contactos sigue siendo una acción real explícita; no se introducen datos demo. Cuenta conserva su reinicio de prueba en development.

La navegación principal visible se ordena Inicio, Producir, Planificar y Más; el menú Más incluye Objetivos, Contactos y Tutorial. El header conserva la acción global de actualización con su flujo/popup Sync existente; navegar no la dispara. `Cerrar sesión` se conserva en el menú global del header; Cuenta no duplica esa acción.

Oportunidades V1 se presenta en Producir mediante el tablero existente, con sus cuatro etapas, filtro, arrastre, menú de tarjeta y diálogos de cierre/restauración. Contactos conserva su tablero de estados, selección masiva y fichas. Estos bloques se movieron de vista sin alterar sus acciones ni crear accesos contextuales duplicados.

Cuenta presenta `Importar datos` con Contactos y Citas en dos columnas de igual ancho y altura en desktop, apiladas con altura natural en mobile. Correos y la sincronización Google se muestran solo tras confirmar la asignación vigente y activa de `system_admin` y el catálogo de rol activo; carga, error o ausencia de rol no los muestran. Esta restricción es de presentación: cada importador conserva sus gates, permisos y acciones existentes. Onboarding conserva su variante de tres fuentes. No hay encabezado interno duplicado ni `Incluir al actualizar`. Los proveedores mantienen sus logos y acciones accesibles; `.ics` conserva su feature gate, sin habilitación adicional.

Cuenta conserva sus campos y el reinicio de datos con ambas confirmaciones, sin acciones placeholder de cambio de plan ni borrado de cuenta. `Fusionar contactos duplicados` integra el contenido sin otro panel/título anidado; diálogo y fusión no cambian. `Eliminar cuenta` enlaza a `/contacto` y aclara que inicia una solicitud, no un borrado automático.

Objetivos coordina ciclo y Prioridades en la vista vigente; Oportunidades se presenta en Producir. El tutorial conserva su Coach y sus gates. Las relecturas mantienen contenido montado cuando corresponde, sin tratar errores como listas vacías ni repetir escrituras al navegar.

El tutorial comparte `ViewSkeleton`: formulario de perfil, chips de Prioridades y
tabla/tablero de contactos reservan geometría antes de la primera lectura. Las
revalidaciones compatibles conservan contenido; un error inicial no presenta una
lista vacía ni selecciones falsas. Prioridades reutiliza `readObjectives` y contactos
reutiliza `readContactListRows`, con las mismas generaciones de lectura de las vistas
operacionales. Perfil conserva su RPC y validaciones existentes, sin caché paralela.
Los gates de Auth, acceso, aceptación legal, routing y onboarding muestran solo
geometría neutra mientras se resuelven: no montan contenido privado ni acciones para
saltar el recorrido. Errores/reintentos y feedback explícito de guardado permanecen.

## Responsive y accesibilidad observable

El responsive combina media queries de `components.css` y `shell.css`, además de un container query del Coach. El shell cambia a navegación inferior a 760 px; la búsqueda y los botones compactos mantienen áreas táctiles y safe area.

En ancho menor, grids principales pasan a una columna, la navegación secundaria se reacomoda, modales reducen ancho y algunas vistas mantienen scroll horizontal en tablas.

No se observó framework formal de accesibilidad ni declaración WCAG. Sí hay uso de botones semánticos, `aria-label`, `aria-pressed`, `aria-selected`, `role="dialog"`, `aria-modal`, `role="tab"`, `title` como tooltip y clase `.sr-only`.

Los controles nativos ayudan con teclado y foco, pero la cobertura de accesibilidad debe considerarse parcial.

## Admin y diagnóstico

Mantención admin reutiliza paneles, botones, campos, tablas y `ProgressBar`, pero tiene patrones propios para límites, capacidades, accesos y visor de datos crudos.

`DataDiagnosticsPanel` usa selector de alcance, selector de tabla, buscador, resumen por tabla, filtros por columna y ordenamiento local. Es una UI operativa densa, más cercana a soporte interno que a usuario final. La tabla `sync_run_logs` solo aparece y se consulta cuando la sesión tiene `admin.view_diagnostics`, aunque Mantención se haya abierto mediante `admin.manage_access`.

El índice Sistema muestra únicamente las superficies autorizadas por capabilities efectivas. Guía y Logs requieren diagnóstico; Mantención requiere administración de acceso; y el maestro HeadHunter requiere administración de maestros globales. Los estados pendientes o con error no muestran enlaces administrativos.

## Contenido y lenguaje

El idioma principal visible es español. La terminología mezcla nombres finales como Contactos, Objetivos, Headhunter, Estado networking, Últimas interacciones y Cuenta con algunos textos sin tilde o de tono técnico.

La convención dominante es usar acciones breves: Guardar cambios, Aplicar selección, Editar datos, Vincular, Importar, Cancelar.

Los textos de ausencia de dato usan variantes como `sin datos`, `Sin empresa`, `Sin cargo`, `sin objetivos` y `sin interacciones`. El patrón visual existe, pero el texto no está completamente normalizado.

## Límites actuales

No existe catálogo formal de componentes. Sí hay harnesses focales de navegador y pruebas visuales sintéticas; la prueba autenticada DEV/PROD sigue siendo un gate distinto según `docs/TESTING.md`.

No todos los botones usan `Button`; algunos componentes usan `button` directo por necesidades locales.

No todos los mensajes de error, éxito, loading y empty state pasan por una primitive común.

Los tokens cubren colores, radios y sombras, pero no todo el lenguaje visual.

La UI está suficientemente ordenada para documentar patrones reutilizables, pero todavía no corresponde describirla como un design system completo.
