# UI style guide

Guia viva para decisiones visuales reutilizables. La referencia visual real esta dentro de la app, oculta del menu principal:

[Abrir anexo visual en la app](http://localhost:8501/?page=iconos)

[Abrir anexo visual cloud](http://localhost:3000/sistema/diseno)

## Principio

- Crear componentes reutilizables antes de repetir estilos por vista.
- Separar claramente iconos de tipo, botones de accion y estados.
- Los ejemplos de esta guia deben reflejarse en codigo real, no solo en texto.
- La futura app cloud debe partir desde estos tokens y componentes. No replicar vistas con estilos hardcodeados si el patron ya existe aqui.
- Si aparece una necesidad visual nueva, primero definir token/componente y luego usarlo en la vista.
- Cada componente nuevo o ajustado debe probarse en desktop y en ancho mobile. Mobile no es una app distinta en el MVP: es la misma web responsive/PWA vista en pantalla chica.
- En replicas cloud de vistas existentes, la primera meta es paridad visual y funcional con la app local o maqueta aprobada. Cualquier mejora debe hacerse despues de comparar: ubicacion, tamanos, tipografia, colores, leyendas, iconos, densidad, formato de fechas, textos y comportamiento.

## Graficos KPI

Referencia visual vigente: bloque KPI del Dashboard local.

- Selector de periodo alineado a la izquierda, con etiqueta `Periodo KPI`.
- Tarjetas con titulo corto, acumulado grande y grafico compacto.
- Linea de totales delgada, color azul/gris sobrio, con puntos y valores visibles.
- Barras de primera vez en gris claro, mas gruesas que la linea; el valor va dentro si cabe o arriba si la barra es pequena.
- Eje X mensual en formato `mar 26`; eje X semanal puede usar fecha corta de inicio de semana.
- Leyenda con simbolo de linea y simbolo de barra, no solo texto.
- Debajo de cada grafico mostrar variacion contra periodo anterior: `vs mes anterior` o `vs semana anterior`.
- En responsive, las tarjetas/graficos KPI no deben crecer al pasar a una columna. Deben mantener ancho compacto maximo, quedar en una linea cuando caben tres tarjetas y reacomodarse; solo se achican cuando el contenedor es menor al ancho maximo.

## Responsive web/mobile

Objetivo: que la app se pueda usar bien desde navegador mobile sin mantener una app nativa separada.

Reglas:

- Los botones secundarios no deben expandirse automaticamente a todo el ancho en mobile. Usar botones compactos, grupos de iconos, menus o acciones contextuales.
- Una accion principal puede usar ancho completo solo si realmente es la accion dominante de la pantalla.
- Las toolbars deben poder hacer wrap ordenado o pasar a menu compacto sin apilar texto innecesario.
- Las tablas densas deben tener alternativa mobile: columnas minimas, cards, filas expandibles o scroll horizontal controlado.
- Filtros y acciones deben mantenerse cerca del objeto que afectan, pero sin empujar el contenido principal fuera del primer viewport.
- Probar al menos dos anchos: desktop comun y mobile angosto. Revisar que no haya solapes, botones gigantes, textos cortados sin sentido ni scroll horizontal accidental.

## Tipografia

| Uso | Tamano | Peso |
|---|---:|---:|
| Nombre o titulo principal de ficha | 30px | 780 |
| Subtitulo de ficha | 15px | 400 |
| Titulo de bloque o panel | 16px | 800 |
| Texto principal, links, valores, selectores y titulos de filas | 14px | Segun contexto |
| Preview o texto secundario de listas | 13px | 520 |
| Metadata, fechas, estados, notas breves y botones compactos | 12px | 720-760 |
| Labels pequenos en uppercase | 11.2px | 800 |

## Texto de dato vacio

Nombre oficial: `empty-value`.

Usar `empty-value` para cualquier texto que represente ausencia de dato o contenido auxiliar tenue: `sin datos`, `sin correos`, `sin telefonos`, `Sin empresa`, `Sin cargo`, placeholders de campos editables y previews secundarios como el preview de una interaccion colapsada.

En React, invocar este patron con el componente global `EmptyValue` desde `components/ui/EmptyValue.tsx`. Usar la clase `.empty-value` solo cuando el componente no aplique, por ejemplo en placeholders nativos.

Formato oficial:

- Color: `--crm-empty-value`.
- Estilo: cursiva.
- Peso: 400, sin negrita.
- Tamano: hereda el tamano del contexto, salvo que el componente tenga un tamano definido por layout.

No usar `empty-value` para etiquetas de campos, datos reales, estados, links o acciones.

## Iconos circulares de tipo de interaccion

Estos iconos identifican el canal real de la interaccion. No son botones de accion.

| Tipo | Icono | Color |
|---|---|---|
| Correo | Sobre lineal SVG | Gris muy suave |
| Cita / reunion | Calendario lineal SVG | Azul claro |
| Mensaje | Globo de chat lineal SVG | Verde claro |
| Llamada | Telefono lineal SVG | Amarillo suave |

Una interaccion cargada manualmente debe elegir uno de estos tipos. `Manual` es origen o forma de carga, no un tipo visual propio.

## Indicadores informativos de interaccion

Estos indicadores explican contexto de una fila. No son botones y no ejecutan acciones.

| Caso | Icono | Uso | Tooltip |
|---|---|---|---|
| Interaccion compartida | `users` | Se muestra cuando una interaccion tiene mas de un participante asociado | `Interaccion compartida con otros contactos.` y detalle por rol: `De`, `Para`, `CC`, `CCO` o `Sin rol` |
| Origen externo vinculado | Icono de proveedor | Se muestra cuando una interaccion app esta vinculada a Gmail, Calendar u otro proveedor | `Origen externo: SERVICIO`. Si existe URL, abre el origen; si no, queda deshabilitado y explica que el link directo aun no esta disponible |

El indicador compartido debe vivir junto al icono de tipo de interaccion, usando espacio fijo para no desalinear filas con y sin participantes multiples.

## Editor de interacciones

- Componente cloud actual: `InteractionEditorDialog`.
- Debe abrirse desde el lapiz de una interaccion existente para editar la minuta editable.
- Debe abrirse desde `+` para crear una interaccion manual asociada al contacto actual.
- La UI distingue tipo de canal (`Correo`, `Cita`, `Llamada`, `Mensaje`, `Nota manual`) y sentido (`Saliente`, `Entrante`, `Interno / nota`, `Sin definir`).
- El guardado debe pasar por `interactionActions.ts`; no crear guardados locales por vista.
- La fuente original de una interaccion importada no se edita desde este modal. El usuario edita `user_notes_raw`.

## Links inline de accion

Los links inline son acciones pequenas pegadas a un dato concreto. Ejemplos: sobre al lado de un correo, telefono al lado de un numero, WhatsApp al lado de un telefono.

- No reemplazan al boton cuadrado global.
- Se usan dentro de tarjetas de dato, filas compactas o campos concretos.
- Tamano actual: aproximadamente 29x26px.
- Clase actual: `.crm-contact-mini-link`.
- Iconos: deben reutilizar los mismos SVG lineales de tipo de interaccion cuando la accion corresponde al mismo canal.

## Botones de proveedor

Los botones de proveedor representan servicios conectados o disponibles para completar/sincronizar datos del contacto.

- Componente cloud actual: `ProviderButton`.
- Iconos actuales: `google`, `apple`, `microsoft`.
- Tamano: 28x28px, circular, con borde `--crm-border` y fondo `--crm-bg`.
- Estado activo: usa el icono oficial/similar de marca.
- Estado deshabilitado: misma forma, pero en gris/desaturado. No usar otra version local por vista.
- Siempre deben llevar `title`/tooltip con la accion concreta, por ejemplo `Completar desde Google`.
- En v1 cloud son placeholders deshabilitados hasta conectar la capa de proveedores.

## Preview de sincronizacion

- Componente cloud actual: `SyncPreviewDialog`.
- Sirve para contactos, mail, calendario y futuros proveedores. No debe estar amarrado a Google ni a una vista especifica.
- Debe mostrarse antes de aplicar cambios que vienen de una fuente externa.
- Debe agrupar cambios por tipo: `Nuevos`, `Modificaciones`, `Duplicados fusionables`, `Duplicados complejos`, `Eliminaciones` y `Sin cambios`.
- En sync de contactos, la agrupacion preferida es por pestanas: una para `Nuevos`, otra para `Modificaciones`, otra para `Duplicados fusionables`, otra para `Duplicados complejos`, otra para `Eliminaciones` y otra informativa para `Sin cambios`. Cada pestana accionable muestra el conteo de contactos afectados y seleccion/desmarcado de todos. El footer aplica en una sola accion la seleccion total de todas las pestanas.
- Las eliminaciones siempre van al final de los cambios accionables y con su propio set de acciones. No deben mezclarse visualmente con altas, enriquecimientos o enlaces de identidad.
- La accion `No eliminar ni volver a sugerir` queda pausada. Si se retoma, no debe vivir junto al boton principal de aplicar seleccion; debe tener una ubicacion separada y explicacion clara.
- El tipo de cambio se muestra como titulo de seccion, no como etiqueta repetida dentro de cada tarjeta.
- Cada cambio se muestra como tarjeta compacta seleccionable, no como tabla ancha.
- El titulo de cada tarjeta debe ser el objeto/contacto afectado, sin verbos de accion de la app como `Unificar Ricardo`.
- Dentro de cada tarjeta, los campos se muestran como lineas simples de texto, no como mini tarjetas por campo.
- El tipo de dato va en negrita gris.
- El tipo de cambio va en negrita por color: `agregar` en verde, `eliminar` en rojo y `coincide` en azul.
- El dato en si va en texto normal, sin color de enfasis ni negrita; `sin datos` va gris/cursiva.
- Los campos modificados usan `--crm-warning` solo para destacar datos concretos, no todo el renglon.
- `Modificaciones` puede mostrar reemplazos y eliminaciones no aplicados para transparencia, junto con agregados reales. `Duplicados fusionables` debe mostrar solo datos que se agregan al contacto guardado y campos que coinciden; no mostrar reemplazos ignorados ni eliminaciones.
- En cambios `Modificaciones` y `Duplicados fusionables`, mostrar solo campos cambiados o nexos relevantes; no listar datos que no cambiaron.
- En campos simples, usar formato `Campo antes --> despues`.
- En campos multivalor como correos o telefonos, evitar `sin datos --> nuevo correo` si no corresponde a reemplazo. Usar operaciones explicitas: `Correo agregar correo@dominio.com`, `Correo eliminar correo@dominio.com` o, solo si realmente se detecta reemplazo, `Correo antiguo@dominio.com --> nuevo@dominio.com`.
- En contactos completos `Nuevos` o `Eliminados`, no usar `agregar`/`eliminar` dentro de correos o telefonos; la seccion ya explica el tipo de cambio. Mostrar solo los datos existentes.
- En `Duplicados fusionables`, no mostrar IDs externos al usuario. Mostrar el atributo que justifica la propuesta con formato `Correo coincide --> smith@gmail.com`.
- Una accion de enlazar y combinar tambien puede traer modificaciones de datos. En ese caso se usa el mismo formato interno que `Modificaciones` y se agregan las lineas de coincidencia necesarias.
- En `Duplicados fusionables`, los campos simples existentes de la app tienen prioridad sobre el proveedor. Nombre, empresa y cargo solo deben completarse desde la fuente si la app esta vacia.
- La app es fuente principal del contacto. Si la app tiene un dato local y la fuente conectada viene vacia, eso no debe interpretarse automaticamente como eliminacion. El vacio de proveedor significa `sin dato en origen`, no orden de borrar.
- Para campos simples como nombre, empresa o cargo, ante `Modificaciones` y `Duplicados fusionables`: si la app esta vacia y la fuente trae dato, proponer enriquecimiento; si la app ya tiene dato, no reemplazarlo automaticamente aunque la fuente traiga un valor distinto; si la app tiene dato y la fuente no, no proponer eliminar por defecto. En `Modificaciones`, esos reemplazos o eliminaciones no aplicadas pueden mostrarse con `(no aplicado)` para que el usuario entienda la diferencia detectada.
- Para campos multivalor como correos y telefonos: proponer eliminar solo valores que fueron importados desde esa misma fuente y que desaparecieron de esa fuente. No eliminar datos manuales, enriquecidos por el usuario o provenientes de otra fuente.
- Los campos sin dato se muestran como `sin datos` en gris/cursiva.
- Para contactos nuevos o eliminados, mostrar solo campos con dato; no mostrar campos vacios.
- Los cambios vienen seleccionados por defecto salvo que sean bloqueantes.
- Si el usuario desmarca un cambio, no se aplica y queda pendiente para la proxima sincronizacion mientras siga existiendo la diferencia.
- Solo una accion explicita y separada debe registrar una supresion para que el cambio no reaparezca.
- Al aplicar una seleccion parcial con exito, los cambios aplicados deben desaparecer del preview actual sin volver a consultar el proveedor. Los cambios no seleccionados quedan visibles como pendientes. Si no quedan cambios accionables, el preview puede cerrarse.
- Si la aplicacion falla, el preview debe permanecer abierto con los cambios originales para no ocultar nada que no fue aplicado.
- El modal debe devolver los cambios seleccionados al flujo que lo invoco; no debe aplicar datos por si mismo.
- Cuando un cambio de `Nuevos`, `Modificaciones`, `Duplicados fusionables` o `Duplicados complejos` requiera revisar datos antes de aplicar, mostrar un boton compacto `Editar datos` justo despues del nombre del contacto, con icono oficial `edit`.
- `Modificaciones` debe mostrar la descripcion: `Por defecto, no pisaremos ningun dato del contacto guardado; solo completaremos campos faltantes. Puede editar la propuesta en "Editar datos".`
- `Duplicados fusionables` contiene solo grupos de 2 o 3 contactos origen en total y exactamente 1 contacto `Guardado`. La descripcion de la pestana debe decir: `Estos casos tienen 2 o 3 contactos duplicados con 1 contacto existente. Por defecto, no pisaremos ningun dato del contacto guardado; solo completaremos campos faltantes. Puede editar la propuesta en "Editar datos".`
- `Duplicados complejos` contiene grupos conectados por correo o telefono con 4 o mas contactos origen, o cualquier grupo con multiples contactos `Guardado`. No se intenta fusionar en el preview. Los contactos importables aparecen como filas independientes, desmarcadas por defecto, para que el usuario decida si los importa y luego los fusiona con la herramienta de revision de duplicados. La descripcion de la pestana debe decir: `Estos casos tienen 4 o mas contactos duplicados o multiples contactos existentes. Por defecto, no pisaremos ningun dato del contacto guardado; solo completaremos campos faltantes. Puede editar la propuesta en "Editar datos".`
- En `Duplicados complejos`, los contactos importables deben agruparse visualmente por el dato que mejor explica la duplicidad. Priorizar correo compartido; si no existe, usar nombre compartido; si tampoco existe, usar telefono normalizado. El titulo del grupo debe seguir el formato `dato o nombre (N duplicados: X guardado(s) y Y importado(s))`, pero el conteo puede ir como texto secundario para mantener el titulo limpio.
- `Editar datos` debe abrir el flujo global de resultante/contacto como borrador dentro del preview. No guarda por si mismo; solo adjunta la decision estructurada al cambio seleccionado y la escritura ocurre al presionar `Aplicar seleccion`.
- Dentro de ese popup, la accion principal debe decir `Ajustar propuesta`, no `Guardar`, para evitar que el usuario crea que el contacto real ya fue modificado.
- Al volver al preview despues de ajustar el borrador, la tarjeta debe indicar `Propuesta ajustada` mientras siga pendiente de `Aplicar seleccion`.
- Para contactos nuevos y duplicados complejos, `Editar datos` funciona como editor del contacto nuevo prellenado desde la fuente importada. Para modificaciones, permite elegir que campos aceptar. Para duplicados fusionables, permite decidir el contacto resultante.

## Fusionar contactos

- La funcion global `Fusionar contactos` debe abrirse como popup reutilizable desde sync, Contactos/Ficha o Coach.
- Debe aceptar 2 o 3 contactos maximo para evitar una interfaz inmanejable.
- Layout preferido: contactos origen side by side y una columna/panel de contacto resultante.
- Los bloques equivalentes de informacion deben quedar alineados entre columnas para comparar campo por campo: identidad, correos, telefonos y datos app. En los contactos origen, evitar borde externo de tarjeta; separarlos con lineas verticales minimalistas. Dentro de cada columna, preferir divisiones con lineas minimalistas antes que mini bloques anidados. El resultado si debe mantenerse como tarjeta con borde, porque representa la decision final.
- En tarjetas origen, la unica etiqueta superior necesaria es `Guardado` o `Importado`; evitar textos secundarios como `contacto app`, `proveedor` o `referido` si no aportan a la decision.
- El bloque de identidad no debe repetir etiquetas internas cuando hay datos. Debe mostrar nombre arriba y empresa/cargo abajo, siguiendo el patron de tarjetas de contacto. Solo usar placeholders como `Empresa` o `Cargo` cuando el dato esta vacio.
- Para campos simples como nombre, empresa y cargo, el usuario puede elegir una identidad de origen o editar el resultado manualmente. Si el resultado coincide exactamente con un origen, el bloque de ese origen se marca en verde.
- Para correos, telefonos y otros campos multivalor, el usuario selecciona que valores conservar/agregar en el resultante. Tambien puede alternarlos desde las tarjetas origen cuando aparecen ahi. Los valores seleccionados se marcan en verde en todas las tarjetas origen donde aparezcan.
- En la tarjeta del resultado, los correos y telefonos seleccionados no se pintan en verde; el check ya comunica la seleccion. El verde solo se usa en las tarjetas origen para ayudar a ver de donde viene cada dato seleccionado.
- `Foco networking` y `Headhunter` no se muestran como "elige origen A/B"; se muestran como switches del resultante.
- Los switches de `Foco networking` y `Headhunter` deben venir activos por defecto si cualquiera de los contactos origen tiene el valor activo.
- `Estado networking` debe venir por defecto con el estado mas avanzado entre los contactos origen, usando la prelacion oficial: Pendiente, Contactado, Agendado, Cita concretada, Agradecimiento enviado. Debe quedar editable antes de guardar.
- En tarjetas origen, los datos app solo se muestran para contactos `Guardado`. No se muestran en contactos `Importado`, porque foco, headhunter y estado networking son atributos internos de la app.
- En contactos `Guardado`, el bloque de datos app puede ser seleccionable para copiar foco, headhunter y estado al resultado, pero no debe pintarse verde por coincidencia; no aporta lo suficiente y agrega ruido visual.
- Las acciones de guardar fusion deben explicar que interacciones, referidos, ToDos, IDs externos e historial quedaran asociados al contacto resultante.
- Referencia visual cloud actual: `ContactMergePreview` en `/sistema/diseno`, alimentada por el componente productivo `ContactMergeWorkspace`.
- Primer uso productivo: `SyncPreviewDialog` abre `ContactMergeDialog` desde el boton `Editar datos` en `Nuevos`, `Modificaciones`, `Duplicados fusionables` y `Duplicados complejos`; guarda una decision estructurada de resultante antes de aplicar la seleccion.
- Para fusiones manuales, no crear selectores fuera del modal. Usar el mismo `ContactMergeDialog` y agregar contactos desde el control interno `Agregar contacto guardado`, con tope de 3 contactos.
- Pendiente tecnico: la fusion profunda de historiales entre contactos app (interacciones, referidos, ToDos e historial completo) debe implementarse como accion interna separada antes de usar esta funcion como fusion definitiva usuario/Coach.

## Cuenta y conexiones

- La seccion Cuenta concentra perfil, plan, conexiones externas, sync delicado, respaldos y acciones de seguridad.
- Las vistas operativas pueden invocar sync contextual, pero la administracion principal de permisos y conexiones vive en Cuenta.
- Los conectores deben mostrarse con `ProviderButton` y declarar si estan disponibles o deshabilitados. No crear botones de proveedor locales por vista.
- Las acciones delicadas, como aplicar cambios importados, desconectar servicios, exportar datos o eliminar cuenta, deben usar confirmacion y registro auditable cuando se implementen.
- Cuenta debe usar `Panel`, `Button`, `ProviderButton`, `compact-list` y tokens `--crm-*`; evitar estilos inline salvo excepciones temporales.

## Burbujas Coach IA

- Usar el componente global del Coach; no crear burbujas por vista.
- El resumen debe ser corto y directo. Para cambios de estado: `Cambia el estado de NOMBRE de ESTADO ACTUAL a ESTADO SUGERIDO.`
- En el resumen, nombres largos se muestran con maximo tres palabras completas y la cuarta como inicial. Ejemplo: `Manuel del Castillo M.`
- El resumen nunca debe truncarse con puntos suspensivos. Si falta ancho, el texto se apila dentro de la burbuja.
- La fecha de la burbuja va al final del resumen, en gris, cursiva y formato `5 jul 2026`.
- Al expandir, mostrar el detalle de evidencia. En citas, incluir asunto y dias transcurridos cuando exista interaccion asociada.
- Los links de accion dentro del detalle usan `--crm-accent` y van bajo una linea divisoria con `--crm-border`.
- Los estados dentro de la burbuja usan punto de color oficial y texto en negrita.
- Si la burbuja es seleccionable, el checkbox va al lado derecho de la burbuja para no interferir con la punta que conecta visualmente con la mascota del Coach.

## Botones de accion

Los botones de accion representan lo que hace el usuario. No deben confundirse con los iconos circulares de tipo de interaccion.

- Boton cuadrado minimo: 36x36.
- Boton rectangular: mismo alto, ancho maximo controlado.
- Icono Material: 18px.
- Texto visible omitido cuando el tooltip explica la accion.
- Centrado con `inline-flex`, `align-items:center`, `justify-content:center`, `line-height:1`.
- En Streamlit, usar el helper `boton_icono_estandar(...)` para evitar deformaciones.
- No crear botones compactos de solo icono con `st.button(...)` directo. Si aparece una necesidad nueva, ampliar `ICONOS_UI` o el helper global antes de crear una excepcion local.
- En mobile, mantener botones icon-only cuadrados cuando sea posible. No usar `use_container_width=True` o equivalentes en botones secundarios compactos.

| Accion | Icono Material |
|---|---|
| Volver | `arrow_back` |
| Actualizar | `sync` |
| Agregar | `add` |
| Editar | `edit` |
| Aplicar | `check` |
| Configurar | `settings` |
| Coach IA | `auto_awesome` |
| Automatizar | `bolt` |
| Ejecutar | `play_arrow` |
| Expandir | `unfold_more` |
| Contraer | `unfold_less` |
| Seleccionar todos | `select_check_box` |
| Limpiar | `close` |
| Incluir foco | `person_add` |
| Sacar foco | `person_remove` |
| Marcar headhunter | `adjust` |
| Quitar headhunter | `groups` |
| Etiqueta | `label` |
| Desactivar | `delete` |

## Botones con texto

Usar botones con texto cuando la decision pueda ser ambigua o tenga impacto: aceptar, cancelar, guardar, ejecutar, vincular, desactivar o eliminar.

- Helper actual: `boton_accion_estandar(...)`.
- Altura base: 36px.
- Radio: 8px.
- Texto: 14px.
- Icono Material: 18px.
- Ancho: segun contenido, con maximo controlado.
- Tonos permitidos:
  - `primary`: aceptar, aplicar, guardar, ejecutar.
  - `secondary`: cancelar, cerrar, acciones neutras.
  - `positive`: automatizar o confirmar una preferencia positiva.
  - `danger`: eliminar o desactivar.

| Accion | Icono | Tono |
|---|---|---|
| Aceptar | `check` | Primary |
| Aplicar | `check` | Primary |
| Guardar | `save` | Primary |
| Ejecutar | `play_arrow` | Primary |
| Cancelar | `close` | Secondary |
| Cerrar | `close` | Secondary |
| Vincular | `link` | Primary |
| Desvincular | `link_off` | Secondary |
| Desactivar | `delete` | Danger |
| Eliminar | `delete` | Danger |
| Automatizar | `bolt` | Positive |

## Selectores buscables

Cuando una lista de opciones puede crecer, usar un selector buscable reutilizable en lugar de un `select` largo.

- Componente cloud actual: `ContactSearchSelect`.
- Uso inicial: vincular un referido con un contacto existente.
- Debe permitir escribir para filtrar por nombre, empresa, cargo, correo o telefono.
- Debe usar el estandar de campos compactos: alto base 36px, radio 8px, texto 14px, placeholder gris/italica sin bold y opciones con titulo 13px-14px y metadata 12px. No agrandar el input por contexto de modal o panel.
- La primera opcion funcional debe permitir dejar el objeto `Sin vinculo` cuando el vinculo sea opcional.
- La lista desplegable debe limitar resultados visibles y usar scroll interno para no empujar el modal.
- Este patron debe reutilizarse en futuros contextos donde se selecciona un contacto.

## Cambios rapidos pendientes

Cuando una ficha secundaria propone completar datos de un objeto principal, no escribir inmediatamente en la base al hacer clic. Usar un estado visual de cambios pendientes y guardar todo al confirmar.

- Uso inicial: mini ficha de contacto dentro de `Referidos y contactos`.
- Icono `arrowRight`: dato disponible para traer desde el referido.
- Icono `check`: dato marcado como cambio pendiente.
- Al desmarcar, el cambio se revierte en pantalla y no se guarda.
- El guardado debe reutilizar la accion oficial del objeto destino, por ejemplo `saveContactFromEditor` para contactos.
- Textos de tooltip: `Actualizar desde referido` para campos de reemplazo como empresa/cargo y `Agregar desde referido` para listas como correos/telefonos.

## Paleta oficial

La app debe usar una paleta acotada. Si se necesita un color nuevo, primero se agrega a esta guia y al anexo visual `/?page=iconos`.

| Uso | Token | Color |
|---|---|---|
| Fondo app | `--crm-bg` | `#f6f7fb` |
| Panel blanco | `--crm-surface` | `#ffffff` |
| Superficies internas suaves | `--crm-surface-soft`, `--crm-field-soft` | Igual a `--crm-bg` |
| Borde | `--crm-border` | `#d9dee8` |
| Borde fuerte | `--crm-border-strong` | `#cbd5e1` |
| Texto principal | `--crm-text` | `#182230` |
| Texto secundario | `--crm-muted` | `#667085` |
| Dato vacio / placeholder | `--crm-empty-value` | `#94a3b8` via `--crm-muted-soft` |
| Primario | `--crm-primary` | `#111827` |
| Link / acento | `--crm-accent` | `#2563eb` |
| Positivo | `positive` | `#15803d` |
| Destructivo | `danger` | `#dc2626` |

## Estados oficiales

| Estado | Color |
|---|---|
| Pendiente | `#dc2626` |
| Contactado | `#ea580c` |
| Agendado | `#16a34a` |
| Cita concretada | `#0284c7` |
| Agradecimiento enviado | `#1d4ed8` |

## Implementacion actual

- `ICONOS_UI`: diccionario de acciones e iconos Material.
- `boton_icono_estandar(...)`: helper para crear botones de accion consistentes.
- `BOTONES_ACCION_UI`: diccionario de botones con texto por accion, icono y tono.
- `boton_accion_estandar(...)`: helper para crear botones con texto consistentes.
- `PALETA_UI`: inventario de colores usado por el anexo visual.
- `--crm-empty-value` y clase `.empty-value`: estandar cloud para placeholders, previews secundarios y textos `sin dato`.
- `icono_interaccion_ficha(...)`: SVGs lineales para tipos de interaccion.
- `estilo_interaccion_ficha(...)`: colores por tipo de interaccion.
- `/?page=iconos`: anexo visual oculto para revisar el estandar real dentro de la app.
- `cloud/web/components/ui/Panel.tsx`: panel base cloud para evitar encabezados y contenedores hardcodeados por vista.
- `cloud/web/components/ui/ProviderIcon.tsx`: iconos y botones globales para proveedores Google, Apple y Microsoft, con variante deshabilitada.
- `cloud/web/components/ui/ContactSearchSelect.tsx`: selector buscable global de contactos para vinculos y acciones contextuales.
- `cloud/web/components/DashboardPipeline.tsx`: pipeline cloud con colores oficiales de estado.
- `cloud/web/components/CoachPreview.tsx`: primera version cloud reutilizable del Coach read-only.
- `cloud/web/components/InteractionEditorDialog.tsx`: editor global de interacciones/minutas para ficha y futuros contextos.
- `cloud/web/components/RecentCards.tsx`: tarjetas cloud para contactos e interacciones recientes.

## Historial

- 2026-07-22: Se crea guia visual con referencia oculta en la app y separacion entre iconos de tipo de interaccion y botones de accion.
- 2026-07-22: Se agrega paleta oficial, links inline y botones con texto estandar.
- 2026-07-22: Se agrega regla para que la replica cloud use esta guia como base del design system y evite estilos hardcodeados.
- 2026-07-22: Se agrega estandar responsive web/mobile, incluyendo evitar botones secundarios a ancho completo en mobile.
- 2026-07-27: Se agrega anexo visual cloud en `cloud/web/app/sistema/diseno/page.tsx` y componentes reutilizables iniciales para iconos, botones y metricas.
- 2026-07-27: Se simplifica paleta cloud: superficies internas suaves usan el mismo fondo de app para reducir diferencias tenues y ruido visual.
- 2026-07-28: Dashboard cloud adopta componentes visuales reutilizables para paneles, pipeline, Coach preview y tarjetas recientes; se valida en desktop y mobile.
- 2026-08-03: Se agrega Cuenta como ubicacion visual de conexiones y sync delicado, usando componentes globales y sin crear estilos locales de proveedor.
- 2026-08-03: Se pausa `No eliminar ni volver a sugerir` en el footer de sync por confusion de usabilidad; queda como accion futura separada.
- 2026-08-03: Se agrega maqueta visual cloud de `Fusionar contactos` con switches binarios, estado networking editable en el resultante y columnas alineadas por bloques de informacion.
- 2026-07-30: Se agrega estandar cloud para botones de proveedores Google/Apple/Microsoft, incluyendo estado deshabilitado en gris.
