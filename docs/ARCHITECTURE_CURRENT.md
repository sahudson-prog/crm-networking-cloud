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
| `es_interaccion_saliente` | Interacciones local | Determina si una interaccion fue saliente en Streamlit; la app cloud ya no debe usar fallback desde texto heredado. |
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
| `cloud/supabase/add_external_interaction_sources_v0_2.sql` | Migracion para separar interacciones propias de la app y objetos externos conectados | Agrega `external_interaction_sources` con IDs externos, thread, URL futura, detalle fuente, hash, estado de sync y control de relectura |
| `cloud/supabase/add_external_interaction_read_diagnostics_v0_1.sql` | Migracion diagnostica para lecturas crudas de interacciones externas | Agrega `external_interaction_read_diagnostics` para guardar la ultima lectura cruda de Calendar por evento, con emails detectados, contactos mapeados y motivo por el que paso o no al preview |
| `cloud/supabase/verify_schema_v0_1.sql` | Consulta metadata de Supabase/Postgres para verificar que las tablas esperadas existen, RLS esta habilitado y las policies fueron creadas | Creado localmente; se ejecuta solo despues del schema |
| `tools/legacy_migration` | Archivo historico de herramientas usadas para la primera carga/reparacion desde la app anterior | Fuera del runtime y fuera de `cloud/`; no debe usarse como fuente de reglas ni como adaptacion permanente del producto |
| `tools/dev_maintenance/supabase` | Scripts manuales de mantenimiento del ambiente dev | Incluye reset/verificacion de usuario dev para volver a base limpia antes de cargar desde conectores y diagnosticos read-only de sync por contacto; no se ejecuta sin confirmacion |
| `docs/PRIVACY_SECURITY_COMPLIANCE.md` | Manual vivo de privacidad, seguridad y cumplimiento | Gate documental del sprint de cuentas/usuarios/beta. Aterriza Ley 19.628, Ley 21.719, OAuth, datos personales, derechos del titular, logs, roles/capabilities, RLS y separacion entre datos privados/agregados. No reemplaza revision legal formal |
| `cloud/supabase/add_account_access_model_v0_1.sql` | Modelo de acceso beta v0.1 preparado, no ejecutado | Crea roles, planes, capacidades, organizaciones, membresias, patrocinios, resolvedor `current_user_has_capability`, trigger de alta de usuario y backfill para reemplazar gates de UI/env por permisos persistentes |
| `cloud/supabase/bootstrap_first_system_admin_v0_1.sql` | Bootstrap manual del primer administrador | Asigna o reactiva `system_admin`, `beta_tester` y `user` a un usuario existente por email. Requiere ejecutar primero el modelo de acceso y no permite auto-promocion desde la app |
| `cloud/supabase/verify_account_access_model_v0_1.sql` | Verificacion del modelo de acceso | Revisa tablas esperadas, RLS, seeds de roles/planes/capabilities, funcion de capability y trigger de alta de usuario |
| `cloud/supabase/verify_multiuser_readiness_v0_1.sql` | Verificacion estructural multiusuario | Consulta metadata solamente: revisa que tablas privadas esperadas tengan columna de dueno, RLS y policies, que catalogos globales no tengan `user_id`, y que existan resolvedor de capacidades y trigger de alta. No reemplaza la prueba real con dos usuarios |
| `cloud/web` | App web cloud Next/React para leer Supabase con Auth, Dashboard, Contactos, Cuenta y Sistema | Scaffold creado, dependencias instaladas, typecheck y build ok; pendiente validar visualmente contra Supabase limpio |
| `cloud/web/styles/tokens.css` | Tokens visuales base para la app cloud: paleta, estados, radios y sombras | Creado desde `docs/UI_STYLE_GUIDE.md` como inicio del design system cloud |
| `cloud/web/components` | Componentes reutilizables iniciales: shell, auth gate, metricas, tabla de contactos, badges de estado, Dashboard, Ficha, Cuenta y vistas read-only | Creado como capa UI reusable; no replica estilos por vista |
| `cloud/web/lib/cloudData.ts` | Capa comun de lectura Supabase para Dashboard, Contactos y Ficha | Creado para evitar queries dispersas; Contactos lee todos los activos por paginas, Ficha lee contacto/interacciones/referidos/ToDos por `contactId`, Dashboard calcula estados desde todos los activos, expone lectura global de referidos y delega KPIs a `kpiCalculations` |
| `cloud/web/lib/kpiCalculations.ts` | Motor cloud de KPIs del Dashboard | Calcula periodos semanales/mensuales, respeta fecha global de inicio de networking, acumulados, contactos distintos, empresas HH y primera vez sin mezclarlo con UI |
| `cloud/web/tests/kpiCalculations.test.ts` | Tests del motor KPI cloud | Valida fecha calendario sin corrimiento horario, contactos unicos, primer contacto, dominios HH unicos y maximo de 12 periodos |
| `cloud/web/tests/coachRuleEngine.test.ts` | Tests de reglas del Coach RULE | Valida prelacía base de estados: contactado, agendado, cita concretada por cita pasada, cita concretada por minuta, agradecimiento y guard de foco; tambien valida `HEADHUNTER_COMPANY_DETECTED` para completar empresa headhunter por dominio unico |
| `cloud/web/components/ui` | Componentes visuales globales para la app cloud: iconos SVG, botones, paneles y tarjetas metricas | Creado para que nuevas vistas no redefinan botones/iconos/paneles localmente |
| `cloud/web/components/DashboardPipeline.tsx` | Componente cloud para mostrar pipeline de estados con colores oficiales | Primera version usada en Dashboard read-only |
| `cloud/web/components/CoachPreview.tsx` | Modulo cloud reutilizable del Coach IA con mascota, botones estandar y burbujas | Exporta `CoachModule` parametrizable por contexto/contacto, con robot animado, parpadeo y boca activa al expandir sugerencias; traduce ToDos a lenguaje natural, resuelve evidencia contra interacciones para mostrar asunto/dias, usa nombres cortos en links y pinta estados con tokens oficiales; permite seleccionar multiples sugerencias, delega la ejecucion a acciones internas, busca nuevas sugerencias y abre historial del Coach |
| `cloud/web/components/CoachActionLogDialog.tsx` | Modal reutilizable de historial del Coach cloud | Muestra solo sugerencias no vigentes como log simple: mensaje igual a la burbuja activa, stamp `done`/`dismissed`/`expired`/`auto resolved`, fecha de cierre, filtros por estado y detalle colapsable con motivo, regla, evidencia y link al contacto |
| `cloud/web/lib/coachActions.ts` | Acciones ejecutables iniciales del Coach cloud | Implementa rutas accionables para `NETWORKING_STATUS_CHANGE`, `HEADHUNTER_COMPANY_DETECTED` y `todo.dismiss`: valida usuario, sugerencia y estado/dato oficial cuando aplica, actualiza `contacts.networking_status` o `contacts.company`, marca ToDos como `done` o `dismissed`, registra `action_invocations`, deja traza en `audit_log` y marca como `failed` los intentos que fallan despues de iniciarse. La misma accion sirve para ejecucion manual confirmada y autoejecucion por regla segura |
| `cloud/web/lib/contactActions.ts` | Acciones ejecutables de contacto cloud | Centraliza acciones de contacto cloud: `contact.update_networking_status` desde selector con autosave, `contact.update_flags` para foco/headhunter desde ficha, y `contact.create`/`contact.update` desde el editor global. Valida usuario/estado/email, guarda datos base, reemplaza emails/telefonos, registra `action_invocations` y `audit_log` |
| `cloud/web/lib/coachConfig.ts` | Capa cloud de configuracion del Coach | Lee, crea si faltan y guarda `todo_configs` solo para reglas aprobadas e implementadas, traduce tipos tecnicos a nombres/ejemplos/condiciones en lenguaje usuario, clasifica por familia/variable afectada y valida si una regla puede usar `execute_without_asking` |
| `cloud/web/lib/coachRuleEngine.ts` | Motor cloud inicial de reglas duras del Coach | Evalua reglas `RULE` de cambio de estado networking sobre contactos, participantes e interacciones importadas; respeta foco/contacto activo, direccion saliente estructurada, prelacia, dedupe, cierre de sugerencias no vigentes, `object_review_state` y preferencias `todo_configs`, incluyendo autoejecucion segura. Soporta revision masiva o acotada por contacto. Tambien evalua `HEADHUNTER_COMPANY_DETECTED` usando el maestro global de empresas headhunter: si un contacto marcado como headhunter no tiene empresa y un dominio coincide con una unica empresa, crea sugerencia para completar `contacts.company` |
| `cloud/web/lib/coachRuleTriggers.ts` | Gatillos acotados de reglas Coach | Encapsula la revision de reglas por contacto despues de cambios en contactos/interacciones, sin bloquear la accion principal si la revision falla |
| `cloud/web/lib/coachLog.ts` | Lectura del historial del Coach cloud | Encapsula consulta a `todos` cerrados, resuelve nombres de contacto e interacciones de evidencia, y ordena por `resolved_at`/`updated_at` para mostrar sugerencias que ya no estan activas |
| `cloud/web/lib/coachText.ts` | Textos reutilizables del Coach cloud | Centraliza parseo de estados/empresa/evidencia, nombres abreviados, fecha visible y mensajes/detalles de burbujas para que sugerencias activas e historial no dupliquen wording |
| `cloud/web/components/CoachConfigDialog.tsx` | Modal reutilizable para configurar automatizaciones del Coach | Se abre desde el engranaje del Coach, lista reglas por variable afectada y permite elegir `Pedir confirmacion siempre`, `Ejecutar sin preguntar` o `No volver a sugerir` sin duplicar la logica de configuracion |
| `cloud/web/components/ContactFilterControls.tsx` / `cloud/web/lib/contactFilters.ts` | Filtro global reutilizable de contactos | Centraliza buscador universal, selectores triestado de foco/headhunter, filtros expandibles por estado multi-seleccionable y objetivos estructurados por ID para Contactos y Dashboard; evita duplicar filtros por vista |
| `cloud/web/app/objetivos/page.tsx` / `cloud/web/components/ObjectivesPage.tsx` | Mantenedor cloud de Objetivos | Ruta principal `Objetivos` con CRUD minimalista en cuatro columnas: Industrias, Empresas, Cargos y Funciones. Usa acciones globales, muestra acciones contextuales solo al seleccionar un objetivo y permite vincular contactos desde un modal con buscador universal/checks |
| `cloud/web/components/ObjectiveSelector.tsx` | Selector/chips reutilizables de objetivos | Componente global para seleccionar multiples objetivos existentes desde el editor de contacto y mostrar chips compactos en ficha; no permite tags libres |
| `cloud/web/lib/objectiveActions.ts` | Acciones cloud de objetivos | Centraliza lectura, guardado, eliminacion y asociacion contacto-objetivo desde ambos sentidos: contacto a objetivos, objetivo a contactos y asignacion masiva desde Contactos. Tolera tablas aun no migradas al leer para que la app no caiga antes de ejecutar SQL. Lee asociaciones contacto-objetivo por lotes para evitar consultas demasiado grandes cuando existen muchos contactos |
| `cloud/web/lib/objectiveMetrics.ts` / `cloud/web/components/ObjectiveMetricsTable.tsx` | Metricas derivadas de objetivos | Calcula y muestra un resumen compacto por objetivo desde asociaciones, contactos, participantes e interacciones, sin crear tablas agregadas nuevas. Cuenta cafes unicos (`calendar` + `call`), respeta fecha de inicio de networking en Dashboard, permite mostrar/ocultar objetivos sin actividad y ordena por prioridad |
| `cloud/supabase/add_objectives_v0_1.sql` | Migracion preparada de Objetivos | Agrega tablas user-owned `objectives` y `contact_objective_assignments`, indices, triggers `updated_at` y RLS por usuario. No ejecutada aun; requiere aprobacion antes de correr en Supabase dev |
| `cloud/supabase/fix_objective_assignment_rls_v0_1.sql` | Ajuste RLS de asociaciones de Objetivos | Separa lectura simple por `user_id` de validaciones fuertes de escritura para evitar que permisos de asociaciones bloqueen vistas base como Contactos/Dashboard |
| `cloud/web/components/ContactTable.tsx` | Vista/tabla cloud de contactos | Lista contactos activos usando `ContactFilterControls`, toolbox de acciones masivas para foco/headhunter/estado usando `contactActions` y objetivos usando `objectiveActions`, orden por columnas visibles, indicador headhunter junto a empresa/cargo, ultima interaccion compacta y link a ficha mediante `/contactos?contactId=...` |
| `cloud/web/components/ContactEditorDialog.tsx` | Editor global de contacto cloud | Modal reutilizable para crear o editar contactos desde distintos contextos. Edita datos base, estado, foco, marca headhunter, correos y telefonos; delega persistencia a `saveContactFromEditor`. Cuando el contacto esta marcado como headhunter, lee el maestro global para mostrar una lista propia de empresas coincidentes mientras el usuario escribe. Ya no muestra campo manual de dominios/empresas headhunter; preserva los dominios internos existentes al guardar para evitar perdida accidental mientras se migra esa logica al maestro/Coach |
| `cloud/web/components/ContactProfile.tsx` | Ficha cloud de contacto | Bloque madre cloud de contacto: datos/estado, interacciones, referidos y Coach contextual filtrado. Reutiliza `CoachModule`, `ContactDataSyncButton`, `ActivitySyncButton`, `InteractionTimelineList`, iconos/botones globales, accion interna para guardar estado networking y abre el editor global de contacto desde el icono editar. En la cabecera de datos, el sync actualiza datos del contacto desde Google Contacts; en el bloque de interacciones, el sync actualiza Gmail/Calendar para ese contacto |
| `cloud/web/components/InteractionTimelineList.tsx` | Timeline reutilizable de interacciones | Componente unico para filas compactas expandibles de interacciones. En ficha muestra minuta/origen/participantes; en Dashboard agrega contacto vinculado, estado y dias sin contacto sin duplicar la fila base |
| `cloud/web/components/ReferralEditorDialog.tsx` | Editor global de referido cloud | Modal reutilizable para crear/editar referidos desde la ficha. Permite guardar el apunte libre, vincular/desvincular contacto existente, abrir el editor global de contacto y marcar cambios rapidos pendientes para actualizar el contacto vinculado desde datos del referido al guardar |
| `cloud/web/components/InteractionEditorDialog.tsx` | Editor global de interaccion/minuta cloud | Modal reutilizable para editar minuta de interacciones existentes o crear una interaccion manual asociada al contacto actual desde la ficha. Al crear, el sentido parte como `Sin definir` |
| `cloud/web/components/SyncPreviewDialog.tsx` | Preview global de sincronizacion cloud | Modal reutilizable para revisar cambios antes de aplicar sync: usa pestanas accionables como `Nuevos`, `Modificaciones`, `Duplicados fusionables`, `Duplicados complejos`, `Eliminaciones` y `Omitidas`; cada pestana mantiene seleccion/desmarcado propio, pero el footer aplica la seleccion total de todas las pestanas en un solo flujo. Los elementos `Sin cambios` no se muestran como pestana ni cuentan como pendientes, para evitar confundirlos con cambios aplicables; si hace falta, quedan solo como conteo diagnostico del flujo llamador. El footer muestra una sola linea de seleccion/pendientes o `No hay cambios para aplicar.`; omite conteos tecnicos como candidatos revisados y muestra solo errores reales o progreso de aplicacion. Destaca campos cambiados con tokens oficiales, soporta operaciones `add`/`remove`/`replace`/`match`/`info` y devuelve la seleccion al flujo llamador sin escribir datos por si mismo. En `Nuevos`, `Modificaciones`, `Duplicados fusionables` y `Duplicados complejos`, el boton compacto `Editar datos` abre `ContactMergeDialog` como borrador para guardar una decision estructurada antes de aplicar. En `Duplicados complejos`, si el grupo trae 2 o 3 contactos ya guardados, el conteo `guardados` puede abrir la misma fusion profunda con esos contactos preseleccionados. Los flujos que lo invocan remueven localmente los cambios aplicados con exito, mantienen visibles los pendientes o fallidos sin releer el proveedor y bloquean cerrar mientras estan aplicando |
| `cloud/web/components/ContactSyncPreviewSandbox.tsx` | Sandbox interno de preview de contactos | Bloque oculto en `/sistema/diseno` para cargar contactos reales de la app, simular una fuente conectada, abrir `SyncPreviewDialog` y probar `contactSyncApply` con dependencias simuladas. Sirve para validar UX, seleccion, pendientes y cursor sin escribir datos en Supabase ni llamar Google real |
| `cloud/web/components/ContactMergeWorkspace.tsx` | Workspace global de fusion de contactos | Componente reutilizable para comparar 2 o 3 contactos origen y construir un contacto resultante: identidad editable/seleccionable, correos/telefonos multivalor, switches foco/headhunter y estado networking editable. Puede recibir contactos disponibles y mostrar `Agregar contacto guardado` dentro del modal hasta completar el maximo de 3, evitando selectores manuales fuera de la funcion global |
| `cloud/web/components/ContactMergeDialog.tsx` | Modal global de fusion/edicion de resultante | Popup productivo que envuelve `ContactMergeWorkspace` y devuelve `ContactMergeResult` junto con las fuentes usadas al flujo llamador. Primer uso: boton `Editar datos` de `SyncPreviewDialog` para contactos nuevos y modificaciones. En sync, permite una sola fuente cuando se edita un contacto nuevo, porque solo ajusta el borrador; la escritura real ocurre despues con `Aplicar seleccion`. En Cuenta y duplicados complejos sigue exigiendo 2 o mas contactos y puede guardar fusion profunda de contactos ya guardados mediante `merge_contacts_deep` |
| `cloud/web/components/ContactMergePreview.tsx` | Referencia visual de fusion de contactos | Demo en `/sistema/diseno` que consume `ContactMergeWorkspace`; sirve para validar el diseño sin duplicar la implementacion productiva |
| `cloud/web/lib/contactMerge.ts` | Contrato de fusion de contactos | Define `ContactMergeSource`, `ContactMergeResult`, defaults de resultante, prelacion de estado, helpers para convertir contactos app/proveedor al contrato comun y helpers puros para adjuntar/leer `contactMergeDecision` dentro de un `SyncPreviewChange` |
| `cloud/web/lib/contactMergeActions.ts` | Accion interna de fusion profunda | Wrapper reutilizable para llamar `merge_contacts_deep` desde UI, sync, Coach o automatizaciones. Normaliza inputs, exige nombre, maximo 3 contactos totales y devuelve conteos de objetos movidos |
| `cloud/supabase/merge_contacts_deep_v0_2.sql` | Funcion transaccional de fusion profunda | RPC `merge_contacts_deep`: actualiza el contacto resultante, deja emails/telefonos segun el resultado, mueve IDs externos, participantes de interacciones, referidos, ToDos y estados de revision al contacto destino, desactiva contactos origen y registra accion/auditoria. Ejecutada y verificada en Supabase dev el 2026-08-04 |
| `cloud/web/components/AccountPage.tsx` | Pagina Cuenta cloud | Vista compacta para perfil/plan, servicios conectados, fecha de inicio de networking, revision de duplicados y acciones delicadas. Separa cuenta de acceso de cuentas conectadas para importar datos; `Servicios conectados` integra Google con acciones de importar contactos, correos y citas mediante `GoogleContactsSyncPanel`/`GoogleInteractionsSyncPanel` en modo compacto. Distingue cuenta Google vinculada desde `connected_accounts` de permiso temporal activo para importar, muestra cuenta/permisos conocidos y permite desvincular Google dentro de la app sin borrar datos importados. Limitacion vigente: no guarda refresh tokens; si el token de sesion vence, el usuario debe reconectar/actualizar permiso |
| `cloud/web/components/AdminMaintenancePage.tsx` | Vista admin de mantencion | Ruta `Sistema > Mantencion admin` para revisar seguros app, limites de proveedor, acumulados internos por periodo, accesos de usuarios y datos crudos de diagnostico. El acceso se valida con capability `admin.manage_access`, no con email/localhost. Incluye `AccessAdminPanel` y `DataDiagnosticsPanel`; el visor cubre tablas operativas principales y tablas del modelo de acceso, rotuladas como `Global`, `Usuario` o `Sistema`, excluyendo columnas sensibles como tokens OAuth |
| `cloud/web/components/AccessAdminPanel.tsx` | Mantenedor inicial de accesos | Panel admin para ver usuarios, plan vigente, roles activos y asignaciones; permite cambiar plan y activar/desactivar roles usando acciones compartidas. Pide confirmacion antes de guardar cambios sensibles y bloquea desactivar el ultimo `system_admin`. Es el primer corte de mantenedor, no billing definitivo |
| `cloud/web/lib/accessControl.ts` | Resolvedor cliente de capacidades | Helper comun que lee la sesion Supabase y consulta RPC `current_user_has_capability`; devuelve estados `allowed`, `denied`, `no_session`, `missing_model` o `error` para que las vistas no dupliquen reglas de permisos. Expone `requireCurrentUserCapability` para bloquear acciones sensibles con un mensaje unico |
| `cloud/web/lib/accountDataActions.ts` | Acciones delicadas de datos de cuenta | Accion cliente para reiniciar los datos operativos del usuario autenticado mediante RPC, validando `data.delete_account` antes de llamar la base |
| `cloud/web/lib/adminAccess.ts` | Compatibilidad de gate admin | Wrapper que delega en `accessControl`; mantiene la interfaz existente de vistas admin sin usar `NEXT_PUBLIC_ADMIN_EMAILS` ni localhost |
| `cloud/web/lib/accessAdminActions.ts` | Acciones admin de acceso | Lee perfiles, planes, roles, capabilities y asignaciones; guarda plan y roles desde el mantenedor admin. Cada funcion valida `admin.manage_access` antes de leer o escribir |
| `cloud/web/lib/connectedAccounts.ts` | Estado persistente de cuentas conectadas | Lee `connected_accounts`, acumula scopes conocidos desde el flujo OAuth iniciado por la app, marca la cuenta Google actual como vinculada solo cuando existe una accion OAuth recordada y permite revocar la conexion dentro de la app, sin persistir refresh tokens. Expone `readCurrentGoogleConnectionState` como lector comun para que Cuenta, ficha y botones de importacion no usen un token temporal si no existe conexion activa persistente |
| `cloud/web/components/SyncLogsPage.tsx` | Visor de logs de sincronizacion | Ruta `Sistema > Logs` para leer las ultimas filas de `sync_run_logs` del usuario actual. Muestra pasos por proveedor/recurso/operacion/alcance con estado y detalle, pensado para diagnostico operativo sin ensuciar Cuenta ni depender de SQL manual. Los detalles y metadata se guardan mediante `syncRunLog`, que redacta correos, telefonos, tokens y claves sensibles antes de persistir |
| `cloud/web/components/GoogleContactsSyncPanel.tsx` | Panel real de sync Google Contacts cloud | Bloque beta en `Cuenta` para conectar/reconectar Google con scope `contacts.readonly`, preparar preview real con `googleContactSyncFlow`, mostrar `SyncPreviewDialog` y aplicar solo la seleccion mediante `contactSyncApply`. Tiene modo compacto para vivir dentro de `Servicios conectados`, mostrando contador de contactos vinculados y botones de importar/borrar importados. El borrado importado queda placeholder no destructivo hasta definir politica. No escribe en Google; escribe en la copia cloud solo despues de confirmacion. Revisa capability `contacts.import_google` y conexion persistente activa antes de preparar o aplicar; si falta token fresco, solicita reconexion. Muestra `ProgressBar` global mientras revisa/aplica para que lotes grandes no parezcan congelados. Escribe pasos operativos en `sync_run_logs` y ya no muestra diagnostico tecnico incrustado en Cuenta. Lee desde `usageLimitSettings` el tope editable de paginas por revision. La importacion de contactos no fusiona duplicados; despues de importar, la revision local de duplicados se hace en Cuenta con la funcion global `Fusionar contactos`. El cliente People API pide `requestSyncToken` solo en la primera pagina de una lectura completa y usa `syncToken` solo en modo incremental |
| `cloud/web/components/NetworkingStartDateSetting.tsx` | Control de fecha de inicio de networking | Bloque reutilizable en `Cuenta` para leer y actualizar `Fecha_Inicio_Networking` con confirmacion explicita. Mantiene la vista minimalista y explica impacto sobre reconstruccion historica de Gmail/Calendar y KPIs del Dashboard solo al guardar |
| `cloud/web/components/GoogleInteractionsSyncPanel.tsx` | Panel de importacion historica de actividad | Bloque beta en `Cuenta` para forzar nueva lectura read-only desde la fecha global de inicio de networking sobre contactos en foco; en Calendar tambien revisa una ventana futura movil de 3 meses. Separa la revision/aplicacion de Gmail y Google Calendar en dos acciones visibles (`Importar correos` e `Importar citas`), pero ambas reutilizan `syncGoogleInteractions` con `includeMail`/`includeCalendar` para no duplicar motor. Tiene modo compacto para `Servicios conectados`, mostrando filas separadas de correos y citas con contadores vinculados y placeholders no destructivos de borrar importados. Usa modo dry-run/apply, `forceFullSync`, `focusedOnly` y sin guardar cursores, para que las revisiones historicas pesadas no muevan el puntero incremental diario. Revisa capability `interactions.import_google` y conexion persistente activa antes de preparar o aplicar; si falta token fresco, solicita reconexion. Reutiliza `SyncPreviewDialog` para revisar interacciones nuevas, modificadas y omitidas antes de aplicar; la ventana se abre aunque no haya cambios accionables para dejar claro el resultado. Escribe pasos en `sync_run_logs` y evita dejar mensajes tecnicos persistentes en Cuenta |
| `cloud/web/components/ContactDataSyncButton.tsx` | Boton de sync de datos del contacto | Entrada UI reutilizable para actualizar un contacto ya vinculado a Google Contacts desde la ficha. Lee el ID externo del contacto, trae ese registro puntual desde People API, arma preview con `buildContactSyncPreview`, aplica con `applyContactSyncPreview` y registra pasos en `sync_run_logs`, sin mezclar correos/citas. Revisa capability `contacts.import_google` y conexion Google persistente antes de llamar Google. Antes de llamar Google lee la sesion OAuth fresca mediante `readCurrentGoogleConnectionState`, muestra estado informativo en la ficha durante conexion/revision y usa reconexion Google sin flash rojo cuando el permiso vencio |
| `cloud/web/components/ActivitySyncButton.tsx` | Boton reutilizable de sync de interacciones | Entrada UI comun para actualizar Gmail/Calendar desde distintos contextos. Variante global: `Actualizar interacciones`, incremental sobre contactos en foco y guarda cursores cuando el modo de lectura del proveedor lo permite. Variante ficha: `Actualizar interacciones contacto`, usa etiqueta propia `contact:{id}` para no mover el cursor global y vive en el bloque de interacciones. Ambas variantes aplican la fecha global de inicio para Gmail y Calendar; en Calendar agregan una ventana futura de 3 meses para traer proximas citas aunque no hayan ocurrido todavia. Usan scopes Google read-only, validan `interactions.import_google`, conexion Google persistente y token fresco antes de llamar al mismo `syncGoogleInteractions`; muestran preview antes de aplicar mediante `SyncPreviewDialog` aunque no haya cambios accionables y escriben pasos en `sync_run_logs`. Leen la conexion mediante `readCurrentGoogleConnectionState`, muestran estado informativo en la ficha durante conexion/revision/reconexion y evitan pintar permiso vencido como error rojo cuando pueden redirigir a reconexion. Si Gmail o Calendar no tiene permiso pero el otro servicio si puede leerse, el preview sigue y el permiso faltante queda como advertencia. Gmail busca `from`/`to`/`cc`/`bcc` por correos del contacto o foco; Calendar busca por emails del alcance cuando no usa syncToken y luego filtra al mapear participantes |
| `cloud/web/lib/googleAuthSession.ts` | Sesion Google de UI | Helper cliente para leer el token Google fresco desde Supabase Auth justo antes de llamar a Google, iniciar reconexion OAuth con scopes declarados y recordar temporalmente que scopes pidio el usuario para actualizar `connected_accounts`. Evita que los botones dependan de una copia vieja del `provider_token` tomada al montar la vista |
| `cloud/web/components/InteractionSyncResultSummary.tsx` / `cloud/web/lib/interactionSyncText.ts` | Resumen reutilizable de sync de actividad | Centraliza wording y conteos de Gmail/Calendar para que Cuenta, boton global y futuros previews interpreten igual `posibles`, `nuevos`, `modificados` y `omitidos` |
| `cloud/web/lib/interactionSyncPreview.ts` | Helpers de preview de actividad | Centraliza extraccion de cambios accionables y IDs externos seleccionados para que Cuenta, ficha y futuras vistas no dupliquen la logica de aplicar interacciones seleccionadas |
| `cloud/web/components/ContactDuplicateReviewPanel.tsx` | Revision local y manual de duplicados guardados | Panel compacto en `Cuenta` que muestra solo resumen y boton `Gestionar duplicados`; el listado vive en modal. Lee contactos activos, usa `contactDuplicateReview` para detectar grupos duplicados y reutiliza `ContactMergeDialog` + `mergeContactsDeep` para fusionar grupos de hasta 3 contactos guardados. La fusion manual se expone como un boton simple; la busqueda/agregado de contactos vive dentro del modal global, con tope de 3 contactos |
| `cloud/web/lib/contactSyncPreview.ts` | Motor puro de preview de contactos | Compara contactos internos con contactos normalizados de una fuente externa y genera `SyncPreviewChange` sin escribir datos: nuevos, modificaciones, eliminaciones y revisados sin cambios. La prioridad de pareo es el ID externo guardado en `external_contact_ids`; si el ID actual no esta enlazado, para Google revisa `previousResourceNames` antes de clasificar como nuevo. Si el proveedor ya esta enlazado a un contacto app, ese contacto solo puede quedar como modificado, eliminado o sin cambios; si el ID externo no esta enlazado ni se reconoce por ID anterior, entra como `Nuevo` aunque comparta correo o telefono con contactos guardados o con otros contactos de la fuente. La revision/fusion por correo o telefono queda separada para la herramienta de duplicados posterior. Protege datos enriquecidos: Nombre, Empresa y Cargo guardados no se reemplazan automaticamente, solo se completan si estan vacios; en `Modificaciones` muestra diferencias ignoradas con `apply: false` para que la UI marque `(no aplicado)`; un campo vacio en la fuente no borra un dato local; eliminaciones de correos/telefonos solo se muestran como no aplicadas si el valor era conocido desde esa misma fuente y no esta suprimido. Las eliminaciones completas de contacto por ausencia solo se calculan en revision completa/historica; en incremental solo se aceptan si la fuente manda explicitamente el contacto como eliminado. Expone `traceContactSyncPreviewBranches` como trazador puro para diagnosticar el arbol de decision sin escribir datos ni tocar proveedores |
| `cloud/web/lib/contactDuplicateReview.ts` | Motor puro de revision de duplicados guardados | Detecta contactos activos duplicados por correo normalizado o identidad de telefono. Usa grafo de conexiones, por lo que agrupa duplicados indirectos si A comparte telefono con B y B comparte correo con C. Devuelve grupos con label, contactos, claves compartidas y fuentes listas para `ContactMergeDialog` |
| `cloud/web/lib/headhunterCompanyMaster.ts` | Motor puro del maestro headhunter | Normaliza nombres/dominios y resuelve si un contacto headhunter calza por empresa oficial, por dominio unico, queda ambiguo o no resuelto. No escribe datos ni depende de Google |
| `cloud/web/lib/headhunterCompanyActions.ts` | Acciones del maestro headhunter cloud | Lee empresas headhunter desde el catalogo global de la app y crea empresas/dominios solo despues de validar `admin.manage_global_masters`. La lectura sigue disponible para usuarios autenticados porque alimenta Contactos, ficha, Coach y Dashboard |
| `cloud/web/lib/phoneIdentity.ts` | Identidad normalizada de telefonos | Helper reutilizable para comparar telefonos sin depender del formato textual. Genera identidades por digitos completos, formato nacional inferido y ultimos 8 digitos; primera cobertura explicita: Chile, Peru, Argentina, Colombia, Mexico, Brasil y USA. En Chile reconoce moviles con `9` duplicado despues de `+56`. Los paises soportados viven en `SUPPORTED_PHONE_COUNTRIES`, para sumar nuevos codigos sin tocar la logica central. Lo usa `contactSyncPreview` para evitar falsos agregados cuando un proveedor trae codigo de pais, formato internacional distinto o duplicados equivalentes |
| `cloud/web/lib/externalContactSnapshots.ts` | Contrato de snapshot de contactos externos | Helper reusable para construir la foto cruda de un contacto de proveedor, extraerla desde metadata de preview, transformarla al payload de Supabase y derivar valores conocidos de correo/telefono desde snapshots vinculados. Evita comparar Google actual contra telefonos/correos locales ya normalizados |
| `cloud/web/lib/contactSyncApply.ts` | Accion para aplicar preview de contactos | Aplica solo los cambios seleccionados de un preview de contactos: crea contactos nuevos, actualiza campos simples, agrega medios nuevos asociados a la fuente conectada y desactiva contactos eliminados de la fuente. Antes de escribir, valida la preparacion de Supabase con `validate_contact_sync_storage_v0_1`; si falta tabla, indice o queda un indice unico antiguo, falla sin crear filas parciales. Si un cambio nuevo o modificado trae `contactMergeDecision`, guarda el resultante definido por el usuario al crear o actualizar el contacto. En contactos nuevos, enlaza el ID externo apenas se crea el contacto interno y antes de completar medios, para que una interrupcion posterior se recupere como modificacion. Los contactos creados por importacion parten fuera de foco networking por defecto; entrar en foco debe ser una decision del usuario o de una accion explicita. Permite que correos o telefonos repetidos existan en contactos distintos; la unicidad de `contact_emails` y `contact_phones` es por contacto, porque los duplicados se resuelven en una etapa posterior. Al aplicar un cambio exitoso, guarda o actualiza `external_contact_snapshots` con la foto cruda del proveedor, incluyendo cumpleanos de Google, sin reflejarla aun en la ficha local. Confirma inmediatamente que el proveedor quedo enlazado al contacto destino; si no puede confirmarlo, falla el cambio en lugar de mostrar un falso exito. Devuelve `appliedChangeIds` y `failedChangeIds` para que la UI pueda remover solo lo aplicado y mantener visible lo fallido. Guarda el cursor nuevo solo si no hubo errores ni cambios pendientes |
| `cloud/web/components/ui/ContactSearchSelect.tsx` | Selector buscable global de contacto | Componente reutilizable para elegir contactos por texto, filtrando por nombre, empresa, cargo, correo o telefono. Primer uso: vincular referidos |
| `cloud/web/components/ui/ProgressBar.tsx` | Barra global de progreso | Componente reutilizable para procesos largos de sync, importacion, reconstruccion historica o acciones por lote. Soporta progreso conocido con `value`/`max`, estado indeterminado y tonos basados en la paleta oficial |
| `cloud/web/lib/contactDraft.ts` | Borrador reutilizable de contacto | Construye un `ContactEditorInput` a partir de un contacto existente y un patch de cambios pendientes. Lo usan el guardado rapido desde referidos y el editor oficial de contacto para evitar rutas divergentes |
| `cloud/web/lib/interactionActions.ts` | Acciones ejecutables de interacciones cloud | Centraliza `interaction.create_manual`, `interaction.update_user_notes` e `interaction.dismiss`, validando usuario/contacto/tipo/fecha cuando aplica, creando participante para interacciones nuevas y registrando `action_invocations`/`audit_log`. `interaction.dismiss` archiva por `metadata` y escribe columnas soft-delete si existen |
| `cloud/web/lib/interactionState.ts` | Estado operativo de interacciones | Helper reutilizable para detectar interacciones archivadas y excluirlas de ficha, Dashboard/KPIs y reglas del Coach sin duplicar filtros |
| `cloud/web/lib/externalInteractionSync.ts` | Capa comun de sync de interacciones externas | Recibe objetos externos normalizados desde cualquier adaptador de proveedor, crea/actualiza `interactions` sin pisar `user_notes_raw` en registros existentes, guarda `external_interaction_sources`, agrega participantes faltantes de forma conservadora, respeta `prevent_reimport`, registra auditoria basica y expone helpers de puntero `object_review_state` para que Coach sepa si debe revisar una version de interaccion |
| `cloud/web/lib/externalInteractionReadDiagnostics.ts` | Diagnostico de lecturas externas | Guarda snapshots acotados de eventos Google Calendar leidos antes del filtro final, separados de `interactions`, para auditar por que un evento quedo como candidato, filtrado o sin contacto mapeado. No persiste descripcion/cuerpo crudo del evento: guarda flags, conteos, fechas, estado, asunto sanitizado y participantes normalizados |
| `cloud/web/lib/googleInteractionAdapter.ts` | Adaptador Google para interacciones | Convierte objetos Gmail y Google Calendar ya leidos por un futuro cliente Google al formato comun de `externalInteractionSync`. Implementa regla anti-ruido de Gmail: descarta correos donde un tercero envia y usuario/contacto solo estan copiados; soporta participantes `FROM`, `TO`, `CC`, `BCC`, link Gmail web y `htmlLink` de Calendar. En Calendar deduplica participantes por identidad contacto/email para no mostrar el mismo invitado dos veces si Google lo entrega como organizador y asistente |
| `cloud/web/lib/googleInteractionClient.ts` | Cliente read-only Gmail/Calendar | Lee Gmail y Google Calendar con access token autorizado, query opcional, paginacion acotada, limites por corrida, errores claros de permisos/token, cursor incremental Gmail por `historyId` oficial y cursor incremental Calendar por `syncToken`. Calendar solicita tambien invitaciones ocultas para no perder citas invitadas/no visibles. Los techos internos respetan maximos de pagina cercanos al proveedor: Gmail hasta 500 mensajes por pagina y Calendar hasta 2500 eventos por pagina. No guarda datos ni escribe en Google |
| `cloud/web/lib/googleInteractionSyncFlow.ts` | Flujo Google de sync de interacciones | Ensambla contactos app, cursores, cliente Google, adaptador Google y orquestador comun para importar Gmail/Calendar como interacciones app vinculadas a origen externo. Soporta alcance por contactos especificos, solo contactos en foco, revision historica forzada, queries Gmail/Calendar cuando corresponde y control explicito de guardado de cursores. Para Gmail con alcance de foco genera query por correos de contactos foco para no barrer la cuenta completa, y la fecha `after:` se envia como segundos Unix para evitar interpretaciones por zona horaria. Para Calendar, cuando la lectura no usa `syncToken`, consulta por emails del alcance, lee primero la ventana futura de 3 meses y luego el historico desde la fecha global, deduplicando eventos por ID antes de mapear participantes; si usa cursor incremental, respeta la restriccion de Google de no combinar `syncToken` con filtros de busqueda y agrega una pasada futura acotada por contactos foco para no perder citas futuras existentes. Despues de leer desde Google, vuelve a aplicar internamente la fecha global de inicio sobre Gmail y Calendar para que ningun cursor o respuesta incremental deje pasar objetos antiguos. Guarda cursores solo si el lote queda ok, no es dry-run y el flujo lo permite; si Gmail o Calendar informan cursor vencido, marca el cursor y reintenta lectura historica. En dry-run arma preview comparando la fuente actual contra `external_interaction_sources`, normalizando los IDs externos igual que el guardado y comparando fechas como instantes reales, no como texto, para no volver a mostrar falsos nuevos o falsas modificaciones de fecha, sin tocar minutas. Cuando `saveReadDiagnostics` esta activo, guarda las lecturas crudas de Calendar en `external_interaction_read_diagnostics` para diagnostico sin convertirlas en interacciones reales |
| `cloud/web/lib/syncDate.ts` | Helper de fechas globales de sync | Lee y normaliza `Fecha_Inicio_Networking` desde settings para que Cuenta, ficha y futuros botones usen la misma fecha base sin duplicar parseo |
| `cloud/web/lib/userSettingsActions.ts` | Acciones de configuracion de usuario | Guarda settings por usuario en `user_settings` usando Supabase Auth y RLS. Primer uso: fecha base de actividad/networking |
| `cloud/web/lib/usageLimitCatalog.ts` | Catalogo beta de limites y proveedores | Centraliza parametros iniciales de guardrails para Gmail, Google Calendar, Google Contacts y Supabase: seguro app, limite proveedor, topes por revision, unidad, ventana de reseteo, ranking de impacto, variables de capacidad que escalan el indicador y referencias externas observadas cuando aun no hay eventos internos. Lo consume la vista admin y debe ser la fuente futura para enforcement de sync |
| `cloud/web/lib/usageLimitSettings.ts` | Lectura/escritura de limites admin | Helper compartido para leer overrides de `user_settings`, limpiar parametros guardados y resolver el valor app efectivo por ID. Lo usan Mantencion admin, sync de contactos y sync de actividad para evitar constantes duplicadas |
| `cloud/web/lib/googleContactAdapter.ts` | Adaptador Google para contactos | Convierte personas de Google People API al contrato externo comun de contactos: ID externo, nombre, empresa, cargo, correos, telefonos, `etag`, `deleted` y `previousResourceNames`. No llama APIs; solo normaliza objetos ya leidos por el futuro cliente Google |
| `cloud/web/lib/googleContactsClient.ts` | Cliente read-only Google Contacts | Lee `people/me/connections` usando un access token ya autorizado, `personFields`, paginacion, `requestSyncToken`, `syncToken` incremental y limite de paginas. Solicita `birthdays` junto a nombre, correos, telefonos, organizaciones y metadata. Devuelve contactos externos normalizados, `nextSyncToken`, advertencias y error explicito para cursor vencido `EXPIRED_SYNC_TOKEN`. Si Google rechaza una lectura incremental con `Request contains an invalid argument`, lo trata como cursor incompatible para que el flujo pueda reintentar lectura completa. No guarda tokens ni escribe datos |
| `cloud/web/lib/googleContactSyncFlow.ts` | Flujo de preview Google Contacts | Ensambla contactos app, referencias externas, snapshots externos, cursor guardado y lectura Google read-only para preparar un preview real de contactos. El pareo con contactos app usa solo enlaces modernos en `external_contact_ids`; no usa campos legacy como respaldo. Lee enlaces externos y snapshots desde Supabase con paginacion interna de 1000 filas para no depender del tope de filas de PostgREST; esto evita que contactos ya enlazados aparezcan como `Nuevos` cuando hay mas de 1000 vinculos. Los valores conocidos por fuente se leen desde `external_contact_snapshots`, no desde `contact_emails`/`contact_phones`, para que las diferencias de formato local no generen falsos cambios. Si el cursor vence, lo marca vencido y reintenta una lectura completa. Si Google rechaza una lectura completa al solicitar cursor futuro, reintenta la misma lectura sin pedir cursor incremental y lo deja visible en diagnostico. No aplica cambios ni guarda el cursor nuevo |
| `cloud/web/lib/syncCursorStore.ts` | Cursores de sync cloud | Lee, guarda y marca como vencidos los cursores incrementales en `sync_cursors`, filtrados por usuario, proveedor, recurso y etiqueta. Es reutilizable por contactos, mail, calendario y futuros proveedores |
| `cloud/web/lib/syncOrchestrator.ts` | Orquestador comun de sincronizacion cloud | Define contratos reutilizables de sync para contactos, mail, calendario y mensajes: provider, recurso, modo, alcance, cursores, dry-run, conteos, errores y objetos afectados. `syncMailInteractions` y `syncCalendarInteractions` ejecutan lotes de interacciones normalizadas usando `externalInteractionSync`; `syncContacts` genera preview si recibe contactos internos y externos, y bloquea la sync si faltan datos para revisar antes de aplicar |
| `cloud/web/lib/referralActions.ts` | Acciones ejecutables de referidos cloud | Centraliza `referral.create`, `referral.update` y `referral.dismiss`. Valida contacto que refiere, contacto vinculado, datos minimos, email/telefono, y registra `action_invocations`/`audit_log` |
| `cloud/web/components/RecentCards.tsx` | Componentes cloud para tarjetas recientes simples | Queda como apoyo para tarjetas simples; las interacciones compactas de Ficha/Dashboard viven en `InteractionTimelineList` |
| `cloud/web/components/DashboardKpis.tsx` | Componente cloud para KPIs superiores del Dashboard con linea de tendencia, barras de primera vez y acumulado | Usa datos ya calculados por `kpiCalculations`; soporta semanal/mensual mediante parametros del Dashboard |
| `cloud/web/components/HeadhunterCompanies.tsx` | Componente cloud para resumen de empresas headhunter | Tabla read-only con seleccion por empresa/dominio, `sin email` destacado y salida parametrizada para filtrar Ultimas interacciones sin recalcular en UI |
| `cloud/web/components/HeadhunterCompanyMasterPage.tsx` | Mantenedor base de empresas headhunter | Pantalla simple accesible desde `Sistema > Mantencion admin` para crear empresas y dominios del maestro; reutiliza el gate admin beta. El editor de contacto y la tabla de Contactos ya consumen ese catalogo para resolucion/autocompletado. Pendiente conectar edicion completa y proteger tambien con roles/RLS reales |
| `cloud/web/components/ReferralActions.tsx` | Variante Dashboard de referidos activos | Reutiliza clases/patron visual de tarjetas de referidos, mostrando contacto que refiere, datos del referido y contacto vinculado en layout ancho; en mobile se apila como ficha |
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

Estado cloud actual: `contact.update_networking_status`, `contact.update_company`, `contact.update_flags`, `contact.create`, `contact.update`, `contact.merge_deep`, `interaction.create_manual`, `interaction.update_user_notes`, `interaction.dismiss`, `referral.create`, `referral.update`, `referral.dismiss`, `todo.dismiss`, `sync.mail`, `sync.calendar`, contrato seguro `sync.contacts` y `sync.contacts.apply_preview` ya tienen una primera implementacion. La Ficha cloud usa `contactActions.ts` para guardar estado networking, foco y marca headhunter; el editor global usa la misma capa para crear/editar contactos con auditoria. Interacciones usa `interactionActions.ts` para crear/editar minutas desde la ficha y archivar interacciones con confirmacion. Referidos usa `referralActions.ts` para crear/editar/vincular/eliminar desde la ficha. Sync usa `syncOrchestrator.ts`, `googleContactSyncFlow.ts` y `contactSyncApply.ts` para que botones, flujos, reglas, Coach IA o futuros agentes puedan llamar funciones con inputs/outputs estables. El Coach ya usa `contact.update_networking_status` para estados y `contact.update_company` para completar empresa headhunter detectada por dominio unico. `contactSyncApply` ya deriva a `contact.merge_deep` cuando una propuesta de `Duplicados fusionables` contiene mas de un contacto `Guardado`, usando el mismo resultante del popup o el default del contrato global. Falta convertirlas en registry mas amplio, agregar accion de revertir/desactivar y reutilizarlas tambien desde Contactos/Dashboard/Coach cuando esas acciones se migren a cloud.

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

- 2026-08-26: Se agrega `docs/PRIVACY_SECURITY_COMPLIANCE.md` como gate arquitectonico antes de beta multiusuario. El sprint de cuentas debe cerrar roles/capabilities, conexiones persistentes, RLS admin, manejo de tokens, logs minimizados y prueba con dos usuarios.
- 2026-08-26: Se prepara `cloud/supabase/add_account_access_model_v0_1.sql` como propuesta no ejecutada para modelo de acceso v0.1 y resolvedor central de capacidades.
- 2026-08-26: Se implementa primer corte cloud del modelo de acceso en codigo: gate admin por capability, mantenedor inicial de accesos, SQL de bootstrap/verificacion y Cuenta leyendo conexion Google desde `connected_accounts`.
- 2026-07-15: Se reemplazan "funciones representativas" por inventario completo de funciones actuales.
- 2026-07-15: Se agregan funciones de KPIs para contactos realizados y empresas HH realizadas.
- 2026-07-15: Se ajusta deteccion de interacciones salientes para registros legacy sin `Rol_Email`.
- 2026-07-28: En cloud, `kpiCalculations` usa fecha calendario para bucket semanal/mensual y evita que `YYYY-MM-DDT00:00:00Z` se mueva al dia/mes anterior por zona horaria del navegador.
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
- 2026-07-27: Se crearon herramientas transicionales para validar/cargar un ZIP de continuidad a Supabase dev.
- 2026-08-11: Esas herramientas transicionales se mueven a `tools/legacy_migration` y dejan de considerarse parte de la app cloud. El producto nuevo debe alimentarse desde conectores y migraciones futuras adaptadas al modelo nuevo.
- 2026-07-27: Se crea `cloud/web` como primera app cloud Next/React en modo lectura, con componentes y tokens globales preparados para Vercel/Supabase; dependencias instaladas, typecheck y build validados.
- 2026-07-27: Se agrega `cloud/web/lib/cloudData.ts` para centralizar lectura cloud; Contactos deja de limitarse a 300 filas y Dashboard cuenta estados sobre todos los contactos activos.
- 2026-07-27: Se agrega anexo visual cloud `/sistema/diseno` y componentes UI globales para iconos, botones y metricas.
- 2026-07-28: Dashboard cloud read-only empieza rediseño modular con `Panel`, `DashboardPipeline`, `CoachPreview` y `RecentCards`; se corrige login para no quedar pegado indefinidamente en carga.
- 2026-07-28: Dashboard cloud se reordena para comparabilidad con Streamlit: KPIs, Coach IA, Empresas headhunter, Ultimas interacciones y Referidos sugeridos; se agregan componentes `DashboardKpis`, `HeadhunterCompanies` y `ReferralActions`.
- 2026-08-20: Dashboard cloud agrega filtro global reutilizando `ContactFilterControls`; KPIs, Coach, Ultimas interacciones, Empresas HH y Referidos se calculan sobre los contactos filtrados. Las interacciones pasan a `InteractionTimelineList`, compartido con Ficha, y referidos adopta variante ancha responsive.
- 2026-07-28: `CoachPreview` pasa a minimo funcional para ToDos de cambio de estado y descarte: seleccion multiple, ejecucion de `NETWORKING_STATUS_CHANGE`, descarte `todo.dismiss`, cierre de ToDos y registro de accion/auditoria en Supabase.
- 2026-07-28: `CoachConfigDialog` conecta el engranaje del Coach a `todo_configs`; replica el modelo local de configuracion por tipo, con lenguaje de usuario y guardado en Supabase.
- 2026-08-21: `coachConfig` asegura filas base de configuracion por usuario y `coachRuleTriggers` conecta cambios de contacto/interaccion con revisiones acotadas del Coach.
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
- 2026-08-12: `contactSyncPreview` deja de proponer consolidacion/enlace durante la importacion inicial. Si el ID externo no esta enlazado, el contacto entra como `Nuevo` aunque coincida por correo o telefono; la coincidencia queda para `Revision de duplicados`.
- 2026-07-31: `contactSyncPreview` agrupa varios IDs externos ya enlazados al mismo contacto destino y agrega tipo `unchanged`; desde 2026-08-14, `SyncPreviewDialog` deja de mostrar `Sin cambios` como pestana y lo conserva solo como conteo diagnostico cuando el flujo llamador lo necesite.
- 2026-08-03: Cloud agrega `phoneIdentity.ts` para comparar telefonos con formatos internacionales/nacionales en Chile, Peru, Argentina, Colombia, Mexico, Brasil y USA; `contactSyncPreview` lo usa para evitar falsos updates por codigo de pais.
- 2026-08-03: Sync de contactos robustece telefonos chilenos con `9` duplicado, deduplica telefonos equivalentes traidos por el proveedor y trata placeholders como `sin dato`, `sin datos` y `null` como vacios reales en preview y formato global.
- 2026-08-03: `googleContactAdapter` pasa a preferir el telefono visible (`value`) sobre `canonicalForm`, porque Google puede truncar `canonicalForm` al intentar canonizar numeros mal escritos; `canonicalForm` queda solo como fallback si no hay valor visible.
- 2026-08-03: Cloud agrega ruta `/cuenta` y `AccountPage`; `GoogleContactsSyncPanel` se mueve desde `Sistema` a Cuenta y el OAuth de Google Contacts retorna a `/cuenta`.
- 2026-08-11: Sync cloud de actividad queda con una sola ruta tecnica (`syncGoogleInteractions`) y tres entradas de uso: Cuenta reconstruye historial Gmail/Calendar sin mover cursores, barra superior actualiza incrementalmente contactos en foco, y ficha actualiza un contacto especifico por query de correo sin tocar cursores globales.
- 2026-08-13: Gmail deja de usar fechas como cursor incremental. El primer barrido completo guarda `historyId` oficial de Gmail como cursor; las siguientes revisiones usan `users.history.list` con `historyTypes=messageAdded`. Si Gmail responde que el `historyId` vencio, el flujo marca el cursor vencido y reintenta una lectura historica acotada. Calendar mantiene `syncToken` oficial y el mismo manejo de cursor vencido.
- 2026-08-13: Cuenta agrega preview revisable para reconstruccion Gmail/Calendar reutilizando `SyncPreviewDialog`: `Nuevas`, `Modificaciones` y `Omitidas`. Los objetos sin cambios quedan fuera del modal para no confundir la seleccion. El preview compara asunto, fecha y contenido de origen contra `external_interaction_sources`; la minuta del usuario queda fuera de la comparacion y no se pisa. Pendiente: congelar el preview para que aplicar seleccion no tenga que releer Google.
- 2026-08-13: La reconstruccion historica de Cuenta queda acotada a contactos en foco. Gmail usa una query por emails de esos contactos cuando el foco es razonable. Calendar lee eventos desde la fecha base, solicita invitaciones ocultas, busca por emails del alcance y vincula por participantes estructurados o por el email exacto que hizo match en la busqueda, replicando la tolerancia util de la app local sin crear reglas por contacto. En incremental con `syncToken`, como Google no permite combinar cursor con query, el flujo revisa el JSON del evento devuelto contra los emails en foco para inferir el mismo match. Los limites de actividad quedan centralizados en 200 correos y 200 eventos por corrida.
- 2026-08-03: Se retira la UI activa de `No eliminar ni volver a sugerir` del sync de contactos. La tabla dev `sync_change_suppressions` queda creada pero sin consumo desde la app hasta redisenar esa experiencia.
- 2026-08-03: `Fusionar contactos` se convierte en modulo reutilizable cloud: `contactMerge.ts` define contrato, defaults y helpers puros para transportar `contactMergeDecision`; `ContactMergeWorkspace` concentra la UI, `ContactMergeDialog` la expone como popup y `SyncPreviewDialog` lo usa en `Nuevos` y `Modificaciones` mediante `Editar datos`. `contactSyncApply` lee ese mismo contrato al crear o modificar un contacto.
- 2026-08-03: Se agrega la accion interna `contact.merge_deep`: `contactMergeActions.ts` llama la RPC transaccional `merge_contacts_deep`, que mueve IDs externos, participantes de interacciones, referidos, ToDos y estados de revision al contacto resultante, desactiva los contactos origen y registra accion/auditoria. Esta accion queda para `Revision de duplicados`, fusiones manuales, Ficha o Coach, no para fusionar durante la importacion inicial.
- 2026-08-04: Se habia explorado separar duplicados de importacion en `Duplicados fusionables` y `Duplicados complejos`; el criterio queda deprecado para sync inicial. La importacion no evalua duplicados por correo/telefono y la herramienta posterior de duplicados decide que fusionar.
- 2026-08-04: `contactDuplicateReview` y `ContactDuplicateReviewPanel` agregan primera herramienta de revision local/manual de duplicados guardados en Cuenta, reutilizando `ContactMergeDialog` y `merge_contacts_deep` para grupos detectados o fusion manual iniciada desde un boton simple. `ContactMergeWorkspace` concentra la busqueda `Agregar contacto guardado` dentro del modal, y `SyncPreviewDialog` permite abrir fusion profunda desde el conteo de `guardados` en duplicados complejos cuando hay 2 o 3 contactos internos preseleccionables.
- 2026-08-04: Usuario ejecuta y verifica `merge_contacts_deep_v0_2.sql` en Supabase dev. Queda pendiente probar con caso real controlado y conectar la accion a Ficha/Coach.
- 2026-08-11: `contactSyncApply` mejora el registro de fallas parciales de sync de contactos: conserva `externalId`/`objectId` para cambios sin contacto app aun creado y captura mensajes estructurados de Supabase/PostgREST, incluyendo `message`, `details`, `hint` y `code`, para poder investigar errores reales en `action_invocations`.
- 2026-08-12: Se reemplaza la prevalidacion que bloqueaba correos/telefonos repetidos por un modelo que permite duplicados entre contactos. `contactSyncApply` enlaza el ID externo apenas crea el contacto y la base usa unicidad por contacto; los duplicados se resuelven despues con `Revision de duplicados`. Pendiente: convertir creacion/aplicacion de contactos desde sync en una operacion transaccional.
- 2026-08-12: Se agrega `cloud/supabase/prepare_contact_sync_storage_v0_1.sql` y la funcion `validate_contact_sync_storage_v0_1` al schema base. `contactSyncApply` ejecuta esa validacion antes de importar para evitar contactos parciales si faltan snapshots o indices por contacto. Los scripts de reset/verificacion dev ahora incluyen `external_contact_snapshots`.
- 2026-08-13: Se define el siguiente bloque arquitectonico despues de cerrar pruebas reales de contactos/correos/citas: persistir conexiones externas en `connected_accounts`, separar identidad de acceso y permisos de importacion, guardar scopes/estado/email/revocacion por usuario y definir estrategia segura de tokens antes de sumar un segundo usuario real.
- 2026-08-12: La importacion de contactos nuevos queda fuera de foco networking por defecto. El schema base cambia `contacts.networking_focus` a default `false` y se agrega `cloud/supabase/set_contact_focus_default_false_v0_1.sql` para alinear Supabase dev.
- 2026-08-12: `contactSyncPreview` deja de proponer eliminaciones por ausencia durante revisiones incrementales de contactos. En incremental, solo se muestra eliminacion si el proveedor envia una marca explicita de borrado; las ausencias se evaluan unicamente en revision completa/historica.
- 2026-08-12: `contactSyncPreview` usa `previousResourceNames` de Google Contacts para reconocer contactos cuyo `people/...` cambio. El caso se clasifica como modificacion del contacto guardado y al aplicar se enlaza el ID vigente. Si Google no informa ID anterior, no se compara por parecido de nombre/correo/telefono dentro de la importacion; el contacto queda como nuevo y la limpieza se resuelve despues en revision de duplicados.
- 2026-08-14: `googleContactSyncFlow` pagina internamente la lectura de `external_contact_ids` y `external_contact_snapshots` en Supabase. El bug observado era que el preview recibia solo las primeras 1000 filas de enlaces/snapshots y clasificaba el saldo de contactos ya importados como `Nuevos`; no era un cambio de Google ID ni una regla de duplicados.
- 2026-08-11: `contactSyncPreview` corrige la prioridad de pareo por ID externo: un contacto ya enlazado por `external_contact_ids` no puede volver a aparecer como `Duplicado fusionable` por coincidir en telefono/correo con otro contacto. Las coincidencias de segundo orden solo corren para objetos de proveedor sin ID externo enlazado.
- 2026-08-11: `contactSyncApply` endurece la escritura de IDs externos: despues de crear/actualizar el enlace proveedor-contacto, verifica que la fila quedo activa y apuntando al contacto destino antes de marcar el cambio como aplicado.
- 2026-08-11: Se retira de `googleContactSyncFlow` el respaldo por `contacts.legacy_google_id`. La app cloud debe parear proveedores externos solo mediante `external_contact_ids`; cualquier migracion desde la app anterior queda fuera del runtime y debe adaptar datos al modelo nuevo, no al reves.
- 2026-08-11: Coach, KPIs e interacciones cloud dejan de leer `legacy_entry_id` y metadata heredada para evidencia o direccion. Las sugerencias y metricas cloud usan `interactions.id`, participantes, direccion y roles estructurados.
- 2026-08-11: `cloud/supabase/schema_v0_1.sql` queda sin columnas `legacy_*`; los IDs externos viven en tablas de referencia de proveedor.
- 2026-08-12: Se preparan scripts manuales de reset/verificacion en `tools/dev_maintenance/supabase` para limpiar Supabase dev antes de cargar datos desde Google.
