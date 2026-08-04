from __future__ import annotations

import hashlib
import json
import re
import zipfile
from pathlib import Path
from typing import Any, Dict, Iterable, List, Tuple


SCHEMA_VERSION = "crm_networking_export_v0_1"

REQUIRED_TABLE_FILES = {
    "crm_contactos_extra": "tables/crm_contactos_extra.jsonl",
    "interacciones": "tables/interacciones.jsonl",
    "crm_relaciones": "tables/crm_relaciones.jsonl",
    "crm_todos": "tables/crm_todos.jsonl",
    "crm_todo_config": "tables/crm_todo_config.jsonl",
    "crm_object_review_state": "tables/crm_object_review_state.jsonl",
    "crm_sync_state": "tables/crm_sync_state.jsonl",
    "crm_config": "tables/crm_config.jsonl",
}


def read_json(zip_file: zipfile.ZipFile, name: str) -> Dict[str, Any]:
    try:
        return json.loads(zip_file.read(name).decode("utf-8"))
    except KeyError:
        raise ValueError(f"Missing required file: {name}") from None
    except json.JSONDecodeError as exc:
        raise ValueError(f"Invalid JSON in {name}: {exc}") from exc


def read_jsonl(zip_file: zipfile.ZipFile, name: str) -> List[Dict[str, str]]:
    try:
        raw = zip_file.read(name).decode("utf-8")
    except KeyError:
        raise ValueError(f"Missing required file: {name}") from None

    rows: List[Dict[str, str]] = []
    for line_number, line in enumerate(raw.splitlines(), start=1):
        if not line.strip():
            continue
        try:
            parsed = json.loads(line)
        except json.JSONDecodeError as exc:
            raise ValueError(f"Invalid JSONL in {name}:{line_number}: {exc}") from exc
        rows.append({str(k): "" if v is None else str(v) for k, v in parsed.items()})
    return rows


def sha256_bytes(content: bytes) -> str:
    return hashlib.sha256(content).hexdigest()


def split_values(value: str) -> List[str]:
    value = str(value or "").strip()
    if not value or value.lower() in {"nan", "none", "null", "sin email", "sin datos"}:
        return []
    parts = re.split(r"[;,]", value)
    return [part.strip() for part in parts if part.strip()]


def normalized_email(email: str) -> str:
    return str(email or "").strip().lower()


def normalized_phone(phone: str) -> str:
    return re.sub(r"\D+", "", str(phone or ""))


def bool_from_text(value: str, default: bool = False) -> bool:
    text = str(value or "").strip().lower()
    if text in {"true", "1", "si", "sí", "yes", "y"}:
        return True
    if text in {"false", "0", "no", "n"}:
        return False
    return default


def clean_text(value: Any) -> str:
    return "" if value is None else str(value).strip()


def distinct_non_empty(values: Iterable[str]) -> List[str]:
    seen = set()
    result = []
    for value in values:
        clean = clean_text(value)
        if clean and clean not in seen:
            seen.add(clean)
            result.append(clean)
    return result


def validate_manifest_hashes(zip_file: zipfile.ZipFile, manifest: Dict[str, Any]) -> List[Dict[str, str]]:
    mismatches = []
    manifest_tables = manifest.get("tables", {})
    if not isinstance(manifest_tables, dict):
        return [{"file": "manifest.json", "error": "manifest.tables is not an object"}]

    for path, metadata in manifest_tables.items():
        if not isinstance(metadata, dict):
            mismatches.append({"file": path, "error": "metadata is not an object"})
            continue
        expected_hash = clean_text(metadata.get("sha256", ""))
        if not expected_hash:
            continue
        try:
            actual_hash = sha256_bytes(zip_file.read(path))
        except KeyError:
            mismatches.append({"file": path, "error": "file listed in manifest is missing"})
            continue
        if actual_hash != expected_hash:
            mismatches.append({"file": path, "error": "sha256 mismatch"})
    return mismatches


def read_export_package(zip_path: Path) -> Dict[str, Any]:
    if not zip_path.exists():
        raise ValueError(f"File not found: {zip_path}")
    if zip_path.suffix.lower() != ".zip":
        raise ValueError("Expected a .zip mirror export")

    with zipfile.ZipFile(zip_path, "r") as zip_file:
        names = set(zip_file.namelist())
        manifest = read_json(zip_file, "manifest.json")
        validation = read_json(zip_file, "validation_report.json")
        missing_files = [
            path
            for path in ["manifest.json", "validation_report.json", *REQUIRED_TABLE_FILES.values()]
            if path not in names
        ]
        hash_mismatches = validate_manifest_hashes(zip_file, manifest)
        tables = {
            table_name: read_jsonl(zip_file, path)
            for table_name, path in REQUIRED_TABLE_FILES.items()
        }

    return {
        "zip_path": zip_path,
        "manifest": manifest,
        "validation": validation,
        "tables": tables,
        "missing_files": missing_files,
        "hash_mismatches": hash_mismatches,
    }


def target_counts(tables: Dict[str, List[Dict[str, str]]]) -> Dict[str, int]:
    contacts = tables["crm_contactos_extra"]
    interactions = tables["interacciones"]
    referrals = tables["crm_relaciones"]
    todos = tables["crm_todos"]
    todo_configs = tables["crm_todo_config"]
    review_state = tables["crm_object_review_state"]
    sync_state = tables["crm_sync_state"]
    user_settings = tables["crm_config"]

    email_count = 0
    phone_count = 0
    external_id_count = 0
    seen_emails = set()
    seen_phones = set()
    for row in contacts:
        for email in distinct_non_empty(normalized_email(v) for v in split_values(row.get("Emails_Concatenados", ""))):
            if email not in seen_emails:
                seen_emails.add(email)
                email_count += 1
        for phone in distinct_non_empty(normalized_phone(v) for v in split_values(row.get("Telefonos", ""))):
            if phone not in seen_phones:
                seen_phones.add(phone)
                phone_count += 1

        provider = clean_text(row.get("Provider", ""))
        provider_contact_id = clean_text(row.get("Provider_Contact_ID", ""))
        legacy_google_id = clean_text(row.get("Google_ID", ""))
        if provider_contact_id or legacy_google_id.startswith("people/"):
            external_id_count += 1
        elif provider and provider.lower() not in {"app", "manual"}:
            external_id_count += 1

    unique_interaction_ids = set()
    participant_keys = set()
    for row in interactions:
        legacy_entry_id = clean_text(row.get("ID_Entrada", ""))
        if legacy_entry_id:
            unique_interaction_ids.add(legacy_entry_id)
        contact_key = clean_text(row.get("Google_ID", ""))
        email_key = normalized_email(row.get("Email_Asociado", ""))
        role_key = clean_text(row.get("Rol_Email", ""))
        if legacy_entry_id and (contact_key or email_key):
            participant_keys.add((legacy_entry_id, contact_key, email_key, role_key))

    return {
        "profiles": 1,
        "user_settings": len(user_settings),
        "service_connectors": 0,
        "connected_accounts": 0,
        "contacts": len(contacts),
        "external_contact_ids": external_id_count,
        "contact_emails": email_count,
        "contact_phones": phone_count,
        "interactions": len(unique_interaction_ids),
        "interaction_participants": len(participant_keys),
        "referrals": len(referrals),
        "todo_configs": len(todo_configs),
        "todos": len(todos),
        "action_invocations": 0,
        "object_review_state": len(review_state),
        "sync_cursors": len(sync_state),
        "import_batches": 1,
        "data_exports": 0,
        "usage_limits": 0,
        "usage_events": 0,
        "audit_log": 0,
        "metric_snapshots": 0,
    }


def preview_from_package(package: Dict[str, Any]) -> Tuple[Dict[str, Any], int]:
    manifest = package["manifest"]
    validation = package["validation"]
    tables = package["tables"]
    manifest_version = clean_text(manifest.get("schema_version", ""))
    blocking_errors = list(validation.get("blocking_errors", []) or [])
    warnings = list(manifest.get("warnings", []) or []) + list(validation.get("warnings", []) or [])

    preview = {
        "zip_file": package["zip_path"].name,
        "schema_version": manifest_version,
        "schema_version_ok": manifest_version == SCHEMA_VERSION,
        "generated_at": manifest.get("generated_at", ""),
        "source_app": manifest.get("source_app", ""),
        "export_mode": manifest.get("export_mode", ""),
        "required_files_ok": not package["missing_files"],
        "missing_files": package["missing_files"],
        "hashes_ok": not package["hash_mismatches"],
        "hash_mismatches": package["hash_mismatches"],
        "blocking_errors_count": len(blocking_errors),
        "warnings_count": len(warnings),
        "source_table_counts": {name: len(rows) for name, rows in tables.items()},
        "target_table_estimated_counts": target_counts(tables),
    }

    exit_code = 0
    if package["missing_files"] or package["hash_mismatches"] or blocking_errors or manifest_version != SCHEMA_VERSION:
        exit_code = 2
    return preview, exit_code
