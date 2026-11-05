# UX-ONB-COPY-01 - Revisión editorial del tutorial

## Estado y objetivo

- Status: `CANDIDATE APPROVED BY OWNER / PENDING BETA UX V1 INTEGRATION`. Copy definitivo y presentación visual en DEV aprobados por el owner; no desplegada en PROD. Candidata exclusivamente a Beta UX V1 junto con BRAND-BETA-01 y UX-DATE-01, no a una release independiente.
- Reducir considerablemente la extensión y densidad del texto de todo el onboarding/tutorial, con mayor claridad, jerarquía, formato editorial y legibilidad.

## Decisiones aprobadas

- Lenguaje cercano, natural y confiable, tomando como referencia el estilo comunicacional de Fintual sin copiar textos; mensajes breves, concretos y orientados a acciones y beneficios.
- Cubrir introducción, pasos guiados, mensajes del Coach en onboarding, instrucciones y cierre.
- Conservar mecánicas, secuencia, número de pasos, navegación, transiciones, validaciones, persistencia y obligaciones del onboarding.
- No extender esta revisión al resto de la aplicación; eso pertenece a UX-COPY-01.

## Copy exacto aprobado

### Marco común (sin cambios)

**Simplifica y ordena tu networking.**

Organiza tu red, mantén visibles tus relaciones y pendientes, y enfócate en las conversaciones que importan

### Intro 1

**Hay un diamante en bruto en tu red.**

Tus contactos pueden ser el punto de partida de tu próximo trabajo, negocio o marca profesional. El networking te ayuda a descubrir y desarrollar ese potencial. Coffeecito está para acompañarte en ese camino.

### Intro 2

**Una red bien cultivada abre oportunidades.**

- **Encontrar tu próximo trabajo:** enterarte de oportunidades laborales y conectar con quienes pueden recomendarte.
- **Generar nuevos negocios:** acercarte a nuevos clientes y aliados.
- **Fortalecer tu posicionamiento:** compartir lo que haces y ampliar tu alcance profesional.

### Intro 3

**Que organizar tu red no te quite tiempo para conectar.**

Coffeecito reúne tus contactos, conversaciones y pendientes para que no tengas que llevar todo en la cabeza.

Así puedes dedicar menos tiempo a ordenar información y más a saber con quién hablar y dar el siguiente paso.

### Intro 4 (sin cambios)

**Coffeecito se encarga de la gestión. Tú del café y la conversación.**

Botón: **Empecemos**.

### Paso 1

**Cuéntame de ti.**

¿Cómo te llamas y cuál es tu situación profesional? Con estos datos podremos personalizar tu experiencia. Puedes actualizarlos después en Cuenta.

### Paso 2

**Define tu objetivo y tus prioridades.**

Define tu objetivo de networking y establece las prioridades que te interesa perseguir. Esto te ayudará a enfocar tus conversaciones y encontrar oportunidades que tengan sentido para ti.

### Paso 3

**Comienza con tus contactos.**

Puedes importar tus contactos desde un archivo vCard o crearlos uno a uno en Coffeecito. Aquí puedes ver cómo exportar contactos desde Google o desde Apple.

### Paso 4

**Tu red, organizada a tu manera.**

Aquí administras tus contactos: eliges a quiénes poner en foco para hacer networking, actualizas su estado de avance y marcas a los headhunters para agruparlos por consultora.

### Paso 5

**La historia de cada contacto.**

Cada contacto tiene una ficha donde puedes editar sus datos y registrar mensajes, citas, correos o llamadas, con notas y minutas. También podrás anotar contactos referidos para darles seguimiento y seguir ampliando tu red.

### Paso 6

**Ya puedes empezar.**

Ahora ya conoces las funciones básicas para avanzar. Yo te acompañaré con sugerencias para mantener tu red ordenada y al día.

Botón: **Ir a Contactos**. Conserva el guardado de finalización antes de navegar.

## Formato y mensajes auxiliares

- Cuatro slides, seis pasos y condición existente de omisión de ficha sin contactos intactos.
- Intro 2 usa una lista vertical semántica de tres beneficios sin tarjetas. Intro 3 conserva dos párrafos, sin las cinco preguntas anteriores.
- Se preservan fuentes, tamaños y composición; los controles de replay pueden envolver a otra línea para evitar overflow a 320 px.
- `Atrás` pasa a `Anterior` solo en Coach onboarding; `Salir` pasa a `Salir del tutorial` solo en el recorrido/replay.
- `Preparando recorrido...` pasa a `Preparando tu tutorial...` en la ruta del tutorial, sin cambiar el loading compartido de Shell.
- En `StartingPointFields`, solo modo onboarding: `Cargando tu punto de partida...` pasa a `Cargando tus datos...`; `Tu punto de partida quedó guardado.` pasa a `Datos guardados.`. Cuenta conserva sus mensajes.
- Errores del recorrido: `No pudimos cargar tu avance. Vuelve a intentarlo.`, `No pudimos guardar tu avance. Vuelve a intentarlo.` y `No pudimos continuar desde este paso.`. No cambian los disparadores ni la recuperación.

## Exclusiones, dependencias y gates

- No se implementa el diálogo de ayuda de importación, pestañas ni enlaces externos. Se excluye expresamente la frase `Te explicamos aquí cómo obtener el archivo.`.
- Pendiente separado: preparar un instructivo para exportar contactos desde Google y Apple. La frase aprobada `Aquí puedes ver cómo exportar contactos desde Google o desde Apple.` es solo texto en esta entrega; no hay enlace, popup ni control sin destino.
- No se oculta ni modifica la cabecera, sus botones, utilidades o enlaces. No se modifica BRAND-BETA-01.
- El candidato COPY independiente conservaba la fecha. En la integración Beta UX V1, UX-DATE-01 retira el campo redundante sin sustituir el copy aprobado; la fecha única se configura en Objetivos. La release sigue siendo conjunta.
- No se cambian mensajes operativos compartidos fuera del onboarding, Auth, SQL, permisos, importadores ni navegación. Las modalidades futuras continúan sin habilitarse.
- Gate local: tests focales, typecheck, build, diff-check y comparación sintética antes/después a 320, 375, 390 px y desktop. La evidencia sintética no certifica un first-run autenticado real.
- Validación local del candidato: typecheck y build estándar PASS. Comparación en navegador de las cuatro intros y seis burbujas reales a 320, 375, 390 y 1440 px, sin overflow horizontal editorial; navegación y cierre con fixtures sintéticas PASS. El fixture `cloud/web/tests/local/onboarding-copy-preview.cjs` usa componentes y estilos reales, pero sustituye Auth, persistencia y cuerpos operativos: no certifica el layout completo de Contactos, Cuenta ni la cabecera autenticada. No accede a datos reales ni servicios remotos.
- Aprobación reportada por el owner: textos definitivos y presentación visual del tutorial real conectado a DEV. La comparación sintética y sus límites de certificación se distinguen de esa aprobación.
- Pendientes: integración conjunta Beta UX V1, resolución de UX-DATE-01, instructivo de exportación de contactos y gates de release. La publicación de esta branch no autoriza PR, merge ni deployment independiente.
- Fuera de alcance: altura mínima existente de slides y fallo de lectura de ficha sin reintento dedicado; no se reparan mecanismos del tutorial en esta entrega.
