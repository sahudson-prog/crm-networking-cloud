import streamlit as st
import pandas as pd
import os.path
from google.auth.transport.requests import Request
from google.oauth2.credentials import Credentials
from google_auth_oauthlib.flow import InstalledAppFlow
from google.auth.exceptions import RefreshError, TransportError
from googleapiclient.discovery import build
from googleapiclient.errors import HttpError

# 1. PERMISOS: Agregamos lectura de contactos y control total de Sheets
SCOPES = [
    'https://www.googleapis.com/auth/contacts.readonly',
    'https://www.googleapis.com/auth/spreadsheets',
    'https://www.googleapis.com/auth/gmail.readonly',
    'https://www.googleapis.com/auth/calendar.readonly'
]

def sincronizar_gmail_contacto(creds, google_id, emails_contacto):
    """Versión de producción limpia e incremental para sincronizar correos de Gmail"""
    if not emails_contacto or emails_contacto == "Sin Email":
        return 0

    from datetime import datetime
    
    gmail_service = build('gmail', 'v1', credentials=creds)
    sheets_service = build('sheets', 'v4', credentials=creds)
    try:
        email_usuario = gmail_service.users().getProfile(userId='me').execute().get("emailAddress", "").strip().lower()
    except Exception:
        email_usuario = ""
    
    # 1. Recuperamos los IDs que ya existen en el Sheet para evitar duplicados
    try:
        result_sheet = sheets_service.spreadsheets().values().get(
            spreadsheetId=ID_PLANILLA, range="Interacciones!B:B"
        ).execute()
        ids_existentes = [fila[0] for fila in result_sheet.get('values', []) if fila]
    except Exception:
        ids_existentes = []

    # 2. Leer Configuración de Fecha Global
    fecha_config = leer_fecha_inicio_config(creds)
    try:
        dt_config = datetime.strptime(fecha_config, "%d/%m/%Y")
        fecha_gmail = dt_config.strftime("%Y/%m/%d")
    except:
        fecha_gmail = "2025/10/01"

    # Limpieza de correos concatenados
    lista_emails = [e.strip() for e in emails_contacto.split(",")]
    nuevos_registros = []

    for email in lista_emails:
        query = f"(from:{email} OR to:{email}) after:{fecha_gmail}"
        try:
            results = gmail_service.users().messages().list(userId='me', q=query, maxResults=30).execute()
            messages = results.get('messages', [])
            
            for msg in messages:
                msg_id = msg['id']
                id_fuente = f"GMAIL_{msg_id}"
                thread_id_gmail = construir_thread_id_gmail(msg.get("threadId", ""))
                email_asociado = email.strip().lower()
                id_unico_crm = construir_id_entrada_interaccion(id_fuente, email_asociado)
                
                if id_unico_crm in ids_existentes:
                    nuevos_registros.append([
                        str(google_id).strip(), id_unico_crm, "", "", "", "", "", "", "", id_fuente, thread_id_gmail, email_asociado, ""
                    ])
                    continue
                
                # Traemos el detalle completo del correo
                txt = gmail_service.users().messages().get(userId='me', id=msg_id, format='full').execute()
                thread_id_gmail = construir_thread_id_gmail(txt.get("threadId", msg.get("threadId", "")))
                payload = txt.get('payload', {})
                headers = payload.get('headers', [])
                
                asunto = "Sin Asunto"
                fecha_raw = ""
                remitente = "Desconocido"
                
                for h in headers:
                    if h['name'].lower() == 'subject':
                        asunto = h['value']
                    if h['name'].lower() == 'date':
                        fecha_raw = h['value']
                    if h['name'].lower() == 'from':
                        remitente = h['value']
                rol_email = ""
                participantes_contacto = participantes_gmail_en_scope(headers, {email_asociado: {"Google_ID": google_id}}, email_usuario)
                if not participantes_contacto:
                    continue
                rol_email = participantes_contacto[0].get("rol", "")
                
                # Formateamos la fecha a DD/MM/AAAA
                try:
                    fecha_limpia = " ".join(fecha_raw.split()[:4])
                    dt = datetime.strptime(fecha_limpia, "%a, %d %b %Y")
                    fecha_formateada = dt.strftime("%d/%m/%Y")
                except:
                    fecha_formateada = datetime.now().strftime("%d/%m/%Y")
                
                # 🛠️ EXTRAE EL CUERPO COMPLETO SIN TRUNCAR (Paso B)
                cuerpo_completo = extraer_cuerpo_completo_gmail(payload)
                
                # Fallback inteligente si el correo venía vacío
                if not cuerpo_completo.strip():
                    cuerpo_completo = txt.get('snippet', 'Sin detalle disponible.')
                
                # 🛡️ NUEVO BLINDAJE ANTI-DESBORDAMIENTO AGREGADO AQUÍ:
                if len(cuerpo_completo) > 45000:
                    cuerpo_completo = cuerpo_completo[:45000] + "\n\n[... CONTENIDO TRUNCADO POR SEGURIDAD DE GOOGLE SHEETS EN EL CRM ...]"
                
                # 🎯 MAPEO CORRECTO DE COLUMNAS (Alineado con la base de datos)
                nuevas_filas = [
                    str(google_id).strip(),                        # A: Google_ID
                    id_unico_crm,                                  # B: ID_Entrada
                    fecha_formateada,                              # C: Fecha
                    "Email",                                       # D: Tipo
                    asunto if asunto.strip() != "" else "Correo Sincronizado", # E: Asunto_Titulo
                    remitente,                                     # F: De_Hacia_Contacto
                    cuerpo_completo,                               # G: Detalle_Fuente (original importado)
                    cuerpo_completo,                               # H: Notas_Usuario_Crudo (copia editable)
                    "Procesamiento de resumen pendiente.",         # I: Resumen_IA
                    id_fuente,
                    thread_id_gmail,
                    email_asociado,
                    rol_email
                ]
                nuevos_registros.append(nuevas_filas)
                ids_existentes.append(id_unico_crm)
                
        except Exception:
            continue

    # 3. Inyección final al Sheet si existen deltas nuevos
    if nuevos_registros:
        try:
            resultado_upsert = upsert_interacciones_por_id(creds, nuevos_registros)
            return resultado_upsert["nuevas"]
        except Exception:
            pass
        
    return len(nuevos_registros)

def extraer_cuerpo_completo_gmail(payload):
    """
    Recorre recursivamente las partes del payload de un correo de Gmail 
    para extraer el texto plano completo decodificado en UTF-8.
    """
    import base64
    
    # Caso 1: El texto viene directo en el cuerpo (Correos ultra simples sin formato)
    if 'body' in payload and 'data' in payload['body']:
        data_b64 = payload['body']['data']
        return base64.urlsafe_b64decode(data_b64.encode('ASCII')).decode('utf-8', errors='ignore')
        
    # Caso 2: El correo viene fragmentado en partes (Mime-Multipart / HTML + Texto)
    if 'parts' in payload:
        partes = payload['parts']
        texto_plano_acumulado = []
        
        for parte in partes:
            mime_type = parte.get('mimeType', '')
            
            # Buscamos prioritariamente el texto plano
            if mime_type == 'text/plain' and 'body' in parte and 'data' in parte['body']:
                data_b64 = parte['body']['data']
                texto_plano_acumulado.append(
                    base64.urlsafe_b64decode(data_b64.encode('ASCII')).decode('utf-8', errors='ignore')
                )
            # Si es otra estructura anidada, entramos de forma recursiva
            elif 'parts' in parte:
                texto_plano_acumulado.append(extraer_cuerpo_completo_gmail(parte))
                
        if texto_plano_acumulado:
            return "\n".join(texto_plano_acumulado)
            
        # Fallback: Si no había texto plano pero sí HTML, extraemos el HTML como último recurso
        for parte in partes:
            if parte.get('mimeType', '') == 'text/html' and 'body' in parte and 'data' in parte['body']:
                data_b64 = parte['body']['data']
                return base64.urlsafe_b64decode(data_b64.encode('ASCII')).decode('utf-8', errors='ignore')
                
    return ""

@st.dialog("📄 Detalle de la Interacción", width="large")
def mostrar_popup_detalle_global(fila_target, creds):
    """
    Popup centralizado y global para visualizar y editar el contenido 
    y minutas de cualquier interacción directamente en la base de datos (Google Sheets).
    """
    import pandas as pd
    
    # Estilos visuales compartidos
    estilos_pasteles = {
        "Email": {"bg": "#FFFFFF", "border": "#6c757d", "icono": "✉️"},
        "Cita": {"bg": "#E3F2FD", "border": "#2196F3", "icono": "📅"},
        "Mensaje": {"bg": "#E8F5E9", "border": "#4CAF50", "icono": "💬"},
        "Llamada": {"bg": "#FFFDE7", "border": "#FFEB3B", "icono": "📞"},
        "WhatsApp": {"bg": "#E8F5E9", "border": "#25D366", "icono": "💬"},
        "Reunión": {"bg": "#F3E5F5", "border": "#9C27B0", "icono": "👥"}
    }
    
    tipo_target = str(fila_target.get("Tipo", "Email")).strip()
    estilo = estilos_pasteles.get(tipo_target, {"bg": "#FFFFFF", "border": "#6c757d", "icono": "📝"})
    id_ver = str(fila_target.get("ID_Entrada", "")).strip()
    
    st.markdown(f"### {estilo['icono']} {fila_target.get('Asunto_Titulo', 'Sin Asunto')}")
    
    # Contenedor visual del detalle
    st.markdown(f"<div style='background-color: {estilo['bg']}; padding: 12px; border-radius: 6px; border-left: 6px solid {estilo['border']}; border: 1px solid #cbd5e1; margin-bottom: 15px;'>", unsafe_allow_html=True)
    st.caption(f"🆔 **ID:** `{id_ver}`  |  📅 **Fecha:** {fila_target.get('Fecha', '--/--/----')}  |  📍 **Contacto:** {fila_target.get('De_Hacia_Contacto', 'N/A')}")
    st.markdown("</div>", unsafe_allow_html=True)
    
    detalle_fuente = fila_target.get("Detalle_Fuente", "")
    if pd.isna(detalle_fuente) or str(detalle_fuente).strip() in ["NULL", "nan"]:
        detalle_fuente = ""

    notas_actuales = fila_target.get("Notas_Usuario_Crudo", "")
    if pd.isna(notas_actuales) or str(notas_actuales).strip() in ["NULL", "nan"]:
        notas_actuales = ""

    with st.expander("Ver original importado", expanded=False):
        st.text_area(
            "Detalle fuente",
            value=str(detalle_fuente),
            height=180,
            disabled=True,
            key=f"txt_area_fuente_original_{id_ver}"
        )

    label_area = "Contenido editable de la interacción:"
    
    # Campo de texto editable directo
    nuevo_detalle = st.text_area(
        label=label_area,
        value=str(notas_actuales),
        height=250,
        key=f"txt_area_detalle_{id_ver}",
        help="Esta es la versión editable que verás en la línea de tiempo y que usará la IA."
    )
    
    # Zona de botones de acción del registro
    c_btn_guardar, c_btn_eliminar, c_btn_espacio = st.columns([3, 3, 6])
    
    with c_btn_guardar:
        if st.button("💾 Guardar Cambios", key=f"btn_save_popup_{id_ver}", use_container_width=True, type="primary"):
            with st.spinner("Actualizando Google Sheets..."):
                # Gana tracción llamando a nuestra nueva función de backend
                exito = actualizar_notas_usuario_sheet(creds, id_ver, nuevo_detalle)
                if exito:
                    st.success("¡Detalle actualizado con éxito!")
                    st.session_state["id_interaccion_activa"] = None
                    st.session_state["detalle_interaccion_activa"] = ""
                    st.rerun()
                else:
                    st.error("No se pudo encontrar el registro para actualizar.")
                
    with c_btn_eliminar:
        if st.button("❌ Eliminar Hito", key=f"btn_del_popup_{id_ver}", use_container_width=True):
            st.session_state["id_a_eliminar"] = id_ver
            st.session_state["detalle_interaccion_activa"] = ""
            st.rerun()
            
    # Mostrar el análisis de IA abajo si existe
    st.write("---")
    st.markdown("##### ✨ Resumen Inteligente (IA):")
    resumen_ia = fila_target.get("Resumen_IA", "")
    if pd.isna(resumen_ia) or str(resumen_ia).strip() in ["", "NULL", "nan"]:
        st.caption("*Análisis de IA pendiente por procesar.*")
    else:
        st.write(resumen_ia)

def sincronizar_calendar_contacto(creds, google_id, emails_contacto):
    """Busca eventos en Google Calendar vinculados al correo del contacto y los guarda en 'Interacciones'"""
    if not emails_contacto or emails_contacto == "Sin Email":
        return 0

    from datetime import datetime
    
    # Inicializamos los servicios de Google
    calendar_service = build('calendar', 'v3', credentials=creds)
    sheets_service = build('sheets', 'v4', credentials=creds)
    
    # 1. Recuperamos los IDs que ya existen en el Sheet para evitar duplicados
    result_sheet = sheets_service.spreadsheets().values().get(
        spreadsheetId=ID_PLANILLA, range="Interacciones!B:B"
    ).execute()
    ids_existentes = [fila[0] for fila in result_sheet.get('values', []) if fila]

    # ⚙️ Rescatamos el parámetro global desde Sheets y formateamos para Calendar (RFC3339)
    fecha_config = leer_fecha_inicio_config(creds)
    try:
        dt_config = datetime.strptime(fecha_config, "%d/%m/%Y")
        tiempo_min = f"{dt_config.strftime('%Y-%m-%d')}T00:00:00Z"
    except:
        tiempo_min = "2025-10-01T00:00:00Z"

    lista_emails = [e.strip() for e in emails_contacto.split(",")]
    nuevos_registros = []

    for email in lista_emails:
        try:
            # Buscamos eventos en el calendario principal usando el email del contacto como palabra clave (query)
            events_result = calendar_service.events().list(
                calendarId='primary', 
                q=email,
                timeMin=tiempo_min,
                maxResults=15, 
                singleEvents=True,
                orderBy='startTime'
            ).execute()
            
            events = events_result.get('items', [])
            
            for event in events:
                event_id = event['id']
                id_unico_crm = f"CALENDAR_{event_id}"
                
                # Evitamos duplicar si ya existe en el Sheet
                if id_unico_crm in ids_existentes:
                    nuevos_registros.append([
                        str(google_id).strip(), id_unico_crm, "", "", "", "", "", "", ""
                    ])
                    continue
                
                asunto = event.get('summary', 'Reunión sin título')
                descripcion = event.get('description', 'Sin descripción en el evento de calendario.')
                ubicacion = event.get('location', 'No especificada')
                
                # Parsear la fecha del evento (puede venir como 'dateTime' o solo 'date' si es todo el día)
                start = event.get('start', {})
                date_raw = start.get('dateTime', start.get('date', ''))
                
                try:
                    # Ejemplo raw: "2026-06-09T14:30:00-04:00" -> Tomamos los primeros 10 caracteres (AAAA-MM-DD)
                    dt = datetime.strptime(date_raw[:10], "%Y-%m-%d")
                    fecha_formateada = dt.strftime("%d/%m/%Y")
                except:
                    fecha_formateada = datetime.now().strftime("%d/%m/%Y")
                
                # Mapeamos al tipo "Cita" o "Reunión" para que use tus estilos pasteles automáticamente
                tipo_evento = "Cita"
                
                nuevas_filas = [
                    str(google_id).strip(),
                    id_unico_crm,
                    fecha_formateada,
                    tipo_evento,
                    asunto,
                    f"Ubicación/Link: {ubicacion}",
                    descripcion if descripcion.strip() != "" else "Cita extraída automáticamente de Google Calendar.",
                    descripcion if descripcion.strip() != "" else "Cita extraída automáticamente de Google Calendar.",
                    "Procesamiento de resumen pendiente."
                ]
                nuevos_registros.append(nuevas_filas)
                ids_existentes.append(id_unico_crm) # Blindaje contra duplicados en el mismo loop
                
        except Exception as e:
            continue

    # 2. Inyectamos en lote al Google Sheet si hay eventos nuevos
    if nuevos_registros:
        resultado_upsert = upsert_interacciones_por_id(creds, nuevos_registros)
        return resultado_upsert["nuevas"]
        
    return len(nuevos_registros)

def sincronizar_lote_completo_scope(creds):
    """
    Motor global incremental solicitado por Sergio. 
    Busca todos los contactos activos en Scope dentro del Sheet local 
    y actualiza secuencialmente su historial completo de Gmail y Calendar.
    """
    import streamlit as st
    
    # 1. Leemos la base de datos fresca guardada en la nube
    df_sheet_actual = leer_sheet_local(creds)
    
    if df_sheet_actual.empty:
        return 0, 0
        
    # 2. Filtramos estrictamente los registros que están marcados con el Scope activo
    df_activos = df_sheet_actual[df_sheet_actual["Scope_Networking"].astype(str).str.strip() == "TRUE"]
    
    if df_activos.empty:
        return 0, 0
        
    total_contactos = len(df_activos)
    total_correos_nuevos = 0
    total_citas_nuevas = 0
    
    # Contenedor visual elástico para el progreso en lote
    barra_progreso = st.progress(0)
    status_text = st.empty()
    
    # 3. Bucle secuencial seguro reutilizando tu lógica de producción
    for idx, (_, contacto) in enumerate(df_activos.iterrows()):
        g_id = str(contacto.get("Google_ID", "")).strip()
        nombre = str(contacto.get("Nombre_Visual", "Contacto")).strip()
        emails = str(contacto.get("Emails_Concatenados", "")).strip()
        
        if not g_id or not emails or emails in ["", "Sin Email", "nan", "null"]:
            continue
            
        status_text.caption(f"🔄 Sincronizando ({idx + 1}/{total_contactos}): **{nombre}**...")
        
        try:
            # Reutilización exacta de tus dos funciones del core sin duplicar lógica
            nuevos_mails = sincronizar_gmail_contacto(creds, g_id, emails)
            nuevas_citas = sincronizar_calendar_contacto(creds, g_id, emails)
            
            total_correos_nuevos += nuevos_mails
            total_citas_nuevas += nuevas_citas
        except Exception:
            # Blindaje individual para que la falla de un contacto no detenga el lote completo
            continue
            
        # Actualizamos la barra proporcionalmente
        barra_progreso.progress((idx + 1) / total_contactos)
        
    # Limpieza estética de los indicadores de progreso
    barra_progreso.empty()
    status_text.empty()
    
    return total_correos_nuevos, total_citas_nuevas

def asegurar_hoja_sync_state(creds):
    """Crea la pestaña de cursores de sincronización si todavía no existe."""
    service = build('sheets', 'v4', credentials=creds)
    metadata = service.spreadsheets().get(
        spreadsheetId=ID_PLANILLA,
        fields="sheets.properties.title"
    ).execute()
    titulos = [s["properties"]["title"] for s in metadata.get("sheets", [])]
    if "CRM_Sync_State" not in titulos:
        service.spreadsheets().batchUpdate(
            spreadsheetId=ID_PLANILLA,
            body={"requests": [{"addSheet": {"properties": {"title": "CRM_Sync_State"}}}]}
        ).execute()
        service.spreadsheets().values().update(
            spreadsheetId=ID_PLANILLA,
            range="CRM_Sync_State!A1:C1",
            valueInputOption="USER_ENTERED",
            body={"values": [["Clave", "Valor", "Actualizado_En"]]}
        ).execute()
    return service

def leer_sync_state(creds):
    """Lee cursores de sincronización incremental desde CRM_Sync_State."""
    service = asegurar_hoja_sync_state(creds)
    try:
        result = service.spreadsheets().values().get(
            spreadsheetId=ID_PLANILLA,
            range="CRM_Sync_State!A:C"
        ).execute()
        rows = result.get("values", [])
        estado = {}
        for fila in rows[1:]:
            if len(fila) >= 2 and str(fila[0]).strip():
                estado[str(fila[0]).strip()] = str(fila[1]).strip()
        return estado
    except Exception:
        return {}

def guardar_sync_state(creds, estado):
    """Sobrescribe cursores de sincronización incremental en CRM_Sync_State."""
    from datetime import datetime
    service = asegurar_hoja_sync_state(creds)
    ahora = datetime.now().strftime("%d/%m/%Y %H:%M:%S")
    filas = [["Clave", "Valor", "Actualizado_En"]]
    for clave, valor in sorted(estado.items()):
        filas.append([clave, valor, ahora])
    service.spreadsheets().values().clear(
        spreadsheetId=ID_PLANILLA,
        range="CRM_Sync_State!A:C"
    ).execute()
    service.spreadsheets().values().update(
        spreadsheetId=ID_PLANILLA,
        range="CRM_Sync_State!A:C",
        valueInputOption="USER_ENTERED",
        body={"values": filas}
    ).execute()

def leer_ids_interacciones_existentes(creds):
    service = build('sheets', 'v4', credentials=creds)
    try:
        result = service.spreadsheets().values().get(
            spreadsheetId=ID_PLANILLA, range="Interacciones!B:B"
        ).execute()
        return {fila[0] for fila in result.get("values", []) if fila}
    except Exception:
        return set()

def columnas_interacciones():
    return [
        "Google_ID", "ID_Entrada", "Fecha", "Tipo", "Asunto_Titulo",
        "De_Hacia_Contacto", "Detalle_Fuente", "Notas_Usuario_Crudo", "Resumen_IA",
        "ID_Fuente", "Thread_ID", "Email_Asociado", "Rol_Email"
    ]

def construir_thread_id_gmail(thread_id):
    thread_limpio = str(thread_id or "").strip()
    return f"GMAIL_THREAD_{thread_limpio}" if thread_limpio else ""

def normalizar_email_para_id(email):
    import re
    return re.sub(r"[^a-z0-9]+", "_", str(email).strip().lower()).strip("_")

def construir_id_entrada_interaccion(id_fuente, email_asociado):
    email_key = normalizar_email_para_id(email_asociado)
    return f"{id_fuente}__{email_key}" if email_key else id_fuente

def construir_indice_contactos_scope(df_contactos):
    """Mapea emails normalizados a filas de contactos en scope."""
    indice = {}
    if df_contactos.empty:
        return indice
    df_scope = df_contactos[df_contactos["Scope_Networking"].astype(str).str.strip() == "TRUE"].copy()
    if "Estado_Contacto" in df_scope.columns:
        df_scope = df_scope[df_scope["Estado_Contacto"].astype(str).str.strip() != "Desactivado"].copy()
    for _, contacto in df_scope.iterrows():
        emails = str(contacto.get("Emails_Concatenados", "")).strip()
        if not emails or emails in ["Sin Email", "nan", "null"]:
            continue
        for email in emails.split(","):
            email_limpio = email.strip().lower()
            if email_limpio and email_limpio not in indice:
                indice[email_limpio] = contacto
    return indice

def extraer_emails_desde_headers(headers):
    from email.utils import getaddresses
    valores = []
    for h in headers:
        if h.get("name", "").lower() in ["from", "to", "cc", "bcc", "reply-to"]:
            valores.append(h.get("value", ""))
    return {email.lower() for _, email in getaddresses(valores) if email}

def emails_gmail_por_header(headers, nombre_header):
    from email.utils import getaddresses
    valores = [h.get("value", "") for h in headers if h.get("name", "").lower() == nombre_header.lower()]
    return [(nombre.strip(), email.strip().lower()) for nombre, email in getaddresses(valores) if email.strip()]

def participantes_gmail_en_scope(headers, indice_contactos, email_usuario=""):
    from email.utils import getaddresses
    email_usuario = str(email_usuario or "").strip().lower()
    remitentes = emails_gmail_por_header(headers, "from")
    emails_from = {email for _, email in remitentes if email}
    remitentes_contacto = [
        {"email": email, "rol": "FROM", "nombre": nombre, "contacto": indice_contactos[email]}
        for nombre, email in remitentes
        if email in indice_contactos
    ]

    # Regla anti-ruido: si el remitente es un tercero, no registramos contactos
    # que solo aparecen copiados en el hilo.
    if remitentes_contacto:
        return remitentes_contacto
    if not email_usuario or email_usuario not in emails_from:
        return []

    roles_headers = [("to", "TO"), ("cc", "CC"), ("bcc", "BCC")]
    participantes = []
    emails_vistos = set()
    for nombre_header, rol in roles_headers:
        valores = [h.get("value", "") for h in headers if h.get("name", "").lower() == nombre_header]
        for nombre, email in getaddresses(valores):
            email_limpio = email.strip().lower()
            if not email_limpio or email_limpio in emails_vistos:
                continue
            if email_limpio not in indice_contactos:
                continue
            emails_vistos.add(email_limpio)
            participantes.append({
                "email": email_limpio,
                "rol": rol,
                "nombre": nombre.strip(),
                "contacto": indice_contactos[email_limpio],
            })
    return participantes

def fila_interaccion_desde_mensaje_gmail(msg, contacto, ids_existentes=None, email_asociado="", rol_email=""):
    from datetime import datetime
    from email.utils import parsedate_to_datetime
    msg_id = msg.get("id", "")
    id_fuente = f"GMAIL_{msg_id}"
    thread_id_gmail = construir_thread_id_gmail(msg.get("threadId", ""))
    id_unico_crm = construir_id_entrada_interaccion(id_fuente, email_asociado)
    if not msg_id:
        return None

    payload = msg.get("payload", {})
    headers = payload.get("headers", [])
    asunto = "Sin Asunto"
    fecha_formateada = datetime.now().strftime("%d/%m/%Y")
    remitente = "Desconocido"

    for h in headers:
        nombre = h.get("name", "").lower()
        valor = h.get("value", "")
        if nombre == "subject":
            asunto = valor
        elif nombre == "from":
            remitente = valor
        elif nombre == "date":
            try:
                fecha_formateada = parsedate_to_datetime(valor).strftime("%d/%m/%Y")
            except Exception:
                pass

    cuerpo_completo = extraer_cuerpo_completo_gmail(payload)
    if not cuerpo_completo.strip():
        cuerpo_completo = msg.get("snippet", "Sin detalle disponible.")
    if len(cuerpo_completo) > 45000:
        cuerpo_completo = cuerpo_completo[:45000] + "\n\n[... CONTENIDO TRUNCADO POR SEGURIDAD DE GOOGLE SHEETS EN EL CRM ...]"
    de_hacia_contacto = f"{str(rol_email).strip().upper()}: {str(email_asociado).strip().lower()}" if email_asociado else remitente

    return [
        str(contacto.get("Google_ID", "")).strip(),
        id_unico_crm,
        fecha_formateada,
        "Email",
        asunto if asunto.strip() else "Correo Sincronizado",
        de_hacia_contacto,
        cuerpo_completo,
        cuerpo_completo,
        "Procesamiento de resumen pendiente.",
        id_fuente,
        thread_id_gmail,
        str(email_asociado).strip().lower(),
        str(rol_email).strip().upper(),
    ]

def filas_interacciones_desde_mensaje_gmail(msg, indice_contactos, ids_existentes=None, email_usuario=""):
    headers = msg.get("payload", {}).get("headers", [])
    filas = []
    for participante in participantes_gmail_en_scope(headers, indice_contactos, email_usuario):
        fila = fila_interaccion_desde_mensaje_gmail(
            msg,
            participante["contacto"],
            ids_existentes,
            email_asociado=participante["email"],
            rol_email=participante["rol"],
        )
        if fila:
            filas.append(fila)
    return filas

def sincronizar_gmail_reciente_scope(creds, df_contactos, dias=7, limite_mensajes=500):
    """Repara correos recientes que pudieron quedar antes del cursor de Gmail."""
    gmail_service = build('gmail', 'v1', credentials=creds)
    indice_contactos = construir_indice_contactos_scope(df_contactos)
    if not indice_contactos:
        return {"nuevas": 0, "reasignadas": 0, "migradas": 0, "mensaje": "Sin contactos en scope con email."}
    try:
        email_usuario = gmail_service.users().getProfile(userId='me').execute().get("emailAddress", "").strip().lower()
    except Exception:
        email_usuario = ""

    ids_existentes = leer_ids_interacciones_existentes(creds)
    filas_para_upsert = []
    revisados = 0
    page_token = None

    while revisados < limite_mensajes:
        params = {
            "userId": "me",
            "q": f"newer_than:{dias}d",
            "maxResults": min(100, limite_mensajes - revisados),
        }
        if page_token:
            params["pageToken"] = page_token

        result = gmail_service.users().messages().list(**params).execute()
        mensajes = result.get("messages", [])
        if not mensajes:
            break

        for msg_ref in mensajes:
            if revisados >= limite_mensajes:
                break
            revisados += 1
            msg_id = msg_ref.get("id", "")
            id_unico_crm = f"GMAIL_{msg_id}"
            if not msg_id:
                continue

            try:
                meta = gmail_service.users().messages().get(
                    userId='me',
                    id=msg_id,
                    format='metadata',
                    metadataHeaders=['From', 'To', 'Cc', 'Bcc', 'Reply-To']
                ).execute()
            except Exception:
                continue
            participantes = participantes_gmail_en_scope(meta.get("payload", {}).get("headers", []), indice_contactos, email_usuario)
            if not participantes:
                continue

            try:
                msg_full = gmail_service.users().messages().get(
                    userId='me', id=msg_id, format='full'
                ).execute()
            except Exception:
                continue
            for fila in filas_interacciones_desde_mensaje_gmail(msg_full, indice_contactos, ids_existentes, email_usuario):
                filas_para_upsert.append(fila)
                ids_existentes.add(str(fila[1]).strip())

        page_token = result.get("nextPageToken")
        if not page_token:
            break

    if not filas_para_upsert:
        return {"nuevas": 0, "reasignadas": 0, "migradas": 0, "mensaje": f"Revision reciente OK: {revisados} mensajes revisados."}

    resultado = upsert_interacciones_por_id(creds, filas_para_upsert)
    return {
        "nuevas": resultado.get("nuevas", 0),
        "reasignadas": resultado.get("reasignadas", 0),
        "migradas": resultado.get("migradas", 0),
        "mensaje": f"Revision reciente OK: {revisados} mensajes revisados.",
    }

def sincronizar_gmail_incremental_scope(creds, df_contactos, estado):
    """Sincroniza nuevos mensajes de Gmail usando History API y un cursor persistido."""
    gmail_service = build('gmail', 'v1', credentials=creds)
    sheets_service = build('sheets', 'v4', credentials=creds)
    indice_contactos = construir_indice_contactos_scope(df_contactos)
    if not indice_contactos:
        return 0, "Sin contactos en scope con email."

    perfil_actual = gmail_service.users().getProfile(userId='me').execute()
    email_usuario = str(perfil_actual.get("emailAddress", "")).strip().lower()
    history_actual = str(perfil_actual.get("historyId", "")).strip()
    history_inicio = estado.get("GMAIL_HISTORY_ID", "").strip()

    if not history_inicio:
        if history_actual:
            estado["GMAIL_HISTORY_ID"] = history_actual
        return 0, "Cursor Gmail inicializado. La próxima ejecución traerá solo mensajes nuevos."

    ids_existentes = leer_ids_interacciones_existentes(creds)
    nuevos_registros = []
    page_token = None

    try:
        while True:
            params = {
                "userId": "me",
                "startHistoryId": history_inicio,
                "historyTypes": ["messageAdded"],
                "maxResults": 100
            }
            if page_token:
                params["pageToken"] = page_token
            result = gmail_service.users().history().list(**params).execute()

            for item in result.get("history", []):
                for agregado in item.get("messagesAdded", []):
                    msg_ref = agregado.get("message", {})
                    msg_id = msg_ref.get("id")
                    id_unico_crm = f"GMAIL_{msg_id}"
                    if not msg_id:
                        continue

                    msg = gmail_service.users().messages().get(
                        userId='me', id=msg_id, format='full'
                    ).execute()
                    for fila in filas_interacciones_desde_mensaje_gmail(msg, indice_contactos, ids_existentes, email_usuario):
                        nuevos_registros.append(fila)
                        ids_existentes.add(str(fila[1]).strip())

            page_token = result.get("nextPageToken")
            if not page_token:
                break

        if nuevos_registros:
            resultado_upsert = upsert_interacciones_por_id(creds, nuevos_registros)
            nuevos_registros = [None] * resultado_upsert["nuevas"]

        if history_actual:
            estado["GMAIL_HISTORY_ID"] = history_actual
        return len(nuevos_registros), "OK"
    except Exception as e:
        if history_actual:
            estado["GMAIL_HISTORY_ID"] = history_actual
        return 0, f"No se pudo usar el cursor Gmail; se reinicializó. Detalle: {e}"

def evento_calendar_menciona_contacto(evento, indice_contactos):
    import json
    texto = json.dumps(evento, ensure_ascii=False).lower()
    for email, contacto in indice_contactos.items():
        if email in texto:
            return contacto
    return None

def fila_interaccion_desde_evento_calendar(evento, contacto):
    from datetime import datetime
    event_id = evento.get("id", "")
    asunto = evento.get("summary", "Reunión sin título")
    descripcion = evento.get("description", "Sin descripción en el evento de calendario.")
    ubicacion = evento.get("location", "No especificada")
    start = evento.get("start", {})
    date_raw = start.get("dateTime", start.get("date", ""))
    try:
        fecha_formateada = datetime.strptime(date_raw[:10], "%Y-%m-%d").strftime("%d/%m/%Y")
    except Exception:
        fecha_formateada = datetime.now().strftime("%d/%m/%Y")

    return [
        str(contacto.get("Google_ID", "")).strip(),
        f"CALENDAR_{event_id}",
        fecha_formateada,
        "Cita",
        asunto,
        f"Ubicación/Link: {ubicacion}",
        descripcion if str(descripcion).strip() else "Cita extraída automáticamente de Google Calendar.",
        descripcion if str(descripcion).strip() else "Cita extraída automáticamente de Google Calendar.",
        "Procesamiento de resumen pendiente.",
        f"CALENDAR_{event_id}",
        "",
        "",
        "CALENDAR"
    ]

def sincronizar_calendar_incremental_scope(creds, df_contactos, estado):
    """Sincroniza eventos nuevos o modificados de Calendar usando updatedMin."""
    from datetime import datetime, timedelta, timezone
    calendar_service = build('calendar', 'v3', credentials=creds)
    sheets_service = build('sheets', 'v4', credentials=creds)
    indice_contactos = construir_indice_contactos_scope(df_contactos)
    if not indice_contactos:
        return 0, 0, "Sin contactos en scope con email."

    ahora_utc = datetime.now(timezone.utc)
    updated_min = estado.get("CALENDAR_UPDATED_MIN", "").strip()
    if not updated_min:
        estado["CALENDAR_UPDATED_MIN"] = ahora_utc.isoformat().replace("+00:00", "Z")
        return 0, 0, "Cursor Calendar inicializado. La próxima ejecución traerá cambios nuevos."

    try:
        dt_updated = datetime.fromisoformat(updated_min.replace("Z", "+00:00")) - timedelta(minutes=10)
        updated_min_api = dt_updated.isoformat().replace("+00:00", "Z")
    except Exception:
        updated_min_api = updated_min

    result_sheet = sheets_service.spreadsheets().values().get(
        spreadsheetId=ID_PLANILLA, range="Interacciones"
    ).execute()
    rows = result_sheet.get("values", [])
    headers = rows[0] if rows else columnas_interacciones()
    for col in columnas_interacciones():
        if col not in headers:
            headers.append(col)
    data = rows[1:] if len(rows) > 1 else []
    data_alineada = [fila + [""] * (len(headers) - len(fila)) for fila in data]
    df_interacciones = pd.DataFrame(data_alineada, columns=headers)
    if df_interacciones.empty:
        df_interacciones = pd.DataFrame(columns=headers)
    ids_existentes = set(df_interacciones["ID_Entrada"].astype(str).str.strip()) if "ID_Entrada" in df_interacciones.columns else set()

    nuevos = 0
    actualizados = 0
    page_token = None

    while True:
        params = {
            "calendarId": "primary",
            "updatedMin": updated_min_api,
            "singleEvents": True,
            "showDeleted": False,
            "maxResults": 250
        }
        if page_token:
            params["pageToken"] = page_token
        events_result = calendar_service.events().list(**params).execute()

        for evento in events_result.get("items", []):
            if evento.get("status") == "cancelled":
                continue
            contacto = evento_calendar_menciona_contacto(evento, indice_contactos)
            if contacto is None:
                continue
            fila = fila_interaccion_desde_evento_calendar(evento, contacto)
            id_entrada = fila[1]
            if id_entrada in ids_existentes and "ID_Entrada" in df_interacciones.columns:
                condicion = df_interacciones["ID_Entrada"].astype(str).str.strip() == id_entrada
                google_id_actual = str(df_interacciones.loc[condicion, "Google_ID"].iloc[0]).strip()
                google_id_nuevo = str(fila[0]).strip()
                if google_id_nuevo and google_id_actual != google_id_nuevo:
                    df_interacciones.loc[condicion, "Google_ID"] = google_id_nuevo
                    actualizados += 1
            else:
                nueva = {col: "" for col in headers}
                for col, valor in zip(headers, fila):
                    nueva[col] = valor
                df_interacciones = pd.concat([df_interacciones, pd.DataFrame([nueva])], ignore_index=True)
                ids_existentes.add(id_entrada)
                nuevos += 1

        page_token = events_result.get("nextPageToken")
        if not page_token:
            break

    if nuevos or actualizados:
        datos_actualizados = [df_interacciones.columns.tolist()] + df_interacciones.values.tolist()
        sheets_service.spreadsheets().values().clear(
            spreadsheetId=ID_PLANILLA, range="Interacciones"
        ).execute()
        sheets_service.spreadsheets().values().update(
            spreadsheetId=ID_PLANILLA,
            range="Interacciones",
            valueInputOption="USER_ENTERED",
            body={"values": datos_actualizados}
        ).execute()

    estado["CALENDAR_UPDATED_MIN"] = ahora_utc.isoformat().replace("+00:00", "Z")
    return nuevos, actualizados, "OK"

def sincronizar_cambios_incrementales_scope(creds):
    """Sincroniza solo cambios nuevos desde los cursores guardados."""
    return sincronizar_actividad_contactos(creds, alcance="scope_incremental")

def sincronizar_actividad_contactos(creds, alcance="scope_incremental", contacto_contexto=None):
    """Sincroniza Gmail/Calendar con un resultado comun para uso masivo o individual."""
    df_contactos = leer_sheet_local(creds)
    if alcance == "contacto":
        google_id = str((contacto_contexto or {}).get("Google_ID", "")).strip()
        if not google_id:
            return {
                "correos_nuevos": 0,
                "correos_reasignados": 0,
                "correos_migrados": 0,
                "citas_nuevas": 0,
                "citas_actualizadas": 0,
                "gmail": "Contacto sin ID.",
                "calendar": "Contacto sin ID.",
                "contacto": contacto_contexto or {},
                "google_id": google_id,
                "emails": "",
            }
        fila_contacto = pd.DataFrame()
        if not df_contactos.empty and "Google_ID" in df_contactos.columns:
            fila_contacto = df_contactos[df_contactos["Google_ID"].astype(str).str.strip() == google_id].copy()
        contacto_actual = fila_contacto.iloc[0].to_dict() if not fila_contacto.empty else (contacto_contexto or {})
        emails = contacto_actual.get("Emails_Concatenados", "")
        correos_nuevos = sincronizar_gmail_contacto(creds, google_id, emails)
        citas_nuevas = sincronizar_calendar_contacto(creds, google_id, emails)
        return {
            "correos_nuevos": correos_nuevos,
            "correos_reasignados": 0,
            "correos_migrados": 0,
            "citas_nuevas": citas_nuevas,
            "citas_actualizadas": 0,
            "gmail": "Revision historica del contacto completada.",
            "calendar": "Revision historica del contacto completada.",
            "contacto": contacto_actual,
            "google_id": google_id,
            "emails": emails,
        }

    if alcance == "scope_incremental":
        estado = leer_sync_state(creds)
        correos_nuevos, msg_gmail = sincronizar_gmail_incremental_scope(creds, df_contactos, estado)
        reparacion_gmail = sincronizar_gmail_reciente_scope(creds, df_contactos)
        citas_nuevas, citas_actualizadas, msg_calendar = sincronizar_calendar_incremental_scope(creds, df_contactos, estado)
        guardar_sync_state(creds, estado)
        return {
            "correos_nuevos": correos_nuevos + reparacion_gmail.get("nuevas", 0),
            "correos_reasignados": reparacion_gmail.get("reasignadas", 0),
            "correos_migrados": reparacion_gmail.get("migradas", 0),
            "citas_nuevas": citas_nuevas,
            "citas_actualizadas": citas_actualizadas,
            "gmail": f"{msg_gmail} | {reparacion_gmail.get('mensaje', '')}",
            "calendar": msg_calendar,
        }

    raise ValueError(f"Alcance de sincronizacion no soportado: {alcance}")

# 2. CONFIGURACIÓN: Pega aquí el ID de tu Google Sheet
ID_PLANILLA = "14tigwoo1mDybh-HxhJ64dsmng2y39nqY6JoiCImtM8E"
RANGO_SHEET = "CRM_Contactos_Extra!A:Y"

def autenticar_google():
    creds = None
    if os.path.exists('token.json'):
        creds = Credentials.from_authorized_user_file('token.json', SCOPES)
    
    if not creds or not creds.valid:
        if creds and creds.expired and creds.refresh_token:
            try:
                creds.refresh(Request())
            except (TransportError, RefreshError) as e:
                detalle_error = str(e)
                if isinstance(e, RefreshError) and "invalid_grant" in detalle_error:
                    from datetime import datetime
                    nombre_archivo = f"token.invalid-{datetime.now().strftime('%Y%m%d-%H%M%S')}.json"
                    try:
                        if os.path.exists("token.json"):
                            os.replace("token.json", nombre_archivo)
                    except Exception:
                        pass
                    for key in ["flow", "auth_url"]:
                        st.session_state.pop(key, None)
                    creds = None
                    st.warning("La sesión de Google expiró o fue revocada. Te pediré autorización nuevamente.")
                else:
                    st.error("No pude conectar con Google para renovar la sesión.")
                    st.caption("Esto suele pasar cuando internet, VPN, firewall o permisos de red bloquean el acceso a Google. Cuando la conexión esté disponible, refresca esta página.")
                    c_retry, _ = st.columns([1.0, 6.0], gap="small")
                    with c_retry:
                        if st.button("Reintentar", key="btn_reintentar_google", use_container_width=True):
                            st.rerun()
                    with st.expander("Detalle técnico", expanded=False):
                        st.code(detalle_error, language="text")
                    st.stop()

    if not creds or not creds.valid:
        if 'flow' not in st.session_state: st.session_state.flow = InstalledAppFlow.from_client_secrets_file('credentials.json', SCOPES)
        flow = st.session_state.flow
        st.info("🔑 Se requiere autorización de acceso para Google Contacts y Sheets.")
        flow.redirect_uri = 'urn:ietf:wg:oauth:2.0:oob'
        if 'auth_url' not in st.session_state: st.session_state.auth_url, _ = flow.authorization_url(prompt='consent')
        auth_url = st.session_state.auth_url
        
        st.write("1. Haz clic en el siguiente enlace para iniciar sesión:")
        st.markdown(f"[👉 HACER CLIC AQUÍ PARA AUTORIZAR]({auth_url})")
        
        codigo_autorizacion = st.text_input("2. Copia el código que te dará Google y pégalo aquí:")
        
        if codigo_autorizacion:
            flow.fetch_token(code=codigo_autorizacion)
            st.session_state.clear() # Limpia la memoria interna una vez que entramos con éxito
            creds = flow.credentials
            with open('token.json', 'w') as token:
                token.write(creds.to_json())
            st.success("¡Autenticado con éxito! Recargando...")
            st.rerun()
        else:
            st.stop()
    return creds

def leer_sheet_local(creds):
    """Lee los datos guardados en el Google Sheet para saber el estado del Scope"""
    service = build('sheets', 'v4', credentials=creds)
    columnas_maestras = columnas_contactos_maestras()
    
    try:
        result = service.spreadsheets().values().get(
            spreadsheetId=ID_PLANILLA, range=RANGO_SHEET
        ).execute()
        
        # Extraemos las filas desde la respuesta de Google API
        rows = result.get('values', [])
        
        # Si la pestaña existe pero no tiene filas de datos, retornamos el molde vacío
        if not rows:
            return pd.DataFrame(columns=columnas_maestras)
        
        # Transformamos la lectura en un DataFrame estructurado
        headers = [str(col).strip() for col in rows[0]]
        data = rows[1:]
        data_alineada = [
            (fila + [""] * (len(headers) - len(fila)))[:len(headers)]
            for fila in data
        ]
        df = pd.DataFrame(data_alineada, columns=headers if headers else columnas_maestras)
        for col in columnas_maestras:
            if col not in df.columns:
                df[col] = ""
        return preparar_df_contactos_maestro(df)
        
    except Exception as e:
        # Blindaje total: Si falla la conexión o el rango no existe, 
        # retornamos el DataFrame vacío con las columnas correctas de forma directa y segura.
        return pd.DataFrame(columns=columnas_maestras)



def leer_fecha_inicio_config(creds):
    """Lee la fecha de inicio histórica desde la pestaña CRM_Config. Por defecto 01/10/2025."""
    service = build('sheets', 'v4', credentials=creds)
    try:
        result = service.spreadsheets().values().get(
            spreadsheetId=ID_PLANILLA, range="CRM_Config!A2:B2"
        ).execute()
        values = result.get('values', [])
        if values and len(values[0]) >= 2:
            return str(values[0][1]).strip() # Retorna el valor de la celda B2
    except Exception:
        pass
    return "01/10/2025" # Blindaje por defecto si la pestaña no se encuentra

def extraer_dominios_desde_emails(emails_concatenados):
    """Devuelve dominios tipo @firma.cl separados por ; desde una lista de correos."""
    import re

    texto = "" if pd.isna(emails_concatenados) else str(emails_concatenados)
    if not texto or texto.strip().lower() in ["sin email", "nan", "none", "null"]:
        return ""

    dominios = []
    for email in re.findall(r"[\w\.-]+@[\w\.-]+\.\w+", texto):
        dominio = "@" + email.split("@", 1)[1].strip().lower()
        if dominio not in dominios:
            dominios.append(dominio)
    return ";".join(dominios)

def listar_dominios_headhunter(fila_contacto):
    dominios_guardados = str(fila_contacto.get("Dominios_Headhunter", "")).strip()
    if not dominios_guardados:
        dominios_guardados = extraer_dominios_desde_emails(fila_contacto.get("Emails_Concatenados", ""))

    dominios = []
    for dominio in dominios_guardados.split(";"):
        dominio = dominio.strip().lower()
        if not dominio:
            continue
        if dominio != "no email" and not dominio.startswith("@"):
            dominio = "@" + dominio
        if dominio not in dominios:
            dominios.append(dominio)

    return dominios or ["NO EMAIL"]

def construir_resumen_dominios_headhunter(df_hh_scope, ultimas, hoy):
    columnas = ["Dominio", "Contactos HH", "Estado CRM", "Último contacto", "Días sin contacto", "Tipo", "Asunto"]
    if df_hh_scope.empty:
        return pd.DataFrame(columns=columnas)

    filas = []
    for _, contacto in df_hh_scope.iterrows():
        for dominio in listar_dominios_headhunter(contacto):
            filas.append({
                "Google_ID": str(contacto.get("Google_ID", "")).strip(),
                "Dominio": dominio,
                "Estado_CRM": str(contacto.get("Estado_CRM", "")).strip(),
            })

    df_dominios = pd.DataFrame(filas)
    if df_dominios.empty:
        return pd.DataFrame(columns=columnas)

    df_ultimas = ultimas.copy()
    if df_ultimas.empty:
        df_ultimas = pd.DataFrame(columns=["Google_ID", "Fecha_DT", "Tipo", "Asunto_Titulo"])
    for col in ["Google_ID", "Fecha_DT", "Tipo", "Asunto_Titulo"]:
        if col not in df_ultimas.columns:
            df_ultimas[col] = pd.NaT if col == "Fecha_DT" else ""
    df_ultimas["Google_ID"] = df_ultimas["Google_ID"].astype(str).str.strip()

    df_dominios = pd.merge(df_dominios, df_ultimas[["Google_ID", "Fecha_DT", "Tipo", "Asunto_Titulo"]], on="Google_ID", how="left")

    prioridad_estado = {
        "1. Pendiente": 1,
        "2. Promesa conversa/café": 2,
        "3. Propuesta de cita": 3,
        "4. Cita creada": 4,
        "5. Cita concretada": 5,
        "6. Agradecimiento enviado": 6,
        "7. Propone nuevo lead": 7,
        "8. Nuevo lead contactado": 8,
    }

    resumen = []
    for dominio, grupo in df_dominios.groupby("Dominio", dropna=False):
        grupo = grupo.copy()
        grupo["Estado_CRM"] = grupo["Estado_CRM"].apply(normalizar_estado_networking)
        prioridad_estado = {estado: idx for idx, estado in enumerate(estados_networking_oficiales(), start=1)}
        grupo["__prioridad"] = grupo["Estado_CRM"].map(prioridad_estado).fillna(0)
        estado_avanzado = grupo.sort_values("__prioridad", ascending=False)["Estado_CRM"].iloc[0]
        con_fecha = grupo.dropna(subset=["Fecha_DT"]).sort_values("Fecha_DT", ascending=False)
        if con_fecha.empty:
            ultimo_contacto = "Sin registro"
            dias_sin_contacto = pd.NA
            tipo = "Sin interacción"
            asunto = ""
        else:
            fila_ultima = con_fecha.iloc[0]
            ultimo_contacto = fila_ultima["Fecha_DT"].strftime("%d/%m/%Y")
            dias_sin_contacto = int((hoy - fila_ultima["Fecha_DT"]).days)
            tipo = str(fila_ultima.get("Tipo", "")).strip() or "Sin interacción"
            asunto = str(fila_ultima.get("Asunto_Titulo", "")).strip()

        resumen.append({
            "Dominio": dominio,
            "Contactos HH": int(grupo["Google_ID"].nunique()),
            "Estado CRM": estado_avanzado,
            "Último contacto": ultimo_contacto,
            "Días sin contacto": dias_sin_contacto,
            "Tipo": tipo,
            "Asunto": asunto,
        })

    df_resumen = pd.DataFrame(resumen, columns=columnas)
    df_resumen["__dias_sort"] = pd.to_numeric(df_resumen["Días sin contacto"], errors="coerce")
    df_resumen = df_resumen.sort_values(["__dias_sort", "Dominio"], ascending=[False, True], na_position="first")
    return df_resumen.drop(columns=["__dias_sort"])

def columnas_relaciones_legacy():
    return ["Google_ID_Origen", "Nombre_Referido", "Google_ID_Referido", "Notas_Relacion"]


def columnas_referidos_expandidas():
    return [
        "Google_ID_Origen",
        "Nombre_Referido",
        "Google_ID_Referido",
        "Notas_Relacion",
        "Referido_ID",
        "Quien_Refiere_ID",
        "Empresa_Referido",
        "Cargo_Referido",
        "Telefono_Referido",
        "Email_Referido",
        "Notas_Referido",
        "Contacto_Vinculado_ID",
        "Estado_Referido",
        "Fecha_Creacion",
        "Fecha_Actualizacion",
        "Origen",
        "Activo",
    ]


def columnas_relaciones():
    return columnas_referidos_expandidas()


def generar_referido_id(fila_rel):
    base = "|".join([
        str(fila_rel.get("Google_ID_Origen", fila_rel.get("Quien_Refiere_ID", ""))).strip(),
        str(fila_rel.get("Nombre_Referido", "")).strip(),
        str(fila_rel.get("Google_ID_Referido", fila_rel.get("Contacto_Vinculado_ID", ""))).strip(),
        str(fila_rel.get("Notas_Relacion", fila_rel.get("Notas_Referido", ""))).strip(),
    ])
    return f"REF_{hash_texto_corto(base)}"


def normalizar_relaciones_df(df_relaciones):
    columnas_base = columnas_relaciones()
    if df_relaciones is None or df_relaciones.empty:
        return pd.DataFrame(columns=columnas_base)

    df = df_relaciones.copy().fillna("")
    df.columns = [str(col).strip() for col in df.columns]
    for col in columnas_base:
        if col not in df.columns:
            df[col] = ""

    df["Google_ID_Origen"] = df["Google_ID_Origen"].astype(str).str.strip()
    df["Quien_Refiere_ID"] = df["Quien_Refiere_ID"].astype(str).str.strip()
    df["Quien_Refiere_ID"] = df["Quien_Refiere_ID"].where(df["Quien_Refiere_ID"] != "", df["Google_ID_Origen"])
    df["Google_ID_Origen"] = df["Google_ID_Origen"].where(df["Google_ID_Origen"] != "", df["Quien_Refiere_ID"])

    df["Google_ID_Referido"] = df["Google_ID_Referido"].astype(str).str.strip()
    df["Contacto_Vinculado_ID"] = df["Contacto_Vinculado_ID"].astype(str).str.strip()
    df["Contacto_Vinculado_ID"] = df["Contacto_Vinculado_ID"].where(df["Contacto_Vinculado_ID"] != "", df["Google_ID_Referido"])
    df["Google_ID_Referido"] = df["Google_ID_Referido"].where(df["Google_ID_Referido"] != "", df["Contacto_Vinculado_ID"])

    df["Notas_Relacion"] = df["Notas_Relacion"].astype(str)
    df["Notas_Referido"] = df["Notas_Referido"].astype(str)
    df["Notas_Referido"] = df["Notas_Referido"].where(df["Notas_Referido"].str.strip() != "", df["Notas_Relacion"])
    df["Notas_Relacion"] = df["Notas_Relacion"].where(df["Notas_Relacion"].str.strip() != "", df["Notas_Referido"])

    df["Referido_ID"] = df["Referido_ID"].astype(str).str.strip()
    sin_id = df["Referido_ID"].eq("")
    if sin_id.any():
        df.loc[sin_id, "Referido_ID"] = df.loc[sin_id].apply(generar_referido_id, axis=1)

    df["Estado_Referido"] = df["Estado_Referido"].astype(str).str.strip()
    df["Estado_Referido"] = df["Estado_Referido"].where(df["Estado_Referido"] != "", "Abierto")
    df["Origen"] = df["Origen"].astype(str).str.strip()
    df["Origen"] = df["Origen"].where(df["Origen"] != "", "Manual")
    df["Activo"] = df["Activo"].astype(str).str.strip()
    df["Activo"] = df["Activo"].where(df["Activo"] != "", "TRUE")

    return df[columnas_base].fillna("")


def leer_relaciones_sheet(creds):
    """Lee las relaciones vinculadas entre contactos desde la pestaña CRM_Relaciones con soporte de ID único"""
    service = build('sheets', 'v4', credentials=creds)
    columnas_base = columnas_relaciones()
    try:
        result = service.spreadsheets().values().get(
            spreadsheetId=ID_PLANILLA, range="CRM_Relaciones!A:Q"
        ).execute()
        rows = result.get('values', [])
        if not rows or len(rows) < 2:
            return pd.DataFrame(columns=columnas_base)
            
        headers = rows[0]
        data = rows[1:]
        data_alineada = [fila + [""] * (len(headers) - len(fila)) for fila in data]
        df = pd.DataFrame(data_alineada, columns=headers)
        return normalizar_relaciones_df(df)
    except Exception:
        return pd.DataFrame(columns=columnas_base)


def guardar_relaciones_sheet(creds, df_relaciones):
    """Guarda CRM_Relaciones con encabezados estables y sin remanentes visuales."""
    service = build('sheets', 'v4', credentials=creds)
    columnas_base = columnas_relaciones()
    df_guardar = df_relaciones.copy() if df_relaciones is not None else pd.DataFrame(columns=columnas_base)
    for col in columnas_base:
        if col not in df_guardar.columns:
            df_guardar[col] = ""
    df_guardar = normalizar_relaciones_df(df_guardar)
    datos_lista = [columnas_base] + df_guardar.values.tolist()
    service.spreadsheets().values().clear(spreadsheetId=ID_PLANILLA, range="CRM_Relaciones!A:Q").execute()
    service.spreadsheets().values().update(
        spreadsheetId=ID_PLANILLA,
        range="CRM_Relaciones!A:Q",
        valueInputOption="USER_ENTERED",
        body={"values": datos_lista}
    ).execute()


def clave_relacion(fila_rel):
    referido_id = str(fila_rel.get("Referido_ID", "")).strip()
    if referido_id:
        return referido_id
    partes = [
        str(fila_rel.get("Google_ID_Origen", "")).strip(),
        str(fila_rel.get("Nombre_Referido", "")).strip(),
        str(fila_rel.get("Google_ID_Referido", "")).strip(),
        str(fila_rel.get("Notas_Relacion", fila_rel.get("Notes_Relacion", ""))).strip(),
    ]
    return hash_texto_corto("|".join(partes))


def condicion_relacion_por_clave(df_relaciones, relacion_key):
    if df_relaciones is None or df_relaciones.empty:
        return pd.Series([], dtype=bool)
    return df_relaciones.apply(lambda fila: clave_relacion(fila) == str(relacion_key or "").strip(), axis=1)


def construir_fila_referido_editor(datos_referido, fila_base=None):
    from datetime import datetime

    fila = {col: "" for col in columnas_relaciones()}
    if fila_base is not None:
        for col in columnas_relaciones():
            fila[col] = valor_contacto_limpio(fila_base.get(col, ""))

    quien_refiere = valor_contacto_limpio(
        datos_referido.get("Quien_Refiere_ID", datos_referido.get("Google_ID_Origen", fila.get("Quien_Refiere_ID", fila.get("Google_ID_Origen", ""))))
    )
    contacto_vinculado = valor_contacto_limpio(
        datos_referido.get("Contacto_Vinculado_ID", datos_referido.get("Google_ID_Referido", fila.get("Contacto_Vinculado_ID", fila.get("Google_ID_Referido", ""))))
    )
    nombre_referido = valor_contacto_limpio(datos_referido.get("Nombre_Referido", fila.get("Nombre_Referido", "")))
    notas = valor_contacto_limpio(datos_referido.get("Notas_Referido", datos_referido.get("Notas_Relacion", fila.get("Notas_Referido", fila.get("Notas_Relacion", "")))))

    fila.update({
        "Google_ID_Origen": quien_refiere,
        "Quien_Refiere_ID": quien_refiere,
        "Nombre_Referido": nombre_referido,
        "Google_ID_Referido": contacto_vinculado,
        "Contacto_Vinculado_ID": contacto_vinculado,
        "Notas_Relacion": notas,
        "Notas_Referido": notas,
        "Empresa_Referido": valor_contacto_limpio(datos_referido.get("Empresa_Referido", fila.get("Empresa_Referido", ""))),
        "Cargo_Referido": valor_contacto_limpio(datos_referido.get("Cargo_Referido", fila.get("Cargo_Referido", ""))),
        "Telefono_Referido": valor_contacto_limpio(datos_referido.get("Telefono_Referido", fila.get("Telefono_Referido", ""))),
        "Email_Referido": valor_contacto_limpio(datos_referido.get("Email_Referido", fila.get("Email_Referido", ""))),
        "Estado_Referido": valor_contacto_limpio(datos_referido.get("Estado_Referido", fila.get("Estado_Referido", "Abierto"))) or "Abierto",
        "Origen": valor_contacto_limpio(datos_referido.get("Origen", fila.get("Origen", "Manual"))) or "Manual",
        "Activo": valor_contacto_limpio(datos_referido.get("Activo", fila.get("Activo", "TRUE"))).upper() or "TRUE",
    })

    if not valor_contacto_limpio(fila.get("Fecha_Creacion", "")):
        fila["Fecha_Creacion"] = datetime.now().strftime("%d/%m/%Y %H:%M:%S")
    fila["Fecha_Actualizacion"] = datetime.now().strftime("%d/%m/%Y %H:%M:%S")
    if not valor_contacto_limpio(fila.get("Referido_ID", "")):
        fila["Referido_ID"] = generar_referido_id(fila)
    return fila


def guardar_referido_editor_en_sheet(creds, datos_referido, referido_id_actual=""):
    df_relaciones = leer_relaciones_sheet(creds)
    referido_id_actual = str(referido_id_actual or datos_referido.get("Referido_ID", "") or "").strip()

    errores = []
    if not valor_contacto_limpio(datos_referido.get("Quien_Refiere_ID", datos_referido.get("Google_ID_Origen", ""))):
        errores.append("Debe existir un contacto que refiere.")
    datos_minimos = [
        datos_referido.get("Nombre_Referido", ""),
        datos_referido.get("Email_Referido", ""),
        datos_referido.get("Telefono_Referido", ""),
        datos_referido.get("Empresa_Referido", ""),
        datos_referido.get("Cargo_Referido", ""),
        datos_referido.get("Notas_Referido", datos_referido.get("Notas_Relacion", "")),
        datos_referido.get("Contacto_Vinculado_ID", datos_referido.get("Google_ID_Referido", "")),
    ]
    if not any(valor_contacto_limpio(valor) for valor in datos_minimos):
        errores.append("El referido necesita al menos un dato ademas de quien refiere.")
    invalidos_email = validar_emails_contacto_editor(datos_referido.get("Email_Referido", ""))
    if invalidos_email:
        errores.append("Email de referido invalido: " + ", ".join(invalidos_email))
    invalidos_telefono = validar_telefonos_contacto_editor(datos_referido.get("Telefono_Referido", ""))
    if invalidos_telefono:
        errores.append("Telefono de referido invalido: " + ", ".join(invalidos_telefono))
    if errores:
        return {"ok": False, "errores": errores, "referido_id": referido_id_actual}

    if referido_id_actual:
        condicion = condicion_relacion_por_clave(df_relaciones, referido_id_actual)
    else:
        condicion = pd.Series([False] * len(df_relaciones), index=df_relaciones.index)

    fila_base = df_relaciones.loc[condicion].iloc[0] if len(condicion) and condicion.any() else None
    fila = construir_fila_referido_editor(datos_referido, fila_base=fila_base)
    if len(condicion) and condicion.any():
        for col, valor in fila.items():
            df_relaciones.loc[condicion, col] = valor
    else:
        df_relaciones = pd.concat([df_relaciones, pd.DataFrame([fila])], ignore_index=True)
    guardar_relaciones_sheet(creds, df_relaciones)
    return {"ok": True, "errores": [], "referido_id": fila.get("Referido_ID", ""), "referido": fila}


def upsert_relacion_contacto(creds, relacion_key, google_id_origen, nombre_referido, google_id_referido, notas_relacion):
    datos_referido = {
        "Google_ID_Origen": google_id_origen,
        "Quien_Refiere_ID": google_id_origen,
        "Nombre_Referido": nombre_referido,
        "Google_ID_Referido": google_id_referido,
        "Contacto_Vinculado_ID": google_id_referido,
        "Notas_Relacion": notas_relacion,
        "Notas_Referido": notas_relacion,
        "Origen": "Manual",
        "Activo": "TRUE",
    }
    return guardar_referido_editor_en_sheet(creds, datos_referido, referido_id_actual=relacion_key)


def eliminar_relacion_contacto(creds, relacion_key):
    df_relaciones = leer_relaciones_sheet(creds)
    condicion = condicion_relacion_por_clave(df_relaciones, relacion_key)
    if len(condicion) and condicion.any():
        df_relaciones = df_relaciones[~condicion].copy()
        guardar_relaciones_sheet(creds, df_relaciones)
        return True
    return False


def solicitar_popup_referidos(google_id_contexto=None, relacion_key=None):
    st.session_state["popup_referidos_abierto"] = True
    st.session_state["popup_referidos_google_id"] = str(google_id_contexto or "").strip()
    st.session_state["popup_referidos_relacion_key"] = str(relacion_key or "").strip()
    st.session_state["popup_referidos_draft"] = {}
    st.session_state["popup_referidos_reload"] = True


def cerrar_popup_referidos():
    st.session_state["popup_referidos_abierto"] = False
    st.session_state["popup_referidos_google_id"] = ""
    st.session_state["popup_referidos_relacion_key"] = ""
    st.session_state["popup_referidos_draft"] = {}
    st.session_state["popup_referidos_reload"] = False
    st.session_state["popup_referidos_reabrir_despues_contacto"] = False
    st.session_state["confirmar_borrado_rel_id"] = None


def renderizar_popup_referidos_pendiente(creds, df_maestro_contactos, google_id_contexto=None):
    if st.session_state.get("popup_contacto_editor_abierto", False):
        renderizar_popup_contacto_editor_pendiente(creds, df_maestro_contactos)
        return
    resultado_contacto = st.session_state.pop("popup_referidos_contacto_resultado", None)
    if resultado_contacto and resultado_contacto.get("ok"):
        draft = dict(st.session_state.get("popup_referidos_draft", {}))
        draft["Contacto_Vinculado_ID"] = resultado_contacto.get("contacto_id", "")
        draft["Google_ID_Referido"] = resultado_contacto.get("contacto_id", "")
        st.session_state["popup_referidos_draft"] = draft
        st.session_state["popup_referidos_reload"] = True
        st.session_state["popup_referidos_abierto"] = True
    if not st.session_state.get("popup_referidos_abierto", False):
        return
    contexto_pendiente = str(st.session_state.get("popup_referidos_google_id", "") or "").strip()
    contexto_actual = str(google_id_contexto or "").strip()
    if contexto_actual and contexto_pendiente and contexto_actual != contexto_pendiente:
        return
    popup_gestion_vincu_global(
        creds,
        df_maestro_contactos,
        google_id_contexto=contexto_pendiente or contexto_actual or None,
        relacion_key_inicial=st.session_state.get("popup_referidos_relacion_key", "")
    )

def columnas_todos_ia():
    return [
        "Todo_ID", "Fecha_Creacion", "Fecha_Actualizacion", "Estado_ToDo",
        "Tipo_ToDo", "Prioridad", "Origen", "Confianza",
        "Objeto_Tipo", "Objeto_ID", "Objeto_Label", "Cambio_Tipo",
        "Estado_Actual_JSON", "Estado_Sugerido_JSON", "Evidencia_JSON",
        "Acciones_JSON", "Dedup_Key", "Notas"
    ]

def tipos_todos_ia():
    return {
        "NETWORKING_STATUS_CHANGE": "Sugerir cambio de estado oficial del contacto.",
        "RULE_STATUS_TO_CONTACTED": "Cambiar estado a Contactado.",
        "RULE_STATUS_TO_SCHEDULED": "Cambiar estado a Agendado.",
        "RULE_STATUS_TO_MEETING_DONE": "Cambiar estado a Cita concretada.",
        "RULE_STATUS_TO_THANK_YOU": "Cambiar estado a Agradecimiento enviado.",
        "FOCUS_CHANGE": "Incluir o quitar un contacto del foco de networking activo.",
        "CONTACT_CREATE": "Crear un contacto nuevo sugerido por interacciones o minutas.",
        "CONTACT_UPDATE_FIELD": "Actualizar un campo de un contacto existente.",
        "CONTACT_ADD_EMAIL": "Agregar un correo a un contacto existente.",
        "CONTACT_MERGE_REVIEW": "Revisar posible fusion o reasignacion entre contactos.",
        "EMAIL_DRAFT": "Crear o abrir un borrador de correo.",
        "WHATSAPP_MESSAGE": "Abrir WhatsApp Web con un mensaje sugerido.",
        "CALENDAR_ACTION": "Crear, revisar o confirmar una cita.",
        "FOLLOW_UP_REMINDER": "Sugerir retomar contacto por antiguedad o contexto.",
        "REFERRAL_REVIEW": "Revisar un referido mencionado o pendiente.",
        "HH_DOMAIN_REVIEW": "Revisar marca de headhunter o dominio asociado.",
        "DATA_CONFLICT_REVIEW": "Resolver conflicto entre fuentes de datos.",
        "SYNC_REVIEW": "Revisar cambios detectados durante una sincronizacion.",
    }

def catalogo_automatizaciones_todo():
    return [
        {
            "Tipo_ToDo": "RULE_STATUS_TO_CONTACTED",
            "Descripcion": "Cambia el estado del contacto a Contactado cuando existe un correo o mensaje saliente.",
            "Motor_Tipo": "RULE",
            "Modo_Ejecucion": "Preguntar",
            "Permite_Auto_Aplicar": "TRUE",
            "Requiere_Confirmacion": "TRUE",
            "Fuentes_Requeridas": "contactos;interacciones;gmail",
            "Ventana_Dias": "365",
            "Criterio_Dedupe": "sub_regla+contacto+estado_sugerido",
        },
        {
            "Tipo_ToDo": "RULE_STATUS_TO_SCHEDULED",
            "Descripcion": "Cambia el estado del contacto a Agendado cuando existe una cita futura.",
            "Motor_Tipo": "RULE",
            "Modo_Ejecucion": "Preguntar",
            "Permite_Auto_Aplicar": "TRUE",
            "Requiere_Confirmacion": "TRUE",
            "Fuentes_Requeridas": "contactos;interacciones;calendario",
            "Ventana_Dias": "365",
            "Criterio_Dedupe": "sub_regla+contacto+estado_sugerido",
        },
        {
            "Tipo_ToDo": "RULE_STATUS_TO_MEETING_DONE",
            "Descripcion": "Cambia el estado del contacto a Cita concretada cuando una cita ya paso.",
            "Motor_Tipo": "RULE",
            "Modo_Ejecucion": "Preguntar",
            "Permite_Auto_Aplicar": "TRUE",
            "Requiere_Confirmacion": "TRUE",
            "Fuentes_Requeridas": "contactos;interacciones;calendario",
            "Ventana_Dias": "365",
            "Criterio_Dedupe": "sub_regla+contacto+estado_sugerido",
        },
        {
            "Tipo_ToDo": "RULE_STATUS_TO_THANK_YOU",
            "Descripcion": "Cambia el estado del contacto a Agradecimiento enviado cuando existe un mensaje posterior a una cita.",
            "Motor_Tipo": "RULE",
            "Modo_Ejecucion": "Preguntar",
            "Permite_Auto_Aplicar": "TRUE",
            "Requiere_Confirmacion": "TRUE",
            "Fuentes_Requeridas": "contactos;interacciones;calendario;gmail",
            "Ventana_Dias": "365",
            "Criterio_Dedupe": "sub_regla+contacto+estado_sugerido",
        },
        {
            "Tipo_ToDo": "FOCUS_CHANGE",
            "Descripcion": "Sugerir incluir o quitar contactos del foco activo.",
            "Motor_Tipo": "HYBRID",
            "Modo_Ejecucion": "Preguntar",
            "Permite_Auto_Aplicar": "TRUE",
            "Requiere_Confirmacion": "TRUE",
            "Fuentes_Requeridas": "contactos;interacciones;minutas",
            "Ventana_Dias": "180",
            "Criterio_Dedupe": "tipo+contacto+accion",
        },
        {
            "Tipo_ToDo": "CONTACT_CREATE",
            "Descripcion": "Sugerir crear contactos detectados en minutas o referidos.",
            "Motor_Tipo": "AI",
            "Modo_Ejecucion": "Preguntar",
            "Permite_Auto_Aplicar": "FALSE",
            "Requiere_Confirmacion": "TRUE",
            "Fuentes_Requeridas": "minutas;relaciones",
            "Ventana_Dias": "365",
            "Criterio_Dedupe": "tipo+nombre+fuente",
        },
        {
            "Tipo_ToDo": "CONTACT_UPDATE_FIELD",
            "Descripcion": "Sugerir actualizar datos de contacto.",
            "Motor_Tipo": "HYBRID",
            "Modo_Ejecucion": "Preguntar",
            "Permite_Auto_Aplicar": "TRUE",
            "Requiere_Confirmacion": "TRUE",
            "Fuentes_Requeridas": "google_contacts;minutas;gmail",
            "Ventana_Dias": "365",
            "Criterio_Dedupe": "tipo+contacto+campo+valor",
        },
        {
            "Tipo_ToDo": "CONTACT_ADD_EMAIL",
            "Descripcion": "Sugerir agregar un email a un contacto existente.",
            "Motor_Tipo": "RULE",
            "Modo_Ejecucion": "Preguntar",
            "Permite_Auto_Aplicar": "TRUE",
            "Requiere_Confirmacion": "TRUE",
            "Fuentes_Requeridas": "gmail;contactos",
            "Ventana_Dias": "365",
            "Criterio_Dedupe": "tipo+contacto+email",
        },
        {
            "Tipo_ToDo": "CONTACT_MERGE_REVIEW",
            "Descripcion": "Revisar posibles duplicados o reasignaciones de contacto.",
            "Motor_Tipo": "HYBRID",
            "Modo_Ejecucion": "Preguntar",
            "Permite_Auto_Aplicar": "FALSE",
            "Requiere_Confirmacion": "TRUE",
            "Fuentes_Requeridas": "contactos;gmail;interacciones",
            "Ventana_Dias": "365",
            "Criterio_Dedupe": "tipo+contactos_candidatos",
        },
        {
            "Tipo_ToDo": "EMAIL_DRAFT",
            "Descripcion": "Sugerir preparar correo o abrir Gmail.",
            "Motor_Tipo": "AI",
            "Modo_Ejecucion": "Preguntar",
            "Permite_Auto_Aplicar": "FALSE",
            "Requiere_Confirmacion": "TRUE",
            "Fuentes_Requeridas": "contactos;minutas;interacciones",
            "Ventana_Dias": "120",
            "Criterio_Dedupe": "tipo+contacto+proposito",
        },
        {
            "Tipo_ToDo": "WHATSAPP_MESSAGE",
            "Descripcion": "Sugerir abrir WhatsApp Web con mensaje.",
            "Motor_Tipo": "AI",
            "Modo_Ejecucion": "Preguntar",
            "Permite_Auto_Aplicar": "FALSE",
            "Requiere_Confirmacion": "TRUE",
            "Fuentes_Requeridas": "contactos;minutas;interacciones",
            "Ventana_Dias": "120",
            "Criterio_Dedupe": "tipo+contacto+proposito",
        },
        {
            "Tipo_ToDo": "CALENDAR_ACTION",
            "Descripcion": "Sugerir crear, revisar o confirmar una cita.",
            "Motor_Tipo": "RULE",
            "Modo_Ejecucion": "Preguntar",
            "Permite_Auto_Aplicar": "FALSE",
            "Requiere_Confirmacion": "TRUE",
            "Fuentes_Requeridas": "calendario;contactos",
            "Ventana_Dias": "365",
            "Criterio_Dedupe": "tipo+contacto+cita",
        },
        {
            "Tipo_ToDo": "FOLLOW_UP_REMINDER",
            "Descripcion": "Sugerir retomar contacto por antiguedad o contexto.",
            "Motor_Tipo": "RULE",
            "Modo_Ejecucion": "Preguntar",
            "Permite_Auto_Aplicar": "FALSE",
            "Requiere_Confirmacion": "TRUE",
            "Fuentes_Requeridas": "contactos;interacciones;fecha_actual",
            "Ventana_Dias": "365",
            "Criterio_Dedupe": "tipo+contacto+bucket_antiguedad",
        },
        {
            "Tipo_ToDo": "REFERRAL_REVIEW",
            "Descripcion": "Revisar referidos mencionados o pendientes.",
            "Motor_Tipo": "AI",
            "Modo_Ejecucion": "Preguntar",
            "Permite_Auto_Aplicar": "FALSE",
            "Requiere_Confirmacion": "TRUE",
            "Fuentes_Requeridas": "minutas;relaciones;contactos",
            "Ventana_Dias": "365",
            "Criterio_Dedupe": "tipo+contacto_origen+referido",
        },
        {
            "Tipo_ToDo": "HH_DOMAIN_REVIEW",
            "Descripcion": "Revisar marca de headhunter o dominio asociado.",
            "Motor_Tipo": "RULE",
            "Modo_Ejecucion": "Preguntar",
            "Permite_Auto_Aplicar": "TRUE",
            "Requiere_Confirmacion": "TRUE",
            "Fuentes_Requeridas": "contactos;dominios",
            "Ventana_Dias": "365",
            "Criterio_Dedupe": "tipo+contacto+dominio",
        },
        {
            "Tipo_ToDo": "DATA_CONFLICT_REVIEW",
            "Descripcion": "Resolver conflictos entre fuentes de datos.",
            "Motor_Tipo": "RULE",
            "Modo_Ejecucion": "Preguntar",
            "Permite_Auto_Aplicar": "FALSE",
            "Requiere_Confirmacion": "TRUE",
            "Fuentes_Requeridas": "google_contacts;sheet;gmail",
            "Ventana_Dias": "365",
            "Criterio_Dedupe": "tipo+objeto+campo",
        },
        {
            "Tipo_ToDo": "SYNC_REVIEW",
            "Descripcion": "Revisar cambios detectados durante sincronizacion.",
            "Motor_Tipo": "RULE",
            "Modo_Ejecucion": "Preguntar",
            "Permite_Auto_Aplicar": "TRUE",
            "Requiere_Confirmacion": "TRUE",
            "Fuentes_Requeridas": "sync;google_contacts;interacciones",
            "Ventana_Dias": "365",
            "Criterio_Dedupe": "tipo+sync_batch+objeto",
        },
    ]

def orden_motor_todo(motor):
    orden = {"RULE": 1, "HYBRID": 2, "AI": 3}
    return orden.get(str(motor).strip().upper(), 99)

def orden_accion_todo(tipo_todo):
    acciones_fuera_app = {
        "EMAIL_DRAFT",
        "WHATSAPP_MESSAGE",
        "CALENDAR_ACTION",
        "CONTACT_CREATE",
    }
    return 2 if str(tipo_todo).strip().upper() in acciones_fuera_app else 1

def tipo_config_para_regla_estado_networking(rule_id, estado_sugerido=""):
    mapa = {
        "STATUS_CONTACTED_FROM_OUTBOUND_MESSAGE": "RULE_STATUS_TO_CONTACTED",
        "STATUS_SCHEDULED_FROM_FUTURE_EVENT": "RULE_STATUS_TO_SCHEDULED",
        "STATUS_MEETING_DONE_FROM_PAST_EVENT": "RULE_STATUS_TO_MEETING_DONE",
        "STATUS_MEETING_DONE_FROM_MINUTE": "RULE_STATUS_TO_MEETING_DONE",
        "STATUS_THANK_YOU_FROM_POST_MEETING_MESSAGE": "RULE_STATUS_TO_THANK_YOU",
    }
    rule_id = str(rule_id or "").strip()
    if rule_id in mapa:
        return mapa[rule_id]
    estado = normalizar_estado_networking(estado_sugerido)
    mapa_estado = {
        "Contactado": "RULE_STATUS_TO_CONTACTED",
        "Agendado": "RULE_STATUS_TO_SCHEDULED",
        "Cita concretada": "RULE_STATUS_TO_MEETING_DONE",
        "Agradecimiento enviado": "RULE_STATUS_TO_THANK_YOU",
    }
    return mapa_estado.get(estado, "NETWORKING_STATUS_CHANGE")

def prioridad_regla_estado_networking(rule_id):
    mapa = {
        "STATUS_THANK_YOU_FROM_POST_MEETING_MESSAGE": 10,
        "STATUS_MEETING_DONE_FROM_MINUTE": 20,
        "STATUS_MEETING_DONE_FROM_PAST_EVENT": 30,
        "STATUS_SCHEDULED_FROM_FUTURE_EVENT": 40,
        "STATUS_CONTACTED_FROM_OUTBOUND_MESSAGE": 50,
    }
    return mapa.get(str(rule_id or "").strip(), 999)

def elegir_sugerencia_estado_preferente(sugerencias):
    if not sugerencias:
        return None
    return sorted(
        sugerencias,
        key=lambda item: (
            prioridad_regla_estado_networking(item.get("rule_id", "")),
            -nivel_estado_networking(item.get("estado_sugerido", "")),
        )
    )[0]

def estados_todo_cerrados():
    return ["Completado", "Descartado", "Reemplazado", "Obsoleto", "Auto-completado", "Error"]

def tipo_config_para_todo(row):
    tipo = str(row.get("Tipo_ToDo", "")).strip()
    if tipo == "NETWORKING_STATUS_CHANGE":
        evidencia = parse_json_seguro(row.get("Evidencia_JSON", {}), {})
        sugerido = parse_json_seguro(row.get("Estado_Sugerido_JSON", {}), {})
        return tipo_config_para_regla_estado_networking(
            evidencia.get("regla", ""),
            sugerido.get("Estado_CRM", "")
        )
    return tipo

def fila_config_todo(df_config, tipo_config):
    if df_config is None or df_config.empty or "Tipo_ToDo" not in df_config.columns:
        return {}
    tipo_config = str(tipo_config or "").strip()
    match = df_config[df_config["Tipo_ToDo"].astype(str).str.strip() == tipo_config]
    if match.empty:
        return {}
    return match.iloc[0].to_dict()

def modo_ejecucion_todo(df_config, tipo_config):
    fila = fila_config_todo(df_config, tipo_config)
    return str(fila.get("Modo_Ejecucion", "Preguntar") or "Preguntar").strip()

def etiqueta_modo_todo(modo):
    return {
        "Preguntar": "Pedir confirmacion siempre",
        "Automatico": "Ejecutar sin consultar",
        "Desactivado": "No volver a sugerir",
    }.get(str(modo or "").strip(), "Pedir confirmacion siempre")

def modo_desde_etiqueta_todo(etiqueta):
    return {
        "Pedir confirmacion siempre": "Preguntar",
        "Ejecutar sin consultar": "Automatico",
        "No volver a sugerir": "Desactivado",
    }.get(str(etiqueta or "").strip(), "Preguntar")

def texto_ejemplo_config_todo(tipo_todo):
    ejemplos = {
        "RULE_STATUS_TO_CONTACTED": 'Cambia el estado de Ana P. de Pendiente a Contactado.',
        "RULE_STATUS_TO_SCHEDULED": 'Cambia el estado de Ana P. de Contactado a Agendado.',
        "RULE_STATUS_TO_MEETING_DONE": 'Cambia el estado de Ana P. de Agendado a Cita concretada.',
        "RULE_STATUS_TO_THANK_YOU": 'Cambia el estado de Ana P. de Cita concretada a Agradecimiento enviado.',
        "CONTACT_ADD_EMAIL": "Sugiere agregar un correo nuevo a Ana P.",
        "CALENDAR_ACTION": "Sugiere revisar o crear una cita con Ana P.",
        "FOLLOW_UP_REMINDER": "Sugiere retomar contacto con Ana P.",
        "HH_DOMAIN_REVIEW": "Sugiere revisar si Ana P. o su empresa son headhunter.",
        "DATA_CONFLICT_REVIEW": "Sugiere revisar un dato que no calza entre fuentes.",
        "SYNC_REVIEW": "Sugiere revisar un cambio detectado al sincronizar.",
        "FOCUS_CHANGE": "Sugiere cambiar si Ana P. esta en foco de networking.",
        "CONTACT_UPDATE_FIELD": "Sugiere actualizar un dato de Ana P.",
        "CONTACT_MERGE_REVIEW": "Sugiere fusionar o consolidar contactos duplicados.",
        "CONTACT_CREATE": "Sugiere crear un contacto mencionado en una minuta.",
        "EMAIL_DRAFT": "Sugiere preparar un correo para Ana P.",
        "WHATSAPP_MESSAGE": "Sugiere abrir WhatsApp con un mensaje para Ana P.",
        "REFERRAL_REVIEW": "Sugiere revisar un referido mencionado por Ana P.",
    }
    tipo_todo = str(tipo_todo or "").strip()
    return ejemplos.get(tipo_todo, tipos_todos_ia().get(tipo_todo, tipo_todo.replace("_", " ").title()))

def nombre_config_todo_usuario(tipo_todo):
    nombres = {
        "RULE_STATUS_TO_CONTACTED": "Cambiar estado a Contactado",
        "RULE_STATUS_TO_SCHEDULED": "Cambiar estado a Agendado",
        "RULE_STATUS_TO_MEETING_DONE": "Cambiar estado a Cita concretada",
        "RULE_STATUS_TO_THANK_YOU": "Cambiar estado a Agradecimiento enviado",
        "CONTACT_ADD_EMAIL": "Agregar correo a contacto",
        "CALENDAR_ACTION": "Crear o revisar cita",
        "FOLLOW_UP_REMINDER": "Retomar contacto",
        "HH_DOMAIN_REVIEW": "Revisar empresa headhunter",
        "DATA_CONFLICT_REVIEW": "Resolver dato inconsistente",
        "SYNC_REVIEW": "Revisar cambio de sincronizacion",
        "FOCUS_CHANGE": "Cambiar foco de networking",
        "CONTACT_UPDATE_FIELD": "Actualizar dato de contacto",
        "CONTACT_MERGE_REVIEW": "Fusionar o consolidar contacto",
        "CONTACT_CREATE": "Crear contacto sugerido",
        "EMAIL_DRAFT": "Preparar correo",
        "WHATSAPP_MESSAGE": "Preparar WhatsApp",
        "REFERRAL_REVIEW": "Revisar referido",
    }
    tipo_todo = str(tipo_todo or "").strip()
    return nombres.get(tipo_todo, tipos_todos_ia().get(tipo_todo, tipo_todo.replace("_", " ").title()))

def condicion_config_todo_usuario(tipo_todo):
    condiciones = {
        "RULE_STATUS_TO_CONTACTED": "cuando existe un correo o mensaje saliente hacia el contacto",
        "RULE_STATUS_TO_SCHEDULED": "cuando existe una cita futura con el contacto",
        "RULE_STATUS_TO_MEETING_DONE": "cuando existe una cita cuya fecha ya paso",
        "RULE_STATUS_TO_THANK_YOU": "cuando hay un correo o mensaje posterior a una cita concretada",
        "CONTACT_ADD_EMAIL": "cuando aparece un correo nuevo que parece pertenecer al contacto",
        "CALENDAR_ACTION": "cuando falta crear, revisar o confirmar una cita",
        "FOLLOW_UP_REMINDER": "cuando el contacto lleva demasiado tiempo sin interaccion",
        "HH_DOMAIN_REVIEW": "cuando hay datos para revisar marca o empresa headhunter",
        "DATA_CONFLICT_REVIEW": "cuando un dato no calza entre fuentes",
        "SYNC_REVIEW": "cuando una sincronizacion detecta cambios relevantes",
        "FOCUS_CHANGE": "cuando el historial sugiere cambiar el foco de networking",
        "CONTACT_UPDATE_FIELD": "cuando una fuente sugiere actualizar datos del contacto",
        "CONTACT_MERGE_REVIEW": "cuando hay posibles duplicados o cambios de ID",
        "CONTACT_CREATE": "cuando una minuta o referido menciona a alguien no creado",
        "EMAIL_DRAFT": "cuando conviene preparar un correo de seguimiento",
        "WHATSAPP_MESSAGE": "cuando conviene abrir WhatsApp con un mensaje sugerido",
        "REFERRAL_REVIEW": "cuando aparece un referido pendiente de revisar",
    }
    tipo_todo = str(tipo_todo or "").strip()
    return condiciones.get(tipo_todo, "cuando se cumpla la regla asociada")

def complejidad_config_todo_usuario(motor):
    return {
        "RULE": "Regla simple",
        "HYBRID": "Regla + revision",
        "AI": "IA",
    }.get(str(motor or "").strip().upper(), "Regla simple")

def ordenar_config_todos(df_config):
    if df_config is None or df_config.empty:
        return df_config
    df = df_config.copy()
    orden_tipo = {
        "RULE_STATUS_TO_CONTACTED": 10,
        "RULE_STATUS_TO_SCHEDULED": 20,
        "RULE_STATUS_TO_MEETING_DONE": 30,
        "RULE_STATUS_TO_THANK_YOU": 40,
        "CONTACT_ADD_EMAIL": 50,
        "CALENDAR_ACTION": 60,
        "FOLLOW_UP_REMINDER": 70,
        "HH_DOMAIN_REVIEW": 80,
        "DATA_CONFLICT_REVIEW": 90,
        "SYNC_REVIEW": 100,
        "FOCUS_CHANGE": 110,
        "CONTACT_UPDATE_FIELD": 120,
        "CONTACT_MERGE_REVIEW": 130,
        "CONTACT_CREATE": 140,
        "EMAIL_DRAFT": 150,
        "WHATSAPP_MESSAGE": 160,
        "REFERRAL_REVIEW": 170,
    }
    df["__orden_motor"] = df["Motor_Tipo"].apply(orden_motor_todo)
    df["__orden_accion"] = df["Tipo_ToDo"].apply(orden_accion_todo)
    df["__orden_tipo"] = df["Tipo_ToDo"].astype(str).str.strip().map(orden_tipo).fillna(999)
    df["__descripcion_sort"] = df["Descripcion"].fillna("").astype(str).str.lower()
    df = df.sort_values(
        ["__orden_motor", "__orden_accion", "__orden_tipo", "__descripcion_sort"],
        ascending=[True, True, True, True]
    )
    return df.drop(columns=["__orden_motor", "__orden_accion", "__orden_tipo", "__descripcion_sort"])

def columnas_todo_config():
    return [
        "Tipo_ToDo", "Descripcion", "Motor_Tipo", "Modo_Ejecucion",
        "Permite_Auto_Aplicar", "Requiere_Confirmacion", "Fuentes_Requeridas",
        "Ventana_Dias", "Criterio_Dedupe", "Actualizado_En"
    ]

def columnas_object_review_state():
    return [
        "Processor_ID", "Objeto_Tipo", "Objeto_ID", "Objeto_Updated_At",
        "Reviewed_At", "Input_Hash", "Output_Hash", "Todo_IDs_Generados",
        "Estado_Revision", "Error", "Notas"
    ]

def asegurar_hoja_simple(creds, titulo, rango_header, columnas):
    service = build('sheets', 'v4', credentials=creds)
    metadata = service.spreadsheets().get(
        spreadsheetId=ID_PLANILLA,
        fields="sheets.properties.title"
    ).execute()
    titulos = [s["properties"]["title"] for s in metadata.get("sheets", [])]
    if titulo not in titulos:
        service.spreadsheets().batchUpdate(
            spreadsheetId=ID_PLANILLA,
            body={"requests": [{"addSheet": {"properties": {"title": titulo}}}]}
        ).execute()
        service.spreadsheets().values().update(
            spreadsheetId=ID_PLANILLA,
            range=rango_header,
            valueInputOption="USER_ENTERED",
            body={"values": [columnas]}
        ).execute()
    return service

def leer_todo_config(creds):
    from datetime import datetime
    columnas = columnas_todo_config()
    defaults = pd.DataFrame(catalogo_automatizaciones_todo())
    defaults["Actualizado_En"] = ""
    try:
        service = asegurar_hoja_simple(creds, "CRM_ToDo_Config", "CRM_ToDo_Config!A1:J1", columnas)
        result = service.spreadsheets().values().get(
            spreadsheetId=ID_PLANILLA,
            range="CRM_ToDo_Config!A:J"
        ).execute()
        rows = result.get("values", [])
        if not rows or len(rows) < 2:
            guardar_todo_config(creds, defaults[columnas])
            return defaults[columnas]

        headers = [str(col).strip() for col in rows[0]]
        data = rows[1:]
        data_alineada = [(fila + [""] * (len(headers) - len(fila)))[:len(headers)] for fila in data]
        df = pd.DataFrame(data_alineada, columns=headers)
        for col in columnas:
            if col not in df.columns:
                df[col] = ""

        tipos_existentes = set(df["Tipo_ToDo"].astype(str).str.strip())
        faltantes = defaults[~defaults["Tipo_ToDo"].isin(tipos_existentes)]
        if not faltantes.empty:
            df = pd.concat([df[columnas], faltantes[columnas]], ignore_index=True)
            df["Actualizado_En"] = df["Actualizado_En"].replace("", datetime.now().strftime("%d/%m/%Y %H:%M:%S"))
            guardar_todo_config(creds, df[columnas])
        return df[columnas]
    except Exception:
        return defaults[columnas]

def guardar_todo_config(creds, df_config):
    from datetime import datetime
    columnas = columnas_todo_config()
    service = asegurar_hoja_simple(creds, "CRM_ToDo_Config", "CRM_ToDo_Config!A1:J1", columnas)
    df_guardar = df_config.copy()
    for col in columnas:
        if col not in df_guardar.columns:
            df_guardar[col] = ""
    df_guardar = df_guardar[columnas].fillna("")
    df_guardar["Actualizado_En"] = df_guardar["Actualizado_En"].replace("", datetime.now().strftime("%d/%m/%Y %H:%M:%S"))
    filas = [columnas] + df_guardar.values.tolist()
    service.spreadsheets().values().clear(
        spreadsheetId=ID_PLANILLA,
        range="CRM_ToDo_Config!A:J"
    ).execute()
    service.spreadsheets().values().update(
        spreadsheetId=ID_PLANILLA,
        range="CRM_ToDo_Config!A:J",
        valueInputOption="USER_ENTERED",
        body={"values": filas}
    ).execute()

def leer_object_review_state(creds):
    columnas = columnas_object_review_state()
    try:
        service = asegurar_hoja_simple(creds, "CRM_Object_Review_State", "CRM_Object_Review_State!A1:K1", columnas)
        result = service.spreadsheets().values().get(
            spreadsheetId=ID_PLANILLA,
            range="CRM_Object_Review_State!A:K"
        ).execute()
        rows = result.get("values", [])
        if not rows or len(rows) < 2:
            return pd.DataFrame(columns=columnas)
        headers = [str(col).strip() for col in rows[0]]
        data = rows[1:]
        data_alineada = [(fila + [""] * (len(headers) - len(fila)))[:len(headers)] for fila in data]
        df = pd.DataFrame(data_alineada, columns=headers)
        for col in columnas:
            if col not in df.columns:
                df[col] = ""
        return df[columnas]
    except Exception:
        return pd.DataFrame(columns=columnas)

def guardar_object_review_state(creds, df_state):
    columnas = columnas_object_review_state()
    service = asegurar_hoja_simple(creds, "CRM_Object_Review_State", "CRM_Object_Review_State!A1:K1", columnas)
    df_guardar = df_state.copy()
    for col in columnas:
        if col not in df_guardar.columns:
            df_guardar[col] = ""
    df_guardar = df_guardar[columnas].fillna("")
    filas = [columnas] + df_guardar.values.tolist()
    service.spreadsheets().values().clear(
        spreadsheetId=ID_PLANILLA,
        range="CRM_Object_Review_State!A:K"
    ).execute()
    service.spreadsheets().values().update(
        spreadsheetId=ID_PLANILLA,
        range="CRM_Object_Review_State!A:K",
        valueInputOption="USER_ENTERED",
        body={"values": filas}
    ).execute()

def estados_networking_oficiales():
    return ["Pendiente", "Contactado", "Agendado", "Cita concretada", "Agradecimiento enviado"]

def columnas_fechas_crm_legacy():
    return [
        "F_Pendiente", "F_Promesa_Cafe", "F_Propuesta_Cita", "F_Cita_Creada",
        "F_Cita_Concretada", "F_Agradecimiento", "F_Propone_Lead",
        "F_Nuevo_Lead_Contactado"
    ]

def estado_por_columna_fecha_legacy():
    return {
        "F_Pendiente": "Pendiente",
        "F_Promesa_Cafe": "Contactado",
        "F_Propuesta_Cita": "Contactado",
        "F_Cita_Creada": "Agendado",
        "F_Cita_Concretada": "Cita concretada",
        "F_Agradecimiento": "Agradecimiento enviado",
        "F_Propone_Lead": "Contactado",
        "F_Nuevo_Lead_Contactado": "Contactado",
    }

def columna_fecha_para_estado_networking(estado):
    estado_norm = normalizar_estado_networking(estado)
    return {
        "Pendiente": "F_Pendiente",
        "Contactado": "F_Propuesta_Cita",
        "Agendado": "F_Cita_Creada",
        "Cita concretada": "F_Cita_Concretada",
        "Agradecimiento enviado": "F_Agradecimiento",
    }.get(estado_norm, "F_Pendiente")

def parse_fecha_hito_crm(valor):
    texto = str(valor or "").strip()
    if not texto:
        return pd.NaT
    return pd.to_datetime(texto, format="%d/%m/%y", errors="coerce")

def calcular_estado_networking_desde_row(row):
    ultima_fecha = pd.NaT
    estado_ganador = ""
    for col, estado in estado_por_columna_fecha_legacy().items():
        fecha = parse_fecha_hito_crm(row.get(col, ""))
        if pd.notna(fecha) and (pd.isna(ultima_fecha) or fecha >= ultima_fecha):
            ultima_fecha = fecha
            estado_ganador = estado
    if estado_ganador:
        return estado_ganador
    return normalizar_estado_networking(row.get("Estado_CRM", "Pendiente"))

def normalizar_estado_networking(valor):
    texto = str(valor or "").strip().lower()
    equivalencias = {
        "": "Pendiente",
        "1. pendiente": "Pendiente",
        "pendiente": "Pendiente",
        "fuera de scope": "Pendiente",
        "fuera de foco": "Pendiente",
        "2. promesa conversa/café": "Contactado",
        "2. promesa conversa/cafe": "Contactado",
        "3. propuesta de cita": "Contactado",
        "contactado": "Contactado",
        "4. cita creada": "Agendado",
        "agendado": "Agendado",
        "5. cita concretada": "Cita concretada",
        "cita concretada": "Cita concretada",
        "6. agradecimiento enviado": "Agradecimiento enviado",
        "agradecimiento enviado": "Agradecimiento enviado",
        "7. propone nuevo lead": "Contactado",
        "8. nuevo lead contactado": "Contactado",
    }
    return equivalencias.get(texto, str(valor or "Pendiente").strip())

def nivel_estado_networking(estado):
    oficiales = estados_networking_oficiales()
    estado_norm = normalizar_estado_networking(estado)
    return oficiales.index(estado_norm) if estado_norm in oficiales else 0

def marca_estado_networking(estado):
    estado_norm = normalizar_estado_networking(estado)
    marcas = {
        "Pendiente": "🟥",
        "Contactado": "🟧",
        "Agendado": "🟩",
        "Cita concretada": "🟦",
        "Agradecimiento enviado": "🔷",
    }
    return f"{marcas.get(estado_norm, '⬜')} {estado_norm}"

def es_interaccion_saliente(row):
    rol = str(row.get("Rol_Email", "")).strip().upper()
    tipo = str(row.get("Tipo", "")).strip().lower()
    if tipo not in ["email", "mensaje", "whatsapp"]:
        return False
    if rol in ["TO", "CC", "BCC", "MANUAL"]:
        return True
    if rol:
        return False
    de_hacia = str(row.get("De_Hacia_Contacto", "")).strip()
    de_hacia_lower = de_hacia.lower()
    return (
        de_hacia.upper().startswith(("TO:", "CC:", "BCC:")) or
        "sergiohudson@gmail.com" in de_hacia_lower or
        "sergio hudson" in de_hacia_lower or
        "usuario app" in de_hacia_lower
    )

def parse_fecha_interaccion(valor):
    return pd.to_datetime(valor, format="%d/%m/%Y", errors="coerce")

def inicio_semana_lunes(fecha):
    fecha_ts = pd.Timestamp(fecha).normalize()
    return fecha_ts - pd.Timedelta(days=int(fecha_ts.weekday()))

def semanas_kpi(hoy, semanas=4):
    inicio_actual = inicio_semana_lunes(hoy)
    return [inicio_actual - pd.Timedelta(weeks=i) for i in range(semanas, -1, -1)]

def etiqueta_semana(inicio):
    return pd.Timestamp(inicio).strftime("%d/%m")

def inicio_mes(fecha):
    fecha_ts = pd.Timestamp(fecha).normalize()
    return pd.Timestamp(year=fecha_ts.year, month=fecha_ts.month, day=1)

def parse_fecha_inicio_networking(valor):
    fecha = pd.to_datetime(valor, format="%d/%m/%Y", errors="coerce")
    if pd.isna(fecha):
        fecha = pd.to_datetime(valor, dayfirst=True, errors="coerce")
    return fecha.normalize() if pd.notna(fecha) else pd.NaT

def periodos_kpi(hoy, modo, fecha_inicio_networking=None, max_periodos=12):
    max_periodos = max(1, int(max_periodos or 12))
    fecha_inicio = parse_fecha_inicio_networking(fecha_inicio_networking)
    if modo == "Mensual":
        inicio_actual = inicio_mes(hoy)
        inicio_minimo = inicio_actual - pd.DateOffset(months=max_periodos - 1)
        if pd.notna(fecha_inicio):
            inicio_minimo = max(inicio_minimo, inicio_mes(fecha_inicio))
        periodos = []
        cursor = inicio_minimo
        while cursor <= inicio_actual and len(periodos) < max_periodos:
            periodos.append(pd.Timestamp(cursor))
            cursor = cursor + pd.DateOffset(months=1)
        if not periodos:
            periodos = [inicio_actual]
        return periodos, "mes"

    inicio_actual = inicio_semana_lunes(hoy)
    inicio_minimo = inicio_actual - pd.Timedelta(weeks=max_periodos - 1)
    if pd.notna(fecha_inicio):
        inicio_minimo = max(inicio_minimo, inicio_semana_lunes(fecha_inicio))
    periodos = []
    cursor = inicio_minimo
    while cursor <= inicio_actual and len(periodos) < max_periodos:
        periodos.append(pd.Timestamp(cursor))
        cursor = cursor + pd.Timedelta(weeks=1)
    if not periodos:
        periodos = [inicio_actual]
    return periodos, "semana"

def fin_periodo_kpi(inicio, granularidad):
    inicio_ts = pd.Timestamp(inicio)
    if granularidad == "mes":
        return inicio_ts + pd.DateOffset(months=1)
    return inicio_ts + pd.Timedelta(days=7)

def etiqueta_periodo_kpi(inicio, granularidad):
    inicio_ts = pd.Timestamp(inicio)
    if granularidad == "mes":
        meses = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"]
        return f"{meses[inicio_ts.month - 1]} {inicio_ts.strftime('%y')}"
    return inicio_ts.strftime("%d/%m")

def preparar_interacciones_con_fecha(df_interacciones):
    df = df_interacciones.copy() if df_interacciones is not None else pd.DataFrame()
    for col in columnas_interacciones():
        if col not in df.columns:
            df[col] = ""
    if df.empty:
        df["Fecha_DT"] = pd.NaT
        return df
    df["Google_ID"] = df["Google_ID"].astype(str).str.strip()
    df["Fecha_DT"] = pd.to_datetime(df.get("Fecha", ""), format="%d/%m/%Y", errors="coerce")
    df["Tipo"] = df["Tipo"].fillna("").astype(str).str.strip()
    return df

def serie_interacciones_periodos(df_interacciones, periodos, tipos, contactos_unicos=False, solo_salientes=False, granularidad="semana"):
    df = preparar_interacciones_con_fecha(df_interacciones)
    if df.empty:
        df = pd.DataFrame(columns=["Google_ID", "Fecha_DT", "Tipo", "Rol_Email"])
    tipos_norm = {str(t).strip().lower() for t in tipos}
    df = df[df["Tipo"].astype(str).str.strip().str.lower().isin(tipos_norm)].copy()
    if solo_salientes and not df.empty:
        df = df[df.apply(es_interaccion_saliente, axis=1)].copy()
    valores = []
    for inicio in periodos:
        fin = fin_periodo_kpi(inicio, granularidad)
        df_periodo = df[(df["Fecha_DT"] >= inicio) & (df["Fecha_DT"] < fin)].copy()
        if contactos_unicos:
            valor = int(df_periodo["Google_ID"].astype(str).str.strip().replace("", pd.NA).dropna().nunique())
        else:
            valor = int(len(df_periodo))
        valores.append(valor)
    return valores

def filtrar_interacciones_salientes_contacto(df_interacciones):
    df = preparar_interacciones_con_fecha(df_interacciones)
    if df.empty:
        return pd.DataFrame(columns=["Google_ID", "Fecha_DT", "Tipo", "Rol_Email", "Email_Asociado"])
    tipos_contacto = {"email", "mensaje", "whatsapp"}
    df = df[df["Tipo"].astype(str).str.strip().str.lower().isin(tipos_contacto)].copy()
    if df.empty:
        return df
    df = df[df.apply(es_interaccion_saliente, axis=1)].copy()
    df["Google_ID"] = df["Google_ID"].astype(str).str.strip()
    df = df[(df["Google_ID"] != "") & df["Fecha_DT"].notna()].copy()
    return df

def acumulado_interacciones_hasta(df_interacciones, tipos, hasta, solo_salientes=False):
    df = preparar_interacciones_con_fecha(df_interacciones)
    if df.empty:
        return 0
    tipos_norm = {str(t).strip().lower() for t in tipos}
    df = df[df["Tipo"].astype(str).str.strip().str.lower().isin(tipos_norm)].copy()
    if solo_salientes and not df.empty:
        df = df[df.apply(es_interaccion_saliente, axis=1)].copy()
    fin = pd.Timestamp(hasta).normalize() + pd.Timedelta(days=1)
    return int((df["Fecha_DT"].notna() & (df["Fecha_DT"] < fin)).sum())

def serie_contactos_realizados_periodos(df_interacciones, periodos, granularidad="semana", hasta=None):
    df = filtrar_interacciones_salientes_contacto(df_interacciones)
    if df.empty:
        return [0 for _ in periodos], [0 for _ in periodos], 0
    primeras = df.sort_values("Fecha_DT").groupby("Google_ID", as_index=False).first()[["Google_ID", "Fecha_DT"]]
    valores_total = []
    valores_primera_vez = []
    for inicio in periodos:
        fin = fin_periodo_kpi(inicio, granularidad)
        df_periodo = df[(df["Fecha_DT"] >= inicio) & (df["Fecha_DT"] < fin)].copy()
        primeras_periodo = primeras[(primeras["Fecha_DT"] >= inicio) & (primeras["Fecha_DT"] < fin)]
        valores_total.append(int(df_periodo["Google_ID"].nunique()))
        valores_primera_vez.append(int(primeras_periodo["Google_ID"].nunique()))
    if hasta is None:
        hasta = pd.Timestamp.now().normalize()
    fin_acum = pd.Timestamp(hasta).normalize() + pd.Timedelta(days=1)
    acumulado = int(df[df["Fecha_DT"] < fin_acum]["Google_ID"].nunique())
    return valores_total, valores_primera_vez, acumulado

def serie_dominios_hh_realizados_periodos(df_interacciones, df_hh_scope, periodos, granularidad="semana", hasta=None):
    if df_hh_scope is None or df_hh_scope.empty:
        return [0 for _ in periodos], [0 for _ in periodos], 0
    df = filtrar_interacciones_salientes_contacto(df_interacciones)
    if df.empty:
        return [0 for _ in periodos], [0 for _ in periodos], 0

    dominios_por_contacto = {}
    for _, contacto in df_hh_scope.iterrows():
        google_id = str(contacto.get("Google_ID", "")).strip()
        if not google_id:
            continue
        dominios_por_contacto[google_id] = listar_dominios_headhunter(contacto)

    df = df[df["Google_ID"].isin(dominios_por_contacto.keys())].copy()
    if df.empty:
        return [0 for _ in periodos], [0 for _ in periodos], 0

    def dominios_interaccion(row):
        dominios_email = extraer_dominios_desde_emails(row.get("Email_Asociado", ""))
        dominios = [d.strip().lower() for d in dominios_email.split(";") if d.strip()]
        if not dominios:
            dominios = dominios_por_contacto.get(str(row.get("Google_ID", "")).strip(), [])
        return [d for d in dominios if d and d != "no email"]

    df["__Dominios_HH"] = df.apply(dominios_interaccion, axis=1)
    df = df.explode("__Dominios_HH")
    df["__Dominios_HH"] = df["__Dominios_HH"].fillna("").astype(str).str.strip().str.lower()
    df = df[df["__Dominios_HH"] != ""].copy()
    primeras = (
        df.sort_values("Fecha_DT")
        .groupby("__Dominios_HH", as_index=False)
        .first()[["__Dominios_HH", "Fecha_DT"]]
    )
    valores = []
    valores_primera_vez = []
    for inicio in periodos:
        fin = fin_periodo_kpi(inicio, granularidad)
        df_periodo = df[(df["Fecha_DT"] >= inicio) & (df["Fecha_DT"] < fin)].copy()
        primeras_periodo = primeras[(primeras["Fecha_DT"] >= inicio) & (primeras["Fecha_DT"] < fin)]
        valores.append(int(df_periodo["__Dominios_HH"].nunique()))
        valores_primera_vez.append(int(primeras_periodo["__Dominios_HH"].nunique()))
    if hasta is None:
        hasta = pd.Timestamp.now().normalize()
    fin_acum = pd.Timestamp(hasta).normalize() + pd.Timedelta(days=1)
    acumulado = int(df[df["Fecha_DT"] < fin_acum]["__Dominios_HH"].nunique())
    return valores, valores_primera_vez, acumulado

def serie_interacciones_semanales(df_interacciones, semanas, tipos, contactos_unicos=False, solo_salientes=False):
    return serie_interacciones_periodos(
        df_interacciones,
        semanas,
        tipos,
        contactos_unicos=contactos_unicos,
        solo_salientes=solo_salientes,
        granularidad="semana"
    )

def fecha_minima_hitos(row, columnas):
    fechas = [parse_fecha_hito_crm(row.get(col, "")) for col in columnas]
    fechas = [f for f in fechas if pd.notna(f)]
    return min(fechas) if fechas else pd.NaT

def serie_acumulado_estados_avanzados(df_contactos, periodos, granularidad="semana"):
    df = df_contactos.copy() if df_contactos is not None else pd.DataFrame()
    for col in columnas_fechas_crm_legacy() + ["Estado_CRM", "Scope_Networking", "Estado_Contacto"]:
        if col not in df.columns:
            df[col] = ""
    if df.empty:
        return [0 for _ in semanas]
    df["Estado_CRM"] = df.apply(calcular_estado_networking_desde_row, axis=1)
    df["__fecha_avance"] = df.apply(lambda row: fecha_minima_hitos(row, ["F_Cita_Concretada", "F_Agradecimiento"]), axis=1)
    df = df[
        (df["Scope_Networking"].astype(str).str.strip().str.upper() == "TRUE") &
        (df["Estado_Contacto"].astype(str).str.strip() != "Desactivado")
    ].copy()
    valores = []
    for inicio in periodos:
        fin = fin_periodo_kpi(inicio, granularidad)
        valores.append(int((df["__fecha_avance"].notna() & (df["__fecha_avance"] < fin)).sum()))
    return valores

def serie_dominios_hh_sin_contacto(df_hh_scope, df_interacciones, periodos, dias_umbral=60, granularidad="semana"):
    if df_hh_scope is None or df_hh_scope.empty:
        return [0 for _ in periodos]
    df_int = preparar_interacciones_con_fecha(df_interacciones)
    dominios_contactos = {}
    for _, contacto in df_hh_scope.iterrows():
        google_id = str(contacto.get("Google_ID", "")).strip()
        for dominio in listar_dominios_headhunter(contacto):
            dominios_contactos.setdefault(dominio, set()).add(google_id)
    valores = []
    for inicio in periodos:
        fin = fin_periodo_kpi(inicio, granularidad)
        contador = 0
        for dominio, ids_contactos in dominios_contactos.items():
            df_dom = df_int[
                df_int["Google_ID"].astype(str).str.strip().isin(ids_contactos) &
                (df_int["Fecha_DT"] < fin)
            ].copy()
            if df_dom.empty:
                continue
            ultima = df_dom["Fecha_DT"].max()
            if pd.notna(ultima) and int((fin - pd.Timedelta(days=1) - ultima).days) > dias_umbral:
                contador += 1
        valores.append(contador)
    return valores

def formatear_pct_cambio(valor_actual, valor_base):
    valor_actual = int(valor_actual or 0)
    valor_base = int(valor_base or 0)
    if valor_base == 0:
        pct = 0 if valor_actual == 0 else 100
    else:
        pct = round(((valor_actual - valor_base) / valor_base) * 100)
    signo = "+" if pct > 0 else ""
    return f"{signo}{pct}%"

def render_kpi_periodo(titulo, valores, periodos, granularidad="semana", tooltip="", acumulado=None, barras=None, barras_titulo="Primera vez"):
    import altair as alt

    serie = pd.DataFrame({
        "Periodo": [etiqueta_periodo_kpi(s, granularidad) for s in periodos],
        "Valor": valores,
    })
    if barras is not None:
        serie["Barra"] = barras
        serie["Barra_Label"] = [str(int(v)) if int(v or 0) > 0 else "" for v in barras]
    valor_actual = int(valores[-1]) if valores else 0
    valor_semana_pasada = int(valores[-2]) if len(valores) >= 2 else 0
    cambio_semana = valor_actual - valor_semana_pasada
    pct_semana = formatear_pct_cambio(valor_actual, valor_semana_pasada)
    signo_sem = "+" if cambio_semana >= 0 else ""
    texto_comparacion = "vs mes pasado" if granularidad == "mes" else "vs sem. pasada"

    title_attr = str(tooltip or "").replace('"', "&quot;")
    st.markdown(f"<div title=\"{title_attr}\" style='font-weight:700;color:#1f2937'>{titulo}</div>", unsafe_allow_html=True)
    valor_principal = f"Acum: {int(acumulado)}" if acumulado is not None else str(valor_actual)
    st.markdown(
        (
            "<div style='font-size:1.65rem;font-weight:760;line-height:1.1'>"
            f"{valor_principal}"
            "</div>"
        ),
        unsafe_allow_html=True,
    )

    angulo_etiquetas = -35 if granularidad == "mes" else 0
    base = alt.Chart(serie).encode(
        x=alt.X("Periodo:N", title=None, sort=None, axis=alt.Axis(labelAngle=angulo_etiquetas, labelColor="#667085")),
        y=alt.Y(
            "Valor:Q",
            title=None,
            axis=alt.Axis(labels=False, ticks=False, domain=False),
            scale=alt.Scale(domainMin=0),
        ),
    )
    capas = []
    if barras is not None:
        barras_chart = base.mark_bar(color="#cbd5e1", opacity=0.75, size=18).encode(
            y=alt.Y("Barra:Q", title=None, axis=alt.Axis(labels=False, ticks=False, domain=False), scale=alt.Scale(domainMin=0)),
            tooltip=[
                alt.Tooltip("Periodo:N", title="Periodo"),
                alt.Tooltip("Barra:Q", title=barras_titulo, format=".0f"),
                alt.Tooltip("Valor:Q", title="Total", format=".0f"),
            ],
        )
        etiquetas_barra = base.mark_text(
            dy=12,
            color="#64748b",
            fontSize=10,
            fontStyle="italic",
            fontWeight=500,
        ).encode(
            y=alt.Y("Barra:Q", title=None),
            text=alt.Text("Barra_Label:N"),
        )
        capas.extend([barras_chart, etiquetas_barra])
    linea = base.mark_line(color="#475569", strokeWidth=2.5, point={"filled": True, "size": 55})
    etiquetas = base.mark_text(dy=-10, color="#334155", fontSize=11, fontWeight=600).encode(
        text=alt.Text("Valor:Q", format=".0f")
    )
    capas.extend([linea, etiquetas])
    st.altair_chart(alt.layer(*capas).properties(height=115), use_container_width=True)
    if barras is not None:
        st.markdown(
            """
            <div style="display:flex;gap:12px;align-items:center;margin-top:-8px;margin-bottom:2px;font-size:.72rem;color:#64748b">
                <span><span style="display:inline-block;width:18px;height:2px;background:#475569;vertical-align:middle;margin-right:5px"></span>Línea: totales</span>
                <span><span style="display:inline-block;width:10px;height:10px;background:#cbd5e1;vertical-align:middle;margin-right:5px"></span>Barras: primer contacto</span>
            </div>
            """,
            unsafe_allow_html=True,
        )
    st.caption(f"{texto_comparacion}: {signo_sem}{cambio_semana} ({pct_semana})")

def render_kpi_semanal(titulo, valores, semanas):
    return render_kpi_periodo(titulo, valores[-4:], semanas[-4:], granularidad="semana")

def hash_texto_corto(texto):
    import hashlib
    return hashlib.sha256(str(texto).encode("utf-8", errors="ignore")).hexdigest()[:16]

def thread_ids_desde_evidencia(df_interacciones, evidencia_ids):
    if df_interacciones is None or df_interacciones.empty or "Thread_ID" not in df_interacciones.columns:
        return []
    evidencia_set = {str(x).strip() for x in evidencia_ids if str(x).strip()}
    if not evidencia_set or "ID_Entrada" not in df_interacciones.columns:
        return []
    df_match = df_interacciones[
        df_interacciones["ID_Entrada"].astype(str).str.strip().isin(evidencia_set)
    ].copy()
    if df_match.empty:
        return []
    return sorted({
        str(x).strip()
        for x in df_match["Thread_ID"].fillna("").astype(str)
        if str(x).strip()
    })

def dedup_key_recomendacion_por_thread(tipo_todo, rule_id, google_id, accion_key, thread_ids):
    threads = sorted({str(x).strip() for x in thread_ids if str(x).strip()})
    scope = f"THREADS:{hash_texto_corto(';'.join(threads))}" if threads else "NO_THREAD"
    return f"{tipo_todo}|{rule_id}|{google_id}|{accion_key}|{scope}"

def acciones_todo_estado_json(google_id, estado_sugerido):
    import json
    return json.dumps([
        {"id": "abrir_contacto", "label": "Ver contacto", "kind": "internal_link", "href": f"/?view=contacto&google_id={google_id}"},
        {"id": "aplicar_estado", "label": "Aplicar cambio", "kind": "app_action", "operation": "update_contact_status", "estado_sugerido": estado_sugerido},
        {"id": "descartar", "label": "Descartar", "kind": "app_action", "operation": "dismiss_todo"}
    ], ensure_ascii=False)

def construir_todo_estado_networking(contacto, estado_actual, estado_sugerido, motivo, evidencia_ids, rule_id, thread_ids=None):
    import json
    from datetime import datetime
    google_id = str(contacto.get("Google_ID", "")).strip()
    nombre = str(contacto.get("Nombre_Visual", "")).strip() or google_id
    dedup_key = f"NETWORKING_STATUS_CHANGE|{rule_id}|{google_id}|{estado_sugerido}"
    thread_ids = sorted({str(x).strip() for x in (thread_ids or []) if str(x).strip()})
    ahora = datetime.now().strftime("%d/%m/%Y %H:%M:%S")
    return {
        "Todo_ID": f"TODO_{hash_texto_corto(dedup_key)}",
        "Fecha_Creacion": ahora,
        "Fecha_Actualizacion": ahora,
        "Estado_ToDo": "Pendiente",
        "Tipo_ToDo": "NETWORKING_STATUS_CHANGE",
        "Prioridad": "Media",
        "Origen": "RULE",
        "Confianza": "85",
        "Objeto_Tipo": "Contacto",
        "Objeto_ID": google_id,
        "Objeto_Label": nombre,
        "Cambio_Tipo": "Estado networking",
        "Estado_Actual_JSON": json.dumps({"Estado_CRM": estado_actual}, ensure_ascii=False),
        "Estado_Sugerido_JSON": json.dumps({"Estado_CRM": estado_sugerido}, ensure_ascii=False),
        "Evidencia_JSON": json.dumps({"regla": rule_id, "motivo": motivo, "interacciones": evidencia_ids, "gmail_threads": thread_ids}, ensure_ascii=False),
        "Acciones_JSON": acciones_todo_estado_json(google_id, estado_sugerido),
        "Dedup_Key": dedup_key,
        "Notas": motivo,
    }

def sugerir_estado_networking_para_contacto(contacto, df_interacciones_contacto, hoy):
    estado_actual = normalizar_estado_networking(contacto.get("Estado_CRM", "Pendiente"))
    nivel_actual = nivel_estado_networking(estado_actual)
    if df_interacciones_contacto.empty:
        return None
    sugerencias = []

    df_int = df_interacciones_contacto.copy()
    df_int["Fecha_DT"] = df_int["Fecha"].apply(parse_fecha_interaccion)
    df_int = df_int.dropna(subset=["Fecha_DT"]).copy()
    if df_int.empty:
        return None

    df_citas = df_int[df_int["Tipo"].astype(str).str.strip().str.lower().isin(["cita", "reunión", "reunion"])].copy()
    df_salientes = df_int[df_int.apply(es_interaccion_saliente, axis=1)].copy()

    if nivel_actual >= nivel_estado_networking("Cita concretada") and nivel_actual < nivel_estado_networking("Agradecimiento enviado"):
        citas_pasadas = df_citas[df_citas["Fecha_DT"].dt.date <= hoy.date()].copy()
        if not citas_pasadas.empty and not df_salientes.empty:
            ultima_cita = citas_pasadas.sort_values("Fecha_DT", ascending=False).iloc[0]
            salientes_post_cita = df_salientes[df_salientes["Fecha_DT"] >= ultima_cita["Fecha_DT"]].copy()
            if not salientes_post_cita.empty:
                evidencia = [str(ultima_cita.get("ID_Entrada", "")).strip()] + salientes_post_cita["ID_Entrada"].astype(str).str.strip().head(3).tolist()
                sugerencias.append({
                    "rule_id": "STATUS_THANK_YOU_FROM_POST_MEETING_MESSAGE",
                    "estado_actual": estado_actual,
                    "estado_sugerido": "Agradecimiento enviado",
                    "motivo": "Hay mensaje o correo saliente posterior a una cita ya concretada.",
                    "evidencia_ids": [x for x in evidencia if x],
                })

    citas_pasadas = df_citas[df_citas["Fecha_DT"].dt.date <= hoy.date()].copy()
    if nivel_actual < nivel_estado_networking("Cita concretada") and not citas_pasadas.empty:
        if "Notas_Usuario_Crudo" not in citas_pasadas.columns:
            citas_pasadas["Notas_Usuario_Crudo"] = ""
        citas_con_minuta = citas_pasadas[
            ~citas_pasadas["Notas_Usuario_Crudo"]
            .fillna("")
            .astype(str)
            .str.strip()
            .str.lower()
            .isin(["", "null", "nan"])
        ].copy()
        if not citas_con_minuta.empty:
            evidencia = citas_con_minuta.sort_values("Fecha_DT", ascending=False)["ID_Entrada"].astype(str).str.strip().head(3).tolist()
            sugerencias.append({
                "rule_id": "STATUS_MEETING_DONE_FROM_MINUTE",
                "estado_actual": estado_actual,
                "estado_sugerido": "Cita concretada",
                "motivo": "Existe una minuta cargada en una cita pasada.",
                "evidencia_ids": [x for x in evidencia if x],
            })

    if nivel_actual < nivel_estado_networking("Cita concretada") and not citas_pasadas.empty:
        evidencia = citas_pasadas.sort_values("Fecha_DT", ascending=False)["ID_Entrada"].astype(str).str.strip().head(3).tolist()
        sugerencias.append({
            "rule_id": "STATUS_MEETING_DONE_FROM_PAST_EVENT",
            "estado_actual": estado_actual,
            "estado_sugerido": "Cita concretada",
            "motivo": "Existe una cita en calendario cuya fecha ya paso.",
            "evidencia_ids": [x for x in evidencia if x],
        })

    citas_futuras = df_citas[df_citas["Fecha_DT"].dt.date > hoy.date()].copy()
    if nivel_actual < nivel_estado_networking("Agendado") and not citas_futuras.empty:
        evidencia = citas_futuras.sort_values("Fecha_DT", ascending=True)["ID_Entrada"].astype(str).str.strip().head(3).tolist()
        sugerencias.append({
            "rule_id": "STATUS_SCHEDULED_FROM_FUTURE_EVENT",
            "estado_actual": estado_actual,
            "estado_sugerido": "Agendado",
            "motivo": "Existe una cita futura en calendario.",
            "evidencia_ids": [x for x in evidencia if x],
        })

    if nivel_actual < nivel_estado_networking("Contactado") and not df_salientes.empty:
        evidencia = df_salientes.sort_values("Fecha_DT", ascending=False)["ID_Entrada"].astype(str).str.strip().head(3).tolist()
        sugerencias.append({
            "rule_id": "STATUS_CONTACTED_FROM_OUTBOUND_MESSAGE",
            "estado_actual": estado_actual,
            "estado_sugerido": "Contactado",
            "motivo": "Existe correo o mensaje saliente hacia el contacto.",
            "evidencia_ids": [x for x in evidencia if x],
        })

    return elegir_sugerencia_estado_preferente(sugerencias)

def aplicar_todos_estado_networking_automaticos(creds, todos_estado, etiqueta_sync="Estado CRM autoaplicado", nota_accion="Aplicado automaticamente por configuracion."):
    if not todos_estado:
        return 0
    from datetime import datetime
    df_maestro = leer_sheet_local(creds)
    if df_maestro.empty or "Google_ID" not in df_maestro.columns:
        return 0

    columnas_fechas = columnas_fechas_crm_legacy()
    for col in ["Google_ID", "Estado_CRM", "Estado_Sync"] + columnas_fechas:
        if col not in df_maestro.columns:
            df_maestro[col] = ""

    ahora_detalle = datetime.now().strftime("%d/%m/%y %H:%M:%S")
    fecha_hito = datetime.now().strftime("%d/%m/%y")
    aplicados = 0
    for todo in todos_estado:
        google_id = str(todo.get("Objeto_ID", "")).strip()
        sugerido = parse_json_seguro(todo.get("Estado_Sugerido_JSON", {}), {})
        estado_sugerido = normalizar_estado_networking(sugerido.get("Estado_CRM", ""))
        if not google_id or estado_sugerido not in estados_networking_oficiales():
            continue

        condicion = df_maestro["Google_ID"].astype(str).str.strip() == google_id
        if not condicion.any():
            continue

        columna_hito = columna_fecha_para_estado_networking(estado_sugerido)
        if columna_hito not in df_maestro.columns:
            df_maestro[columna_hito] = ""
        df_maestro.loc[condicion, "Estado_CRM"] = estado_sugerido
        df_maestro.loc[condicion, columna_hito] = fecha_hito
        df_maestro.loc[condicion, "Estado_Sync"] = f"{etiqueta_sync} - {ahora_detalle}"
        todo["Estado_ToDo"] = "Completado"
        todo["Fecha_Actualizacion"] = datetime.now().strftime("%d/%m/%Y %H:%M:%S")
        nota_previa = str(todo.get("Notas", "")).strip()
        todo["Notas"] = f"{nota_previa} | {nota_accion}" if nota_previa else nota_accion
        aplicados += 1

    if aplicados:
        guardar_en_sheet(creds, df_maestro)
    return aplicados

def ejecutar_todos_seleccionados_coach(creds, seleccionados):
    if not seleccionados:
        return {"aplicados": 0, "no_soportados": 0, "mensaje": "No hay sugerencias seleccionadas."}

    todos = []
    for row in seleccionados:
        if hasattr(row, "to_dict"):
            todos.append(row.to_dict())
        else:
            todos.append(dict(row))

    soportados = [
        todo for todo in todos
        if str(todo.get("Tipo_ToDo", "")).strip() == "NETWORKING_STATUS_CHANGE"
    ]
    no_soportados = len(todos) - len(soportados)
    if not soportados:
        return {
            "aplicados": 0,
            "no_soportados": no_soportados,
            "mensaje": "Por ahora solo puedo ejecutar cambios de estado de networking."
        }

    aplicados = aplicar_todos_estado_networking_automaticos(
        creds,
        soportados,
        etiqueta_sync="Estado CRM actualizado desde Coach IA",
        nota_accion="Aplicado manualmente desde Coach IA."
    )

    completados = [todo for todo in soportados if str(todo.get("Estado_ToDo", "")).strip() == "Completado"]
    if completados:
        df_todos = leer_todos_ia(creds)
        columnas = columnas_todos_ia()
        for col in columnas:
            if col not in df_todos.columns:
                df_todos[col] = ""
        for todo in completados:
            todo_id = str(todo.get("Todo_ID", "")).strip()
            if not todo_id:
                continue
            condicion = df_todos["Todo_ID"].astype(str).str.strip() == todo_id
            if not condicion.any():
                continue
            for col in ["Estado_ToDo", "Fecha_Actualizacion", "Notas"]:
                df_todos.loc[condicion, col] = str(todo.get(col, "")).strip()
        guardar_todos_ia(creds, df_todos[columnas])

    mensaje = f"Sugerencias ejecutadas: {aplicados}."
    if no_soportados:
        mensaje += f" Omitidas por no tener ejecucion implementada: {no_soportados}."
    return {"aplicados": aplicados, "no_soportados": no_soportados, "mensaje": mensaje}

def generar_todos_estado_networking(creds, df_contactos, df_interacciones):
    if df_contactos.empty or df_interacciones.empty:
        return {"creados": 0, "omitidos": 0, "mensaje": "Sin contactos o interacciones para revisar."}

    df_config = leer_todo_config(creds)

    df_todos = leer_todos_ia(creds)
    columnas = columnas_todos_ia()
    for col in columnas:
        if col not in df_todos.columns:
            df_todos[col] = ""

    dedup_abiertos = set(
        df_todos[
            ~df_todos["Estado_ToDo"].astype(str).str.strip().isin(estados_todo_cerrados())
        ]["Dedup_Key"].astype(str).str.strip()
    )
    df_todos_abiertos = df_todos[
        ~df_todos["Estado_ToDo"].astype(str).str.strip().isin(estados_todo_cerrados())
    ].copy()
    estado_abiertos = {}
    if not df_todos_abiertos.empty:
        for idx_todo_abierto, todo_abierto in df_todos_abiertos.iterrows():
            sugerido_abierto = parse_json_seguro(todo_abierto.get("Estado_Sugerido_JSON", {}), {})
            evidencia_abierta = parse_json_seguro(todo_abierto.get("Evidencia_JSON", {}), {})
            estado_sugerido_abierto = normalizar_estado_networking(sugerido_abierto.get("Estado_CRM", ""))
            objeto_id_abierto = str(todo_abierto.get("Objeto_ID", "")).strip()
            if objeto_id_abierto and estado_sugerido_abierto:
                estado_key_abierto = (objeto_id_abierto, estado_sugerido_abierto)
                prioridad_abierta = prioridad_regla_estado_networking(evidencia_abierta.get("regla", ""))
                existente = estado_abiertos.get(estado_key_abierto)
                if existente is None or prioridad_abierta < existente["prioridad"]:
                    estado_abiertos[estado_key_abierto] = {
                        "idx": idx_todo_abierto,
                        "prioridad": prioridad_abierta,
                    }

    hoy = pd.Timestamp.today().normalize()
    df_contactos_work = df_contactos.copy()
    for col in ["Google_ID", "Nombre_Visual", "Estado_CRM", "Scope_Networking", "Estado_Contacto"]:
        if col not in df_contactos_work.columns:
            df_contactos_work[col] = ""
    df_contactos_work = df_contactos_work[
        (df_contactos_work["Scope_Networking"].astype(str).str.strip().str.upper() == "TRUE") &
        (df_contactos_work["Estado_Contacto"].astype(str).str.strip() != "Desactivado")
    ].copy()

    df_interacciones_work = df_interacciones.copy()
    for col in columnas_interacciones():
        if col not in df_interacciones_work.columns:
            df_interacciones_work[col] = ""
    df_interacciones_work["Google_ID"] = df_interacciones_work["Google_ID"].astype(str).str.strip()

    nuevos = []
    automaticos = []
    omitidos = 0
    actualizados = 0
    for _, contacto in df_contactos_work.iterrows():
        google_id = str(contacto.get("Google_ID", "")).strip()
        if not google_id:
            continue
        df_int_contacto = df_interacciones_work[df_interacciones_work["Google_ID"] == google_id].copy()
        sugerencia = sugerir_estado_networking_para_contacto(contacto, df_int_contacto, hoy)
        if not sugerencia:
            continue
        tipo_config = tipo_config_para_regla_estado_networking(
            sugerencia.get("rule_id", ""),
            sugerencia.get("estado_sugerido", "")
        )
        modo_config = modo_ejecucion_todo(df_config, tipo_config)
        if modo_config == "Desactivado":
            omitidos += 1
            continue
        todo = construir_todo_estado_networking(
            contacto,
            sugerencia["estado_actual"],
            sugerencia["estado_sugerido"],
            sugerencia["motivo"],
            sugerencia["evidencia_ids"],
            sugerencia["rule_id"],
            thread_ids_desde_evidencia(df_interacciones_work, sugerencia["evidencia_ids"]),
        )
        if todo["Dedup_Key"] in dedup_abiertos:
            omitidos += 1
            continue
        estado_key = (str(todo.get("Objeto_ID", "")).strip(), sugerencia["estado_sugerido"])
        if estado_key in estado_abiertos:
            prioridad_nueva = prioridad_regla_estado_networking(sugerencia.get("rule_id", ""))
            existente = estado_abiertos[estado_key]
            if prioridad_nueva < existente["prioridad"]:
                idx_existente = existente["idx"]
                if modo_config == "Automatico":
                    df_todos.loc[idx_existente, "Estado_ToDo"] = "Reemplazado"
                    automaticos.append(todo)
                else:
                    for col in columnas:
                        df_todos.loc[idx_existente, col] = str(todo.get(col, "")).strip()
                estado_abiertos[estado_key] = {
                    "idx": idx_existente,
                    "prioridad": prioridad_nueva,
                }
                dedup_abiertos.add(todo["Dedup_Key"])
                actualizados += 1
            else:
                omitidos += 1
            continue
        if modo_config == "Automatico":
            automaticos.append(todo)
        else:
            nuevos.append(todo)
        dedup_abiertos.add(todo["Dedup_Key"])
        estado_abiertos[estado_key] = {
            "idx": None,
            "prioridad": prioridad_regla_estado_networking(sugerencia.get("rule_id", "")),
        }

    auto_aplicados = aplicar_todos_estado_networking_automaticos(creds, automaticos)
    if automaticos:
        nuevos.extend(automaticos)

    if nuevos:
        df_todos = pd.concat([df_todos[columnas], pd.DataFrame(nuevos)[columnas]], ignore_index=True)
    if nuevos or actualizados:
        guardar_todos_ia(creds, df_todos)

    return {
        "creados": len([t for t in nuevos if str(t.get("Estado_ToDo", "")).strip() != "Completado"]),
        "actualizados": actualizados,
        "auto_aplicados": auto_aplicados,
        "omitidos": omitidos,
        "mensaje": "Revision de estados completada."
    }

def asegurar_hoja_todos_ia(creds):
    service = build('sheets', 'v4', credentials=creds)
    metadata = service.spreadsheets().get(
        spreadsheetId=ID_PLANILLA,
        fields="sheets.properties.title"
    ).execute()
    titulos = [s["properties"]["title"] for s in metadata.get("sheets", [])]
    if "CRM_ToDos" not in titulos:
        service.spreadsheets().batchUpdate(
            spreadsheetId=ID_PLANILLA,
            body={"requests": [{"addSheet": {"properties": {"title": "CRM_ToDos"}}}]}
        ).execute()
        service.spreadsheets().values().update(
            spreadsheetId=ID_PLANILLA,
            range="CRM_ToDos!A1:R1",
            valueInputOption="USER_ENTERED",
            body={"values": [columnas_todos_ia()]}
        ).execute()
    return service

def leer_todos_ia(creds):
    columnas = columnas_todos_ia()
    try:
        service = asegurar_hoja_todos_ia(creds)
        result = service.spreadsheets().values().get(
            spreadsheetId=ID_PLANILLA,
            range="CRM_ToDos!A:R"
        ).execute()
        rows = result.get("values", [])
        if not rows or len(rows) < 2:
            return pd.DataFrame(columns=columnas)
        headers = [str(col).strip() for col in rows[0]]
        data = rows[1:]
        data_alineada = [(fila + [""] * (len(headers) - len(fila)))[:len(headers)] for fila in data]
        df = pd.DataFrame(data_alineada, columns=headers)
        for col in columnas:
            if col not in df.columns:
                df[col] = ""
        return df[columnas]
    except Exception:
        return pd.DataFrame(columns=columnas)

def guardar_todos_ia(creds, df_todos):
    service = asegurar_hoja_todos_ia(creds)
    columnas = columnas_todos_ia()
    df_guardar = df_todos.copy()
    for col in columnas:
        if col not in df_guardar.columns:
            df_guardar[col] = ""
    df_guardar = df_guardar[columnas].fillna("")
    filas = [columnas] + df_guardar.values.tolist()
    service.spreadsheets().values().clear(
        spreadsheetId=ID_PLANILLA,
        range="CRM_ToDos!A:R"
    ).execute()
    service.spreadsheets().values().update(
        spreadsheetId=ID_PLANILLA,
        range="CRM_ToDos!A:R",
        valueInputOption="USER_ENTERED",
        body={"values": filas}
    ).execute()

def reiniciar_recomendaciones_ia(creds):
    df_todos_actual = leer_todos_ia(creds)
    df_state_actual = leer_object_review_state(creds)
    total_todos = len(df_todos_actual)
    total_state = len(df_state_actual)
    guardar_todos_ia(creds, pd.DataFrame(columns=columnas_todos_ia()))
    guardar_object_review_state(creds, pd.DataFrame(columns=columnas_object_review_state()))
    return {"todos": total_todos, "revisiones": total_state}

@st.dialog("Configurar automatizaciones", width="large")
def popup_configurar_automatizaciones_todo(creds):
    st.caption("Elige que comentarios puede hacer el Coach y cuando debe actuar solo.")
    try:
        df_config = leer_todo_config(creds)
    except Exception as e:
        st.error("No pude cargar la configuración de automatizaciones.")
        with st.expander("Detalle técnico", expanded=False):
            st.code(str(e), language="text")
        return

    df_config = ordenar_config_todos(df_config).reset_index(drop=True)
    df_visible = df_config[
        df_config["Tipo_ToDo"].astype(str).str.strip() != "NETWORKING_STATUS_CHANGE"
    ].copy()
    df_editor = pd.DataFrame({
        "Tipo_ToDo": df_visible["Tipo_ToDo"].astype(str).str.strip(),
        "Sugerencia": df_visible["Tipo_ToDo"].apply(nombre_config_todo_usuario),
        "Que_Hacer": df_visible["Modo_Ejecucion"].apply(etiqueta_modo_todo),
        "Comentario": df_visible["Tipo_ToDo"].apply(texto_ejemplo_config_todo),
        "Cuando_Aparece": df_visible["Tipo_ToDo"].apply(condicion_config_todo_usuario),
        "Complejidad": df_visible["Motor_Tipo"].apply(complejidad_config_todo_usuario),
    })

    opciones_modo = [
        "Pedir confirmacion siempre",
        "Ejecutar sin consultar",
        "No volver a sugerir",
    ]

    df_editado = st.data_editor(
        df_editor,
        column_config={
            "Tipo_ToDo": None,
            "Sugerencia": st.column_config.TextColumn("Regla", disabled=True, width="medium"),
            "Que_Hacer": st.column_config.SelectboxColumn("Qué hacer", options=opciones_modo),
            "Comentario": st.column_config.TextColumn("Ejemplo", disabled=True, width="medium"),
            "Cuando_Aparece": st.column_config.TextColumn("Cuándo aparece", disabled=True, width="medium"),
            "Complejidad": st.column_config.TextColumn("Tipo", disabled=True, width="small"),
        },
        disabled=["Tipo_ToDo", "Sugerencia", "Comentario", "Cuando_Aparece", "Complejidad"],
        use_container_width=True,
        hide_index=True,
        height=430,
        key="editor_config_todos_ia"
    )

    st.caption("Las reglas simples pueden ejecutarse solas. Las sugerencias con IA quedan preparadas para futuras versiones y, por seguridad, pueden pedir confirmacion.")

    c_guardar, c_cerrar, _ = st.columns([1.2, 1.0, 5.8], gap="small")
    with c_guardar:
        if st.button("Guardar", type="primary", use_container_width=True, key="btn_guardar_config_todos_ia"):
            try:
                df_guardar = df_config.copy()
                advertencias = []
                for _, fila_editada in df_editado.iterrows():
                    tipo_todo = str(fila_editada.get("Tipo_ToDo", "")).strip()
                    modo = modo_desde_etiqueta_todo(fila_editada.get("Que_Hacer", ""))
                    condicion = df_guardar["Tipo_ToDo"].astype(str).str.strip() == tipo_todo
                    if not condicion.any():
                        continue
                    permite_auto = str(df_guardar.loc[condicion, "Permite_Auto_Aplicar"].iloc[0]).strip().upper() == "TRUE"
                    if modo == "Automatico" and not permite_auto:
                        modo = "Preguntar"
                        advertencias.append(texto_ejemplo_config_todo(tipo_todo))
                    df_guardar.loc[condicion, "Modo_Ejecucion"] = modo
                    df_guardar.loc[condicion, "Requiere_Confirmacion"] = "FALSE" if modo == "Automatico" else "TRUE"
                guardar_todo_config(creds, df_guardar)
                if advertencias:
                    st.warning("Algunas sugerencias no permiten ejecucion automatica completa todavia, asi que quedaron con confirmacion.")
                st.success("Configuración guardada.")
                st.rerun()
            except Exception as e:
                st.error("No pude guardar la configuración.")
                with st.expander("Detalle técnico", expanded=False):
                    st.code(str(e), language="text")
    with c_cerrar:
        if st.button("Cerrar", use_container_width=True, key="btn_cerrar_config_todos_ia"):
            st.rerun()

    with st.expander("Opciones avanzadas", expanded=False):
        st.caption("Reiniciar sugerencias limpia los pendientes actuales y el registro de revisión. No toca contactos, interacciones, notas ni configuración.")
        confirmar_reset = st.checkbox(
            "Confirmo que quiero reiniciar las sugerencias",
            key="chk_confirm_reiniciar_recomendaciones_ia"
        )
        if st.button(
            "Reiniciar sugerencias",
            key="btn_confirm_reiniciar_recomendaciones_ia",
            type="secondary",
            use_container_width=False,
            disabled=not confirmar_reset
        ):
            try:
                resumen = reiniciar_recomendaciones_ia(creds)
                st.success(f"Reinicio listo. Sugerencias limpiadas: {resumen['todos']} | Revisiones limpiadas: {resumen['revisiones']}.")
                st.rerun()
            except Exception as e:
                st.error("No pude reiniciar las sugerencias.")
                with st.expander("Detalle técnico", expanded=False):
                    st.code(str(e), language="text")

def parse_json_seguro(valor, default=None):
    import json
    try:
        if str(valor or "").strip() == "":
            return default if default is not None else {}
        return json.loads(str(valor))
    except Exception:
        return default if default is not None else {}

def texto_sugerencia_todo(row):
    actual = parse_json_seguro(row.get("Estado_Actual_JSON", {}), {})
    sugerido = parse_json_seguro(row.get("Estado_Sugerido_JSON", {}), {})
    estado_actual = str(actual.get("Estado_CRM", "")).strip()
    estado_sugerido = str(sugerido.get("Estado_CRM", "")).strip()
    if estado_actual or estado_sugerido:
        return f"Cambiar estado de {marca_estado_networking(estado_actual) if estado_actual else 'sin estado'} a {marca_estado_networking(estado_sugerido) if estado_sugerido else 'sin estado'}"
    cambio = str(row.get("Cambio_Tipo", "")).strip()
    return cambio or "Revisar recomendacion"

def texto_motivo_todo(row):
    evidencia = parse_json_seguro(row.get("Evidencia_JSON", {}), {})
    return str(evidencia.get("motivo", "") or row.get("Notas", "") or "").strip()

def texto_evidencia_todo(row, df_interacciones=None):
    evidencia = parse_json_seguro(row.get("Evidencia_JSON", {}), {})
    ids = [str(x).strip() for x in evidencia.get("interacciones", []) if str(x).strip()]
    if not ids:
        return ""
    if df_interacciones is None or df_interacciones.empty or "ID_Entrada" not in df_interacciones.columns:
        return f"{len(ids)} interaccion(es)"
    df_int = df_interacciones.copy()
    df_int["ID_Entrada"] = df_int["ID_Entrada"].astype(str).str.strip()
    muestras = []
    for _, fila in df_int[df_int["ID_Entrada"].isin(ids)].head(2).iterrows():
        fecha = str(fila.get("Fecha", "")).strip()
        tipo = str(fila.get("Tipo", "")).strip()
        asunto = str(fila.get("Asunto_Titulo", "")).strip()
        partes = [p for p in [tipo, fecha, asunto] if p]
        if partes:
            muestras.append(" · ".join(partes))
    if muestras:
        sufijo = f" +{len(ids) - len(muestras)}" if len(ids) > len(muestras) else ""
        return " | ".join(muestras) + sufijo
    return f"{len(ids)} interaccion(es)"

def html_escape(valor):
    import html
    return html.escape(str(valor or "").strip())

def badge_estado_networking_html(estado):
    estado_norm = normalizar_estado_networking(estado)
    clases = {
        "Pendiente": "pendiente",
        "Contactado": "contactado",
        "Agendado": "agendado",
        "Cita concretada": "cita",
        "Agradecimiento enviado": "agradecimiento",
    }
    clase = clases.get(estado_norm, "neutro")
    return f'<span class="coach-state coach-state-{clase}">{html_escape(estado_norm)}</span>'

def motor_todo_desde_row(row):
    motor = str(row.get("Origen", "") or row.get("Motor_Tipo", "")).strip().upper()
    if motor in ["RULE", "HYBRID", "AI"]:
        return motor
    tipo = str(row.get("Tipo_ToDo", "")).strip()
    for item in catalogo_automatizaciones_todo():
        if item.get("Tipo_ToDo") == tipo:
            return str(item.get("Motor_Tipo", "RULE")).strip().upper()
    return "RULE"

def texto_motor_todo(motor):
    return {
        "RULE": "Regla",
        "HYBRID": "Hibrida",
        "AI": "IA",
    }.get(str(motor or "").upper(), "Regla")

def nombre_contacto_corto(nombre):
    partes = [p.strip() for p in str(nombre or "").split() if p.strip()]
    if not partes:
        return "Contacto"
    if len(partes) == 1:
        return partes[0]
    return f"{partes[0]} {partes[1][0]}."

def fecha_todo_corta(valor):
    fecha = pd.to_datetime(str(valor or "").strip(), errors="coerce", dayfirst=True)
    if pd.notna(fecha):
        return fecha.strftime("%d/%m")
    texto = str(valor or "").strip()
    return texto[:5] if len(texto) > 5 else texto

def detalle_todo_natural(row, df_interacciones=None):
    from datetime import datetime
    motivo = texto_motivo_todo(row)
    evidencia = parse_json_seguro(row.get("Evidencia_JSON", {}), {})
    rule_id = str(evidencia.get("regla", "") or "").strip()
    ids = [str(x).strip() for x in evidencia.get("interacciones", []) if str(x).strip()]
    if df_interacciones is None or df_interacciones.empty or not ids or "ID_Entrada" not in df_interacciones.columns:
        return motivo or str(row.get("Notas", "") or "").strip()

    df_int = df_interacciones.copy()
    df_int["ID_Entrada"] = df_int["ID_Entrada"].astype(str).str.strip()
    df_match = df_int[df_int["ID_Entrada"].isin(ids)].copy()
    if df_match.empty:
        return motivo

    df_match["Fecha_DT"] = pd.to_datetime(df_match.get("Fecha", ""), format="%d/%m/%Y", errors="coerce")
    df_match = df_match.sort_values("Fecha_DT", ascending=False, na_position="last")
    interaccion = df_match.iloc[0]
    tipo = str(interaccion.get("Tipo", "") or "interaccion").strip().lower()
    asunto = str(interaccion.get("Asunto_Titulo", "") or "").strip()
    fecha_dt = interaccion.get("Fecha_DT", pd.NaT)
    dias_txt = ""
    if pd.notna(fecha_dt):
        dias = max((pd.Timestamp(datetime.now().date()) - pd.Timestamp(fecha_dt).normalize()).days, 0)
        dias_txt = f" hace {dias} dia{'s' if dias != 1 else ''}"
    asunto_txt = f' "{asunto}"' if asunto else ""
    if rule_id == "STATUS_MEETING_DONE_FROM_MINUTE":
        return f"La cita{asunto_txt} ya tiene minuta{dias_txt}."
    if rule_id == "STATUS_MEETING_DONE_FROM_PAST_EVENT":
        return f"La cita{asunto_txt} paso{dias_txt}."
    if rule_id == "STATUS_CONTACTED_FROM_OUTBOUND_MESSAGE":
        tipo_contacto = "mensaje" if tipo in ["mensaje", "whatsapp"] else tipo
        return f"Se comunicaron por {tipo_contacto}{dias_txt}."
    base = f"Detecte {tipo}{asunto_txt}{dias_txt}."
    if motivo:
        return f"{base} {motivo}"
    return base

def render_coach_mascota(nombre="", size="normal"):
    nombre_label = html_escape(nombre)
    size_class = "coach-floating-bot-mini" if size == "mini" else "coach-floating-bot-normal"
    nombre_html = f'<div class="coach-bot-name">{nombre_label}</div>' if nombre_label else ""
    st.markdown(
        f"""
        <div class="coach-floating-bot {size_class}" aria-label="Asistente virtual del Coach IA">
            <div class="coach-bot">
                <div class="coach-bot-antenna"></div>
                <div class="coach-bot-head">
                    <div class="coach-bot-eye"></div>
                    <div class="coach-bot-eye"></div>
                    <div class="coach-bot-mouth"></div>
                </div>
                <div class="coach-bot-neck"></div>
                <div class="coach-bot-body">
                    <div class="coach-bot-panel">
                        <span>C</span><span>o</span><span>a</span><span>c</span><span>h</span>
                    </div>
                </div>
            </div>
            {nombre_html}
        </div>
        """,
        unsafe_allow_html=True
    )

def html_linea_todo(row, df_interacciones=None, compact=False):
    from urllib.parse import quote
    contacto_completo = str(row.get("Objeto_Label", "") or "Contacto sin nombre").strip()
    contacto_corto = nombre_contacto_corto(contacto_completo)
    contacto_responsivo = (
        f'<strong class="coach-contact-short">{html_escape(contacto_corto)}</strong>'
        f'<strong class="coach-contact-full">{html_escape(contacto_completo)}</strong>'
    )
    google_id = str(row.get("Objeto_ID", "")).strip()
    ficha = f"/?view=contacto&google_id={quote(google_id, safe='')}" if google_id else ""
    actual = parse_json_seguro(row.get("Estado_Actual_JSON", {}), {})
    sugerido = parse_json_seguro(row.get("Estado_Sugerido_JSON", {}), {})
    evidencia_json = parse_json_seguro(row.get("Evidencia_JSON", {}), {})
    estado_actual = str(actual.get("Estado_CRM", "")).strip()
    estado_sugerido = str(sugerido.get("Estado_CRM", "")).strip()
    detalle = detalle_todo_natural(row, df_interacciones)
    fecha = fecha_todo_corta(row.get("Fecha_Creacion", ""))
    tipo = str(row.get("Tipo_ToDo", "")).strip()
    tipo_desc = tipos_todos_ia().get(tipo, tipo.replace("_", " ").title() if tipo else "Sugerencia")

    if estado_actual or estado_sugerido:
        estado_actual_html = badge_estado_networking_html(estado_actual) if estado_actual else '<span class="coach-muted">sin estado</span>'
        estado_sugerido_html = badge_estado_networking_html(estado_sugerido) if estado_sugerido else '<span class="coach-muted">sin estado</span>'
        resumen = (
            f"Cambia el estado de {contacto_responsivo} de "
            f"{estado_actual_html} "
            f"a {estado_sugerido_html}."
        )
    else:
        cambio = str(row.get("Cambio_Tipo", "")).strip() or "revisar esta accion"
        resumen = f"Revisa {html_escape(cambio).lower()} para {contacto_responsivo}."

    contacto_html = (
        f'<a href="{html_escape(ficha)}" target="_blank" class="coach-contact-link">Ir a {html_escape(contacto_corto)}</a>'
        if ficha else f'<span class="coach-contact-link">Ir a {html_escape(contacto_corto)}</span>'
    )
    acciones_html = [contacto_html]
    regla = str(evidencia_json.get("regla", "") or "").strip()
    evidencia_ids = [str(x).strip() for x in evidencia_json.get("interacciones", []) if str(x).strip()]
    if ficha and regla == "STATUS_MEETING_DONE_FROM_PAST_EVENT" and evidencia_ids:
        id_cita = evidencia_ids[0]
        href_minuta = (
            f"{ficha}&expand_historial=1"
            f"&edit_interaccion={quote(id_cita, safe='')}"
        )
        acciones_html.append(
            f'<a href="{html_escape(href_minuta)}" target="_blank" class="coach-contact-link">Agregar minuta</a>'
        )

    clase_compacta = " compact" if compact else ""
    return f"""
    <details class="coach-message{clase_compacta}">
        <summary>
            <span class="coach-message-date">{html_escape(fecha)}</span>
            <span class="coach-message-text">{resumen}</span>
        </summary>
        <div class="coach-message-detail">
            <div>{html_escape(detalle or tipo_desc)}</div>
            <div class="coach-message-actions">{"".join(acciones_html)}</div>
        </div>
    </details>
    """


def preparar_todos_pendientes_para_vista(df_todos, contacto_id=None):
    if df_todos is None or df_todos.empty or "Estado_ToDo" not in df_todos.columns:
        return pd.DataFrame()

    df_pendientes = df_todos[df_todos["Estado_ToDo"].astype(str).str.strip().isin(["", "Pendiente"])].copy()
    if contacto_id and "Objeto_ID" in df_pendientes.columns:
        df_pendientes = df_pendientes[
            df_pendientes["Objeto_ID"].astype(str).str.strip() == str(contacto_id).strip()
        ].copy()
    if df_pendientes.empty:
        return df_pendientes

    df_pendientes["__fecha_sort"] = pd.to_datetime(df_pendientes["Fecha_Creacion"], errors="coerce", dayfirst=True)
    df_pendientes["__motor"] = df_pendientes.apply(motor_todo_desde_row, axis=1)
    return df_pendientes.sort_values(["__fecha_sort", "Prioridad"], ascending=[True, False]).drop(columns=["__fecha_sort"])


def render_coach_mensajes(df_todos_vista, df_interacciones=None, key_prefix="coach", selectable=False, max_items=None, height=216, compact=False):
    seleccionados = []
    if df_todos_vista is None or df_todos_vista.empty:
        st.caption("Sin sugerencias abiertas.")
        return seleccionados

    df_render = df_todos_vista.head(max_items).copy() if max_items else df_todos_vista.copy()
    with st.container(height=height, border=False):
        for idx_todo, (_, row) in enumerate(df_render.iterrows()):
            todo_id = str(row.get("Todo_ID", "")).strip() or f"{key_prefix}_{idx_todo}"
            if selectable:
                c_check, c_linea = st.columns([0.045, 0.955], gap="small")
                with c_check:
                    marcado = st.checkbox(
                        "Seleccionar",
                        key=f"chk_todo_card_{key_prefix}_{hash_texto_corto(todo_id)}",
                        label_visibility="collapsed"
                    )
                with c_linea:
                    st.markdown(html_linea_todo(row, df_interacciones, compact=compact), unsafe_allow_html=True)
                if marcado:
                    seleccionados.append(row)
            else:
                st.markdown(html_linea_todo(row, df_interacciones, compact=compact), unsafe_allow_html=True)
    return seleccionados

@st.fragment
def render_panel_todos_ia(creds, df_todos, df_contactos=None, df_interacciones=None):
    total_abiertos = 0
    if df_todos is not None and not df_todos.empty and "Estado_ToDo" in df_todos.columns:
        total_abiertos = len(df_todos[df_todos["Estado_ToDo"].astype(str).str.strip().isin(["", "Pendiente"])])

    seleccionados = []
    c_robot, c_chat = st.columns([0.82, 5.18], gap="small")
    with c_robot:
        render_coach_mascota()
        c_buscar, c_config = st.columns(2, gap="small")
        with c_buscar:
            if st.button(" ", icon=":material/auto_awesome:", key="btn_generar_todos_estado_networking", help="Buscar sugerencias", use_container_width=True, type="primary"):
                if df_contactos is None or df_interacciones is None:
                    st.warning("Faltan datos para revisar sugerencias.")
                else:
                    with st.spinner("Revisando reglas programables..."):
                        resultado = generar_todos_estado_networking(creds, df_contactos, df_interacciones)
                    auto_aplicados = int(resultado.get("auto_aplicados", 0) or 0)
                    actualizados = int(resultado.get("actualizados", 0) or 0)
                    extra_auto = f" | Autoaplicados: {auto_aplicados}" if auto_aplicados else ""
                    extra_actualizados = f" | Actualizados: {actualizados}" if actualizados else ""
                    st.success(f"{resultado['mensaje']} Creados: {resultado['creados']} | Omitidos: {resultado['omitidos']}{extra_actualizados}{extra_auto}")
                    st.rerun()
        with c_config:
            if st.button(" ", icon=":material/settings:", key="btn_configurar_todos_ia", help="Configurar automatizaciones", use_container_width=True, type="secondary"):
                popup_configurar_automatizaciones_todo(creds)
    with c_chat:
        df_pendientes = preparar_todos_pendientes_para_vista(df_todos)
        if df_todos is None or df_todos.empty:
            st.info("Aun no hay pendientes IA.")
            return

        if df_pendientes.empty:
            st.success("No hay pendientes IA abiertos.")
            return

        tabs = st.tabs([
            f"Reglas ({len(df_pendientes[df_pendientes['__motor'] == 'RULE'])})",
            f"Hibridas ({len(df_pendientes[df_pendientes['__motor'] == 'HYBRID'])})",
            f"IA ({len(df_pendientes[df_pendientes['__motor'] == 'AI'])})",
        ])
        for tab, motor in zip(tabs, ["RULE", "HYBRID", "AI"]):
            with tab:
                df_motor = df_pendientes[df_pendientes["__motor"] == motor].copy()
                if df_motor.empty:
                    st.caption("Sin comentarios abiertos en esta categoria.")
                    continue
                seleccionados.extend(
                    render_coach_mensajes(
                        df_motor,
                        df_interacciones,
                        key_prefix=f"dash_{motor}",
                        selectable=True,
                        height=216
                    )
                )

    c_ejecutar, c_help, _, c_auto = st.columns([1.2, 3.2, 4.0, 0.42], gap="small")
    with c_ejecutar:
        if st.button(
            "Ejecutar",
            icon=":material/play_arrow:",
            key="btn_ejecutar_todos_seleccionados",
            help="Ejecutar las sugerencias seleccionadas",
            use_container_width=True,
            type="primary",
            disabled=len(seleccionados) == 0
        ):
            with st.spinner("Ejecutando sugerencias seleccionadas..."):
                resultado = ejecutar_todos_seleccionados_coach(creds, seleccionados)
            if resultado.get("aplicados", 0):
                st.success(resultado["mensaje"])
                st.rerun()
            else:
                st.warning(resultado["mensaje"])
                st.rerun(scope="fragment")
    with c_help:
        st.caption("Selecciona una o varias sugerencias y ejecutalas cuando estes de acuerdo.")
    with c_auto:
        if st.button(
            " ",
            icon=":material/bolt:",
            key="btn_auto_tipo_todo",
            help="En adelante, hacer este tipo sin preguntar",
            use_container_width=True,
            type="secondary",
            disabled=len(seleccionados) != 1
        ):
            tipo_sel = tipo_config_para_todo(seleccionados[0])
            df_config = leer_todo_config(creds)
            condicion_tipo = df_config["Tipo_ToDo"].astype(str).str.strip() == tipo_sel
            if condicion_tipo.any() and str(df_config.loc[condicion_tipo, "Permite_Auto_Aplicar"].iloc[0]).strip().upper() == "TRUE":
                df_config.loc[condicion_tipo, "Modo_Ejecucion"] = "Automatico"
                df_config.loc[condicion_tipo, "Requiere_Confirmacion"] = "FALSE"
                guardar_todo_config(creds, df_config)
                st.success(f"{texto_ejemplo_config_todo(tipo_sel)} quedo configurado como automatico.")
                st.rerun()
            else:
                st.warning("Este tipo de pendiente no permite automatizacion completa.")
    return

# 🎨 CONFIGURACIÓN GLOBAL DE ESTILOS VISUALES REFINADOS (PUNTO 4)
ESTILOS_PASTELES_CRM = {
    "Email": {"bg": "#FFFFFF", "border": "#6c757d", "icono": "✉️"},
    "Cita": {"bg": "#E3F2FD", "border": "#2196F3", "icono": "📅"},
    "Llamada": {"bg": "#FFFDE7", "border": "#FFEB3B", "icono": "📞"},
    "Mensaje": {"bg": "#E8F5E9", "border": "#25D366", "icono": "💬"}
}

# 🕒 COMPONENTE GLOBAL: RENDERIZADOR ROBUSTO DE LÍNEA DE TIEMPO (PUNTO 6)
def renderizar_linea_tiempo_contacto(creds, df_interacciones, expandir_todo=False):
    """Pinta la línea de tiempo de forma responsive y expandible según el estado del botón global"""
    import pandas as pd
    
    if df_interacciones.empty:
        st.info("ℹ️ Este contacto aún no registra interacciones históricas. Agrega una minuta o sincroniza para iniciar la línea de tiempo.")
        return

    # Contenedor elástico con comportamiento elástico interno
    with st.container(height=550):
        for idx, fila in df_interacciones.iterrows():
            # Sanitización de tipos antiguos al nuevo estándar de 4 formatos
            tipo_raw = str(fila.get("Tipo", "Email")).strip()
            tipo_actual = "Mensaje" if tipo_raw in ["WhatsApp", "Mensaje"] else ("Cita" if tipo_raw == "Reunión" else tipo_raw)
            
            # Buscamos el estilo oficial del formato
            estilo = ESTILOS_PASTELES_CRM.get(tipo_actual, {"bg": "#FFFFFF", "border": "#6c757d", "icono": "📝"})
            
            asunto = str(fila.get("Asunto_Titulo", "Sin Asunto")).strip()
            fecha = str(fila.get("Fecha", "--/--/----")).strip()
            
            # La línea de tiempo muestra la versión editable/curada por el usuario.
            notas_usuario = fila.get("Notas_Usuario_Crudo", "")
            texto_detalle = ""
            if pd.notna(notas_usuario) and str(notas_usuario).strip() not in ["", "NULL", "nan"]:
                texto_detalle = str(notas_usuario).strip()

            # 1. CAPA TITULAR: HTML Flexible (height: auto para soportar cualquier contenedor)
            html_tarjeta = f"""
            <div style='
                display: flex; 
                justify-content: space-between; 
                align-items: center; 
                background-color: {estilo['bg']}; 
                border: 1px solid #e2e8f0;
                border-left: 6px solid {estilo['border']}; 
                padding: 10px 14px; 
                border-radius: 6px;
                margin-bottom: 4px;
                width: 100%;
                min-height: 44px;
                height: auto;
                box-sizing: border-box;
                font-family: sans-serif;
            '>
                <div style='font-size: 0.94em; max-width: 75%; color: #1a202c;'>
                    {estilo['icono']} &nbsp;<b>{asunto}</b>
                </div>
                <div style='font-size: 0.84em; color: #4a5568; white-space: nowrap; margin-left: 15px;'>
                    ⏱️ {fecha}
                </div>
            </div>
            """
            st.markdown(html_tarjeta, unsafe_allow_html=True)
            
            # 2. CAPA EXPANDIBLE: Despliega el cuerpo indentado e integra el botón de edición inteligente
            if expandir_todo:
                texto_limpio = texto_detalle.strip() if texto_detalle else "*(Sin contenido editable registrado en esta interacción)*"
                id_entrada = str(fila.get("ID_Entrada", f"INT_{idx}")).strip()
                key_edicion = f"btn_edit_lt_{idx}_{id_entrada}"
                
                html_detalle = f"""
                <div style='
                    background-color: #f8fafc;
                    border: 1px dashed #cbd5e1;
                    border-left: 4px solid {estilo['border']};
                    padding: 8px 14px;
                    margin-left: 12px;
                    margin-top: 2px;
                    font-size: 0.88em;
                    color: #334155;
                    white-space: pre-wrap;
                    font-family: sans-serif;
                '>{texto_limpio}</div>
                """
                st.markdown(html_detalle, unsafe_allow_html=True)
                
                # Inyectamos el disparador elástico alineado a la izquierda con el mismo margen
                c_btn_edit, _ = st.columns([0.45, 11.55])
                with c_btn_edit:
                    # Al hacer clic aquí, se dispara el popup modal global de edición que creamos recién
                    if st.button(" ", icon=":material/edit:", key=key_edicion, help="Editar o añadir minuta", use_container_width=True):
                        # Pasamos las credenciales guardadas en tu session_state para la reescritura en Google Sheets
                        mostrar_popup_detalle_global(fila, creds)
                
                # Pequeño espacio de separación estética para la siguiente tarjeta
                st.markdown("<div style='margin-bottom: 12px;'></div>", unsafe_allow_html=True)

def guardar_en_sheet(creds, df_actualizado):
    """Escribe los cambios de vuelta en el Google Sheet"""
    service = build('sheets', 'v4', credentials=creds)
    df_actualizado = df_actualizado.drop(columns=["Dias_Ultima_Interaccion", "Ultima_Interaccion_DT"], errors="ignore")
    df_actualizado = preparar_df_contactos_maestro(df_actualizado)
    columnas_base = columnas_contactos_maestras()
    columnas_extra = [col for col in df_actualizado.columns if col not in columnas_base]
    df_actualizado = df_actualizado[columnas_base + columnas_extra]
    
    # Preparar los datos incluyendo los encabezados
    datos_lista = [df_actualizado.columns.tolist()] + df_actualizado.values.tolist()
    body = {'values': datos_lista}
    
    # Limpiamos primero el rango para evitar filas duplicadas o fantasmas
    service.spreadsheets().values().clear(
        spreadsheetId=ID_PLANILLA, range=RANGO_SHEET
    ).execute()
    
    # Escribimos los nuevos valores consolidados
    service.spreadsheets().values().update(
        spreadsheetId=ID_PLANILLA, range=RANGO_SHEET,
        valueInputOption="RAW", body=body
    ).execute()

def leer_historial_sheet(creds, google_id):
    """Lee la pestaña 'Interacciones' del Google Sheet para el contacto seleccionado"""
    service = build('sheets', 'v4', credentials=creds)
    columnas_historial = columnas_interacciones()
    try:
        # Leemos la pestaña completa para asegurar que no se pierdan celdas vacías por formato
        result = service.spreadsheets().values().get(
            spreadsheetId=ID_PLANILLA, range="Interacciones"
        ).execute()
        
        rows = result.get('values', [])
        # Si no hay filas o solo está el encabezado, retornamos la estructura base vacía
        if not rows or len(rows) < 2:
            return pd.DataFrame(columns=columnas_historial)
            
        headers = rows[0]
        data = rows[1:]
        
        # Aseguramos que Pandas reciba filas del mismo largo que los encabezados para evitar desfases de columnas
        data_alineada = [fila + [""] * (len(headers) - len(fila)) for fila in data]
        df = pd.DataFrame(data_alineada, columns=headers)
        
        # Limpiamos espacios invisibles que puedan venir en los encabezados del Sheet
        df.columns = [col.strip() for col in df.columns]
        
        # Filtramos estrictamente comparando las cadenas de texto sin espacios invisibles
        df_filtrado = df[df["Google_ID"].astype(str).str.strip() == str(google_id).strip()].copy()
        
        # ⏳ Ordenamiento cronológico inverso (Más reciente primero) para la línea de tiempo
        if not df_filtrado.empty:
            df_filtrado["Fecha_DT"] = pd.to_datetime(df_filtrado["Fecha"], format="%d/%m/%Y", errors="coerce")
            df_filtrado = df_filtrado.sort_values(by="Fecha_DT", ascending=False).drop(columns=["Fecha_DT"])
            
        return df_filtrado
    except Exception:
        # Retorno seguro en caso de falla de conexión o rango inexistente
        return pd.DataFrame(columns=columnas_historial)

# =========================================================================
# 💾 FUNCIONES DE PERSISTENCIA DEDICADAS (API GOOGLE SHEETS)
# =========================================================================

def leer_interacciones_todas(creds):
    """Lee todas las interacciones para vistas agregadas como dashboard."""
    service = build('sheets', 'v4', credentials=creds)
    columnas_historial = columnas_interacciones()
    try:
        result = service.spreadsheets().values().get(
            spreadsheetId=ID_PLANILLA, range="Interacciones"
        ).execute()
        rows = result.get('values', [])
        if not rows or len(rows) < 2:
            return pd.DataFrame(columns=columnas_historial)
        headers = [str(col).strip() for col in rows[0]]
        data = rows[1:]
        data_alineada = [(fila + [""] * (len(headers) - len(fila)))[:len(headers)] for fila in data]
        df = pd.DataFrame(data_alineada, columns=headers)
        for col in columnas_historial:
            if col not in df.columns:
                df[col] = ""
        df["ID_Fuente"] = df["ID_Fuente"].replace("", pd.NA).fillna(df["ID_Entrada"]).astype(str).str.strip()
        df["Thread_ID"] = df["Thread_ID"].fillna("").astype(str).str.strip()
        df["Email_Asociado"] = df["Email_Asociado"].fillna("").astype(str).str.strip().str.lower()
        df["Rol_Email"] = df["Rol_Email"].fillna("").astype(str).str.strip().str.upper()
        return df
    except Exception:
        return pd.DataFrame(columns=columnas_historial)


def filas_sheet_a_dataframe(rows, columnas_esperadas=None):
    columnas_esperadas = columnas_esperadas or []
    if not rows:
        return pd.DataFrame(columns=columnas_esperadas)
    headers = [str(col).strip() for col in rows[0]]
    if not headers:
        headers = list(columnas_esperadas)
    data = rows[1:] if len(rows) > 1 else []
    data_alineada = [(fila + [""] * (len(headers) - len(fila)))[:len(headers)] for fila in data]
    df = pd.DataFrame(data_alineada, columns=headers)
    for col in columnas_esperadas:
        if col not in df.columns:
            df[col] = ""
    return df.fillna("")


def leer_rango_export_solo_lectura(creds, rango, columnas_esperadas=None):
    service = build('sheets', 'v4', credentials=creds)
    try:
        result = service.spreadsheets().values().get(
            spreadsheetId=ID_PLANILLA,
            range=rango
        ).execute()
        return filas_sheet_a_dataframe(result.get("values", []), columnas_esperadas), None
    except Exception as e:
        return pd.DataFrame(columns=columnas_esperadas or []), f"No se pudo leer {rango}: {e}"


def valor_exportable(valor):
    if pd.isna(valor):
        return ""
    return str(valor)


def dataframe_a_jsonl(df):
    import json
    if df is None:
        df = pd.DataFrame()
    df_export = df.copy().fillna("")
    lineas = []
    for _, row in df_export.iterrows():
        registro = {str(col): valor_exportable(row.get(col, "")) for col in df_export.columns}
        lineas.append(json.dumps(registro, ensure_ascii=False, separators=(",", ":")))
    return ("\n".join(lineas) + ("\n" if lineas else "")).encode("utf-8")


def hash_bytes_export(contenido):
    import hashlib
    return hashlib.sha256(contenido).hexdigest()


def agregar_archivo_export(zip_file, archivos_manifest, ruta, contenido, filas=0, columnas=None):
    zip_file.writestr(ruta, contenido)
    archivos_manifest[ruta] = {
        "rows": int(filas),
        "columns": list(columnas or []),
        "sha256": hash_bytes_export(contenido),
    }


def validar_export_espejo(tablas):
    warnings = []
    blocking_errors = []

    df_contactos = tablas.get("crm_contactos_extra", pd.DataFrame()).copy()
    df_interacciones = tablas.get("interacciones", pd.DataFrame()).copy()
    df_relaciones = tablas.get("crm_relaciones", pd.DataFrame()).copy()
    df_todos = tablas.get("crm_todos", pd.DataFrame()).copy()

    def valores_col(df, col):
        if df is None or df.empty or col not in df.columns:
            return []
        return [str(v).strip() for v in df[col].fillna("").tolist() if str(v).strip()]

    def registrar_duplicados(df, col, etiqueta):
        valores = valores_col(df, col)
        duplicados = sorted({v for v in valores if valores.count(v) > 1})
        if duplicados:
            warnings.append({
                "tipo": "duplicados",
                "tabla": etiqueta,
                "columna": col,
                "cantidad": len(duplicados),
                "muestras": duplicados[:10],
            })

    registrar_duplicados(df_contactos, "Contact_ID", "crm_contactos_extra")
    registrar_duplicados(df_contactos, "Google_ID", "crm_contactos_extra")
    registrar_duplicados(df_interacciones, "ID_Entrada", "interacciones")
    registrar_duplicados(df_relaciones, "Referido_ID", "crm_relaciones")
    registrar_duplicados(df_todos, "Todo_ID", "crm_todos")

    ids_contactos = set(valores_col(df_contactos, "Google_ID")) | set(valores_col(df_contactos, "Contact_ID"))
    ids_interacciones = set(valores_col(df_interacciones, "ID_Entrada"))

    if df_interacciones is not None and not df_interacciones.empty and "Google_ID" in df_interacciones.columns:
        sin_contacto = df_interacciones[
            ~df_interacciones["Google_ID"].fillna("").astype(str).str.strip().isin(ids_contactos)
        ]
        sin_contacto = sin_contacto[sin_contacto["Google_ID"].fillna("").astype(str).str.strip() != ""]
        if len(sin_contacto):
            warnings.append({
                "tipo": "referencia_contacto_interaccion",
                "tabla": "interacciones",
                "cantidad": int(len(sin_contacto)),
                "muestras": sin_contacto.get("ID_Entrada", pd.Series(dtype=str)).head(10).astype(str).tolist(),
            })

    if df_relaciones is not None and not df_relaciones.empty:
        if "Quien_Refiere_ID" in df_relaciones.columns:
            origen_roto = df_relaciones[
                ~df_relaciones["Quien_Refiere_ID"].fillna("").astype(str).str.strip().isin(ids_contactos)
            ]
            origen_roto = origen_roto[origen_roto["Quien_Refiere_ID"].fillna("").astype(str).str.strip() != ""]
            if len(origen_roto):
                warnings.append({
                    "tipo": "referido_origen_inexistente",
                    "tabla": "crm_relaciones",
                    "cantidad": int(len(origen_roto)),
                    "muestras": origen_roto.get("Referido_ID", pd.Series(dtype=str)).head(10).astype(str).tolist(),
                })
        if "Contacto_Vinculado_ID" in df_relaciones.columns:
            vinculo_roto = df_relaciones[
                ~df_relaciones["Contacto_Vinculado_ID"].fillna("").astype(str).str.strip().isin(ids_contactos)
            ]
            vinculo_roto = vinculo_roto[vinculo_roto["Contacto_Vinculado_ID"].fillna("").astype(str).str.strip() != ""]
            if len(vinculo_roto):
                warnings.append({
                    "tipo": "referido_vinculo_inexistente",
                    "tabla": "crm_relaciones",
                    "cantidad": int(len(vinculo_roto)),
                    "muestras": vinculo_roto.get("Referido_ID", pd.Series(dtype=str)).head(10).astype(str).tolist(),
                })

    if df_todos is not None and not df_todos.empty:
        activos = df_todos[df_todos.get("Estado_ToDo", "").astype(str).str.lower().isin(["activo", "pendiente", "abierto"])] if "Estado_ToDo" in df_todos.columns else df_todos.iloc[0:0]
        if not activos.empty and "Objeto_Tipo" in activos.columns and "Objeto_ID" in activos.columns:
            todos_contacto = activos[activos["Objeto_Tipo"].astype(str).str.lower().str.contains("contact")]
            todos_contacto_roto = todos_contacto[
                ~todos_contacto["Objeto_ID"].fillna("").astype(str).str.strip().isin(ids_contactos)
            ]
            if len(todos_contacto_roto):
                warnings.append({
                    "tipo": "todo_contacto_inexistente",
                    "tabla": "crm_todos",
                    "cantidad": int(len(todos_contacto_roto)),
                    "muestras": todos_contacto_roto.get("Todo_ID", pd.Series(dtype=str)).head(10).astype(str).tolist(),
                })
            todos_interaccion = activos[activos["Objeto_Tipo"].astype(str).str.lower().str.contains("interaccion")]
            todos_interaccion_roto = todos_interaccion[
                ~todos_interaccion["Objeto_ID"].fillna("").astype(str).str.strip().isin(ids_interacciones)
            ]
            if len(todos_interaccion_roto):
                warnings.append({
                    "tipo": "todo_interaccion_inexistente",
                    "tabla": "crm_todos",
                    "cantidad": int(len(todos_interaccion_roto)),
                    "muestras": todos_interaccion_roto.get("Todo_ID", pd.Series(dtype=str)).head(10).astype(str).tolist(),
                })

    return {"warnings": warnings, "blocking_errors": blocking_errors}


def construir_export_espejo_local(creds):
    import io
    import json
    import zipfile
    from datetime import datetime, timezone

    generado = datetime.now(timezone.utc).replace(microsecond=0).isoformat()
    tablas = {}
    raw = {}
    warnings = []

    df_contactos = preparar_df_contactos_maestro(leer_sheet_local(creds))
    tablas["crm_contactos_extra"] = df_contactos[columnas_contactos_maestras()].fillna("")

    df_interacciones = leer_interacciones_todas(creds)
    tablas["interacciones"] = df_interacciones[columnas_interacciones()].fillna("")

    df_relaciones = normalizar_relaciones_df(leer_relaciones_sheet(creds))
    tablas["crm_relaciones"] = df_relaciones[columnas_relaciones()].fillna("")

    lecturas = [
        ("crm_todos", "CRM_ToDos!A:R", columnas_todos_ia()),
        ("crm_todo_config", "CRM_ToDo_Config!A:J", columnas_todo_config()),
        ("crm_object_review_state", "CRM_Object_Review_State!A:K", columnas_object_review_state()),
        ("crm_sync_state", "CRM_Sync_State!A:C", ["Clave", "Valor", "Actualizado_En"]),
        ("crm_config", "CRM_Config!A:B", ["Clave", "Valor"]),
    ]
    for nombre, rango, columnas in lecturas:
        df_leido, warning = leer_rango_export_solo_lectura(creds, rango, columnas)
        if warning:
            warnings.append({"tipo": "lectura", "tabla": nombre, "detalle": warning})
        tablas[nombre] = df_leido.fillna("")

    raw_ranges = [
        ("crm_contactos_extra", RANGO_SHEET),
        ("interacciones", "Interacciones"),
        ("crm_relaciones", "CRM_Relaciones!A:Q"),
        ("crm_todos", "CRM_ToDos!A:R"),
        ("crm_todo_config", "CRM_ToDo_Config!A:J"),
        ("crm_object_review_state", "CRM_Object_Review_State!A:K"),
        ("crm_sync_state", "CRM_Sync_State!A:C"),
        ("crm_config", "CRM_Config!A:B"),
    ]
    for nombre, rango in raw_ranges:
        df_raw, warning = leer_rango_export_solo_lectura(creds, rango, [])
        if warning:
            warnings.append({"tipo": "raw_snapshot", "tabla": nombre, "detalle": warning})
        raw[nombre] = df_raw.fillna("")

    validacion = validar_export_espejo(tablas)
    validacion["warnings"] = warnings + validacion.get("warnings", [])
    validacion["generated_at"] = generado

    buffer = io.BytesIO()
    archivos_manifest = {}
    with zipfile.ZipFile(buffer, mode="w", compression=zipfile.ZIP_DEFLATED) as zip_file:
        for nombre, df in tablas.items():
            ruta = f"tables/{nombre}.jsonl"
            contenido = dataframe_a_jsonl(df)
            agregar_archivo_export(zip_file, archivos_manifest, ruta, contenido, len(df), df.columns.tolist())

        for nombre, df in raw.items():
            ruta = f"raw_sheets/{nombre}.jsonl"
            contenido = dataframe_a_jsonl(df)
            agregar_archivo_export(zip_file, archivos_manifest, ruta, contenido, len(df), df.columns.tolist())

        validation_bytes = json.dumps(validacion, ensure_ascii=False, indent=2).encode("utf-8")
        agregar_archivo_export(
            zip_file,
            archivos_manifest,
            "validation_report.json",
            validation_bytes,
            0,
            []
        )

        manifest = {
            "schema_version": "crm_networking_export_v0_1",
            "generated_at": generado,
            "source_app": "streamlit_local",
            "source_version": "local_docs_2026_07_22",
            "export_mode": "mirror_full",
            "user_label": "owner",
            "tables": archivos_manifest,
            "warnings": validacion.get("warnings", []),
            "blocking_errors": validacion.get("blocking_errors", []),
        }
        manifest_bytes = json.dumps(manifest, ensure_ascii=False, indent=2).encode("utf-8")
        agregar_archivo_export(zip_file, archivos_manifest, "manifest.json", manifest_bytes, 0, [])

    buffer.seek(0)
    nombre_archivo = f"crm-networking-export-{datetime.now().strftime('%Y%m%d-%H%M%S')}.zip"
    resumen = {
        "archivo": nombre_archivo,
        "generated_at": generado,
        "conteos": {nombre: int(len(df)) for nombre, df in tablas.items()},
        "warnings": validacion.get("warnings", []),
        "blocking_errors": validacion.get("blocking_errors", []),
    }
    return nombre_archivo, buffer.getvalue(), resumen


def guardar_interacciones_todas(creds, df_interacciones):
    service = build('sheets', 'v4', credentials=creds)
    datos_actualizados = [df_interacciones.columns.tolist()] + df_interacciones.fillna("").values.tolist()
    service.spreadsheets().values().clear(
        spreadsheetId=ID_PLANILLA, range="Interacciones"
    ).execute()
    service.spreadsheets().values().update(
        spreadsheetId=ID_PLANILLA,
        range="Interacciones",
        valueInputOption="USER_ENTERED",
        body={"values": datos_actualizados}
    ).execute()

def inicializar_notas_editables_desde_fuente(creds):
    df_interacciones = leer_interacciones_todas(creds)
    if df_interacciones.empty:
        return 0
    for col in columnas_interacciones():
        if col not in df_interacciones.columns:
            df_interacciones[col] = ""

    detalle = df_interacciones["Detalle_Fuente"].fillna("").astype(str).str.strip()
    notas = df_interacciones["Notas_Usuario_Crudo"].fillna("").astype(str).str.strip()
    condicion = (notas == "") & (detalle != "") & (~detalle.str.lower().isin(["nan", "null"]))
    total = int(condicion.sum())
    if total > 0:
        df_interacciones.loc[condicion, "Notas_Usuario_Crudo"] = df_interacciones.loc[condicion, "Detalle_Fuente"]
        guardar_interacciones_todas(creds, df_interacciones)
    return total

def upsert_interacciones_por_id(creds, filas_interacciones):
    columnas_historial = columnas_interacciones()
    df_interacciones = leer_interacciones_todas(creds)
    for col in columnas_historial:
        if col not in df_interacciones.columns:
            df_interacciones[col] = ""
    df_interacciones["ID_Fuente"] = df_interacciones["ID_Fuente"].replace("", pd.NA).fillna(df_interacciones["ID_Entrada"]).astype(str).str.strip()
    df_interacciones["Thread_ID"] = df_interacciones["Thread_ID"].fillna("").astype(str).str.strip()
    df_interacciones["Email_Asociado"] = df_interacciones["Email_Asociado"].fillna("").astype(str).str.strip().str.lower()
    df_interacciones["Rol_Email"] = df_interacciones["Rol_Email"].fillna("").astype(str).str.strip().str.upper()

    ids_existentes = set(df_interacciones["ID_Entrada"].astype(str).str.strip())
    nuevas = 0
    reasignadas = 0
    migradas = 0
    hubo_cambios = False

    for fila in filas_interacciones:
        fila_normalizada = (list(fila) + [""] * len(columnas_historial))[:len(columnas_historial)]
        nueva = dict(zip(columnas_historial, fila_normalizada))
        id_entrada = str(nueva.get("ID_Entrada", "")).strip()
        google_id_nuevo = str(nueva.get("Google_ID", "")).strip()
        id_fuente = str(nueva.get("ID_Fuente", "")).strip() or id_entrada
        thread_id = str(nueva.get("Thread_ID", "")).strip()
        email_asociado = str(nueva.get("Email_Asociado", "")).strip().lower()
        rol_email = str(nueva.get("Rol_Email", "")).strip().upper()
        nueva["ID_Fuente"] = id_fuente
        nueva["Thread_ID"] = thread_id
        nueva["Email_Asociado"] = email_asociado
        nueva["Rol_Email"] = rol_email
        if not id_entrada:
            continue

        if id_entrada in ids_existentes:
            condicion = df_interacciones["ID_Entrada"].astype(str).str.strip() == id_entrada
            google_id_actual = str(df_interacciones.loc[condicion, "Google_ID"].iloc[0]).strip()
            if google_id_nuevo and google_id_actual != google_id_nuevo:
                df_interacciones.loc[condicion, "Google_ID"] = google_id_nuevo
                reasignadas += 1
                hubo_cambios = True
            for col_meta in ["ID_Fuente", "Thread_ID", "Email_Asociado", "Rol_Email"]:
                valor_nuevo = str(nueva.get(col_meta, "")).strip()
                valor_actual = str(df_interacciones.loc[condicion, col_meta].iloc[0]).strip()
                if valor_nuevo and not valor_actual:
                    df_interacciones.loc[condicion, col_meta] = valor_nuevo
                    hubo_cambios = True
        else:
            condicion_legacy = (
                (df_interacciones["ID_Entrada"].astype(str).str.strip() == id_fuente) &
                (df_interacciones["Google_ID"].astype(str).str.strip() == google_id_nuevo) &
                (df_interacciones["Email_Asociado"].astype(str).str.strip() == "")
            )
            if id_fuente != id_entrada and condicion_legacy.any():
                idx_legacy = df_interacciones[condicion_legacy].index[0]
                df_interacciones.loc[idx_legacy, "ID_Entrada"] = id_entrada
                df_interacciones.loc[idx_legacy, "ID_Fuente"] = id_fuente
                df_interacciones.loc[idx_legacy, "Thread_ID"] = thread_id
                df_interacciones.loc[idx_legacy, "Email_Asociado"] = email_asociado
                df_interacciones.loc[idx_legacy, "Rol_Email"] = rol_email
                ids_existentes.add(id_entrada)
                ids_existentes.discard(id_fuente)
                migradas += 1
                hubo_cambios = True
            else:
                df_interacciones = pd.concat([df_interacciones, pd.DataFrame([nueva])], ignore_index=True)
                ids_existentes.add(id_entrada)
                nuevas += 1
                hubo_cambios = True

    if hubo_cambios:
        guardar_interacciones_todas(creds, df_interacciones)

    return {"nuevas": nuevas, "reasignadas": reasignadas, "migradas": migradas}

def registrar_nueva_interaccion_manual(creds, google_id, tipo, asunto, fecha, notas):
    """Función dedicada exclusivamente a inyectar una fila nueva al final del Sheet"""
    from datetime import datetime
    
    id_generado = f"MANUAL_{datetime.now().strftime('%Y%m%d_%H%M%S')}"
    
    fila_nueva = [
        str(google_id).strip(),
        id_generado,
        fecha,
        tipo,
        asunto if asunto.strip() != "" else "Interacción Manual",
        "Usuario App",
        "Registro manual ingresado desde la interfaz de la Ficha Técnica.",
        notas,
        "Procesamiento de resumen pendiente.",
        id_generado,
        "",
        "",
        "MANUAL"
    ]
    
    upsert_interacciones_por_id(creds, [fila_nueva])


def editar_interaccion_existente(creds, id_activo, tipo, asunto, fecha, notas):
    """Función dedicada exclusivamente a buscar un ID y sobreescribir sus datos (Update)"""
    
    service = build('sheets', 'v4', credentials=creds)
    
    result = service.spreadsheets().values().get(
        spreadsheetId=ID_PLANILLA, range="Interacciones"
    ).execute()
    
    rows = result.get('values', [])
    if rows:
        headers = rows[0]
        data = rows[1:]
        data_alineada = [f + [""] * (len(headers) - len(f)) for f in data]
        df_total = pd.DataFrame(data_alineada, columns=headers)
        df_total.columns = [col.strip() for col in df_total.columns]
        
        condicion = df_total["ID_Entrada"].astype(str).str.strip() == str(id_activo).strip()
        
        if not df_total[condicion].empty:
            df_total.loc[condicion, "Tipo"] = tipo
            df_total.loc[condicion, "Asunto_Titulo"] = asunto if asunto.strip() != "" else "Interacción Manual"
            df_total.loc[condicion, "Fecha"] = fecha
            df_total.loc[condicion, "Notas_Usuario_Crudo"] = notas
            
            datos_actualizados = [df_total.columns.tolist()] + df_total.values.tolist()
            body = {'values': datos_actualizados}
            
            service.spreadsheets().values().clear(spreadsheetId=ID_PLANILLA, range="Interacciones").execute()
            service.spreadsheets().values().update(
                spreadsheetId=ID_PLANILLA, range="Interacciones",
                valueInputOption="USER_ENTERED", body=body
            ).execute()

def actualizar_notas_usuario_sheet(creds, id_entrada, nuevo_texto):
    """
    Busca una interacción por su ID_Entrada en la pestaña 'Interacciones' 
    y actualiza exclusivamente el campo 'Notas_Usuario_Crudo' con el texto editable del usuario.
    """
    from googleapiclient.discovery import build
    import pandas as pd
    
    service = build('sheets', 'v4', credentials=creds)
    
    # 1. Bajamos la matriz completa actual de Interacciones
    result = service.spreadsheets().values().get(
        spreadsheetId=ID_PLANILLA, range="Interacciones"
    ).execute()
    
    rows = result.get('values', [])
    if not rows:
        return False
        
    headers = rows[0]
    data = rows[1:]
    
    # Alineamos filas más cortas por seguridad de índices
    data_alineada = [f + [""] * (len(headers) - len(f)) for f in data]
    df_total = pd.DataFrame(data_alineada, columns=headers)
    df_total.columns = [col.strip() for col in df_total.columns]
    
    # 2. Buscamos la fila exacta que coincide con el ID de entrada
    condicion = df_total["ID_Entrada"].astype(str).str.strip() == str(id_entrada).strip()
    
    if not df_total[condicion].empty:
        if "Notas_Usuario_Crudo" not in df_total.columns:
            df_total["Notas_Usuario_Crudo"] = ""
        df_total.loc[condicion, "Notas_Usuario_Crudo"] = str(nuevo_texto)
        
        # 3. Reconstruimos la matriz limpia para impactar en Google Sheets
        datos_actualizados = [df_total.columns.tolist()] + df_total.values.tolist()
        body = {'values': datos_actualizados}
        
        # Limpiamos y reescribimos toda la pestaña sanitizada
        service.spreadsheets().values().clear(spreadsheetId=ID_PLANILLA, range="Interacciones").execute()
        service.spreadsheets().values().update(
            spreadsheetId=ID_PLANILLA, range="Interacciones",
            valueInputOption="USER_ENTERED", body=body
        ).execute()
        return True
        
    return False

def eliminar_interaccion_existente(creds, id_a_eliminar):
    """Función dedicada exclusivamente a remover una fila por su ID_Entrada y consolidar el Sheet"""
    from googleapiclient.discovery import build
    import pandas as pd
    
    service = build('sheets', 'v4', credentials=creds)
    
    result = service.spreadsheets().values().get(
        spreadsheetId=ID_PLANILLA, range="Interacciones"
    ).execute()
    
    rows = result.get('values', [])
    if rows:
        headers = rows[0]
        data = rows[1:]
        data_alineada = [f + [""] * (len(headers) - len(f)) for f in data]
        df_total = pd.DataFrame(data_alineada, columns=headers)
        df_total.columns = [col.strip() for col in df_total.columns]
        
        # Filtramos el DataFrame dejando FUERA la fila que coincide con el ID a eliminar
        df_filtrado = df_total[df_total["ID_Entrada"].astype(str).str.strip() != str(id_a_eliminar).strip()]
        
        # Reconstruimos la matriz limpia con los encabezados originales
        datos_actualizados = [df_filtrado.columns.tolist()] + df_filtrado.values.tolist()
        body = {'values': datos_actualizados}
        
        # Limpiamos y reescribimos la base sanitizada de punta a punta
        service.spreadsheets().values().clear(spreadsheetId=ID_PLANILLA, range="Interacciones").execute()
        service.spreadsheets().values().update(
            spreadsheetId=ID_PLANILLA, range="Interacciones",
            valueInputOption="USER_ENTERED", body=body
        ).execute()

def obtener_contactos_google_legacy(creds):
    """Trae TODOS los contactos desde Google Contacts usando paginación iterativa"""
    service = build('people', 'v1', credentials=creds)
    lista_contactos = []
    token_pagina = None  # Llave para pedir la siguiente página de contactos
    
    while True:
        # Hacemos la llamada a la API respetando el límite de 1000 por página
        results = service.people().connections().list(
            resourceName='people/me',
            pageSize=1000,  
            personFields='names,emailAddresses,organizations,phoneNumbers',
            pageToken=token_pagina  # Pasamos el token actual (None en la primera vuelta)
        ).execute()
        
        connections = results.get('connections', [])
        for person in connections:
            id_google = person.get('resourceName', '')
            nombres = person.get('names', [])
            nombre_completo = nombres[0].get('displayName', 'Sin Nombre') if nombres else 'Sin Nombre'
            emails = person.get('emailAddresses', [])
            emails_texto = ", ".join([email.get('value') for email in emails]) if emails else 'Sin Email'
            orgs = person.get('organizations', [])
            empresa = orgs[0].get('name', 'Sin Empresa') if orgs else 'Sin Empresa'
            cargo = orgs[0].get('title', 'Sin Cargo') if orgs else 'Sin Cargo'
            
            phones = person.get('phoneNumbers', [])
            telefonos_texto = ", ".join([phone.get('value') for phone in phones]) if phones else 'Sin Teléfono'
            
            lista_contactos.append({
                "Google_ID": id_google,
                "Nombre_Visual": nombre_completo,
                "Emails_Concatenados": emails_texto,
                "Telefonos": telefonos_texto,
                "Empresa_Google": empresa,
                "Cargo_Google": cargo
            })
            
        # Revisamos si Google nos dio un token para la siguiente página
        token_pagina = results.get('nextPageToken')
        if not token_pagina:
            break  # Si ya no hay más páginas, rompemos el bucle
            
    return pd.DataFrame(lista_contactos)

PERSON_FIELDS_CONTACTOS = "names,emailAddresses,organizations,phoneNumbers,metadata"

def fila_desde_persona_google(person):
    id_google = person.get('resourceName', '')
    nombres = person.get('names', [])
    nombre_completo = nombres[0].get('displayName', 'Sin Nombre') if nombres else 'Sin Nombre'
    emails = person.get('emailAddresses', [])
    emails_texto = ", ".join([email.get('value') for email in emails if email.get('value')]) if emails else 'Sin Email'
    orgs = person.get('organizations', [])
    empresa = orgs[0].get('name', 'Sin Empresa') if orgs else 'Sin Empresa'
    cargo = orgs[0].get('title', 'Sin Cargo') if orgs else 'Sin Cargo'
    phones = person.get('phoneNumbers', [])
    telefonos_texto = ", ".join([phone.get('value') for phone in phones if phone.get('value')]) if phones else 'Sin Telefono'
    metadata = person.get("metadata", {}) or {}

    return {
        "Google_ID": id_google,
        "Nombre_Visual": nombre_completo,
        "Emails_Concatenados": emails_texto,
        "Telefonos": telefonos_texto,
        "Empresa_Google": empresa,
        "Cargo_Google": cargo,
        "__deleted": bool(metadata.get("deleted", False)),
    }

def obtener_contactos_google_con_cursor(creds, sync_token=None, request_sync_token=False):
    """Lee Google Contacts. Con sync_token trae solo cambios; sin token puede pedir cursor nuevo."""
    service = build('people', 'v1', credentials=creds)
    lista_contactos = []
    token_pagina = None
    next_sync_token = ""

    while True:
        params = {
            "resourceName": "people/me",
            "pageSize": 1000,
            "personFields": PERSON_FIELDS_CONTACTOS,
            "pageToken": token_pagina,
        }
        if sync_token:
            params["syncToken"] = sync_token
        elif request_sync_token:
            params["requestSyncToken"] = True

        results = service.people().connections().list(**params).execute()
        for person in results.get('connections', []):
            lista_contactos.append(fila_desde_persona_google(person))

        token_pagina = results.get('nextPageToken')
        next_sync_token = results.get('nextSyncToken', next_sync_token)
        if not token_pagina:
            break

    return pd.DataFrame(lista_contactos), next_sync_token

def obtener_contactos_google(creds):
    """Trae todos los contactos desde Google Contacts."""
    df_contactos, _ = obtener_contactos_google_con_cursor(creds)
    if "__deleted" in df_contactos.columns:
        df_contactos = df_contactos[df_contactos["__deleted"] != True].drop(columns=["__deleted"], errors="ignore")
    return df_contactos

def normalizar_telefono_para_match(valor):
    import re
    digitos = re.sub(r"\D+", "", str(valor or ""))
    return digitos[-9:] if len(digitos) >= 9 else digitos

def set_emails_contacto(valor):
    texto = str(valor or "").strip().lower()
    if texto in ["", "sin email", "nan", "null"]:
        return set()
    return {email.strip() for email in texto.split(",") if email.strip()}

def set_telefonos_contacto(valor):
    texto = str(valor or "").strip()
    if texto.lower() in ["", "sin telefono", "sin teléfono", "nan", "null"]:
        return set()
    return {
        normalizar_telefono_para_match(tel)
        for tel in texto.split(",")
        if normalizar_telefono_para_match(tel)
    }

def obtener_contacto_google_por_id(creds, google_id):
    service = build('people', 'v1', credentials=creds)
    person = service.people().get(
        resourceName=str(google_id).strip(),
        personFields=PERSON_FIELDS_CONTACTOS
    ).execute()
    fila = fila_desde_persona_google(person)
    if fila.get("__deleted"):
        return pd.DataFrame(columns=columnas_contactos_maestras())
    return pd.DataFrame([fila]).drop(columns=["__deleted"], errors="ignore")

def buscar_contacto_google_por_identidad(creds, contacto_ref):
    emails_ref = set_emails_contacto(contacto_ref.get("Emails_Concatenados", ""))
    telefonos_ref = set_telefonos_contacto(contacto_ref.get("Telefonos", ""))
    if not emails_ref and not telefonos_ref:
        return pd.DataFrame(columns=columnas_contactos_maestras())

    df_google = obtener_contactos_google(creds)
    if df_google.empty:
        return df_google

    candidatos = []
    for _, fila in df_google.iterrows():
        emails = set_emails_contacto(fila.get("Emails_Concatenados", ""))
        telefonos = set_telefonos_contacto(fila.get("Telefonos", ""))
        if emails_ref.intersection(emails) or telefonos_ref.intersection(telefonos):
            candidatos.append(fila)

    if len(candidatos) == 1:
        return pd.DataFrame([candidatos[0]])
    return pd.DataFrame(columns=df_google.columns)

def reasignar_interacciones_contacto(creds, google_id_anterior, google_id_nuevo):
    google_id_anterior = str(google_id_anterior or "").strip()
    google_id_nuevo = str(google_id_nuevo or "").strip()
    if not google_id_anterior or not google_id_nuevo or google_id_anterior == google_id_nuevo:
        return 0
    df_interacciones = leer_interacciones_todas(creds)
    if df_interacciones.empty or "Google_ID" not in df_interacciones.columns:
        return 0
    condicion = df_interacciones["Google_ID"].astype(str).str.strip() == google_id_anterior
    total = int(condicion.sum())
    if total > 0:
        df_interacciones.loc[condicion, "Google_ID"] = google_id_nuevo
        guardar_interacciones_todas(creds, df_interacciones)
    return total

def actualizar_contacto_individual_desde_google(creds, contacto_ref):
    google_id_original = str(contacto_ref.get("Google_ID", "")).strip()
    df_sheet = leer_sheet_local(creds)
    df_sheet_work = df_sheet.copy()
    df_google = pd.DataFrame()
    origen = "id"

    try:
        if google_id_original and es_contacto_fuente_conectada(google_id_original):
            df_google = obtener_contacto_google_por_id(creds, google_id_original)
    except HttpError as e:
        if e.resp is None or e.resp.status not in [400, 404, 410]:
            raise
        df_google = pd.DataFrame()

    if df_google.empty:
        origen = "identidad"
        df_google = buscar_contacto_google_por_identidad(creds, contacto_ref)

    if df_google.empty:
        return {
            "ok": False,
            "mensaje": "No encontre un match unico en Google Contacts para este contacto.",
            "google_id": google_id_original,
            "emails": contacto_ref.get("Emails_Concatenados", ""),
            "interacciones_reasignadas": 0,
        }

    fila_google = preparar_df_contactos_maestro(df_google).iloc[0]
    google_id_nuevo = str(fila_google.get("Google_ID", "")).strip()
    if not google_id_nuevo:
        return {
            "ok": False,
            "mensaje": "Google Contacts no devolvio un ID valido para el contacto.",
            "google_id": google_id_original,
            "emails": contacto_ref.get("Emails_Concatenados", ""),
            "interacciones_reasignadas": 0,
        }

    df_sheet_base = df_sheet_work.copy()
    if google_id_original and google_id_nuevo != google_id_original:
        existe_nuevo = (
            "Google_ID" in df_sheet_base.columns and
            (df_sheet_base["Google_ID"].astype(str).str.strip() == google_id_nuevo).any()
        )
        if existe_nuevo:
            return {
                "ok": False,
                "mensaje": "Encontre el contacto con otro Google_ID, pero ese ID ya existe en el Sheet. Lo dejo pendiente para fusion manual.",
                "google_id": google_id_original,
                "emails": contacto_ref.get("Emails_Concatenados", ""),
                "interacciones_reasignadas": 0,
            }
        condicion_original = df_sheet_base["Google_ID"].astype(str).str.strip() == google_id_original
        if condicion_original.any():
            df_sheet_base.loc[condicion_original, "Google_ID"] = google_id_nuevo

    tipo = "Modificacion" if google_id_original else "Nuevo"
    cambios = pd.DataFrame([{
        "Seleccionar": True,
        "Tipo_Cambio": tipo,
        "Google_ID": google_id_nuevo,
        "Nombre": valor_contacto_limpio(fila_google.get("Nombre_Visual", "")),
        "Detalle_Cambio": "Actualizacion puntual desde ficha de contacto.",
    }])
    resumen = aplicar_cambios_contactos_google(creds, df_sheet_base, pd.DataFrame([fila_google]), cambios)
    interacciones_reasignadas = reasignar_interacciones_contacto(creds, google_id_original, google_id_nuevo)
    df_actualizado = preparar_df_contactos_maestro(leer_sheet_local(creds))
    fila_actualizada = df_actualizado[df_actualizado["Google_ID"].astype(str).str.strip() == google_id_nuevo]
    contacto_actualizado = fila_actualizada.iloc[0].to_dict() if not fila_actualizada.empty else fila_google.to_dict()

    return {
        "ok": True,
        "mensaje": "Contacto actualizado desde Google Contacts.",
        "google_id": google_id_nuevo,
        "emails": contacto_actualizado.get("Emails_Concatenados", ""),
        "contacto": contacto_actualizado,
        "resumen": resumen,
        "origen": origen,
        "interacciones_reasignadas": interacciones_reasignadas,
    }

def columnas_contactos_maestras():
    return [
        "Google_ID", "Contact_ID", "Provider", "Provider_Contact_ID",
        "Nombre_Visual", "Emails_Concatenados", "Telefonos",
        "Empresa_Google", "Cargo_Google", "Scope_Networking", "Nivel_Cercania",
        "Es_Headhunter", "Dominios_Headhunter", "Estado_CRM", "Estado_Sync", "Estado_Contacto",
        "F_Pendiente", "F_Promesa_Cafe", "F_Propuesta_Cita", "F_Cita_Creada",
        "F_Cita_Concretada", "F_Agradecimiento", "F_Propone_Lead",
        "F_Nuevo_Lead_Contactado", "Minuta_Reunion"
    ]

def inferir_contact_id_app(fila_contacto):
    google_id = str(fila_contacto.get("Google_ID", "") or "").strip()
    contact_id = str(fila_contacto.get("Contact_ID", "") or "").strip()
    if contact_id:
        return contact_id
    if google_id.startswith("APP_CONTACT_"):
        return google_id
    if google_id:
        return f"APP_CONTACT_{hash_texto_corto('provider-id|' + google_id)}"
    return generar_contacto_id_app(fila_contacto)

def inferir_provider_contacto(fila_contacto):
    provider = str(fila_contacto.get("Provider", "") or "").strip()
    if provider:
        return provider
    google_id = str(fila_contacto.get("Google_ID", "") or "").strip()
    if google_id.startswith("people/"):
        return "Google"
    if google_id.startswith("APP_CONTACT_"):
        return "App"
    return "Manual"

def inferir_provider_contact_id(fila_contacto):
    provider_contact_id = str(fila_contacto.get("Provider_Contact_ID", "") or "").strip()
    if provider_contact_id:
        return provider_contact_id
    google_id = str(fila_contacto.get("Google_ID", "") or "").strip()
    if google_id.startswith("people/"):
        return google_id
    return ""

def preparar_df_contactos_maestro(df_contactos):
    df = df_contactos.copy() if df_contactos is not None else pd.DataFrame()
    for col in columnas_contactos_maestras():
        if col not in df.columns:
            df[col] = ""
    df["Google_ID"] = df["Google_ID"].astype(str).str.strip()
    df = df[df["Google_ID"] != ""].copy()
    df = df.drop_duplicates(subset=["Google_ID"], keep="last")
    if not df.empty:
        df["Contact_ID"] = df.apply(inferir_contact_id_app, axis=1)
        df["Provider"] = df.apply(inferir_provider_contacto, axis=1)
        df["Provider_Contact_ID"] = df.apply(inferir_provider_contact_id, axis=1)
    df["Scope_Networking"] = df["Scope_Networking"].replace("", "FALSE").fillna("FALSE").astype(str).str.strip().str.upper()
    df["Nivel_Cercania"] = df["Nivel_Cercania"].replace("", "3").fillna("3").astype(str).str.strip()
    df["Es_Headhunter"] = df["Es_Headhunter"].replace("", "FALSE").fillna("FALSE").astype(str).str.strip().str.upper()
    df["Dominios_Headhunter"] = df["Dominios_Headhunter"].fillna("").astype(str).str.strip()
    df["Estado_Sync"] = df["Estado_Sync"].replace("", "Nunca Sincronizado").fillna("Nunca Sincronizado")
    df["Estado_Contacto"] = df["Estado_Contacto"].replace("", "Activo").fillna("Activo").astype(str).str.strip()
    df.loc[df["Estado_Sync"].astype(str).str.contains("No encontrado", case=False, na=False), "Estado_Contacto"] = "Desactivado"
    return df

def valor_contacto_limpio(valor):
    if pd.isna(valor):
        return ""
    texto = str(valor).strip()
    return "" if texto.lower() in ["nan", "none", "null"] else texto

def es_contacto_fuente_conectada(contacto_id):
    """Distingue IDs externos actuales de IDs nativos de la app."""
    return str(contacto_id or "").strip().startswith("people/")

def generar_contacto_id_app(datos_contacto=None):
    from datetime import datetime
    base = datos_contacto or {}
    huella = "|".join([
        valor_contacto_limpio(base.get("Nombre_Visual", "")),
        valor_contacto_limpio(base.get("Emails_Concatenados", "")),
        valor_contacto_limpio(base.get("Telefonos", "")),
        datetime.now().strftime("%Y%m%d%H%M%S%f"),
    ])
    return f"APP_CONTACT_{hash_texto_corto(huella)}"

def validar_emails_contacto_editor(valor):
    import re
    texto = valor_contacto_limpio(valor)
    if not texto or texto.lower() in ["sin email", "sin emails"]:
        return []
    candidatos = [email.strip().lower() for email in re.split(r"[,;|\s]+", texto) if email.strip()]
    return [
        email for email in candidatos
        if not re.match(r"^[^@\s]+@[^@\s]+\.[^@\s]+$", email)
    ]

def validar_telefonos_contacto_editor(valor):
    invalidos = []
    texto = valor_contacto_limpio(valor)
    if not texto or texto.lower() in ["sin telefono", "sin teléfono"]:
        return invalidos
    import re
    for telefono in re.split(r"[,;|/]+", texto):
        telefono_limpio = telefono.strip()
        if not telefono_limpio:
            continue
        digitos = re.sub(r"\D+", "", telefono_limpio)
        if len(digitos) < 7:
            invalidos.append(telefono_limpio)
    return invalidos

def buscar_duplicados_contacto_editor(df_contactos, datos_contacto, contacto_id_actual=""):
    df = preparar_df_contactos_maestro(df_contactos)
    contacto_id_actual = str(contacto_id_actual or "").strip()
    emails_ref = emails_contacto_set(datos_contacto.get("Emails_Concatenados", ""))
    telefonos_ref = telefonos_contacto_set(datos_contacto.get("Telefonos", ""))
    if df.empty or (not emails_ref and not telefonos_ref):
        return pd.DataFrame(columns=df.columns.tolist() + ["Motivo_Duplicado"])

    duplicados = []
    for _, fila in df.iterrows():
        gid = str(fila.get("Google_ID", "")).strip()
        if not gid or gid == contacto_id_actual:
            continue
        motivos = []
        match_emails = sorted(emails_ref.intersection(emails_contacto_set(fila.get("Emails_Concatenados", ""))))
        match_telefonos = sorted(telefonos_ref.intersection(telefonos_contacto_set(fila.get("Telefonos", ""))))
        if match_emails:
            motivos.append("email: " + ", ".join(match_emails))
        if match_telefonos:
            motivos.append("telefono: " + ", ".join(match_telefonos))
        if motivos:
            fila_dup = fila.copy()
            fila_dup["Motivo_Duplicado"] = " | ".join(motivos)
            duplicados.append(fila_dup)

    return pd.DataFrame(duplicados) if duplicados else pd.DataFrame(columns=df.columns.tolist() + ["Motivo_Duplicado"])

def construir_fila_contacto_editor(datos_contacto, fila_base=None):
    fila = {col: "" for col in columnas_contactos_maestras()}
    if fila_base is not None:
        for col in columnas_contactos_maestras():
            fila[col] = valor_contacto_limpio(fila_base.get(col, ""))

    for col in ["Google_ID", "Nombre_Visual", "Emails_Concatenados", "Telefonos", "Empresa_Google", "Cargo_Google"]:
        if col in datos_contacto:
            fila[col] = valor_contacto_limpio(datos_contacto.get(col, ""))

    fila["Scope_Networking"] = valor_contacto_limpio(datos_contacto.get("Scope_Networking", fila.get("Scope_Networking", "FALSE"))).upper() or "FALSE"
    fila["Nivel_Cercania"] = valor_contacto_limpio(datos_contacto.get("Nivel_Cercania", fila.get("Nivel_Cercania", "3"))) or "3"
    fila["Es_Headhunter"] = valor_contacto_limpio(datos_contacto.get("Es_Headhunter", fila.get("Es_Headhunter", "FALSE"))).upper() or "FALSE"
    fila["Dominios_Headhunter"] = valor_contacto_limpio(datos_contacto.get("Dominios_Headhunter", fila.get("Dominios_Headhunter", "")))
    fila["Estado_CRM"] = normalizar_estado_networking(datos_contacto.get("Estado_CRM", fila.get("Estado_CRM", "Pendiente"))) or "Pendiente"
    fila["Estado_Contacto"] = valor_contacto_limpio(datos_contacto.get("Estado_Contacto", fila.get("Estado_Contacto", "Activo"))) or "Activo"
    fila["Estado_Sync"] = valor_contacto_limpio(datos_contacto.get("Estado_Sync", fila.get("Estado_Sync", "Creado en app")))
    fila["Contact_ID"] = inferir_contact_id_app(fila)
    fila["Provider"] = inferir_provider_contacto(fila)
    fila["Provider_Contact_ID"] = inferir_provider_contact_id(fila)
    return fila

def guardar_contacto_editor_en_sheet(creds, datos_contacto, contacto_id_actual=""):
    from datetime import datetime
    df_actual = preparar_df_contactos_maestro(leer_sheet_local(creds))
    contacto_id_actual = str(contacto_id_actual or datos_contacto.get("Google_ID", "") or "").strip()
    datos_contacto = dict(datos_contacto or {})

    errores = []
    if not valor_contacto_limpio(datos_contacto.get("Nombre_Visual", "")):
        errores.append("El nombre es obligatorio.")
    invalidos_email = validar_emails_contacto_editor(datos_contacto.get("Emails_Concatenados", ""))
    if invalidos_email:
        errores.append("Emails invalidos: " + ", ".join(invalidos_email))
    invalidos_telefono = validar_telefonos_contacto_editor(datos_contacto.get("Telefonos", ""))
    if invalidos_telefono:
        errores.append("Telefonos invalidos: " + ", ".join(invalidos_telefono))

    duplicados = buscar_duplicados_contacto_editor(df_actual, datos_contacto, contacto_id_actual)
    if not duplicados.empty:
        return {"ok": False, "errores": errores, "duplicados": duplicados, "contacto_id": contacto_id_actual}
    if errores:
        return {"ok": False, "errores": errores, "duplicados": duplicados, "contacto_id": contacto_id_actual}

    es_nuevo = not contacto_id_actual
    if es_nuevo:
        contacto_id_actual = generar_contacto_id_app(datos_contacto)
        datos_contacto["Google_ID"] = contacto_id_actual

    condicion = df_actual["Google_ID"].astype(str).str.strip() == contacto_id_actual
    fila_base = df_actual.loc[condicion].iloc[0] if condicion.any() else None
    fila_guardar = construir_fila_contacto_editor(datos_contacto, fila_base=fila_base)
    fila_guardar["Google_ID"] = contacto_id_actual
    fila_guardar["Contact_ID"] = inferir_contact_id_app(fila_guardar)
    fila_guardar["Provider"] = inferir_provider_contacto(fila_guardar)
    fila_guardar["Provider_Contact_ID"] = inferir_provider_contact_id(fila_guardar)
    fila_guardar["Estado_Sync"] = f"{'Creado' if es_nuevo else 'Editado'} en app - {datetime.now().strftime('%d/%m/%Y %H:%M:%S')}"

    if condicion.any():
        for col in columnas_contactos_maestras():
            df_actual.loc[condicion, col] = fila_guardar.get(col, "")
    else:
        df_actual = pd.concat([df_actual, pd.DataFrame([fila_guardar])], ignore_index=True)

    guardar_en_sheet(creds, df_actual)
    return {"ok": True, "errores": [], "duplicados": pd.DataFrame(), "contacto_id": contacto_id_actual, "contacto": fila_guardar}

def marcar_contactos_desactivados_df(df_contactos, contacto_ids, motivo="Desactivado", ahora_string=None):
    from datetime import datetime

    ids = {str(contacto_id or "").strip() for contacto_id in contacto_ids if str(contacto_id or "").strip()}
    df = preparar_df_contactos_maestro(df_contactos)
    if df.empty or not ids:
        return df, 0
    if ahora_string is None:
        ahora_string = datetime.now().strftime("%d/%m/%y %H:%M:%S")
    for col in ["Estado_Contacto", "Scope_Networking", "Estado_Sync"]:
        if col not in df.columns:
            df[col] = ""
    condicion = df["Google_ID"].astype(str).str.strip().isin(ids)
    total = int(condicion.sum())
    if total:
        df.loc[condicion, "Estado_Contacto"] = "Desactivado"
        df.loc[condicion, "Scope_Networking"] = "FALSE"
        df.loc[condicion, "Estado_Sync"] = f"{motivo} - {ahora_string}"
    return df, total


def desactivar_contactos_en_sheet(creds, contacto_ids, motivo="Desactivado"):
    df_actual = leer_sheet_local(creds)
    df_actualizado, total = marcar_contactos_desactivados_df(df_actual, contacto_ids, motivo=motivo)
    if total:
        guardar_en_sheet(creds, df_actualizado)
    return {"ok": total > 0, "total": total, "contacto_ids": [str(x or "").strip() for x in contacto_ids if str(x or "").strip()]}

def solicitar_popup_contacto_editor(contacto_id=None, valores_iniciales=None, retorno_key="contacto_editor_resultado"):
    st.session_state["popup_contacto_editor_abierto"] = True
    st.session_state["popup_contacto_editor_id"] = str(contacto_id or "").strip()
    st.session_state["popup_contacto_editor_prefill"] = dict(valores_iniciales or {})
    st.session_state["popup_contacto_editor_retorno_key"] = str(retorno_key or "contacto_editor_resultado")
    st.session_state["popup_contacto_editor_guardado"] = None
    st.session_state["popup_contacto_editor_carga_key"] = ""

def cerrar_popup_contacto_editor():
    st.session_state["popup_contacto_editor_abierto"] = False
    st.session_state["popup_contacto_editor_id"] = ""
    st.session_state["popup_contacto_editor_prefill"] = {}
    st.session_state["popup_contacto_editor_carga_key"] = ""
    st.session_state["contacto_editor_confirmar_desactivar"] = False
    if st.session_state.get("popup_referidos_reabrir_despues_contacto", False):
        st.session_state["popup_referidos_abierto"] = True
        st.session_state["popup_referidos_reload"] = True
        st.session_state["popup_referidos_reabrir_despues_contacto"] = False

def renderizar_popup_contacto_editor_pendiente(creds, df_maestro_contactos):
    if not st.session_state.get("popup_contacto_editor_abierto", False):
        return
    popup_editor_contacto_global(
        creds,
        df_maestro_contactos,
        contacto_id=st.session_state.get("popup_contacto_editor_id", ""),
        valores_iniciales=st.session_state.get("popup_contacto_editor_prefill", {}),
        retorno_key=st.session_state.get("popup_contacto_editor_retorno_key", "contacto_editor_resultado"),
    )

def valores_contacto_editor_desde_state(prefix):
    return {
        "Nombre_Visual": st.session_state.get(f"{prefix}_nombre", ""),
        "Empresa_Google": st.session_state.get(f"{prefix}_empresa", ""),
        "Cargo_Google": st.session_state.get(f"{prefix}_cargo", ""),
        "Emails_Concatenados": st.session_state.get(f"{prefix}_emails", ""),
        "Telefonos": st.session_state.get(f"{prefix}_telefonos", ""),
        "Scope_Networking": "TRUE" if st.session_state.get(f"{prefix}_scope", False) else "FALSE",
        "Es_Headhunter": "TRUE" if st.session_state.get(f"{prefix}_headhunter", False) else "FALSE",
        "Estado_CRM": st.session_state.get(f"{prefix}_estado", "Pendiente"),
    }

@st.dialog("Contacto", width="large")
def popup_editor_contacto_global(creds, df_maestro_contactos, contacto_id=None, valores_iniciales=None, retorno_key="contacto_editor_resultado"):
    prefix = "contacto_editor"
    contacto_id = str(contacto_id or "").strip()
    valores_iniciales = dict(valores_iniciales or {})
    df_contactos = preparar_df_contactos_maestro(df_maestro_contactos)
    fila_actual = pd.Series(dtype=object)
    if contacto_id and not df_contactos.empty:
        match = df_contactos[df_contactos["Google_ID"].astype(str).str.strip() == contacto_id]
        if not match.empty:
            fila_actual = match.iloc[0]

    carga_key = contacto_id or "nuevo:" + hash_texto_corto(str(sorted(valores_iniciales.items())))
    if st.session_state.get(f"{prefix}_carga_key") != carga_key:
        fuente = fila_actual.to_dict() if not fila_actual.empty else {}
        fuente.update({k: v for k, v in valores_iniciales.items() if valor_contacto_limpio(v)})
        st.session_state[f"{prefix}_carga_key"] = carga_key
        st.session_state[f"{prefix}_nombre"] = valor_contacto_limpio(fuente.get("Nombre_Visual", ""))
        st.session_state[f"{prefix}_empresa"] = valor_contacto_limpio(fuente.get("Empresa_Google", ""))
        st.session_state[f"{prefix}_cargo"] = valor_contacto_limpio(fuente.get("Cargo_Google", ""))
        st.session_state[f"{prefix}_emails"] = valor_contacto_limpio(fuente.get("Emails_Concatenados", ""))
        st.session_state[f"{prefix}_telefonos"] = valor_contacto_limpio(fuente.get("Telefonos", ""))
        st.session_state[f"{prefix}_scope"] = str(fuente.get("Scope_Networking", "FALSE")).strip().upper() == "TRUE"
        st.session_state[f"{prefix}_headhunter"] = str(fuente.get("Es_Headhunter", "FALSE")).strip().upper() == "TRUE"
        st.session_state[f"{prefix}_estado"] = normalizar_estado_networking(fuente.get("Estado_CRM", "Pendiente")) or "Pendiente"

    st.markdown('<div class="crm-dialog-title">Crear o editar contacto</div>', unsafe_allow_html=True)
    st.text_input("Nombre", key=f"{prefix}_nombre")
    col_1, col_2 = st.columns(2)
    with col_1:
        st.text_input("Empresa", key=f"{prefix}_empresa")
    with col_2:
        st.text_input("Cargo", key=f"{prefix}_cargo")
    st.text_area("Correos", key=f"{prefix}_emails", height=70, placeholder="correo@empresa.cl; otro@empresa.cl")
    st.text_area("Telefonos", key=f"{prefix}_telefonos", height=70, placeholder="+56 9 1234 5678; +56 2 1234 5678")

    col_scope, col_hh, col_estado = st.columns([1, 1, 2])
    with col_scope:
        st.toggle("Foco networking", key=f"{prefix}_scope")
    with col_hh:
        st.toggle("Headhunter", key=f"{prefix}_headhunter")
    with col_estado:
        estados = estados_networking_oficiales()
        estado_actual = st.session_state.get(f"{prefix}_estado", "Pendiente")
        idx_estado = estados.index(estado_actual) if estado_actual in estados else 0
        st.selectbox("Estado networking", estados, index=idx_estado, key=f"{prefix}_estado")

    datos = valores_contacto_editor_desde_state(prefix)
    errores = []
    if not valor_contacto_limpio(datos.get("Nombre_Visual", "")):
        errores.append("El nombre es obligatorio.")
    invalidos_email = validar_emails_contacto_editor(datos.get("Emails_Concatenados", ""))
    invalidos_telefono = validar_telefonos_contacto_editor(datos.get("Telefonos", ""))
    if invalidos_email:
        errores.append("Revisa estos correos: " + ", ".join(invalidos_email))
    if invalidos_telefono:
        errores.append("Revisa estos telefonos: " + ", ".join(invalidos_telefono))

    duplicados = buscar_duplicados_contacto_editor(df_contactos, datos, contacto_id)
    for error in errores:
        st.error(error)
    if not duplicados.empty:
        st.warning("Ya existe al menos un contacto con el mismo correo o telefono. Para evitar duplicados, revisa el vinculo antes de guardar.")
        st.dataframe(
            duplicados[["Nombre_Visual", "Emails_Concatenados", "Telefonos", "Motivo_Duplicado"]],
            hide_index=True,
            use_container_width=True,
        )

    contacto_desactivado = str(fila_actual.get("Estado_Contacto", "Activo") if not fila_actual.empty else "Activo").strip() == "Desactivado"
    if contacto_desactivado:
        st.caption("Este contacto ya esta desactivado. El historial se mantiene.")

    if st.session_state.get(f"{prefix}_confirmar_desactivar", False) and contacto_id:
        st.warning("Confirmas desactivar este contacto? No se borraran sus minutas, interacciones, referidos ni historial.")
        col_conf_desactivar, col_conf_cancelar = st.columns(2, gap="small")
        with col_conf_desactivar:
            if st.button("Si, desactivar", key=f"{prefix}_desactivar_confirmar", type="primary", use_container_width=True):
                resultado = desactivar_contactos_en_sheet(creds, [contacto_id], motivo="Desactivado")
                if resultado.get("ok"):
                    st.session_state[retorno_key] = {"ok": True, "contacto_id": contacto_id, "desactivado": True}
                    cerrar_popup_contacto_editor()
                    st.rerun()
                st.error("No pude desactivar el contacto.")
        with col_conf_cancelar:
            if st.button("No desactivar", key=f"{prefix}_desactivar_cancelar", use_container_width=True):
                st.session_state[f"{prefix}_confirmar_desactivar"] = False
                st.rerun()

    col_cancelar, col_desactivar, col_guardar = st.columns([1, 1, 1])
    with col_cancelar:
        if st.button("Cancelar", key=f"{prefix}_cancelar", use_container_width=True):
            cerrar_popup_contacto_editor()
            st.rerun()
    with col_desactivar:
        if contacto_id:
            if st.button("Desactivar", key=f"{prefix}_desactivar", disabled=contacto_desactivado, use_container_width=True):
                st.session_state[f"{prefix}_confirmar_desactivar"] = True
                st.rerun()
        else:
            st.markdown("&nbsp;", unsafe_allow_html=True)
    with col_guardar:
        if st.button("Guardar contacto", key=f"{prefix}_guardar", type="primary", disabled=bool(errores) or not duplicados.empty, use_container_width=True):
            resultado = guardar_contacto_editor_en_sheet(creds, datos, contacto_id_actual=contacto_id)
            if resultado.get("ok"):
                st.session_state[retorno_key] = resultado
                cerrar_popup_contacto_editor()
                st.rerun()
            else:
                for error in resultado.get("errores", []):
                    st.error(error)
                if not resultado.get("duplicados", pd.DataFrame()).empty:
                    st.warning("No guarde el contacto porque encontre duplicados.")

def emails_contacto_set(valor):
    texto = valor_contacto_limpio(valor).lower()
    if not texto or texto in ["sin email", "sin emails"]:
        return set()
    import re
    candidatos = re.split(r"[,;|\s]+", texto)
    return {
        email.strip().lower()
        for email in candidatos
        if "@" in email and "." in email
    }

def telefonos_contacto_set(valor, ultimos_digitos=8):
    import re
    texto = valor_contacto_limpio(valor)
    if not texto or texto.lower() in ["sin telefono", "#error!"]:
        return set()
    candidatos = re.split(r"[,;|/]+", texto)
    telefonos = set()
    for candidato in candidatos:
        digitos = re.sub(r"\D+", "", candidato)
        if len(digitos) >= ultimos_digitos:
            telefonos.add(digitos[-ultimos_digitos:])
    if not telefonos:
        digitos = re.sub(r"\D+", "", texto)
        if len(digitos) >= ultimos_digitos:
            telefonos.add(digitos[-ultimos_digitos:])
    return telefonos

def construir_indices_contactos_para_consolidacion(df_contactos):
    email_index = {}
    telefono_index = {}
    if df_contactos is None or df_contactos.empty:
        return email_index, telefono_index
    for _, fila in df_contactos.iterrows():
        gid = str(fila.get("Google_ID", "")).strip()
        if not gid:
            continue
        for email in emails_contacto_set(fila.get("Emails_Concatenados", "")):
            email_index.setdefault(email, set()).add(gid)
        for telefono in telefonos_contacto_set(fila.get("Telefonos", "")):
            telefono_index.setdefault(telefono, set()).add(gid)
    return email_index, telefono_index

def detectar_candidato_consolidacion(fila_sheet, google_email_index, google_telefono_index, google_map):
    gid_origen = str(fila_sheet.get("Google_ID", "")).strip()
    emails = emails_contacto_set(fila_sheet.get("Emails_Concatenados", ""))
    telefonos = telefonos_contacto_set(fila_sheet.get("Telefonos", ""))
    candidatos = {}

    for email in emails:
        for gid in google_email_index.get(email, set()):
            if gid != gid_origen:
                candidatos.setdefault(gid, {"email": set(), "telefono": set()})["email"].add(email)
    for telefono in telefonos:
        for gid in google_telefono_index.get(telefono, set()):
            if gid != gid_origen:
                candidatos.setdefault(gid, {"email": set(), "telefono": set()})["telefono"].add(telefono)

    if not candidatos:
        return None

    def score(item):
        _, matches = item
        return (len(matches["email"]) > 0, len(matches["telefono"]) > 0, len(matches["email"]) + len(matches["telefono"]))

    gid_destino, matches = sorted(candidatos.items(), key=score, reverse=True)[0]
    fila_destino = google_map.loc[gid_destino] if gid_destino in google_map.index else pd.Series(dtype=object)
    criterios = []
    if matches["email"]:
        criterios.append("email: " + ", ".join(sorted(matches["email"])))
    if matches["telefono"]:
        criterios.append("telefono ultimos 8 digitos: " + ", ".join(sorted(matches["telefono"])))
    return {
        "Google_ID_Destino": gid_destino,
        "Nombre_Destino": valor_contacto_limpio(fila_destino.get("Nombre_Visual", "")),
        "Criterio": " | ".join(criterios),
    }

def fecha_hito_mas_reciente(valor_a, valor_b):
    fecha_a = parse_fecha_hito_crm(valor_a)
    fecha_b = parse_fecha_hito_crm(valor_b)
    if pd.isna(fecha_a) and pd.isna(fecha_b):
        return valor_contacto_limpio(valor_a) or valor_contacto_limpio(valor_b)
    if pd.isna(fecha_a):
        return valor_contacto_limpio(valor_b)
    if pd.isna(fecha_b):
        return valor_contacto_limpio(valor_a)
    return valor_contacto_limpio(valor_a) if fecha_a >= fecha_b else valor_contacto_limpio(valor_b)

def fusionar_datos_app_contacto(fila_destino, fila_origen):
    fila = fila_destino.copy()
    if str(fila_origen.get("Scope_Networking", "")).strip().upper() == "TRUE":
        fila["Scope_Networking"] = "TRUE"
    if str(fila_origen.get("Es_Headhunter", "")).strip().upper() == "TRUE":
        fila["Es_Headhunter"] = "TRUE"

    try:
        nivel_destino = int(str(fila_destino.get("Nivel_Cercania", "") or "3").strip())
    except ValueError:
        nivel_destino = 3
    try:
        nivel_origen = int(str(fila_origen.get("Nivel_Cercania", "") or "3").strip())
    except ValueError:
        nivel_origen = 3
    fila["Nivel_Cercania"] = str(min(nivel_destino, nivel_origen))

    dominios = []
    for valor in [fila_destino.get("Dominios_Headhunter", ""), fila_origen.get("Dominios_Headhunter", "")]:
        for dominio in str(valor or "").split(";"):
            dominio_limpio = dominio.strip().lower()
            if dominio_limpio and dominio_limpio not in dominios:
                dominios.append(dominio_limpio)
    fila["Dominios_Headhunter"] = ";".join(dominios)

    estado_destino = normalizar_estado_networking(fila_destino.get("Estado_CRM", "Pendiente"))
    estado_origen = normalizar_estado_networking(fila_origen.get("Estado_CRM", "Pendiente"))
    fila["Estado_CRM"] = estado_origen if nivel_estado_networking(estado_origen) > nivel_estado_networking(estado_destino) else estado_destino

    for col_fecha in columnas_fechas_crm_legacy():
        fila[col_fecha] = fecha_hito_mas_reciente(fila_destino.get(col_fecha, ""), fila_origen.get(col_fecha, ""))

    minuta_destino = valor_contacto_limpio(fila_destino.get("Minuta_Reunion", ""))
    minuta_origen = valor_contacto_limpio(fila_origen.get("Minuta_Reunion", ""))
    if minuta_origen and minuta_origen != minuta_destino:
        fila["Minuta_Reunion"] = (minuta_destino + "\n\n--- Minuta contacto fusionado ---\n" + minuta_origen).strip() if minuta_destino else minuta_origen

    fila["Estado_Contacto"] = "Activo"
    return fila

def construir_cambios_contactos_google(df_google, df_sheet):
    columnas_google = ["Nombre_Visual", "Emails_Concatenados", "Telefonos", "Empresa_Google", "Cargo_Google"]
    etiquetas = {
        "Nombre_Visual": "Nombre",
        "Emails_Concatenados": "Email",
        "Telefonos": "Telefono",
        "Empresa_Google": "Empresa",
        "Cargo_Google": "Cargo",
    }
    df_google_cmp = preparar_df_contactos_maestro(df_google)
    df_sheet_cmp = preparar_df_contactos_maestro(df_sheet)
    google_ids = set(df_google_cmp["Google_ID"].astype(str).str.strip())
    sheet_ids = set(df_sheet_cmp["Google_ID"].astype(str).str.strip())
    sheet_ids_fuente = {gid for gid in sheet_ids if es_contacto_fuente_conectada(gid)}
    google_map = df_google_cmp.set_index("Google_ID", drop=False)
    sheet_map = df_sheet_cmp.set_index("Google_ID", drop=False)
    google_email_index, google_telefono_index = construir_indices_contactos_para_consolidacion(df_google_cmp)
    cambios = []

    for gid in sorted(google_ids - sheet_ids):
        fila = google_map.loc[gid]
        cambios.append({
            "Seleccionar": True,
            "Tipo_Cambio": "Nuevo",
            "Google_ID": gid,
            "Google_ID_Destino": "",
            "Nombre": valor_contacto_limpio(fila.get("Nombre_Visual", "")),
            "Contacto_Destino": "",
            "Detalle_Cambio": "Contacto nuevo en Google Contacts.",
        })

    for gid in sorted(google_ids & sheet_ids_fuente):
        fila_google = google_map.loc[gid]
        fila_sheet = sheet_map.loc[gid]
        detalles = []
        for col in columnas_google:
            antes = valor_contacto_limpio(fila_sheet.get(col, ""))
            despues = valor_contacto_limpio(fila_google.get(col, ""))
            if antes != despues:
                detalles.append(f"{etiquetas[col]}: {antes or '(vacio)'} -> {despues or '(vacio)'}")
        if detalles:
            cambios.append({
                "Seleccionar": True,
                "Tipo_Cambio": "Modificacion",
                "Google_ID": gid,
                "Google_ID_Destino": "",
                "Nombre": valor_contacto_limpio(fila_google.get("Nombre_Visual", "")) or valor_contacto_limpio(fila_sheet.get("Nombre_Visual", "")),
                "Contacto_Destino": "",
                "Detalle_Cambio": " | ".join(detalles),
            })

    for gid in sorted(sheet_ids_fuente - google_ids):
        fila = sheet_map.loc[gid]
        candidato = detectar_candidato_consolidacion(fila, google_email_index, google_telefono_index, google_map)
        if candidato:
            cambios.append({
                "Seleccionar": True,
                "Tipo_Cambio": "Consolidacion",
                "Google_ID": gid,
                "Google_ID_Destino": candidato["Google_ID_Destino"],
                "Nombre": valor_contacto_limpio(fila.get("Nombre_Visual", "")),
                "Contacto_Destino": candidato["Nombre_Destino"],
                "Detalle_Cambio": (
                    "El ID anterior ya no aparece en Google Contacts, pero existe un contacto vigente "
                    f"con match por {candidato['Criterio']}. Se reasignara la data de la app al ID vigente."
                ),
            })
            continue
        cambios.append({
            "Seleccionar": True,
            "Tipo_Cambio": "Desactivacion",
            "Google_ID": gid,
            "Google_ID_Destino": "",
            "Nombre": valor_contacto_limpio(fila.get("Nombre_Visual", "")),
            "Contacto_Destino": "",
            "Detalle_Cambio": "Ya no aparece en Google Contacts; se marcara como Desactivado sin borrar historial.",
        })

    return pd.DataFrame(cambios, columns=["Seleccionar", "Tipo_Cambio", "Google_ID", "Google_ID_Destino", "Nombre", "Contacto_Destino", "Detalle_Cambio"])

def construir_cambios_contactos_google_delta(df_google_delta, df_sheet):
    columnas_preview = ["Seleccionar", "Tipo_Cambio", "Google_ID", "Google_ID_Destino", "Nombre", "Contacto_Destino", "Detalle_Cambio"]
    columnas_google = ["Nombre_Visual", "Emails_Concatenados", "Telefonos", "Empresa_Google", "Cargo_Google"]
    etiquetas = {
        "Nombre_Visual": "Nombre",
        "Emails_Concatenados": "Email",
        "Telefonos": "Telefono",
        "Empresa_Google": "Empresa",
        "Cargo_Google": "Cargo",
    }
    df_sheet_cmp = preparar_df_contactos_maestro(df_sheet)
    sheet_map = df_sheet_cmp.set_index("Google_ID", drop=False) if not df_sheet_cmp.empty else pd.DataFrame()
    if df_google_delta is None or df_google_delta.empty:
        return pd.DataFrame(columns=columnas_preview)

    df_google_activos = preparar_df_contactos_maestro(df_google_delta[df_google_delta.get("__deleted", False) != True].drop(columns=["__deleted"], errors="ignore")) if "__deleted" in df_google_delta.columns else preparar_df_contactos_maestro(df_google_delta)
    google_map = df_google_activos.set_index("Google_ID", drop=False) if not df_google_activos.empty else pd.DataFrame()
    google_email_index, google_telefono_index = construir_indices_contactos_para_consolidacion(df_google_activos)
    cambios = []

    for _, fila_google_raw in df_google_delta.iterrows():
        gid = str(fila_google_raw.get("Google_ID", "")).strip()
        if not gid:
            continue

        eliminado = bool(fila_google_raw.get("__deleted", False))
        existe_en_sheet = not sheet_map.empty and gid in sheet_map.index
        fila_sheet = sheet_map.loc[gid] if existe_en_sheet else pd.Series(dtype=object)

        if eliminado:
            if existe_en_sheet:
                candidato = detectar_candidato_consolidacion(fila_sheet, google_email_index, google_telefono_index, google_map)
                if candidato:
                    cambios.append({
                        "Seleccionar": True,
                        "Tipo_Cambio": "Consolidacion",
                        "Google_ID": gid,
                        "Google_ID_Destino": candidato["Google_ID_Destino"],
                        "Nombre": valor_contacto_limpio(fila_sheet.get("Nombre_Visual", "")),
                        "Contacto_Destino": candidato["Nombre_Destino"],
                        "Detalle_Cambio": (
                            "El contacto fue eliminado en Google Contacts, pero hay un contacto vigente "
                            f"con match por {candidato['Criterio']}. Se reasignara la data de la app al ID vigente."
                        ),
                    })
                    continue
                cambios.append({
                    "Seleccionar": True,
                    "Tipo_Cambio": "Desactivacion",
                    "Google_ID": gid,
                    "Google_ID_Destino": "",
                    "Nombre": valor_contacto_limpio(fila_sheet.get("Nombre_Visual", "")),
                    "Contacto_Destino": "",
                    "Detalle_Cambio": "El contacto fue eliminado en Google Contacts; se marcara como Desactivado sin borrar historial.",
                })
            continue

        fila_google = preparar_df_contactos_maestro(pd.DataFrame([fila_google_raw.drop(labels=["__deleted"], errors="ignore")])).iloc[0]
        if not existe_en_sheet:
            cambios.append({
                "Seleccionar": True,
                "Tipo_Cambio": "Nuevo",
                "Google_ID": gid,
                "Google_ID_Destino": "",
                "Nombre": valor_contacto_limpio(fila_google.get("Nombre_Visual", "")),
                "Contacto_Destino": "",
                "Detalle_Cambio": "Contacto nuevo en Google Contacts.",
            })
            continue

        detalles = []
        for col in columnas_google:
            antes = valor_contacto_limpio(fila_sheet.get(col, ""))
            despues = valor_contacto_limpio(fila_google.get(col, ""))
            if antes != despues:
                detalles.append(f"{etiquetas[col]}: {antes or '(vacio)'} -> {despues or '(vacio)'}")

        if valor_contacto_limpio(fila_sheet.get("Estado_Contacto", "Activo")).lower() == "desactivado":
            detalles.append("Estado contacto: Desactivado -> Activo")

        if detalles:
            cambios.append({
                "Seleccionar": True,
                "Tipo_Cambio": "Modificacion",
                "Google_ID": gid,
                "Google_ID_Destino": "",
                "Nombre": valor_contacto_limpio(fila_google.get("Nombre_Visual", "")) or valor_contacto_limpio(fila_sheet.get("Nombre_Visual", "")),
                "Contacto_Destino": "",
                "Detalle_Cambio": " | ".join(detalles),
            })

    return pd.DataFrame(cambios, columns=columnas_preview)

def reasignar_google_id_en_tablas_app(creds, google_id_origen, google_id_destino):
    resumen = {"Interacciones": 0, "Relaciones": 0, "ToDos": 0}

    df_interacciones = leer_interacciones_todas(creds)
    if not df_interacciones.empty and "Google_ID" in df_interacciones.columns:
        condicion = df_interacciones["Google_ID"].astype(str).str.strip() == google_id_origen
        resumen["Interacciones"] = int(condicion.sum())
        if resumen["Interacciones"]:
            df_interacciones.loc[condicion, "Google_ID"] = google_id_destino
            guardar_interacciones_todas(creds, df_interacciones)

    df_relaciones = leer_relaciones_sheet(creds)
    if not df_relaciones.empty:
        for col in ["Google_ID_Origen", "Google_ID_Referido", "Quien_Refiere_ID", "Contacto_Vinculado_ID"]:
            if col in df_relaciones.columns:
                condicion = df_relaciones[col].astype(str).str.strip() == google_id_origen
                resumen["Relaciones"] += int(condicion.sum())
                df_relaciones.loc[condicion, col] = google_id_destino
        if resumen["Relaciones"]:
            guardar_relaciones_sheet(creds, df_relaciones)

    df_todos = leer_todos_ia(creds)
    if not df_todos.empty:
        cambios_todos = 0
        if "Objeto_ID" in df_todos.columns:
            condicion = df_todos["Objeto_ID"].astype(str).str.strip() == google_id_origen
            cambios_todos += int(condicion.sum())
            df_todos.loc[condicion, "Objeto_ID"] = google_id_destino
        for col in ["Estado_Actual_JSON", "Estado_Sugerido_JSON", "Evidencia_JSON", "Acciones_JSON", "Dedup_Key", "Notas"]:
            if col in df_todos.columns:
                mask = df_todos[col].astype(str).str.contains(google_id_origen, regex=False, na=False)
                cambios_todos += int(mask.sum())
                df_todos.loc[mask, col] = df_todos.loc[mask, col].astype(str).str.replace(google_id_origen, google_id_destino, regex=False)
        resumen["ToDos"] = cambios_todos
        if cambios_todos:
            guardar_todos_ia(creds, df_todos)

    return resumen

def construir_preview_contacto_contexto(contacto_ref, df_google, df_sheet):
    columnas_preview = ["Seleccionar", "Tipo_Cambio", "Google_ID", "Google_ID_Destino", "Nombre", "Contacto_Destino", "Detalle_Cambio"]
    google_id_original = str(contacto_ref.get("Google_ID", "")).strip()
    df_sheet_ref = preparar_df_contactos_maestro(df_sheet)
    fila_sheet = pd.Series(contacto_ref)
    if google_id_original and not df_sheet_ref.empty:
        match_sheet = df_sheet_ref[df_sheet_ref["Google_ID"].astype(str).str.strip() == google_id_original]
        if not match_sheet.empty:
            fila_sheet = match_sheet.iloc[0]

    if df_google is not None and not df_google.empty:
        df_google_cmp = preparar_df_contactos_maestro(df_google.drop(columns=["__deleted"], errors="ignore"))
        google_ids = set(df_google_cmp["Google_ID"].astype(str).str.strip())
        if google_id_original and google_id_original in google_ids:
            df_sheet_uno = preparar_df_contactos_maestro(pd.DataFrame([fila_sheet]))
            return construir_cambios_contactos_google(df_google_cmp[df_google_cmp["Google_ID"] == google_id_original], df_sheet_uno)

        google_map = df_google_cmp.set_index("Google_ID", drop=False) if not df_google_cmp.empty else pd.DataFrame()
        google_email_index, google_telefono_index = construir_indices_contactos_para_consolidacion(df_google_cmp)
        candidato = detectar_candidato_consolidacion(fila_sheet, google_email_index, google_telefono_index, google_map)
        if candidato:
            return pd.DataFrame([{
                "Seleccionar": True,
                "Tipo_Cambio": "Consolidacion",
                "Google_ID": google_id_original,
                "Google_ID_Destino": candidato["Google_ID_Destino"],
                "Nombre": valor_contacto_limpio(fila_sheet.get("Nombre_Visual", "")),
                "Contacto_Destino": candidato["Nombre_Destino"],
                "Detalle_Cambio": "Consolidacion sugerida por match de identidad.",
            }], columns=columnas_preview)

    return pd.DataFrame([{
        "Seleccionar": True,
        "Tipo_Cambio": "Desactivacion",
        "Google_ID": google_id_original,
        "Google_ID_Destino": "",
        "Nombre": valor_contacto_limpio(fila_sheet.get("Nombre_Visual", "")),
        "Contacto_Destino": "",
        "Detalle_Cambio": "Contacto no encontrado en la fuente conectada.",
    }], columns=columnas_preview)

def preparar_preview_contacto_individual(creds, contacto_ref):
    google_id_original = str(contacto_ref.get("Google_ID", "")).strip()
    df_sheet = leer_sheet_local(creds)
    df_google = pd.DataFrame()
    mensaje = "Revision acotada al contacto actual."

    try:
        if google_id_original and es_contacto_fuente_conectada(google_id_original):
            df_google = obtener_contacto_google_por_id(creds, google_id_original)
    except HttpError as e:
        if e.resp is None or e.resp.status not in [400, 404, 410]:
            raise
        df_google = pd.DataFrame()

    if df_google.empty:
        df_google = obtener_contactos_google(creds)
        mensaje = "El ID actual no aparece en la fuente conectada; se buscara posible consolidacion por email o telefono."

    df_preview = construir_preview_contacto_contexto(contacto_ref, df_google, df_sheet)
    return {
        "preview": df_preview,
        "google_df": df_google.drop(columns=["__deleted"], errors="ignore"),
        "next_sync_token": "",
        "modo": "contacto",
        "mensaje": mensaje,
    }

def preparar_preview_contactos_google(creds, forzar_completo=False, contacto_contexto=None):
    if contacto_contexto is not None:
        return preparar_preview_contacto_individual(creds, contacto_contexto)

    estado = leer_sync_state(creds)
    sync_token = "" if forzar_completo else estado.get("CONTACTS_SYNC_TOKEN", "").strip()
    modo = "incremental" if sync_token else "completo"
    mensaje = "Revision completa solicitada manualmente." if forzar_completo else ""

    try:
        if sync_token:
            df_google, next_sync_token = obtener_contactos_google_con_cursor(creds, sync_token=sync_token)
        else:
            df_google, next_sync_token = obtener_contactos_google_con_cursor(creds, request_sync_token=True)
    except HttpError as e:
        if sync_token and e.resp is not None and e.resp.status in [400, 410]:
            df_google, next_sync_token = obtener_contactos_google_con_cursor(creds, request_sync_token=True)
            modo = "completo"
            mensaje = "El cursor de Google Contacts habia vencido; se hizo una comparacion completa controlada."
        else:
            raise

    df_sheet = leer_sheet_local(creds)
    if modo == "incremental":
        df_preview = construir_cambios_contactos_google_delta(df_google, df_sheet)
    else:
        df_preview = construir_cambios_contactos_google(
            df_google.drop(columns=["__deleted"], errors="ignore"),
            df_sheet
        )

    return {
        "preview": df_preview,
        "google_df": df_google.drop(columns=["__deleted"], errors="ignore"),
        "next_sync_token": next_sync_token,
        "modo": modo,
        "mensaje": mensaje,
    }

def aplicar_cambios_contactos_google(creds, df_sheet, df_google, df_cambios_seleccionados):
    from datetime import datetime
    ahora = datetime.now().strftime("%d/%m/%y %H:%M:%S")
    columnas_google = ["Nombre_Visual", "Emails_Concatenados", "Telefonos", "Empresa_Google", "Cargo_Google"]
    df_actual = preparar_df_contactos_maestro(df_sheet)
    df_google_ref = preparar_df_contactos_maestro(df_google)
    google_map = df_google_ref.set_index("Google_ID", drop=False) if not df_google_ref.empty else pd.DataFrame()
    aplicados = {"Nuevo": 0, "Modificacion": 0, "Consolidacion": 0, "Desactivacion": 0}

    for _, cambio in df_cambios_seleccionados.iterrows():
        gid = str(cambio.get("Google_ID", "")).strip()
        tipo = str(cambio.get("Tipo_Cambio", "")).strip()
        if not gid:
            continue
        condicion = df_actual["Google_ID"].astype(str).str.strip() == gid

        if tipo == "Consolidacion":
            gid_destino = str(cambio.get("Google_ID_Destino", "")).strip()
            if not gid_destino or df_google_ref.empty or gid_destino not in google_map.index or not condicion.any():
                continue

            condicion_destino = df_actual["Google_ID"].astype(str).str.strip() == gid_destino
            fila_origen = df_actual.loc[condicion].iloc[0].copy()
            if condicion_destino.any():
                fila_destino = df_actual.loc[condicion_destino].iloc[0].copy()
            else:
                fila_destino = pd.Series({col: "" for col in columnas_contactos_maestras()})
                fila_destino["Google_ID"] = gid_destino
                fila_destino["Scope_Networking"] = "FALSE"
                fila_destino["Nivel_Cercania"] = "3"
                fila_destino["Es_Headhunter"] = "FALSE"
                fila_destino["Estado_CRM"] = "Pendiente"
                fila_destino["Estado_Contacto"] = "Activo"

            fila_fusionada = fusionar_datos_app_contacto(fila_destino, fila_origen)
            fila_google = google_map.loc[gid_destino]
            fila_fusionada["Google_ID"] = gid_destino
            for col in columnas_google:
                fila_fusionada[col] = valor_contacto_limpio(fila_google.get(col, ""))
            fila_fusionada["Estado_Contacto"] = "Activo"
            fila_fusionada["Estado_Sync"] = f"Consolidado desde {gid} - {ahora}"

            df_actual = df_actual[~(df_actual["Google_ID"].astype(str).str.strip().isin([gid, gid_destino]))].copy()
            df_actual = pd.concat([df_actual, pd.DataFrame([fila_fusionada])], ignore_index=True)
            reasignar_google_id_en_tablas_app(creds, gid, gid_destino)
            aplicados["Consolidacion"] += 1

        elif tipo in ["Nuevo", "Modificacion"]:
            if df_google_ref.empty or gid not in google_map.index:
                continue
            fila_google = google_map.loc[gid]
            if not condicion.any():
                nueva_fila = {col: "" for col in columnas_contactos_maestras()}
                nueva_fila["Google_ID"] = gid
                nueva_fila["Scope_Networking"] = "FALSE"
                nueva_fila["Nivel_Cercania"] = "3"
                nueva_fila["Es_Headhunter"] = "FALSE"
                nueva_fila["Dominios_Headhunter"] = ""
                nueva_fila["Estado_Contacto"] = "Activo"
                df_actual = pd.concat([df_actual, pd.DataFrame([nueva_fila])], ignore_index=True)
                condicion = df_actual["Google_ID"].astype(str).str.strip() == gid
                tipo = "Nuevo"

            for col in columnas_google:
                df_actual.loc[condicion, col] = valor_contacto_limpio(fila_google.get(col, ""))
            df_actual.loc[condicion, "Estado_Contacto"] = "Activo"
            df_actual.loc[condicion, "Estado_Sync"] = f"{'Nuevo' if tipo == 'Nuevo' else 'Actualizado'} - {ahora}"
            aplicados[tipo] = aplicados.get(tipo, 0) + 1

        elif tipo in ["Desactivacion", "Eliminacion"]:
            if condicion.any():
                df_actual, total_desactivados = marcar_contactos_desactivados_df(
                    df_actual,
                    [gid],
                    motivo="Desactivado",
                    ahora_string=ahora
                )
                aplicados["Desactivacion"] += total_desactivados

    guardar_en_sheet(creds, df_actual)
    return aplicados

def limpiar_estado_popup_sync_contactos():
    st.session_state["sync_contactos_preview"] = None
    st.session_state["sync_contactos_google_df"] = None
    st.session_state["sync_contactos_next_token"] = ""
    st.session_state["sync_contactos_modo"] = ""
    st.session_state["sync_contactos_mensaje"] = ""
    st.session_state["sync_contactos_forzar_completo"] = False
    st.session_state["sync_contactos_contexto"] = None
    st.session_state["sync_contactos_post_actividad"] = False

def id_resultante_sync_contacto(contacto_contexto, seleccionados):
    google_id_base = str(contacto_contexto.get("Google_ID", "")).strip()
    if seleccionados is None or seleccionados.empty:
        return google_id_base, False
    for _, cambio in seleccionados.iterrows():
        tipo = str(cambio.get("Tipo_Cambio", "")).strip()
        gid = str(cambio.get("Google_ID", "")).strip()
        if gid and gid != google_id_base:
            continue
        if tipo == "Consolidacion":
            destino = str(cambio.get("Google_ID_Destino", "")).strip()
            return destino or google_id_base, False
        if tipo in ["Desactivacion", "Eliminacion"]:
            return google_id_base, True
        if tipo in ["Nuevo", "Modificacion"]:
            return gid or google_id_base, False
    return google_id_base, False

def sincronizar_actividad_contacto_resultante(creds, google_id_resultante, contacto_fallback=None, desactivado=False):
    if desactivado:
        contacto_actualizado = contacto_fallback or {}
        try:
            df_actualizado = preparar_df_contactos_maestro(leer_sheet_local(creds))
            fila_actualizada = df_actualizado[df_actualizado["Google_ID"].astype(str).str.strip() == str(google_id_resultante).strip()]
            if not fila_actualizada.empty:
                contacto_actualizado = fila_actualizada.iloc[0].to_dict()
        except Exception:
            pass
        return {
            "nivel": "warning",
            "mensaje": "Contacto desactivado. No se sincronizo actividad.",
            "contacto": contacto_actualizado,
        }

    df_actualizado = preparar_df_contactos_maestro(leer_sheet_local(creds))
    fila_actualizada = df_actualizado[df_actualizado["Google_ID"].astype(str).str.strip() == str(google_id_resultante).strip()]
    if not fila_actualizada.empty:
        contacto_actualizado = fila_actualizada.iloc[0].to_dict()
    else:
        contacto_actualizado = contacto_fallback or {"Google_ID": google_id_resultante}

    resultado_actividad = sincronizar_actividad_contactos(
        creds,
        alcance="contacto",
        contacto_contexto=contacto_actualizado
    )
    correos_n = resultado_actividad.get("correos_nuevos", 0)
    citas_n = resultado_actividad.get("citas_nuevas", 0)
    return {
        "nivel": "success",
        "mensaje": f"Contacto actualizado. Correos nuevos: {correos_n} | Citas nuevas: {citas_n}",
        "contacto": contacto_actualizado,
        "google_id": google_id_resultante,
        "emails": resultado_actividad.get("emails", contacto_actualizado.get("Emails_Concatenados", "")),
    }

def etiqueta_contacto_google_opcion(fila):
    nombre = valor_contacto_limpio(fila.get("Nombre_Visual", "")) or "Sin nombre"
    email = valor_contacto_limpio(fila.get("Emails_Concatenados", ""))
    telefono = valor_contacto_limpio(fila.get("Telefonos", ""))
    gid = str(fila.get("Google_ID", "")).strip()
    detalle = " | ".join([x for x in [email, telefono] if x and x.lower() not in ["sin email", "sin telefono"]])
    return f"{nombre} - {detalle} - {gid}" if detalle else f"{nombre} - {gid}"

def opciones_contactos_google_para_selector(df_google):
    df_google_ref = preparar_df_contactos_maestro(df_google)
    opciones = []
    mapa = {}
    if df_google_ref.empty:
        return opciones, mapa
    df_google_ref["__label"] = df_google_ref.apply(etiqueta_contacto_google_opcion, axis=1)
    df_google_ref = df_google_ref.sort_values(["Nombre_Visual", "Google_ID"], na_position="last")
    for _, fila in df_google_ref.iterrows():
        gid = str(fila.get("Google_ID", "")).strip()
        label = str(fila.get("__label", "")).strip()
        if gid and label:
            opciones.append(label)
            mapa[label] = gid
    return opciones, mapa

def html_valor_contacto(valor, cambiado=False):
    import html
    texto = valor_contacto_limpio(valor)
    texto_norm = texto.lower().replace("é", "e")
    valores_sin_dato = {"sin email", "sin telefono", "sin empresa", "sin cargo", "sin nombre", "sin datos"}
    partes = [p.strip() for p in texto_norm.replace("|", "/").split("/") if p.strip()]
    if not texto or texto_norm in valores_sin_dato or (partes and all(p in valores_sin_dato for p in partes)):
        return "<em style='color:#94a3b8'>sin datos</em>"
    color = "#c2410c" if cambiado else "#334155"
    return f"<span style='color:{color}'>{html.escape(texto)}</span>"

def render_contacto_resumen_compacto(titulo, fila, fila_comparacion=None, destacar_cambios=False):
    fila_cmp = fila_comparacion if fila_comparacion is not None else pd.Series(dtype=object)
    cargo = valor_contacto_limpio(fila.get("Cargo_Google", ""))
    empresa = valor_contacto_limpio(fila.get("Empresa_Google", ""))
    empresa_cargo = " / ".join([x for x in [empresa, cargo] if x])
    cargo_cmp = valor_contacto_limpio(fila_cmp.get("Cargo_Google", ""))
    empresa_cmp = valor_contacto_limpio(fila_cmp.get("Empresa_Google", ""))
    empresa_cargo_cmp = " / ".join([x for x in [empresa_cmp, cargo_cmp] if x])
    campos = [
        ("ID", "Google_ID", str(fila.get("Google_ID", "")).strip(), str(fila_cmp.get("Google_ID", "")).strip()),
        ("Nombre", "Nombre_Visual", fila.get("Nombre_Visual", ""), fila_cmp.get("Nombre_Visual", "")),
        ("Email", "Emails_Concatenados", fila.get("Emails_Concatenados", ""), fila_cmp.get("Emails_Concatenados", "")),
        ("Telefono", "Telefonos", fila.get("Telefonos", ""), fila_cmp.get("Telefonos", "")),
        ("Empresa / cargo", "Empresa_Cargo", empresa_cargo, empresa_cargo_cmp),
    ]
    lineas = [f"<div style='font-weight:700;color:#111827;margin-bottom:4px'>{titulo}</div>"]
    for label, _, valor, valor_cmp in campos:
        cambiado = destacar_cambios and valor_contacto_limpio(valor) != valor_contacto_limpio(valor_cmp)
        lineas.append(
            "<div style='line-height:1.35;margin:0'>"
            f"<span style='color:#64748b'>{label}:</span> {html_valor_contacto(valor, cambiado=cambiado)}"
            "</div>"
        )
    st.markdown("\n".join(lineas), unsafe_allow_html=True)

def render_tarjetas_sync_contactos(df_cambios, df_sheet, df_google):
    seleccionados = []
    df_sheet_ref = preparar_df_contactos_maestro(df_sheet)
    df_google_ref = preparar_df_contactos_maestro(df_google)
    sheet_map = df_sheet_ref.set_index("Google_ID", drop=False) if not df_sheet_ref.empty else pd.DataFrame()
    google_map = df_google_ref.set_index("Google_ID", drop=False) if not df_google_ref.empty else pd.DataFrame()
    opciones_google, mapa_opciones_google = opciones_contactos_google_para_selector(df_google_ref)

    df_modificaciones = df_cambios[df_cambios["Tipo_Cambio"].astype(str).str.strip() == "Modificacion"].copy()
    df_consolidaciones = df_cambios[df_cambios["Tipo_Cambio"].astype(str).str.strip() == "Consolidacion"].copy()
    df_desactivaciones = df_cambios[df_cambios["Tipo_Cambio"].astype(str).str.strip().isin(["Desactivacion", "Eliminacion"])].copy()

    if not df_modificaciones.empty or not df_consolidaciones.empty:
        st.markdown("##### Cambios y consolidaciones")

    for idx, cambio in df_modificaciones.iterrows():
        gid = str(cambio.get("Google_ID", "")).strip()
        key_base = hash_texto_corto(f"mod_{idx}_{gid}")
        fila_antes = sheet_map.loc[gid] if gid in sheet_map.index else pd.Series(dtype=object)
        fila_despues = google_map.loc[gid] if gid in google_map.index else pd.Series(dtype=object)
        with st.container(border=True):
            aplicar = st.checkbox("Aplicar modificacion", value=True, key=f"sync_mod_apply_{key_base}")
            c_antes, c_despues = st.columns(2, gap="medium")
            with c_antes:
                render_contacto_resumen_compacto("Origen", fila_antes)
            with c_despues:
                render_contacto_resumen_compacto("Destino", fila_despues, fila_comparacion=fila_antes, destacar_cambios=True)
        if aplicar:
            seleccionados.append(cambio.to_dict())

    for idx, cambio in df_consolidaciones.iterrows():
        gid = str(cambio.get("Google_ID", "")).strip()
        gid_destino = str(cambio.get("Google_ID_Destino", "")).strip()
        key_base = hash_texto_corto(f"con_{idx}_{gid}_{gid_destino}")
        fila_origen = sheet_map.loc[gid] if gid in sheet_map.index else pd.Series(dtype=object)
        fila_destino = google_map.loc[gid_destino] if gid_destino in google_map.index else pd.Series(dtype=object)
        with st.container(border=True):
            aplicar = st.checkbox("Aplicar consolidacion sugerida", value=True, key=f"sync_con_apply_{key_base}")
            c_origen, c_destino = st.columns(2, gap="medium")
            with c_origen:
                render_contacto_resumen_compacto("Origen", fila_origen)
            with c_destino:
                render_contacto_resumen_compacto("Destino", fila_destino, fila_comparacion=fila_origen, destacar_cambios=True)
        if aplicar:
            seleccionados.append(cambio.to_dict())

    if not df_desactivaciones.empty:
        st.markdown("##### Por desactivar o consolidar manualmente")
        st.caption("Si eliges un contacto destino, la app consolidara la data interna bajo ese ID vigente. Si aplicas sin destino, se desactiva.")

    for idx, cambio in df_desactivaciones.iterrows():
        gid = str(cambio.get("Google_ID", "")).strip()
        key_base = hash_texto_corto(f"des_{idx}_{gid}")
        fila_origen = sheet_map.loc[gid] if gid in sheet_map.index else pd.Series(dtype=object)
        opciones_disponibles = [
            label for label in opciones_google
            if mapa_opciones_google.get(label, "") != gid
        ]
        with st.container(border=True):
            aplicar = st.checkbox("Aplicar accion", value=False, key=f"sync_des_apply_{key_base}")
            render_contacto_resumen_compacto("Origen", fila_origen)
            destino_label = st.selectbox(
                "Consolidar manualmente con",
                options=["-- Desactivar sin fusionar --"] + opciones_disponibles,
                key=f"sync_des_dest_{key_base}",
                disabled=not aplicar or not opciones_disponibles,
                help="Opcional. Si seleccionas un destino, se reasigna la data interna al contacto vigente."
            )
            if not opciones_disponibles:
                st.caption("No hay contactos destino disponibles en esta revision. Usa Revisar todo para cargar el universo completo.")
        if aplicar:
            cambio_final = cambio.to_dict()
            gid_destino = mapa_opciones_google.get(destino_label, "")
            if gid_destino:
                cambio_final["Tipo_Cambio"] = "Consolidacion"
                cambio_final["Google_ID_Destino"] = gid_destino
                cambio_final["Contacto_Destino"] = destino_label
            seleccionados.append(cambio_final)

    return pd.DataFrame(seleccionados, columns=df_cambios.columns)

@st.dialog("Actualizar contactos desde Google", width="large")
def popup_actualizar_contactos_google(creds_dialog, contacto_contexto=None, sincronizar_actividad_despues=False):
    if st.session_state.get("sync_contactos_preview") is None:
        with st.spinner("Leyendo cambios de Google Contacts..."):
            resultado_preview = preparar_preview_contactos_google(
                creds_dialog,
                forzar_completo=st.session_state.get("sync_contactos_forzar_completo", False),
                contacto_contexto=contacto_contexto
            )
            st.session_state["sync_contactos_google_df"] = resultado_preview["google_df"]
            st.session_state["sync_contactos_preview"] = resultado_preview["preview"]
            st.session_state["sync_contactos_next_token"] = resultado_preview["next_sync_token"]
            st.session_state["sync_contactos_modo"] = resultado_preview["modo"]
            st.session_state["sync_contactos_mensaje"] = resultado_preview["mensaje"]

    df_cambios = st.session_state.get("sync_contactos_preview", pd.DataFrame())
    modo_sync = st.session_state.get("sync_contactos_modo", "incremental")
    mensaje_sync = st.session_state.get("sync_contactos_mensaje", "")
    if mensaje_sync:
        st.info(mensaje_sync)
    st.caption(
        "Modo: contacto actual."
        if modo_sync == "contacto"
        else (
            "Modo: solo cambios desde la ultima actualizacion."
            if modo_sync == "incremental"
            else "Modo: comparacion completa para inicializar o reparar el cursor."
        )
    )

    if df_cambios.empty:
        st.success("No se detectaron cambios de contacto.")
        c_sin1, c_sin2, c_sin3, _ = st.columns([1.0, 1.6, 1.8, 3.6], gap="small")
        with c_sin1:
            cerrar_sin_cambios = st.button("Cerrar", key="btn_cerrar_sync_contactos_sin_cambios", use_container_width=True)
        with c_sin2:
            revisar_completo = st.button(
                "Revisar todo",
                key="btn_forzar_sync_contactos_completo",
                help="Hacer una comparacion completa para recuperar diferencias no aplicadas o reparar el cursor",
                use_container_width=True,
                disabled=modo_sync == "contacto"
            )
        with c_sin3:
            sync_actividad = st.button(
                "Actualizar actividad",
                key="btn_sync_contacto_sin_cambios_actividad",
                help="Buscar correos y citas del contacto",
                use_container_width=True,
                type="primary",
                disabled=not sincronizar_actividad_despues or contacto_contexto is None
            )
        if revisar_completo:
            st.session_state["sync_contactos_preview"] = None
            st.session_state["sync_contactos_google_df"] = None
            st.session_state["sync_contactos_next_token"] = ""
            st.session_state["sync_contactos_modo"] = "completo"
            st.session_state["sync_contactos_mensaje"] = ""
            st.session_state["sync_contactos_forzar_completo"] = True
            st.rerun()
        if sync_actividad and contacto_contexto is not None:
            google_id_resultante = str(contacto_contexto.get("Google_ID", "")).strip()
            with st.spinner("Actualizando actividad..."):
                resultado_actividad = sincronizar_actividad_contacto_resultante(
                    creds_dialog,
                    google_id_resultante,
                    contacto_fallback=contacto_contexto
                )
            contacto_actualizado = resultado_actividad.get("contacto", contacto_contexto)
            st.session_state["contacto_seleccionado"] = contacto_actualizado
            st.session_state["contacto_url_cargado"] = str(contacto_actualizado.get("Google_ID", google_id_resultante)).strip()
            st.session_state["sync_contacto_resultado"] = resultado_actividad
            st.session_state["mostrar_popup_sync_contacto_individual"] = False
            limpiar_estado_popup_sync_contactos()
            st.rerun()
        if cerrar_sin_cambios:
            next_token = st.session_state.get("sync_contactos_next_token", "")
            if next_token and modo_sync != "contacto":
                estado = leer_sync_state(creds_dialog)
                estado["CONTACTS_SYNC_TOKEN"] = next_token
                guardar_sync_state(creds_dialog, estado)
            st.session_state["mostrar_popup_sync_contactos"] = False
            st.session_state["mostrar_popup_sync_contacto_individual"] = False
            limpiar_estado_popup_sync_contactos()
            st.rerun()
        return

    st.caption("Revisa los cambios detectados. Los cambios no seleccionados volveran a aparecer en una revision posterior.")
    with st.form("form_sync_contactos_google", clear_on_submit=False):
        df_nuevos = df_cambios[df_cambios["Tipo_Cambio"].astype(str).str.strip() == "Nuevo"].copy()
        df_otros = df_cambios[df_cambios["Tipo_Cambio"].astype(str).str.strip() != "Nuevo"].copy()

        seleccionados_partes = []
        if not df_nuevos.empty:
            st.markdown("##### Contactos nuevos")
            df_nuevos_editado = st.data_editor(
                df_nuevos,
                column_config={
                    "Seleccionar": st.column_config.CheckboxColumn("Aplicar", default=True),
                    "Tipo_Cambio": st.column_config.TextColumn("Tipo", disabled=True),
                    "Google_ID": st.column_config.TextColumn("Google ID", disabled=True),
                    "Google_ID_Destino": None,
                    "Nombre": st.column_config.TextColumn("Nombre", disabled=True),
                    "Contacto_Destino": None,
                    "Detalle_Cambio": st.column_config.TextColumn("Detalle", disabled=True),
                },
                disabled=[col for col in df_nuevos.columns if col != "Seleccionar"],
                use_container_width=True,
                height=min(260, 80 + (len(df_nuevos) * 36)),
                hide_index=True,
                key="editor_sync_contactos_google_nuevos"
            )
            seleccionados_partes.append(df_nuevos_editado[df_nuevos_editado["Seleccionar"]].copy())

        if not df_otros.empty:
            seleccionados_partes.append(
                render_tarjetas_sync_contactos(
                    df_otros,
                    leer_sheet_local(creds_dialog),
                    st.session_state.get("sync_contactos_google_df", pd.DataFrame())
                )
            )

        c_aplicar, c_cancelar, _ = st.columns([1.35, 1.0, 5.65], gap="small")
        with c_aplicar:
            aplicar = st.form_submit_button("Aplicar cambios", type="primary", use_container_width=True)
        with c_cancelar:
            cancelar = st.form_submit_button("Cerrar", use_container_width=True)

    if cancelar:
        st.session_state["mostrar_popup_sync_contactos"] = False
        st.session_state["mostrar_popup_sync_contacto_individual"] = False
        limpiar_estado_popup_sync_contactos()
        st.rerun()

    if aplicar:
        seleccionados = pd.concat(
            [df_sel for df_sel in seleccionados_partes if df_sel is not None and not df_sel.empty],
            ignore_index=True
        ) if seleccionados_partes else pd.DataFrame(columns=df_cambios.columns)
        if seleccionados.empty:
            st.warning("No hay cambios seleccionados para aplicar.")
            return
        total_cambios_detectados = len(df_cambios)
        total_cambios_seleccionados = len(seleccionados)
        quedaron_cambios_pendientes = total_cambios_seleccionados < total_cambios_detectados
        with st.spinner("Actualizando el Sheet de contactos..."):
            resumen = aplicar_cambios_contactos_google(
                creds_dialog,
                leer_sheet_local(creds_dialog),
                st.session_state.get("sync_contactos_google_df", pd.DataFrame()),
                seleccionados
            )
            next_token = st.session_state.get("sync_contactos_next_token", "")
            if next_token and not quedaron_cambios_pendientes and modo_sync != "contacto":
                estado = leer_sync_state(creds_dialog)
                estado["CONTACTS_SYNC_TOKEN"] = next_token
                guardar_sync_state(creds_dialog, estado)
            if sincronizar_actividad_despues and contacto_contexto is not None:
                google_id_resultante, contacto_desactivado = id_resultante_sync_contacto(contacto_contexto, seleccionados)
                resultado_actividad = sincronizar_actividad_contacto_resultante(
                    creds_dialog,
                    google_id_resultante,
                    contacto_fallback=contacto_contexto,
                    desactivado=contacto_desactivado
                )
                st.session_state["sync_contacto_resultado"] = resultado_actividad
                contacto_actualizado = resultado_actividad.get("contacto", contacto_contexto)
                st.session_state["contacto_seleccionado"] = contacto_actualizado
                if not contacto_desactivado and google_id_resultante:
                    try:
                        st.query_params["google_id"] = google_id_resultante
                    except Exception:
                        pass
                    st.session_state["contacto_url_cargado"] = google_id_resultante
        st.session_state["mostrar_popup_sync_contactos"] = False
        st.session_state["mostrar_popup_sync_contacto_individual"] = False
        limpiar_estado_popup_sync_contactos()
        st.success(
            f"Contactos actualizados. Nuevos: {resumen.get('Nuevo', 0)} | "
            f"Modificados: {resumen.get('Modificacion', 0)} | "
            f"Consolidados: {resumen.get('Consolidacion', 0)} | "
            f"Desactivados: {resumen.get('Desactivacion', 0)}"
        )
        if quedaron_cambios_pendientes:
            st.info("Quedaron cambios sin aplicar; no se avanzo el cursor de Google Contacts para que vuelvan a aparecer en la proxima revision.")
        st.rerun()

# ---- INTERFAZ DE USUARIO (STREAMLIT) ----
st.set_page_config(page_title="CRM Networking", layout="wide")


def aplicar_estilos_globales():
    st.markdown("""
    <style>
        :root {
            --crm-bg: #f6f7fb;
            --crm-surface: #ffffff;
            --crm-surface-soft: #fbfcfe;
            --crm-border: #d9dee8;
            --crm-border-strong: #cbd5e1;
            --crm-text: #182230;
            --crm-muted: #667085;
            --crm-primary: #111827;
            --crm-primary-hover: #1f2937;
            --crm-accent: #2563eb;
            --crm-fs-contact-name: 1.875rem;
            --crm-fs-contact-role: 0.9375rem;
            --crm-fs-section-title: 1rem;
            --crm-fs-label: 0.7rem;
            --crm-fs-body: 0.875rem;
            --crm-fs-small: 0.8125rem;
            --crm-fs-meta: 0.75rem;
            --crm-control-height: 2.25rem;
            --crm-control-radius: 8px;
            --crm-control-padding-x: 0.75rem;
        }

        [data-testid="stAppViewContainer"] {
            background: var(--crm-bg);
        }

        [data-testid="stHeader"], [data-testid="stToolbar"], #MainMenu, footer {
            visibility: hidden;
            height: 0;
        }

        .main .block-container {
            padding-top: 0.8rem;
            padding-left: clamp(1rem, 2.2vw, 2.25rem);
            padding-right: clamp(1rem, 2.2vw, 2.25rem);
            padding-bottom: 3rem;
            max-width: min(1480px, calc(100vw - 2rem));
        }

        h1, h2, h3, h4 {
            color: var(--crm-text);
            letter-spacing: 0;
        }

        .crm-topbar {
            display: flex;
            align-items: center;
            justify-content: space-between;
            gap: 1.4rem;
            min-height: 42px;
            margin: 0 0 0.75rem 0;
            padding: 0 0 0.7rem 0;
            border-bottom: 1px solid var(--crm-border);
        }

        .crm-brand {
            display: inline-flex;
            align-items: center;
            gap: 0.55rem;
            min-height: 2.35rem;
            font-size: 1rem;
            font-weight: 760;
            color: var(--crm-text);
            letter-spacing: -0.01em;
        }

        .crm-brand-mark {
            width: 1.8rem;
            height: 1.8rem;
            display: inline-flex;
            align-items: center;
            justify-content: center;
            border-radius: 8px;
            background: #111827;
            color: white;
            font-size: 0.9rem;
            line-height: 1;
        }

        .crm-nav {
            display: inline-flex;
            align-items: center;
            gap: 0.25rem;
            padding: 0.2rem;
            border: 1px solid var(--crm-border);
            border-radius: 10px;
            background: #fbfcfe;
        }

        .crm-nav-link {
            min-height: 2.15rem;
            display: inline-flex;
            align-items: center;
            gap: 0.42rem;
            padding: 0 0.75rem;
            border-radius: 8px;
            color: var(--crm-muted);
            text-decoration: none;
            font-size: 0.9rem;
            font-weight: 590;
            line-height: 1;
        }

        .crm-nav-link:hover {
            color: var(--crm-text);
            background: var(--crm-surface-soft);
            text-decoration: none;
        }

        .crm-nav-link.active {
            color: var(--crm-text);
            background: var(--crm-surface);
            box-shadow: 0 1px 2px rgba(16, 24, 40, 0.08);
        }

        .crm-nav-link svg {
            width: 1rem;
            height: 1rem;
            stroke-width: 2;
        }

        .crm-icon-guide-grid {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(12rem, 1fr));
            gap: 0.75rem;
            margin: 0.65rem 0 1.2rem;
        }

        .crm-icon-guide-card {
            display: flex;
            align-items: center;
            gap: 0.75rem;
            min-height: 4.2rem;
            padding: 0.72rem 0.78rem;
            border: 1px solid var(--crm-border);
            border-radius: 9px;
            background: var(--crm-surface);
        }

        .crm-icon-guide-card .crm-ficha-type-icon,
        .crm-icon-guide-card .crm-status-dot {
            flex: 0 0 auto;
        }

        .crm-icon-guide-title {
            color: var(--crm-text);
            font-size: var(--crm-fs-body);
            font-weight: 800;
            line-height: 1.2;
        }

        .crm-icon-guide-meta {
            color: var(--crm-muted);
            font-size: var(--crm-fs-meta);
            line-height: 1.35;
            margin-top: 0.16rem;
        }

        .crm-icon-guide-code {
            color: #475569;
            font-size: var(--crm-fs-meta);
            font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
            margin-top: 0.18rem;
        }

        .crm-icon-guide-button-note {
            min-height: 2.4rem;
            margin-top: 0.36rem;
        }

        .crm-color-guide-grid {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(13rem, 1fr));
            gap: 0.72rem;
            margin: 0.65rem 0 1.2rem;
        }

        .crm-color-guide-card {
            display: grid;
            grid-template-columns: 2.35rem minmax(0, 1fr);
            gap: 0.72rem;
            align-items: center;
            min-height: 4.1rem;
            padding: 0.68rem 0.72rem;
            border: 1px solid var(--crm-border);
            border-radius: 9px;
            background: var(--crm-surface);
        }

        .crm-color-guide-swatch {
            width: 2.15rem;
            height: 2.15rem;
            border-radius: 8px;
            border: 1px solid rgba(15, 23, 42, 0.12);
            box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.45);
        }

        .crm-color-guide-section {
            margin-top: 0.65rem;
        }

        div[data-testid="stElementContainer"]:has(.crm-button-scope) {
            height: 0 !important;
            margin: 0 !important;
            padding: 0 !important;
            overflow: hidden !important;
        }

        div[data-testid="stVerticalBlock"]:has(> div[data-testid="stElementContainer"] .crm-button-scope) {
            gap: 0 !important;
        }

        div[data-testid="stElementContainer"]:has(.crm-button-scope) + div[data-testid="stElementContainer"] div.stButton > button,
        div[data-testid="stElementContainer"]:has(.crm-button-scope) + div[data-testid="stElementContainer"] button[data-testid^="stBaseButton"] {
            min-height: var(--crm-control-height) !important;
            height: var(--crm-control-height) !important;
            border-radius: var(--crm-control-radius) !important;
            font-size: var(--crm-fs-body) !important;
            display: inline-flex !important;
            align-items: center !important;
            justify-content: center !important;
            gap: 0 !important;
            line-height: 1 !important;
        }

        div[data-testid="stElementContainer"]:has(.crm-button-scope.square) + div[data-testid="stElementContainer"] div.stButton > button,
        div[data-testid="stElementContainer"]:has(.crm-button-scope.square) + div[data-testid="stElementContainer"] button[data-testid^="stBaseButton"] {
            width: var(--crm-control-height) !important;
            min-width: var(--crm-control-height) !important;
            max-width: var(--crm-control-height) !important;
            padding: 0 !important;
        }

        div[data-testid="stElementContainer"]:has(.crm-button-scope) + div[data-testid="stElementContainer"] div.stButton > button p,
        div[data-testid="stElementContainer"]:has(.crm-button-scope) + div[data-testid="stElementContainer"] button[data-testid^="stBaseButton"] p,
        div[data-testid="stElementContainer"]:has(.crm-button-scope) + div[data-testid="stElementContainer"] div[data-testid="stMarkdownContainer"] {
            width: auto !important;
            min-width: 0 !important;
            margin: 0 !important;
            padding: 0 !important;
            display: inline-flex !important;
            align-items: center !important;
            justify-content: center !important;
            line-height: 1 !important;
        }

        div[data-testid="stElementContainer"]:has(.crm-button-scope) + div[data-testid="stElementContainer"] span[data-testid="stIconMaterial"] {
            width: 18px !important;
            height: 18px !important;
            margin: 0 !important;
            display: inline-flex !important;
            align-items: center !important;
            justify-content: center !important;
            font-size: 18px !important;
            line-height: 1 !important;
            transform: none !important;
        }

        div[data-testid="stElementContainer"]:has(.crm-button-scope.rect) + div[data-testid="stElementContainer"] div.stButton > button,
        div[data-testid="stElementContainer"]:has(.crm-button-scope.rect) + div[data-testid="stElementContainer"] button[data-testid^="stBaseButton"] {
            max-width: 10rem !important;
            padding-left: var(--crm-control-padding-x) !important;
            padding-right: var(--crm-control-padding-x) !important;
        }

        div[data-testid="stElementContainer"]:has(.crm-action-button-scope) {
            height: 0 !important;
            margin: 0 !important;
            padding: 0 !important;
            overflow: hidden !important;
        }

        div[data-testid="stVerticalBlock"]:has(> div[data-testid="stElementContainer"] .crm-action-button-scope) {
            gap: 0 !important;
        }

        div[data-testid="stElementContainer"]:has(.crm-action-button-scope) + div[data-testid="stElementContainer"] div.stButton > button,
        div[data-testid="stElementContainer"]:has(.crm-action-button-scope) + div[data-testid="stElementContainer"] button[data-testid^="stBaseButton"] {
            min-height: var(--crm-control-height) !important;
            height: var(--crm-control-height) !important;
            width: auto !important;
            max-width: 10.5rem !important;
            border-radius: var(--crm-control-radius) !important;
            padding: 0 var(--crm-control-padding-x) !important;
            font-size: var(--crm-fs-body) !important;
            display: inline-flex !important;
            align-items: center !important;
            justify-content: center !important;
            gap: 0.38rem !important;
            line-height: 1 !important;
            white-space: nowrap !important;
        }

        div[data-testid="stElementContainer"]:has(.crm-action-button-scope) + div[data-testid="stElementContainer"] div.stButton > button p,
        div[data-testid="stElementContainer"]:has(.crm-action-button-scope) + div[data-testid="stElementContainer"] button[data-testid^="stBaseButton"] p,
        div[data-testid="stElementContainer"]:has(.crm-action-button-scope) + div[data-testid="stElementContainer"] div[data-testid="stMarkdownContainer"] {
            margin: 0 !important;
            padding: 0 !important;
            line-height: 1 !important;
        }

        div[data-testid="stElementContainer"]:has(.crm-action-button-scope) + div[data-testid="stElementContainer"] span[data-testid="stIconMaterial"] {
            width: 18px !important;
            height: 18px !important;
            margin: 0 !important;
            font-size: 18px !important;
            line-height: 1 !important;
            transform: none !important;
        }

        div[data-testid="stElementContainer"]:has(.crm-action-button-scope.positive) + div[data-testid="stElementContainer"] div.stButton > button,
        div[data-testid="stElementContainer"]:has(.crm-action-button-scope.positive) + div[data-testid="stElementContainer"] button[data-testid^="stBaseButton"] {
            background: #15803d !important;
            border-color: #15803d !important;
            color: #ffffff !important;
        }

        div[data-testid="stElementContainer"]:has(.crm-action-button-scope.danger) + div[data-testid="stElementContainer"] div.stButton > button,
        div[data-testid="stElementContainer"]:has(.crm-action-button-scope.danger) + div[data-testid="stElementContainer"] button[data-testid^="stBaseButton"] {
            background: #dc2626 !important;
            border-color: #dc2626 !important;
            color: #ffffff !important;
        }

        .crm-page-header {
            margin: 1rem 0 0.9rem 0;
        }

        .crm-page-title {
            margin: 0;
            font-size: 1.45rem;
            line-height: 1.2;
            font-weight: 760;
            color: var(--crm-text);
            letter-spacing: -0.03em;
        }

        .crm-page-caption {
            margin-top: 0.2rem;
            color: var(--crm-muted);
            font-size: 0.86rem;
        }

        div[data-testid="stHorizontalBlock"] {
            gap: 0.55rem;
        }

        div.stButton > button {
            display: inline-flex;
            align-items: center;
            justify-content: center;
            gap: 0.35rem;
            border-radius: var(--crm-control-radius);
            min-height: var(--crm-control-height);
            height: var(--crm-control-height);
            font-size: var(--crm-fs-body);
            font-weight: 560;
            border: 1px solid var(--crm-border-strong);
            box-shadow: none;
            padding-left: var(--crm-control-padding-x);
            padding-right: var(--crm-control-padding-x);
            line-height: 1;
        }

        button[data-testid^="stBaseButton"] {
            display: inline-flex !important;
            align-items: center !important;
            justify-content: center !important;
            gap: 0.35rem !important;
            min-height: var(--crm-control-height) !important;
            height: var(--crm-control-height) !important;
            border-radius: var(--crm-control-radius) !important;
            padding-left: var(--crm-control-padding-x) !important;
            padding-right: var(--crm-control-padding-x) !important;
            font-size: var(--crm-fs-body) !important;
            line-height: 1 !important;
        }

        div.stButton > button p {
            display: inline-flex;
            align-items: center;
            justify-content: center;
            margin: 0;
            width: 100%;
            line-height: 1;
        }

        button[data-testid^="stBaseButton"] p {
            display: inline-flex !important;
            align-items: center !important;
            justify-content: center !important;
            margin: 0 !important;
            width: 100% !important;
            font-size: inherit !important;
            line-height: 1 !important;
        }

        button[data-testid^="stBaseButton"] > span:has(span[data-testid="stIconMaterial"]) {
            margin: 0 !important;
            width: 18px !important;
            height: 18px !important;
            min-width: 18px !important;
            display: inline-flex !important;
            align-items: center !important;
            justify-content: center !important;
            line-height: 1 !important;
        }

        div.stButton > button span[data-testid="stIconMaterial"] {
            margin: 0 !important;
            width: 18px !important;
            height: 18px !important;
            font-size: 18px !important;
            line-height: 1 !important;
            display: inline-flex !important;
            align-items: center !important;
            justify-content: center !important;
        }

        button[data-testid^="stBaseButton"] span[data-testid="stIconMaterial"] {
            margin: 0 !important;
            width: 18px !important;
            height: 18px !important;
            font-size: 18px !important;
            line-height: 1 !important;
            display: inline-flex !important;
            align-items: center !important;
            justify-content: center !important;
        }

        button[data-testid^="stBaseButton"]:has(span[data-testid="stIconMaterial"]) > div[data-testid="stMarkdownContainer"]:empty {
            display: none !important;
        }

        button[data-testid^="stBaseButton"]:has(span[data-testid="stIconMaterial"]) > div[data-testid="stMarkdownContainer"]:empty {
            width: 0 !important;
            min-width: 0 !important;
            margin: 0 !important;
            padding: 0 !important;
        }

        button[data-testid^="stBaseButton"]:has(> div[data-testid="stMarkdownContainer"]:empty) {
            gap: 0 !important;
            padding-left: 0 !important;
            padding-right: 0 !important;
        }

        div[data-testid="stSelectbox"] [data-baseweb="select"] {
            min-height: var(--crm-control-height) !important;
            height: var(--crm-control-height) !important;
            border-radius: var(--crm-control-radius) !important;
            background: var(--crm-surface-soft) !important;
        }

        div[data-testid="stSelectbox"] [data-baseweb="select"] > div {
            min-height: var(--crm-control-height) !important;
            height: var(--crm-control-height) !important;
            align-items: center !important;
        }

        div[data-testid="stSelectbox"] [data-baseweb="select"],
        div[data-testid="stSelectbox"] [data-baseweb="select"] * {
            font-size: var(--crm-fs-body) !important;
            line-height: 1.25 !important;
        }

        div.stButton > button[kind="primary"] {
            background: var(--crm-primary) !important;
            border-color: var(--crm-primary) !important;
            color: white !important;
        }

        button[data-testid="stBaseButton-primary"] {
            background: var(--crm-primary) !important;
            border-color: var(--crm-primary) !important;
            color: white !important;
        }

        div.stButton > button[kind="primary"]:hover {
            background: var(--crm-primary-hover) !important;
            border-color: var(--crm-primary-hover) !important;
            color: white !important;
        }

        button[data-testid="stBaseButton-primary"]:hover {
            background: var(--crm-primary-hover) !important;
            border-color: var(--crm-primary-hover) !important;
            color: white !important;
        }

        div.stButton > button[kind="secondary"] {
            background: var(--crm-surface);
            color: #334155;
        }

        div.stButton > button[kind="secondary"]:hover {
            border-color: #94a3b8;
            color: #0f172a;
            background: #fbfdff;
        }

        div[data-testid="stMetric"] {
            background: var(--crm-surface);
            border: 1px solid var(--crm-border);
            border-radius: 8px;
            padding: 0.85rem 1rem;
        }

        div[data-testid="stMetric"] label {
            color: var(--crm-muted);
        }

        div[data-testid="stDataFrame"], div[data-testid="stDataEditor"] {
            border: 1px solid var(--crm-border);
            border-radius: 8px;
            overflow: hidden;
            background: var(--crm-surface);
        }

        div[data-testid="stVerticalBlockBorderWrapper"]:has(> div[data-testid="stVerticalBlock"] > div[data-testid="stElementContainer"] .crm-ficha-panel-marker) {
            background: var(--crm-surface) !important;
            border-color: var(--crm-border) !important;
            box-shadow: 0 18px 45px rgba(15, 23, 42, 0.07) !important;
        }

        div[data-testid="stVerticalBlock"]:has(> div[data-testid="stElementContainer"] .crm-ficha-panel-marker) {
            background: var(--crm-surface) !important;
            border: 1px solid var(--crm-border) !important;
            border-radius: 10px !important;
            box-shadow: 0 18px 45px rgba(15, 23, 42, 0.07) !important;
            padding: 1rem !important;
        }

        div[data-testid="stVerticalBlock"]:has(> div[data-testid="stElementContainer"] .crm-ficha-interactions-section-marker) {
            gap: 0.25rem !important;
        }

        div[data-testid="stVerticalBlockBorderWrapper"]:has(> div[data-testid="stVerticalBlock"] > div[data-testid="stElementContainer"] .crm-ficha-ref-card-inner) {
            background: var(--crm-surface-soft) !important;
            border: 1px solid #e5eaf2 !important;
            border-radius: 8px !important;
            box-shadow: none !important;
        }

        div[data-testid="stVerticalBlock"]:has(> div[data-testid="stElementContainer"] .crm-ficha-ref-card-inner) {
            background: var(--crm-surface-soft) !important;
            border: 1px solid #e5eaf2 !important;
            border-radius: 8px !important;
            box-shadow: none !important;
            padding: 0.75rem !important;
        }

        div[data-testid="stExpander"] {
            border: 1px solid var(--crm-border);
            border-radius: 8px;
            background: var(--crm-surface);
        }

        div[data-testid="stExpander"] summary {
            font-weight: 650;
            color: #334155;
        }

        hr {
            margin: 1.8rem 0;
            border-color: var(--crm-border);
        }

        .crm-section-label {
            color: var(--crm-muted);
            font-size: 0.78rem;
            font-weight: 700;
            margin: 0.2rem 0 0.35rem 0;
            text-transform: uppercase;
            letter-spacing: 0.03em;
        }

        .crm-contact-card {
            border: 0;
            border-radius: 10px;
            background: #ffffff;
            padding: 1.05rem 1.1rem 1rem 1.1rem;
            box-shadow: 0 1px 2px rgba(15, 23, 42, 0.035);
            margin-bottom: 1rem;
        }

        .crm-contact-name {
            margin: 0 0 0.22rem 0;
            font-size: var(--crm-fs-contact-name);
            line-height: 1.08;
            font-weight: 780;
            color: var(--crm-text);
            letter-spacing: 0;
        }

        h2.crm-contact-name {
            font-size: var(--crm-fs-contact-name) !important;
            line-height: 1.08 !important;
            font-weight: 780 !important;
            color: var(--crm-text) !important;
            letter-spacing: 0 !important;
        }

        .crm-contact-role {
            margin: 0 0 0.9rem 0;
            color: var(--crm-muted);
            font-size: var(--crm-fs-contact-role);
            line-height: 1.32;
        }

        p.crm-contact-role {
            font-size: var(--crm-fs-contact-role) !important;
            color: var(--crm-muted) !important;
            line-height: 1.32 !important;
        }

        .crm-contact-grid {
            display: grid;
            grid-template-columns: repeat(2, minmax(0, 1fr));
            gap: 0.62rem;
            margin-bottom: 0.95rem;
        }

        .crm-contact-field {
            border: 1px solid #e5eaf2;
            border-radius: 8px;
            background: #f8fafc;
            padding: 0.7rem 0.75rem;
            min-height: 4.5rem;
        }

        .crm-contact-field-label {
            color: var(--crm-muted);
            font-size: var(--crm-fs-label);
            font-weight: 800;
            text-transform: uppercase;
            letter-spacing: 0.03em;
            margin-bottom: 0.38rem;
        }

        .crm-contact-field-row {
            display: flex;
            align-items: center;
            gap: 0.38rem;
            min-height: 1.75rem;
        }

        .crm-contact-value {
            min-width: 0;
            flex: 1;
            color: #0f172a;
            font-size: var(--crm-fs-body);
            font-weight: 700;
            line-height: 1.25;
            word-break: break-word;
        }

        .crm-contact-mini-link {
            width: 1.8rem;
            height: 1.65rem;
            display: inline-flex;
            align-items: center;
            justify-content: center;
            border: 1px solid var(--crm-border-strong);
            border-radius: 8px;
            background: var(--crm-surface);
            color: #334155;
            font-size: 0.86rem;
            font-weight: 800;
            text-decoration: none;
            flex: 0 0 auto;
        }

        .crm-contact-mini-link:hover {
            border-color: #94a3b8;
            background: #fbfdff;
            color: #0f172a;
            text-decoration: none;
        }

        .crm-contact-mini-link svg {
            width: 0.9rem;
            height: 0.9rem;
            display: block;
            fill: none;
            stroke: currentColor;
            stroke-width: 2;
            stroke-linecap: round;
            stroke-linejoin: round;
        }

        .crm-contact-mini-link.whatsapp {
            color: #128c7e;
        }

        div[data-testid="stCheckbox"]:has(input[aria-label="Foco networking"][aria-checked="true"]) label > div:first-child {
            background: #15803d !important;
            border-color: #15803d !important;
        }

        div[data-testid="stCheckbox"]:has(input[aria-label="Headhunter"][aria-checked="true"]) label > div:first-child {
            background: #111827 !important;
            border-color: #111827 !important;
        }

        .crm-action-label {
            color: #64748b;
            font-size: 0.72rem;
            margin: 0 0 0.26rem 0;
            white-space: nowrap;
        }

        .crm-action-label.with-dot {
            display: inline-flex;
            align-items: center;
            gap: 0.32rem;
            font-weight: 750;
            text-transform: uppercase;
            letter-spacing: 0.02em;
        }

        .crm-actions-spacer {
            height: 1.08rem;
            margin-bottom: 0.26rem;
        }

        .crm-status-dot {
            width: 0.55rem;
            height: 0.55rem;
            display: inline-block;
            border-radius: 999px;
            background: #64748b;
            box-shadow: 0 0 0 3px #eef2f7;
        }

        .crm-status-dot.scope { background: #15803d; }
        .crm-status-dot.hh { background: #111827; }
        .crm-status-dot.pendiente { background: #dc2626; }
        .crm-status-dot.contactado { background: #ea580c; }
        .crm-status-dot.agendado { background: #16a34a; }
        .crm-status-dot.cita { background: #0284c7; }
        .crm-status-dot.agradecimiento { background: #1d4ed8; }

        .crm-ficha-section {
            border: 0;
            border-radius: 10px;
            background: var(--crm-surface);
            box-shadow: 0 1px 2px rgba(15, 23, 42, 0.035);
            padding: 1rem;
            margin-bottom: 1rem;
        }

        .crm-ficha-section-title {
            display: flex;
            align-items: center;
            justify-content: space-between;
            gap: 0.75rem;
            margin-bottom: 0.55rem;
        }

        .crm-ficha-section-title h3 {
            margin: 0;
            color: var(--crm-text);
            font-size: var(--crm-fs-section-title);
            line-height: 1.2;
            font-weight: 800;
        }

        .crm-ficha-timeline {
            display: flex;
            flex-direction: column;
            gap: 0;
        }

        .crm-ficha-entry {
            border: 1px solid #e5eaf2;
            border-left-width: 5px;
            border-left-style: solid;
            border-radius: 9px;
            background: #ffffff;
            overflow: hidden;
            margin-bottom: 0;
        }

        .crm-ficha-entry summary {
            list-style: none;
            cursor: pointer;
            padding: 0.44rem 0.72rem;
        }

        .crm-ficha-entry summary::-webkit-details-marker {
            display: none;
        }

        .crm-ficha-entry-row {
            display: grid;
            grid-template-columns: 3.35rem 1.55rem minmax(0, 1fr);
            gap: 0.48rem;
            align-items: center;
        }

        .crm-ficha-entry-date {
            color: #64748b;
            font-size: var(--crm-fs-meta);
            font-weight: 720;
            white-space: nowrap;
        }

        .crm-ficha-type-icon {
            width: 1.55rem;
            height: 1.55rem;
            display: inline-flex;
            align-items: center;
            justify-content: center;
            border: 1px solid rgba(15, 23, 42, 0.16);
            border-radius: 999px;
            background: rgba(255, 255, 255, 0.72);
            color: #334155;
            font-size: 0.8rem;
            font-weight: 800;
        }

        .crm-ficha-type-icon svg {
            width: 0.9rem;
            height: 0.9rem;
            display: block;
            fill: none;
            stroke: currentColor;
            stroke-width: 2;
            stroke-linecap: round;
            stroke-linejoin: round;
        }

        .crm-ficha-entry-title {
            min-width: 0;
            color: #0f172a;
            font-size: var(--crm-fs-body);
            font-weight: 720;
            overflow: hidden;
            text-overflow: ellipsis;
            white-space: nowrap;
        }

        .crm-ficha-entry-copy {
            min-width: 0;
            display: grid;
            grid-template-columns: minmax(7.5rem, 0.5fr) minmax(0, 0.5fr);
            gap: 0.5rem;
            align-items: baseline;
        }

        .crm-ficha-entry-preview {
            min-width: 0;
            color: #7b8798;
            font-size: var(--crm-fs-small);
            font-weight: 520;
            overflow: hidden;
            text-overflow: ellipsis;
            white-space: nowrap;
        }

        .crm-ficha-entry[open] .crm-ficha-entry-copy {
            grid-template-columns: minmax(0, 1fr);
        }

        .crm-ficha-entry[open] .crm-ficha-entry-title {
            overflow: visible;
            text-overflow: clip;
            white-space: normal;
        }

        .crm-ficha-entry[open] .crm-ficha-entry-preview {
            display: none;
        }

        .crm-ficha-entry-detail {
            border-top: 1px solid rgba(15, 23, 42, 0.08);
            padding: 0.52rem 0.78rem 0.64rem;
            color: #334155;
            font-size: var(--crm-fs-body);
            line-height: 1.45;
            white-space: pre-wrap;
        }

        div[data-testid="stHorizontalBlock"]:has(.crm-ficha-entry) {
            margin-bottom: 5px !important;
            height: auto !important;
            min-height: 41px !important;
            overflow: visible !important;
        }

        div[data-testid="stLayoutWrapper"]:has(.crm-ficha-entry),
        div[data-testid="stColumn"]:has(.crm-ficha-entry) {
            height: auto !important;
            min-height: 41px !important;
            overflow: visible !important;
        }

        div[data-testid="stLayoutWrapper"]:has(.crm-ficha-entry[open]),
        div[data-testid="stHorizontalBlock"]:has(.crm-ficha-entry[open]),
        div[data-testid="stColumn"]:has(.crm-ficha-entry[open]) {
            height: auto !important;
            min-height: max-content !important;
            overflow: visible !important;
        }

        div[data-testid="stHorizontalBlock"]:has(.crm-ficha-entry[open]) {
            margin-bottom: 5px !important;
        }

        div[data-testid="stElementContainer"]:has(.crm-ficha-entry) {
            margin-bottom: 0 !important;
            height: auto !important;
            min-height: max-content !important;
            overflow: visible !important;
        }

        div[data-testid="stMarkdownContainer"]:has(.crm-ficha-entry[open]) {
            margin-bottom: 0 !important;
        }

        .crm-ficha-empty {
            color: #94a3b8;
            font-style: italic;
        }

        .crm-ficha-ref-card {
            padding: 0.7rem 0.72rem 0.68rem;
            border-bottom: 1px solid #cbd5e1;
            margin-bottom: 0.08rem;
        }

        .crm-ficha-ref-head {
            display: flex;
            align-items: flex-start;
            justify-content: space-between;
            gap: 0.75rem;
            margin-bottom: 0.32rem;
        }

        .crm-ficha-ref-name {
            color: #0f172a;
            font-size: var(--crm-fs-body);
            font-weight: 800;
            line-height: 1.25;
            min-width: 0;
        }

        .crm-ficha-ref-crm {
            color: #667085;
            font-size: var(--crm-fs-meta);
            font-weight: 760;
            white-space: nowrap;
        }

        .crm-ficha-ref-note {
            color: #64748b;
            font-size: var(--crm-fs-meta);
            line-height: 1.35;
        }

        .crm-dialog-title {
            color: #0f172a;
            font-size: 1.05rem;
            font-weight: 800;
            line-height: 1.25;
            margin: 0 0 0.75rem;
        }

        .crm-ref-editor-empty,
        .crm-ref-editor-card {
            background: var(--crm-surface-soft);
            border: 1px solid var(--crm-border);
            border-radius: 8px;
            padding: 0.75rem;
            min-height: 8.5rem;
        }

        .crm-ref-editor-empty {
            color: #94a3b8;
            font-size: var(--crm-fs-small);
            font-style: italic;
            display: flex;
            align-items: center;
        }

        .crm-ref-editor-card-name {
            color: #0f172a;
            font-size: var(--crm-fs-body);
            font-weight: 800;
            line-height: 1.25;
            margin-bottom: 0.18rem;
        }

        .crm-ref-editor-card-muted {
            color: #64748b;
            font-size: var(--crm-fs-meta);
            line-height: 1.3;
            margin-bottom: 0.7rem;
        }

        .crm-ref-editor-card-row {
            display: grid;
            grid-template-columns: 4.5rem 1fr;
            gap: 0.5rem;
            color: #334155;
            font-size: var(--crm-fs-meta);
            line-height: 1.35;
            margin-bottom: 0.45rem;
        }

        .crm-ref-editor-card-row > span {
            color: #64748b;
            font-weight: 760;
            text-transform: uppercase;
            font-size: 0.66rem;
            letter-spacing: 0;
        }

        div[data-testid="stElementContainer"]:has(.crm-ficha-ref-bottom-marker) {
            height: 0 !important;
            margin: 0 !important;
            padding: 0 !important;
            overflow: hidden !important;
        }

        div[data-testid="stElementContainer"]:has(.crm-ficha-ref-bottom-marker) + div[data-testid="stHorizontalBlock"] {
            padding-top: 0.36rem;
            margin-top: 0.12rem;
        }

        .crm-ficha-ref-state-muted {
            display: inline-flex;
            align-items: center;
            gap: 0.34rem;
            color: #667085;
            font-size: var(--crm-fs-meta);
            font-style: italic;
            line-height: 1.25;
            margin: 0.12rem 0 0 0.72rem;
        }

        .crm-ficha-ref-state-muted .crm-status-dot {
            width: 0.45rem;
            height: 0.45rem;
            box-shadow: none;
        }

        .crm-ficha-ref-actions {
            display: flex;
            align-items: center;
            justify-content: flex-end;
            flex-wrap: wrap;
            gap: 0.45rem;
            margin-top: 0.56rem;
        }

        .crm-ficha-ref-link {
            display: inline-flex;
            align-items: center;
            justify-content: flex-start;
            min-height: 1.88rem;
            margin: 0.12rem 0 0 0.72rem;
            padding: 0;
            color: #2563eb;
            background: transparent;
            border: 0;
            font-size: var(--crm-fs-body);
            font-weight: 800;
            line-height: 1.2;
            text-decoration: none !important;
            white-space: normal;
            overflow-wrap: anywhere;
        }

        .crm-ficha-ref-bottom-spacer {
            display: block;
            min-height: 1.88rem;
            margin: 0.12rem 0 0 0.72rem;
        }

        div[data-testid="stMarkdownContainer"]:has(.crm-ficha-ref-link) p {
            margin: 0 !important;
        }

        .crm-ficha-ref-status {
            display: inline-flex;
            align-items: center;
            justify-content: center;
            min-height: 1.75rem;
            min-width: 3.6rem;
            border-radius: 7px;
            border: 1px solid var(--crm-border-strong);
            padding: 0 0.62rem;
            color: #334155;
            background: #ffffff;
            font-size: var(--crm-fs-meta);
            font-weight: 760;
            text-decoration: none !important;
            white-space: nowrap;
        }

        .crm-ficha-ref-link,
        .crm-ficha-ref-link:visited,
        .crm-ficha-ref-link:hover,
        .crm-ficha-ref-link:active {
            color: #2563eb !important;
            text-decoration: none !important;
        }

        .crm-ficha-ref-link:hover {
            color: #1d4ed8 !important;
        }

        .crm-ficha-ref-status.linked {
            border-color: #15803d;
            color: #ffffff;
            background: #2f7d3f;
        }

        .crm-ficha-ref-status.unlinked {
            border-color: #111827;
            color: #ffffff;
            background: #111827;
        }

        div[data-testid="stElementContainer"]:has(.crm-ref-edit-button-scope) {
            height: 0 !important;
            margin: 0 !important;
            padding: 0 !important;
            overflow: hidden !important;
        }

        div[data-testid="stElementContainer"]:has(.crm-ref-edit-button-scope) + div[data-testid="stElementContainer"] div.stButton > button {
            min-height: 1.88rem !important;
            height: 1.88rem !important;
            border-radius: 8px !important;
            padding: 0 0.62rem !important;
            font-size: var(--crm-fs-meta) !important;
            font-weight: 740 !important;
            white-space: nowrap !important;
        }

        div[data-testid="stElementContainer"]:has(.crm-ref-edit-button-scope) + div[data-testid="stElementContainer"] button[data-testid^="stBaseButton"] {
            min-height: 1.88rem !important;
            height: 1.88rem !important;
            border-radius: 8px !important;
            padding: 0 0.62rem !important;
            font-size: var(--crm-fs-meta) !important;
            font-weight: 740 !important;
            white-space: nowrap !important;
        }

        div[data-testid="stElementContainer"]:has(.crm-ref-edit-button-scope) + div[data-testid="stElementContainer"] div.stButton > button p {
            font-size: var(--crm-fs-meta) !important;
            line-height: 1 !important;
        }

        div[data-testid="stElementContainer"]:has(.crm-ref-edit-button-scope.linked) + div[data-testid="stElementContainer"] div.stButton > button {
            background: #15803d !important;
            border-color: #15803d !important;
            color: #ffffff !important;
        }

        div[data-testid="stElementContainer"]:has(.crm-ref-edit-button-scope.linked) + div[data-testid="stElementContainer"] button[data-testid^="stBaseButton"] {
            background: #15803d !important;
            border-color: #15803d !important;
            color: #ffffff !important;
        }

        div[data-testid="stElementContainer"]:has(.crm-ref-edit-button-scope.unlinked) + div[data-testid="stElementContainer"] div.stButton > button {
            background: #0f172a !important;
            border-color: #0f172a !important;
            color: #ffffff !important;
        }

        div[data-testid="stElementContainer"]:has(.crm-ref-edit-button-scope.unlinked) + div[data-testid="stElementContainer"] button[data-testid^="stBaseButton"] {
            background: #0f172a !important;
            border-color: #0f172a !important;
            color: #ffffff !important;
        }

        .crm-ficha-coach-shell {
            border: 0;
            border-radius: 10px;
            background: var(--crm-surface);
            box-shadow: 0 10px 26px rgba(15, 23, 42, 0.055);
            padding: 0.8rem 0.85rem;
            margin-bottom: 1rem;
        }

        .crm-ficha-coach-shell .coach-floating-bot {
            transform: scale(0.84);
            transform-origin: top center;
            height: 7.7rem;
            margin-top: 0;
        }

        .crm-ficha-coach-shell .coach-chat-scroll {
            max-height: 14rem;
        }

        @media (max-width: 900px) {
            .crm-contact-grid {
                grid-template-columns: 1fr;
            }
        }

        .coach-floating-bot {
            position: sticky;
            top: 5rem;
            width: 6.9rem;
            height: 8.9rem;
            margin: 0.35rem auto 0.45rem auto;
            pointer-events: none;
            z-index: 1;
        }

        .coach-floating-bot-mini {
            position: relative;
            top: auto;
            transform: none;
            transform-origin: top center;
            width: 72px;
            height: 98px;
            margin: 0 0 0.35rem -0.38rem;
        }

        div[data-testid="stVerticalBlock"]:has(.coach-floating-bot-mini) {
            gap: 0.35rem !important;
        }

        .coach-floating-bot-mini .coach-bot {
            width: 72px;
            height: 98px;
            margin: 0 auto;
        }

        .coach-floating-bot-mini .coach-bot-antenna {
            height: 17px;
        }

        .coach-floating-bot-mini .coach-bot-antenna::after {
            top: -5px;
            width: 9px;
            height: 9px;
        }

        .coach-floating-bot-mini .coach-bot-head {
            left: 10px;
            top: 16px;
            width: 52px;
            height: 43px;
            border-radius: 15px 15px 12px 12px;
            gap: 8px;
        }

        .coach-floating-bot-mini .coach-bot-eye {
            width: 7px;
            height: 7px;
        }

        .coach-floating-bot-mini .coach-bot-mouth {
            left: 19px;
            bottom: 9px;
            width: 14px;
        }

        .coach-floating-bot-mini .coach-bot-neck {
            left: 29px;
            top: 57px;
            width: 14px;
            height: 8px;
        }

        .coach-floating-bot-mini .coach-bot-body {
            left: 13px;
            top: 64px;
            width: 46px;
            height: 31px;
            border-radius: 12px 12px 15px 15px;
        }

        .coach-floating-bot-mini .coach-bot-panel {
            left: 6px;
            top: 6px;
            width: 32px;
            height: 16px;
            font-size: 0.52rem;
        }

        .coach-bot-name {
            position: relative;
            text-align: center;
            color: #0f172a;
            font-family: "Comic Sans MS", "Segoe Print", cursive;
            font-size: 0.96rem;
            font-weight: 760;
            line-height: 1;
            transform: rotate(-3deg);
            z-index: 2;
            margin-top: -0.16rem;
        }

        .coach-bot {
            position: relative;
            width: 88px;
            height: 118px;
            margin: 0.2rem auto 0 auto;
            animation: coachFloat 3.8s ease-in-out infinite;
        }

        .coach-bot-antenna {
            position: absolute;
            left: 50%;
            top: 0;
            width: 2px;
            height: 20px;
            background: #64748b;
            transform: translateX(-50%);
        }

        .coach-bot-antenna::after {
            content: "";
            position: absolute;
            left: 50%;
            top: -6px;
            width: 10px;
            height: 10px;
            border-radius: 999px;
            background: #2563eb;
            transform: translateX(-50%);
            box-shadow: 0 0 0 4px rgba(37, 99, 235, 0.12);
        }

        .coach-bot-head {
            position: absolute;
            left: 12px;
            top: 18px;
            width: 64px;
            height: 52px;
            border: 2px solid #334155;
            border-radius: 18px 18px 14px 14px;
            background: #dbeafe;
            display: flex;
            align-items: center;
            justify-content: center;
            gap: 10px;
        }

        .coach-bot-eye {
            width: 8px;
            height: 8px;
            border-radius: 999px;
            background: #0f172a;
            animation: coachBlink 4.8s ease-in-out infinite;
        }

        .coach-bot-mouth {
            position: absolute;
            left: 24px;
            bottom: 11px;
            width: 16px;
            height: 2px;
            border-radius: 999px;
            background: #475569;
        }

        .coach-bot-neck {
            position: absolute;
            left: 36px;
            top: 68px;
            width: 16px;
            height: 10px;
            background: #94a3b8;
            border-left: 2px solid #334155;
            border-right: 2px solid #334155;
        }

        .coach-bot-body {
            position: absolute;
            left: 16px;
            top: 76px;
            width: 56px;
            height: 38px;
            border: 2px solid #334155;
            border-radius: 14px 14px 18px 18px;
            background: #f1f5f9;
        }

        .coach-bot-panel {
            position: absolute;
            left: 7px;
            top: 8px;
            width: 40px;
            height: 18px;
            border-radius: 6px;
            border: 1px solid #cbd5e1;
            background: #ffffff;
            display: flex;
            align-items: center;
            justify-content: center;
            gap: 1px;
            font-family: "Comic Sans MS", "Segoe Print", cursive;
            font-size: 0.62rem;
            font-weight: 800;
            letter-spacing: 0;
            transform: rotate(-5deg);
        }

        .coach-bot-panel span:nth-child(1) { color: #dc2626; }
        .coach-bot-panel span:nth-child(2) { color: #ea580c; }
        .coach-bot-panel span:nth-child(3) { color: #ca8a04; }
        .coach-bot-panel span:nth-child(4) { color: #16a34a; }
        .coach-bot-panel span:nth-child(5) { color: #2563eb; }

        body:has(.coach-message:hover) .coach-floating-bot .coach-bot-mouth,
        body:has(.coach-message[open]) .coach-floating-bot .coach-bot-mouth {
            height: 7px;
            bottom: 8px;
            border-radius: 0 0 10px 10px;
            animation: coachTalk 0.38s ease-in-out infinite;
        }

        @keyframes coachFloat {
            0%, 100% { transform: translateY(0); }
            50% { transform: translateY(-6px); }
        }

        @keyframes coachBlink {
            0%, 92%, 100% { transform: scaleY(1); }
            95% { transform: scaleY(0.15); }
        }

        @keyframes coachTalk {
            0%, 100% { height: 3px; bottom: 10px; }
            50% { height: 9px; bottom: 7px; }
        }

        .coach-message {
            position: relative;
            border: 0;
            background: var(--crm-surface-soft);
            border-radius: 14px 14px 14px 5px;
            margin: 0 0 0.38rem 0.72rem;
            box-shadow: 0 1px 2px rgba(15, 23, 42, 0.035);
            overflow: visible;
        }

        .coach-message::before {
            content: "";
            position: absolute;
            left: -13px;
            top: 13px;
            width: 20px;
            height: 20px;
            background: var(--crm-surface-soft);
            border-left: 0;
            border-bottom: 0;
            border-bottom-left-radius: 6px;
            transform: rotate(45deg) skew(-14deg, -14deg);
            z-index: 0;
        }

        .coach-message summary {
            position: relative;
            z-index: 1;
            display: flex;
            align-items: center;
            gap: 0.42rem;
            padding: 0.46rem 0.64rem;
            cursor: pointer;
            list-style: none;
            color: #1f2937;
            min-height: 2.15rem;
        }

        .coach-message summary::-webkit-details-marker {
            display: none;
        }

        .coach-message summary::after {
            content: "+";
            margin-left: auto;
            color: var(--crm-muted);
            font-weight: 700;
        }

        .coach-message[open] summary::after {
            content: "-";
        }

        .coach-message-date {
            flex: 0 0 auto;
            color: var(--crm-muted);
            font-size: 0.78rem;
            font-weight: 650;
            white-space: nowrap;
        }

        .coach-message-text {
            min-width: 0;
            overflow: hidden;
            text-overflow: ellipsis;
            white-space: nowrap;
            font-size: 0.91rem;
            line-height: 1.25;
        }

        .coach-message.compact {
            margin-left: 0.52rem;
            margin-bottom: 0.34rem;
        }

        .coach-message.compact summary {
            padding: 0.42rem 0.56rem;
            min-height: 2rem;
            gap: 0.34rem;
        }

        .coach-message.compact .coach-message-date {
            flex: 0 0 2.36rem;
            font-size: 0.72rem;
        }

        .coach-message.compact .coach-message-text {
            font-size: 0.84rem;
        }

        .coach-message:hover {
            border-color: #cbd5e1;
            background: #fbfdff;
        }

        .coach-message:hover::before {
            background: #fbfdff;
            border-color: #cbd5e1;
        }

        .coach-message:hover .coach-message-text,
        .coach-message[open] .coach-message-text {
            white-space: normal;
        }

        .coach-contact-full {
            display: none;
        }

        .coach-message[open] .coach-contact-short {
            display: none;
        }

        .coach-message[open] .coach-contact-full {
            display: inline;
        }

        .coach-message-detail {
            position: relative;
            z-index: 1;
            display: none;
            padding: 0 0.72rem 0.68rem 0.72rem;
            color: var(--crm-muted);
            font-size: 0.84rem;
            line-height: 1.38;
        }

        .coach-message:hover .coach-message-detail,
        .coach-message[open] .coach-message-detail {
            display: block;
        }

        .coach-message-actions {
            display: flex;
            flex-wrap: wrap;
            gap: 0.5rem;
            align-items: center;
            margin-top: 0.3rem;
            padding-top: 0.3rem;
            border-top: 1px solid var(--crm-border);
            font-size: 0.78rem;
        }

        .coach-contact-link {
            color: #2563eb;
            font-weight: 650;
            text-decoration: none;
        }

        .coach-contact-link:hover {
            color: #1d4ed8;
            text-decoration: underline;
        }

        .coach-message .coach-state {
            font-size: 0.86rem;
        }

        .coach-message .coach-state::before {
            width: 0.52rem;
            height: 0.52rem;
            border-radius: 2px;
        }

        .coach-todo-meta {
            display: flex;
            gap: 0.4rem;
            flex-wrap: wrap;
            color: var(--crm-muted);
            font-size: 0.72rem;
            font-weight: 650;
            text-transform: uppercase;
            letter-spacing: 0.03em;
            margin-bottom: 0.38rem;
        }

        .coach-todo-meta span {
            border: 1px solid var(--crm-border);
            background: var(--crm-surface-soft);
            border-radius: 999px;
            padding: 0.12rem 0.42rem;
        }

        .coach-state {
            display: inline-flex;
            align-items: center;
            gap: 0.3rem;
            font-weight: 700;
            white-space: nowrap;
        }

        .coach-state::before {
            content: "";
            width: 0.62rem;
            height: 0.62rem;
            border-radius: 3px;
            display: inline-block;
        }

        .coach-state-pendiente::before { background: #dc2626; }
        .coach-state-contactado::before { background: #ea580c; }
        .coach-state-agendado::before { background: #16a34a; }
        .coach-state-cita::before { background: #0284c7; }
        .coach-state-agradecimiento::before { background: #1d4ed8; }
        .coach-state-neutro::before { background: #64748b; }

        .coach-muted {
            color: var(--crm-muted);
            font-style: italic;
        }

        @media (max-width: 900px) {
            .main .block-container {
                padding-left: 1rem;
                padding-right: 1rem;
            }

            .crm-brand {
                font-size: 0.95rem;
            }

            .crm-page-title {
                font-size: 1.3rem;
            }

            .coach-floating-bot {
                width: 5.4rem;
                height: 6.8rem;
                transform: scale(0.82);
                transform-origin: top right;
                margin: 0.2rem auto 0.4rem auto;
            }

            .coach-floating-bot-mini {
                width: 72px;
                height: 98px;
                transform: none;
                transform-origin: top center;
            }

            .coach-message summary {
                align-items: flex-start;
                flex-direction: column;
                gap: 0.18rem;
            }

            .coach-message-text {
                white-space: normal;
            }
        }
    </style>
    """, unsafe_allow_html=True)


aplicar_estilos_globales()

# 1. CONTROL DE NAVEGACIÓN (Inicialización en Session State)
if "pagina_activa" not in st.session_state:
    st.session_state["pagina_activa"] = "Networking"

if "contacto_seleccionado" not in st.session_state:
    st.session_state["contacto_seleccionado"] = None

if "contacto_url_cargado" not in st.session_state:
    st.session_state["contacto_url_cargado"] = ""

def cargar_pagina_desde_url():
    try:
        pagina_url = str(st.query_params.get("page", "")).strip().lower()
    except Exception:
        return
    mapa_paginas = {
        "dashboard": "Dashboard",
        "contactos": "Networking",
        "networking": "Networking",
        "empresas": "Empresas",
        "iconos": "Iconos",
    }
    if pagina_url in mapa_paginas:
        st.session_state["pagina_activa"] = mapa_paginas[pagina_url]

def cargar_contacto_desde_url():
    try:
        vista_url = str(st.query_params.get("view", "")).strip().lower()
        google_id_url = str(st.query_params.get("google_id", "")).strip()
    except Exception:
        return

    if vista_url not in ["contacto", "contact"] or not google_id_url:
        return
    if st.session_state.get("contacto_url_cargado") == google_id_url:
        return

    creds_url = autenticar_google()
    df_contactos_url = leer_sheet_local(creds_url)
    if df_contactos_url.empty or "Google_ID" not in df_contactos_url.columns:
        return

    match_contacto = df_contactos_url[
        df_contactos_url["Google_ID"].astype(str).str.strip() == google_id_url
    ]
    if match_contacto.empty:
        return

    st.session_state["contacto_seleccionado"] = match_contacto.iloc[0].to_dict()
    st.session_state["pagina_activa"] = "Ficha_Contacto"
    st.session_state["contacto_url_cargado"] = google_id_url

cargar_pagina_desde_url()
cargar_contacto_desde_url()

# 2. BARRA DE NAVEGACIÓN SUPERIOR
pagina_actual = st.session_state["pagina_activa"]
active_dash = " active" if pagina_actual == "Dashboard" else ""
active_contactos = " active" if pagina_actual in ["Networking", "Ficha_Contacto"] else ""
active_empresas = " active" if pagina_actual == "Empresas" else ""
st.markdown(
    f"""
    <div class="crm-topbar">
        <div class="crm-brand">
            <span class="crm-brand-mark">CN</span>
            <span>CRM Networking</span>
        </div>
        <nav class="crm-nav" aria-label="Navegación principal">
            <a class="crm-nav-link{active_dash}" href="/?page=dashboard" target="_self">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><path d="M4 19V5"/><path d="M4 19h16"/><path d="M8 16V9"/><path d="M13 16V6"/><path d="M18 16v-4"/></svg>
                <span>Dashboard</span>
            </a>
            <a class="crm-nav-link{active_contactos}" href="/?page=contactos" target="_self">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><path d="M16 11a4 4 0 1 0-8 0"/><path d="M3 21a7 7 0 0 1 18 0"/></svg>
                <span>Contactos</span>
            </a>
            <a class="crm-nav-link{active_empresas}" href="/?page=empresas" target="_self">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><path d="M4 21V7l8-4 8 4v14"/><path d="M9 21v-7h6v7"/><path d="M8 9h.01"/><path d="M16 9h.01"/></svg>
                <span>Empresas</span>
            </a>
        </nav>
    </div>
    """,
    unsafe_allow_html=True
)

def render_page_header(titulo, subtitulo=""):
    subtitulo_html = f'<div class="crm-page-caption">{subtitulo}</div>' if subtitulo else ""
    st.markdown(
        f"""
        <div class="crm-page-header">
            <div class="crm-page-title">{titulo}</div>
            {subtitulo_html}
        </div>
        """,
        unsafe_allow_html=True
    )

def opciones_orden_contactos():
    return {
        "Dias ultima interaccion": "Dias_Ultima_Interaccion",
        "Nombre": "Nombre_Visual",
        "Empresa": "Empresa_Google",
        "Cargo": "Cargo_Google",
        "Estado CRM": "Estado_CRM",
        "Marca scope": "Scope_Networking",
        "Headhunter": "Es_Headhunter",
    }

def valores_unicos_contactos(df, columna):
    if df is None or df.empty or columna not in df.columns:
        return []
    return sorted([
        str(x).strip()
        for x in df[columna].dropna().astype(str).unique()
        if str(x).strip() != ""
    ])

def opciones_dominios_hh_contactos(df):
    dominios = set()
    if df is None or df.empty or "Dominios_Filtro_HH" not in df.columns:
        return []
    for valor in df["Dominios_Filtro_HH"].dropna().astype(str):
        for dominio in valor.split(";"):
            dominio = dominio.strip()
            if dominio:
                dominios.add(dominio)
    return sorted(dominios)

def inicializar_filtro_contactos(df_contactos):
    defaults = {
        "contactos_filter_pipeline": [],
        "contactos_filter_nombre": "",
        "contactos_filter_correo": "",
        "contactos_filter_telefono": "",
        "contactos_filter_empresas": [],
        "contactos_filter_cargos": [],
        "contactos_filter_scope": ["TRUE"] if "TRUE" in valores_unicos_contactos(df_contactos, "Scope_Networking") else [],
        "contactos_filter_hh": [],
        "contactos_filter_dominios_hh": [],
        "contactos_filter_estado_contacto": ["Activo"] if "Activo" in valores_unicos_contactos(df_contactos, "Estado_Contacto") else [],
        "contactos_filter_estado_sync": [],
        "contactos_sort_label": "Dias ultima interaccion",
        "contactos_sort_direction": "Menor a mayor",
    }
    if not st.session_state.get("contactos_filter_initialized_v1"):
        for key, value in defaults.items():
            st.session_state.setdefault(key, value)
        st.session_state["contactos_filter_initialized_v1"] = True

    opciones_por_key = {
        "contactos_filter_pipeline": estados_networking_oficiales(),
        "contactos_filter_empresas": valores_unicos_contactos(df_contactos, "Empresa_Google"),
        "contactos_filter_cargos": valores_unicos_contactos(df_contactos, "Cargo_Google"),
        "contactos_filter_scope": valores_unicos_contactos(df_contactos, "Scope_Networking"),
        "contactos_filter_hh": valores_unicos_contactos(df_contactos, "Es_Headhunter"),
        "contactos_filter_dominios_hh": opciones_dominios_hh_contactos(df_contactos),
        "contactos_filter_estado_contacto": valores_unicos_contactos(df_contactos, "Estado_Contacto"),
        "contactos_filter_estado_sync": ["Nuevo", "Actualizado", "Desactivado", "Nunca Sincronizado"],
    }
    for key, opciones in opciones_por_key.items():
        actuales = st.session_state.get(key, [])
        st.session_state[key] = [valor for valor in actuales if valor in opciones]

def obtener_estado_filtro_contactos():
    return {
        "pipeline": st.session_state.get("contactos_filter_pipeline", []),
        "nombre": st.session_state.get("contactos_filter_nombre", ""),
        "correo": st.session_state.get("contactos_filter_correo", ""),
        "telefono": st.session_state.get("contactos_filter_telefono", ""),
        "empresas": st.session_state.get("contactos_filter_empresas", []),
        "cargos": st.session_state.get("contactos_filter_cargos", []),
        "scope": st.session_state.get("contactos_filter_scope", []),
        "headhunter": st.session_state.get("contactos_filter_hh", []),
        "dominios_hh": st.session_state.get("contactos_filter_dominios_hh", []),
        "estado_contacto": st.session_state.get("contactos_filter_estado_contacto", []),
        "estado_sync": st.session_state.get("contactos_filter_estado_sync", []),
        "orden_label": st.session_state.get("contactos_sort_label", "Dias ultima interaccion"),
        "orden_direccion": st.session_state.get("contactos_sort_direction", "Menor a mayor"),
    }

def resetear_filtro_contactos(df_contactos):
    for key in list(st.session_state.keys()):
        if key.startswith("contactos_filter_") or key.startswith("contactos_sort_"):
            del st.session_state[key]
    st.session_state["contactos_filter_initialized_v1"] = False
    inicializar_filtro_contactos(df_contactos)

def aplicar_filtro_contactos(df_contactos, filtro, incluir_pipeline=True, incluir_orden=True):
    df_filtrado = df_contactos.copy() if df_contactos is not None else pd.DataFrame()
    if df_filtrado.empty:
        return df_filtrado

    texto_nombre = str(filtro.get("nombre", "")).strip()
    texto_correo = str(filtro.get("correo", "")).strip()
    texto_telefono = str(filtro.get("telefono", "")).strip()
    if texto_nombre:
        df_filtrado = df_filtrado[df_filtrado["Nombre_Visual"].astype(str).str.contains(texto_nombre, case=False, na=False)]
    if texto_correo:
        df_filtrado = df_filtrado[df_filtrado["Emails_Concatenados"].astype(str).str.contains(texto_correo, case=False, na=False)]
    if texto_telefono:
        df_filtrado = df_filtrado[df_filtrado["Telefonos"].astype(str).str.contains(texto_telefono, case=False, na=False)]

    filtros_in = [
        ("empresas", "Empresa_Google"),
        ("cargos", "Cargo_Google"),
        ("scope", "Scope_Networking"),
        ("headhunter", "Es_Headhunter"),
        ("estado_contacto", "Estado_Contacto"),
    ]
    for key, columna in filtros_in:
        valores = filtro.get(key, [])
        if valores:
            df_filtrado = df_filtrado[df_filtrado[columna].astype(str).isin(valores)]

    dominios = filtro.get("dominios_hh", [])
    if dominios:
        dominios_seleccionados = set(dominios)
        df_filtrado = df_filtrado[
            df_filtrado["Dominios_Filtro_HH"].astype(str).apply(
                lambda valor: bool(dominios_seleccionados.intersection({d.strip() for d in valor.split(";") if d.strip()}))
            )
        ]

    estados_sync = filtro.get("estado_sync", [])
    if estados_sync:
        condicion_estado = pd.Series(False, index=df_filtrado.index)
        for estado in estados_sync:
            condicion_estado = condicion_estado | df_filtrado["Estado_Sync"].astype(str).str.contains(estado, case=False, na=False)
        df_filtrado = df_filtrado[condicion_estado]

    if incluir_pipeline and filtro.get("pipeline"):
        df_filtrado = df_filtrado[df_filtrado["Estado_CRM"].isin(filtro.get("pipeline", []))]

    if incluir_orden:
        opciones_orden = opciones_orden_contactos()
        columna_orden = opciones_orden.get(filtro.get("orden_label"), "Dias_Ultima_Interaccion")
        ascendente = filtro.get("orden_direccion") == "Menor a mayor"
        if columna_orden == "Dias_Ultima_Interaccion":
            df_filtrado["__orden_contactos"] = pd.to_numeric(df_filtrado["Dias_Ultima_Interaccion"], errors="coerce")
            df_filtrado = (
                df_filtrado
                .sort_values(["__orden_contactos", "Nombre_Visual"], ascending=[ascendente, True], na_position="last")
                .drop(columns=["__orden_contactos"])
            )
        else:
            df_filtrado = df_filtrado.sort_values(
                [columna_orden, "Nombre_Visual"],
                ascending=[ascendente, True],
                na_position="last"
            )
    return df_filtrado

def alternar_filtro_pipeline_contactos(etapa, etapas_crm):
    pipeline_actual = set(st.session_state.get("contactos_filter_pipeline", []))
    if etapa in pipeline_actual:
        pipeline_actual.discard(etapa)
    else:
        pipeline_actual.add(etapa)
    st.session_state["contactos_filter_pipeline"] = [e for e in etapas_crm if e in pipeline_actual]

def render_pipeline_contactos(df_base_filtrada, etapas_crm):
    df_solo_scope = df_base_filtrada[df_base_filtrada["Scope_Networking"] == "TRUE"].copy()
    flujo_principal = [
        ("Pendiente", "Pendientes", "contactos_pipeline_pendiente"),
        ("Contactado", "Contactado", "contactos_pipeline_contactado"),
        ("Agendado", "Agendado", "contactos_pipeline_agendado"),
        ("Cita concretada", "Cita concretada", "contactos_pipeline_cita_concretada"),
        ("Agradecimiento enviado", "Agradecimiento", "contactos_pipeline_agradecimiento"),
    ]
    pipeline_actual = set(st.session_state.get("contactos_filter_pipeline", []))
    cols_flujo = st.columns(len(flujo_principal), gap="small")
    for idx_flujo, (etapa, label, key_btn) in enumerate(flujo_principal):
        cnt = len(df_solo_scope[df_solo_scope["Estado_CRM"] == etapa])
        activo = etapa in pipeline_actual
        sufijo = " ›" if idx_flujo < len(flujo_principal) - 1 else ""
        with cols_flujo[idx_flujo]:
            st.button(
                f"{label} ({cnt}){sufijo}",
                key=key_btn,
                use_container_width=True,
                type="primary" if activo else "secondary",
                on_click=alternar_filtro_pipeline_contactos,
                args=(etapa, etapas_crm),
            )
    return st.session_state.get("contactos_filter_pipeline", [])

def render_filtro_contactos_global(df_contactos):
    opciones_orden = opciones_orden_contactos()
    with st.expander("Filtros y orden", expanded=False):
        f1_c1, f1_c2, f1_c3 = st.columns(3)
        with f1_c1:
            st.text_input("Nombre contiene", key="contactos_filter_nombre")
        with f1_c2:
            st.text_input("Correo contiene", key="contactos_filter_correo")
        with f1_c3:
            st.text_input("Telefono contiene", key="contactos_filter_telefono")

        f2_c1, f2_c2, f2_c3 = st.columns(3)
        with f2_c1:
            st.multiselect("Empresa", options=valores_unicos_contactos(df_contactos, "Empresa_Google"), key="contactos_filter_empresas")
        with f2_c2:
            st.multiselect("Cargo", options=valores_unicos_contactos(df_contactos, "Cargo_Google"), key="contactos_filter_cargos")
        with f2_c3:
            st.multiselect("Marca scope", options=valores_unicos_contactos(df_contactos, "Scope_Networking"), key="contactos_filter_scope")

        f3_c1, f3_c2, f3_c3 = st.columns(3)
        with f3_c1:
            st.multiselect("Headhunter", options=valores_unicos_contactos(df_contactos, "Es_Headhunter"), key="contactos_filter_hh")
        with f3_c2:
            st.multiselect("Empresa headhunter", options=opciones_dominios_hh_contactos(df_contactos), key="contactos_filter_dominios_hh")
        with f3_c3:
            st.multiselect("Estado contacto", options=valores_unicos_contactos(df_contactos, "Estado_Contacto"), key="contactos_filter_estado_contacto")

        f4_c1, f4_c2, f4_c3 = st.columns([1.6, 1.3, 3.1], gap="small")
        with f4_c1:
            st.selectbox("Ordenar por", options=list(opciones_orden.keys()), key="contactos_sort_label")
        with f4_c2:
            st.segmented_control("Direccion", options=["Menor a mayor", "Mayor a menor"], key="contactos_sort_direction")
        with f4_c3:
            st.multiselect(
                "Estado sync contiene",
                options=["Nuevo", "Actualizado", "Desactivado", "Nunca Sincronizado"],
                key="contactos_filter_estado_sync"
            )

        _, c_limpiar = st.columns([5.6, 1.2])
        with c_limpiar:
            if st.button("Limpiar filtros", key="btn_contactos_limpiar_filtros", use_container_width=True):
                resetear_filtro_contactos(df_contactos)
                st.rerun()

# 3. MOLDES DE LAS VISTAS FUTURAS (Para modularizar y no mezclar códigos)
def mostrar_vista_dashboard():
    from datetime import datetime
    render_page_header("Dashboard", "Actividad, seguimiento y sugerencias para gestionar tu networking.")

    etapas_crm = estados_networking_oficiales()
    creds = autenticar_google()

    df_contactos = leer_sheet_local(creds)
    df_interacciones = leer_interacciones_todas(creds)
    df_relaciones = leer_relaciones_sheet(creds)
    df_todos_ia = leer_todos_ia(creds)

    if df_contactos.empty:
        st.warning("No hay contactos disponibles en el CRM.")
        return

    for col in ["Scope_Networking", "Estado_CRM", "Es_Headhunter", "Dominios_Headhunter", "Estado_Contacto", "Google_ID", "Nombre_Visual", "Empresa_Google", "Cargo_Google", "Emails_Concatenados"]:
        if col not in df_contactos.columns:
            df_contactos[col] = ""
    df_contactos["Scope_Networking"] = df_contactos["Scope_Networking"].astype(str).str.strip().str.upper()
    df_contactos["Es_Headhunter"] = df_contactos["Es_Headhunter"].astype(str).str.strip().str.upper()
    df_contactos["Estado_Contacto"] = df_contactos["Estado_Contacto"].replace("", "Activo").fillna("Activo").astype(str).str.strip()

    columnas_hitos = columnas_fechas_crm_legacy()
    for col in columnas_hitos:
        if col not in df_contactos.columns:
            df_contactos[col] = ""
    df_contactos["Estado_CRM"] = df_contactos.apply(calcular_estado_networking_desde_row, axis=1)

    etapas_accionables = estados_networking_oficiales()[1:]

    df_scope = df_contactos[
        (df_contactos["Scope_Networking"] == "TRUE") &
        (df_contactos["Estado_Contacto"].astype(str).str.strip() != "Desactivado")
    ].copy()
    df_activos = df_scope[df_scope["Estado_CRM"].isin(etapas_accionables)].copy()

    if not df_interacciones.empty and "Google_ID" in df_interacciones.columns:
        df_interacciones["Google_ID"] = df_interacciones["Google_ID"].astype(str).str.strip()
        df_interacciones["Fecha_DT"] = pd.to_datetime(df_interacciones.get("Fecha", ""), format="%d/%m/%Y", errors="coerce")
        ultimas = (
            df_interacciones.dropna(subset=["Fecha_DT"])
            .sort_values("Fecha_DT")
            .groupby("Google_ID", as_index=False)
            .tail(1)[["Google_ID", "Fecha_DT", "Tipo", "Asunto_Titulo"]]
        )
    else:
        ultimas = pd.DataFrame(columns=["Google_ID", "Fecha_DT", "Tipo", "Asunto_Titulo"])

    df_activos = pd.merge(df_activos, ultimas, on="Google_ID", how="left")

    df_activos["Ultimo_Contacto_DT"] = df_activos["Fecha_DT"]
    hoy = pd.Timestamp(datetime.now().date())
    df_activos["Dias_sin_contacto"] = (hoy - df_activos["Ultimo_Contacto_DT"]).dt.days
    df_activos["Tipo"] = df_activos["Tipo"].fillna("Sin interacción")
    df_activos["Asunto_Titulo"] = df_activos["Asunto_Titulo"].fillna("")

    df_scope_interacciones = pd.merge(df_scope, ultimas, on="Google_ID", how="left")
    df_scope_interacciones["Ultimo_Contacto_DT"] = df_scope_interacciones["Fecha_DT"]
    df_scope_interacciones["Dias_sin_contacto"] = (hoy - df_scope_interacciones["Ultimo_Contacto_DT"]).dt.days
    df_scope_interacciones["Tipo"] = df_scope_interacciones["Tipo"].fillna("Sin interacción")
    df_scope_interacciones["Asunto_Titulo"] = df_scope_interacciones["Asunto_Titulo"].fillna("")

    modo_kpi = st.segmented_control(
        "Periodo KPI",
        options=["Semanal", "Mensual"],
        default="Semanal",
        key="dashboard_modo_kpi"
    )
    fecha_inicio_networking = leer_fecha_inicio_config(creds)
    periodos_metricas, granularidad_metricas = periodos_kpi(
        hoy,
        modo_kpi,
        fecha_inicio_networking=fecha_inicio_networking,
        max_periodos=12,
    )
    df_hh_scope_metricas = df_scope[df_scope["Es_Headhunter"] == "TRUE"].copy()
    tipos_cafes = ["Cita", "Reunion", "Reunión", "Llamada"]
    serie_citas_llamadas = serie_interacciones_periodos(
        df_interacciones,
        periodos_metricas,
        tipos=tipos_cafes,
        contactos_unicos=False,
        granularidad=granularidad_metricas
    )
    acumulado_cafes = acumulado_interacciones_hasta(
        df_interacciones,
        tipos=tipos_cafes,
        hasta=hoy,
        solo_salientes=False
    )
    serie_contactados, serie_contactados_primera_vez, acumulado_contactados = serie_contactos_realizados_periodos(
        df_interacciones,
        periodos_metricas,
        granularidad=granularidad_metricas,
        hasta=hoy
    )
    serie_hh_realizados, serie_hh_primera_vez, acumulado_hh_realizados = serie_dominios_hh_realizados_periodos(
        df_interacciones,
        df_hh_scope_metricas,
        periodos_metricas,
        granularidad=granularidad_metricas,
        hasta=hoy
    )

    c1, c2, c3 = st.columns(3)
    with c1:
        render_kpi_periodo(
            "Total cafés",
            serie_citas_llamadas,
            periodos_metricas,
            granularidad_metricas,
            tooltip="Citas + llamadas.",
            acumulado=acumulado_cafes,
        )
    with c2:
        render_kpi_periodo(
            "Contactos realizados",
            serie_contactados,
            periodos_metricas,
            granularidad_metricas,
            tooltip="Cantidad de contactos que recibieron 1 o más mensajes o correos en el periodo, considerando la fecha del mensaje o correo. En correos, solo cuentan los enviados por el usuario.",
            acumulado=acumulado_contactados,
            barras=serie_contactados_primera_vez,
            barras_titulo="Contactados por primera vez",
        )
    with c3:
        render_kpi_periodo(
            "Contactos HH realizados",
            serie_hh_realizados,
            periodos_metricas,
            granularidad_metricas,
            tooltip="Cantidad de empresas/dominios headhunter que recibieron 1 o más mensajes o correos en el periodo, considerando la fecha del mensaje o correo. En correos, solo cuentan los enviados por el usuario.",
            acumulado=acumulado_hh_realizados,
            barras=serie_hh_primera_vez,
            barras_titulo="Empresas HH contactadas por primera vez",
        )

    st.write("---")
    render_panel_todos_ia(creds, df_todos_ia, df_contactos, df_interacciones)

    df_base_vista = df_scope_interacciones[
        (df_scope_interacciones["Estado_CRM"].isin(etapas_accionables)) |
        (df_scope_interacciones["Ultimo_Contacto_DT"].notna())
    ].copy()
    df_hh_scope = df_scope[df_scope["Es_Headhunter"] == "TRUE"].copy()

    if not df_hh_scope.empty:
        st.write("---")
        st.markdown("#### Empresas headhunter")
        df_dominios_hh = construir_resumen_dominios_headhunter(df_hh_scope, ultimas, hoy)
        dominios_disponibles = df_dominios_hh["Dominio"].astype(str).str.strip().tolist()

        if "dash_dominios_hh_seleccionados" not in st.session_state:
            st.session_state["dash_dominios_hh_seleccionados"] = []
        if "dash_dominios_hh_filtro_activo" not in st.session_state:
            st.session_state["dash_dominios_hh_filtro_activo"] = []

        seleccion_dominios = [
            dominio for dominio in st.session_state["dash_dominios_hh_seleccionados"]
            if dominio in dominios_disponibles
        ]
        st.session_state["dash_dominios_hh_seleccionados"] = seleccion_dominios

        df_dominios_editor = df_dominios_hh.copy()
        if "Estado CRM" in df_dominios_editor.columns:
            df_dominios_editor["Estado CRM"] = df_dominios_editor["Estado CRM"].apply(marca_estado_networking)
        df_dominios_editor.insert(
            0,
            "Seleccionar",
            df_dominios_editor["Dominio"].astype(str).str.strip().isin(seleccion_dominios)
        )

        def estilo_no_email(valor):
            return "color: #b91c1c; font-weight: 700;" if str(valor).strip().upper() == "NO EMAIL" else ""

        with st.form("dash_form_dominios_hh", clear_on_submit=False):
            df_dominios_editado = st.data_editor(
                df_dominios_editor.style.applymap(estilo_no_email, subset=["Dominio"]),
                column_config={
                    "Seleccionar": st.column_config.CheckboxColumn("Seleccionar", default=False),
                    "Dominio": st.column_config.TextColumn("Empresa headhunter", disabled=True),
                    "Contactos HH": st.column_config.NumberColumn("Contactos HH", disabled=True),
                    "Estado CRM": st.column_config.TextColumn("Estado CRM", disabled=True),
                    "Último contacto": st.column_config.TextColumn("Último contacto", disabled=True),
                    "Días sin contacto": st.column_config.NumberColumn("Días sin contacto", disabled=True),
                    "Tipo": st.column_config.TextColumn("Tipo", disabled=True),
                    "Asunto": st.column_config.TextColumn("Asunto", disabled=True),
                },
                disabled=[col for col in df_dominios_editor.columns if col != "Seleccionar"],
                use_container_width=True,
                height=220,
                hide_index=True,
                key="dash_editor_dominios_hh"
            )

            c_filtro_hh1, c_filtro_hh2, _ = st.columns([1.25, 1.1, 5.65], gap="small")
            with c_filtro_hh1:
                aplicar_filtro_hh = st.form_submit_button("Filtrar interacciones", use_container_width=True, type="primary")
            with c_filtro_hh2:
                limpiar_filtro_hh = st.form_submit_button("Limpiar filtro", use_container_width=True)

        if aplicar_filtro_hh:
            if hasattr(df_dominios_editado, "data"):
                df_dominios_editado = df_dominios_editado.data
            seleccion_actual = (
                df_dominios_editado[df_dominios_editado["Seleccionar"]]["Dominio"]
                .astype(str)
                .str.strip()
                .tolist()
            )
            st.session_state["dash_dominios_hh_seleccionados"] = seleccion_actual
            st.session_state["dash_dominios_hh_filtro_activo"] = seleccion_actual.copy()
            st.rerun()

        if limpiar_filtro_hh:
            st.session_state["dash_dominios_hh_filtro_activo"] = []
            st.session_state["dash_dominios_hh_seleccionados"] = []
            st.rerun()

        dominios_filtro_activo = [
            dominio for dominio in st.session_state.get("dash_dominios_hh_filtro_activo", [])
            if dominio in dominios_disponibles
        ]
        if dominios_filtro_activo:
            set_dominios_filtro = set(dominios_filtro_activo)
            ids_hh_filtrados = set()
            for _, contacto_hh in df_hh_scope.iterrows():
                if set_dominios_filtro.intersection(set(listar_dominios_headhunter(contacto_hh))):
                    ids_hh_filtrados.add(str(contacto_hh.get("Google_ID", "")).strip())
            df_base_vista = df_scope_interacciones[
                df_scope_interacciones["Google_ID"].astype(str).str.strip().isin(ids_hh_filtrados)
            ].copy()
            st.caption(f"Filtro activo: {', '.join(dominios_filtro_activo)} · {len(ids_hh_filtrados)} contactos HH")

    st.write("---")
    st.markdown("#### Últimas interacciones")
    dias_contacto = df_base_vista["Dias_sin_contacto"]
    buckets_ultimo_contacto = {
        "Menos de 1 mes": dias_contacto.notna() & (dias_contacto < 30),
        "1+ mes": dias_contacto.notna() & (dias_contacto >= 30) & (dias_contacto < 60),
        "2+ meses": dias_contacto.notna() & (dias_contacto >= 60) & (dias_contacto < 90),
        "3 o más meses": dias_contacto.notna() & (dias_contacto >= 90),
        "Sin interacción": dias_contacto.isna(),
    }
    opciones_ultimo_contacto = list(buckets_ultimo_contacto.keys())
    if (
        "dash_tramo_sin_contacto" in st.session_state
        and st.session_state["dash_tramo_sin_contacto"] not in opciones_ultimo_contacto
    ):
        del st.session_state["dash_tramo_sin_contacto"]
    tramo_label = st.segmented_control(
        "Último contacto",
        options=opciones_ultimo_contacto,
        default="Menos de 1 mes",
        format_func=lambda nombre: f"{nombre} ({int(buckets_ultimo_contacto[nombre].sum())})",
        key="dash_tramo_sin_contacto"
    )
    df_rezago = df_base_vista[buckets_ultimo_contacto[tramo_label]].copy()
    df_rezago = df_rezago.sort_values(["Dias_sin_contacto", "Nombre_Visual"], ascending=[False, True])
    df_rezago["Último contacto"] = df_rezago["Ultimo_Contacto_DT"].dt.strftime("%d/%m/%Y").fillna("Sin registro")

    columnas_rezago = ["Google_ID", "Nombre_Visual", "Empresa_Google", "Cargo_Google", "Estado_CRM", "Último contacto", "Dias_sin_contacto", "Tipo", "Asunto_Titulo"]
    df_rezago_editor = df_rezago[[c for c in columnas_rezago if c in df_rezago.columns]].copy()
    if "Estado_CRM" in df_rezago_editor.columns:
        df_rezago_editor["Estado_CRM"] = df_rezago_editor["Estado_CRM"].apply(marca_estado_networking)
    from urllib.parse import quote
    df_rezago_editor.insert(
        0,
        "Ficha",
        df_rezago_editor["Google_ID"].astype(str).str.strip().apply(
            lambda google_id: f"/?view=contacto&google_id={quote(google_id, safe='')}"
        )
    )

    with st.container():
        df_rezago_editado = st.dataframe(
            df_rezago_editor,
            column_config={
                "Ficha": st.column_config.LinkColumn("Ficha", display_text="Abrir"),
                "Google_ID": None,
                "Nombre_Visual": st.column_config.TextColumn("Nombre", disabled=True),
                "Empresa_Google": st.column_config.TextColumn("Empresa", disabled=True),
                "Cargo_Google": st.column_config.TextColumn("Cargo", disabled=True),
                "Estado_CRM": st.column_config.TextColumn("Estado CRM", disabled=True),
                "Último contacto": st.column_config.TextColumn("Último contacto", disabled=True),
                "Dias_sin_contacto": st.column_config.NumberColumn("Días sin contacto", disabled=True),
                "Tipo": st.column_config.TextColumn("Tipo", disabled=True),
                "Asunto_Titulo": st.column_config.TextColumn("Asunto", disabled=True),
            },
            use_container_width=True,
            height=260,
            hide_index=True,
            key="dash_editor_ultimas_interacciones"
        )

        st.caption("Usa la columna Ficha para abrir el contacto en una pestana nueva.")

    ver_contacto_dash = False

    if ver_contacto_dash:
        seleccionados = df_rezago_editado[df_rezago_editado["Seleccionar"]].copy()
        if len(seleccionados) != 1:
            st.warning("Selecciona exactamente un contacto para abrir su ficha.")
        else:
            gid_sel = str(seleccionados.iloc[0]["Google_ID"]).strip()
            contacto_match = df_base_vista[df_base_vista["Google_ID"].astype(str).str.strip() == gid_sel]
            if contacto_match.empty:
                st.warning("No pude encontrar ese contacto en la vista actual.")
            else:
                st.session_state["contacto_seleccionado"] = contacto_match.iloc[0].to_dict()
                st.session_state["pagina_activa"] = "Ficha_Contacto"
                st.rerun()

    st.write("---")
    st.markdown("#### Referidos sugeridos por accionar")
    if df_relaciones.empty:
        st.info("Aún no hay referidos vinculados en CRM_Relaciones.")
    else:
        df_rel = df_relaciones.copy()
        for col in ["Google_ID_Origen", "Nombre_Referido", "Google_ID_Referido", "Notas_Relacion"]:
            if col not in df_rel.columns:
                df_rel[col] = ""
        nombres = dict(zip(df_contactos["Google_ID"].astype(str).str.strip(), df_contactos["Nombre_Visual"]))
        estados = dict(zip(df_contactos["Google_ID"].astype(str).str.strip(), df_contactos["Estado_CRM"]))
        scopes = dict(zip(df_contactos["Google_ID"].astype(str).str.strip(), df_contactos["Scope_Networking"]))
        ids_con_interaccion = set(df_interacciones["Google_ID"].astype(str).str.strip()) if not df_interacciones.empty else set()

        df_rel["Origen"] = df_rel["Google_ID_Origen"].astype(str).str.strip().map(nombres).fillna("Desconocido")
        df_rel["Referido"] = df_rel.apply(
            lambda row: nombres.get(str(row.get("Google_ID_Referido", "")).strip(), str(row.get("Nombre_Referido", "")).strip()),
            axis=1
        )
        df_rel["Estado referido"] = df_rel["Google_ID_Referido"].astype(str).str.strip().map(estados).fillna("Sin contacto CRM")
        df_rel["Scope referido"] = df_rel["Google_ID_Referido"].astype(str).str.strip().map(scopes).fillna("NO")
        df_rel["Origen con interacción"] = df_rel["Google_ID_Origen"].astype(str).str.strip().isin(ids_con_interaccion)
        df_accion = df_rel[
            (df_rel["Origen con interacción"]) &
            (
                df_rel["Google_ID_Referido"].astype(str).str.strip().eq("") |
                (df_rel["Scope referido"] != "TRUE") |
                (df_rel["Estado referido"].isin(["1. Pendiente", "Sin contacto CRM"]))
            )
        ].copy()
        st.dataframe(
            df_accion[["Origen", "Referido", "Estado referido", "Scope referido", "Notas_Relacion"]],
            use_container_width=True,
            height=240,
            hide_index=True
        )

def mostrar_vista_empresas():
    render_page_header("Empresas", "Seguimiento de empresas objetivo y oportunidades.")
    st.caption("Tabla jerarquizada según el flujo de búsqueda de empleo (Placeholder).")


# =========================================================================
# =========================================================================
# FICHA CONTACTO: BLOQUE MODULAR DE DATOS Y ACCIONES
# =========================================================================
def clase_estado_networking(estado):
    estado_norm = normalizar_estado_networking(estado)
    return {
        "Pendiente": "pendiente",
        "Contactado": "contactado",
        "Agendado": "agendado",
        "Cita concretada": "cita",
        "Agradecimiento enviado": "agradecimiento",
    }.get(estado_norm, "neutro")


def separar_valores_contacto(valor):
    texto = str(valor or "").strip()
    if not texto or texto.lower() in ["nan", "null", "none", "sin email", "sin telefono", "#error!"]:
        return []
    partes = []
    for separador in [";", ","]:
        texto = texto.replace(separador, "|")
    for parte in texto.split("|"):
        parte_limpia = parte.strip()
        if parte_limpia:
            partes.append(parte_limpia)
    return partes


def telefono_para_link(valor):
    digitos = "".join(ch for ch in str(valor or "") if ch.isdigit())
    if not digitos:
        return ""
    if str(valor).strip().startswith("+"):
        return f"+{digitos}"
    return digitos


def html_fila_correo_contacto(email):
    email_limpio = str(email or "").strip()
    href = f"mailto:{email_limpio}"
    icono = icono_interaccion_ficha("email")
    return f'<div class="crm-contact-field-row"><span class="crm-contact-value">{html_escape(email_limpio)}</span><a class="crm-contact-mini-link" href="{html_escape(href)}" title="Enviar email">{icono}</a></div>'


def html_fila_telefono_contacto(telefono):
    telefono_limpio = str(telefono or "").strip()
    tel_link = telefono_para_link(telefono_limpio)
    whatsapp_link = "".join(ch for ch in tel_link if ch.isdigit())
    href_tel = f"tel:{tel_link}" if tel_link else "#"
    href_wsp = f"https://wa.me/{whatsapp_link}" if whatsapp_link else "#"
    icono_llamada = icono_interaccion_ficha("llamada")
    icono_mensaje = icono_interaccion_ficha("mensaje")
    return f'<div class="crm-contact-field-row"><span class="crm-contact-value">{html_escape(telefono_limpio)}</span><a class="crm-contact-mini-link" href="{html_escape(href_tel)}" title="Llamar">{icono_llamada}</a><a class="crm-contact-mini-link whatsapp" href="{html_escape(href_wsp)}" target="_blank" title="Escribir por WhatsApp">{icono_mensaje}</a></div>'


def html_datos_contacto_ficha(contacto):
    emails = separar_valores_contacto(contacto.get("Emails_Concatenados", ""))
    telefonos = separar_valores_contacto(contacto.get("Telefonos", ""))
    html_emails = "".join(html_fila_correo_contacto(email) for email in emails)
    html_telefonos = "".join(html_fila_telefono_contacto(tel) for tel in telefonos)
    if not html_emails:
        html_emails = '<em style="color:#94a3b8">sin datos</em>'
    if not html_telefonos:
        html_telefonos = '<em style="color:#94a3b8">sin datos</em>'
    return f'<div class="crm-contact-grid"><div class="crm-contact-field"><div class="crm-contact-field-label">Correos</div>{html_emails}</div><div class="crm-contact-field"><div class="crm-contact-field-label">Telefonos</div>{html_telefonos}</div></div>'


def actualizar_contacto_individual_ficha(creds, contacto, scope=None, headhunter=None, estado=None):
    from datetime import datetime

    google_id = str(contacto.get("Google_ID", "")).strip()
    if not google_id:
        return False, "No pude identificar el contacto."

    df_sheet_actual = leer_sheet_local(creds)
    if df_sheet_actual.empty or "Google_ID" not in df_sheet_actual.columns:
        df_sheet_actual = pd.DataFrame([contacto])

    columnas_base = [
        "Google_ID", "Nombre_Visual", "Emails_Concatenados", "Telefonos",
        "Empresa_Google", "Cargo_Google", "Scope_Networking", "Nivel_Cercania",
        "Es_Headhunter", "Dominios_Headhunter", "Estado_CRM", "Estado_Sync",
        "Estado_Contacto"
    ] + columnas_fechas_crm_legacy()
    for col in columnas_base:
        if col not in df_sheet_actual.columns:
            df_sheet_actual[col] = ""

    condicion = df_sheet_actual["Google_ID"].astype(str).str.strip() == google_id
    if not condicion.any():
        nueva_fila = {col: "" for col in df_sheet_actual.columns}
        for col in df_sheet_actual.columns:
            if col in contacto:
                nueva_fila[col] = contacto.get(col, "")
        nueva_fila["Google_ID"] = google_id
        df_sheet_actual = pd.concat([df_sheet_actual, pd.DataFrame([nueva_fila])], ignore_index=True)
        condicion = df_sheet_actual["Google_ID"].astype(str).str.strip() == google_id

    ahora_string = datetime.now().strftime("%d/%m/%y %H:%M:%S")

    if scope is not None:
        scope_valor = "TRUE" if str(scope).strip().upper() == "TRUE" else "FALSE"
        df_sheet_actual.loc[condicion, "Scope_Networking"] = scope_valor
        df_sheet_actual.loc[condicion, "Estado_Sync"] = f"Foco networking actualizado - {ahora_string}"
        if scope_valor == "TRUE":
            df_sheet_actual.loc[condicion, "Estado_Contacto"] = "Activo"
            sin_fechas = True
            for col_fecha in columnas_fechas_crm_legacy():
                valor_fecha = df_sheet_actual.loc[condicion, col_fecha].iloc[0]
                if pd.notna(valor_fecha) and str(valor_fecha).strip():
                    sin_fechas = False
                    break
            if sin_fechas:
                df_sheet_actual.loc[condicion, "F_Pendiente"] = datetime.now().strftime("%d/%m/%y")

    if headhunter is not None:
        hh_valor = "TRUE" if str(headhunter).strip().upper() == "TRUE" else "FALSE"
        df_sheet_actual.loc[condicion, "Es_Headhunter"] = hh_valor
        emails_contacto = df_sheet_actual.loc[condicion, "Emails_Concatenados"].iloc[0]
        if not str(emails_contacto or "").strip():
            emails_contacto = contacto.get("Emails_Concatenados", "")
        df_sheet_actual.loc[condicion, "Dominios_Headhunter"] = (
            extraer_dominios_desde_emails(emails_contacto)
            if hh_valor == "TRUE"
            else ""
        )
        df_sheet_actual.loc[condicion, "Estado_Sync"] = f"Marca headhunter actualizada - {ahora_string}"

    if estado is not None:
        estado_norm = normalizar_estado_networking(estado)
        columna_hito = columna_fecha_para_estado_networking(estado_norm)
        df_sheet_actual.loc[condicion, "Scope_Networking"] = "TRUE"
        df_sheet_actual.loc[condicion, "Estado_Contacto"] = "Activo"
        df_sheet_actual.loc[condicion, "Estado_CRM"] = estado_norm
        df_sheet_actual.loc[condicion, columna_hito] = datetime.now().strftime("%d/%m/%y")
        df_sheet_actual.loc[condicion, "Estado_Sync"] = f"Estado networking actualizado - {ahora_string}"

    guardar_en_sheet(creds, df_sheet_actual)
    contacto_actualizado = df_sheet_actual.loc[condicion].iloc[0].to_dict()
    st.session_state["contacto_seleccionado"] = contacto_actualizado
    return True, "Contacto actualizado."


def renderizar_bloque_datos_estado_contacto(creds, contacto):
    nombre = str(contacto.get("Nombre_Visual", "") or "Contacto sin nombre").strip()
    empresa = str(contacto.get("Empresa_Google", "") or "").strip()
    cargo = str(contacto.get("Cargo_Google", "") or "").strip()
    subtitulo = " · ".join([x for x in [cargo, empresa] if x])
    estado_actual = normalizar_estado_networking(contacto.get("Estado_CRM", "Pendiente"))
    scope_actual = str(contacto.get("Scope_Networking", "FALSE")).strip().upper() == "TRUE"
    hh_actual = str(contacto.get("Es_Headhunter", "FALSE")).strip().upper() == "TRUE"
    key_base = hash_texto_corto(contacto.get("Google_ID", nombre))

    with st.container(border=True):
        st.markdown('<div class="crm-ficha-panel-marker crm-ficha-contact-section-marker"></div>', unsafe_allow_html=True)
        st.markdown(f'<h2 class="crm-contact-name">{html_escape(nombre)}</h2>', unsafe_allow_html=True)
        if subtitulo:
            st.markdown(f'<p class="crm-contact-role">{html_escape(subtitulo)}</p>', unsafe_allow_html=True)
        st.markdown(html_datos_contacto_ficha(contacto), unsafe_allow_html=True)

        col_scope, col_hh, col_estado, col_btn = st.columns([1.25, 1.35, 3.0, 0.58], gap="small")

        with col_scope:
            dot_scope = "scope" if scope_actual else "neutro"
            st.markdown(f'<div class="crm-action-label with-dot"><span class="crm-status-dot {dot_scope}"></span>Foco</div>', unsafe_allow_html=True)
            nuevo_scope = st.toggle(
                "Foco networking",
                value=scope_actual,
                key=f"toggle_ficha_scope_{key_base}",
                help="Activa o desactiva este contacto del foco de networking",
                label_visibility="collapsed"
            )
            if nuevo_scope != scope_actual:
                ok, msg = actualizar_contacto_individual_ficha(creds, contacto, scope="TRUE" if nuevo_scope else "FALSE")
                st.success(msg) if ok else st.error(msg)
                st.rerun()

        with col_hh:
            dot_hh = "hh" if hh_actual else "neutro"
            st.markdown(f'<div class="crm-action-label with-dot"><span class="crm-status-dot {dot_hh}"></span>Headhunter</div>', unsafe_allow_html=True)
            nuevo_hh = st.toggle(
                "Headhunter",
                value=hh_actual,
                key=f"toggle_ficha_hh_{key_base}",
                help="Marca o desmarca este contacto como headhunter",
                label_visibility="collapsed"
            )
            if nuevo_hh != hh_actual:
                ok, msg = actualizar_contacto_individual_ficha(creds, contacto, headhunter="TRUE" if nuevo_hh else "FALSE")
                st.success(msg) if ok else st.error(msg)
                st.rerun()

        with col_estado:
            clase_estado = clase_estado_networking(estado_actual)
            st.markdown(f'<div class="crm-action-label with-dot"><span class="crm-status-dot {clase_estado}"></span>Estado networking</div>', unsafe_allow_html=True)
            etapas = estados_networking_oficiales()
            idx_estado = etapas.index(estado_actual) if estado_actual in etapas else 0
            estado_seleccionado = st.selectbox(
                "Estado networking",
                options=etapas,
                index=idx_estado,
                key=f"ficha_estado_networking_{key_base}",
                label_visibility="collapsed"
            )

        with col_btn:
            st.markdown('<div class="crm-actions-spacer"></div>', unsafe_allow_html=True)
            if boton_icono_estandar("aplicar", key=f"btn_ficha_estado_apply_{key_base}", help_text="Aplicar estado al contacto"):
                ok, msg = actualizar_contacto_individual_ficha(creds, contacto, estado=estado_seleccionado)
                st.success(msg) if ok else st.error(msg)
                st.rerun()


def renderizar_bloque_referidos_contacto(creds, contacto):
    with st.container(border=True):
        c_titulo, c_accion = st.columns([5, 0.8], gap="small")
        with c_titulo:
            st.markdown("<h4 style='font-size: 1.1em; color: #1e293b; margin: 0 0 12px 0;'>👥 Contactos Vinculados / Referidos</h4>", unsafe_allow_html=True)
        with c_accion:
            boton_vinculos = boton_icono_estandar("agregar", key="btn_global_relaciones_ficha", help_text="Gestionar vínculos y referidos")

        df_relaciones = leer_relaciones_sheet(creds)
        df_maestro_contactos = leer_sheet_local(creds)
        df_rel_filtrado = df_relaciones[
            df_relaciones["Google_ID_Origen"].astype(str).str.strip() == str(contacto["Google_ID"]).strip()
        ]

        if df_rel_filtrado.empty:
            st.caption("*No hay contactos referidos vinculados a este perfil.*")
        else:
            ids_existentes_en_crm = set(df_maestro_contactos["Google_ID"].astype(str).str.strip().unique())

            for _, fila_rel in df_rel_filtrado.iterrows():
                nombre_ref = str(fila_rel.get("Nombre_Referido", "")).strip()
                id_ref = str(fila_rel.get("Google_ID_Referido", "")).strip()
                notas_ref = str(fila_rel.get("Notas_Relacion", "")).strip()

                if id_ref and id_ref in ids_existentes_en_crm:
                    semaforo = "🟢"
                    match_crm = df_maestro_contactos[df_maestro_contactos["Google_ID"].astype(str).str.strip() == id_ref]
                    nombre_despliegue = match_crm.iloc[0]["Nombre_Visual"] if not match_crm.empty else nombre_ref
                else:
                    semaforo = "🔴"
                    nombre_despliegue = nombre_ref if nombre_ref else "Contacto sin Nombre"

                texto_notas = f" <span style='color: #64748b; font-size: 0.85em;'>({notas_ref})</span>" if notas_ref else ""
                st.markdown(f"{semaforo} **{nombre_despliegue}**{texto_notas}", unsafe_allow_html=True)

        if boton_vinculos:
            popup_gestion_vincu_global(creds, df_maestro_contactos, google_id_contexto=contacto["Google_ID"])


@st.dialog("Actualizar Estado de Networking", width="small")
def popup_cambiar_estado_networking(creds, contacto_target):
    nombre = str(contacto_target.get("Nombre_Visual", "este contacto")).strip()
    etapas = estados_networking_oficiales()
    estado_actual = normalizar_estado_networking(contacto_target.get("Estado_CRM", "Pendiente"))
    idx_init = etapas.index(estado_actual) if estado_actual in etapas else 0
    st.write(f"Selecciona el estado de **{nombre}**:")
    etapa_seleccionada = st.selectbox("Estado", etapas, index=idx_init)
    if st.button("Registrar estado", use_container_width=True, type="primary"):
        ok, msg = actualizar_contacto_individual_ficha(creds, contacto_target, estado=etapa_seleccionada)
        st.success(msg) if ok else st.error(msg)
        st.rerun()


def icono_interaccion_ficha(tipo_norm):
    iconos = {
        "email": '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="4" y="6" width="16" height="12" rx="1.8"></rect><path d="m4.5 7 7.5 6 7.5-6"></path></svg>',
        "cita": '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 2v4"></path><path d="M16 2v4"></path><rect x="3" y="4" width="18" height="18" rx="2"></rect><path d="M3 10h18"></path></svg>',
        "mensaje": '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M21 15a4 4 0 0 1-4 4H8l-5 3V7a4 4 0 0 1 4-4h10a4 4 0 0 1 4 4z"></path></svg>',
        "llamada": '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M22 16.9v3a2 2 0 0 1-2.2 2 19.7 19.7 0 0 1-8.6-3.1 19.4 19.4 0 0 1-6-6 19.7 19.7 0 0 1-3.1-8.6A2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1 1 .4 1.9.7 2.8a2 2 0 0 1-.4 2.1L8.1 9.9a16 16 0 0 0 6 6l1.3-1.3a2 2 0 0 1 2.1-.4c.9.3 1.8.6 2.8.7A2 2 0 0 1 22 16.9z"></path></svg>',
        "manual": '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14"></path><path d="M5 12h14"></path></svg>',
    }
    return iconos.get(tipo_norm, iconos["manual"])


def estilo_interaccion_ficha(tipo):
    tipo_norm = str(tipo or "").strip().lower()
    if tipo_norm in ["cita", "reunion", "reunión"]:
        return {"bg": "#E3F2FD", "border": "#2196F3", "icono": icono_interaccion_ficha("cita")}
    if tipo_norm in ["mensaje", "whatsapp"]:
        return {"bg": "#E8F5E9", "border": "#25D366", "icono": icono_interaccion_ficha("mensaje")}
    if tipo_norm == "llamada":
        return {"bg": "#FFFDE7", "border": "#FACC15", "icono": icono_interaccion_ficha("llamada")}
    if tipo_norm == "email":
        return {"bg": "#FBFCFE", "border": "#6C757D", "icono": icono_interaccion_ficha("email")}
    return {"bg": "#F8FAFC", "border": "#94A3B8", "icono": icono_interaccion_ficha("manual")}


ICONOS_UI = {
    "volver": {"label": "Volver", "icon": "arrow_back", "help": "Volver a la vista anterior"},
    "actualizar": {"label": "Actualizar", "icon": "sync", "help": "Sincronizar contacto o actividad"},
    "agregar": {"label": "Agregar", "icon": "add", "help": "Crear nuevo elemento"},
    "editar": {"label": "Editar", "icon": "edit", "help": "Editar minuta o registro"},
    "aplicar": {"label": "Aplicar", "icon": "check", "help": "Confirmar o aplicar cambio"},
    "configurar": {"label": "Configurar", "icon": "settings", "help": "Abrir configuracion"},
    "coach": {"label": "Coach IA", "icon": "auto_awesome", "help": "Buscar sugerencias del Coach"},
    "automatizar": {"label": "Automatizar", "icon": "bolt", "help": "Automatizar una sugerencia"},
    "ejecutar": {"label": "Ejecutar", "icon": "play_arrow", "help": "Ejecutar seleccion"},
    "expandir": {"label": "Expandir", "icon": "unfold_more", "help": "Expandir elementos"},
    "contraer": {"label": "Contraer", "icon": "unfold_less", "help": "Contraer elementos"},
    "seleccionar_todos": {"label": "Seleccionar todos", "icon": "select_check_box", "help": "Seleccionar filas visibles"},
    "limpiar": {"label": "Limpiar", "icon": "close", "help": "Limpiar seleccion"},
    "incluir_foco": {"label": "Incluir foco", "icon": "person_add", "help": "Agregar al foco de networking"},
    "sacar_foco": {"label": "Sacar foco", "icon": "person_remove", "help": "Sacar del foco de networking"},
    "marcar_hh": {"label": "Marcar HH", "icon": "adjust", "help": "Marcar como headhunter"},
    "quitar_hh": {"label": "Quitar HH", "icon": "groups", "help": "Quitar marca headhunter"},
    "etiqueta": {"label": "Etiqueta", "icon": "label", "help": "Filtrar desde etiqueta"},
    "desactivar": {"label": "Desactivar", "icon": "delete", "help": "Desactivar o eliminar"},
}


BOTONES_ACCION_UI = {
    "aceptar": {"label": "Aceptar", "icon": "check", "help": "Aceptar o confirmar", "tone": "primary"},
    "aplicar": {"label": "Aplicar", "icon": "check", "help": "Aplicar cambio", "tone": "primary"},
    "guardar": {"label": "Guardar", "icon": "save", "help": "Guardar cambios", "tone": "primary"},
    "ejecutar": {"label": "Ejecutar", "icon": "play_arrow", "help": "Ejecutar seleccion", "tone": "primary"},
    "cancelar": {"label": "Cancelar", "icon": "close", "help": "Cancelar sin guardar", "tone": "secondary"},
    "cerrar": {"label": "Cerrar", "icon": "close", "help": "Cerrar ventana", "tone": "secondary"},
    "vincular": {"label": "Vincular", "icon": "link", "help": "Vincular contacto", "tone": "primary"},
    "desvincular": {"label": "Desvincular", "icon": "link_off", "help": "Quitar vinculo", "tone": "secondary"},
    "desactivar": {"label": "Desactivar", "icon": "delete", "help": "Desactivar contacto", "tone": "danger"},
    "eliminar": {"label": "Eliminar", "icon": "delete", "help": "Eliminar registro", "tone": "danger"},
    "automatizar": {"label": "Automatizar", "icon": "bolt", "help": "Automatizar regla", "tone": "positive"},
}


PALETA_UI = {
    "Base": [
        {"nombre": "Fondo app", "token": "--crm-bg", "hex": "#f6f7fb", "uso": "Fondo general de pagina"},
        {"nombre": "Panel blanco", "token": "--crm-surface", "hex": "#ffffff", "uso": "Bloques principales y tablas"},
        {"nombre": "Superficie suave", "token": "--crm-surface-soft", "hex": "#fbfcfe", "uso": "Campos, nav, fondos secundarios"},
        {"nombre": "Tarjeta suave", "token": "field-soft", "hex": "#f8fafc", "uso": "Correos, telefonos, tarjetas internas"},
        {"nombre": "Borde", "token": "--crm-border", "hex": "#d9dee8", "uso": "Separadores y contornos sutiles"},
        {"nombre": "Borde fuerte", "token": "--crm-border-strong", "hex": "#cbd5e1", "uso": "Botones, mini links y divisores"},
        {"nombre": "Texto principal", "token": "--crm-text", "hex": "#182230", "uso": "Titulos y contenido principal"},
        {"nombre": "Texto secundario", "token": "--crm-muted", "hex": "#667085", "uso": "Subtitulos, metadata y ayuda"},
        {"nombre": "Texto tenue", "token": "empty-muted", "hex": "#94a3b8", "uso": "Sin datos, placeholders y vacios"},
    ],
    "Acciones": [
        {"nombre": "Primario", "token": "--crm-primary", "hex": "#111827", "uso": "Accion principal"},
        {"nombre": "Primario hover", "token": "--crm-primary-hover", "hex": "#1f2937", "uso": "Hover de accion principal"},
        {"nombre": "Link / acento", "token": "--crm-accent", "hex": "#2563eb", "uso": "Links y acentos navegables"},
        {"nombre": "Positivo", "token": "positive", "hex": "#15803d", "uso": "Vinculado, foco activo, accion positiva"},
        {"nombre": "Destructivo", "token": "danger", "hex": "#dc2626", "uso": "Eliminar, desactivar o alerta critica"},
        {"nombre": "Cambio detectado", "token": "changed", "hex": "#c2410c", "uso": "Campo modificado en previews de sync"},
        {"nombre": "WhatsApp", "token": "whatsapp", "hex": "#128c7e", "uso": "Link inline de mensaje WhatsApp"},
    ],
    "Estados networking": [
        {"nombre": "Pendiente", "token": "estado-pendiente", "hex": "#dc2626", "uso": "Estado oficial pendiente"},
        {"nombre": "Contactado", "token": "estado-contactado", "hex": "#ea580c", "uso": "Estado oficial contactado"},
        {"nombre": "Agendado", "token": "estado-agendado", "hex": "#16a34a", "uso": "Estado oficial agendado"},
        {"nombre": "Cita concretada", "token": "estado-cita", "hex": "#0284c7", "uso": "Estado oficial cita concretada"},
        {"nombre": "Agradecimiento enviado", "token": "estado-agradecimiento", "hex": "#1d4ed8", "uso": "Estado oficial agradecimiento"},
    ],
    "Interacciones": [
        {"nombre": "Correo fondo", "token": "email-bg", "hex": "#FBFCFE", "uso": "Fila de interaccion email"},
        {"nombre": "Correo borde", "token": "email-border", "hex": "#6C757D", "uso": "Borde lateral email"},
        {"nombre": "Cita fondo", "token": "cita-bg", "hex": "#E3F2FD", "uso": "Fila de cita/reunion"},
        {"nombre": "Cita borde", "token": "cita-border", "hex": "#2196F3", "uso": "Borde lateral cita"},
        {"nombre": "Mensaje fondo", "token": "mensaje-bg", "hex": "#E8F5E9", "uso": "Fila de mensaje"},
        {"nombre": "Mensaje borde", "token": "mensaje-border", "hex": "#25D366", "uso": "Borde lateral mensaje"},
        {"nombre": "Llamada fondo", "token": "llamada-bg", "hex": "#FFFDE7", "uso": "Fila de llamada"},
        {"nombre": "Llamada borde", "token": "llamada-border", "hex": "#FACC15", "uso": "Borde lateral llamada"},
    ],
}


def icono_accion_ui(accion):
    return ICONOS_UI.get(str(accion or "").strip(), ICONOS_UI["agregar"])


def boton_accion_estandar(accion, key, label=None, help_text=None, disabled=False, on_click=None, args=None, kwargs=None, use_container_width=False):
    config = BOTONES_ACCION_UI.get(str(accion or "").strip(), BOTONES_ACCION_UI["aceptar"])
    tone = config.get("tone", "secondary")
    st.markdown(f'<span class="crm-action-button-scope {html_escape(tone)}"></span>', unsafe_allow_html=True)
    return st.button(
        label or config["label"],
        icon=f":material/{config['icon']}:",
        key=key,
        help=help_text or config["help"],
        type="primary" if tone == "primary" else "secondary",
        disabled=disabled,
        on_click=on_click,
        args=args or (),
        kwargs=kwargs or {},
        use_container_width=use_container_width,
    )


def boton_icono_estandar(accion, key, help_text=None, variante="square", type="secondary", disabled=False, on_click=None, args=None, kwargs=None):
    config = icono_accion_ui(accion)
    variante_css = "square" if variante == "square" else "rect"
    st.markdown(f'<span class="crm-button-scope {variante_css}"></span>', unsafe_allow_html=True)
    return st.button(
        " ",
        icon=f":material/{config['icon']}:",
        key=key,
        help=help_text or config["help"],
        use_container_width=variante != "square",
        type=type,
        disabled=disabled,
        on_click=on_click,
        args=args or (),
        kwargs=kwargs or {},
    )


def html_card_icono_interaccion(nombre, tipo, descripcion):
    estilo = estilo_interaccion_ficha(tipo)
    return (
        f'<div class="crm-icon-guide-card">'
        f'<span class="crm-ficha-type-icon" style="background:{estilo["bg"]};border-color:{estilo["border"]}">'
        f'{estilo["icono"]}</span>'
        f'<div><div class="crm-icon-guide-title">{html_escape(nombre)}</div>'
        f'<div class="crm-icon-guide-meta">{html_escape(descripcion)}</div>'
        f'<div class="crm-icon-guide-code">tipo: {html_escape(tipo)}</div></div>'
        f'</div>'
    )


def html_card_estado_ui(nombre, clase, descripcion):
    return (
        f'<div class="crm-icon-guide-card">'
        f'<span class="crm-status-dot {clase}"></span>'
        f'<div><div class="crm-icon-guide-title">{html_escape(nombre)}</div>'
        f'<div class="crm-icon-guide-meta">{html_escape(descripcion)}</div>'
        f'</div></div>'
    )


def html_card_color_ui(item):
    return (
        f'<div class="crm-color-guide-card">'
        f'<span class="crm-color-guide-swatch" style="background:{html_escape(item["hex"])}"></span>'
        f'<div><div class="crm-icon-guide-title">{html_escape(item["nombre"])}</div>'
        f'<div class="crm-icon-guide-meta">{html_escape(item["uso"])}</div>'
        f'<div class="crm-icon-guide-code">{html_escape(item["token"])} · {html_escape(item["hex"])}</div>'
        f'</div></div>'
    )


def html_card_link_inline_ui():
    return (
        '<div class="crm-icon-guide-card" style="align-items:flex-start">'
        '<div style="min-width:0;flex:1">'
        '<div class="crm-contact-field-label">Correo</div>'
        f'{html_fila_correo_contacto("correo@ejemplo.cl")}'
        '<div class="crm-contact-field-label" style="margin-top:0.6rem">Telefono</div>'
        f'{html_fila_telefono_contacto("+56 9 1234 5678")}'
        '</div>'
        '<div><div class="crm-icon-guide-title">Link inline</div>'
        '<div class="crm-icon-guide-meta">Accion pequeña pegada a un dato concreto. No reemplaza el boton cuadrado global.</div>'
        '<div class="crm-icon-guide-code">.crm-contact-mini-link</div></div>'
        '</div>'
    )


def mostrar_vista_iconos_ui():
    render_page_header("Guía visual de diseño", "Referencia oculta de iconos, botones y colores usados por la app.")

    st.markdown("### Paleta oficial")
    st.caption("Colores permitidos para mantener consistencia visual. Si falta un color nuevo, primero debe agregarse acá y documentarse su uso.")
    for grupo, colores in PALETA_UI.items():
        st.markdown(f'<div class="crm-color-guide-section"><div class="crm-section-label">{html_escape(grupo)}</div></div>', unsafe_allow_html=True)
        cards_colores = "".join(html_card_color_ui(item) for item in colores)
        st.markdown(f'<div class="crm-color-guide-grid">{cards_colores}</div>', unsafe_allow_html=True)

    st.markdown("### Iconos circulares: tipo de interacción")
    st.caption("Estos iconos identifican el canal real de la interacción. Una interacción cargada manualmente debe elegir uno de estos tipos; manual es origen/carga, no un icono propio.")
    cards_interacciones = [
        html_card_icono_interaccion("Correo", "email", "Emails enviados/recibidos y link para redactar mail."),
        html_card_icono_interaccion("Cita / reunión", "cita", "Eventos de calendario y reuniones."),
        html_card_icono_interaccion("Mensaje", "mensaje", "WhatsApp, LinkedIn u otros mensajes."),
        html_card_icono_interaccion("Llamada", "llamada", "Llamadas o acción de llamar por teléfono."),
    ]
    st.markdown(f'<div class="crm-icon-guide-grid">{"".join(cards_interacciones)}</div>', unsafe_allow_html=True)

    st.markdown("### Links inline: acción pegada a un dato")
    st.caption("Son más pequeños que un botón porque viven dentro de un campo específico, como email o teléfono.")
    st.markdown(f'<div class="crm-icon-guide-grid">{html_card_link_inline_ui()}</div>', unsafe_allow_html=True)

    st.markdown("### Botones cuadrados: acción compacta")
    st.caption("Botón estándar mínimo: 36x36, icono Material de 18px, centrado, sin texto visible y con tooltip.")
    acciones = list(ICONOS_UI.keys())
    for fila_inicio in range(0, len(acciones), 6):
        fila = acciones[fila_inicio:fila_inicio + 6]
        cols = st.columns(6, gap="small")
        for idx in range(6):
            with cols[idx]:
                if idx >= len(fila):
                    st.markdown("&nbsp;", unsafe_allow_html=True)
                    continue
                accion = fila[idx]
                config = icono_accion_ui(accion)
                boton_icono_estandar(accion, key=f"btn_icon_guide_square_{accion}_{fila_inicio}_{idx}", variante="square")
                st.markdown(
                    f'<div class="crm-icon-guide-button-note">'
                    f'<div class="crm-icon-guide-title" style="font-size:0.78rem">{html_escape(config["label"])}</div>'
                    f'<div class="crm-icon-guide-code">{html_escape(config["icon"])}</div></div>',
                    unsafe_allow_html=True,
                )

    st.markdown("### Botones rectangulares: acción con más aire")
    st.caption("Mismo estándar, pero puede crecer hasta un ancho máximo controlado. No debería ocupar una columna completa si no es necesario.")
    for fila_inicio in range(0, len(acciones), 4):
        fila = acciones[fila_inicio:fila_inicio + 4]
        cols = st.columns(4, gap="small")
        for idx in range(4):
            with cols[idx]:
                if idx >= len(fila):
                    st.markdown("&nbsp;", unsafe_allow_html=True)
                    continue
                accion = fila[idx]
                config = icono_accion_ui(accion)
                boton_icono_estandar(accion, key=f"btn_icon_guide_rect_{accion}_{fila_inicio}_{idx}", variante="rect")
                st.markdown(
                    f'<div class="crm-icon-guide-button-note">'
                    f'<div class="crm-icon-guide-title" style="font-size:0.78rem">{html_escape(config["label"])}</div>'
                    f'<div class="crm-icon-guide-code">{html_escape(config["icon"])}</div></div>',
                    unsafe_allow_html=True,
                )

    st.markdown("### Botones con texto: decisiones estándar")
    st.caption("Usar para confirmar, cancelar, guardar, ejecutar o acciones destructivas. Mantienen altura 36px y ancho según contenido.")
    acciones_texto = list(BOTONES_ACCION_UI.keys())
    for fila_inicio in range(0, len(acciones_texto), 4):
        fila = acciones_texto[fila_inicio:fila_inicio + 4]
        cols = st.columns(4, gap="small")
        for idx in range(4):
            with cols[idx]:
                if idx >= len(fila):
                    st.markdown("&nbsp;", unsafe_allow_html=True)
                    continue
                accion = fila[idx]
                config = BOTONES_ACCION_UI[accion]
                boton_accion_estandar(accion, key=f"btn_action_guide_{accion}_{fila_inicio}_{idx}")
                st.markdown(
                    f'<div class="crm-icon-guide-button-note">'
                    f'<div class="crm-icon-guide-title" style="font-size:0.78rem">{html_escape(config["label"])}</div>'
                    f'<div class="crm-icon-guide-code">{html_escape(config["tone"])} · {html_escape(config["icon"])}</div></div>',
                    unsafe_allow_html=True,
                )

    st.markdown("### Estados oficiales")
    cards_estados = [
        html_card_estado_ui("Pendiente", "pendiente", "Rojo: falta iniciar acción."),
        html_card_estado_ui("Contactado", "contactado", "Naranjo: ya hubo contacto."),
        html_card_estado_ui("Agendado", "agendado", "Verde: existe cita futura."),
        html_card_estado_ui("Cita concretada", "cita", "Azul claro: la cita ya ocurrió."),
        html_card_estado_ui("Agradecimiento enviado", "agradecimiento", "Azul fuerte: seguimiento posterior enviado."),
    ]
    st.markdown(f'<div class="crm-icon-guide-grid">{"".join(cards_estados)}</div>', unsafe_allow_html=True)

    st.info("Referencia interna: esta vista queda oculta para usuarios y enlazada desde docs/UI_STYLE_GUIDE.md como anexo visual.")


def fecha_interaccion_ficha(valor):
    fecha = pd.to_datetime(valor, errors="coerce", dayfirst=True)
    if pd.isna(fecha):
        return "Sin fecha"
    return fecha.strftime("%d/%m")


def texto_minuta_ficha(valor):
    texto = str(valor or "").strip()
    if not texto or texto.lower() in ["nan", "null", "none"]:
        return '<span class="crm-ficha-empty">sin minuta</span>'
    return html_escape(texto)


def texto_preview_interaccion_ficha(fila, max_chars=150):
    texto = str(fila.get("Notas_Usuario_Crudo", "") or "").strip()
    if not texto or texto.lower() in ["nan", "null", "none"]:
        return ""
    texto = " ".join(texto.split())
    return texto[:max_chars - 3].rstrip() + "..." if len(texto) > max_chars else texto


def html_interaccion_ficha(fila, abierta=False):
    tipo = str(fila.get("Tipo", "") or "Interacción").strip()
    asunto = str(fila.get("Asunto_Titulo", "") or "").strip() or "Sin título"
    fecha = fecha_interaccion_ficha(fila.get("Fecha", ""))
    notas = texto_minuta_ficha(fila.get("Notas_Usuario_Crudo", ""))
    preview = texto_preview_interaccion_ficha(fila)
    preview_html = html_escape(preview) if preview else '<span class="crm-ficha-empty">sin minuta</span>'
    estilo = estilo_interaccion_ficha(tipo)
    open_attr = " open" if abierta else ""
    return (
        f'<details class="crm-ficha-entry" style="background:{estilo["bg"]}; border-left-color:{estilo["border"]};"{open_attr}>'
        f'<summary><div class="crm-ficha-entry-row">'
        f'<span class="crm-ficha-entry-date">{html_escape(fecha)}</span>'
        f'<span class="crm-ficha-type-icon" title="{html_escape(tipo)}">{estilo["icono"]}</span>'
        f'<span class="crm-ficha-entry-copy"><span class="crm-ficha-entry-title">{html_escape(asunto)}</span>'
        f'<span class="crm-ficha-entry-preview">{preview_html}</span></span>'
        f'</div></summary>'
        f'<div class="crm-ficha-entry-detail">{notas}</div>'
        f'</details>'
    )


def renderizar_confirmacion_eliminar_interaccion(creds):
    if "id_a_eliminar" not in st.session_state or st.session_state["id_a_eliminar"] is None:
        return

    id_del_activo = st.session_state["id_a_eliminar"]
    st.error(f"¿Confirmas que deseas eliminar permanentemente la interacción `{id_del_activo}`?")
    c_conf1, c_conf2 = st.columns(2)
    with c_conf1:
        if st.button("Eliminar", icon=":material/delete:", use_container_width=True, type="primary", key="btn_confirma_borrado_real"):
            with st.spinner("Eliminando registro..."):
                eliminar_interaccion_existente(creds, id_del_activo)
                st.session_state["id_a_eliminar"] = None
                if st.session_state.get("id_interaccion_activa") == id_del_activo:
                    st.session_state["id_interaccion_activa"] = None
                st.success("Registro eliminado.")
                st.rerun()
    with c_conf2:
        if st.button("Cancelar", use_container_width=True, key="btn_cancela_borrado_real"):
            st.session_state["id_a_eliminar"] = None
            st.rerun()


def renderizar_interacciones_contacto_compactas(creds, df_interacciones):
    if "expandir_historial_completo" not in st.session_state:
        st.session_state["expandir_historial_completo"] = False

    with st.container(border=True):
        st.markdown('<div class="crm-ficha-panel-marker crm-ficha-interactions-section-marker"></div>', unsafe_allow_html=True)
        c_titulo, c_exp, c_col, c_add = st.columns([7.1, 0.58, 0.58, 0.58], gap="small")
        with c_titulo:
            st.markdown('<div class="crm-ficha-section-title"><h3>Últimas interacciones</h3></div>', unsafe_allow_html=True)
        with c_exp:
            if boton_icono_estandar("expandir", key="btn_ficha_expandir_todas", help_text="Expandir todas"):
                st.session_state["expandir_historial_completo"] = True
                st.rerun()
        with c_col:
            if boton_icono_estandar("contraer", key="btn_ficha_contraer_todas", help_text="Contraer todas"):
                st.session_state["expandir_historial_completo"] = False
                st.rerun()
        with c_add:
            if boton_icono_estandar("agregar", key="btn_ficha_nueva_interaccion", help_text="Agregar interacción manual"):
                st.session_state["id_interaccion_activa"] = "NUEVA_ENTRADA"
                st.rerun()

        renderizar_confirmacion_eliminar_interaccion(creds)

        if df_interacciones is None or df_interacciones.empty:
            st.caption("Aún no hay interacciones registradas para este contacto.")
            return

        df_vista = df_interacciones.copy()
        if "Fecha" not in df_vista.columns:
            df_vista["Fecha"] = ""
        if "ID_Entrada" not in df_vista.columns:
            df_vista["ID_Entrada"] = ""
        df_vista["__fecha_sort"] = pd.to_datetime(df_vista["Fecha"], errors="coerce", dayfirst=True)
        df_vista = df_vista.sort_values("__fecha_sort", ascending=False).drop(columns=["__fecha_sort"])

        for idx_inter, (_, fila) in enumerate(df_vista.iterrows()):
            id_entrada = str(fila.get("ID_Entrada", "")).strip() or f"inter_{idx_inter}"
            key_hash = hash_texto_corto(f"{id_entrada}_{idx_inter}")
            c_card, c_edit = st.columns([11, 0.85], gap="small")
            with c_card:
                st.markdown(
                    html_interaccion_ficha(fila, abierta=st.session_state["expandir_historial_completo"]),
                    unsafe_allow_html=True
                )
            with c_edit:
                if boton_icono_estandar("editar", key=f"btn_ficha_editar_interaccion_{key_hash}", help_text="Editar minuta"):
                    st.session_state["detalle_interaccion_activa"] = id_entrada
                    st.rerun()


def render_contactos_referidos(creds, google_id, key_prefix="referidos_contacto", titulo="Contactos referidos"):
    df_relaciones = leer_relaciones_sheet(creds)
    df_maestro_contactos = leer_sheet_local(creds)
    google_id = str(google_id or "").strip()

    with st.container(border=True):
        st.markdown('<div class="crm-ficha-panel-marker crm-ficha-ref-section-marker"></div>', unsafe_allow_html=True)
        c_titulo, c_accion = st.columns([5.8, 0.8], gap="small")
        with c_titulo:
            st.markdown(f'<div class="crm-ficha-section-title"><h3>{html_escape(titulo)}</h3></div>', unsafe_allow_html=True)
        with c_accion:
            boton_icono_estandar(
                "agregar",
                key=f"btn_{key_prefix}_gestionar",
                help_text="Agregar o editar referidos",
                on_click=solicitar_popup_referidos,
                args=(google_id,)
            )

        if df_relaciones.empty or "Google_ID_Origen" not in df_relaciones.columns:
            st.caption("Aún no hay contactos referidos vinculados a este perfil.")
            renderizar_popup_referidos_pendiente(creds, df_maestro_contactos, google_id_contexto=google_id)
            return

        df_rel_filtrado = df_relaciones[
            df_relaciones["Google_ID_Origen"].astype(str).str.strip() == google_id
        ].copy()
        if df_rel_filtrado.empty:
            st.caption("Aún no hay contactos referidos vinculados a este perfil.")
            renderizar_popup_referidos_pendiente(creds, df_maestro_contactos, google_id_contexto=google_id)
            return

        ids_existentes = set(df_maestro_contactos["Google_ID"].astype(str).str.strip().unique())
        if "Estado_CRM" not in df_maestro_contactos.columns:
            df_maestro_contactos["Estado_CRM"] = "Pendiente"
        estados_contacto = dict(zip(df_maestro_contactos["Google_ID"].astype(str).str.strip(), df_maestro_contactos["Estado_CRM"].astype(str)))
        nombres_contacto = dict(zip(df_maestro_contactos["Google_ID"].astype(str).str.strip(), df_maestro_contactos["Nombre_Visual"].astype(str)))
        from urllib.parse import quote

        for idx_ref_card, (_, fila_rel) in enumerate(df_rel_filtrado.iterrows()):
            relacion_key = clave_relacion(fila_rel)
            nombre_manual = str(fila_rel.get("Nombre_Referido", "") or "").strip() or "Contacto sin nombre"
            notas_ref = str(fila_rel.get("Notas_Relacion", fila_rel.get("Notes_Relacion", "")) or "").strip()
            id_ref = str(fila_rel.get("Google_ID_Referido", "") or "").strip()
            vinculado = bool(id_ref and id_ref in ids_existentes)
            nota_html = html_escape(notas_ref) if notas_ref else '<span class="crm-ficha-empty">sin notas</span>'
            ficha_href = ""
            if vinculado:
                ficha_href = f"/?view=contacto&google_id={quote(id_ref, safe='')}"
            nombre_vinculado = nombres_contacto.get(id_ref, nombre_manual)
            texto_ficha = str(nombre_vinculado or "").strip() or nombre_manual
            estado_html = ""
            if vinculado:
                estado_ref = normalizar_estado_networking(estados_contacto.get(id_ref, "Pendiente"))
                clase_estado_ref = clase_estado_networking(estado_ref)
                estado_html = (
                    f'<div class="crm-ficha-ref-state-muted">'
                    f'<span class="crm-status-dot {clase_estado_ref}"></span>'
                    f'<span>{html_escape(estado_ref)}</span></div>'
                )
            vinculo_texto = "Vinculado" if vinculado else "Vincular"
            with st.container(border=True):
                st.markdown(
                    f'<div class="crm-ficha-ref-card-inner"></div>'
                    f'<div class="crm-ficha-ref-card"><div class="crm-ficha-ref-head">'
                    f'<div class="crm-ficha-ref-name">{html_escape(nombre_manual)}</div></div>'
                    f'<div class="crm-ficha-ref-note">{nota_html}</div></div>',
                    unsafe_allow_html=True
                )
                st.markdown('<span class="crm-ficha-ref-bottom-marker"></span>', unsafe_allow_html=True)
                c_ficha, c_vinculo = st.columns([2.3, 1.7], gap="small")
                with c_ficha:
                    if ficha_href:
                        st.markdown(
                            f'<a class="crm-ficha-ref-link" href="{html_escape(ficha_href)}" target="_blank">{html_escape(texto_ficha)}</a>',
                            unsafe_allow_html=True
                        )
                        st.markdown(estado_html, unsafe_allow_html=True)
                    else:
                        st.markdown('<span class="crm-ficha-ref-bottom-spacer"></span>', unsafe_allow_html=True)
                with c_vinculo:
                    clase_vinculo = "linked" if vinculado else "unlinked"
                    st.markdown(f'<span class="crm-ref-edit-button-scope {clase_vinculo}"></span>', unsafe_allow_html=True)
                    st.button(
                        vinculo_texto,
                        key=f"btn_{key_prefix}_editar_{idx_ref_card}_{hash_texto_corto(nombre_manual + id_ref)}",
                        help="Editar vínculo del referido",
                        use_container_width=True,
                        type="secondary",
                        on_click=solicitar_popup_referidos,
                        args=(google_id, relacion_key)
                    )

    renderizar_popup_referidos_pendiente(creds, df_maestro_contactos, google_id_contexto=google_id)


def renderizar_referidos_contacto_tarjetas(creds, contacto):
    render_contactos_referidos(
        creds,
        google_id=contacto.get("Google_ID", ""),
        key_prefix=f"ficha_ref_{hash_texto_corto(contacto.get('Google_ID', ''))}",
        titulo="Contactos referidos"
    )


def renderizar_coach_contacto_compacto(creds, contacto, df_interacciones):
    google_id = str(contacto.get("Google_ID", "")).strip()
    df_todos = leer_todos_ia(creds)
    df_todos_contacto = preparar_todos_pendientes_para_vista(df_todos, contacto_id=google_id)

    with st.container(border=True):
        st.markdown('<div class="crm-ficha-panel-marker crm-ficha-coach-section-marker"></div>', unsafe_allow_html=True)
        c_robot, c_chat = st.columns([1.65, 4.35], gap="small")
        with c_robot:
            render_coach_mascota(size="mini")
            c_buscar, c_config = st.columns(2, gap="small")
            with c_buscar:
                if boton_icono_estandar("coach", key="btn_ficha_generar_todos", help_text="Buscar sugerencias de este contacto"):
                    df_contactos_base = pd.DataFrame([contacto])
                    df_interacciones_todas = leer_interacciones_todas(creds)
                    with st.spinner("Revisando reglas del contacto..."):
                        resultado = generar_todos_estado_networking(creds, df_contactos_base, df_interacciones_todas)
                    st.success(f"{resultado['mensaje']} Creados: {resultado['creados']} | Omitidos: {resultado['omitidos']}")
                    st.rerun()
            with c_config:
                if boton_icono_estandar("configurar", key="btn_ficha_config_todos", help_text="Configurar automatizaciones"):
                    popup_configurar_automatizaciones_todo(creds)
        with c_chat:
            if df_todos_contacto.empty:
                st.markdown('<details class="coach-message compact"><summary><span class="coach-message-date">Hoy</span><span class="coach-message-text">Sin sugerencias abiertas para este contacto.</span></summary><div class="coach-message-detail">El Coach no tiene comentarios pendientes para esta ficha.</div></details>', unsafe_allow_html=True)
            else:
                render_coach_mensajes(
                    df_todos_contacto,
                    df_interacciones,
                    key_prefix=f"ficha_{hash_texto_corto(google_id)}",
                    selectable=False,
                    max_items=4,
                    height=176,
                    compact=True
                )

# 📝 POPUP MODAL EXCLUSIVO PARA CREACIÓN Y EDICIÓN DE MINUTAS MANUALES (PUNTO 2)
@st.dialog("📝 Minuta de Interacción", width="large")
def popup_formulario_minuta(creds, contacto_target, id_activo_target, df_interacciones_target):
    es_creacion_pop = (id_activo_target == "NUEVA_ENTRADA")
    
    # --- MOLDES E INICIALIZACIÓN POR DEFECTO ---
    default_tipo = "Reunión"
    default_asunto = ""
    default_notas = ""
    from datetime import date, datetime
    default_fecha = date.today()
    
    if not es_creacion_pop:
        match_fila = df_interacciones_target[df_interacciones_target["ID_Entrada"].astype(str).str.strip() == str(id_activo_target).strip()]
        if not match_fila.empty:
            default_tipo = str(match_fila.iloc[0].get("Tipo", "Reunión")).strip()
            default_asunto = str(match_fila.iloc[0].get("Asunto_Titulo", "")).strip()
            default_notas = str(match_fila.iloc[0].get("Notas_Usuario_Crudo", "")).strip()
            try:
                f_str = str(match_fila.iloc[0].get("Fecha", "")).strip()
                default_fecha = datetime.strptime(f_str, "%d/%m/%Y").date()
            except:
                default_fecha = date.today()
    
    opciones_tipo = ["Reunión", "Llamada", "Email", "WhatsApp"]
    idx_tipo = opciones_tipo.index(default_tipo) if default_tipo in opciones_tipo else 0
    
    tipo_manual = st.selectbox("Formato / Tipo:", opciones_tipo, index=idx_tipo, key="pop_tipo_manual")
    asunto_manual = st.text_input("Asunto / Título corto:", value=default_asunto, placeholder="Ej: Café comercial...", key="pop_asunto_manual")
    fecha_manual = st.date_input("Fecha de la Interacción:", value=default_fecha, key="pop_fecha_manual")
    notas_usuario = st.text_area("Minuta / Notas de la reunión:", value=default_notas, height=200, placeholder="Escribe aquí los apuntes crudos...", key="pop_notas_manual")
    
    c_guardar, c_cancelar = st.columns(2)
    with c_guardar:
        if st.button("💾 Guardar Cambios", use_container_width=True, type="primary", key="pop_btn_guardar"):
            try:
                str_fecha_formateada = fecha_manual.strftime("%d/%m/%Y")
                if es_creacion_pop:
                    registrar_nueva_interaccion_manual(
                        creds, contacto_target.get("Google_ID", ""), 
                        tipo_manual, asunto_manual, str_fecha_formateada, notas_usuario
                    )
                else:
                    editar_interaccion_existente(
                        creds, id_activo_target, 
                        tipo_manual, asunto_manual, str_fecha_formateada, notas_usuario
                    )
                st.success("¡Línea de tiempo sincronizada con éxito!")
                st.session_state["id_interaccion_activa"] = None
                st.rerun()
            except Exception as error_save:
                st.error(f"❌ Error al guardar: {error_save}")
    with c_cancelar:
        if st.button("❌ Cerrar", use_container_width=True, key="pop_btn_cerrar"):
            st.session_state["id_interaccion_activa"] = None
            st.rerun()

# =========================================================================
# POPUP GLOBAL: REFERIDOS Y CONTACTOS
# =========================================================================
def opciones_contactos_por_id(df_contactos, incluir_sin_vinculo=False):
    df = preparar_df_contactos_maestro(df_contactos)
    opciones = [""] if incluir_sin_vinculo else []
    etiquetas = {"": "Sin vínculo"}
    if df.empty:
        return opciones, etiquetas
    df = df.sort_values("Nombre_Visual", na_position="last")
    for _, fila in df.iterrows():
        gid = str(fila.get("Google_ID", "")).strip()
        if not gid:
            continue
        nombre = valor_contacto_limpio(fila.get("Nombre_Visual", "")) or gid
        empresa = valor_contacto_limpio(fila.get("Empresa_Google", ""))
        cargo = valor_contacto_limpio(fila.get("Cargo_Google", ""))
        detalle = " · ".join([x for x in [cargo, empresa] if x])
        etiquetas[gid] = f"{nombre} ({detalle})" if detalle else nombre
        opciones.append(gid)
    return opciones, etiquetas


def obtener_fila_contacto_por_id(df_contactos, contacto_id):
    contacto_id = str(contacto_id or "").strip()
    if not contacto_id:
        return pd.Series(dtype=object)
    df = preparar_df_contactos_maestro(df_contactos)
    if df.empty:
        return pd.Series(dtype=object)
    match = df[df["Google_ID"].astype(str).str.strip() == contacto_id]
    return match.iloc[0] if not match.empty else pd.Series(dtype=object)


def datos_referido_desde_state(prefix):
    return {
        "Quien_Refiere_ID": st.session_state.get(f"{prefix}_quien_refiere", ""),
        "Google_ID_Origen": st.session_state.get(f"{prefix}_quien_refiere", ""),
        "Nombre_Referido": st.session_state.get(f"{prefix}_nombre", ""),
        "Empresa_Referido": st.session_state.get(f"{prefix}_empresa", ""),
        "Cargo_Referido": st.session_state.get(f"{prefix}_cargo", ""),
        "Telefono_Referido": st.session_state.get(f"{prefix}_telefono", ""),
        "Email_Referido": st.session_state.get(f"{prefix}_email", ""),
        "Notas_Referido": st.session_state.get(f"{prefix}_notas", ""),
        "Notas_Relacion": st.session_state.get(f"{prefix}_notas", ""),
        "Contacto_Vinculado_ID": st.session_state.get(f"{prefix}_contacto_vinculado", ""),
        "Google_ID_Referido": st.session_state.get(f"{prefix}_contacto_vinculado", ""),
        "Estado_Referido": "Abierto",
        "Origen": "Manual",
        "Activo": "TRUE",
    }


def prefill_contacto_desde_referido(datos_referido):
    return {
        "Nombre_Visual": valor_contacto_limpio(datos_referido.get("Nombre_Referido", "")),
        "Empresa_Google": valor_contacto_limpio(datos_referido.get("Empresa_Referido", "")),
        "Cargo_Google": valor_contacto_limpio(datos_referido.get("Cargo_Referido", "")),
        "Emails_Concatenados": valor_contacto_limpio(datos_referido.get("Email_Referido", "")),
        "Telefonos": valor_contacto_limpio(datos_referido.get("Telefono_Referido", "")),
        "Scope_Networking": "TRUE",
        "Es_Headhunter": "FALSE",
        "Estado_CRM": "Pendiente",
    }


def html_contacto_vinculado_referido(fila_contacto):
    if fila_contacto is None or fila_contacto.empty:
        return '<div class="crm-ref-editor-empty">Sin contacto vinculado.</div>'
    nombre = valor_contacto_limpio(fila_contacto.get("Nombre_Visual", "")) or "Contacto sin nombre"
    empresa = valor_contacto_limpio(fila_contacto.get("Empresa_Google", ""))
    cargo = valor_contacto_limpio(fila_contacto.get("Cargo_Google", ""))
    emails = separar_valores_contacto(fila_contacto.get("Emails_Concatenados", ""))
    telefonos = separar_valores_contacto(fila_contacto.get("Telefonos", ""))
    estado = normalizar_estado_networking(fila_contacto.get("Estado_CRM", "Pendiente"))
    clase_estado = clase_estado_networking(estado)
    emails_html = "".join(f"<div>{html_escape(email)}</div>" for email in emails) or '<em>sin datos</em>'
    telefonos_html = "".join(f"<div>{html_escape(tel)}</div>" for tel in telefonos) or '<em>sin datos</em>'
    detalle = " · ".join([x for x in [cargo, empresa] if x])
    return (
        '<div class="crm-ref-editor-card">'
        f'<div class="crm-ref-editor-card-name">{html_escape(nombre)}</div>'
        f'<div class="crm-ref-editor-card-muted">{html_escape(detalle) if detalle else "<em>sin datos</em>"}</div>'
        f'<div class="crm-ref-editor-card-row"><span>Correos</span><div>{emails_html}</div></div>'
        f'<div class="crm-ref-editor-card-row"><span>Telefonos</span><div>{telefonos_html}</div></div>'
        f'<div class="crm-ficha-ref-state-muted"><span class="crm-status-dot {clase_estado}"></span><span>{html_escape(estado)}</span></div>'
        '</div>'
    )


@st.dialog("Referidos y contactos", width="large")
def popup_gestion_vincu_global(creds, df_maestro_contactos, google_id_contexto=None, relacion_key_inicial=None):
    df_relaciones = leer_relaciones_sheet(creds)
    df_contactos = preparar_df_contactos_maestro(df_maestro_contactos)
    relacion_key_actual = str(relacion_key_inicial or "").strip()
    google_id_contexto = str(google_id_contexto or "").strip()
    prefix = "referido_editor"
    widget_quien_key = f"{prefix}_quien_refiere_widget"
    widget_contacto_key = f"{prefix}_contacto_vinculado_widget"

    fila_editar = pd.Series(dtype=object)
    if relacion_key_actual and not df_relaciones.empty:
        condicion = condicion_relacion_por_clave(df_relaciones, relacion_key_actual)
        if len(condicion) and condicion.any():
            fila_editar = df_relaciones.loc[condicion].iloc[0]

    draft = dict(st.session_state.get("popup_referidos_draft", {}) or {})
    carga_key = relacion_key_actual or f"nuevo:{google_id_contexto or 'global'}"
    debe_cargar = st.session_state.get(f"{prefix}_carga_key") != carga_key or st.session_state.get("popup_referidos_reload", False)
    if debe_cargar:
        fuente = fila_editar.to_dict() if not fila_editar.empty else {}
        if google_id_contexto:
            fuente["Quien_Refiere_ID"] = google_id_contexto
            fuente["Google_ID_Origen"] = google_id_contexto
        fuente.update(draft)
        st.session_state[f"{prefix}_carga_key"] = carga_key
        st.session_state[f"{prefix}_quien_refiere"] = valor_contacto_limpio(fuente.get("Quien_Refiere_ID", fuente.get("Google_ID_Origen", "")))
        st.session_state[f"{prefix}_nombre"] = valor_contacto_limpio(fuente.get("Nombre_Referido", ""))
        st.session_state[f"{prefix}_empresa"] = valor_contacto_limpio(fuente.get("Empresa_Referido", ""))
        st.session_state[f"{prefix}_cargo"] = valor_contacto_limpio(fuente.get("Cargo_Referido", ""))
        st.session_state[f"{prefix}_telefono"] = valor_contacto_limpio(fuente.get("Telefono_Referido", ""))
        st.session_state[f"{prefix}_email"] = valor_contacto_limpio(fuente.get("Email_Referido", ""))
        st.session_state[f"{prefix}_notas"] = valor_contacto_limpio(fuente.get("Notas_Referido", fuente.get("Notas_Relacion", "")))
        st.session_state[f"{prefix}_contacto_vinculado"] = valor_contacto_limpio(fuente.get("Contacto_Vinculado_ID", fuente.get("Google_ID_Referido", "")))
        st.session_state.pop(widget_quien_key, None)
        st.session_state.pop(widget_contacto_key, None)
        st.session_state["popup_referidos_reload"] = False

    c_title, c_close = st.columns([6, 0.75], gap="small")
    with c_title:
        st.markdown('<div class="crm-dialog-title">Referidos y contactos</div>', unsafe_allow_html=True)
    with c_close:
        if boton_icono_estandar("cerrar", key="btn_ref_editor_cerrar", help_text="Cerrar"):
            cerrar_popup_referidos()
            st.rerun()

    opciones_contactos, etiquetas_contactos = opciones_contactos_por_id(df_contactos, incluir_sin_vinculo=True)
    opciones_origen, etiquetas_origen = opciones_contactos_por_id(df_contactos, incluir_sin_vinculo=False)
    if not opciones_origen:
        opciones_origen = [""]
        etiquetas_origen[""] = "Selecciona un contacto"

    col_ref, col_link, col_contacto = st.columns([4.6, 0.45, 4.95], gap="small")

    with col_ref:
        st.markdown("##### Referido")
        if google_id_contexto:
            fila_origen = obtener_fila_contacto_por_id(df_contactos, google_id_contexto)
            nombre_origen = valor_contacto_limpio(fila_origen.get("Nombre_Visual", "")) or "Contacto actual"
            st.text_input("Quien refiere", value=nombre_origen, disabled=True, key=f"{prefix}_quien_refiere_nombre")
            st.session_state[f"{prefix}_quien_refiere"] = google_id_contexto
        else:
            quien_actual = st.session_state.get(f"{prefix}_quien_refiere", "")
            idx_quien = opciones_origen.index(quien_actual) if quien_actual in opciones_origen else 0
            quien_seleccionado = st.selectbox(
                "Quien refiere",
                opciones_origen,
                index=idx_quien,
                format_func=lambda opcion: etiquetas_origen.get(opcion, opcion),
                key=widget_quien_key,
            )
            st.session_state[f"{prefix}_quien_refiere"] = quien_seleccionado

        st.text_input("Nombre", key=f"{prefix}_nombre")
        c_emp, c_car = st.columns(2, gap="small")
        with c_emp:
            st.text_input("Empresa", key=f"{prefix}_empresa")
        with c_car:
            st.text_input("Cargo", key=f"{prefix}_cargo")
        st.text_input("Correo", key=f"{prefix}_email")
        st.text_input("Telefono", key=f"{prefix}_telefono")
        st.text_area("Notas adicionales", key=f"{prefix}_notas", height=96)

    with col_link:
        st.markdown('<div style="height:6.8rem"></div><div class="material-symbols-rounded" style="font-size:1.4rem;color:#64748b;text-align:center">link</div>', unsafe_allow_html=True)

    with col_contacto:
        st.markdown("##### Contacto")
        contacto_actual = st.session_state.get(f"{prefix}_contacto_vinculado", "")
        idx_contacto = opciones_contactos.index(contacto_actual) if contacto_actual in opciones_contactos else 0
        contacto_seleccionado = st.selectbox(
            "Contacto vinculado",
            opciones_contactos,
            index=idx_contacto,
            format_func=lambda opcion: etiquetas_contactos.get(opcion, opcion),
            key=widget_contacto_key,
        )
        st.session_state[f"{prefix}_contacto_vinculado"] = contacto_seleccionado
        contacto_vinculado = st.session_state.get(f"{prefix}_contacto_vinculado", "")
        fila_contacto = obtener_fila_contacto_por_id(df_contactos, contacto_vinculado)
        st.markdown(html_contacto_vinculado_referido(fila_contacto), unsafe_allow_html=True)

        c_crear_editar, c_limpiar = st.columns([1, 1], gap="small")
        with c_crear_editar:
            texto_btn = "Editar contacto" if contacto_vinculado else "Crear contacto"
            if st.button(texto_btn, key="btn_ref_editor_contacto", use_container_width=True):
                datos_actuales = datos_referido_desde_state(prefix)
                st.session_state["popup_referidos_draft"] = datos_actuales
                st.session_state["popup_referidos_reabrir_despues_contacto"] = True
                st.session_state["popup_referidos_abierto"] = False
                solicitar_popup_contacto_editor(
                    contacto_id=contacto_vinculado or None,
                    valores_iniciales=prefill_contacto_desde_referido(datos_actuales) if not contacto_vinculado else {},
                    retorno_key="popup_referidos_contacto_resultado",
                )
                st.rerun()
        with c_limpiar:
            if st.button("Sin vínculo", key="btn_ref_editor_sin_vinculo", use_container_width=True, disabled=not bool(contacto_vinculado)):
                st.session_state[f"{prefix}_contacto_vinculado"] = ""
                st.session_state.pop(widget_contacto_key, None)
                st.rerun()

    datos_guardar = datos_referido_desde_state(prefix)
    errores = []
    if not valor_contacto_limpio(datos_guardar.get("Quien_Refiere_ID", "")):
        errores.append("Selecciona quien refiere.")
    datos_minimos = [
        datos_guardar.get("Nombre_Referido", ""),
        datos_guardar.get("Email_Referido", ""),
        datos_guardar.get("Telefono_Referido", ""),
        datos_guardar.get("Empresa_Referido", ""),
        datos_guardar.get("Cargo_Referido", ""),
        datos_guardar.get("Notas_Referido", ""),
        datos_guardar.get("Contacto_Vinculado_ID", ""),
    ]
    if not any(valor_contacto_limpio(valor) for valor in datos_minimos):
        errores.append("Agrega al menos un dato del referido.")
    invalidos_email = validar_emails_contacto_editor(datos_guardar.get("Email_Referido", ""))
    invalidos_telefono = validar_telefonos_contacto_editor(datos_guardar.get("Telefono_Referido", ""))
    if invalidos_email:
        errores.append("Correo invalido: " + ", ".join(invalidos_email))
    if invalidos_telefono:
        errores.append("Telefono invalido: " + ", ".join(invalidos_telefono))
    for error in errores:
        st.error(error)

    c_cancelar, c_eliminar, c_guardar = st.columns([1.1, 1.1, 1.4], gap="small")
    with c_cancelar:
        if st.button("Cancelar", key="btn_ref_editor_cancelar", use_container_width=True):
            cerrar_popup_referidos()
            st.rerun()
    with c_eliminar:
        if relacion_key_actual and st.button("Eliminar", key="btn_ref_editor_eliminar", use_container_width=True):
            st.session_state["confirmar_borrado_rel_id"] = relacion_key_actual
    with c_guardar:
        label_guardar = "Guardar cambios" if relacion_key_actual else "Guardar referido"
        if st.button(label_guardar, key="btn_ref_editor_guardar", type="primary", disabled=bool(errores), use_container_width=True):
            resultado = guardar_referido_editor_en_sheet(creds, datos_guardar, referido_id_actual=relacion_key_actual)
            if resultado.get("ok"):
                st.success("Referido guardado.")
                cerrar_popup_referidos()
                st.rerun()
            for error in resultado.get("errores", []):
                st.error(error)

    if relacion_key_actual and st.session_state.get("confirmar_borrado_rel_id") == relacion_key_actual:
        st.warning("¿Confirmas que quieres eliminar este referido?")
        c_conf, c_cancel = st.columns(2, gap="small")
        with c_conf:
            if st.button("Sí, eliminar", key=f"btn_ref_editor_confirm_delete_{relacion_key_actual}", use_container_width=True):
                eliminar_relacion_contacto(creds, relacion_key_actual)
                cerrar_popup_referidos()
                st.rerun()
        with c_cancel:
            if st.button("No eliminar", key=f"btn_ref_editor_cancel_delete_{relacion_key_actual}", use_container_width=True):
                st.session_state["confirmar_borrado_rel_id"] = None
                st.rerun()

# =========================================================================
# 📥 POPUP DIALOG: FILTRAR CONTACTOS DESDE ETIQUETA GMAIL (SEMAFORO & SCOPE)
# =========================================================================
@st.dialog("📥 Filtrar Contactos desde Etiqueta Gmail", width="large")
def popup_filtrar_contactos_etiqueta_gmail(creds, df_consolidado_maestro):
    """
    Popup interactivo solicitado por Sergio. Barrea mensajes por etiqueta, calcula
    volúmenes por remitente y permite encender el Scope para contactos existentes (Semaforo 🟢/🔴).
    """
    from googleapiclient.discovery import build
    import re
    
    st.write("Selecciona una etiqueta para listar los remitentes y gestionar su inclusión en el Scope de Networking.")
    
    # 1. Recuperamos las etiquetas reales del Gmail del usuario
    try:
        gmail_service = build('gmail', 'v1', credentials=creds)
        results_labels = gmail_service.users().labels().list(userId='me').execute()
        labels_items = results_labels.get('labels', [])
        lista_etiquetas = [l['name'] for l in labels_items if l.get('type') == 'user']
        lista_etiquetas.sort()
        
        if not lista_etiquetas:
            st.info("ℹ️ No se detectaron etiquetas personalizadas en tu cuenta de Gmail.")
            lista_etiquetas = ["CRM", "Networking", "Clientes"]
    except Exception as e:
        st.error(f"❌ Error al conectar con Gmail para listar etiquetas: {e}")
        return

    etiqueta_sel = st.selectbox("🏷️ Selecciona la etiqueta a escanear:", lista_etiquetas, index=0, key="pop_tag_selector_core")
    
    if st.button("🔍 Analizar Etiqueta", use_container_width=True, key="btn_execute_analysis_tag"):
        st.session_state["ejecutar_analisis_tag"] = True
        st.session_state["tag_actual_analizado"] = etiqueta_sel

    # 2. Procesamiento de los mensajes (Versión optimizada con Formulario e inspección Bidireccional From/To)
    if st.session_state.get("ejecutar_analisis_tag", False) and st.session_state.get("tag_actual_analizado") == etiqueta_sel:
        with st.spinner(f"Analizando mensajes bajo la etiqueta '{etiqueta_sel}'..."):
            try:
                query_tag = f"label:{etiqueta_sel}"
                # Traemos un set de mensajes robusto para abarcar historial
                result_messages = gmail_service.users().messages().list(userId='me', q=query_tag, maxResults=120).execute()
                messages = result_messages.get('messages', [])
                
                if not messages:
                    st.warning(f"⚠️ No se encontraron correos con la etiqueta '{etiqueta_sel}'.")
                    return
                
                # Mapeamos la base de datos local para búsquedas eficientes en O(1)
                emails_crm_map = {}
                for idx_m, row_m in df_consolidado_maestro.iterrows():
                    em_raw = str(row_m.get("Emails_Concatenados", "")).strip().lower()
                    if em_raw and em_raw not in ["", "sin email", "null", "nan"]:
                        for single_em in [e.strip() for e in em_raw.split(",")]:
                            emails_crm_map[single_em] = {
                                "Nombre_Visual": row_m.get("Nombre_Visual"),
                                "Google_ID": row_m.get("Google_ID"),
                                "Scope_Networking": str(row_m.get("Scope_Networking", "FALSE")).strip() == "TRUE"
                            }

                # Barrido de metadatos analizando Remitente (From) y Destinatario (To)
                remitentes_conteo = {}
                for msg in messages:
                    meta = gmail_service.users().messages().get(userId='me', id=msg['id'], format='metadata', metadataHeaders=['From', 'To']).execute()
                    headers = meta.get('payload', {}).get('headers', [])
                    
                    from_value = next((h['value'] for h in headers if h['name'].lower() == 'from'), "")
                    to_value = next((h['value'] for h in headers if h['name'].lower() == 'to'), "")
                    
                    target_value = from_value
                    
                    # 🕵️ Si el correo lo enviaste tú, interceptamos el destinatario para no perder el hito sin respuesta
                    if to_value and ("sergio" in from_value.lower() or "hudson" in from_value.lower()):
                        target_value = to_value
                    
                    if target_value:
                        match = re.search(r'(.*)<(.*)>', target_value)
                        if match:
                            nombre = match.group(1).replace('"', '').replace("'", "").strip()
                            correo = match.group(2).strip().lower()
                        else:
                            correo = target_value.strip().lower()
                            nombre = correo.split('@')[0].capitalize()
                        
                        if not nombre:
                            nombre = correo.split('@')[0].capitalize()
                            
                        # Limpieza y desagregación por si hay múltiples destinatarios en el string
                        for c_individual in [c.strip() for c in correo.split(",")]:
                            # Ignoramos tu propia dirección de salida
                            if "sergio" in c_individual or "hudson" in c_individual:
                                continue
                                
                            if c_individual in remitentes_conteo:
                                remitentes_conteo[c_individual]["cantidad"] += 1
                            else:
                                n_individual = nombre if "," not in correo else c_individual.split('@')[0].capitalize()
                                remitentes_conteo[c_individual] = {"nombre": n_individual, "correo": c_individual, "cantidad": 1}

                st.write("---")
                st.markdown("##### 📋 Listado de Remitentes Detectados")
                
                # Encabezados de tabla alineados
                h_c1, h_c2, h_c3, h_c4, h_c5 = st.columns([1, 4, 4, 1.5, 1.5])
                h_c1.markdown("**Activar**")
                h_c2.markdown("**Nombre**")
                h_c3.markdown("**Correo**")
                h_c4.markdown("**N° Mails**")
                h_c5.markdown("**Estado**")
                
                decisiones_scope = {}
                
                # 📦 CONTENEDOR FORM: Congela los parpadeos y reruns lentos al hacer clics
                with st.form(key=f"form_scope_tag_{etiqueta_sel}"):
                    
                    for key_email, data in remitentes_conteo.items():
                        match_crm = emails_crm_map.get(key_email)
                        
                        c_chk, c_nom, c_em, c_cant, c_sem = st.columns([1, 4, 4, 1.5, 1.5])
                        
                        if match_crm:
                            semaforo_html = "🟢 <span style='color: green; font-weight: bold;'>Contacto</span>"
                            nombre_mostrar = match_crm["Nombre_Visual"]
                            scope_inicial = match_crm["Scope_Networking"]
                            
                            with c_chk:
                                decisiones_scope[match_crm["Google_ID"]] = st.checkbox(
                                    "", value=scope_inicial, key=f"pop_chk_scope_{match_crm['Google_ID']}", label_visibility="collapsed"
                                )
                        else:
                            semaforo_html = "🔴 <span style='color: red;'>No Creado</span>"
                            nombre_mostrar = data["nombre"]
                            with c_chk:
                                st.checkbox("", value=False, disabled=True, key=f"pop_chk_dis_{key_email}", label_visibility="collapsed")
                        
                        c_nom.markdown(f"<div style='font-size: 0.9em; padding-top:2px;'>{nombre_mostrar}</div>", unsafe_allow_html=True)
                        c_em.markdown(f"<div style='font-size: 0.85em; color: #475569; padding-top:2px;'><code>{key_email}</code></div>", unsafe_allow_html=True)
                        c_cant.markdown(f"<div style='font-size: 0.9em; padding-top:2px; padding-left:10px;'>{data['cantidad']}</div>", unsafe_allow_html=True)
                        c_sem.markdown(f"<div style='font-size: 0.85em; padding-top:2px;'>{semaforo_html}</div>", unsafe_allow_html=True)

                    st.write("---")
                    
                    # Botonera baja transaccional integrada al bloque del Formulario
                    c_save, c_cancel = st.columns(2)
                    
                    with c_cancel:
                        if st.form_submit_button("❌ Cancelar", use_container_width=True):
                            st.session_state["ejecutar_analisis_tag"] = False
                            st.rerun()
                            
                    with c_save:
                        if st.form_submit_button("💾 Guardar dentro del Scope", type="primary", use_container_width=True):
                            df_sheet_actual = leer_sheet_local(creds)
                            
                            for g_id_target, valor_checkbox in decisiones_scope.items():
                                condicion = df_sheet_actual["Google_ID"].astype(str).str.strip() == str(g_id_target).strip()
                                if not df_sheet_actual[condicion].empty:
                                    df_sheet_actual.loc[condicion, "Scope_Networking"] = "TRUE" if valor_checkbox else "FALSE"
                            
                            guardar_en_sheet(creds, df_sheet_actual)
                            st.success("¡Scope actualizado con éxito en la base de datos!")
                            st.session_state["ejecutar_analisis_tag"] = False
                            st.rerun()
                        
            except Exception as ex_tag:
                st.error(f"❌ Error al procesar los remitentes: {ex_tag}")

# =========================================================================
# POPUP DIALOG: SINCRONIZAR ACTIVIDAD GMAIL/CALENDAR
# =========================================================================
@st.dialog("Sincronizar actividad", width="large")
def popup_actualizar_historial(creds_dialog, df_sheet_dialog):
    fecha_inicio_sync = leer_fecha_inicio_config(creds_dialog)
    contactos_scope = (
        df_sheet_dialog[df_sheet_dialog["Scope_Networking"].astype(str).str.strip() == "TRUE"]
        if not df_sheet_dialog.empty and "Scope_Networking" in df_sheet_dialog.columns
        else df_sheet_dialog.iloc[0:0]
    )
    contactos_con_email = (
        contactos_scope[
            ~contactos_scope["Emails_Concatenados"].astype(str).str.strip().isin(["", "Sin Email", "nan", "null"])
        ]
        if not contactos_scope.empty and "Emails_Concatenados" in contactos_scope.columns
        else contactos_scope.iloc[0:0]
    )

    st.write("Mantiene al dia Gmail y Calendar para los contactos actualmente marcados en scope.")
    st.markdown(
        f"""
        - Contactos en scope con email: **{len(contactos_con_email)}**
        - Modo recomendado: **solo cambios nuevos**. Gmail usa cursor de historial y Calendar usa fecha de ultima actualizacion guardada en `CRM_Sync_State`.
        - Primer uso del modo recomendado: inicializa los controles; desde la siguiente ejecucion trae cambios nuevos.
        - Modo historico: reconstruye desde la fecha base **{fecha_inicio_sync}** y compara IDs antes de insertar. Usalo solo para reparar o cargar hacia atras.
        """
    )
    st.warning("La reconstruccion historica puede tardar y consumir cuota de Google. El modo recomendado esta pensado para uso periodico.")

    c_incremental, c_cancel = st.columns([1.45, 4.55], gap="small")
    with c_incremental:
        if st.button("Actualizar cambios nuevos", key="btn_confirm_sync_incremental", type="primary", use_container_width=True):
            if creds_dialog:
                with st.spinner("Sincronizando cambios nuevos..."):
                    resultado_sync = sincronizar_cambios_incrementales_scope(creds_dialog)
                st.success(
                    "Completado. "
                    f"Correos nuevos: {resultado_sync['correos_nuevos']} | "
                    f"Correos reasignados: {resultado_sync.get('correos_reasignados', 0)} | "
                    f"Correos migrados: {resultado_sync.get('correos_migrados', 0)} | "
                    f"Citas nuevas: {resultado_sync['citas_nuevas']} | "
                    f"Citas actualizadas: {resultado_sync['citas_actualizadas']}"
                )
                st.caption(f"Gmail: {resultado_sync['gmail']}")
                st.caption(f"Calendar: {resultado_sync['calendar']}")
            else:
                st.error("Requiere conexion activa.")
    with c_cancel:
        if st.button("Cerrar", key="btn_cancel_sync_historial"):
            st.session_state["mostrar_popup_actualizar_historial"] = False
            st.rerun(scope="app")

    with st.expander("Reconstruir historico desde fecha base", expanded=False):
        st.caption("Lee Gmail y Calendar desde la fecha configurada. Es mas lento y debe quedar como mantenimiento puntual.")
        if st.button("Reconstruir historial", key="btn_confirm_sync_historial", type="secondary"):
            if creds_dialog:
                with st.spinner("Reconstruyendo historial..."):
                    mails_totales, citas_totales = sincronizar_lote_completo_scope(creds_dialog)
                st.success(f"Completado. Correos nuevos: {mails_totales} | Citas nuevas: {citas_totales}")
            else:
                st.error("Requiere conexion activa.")

# ---- VISTA ANTERIOR DEPRECADA: queda como respaldo funcional durante el rediseño ----
def mostrar_vista_ficha_contacto_legacy():
    contacto = st.session_state["contacto_seleccionado"]
    
    # 1. Recuperamos las credenciales activas del flujo para consultar la API
    creds = autenticar_google()

    if st.session_state.get("mostrar_popup_sync_contacto_individual", False):
        popup_actualizar_contactos_google(
            creds,
            contacto_contexto=st.session_state.get("sync_contactos_contexto", contacto),
            sincronizar_actividad_despues=True
        )
    
    # 2. Leemos la pestaña 'Interacciones' filtrando por este contacto real
    if st.session_state.get("sync_contacto_resultado"):
        resultado_sync_contacto = st.session_state.pop("sync_contacto_resultado")
        nivel_msg = resultado_sync_contacto.get("nivel", "success")
        mensaje_sync_contacto = resultado_sync_contacto.get("mensaje", "")
        if nivel_msg == "warning":
            st.warning(mensaje_sync_contacto)
        elif nivel_msg == "error":
            st.error(mensaje_sync_contacto)
        else:
            st.success(mensaje_sync_contacto)

    df_interacciones = leer_historial_sheet(creds, contacto["Google_ID"])
    
    # 3. Guardamos el DataFrame en memoria de sesión para estructurar la visualización después
    st.session_state["historial_contacto_actual"] = df_interacciones

    edit_interaccion_url = str(st.query_params.get("edit_interaccion", "")).strip()
    expand_historial_url = str(st.query_params.get("expand_historial", "")).strip().lower()
    if edit_interaccion_url or expand_historial_url in ["1", "true", "si", "sí"]:
        st.session_state["expandir_historial_completo"] = True
    if edit_interaccion_url and st.session_state.get("coach_edit_interaccion_url_abierta") != edit_interaccion_url:
        df_match_edit = df_interacciones[
            df_interacciones["ID_Entrada"].astype(str).str.strip() == edit_interaccion_url
        ].copy() if "ID_Entrada" in df_interacciones.columns else pd.DataFrame()
        if not df_match_edit.empty:
            st.session_state["coach_edit_interaccion_url_abierta"] = edit_interaccion_url
            mostrar_popup_detalle_global(df_match_edit.iloc[0], creds)
        else:
            st.warning("No pude encontrar la interacción solicitada para editar la minuta.")
    elif not edit_interaccion_url:
        st.session_state["coach_edit_interaccion_url_abierta"] = ""

    # 🧭 BARRA SUPERIOR INTEGRADA: Navegación y Acciones Rápidas Unificadas (Punto 4)
    c_back, c_act1, c_act2 = st.columns([8.6, 0.5, 0.5])
    with c_back:
        if st.button("← Contactos", key="back_to_net", help="Volver a Contactos", use_container_width=False):
            st.session_state["pagina_activa"] = "Networking"
            try:
                st.query_params.clear()
                st.query_params["page"] = "contactos"
            except Exception:
                pass
            st.rerun()
            
    with c_act1:
        # Botón compacto de Sincronización Automática (Ícono Sync)
        if boton_icono_estandar("actualizar", key="btn_sync_top_icon", help_text="Actualizar contacto, correos y calendario", type="primary"):
            st.session_state["mostrar_popup_sync_contacto_individual"] = True
            st.session_state["sync_contactos_contexto"] = contacto.copy()
            st.session_state["sync_contactos_post_actividad"] = True
            st.session_state["sync_contactos_preview"] = None
            st.session_state["sync_contactos_google_df"] = None
            st.session_state["sync_contactos_next_token"] = ""
            st.session_state["sync_contactos_modo"] = "contacto"
            st.session_state["sync_contactos_mensaje"] = ""
            st.session_state["sync_contactos_forzar_completo"] = False
            st.rerun()
                
    with c_act2:
        # Botón compacto para abrir Formulario de Nueva Entrada Manual (Ícono +)
        if boton_icono_estandar("agregar", key="btn_nueva_top_icon", help_text="Registrar nueva minuta manual"):
            st.session_state["id_interaccion_activa"] = "NUEVA_ENTRADA"
            st.rerun()
            
    st.write("")
    col_principal, col_lateral = st.columns([7, 4], gap="large")

    with col_principal:
        renderizar_bloque_datos_estado_contacto(creds, contacto)

        # 🚨 POPUP DE CONFIRMACIÓN DE ELIMINACIÓN
        if "id_a_eliminar" in st.session_state and st.session_state["id_a_eliminar"] is not None:
            id_del_activo = st.session_state["id_a_eliminar"]
            
            st.error(f"⚠️ **¿Confirmas que deseas eliminar permanentemente la interacción `{id_del_activo}`?**")
            c_conf1, c_conf2 = st.columns(2)
            with c_conf1:
                if st.button("🔥 Sí, Eliminar", use_container_width=True, type="primary", key="btn_confirma_borrado_real"):
                    with st.spinner("Removiendo registro de Google Sheets..."):
                        eliminar_interaccion_existente(creds, id_del_activo)
                        st.session_state["id_a_eliminar"] = None
                        if st.session_state.get("id_interaccion_activa") == id_del_activo:
                            st.session_state["id_interaccion_activa"] = None
                        st.success("¡Registro eliminado con éxito!")
                        st.rerun()
            with c_conf2:
                if st.button("Cancelar", use_container_width=True, key="btn_cancela_borrado_real"):
                    st.session_state["id_a_eliminar"] = None
                    st.rerun()
            st.write("---")

        
        
        # 🎨 CONFIGURACIÓN DE ESTILOS VISUALES (LOOK & FEEL PASTEL REAL)
        estilos_pasteles = {
            "Email": {"bg": "#FFFFFF", "border": "#6c757d", "icono": "✉️"},
            "Cita": {"bg": "#E3F2FD", "border": "#2196F3", "icono": "📅"},
            "Mensaje": {"bg": "#E8F5E9", "border": "#4CAF50", "icono": "💬"},
            "Llamada": {"bg": "#FFFDE7", "border": "#FFEB3B", "icono": "📞"},
            "WhatsApp": {"bg": "#E8F5E9", "border": "#25D366", "icono": "💬"},
            "Reunión": {"bg": "#F3E5F5", "border": "#9C27B0", "icono": "👥"}
        }

        # 🔄 CONTROL DE EXPANSIÓN SUPERIOR E INTERRUPTOR EN SESIÓN
        if "expandir_historial_completo" not in st.session_state:
            st.session_state["expandir_historial_completo"] = False

        c_space, c_btn_exp = st.columns([7, 5])
        with c_btn_exp:
            label_btn_exp = "⚠️ Contraer" if st.session_state["expandir_historial_completo"] else "🔍 Expandir Detalle"
            if st.button(label_btn_exp, key="btn_toggle_expandir_historial", use_container_width=True, type="secondary"):
                st.session_state["expandir_historial_completo"] = not st.session_state["expandir_historial_completo"]
                st.rerun()

        # 🔄 INVOCACIÓN AL COMPONENTE GLOBAL CENTRALIZADO (Paso 1)
        # Delegamos el loop y la renderización elástica a la función externa
        renderizar_linea_tiempo_contacto(creds,
            st.session_state["historial_contacto_actual"], 
            expandir_todo=st.session_state["expandir_historial_completo"]
        )

    with col_lateral:
        renderizar_bloque_referidos_contacto(creds, contacto)

    if "id_interaccion_activa" not in st.session_state:
        st.session_state["id_interaccion_activa"] = None

    id_activo = st.session_state["id_interaccion_activa"]
    if id_activo is not None:
        popup_formulario_minuta(creds, contacto, id_activo, df_interacciones)

def mostrar_vista_ficha_contacto():
    contacto = st.session_state["contacto_seleccionado"]
    creds = autenticar_google()

    google_id_url = str(st.query_params.get("google_id", "") or "").strip()
    if google_id_url and google_id_url != str(contacto.get("Google_ID", "")).strip():
        df_contactos_url = leer_sheet_local(creds)
        if not df_contactos_url.empty and "Google_ID" in df_contactos_url.columns:
            df_match_url = df_contactos_url[
                df_contactos_url["Google_ID"].astype(str).str.strip() == google_id_url
            ].copy()
            if not df_match_url.empty:
                contacto = df_match_url.iloc[0].to_dict()
                st.session_state["contacto_seleccionado"] = contacto

    if st.session_state.get("mostrar_popup_sync_contacto_individual", False):
        popup_actualizar_contactos_google(
            creds,
            contacto_contexto=st.session_state.get("sync_contactos_contexto", contacto),
            sincronizar_actividad_despues=True
        )

    if st.session_state.get("sync_contacto_resultado"):
        resultado_sync_contacto = st.session_state.pop("sync_contacto_resultado")
        nivel_msg = resultado_sync_contacto.get("nivel", "success")
        mensaje_sync_contacto = resultado_sync_contacto.get("mensaje", "")
        if nivel_msg == "warning":
            st.warning(mensaje_sync_contacto)
        elif nivel_msg == "error":
            st.error(mensaje_sync_contacto)
        else:
            st.success(mensaje_sync_contacto)

    df_interacciones = leer_historial_sheet(creds, contacto["Google_ID"])
    st.session_state["historial_contacto_actual"] = df_interacciones

    edit_interaccion_url = str(st.query_params.get("edit_interaccion", "")).strip()
    expand_historial_url = str(st.query_params.get("expand_historial", "")).strip().lower()
    if edit_interaccion_url or expand_historial_url in ["1", "true", "si", "sí"]:
        st.session_state["expandir_historial_completo"] = True
    if edit_interaccion_url and st.session_state.get("coach_edit_interaccion_url_abierta") != edit_interaccion_url:
        df_match_edit = df_interacciones[
            df_interacciones["ID_Entrada"].astype(str).str.strip() == edit_interaccion_url
        ].copy() if "ID_Entrada" in df_interacciones.columns else pd.DataFrame()
        if not df_match_edit.empty:
            st.session_state["coach_edit_interaccion_url_abierta"] = edit_interaccion_url
            mostrar_popup_detalle_global(df_match_edit.iloc[0], creds)
        else:
            st.warning("No pude encontrar la interacción solicitada para editar la minuta.")
    elif not edit_interaccion_url:
        st.session_state["coach_edit_interaccion_url_abierta"] = ""

    c_back, c_spacer, c_sync, c_add = st.columns([2.0, 7.5, 0.55, 0.55], gap="small")
    with c_back:
        if st.button("Contactos", icon=":material/arrow_back:", key="back_to_net", help="Volver a Contactos", use_container_width=False):
            st.session_state["pagina_activa"] = "Networking"
            try:
                st.query_params.clear()
                st.query_params["page"] = "contactos"
            except Exception:
                pass
            st.rerun()
    with c_sync:
        if boton_icono_estandar("actualizar", key="btn_sync_top_icon", help_text="Actualizar contacto, correos y calendario"):
            st.session_state["mostrar_popup_sync_contacto_individual"] = True
            st.session_state["sync_contactos_contexto"] = contacto.copy()
            st.session_state["sync_contactos_post_actividad"] = True
            st.session_state["sync_contactos_preview"] = None
            st.session_state["sync_contactos_google_df"] = None
            st.session_state["sync_contactos_next_token"] = ""
            st.session_state["sync_contactos_modo"] = "contacto"
            st.session_state["sync_contactos_mensaje"] = ""
            st.session_state["sync_contactos_forzar_completo"] = False
            st.rerun()
    with c_add:
        if boton_icono_estandar("agregar", key="btn_nueva_top_icon", help_text="Registrar nueva interacción manual"):
            st.session_state["id_interaccion_activa"] = "NUEVA_ENTRADA"
            st.rerun()

    st.write("")
    col_principal, col_lateral = st.columns([7, 4], gap="large")

    with col_principal:
        renderizar_bloque_datos_estado_contacto(creds, contacto)
        renderizar_interacciones_contacto_compactas(creds, df_interacciones)

    with col_lateral:
        renderizar_coach_contacto_compacto(creds, contacto, df_interacciones)
        renderizar_referidos_contacto_tarjetas(creds, contacto)

    if "id_interaccion_activa" not in st.session_state:
        st.session_state["id_interaccion_activa"] = None

    id_activo = st.session_state["id_interaccion_activa"]
    if id_activo is not None:
        popup_formulario_minuta(creds, contacto, id_activo, df_interacciones)

    id_detalle = str(st.session_state.get("detalle_interaccion_activa", "") or "").strip()
    if id_detalle:
        df_match_detalle = df_interacciones[
            df_interacciones["ID_Entrada"].astype(str).str.strip() == id_detalle
        ].copy() if "ID_Entrada" in df_interacciones.columns else pd.DataFrame()
        if not df_match_detalle.empty:
            mostrar_popup_detalle_global(df_match_detalle.iloc[0], creds)
        else:
            st.session_state["detalle_interaccion_activa"] = ""
            st.warning("No pude encontrar esa interacción para editarla.")

# 4. ENCAPSULACIÓN DE TU CÓDIGO ACTUAL DE NETWORKING
# Definimos la función que protegerá la vista de Networking
def mostrar_vista_networking():
    render_page_header("Contactos", "Gestión por contacto, estado, foco y últimas interacciones.")

# Lista maestra global de las 8 etapas oficiales refinadas
    etapas_crm = [
        "1. Pendiente", "2. Promesa conversa/café", "3. Propuesta de cita", 
        "4. Cita creada", "5. Cita concretada", "6. Agradecimiento enviado", 
        "7. Propone nuevo lead", "8. Nuevo lead contactado"
    ]

    creds = autenticar_google()
    etapas_crm = estados_networking_oficiales()

    try:
        # 1. Traer datos de ambas fuentes
        df_sheet = leer_sheet_local(creds)
        df_interacciones_networking = leer_interacciones_todas(creds)
        if st.session_state.get("mostrar_popup_sync_contactos", False):
            popup_actualizar_contactos_google(creds)
        if st.session_state.get("mostrar_popup_actualizar_historial", False):
            popup_actualizar_historial(creds, df_sheet)

        df_consolidado = preparar_df_contactos_maestro(df_sheet)

        
        # 2. Ingeniería de Reconciliación (Cruzamos Google vs Sheet local usando el ID único)
        if not df_consolidado.empty:
            if False:
                df_google["Google_ID"] = df_google["Google_ID"].astype(str).str.strip()
                df_sheet["Google_ID"] = df_sheet["Google_ID"].astype(str).str.strip()
                # Mantener solo las columnas de configuración del sheet para no duplicar datos
                # Reemplazamos Fecha_Inicio_Filtro por Estado_Sync
                columnas_estado_sheet = [
                    "Google_ID", "Scope_Networking", "Nivel_Cercania", "Es_Headhunter", "Dominios_Headhunter", "Estado_Sync",
                    "F_Pendiente", "F_Promesa_Cafe", "F_Propuesta_Cita", "F_Cita_Creada",
                    "F_Cita_Concretada", "F_Agradecimiento", "F_Propone_Lead",
                    "F_Nuevo_Lead_Contactado", "Minuta_Reunion"
                ]
                columnas_estado_sheet = [col for col in columnas_estado_sheet if col in df_sheet.columns]
                df_sheet_sub = df_sheet[columnas_estado_sheet]
                df_consolidado = pd.merge(df_google, df_sheet_sub, on="Google_ID", how="left")
            if False:
                df_consolidado = df_google.copy()
                df_consolidado["Scope_Networking"] = "FALSE"
                df_consolidado["Nivel_Cercania"] = "3"
                df_consolidado["Es_Headhunter"] = "FALSE"
                df_consolidado["Dominios_Headhunter"] = ""
                df_consolidado["Estado_Sync"] = "Nunca Sincronizado"
            
            # Rellenar valores vacíos por defecto si son contactos nuevos de Google
            df_consolidado["Scope_Networking"] = df_consolidado["Scope_Networking"].fillna("FALSE")
            df_consolidado["Scope_Networking"] = df_consolidado["Scope_Networking"].astype(str).str.strip().str.upper()
            df_consolidado["Nivel_Cercania"] = df_consolidado["Nivel_Cercania"].fillna("3")
            df_consolidado["Nivel_Cercania"] = df_consolidado["Nivel_Cercania"].astype(str).str.strip()
            if "Es_Headhunter" not in df_consolidado.columns:
                df_consolidado["Es_Headhunter"] = "FALSE"
            df_consolidado["Es_Headhunter"] = df_consolidado["Es_Headhunter"].fillna("FALSE").astype(str).str.strip().str.upper()
            if "Dominios_Headhunter" not in df_consolidado.columns:
                df_consolidado["Dominios_Headhunter"] = ""
            df_consolidado["Dominios_Headhunter"] = df_consolidado["Dominios_Headhunter"].fillna("").astype(str).str.strip()

            # -------------------------------------------------------------------------
            # MOTOR DE ESTADOS LOGÍSTICOS POR FECHA MÁS RECIENTE (Sergio Op. 2)
            # -------------------------------------------------------------------------
            from datetime import datetime, date
            
            # Inicializar Variable Global de Fecha en session_state si no existe
            if "FECHA_INICIO_PROCESO" not in st.session_state:
                st.session_state["FECHA_INICIO_PROCESO"] = date(2026, 1, 1)

            columnas_fechas_crm = [
                "F_Pendiente", "F_Promesa_Cafe", "F_Propuesta_Cita", "F_Cita_Creada", 
                "F_Cita_Concretada", "F_Agradecimiento", "F_Propone_Lead", "F_Nuevo_Lead_Contactado"
            ]
            
            # Generamos el mapa dinámicamente a partir de la lista global
            etapas_mapeadas = estado_por_columna_fecha_legacy()

            # Asegurar existencia de las nuevas celdas del CRM
            for col in columnas_fechas_crm + ["Minuta_Reunion"]:
                if col not in df_consolidado.columns:
                    df_consolidado[col] = None

            # Si está en Scope y no tiene ninguna fecha, inicializamos F_Pendiente con el día de hoy
            hoy_str = datetime.now().strftime("%d/%m/%y")
            def inicializar_fechas_scope(row):
                tiene_alguna_fecha = any(pd.notna(row[c]) and str(row[c]).strip() != "" for c in columnas_fechas_crm)
                if row["Scope_Networking"] == "TRUE" and not tiene_alguna_fecha:
                    row["F_Pendiente"] = hoy_str
                return row

            df_consolidado = df_consolidado.apply(inicializar_fechas_scope, axis=1)

            # Determinar Estado Actual evaluando la fecha de actualización más reciente
            def calcular_estado_por_fecha(row):
                ultima_fecha_valida = None
                columna_ganadora = "F_Pendiente"
                
                for col in columnas_fechas_crm:
                    val_celda = row[col]
                    if pd.notna(val_celda) and str(val_celda).strip() != "":
                        try:
                            fecha_dt = datetime.strptime(str(val_celda).strip(), "%d/%m/%y")
                            if ultima_fecha_valida is None or fecha_dt >= ultima_fecha_valida:
                                ultima_fecha_valida = fecha_dt
                                columna_ganadora = col
                        except ValueError:
                            columna_ganadora = col # Fallback por si el string no cumple formato estricto
                            
                return etapas_mapeadas[columna_ganadora]

            df_consolidado["Estado_CRM"] = df_consolidado.apply(calcular_estado_por_fecha, axis=1)

            if not df_interacciones_networking.empty and "Google_ID" in df_interacciones_networking.columns:
                df_interacciones_networking["Google_ID"] = df_interacciones_networking["Google_ID"].astype(str).str.strip()
                df_interacciones_networking["Fecha_DT"] = pd.to_datetime(
                    df_interacciones_networking.get("Fecha", ""),
                    format="%d/%m/%Y",
                    errors="coerce"
                )
                ultimas_networking = (
                    df_interacciones_networking.dropna(subset=["Fecha_DT"])
                    .sort_values("Fecha_DT")
                    .groupby("Google_ID", as_index=False)
                    .tail(1)[["Google_ID", "Fecha_DT"]]
                    .rename(columns={"Fecha_DT": "Ultima_Interaccion_DT"})
                )
            else:
                ultimas_networking = pd.DataFrame(columns=["Google_ID", "Ultima_Interaccion_DT"])

            df_consolidado = pd.merge(df_consolidado, ultimas_networking, on="Google_ID", how="left")
            hoy_ts = pd.Timestamp(date.today())
            df_consolidado["Dias_Ultima_Interaccion"] = (hoy_ts - df_consolidado["Ultima_Interaccion_DT"]).dt.days.astype("Int64")
            # -------------------------------------------------------------------------

            # Inicializar columna de selección a la izquierda para control de filas
            df_consolidado["Seleccionar"] = False

            # Asegurar el rellenado de vacíos para los que se leen frescos de Google por primera vez
            if "Estado_Sync" not in df_consolidado.columns:
                df_consolidado["Estado_Sync"] = "Nunca Sincronizado"
            df_consolidado["Estado_Sync"] = df_consolidado["Estado_Sync"].fillna("Nunca Sincronizado")
            if "Estado_Contacto" not in df_consolidado.columns:
                df_consolidado["Estado_Contacto"] = "Activo"
            df_consolidado["Estado_Contacto"] = df_consolidado["Estado_Contacto"].replace("", "Activo").fillna("Activo").astype(str).str.strip()

            # REORDENAMIENTO MAESTRO: Agregamos el Estado calculado y la Minuta a la visualización
            columnas_ordenadas = [
                "Seleccionar", "Google_ID", "Nombre_Visual", "Emails_Concatenados", "Telefonos", 
                "Empresa_Google", "Cargo_Google", "Scope_Networking", "Es_Headhunter",
                "Dominios_Headhunter", "Dias_Ultima_Interaccion", "Nivel_Cercania",
                "Estado_CRM", "Minuta_Reunion", "Estado_Sync", "Estado_Contacto"
            ]
            df_consolidado = df_consolidado[columnas_ordenadas]
            df_consolidado["Dominios_Filtro_HH"] = df_consolidado.apply(
                lambda row: ";".join(listar_dominios_headhunter(row))
                if str(row.get("Es_Headhunter", "")).strip().upper() == "TRUE"
                else "",
                axis=1
            )

            # -------------------------------------------------------------------------
            # FILTRO GLOBAL DE CONTACTOS + PIPELINE
            # -------------------------------------------------------------------------
            st.markdown("""
            <style>
                div.stButton > button {
                    min-height: 2.1rem;
                    padding: 0.28rem 0.62rem;
                    border-radius: 6px;
                    font-size: 0.9rem;
                }
                div[data-testid="stDataFrame"] {
                    border: 1px solid #e5e7eb;
                    border-radius: 8px;
                    overflow: hidden;
                }
                .crm-section-label {
                    color: #64748b;
                    font-size: 0.82rem;
                    font-weight: 600;
                    margin: 0.2rem 0 0.35rem 0;
                    text-transform: uppercase;
                    letter-spacing: 0.02em;
                }
                .crm-table-status {
                    color: #334155;
                    font-size: 0.92rem;
                    margin: 0.2rem 0 0.45rem 0;
                }
                .crm-action-label {
                    color: #64748b;
                    font-size: 0.78rem;
                    margin: 0 0 0.2rem 0;
                    white-space: nowrap;
                }
                .crm-actions-spacer {
                    height: 1.45rem;
                }
            </style>
            """, unsafe_allow_html=True)

            inicializar_filtro_contactos(df_consolidado)
            filtro_pre_pipeline = obtener_estado_filtro_contactos()
            df_para_conteos_pipeline = aplicar_filtro_contactos(
                df_consolidado,
                filtro_pre_pipeline,
                incluir_pipeline=False,
                incluir_orden=False
            )
            pipeline_seleccionado = render_pipeline_contactos(df_para_conteos_pipeline, etapas_crm)
            render_filtro_contactos_global(df_consolidado)
            filtro_contactos = obtener_estado_filtro_contactos()
            filtro_contactos["pipeline"] = pipeline_seleccionado
            df_filtrado = aplicar_filtro_contactos(
                df_consolidado,
                filtro_contactos,
                incluir_pipeline=True,
                incluir_orden=True
            )

            # --- TABLA Y ACCIONES DE NETWORKING (fragment: no recarga toda la pagina al seleccionar) ---
            @st.fragment
            def render_tabla_networking(df_filtrado_frag, df_consolidado_frag, df_sheet_frag, creds_frag):
                columnas_tabla_networking = [
                    "Seleccionar", "Google_ID", "Nombre_Visual", "Emails_Concatenados", "Telefonos",
                    "Empresa_Google", "Cargo_Google", "Scope_Networking", "Es_Headhunter",
                    "Dominios_Headhunter", "Dias_Ultima_Interaccion", "Estado_CRM", "Estado_Sync", "Estado_Contacto"
                ]
                from urllib.parse import quote

                if "networking_selected_ids" not in st.session_state:
                    st.session_state["networking_selected_ids"] = []

                df_filtrado_frag = df_filtrado_frag.copy()
                acciones_container = st.container()
                filtro_contactos_actual = obtener_estado_filtro_contactos()
                columna_orden = opciones_orden_contactos().get(
                    filtro_contactos_actual.get("orden_label"),
                    "Dias_Ultima_Interaccion"
                )
                ascendente = filtro_contactos_actual.get("orden_direccion") == "Menor a mayor"

                ids_visibles = df_filtrado_frag["Google_ID"].astype(str).str.strip().tolist()
                set_visibles = set(ids_visibles)
                seleccion_ids = set(st.session_state.get("networking_selected_ids", [])) & set_visibles
                st.session_state["networking_selected_ids"] = list(seleccion_ids)

                df_mostrar = df_filtrado_frag[columnas_tabla_networking].copy()
                if "Estado_CRM" in df_mostrar.columns:
                    df_mostrar["Estado_CRM"] = df_mostrar["Estado_CRM"].apply(marca_estado_networking)
                df_mostrar.insert(
                    0,
                    "Ficha",
                    df_mostrar["Google_ID"].astype(str).str.strip().apply(
                        lambda google_id: f"/?view=contacto&google_id={quote(google_id, safe='')}"
                    )
                )
                df_mostrar["Seleccionar"] = df_mostrar["Google_ID"].astype(str).str.strip().isin(seleccion_ids)
                editor_key = f"editor_contactos_{columna_orden}_{'asc' if ascendente else 'desc'}"

                def sync_seleccion_desde_editor():
                    estado_editor = st.session_state.get(editor_key, {})
                    seleccion_actual = set(st.session_state.get("networking_selected_ids", [])) & set_visibles
                    for idx_raw, cambios in estado_editor.get("edited_rows", {}).items():
                        if "Seleccionar" not in cambios:
                            continue
                        try:
                            idx = int(idx_raw)
                        except (TypeError, ValueError):
                            continue
                        if 0 <= idx < len(ids_visibles):
                            g_id = ids_visibles[idx]
                            if cambios["Seleccionar"] is True:
                                seleccion_actual.add(g_id)
                            else:
                                seleccion_actual.discard(g_id)
                    st.session_state["networking_selected_ids"] = list(seleccion_actual)

                cantidad_seleccionada = len(seleccion_ids)
                hay_seleccion = cantidad_seleccionada > 0
                contactos_seleccionados_actuales = df_filtrado_frag[df_filtrado_frag["Google_ID"].astype(str).str.strip().isin(seleccion_ids)].copy()

                ejecutar_accion_scope = None
                ejecutar_accion_hh = None
                ejecutar_estado_crm = False

                with acciones_container:
                    st.markdown(
                        f'<div class="crm-table-status"><strong>{len(df_filtrado_frag)}</strong> contactos en tabla · <strong>{cantidad_seleccionada}</strong> seleccionados</div>',
                        unsafe_allow_html=True
                    )
                    g_sel, g_scope, g_hh, g_estado, g_estado_btn, _ = st.columns(
                        [0.8, 0.8, 0.8, 1.55, 0.36, 4.69],
                        gap="small"
                    )
                    with g_sel:
                        st.markdown('<div class="crm-action-label">Seleccionar</div>', unsafe_allow_html=True)
                        c_sel1, c_sel2 = st.columns(2, gap="small")
                        with c_sel1:
                            if st.button(" ", icon=":material/select_check_box:", key="btn_select_all_networking", help="Seleccionar todos los contactos visibles", use_container_width=True, disabled=len(ids_visibles) == 0):
                                st.session_state["networking_selected_ids"] = ids_visibles
                                st.rerun(scope="fragment")
                        with c_sel2:
                            if st.button(" ", icon=":material/close:", key="btn_clear_selection_networking", help="Limpiar selección", use_container_width=True, disabled=not hay_seleccion):
                                st.session_state["networking_selected_ids"] = []
                                st.rerun(scope="fragment")
                    with g_scope:
                        st.markdown('<div class="crm-action-label">Foco</div>', unsafe_allow_html=True)
                        c_scope1, c_scope2 = st.columns(2, gap="small")
                        with c_scope1:
                            if st.button(" ", icon=":material/person_add:", key="btn_bulk_inc", help="Agregar al foco de networking", use_container_width=True, type="secondary", disabled=not hay_seleccion):
                                ejecutar_accion_scope = "TRUE"
                        with c_scope2:
                            if st.button(" ", icon=":material/person_remove:", key="btn_bulk_exc", help="Sacar del foco de networking", use_container_width=True, type="secondary", disabled=not hay_seleccion):
                                ejecutar_accion_scope = "FALSE"
                    with g_hh:
                        st.markdown('<div class="crm-action-label">Headhunter</div>', unsafe_allow_html=True)
                        c_hh1, c_hh2 = st.columns(2, gap="small")
                        with c_hh1:
                            if st.button(" ", icon=":material/adjust:", key="btn_bulk_hh_true", help="Marcar como headhunter", use_container_width=True, type="secondary", disabled=not hay_seleccion):
                                ejecutar_accion_hh = "TRUE"
                        with c_hh2:
                            if st.button(" ", icon=":material/groups:", key="btn_bulk_hh_false", help="Quitar marca headhunter", use_container_width=True, type="secondary", disabled=not hay_seleccion):
                                ejecutar_accion_hh = "FALSE"
                    with g_estado:
                        estado_bulk = st.selectbox(
                            "Estado CRM",
                            options=etapas_crm,
                            index=0,
                            key="networking_bulk_estado_crm",
                            disabled=not hay_seleccion
                        )
                    with g_estado_btn:
                        st.markdown('<div class="crm-actions-spacer"></div>', unsafe_allow_html=True)
                        if st.button(" ", icon=":material/check:", key="btn_bulk_estado_crm", help="Aplicar estado a contactos seleccionados", use_container_width=True, type="secondary", disabled=not hay_seleccion):
                            ejecutar_estado_crm = True

                if ejecutar_estado_crm:
                    if seleccion_ids:
                        from datetime import datetime
                        ahora_string = datetime.now().strftime("%d/%m/%y %H:%M:%S")
                        fecha_hito = datetime.now().strftime("%d/%m/%y")
                        columna_hito = columna_fecha_para_estado_networking(estado_bulk)
                        df_sheet_actual = leer_sheet_local(creds_frag)

                        if df_sheet_actual.empty or "Google_ID" not in df_sheet_actual.columns:
                            df_sheet_actual = df_consolidado_frag.drop(columns=["Seleccionar"], errors="ignore").copy()

                        for col_base in [
                            "Google_ID", "Scope_Networking", "Nivel_Cercania", "Es_Headhunter",
                            "Dominios_Headhunter", "Estado_CRM", "Estado_Sync", "Estado_Contacto"
                        ] + columnas_fechas_crm:
                            if col_base not in df_sheet_actual.columns:
                                df_sheet_actual[col_base] = ""

                        for _, fila_seleccionada in contactos_seleccionados_actuales.iterrows():
                            fila_seleccionada = fila_seleccionada.drop(labels=["Seleccionar"], errors="ignore")
                            g_id_sel = str(fila_seleccionada["Google_ID"]).strip()
                            condicion = df_sheet_actual["Google_ID"].astype(str).str.strip() == g_id_sel

                            if not condicion.any():
                                nueva_fila = {col: "" for col in df_sheet_actual.columns}
                                for col in df_sheet_actual.columns:
                                    if col in fila_seleccionada.index:
                                        nueva_fila[col] = fila_seleccionada[col]
                                df_sheet_actual = pd.concat([df_sheet_actual, pd.DataFrame([nueva_fila])], ignore_index=True)
                                condicion = df_sheet_actual["Google_ID"].astype(str).str.strip() == g_id_sel

                            df_sheet_actual.loc[condicion, "Scope_Networking"] = "TRUE"
                            df_sheet_actual.loc[condicion, "Estado_Contacto"] = "Activo"
                            df_sheet_actual.loc[condicion, "Estado_CRM"] = estado_bulk
                            df_sheet_actual.loc[condicion, columna_hito] = fecha_hito
                            df_sheet_actual.loc[condicion, "Estado_Sync"] = f"Estado CRM actualizado - {ahora_string}"

                        guardar_en_sheet(creds_frag, df_sheet_actual)
                        st.session_state["networking_selected_ids"] = []
                        st.success(f"Estado CRM actualizado a {estado_bulk}.")
                        st.rerun()

                if ejecutar_accion_hh is not None:
                    if seleccion_ids:
                        from datetime import datetime
                        ahora_string = datetime.now().strftime("%d/%m/%y %H:%M:%S")
                        df_sheet_actual = leer_sheet_local(creds_frag)

                        if df_sheet_actual.empty or "Google_ID" not in df_sheet_actual.columns:
                            df_sheet_actual = df_consolidado_frag.drop(columns=["Seleccionar"], errors="ignore").copy()

                        for col_base in ["Google_ID", "Scope_Networking", "Nivel_Cercania", "Es_Headhunter", "Dominios_Headhunter", "Estado_Sync", "Estado_Contacto"]:
                            if col_base not in df_sheet_actual.columns:
                                df_sheet_actual[col_base] = ""

                        for _, fila_seleccionada in contactos_seleccionados_actuales.iterrows():
                            fila_seleccionada = fila_seleccionada.drop(labels=["Seleccionar"], errors="ignore")
                            g_id_sel = str(fila_seleccionada["Google_ID"]).strip()
                            condicion = df_sheet_actual["Google_ID"].astype(str).str.strip() == g_id_sel

                            if not condicion.any():
                                nueva_fila = {col: "" for col in df_sheet_actual.columns}
                                for col in df_sheet_actual.columns:
                                    if col in fila_seleccionada.index:
                                        nueva_fila[col] = fila_seleccionada[col]
                                df_sheet_actual = pd.concat([df_sheet_actual, pd.DataFrame([nueva_fila])], ignore_index=True)
                                condicion = df_sheet_actual["Google_ID"].astype(str).str.strip() == g_id_sel

                            df_sheet_actual.loc[condicion, "Es_Headhunter"] = ejecutar_accion_hh
                            df_sheet_actual.loc[condicion, "Dominios_Headhunter"] = (
                                extraer_dominios_desde_emails(fila_seleccionada.get("Emails_Concatenados", ""))
                                if ejecutar_accion_hh == "TRUE"
                                else ""
                            )
                            df_sheet_actual.loc[condicion, "Estado_Sync"] = f"Actualizado - {ahora_string}"

                        guardar_en_sheet(creds_frag, df_sheet_actual)
                        st.session_state["networking_selected_ids"] = []
                        st.success("Marca headhunter actualizada.")
                        st.rerun()

                if ejecutar_accion_scope is not None:
                    if seleccion_ids:
                        from datetime import datetime
                        ahora_string = datetime.now().strftime("%d/%m/%y %H:%M:%S")
                        df_sheet_actual = leer_sheet_local(creds_frag)

                        if df_sheet_actual.empty or "Google_ID" not in df_sheet_actual.columns:
                            df_sheet_actual = df_consolidado_frag.drop(columns=["Seleccionar"], errors="ignore").copy()

                        for col_base in ["Google_ID", "Scope_Networking", "Nivel_Cercania", "Es_Headhunter", "Dominios_Headhunter", "Estado_Sync", "Estado_Contacto"]:
                            if col_base not in df_sheet_actual.columns:
                                df_sheet_actual[col_base] = ""

                        for _, fila_seleccionada in contactos_seleccionados_actuales.iterrows():
                            fila_seleccionada = fila_seleccionada.drop(labels=["Seleccionar"], errors="ignore")
                            g_id_sel = str(fila_seleccionada["Google_ID"]).strip()
                            condicion = df_sheet_actual["Google_ID"].astype(str).str.strip() == g_id_sel

                            if not condicion.any():
                                nueva_fila = {col: "" for col in df_sheet_actual.columns}
                                for col in df_sheet_actual.columns:
                                    if col in fila_seleccionada.index:
                                        nueva_fila[col] = fila_seleccionada[col]
                                df_sheet_actual = pd.concat([df_sheet_actual, pd.DataFrame([nueva_fila])], ignore_index=True)
                                condicion = df_sheet_actual["Google_ID"].astype(str).str.strip() == g_id_sel

                            df_sheet_actual.loc[condicion, "Scope_Networking"] = ejecutar_accion_scope
                            df_sheet_actual.loc[condicion, "Estado_Sync"] = f"Actualizado - {ahora_string}"

                            if ejecutar_accion_scope == "TRUE":
                                df_sheet_actual.loc[condicion, "Estado_Contacto"] = "Activo"
                                columnas_fechas_scope = [
                                    "F_Pendiente", "F_Promesa_Cafe", "F_Propuesta_Cita", "F_Cita_Creada",
                                    "F_Cita_Concretada", "F_Agradecimiento", "F_Propone_Lead", "F_Nuevo_Lead_Contactado"
                                ]
                                columnas_existentes = [c for c in columnas_fechas_scope if c in df_sheet_actual.columns]
                                if columnas_existentes:
                                    sin_fechas = True
                                    for col_fecha in columnas_existentes:
                                        valor_fecha = df_sheet_actual.loc[condicion, col_fecha].iloc[0]
                                        if pd.notna(valor_fecha) and str(valor_fecha).strip() != "":
                                            sin_fechas = False
                                            break
                                    if sin_fechas and "F_Pendiente" in df_sheet_actual.columns:
                                        df_sheet_actual.loc[condicion, "F_Pendiente"] = datetime.now().strftime("%d/%m/%y")

                        guardar_en_sheet(creds_frag, df_sheet_actual)
                        st.session_state["networking_selected_ids"] = []
                        st.success("Scope actualizado.")
                        st.rerun()

                if st.session_state.get("confirmar_eliminacion", False):
                    cant_sel = len(contactos_seleccionados_actuales)
                    st.error(f"Confirmas desactivar {cant_sel} contactos? No se borraran sus minutas ni historial.")
                    c_pop1, c_pop2 = st.columns([1.2, 6], gap="small")
                    with c_pop1:
                        if st.button("Si, desactivar", type="primary", key="btn_execute_bulk_del_real"):
                            ids_a_desactivar = contactos_seleccionados_actuales["Google_ID"].astype(str).str.strip().tolist()
                            desactivar_contactos_en_sheet(creds_frag, ids_a_desactivar, motivo="Desactivado")
                            st.session_state["networking_selected_ids"] = []
                            st.session_state.confirmar_eliminacion = False
                            st.success("Contactos desactivados. El historial se mantiene.")
                            st.rerun()
                    with c_pop2:
                        if st.button("Cancelar", key="btn_cancel_bulk_del_real"):
                            st.session_state.confirmar_eliminacion = False
                            st.rerun(scope="fragment")

                st.data_editor(
                    df_mostrar,
                    column_config={
                        "Ficha": st.column_config.LinkColumn("Ficha", display_text="Abrir"),
                        "Seleccionar": st.column_config.CheckboxColumn("Seleccionar", default=False),
                        "Google_ID": None,
                        "Nombre_Visual": st.column_config.TextColumn("Nombre", disabled=True),
                        "Emails_Concatenados": st.column_config.TextColumn("Correos", disabled=True),
                        "Telefonos": st.column_config.TextColumn("Telefonos", disabled=True),
                        "Empresa_Google": st.column_config.TextColumn("Empresa", disabled=True),
                        "Cargo_Google": st.column_config.TextColumn("Cargo", disabled=True),
                        "Scope_Networking": st.column_config.TextColumn("Marca scope", disabled=True),
                        "Es_Headhunter": st.column_config.TextColumn("Es headhunter", disabled=True),
                        "Dominios_Headhunter": st.column_config.TextColumn("Empresas headhunter", disabled=True),
                        "Dias_Ultima_Interaccion": st.column_config.NumberColumn("Días última interacción", disabled=True),
                        "Estado_CRM": st.column_config.TextColumn("Estado CRM", disabled=True),
                        "Estado_Sync": st.column_config.TextColumn("Estado sync", disabled=True),
                        "Estado_Contacto": st.column_config.TextColumn("Estado contacto", disabled=True),
                    },
                    disabled=[col for col in df_mostrar.columns if col not in ["Seleccionar", "Ficha"]],
                    on_change=sync_seleccion_desde_editor,
                    use_container_width=True,
                    height=430,
                    key=editor_key
                )

            render_tabla_networking(df_filtrado, df_consolidado, df_sheet, creds)

            with st.expander("Opciones avanzadas", expanded=False):
                st.caption("Mantenimiento de datos con Google. Usar cuando quieras traer cambios recientes de contactos, correos o calendario.")
                seleccion_avanzada = len(st.session_state.get("networking_selected_ids", [])) > 0
                c_adv1, c_adv2, c_adv3, c_adv4, c_adv5, c_adv6, _ = st.columns([0.95, 0.95, 0.95, 0.5, 0.5, 0.95, 4.15], gap="small")
                with c_adv1:
                    if st.button("↻ Contactos", key="btn_open_sync_contactos_google", help="Actualizar contactos desde Google Contacts", use_container_width=True, type="secondary"):
                        st.session_state["mostrar_popup_sync_contactos"] = True
                        st.session_state["sync_contactos_preview"] = None
                        st.session_state["sync_contactos_google_df"] = None
                        st.session_state["sync_contactos_next_token"] = None
                        st.session_state["sync_contactos_modo"] = "incremental"
                        st.session_state["sync_contactos_mensaje"] = ""
                        st.session_state["sync_contactos_forzar_completo"] = False
                        st.rerun()
                with c_adv2:
                    if st.button("↻ Actividad", key="btn_open_sync_historial_top", help="Actualizar correos y calendario", use_container_width=True, type="secondary"):
                        st.session_state["mostrar_popup_actualizar_historial"] = True
                        st.rerun()
                with c_adv3:
                    if st.button("Notas", key="btn_inicializar_notas_editables", help="Inicializar notas editables desde el contenido original", use_container_width=True, type="secondary"):
                        with st.spinner("Copiando originales a notas editables vacías..."):
                            total_migrado = inicializar_notas_editables_desde_fuente(creds)
                        st.success(f"Notas editables inicializadas: {total_migrado}.")
                        st.rerun()
                with c_adv4:
                    if st.button(" ", icon=":material/label:", key="btn_trigger_filtrar_tag_gmail_core", help="Filtrar contactos desde etiqueta Gmail", use_container_width=True, type="secondary"):
                        if creds and df_consolidado is not None:
                            popup_filtrar_contactos_etiqueta_gmail(creds, df_consolidado)
                        else:
                            st.error("Requiere conexión activa.")
                with c_adv5:
                    if st.button(" ", icon=":material/delete:", key="btn_bulk_del", help="Desactivar contactos seleccionados", use_container_width=True, type="secondary", disabled=not seleccion_avanzada):
                        st.session_state.confirmar_eliminacion = True
                        st.rerun()
                with c_adv6:
                    if st.button("Exportar", key="btn_preparar_export_espejo", help="Preparar respaldo ZIP para migracion cloud", use_container_width=True, type="secondary"):
                        with st.spinner("Preparando export espejo..."):
                            nombre_export, bytes_export, resumen_export = construir_export_espejo_local(creds)
                        st.session_state["export_espejo_nombre"] = nombre_export
                        st.session_state["export_espejo_bytes"] = bytes_export
                        st.session_state["export_espejo_resumen"] = resumen_export

                if st.session_state.get("export_espejo_bytes"):
                    resumen_export = st.session_state.get("export_espejo_resumen", {})
                    st.divider()
                    st.caption("Export espejo listo. Contiene datos personales y minutas: no lo subas a GitHub ni lo compartas por chat.")
                    conteos_export = resumen_export.get("conteos", {})
                    if conteos_export:
                        st.caption(
                            " | ".join([
                                f"{nombre}: {cantidad}"
                                for nombre, cantidad in conteos_export.items()
                            ])
                        )
                    if resumen_export.get("blocking_errors"):
                        st.error("El reporte detecto errores bloqueantes. Revisa el ZIP antes de importarlo.")
                    elif resumen_export.get("warnings"):
                        st.warning(f"Export generado con {len(resumen_export.get('warnings', []))} advertencias no bloqueantes.")
                    st.download_button(
                        "Descargar export espejo",
                        data=st.session_state["export_espejo_bytes"],
                        file_name=st.session_state.get("export_espejo_nombre", "crm-networking-export.zip"),
                        mime="application/zip",
                        key="download_export_espejo_local",
                        type="primary",
                        use_container_width=False,
                    )
        else:
            st.warning("No hay contactos guardados en el Sheet. Usa Actualizar contactos para importar desde Google Contacts.")

    except Exception as e:
        st.error(f"Ocurrió un error en la sincronización estructural: {e}")

# =========================================================================
# 🎛️ EJECUTOR DE ENRUTAMIENTO SEGURO
# =======================================================   ==================
if st.session_state["pagina_activa"] == "Networking":
    mostrar_vista_networking()
elif st.session_state["pagina_activa"] == "Dashboard":
    mostrar_vista_dashboard()
elif st.session_state["pagina_activa"] == "Empresas":
    mostrar_vista_empresas()
elif st.session_state["pagina_activa"] == "Iconos":
    mostrar_vista_iconos_ui()
elif st.session_state["pagina_activa"] == "Ficha_Contacto":
    mostrar_vista_ficha_contacto()

