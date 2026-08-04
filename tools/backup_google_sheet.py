from datetime import datetime
from pathlib import Path

import pandas as pd
from google.oauth2.credentials import Credentials
from googleapiclient.discovery import build


SCOPES = [
    "https://www.googleapis.com/auth/contacts.readonly",
    "https://www.googleapis.com/auth/spreadsheets",
    "https://www.googleapis.com/auth/gmail.readonly",
    "https://www.googleapis.com/auth/calendar.readonly",
]

SPREADSHEET_ID = "14tigwoo1mDybh-HxhJ64dsmng2y39nqY6JoiCImtM8E"


def rows_to_frame(rows):
    if not rows:
        return pd.DataFrame()
    width = max(len(row) for row in rows)
    padded = [(row + [""] * (width - len(row)))[:width] for row in rows]
    return pd.DataFrame(padded)


def safe_sheet_name(name):
    return "".join(ch if ch.isalnum() or ch in "._-" else "_" for ch in name)[:80]


def main():
    root = Path(__file__).resolve().parents[1]
    out_dir = root / "backups" / f"google_sheet_{datetime.now().strftime('%Y%m%d_%H%M%S')}"
    out_dir.mkdir(parents=True, exist_ok=True)

    creds = Credentials.from_authorized_user_file(root / "token.json", SCOPES)
    service = build("sheets", "v4", credentials=creds)
    metadata = service.spreadsheets().get(
        spreadsheetId=SPREADSHEET_ID,
        fields="sheets.properties.title",
    ).execute()

    manifest = []
    for sheet in metadata.get("sheets", []):
        title = sheet["properties"]["title"]
        result = service.spreadsheets().values().get(
            spreadsheetId=SPREADSHEET_ID,
            range=f"'{title}'",
        ).execute()
        rows = result.get("values", [])
        frame = rows_to_frame(rows)
        file_path = out_dir / f"{safe_sheet_name(title)}.csv"
        frame.to_csv(file_path, index=False, header=False, encoding="utf-8-sig")
        manifest.append({"sheet": title, "rows": len(rows), "columns": frame.shape[1], "file": file_path.name})

    pd.DataFrame(manifest).to_csv(out_dir / "manifest.csv", index=False, encoding="utf-8-sig")
    print(out_dir)


if __name__ == "__main__":
    main()
