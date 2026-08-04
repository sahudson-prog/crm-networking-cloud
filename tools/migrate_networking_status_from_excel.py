import argparse
import json
import re
import unicodedata
from datetime import datetime
from difflib import SequenceMatcher
from pathlib import Path

import pandas as pd
from google.auth.transport.requests import Request
from google.oauth2.credentials import Credentials
from googleapiclient.discovery import build


SCOPES = [
    "https://www.googleapis.com/auth/contacts.readonly",
    "https://www.googleapis.com/auth/spreadsheets",
    "https://www.googleapis.com/auth/gmail.readonly",
    "https://www.googleapis.com/auth/calendar.readonly",
]

SHEET_ID = "14tigwoo1mDybh-HxhJ64dsmng2y39nqY6JoiCImtM8E"
CRM_RANGE = "CRM_Contactos_Extra!A:V"

MILESTONE_COLUMNS = [
    "F_Pendiente",
    "F_Promesa_Cafe",
    "F_Propuesta_Cita",
    "F_Cita_Creada",
    "F_Cita_Concretada",
    "F_Agradecimiento",
    "F_Propone_Lead",
    "F_Nuevo_Lead_Contactado",
]

OUTPUT_COLUMNS = [
    "Google_ID",
    "Nombre_Visual",
    "Emails_Concatenados",
    "Telefonos",
    "Empresa_Google",
    "Cargo_Google",
    "Scope_Networking",
    "Nivel_Cercania",
    "Es_Headhunter",
    "Dominios_Headhunter",
    "Estado_CRM",
    "Estado_Sync",
    *MILESTONE_COLUMNS,
    "Minuta_Reunion",
]


def normalize_text(value):
    value = "" if pd.isna(value) else str(value)
    value = unicodedata.normalize("NFKD", value).encode("ascii", "ignore").decode("ascii")
    value = value.lower()
    value = re.sub(r"[^a-z0-9 ]+", " ", value)
    return re.sub(r"\s+", " ", value).strip()


def normalize_column(value):
    return normalize_text(value).replace(" ", "_")


def truthy(value):
    return str(value).strip().lower() in {"1", "1.0", "true", "x", "si", "sí", "yes"}


def find_column(df, *needles):
    normalized = {normalize_column(col): col for col in df.columns}
    for key, original in normalized.items():
        if all(needle in key for needle in needles):
            return original
    return None


def get_credentials():
    creds = Credentials.from_authorized_user_file("token.json", SCOPES)
    if creds.expired and creds.refresh_token:
        creds.refresh(Request())
    return creds


def read_crm_sheet(service):
    values = service.spreadsheets().values().get(
        spreadsheetId=SHEET_ID,
        range=CRM_RANGE,
    ).execute().get("values", [])
    if not values:
        return pd.DataFrame(columns=OUTPUT_COLUMNS)
    headers = values[0]
    rows = [row + [""] * (len(headers) - len(row)) for row in values[1:]]
    return pd.DataFrame(rows, columns=headers)


def infer_target(row, cols):
    if cols["referral_contacted"] and truthy(row.get(cols["referral_contacted"], "")):
        return "F_Nuevo_Lead_Contactado", "8. Nuevo lead contactado"
    if cols["referral_proposed"] and truthy(row.get(cols["referral_proposed"], "")):
        return "F_Propone_Lead", "7. Propone nuevo lead"
    if cols["thanks"] and truthy(row.get(cols["thanks"], "")):
        return "F_Agradecimiento", "6. Agradecimiento enviado"
    if cols["meeting_done"] and truthy(row.get(cols["meeting_done"], "")):
        return "F_Cita_Concretada", "5. Cita concretada"
    if cols["meeting_created"] and truthy(row.get(cols["meeting_created"], "")):
        return "F_Cita_Creada", "4. Cita creada"
    if cols["invitation"] and truthy(row.get(cols["invitation"], "")):
        return "F_Propuesta_Cita", "3. Propuesta de cita"
    if cols["coffee_promise"] and truthy(row.get(cols["coffee_promise"], "")):
        return "F_Propuesta_Cita", "3. Propuesta de cita"
    return "F_Pendiente", "1. Pendiente"


def best_match(source_norm, crm):
    best = None
    best_score = 0.0
    source_tokens = set(source_norm.split())
    for _, candidate in crm.iterrows():
        target_norm = candidate["__norm_name"]
        score = SequenceMatcher(None, source_norm, target_norm).ratio() if source_norm and target_norm else 0
        target_tokens = set(str(target_norm).split())
        if len(source_tokens) >= 2 and source_tokens.issubset(target_tokens):
            score = max(score, 0.96)
        if score > best_score:
            best = candidate
            best_score = score
    return best, best_score


def build_preview(excel_csv, crm):
    excel = pd.read_csv(excel_csv)
    name_col = find_column(excel, "nombre")
    avance_col = find_column(excel, "avance")
    if not name_col or not avance_col:
        raise ValueError("No encontre columnas de nombre/avance en el Excel convertido.")

    cols = {
        "coffee_promise": find_column(excel, "promesa"),
        "invitation": find_column(excel, "invitaci"),
        "meeting_created": find_column(excel, "cita", "creada"),
        "meeting_done": find_column(excel, "reuni") or find_column(excel, "cafe"),
        "thanks": find_column(excel, "agradecimiento"),
        "referral_proposed": find_column(excel, "compromete", "contacto"),
        "referral_contacted": find_column(excel, "contacto", "establecido"),
    }

    crm = crm.copy()
    crm["__norm_name"] = crm["Nombre_Visual"].map(normalize_text)
    excel["__norm_name"] = excel[name_col].map(normalize_text)
    excel["__avance_num"] = pd.to_numeric(excel[avance_col], errors="coerce").fillna(0)
    active = excel[excel["__avance_num"] > 0].copy()

    crm_by_norm = {name: group for name, group in crm.groupby("__norm_name") if name}
    matched = []
    ambiguous = []
    unmatched = []

    for idx, row in active.iterrows():
        source_norm = row["__norm_name"]
        method = ""
        score = 1.0
        match = None
        if source_norm in crm_by_norm and len(crm_by_norm[source_norm]) == 1:
            match = crm_by_norm[source_norm].iloc[0]
            method = "exact"
        elif source_norm in crm_by_norm and len(crm_by_norm[source_norm]) > 1:
            ambiguous.append({
                "excel_row": int(idx) + 2,
                "nombre_excel": row[name_col],
                "candidates": int(len(crm_by_norm[source_norm])),
            })
            continue
        else:
            match, score = best_match(source_norm, crm)
            if score >= 0.92:
                method = "fuzzy"
            else:
                unmatched.append({
                    "excel_row": int(idx) + 2,
                    "nombre_excel": row[name_col],
                    "best_score": round(float(score), 3),
                    "best_candidate": "" if match is None else match.get("Nombre_Visual", ""),
                })
                continue

        target_col, target_state = infer_target(row, cols)
        matched.append({
            "excel_row": int(idx) + 2,
            "nombre_excel": row[name_col],
            "google_id": match["Google_ID"],
            "nombre_crm": match["Nombre_Visual"],
            "avance": int(row["__avance_num"]),
            "dest_col": target_col,
            "dest_estado": target_state,
            "method": method,
            "score": round(float(score), 3),
            "scope_actual": match.get("Scope_Networking", ""),
            "estado_actual": match.get("Estado_CRM", ""),
        })

    preview = pd.DataFrame(matched)
    if not preview.empty:
        priority = {col: idx for idx, col in enumerate(MILESTONE_COLUMNS)}
        preview["__priority"] = preview["dest_col"].map(priority).fillna(0)
        preview = (
            preview.sort_values(["google_id", "__priority", "excel_row"])
            .drop_duplicates("google_id", keep="last")
            .drop(columns=["__priority"])
            .reset_index(drop=True)
        )

    return preview, pd.DataFrame(ambiguous), pd.DataFrame(unmatched), cols, len(active)


def apply_updates(service, crm, preview):
    crm = crm.copy()
    for col in OUTPUT_COLUMNS:
        if col not in crm.columns:
            crm[col] = ""
    crm = crm[OUTPUT_COLUMNS]

    today = datetime.now().strftime("%d/%m/%y")
    by_id = {str(row["Google_ID"]).strip(): idx for idx, row in crm.iterrows()}
    for _, update in preview.iterrows():
        google_id = str(update["google_id"]).strip()
        if google_id not in by_id:
            continue
        idx = by_id[google_id]
        crm.loc[idx, "Scope_Networking"] = "TRUE"
        if not str(crm.loc[idx, "Nivel_Cercania"]).strip():
            crm.loc[idx, "Nivel_Cercania"] = "3"
        crm.loc[idx, update["dest_col"]] = today
        crm.loc[idx, "Estado_CRM"] = update["dest_estado"]

    values = [crm.columns.tolist()] + crm.fillna("").astype(str).values.tolist()
    service.spreadsheets().values().clear(
        spreadsheetId=SHEET_ID,
        range=CRM_RANGE,
    ).execute()
    service.spreadsheets().values().update(
        spreadsheetId=SHEET_ID,
        range=CRM_RANGE,
        valueInputOption="USER_ENTERED",
        body={"values": values},
    ).execute()
    return crm


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--excel-csv", default=".tmp_contactos_excel.csv")
    parser.add_argument("--preview-csv", default="migration_preview_networking_status.csv")
    parser.add_argument("--apply", action="store_true")
    args = parser.parse_args()

    creds = get_credentials()
    service = build("sheets", "v4", credentials=creds)
    crm = read_crm_sheet(service)
    preview, ambiguous, unmatched, detected_cols, active_count = build_preview(args.excel_csv, crm)
    preview.to_csv(args.preview_csv, index=False, encoding="utf-8-sig")

    summary = {
        "active_excel_rows_avance_gt_0": active_count,
        "matched_to_update": int(len(preview)),
        "exact_matches": int((preview["method"] == "exact").sum()) if not preview.empty else 0,
        "fuzzy_matches": int((preview["method"] == "fuzzy").sum()) if not preview.empty else 0,
        "ambiguous": int(len(ambiguous)),
        "unmatched": int(len(unmatched)),
        "currently_scope_true_among_matched": int((preview["scope_actual"].astype(str) == "TRUE").sum()) if not preview.empty else 0,
        "will_add_to_scope": int((preview["scope_actual"].astype(str) != "TRUE").sum()) if not preview.empty else 0,
        "target_states": preview["dest_estado"].value_counts().to_dict() if not preview.empty else {},
        "detected_excel_columns": detected_cols,
        "preview_csv": str(Path(args.preview_csv).resolve()),
        "applied": bool(args.apply),
    }

    if args.apply:
        backup_path = Path(
            "backup_CRM_Contactos_Extra_before_status_migration_"
            + datetime.now().strftime("%Y%m%d_%H%M%S")
            + ".csv"
        )
        crm.to_csv(backup_path, index=False, encoding="utf-8-sig")
        summary["backup_csv"] = str(backup_path.resolve())
        apply_updates(service, crm, preview)

    print(json.dumps(summary, ensure_ascii=False, indent=2))
    if not ambiguous.empty:
        print("\nAMBIGUOUS_SAMPLE")
        print(ambiguous.head(15).to_json(orient="records", force_ascii=False, indent=2))
    if not unmatched.empty:
        print("\nUNMATCHED_SAMPLE")
        print(unmatched.head(20).to_json(orient="records", force_ascii=False, indent=2))


if __name__ == "__main__":
    main()
