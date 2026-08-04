# Contexto de proyecto para Codex

## Regla de trabajo

No asumir que el resumen de Gemini es correcto. Usarlo como hipotesis y validar siempre contra `app.py`, la planilla de Google y el comportamiento real de Streamlit.

## Producto

CRM personal de networking para busqueda laboral. El usuario administra contactos, nivel de cercania, etapas del pipeline, interacciones historicas, citas/correos importados y vinculos de referidos.

## Stack verificado

- Python
- Streamlit
- Pandas / NumPy
- Google People API
- Google Sheets API
- Gmail API
- Google Calendar API
- OAuth local con `credentials.json` y `token.json`

## Archivos relevantes

- `app.py`: archivo principal, aproximadamente 1835 lineas.
- `app copy.py`: respaldo local con version anterior o parcial.
- `Planificacion.docx`: planificacion del producto.
- `credentials.json` y `token.json`: archivos sensibles locales, no leer ni exponer salvo que el usuario lo pida explicitamente por una razon concreta.

## Datos externos esperados

Google Sheets funciona como base de datos. Rangos usados en el codigo:

- `CRM_Contactos_Extra!A:T`
- `Interacciones`
- `Interacciones!A:I`
- `Interacciones!B:B`
- `CRM_Relaciones!A:D`
- `CRM_Config!A2:B2`

## Funciones y flujos principales

- `autenticar_google`: maneja OAuth local.
- `obtener_contactos_google`: importa contactos desde Google Contacts.
- `leer_sheet_local` / `guardar_en_sheet`: lectura y escritura de contactos CRM.
- `sincronizar_gmail_contacto`: importa correos por contacto.
- `sincronizar_calendar_contacto`: importa eventos de calendario por contacto.
- `sincronizar_lote_completo_scope`: corre sincronizacion masiva para contactos en scope.
- `leer_historial_sheet`: lee interacciones por contacto.
- `registrar_nueva_interaccion_manual`, `editar_interaccion_existente`, `actualizar_detalle_fuente_sheet`, `eliminar_interaccion_existente`: CRUD de interacciones.
- `popup_gestion_vincu_global` y `leer_relaciones_sheet`: gestion de relaciones/referidos.
- `popup_filtrar_contactos_etiqueta_gmail`: analiza etiquetas Gmail para detectar remitentes y activar scope.
- `mostrar_vista_networking`: vista principal.
- `mostrar_vista_ficha_contacto`: ficha individual con timeline y acciones.
- `mostrar_vista_dashboard` y `mostrar_vista_empresas`: placeholders.

## Observaciones verificadas

- `app.py` compila sin errores de sintaxis.
- Hay funciones duplicadas: `mostrar_vista_empresas` y `mostrar_vista_ficha_contacto` aparecen definidas dos veces. En Python queda activa la ultima definicion.
- El resumen de Gemini dice que las interacciones se normalizan a 4 tipos, pero la UI de minutas usa tambien `Reunion` y `WhatsApp`; el timeline las normaliza visualmente hacia `Cita` y `Mensaje`.
- `leer_sheet_local` declara una lista de 18 columnas maestras como fallback, mientras `RANGO_SHEET` apunta a `A:T` (20 columnas). Conviene validar la estructura real de la planilla antes de tocar persistencia.
- La app usa muchos `except Exception` silenciosos. Esto protege la UX, pero dificulta diagnosticar fallos de APIs.
- La app no tenia `requirements.txt`, `.gitignore` ni README antes de la migracion a Codex.

## Precauciones

- No modificar el patron de edicion/guardado de lote sin probar el comportamiento de `st.data_editor` y `st.session_state.editor_contactos`.
- No exponer credenciales, tokens ni datos personales de la red de contactos.
- Antes de refactorizar, crear pruebas o al menos una estrategia de verificacion manual por flujo.
- Para cambios sobre Google Sheets, confirmar columnas reales y rangos antes de escribir.

## Proximos pasos sugeridos

1. Levantar Streamlit localmente y validar que la pantalla inicial carga.
2. Revisar `Planificacion.docx` para comparar objetivos de producto contra implementacion actual.
3. Crear una copia de seguridad de la planilla de Google antes de cambios de persistencia.
4. Implementar primero Dashboard o Empresas, porque son placeholders y tienen bajo riesgo sobre datos existentes.
5. Luego separar `app.py` en modulos, manteniendo una ruta de rollback clara.
