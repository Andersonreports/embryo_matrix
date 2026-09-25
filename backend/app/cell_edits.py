# Manual corrections to the registry, kept in their own .xlsx instead of the
# database - this app won't own a database once it's folded into the parent
# app, so this file is the durable record of every edit a lab user makes.
import re
from datetime import datetime, timezone
from pathlib import Path
from threading import Lock

import openpyxl

EDITABLE_COLUMNS = {"dna conc unpurified", "dna conc purified", "karyotype", "pgt result"}

EDITS_PATH = Path(__file__).parent / "data" / "cell_edits.xlsx"
_HEADERS = ["Sample ID", "Embryo", "Column", "Value", "Edited By", "Edited At"]
_lock = Lock()


def _clean_id(v) -> str:
    return re.sub(r"[^A-Za-z0-9]", "", str(v or "")).upper()


def _ensure_workbook():
    EDITS_PATH.parent.mkdir(parents=True, exist_ok=True)
    if EDITS_PATH.exists():
        return openpyxl.load_workbook(EDITS_PATH)
    wb = openpyxl.Workbook()
    ws = wb.active
    ws.title = "Edits"
    ws.append(_HEADERS)
    return wb


def list_edits() -> list[dict]:
    if not EDITS_PATH.exists():
        return []
    wb = openpyxl.load_workbook(EDITS_PATH, read_only=True)
    try:
        ws = wb["Edits"] if "Edits" in wb.sheetnames else wb.active
        out = []
        for row in ws.iter_rows(min_row=2, values_only=True):
            if not row or not row[0]:
                continue
            sample_id, embryo, column, value, edited_by, edited_at = (list(row) + [None] * 6)[:6]
            out.append({
                "sampleId": str(sample_id or ""),
                "embryo": str(embryo or ""),
                "column": str(column or ""),
                "value": "" if value is None else str(value),
                "editedBy": str(edited_by or ""),
                "editedAt": str(edited_at or ""),
            })
        return out
    finally:
        wb.close()


def save_edit(sample_id: str, embryo: str, column: str, value: str, user: str) -> dict:
    column = str(column or "").strip().lower()
    if column not in EDITABLE_COLUMNS:
        raise ValueError(f"'{column}' is not an editable column")
    sample_id = str(sample_id or "").strip()
    if not sample_id:
        raise ValueError("sampleId is required")
    embryo = str(embryo or "").strip()
    value = str(value or "").strip()
    key_sample, key_embryo = _clean_id(sample_id), _clean_id(embryo)
    now = datetime.now(timezone.utc).isoformat()
    old_value = None
    with _lock:
        wb = _ensure_workbook()
        ws = wb["Edits"] if "Edits" in wb.sheetnames else wb.active
        found = False
        for row in ws.iter_rows(min_row=2):
            cell_sample = row[0].value
            if not cell_sample:
                continue
            if (_clean_id(cell_sample) == key_sample
                    and _clean_id(row[1].value or "") == key_embryo
                    and str(row[2].value or "").strip().lower() == column):
                old_value = row[3].value
                row[3].value = value
                row[4].value = user
                row[5].value = now
                found = True
                break
        if not found:
            ws.append([sample_id, embryo, column, value, user, now])
        wb.save(EDITS_PATH)
    return {
        "sampleId": sample_id, "embryo": embryo, "column": column, "value": value,
        "editedBy": user, "editedAt": now, "oldValue": "" if old_value is None else str(old_value),
    }


def delete_edit(sample_id: str, embryo: str, column: str) -> bool:
    key_sample, key_embryo = _clean_id(sample_id), _clean_id(embryo)
    column = str(column or "").strip().lower()
    if not EDITS_PATH.exists():
        return False
    with _lock:
        wb = openpyxl.load_workbook(EDITS_PATH)
        ws = wb["Edits"] if "Edits" in wb.sheetnames else wb.active
        for row in ws.iter_rows(min_row=2):
            cell_sample = row[0].value
            if not cell_sample:
                continue
            if (_clean_id(cell_sample) == key_sample
                    and _clean_id(row[1].value or "") == key_embryo
                    and str(row[2].value or "").strip().lower() == column):
                ws.delete_rows(row[0].row, 1)
                wb.save(EDITS_PATH)
                return True
        return False
