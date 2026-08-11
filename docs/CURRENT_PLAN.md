# Current plan

Este documento contiene el plan de trabajo priorizado. El backlog contiene todas las ideas; este documento contiene lo que vamos a ejecutar o preparar proximamente.

## Objetivo actual

Profesionalizar el proyecto sin frenar el avance funcional: mantener la app local operativa como base de comparacion, aislar acceso a datos, preparar export/import espejo y construir una replica cloud gradual sobre Postgres/Supabase con Google como unico conector v1.

## Estado de fases

| Fase | Nombre | Estado | Resultado esperado |
|---|---|---|---|
| 0 | Orden y control | En cierre | Documentacion minima, backlog estructurado y reglas claras |
| 1 | Aislar datos y fuentes | Siguiente | UI local funcionando igual, pero con acceso a datos e integraciones centralizados y duplicidades identificadas |
| 2 | Export/import espejo | En curso | App local exporta data completa y app cloud la importa para quedar como replica |
| 3 | Sandbox Supabase/Postgres | En curso | Probar modelo nuevo sin afectar datos actuales ni generar costos sorpresivos |
| 4 | Replica cloud comparable | En curso | App cloud funciona con datos importados y se compara contra la app local |
| 5 | Login y Google conectado | Pendiente | Uno o dos usuarios entran con login propio y conectan Google en modo lectura |
| 6 | Deploy controlado web responsive | Pendiente | Beta cerrada online con limites de uso, alertas y rollback |
| 7 | Producto escalable | Pendiente | Preparar crecimiento, observabilidad, planes, monetizacion y v2 multi-proveedor |

## Plataformas base

Estado reportado por usuario al 2026-07-22:

| Plataforma | Estado | Uso previsto | Nota |
|---|---|---|---|
| GitHub | Listo: repo `crm-networking-cloud` | Repositorio de la futura app cloud | Mantener privado y sin secretos |
| Supabase | Listo: proyecto `crm-networking-dev`, region Americas | Postgres/Auth/Storage de desarrollo | Plan Free; definir guardrails antes de uso intensivo |
| Vercel | Listo | Hosting web responsive/PWA | No importar proyecto hasta crear estructura cloud |
| Google Cloud | Listo: proyecto `crm-networking-dev`, APIs activadas | OAuth y APIs Google read-only | Consent screen casi listo; `gmail.readonly` queda pendiente de validar/agregar |

## Plan inmediato

Antes de continuar con la transicion cloud, se ejecutara el rediseño modular aprobado para la ficha de contacto, en partes pequeñas y verificables. Al 2026-07-21 existe una primera version activa basada en maqueta; queda en revision visual con el usuario antes de cerrarla.

### Rediseño ficha de contacto

| Orden | Backlog ID | Trabajo | Resultado | Riesgo |
|---|---|---|---|---|
| 1 | CONTACT-002 | Bloque datos y acciones | Implementado en primera version; pendiente ajuste visual fino | Medio |
| 2 | CONTACT-003 | Interacciones compactas | Implementado en primera version; pendiente validar expansion/edicion con usuario | Medio |
| 3 | CONTACT-004 | Referidos en tarjetas | Implementado en primera version; pendiente probar con contactos que tengan referidos | Bajo |
| 4 | CONTACT-005 | Coach contextual | Implementado en primera version; pendiente ajustar densidad/alineacion | Medio |
| 5 | DEBT-005 | Componentes reutilizables UI | En curso: Coach y referidos empiezan a usar helpers comunes; falta extraer mas vistas | Medio |
| 6 | CONTACT-006 | Robot compacto alineado | Implementado; pendiente validacion visual del usuario | Medio |
| 7 | CONTACT-007 | Bloque info blanco y bordes | Implementado; pendiente validacion visual del usuario | Bajo |
| 8 | DATA-006 | Modelo ampliado de referidos | Implementado en capa transicional; pendiente validar datos reales tras primera escritura aprobada | Medio |
| 9 | CONTACT-010 | Editor oficial de contacto | Implementado como popup global conectado desde referidos; pendiente validar UX y reutilizar en otros contextos | Medio |
| 10 | CONTACT-011 | Editor oficial de referido | Implementado popup oficial con vinculo opcional y llamada al editor de contacto; pendiente validacion visual/funcional | Medio |
| 11 | CONTACT-008 | Flujo crear/vincular referidos en ficha | Implementado en codigo; pendiente prueba con usuario en ficha real | Medio |

### Profesionalizacion y cloud

| Orden | Backlog ID | Trabajo | Resultado | Riesgo |
|---|---|---|---|---|
| 1 | DOC-001 | Reordenar documentacion base | Documentos con responsabilidades claras | Bajo |
| 2 | CLOUD-009 | Definir guardrails de costos y cuotas | Limites iniciales, alertas y criterios de apagado antes de consumir servicios cloud | Medio |
| 3 | DATA-005 | Definir contrato export/import espejo | Schema JSON/ZIP de salida local, versionado, conteos y validaciones | Medio |
| 4 | DATA-005 | Implementar export local espejo | Implementado y descarga validada por usuario; preview automatizado del ZIP real ejecutado sin errores bloqueantes | Medio |
| 5 | DATA-002 | Disenar schema Postgres inicial | Hecho: schema v0.1 ejecutado en Supabase dev; 22 tablas, 22 policies y RLS activo verificados por CSV | Medio |
| 6 | DATA-005 | Implementar preview import cloud | Hecho: `cloud/importer/preview_export.py` valida ZIP, hashes, conteos y estimacion de tablas destino sin exponer datos personales | Bajo |
| 7 | DATA-005 | Implementar carga cloud controlada | Hecho: carga real ejecutada en Supabase dev con conteos completos y verificacion SQL confirmada por usuario; pendiente comparacion funcional | Medio |
| 8 | CLOUD-006 | Crear app web cloud base | En curso: `cloud/web` creado con Next/React, Supabase Auth, Dashboard, Contactos, Ficha de contacto, Sistema y Cuenta en modo espejo; typecheck/build ok; primera capa comun de lectura lista; Dashboard reordenado para comparabilidad con Streamlit; AuthGate evita carga infinita | Medio |
| 9 | CLOUD-012 | Definir design system cloud | En curso: tokens CSS, paneles, botones, iconos, estados, metricas, KPIs, Coach preview, empresas HH, tarjetas y layouts responsivos nacen como componentes globales; anexo visual cloud creado | Bajo |
| 10 | CLOUD-003 / CLOUD-010 | Cuenta y OAuth Google v1 | Cuenta concentra perfil, plan, conexiones y sync delicado; OAuth Google v1 mantiene scopes minimos de lectura/importacion, sin escritura en contactos, correos ni calendario. Sync/export saliente hacia Google queda fuera de prioridad v1 | Medio |
| 11 | CLOUD-007 | Definir capa de integracion/adaptadores v1 | Google queda como primer conector, sin amarrar la app a Google ni limitar servicios futuros | Medio |
| 12 | TECH-001 | Centralizar nombres de hojas y columnas | Menos strings dispersos en `app.py` | Bajo |
| 13 | TECH-002 | Crear capa inicial de datos para contactos | Contactos leidos/escritos desde una funcion estable | Medio |
| 14 | TECH-003 | Crear capa inicial de datos para interacciones | Interacciones centralizadas antes de migrar | Medio |
| 15 | TECH-004 | Crear capa inicial de datos para ToDos/config | Motor de sugerencias menos acoplado a Sheets | Medio |
| 16 | TECH-006 | Catalogo de acciones internas | Contratos para que UI, reglas y Coach IA usen las mismas funciones accionables | Medio |
| 17 | DEBT-004 | Auditar duplicidades antes de migrar | Mapa de funciones reutilizables, duplicadas y candidatas a extraer | Bajo |
| 18 | CLOUD-011 | Web responsive/PWA primero | Evitar costo/mantencion de app nativa hasta validar necesidad real | Bajo |
| 19 | DASH-003 | Separar calculos KPI | En curso cloud: motor `kpiCalculations` separado de UI; tests KPI base implementados; falta comparacion visual/datos contra local y futuros tests agregados | Medio |
| 20 | QA-001 | Agregar pruebas simples de reglas criticas | Menos riesgo al refactorizar | Bajo |

## Plan cloud MVP propuesto

El MVP cloud sera "la app actual, pero ordenada". No se cambia la app local hasta que la replica online pueda compararse contra ella.

| Etapa | Objetivo | Entregable | Criterio de avance |
|---|---|---|---|
| A | Contrato funcional MVP | Listado cerrado de vistas y funciones actuales a replicar: Dashboard, Contactos, Ficha, Referidos, Coach reglas, KPIs, sync Google y export/import | La app local sigue siendo la referencia |
| B | Guardrails | Matriz de limites Supabase, Google APIs, hosting y IA; alertas y switches de apagado | No hay servicio pago sin limite/alerta definida |
| C | Capa de diseno y componentes | Tokens, botones, tablas, filtros, cards, Coach, referidos y graficos como componentes reutilizables y probados en desktop/mobile web | Un cambio visual comun se hace en un solo lugar |
| D | Modelo interno | Contactos propios de la app, medios de contacto, interacciones, participantes, referidos, ToDos, configs, cursores y auditoria en Postgres | Los IDs Google son referencias externas |
| E | Export local | Boton local para exportar data completa con version de schema y conteos | Export no modifica datos y puede repetirse |
| F | Import cloud | Importador cloud que deja la nube espejo del export local | Conteos y muestras calzan con la app local |
| G | Replica web responsive | Web cloud con vistas actuales, primero para 1 usuario y luego 2 usuarios beta, validada en desktop y mobile web | Comparacion local vs cloud aprobada |
| H | Google v1 read-only | Login y conexion Google para leer contactos, Gmail y Calendar; sin escribir en Google ni exportar contactos hacia Google | Sync incremental y logs visibles |
| I | Cierre beta | QA, backups descargables, monitoreo de uso y decision de corte parcial o mantener paralelo | Costos bajo control y rollback posible |

## Replica cloud por modulos

Cada modulo se replica triangulando tres fuentes: codigo local, vista real del usuario y vision/diseno aprobado. La decision por modulo no es copiar todo: se define que se conserva, que se mejora, que se elimina y que queda como deuda o backlog.

| Orden | Modulo | Referencia local a revisar | Que debe replicarse | Logica a cuestionar antes de migrar | Criterio de cierre |
|---|---|---|---|---|---|
| 1 | Dashboard: KPIs | `mostrar_vista_dashboard`, funciones de periodos, series KPI y fecha inicio networking | 3 graficos: total cafes, contactos realizados y contactos HH realizados; selector semanal/mensual; acumulados; maximo 12 periodos | Si los calculos deben vivir en UI, servicio cloud o queries agregadas; como contar primera interaccion, contactos distintos, HH y salientes; asegurar fecha calendario sin corrimiento por zona horaria | Cloud calza contra local en conteos, periodos y acumulados, con diferencias explicadas |
| 2 | Dashboard: Coach IA | Panel de ToDos, configuracion de reglas, burbujas, acciones y mascota del Coach | Coach conversacional, sugerencias activas, seleccion multiple, ejecutar seleccion, buscar nuevas sugerencias, configuracion por tipo de sugerencia y controles para silenciar/pedir confirmacion/autoaplicar | Separar reglas duras, hibridas e IA; evitar duplicados; cerrar sugerencias cuando ya no aplican; preparar acciones ejecutables por UI/regla/agente; no dejar botones visuales sin contrato de accion. No copiar reglas legado en bloque: migrarlas una por una con aprobacion del usuario, tier minimo y contrato completo | En curso funcional: `CoachModule` global muestra la mascota del Coach, burbujas, evidencia, links cortos y colores oficiales; permite seleccionar multiples sugerencias existentes, ejecutar cambios de estado `NETWORKING_STATUS_CHANGE`, descartar sugerencias, configurar tipos con `todo_configs`, buscar sugerencias RULE de estado networking, autoejecutar reglas seguras configuradas como "Ejecutar sin preguntar" y consultar historial colapsable del Coach con acciones y sugerencias cerradas. Pendiente para cierre: revision incremental por cambios, reglas HYBRID/IA, accion de revertir desde historial y ampliar catalogo de acciones solo regla por regla |
| 3 | Dashboard: Empresas headhunter | Agrupacion por dominio/empresa HH y filtros asociados | Tabla superior de empresas HH, agrupacion por dominio o sin email, ultimo contacto y estado mas avanzado | Fuente oficial del dominio, manejo de varios emails, `sin email`, y relacion con filtros de interacciones | Base cloud implementada: seleccion por empresa filtra Ultimas interacciones sin recarga completa; falta ajuste visual fino y pruebas de casos multiples/no email |
| 4 | Dashboard: Ultimas interacciones | Buckets de ultimo contacto, tabla de interacciones/contactos y links a ficha | Bloques de ultimo contacto, conteos MECE, tabla de contactos/interacciones y acceso a ficha | Calculo real de ultima interaccion, contactos sin interaccion, participantes multiples y direccion de email/mensaje | Conteos y filas calzan con local para los mismos filtros |
| 5 | Dashboard: Referidos sugeridos | Lectura de relaciones/referidos y reglas de accion | Lista de referidos accionables con contacto origen, vinculo y estado | Definir que hace accionable un referido; evitar duplicar flujo de referidos; usar objeto `referral` propio | Muestra los mismos casos relevantes y abre el flujo global de referido/contacto |
| 6 | Contactos: filtros, pipeline y tabla | Filtro global, pipeline, tabla y acciones masivas | Pipeline como filtro, filtros de tabla, orden, seleccion multiple, tabla con links a ficha | Mantener estado de filtros sin resets; default foco networking desde UI; no hardcodear filtros en codigo | El usuario puede llegar a cualquier contacto desde UI y los numeros del pipeline responden a filtros |
| 7 | Contactos: acciones | Acciones de foco, HH, estado, desactivar, opciones avanzadas | Acciones compactas globales, cambio masivo y confirmaciones | Acciones deben invocar contratos comunes, no logica de pantalla; registrar auditoria cuando corresponda | La accion masiva y la accion individual usan el mismo contrato |
| 8 | Ficha: datos y estado | Bloque de identidad, datos, toggles, estado y botones de contacto | Bloque superior blanco, emails/telefonos, toggles foco/HH, selector de estado y acciones futuras de mail/telefono/WhatsApp | IDs propios de la app vs IDs externos; campos editables; mobile/responsive | Primer corte cloud read-only implementado desde `ContactProfile`; pendiente acciones de edicion y ajuste fino contra maqueta/local |
| 9 | Ficha: interacciones | Timeline compacto, expansion, minuta editable, eliminacion segura y sync individual | Filas compactas por tipo, colores oficiales, expansion directa, editar minuta y eliminar con confirmacion | Modelo de participantes, contenido fuente vs minuta editable, hilos de correo, eventos sin contacto, soft-delete vs restauracion por sync | Cloud conecta lapiz y `+` con `InteractionEditorDialog`; usa `interactionActions.ts` para editar minuta y crear interaccion manual con auditoria; al crear, `sentido` parte como `Sin definir`; pendiente `interaction.dismiss` con soft-delete, sync individual y comparacion fina |
| 10 | Ficha: referidos | Tarjetas de referidos y popup `Referidos y contactos` | Tarjetas compactas, vinculo opcional, crear/editar referido y contacto | Usar editor oficial, validar duplicados, no mezclar apunte de referido con contacto real | Cloud conecta tarjetas con `ReferralEditorDialog`: crear/editar referido, vincular/desvincular contacto y abrir editor global de contacto; pendiente validacion UX |
| 11 | Ficha: Coach contextual | Coach filtrado al contacto | Misma burbuja/accion que Dashboard, filtrada al contacto | Si conviene embebido o flotante; mantener componente unico reutilizable | Implementado en cloud reutilizando `CoachModule` con `contactId`, variante y tamano; pendiente ajuste visual de densidad/acciones en modo ficha |
| 12 | Sync, import/export y conectores | Import cloud, sync Google contactos/Gmail/Calendar read-only y export espejo de respaldo/migracion | Importacion facil de contactos, export/import espejo, sync read-only Google, cursores, logs y derivacion a Fusionar contactos cuando haya conflictos | Capa de adaptadores; no depender de Google como fuente unica; limites de uso/costos; evitar fusiones automaticas cuando hay varios contactos o campos contradictorios. Exportar contactos hacia Google/proveedores no es prioridad v1 y debe quedar como capability premium futura | Datos se pueden refrescar sin romper la app local ni exceder cuotas. `Fusionar contactos` ya tiene contrato, workspace global, modal productivo, uso desde `Nuevos`, `Modificaciones`, `Duplicados fusionables` y revision local/manual de duplicados en Cuenta; la seleccion manual de contactos vive dentro del modal con `Agregar contacto guardado`. Los grupos complejos del sync se importan como candidatos independientes para revision posterior y, si tienen 2 o 3 contactos guardados, el conteo `guardados` abre la fusion profunda con esos contactos preseleccionados. `contactSyncApply` y `ContactDuplicateReviewPanel` ya usan `contact.merge_deep`/`merge_contacts_deep` para fusionar contactos guardados. RPC `merge_contacts_deep` ejecutada y verificada en Supabase dev. Para interacciones, `ActivitySyncButton` agrega entrada global incremental para contactos en foco y entrada individual en ficha sin mover cursores globales; Cuenta concentra reconstruccion historica Gmail/Calendar read-only con revision dry-run y aplicacion confirmada. Falta preview/log detallado y validacion con cuenta real |
| 13 | Acciones internas y automatizacion | Cambios de estado, editores, desactivacion, ToDos ejecutables | Catalogo de acciones para UI, reglas, Coach y futuro agente IA | Inputs/outputs claros, permisos, confirmaciones, auditoria y errores | Cada accion importante se puede invocar desde UI o regla sin duplicar codigo |
| 14 | Sistema visual y mobile | Guia UI, `/sistema/diseno`, componentes cloud y ficha local aprobada | Paleta, tipografia, botones, iconos, tablas, paneles, graficos y layout responsive | Detectar estilos hardcoded; asegurar que mobile no infle botones secundarios | Un ajuste de estilo comun se cambia en un solo lugar y pasa QA desktop/mobile |

### Checklist por modulo

Antes de cerrar cualquier modulo cloud:

1. Comparar contra la vista local real y contra la vision de producto.
2. Leer las funciones locales que alimentan esa seccion.
3. Marcar decision por pieza: replicar, mejorar, eliminar o dejar pendiente.
4. Confirmar si existe componente o funcion global reutilizable antes de crear otra.
5. Validar datos importados contra local con conteos o muestras.
6. Probar desktop y mobile web.
7. Actualizar documentacion viva y backlog si aparece deuda o mejora futura.

## Contrato export/import espejo

Estado: definido v0.1 en `docs/DATA_MODEL_BLUEPRINT.md`.

Resumen:

- Export local implementado como `.zip` con `manifest.json`, tablas normalizadas, snapshots raw opcionales y `validation_report.json`.
- Incluye contactos, interacciones, referidos, ToDos, configuraciones, cursores, review state y parametros globales.
- No incluye credenciales, tokens OAuth, variables `.env`, claves Supabase ni secretos.
- Primer import cloud se hara sobre usuario destino vacio o recien creado, con preview de conteos antes de insertar.
- El objetivo es comparar app local vs cloud antes de cortar cualquier flujo.

Preview automatizado ejecutado:

- Herramienta: `cloud/importer/preview_export.py`.
- Cargador controlado: `cloud/importer/load_export.py`.
- ZIP revisado: `crm-networking-export-20260727-114755.zip`.
- Resultado: version ok, archivos requeridos ok, hashes ok, 0 errores bloqueantes, 2 advertencias no bloqueantes.
- Conteos origen: 1357 contactos, 302 interacciones, 6 referidos, 22 ToDos, 18 configs de ToDos, 3 cursores sync y 1 parametro global.
- Estimacion destino: 1357 contactos, 434 emails, 1463 telefonos, 302 interacciones, 302 participantes, 6 referidos, 22 ToDos, 18 configs, 3 cursores y 1 `import_batch`.
- Dry-run de carga: ok. Conteos planeados deduplicados: 1357 contactos, 434 emails, 1463 telefonos, 232 interacciones unicas, 233 participantes, 6 referidos, 22 ToDos, 18 configs, 3 cursores, 1 setting y 1 `import_batch`.
- Carga real ejecutada: 1357 contactos, 434 emails, 1463 telefonos, 232 interacciones unicas, 233 participantes, 6 referidos, 22 ToDos, 18 configs, 3 cursores, 1 setting y 1 `import_batch`.
- Verificacion de conteos post-import: usuario confirma que `cloud/supabase/verify_import_counts_v0_1.sql` calza con lo esperado.

## Schema Supabase/Postgres v0.1

Estado: ejecutado en Supabase dev `crm-networking-dev`.

Archivo: `cloud/supabase/schema_v0_1.sql`.

Verificacion post-ejecucion: `cloud/supabase/verify_schema_v0_1.sql`.

Incluye:

- contactos propios de la app y referencias externas por proveedor;
- emails, telefonos e interacciones con participantes;
- referidos como objeto propio;
- ToDos, configuraciones y control anti reproceso del Coach;
- registro de acciones internas solicitadas o ejecutadas por usuario, reglas, IA o sistema;
- cursores de sync, import/export, auditoria, KPIs y limites de uso;
- RLS por `user_id` para aislar usuarios desde el inicio.

Siguiente paso antes de correrlo en Supabase:

- tablas verificadas: CSV exportado muestra 22 tablas existentes;
- RLS verificado: CSV exportado muestra 22 tablas con RLS activo;
- policies verificadas: CSV exportado muestra 22 policies creadas;
- preparar una prueba chica de import con preview de conteos, sin tocar la app local.

## Guardrails iniciales de costo

- Supabase Free alcanza para un uso personal/beta chica si el volumen se mantiene dentro de sus limites de base, storage y egress. Antes de pasar a Pro, revisar costo mensual esperado y activar Spend Cap.
- La app debe tener limites propios aunque el proveedor tenga plan gratis: maximo de sync manual por dia, maximo de ventanas historicas por sync, backoff ante errores, logs de consumo y boton para pausar conectores.
- Google APIs deben usarse con sync incremental cuando exista cursor/historial. Las importaciones historicas completas deben quedar en opciones avanzadas y con confirmacion.
- IA queda fuera del MVP cloud inicial salvo reglas duras; cuando se active IA, debe tener limite diario/semanal por usuario y cache/control anti reproceso.
- Web responsive/PWA es el camino inicial para mobile. Cada vista nueva debe probarse en pantalla chica, evitando botones secundarios a ancho completo y layouts que se deformen. Expo/native queda como decision futura si aparecen necesidades reales como push nativo, share sheet, almacenamiento local avanzado o distribucion en stores.

## Permisos OAuth Google v1

Objetivo: leer/importar/sincronizar, no escribir.

Scopes candidatos a validar en implementacion:

- Perfil/login: `openid`, `email`, `profile`.
- Contactos: `https://www.googleapis.com/auth/contacts.readonly`.
- Calendario: `https://www.googleapis.com/auth/calendar.readonly`.
- Gmail: idealmente partir con `https://www.googleapis.com/auth/gmail.metadata` si alcanza para busqueda/deteccion; usar `https://www.googleapis.com/auth/gmail.readonly` solo si necesitamos cuerpo del correo para minutas/preview.

No usar en v1 sin aprobacion explicita: `contacts`, `gmail.modify`, `gmail.compose`, `gmail.send`, scopes de Calendar con escritura o el scope amplio `mail.google.com`.

Nota operativa: si `gmail.readonly` no aparece en el buscador de scopes del consent screen, se valida al crear el cliente OAuth y se puede agregar pegando el scope completo o solicitandolo desde la app. No bloquea el trabajo de export/import ni el diseno de base.

## Referencias externas a revalidar

Estos limites/precios son baseline de planificacion y deben revisarse en fuentes oficiales antes de activar billing, deploy o una beta con otro usuario:

- Supabase Pricing y Cost Control: Free para beta chica; Pro desde USD 25/mes; Spend Cap disponible en Pro y con cobertura parcial de items de uso.
- Expo/EAS Pricing: Free con builds/updates limitados; util solo si se decide empaquetar app nativa o usar Expo en el futuro.
- Google APIs: revisar cuotas vigentes de Gmail, Calendar y People API; usar sync incremental, backoff y limites por usuario.
- Google OAuth scopes: priorizar scopes read-only y granular consent.

## Criterio para cerrar Fase 0

- Documentos renombrados y con objetivo claro.
- Backlog convertido a tabla priorizable.
- Plan actual conectado al backlog.
- `AGENTS.md` consolidando reglas de trabajo para Codex.

## Criterio para cerrar Fase 1

- Contactos, interacciones, ToDos y sync tienen funciones/capa de datos centralizada.
- Las integraciones externas pasan por una capa de adaptadores con interfaces comunes.
- Google queda implementado como primer proveedor, no como supuesto unico del producto.
- Existe un mapa de funciones relevantes, duplicidades y decisiones de refactor antes de construir la replica cloud.
- La nueva plataforma no copia acoplamientos innecesarios de `app.py`; separa UI, datos, integraciones, reglas, KPIs, ToDos y autenticacion.
- La app funciona igual que antes.
- Las escrituras directas a Sheets estan reducidas o localizadas.
- Existe una estrategia clara para migrar esa capa a Postgres.

## Criterio para cerrar Fase 2

- La app local tiene un boton de exportar data completa.
- El export incluye contactos, emails, telefonos, interacciones, participantes, minutas/notas editables, relaciones, ToDos, configuracion, cursores y auditoria disponible.
- El archivo exportado tiene version de schema y fecha de generacion.
- La app cloud puede importar el archivo y quedar como espejo funcional de la app local.
- Existe una validacion de conteos y muestras entre local y cloud.

## Principios de migracion cloud

- La app local sigue funcionando durante toda la transicion.
- La nube se construye primero como replica comparable, no como reemplazo inmediato.
- No se corta Google Sheets hasta que la nube replique datos, vistas principales y resultados clave.
- Las fuentes y servicios externos se conectan mediante adaptadores: Google, Apple, Microsoft/Outlook, CSV/Excel, mensajeria, IA, notificaciones y futuras integraciones.
- Para el MVP cloud solo se implementa Google como conector activo. Apple, Microsoft/Outlook y otros servicios quedan disenados en la capa, pero no construidos en v1.
- El modelo interno debe usar contactos, medios de contacto, interacciones y participantes como conceptos propios de la app, no conceptos exclusivos de Google.
- Cada usuario cloud debe tener datos aislados, cuentas conectadas propias y posibilidad de descargar respaldo.
- Cada paso cloud debe pasar por revision de arquitectura: que se reutiliza, que se mejora, que duplicidad se elimina y que documentos se actualizan.
- Los cambios con impacto en datos, permisos, OAuth, costos o privacidad requieren explicacion previa y confirmacion del usuario.
- La app debe preferir responsive web/PWA antes que app nativa para reducir mantencion. No bloquear una futura app mobile, pero no asumirla como requisito del MVP.

## Historial

- 2026-07-15: Se renombra `TRANSITION_PLAN` a `CURRENT_PLAN` y se enfoca en plan de trabajo actual conectado al backlog.
- 2026-07-20: Se ajusta plan cloud para mantener app local como base, agregar export/import espejo y crear capa agnostica de fuentes/servicios.
- 2026-07-20: Se agrega criterio de migracion prolija: auditar duplicidades, separar responsabilidades y pedir permisos ante impactos sensibles.
- 2026-07-21: Se agrega rediseño modular de ficha de contacto como tramo funcional previo a seguir con plataforma cloud.
- 2026-07-21: Se implementa primera version activa de la ficha modular basada en maqueta y queda pendiente revision visual fina.
- 2026-07-21: Se agrega trabajo de componentes reutilizables UI al plan inmediato; Coach y referidos inician esa migracion.
- 2026-07-22: Se reordena la revision de ficha: punto 6 robot compacto, punto 7 bloque info, punto 8 flujo crear/vincular referidos.
- 2026-07-22: Se implementan ajustes de punto 6 y 7 en ficha: robot mini con dimensiones reales, botones estandar y tarjetas de correo/telefono con borde.
- 2026-07-22: Se redefine el punto de referidos: primero modelo ampliado, luego editor oficial de contacto, editor oficial de referido y finalmente reemplazo del flujo de ficha.
- 2026-07-22: DATA-006 avanza con soporte de lectura/escritura normalizada para referidos legacy/ampliados; proximos pasos: CONTACT-010 y CONTACT-011.
- 2026-07-22: CONTACT-010 avanza con editor global de contacto, validaciones y proteccion de contactos nativos de la app.
- 2026-07-22: CONTACT-011 avanza con helper oficial de referido y el popup legacy pasa a delegar en esa escritura centralizada.
- 2026-07-22: Se reemplaza el popup legacy por `Referidos y contactos`, con referido editable, contacto vinculado opcional y editor de contacto reutilizable.
- 2026-07-22: Se agrega identidad app transicional para contactos (`Contact_ID`) y metadatos de proveedor, paso previo a separar proveedores externos de la fuente de verdad de la app.
- 2026-07-22: Se ajusta plan cloud MVP: todo lo actual pero ordenado, Google-only v1, app local viva, export/import espejo, guardrails de costo, OAuth read-only y web responsive/PWA antes que app nativa.
- 2026-07-22: Se agrega validacion obligatoria desktop/mobile web para interfaz, con foco en botones compactos, toolbars y layouts que no se deformen en pantalla chica.
- 2026-07-22: Usuario deja listas las plataformas base: GitHub repo `crm-networking-cloud`, Supabase `crm-networking-dev` en Americas, Vercel y Google Cloud `crm-networking-dev` con APIs activadas; queda pendiente validar/agregar `gmail.readonly`.
- 2026-07-22: Se define contrato export/import espejo v0.1 y el siguiente paso pasa a ser implementar el boton local de export ZIP sin modificar datos.
- 2026-07-22: Se implementa boton `Exportar` en opciones avanzadas de Contactos para generar ZIP espejo local; queda pendiente validar descarga/contenido con datos reales.
- 2026-07-22: Usuario confirma descarga exitosa del ZIP espejo local. Siguiente paso: disenar schema Postgres inicial e import cloud.
- 2026-07-27: Se crea schema Supabase/Postgres v0.1 local en `cloud/supabase/schema_v0_1.sql`; queda pendiente aprobacion y ejecucion controlada en Supabase dev.
- 2026-07-27: Se agrega TECH-006 para catalogar acciones internas ejecutables por UI, reglas y Coach IA, con contratos, confirmacion y trazabilidad.
- 2026-07-27: Se agrega `cloud/supabase/verify_schema_v0_1.sql` para validar tablas, RLS y policies despues de ejecutar el schema.
- 2026-07-27: Usuario ejecuta `schema_v0_1.sql` en Supabase dev con exito. CSVs exportados confirman 22 tablas existentes, 22 policies creadas y RLS activo en las 22 tablas. DATA-002 queda cerrado.
- 2026-07-27: Se crea `cloud/importer/preview_export.py` y se prueba contra el ZIP espejo real mas reciente; preview sin errores bloqueantes, con 2 advertencias no bloqueantes.
- 2026-07-27: Se crea `cloud/importer/load_export.py` con dry-run por defecto y proteccion contra cargar sobre un usuario con datos existentes; dry-run validado contra ZIP real.
- 2026-07-27: Se corrige import para JSONB y para consolidar interacciones duplicadas como una interaccion con participantes. Usuario ejecuta carga real con `--apply` y Supabase recibe los conteos planeados.
- 2026-07-27: Se agrega `cloud/supabase/verify_import_counts_v0_1.sql` para confirmar conteos cargados en Supabase.
- 2026-07-27: Usuario confirma verificacion SQL post-import; se crea `cloud/web` como primera app Next/React conectable a Supabase en modo solo lectura, con dependencias instaladas, typecheck/build ok y pendiente configurar `.env.local` para validar en navegador.
- 2026-07-27: `cloud/web` se valida en navegador con datos reales. Se agrega capa comun de lectura y se corrige Contactos para cargar todos los contactos activos en vez de una muestra inicial.
- 2026-07-27: Se agrega anexo visual cloud `/sistema/diseno` y componentes UI globales para iconos, botones y tarjetas metricas.
- 2026-07-28: Dashboard cloud inicia rediseño modular read-only con componentes globales para panel, pipeline, Coach preview y tarjetas recientes; se prueba en desktop y mobile web.
- 2026-07-28: Dashboard cloud se reordena para calzar con el Dashboard local: KPIs superiores, Coach IA, Empresas headhunter, Ultimas interacciones y Referidos sugeridos.
- 2026-07-28: Coach cloud deja de ser solo lectura para cambios de estado: permite seleccionar ToDos activos, ejecutar los soportados, actualizar el estado del contacto, marcar el ToDo como `done`, descartar sugerencias como `dismissed` y registrar acciones. No se migra aun generacion/revision de reglas ni configuracion por tipo.
- 2026-07-28: Coach cloud agrega configuracion por tipo de sugerencia desde `todo_configs`: lista 18 reglas agrupadas por RULE, HYBRID e IA, con modos `confirm_always`, `execute_without_asking` y `do_not_suggest`. La configuracion no borra sugerencias activas todavia; eso queda para revision de sugerencias vivas.
- 2026-07-28: Coach cloud agrega motor `RULE` inicial para cambios de estado networking: revisa contactos/interacciones importados en Supabase, respeta foco/contacto activo, aplica prelacía documentada, crea o mantiene una sugerencia por contacto, cierra sugerencias inferiores o no vigentes y guarda `object_review_state`. El boton del Coach "Buscar sugerencias" queda conectado; no sincroniza Google todavia.
- 2026-07-28: Coach cloud agrega autoejecucion para reglas seguras marcadas como "Ejecutar sin preguntar" al correr la revision de sugerencias, usando la misma accion interna que la ejecucion manual.
- 2026-07-28: Historial del Coach cloud se simplifica como log de sugerencias no vigentes: lee `todos` cerrados (`done`, `dismissed`, `expired`, `auto_resolved`), muestra el mismo mensaje de la burbuja activa, stamp de estado/autor/fecha, filtros por estado y detalle colapsable con motivo de cierre, regla, evidencia legible y link al contacto.
- 2026-07-28: Se agrega plan de replica cloud por modulos, triangulando codigo local, vista real y vision/diseno antes de decidir que replicar, mejorar o eliminar.
- 2026-07-29: Se inicia la Ficha de contacto cloud como bloque madre read-only: tabla de Contactos abre `/contactos?contactId=...`, `ContactProfile` muestra datos, interacciones, referidos y Coach contextual reutilizando `CoachModule`.
- 2026-07-30: Ficha cloud conecta referidos al flujo global `Referidos y contactos`, reutilizando `ContactEditorDialog` para crear/editar contactos vinculados.
- 2026-07-30: Ficha cloud conecta interacciones al flujo global `InteractionEditorDialog` para editar minutas y crear interacciones manuales desde el contacto.
- 2026-07-30: Se implementa primera version cloud de eliminacion segura de interacciones: `interaction.dismiss` archiva via `metadata`, escribe columnas soft-delete si existen, registra `action_invocations`/`audit_log`, y ficha/Dashboard/Coach filtran interacciones archivadas. Queda pendiente ejecutar/formalizar migracion SQL y configurar bloqueo/restauracion de reimportacion por sync.
- 2026-07-30: Se prepara el modelo app+origen externo para interacciones: schema e importador agregan `external_interaction_sources` para guardar IDs externos, thread, detalle fuente, hash, estado de sync y control de reimportacion. Pendiente ejecutar migracion en Supabase y conectar UI/iconos/link al origen.
- 2026-07-30: Se prepara diagnostico de interacciones duplicadas por origen externo y se define regla de Coach multi-contacto: una sugerencia compartida aparece en varias fichas pero sigue siendo un solo ToDo.
- 2026-07-30: Ficha cloud agrega indicador informativo de interaccion compartida: usa `interaction_participants`, icono `users` y tooltip con participantes por rol (`De`, `Para`, `CC`, `CCO`) sin convertirlo en boton de accion.
- 2026-07-30: Ficha cloud agrega indicador de origen externo para interacciones vinculadas a proveedor: lee `external_interaction_sources`, muestra icono Google y abre Gmail si hay ID usable; Calendar queda como origen vinculado sin link hasta poblar `htmlLink`.
- 2026-07-30: Se crea capa comun agnostica de sync de interacciones externas (`externalInteractionSync.ts`): los adaptadores de proveedor entregaran objetos normalizados y esta capa crea/actualiza interacciones, origen externo, participantes y punteros de revision sin depender directamente de Google.
- 2026-07-30: Se crea adaptador Google de interacciones (`googleInteractionAdapter.ts`) con pruebas: mapea Gmail/Calendar al formato comun, soporta `TO`/`CC`/`BCC`, descarta correos de terceros donde usuario/contacto solo estan copiados y conserva `htmlLink` de Calendar.
- 2026-07-30: Se crea orquestador comun de sincronizacion cloud (`syncOrchestrator.ts`): expone funciones reutilizables para mail/calendario con inputs/outputs de lote, conteos, errores, dry-run, alcance y objetos afectados. Contactos queda con contrato seguro que exige preview/confirmacion antes de aplicar cambios.
- 2026-07-31: Se crea preview global de sincronizacion cloud (`SyncPreviewDialog`) y tipos `SyncPreviewChange`: la UI agrupa nuevos/modificados/consolidaciones/desactivaciones/eliminados en tarjetas seleccionables y devuelve al flujo llamador que aplicar, sin escribir datos por si misma.
- 2026-07-31: `SyncPreviewDialog` pasa a pestanas por tipo de cambio: `Nuevos`, `Modificaciones`, `Duplicados fusionables`, `Duplicados complejos`, `Eliminaciones` y `Sin cambios`; cada pestana accionable maneja su propia seleccion/aplicacion y la pestana de eliminaciones deja preparada la accion `No eliminar ni volver a sugerir`.
- 2026-07-31: Se agrega `contactSyncPreview.ts`, motor puro de comparacion app vs fuente conectada para contactos. Genera preview sin escribir datos y valida reglas clave: campos vacios de fuente no eliminan datos locales, enriquecimiento de campos vacios, eliminacion multivalor solo si el dato era conocido como importado desde esa fuente y soporte de supresiones.
- 2026-07-31: Se agrega `ContactSyncPreviewSandbox` en `/sistema/diseno` para probar el preview de contactos con datos reales de la app y una fuente simulada, sin escritura ni Google real.
- 2026-07-31: Se agrega `googleContactAdapter.ts` para normalizar personas de Google People API al contrato externo comun de contactos, incluyendo `deleted` y `previousResourceNames`, sin conectar aun OAuth ni llamar APIs reales.
- 2026-07-31: Se agrega `googleContactsClient.ts`, cliente read-only para People API `people/me/connections`: soporta paginacion, `requestSyncToken`, `syncToken`, `nextSyncToken`, limite de paginas y error explicito cuando Google informa `EXPIRED_SYNC_TOKEN`.
- 2026-07-31: Se agrega `syncCursorStore.ts`, helper global para leer, guardar y marcar cursores vencidos en Supabase. Siguiente paso: conectar el flujo real de contactos Google para leer incremental, generar preview y guardar `nextSyncToken` solo despues de aplicar o cerrar correctamente la revision.
- 2026-07-31: Se agrega `googleContactSyncFlow.ts`, que prepara el preview real de Google Contacts conectando app contacts, referencias externas, valores conocidos por fuente, cursor guardado y cliente Google read-only. Si el cursor vence, marca el cursor como vencido y reintenta lectura completa. Pendiente: aplicar cambios seleccionados y guardar el nuevo cursor al cerrar correctamente el flujo.
- 2026-07-31: Se agrega `contactSyncApply.ts`, accion oficial para aplicar cambios seleccionados del preview de contactos. Guarda el cursor nuevo solo cuando se aplico todo lo revisado sin errores; si el usuario deja cambios sin seleccionar, quedan pendientes para la siguiente sincronizacion.
- 2026-07-31: El sandbox de `/sistema/diseno` ahora usa el aplicador oficial de preview de contactos en modo simulado. Permite probar seleccion, cambios pendientes y cursor sin escribir datos reales; siguiente paso es conectar esta misma accion al flujo real de Google Contacts/OAuth.
- 2026-07-31: Se conecta en `Sistema` una primera UI real para Google Contacts: boton de conexion OAuth read-only, revision incremental/completa, preview con seleccion y aplicacion confirmada en Supabase cloud. Pendiente validar configuracion OAuth real y mover el acceso final a ubicacion de producto cuando este estable.
- 2026-08-03: Se crea `/cuenta` como ubicacion de producto para perfil, plan, conexiones y sync delicado; Google Contacts sale de `Sistema` y OAuth retorna a Cuenta.
- 2026-08-03: Se pausa `No eliminar ni volver a sugerir` por confusion de usabilidad. La tabla dev queda creada, pero la app no la usa hasta redisenar esa decision como accion separada.
- 2026-07-31: Sync de contactos cloud agrega pestana `Sin cambios` y fusiona varios objetos externos que apuntan al mismo contacto app en una sola linea de preview, conservando todos los IDs externos para enlazarlos al aplicar.
- 2026-07-31: Se ajusta el preview de contactos para evitar falsos "nuevos": si Google trae un ID externo no enlazado pero el correo o telefono coincide con un contacto existente, el cambio pasa a consolidacion/enlace. Caso testigo agregado: Jorge Kehdy.
- 2026-08-03: `Fusionar contactos` deja de ser solo maqueta: se crea contrato `contactMerge`, workspace global, modal `ContactMergeDialog` y conexion desde `SyncPreviewDialog` en `Nuevos`, `Modificaciones` y `Duplicados fusionables`; el aplicador guarda el resultante definido por el usuario al crear, modificar o enlazar el contacto. El preview de sync remueve localmente los cambios aplicados y conserva pendientes sin releer el proveedor.
- 2026-08-04: Sync de contactos separa duplicados en dos pestanas: `Duplicados fusionables` solo cuando hay 2 o 3 contactos origen y exactamente 1 contacto guardado; `Duplicados complejos` cuando hay 4 o mas contactos conectados, o multiples contactos guardados, y deben importarse como candidatos independientes para resolver despues con revision de duplicados.
- 2026-08-03: Se prepara `contact.merge_deep`: wrapper `contactMergeActions.ts`, pruebas de normalizacion y SQL `merge_contacts_deep_v0_2.sql` para fusion transaccional de contactos app. `contactSyncApply` ya detecta propuestas con mas de un contacto guardado y las deriva a esta accion profunda.
- 2026-08-04: Usuario ejecuta y verifica `merge_contacts_deep_v0_2.sql` en Supabase dev. `verify_merge_contacts_deep_v0_2.sql` confirma `public.merge_contacts_deep(p_target_contact_id uuid, p_source_contact_ids uuid[], p_result jsonb, p_source text)`, `security_definer=false`, `volatility=v`. Pendiente validar con caso real controlado.
- 2026-08-04: Cuenta agrega `Revision de duplicados`: `contactDuplicateReview` detecta duplicados guardados por correo/telefono normalizado, incluidos grupos indirectos, y `ContactDuplicateReviewPanel` reutiliza `ContactMergeDialog` y `merge_contacts_deep` para fusionar grupos detectados o una fusion manual iniciada desde boton simple. La busqueda de contactos se mueve al modal global (`Agregar contacto guardado`, maximo 3). En sync, `Duplicados complejos` permite abrir ese mismo modal desde el conteo de guardados cuando hay 2 o 3 contactos internos.
- 2026-08-04: Sync cloud de interacciones avanza en capa tecnica: `googleInteractionClient.ts` lee Gmail/Calendar read-only con limites y errores controlados, y `googleInteractionSyncFlow.ts` conecta lectura, adaptadores, cursores y orquestador comun de interacciones en modo incremental/dry-run. Queda pendiente conectar OAuth real, UI de Cuenta, preview/log y validacion con una cuenta real antes de activarlo para usuario.
- 2026-08-10: Se baja prioridad a exportar/sincronizar contactos hacia Google u otros proveedores. Importar contactos hacia la app sigue siendo prioritario para reducir friccion de entrada; exportar contactos queda como capacidad premium futura con reglas anti-abuso, cuotas y condiciones comerciales por definir. Coach IA no debe copiar reglas legacy en bloque: cada regla se revisara y migrara una por una con confirmacion del usuario, tier minimo y contrato completo.
- 2026-08-11: Cuenta agrega panel beta `GoogleInteractionsSyncPanel` para Gmail/Calendar: reutiliza `syncGoogleInteractions`, solicita scopes read-only junto con contactos, corre revision dry-run sin escribir, limita a 20 correos, 20 eventos y 2 paginas por corrida, y solo escribe interacciones al presionar `Aplicar sincronizacion`. Luego se agrega resumen visible reutilizable (`InteractionSyncResultSummary` + `interactionSyncText`) para explicar encontrados en Google, posibles, nuevos, modificados y omitidos sin duplicar wording con el boton global. Falta preview detallado por interaccion, log persistente visible y validacion con cuenta real.
- 2026-08-11: Sync de actividad se separa por entrada de uso: `Cuenta` queda para reconstruccion historica desde `Fecha_Inicio_Networking` sin mover cursores; la barra superior agrega accion incremental rapida para contactos en foco; la ficha agrega accion individual para un contacto, usando query por correo y sin guardar cursores globales. Todo reutiliza `syncGoogleInteractions`.
