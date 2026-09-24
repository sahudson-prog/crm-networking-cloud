# Sistema de UI

## Estado actual

La UI vigente de CRM Networking cloud está construida en `cloud/web` con Next.js, React y TypeScript. El styling se apoya principalmente en CSS global: `app/globals.css` importa `styles/tokens.css` y `styles/components.css`.

No existe un design system formal completo. Sí existe una base visual compartida con variables CSS, clases reutilizadas y algunas primitives React. La implementación combina patrones comunes con estilos específicos por módulo.

La app usa una estética sobria: fondo gris claro, paneles blancos, bordes suaves, radio bajo, sombras contenidas, texto oscuro y acentos azules/verdes/rojos/naranjos según acción o estado.

La fuente visual es Inter con fallback a fuentes del sistema.

La iconografía no depende de una librería externa. `components/ui/Icon.tsx` define un set propio de iconos SVG lineales. `components/ui/ProviderIcon.tsx` contiene iconografía de proveedores presente en la UI; la existencia de un icono no implica que el conector correspondiente esté implementado.

## Tokens y estilos base

`styles/tokens.css` define tokens reales para colores principales, superficies, bordes, texto, estados, radios y sombras.

Los tokens de color reutilizados incluyen `--crm-bg`, `--crm-surface`, `--crm-border`, `--crm-text`, `--crm-muted`, `--crm-empty-value`, `--crm-primary`, `--crm-accent`, `--crm-positive`, `--crm-danger` y `--crm-warning`.

Los estados de networking tienen colores y fondos suaves dedicados: Pendiente, Contactado, Agendado, Cita concretada y Agradecimiento enviado.

Existen tokens de radio y sombra: `--crm-radius`, `--crm-radius-sm`, `--crm-shadow-soft` y `--crm-shadow-panel`.

No se observó un sistema formal de spacing, tipografía, widths o breakpoints como tokens completos. Esos valores aparecen principalmente como reglas CSS repetidas o específicas de componente.

## Layout y navegación

El shell principal vive en `components/Shell.tsx`. Usa `.app-shell` como contenedor centrado, con ancho máximo de 1220px y margen horizontal responsive.

La cabecera separa navegación principal y acciones secundarias. Dashboard, Contactos y Objetivos aparecen como navegación principal con texto e icono. Cuenta y actualización global aparecen como acciones compactas a la derecha. Sistema se incorpora a esas acciones solo cuando el usuario tiene al menos una capability administrativa efectiva para diagnóstico, gestión de accesos o maestros globales.

Las vistas se organizan con `Panel`, grids y toolbars. El patrón visual más estable es panel blanco con borde, header compacto, título de 16px y contenido interno ordenado por grid o listas.

Dashboard y Contactos comparten `ContactFilterControls` sobre el contenido principal. El filtro incluye buscador universal, selectores de Foco y Headhunter, botón de más filtros, estados seleccionables y objetivos como chips.

## Primitives compartidas

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

Las listas de interacciones usan `InteractionTimelineList`, basado en `details/summary`. Se reutiliza en ficha de contacto y Dashboard, con variante para mostrar contexto de contactos.

Objetivos usa bloques por tipo, filas seleccionables, acciones contextuales visibles al seleccionar y estrellas para prioridad.

## Dialogs y feedback

El patrón modal compartido usa `.modal-backdrop` y `.modal-card`, con header, cuerpo y footer de acciones. Los diálogos se adaptan por clases específicas como editor de contacto, editor de interacción, preview de sync o fusión de contactos.

Los botones principales suelen ir a la derecha del footer, con acción primaria oscura. Las acciones destructivas usan tono rojo cuando están implementadas como botón o texto de advertencia.

Algunas confirmaciones usan `window.confirm`; otras usan modal propio. No hay una primitive única para confirmación destructiva.

El feedback aparece como texto inline, franja dentro de panel, mensaje de modal o barra de progreso según componente. Hay patrones compartidos, pero no un sistema único centralizado de notificaciones.

## Sync y fusión

`SyncPreviewDialog` es el patrón visual principal para revisar cambios antes de aplicar. Muestra tabs, conteos, tarjetas seleccionables, descripción por sección, botón de edición de datos, footer con resumen de selección y progreso opcional.

La edición de datos dentro del preview reutiliza `ContactMergeDialog` y `ContactMergeWorkspace`. Visualmente compara fuentes, deja construir un resultante y vuelve al preview sin guardar hasta aplicar selección.

La lógica de matching, cursores, precedencia y persistencia no pertenece a este documento.

## Coach

`CoachPreview` y `CoachModule` presentan sugerencias como burbujas compactas junto a una mascota visual. Permiten seleccionar sugerencias, ejecutar, descartar, buscar nuevas sugerencias y abrir configuración o historial.

En Dashboard puede mostrar sugerencias agrupadas o detalladas. En ficha de contacto aparece en variante mini y filtra al contacto actual.

Las burbujas usan `details/summary`, fecha visible, texto compacto, vínculos al contacto y checkbox externo. La semántica de reglas no pertenece a este documento.

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
