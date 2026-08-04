# Current data model

Este documento describe el modelo de datos actual usado por la app. No contiene pendientes ni ideas futuras.

## Fuente actual

La app usa Google Sheets como base de datos. El rango principal de contactos es `CRM_Contactos_Extra!A:Y`.

Antes de migrar o cambiar columnas, contrastar este documento con los encabezados reales de la planilla.

## CRM_Contactos_Extra

| Columna | Que representa | Uso principal | Formato requerido |
|---|---|---|---|
| `Google_ID` | ID legacy usado por el codigo actual como llave operativa | Compatibilidad con interacciones, referidos, ToDos y sync existentes | Texto no vacio. Externo actual: `people/...`; nativo app legacy: `APP_CONTACT_...` |
| `Contact_ID` | ID propio de la app para el contacto | Identidad canonica futura del contacto, independiente de Google/Apple/Microsoft/CSV | Texto `APP_CONTACT_...`; se infiere si esta vacio |
| `Provider` | Fuente principal que origino o actualizo el contacto | Separar identidad app de fuentes externas | `Google`, `App`, `Manual` u otro proveedor futuro |
| `Provider_Contact_ID` | ID del contacto en la fuente externa | Vincular/importar/exportar hacia servicios conectados | `people/...` para Google; vacio si es creado solo en la app |
| `Nombre_Visual` | Nombre mostrado al usuario | Tablas, ficha y busqueda | Texto |
| `Emails_Concatenados` | Emails del contacto en una celda | Sync Gmail, dominio HH, reasignacion | Emails separados por `;` si hay varios |
| `Telefonos` | Telefonos del contacto | Match alternativo y visualizacion | Texto, varios separados por `;` |
| `Empresa_Google` | Empresa importada o editada | Tabla, filtros y dashboard | Texto |
| `Cargo_Google` | Cargo/rol del contacto | Tabla y ficha | Texto |
| `Scope_Networking` | Si esta en foco activo de networking | Filtro principal de contactos | `TRUE` o `FALSE` |
| `Nivel_Cercania` | Nivel de cercania con el contacto | Priorizacion futura | Numero/texto simple |
| `Es_Headhunter` | Marca si el contacto es headhunter | Dashboard HH y filtros | `TRUE` o `FALSE` |
| `Dominios_Headhunter` | Dominios/empresas HH asociados | Agrupar empresas headhunter | Dominios separados por `;`, ejemplo `@empresa.cl` |
| `Estado_CRM` | Estado oficial de networking | Pipeline, filtros, ToDos y KPIs | Uno de los estados oficiales |
| `Estado_Sync` | Resultado/estado de sincronizacion | Diagnostico visible | Texto controlado por la app |
| `Estado_Contacto` | Si el contacto esta activo/desactivado | Evitar borrar historial | `Activo` o `Desactivado` |
| `F_Pendiente` | Fecha legacy del hito pendiente | Historial/mapeo legacy | Fecha o vacio |
| `F_Promesa_Cafe` | Fecha legacy de promesa cafe | Historial/mapeo legacy | Fecha o vacio |
| `F_Propuesta_Cita` | Fecha legacy de propuesta de cita | Historial/mapeo legacy | Fecha o vacio |
| `F_Cita_Creada` | Fecha legacy de cita creada | Historial/mapeo legacy | Fecha o vacio |
| `F_Cita_Concretada` | Fecha legacy de cita concretada | Historial/mapeo legacy | Fecha o vacio |
| `F_Agradecimiento` | Fecha legacy de agradecimiento | Historial/mapeo legacy | Fecha o vacio |
| `F_Propone_Lead` | Fecha legacy de referido propuesto | Flujo legacy de referidos | Fecha o vacio |
| `F_Nuevo_Lead_Contactado` | Fecha legacy de referido contactado | Flujo legacy de referidos | Fecha o vacio |
| `Minuta_Reunion` | Nota historica ligada al contacto | Informacion manual legacy | Texto |

## Interacciones

| Columna | Que representa | Uso principal | Formato requerido |
|---|---|---|---|
| `Google_ID` | Contacto asociado | Timeline, dashboard, KPIs | Texto, normalmente `people/...` |
| `ID_Entrada` | ID unico interno de la interaccion | Evitar duplicados y editar registros | Texto unico |
| `Fecha` | Fecha/hora de la interaccion | Orden, KPIs, ultimo contacto | Fecha parseable |
| `Tipo` | Tipo de interaccion | Timeline, filtros, reglas | Email, Reunion/Cita, Llamada, WhatsApp, Nota u otro tipo controlado |
| `Asunto_Titulo` | Titulo o asunto | Timeline y evidencia | Texto |
| `De_Hacia_Contacto` | Direccion de la interaccion | Saber si fue saliente/entrante | Texto, idealmente controlado |
| `Detalle_Fuente` | Contenido original importado | Referencia no editable | Texto original |
| `Notas_Usuario_Crudo` | Version editable por usuario | Fuente principal futura para IA | Texto editable |
| `Resumen_IA` | Resumen generado por IA | Campo reservado/uso futuro | Texto |
| `ID_Fuente` | ID original de Gmail/Calendar | Dedupe contra fuente externa | Texto |
| `Thread_ID` | ID de hilo Gmail | Dedupe de recomendaciones por hilo | Texto, ejemplo `GMAIL_THREAD_...` |
| `Email_Asociado` | Email que vincula interaccion/contacto | Reasignacion si email cambia de contacto | Email normalizado |
| `Rol_Email` | Rol del email/contacto en Gmail | Filtrar CC y participacion | From, To, Cc u otro valor controlado |

Estandar KPI: para computar contactos realizados y empresas headhunter realizadas, la direccion debe venir estructurada desde origen. `Rol_Email` debe indicar `TO`, `CC`, `BCC`, `FROM` o `MANUAL`; `De_Hacia_Contacto` es texto visible/legacy y no debe usarse como fallback permanente de calculo. Si un registro antiguo no trae `Rol_Email`, el dato debe completarse desde la fuente original antes de considerarlo confiable para KPI.

Estandar de fecha KPI: los periodos se calculan usando la fecha calendario de la interaccion segun la fuente/configuracion del usuario. Una fecha `01/04/2026` debe caer en abril, sin moverse a marzo por conversion de zona horaria del navegador o de UTC.

Nota legacy: registros antiguos pueden tener `Rol_Email` vacio. La app local aun conserva una inferencia transicional desde `De_Hacia_Contacto` para no perder historial mientras se hace backfill; esa inferencia no es el estandar futuro.

## CRM_Relaciones

Relaciona contactos con apuntes de referidos. El codigo actual lee `CRM_Relaciones!A:Q` y normaliza tanto la estructura legacy `A:D` como la estructura ampliada. Si la hoja todavia tiene solo las cuatro columnas legacy, la app las completa en memoria para mantener compatibilidad.

Columnas legacy obligatorias:

| Columna | Que representa | Uso principal | Formato requerido |
|---|---|---|---|
| `Google_ID_Origen` | Contacto que refiere o menciona al referido | Mostrar referidos en ficha del contacto origen | Texto, normalmente `people/...` |
| `Nombre_Referido` | Nombre libre del referido | Mostrar el apunte de referido aunque no exista contacto vinculado | Texto |
| `Google_ID_Referido` | Contacto vinculado al referido | Abrir ficha y conectar el apunte con un contacto real | Texto `people/...` o vacio |
| `Notas_Relacion` | Apunte libre sobre el referido o la relacion | Contexto visible en tarjetas de referidos | Texto |

Columnas ampliadas soportadas por el codigo actual:

| Columna | Que representa | Uso principal | Formato requerido |
|---|---|---|---|
| `Referido_ID` | ID estable del apunte de referido | Editar, borrar o vincular sin depender del nombre | Texto unico generado por la app |
| `Quien_Refiere_ID` | Alias explicito del contacto que refiere | Preparar migracion futura a modelo agnostico de fuente | Texto, hoy equivalente a `Google_ID_Origen` |
| `Empresa_Referido` | Empresa escrita libremente para el referido | Preservar dato aunque no exista contacto vinculado | Texto |
| `Cargo_Referido` | Cargo escrito libremente para el referido | Preservar dato aunque no exista contacto vinculado | Texto |
| `Telefono_Referido` | Telefono escrito libremente para el referido | Crear/contactar/vincular contacto futuro | Texto normalizado cuando sea posible |
| `Email_Referido` | Email escrito libremente para el referido | Crear/contactar/vincular contacto futuro | Email o vacio |
| `Notas_Referido` | Notas libres propias del referido | Reemplaza progresivamente `Notas_Relacion` | Texto |
| `Contacto_Vinculado_ID` | Alias explicito del contacto vinculado | Preparar migracion futura a modelo agnostico de fuente | Texto, hoy equivalente a `Google_ID_Referido` |
| `Estado_Referido` | Estado interno del referido | Filtrar o cerrar referidos a futuro | Texto, default `Abierto` |
| `Fecha_Creacion` | Fecha de creacion del referido | Auditoria y orden | `dd/mm/yyyy hh:mm:ss` |
| `Fecha_Actualizacion` | Ultima edicion del referido | Auditoria y sync futuro | `dd/mm/yyyy hh:mm:ss` |
| `Origen` | Fuente de creacion del referido | Distinguir manual, importado o sugerido por Coach | Texto, default `Manual` |
| `Activo` | Marca de vigencia logica | Desactivar sin perder historial | `TRUE`/`FALSE` |

Nota: `Google_ID_Origen`, `Quien_Refiere_ID`, `Google_ID_Referido`, `Contacto_Vinculado_ID`, `Notas_Relacion` y `Notas_Referido` se mantienen espejados por compatibilidad hasta reemplazar el popup legacy.

## CRM_Config

Configuracion general. El codigo lee `CRM_Config!A2:B2`.

Uso conocido:

- fecha historica de inicio para importaciones o sincronizaciones.

## CRM_Sync_State

Estado de sincronizacion incremental. El codigo usa `CRM_Sync_State!A:C`.

| Columna esperada | Que representa | Uso principal | Formato requerido |
|---|---|---|---|
| Clave/fuente | Fuente o proceso de sync | Identificar cursor | Texto |
| Valor/cursor | Cursor o fecha de sync | Sincronizacion incremental | Texto/API token/fecha |
| Ultima actualizacion | Momento de escritura | Diagnostico | Fecha/hora |

## CRM_ToDos

| Columna | Que representa | Uso principal | Formato requerido |
|---|---|---|---|
| `Todo_ID` | ID unico del pendiente | Identificar y actualizar ToDo | Texto unico |
| `Fecha_Creacion` | Fecha de creacion | Orden y antiguedad | Fecha/hora |
| `Fecha_Actualizacion` | Ultima modificacion | Auditoria ligera | Fecha/hora |
| `Estado_ToDo` | Estado del pendiente | Filtrar pendientes | Texto controlado |
| `Tipo_ToDo` | Tipo de sugerencia | Configuracion y motor | Texto controlado |
| `Prioridad` | Prioridad del pendiente | Orden visual | Texto/numero |
| `Origen` | Regla, hibrido o IA | Explicar fuente | Texto controlado |
| `Confianza` | Confianza de la sugerencia | Decidir si confirmar | Numero/texto |
| `Objeto_Tipo` | Tipo de objeto afectado | Saber que cambia | Contacto, interaccion, etc. |
| `Objeto_ID` | ID del objeto afectado | Ejecutar accion | Texto |
| `Objeto_Label` | Nombre visible del objeto | Mostrar al usuario | Texto |
| `Cambio_Tipo` | Tipo de cambio sugerido | Describir accion | Texto controlado |
| `Estado_Actual_JSON` | Estado antes del cambio | Comparar cambio | JSON texto |
| `Estado_Sugerido_JSON` | Estado propuesto | Ejecutar cambio | JSON texto |
| `Evidencia_JSON` | Evidencia usada | Explicar recomendacion | JSON texto |
| `Acciones_JSON` | Acciones disponibles | Botones/links futuros | JSON texto |
| `Dedup_Key` | Clave anti duplicados | Evitar sugerencias repetidas | Texto deterministico |
| `Notas` | Comentarios adicionales | Contexto | Texto |

## CRM_ToDo_Config

| Columna | Que representa | Uso principal | Formato requerido |
|---|---|---|---|
| `Tipo_ToDo` | Tipo de sugerencia o regla concreta configurable | Configurar comportamiento | Texto controlado. En configuracion puede ser granular, por ejemplo `RULE_STATUS_TO_CONTACTED` |
| `Descripcion` | Explicacion del tipo | UI/configuracion | Texto |
| `Motor_Tipo` | Regla, hibrido o IA | Ordenar complejidad | RULE, HYBRID o AI |
| `Modo_Ejecucion` | Como se ejecuta | Preguntar/auto/desactivar | `Preguntar`, `Automatico` o `Desactivado` |
| `Permite_Auto_Aplicar` | Si puede automatizarse | Seguridad | TRUE/FALSE |
| `Requiere_Confirmacion` | Si pide confirmacion | Seguridad | TRUE/FALSE |
| `Fuentes_Requeridas` | Datos necesarios | Control de procesamiento | Texto separado por `;` |
| `Ventana_Dias` | Ventana temporal | Reglas de fecha | Numero o vacio |
| `Criterio_Dedupe` | Criterio anti duplicado | Evitar repeticion | Texto |
| `Actualizado_En` | Fecha de config | Auditoria | Fecha/hora |

## CRM_Object_Review_State

Controla que reglas o IA no revisen dos veces objetos sin cambios.

| Columna | Que representa | Uso principal | Formato requerido |
|---|---|---|---|
| `Processor_ID` | Motor/regla que reviso | Separar procesadores | Texto |
| `Objeto_Tipo` | Tipo de objeto revisado | Minuta, email, contacto, etc. | Texto |
| `Objeto_ID` | ID del objeto revisado | Encontrar revision | Texto |
| `Objeto_Updated_At` | Fecha de ultima edicion del objeto | Saber si cambio | Fecha/hora |
| `Reviewed_At` | Fecha de revision | Evitar reproceso | Fecha/hora |
| `Input_Hash` | Huella del input | Detectar cambios | Texto hash |
| `Output_Hash` | Huella del output | Detectar repeticion | Texto hash |
| `Todo_IDs_Generados` | ToDos creados | Trazabilidad | Texto/JSON |
| `Estado_Revision` | Resultado de revision | Diagnostico | Texto controlado |
| `Error` | Error si fallo | Diagnostico | Texto |
| `Notas` | Contexto adicional | Diagnostico | Texto |

## Export espejo local

La app local puede generar un ZIP de respaldo/migracion desde opciones avanzadas de Contactos. Este export no modifica datos y lee las hojas actuales para generar:

- tablas normalizadas segun los esquemas actuales documentados;
- snapshots raw opcionales de las hojas originales;
- `manifest.json` con conteos y hashes;
- `validation_report.json` con duplicados, referencias rotas y advertencias.

El export contiene datos personales y minutas. No debe subirse a GitHub ni compartirse por chat.

## Historial

- 2026-07-15: Renombrado desde `SHEETS_SCHEMA_CURRENT` y ampliado con uso/formato por columna.
- 2026-07-15: Se documenta fallback legacy para detectar interacciones salientes cuando `Rol_Email` esta vacio.
- 2026-07-28: Se define estandar KPI sin fallback permanente: direccion estructurada obligatoria y fecha calendario sin corrimiento por zona horaria.
- 2026-07-22: `Google_ID` pasa a documentarse como ID tecnico transicional: puede venir de la fuente conectada actual o ser nativo de la app.
- 2026-07-22: `CRM_Contactos_Extra` se amplia a `A:Y` con `Contact_ID`, `Provider` y `Provider_Contact_ID`; `Google_ID` queda como llave legacy hasta migrar referencias.
- 2026-07-20: `CRM_ToDo_Config.Tipo_ToDo` admite reglas configurables granulares para el Coach IA, separadas del tipo base almacenado en `CRM_ToDos`.
- 2026-07-22: Se documenta `CRM_Relaciones` actual A:D como modelo legacy de referidos, incluyendo su limitacion frente al nuevo diseno futuro.
- 2026-07-22: El codigo queda compatible con `CRM_Relaciones!A:Q` y normaliza columnas legacy/ampliadas sin migracion masiva automatica.
- 2026-07-22: Se documenta export espejo local como lectura de respaldo/migracion sin modificacion de datos.
