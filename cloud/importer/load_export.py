#!/usr/bin/env python
"""
Load a CRM Networking mirror export into Supabase/Postgres.

Default mode is dry-run. The script only writes when --apply is provided.
Connection string must come from CRM_NETWORKING_DATABASE_URL or --database-url.
Do not commit or paste the database URL in chat.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, Iterable, List, Optional, Tuple

from export_package import (
    bool_from_text,
    clean_text,
    normalized_email,
    normalized_phone,
    preview_from_package,
    read_export_package,
    split_values,
)


APP_NAMESPACE = uuid.UUID("7adfd0f0-6d28-48c1-930d-532cbe17e0f9")

PRIVATE_TABLES = [
    "action_invocations",
    "audit_log",
    "connected_accounts",
    "contact_emails",
    "contact_phones",
    "data_exports",
    "external_contact_ids",
    "external_interaction_sources",
    "import_batches",
    "interaction_participants",
    "interactions",
    "metric_snapshots",
    "object_review_state",
    "referrals",
    "sync_cursors",
    "todo_configs",
    "todos",
    "usage_events",
    "usage_limits",
    "user_settings",
    "contacts",
]

JSONB_COLUMNS = {
    ("contacts", "legacy_milestones"),
    ("interactions", "metadata"),
    ("external_interaction_sources", "metadata"),
    ("todo_configs", "rule_json"),
    ("todos", "actions_json"),
    ("sync_cursors", "metadata"),
    ("import_batches", "manifest_json"),
    ("import_batches", "validation_report_json"),
    ("user_settings", "value_json"),
}


def import_psycopg():
    try:
        import psycopg
    except ImportError as exc:
        raise RuntimeError(
            "Missing dependency 'psycopg'. Install cloud/importer/requirements.txt "
            "inside the venv before running --apply."
        ) from exc
    return psycopg


def stable_uuid(user_id: str, table: str, legacy_key: str) -> str:
    key = f"{user_id}|{table}|{legacy_key}"
    return str(uuid.uuid5(APP_NAMESPACE, key))


def parse_json_field(value: str, fallback: Any) -> Any:
    text = clean_text(value)
    if not text:
        return fallback
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        return {"raw": text}


def parse_timestamp(value: str) -> Optional[str]:
    text = clean_text(value)
    if not text:
        return None
    normalized = text.replace("Z", "+00:00")
    try:
        return datetime.fromisoformat(normalized).astimezone(timezone.utc).isoformat()
    except ValueError:
        pass
    for fmt in ("%d/%m/%Y %H:%M:%S", "%d/%m/%Y %H:%M", "%d/%m/%Y", "%Y-%m-%d"):
        try:
            return datetime.strptime(text, fmt).replace(tzinfo=timezone.utc).isoformat()
        except ValueError:
            continue
    return None


def normalize_networking_status(value: str) -> str:
    text = clean_text(value)
    aliases = {
        "": "Pendiente",
        "pendiente": "Pendiente",
        "contactado": "Contactado",
        "agendado": "Agendado",
        "cita concretada": "Cita concretada",
        "agradecimiento enviado": "Agradecimiento enviado",
        "3. propuesta de cita": "Contactado",
        "4. cita creada": "Agendado",
        "5. cita concretada": "Cita concretada",
        "6. agradecimiento enviado": "Agradecimiento enviado",
    }
    return aliases.get(text.lower(), text if text in {
        "Pendiente",
        "Contactado",
        "Agendado",
        "Cita concretada",
        "Agradecimiento enviado",
    } else "Pendiente")


def normalize_interaction_type(value: str) -> str:
    text = clean_text(value).lower()
    if "gmail" in text or "email" in text or "correo" in text:
        return "email"
    if "calendar" in text or "cita" in text or "reunion" in text or "reunión" in text:
        return "calendar"
    if "llamada" in text or "call" in text:
        return "call"
    if "whatsapp" in text or "mensaje" in text or "linkedin" in text:
        return "message"
    return "manual"


def normalize_direction(value: str) -> str:
    text = clean_text(value).lower()
    if text in {"to", "cc", "bcc"} or "saliente" in text or "out" in text:
        return "outbound"
    if text in {"from", "sender", "remitente"} or "entrante" in text or "inbound" in text:
        return "inbound"
    if "manual" in text:
        return "internal"
    return "unknown"


def map_by_legacy(rows: Iterable[Dict[str, str]], user_id: str) -> Dict[str, str]:
    mapping: Dict[str, str] = {}
    for row in rows:
        legacy_app = clean_text(row.get("Contact_ID", ""))
        legacy_google = clean_text(row.get("Google_ID", ""))
        key = legacy_app or legacy_google
        if not key:
            continue
        contact_id = stable_uuid(user_id, "contacts", key)
        if legacy_app:
            mapping[legacy_app] = contact_id
        if legacy_google:
            mapping[legacy_google] = contact_id
    return mapping


def build_contacts(tables: Dict[str, List[Dict[str, str]]], user_id: str) -> List[Dict[str, Any]]:
    rows = []
    for row in tables["crm_contactos_extra"]:
        legacy_app = clean_text(row.get("Contact_ID", ""))
        legacy_google = clean_text(row.get("Google_ID", ""))
        key = legacy_app or legacy_google
        if not key:
            continue
        domains = [v.strip() for v in split_values(row.get("Dominios_Headhunter", ""))]
        estado_contacto = clean_text(row.get("Estado_Contacto", ""))
        rows.append({
            "id": stable_uuid(user_id, "contacts", key),
            "user_id": user_id,
            "legacy_app_contact_id": legacy_app,
            "legacy_google_id": legacy_google if legacy_google.startswith("people/") else None,
            "display_name": clean_text(row.get("Nombre_Visual", "")),
            "company": clean_text(row.get("Empresa_Google", "")),
            "role": clean_text(row.get("Cargo_Google", "")),
            "networking_status": normalize_networking_status(row.get("Estado_CRM", "")),
            "networking_focus": bool_from_text(row.get("Scope_Networking", ""), default=True),
            "closeness_level": clean_text(row.get("Nivel_Cercania", "")) or None,
            "is_headhunter": bool_from_text(row.get("Es_Headhunter", "")),
            "headhunter_domains": domains,
            "is_active": estado_contacto.lower() != "desactivado",
            "sync_status": clean_text(row.get("Estado_Sync", "")) or None,
            "legacy_milestones": {
                key: clean_text(row.get(key, ""))
                for key in [
                    "F_Pendiente",
                    "F_Promesa_Cafe",
                    "F_Propuesta_Cita",
                    "F_Cita_Creada",
                    "F_Cita_Concretada",
                    "F_Agradecimiento",
                    "F_Propone_Lead",
                    "F_Nuevo_Lead_Contactado",
                ]
            },
            "legacy_notes": clean_text(row.get("Minuta_Reunion", "")) or None,
        })
    return rows


def build_contact_channels(
    tables: Dict[str, List[Dict[str, str]]],
    user_id: str,
    contact_map: Dict[str, str],
) -> Tuple[List[Dict[str, Any]], List[Dict[str, Any]], List[Dict[str, Any]], List[str]]:
    emails: List[Dict[str, Any]] = []
    phones: List[Dict[str, Any]] = []
    external_ids: List[Dict[str, Any]] = []
    warnings: List[str] = []
    seen_emails = set()
    seen_phones = set()

    for row in tables["crm_contactos_extra"]:
        legacy_app = clean_text(row.get("Contact_ID", ""))
        legacy_google = clean_text(row.get("Google_ID", ""))
        contact_id = contact_map.get(legacy_app) or contact_map.get(legacy_google)
        if not contact_id:
            continue

        for raw_email in split_values(row.get("Emails_Concatenados", "")):
            email = clean_text(raw_email)
            normalized = normalized_email(email)
            if not normalized:
                continue
            if normalized in seen_emails:
                warnings.append("duplicate_email_skipped")
                continue
            seen_emails.add(normalized)
            domain = normalized.split("@", 1)[1] if "@" in normalized else ""
            emails.append({
                "id": stable_uuid(user_id, "contact_emails", normalized),
                "user_id": user_id,
                "contact_id": contact_id,
                "email": email,
                "normalized_email": normalized,
                "domain": domain or None,
                "is_primary": len([e for e in emails if e["contact_id"] == contact_id]) == 0,
                "source": "import",
            })

        for raw_phone in split_values(row.get("Telefonos", "")):
            phone = clean_text(raw_phone)
            normalized = normalized_phone(phone)
            if not normalized:
                continue
            if normalized in seen_phones:
                warnings.append("duplicate_phone_skipped")
                continue
            seen_phones.add(normalized)
            phones.append({
                "id": stable_uuid(user_id, "contact_phones", normalized),
                "user_id": user_id,
                "contact_id": contact_id,
                "phone": phone,
                "normalized_phone": normalized,
                "normalized_phone_last8": normalized[-8:] if len(normalized) >= 8 else normalized,
                "is_primary": len([p for p in phones if p["contact_id"] == contact_id]) == 0,
                "source": "import",
            })

        provider = clean_text(row.get("Provider", ""))
        external_id = clean_text(row.get("Provider_Contact_ID", "")) or legacy_google
        if external_id.startswith("people/") or (provider and provider.lower() not in {"app", "manual"}):
            provider = provider or "Google"
            external_ids.append({
                "id": stable_uuid(user_id, "external_contact_ids", f"{provider}|{external_id}"),
                "user_id": user_id,
                "contact_id": contact_id,
                "connected_account_id": None,
                "provider": provider.lower(),
                "external_id": external_id,
                "is_active": True,
                "last_seen_at": None,
            })

    return emails, phones, external_ids, warnings


def build_interactions(
    tables: Dict[str, List[Dict[str, str]]],
    user_id: str,
    contact_map: Dict[str, str],
) -> Tuple[List[Dict[str, Any]], List[Dict[str, Any]], List[Dict[str, Any]]]:
    interactions: List[Dict[str, Any]] = []
    participants: List[Dict[str, Any]] = []
    external_sources: List[Dict[str, Any]] = []
    seen_interactions = set()
    seen_participants = set()

    for row in tables["interacciones"]:
        legacy_entry_id = clean_text(row.get("ID_Entrada", ""))
        if not legacy_entry_id:
            continue
        interaction_id = stable_uuid(user_id, "interactions", legacy_entry_id)
        if legacy_entry_id not in seen_interactions:
            seen_interactions.add(legacy_entry_id)
            source_id = clean_text(row.get("ID_Fuente", ""))
            thread_id = clean_text(row.get("Thread_ID", ""))
            interaction_type = normalize_interaction_type(row.get("Tipo", ""))
            provider, source_service, external_object_type = external_source_kind(source_id, interaction_type)
            source_detail = clean_text(row.get("Detalle_Fuente", "")) or None
            subject = clean_text(row.get("Asunto_Titulo", ""))
            interactions.append({
                "id": interaction_id,
                "user_id": user_id,
                "legacy_entry_id": legacy_entry_id,
                "provider": provider,
                "provider_event_id": source_id or None,
                "provider_thread_id": thread_id or None,
                "interaction_type": interaction_type,
                "direction": normalize_direction(row.get("Rol_Email", "")),
                "occurred_at": parse_timestamp(row.get("Fecha", "")),
                "subject": subject,
                "source_detail": source_detail,
                "user_notes_raw": clean_text(row.get("Notas_Usuario_Crudo", "")) or None,
                "metadata": {
                    "legacy_contact_label": clean_text(row.get("De_Hacia_Contacto", "")),
                    "legacy_google_id": clean_text(row.get("Google_ID", "")),
                },
            })
            if provider and source_id:
                external_sources.append({
                    "id": stable_uuid(user_id, "external_interaction_sources", f"{provider}|{source_service}|{source_id}"),
                    "user_id": user_id,
                    "interaction_id": interaction_id,
                    "connected_account_id": None,
                    "provider": provider,
                    "source_service": source_service,
                    "external_object_type": external_object_type,
                    "external_id": source_id,
                    "external_thread_id": thread_id or None,
                    "external_url": None,
                    "source_subject": subject or None,
                    "source_detail": source_detail,
                    "content_hash": content_hash(subject, source_detail),
                    "sync_status": "imported",
                    "prevent_reimport": False,
                    "is_active": True,
                    "last_seen_at": parse_timestamp(row.get("Fecha", "")),
                    "last_synced_at": None,
                    "metadata": {
                        "legacy_entry_id": legacy_entry_id,
                        "legacy_contact_label": clean_text(row.get("De_Hacia_Contacto", "")),
                        "legacy_google_id": clean_text(row.get("Google_ID", "")),
                        "email_identity": clean_text(row.get("Email_Asociado", "")),
                        "role": clean_text(row.get("Rol_Email", "")),
                    },
                })

        legacy_contact = clean_text(row.get("Google_ID", ""))
        email_identity = clean_text(row.get("Email_Asociado", "")) or None
        role = clean_text(row.get("Rol_Email", "")) or None
        participant_key = "|".join([
            legacy_entry_id,
            contact_map.get(legacy_contact) or legacy_contact,
            normalized_email(email_identity or ""),
            role or "",
        ])
        if participant_key in seen_participants:
            continue
        seen_participants.add(participant_key)
        participants.append({
            "id": stable_uuid(user_id, "interaction_participants", participant_key),
            "user_id": user_id,
            "interaction_id": interaction_id,
            "contact_id": contact_map.get(legacy_contact),
            "email_identity": email_identity,
            "role": role,
        })
    return interactions, participants, external_sources


def external_source_kind(source_id: str, interaction_type: str) -> Tuple[Optional[str], str, str]:
    upper = source_id.upper()
    if upper.startswith("GMAIL"):
        return "google", "gmail", "email"
    if upper.startswith("CALENDAR"):
        return "google", "calendar", "calendar_event"
    return None, "manual", interaction_type or "manual"


def content_hash(subject: str, source_detail: Optional[str]) -> Optional[str]:
    text = "\n".join([clean_text(subject), clean_text(source_detail or "")]).strip()
    if not text:
        return None
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


def build_referrals(
    tables: Dict[str, List[Dict[str, str]]],
    user_id: str,
    contact_map: Dict[str, str],
) -> Tuple[List[Dict[str, Any]], List[str]]:
    referrals: List[Dict[str, Any]] = []
    warnings: List[str] = []
    for row in tables["crm_relaciones"]:
        legacy_id = clean_text(row.get("Referido_ID", ""))
        if not legacy_id:
            continue
        referred_by_key = clean_text(row.get("Quien_Refiere_ID", "")) or clean_text(row.get("Google_ID_Origen", ""))
        referred_by_contact_id = contact_map.get(referred_by_key)
        if not referred_by_contact_id:
            warnings.append("referral_without_referrer_skipped")
            continue
        linked_key = clean_text(row.get("Contacto_Vinculado_ID", "")) or clean_text(row.get("Google_ID_Referido", ""))
        active = bool_from_text(row.get("Activo", ""), default=True)
        referrals.append({
            "id": stable_uuid(user_id, "referrals", legacy_id),
            "user_id": user_id,
            "legacy_referral_id": legacy_id,
            "referred_by_contact_id": referred_by_contact_id,
            "linked_contact_id": contact_map.get(linked_key),
            "referred_name": clean_text(row.get("Nombre_Referido", "")),
            "referred_company": clean_text(row.get("Empresa_Referido", "")),
            "referred_role": clean_text(row.get("Cargo_Referido", "")),
            "referred_email": clean_text(row.get("Email_Referido", "")),
            "referred_phone": clean_text(row.get("Telefono_Referido", "")),
            "notes": clean_text(row.get("Notas_Referido", "")) or clean_text(row.get("Notas_Relacion", "")),
            "status": "active" if active else "dismissed",
        })
    return referrals, warnings


def execution_mode(value: str) -> str:
    text = clean_text(value).lower()
    if "desactiv" in text:
        return "do_not_suggest"
    if "automatic" in text or "automático" in text:
        return "execute_without_asking"
    return "confirm_always"


def build_todo_configs(tables: Dict[str, List[Dict[str, str]]], user_id: str) -> List[Dict[str, Any]]:
    rows = []
    for row in tables["crm_todo_config"]:
        todo_type = clean_text(row.get("Tipo_ToDo", ""))
        if not todo_type:
            continue
        mode = execution_mode(row.get("Modo_Ejecucion", ""))
        rows.append({
            "id": stable_uuid(user_id, "todo_configs", todo_type),
            "user_id": user_id,
            "todo_type": todo_type,
            "engine_type": clean_text(row.get("Motor_Tipo", "")) or "RULE",
            "action_scope": "in_app",
            "user_mode": mode,
            "enabled": mode != "do_not_suggest",
            "display_name": clean_text(row.get("Descripcion", "")),
            "description": clean_text(row.get("Descripcion", "")),
            "rule_json": {
                key: clean_text(row.get(key, ""))
                for key in [
                    "Fuentes_Requeridas",
                    "Ventana_Dias",
                    "Criterio_Dedupe",
                    "Permite_Auto_Aplicar",
                    "Requiere_Confirmacion",
                ]
            },
        })
    return rows


def build_todos(tables: Dict[str, List[Dict[str, str]]], user_id: str, contact_map: Dict[str, str]) -> List[Dict[str, Any]]:
    rows = []
    for row in tables["crm_todos"]:
        legacy_id = clean_text(row.get("Todo_ID", ""))
        if not legacy_id:
            continue
        object_type = clean_text(row.get("Objeto_Tipo", ""))
        object_key = clean_text(row.get("Objeto_ID", ""))
        object_id = contact_map.get(object_key) if object_type.lower() == "contacto" else None
        rows.append({
            "id": stable_uuid(user_id, "todos", legacy_id),
            "user_id": user_id,
            "legacy_todo_id": legacy_id,
            "todo_type": clean_text(row.get("Tipo_ToDo", "")) or "UNKNOWN",
            "engine_type": clean_text(row.get("Origen", "")) or "RULE",
            "status": normalize_todo_status(row.get("Estado_ToDo", "")),
            "priority": 2,
            "object_type": object_type or None,
            "object_id": object_id,
            "current_state": clean_text(row.get("Estado_Actual_JSON", "")) or None,
            "suggested_state": clean_text(row.get("Estado_Sugerido_JSON", "")) or None,
            "summary": clean_text(row.get("Objeto_Label", "")) or clean_text(row.get("Cambio_Tipo", "")),
            "reason": clean_text(row.get("Notas", "")),
            "evidence": clean_text(row.get("Evidencia_JSON", "")),
            "actions_json": parse_json_field(row.get("Acciones_JSON", ""), []),
            "dedup_key": clean_text(row.get("Dedup_Key", "")) or None,
            "source_fingerprint": None,
            "created_at": parse_timestamp(row.get("Fecha_Creacion", "")) or datetime.now(timezone.utc).isoformat(),
            "resolved_at": None,
        })
    return rows


def normalize_todo_status(value: str) -> str:
    text = clean_text(value).lower()
    if text in {"", "activo", "active", "pendiente", "abierto", "open"}:
        return "active"
    if text in {"completado", "complete", "completed", "done"}:
        return "done"
    if text in {"reemplazado", "descartado", "dismissed", "discarded"}:
        return "dismissed"
    if text in {"expirado", "expired"}:
        return "expired"
    if text in {"auto_resuelto", "auto resuelto", "auto_resolved"}:
        return "auto_resolved"
    return "dismissed"


def build_sync_cursors(tables: Dict[str, List[Dict[str, str]]], user_id: str) -> List[Dict[str, Any]]:
    rows = []
    for row in tables["crm_sync_state"]:
        key = clean_text(row.get("Clave", ""))
        if not key:
            continue
        rows.append({
            "id": stable_uuid(user_id, "sync_cursors", key),
            "user_id": user_id,
            "connected_account_id": None,
            "provider": "google" if "google" in key.lower() or "gmail" in key.lower() or "calendar" in key.lower() else "local",
            "resource_type": key,
            "cursor_label": "",
            "cursor_value": clean_text(row.get("Valor", "")) or None,
            "last_synced_at": parse_timestamp(row.get("Actualizado_En", "")),
            "status": "ok",
            "metadata": {},
        })
    return rows


def build_user_settings(tables: Dict[str, List[Dict[str, str]]], user_id: str) -> List[Dict[str, Any]]:
    rows = []
    for row in tables["crm_config"]:
        key = clean_text(row.get("Clave", "")) or clean_text(row.get("Parametro", ""))
        if not key:
            continue
        rows.append({
            "id": stable_uuid(user_id, "user_settings", key),
            "user_id": user_id,
            "setting_key": key,
            "setting_value": clean_text(row.get("Valor", "")),
            "value_json": {},
        })
    return rows


def build_import_batch(package: Dict[str, Any], user_id: str, source_filename: str) -> Dict[str, Any]:
    manifest = package["manifest"]
    validation = package["validation"]
    batch_key = f"{source_filename}|{manifest.get('generated_at', '')}"
    return {
        "id": stable_uuid(user_id, "import_batches", batch_key),
        "user_id": user_id,
        "source_type": "local_mirror_zip",
        "source_filename": source_filename,
        "manifest_json": manifest,
        "validation_report_json": validation,
        "status": "imported",
        "imported_at": datetime.now(timezone.utc).isoformat(),
    }


def build_cloud_rows(package: Dict[str, Any], user_id: str) -> Tuple[Dict[str, List[Dict[str, Any]]], List[str]]:
    tables = package["tables"]
    contact_map = map_by_legacy(tables["crm_contactos_extra"], user_id)
    contacts = build_contacts(tables, user_id)
    emails, phones, external_ids, channel_warnings = build_contact_channels(tables, user_id, contact_map)
    interactions, participants, external_sources = build_interactions(tables, user_id, contact_map)
    referrals, referral_warnings = build_referrals(tables, user_id, contact_map)

    rows = {
        "profiles": [{"id": user_id, "email": None, "full_name": None}],
        "user_settings": build_user_settings(tables, user_id),
        "contacts": contacts,
        "external_contact_ids": external_ids,
        "contact_emails": emails,
        "contact_phones": phones,
        "interactions": interactions,
        "interaction_participants": participants,
        "external_interaction_sources": external_sources,
        "referrals": referrals,
        "todo_configs": build_todo_configs(tables, user_id),
        "todos": build_todos(tables, user_id, contact_map),
        "object_review_state": [],
        "sync_cursors": build_sync_cursors(tables, user_id),
        "import_batches": [build_import_batch(package, user_id, package["zip_path"].name)],
    }
    return rows, channel_warnings + referral_warnings


def count_existing_user_rows(conn: Any, user_id: str) -> Dict[str, int]:
    counts: Dict[str, int] = {}
    with conn.cursor() as cur:
        for table in PRIVATE_TABLES:
            if not table_exists(cur, table):
                counts[table] = 0
                continue
            cur.execute(f"select count(*) from public.{table} where user_id = %s", (user_id,))
            counts[table] = int(cur.fetchone()[0])
    return counts


def table_exists(cur: Any, table: str) -> bool:
    cur.execute(
        "select exists (select 1 from information_schema.tables where table_schema = 'public' and table_name = %s)",
        (table,),
    )
    return bool(cur.fetchone()[0])


def insert_rows(conn: Any, table: str, rows: List[Dict[str, Any]]) -> None:
    if not rows:
        return
    from psycopg.types.json import Jsonb

    columns = list(rows[0].keys())
    placeholders = ", ".join(["%s"] * len(columns))
    column_sql = ", ".join(columns)
    sql = f"insert into public.{table} ({column_sql}) values ({placeholders})"
    values = [
        tuple(
            Jsonb(row.get(column)) if (table, column) in JSONB_COLUMNS else row.get(column)
            for column in columns
        )
        for row in rows
    ]
    with conn.cursor() as cur:
        cur.executemany(sql, values)


def apply_import(database_url: str, user_id: str, rows_by_table: Dict[str, List[Dict[str, Any]]]) -> Dict[str, int]:
    psycopg = import_psycopg()
    insert_order = [
        "profiles",
        "user_settings",
        "contacts",
        "external_contact_ids",
        "contact_emails",
        "contact_phones",
        "interactions",
        "interaction_participants",
        "external_interaction_sources",
        "referrals",
        "todo_configs",
        "todos",
        "object_review_state",
        "sync_cursors",
        "import_batches",
    ]
    with psycopg.connect(database_url) as conn:
        existing = count_existing_user_rows(conn, user_id)
        non_empty = {table: count for table, count in existing.items() if count > 0}
        if non_empty:
            conn.rollback()
            raise RuntimeError(
                "Target user already has data. Import aborted. "
                "Use a fresh user or implement an explicit replace flow."
            )
        inserted = {}
        for table in insert_order:
            with conn.cursor() as cur:
                if not table_exists(cur, table):
                    inserted[table] = 0
                    continue
            rows = rows_by_table.get(table, [])
            insert_rows(conn, table, rows)
            inserted[table] = len(rows)
        conn.commit()
        return inserted


def friendly_apply_error(exc: Exception) -> str:
    message = str(exc)
    lower = message.lower()
    if "getaddrinfo failed" in lower or "failed to resolve host" in lower:
        return (
            "No se pudo encontrar el servidor de Supabase indicado en la conexion. "
            "Revisa que copiaste completa la connection string desde Supabase, que el host no tenga errores "
            "y que tu red/firewall permita resolver ese dominio."
        )
    if "password authentication failed" in lower:
        return "Supabase rechazo la clave de base de datos. Revisa la password dentro de la connection string."
    if "target user already has data" in lower:
        return message
    return message


def validate_user_id(user_id: str) -> str:
    try:
        return str(uuid.UUID(user_id))
    except ValueError as exc:
        raise ValueError("--user-id must be a valid Supabase auth UUID") from exc


def main() -> int:
    parser = argparse.ArgumentParser(description="Load a CRM Networking mirror export into Supabase/Postgres.")
    parser.add_argument("zip_path", help="Path to crm-networking-export-*.zip")
    parser.add_argument("--user-id", required=True, help="Existing Supabase auth user UUID")
    parser.add_argument("--database-url", help="Postgres connection string. Prefer env var instead.")
    parser.add_argument("--apply", action="store_true", help="Actually insert rows. Default is dry-run.")
    parser.add_argument("--pretty", action="store_true", help="Pretty-print JSON output")
    args = parser.parse_args()

    user_id = validate_user_id(args.user_id)
    package = read_export_package(Path(args.zip_path))
    preview, preview_exit = preview_from_package(package)
    rows_by_table, transform_warnings = build_cloud_rows(package, user_id)
    planned_counts = {table: len(rows) for table, rows in rows_by_table.items()}

    result: Dict[str, Any] = {
        "mode": "apply" if args.apply else "dry_run",
        "preview": preview,
        "transform_warnings_count": len(transform_warnings),
        "planned_insert_counts": planned_counts,
        "inserted_counts": {},
    }
    if preview_exit != 0:
        result["ok"] = False
        result["error"] = "Preview has blocking problems. Import not allowed."
        print(json.dumps(result, ensure_ascii=False, indent=2 if args.pretty else None))
        return preview_exit

    if args.apply:
        database_url = args.database_url or os.environ.get("CRM_NETWORKING_DATABASE_URL", "")
        if not database_url:
            result["ok"] = False
            result["error"] = "Missing CRM_NETWORKING_DATABASE_URL or --database-url."
            print(json.dumps(result, ensure_ascii=False, indent=2 if args.pretty else None))
            return 1
        try:
            result["inserted_counts"] = apply_import(database_url, user_id, rows_by_table)
        except Exception as exc:
            result["ok"] = False
            result["error"] = friendly_apply_error(exc)
            print(json.dumps(result, ensure_ascii=False, indent=2 if args.pretty else None))
            return 1
    result["ok"] = True
    print(json.dumps(result, ensure_ascii=False, indent=2 if args.pretty else None))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
