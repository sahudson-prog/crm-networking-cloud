# Current architecture

Este documento describe la arquitectura actual del codigo. Es una foto tecnica viva: debe actualizarse cuando cambie la estructura, se extraigan modulos o se eliminen/creen funciones relevantes.

## Resumen

La aplicacion es monolitica. `app.py` concentra UI Streamlit, integraciones Google, persistencia en Google Sheets, transformaciones de datos, reglas de negocio, dashboard, ToDos y sincronizacion.

Esto permitio avanzar rapido, pero hoy genera riesgos:

- muchas responsabilidades en un solo archivo;
- acceso a Google Sheets disperso;
- logica de UI mezclada con reglas y persistencia;
- dificil testeo unitario;
- refactors con mayor riesgo de romper flujos existentes.

## Componentes actuales

| Componente | Responsabilidad actual | Riesgo |
|---|---|---|
| UI Streamlit | Render de paginas, tablas, popups y acciones | Mezcla comportamiento visual con logica de negocio |
| Google Auth | OAuth local con `credentials.json` y `token.json` | No sirve directamente para multiusuario en nube |
| Google Sheets | Base de datos actual | Escrituras y rangos dispersos |
| Gmail sync | Importar correos y asociarlos a contactos | Dedupe y participantes requieren cuidado |
| Calendar sync | Importar citas asociadas a contactos | Eventos pueden involucrar multiples contactos |
| Contacts sync | Importar/actualizar datos desde Google Contacts | Cambios de email/ID pueden afectar historial |
| ToDos/Coach IA | Generar y configurar sugerencias accionables | Debe evitar duplicados y reprocesos |
| Dashboard/KPIs | Calcular metricas, filtros y agrupaciones | Logica analitica mezclada con render |

## Inventario de funciones

| Funcion | Area | Para que sirve |
|---|---|---|
| `sincronizar_gmail_contacto` | Gmail legacy | Sincroniza correos para un contacto especifico y los guarda como interacciones. |
| `extraer_cuerpo_completo_gmail` | Gmail | Extrae texto legible desde el payload de Gmail. |
| `mostrar_popup_detalle_global` | UI / interacciones | Muestra detalle editable/expandido de una interaccion. |
| `sincronizar_calendar_contacto` | Calendar legacy | Busca eventos de calendario asociados a un contacto. |
| `sincronizar_lote_completo_scope` | Sync masivo | Sincroniza contactos en foco de networking. |
| `asegurar_hoja_sync_state` | Sheets / sync | Crea o asegura la hoja de cursores de sincronizacion. |
| `leer_sync_state` | Sheets / sync | Lee cursores y estados de sincronizacion incremental. |
| `guardar_sync_state` | Sheets / sync | Guarda cursores y estados de sincronizacion incremental. |
| `leer_ids_interacciones_existentes` | Interacciones | Lee IDs existentes para evitar duplicados. |
| `columnas_interacciones` | Modelo actual | Define columnas esperadas de `Interacciones`. |
| `construir_thread_id_gmail` | Gmail / dedupe | Normaliza el ID de hilo Gmail. |
| `normalizar_email_para_id` | Utilidad | Convierte emails en texto seguro para IDs internos. |
| `construir_id_entrada_interaccion` | Interacciones | Crea ID interno de interaccion por fuente/email. |
| `construir_indice_contactos_scope` | Contactos | Construye indice de contactos en foco por email. |
| `extraer_emails_desde_headers` | Gmail | Extrae emails desde headers de Gmail. |
| `emails_gmail_por_header` | Gmail | Obtiene emails de un header especifico. |
| `participantes_gmail_en_scope` | Gmail / contactos | Identifica contactos relevantes en un correo Gmail. |
| `fila_interaccion_desde_mensaje_gmail` | Gmail / interacciones | Convierte un mensaje Gmail en fila de interaccion. |
| `filas_interacciones_desde_mensaje_gmail` | Gmail / interacciones | Genera una o varias interacciones por mensaje segun participantes. |
| `sincronizar_gmail_reciente_scope` | Gmail sync | Sincroniza mensajes recientes para contactos en foco. |
| `sincronizar_gmail_incremental_scope` | Gmail sync | Sincroniza Gmail usando estado incremental. |
| `evento_calendar_menciona_contacto` | Calendar | Detecta si un evento menciona contactos en foco. |
| `fila_interaccion_desde_evento_calendar` | Calendar / interacciones | Convierte evento Calendar en fila de interaccion. |
| `sincronizar_calendar_incremental_scope` | Calendar sync | Sincroniza Calendar usando cursores incrementales. |
| `sincronizar_cambios_incrementales_scope` | Sync global | Ejecuta sincronizacion incremental de Gmail/Calendar. |
| `autenticar_google` | Auth | Maneja OAuth local y refresco de token. |
| `leer_sheet_local` | Sheets / contactos | Lee contactos desde `CRM_Contactos_Extra`. |
| `leer_fecha_inicio_config` | Config | Lee fecha historica de inicio desde `CRM_Config`. |
| `extraer_dominios_desde_emails` | Headhunters | Obtiene dominios desde emails. |
| `listar_dominios_headhunter` | Headhunters | Lista dominios asociados a un contacto HH. |
| `construir_resumen_dominios_headhunter` | Dashboard HH | Agrupa empresas headhunter por dominio. |
| `columnas_relaciones_legacy` | Relaciones modelo | Define las columnas historicas de `CRM_Relaciones`. |
| `columnas_referidos_expandidas` | Relaciones modelo | Define las columnas ampliadas soportadas para referidos como objeto propio. |
| `columnas_relaciones` | Relaciones modelo | Expone el esquema vigente de `CRM_Relaciones` para lectura/escritura. |
| `generar_referido_id` | Relaciones modelo | Crea un ID estable para filas legacy que no tienen identificador propio. |
| `normalizar_relaciones_df` | Relaciones modelo | Convierte datos legacy o ampliados a un DataFrame canonico compatible. |
| `leer_relaciones_sheet` | Relaciones | Lee relaciones/referidos desde Sheets. |
| `guardar_relaciones_sheet` | Relaciones | Guarda relaciones/referidos con encabezados ampliados y datos normalizados. |
| `clave_relacion` | Relaciones | Obtiene clave estable de una relacion usando `Referido_ID` o hash legacy. |
| `condicion_relacion_por_clave` | Relaciones | Identifica filas de referidos por clave estable. |
| `construir_fila_referido_editor` | Relaciones editor | Construye una fila canonica de referido desde datos libres y vinculo opcional. |
| `guardar_referido_editor_en_sheet` | Relaciones editor | Guarda referido nuevo o editado validando datos minimos y formatos. |
| `upsert_relacion_contacto` | Relaciones | Inserta o actualiza un referido manteniendo campos legacy y ampliados espejados. |
| `eliminar_relacion_contacto` | Relaciones | Elimina una fila de referido desde Sheets por clave estable. |
| `opciones_contactos_por_id` | UI Relaciones editor | Construye opciones de contacto por ID para evitar ambiguedad por nombres duplicados. |
| `obtener_fila_contacto_por_id` | UI Relaciones editor | Obtiene la fila de contacto vinculada para renderizar o editar. |
| `datos_referido_desde_state` | UI Relaciones editor | Lee el borrador del referido desde `session_state`. |
| `prefill_contacto_desde_referido` | UI Relaciones editor | Prepara datos iniciales de contacto a partir del referido. |
| `html_contacto_vinculado_referido` | UI Relaciones editor | Renderiza la tarjeta de solo lectura del contacto vinculado. |
| `columnas_todos_ia` | ToDos modelo | Define columnas de `CRM_ToDos`. |
| `tipos_todos_ia` | ToDos catalogo | Enumera tipos funcionales de sugerencias. |
| `catalogo_automatizaciones_todo` | ToDos config | Define automatizaciones disponibles y sus metadatos. |
| `orden_motor_todo` | ToDos UI | Ordena reglas, hibridos e IA por complejidad. |
| `orden_accion_todo` | ToDos UI | Ordena tipos de acciones por impacto. |
| `tipo_config_para_regla_estado_networking` | ToDos config | Mapea reglas de estado a configuraciones granulares de usuario. |
| `prioridad_regla_estado_networking` | ToDos reglas | Define prelacion entre reglas de estado del Coach IA. |
| `elegir_sugerencia_estado_preferente` | ToDos reglas | Elige la sugerencia de mayor prelacion entre reglas que cumplen condiciones. |
| `tipo_config_para_todo` | ToDos config | Obtiene la regla configurable concreta desde un ToDo. |
| `modo_ejecucion_todo` | ToDos config | Lee el modo vigente para una regla configurable. |
| `nombre_config_todo_usuario` | ToDos UI | Genera nombre corto y humano de una regla configurable. |
| `texto_ejemplo_config_todo` | ToDos UI | Genera ejemplo de comentario que el Coach puede mostrar. |
| `condicion_config_todo_usuario` | ToDos UI | Describe en lenguaje humano cuando aparece una regla. |
| `ordenar_config_todos` | ToDos UI | Ordena configuracion de automatizaciones. |
| `columnas_todo_config` | ToDos modelo | Define columnas de `CRM_ToDo_Config`. |
| `columnas_object_review_state` | ToDos modelo | Define columnas de control anti reproceso. |
| `asegurar_hoja_simple` | Sheets | Crea/asegura hojas con encabezados. |
| `leer_todo_config` | Sheets / ToDos | Lee configuracion de automatizaciones. |
| `guardar_todo_config` | Sheets / ToDos | Guarda configuracion de automatizaciones. |
| `leer_object_review_state` | Sheets / ToDos | Lee estado de revision de objetos. |
| `guardar_object_review_state` | Sheets / ToDos | Guarda estado de revision de objetos. |
| `estados_networking_oficiales` | Estados | Define estados oficiales de networking. |
| `columnas_fechas_crm_legacy` | Estados legacy | Lista columnas antiguas de hitos CRM. |
| `estado_por_columna_fecha_legacy` | Estados legacy | Mapea columnas legacy a estados. |
| `columna_fecha_para_estado_networking` | Estados | Devuelve columna de fecha asociada a estado. |
| `parse_fecha_hito_crm` | Estados | Convierte fechas de hitos CRM. |
| `calcular_estado_networking_desde_row` | Estados | Calcula estado desde columnas/hitos del contacto. |
| `normalizar_estado_networking` | Estados | Normaliza estados legacy/oficiales. |
| `nivel_estado_networking` | Estados | Asigna orden/nivel a cada estado. |
| `marca_estado_networking` | UI estados | Genera marca visual con color por estado. |
| `es_interaccion_saliente` | Interacciones | Determina si una interaccion fue saliente usando `Rol_Email` y fallback legacy. |
| `parse_fecha_interaccion` | Interacciones | Convierte fecha de interaccion a datetime. |
| `inicio_semana_lunes` | KPIs | Calcula inicio de semana en lunes. |
| `semanas_kpi` | KPIs | Genera semanas para graficos historicos. |
| `etiqueta_semana` | KPIs | Formatea etiqueta semanal. |
| `inicio_mes` | KPIs | Calcula inicio de mes. |
| `parse_fecha_inicio_networking` | KPIs/config | Interpreta fecha global de inicio de networking. |
| `periodos_kpi` | KPIs | Genera hasta 12 periodos semanales o mensuales desde la fecha global de inicio. |
| `fin_periodo_kpi` | KPIs | Calcula fin de periodo KPI. |
| `etiqueta_periodo_kpi` | KPIs | Formatea etiqueta de periodo. |
| `preparar_interacciones_con_fecha` | KPIs | Normaliza fechas de interacciones para calculos. |
| `serie_interacciones_periodos` | KPIs | Calcula serie temporal de interacciones. |
| `filtrar_interacciones_salientes_contacto` | KPIs/interacciones | Filtra correos, mensajes y WhatsApp salientes hacia contactos. |
| `acumulado_interacciones_hasta` | KPIs | Calcula acumulado de interacciones hasta una fecha. |
| `serie_contactos_realizados_periodos` | KPIs | Calcula contactos distintos realizados y primera vez por periodo. |
| `serie_dominios_hh_realizados_periodos` | KPIs HH | Calcula empresas/dominios HH realizados y primera vez por periodo. |
| `serie_interacciones_semanales` | KPIs | Compatibilidad para series semanales. |
| `fecha_minima_hitos` | KPIs/estados | Obtiene primera fecha entre hitos. |
| `serie_acumulado_estados_avanzados` | KPIs | Calcula acumulado de contactos avanzados. |
| `serie_dominios_hh_sin_contacto` | KPIs HH | Calcula empresas HH sin contacto reciente. |
| `formatear_pct_cambio` | KPIs UI | Formatea variacion porcentual. |
| `render_kpi_periodo` | UI KPIs | Renderiza grafico KPI semanal/mensual. |
| `render_kpi_semanal` | UI KPIs | Wrapper semanal de KPI. |
| `hash_texto_corto` | Utilidad | Crea hash corto para dedupe/control. |
| `thread_ids_desde_evidencia` | ToDos dedupe | Extrae hilos Gmail desde evidencia. |
| `dedup_key_recomendacion_por_thread` | ToDos dedupe | Crea clave anti duplicado por hilo. |
| `acciones_todo_estado_json` | ToDos acciones | Crea acciones JSON para cambio de estado. |
| `construir_todo_estado_networking` | ToDos reglas | Construye ToDo de cambio de estado. |
| `sugerir_estado_networking_para_contacto` | ToDos reglas | Sugiere estado correcto para un contacto. |
| `aplicar_todos_estado_networking_automaticos` | ToDos reglas | Aplica automaticamente cambios de estado configurados como seguros. |
| `ejecutar_todos_seleccionados_coach` | ToDos reglas | Ejecuta sugerencias seleccionadas en Coach IA y marca ToDos completados. |
| `generar_todos_estado_networking` | ToDos reglas | Genera pendientes de cambios de estado y evita duplicar sugerencias abiertas para el mismo contacto/estado. |
| `asegurar_hoja_todos_ia` | Sheets / ToDos | Crea/asegura hoja `CRM_ToDos`. |
| `leer_todos_ia` | Sheets / ToDos | Lee pendientes desde `CRM_ToDos`. |
| `guardar_todos_ia` | Sheets / ToDos | Guarda pendientes en `CRM_ToDos`. |
| `reiniciar_recomendaciones_ia` | ToDos | Limpia sugerencias y estado de revision. |
| `popup_configurar_automatizaciones_todo` | UI ToDos | Configura automatizaciones y reset. |
| `parse_json_seguro` | Utilidad | Parse JSON tolerante a errores. |
| `texto_sugerencia_todo` | UI ToDos | Genera texto descriptivo de sugerencia. |
| `texto_motivo_todo` | UI ToDos | Genera motivo legible del ToDo. |
| `texto_evidencia_todo` | UI ToDos | Genera evidencia legible del ToDo. |
| `html_escape` | UI/utilidad | Escapa texto antes de insertarlo en bloques HTML controlados. |
| `ICONOS_UI` | UI global | Diccionario oficial de acciones e iconos Material para botones reutilizables. |
| `icono_accion_ui` | UI global | Obtiene la configuracion oficial de icono/tooltip de una accion. |
| `boton_icono_estandar` | UI global | Renderiza botones cuadrados o rectangulares con icono centrado y estilo comun. |
| `badge_estado_networking_html` | UI estados | Renderiza estado de networking como badge HTML coloreado. |
| `clase_estado_networking` | UI estados | Devuelve clase visual para pintar el punto de estado en controles compactos. |
| `separar_valores_contacto` | UI Ficha | Separa correos o telefonos concatenados para visualizarlos como filas limpias. |
| `telefono_para_link` | UI Ficha | Normaliza telefono para enlaces `tel:` y WhatsApp. |
| `html_fila_correo_contacto` | UI Ficha | Renderiza una fila de correo con accion compacta para enviar email. |
| `html_fila_telefono_contacto` | UI Ficha | Renderiza una fila de telefono con acciones compactas de llamada y WhatsApp. |
| `html_datos_contacto_ficha` | UI Ficha | Construye el bloque HTML de correos y telefonos de la ficha. |
| `actualizar_contacto_individual_ficha` | Contactos / UI Ficha | Aplica cambios de foco, marca headhunter o estado networking a un solo contacto. |
| `renderizar_bloque_datos_estado_contacto` | UI Ficha | Renderiza el bloque modular de identidad, datos y acciones de un contacto. |
| `renderizar_bloque_referidos_contacto` | UI Ficha legacy | Renderiza la seccion lateral anterior de contactos vinculados/referidos de la ficha. |
| `popup_cambiar_estado_networking` | UI Ficha legacy | Mantiene compatibilidad con la ficha deprecada para cambiar estado manualmente. |
| `estilo_interaccion_ficha` | UI Ficha | Define color e icono compacto por tipo de interaccion. |
| `fecha_interaccion_ficha` | UI Ficha | Formatea la fecha de una interaccion para tarjetas compactas. |
| `texto_minuta_ficha` | UI Ficha | Prepara la minuta editable para mostrarla expandida o como `sin minuta`. |
| `texto_preview_interaccion_ficha` | UI Ficha | Genera preview compacto tipo inbox desde la minuta editable de una interaccion. |
| `html_interaccion_ficha` | UI Ficha | Construye tarjeta expandible de una interaccion con titulo truncado y preview gris. |
| `renderizar_confirmacion_eliminar_interaccion` | UI Ficha | Centraliza confirmacion de eliminacion de interacciones dentro de la ficha. |
| `renderizar_interacciones_contacto_compactas` | UI Ficha | Renderiza timeline nuevo con filas compactas expandibles por clic y boton de editar minuta. |
| `render_contactos_referidos` | UI Relaciones | Componente reutilizable para renderizar referidos como tarjetas con nombre manual, notas y estado de vinculo. |
| `renderizar_referidos_contacto_tarjetas` | UI Ficha | Wrapper de ficha que invoca el componente reutilizable de referidos. |
| `preparar_todos_pendientes_para_vista` | UI ToDos | Prepara sugerencias abiertas, con filtro opcional por contacto y orden comun para Dashboard/Ficha. |
| `render_coach_mensajes` | UI ToDos | Renderiza burbujas del Coach de forma reutilizable, con o sin seleccion y variante compacta. |
| `renderizar_coach_contacto_compacto` | UI Ficha / Coach IA | Renderiza Coach contextual lateral filtrado al contacto actual usando helpers compartidos. |
| `motor_todo_desde_row` | ToDos UI | Determina si una sugerencia viene de RULE, HYBRID o AI. |
| `texto_motor_todo` | ToDos UI | Convierte el motor del ToDo a etiqueta legible. |
| `render_coach_mascota` | UI ToDos | Renderiza la mascota original animada del Coach IA con tamaño parametrizable. |
| `html_linea_todo` | UI ToDos | Construye una linea expandible tipo conversacion para una sugerencia, con soporte compacto. |
| `render_panel_todos_ia` | UI ToDos | Renderiza panel Coach IA como fragmento para evitar recarga completa al seleccionar sugerencias. |
| `renderizar_linea_tiempo_contacto` | UI Ficha legacy | Renderiza timeline anterior de interacciones. |
| `guardar_en_sheet` | Sheets / contactos | Sobrescribe contactos en `CRM_Contactos_Extra`. |
| `leer_historial_sheet` | Sheets / interacciones | Lee interacciones de un contacto. |
| `leer_interacciones_todas` | Sheets / interacciones | Lee todas las interacciones. |
| `filas_sheet_a_dataframe` | Export / datos | Convierte filas leidas desde Sheets en DataFrame alineado a columnas esperadas. |
| `leer_rango_export_solo_lectura` | Export / datos | Lee rangos de Sheets para export sin crear hojas ni escribir datos. |
| `valor_exportable` | Export / datos | Convierte valores a texto seguro para JSONL. |
| `dataframe_a_jsonl` | Export / datos | Serializa DataFrames como JSONL UTF-8. |
| `hash_bytes_export` | Export / datos | Calcula hash SHA-256 para validar archivos del export. |
| `agregar_archivo_export` | Export / datos | Agrega archivos al ZIP y registra metadata en manifest. |
| `validar_export_espejo` | Export / datos | Detecta duplicados, referencias rotas y advertencias antes de importar cloud. |
| `construir_export_espejo_local` | Export / datos | Genera ZIP espejo con manifest, tablas normalizadas, snapshots raw y reporte de validacion. |
| `guardar_interacciones_todas` | Sheets / interacciones | Sobrescribe hoja `Interacciones`. |
| `inicializar_notas_editables_desde_fuente` | Interacciones | Copia detalle fuente a notas editables si estan vacias. |
| `upsert_interacciones_por_id` | Interacciones | Inserta/actualiza interacciones por ID. |
| `registrar_nueva_interaccion_manual` | Interacciones | Crea interaccion manual. |
| `editar_interaccion_existente` | Interacciones | Edita tipo/asunto/fecha/notas de interaccion. |
| `actualizar_notas_usuario_sheet` | Interacciones | Actualiza notas editables de una interaccion. |
| `eliminar_interaccion_existente` | Interacciones | Elimina una interaccion de Sheets. |
| `obtener_contactos_google_legacy` | Google Contacts legacy | Obtiene contactos con metodo anterior. |
| `fila_desde_persona_google` | Google Contacts | Convierte persona Google en fila de contacto. |
| `obtener_contactos_google_con_cursor` | Google Contacts | Obtiene contactos usando sync token. |
| `obtener_contactos_google` | Google Contacts | Obtiene contactos desde Google Contacts. |
| `normalizar_telefono_para_match` | Contactos | Normaliza telefono para buscar coincidencias. |
| `set_emails_contacto` | Contactos | Convierte emails concatenados a conjunto. |
| `set_telefonos_contacto` | Contactos | Convierte telefonos a conjunto normalizado. |
| `obtener_contacto_google_por_id` | Google Contacts | Obtiene un contacto por Google ID. |
| `buscar_contacto_google_por_identidad` | Google Contacts | Busca contacto por ID, email o telefono. |
| `reasignar_interacciones_contacto` | Contactos/interacciones | Mueve interacciones si cambia el Google ID. |
| `actualizar_contacto_individual_desde_google` | Google Contacts | Actualiza un contacto especifico desde Google. |
| `columnas_contactos_maestras` | Modelo actual | Define columnas esperadas de contactos. |
| `preparar_df_contactos_maestro` | Contactos | Normaliza dataframe maestro de contactos. |
| `valor_contacto_limpio` | Contactos | Limpia valores para comparar campos. |
| `es_contacto_fuente_conectada` | Contactos modelo | Distingue IDs externos actuales `people/...` de IDs nativos de la app. |
| `generar_contacto_id_app` | Contactos modelo | Genera IDs internos `APP_CONTACT_...` para contactos creados en la app. |
| `inferir_contact_id_app` | Contactos modelo | Completa `Contact_ID` propio de la app desde datos legacy o fuente externa. |
| `inferir_provider_contacto` | Contactos modelo | Completa el proveedor principal del contacto actual. |
| `inferir_provider_contact_id` | Contactos modelo | Completa el ID externo del proveedor cuando existe. |
| `validar_emails_contacto_editor` | Contactos editor | Valida formato de emails antes de guardar un contacto. |
| `validar_telefonos_contacto_editor` | Contactos editor | Valida telefonos antes de guardar un contacto. |
| `buscar_duplicados_contacto_editor` | Contactos editor | Detecta posibles duplicados por email o telefono antes de crear/editar. |
| `construir_fila_contacto_editor` | Contactos editor | Construye una fila canonica de contacto conservando defaults y campos existentes. |
| `guardar_contacto_editor_en_sheet` | Contactos editor | Guarda contacto nuevo o editado desde el editor oficial. |
| `marcar_contactos_desactivados_df` | Contactos editor | Marca contactos como desactivados en un DataFrame, sacandolos del foco sin borrar historial. |
| `desactivar_contactos_en_sheet` | Contactos editor | Desactiva contactos desde cualquier flujo usando una escritura centralizada. |
| `solicitar_popup_contacto_editor` | UI Contactos editor | Abre el editor oficial de contacto desde cualquier contexto. |
| `cerrar_popup_contacto_editor` | UI Contactos editor | Cierra y limpia estado del editor oficial de contacto. |
| `renderizar_popup_contacto_editor_pendiente` | UI Contactos editor | Renderiza el editor oficial cuando hay solicitud pendiente. |
| `valores_contacto_editor_desde_state` | UI Contactos editor | Lee campos del editor oficial desde `session_state`. |
| `popup_editor_contacto_global` | UI Contactos editor | Popup reutilizable para crear o editar contactos. |
| `construir_cambios_contactos_google` | Google Contacts | Detecta altas/modificaciones/eliminaciones. |
| `construir_cambios_contactos_google_delta` | Google Contacts | Detecta cambios desde delta incremental. |
| `preparar_preview_contactos_google` | Google Contacts UI | Prepara preview de cambios antes de aplicar. |
| `aplicar_cambios_contactos_google` | Google Contacts | Aplica cambios seleccionados al sheet. |
| `popup_actualizar_contactos_google` | UI contactos | Popup para actualizar contactos desde Google. |
| `aplicar_estilos_globales` | UI global | Inyecta estilos visuales globales. |
| `cargar_pagina_desde_url` | Navegacion | Lee pagina actual desde URL/query params. |
| `cargar_contacto_desde_url` | Navegacion | Carga ficha de contacto desde URL. |
| `render_page_header` | UI global | Renderiza encabezado compacto de pagina. |
| `opciones_orden_contactos` | Filtros Contactos | Define columnas disponibles para ordenar la tabla de contactos. |
| `valores_unicos_contactos` | Filtros Contactos | Obtiene opciones limpias para filtros categoricos. |
| `opciones_dominios_hh_contactos` | Filtros Contactos | Obtiene dominios/empresas headhunter disponibles. |
| `inicializar_filtro_contactos` | Filtros Contactos | Inicializa estado global del filtro de contactos. |
| `obtener_estado_filtro_contactos` | Filtros Contactos | Lee el filtro global como objeto/diccionario. |
| `resetear_filtro_contactos` | Filtros Contactos | Limpia filtros y restaura defaults. |
| `aplicar_filtro_contactos` | Filtros Contactos | Aplica busqueda, categorias, pipeline y orden sobre contactos. |
| `render_pipeline_contactos` | UI Contactos | Renderiza pipeline como control del filtro global. |
| `render_filtro_contactos_global` | UI Contactos | Renderiza panel de filtros y orden compartido. |
| `mostrar_vista_dashboard` | UI Dashboard | Renderiza dashboard completo. |
| `mostrar_vista_empresas` | UI Empresas | Renderiza vista de empresas. |
| `mostrar_vista_iconos_ui` | UI diseño | Vista oculta para aprobar y consultar el estandar visual de iconos, botones y estados. |
| `popup_formulario_minuta` | UI Ficha | Popup para crear/editar minuta o interaccion. |
| `popup_gestion_vincu_global` | UI Relaciones | Gestiona contactos vinculados/referidos. |
| `popup_filtrar_contactos_etiqueta_gmail` | UI Gmail | Filtra contactos por etiqueta Gmail. |
| `popup_actualizar_historial` | UI Sync | Popup de actualizacion de historial/interacciones. |
| `mostrar_vista_ficha_contacto_legacy` | UI Ficha legacy | Conserva la ficha anterior como respaldo deprecado durante el rediseño. |
| `mostrar_vista_ficha_contacto` | UI Ficha | Renderiza ficha individual nueva basada en bloques: datos/acciones, interacciones compactas, Coach contextual y referidos. |
| `mostrar_vista_networking` | UI Contactos | Renderiza pagina Contactos/networking. |

## Artefactos cloud preparatorios

| Artefacto | Responsabilidad | Estado |
|---|---|---|
| `cloud/supabase/schema_v0_1.sql` | Define el primer schema Supabase/Postgres para replica cloud: usuarios, contactos propios de la app, referencias externas, medios de contacto, interacciones, referidos, Coach/ToDos, cursores, import/export, limites, auditoria y KPIs | Creado localmente; pendiente revision y ejecucion controlada en Supabase dev |
| `cloud/supabase/add_external_interaction_sources_v0_2.sql` | Migracion para separar interacciones propias de la app y objetos externos importados | Agrega `external_interaction_sources` con IDs externos, thread, URL futura, detalle fuente, hash, estado de sync y control de reimportacion |
| `cloud/supabase/verify_schema_v0_1.sql` | Consulta metadata de Supabase/Postgres para verificar que las tablas esperadas existen, RLS esta habilitado y las policies fueron creadas | Creado localmente; se ejecuta solo despues del schema |
| `cloud/supabase/verify_import_counts_v0_1.sql` | Verifica conteos cargados por usuario contra el import real ejecutado | Creado localmente; pendiente ejecutar en SQL Editor |
| `cloud/supabase/fix_todo_status_after_import_v0_1.sql` | Reparacion puntual de ToDos importados con estado legacy `Pendiente` | Corrige importaciones v0.1 previas donde los pendientes quedaron como `dismissed`; deja el ToDo legacy completado como `done` |
| `cloud/supabase/diagnose_legacy_interaction_dates_v0_1.sql` / `repair_legacy_interaction_dates_v0_1.sql` / `rollback_legacy_interaction_dates_v0_1.sql` | Reparacion puntual de fechas importadas desde legado sin hora | Scripts de migracion unica para diagnosticar y corregir interacciones legacy guardadas a medianoche UTC, moviendolas a mediodia UTC para preservar el dia calendario visible; incluye backup y rollback |
| `cloud/supabase/consolidate_case_variant_external_interactions_v0_1.sql` | Reparacion puntual de duplicados por ID externo con distinta capitalizacion | Consolida filas legacy/importadas y sincronizadas que representan el mismo correo/cita externa, preservando participantes/notas y ocultando duplicados por metadata sin borrar fisicamente |
| `cloud/importer/preview_export.py` | Lee un ZIP espejo local y valida version, archivos, hashes, errores bloqueantes y conteos estimados de destino sin imprimir datos personales | Implementado y probado contra ZIP real; no inserta datos |
| `cloud/importer/export_package.py` | Modulo compartido para leer/validar el ZIP espejo sin duplicar logica entre preview y carga | Implementado |
| `cloud/importer/load_export.py` | Transforma el ZIP espejo a filas cloud y puede cargar a Supabase/Postgres en modo `--apply`; por defecto corre dry-run | Implementado; carga real ejecutada en Supabase dev. Consolida interacciones duplicadas como una interaccion con participantes; normaliza ToDos legacy `Pendiente` como `active`; ahora prepara `external_interaction_sources` cuando la tabla existe |
| `cloud/web` | Primera app web cloud Next/React para leer Supabase con Auth, Dashboard, Contactos y Sistema en modo espejo | Scaffold creado, dependencias instaladas, typecheck y build ok; pendiente configurar `.env.local`, ejecutar y validar visualmente contra Supabase |
| `cloud/web/styles/tokens.css` | Tokens visuales base para la app cloud: paleta, estados, radios y sombras | Creado desde `docs/UI_STYLE_GUIDE.md` como inicio del design system cloud |
| `cloud/web/components` | Componentes reutilizables iniciales: shell, auth gate, metricas, tabla de contactos, badges de estado, Dashboard, Ficha, Cuenta y vistas read-only | Creado como capa UI reusable; no replica estilos por vista |
| `cloud/web/lib/cloudData.ts` | Capa comun de lectura Supabase para Dashboard, Contactos y Ficha | Creado para evitar queries dispersas; Contactos lee todos los activos por paginas, Ficha lee contacto/interacciones/referidos/ToDos por `contactId`, Dashboard calcula estados desde todos los activos y delega KPIs a `kpiCalculations` |
| `cloud/web/lib/kpiCalculations.ts` | Motor cloud de KPIs del Dashboard | Calcula periodos semanales/mensuales, respeta fecha global de inicio de networking, acumulados, contactos distintos, empresas HH y primera vez sin mezclarlo con UI |
| `cloud/web/tests/kpiCalculations.test.ts` | Tests del motor KPI cloud | Valida fecha calendario sin corrimiento horario, contactos unicos, primer contacto, dominios HH unicos y maximo de 12 periodos |
| `cloud/web/tests/coachRuleEngine.test.ts` | Tests de reglas de estado networking | Valida prelacía base: contactado, agendado, cita concretada por cita pasada, cita concretada por minuta, agradecimiento y guard de foco |
| `cloud/web/components/ui` | Componentes visuales globales para la app cloud: iconos SVG, botones, paneles y tarjetas metricas | Creado para que nuevas vistas no redefinan botones/iconos/paneles localmente |
| `cloud/web/components/DashboardPipeline.tsx` | Componente cloud para mostrar pipeline de estados con colores oficiales | Primera version usada en Dashboard read-only |
| `cloud/web/components/CoachPreview.tsx` | Modulo cloud reutilizable del Coach IA con mascota, botones estandar y burbujas | Exporta `CoachModule` parametrizable por contexto/contacto, con robot animado, parpadeo y boca activa al expandir sugerencias; traduce ToDos a lenguaje natural, resuelve evidencia contra interacciones para mostrar asunto/dias, usa nombres cortos en links y pinta estados con tokens oficiales; permite seleccionar multiples sugerencias, delega la ejecucion a acciones internas, busca nuevas sugerencias y abre historial del Coach |
| `cloud/web/components/CoachActionLogDialog.tsx` | Modal reutilizable de historial del Coach cloud | Muestra solo sugerencias no vigentes como log simple: mensaje igual a la burbuja activa, stamp `done`/`dismissed`/`expired`/`auto resolved`, fecha de cierre, filtros por estado y detalle colapsable con motivo, regla, evidencia y link al contacto |
| `cloud/web/lib/coachActions.ts` | Acciones ejecutables iniciales del Coach cloud | Implementa rutas accionables para `NETWORKING_STATUS_CHANGE` y `todo.dismiss`: valida usuario, sugerencia y estado oficial cuando aplica, actualiza `contacts.networking_status`, marca ToDos como `done` o `dismissed`, registra `action_invocations`, deja traza en `audit_log` y marca como `failed` los intentos que fallan despues de iniciarse. La misma accion sirve para ejecucion manual confirmada y autoejecucion por regla segura |
| `cloud/web/lib/contactActions.ts` | Acciones ejecutables de contacto cloud | Centraliza acciones de contacto cloud: `contact.update_networking_status` desde selector con autosave, `contact.update_flags` para foco/headhunter desde ficha, y `contact.create`/`contact.update` desde el editor global. Valida usuario/estado/email, guarda datos base, reemplaza emails/telefonos, registra `action_invocations` y `audit_log` |
| `cloud/web/lib/coachConfig.ts` | Capa cloud de configuracion del Coach | Lee y guarda `todo_configs`, traduce tipos tecnicos a nombres/ejemplos/condiciones en lenguaje usuario, ordena RULE/HYBRID/IA y valida si una regla puede usar `execute_without_asking` |
| `cloud/web/lib/coachRuleEngine.ts` | Motor cloud inicial de reglas duras del Coach | Evalua reglas `RULE` de cambio de estado networking sobre contactos, participantes e interacciones importadas; respeta foco/contacto activo, direccion saliente estructurada, prelacia, dedupe, cierre de sugerencias no vigentes, `object_review_state` y preferencias `todo_configs`, incluyendo autoejecucion segura |
| `cloud/web/lib/coachLog.ts` | Lectura del historial del Coach cloud | Encapsula consulta a `todos` cerrados, resuelve nombres de contacto e interacciones de evidencia, y ordena por `resolved_at`/`updated_at` para mostrar sugerencias que ya no estan activas |
| `cloud/web/lib/coachText.ts` | Textos reutilizables del Coach cloud | Centraliza parseo de estados/evidencia, nombres abreviados, fecha visible y mensajes/detalles de burbujas para que sugerencias activas e historial no dupliquen wording |
| `cloud/web/components/CoachConfigDialog.tsx` | Modal reutilizable para configurar automatizaciones del Coach | Se abre desde el engranaje del Coach, lista reglas por complejidad y permite elegir `Pedir confirmacion siempre`, `Ejecutar sin preguntar` o `No volver a sugerir` sin duplicar la logica de configuracion |
| `cloud/web/components/ContactTable.tsx` | Tabla cloud de contactos | Lista contactos activos con filtro de foco y busqueda; los nombres abren la Ficha mediante `/contactos?contactId=...` |
| `cloud/web/components/ContactEditorDialog.tsx` | Editor global de contacto cloud | Modal reutilizable para crear o editar contactos desde distintos contextos. Edita datos base, estado, foco, marca headhunter, empresas headhunter, correos y telefonos; delega persistencia a `saveContactFromEditor` |
| `cloud/web/components/ContactProfile.tsx` | Ficha cloud de contacto | Bloque madre cloud de contacto: datos/estado, interacciones, referidos y Coach contextual filtrado. Reutiliza `CoachModule`, `ActivitySyncButton`, iconos/botones globales, accion interna para guardar estado networking y abre el editor global de contacto desde el icono editar. Las filas de interaccion reciben participantes desde `interaction_participants` y muestran un indicador informativo cuando una interaccion es compartida; tambien reciben `external_interaction_sources` para mostrar origen externo/link si existe |
| `cloud/web/components/ReferralEditorDialog.tsx` | Editor global de referido cloud | Modal reutilizable para crear/editar referidos desde la ficha. Permite guardar el apunte libre, vincular/desvincular contacto existente, abrir el editor global de contacto y marcar cambios rapidos pendientes para actualizar el contacto vinculado desde datos del referido al guardar |
| `cloud/web/components/InteractionEditorDialog.tsx` | Editor global de interaccion/minuta cloud | Modal reutilizable para editar minuta de interacciones existentes o crear una interaccion manual asociada al contacto actual desde la ficha. Al crear, el sentido parte como `Sin definir` |
| `cloud/web/components/SyncPreviewDialog.tsx` | Preview global de sincronizacion cloud | Modal reutilizable para revisar cambios antes de aplicar sync: usa pestanas `Nuevos`, `Modificaciones`, `Duplicados fusionables`, `Duplicados complejos`, `Eliminaciones` y `Sin cambios`; cada pestana mantiene seleccion/desmarcado propio, pero el footer aplica la seleccion total de todas las pestanas en un solo flujo. `Sin cambios` es solo lectura para cerrar la suma de revision y las pestanas vacias siguen siendo clicables. Destaca campos cambiados con tokens oficiales, soporta operaciones `add`/`remove`/`replace`/`match`/`info` y devuelve la seleccion al flujo llamador sin escribir datos por si mismo. En `Nuevos`, `Modificaciones`, `Duplicados fusionables` y `Duplicados complejos`, el boton compacto `Editar datos` abre `ContactMergeDialog` como borrador para guardar una decision estructurada antes de aplicar. En `Duplicados complejos`, si el grupo trae 2 o 3 contactos ya guardados, el conteo `guardados` puede abrir la misma fusion profunda con esos contactos preseleccionados. Los flujos que lo invocan remueven localmente los cambios aplicados con exito, mantienen visibles los pendientes o fallidos sin releer el proveedor y muestran el feedback de aplicacion dentro del modal |
| `cloud/web/components/ContactSyncPreviewSandbox.tsx` | Sandbox interno de preview de contactos | Bloque oculto en `/sistema/diseno` para cargar contactos reales de la app, simular una fuente conectada, abrir `SyncPreviewDialog` y probar `contactSyncApply` con dependencias simuladas. Sirve para validar UX, seleccion, pendientes y cursor sin escribir datos en Supabase ni llamar Google real |
| `cloud/web/components/ContactMergeWorkspace.tsx` | Workspace global de fusion de contactos | Componente reutilizable para comparar 2 o 3 contactos origen y construir un contacto resultante: identidad editable/seleccionable, correos/telefonos multivalor, switches foco/headhunter y estado networking editable. Puede recibir contactos disponibles y mostrar `Agregar contacto guardado` dentro del modal hasta completar el maximo de 3, evitando selectores manuales fuera de la funcion global |
| `cloud/web/components/ContactMergeDialog.tsx` | Modal global de fusion/edicion de resultante | Popup productivo que envuelve `ContactMergeWorkspace` y devuelve `ContactMergeResult` junto con las fuentes usadas al flujo llamador. Primer uso: boton `Editar datos` de `SyncPreviewDialog` para contactos nuevos, modificaciones y enlace/combinacion. En sync, su accion principal dice `Ajustar propuesta` porque solo modifica el borrador; la escritura real ocurre despues con `Aplicar seleccion`. En Cuenta y duplicados complejos puede guardar fusion profunda de contactos ya guardados mediante `merge_contacts_deep` |
| `cloud/web/components/ContactMergePreview.tsx` | Referencia visual de fusion de contactos | Demo en `/sistema/diseno` que consume `ContactMergeWorkspace`; sirve para validar el diseño sin duplicar la implementacion productiva |
| `cloud/web/lib/contactMerge.ts` | Contrato de fusion de contactos | Define `ContactMergeSource`, `ContactMergeResult`, defaults de resultante, prelacion de estado, helpers para convertir contactos app/proveedor al contrato comun y helpers puros para adjuntar/leer `contactMergeDecision` dentro de un `SyncPreviewChange` |
| `cloud/web/lib/contactMergeActions.ts` | Accion interna de fusion profunda | Wrapper reutilizable para llamar `merge_contacts_deep` desde UI, sync, Coach o automatizaciones. Normaliza inputs, exige nombre, maximo 3 contactos totales y devuelve conteos de objetos movidos |
| `cloud/supabase/merge_contacts_deep_v0_2.sql` | Funcion transaccional de fusion profunda | RPC `merge_contacts_deep`: actualiza el contacto resultante, deja emails/telefonos segun el resultado, mueve IDs externos, participantes de interacciones, referidos, ToDos y estados de revision al contacto destino, desactiva contactos origen y registra accion/auditoria. Ejecutada y verificada en Supabase dev el 2026-08-04 |
| `cloud/web/components/AccountPage.tsx` | Pagina Cuenta cloud | Vista de producto para perfil/plan, servicios conectados, sync delicado, datos/respaldo y seguridad. Reutiliza `Panel`, `ProviderButton` y `GoogleContactsSyncPanel` para no duplicar controles ni logica de sync |
| `cloud/web/components/GoogleContactsSyncPanel.tsx` | Panel real de sync Google Contacts cloud | Bloque beta en `Cuenta` para conectar/reconectar Google con scope `contacts.readonly`, preparar preview real con `googleContactSyncFlow`, mostrar `SyncPreviewDialog` y aplicar solo la seleccion mediante `contactSyncApply`. No escribe en Google; escribe en la copia cloud solo despues de confirmacion. Si el preview detecta duplicados complejos con 2 o 3 guardados, abre `ContactMergeDialog` desde el conteo de guardados para resolver primero la duplicidad interna |
| `cloud/web/components/GoogleInteractionsSyncPanel.tsx` | Panel de reconstruccion historica Gmail/Calendar | Bloque beta en `Cuenta` para reconstruir historial Gmail/Calendar read-only desde la fecha global de inicio de networking. Usa `syncGoogleInteractions` en modo dry-run/apply, con `forceFullSync` y sin guardar cursores, para que las revisiones historicas pesadas no muevan el puntero incremental diario. Muestra `InteractionSyncResultSummary` para explicar encontrados en Google, posibles, nuevos, modificados y omitidos |
| `cloud/web/components/ActivitySyncButton.tsx` | Boton reutilizable de sync de actividad | Entrada UI comun para actualizar Gmail/Calendar desde distintos contextos. Variante global: incremental sobre contactos en foco y guarda cursores. Variante ficha: busca solo correos del contacto, usa fecha global de inicio, no guarda cursores y refresca la ficha al terminar. Ambas usan scopes Google read-only, llaman al mismo `syncGoogleInteractions` y comparten textos de resultado con Cuenta |
| `cloud/web/components/InteractionSyncResultSummary.tsx` / `cloud/web/lib/interactionSyncText.ts` | Resumen reutilizable de sync de actividad | Centraliza wording y conteos de Gmail/Calendar para que Cuenta, boton global y futuros previews interpreten igual `posibles`, `nuevos`, `modificados` y `omitidos` |
| `cloud/web/components/ContactDuplicateReviewPanel.tsx` | Revision local y manual de duplicados guardados | Panel en `Cuenta` que lee contactos activos, usa `contactDuplicateReview` para detectar grupos duplicados y reutiliza `ContactMergeDialog` + `mergeContactsDeep` para fusionar grupos de hasta 3 contactos guardados. La fusion manual se expone como un boton simple; la busqueda/agregado de contactos vive dentro del modal global, con tope de 3 contactos |
| `cloud/web/lib/contactSyncPreview.ts` | Motor puro de preview de contactos | Compara contactos internos con contactos normalizados de una fuente externa y genera `SyncPreviewChange` sin escribir datos: nuevos, modificaciones, duplicados fusionables, duplicados complejos, eliminaciones y revisados sin cambios. Si un ID externo no esta enlazado pero el correo o telefono ya existe en la app, propone fusionar solo si el grupo tiene 2 o 3 contactos origen y exactamente 1 contacto guardado. Si el grupo conectado tiene 4 o mas contactos origen, o multiples contactos guardados, no intenta fusionar en el preview: crea filas `duplicate_complex` para importar candidatos no enlazados de forma independiente, agrupadas con `duplicateGroupId`/`duplicateGroupLabel` por correo, nombre o telefono comun, y resolver la fusion despues con la herramienta de revision de duplicados. Protege datos enriquecidos: Nombre, Empresa y Cargo guardados no se reemplazan automaticamente en modificaciones o duplicados, solo se completan si estan vacios; en `Modificaciones` muestra diferencias ignoradas con `apply: false` para que la UI marque `(no aplicado)`; un campo vacio en la fuente no borra un dato local; eliminaciones de correos/telefonos solo se muestran como no aplicadas si el valor era conocido como importado desde esa misma fuente y no esta suprimido |
| `cloud/web/lib/contactDuplicateReview.ts` | Motor puro de revision de duplicados guardados | Detecta contactos activos duplicados por correo normalizado o identidad de telefono. Usa grafo de conexiones, por lo que agrupa duplicados indirectos si A comparte telefono con B y B comparte correo con C. Devuelve grupos con label, contactos, claves compartidas y fuentes listas para `ContactMergeDialog` |
| `cloud/web/lib/phoneIdentity.ts` | Identidad normalizada de telefonos | Helper reutilizable para comparar telefonos sin depender del formato textual. Genera identidades por digitos completos, formato nacional inferido y ultimos 8 digitos; primera cobertura explicita: Chile, Peru, Argentina, Colombia, Mexico, Brasil y USA. En Chile reconoce moviles con `9` duplicado despues de `+56`. Los paises soportados viven en `SUPPORTED_PHONE_COUNTRIES`, para sumar nuevos codigos sin tocar la logica central. Lo usa `contactSyncPreview` para evitar falsos agregados cuando un proveedor trae codigo de pais, formato internacional distinto o duplicados equivalentes |
| `cloud/web/lib/contactSyncApply.ts` | Accion para aplicar preview de contactos | Aplica solo los cambios seleccionados de un preview de contactos: crea contactos nuevos, actualiza campos simples, agrega/elimina medios importados desde la fuente, reasigna IDs externos en consolidaciones y desactiva contactos eliminados de la fuente. Si un cambio nuevo, modificado o de enlace/combinacion trae `contactMergeDecision`, guarda el resultante definido por el usuario al crear o actualizar el contacto. Devuelve `appliedChangeIds` y `failedChangeIds` para que la UI pueda remover solo lo aplicado y mantener visible lo fallido. Guarda el cursor nuevo solo si no hubo errores ni cambios pendientes |
| `cloud/web/components/ui/ContactSearchSelect.tsx` | Selector buscable global de contacto | Componente reutilizable para elegir contactos por texto, filtrando por nombre, empresa, cargo, correo o telefono. Primer uso: vincular referidos |
| `cloud/web/lib/contactDraft.ts` | Borrador reutilizable de contacto | Construye un `ContactEditorInput` a partir de un contacto existente y un patch de cambios pendientes. Lo usan el guardado rapido desde referidos y el editor oficial de contacto para evitar rutas divergentes |
| `cloud/web/lib/interactionActions.ts` | Acciones ejecutables de interacciones cloud | Centraliza `interaction.create_manual`, `interaction.update_user_notes` e `interaction.dismiss`, validando usuario/contacto/tipo/fecha cuando aplica, creando participante para interacciones nuevas y registrando `action_invocations`/`audit_log`. `interaction.dismiss` archiva por `metadata` y escribe columnas soft-delete si existen |
| `cloud/web/lib/interactionState.ts` | Estado operativo de interacciones | Helper reutilizable para detectar interacciones archivadas y excluirlas de ficha, Dashboard/KPIs y reglas del Coach sin duplicar filtros |
| `cloud/web/lib/externalInteractionSync.ts` | Capa comun de sync de interacciones externas | Recibe objetos externos normalizados desde cualquier adaptador de proveedor, crea/actualiza `interactions` sin pisar `user_notes_raw` en registros existentes, guarda `external_interaction_sources`, agrega participantes faltantes de forma conservadora, respeta `prevent_reimport`, registra auditoria basica y expone helpers de puntero `object_review_state` para que Coach sepa si debe revisar una version de interaccion |
| `cloud/web/lib/googleInteractionAdapter.ts` | Adaptador Google para interacciones | Convierte objetos Gmail y Google Calendar ya leidos por un futuro cliente Google al formato comun de `externalInteractionSync`. Implementa regla anti-ruido de Gmail: descarta correos donde un tercero envia y usuario/contacto solo estan copiados; soporta participantes `FROM`, `TO`, `CC`, `BCC`, link Gmail web y `htmlLink` de Calendar |
| `cloud/web/lib/googleInteractionClient.ts` | Cliente read-only Gmail/Calendar | Lee Gmail y Google Calendar con access token autorizado, query opcional, paginacion acotada, limites por corrida, errores claros de permisos/token y cursor incremental de Calendar. No guarda datos ni escribe en Google |
| `cloud/web/lib/googleInteractionSyncFlow.ts` | Flujo Google de sync de interacciones | Ensambla contactos app, cursores, cliente Google, adaptador Google y orquestador comun para importar Gmail/Calendar como interacciones app vinculadas a origen externo. Soporta alcance por contactos especificos, solo contactos en foco, revision historica forzada, queries Gmail/Calendar y control explicito de guardado de cursores. Guarda cursores solo si el lote queda ok, no es dry-run y el flujo lo permite; si Calendar informa cursor vencido, marca el cursor y reintenta lectura historica |
| `cloud/web/lib/syncDate.ts` | Helper de fechas globales de sync | Lee y normaliza `Fecha_Inicio_Networking` desde settings para que Cuenta, ficha y futuros botones usen la misma fecha base sin duplicar parseo |
| `cloud/web/lib/googleContactAdapter.ts` | Adaptador Google para contactos | Convierte personas de Google People API al contrato externo comun de contactos: ID externo, nombre, empresa, cargo, correos, telefonos, `etag`, `deleted` y `previousResourceNames`. No llama APIs; solo normaliza objetos ya leidos por el futuro cliente Google |
| `cloud/web/lib/googleContactsClient.ts` | Cliente read-only Google Contacts | Lee `people/me/connections` usando un access token ya autorizado, `personFields`, paginacion, `requestSyncToken`, `syncToken` incremental y limite de paginas. Devuelve contactos externos normalizados, `nextSyncToken`, advertencias y error explicito para cursor vencido `EXPIRED_SYNC_TOKEN`. No guarda tokens ni escribe datos |
| `cloud/web/lib/googleContactSyncFlow.ts` | Flujo de preview Google Contacts | Ensambla contactos app, referencias externas, valores conocidos por fuente, cursor guardado y lectura Google read-only para preparar un preview real de contactos. Si el cursor vence, lo marca vencido y reintenta una lectura completa. No aplica cambios ni guarda el cursor nuevo |
| `cloud/web/lib/syncCursorStore.ts` | Cursores de sync cloud | Lee, guarda y marca como vencidos los cursores incrementales en `sync_cursors`, filtrados por usuario, proveedor, recurso y etiqueta. Es reutilizable por contactos, mail, calendario y futuros proveedores |
| `cloud/web/lib/syncOrchestrator.ts` | Orquestador comun de sincronizacion cloud | Define contratos reutilizables de sync para contactos, mail, calendario y mensajes: provider, recurso, modo, alcance, cursores, dry-run, conteos, errores y objetos afectados. `syncMailInteractions` y `syncCalendarInteractions` ejecutan lotes de interacciones normalizadas usando `externalInteractionSync`; `syncContacts` genera preview si recibe contactos internos y externos, y bloquea la sync si faltan datos para revisar antes de aplicar |
| `cloud/web/lib/referralActions.ts` | Acciones ejecutables de referidos cloud | Centraliza `referral.create`, `referral.update` y `referral.dismiss`. Valida contacto que refiere, contacto vinculado, datos minimos, email/telefono, y registra `action_invocations`/`audit_log` |
| `cloud/web/components/RecentCards.tsx` | Componentes cloud para tarjetas de contactos e interacciones recientes | Primera version usada en Dashboard; prepara reutilizacion en otras vistas |
| `cloud/web/components/DashboardKpis.tsx` | Componente cloud para KPIs superiores del Dashboard con linea de tendencia, barras de primera vez y acumulado | Usa datos ya calculados por `kpiCalculations`; soporta semanal/mensual mediante parametros del Dashboard |
| `cloud/web/components/HeadhunterCompanies.tsx` | Componente cloud para resumen de empresas headhunter | Tabla read-only con seleccion por empresa/dominio, `sin email` destacado y salida parametrizada para filtrar Ultimas interacciones sin recalcular en UI |
| `cloud/web/components/ReferralActions.tsx` | Componente cloud para referidos sugeridos por accionar | Primera version read-only ubicada al final del Dashboard |
| `cloud/web/app/sistema/diseno/page.tsx` | Anexo visual cloud oculto para validar paleta, botones, iconos, estados y metricas reales | Creado; no requiere login porque no muestra datos personales |

## Direccion: acciones internas ejecutables

Las funciones de negocio que puedan ser usadas por UI, reglas, Coach IA o automatizaciones deben evolucionar a acciones internas con contrato estable.

Ejemplos iniciales:

| Accion interna | Funcion actual relacionada | Objetivo |
|---|---|---|
| `contact.create` / `contact.update` | `guardar_contacto_editor_en_sheet`, `popup_editor_contacto_global` | Crear o editar contactos desde cualquier contexto sin duplicar UI/logica |
| `contact.deactivate` | `desactivar_contactos_en_sheet` | Desactivar contactos preservando historial |
| `contact.update_networking_status` | `ejecutar_todos_seleccionados_coach`, acciones masivas de Contactos | Cambiar estado desde UI, regla o Coach usando una sola ruta |
| `referral.create` / `referral.update` / `referral.link_contact` | `guardar_referido_editor_en_sheet`, popup `Referidos y contactos` | Crear, editar o vincular referidos desde ficha, contactos o Coach |
| `interaction.create_manual` / `interaction.update_user_notes` / `interaction.dismiss` | `registrar_nueva_interaccion_manual`, `actualizar_notas_usuario_sheet`, `eliminar_interaccion_existente` | Mantener interacciones/minutas editables como acciones reutilizables; en cloud `interaction.dismiss` debe archivar sin borrar fisicamente para preservar historial y coordinarse con sync |
| `sync.mail` / `sync.calendar` / `sync.contacts` | `syncExternalInteractionBatch`, `syncMailInteractions`, `syncCalendarInteractions`, `syncContacts` | Sincronizar datos externos desde distintos contextos con inputs/outputs estructurados. Mail/calendario ya aplican lotes normalizados; contactos debe pasar por preview y confirmacion antes de escribir |
| `contact.merge_deep` | `mergeContactsDeep`, `merge_contacts_deep` | Fusionar 2 o 3 contactos app en una accion transaccional: conserva el resultante elegido, mueve relaciones y desactiva origenes |

Cada accion debe declarar inputs, outputs, validaciones, objetos afectados, confirmacion por defecto y auditoria. En cloud, cada intento/resultado queda registrado en `action_invocations` y las modificaciones relevantes en `audit_log`.

Estado cloud actual: `contact.update_networking_status`, `contact.update_flags`, `contact.create`, `contact.update`, `contact.merge_deep`, `interaction.create_manual`, `interaction.update_user_notes`, `interaction.dismiss`, `referral.create`, `referral.update`, `referral.dismiss`, `todo.dismiss`, `sync.mail`, `sync.calendar`, contrato seguro `sync.contacts` y `sync.contacts.apply_preview` ya tienen una primera implementacion. La Ficha cloud usa `contactActions.ts` para guardar estado networking, foco y marca headhunter; el editor global usa la misma capa para crear/editar contactos con auditoria. Interacciones usa `interactionActions.ts` para crear/editar minutas desde la ficha y archivar interacciones con confirmacion. Referidos usa `referralActions.ts` para crear/editar/vincular/eliminar desde la ficha. Sync usa `syncOrchestrator.ts`, `googleContactSyncFlow.ts` y `contactSyncApply.ts` para que botones, flujos, reglas, Coach IA o futuros agentes puedan llamar funciones con inputs/outputs estables. `contactSyncApply` ya deriva a `contact.merge_deep` cuando una propuesta de `Duplicados fusionables` contiene mas de un contacto `Guardado`, usando el mismo resultante del popup o el default del contrato global. Falta convertirlas en registry mas amplio, agregar accion de revertir/desactivar y reutilizarlas tambien desde Contactos/Dashboard/Coach cuando esas acciones se migren a cloud.

## Duplicacion o areas a revisar

- Existen funciones legacy junto a funciones incrementales para Gmail/Calendar/Contacts.
- Varias funciones escriben hojas completas de Google Sheets.
- UI y persistencia estan mezcladas en popups y vistas.
- Los calculos de dashboard estan en el mismo archivo que renderiza la UI.
- El motor de ToDos combina catalogo, persistencia, render y reglas.

## Direccion de refactor

1. Centralizar constantes de tablas/columnas.
2. Crear capa de datos para contactos, interacciones, ToDos y sync.
3. Separar reglas de negocio puras.
4. Separar calculos de dashboard/KPIs.
5. Mover integraciones Google a modulo propio.
6. Crear catalogo de acciones internas para que UI, reglas y Coach IA no dupliquen flujos.
7. Mantener UI Streamlit funcionando durante todo el proceso.

## Historial

- 2026-07-15: Se reemplazan "funciones representativas" por inventario completo de funciones actuales.
- 2026-07-15: Se agregan funciones de KPIs para contactos realizados y empresas HH realizadas.
- 2026-07-15: Se ajusta deteccion de interacciones salientes para registros legacy sin `Rol_Email`.
- 2026-07-28: En cloud, `kpiCalculations` usa fecha calendario para bucket semanal/mensual y evita que `YYYY-MM-DDT00:00:00Z` se mueva al dia/mes anterior por zona horaria del navegador. Queda pendiente backfill para remover fallback legacy de salientes.
- 2026-07-15: Se agregan etiquetas en barras KPI y primera vez para empresas HH.
- 2026-07-15: KPIs limitados por fecha de inicio de networking y maximo 12 periodos.
- 2026-07-21: Ficha de contacto inicia rediseño modular con bloque reutilizable de datos/acciones; el popup legacy de cambio de estado queda solo para compatibilidad de la vista deprecada.
- 2026-07-21: Layout de ficha se alinea con maqueta aprobada: columna principal para datos/interacciones y columna lateral para Coach contextual y referidos.
- 2026-07-21: Se agrega `mostrar_vista_ficha_contacto_legacy` como respaldo deprecado y `mostrar_vista_ficha_contacto` pasa a usar componentes nuevos.
- 2026-07-21: Ficha reemplaza botones dobles de foco/headhunter por toggles y se agregan helpers compartidos para burbujas Coach y tarjetas de referidos.
- 2026-07-17: Se agrega filtro global de Contactos y se elimina la doble capa de filtros dentro del fragmento de tabla.
- 2026-07-20: Coach IA cambia de tabla a conversacion compacta con mascota original animada flotante y tabs por motor.
- 2026-07-20: Configuracion de Coach IA baja de categorias tecnicas a reglas concretas de usuario para cambios de estado y otros tipos catalogados.
- 2026-07-20: Panel Coach IA se encapsula como `st.fragment` para que seleccionar sugerencias no recargue todo el Dashboard.
- 2026-07-20: Coach IA agrega boton para ejecutar sugerencias seleccionadas y separa esa accion del rayo de automatizacion futura.
- 2026-07-20: Reglas de estado agregan deteccion de cita concretada por minuta cargada, mapa de prelacion y control anti duplicado contacto/estado.
- 2026-07-22: Se agrega capa transicional de relaciones/referidos para leer legacy A:D y escribir esquema ampliado A:Q desde funciones centralizadas.
- 2026-07-22: CONTACT-010 inicia implementacion con editor oficial de contacto, validaciones, deteccion de duplicados e IDs nativos `APP_CONTACT_...`.
- 2026-07-22: CONTACT-011 inicia implementacion con helper oficial de guardado de referidos; el popup legacy queda delegando en esa funcion.
- 2026-07-22: Se reemplaza popup legacy de referidos por `Referidos y contactos`, conectado al editor global de contacto y al modelo ampliado.
- 2026-07-22: Se centraliza desactivacion de contactos y el editor oficial agrega accion de desactivar con confirmacion.
- 2026-07-22: Contactos se amplian a rango `CRM_Contactos_Extra!A:Y` con identidad app `Contact_ID` y metadata de proveedor, manteniendo `Google_ID` como llave legacy.
- 2026-07-22: Se agrega export espejo local de solo lectura: genera ZIP con manifest, tablas normalizadas, snapshots raw y reporte de validacion desde Opciones avanzadas de Contactos.
- 2026-07-27: Se agrega artefacto cloud `cloud/supabase/schema_v0_1.sql` como primer schema Supabase/Postgres, aun no ejecutado.
- 2026-07-27: Se agrega direccion de arquitectura para acciones internas ejecutables y tabla cloud `action_invocations`.
- 2026-07-27: Se agrega verificador `cloud/supabase/verify_schema_v0_1.sql` para validar metadata despues de ejecutar el schema.
- 2026-07-27: Se agrega `cloud/importer/preview_export.py` para validar ZIP espejo antes del import cloud sin exponer datos personales.
- 2026-07-27: Se extrae `cloud/importer/export_package.py` y se agrega `cloud/importer/load_export.py` para dry-run/carga controlada a Supabase.
- 2026-07-27: Import real a Supabase dev ejecutado; se agrega `cloud/supabase/verify_import_counts_v0_1.sql` para validar conteos post-import.
- 2026-07-27: Se crea `cloud/web` como primera app cloud Next/React en modo lectura, con componentes y tokens globales preparados para Vercel/Supabase; dependencias instaladas, typecheck y build validados.
- 2026-07-27: Se agrega `cloud/web/lib/cloudData.ts` para centralizar lectura cloud; Contactos deja de limitarse a 300 filas y Dashboard cuenta estados sobre todos los contactos activos.
- 2026-07-27: Se agrega anexo visual cloud `/sistema/diseno` y componentes UI globales para iconos, botones y metricas.
- 2026-07-28: Dashboard cloud read-only empieza rediseño modular con `Panel`, `DashboardPipeline`, `CoachPreview` y `RecentCards`; se corrige login para no quedar pegado indefinidamente en carga.
- 2026-07-28: Dashboard cloud se reordena para comparabilidad con Streamlit: KPIs, Coach IA, Empresas headhunter, Ultimas interacciones y Referidos sugeridos; se agregan componentes `DashboardKpis`, `HeadhunterCompanies` y `ReferralActions`.
- 2026-07-28: `CoachPreview` pasa a minimo funcional para ToDos de cambio de estado y descarte: seleccion multiple, ejecucion de `NETWORKING_STATUS_CHANGE`, descarte `todo.dismiss`, cierre de ToDos y registro de accion/auditoria en Supabase.
- 2026-07-28: `CoachConfigDialog` conecta el engranaje del Coach a `todo_configs`; replica el modelo local de configuracion por tipo, con lenguaje de usuario y guardado en Supabase.
- 2026-07-28: `coachRuleEngine` conecta el boton de busqueda del Coach a revision cloud de reglas `RULE` de estado networking; crea/mantiene/cierra ToDos en Supabase y registra estado de revision por contacto.
- 2026-07-29: `ContactProfile` inicia la Ficha cloud read-only reutilizable; `cloudData` agrega lectura de contacto, interacciones, referidos y ToDos por `contactId`, y `ContactTable` abre la ficha desde el nombre.
- 2026-07-29: Ficha cloud agrega iconos globales de editar/expandir/contraer, acciones compactas mail/calendario/telefono/mensaje, preview de interacciones corregido, selector de estado con autosave y layout estrecho del Coach usando el mismo `CoachModule`.
- 2026-07-29: Cloud agrega `ContactEditorDialog` como editor global de contacto y `saveContactFromEditor` como accion reutilizable `contact.create`/`contact.update`, conectado desde la Ficha.
- 2026-07-30: Cloud agrega `contact.update_flags` para cambiar foco networking y marca headhunter desde la Ficha sin abrir el editor, manteniendo auditoria e invocaciones.
- 2026-07-30: Cloud conecta referidos al editor global: `ReferralEditorDialog` abre desde `+`, `Vincular` y `Vinculado`, y reutiliza `ContactEditorDialog` para crear/editar contacto vinculado.
- 2026-07-30: Referidos cloud agrega seleccion multiple con eliminacion segura como `referral.dismiss`, texto explicativo en el editor y selector buscable global `ContactSearchSelect`.
- 2026-07-30: Referidos cloud agrega cambios rapidos pendientes en la mini ficha del contacto vinculado: empresa/cargo se actualizan desde referido y correos/telefonos se agregan usando `saveContactFromEditor` al guardar. Se agrega `contactDraft.ts` para que el guardado rapido y el editor oficial usen el mismo borrador.
- 2026-07-30: Ficha cloud conecta interacciones al editor global `InteractionEditorDialog`: el lapiz edita minuta y el boton `+` crea una interaccion manual asociada al contacto.
- 2026-07-31: Cloud agrega `syncCursorStore.ts` para centralizar lectura, guardado y marcado de cursores vencidos en `sync_cursors`, usando la clave `user_id + provider + resource_type + cursor_label`.
- 2026-07-31: Cloud agrega `googleContactSyncFlow.ts`, flujo reutilizable que prepara preview real de Google Contacts usando cursor incremental, referencias externas y datos app, sin aplicar cambios ni guardar el cursor nuevo todavia.
- 2026-07-31: Cloud agrega `contactSyncApply.ts`, accion reutilizable para aplicar cambios seleccionados de sync de contactos. Si quedan cambios no aceptados o hay errores, no guarda el cursor nuevo para que la proxima sincronizacion vuelva a revisar lo pendiente.
- 2026-07-31: `/sistema/diseno` conecta el sandbox de preview de contactos al aplicador oficial en modo simulado, para validar seleccion parcial/completa, pendientes y avance de cursor sin modificar Supabase.
- 2026-07-31: Cloud agrega `GoogleContactsSyncPanel` en `Sistema`, conectando OAuth Google read-only, preview real y aplicacion confirmada de contactos sobre Supabase cloud. Pendiente validar OAuth real de Supabase/Google en navegador.
- 2026-07-31: `contactSyncPreview` corrige deteccion de contactos sin ID externo enlazado: antes los marcaba como nuevos; ahora si coinciden por correo o telefono se proponen como consolidacion/enlace para evitar duplicados.
- 2026-07-31: `contactSyncPreview` fusiona duplicados externos que apuntan al mismo contacto destino y agrega tipo `unchanged`; `SyncPreviewDialog` suma pestana `Sin cambios` para distinguir contactos revisados sin diferencias de cambios pendientes.
- 2026-08-03: Cloud agrega `phoneIdentity.ts` para comparar telefonos con formatos internacionales/nacionales en Chile, Peru, Argentina, Colombia, Mexico, Brasil y USA; `contactSyncPreview` lo usa para evitar falsos updates por codigo de pais.
- 2026-08-03: Sync de contactos robustece telefonos chilenos con `9` duplicado, deduplica telefonos equivalentes traidos por el proveedor y trata placeholders como `sin dato`, `sin datos` y `null` como vacios reales en preview y formato global.
- 2026-08-03: `googleContactAdapter` pasa a preferir el telefono visible (`value`) sobre `canonicalForm`, porque Google puede truncar `canonicalForm` al intentar canonizar numeros mal escritos; `canonicalForm` queda solo como fallback si no hay valor visible.
- 2026-08-03: Cloud agrega ruta `/cuenta` y `AccountPage`; `GoogleContactsSyncPanel` se mueve desde `Sistema` a Cuenta y el OAuth de Google Contacts retorna a `/cuenta`.
- 2026-08-11: Sync cloud de actividad queda con una sola ruta tecnica (`syncGoogleInteractions`) y tres entradas de uso: Cuenta reconstruye historial Gmail/Calendar sin mover cursores, barra superior actualiza incrementalmente contactos en foco, y ficha actualiza un contacto especifico por query de correo sin tocar cursores globales.
- 2026-08-03: Se retira la UI activa de `No eliminar ni volver a sugerir` del sync de contactos. La tabla dev `sync_change_suppressions` queda creada pero sin consumo desde la app hasta redisenar esa experiencia.
- 2026-08-03: En `Duplicados fusionables`, `contactSyncPreview` conserva campos simples existentes de la app y solo completa vacios desde el proveedor, evitando que un duplicado externo con nombre abreviado pise el nombre principal.
- 2026-08-03: `Fusionar contactos` se convierte en modulo reutilizable cloud: `contactMerge.ts` define contrato, defaults y helpers puros para transportar `contactMergeDecision`; `ContactMergeWorkspace` concentra la UI, `ContactMergeDialog` la expone como popup y `SyncPreviewDialog` lo usa en `Nuevos`, `Modificaciones` y `Duplicados fusionables` mediante `Editar datos`. `contactSyncApply` lee ese mismo contrato al crear, modificar o enlazar un contacto.
- 2026-08-03: Se agrega la accion interna `contact.merge_deep`: `contactMergeActions.ts` llama la RPC transaccional `merge_contacts_deep`, que mueve IDs externos, participantes de interacciones, referidos, ToDos y estados de revision al contacto resultante, desactiva los contactos origen y registra accion/auditoria. `contactSyncApply` ya la usa cuando el preview trae mas de un contacto guardado dentro de `Duplicados fusionables`.
- 2026-08-04: `contactSyncPreview` separa duplicados de importacion en `Duplicados fusionables` y `Duplicados complejos`. Solo propone fusionar cuando hay 2 o 3 contactos origen y exactamente 1 contacto guardado; los grupos de 4 o mas contactos, o con multiples contactos guardados, se muestran como importaciones independientes `duplicate_complex`, desmarcadas por defecto, para resolverlas luego con revision de duplicados.
- 2026-08-04: `contactDuplicateReview` y `ContactDuplicateReviewPanel` agregan primera herramienta de revision local/manual de duplicados guardados en Cuenta, reutilizando `ContactMergeDialog` y `merge_contacts_deep` para grupos detectados o fusion manual iniciada desde un boton simple. `ContactMergeWorkspace` concentra la busqueda `Agregar contacto guardado` dentro del modal, y `SyncPreviewDialog` permite abrir fusion profunda desde el conteo de `guardados` en duplicados complejos cuando hay 2 o 3 contactos internos preseleccionables.
- 2026-08-04: Usuario ejecuta y verifica `merge_contacts_deep_v0_2.sql` en Supabase dev. Queda pendiente probar con caso real controlado y conectar la accion a Ficha/Coach.
- 2026-08-11: `contactSyncApply` mejora el registro de fallas parciales de sync de contactos: conserva `externalId`/`objectId` para cambios sin contacto app aun creado y captura mensajes estructurados de Supabase/PostgREST, incluyendo `message`, `details`, `hint` y `code`, para poder investigar errores reales en `action_invocations`.
