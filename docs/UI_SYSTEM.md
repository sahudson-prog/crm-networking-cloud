# Sistema de UI

## Estado actual

La UI vigente de CRM Networking cloud está construida en `cloud/web` con Next.js, React y TypeScript. El styling se apoya principalmente en CSS global: `app/globals.css` importa `styles/tokens.css` y `styles/components.css`.

No existe un design system formal completo. Sí existe una base visual compartida con variables CSS, clases reutilizadas y algunas primitives React. La implementación combina patrones comunes con estilos específicos por módulo.

La app usa una estética sobria: fondo gris claro, paneles blancos, bordes suaves, radio bajo, sombras contenidas, texto oscuro y acentos azules/verdes/rojos/naranjos según acción o estado.

El criterio visual permanente es un acabado premium y preciso, comparable en cuidado a Apple Human Interface Guidelines: proporciones, alineación, espaciado, tipografía e iconografía coherentes a tamaño real en desktop y móvil. Usar iconos profesionales de un mismo sistema para conjuntos relacionados; evitar trazados SVG improvisados, badges decorativos y controles desproporcionados. Validar visualmente los cambios en ambos tamaños antes de darlos por terminados.

La fuente visual es Inter con fallback a fuentes del sistema.

La iconografía compartida usa el set SVG lineal de `components/ui/Icon.tsx`. Los tres planes de `Mi objetivo` usan `BriefcaseBusiness`, `Handshake` y `Megaphone` de `lucide-react`, importados individualmente y con escala/trazo comunes; esta excepción no cambia los demás iconos de la app. `components/ui/ProviderIcon.tsx` contiene iconografía de proveedores presente en la UI; la existencia de un icono no implica que el conector correspondiente esté implementado.

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

`styles/tokens.css` define tokens reales para colores principales, superficies, bordes, texto, estados, radios y sombras.

Los tokens de color reutilizados incluyen `--crm-bg`, `--crm-surface`, `--crm-border`, `--crm-text`, `--crm-muted`, `--crm-empty-value`, `--crm-primary`, `--crm-accent`, `--crm-positive`, `--crm-danger` y `--crm-warning`.

Los estados de networking tienen colores y fondos suaves dedicados: Pendiente, Contactado, Agendado, Cita concretada y Agradecimiento enviado.

Existen tokens de radio y sombra: `--crm-radius`, `--crm-radius-sm`, `--crm-shadow-soft` y `--crm-shadow-panel`.

No se observó un sistema formal de spacing, tipografía, widths o breakpoints como tokens completos. Esos valores aparecen principalmente como reglas CSS repetidas o específicas de componente.

## Layout y navegación

El shell principal vive en `components/Shell.tsx`. Usa `.app-shell` como contenedor centrado, con ancho máximo de 1220px y margen horizontal responsive.

La cabecera separa navegación principal y acciones secundarias. Contactos y Objetivos aparecen como navegación principal con texto e icono. Contactos es la página principal autenticada en `/` y conserva su ruta explícita `/contactos`. El candidato local Seguimiento reutiliza `/dashboard` y devuelve su enlace visible, sin cambiar los gates privados. A 320 px los tres enlaces principales compactan espaciado/tamaño sin añadir otra fila. Las utilidades se ordenan como Sistema, Sync y Cuenta, con Cuenta al extremo derecho; Sistema aparece solo cuando el usuario tiene al menos una capability administrativa efectiva para diagnóstico, gestión de accesos o maestros globales. Sync es un control compacto que abre un popover con una fila por servicio habilitado, freshness individual, errores o resultados transitorios y una única acción contextual; el header no expone esos textos de forma permanente.

Las vistas se organizan con `Panel`, grids y toolbars. El patrón visual más estable es panel blanco con borde, header compacto, título de 16px y contenido interno ordenado por grid o listas.

Contactos y Seguimiento reutilizan `ContactFilterControls`: buscador, Foco, Headhunter y Más filtros. En Seguimiento, Foco permanece fijo en Sí por contrato; Prioridades conserva selección OR, y Agrupar Headhunters se ubica junto al selector temporal del gráfico. `Mi objetivo` reutiliza panel, campos y modal del sistema. La interfaz no muestra el historial de procesos.

## Primitives compartidas

Seguimiento V1 local conserva la composición de `ReadOnlyDashboard`: búsqueda, filtros, bloque `¿Cómo voy?`, tabla `ObjectiveMetricsTable`, Últimas interacciones, Empresas headhunter y Contactos referidos. Un único Panel blanco contiene cinco niveles rectangulares compactos a la izquierda, con conversiones alineadas a su derecha, y `KpiLineChart` reutilizado a la derecha; se apilan solo cuando el espacio del panel es insuficiente. El gráfico usa doce posiciones temporales fijas sin carrusel ni línea: columnas azul oscuro/azul claro/verde apiladas para café con fecha de cita, café con fecha estimada y cita futura proyectada; total numérico encima de cada columna, período actual en negrita, leyenda debajo y toggle mensual/semanal arriba. El paso horizontal de las barras equivale aproximadamente a dos veces su ancho; no se muestra acumulado separado. La tabla conserva sus columnas y añade Oportunidades inmediatamente después de Prioridad. Las ayudas breves de números, conversiones y períodos admiten hover, foco y Escape. El snapshot se conserva durante refresh/error; las lecturas de detalle tienen error independiente y nunca sustituyen las métricas. La búsqueda explora los detalles, mientras Prioridades/HH gobiernan los indicadores según OBJ-02. La validación visual sintética no sustituye el smoke autenticado del owner.

`Button` es la primitive principal para botones. Usa clase `.button`, tonos `primary`, `secondary`, `ghost`, `danger` y `positive`, variante cuadrada e iconos opcionales.

`Panel` encapsula secciones con título, caption opcional y acción opcional.

`Icon` centraliza iconos SVG lineales internos. `ProviderIcon` y `ProviderButton` centralizan iconos de proveedores.

`EmptyValue` encapsula textos de ausencia de dato mediante `.empty-value`.

`ProgressBar` define barras determinadas o indeterminadas, con tonos neutral, primary, success, warning y danger.

`StatusBadge` presenta estados de networking con clase `.status` y color derivado de `statusClass`.

Estas primitives son compartidas, pero no cubren toda la UI. Muchos módulos todavía usan clases CSS locales y composición propia.

## Formularios

El patrón de formulario más visible usa `.field`, `.field-row`, inputs, selects y textareas con borde claro, fondo blanco, altura compacta y foco azul.

Los labels suelen aparecer como texto pequeño en mayúscula o semibold, según contexto. Los placeholders usan el estilo de ausencia de dato cuando corresponde.

Los errores usan principalmente `.danger-text` o `.form-error`. Los mensajes positivos usan `.form-success` o texto meta. La consistencia es parcial: algunos mensajes aún viven dentro de cada componente.

Los formularios observados usan botones Cancelar/Guardar en el footer del modal o al cierre del bloque. Los estados loading suelen cambiar el texto del botón y deshabilitar acciones.

## Tablas, listas y selección

Las tablas usan `.table` dentro de `.table-wrap`, con encabezados compactos, filas separadas por borde y scroll horizontal cuando el contenido lo requiere.

La tabla de contactos incluye selección por checkbox, orden por columnas visibles, acciones masivas, tablero de estado y vínculos al perfil del contacto.

Las acciones masivas de contactos están agrupadas por tipo: Seleccionar, Foco, Headhunter, Estado y Objetivos. Usan botones de icono compactos y selectores.

Las listas de interacciones usan `InteractionTimelineList`, basado en `details/summary`. Se conserva en la ficha de contacto, en Últimas interacciones de Seguimiento y otros consumidores de timeline.

Objetivos usa bloques por tipo, filas seleccionables, acciones contextuales visibles al seleccionar y estrellas para prioridad.

## Dialogs y feedback

La importación de contactos usa un único modal desde Contactos, Cuenta → Configuración y el paso Importar datos del tutorial. Si Google Contacts está habilitado por los permisos efectivos, ofrece «Desde archivo» y «Desde Google»; de lo contrario muestra solo el método de archivo. En «Desde archivo», «Subir archivo» abre el selector nativo y, tras elegir un `.vcf` válido, inicia la previsualización existente. La selección y confirmación preceden a cualquier aplicación; cancelar el selector conserva el modal y su estado. `VCardHelp` se despliega dentro del modal con instrucciones y enlaces de Google, iCloud, iPhone y Samsung, sin otro diálogo. Cuenta y tutorial conservan las categorías Contactos, Citas y Correos. El lector, las validaciones, los duplicados y la persistencia existentes permanecen en sus componentes.

El patrón modal compartido usa `.modal-backdrop` y `.modal-card`, con header, cuerpo y footer de acciones. Los diálogos se adaptan por clases específicas como editor de contacto, editor de interacción, preview de sync o fusión de contactos.

Los botones principales suelen ir a la derecha del footer, con acción primaria oscura. Las acciones destructivas usan tono rojo cuando están implementadas como botón o texto de advertencia.

Algunas confirmaciones usan `window.confirm`; otras usan modal propio. No hay una primitive única para confirmación destructiva.

El feedback aparece como texto inline, franja dentro de panel, mensaje de modal o barra de progreso según componente. Hay patrones compartidos, pero no un sistema único centralizado de notificaciones.

## Sync y fusión

`SyncPreviewDialog` es el patrón visual principal para revisar cambios antes de aplicar. Muestra tabs, conteos, tarjetas seleccionables, descripción por sección, botón de edición de datos, footer con resumen de selección y progreso opcional.

La edición de datos dentro del preview reutiliza `ContactMergeDialog` y `ContactMergeWorkspace`. Visualmente compara fuentes, deja construir un resultante y vuelve al preview sin guardar hasta aplicar selección.

La lógica de matching, cursores, precedencia y persistencia no pertenece a este documento.

## Coach

`CoachPreview` y `CoachModule` presentan sugerencias como burbujas compactas junto a una mascota visual. Permiten seleccionar sugerencias, ejecutar, descartar, buscar nuevas sugerencias y abrir configuración o historial. Suggestions y onboarding comparten un único frame visual para la mascota, la burbuja, su borde y su punta responsive; cada modo aporta únicamente su contenido y controles propios.

En Seguimiento candidato el Coach no se monta; su código de sugerencias agrupadas/detalladas se conserva para otros usos. En ficha de contacto ocupa el ancho completo antes del grid principal y filtra al contacto actual.

Las burbujas usan `details/summary`, fecha visible, texto compacto, vínculos al contacto y checkbox externo. La semántica de reglas no pertenece a este documento.

La misma envolvente visual del Coach admite un modo `onboarding`. Este modo conserva la mascota y la presentación frameless de la ficha, muestra una burbuja amplia con contenido guiado, progreso y navegación, y no presenta acciones, configuración, historial ni ejecución de sugerencias. En los pasos guiados ocupa el ancho completo entre la navegación y el contenido real de la página; la mascota usa el estado visual de habla mientras esa burbuja está visible. Las burbujas guiadas comparten radio uniforme, jerarquía tipográfica, espaciado y una punta triangular integrada que se reubica sobre la burbuja en pantallas estrechas.

## Onboarding inicial

El recorrido guiado vive exclusivamente bajo `/onboarding/*`. Después de sesión, acceso a la aplicación y aceptación legal vigentes, el first-run es obligatorio hasta que `product_onboarding_v1` quede en estado `completed`; las rutas privadas no montan su header ni contenido mientras ese gate se resuelve. Los estados históricos `not_started`, `in_progress` y `dismissed`, además de un setting ausente o inválido, permanecen dentro del onboarding. Un recorrido `in_progress` reanuda su `lastStep` persistido y una URL arbitraria no adelanta el flujo.

La introducción es una pantalla privada y editorial sobre fotografía, independiente del `Shell` y del Coach. Tiene cuatro slides: las tres primeras presentan concepto, beneficios y práctica con navegación Anterior/Siguiente; la cuarta centra el cierre y el CTA `Empecemos`. El first-run no ofrece `Ahora no`, defer ni salida, y los pasos guiados tampoco pueden cerrarse. `Ver tutorial` permanece como acceso desde el header después de completar el onboarding y abre un replay opcional y descartable que no modifica el estado persistente `completed`.

Después de la introducción y antes de Objetivos, R1 incorpora `Tu punto de partida` sin reemplazar la pantalla existente. El paso usa el mismo Coach superior, burbuja, espaciado, navegación y adaptación responsive del tutorial; debajo presenta nombre, situación profesional y `Fecha_Inicio_Networking`. En first-run, `Siguiente` valida y guarda antes de avanzar. En replay, navegar no escribe automáticamente y la edición es una acción explícita. Cuenta reutiliza el mismo formulario y contrato persistente.

Tras Objetivos, el recorrido muestra la importación real de contactos por vCard o Google y luego la vista de Contactos, incluso si la red está vacía. La ficha se muestra solo cuando existe un contacto; de otro modo se pasa al cierre. Contactos ofrece creación manual mediante el mismo editor tanto en la vista normal como durante el recorrido. El Coach aparece siempre a ancho completo antes del contenido; en pantallas estrechas la mascota queda sobre la burbuja. Las separaciones entre el Coach y los bloques principales del recorrido usan el token semántico `--crm-section-gap`. Completar el recorrido vuelve a Contactos y habilita el producto; salir de un replay vuelve a Contactos sin alterar `completed`. Cuenta conserva únicamente el reinicio de prueba en development.

La navegación principal visible se ordena como Objetivos y Contactos. El link `Ver tutorial` vive en las utilidades del header y no aparece durante el recorrido. El header muestra junto a la acción de actualización global un estado compacto calculado desde el servicio habilitado menos reciente, además de ejecución, resultado transitorio o error accionable; esa acción aplica directamente la actividad elegible sin abrir preview. `Cerrar sesión` vive en una sección separada de Cuenta y no en el header.

El candidato local Oportunidades V1 añade bajo Prioridades, solo en la vista normal de Objetivos, un Kanban de cuatro etapas con columnas gris, azul, morada y verde, y filtro Activas/Finalizadas/Todas (Activas por defecto). La píldora Finalizar abre un popover acotado a resultado de la etapa y Causa de cierre opcional; una finalizada conserva columna, muestra resultado y ofrece la píldora Restaurar en esa misma etapa. Contactos y Oportunidades comparten `StatusBoard`, `StatusBoardCard`, sus clases visuales y `useDeferredBoardSave`: imagen de arrastre, línea azul, placeholder punteado, movimiento optimista y guardado tras 1,6 segundos sin otro cambio. La línea indica el destino del drop; no introduce orden manual persistente entre tarjetas. Oportunidades ofrece cambio de etapa por arrastre o menú accesible de la tarjeta, sin selector visible permanente; exige resultado al finalizar y confirma versiones mediante la RPC versionada `save_opportunity_v2`. La lectura y el feedback compacto superior no desmontan el tablero. El ícono adapta la referencia aprobada de maletín con alas superpuestas, sin cambiar otros iconos. Usa un editor compartido desde el tablero o una Prioridad; la entrada desde ficha de contacto está diferida. Contactos usa búsqueda con selección múltiple, Interacciones depende de los contactos vinculados y advierte antes de retirar asociaciones incompatibles, y Prioridades reutiliza el selector de la ficha de Contactos. No añade navegación global ni modifica el tutorial. El owner confirmó smoke funcional y visual DEV satisfactorio; esta validación no implica promoción PROD.

Cuenta separa `Importar datos` de `Sincronización automática`. La importación manual o histórica se organiza en tres bloques compactos para Contactos, Citas y Correos; en desktop comparten una cuadrícula de tres columnas y en mobile se apilan. Las acciones usan botones de icono con nombre accesible y los proveedores mantienen logos, contenedores y alineación homogéneos. Google se autoriza desde la acción concreta de importar Contacts, seleccionar correos históricos o activar los toggles Gmail/Calendar; no existe un CTA principal separado para vincular el proveedor. El histórico Gmail se abre desde `Seleccionar correos` en un diálogo y permanece independiente del toggle. La sincronización automática agrupa bajo Google únicamente Calendar y Gmail, las capacidades reales vigentes; `.ics`, Apple Contacts y Microsoft Contacts se mantienen como opciones futuras.

El candidato local de Objetivos coordina ciclo, Prioridades y Oportunidades en una sola carga inicial; la lectura opcional de avisos no bloquea esa presentación. El tutorial conserva su Coach y no carga Oportunidades. Las relecturas posteriores mantienen el contenido montado: guardar una tarjeta no vuelve al estado inicial ni atenúa las demás. El toolbar existente muestra operaciones pendientes, éxito confirmado durante 1,8 segundos y errores persistentes con reintento de lectura. Un fallo de reconciliación conserva las tarjetas sin anunciar éxito ni interpretar el fallo como una lista vacía; el contexto y las versiones siguen validándose antes de escribir.

## Responsive y accesibilidad observable

El responsive se resuelve con media queries en `components.css`, principalmente en 780px, 760px, 920px y 1120px, más un container query para Coach compacto.

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

No existe catálogo formal de componentes ni pruebas visuales automatizadas observadas.

No todos los botones usan `Button`; algunos componentes usan `button` directo por necesidades locales.

No todos los mensajes de error, éxito, loading y empty state pasan por una primitive común.

Los tokens cubren colores, radios y sombras, pero no todo el lenguaje visual.

La UI está suficientemente ordenada para documentar patrones reutilizables, pero todavía no corresponde describirla como un design system completo.
