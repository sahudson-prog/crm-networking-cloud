# UI-STRUCT-02 y BF-12: operación y revisión local

## Alcance implementado

Shell compartido en el layout de Next.js, conservando AuthGate y los providers existentes. Header con marca, ActivitySyncButton original, Coach expandido y Cuenta. Navegación única Inicio / Producir / Planificar / Más; mobile utiliza los mismos destinos en la barra inferior. Onboarding conserva su composición previa.

La búsqueda global abre la ficha existente; no filtra indicadores. La lectura de contactos y pendientes es paginada y usa RLS/lectores existentes. Se refresca después del Sync Calendar, después de acciones del Coach y al abrir búsqueda/filtros/Coach si la lectura tiene más de diez segundos. Son lecturas, no Sync. Los detalles de interacciones del Coach se leen al abrirlo. No se ejecutan acciones automáticamente.

Los filtros tienen un único catálogo visual. Conservan estados independientes, sin selector de alcance:

- Contactos: Foco, Headhunter, Estado, Prioridades y texto afectan Contactos y Empresas; no Referidos.
- Producir: afectan Estados de networking; no Oportunidades ni Últimas interacciones.
- Planificar: Foco=Sí obligatorio, Headhunter y Prioridades afectan el resumen y empresas headhunter; el texto afecta solo empresas. Estado se muestra deshabilitado porque no existe ese efecto en el contrato previo.
- Inicio, Objetivos, Cuenta, Sistema y ficha: catálogo visible deshabilitado, con explicación. Los indicadores de Inicio ignoran filtros globales. BF-06B conserva un selector Headhunter propio y Agrupar Headhunters.

Los filtros internos de tablas/tableros permanecen en sus componentes. No se han unificado funcionalmente los filtros ni se han restaurado barras inferiores.

## BF-12: fuente pública y configuración de runtime

La fuente pública autorizada se verificó mediante GET el 2026-11-11 y se configuró posteriormente en memoria en el runtime candidato DEV de localhost:3002, con autorización explícita. No se versiona la URL ni se modifica la hoja. Esta configuración debe restaurarse explícitamente si se recrea el proceso. La aplicación sin variable sigue mostrando «Sin novedades por ahora». Los fixtures `cloud/web/tests/fixtures/editorial.csv` se utilizan exclusivamente en pruebas; nunca se representan como noticias reales del runtime.

`GET /api/editorial` lee una única variable **de servidor**, `COFFEECITO_EDITORIAL_CSV_URL`. No añadir prefijo NEXT_PUBLIC. No recibe URLs por parámetros ni desde las celdas. No usa OAuth, cookies, tokens, service accounts o el conector Calendar. La respuesta contiene solamente slides sanitizados, sin datos de sesión.

La caché de lectura servidor usa `unstable_cache` de la versión Next.js instalada, con revalidación cada 900 segundos. Incluye resultados de error para no reintentar por usuario o slide. La vigencia se evalúa fuera de esa caché. El cliente comparte la respuesta durante 60 segundos dentro de la sesión del shell. La propagación no es instantánea: depende también de la publicación de Sheets y de la revalidación del servidor.

Límites: respuesta 512 KiB, 500 filas, 64.000 bytes por HTML, 80.000 caracteres por registro CSV, 30 slides activos, timeout de 5 segundos. Solo HTTPS, host exacto `docs.google.com`, ruta publicada `/spreadsheets/d/e/<id>/pub`, `output=csv` y parámetros opcionales `gid`/`single`. Sin credenciales en URL, puertos alternativos ni fragmentos. Se permite como máximo **una redirección manual** desde la URL inicial validada al host exacto `doc-0s-34-sheets.googleusercontent.com`, observado en el GET autorizado (307 → 200 CSV). Se exige HTTPS, ruta `/pub/<segmento>/<segmento>/<número>/<número>/*/e@<id>` con el mismo id de publicación y los mismos parámetros CSV, sin parámetros duplicados. No se acepta el host de descarga como URL inicial ni otros shards, sufijos genéricos, destinos arbitrarios, credenciales, puertos alternativos o fragmentos. El plazo de 5 segundos es único para ambos GET y la lectura del cuerpo; no se reenvían cookies ni headers de autenticación. Los destinos temporales recibidos en Location no deben configurarse ni guardarse como fuente: se obtienen nuevamente desde la URL publicada. Si Google cambia de host o formato, fallar cerrado y verificarlo antes de ampliar la allowlist. Error de fuente y ausencia de publicaciones tienen respaldo distinto. Las filas inválidas producen diagnóstico numérico seguro, sin contenido en logs.

## Procedimiento de configuración manual por ambiente

1. Con autorización separada, crear una hoja exclusivamente editorial, sin datos privados. Publicar solo la pestaña destinada al feed como CSV. La hoja publicada es pública fuera de Coffeecito.
2. Crear las cabeceras `id,orden,activo,fecha_inicio,fecha_fin,contenido_html,roles_permitidos`. Se reconocen por nombre, no posición. No duplicar cabeceras.
3. Formatear las celdas de contenido como **texto plano antes de pegar** HTML/CSS generado con IA. No usar fórmulas, IMPORTXML o fórmulas de acceso externo. Comprobar el CSV publicado: Sheets debe escapar comillas, comas y saltos de línea. No escribir escapes CSV manualmente dentro de la celda.
4. `id`: texto único estable, máximo 100 caracteres; todas las filas con un id duplicado se excluyen. `orden`: entero, menor primero; empate por id. `activo`: Sí/Si/TRUE y No/FALSE, sin distinción de mayúsculas. Otras representaciones se excluyen.
5. Fechas opcionales vacías o UTC ISO `YYYY-MM-DDTHH:mm:ssZ`, también con milisegundos `.sssZ`. Ambos extremos son inclusivos; inicio posterior al fin es inválido. No usar hora local sin zona. El reloj del servidor decide vigencia.
6. `roles_permitidos` queda reservado, preferentemente vacío. **No concede privacidad ni restringe contenido en V1**, incluso si contiene `admin`.
7. Obtener y validar manualmente la URL publicada; comprobar host, formato, límites, ausencia de secretos y redirects. Configurar la variable de servidor solo en el ambiente autorizado. No copiar `.env` de otros worktrees ni versionar configuraciones.
8. Reiniciar o desplegar solo el runtime autorizado si cambió la variable. Las posteriores ediciones de filas no requieren deployment, sujetas a caché/publicación.
9. Revisar 0/1/N slides, error, vigencia, enlaces y legibilidad en mobile. No declarar el feed conectado hasta completar esa comprobación con la URL real.

**Requisito futuro de configuración PROD:** requiere aprobación separada de cutover. No hay cambio SQL, migración, RLS, Auth ni transformación de datos. Compatible con ausencia de variable; rollback editorial: retirar la variable y volver al respaldo o desactivar filas, según autorización. No requiere backup/mantenimiento de DB por esta configuración; conservar una copia editorial antes de modificar la hoja. No se ha aplicado ningún cambio PROD.

## Contenido permitido y reglas para generar slides con IA

HTML semántico de títulos, párrafos, listas, énfasis, enlaces y SVG inline simple. La composición no utiliza plantillas cerradas. CSS en `<style>` o atributos `style`; colores, fondos sólidos/gradientes, tipografía del sistema, Flex/Grid y espaciado permitidos. Usar `main` o `body` para pintar todo el fondo editorial. Sin sub-card obligatoria ni footer externo.

`sanitize-html` aplica allowlists de etiquetas/atributos; PostCSS, ya existente en el lockfile y ahora dependencia directa, analiza/reconstruye CSS permitido. No se añadió otro parser CSS. Se descartan at-rules (incluidos @import, @font-face y @media), referencias url(), variables CSS, escapes, funciones desconocidas, posicionamiento fijo/absoluto y propiedades fuera de la allowlist. Usar layout fluido y clamp() para responsive. SVG admite formas simples; no scripts, use, foreignObject, imágenes, animaciones o referencias externas. El visor impone wrapping y ancho máximo; contenido largo puede desplazarse verticalmente.

Cada slide usa iframe `srcdoc` con origen opaco, sin allow-scripts/allow-same-origin. CSP niega scripts, imágenes, fonts, conexiones, formularios, objetos, frames y base URI; solo permite los estilos inline sanitizados. Los enlaces explícitos HTTPS se abren en pestaña separada con noopener/noreferrer y los permisos sandbox de popups; se rechazan esquemas peligrosos, credenciales, rutas Auth/OAuth y parámetros sensibles. No hay recursos externos automáticos ni acceso al documento/sesión del padre.

Dimensiones orientativas: viewport editorial aproximadamente 280–600 px de ancho. Desde 1024 px, Información y novedades e Indicadores de avance comparten proporción exterior 4:3 y límite de 480 px; el iframe ocupa el espacio restante bajo el encabezado. En tablet el visor conserva 340 px y en mobile 360 px, sin imponer 4:3. La vista compacta es una presentación inerte (`pointer-events: none`, `inert`), con documento interno acotado y `overflow: clip`: no hay scroll vertical interno ni barra de scroll. En mobile, los gestos verticales desplazan Inicio y los horizontales cambian de slide. El contenido largo y los enlaces se leen mediante «Ver más» en un modal con iframe interactivo. No fijar anchos mínimos. Texto de 16 px o más, títulos fluidos, contraste legible; evitar ilustraciones de altura gigantesca. Reservar al menos 60 px inferiores para flechas/«Ver más» superpuestos y no poner enlaces esenciales en esas esquinas. El marco ya proporciona ese padding inferior. Revisar 1440, 768, 390, 375 y 320 px; revisar todo el texto mediante el scroll del modal cuando exceda el viewport compacto.

## Interacción del slideshow BF-12

Conserva Swiper, A11y, Keyboard y Autoplay: transición transform de 420 ms, autoplay 7000 ms, loop desde dos slides, `simulateTouch`, `grabCursor`, `disableOnInteraction: false` y `pauseOnMouseEnter: true`. El tracker visual ahora tiene segmentos iguales, separación 5 px, anteriores completos y progreso del activo en Terracotta. `realIndex` y `autoplayTimeLeft` son la única fuente de página/tiempo; no hay timers paralelos ni Pagination adicional.

No hay botón Play/Pause. Hover, contacto táctil, foco de teclado, pestaña oculta y modal pausan el motor mediante la API de Swiper y congelan el progreso. Al terminar hover/foco/touch se reanuda el tiempo restante; navegar manualmente y cerrar el modal reinician los siete segundos cuando ninguna otra condición mantiene la pausa. Movimiento reducido desactiva autoplay y transición. Cero/uno conservan sus tratamientos previos.

«Ver más» es un botón semántico de apariencia textual: Espresso, peso 650, área de 44 px, sin clases de botón compartidas, fondo, borde, sombra, transform, translate ni transición. Hover solo subraya; `:focus-visible` conserva outline. Se centra mediante márgenes y límites laterales, sin transformaciones.

Una máscara CSS se aplica exclusivamente al iframe compacto. Desvanecido en los últimos 100 px de desktop/tablet y 80 px de mobile (22% del visor de 360 px). Tracker y controles quedan fuera de la máscara; el modal no tiene desvanecido. No modifica el HTML de Sheets.

El iframe compacto inserta únicamente CSS fijo en el `<head>` del `srcdoc` ya sanitizado para acotar html/body/main y prohibir scroll real. No cambia el contenido editorial ni el scaffolding expandido. El modal usa `dialog.showModal()` nativo: no había un Dialog accesible compartido instalado. Muestra exactamente el mismo `srcdoc` sanitizado y sandbox opaco, con ancho máximo 760 px, alto 85dvh y margen mobile/safe areas. Único scroll editorial dentro del iframe, X y retorno a «Ver más». Escape funciona con foco en los controles del modal. **Limitación reproducida en Edge 157:** si el foco de teclado está en un enlace del iframe opaco, Escape no alcanza el diálogo del padre; X o Shift+Tab hasta el cierre y luego Escape permiten salir. El gate de Escape universal queda pendiente. No se relaja el sandbox ni se inyectan scripts para sortearlo. La pausa por foco de teclado tiene prioridad sobre el reinicio del autoplay. No cambia sanitización, CSP, lector, caché ni endpoint. Solo el CSS fijo del scaffolding de `editorialDocument` añade scroll raíz vertical y contención a html/body, conservando un único documento desplazable.

El scroll de fondo se bloquea reutilizando `useBodyScrollLock`, ya utilizado por los diálogos de contactos, sin modificar ese hook. Se conserva `dialog.showModal()`, contención en dialog/backdrop y `scrollbar-gutter: stable` limitado al modal abierto solo si la scrollbar ya ocupaba ancho antes de abrirlo (sin reservar espacio artificial para scrollbars superpuestas) para evitar layout shift. Antes de la corrección, wheel al borde del iframe desplazó Inicio de 1317 a 717 px; después, wheel/touch desplazan el documento editorial y conservan exactamente la posición/ancho del padre, también al cerrar.

Prueba focal reutilizando el harness de shell y un contexto headless vacío:

```powershell
node --experimental-strip-types cloud/web/tests/local/shell-browser.mjs --editorial-slideshow-only
```

Añadir `--real-editorial` únicamente con el runtime candidato y la fuente pública autorizados: lee el endpoint local 3002 una vez y usa su respuesta sanitizada en el Home sintético, sin sesión ni llamadas de datos privados. Las capturas y mediciones quedan en el directorio temporal que informa el harness. No equivale a smoke autenticado DEV. Incluye comparación con el componente real de onboarding, mouse/touch, tiempos, loop, pausa, segmentos, máscara, modal, foco, wheel/touch reales en los bordes y viewports 1440/768/390/375/320. Se puede añadir `--layout-only` para continuar únicamente las comprobaciones visuales/scroll sin repetir tiempos ya aprobados. Escape dentro de enlace opaco se informa separadamente como limitación; no se declara PASS de ese caso. La política de visibilidad se prueba con un evento sintético; dispositivos físicos y lectores de pantalla requieren revisión manual.

## Validación y revisión manual

Pruebas sintéticas: `tests/editorial.test.ts`, `tests/structuralViews.test.mjs`, `tests/onboarding.test.ts`, `tests/coachShell.test.ts`, `tests/local/shell-browser.mjs` y el modo UI_STRUCT_ONLY de `tests/local/status-boards-browser.cjs`. El harness local del shell usa datos ficticios, Edge limpio, rutas interceptadas y transporte Supabase nulo; un enlace HTTPS explícito se simula sin conectarse. No sustituye el smoke autenticado.

Smoke manual en el candidato `http://localhost:3002`:

1. Inicio → Producir → Planificar → Más/Contactos → Más/Objetivos; comprobar títulos, bloques, barra activa, contexto y volver atrás.
2. Buscar un contacto sintético y abrir ficha; abrir/cerrar filtros y verificar la explicación de alcance real. Cambiar BF-06B entre Todos/Sí/No sin alterar la pirámide.
3. Abrir Coach global y contextual; contador total, configuración/historial, cierre sin desplazar bloques. Ejecutar/descartar solo por el usuario con autorización de datos correspondiente.
4. Cuenta: Configuración, Invitar existente, Sistema solo con capacidad efectiva y logout existente. No conceder permisos nuevos.
5. Abrir el popup Sync original, comprobar su contenido sin ejecutarlo automáticamente. Las pruebas de un clic y segundo clic de Calendar requieren acción manual/autorización DEV; no se repiten por cuenta del agente.
6. Revisar mobile/tablet, teclado, Escape, menús, safe area, fichas y BF-11. BF-12 muestra la fuente configurada en el proceso; sin variable muestra el respaldo.

No se han modificado ActivitySyncButton, coordinador Calendar, OAuth, permisos, escritores o contratos persistentes. La validación sintética no certifica funcionamiento remoto ni nuevas operaciones Calendar.

## Archivos de esta entrega local

- `cloud/web/app/api/editorial/route.ts`
- `cloud/web/app/contactos/page.tsx`
- `cloud/web/app/cuenta/page.tsx`
- `cloud/web/app/dashboard/page.tsx`
- `cloud/web/app/globals.css`
- `cloud/web/app/layout.tsx`
- `cloud/web/app/objetivos/page.tsx`
- `cloud/web/app/page.tsx`
- `cloud/web/app/planificar/page.tsx`
- `cloud/web/app/registrar-avances/page.tsx`
- `cloud/web/app/sistema/diseno/page.tsx`
- `cloud/web/app/sistema/headhunters/page.tsx`
- `cloud/web/app/sistema/logs/page.tsx`
- `cloud/web/app/sistema/mantencion/page.tsx`
- `cloud/web/app/sistema/page.tsx`
- `cloud/web/app/sistema/solicitudes/page.tsx`
- `cloud/web/components/ApplicationFrame.tsx`
- `cloud/web/components/ApplicationShellContent.tsx`
- `cloud/web/components/CoachPreview.tsx`
- `cloud/web/components/ContactFilterControls.tsx`
- `cloud/web/components/ContactProfile.tsx`
- `cloud/web/components/ContactTable.tsx`
- `cloud/web/components/EditorialFeed.tsx`
- `cloud/web/components/InvitationButton.tsx`
- `cloud/web/components/OnboardingNavigation.tsx`
- `cloud/web/components/ReadOnlyDashboard.tsx`
- `cloud/web/components/Shell.tsx`
- `cloud/web/components/ShellChrome.tsx`
- `cloud/web/components/ShellToolbar.tsx`
- `cloud/web/components/TrackingView.tsx`
- `cloud/web/components/WorkspaceNavigation.tsx`
- `cloud/web/components/WorkspaceState.tsx`
- `cloud/web/lib/editorial.ts`
- `cloud/web/lib/workspaceRead.ts`
- `cloud/web/package-lock.json`
- `cloud/web/package.json`
- `cloud/web/styles/shell.css`
- `cloud/web/tests/brandBeta.test.ts`
- `cloud/web/tests/coachShell.test.ts`
- `cloud/web/tests/editorial.test.ts`
- `cloud/web/tests/fixtures/editorial.csv`
- `cloud/web/tests/local/shell-browser.mjs`
- `cloud/web/tests/local/status-boards-browser.cjs`
- `cloud/web/tests/onboarding.test.ts`
- `cloud/web/tests/structuralViews.test.mjs`
- `docs/UI_STRUCT_02_BF12.md`

Validación local: 119 tests focales PASS; refuerzo posterior de enlaces codificados 7/7 PASS; typecheck y build Webpack aislado PASS. Smoke del shell/BF-12 sintético PASS en 1440/768/390/375/320. BF-11/tableros: smoke sintético UI_STRUCT_ONLY PASS. Sin smoke remoto ejecutado.
