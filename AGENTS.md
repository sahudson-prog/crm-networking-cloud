# Reglas para Codex en CRM Networking

Este documento concentra las reglas de comportamiento para Codex. Si hay una regla de trabajo para la IA, debe vivir aqui y no dispersarse en otros documentos.

## Principios de trabajo

- La fuente de verdad es el codigo actual, el comportamiento real de Streamlit y los datos conectados.
- Resumenes externos sirven como hipotesis; siempre validar contra codigo, datos o ejecucion real.
- Trabajar en cambios pequenos, reversibles y verificables.
- No duplicar logica. Antes de crear una funcion nueva, revisar si ya existe algo reutilizable.
- Antes de agregar o ajustar una funcionalidad, regla, diseno, componente, documento, tabla o item de backlog, revisar si ya existe algo igual, similar o potencialmente contradictorio en codigo y documentacion viva. Si existe, advertirlo al usuario antes de crear contenido nuevo, explicar brevemente que ya existe, donde esta documentado y por que podria ser duplicidad o contradiccion.
- Si el pedido nuevo se solapa con algo existente, preferir actualizar, fusionar, renombrar o extender lo existente antes que crear una pieza nueva. Solo crear algo separado si hay una diferencia clara de proposito, alcance o comportamiento.
- Priorizar componentes globales reutilizables para UI, reglas y datos. Si un objeto puede vivir en Dashboard, Contactos, Ficha u otra vista, crear o ajustar una sola funcion/componente con variantes parametrizadas en lugar de duplicar implementaciones por vista.
- Mantener la UI minimalista, clara y orientada a usuario final no tecnico.
- Diseñar UI pensando tambien en una futura app movil: componentes compactos, tactiles, responsivos, con patrones faciles de transformar a mobile como toggles, listas, tabs y acciones contextuales.
- Toda interfaz nueva o redisenada debe probarse como web desktop y web mobile. En mobile, los botones no deben ocupar todo el ancho salvo que sea una accion principal explicita; preferir iconos compactos, toolbars horizontales con wrap controlado, acciones contextuales y listas/tarjetas escaneables.
- Separar producto, arquitectura, datos, backlog y plan. No mezclar responsabilidades entre documentos.

## Migracion cloud y orden del codigo

- La app local debe seguir funcionando durante la transicion y servir como referencia de comparacion.
- El MVP cloud replica todo lo funcional actual, pero ordenado: primero Google como unico proveedor conectado y otros proveedores quedan para v2.
- La primera experiencia mobile debe ser web responsive/PWA. No asumir app nativa hasta que exista una razon clara de producto o distribucion.
- Antes de implementar una pieza en la nube, revisar la estructura actual, detectar duplicidades y proponer si conviene extraer, reutilizar, simplificar o reemplazar logica.
- Para cada modulo cloud, antes de considerarlo implementado, hacer una auditoria explicita de tres fuentes: codigo local antiguo, vista local real y documentacion viva. El resultado debe declarar que se replica, que se mejora, que se descarta y que queda pendiente.
- En modulos medianos o criticos, usar un agente QA auxiliar cuando sea util para contrastar en paralelo contra codigo local, documentos y comportamiento esperado. El agente QA no decide ni implementa cambios finales; entrega hallazgos, riesgos, diferencias y pruebas sugeridas para que el agente principal integre o corrija.
- En migracion cloud, antes de proponer una version visual nueva, replicar primero la referencia aprobada de la app local o maqueta. Toda diferencia visual relevante debe ser intencional, explicada y validada; no asumir que "cloud" justifica cambiar layout, leyenda, densidad, iconos, colores o textos.
- No trasladar desorden a la nueva plataforma. La migracion debe ser una oportunidad para separar capas: UI, datos, integraciones, reglas, KPIs, ToDos y autenticacion.
- Toda funcion nueva para la nube debe tener una responsabilidad clara, nombre descriptivo y una interfaz reutilizable.
- Las funciones que puedan ejecutar acciones de negocio deben disenarse como acciones internas reutilizables por UI, reglas, Coach IA o automatizaciones. Deben tener contrato claro: nombre de accion, inputs, outputs, validaciones, objetos afectados, si requiere confirmacion, permisos/plan aplicable y auditoria esperada.
- El Coach IA no debe depender de manipular pantallas. Debe sugerir o solicitar acciones internas con parametros estructurados; la app valida, pide confirmacion cuando corresponda, ejecuta y registra resultado.
- Las integraciones externas deben pasar por adaptadores de fuente. La logica de producto no debe depender directamente de Google, Apple, Microsoft u otro proveedor.
- En v1 cloud, las integraciones Google son de lectura/importacion/sync. No escribir en contactos, Gmail o Calendar salvo aprobacion explicita futura.
- Cualquier servicio con riesgo de cobro debe tener limites, alertas o mecanismos de apagado documentados antes de activarse.
- La app debe tener su propia fuente de verdad de contactos; IDs externos viven como referencias de proveedor, no como ID principal del producto.
- Si una decision puede afectar datos, permisos, costos, credenciales, OAuth, despliegue o privacidad, explicar impacto y pedir confirmacion antes de ejecutarla.
- Al completar un cambio relevante, actualizar la documentacion viva que corresponda y registrar que cambio en la version o hito.

## Lineamientos UI reutilizable

- Antes de tocar UI, revisar `docs/UI_STYLE_GUIDE.md` y, si hace falta validacion visual, abrir la guia oculta `/?page=iconos`.
- Antes de crear o ajustar UI, revisar si existe un componente, clase CSS, token o patron visual reutilizable. Si se puede usar en mas de una vista, debe quedar parametrizado y no duplicado.
- Para textos que representan ausencia de dato o contenido tenue equivalente, usar siempre el estandar `empty-value` definido en `docs/UI_STYLE_GUIDE.md`: `sin datos`, `Sin empresa`, `Sin cargo`, `sin telefonos`, placeholders de campos editables y previews secundarios. En React, preferir el componente global `EmptyValue`; no crear estilos locales alternativos para estos casos.
- Para replicas cloud de vistas existentes, comparar componente por componente contra la app local/maqueta antes de cerrar: posicion, tamanos, tipografia, colores, leyendas, iconos, densidad, formato de fechas, textos y comportamiento. Si no se pudo validar visualmente por login o sesion, reportarlo como pendiente.
- Las tablas, filtros, graficos, botones, iconos, paleta, fonts, bloques de ficha, Coach, referidos y acciones de contacto deben tender a componentes globales. Si aparece una excepcion local, documentarla como temporal o llevarla al backlog de deuda.
- Mantener una escala tipografica consistente:
  - Nombre o titulo principal de ficha: 30px, peso 780.
  - Subtitulo de ficha: 15px, peso 400.
  - Titulo de bloque o panel: 16px, peso 800.
  - Texto principal, links relevantes, valores de campos, selectores y titulos de filas: 14px.
  - Preview o texto secundario de listas: 13px.
  - Metadata, fechas, estados, notas breves y botones compactos: 12px.
  - Labels pequenos en uppercase: 11.2px, peso 800.
- Selectores, inputs compactos y botones deben usar la misma altura base de 36px, radio de 8px y texto de 14px, salvo que haya una razon explicita para crear una variante mayor.
- Botones con icono deben usar iconos Material o una libreria definida, centrados con `inline-flex`, `align-items:center`, `justify-content:center`, `line-height:1`, icono de 18px y sin texto visible cuando el tooltip explique la accion.
- Los botones compactos de solo icono deben crearse con `boton_icono_estandar(...)`. No usar `st.button(...)` directo para estos casos; si falta una accion, agregarla a `ICONOS_UI` o mejorar el helper global.
- Para evitar deformaciones en Streamlit, los botones icon-only deben tener ancho/alto estable, padding controlado y selectores CSS asociados al helper global. CSS por key o por vista solo puede usarse como parche temporal documentado.
- En mobile, evitar que Streamlit expanda botones secundarios a ancho completo. Si una accion es secundaria, debe mantenerse compacta o agruparse en menu/opciones avanzadas.
- Los estados oficiales de networking deben usar siempre la misma nomenclatura visual: Pendiente rojo, Contactado naranjo, Agendado verde, Cita concretada azul claro, Agradecimiento enviado azul fuerte.

## Seguridad y datos

- No exponer ni copiar en respuestas `credentials.json`, `token.json`, correos, telefonos, minutas ni datos personales.
- No modificar datos productivos, Google Sheets, credenciales, OAuth o integraciones Google sin explicar antes el impacto.
- Antes de cambios con riesgo sobre datos, crear respaldo local y, si aplica, respaldo de la planilla.
- Preferir desactivar contactos antes que borrar, para preservar historial.

## Validacion minima

Para cambios de codigo Python:

```powershell
venv\Scripts\python.exe -m py_compile app.py
```

Para cambios visuales:

- Ejecutar Streamlit.
- Revisar la vista afectada en navegador.
- Confirmar que no se rompen Dashboard, Contactos, Ficha ni autenticacion.

Para cambios de datos o sync:

- Identificar tablas/columnas afectadas.
- Confirmar si hay escritura sobre Google Sheets.
- Revisar impacto sobre contactos, interacciones, ToDos y cursores de sync.

## Reglas de documentacion

- Antes de agregar contenido a cualquier documento, buscar conceptos similares en `PRODUCT_DETAIL_AND_VISION.md`, `BACKLOG.md`, `CURRENT_PLAN.md`, `DATA_MODEL_BLUEPRINT.md`, `ARCHITECTURE_CURRENT.md`, `RULES_MASTER.md`, `UI_STYLE_GUIDE.md` y `QA_CHECKLIST.md`.
- Si algo ya existe, no duplicarlo con otro nombre salvo que el usuario confirme una separacion. En su lugar, actualizar la entrada existente y dejar el historial correspondiente.
- Si dos documentos parecen contradecirse, detenerse y explicarlo antes de seguir; proponer cual queda como fuente de verdad segun la responsabilidad de cada documento.
- Si cambia una regla de trabajo para Codex, actualizar este archivo.
- Si cambia una idea, pendiente, prioridad o mejora futura, actualizar `docs/BACKLOG.md`.
- Si cambia el plan de trabajo priorizado, actualizar `docs/CURRENT_PLAN.md`.
- Si cambia una caracteristica de producto visible para el usuario, actualizar `docs/PRODUCT_DETAIL_AND_VISION.md`.
- Si cambia una tabla, columna o formato actual, actualizar `docs/CURRENT_DATA_MODEL.md`.
- Si cambia el diseno futuro de base de datos, actualizar `docs/DATA_MODEL_BLUEPRINT.md`.
- Si cambia la estructura del codigo, modulos, responsabilidades o inventario de funciones, actualizar `docs/ARCHITECTURE_CURRENT.md`.
- Si cambia una validacion necesaria, actualizar `docs/QA_CHECKLIST.md`.
- No crear documentos nuevos salvo que el contenido no quepa naturalmente en los existentes.

## Flujo esperado en cada iteracion

1. Entender el pedido y revisar contexto local relevante.
2. Revisar duplicidad o solapamiento en codigo y documentos vivos: producto, backlog, plan, datos, arquitectura, reglas, UI y QA.
3. Si existe algo similar, advertirlo al usuario con ubicacion, resumen y recomendacion: reutilizar, fusionar, extender, reemplazar o crear separado.
4. Si el cambio toca datos, arquitectura, nube, permisos o integraciones, indicar el riesgo antes de editar.
5. Crear respaldo cuando corresponda.
6. Revisar si ya existe logica reutilizable o duplicada antes de crear codigo nuevo.
7. Implementar el cambio mas pequeno que resuelva el objetivo.
8. Validar.
9. Informar que documentos se actualizaron o explicar por que no hizo falta.

## Direccion tecnica vigente

La app actual usa Streamlit + Google Sheets. La direccion objetivo es:

- Postgres como base definitiva.
- Login multiusuario.
- OAuth Google por usuario.
- Importadores Google/CSV/Excel.
- Backups descargables.
- Despliegue en nube con limites de uso.

La transicion debe ser gradual: aislar acceso a datos, migrar persistencia y luego escalar plataforma.
