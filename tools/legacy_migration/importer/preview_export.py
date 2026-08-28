#!/usr/bin/env python
"""
Preview a CRM Networking mirror export before importing it to cloud.

This script intentionally does not print personal data. It only reports structure,
counts, hashes, missing files, blocking errors and target table row estimates.
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path
from export_package import preview_from_package, read_export_package


def main() -> int:
    parser = argparse.ArgumentParser(description="Preview a CRM Networking mirror export ZIP.")
    parser.add_argument("zip_path", help="Path to crm-networking-export-*.zip")
    parser.add_argument("--pretty", action="store_true", help="Pretty-print JSON output")
    args = parser.parse_args()

    try:
        preview, exit_code = preview_from_package(read_export_package(Path(args.zip_path)))
    except Exception as exc:
        print(json.dumps({"ok": False, "error": str(exc)}, ensure_ascii=False), file=sys.stderr)
        return 1

    print(json.dumps(preview, ensure_ascii=False, indent=2 if args.pretty else None))
    return exit_code


if __name__ == "__main__":
    raise SystemExit(main())
