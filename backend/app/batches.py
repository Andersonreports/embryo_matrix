# WGA and sequencing batches made on the Batch creation page. Each batch is kept in batches.json, pushed to the
# PGS & NIPGS updates (edits) sheet through the Apps Script (action batchSave: one row per sample in the
# "WGA Batches" / "Sequencing Batches" tab), and downloaded as an .xlsx block laid out like the live batch
# record sheets, which staff paste in themselves. The live batch sheets are never written to.
import io
import json
import re
import threading
from datetime import datetime
from pathlib import Path
from threading import Lock

from openpyxl import Workbook
from openpyxl.styles import Alignment, Border, Font, PatternFill, Side

from . import edits_sheet

LOG_PATH = Path(__file__).parent / "data" / "batches.json"
_lock = Lock()

KINDS = {"wga": "WGA Batches", "seq": "Sequencing Batches"}
# Batch-level fields per kind: (key, label in the sheet)
META = {
    "wga": [("batchNo", "WGA Batch No"), ("date", "Processing Date"), ("instrument", "Instrument Name"), ("instrumentId", "Instrument ID")],
    "seq": [("batchNo", "Run ID"), ("date", "Run Date"), ("seqType", "Seq Type"), ("instrument", "Seq Platform"),
            ("instrumentId", "Instrument ID"), ("operator", "Operator")],
}
KIT = [("process", "Process"), ("name", "Kit / Reagent"), ("manufacturer", "Manufacturer"), ("lot", "Lot No."),
       ("expiry", "Expiry Date"), ("qty", "Qty Used"), ("preparedBy", "Prepared By"), ("checkedBy", "Checked By")]
# Sample table per kind: (key, column header). Keys the page doesn't fill stay blank for the bench to complete.
SAMPLE_COLS = {
    "wga": [("sno", "S. No."), ("biopsy", "Biopsy Date"), ("received", "Received Date"), ("sampleType", "Sample Type"),
            ("patient", "Patient Name"), ("embryo", "Embryo Tag"), ("index", "Barcode / Index"),
            ("dnaConc", "DNA Conc. (ng/µL)"), ("purified", "Purified WGA Conc. (ng/µL)")],
    "seq": [("sno", "S. No."), ("biopsy", "Biopsy Date"), ("received", "Received Date"), ("sampleType", "Sample Type"),
            ("patient", "Patient Name"), ("embryo", "Embryo Tag"), ("dnaConc", "DNA Conc. (ng/µL)"), ("volume", "Volume"),
            ("pool", "Pool Number"), ("index", "Index ID"), ("i7", "i7"), ("i5", "i5"), ("remarks", "Remarks")],
}


def _load() -> list:
    try:
        return json.loads(LOG_PATH.read_text(encoding="utf-8"))
    except Exception:
        return []


def _save(items: list) -> None:
    LOG_PATH.parent.mkdir(parents=True, exist_ok=True)
    LOG_PATH.write_text(json.dumps(items, ensure_ascii=False, indent=1), encoding="utf-8")


def _clean(v, n=200) -> str:
    return str(v if v is not None else "").strip()[:n]


def listing() -> list:
    return _load()


def create(kind: str, meta: dict, kit: dict, samples: list, user: str) -> dict:
    if kind not in KINDS:
        raise ValueError("Unknown batch kind")
    if not samples:
        raise ValueError("Choose at least one sample")
    meta = {k: _clean(meta.get(k)) for k, _ in META[kind]}
    if not meta["batchNo"]:
        raise ValueError(("WGA batch no" if kind == "wga" else "Run ID") + " is required")
    keys = [k for k, _ in SAMPLE_COLS[kind]] + ["sampleId", "test", "key"]
    rows = [{k: _clean(s.get(k)) for k in keys} for s in samples[:400]]
    for i, r in enumerate(rows):
        r["sno"] = str(i + 1)
    now = datetime.now()
    with _lock:
        items = _load()
        if any(b["kind"] == kind and b["meta"]["batchNo"].lower() == meta["batchNo"].lower() for b in items):
            raise ValueError(f"{'WGA batch' if kind == 'wga' else 'Run'} {meta['batchNo']} was already made here")
        entry = {"id": now.strftime("%Y%m%d%H%M%S%f"), "kind": kind, "meta": meta,
                 "kit": {k: _clean(kit.get(k)) for k, _ in KIT} if kit else {}, "samples": rows,
                 "createdBy": user, "createdAt": now.strftime("%Y-%m-%d %H:%M"), "sent": False, "error": ""}
        items.append(entry)
        _save(items)
    threading.Thread(target=retry_pending, daemon=True).start()
    return entry


def delete(batch_id: str) -> bool:
    with _lock:
        items = _load()
        hit = next((b for b in items if b["id"] == batch_id), None)
        if not hit:
            return False
        _save([b for b in items if b["id"] != batch_id])
    if hit.get("sent") and edits_sheet.configured():
        threading.Thread(target=_post_delete, args=(hit,), daemon=True).start()
    return True


def _post_delete(b: dict) -> None:
    try:
        edits_sheet._post({"action": "batchDelete", "tab": KINDS[b["kind"]], "id": b["id"]})
    except Exception:
        pass


def _body(b: dict) -> dict:
    head = [[label, b["meta"].get(k, "")] for k, label in META[b["kind"]]]
    kit = [[label, b["kit"].get(k, "")] for k, label in KIT if k != "process"] if b["kind"] == "wga" else []
    tail = [["Sample ID", ""], ["Test Name", ""], ["Created By", b["createdBy"]], ["Created At", b["createdAt"]], ["Batch ID", b["id"]]]
    rows = []
    for s in b["samples"]:
        cells = head + kit + [[label, s.get(k, "")] for k, label in SAMPLE_COLS[b["kind"]]] + tail
        cells[-5][1], cells[-4][1] = s.get("sampleId", ""), s.get("test", "")
        rows.append(cells)
    return {"action": "batchSave", "tab": KINDS[b["kind"]], "id": b["id"], "rows": rows}


def retry_pending() -> int:
    """Send every unsent batch, oldest first; returns how many are still waiting."""
    if not edits_sheet.configured():
        return len([b for b in _load() if not b.get("sent")])
    with _lock:
        items = _load()
        for b in items:
            if b.get("sent"):
                continue
            try:
                edits_sheet._post(_body(b))
                b["sent"], b["error"] = True, ""
            except Exception as ex:
                b["error"] = str(ex)
                break
        _save(items)
        return len([b for b in items if not b.get("sent")])


# ---- .xlsx download, laid out like the live batch record sheets ----
_THIN = Side(style="thin", color="000000")
_BOX = Border(left=_THIN, right=_THIN, top=_THIN, bottom=_THIN)
_BAND = PatternFill("solid", fgColor="CFE2F3")
_CENTER = Alignment(horizontal="center", vertical="center", wrap_text=True)


def _num(v: str):
    return float(v) if re.fullmatch(r"\d+(\.\d+)?", v or "") else v


def xlsx(b: dict) -> tuple[bytes, str]:
    kind, cols = b["kind"], SAMPLE_COLS[b["kind"]]
    width = len(cols)
    span = min(width, 8)  # the template's section bands and header block stop at column H
    last = chr(ord("A") + span - 1)
    wb = Workbook()
    ws = wb.active
    ws.title = ("WGA " if kind == "wga" else "Run ") + re.sub(r"[\\/*?:\[\]]", "-", b["meta"]["batchNo"])[:25]

    def box(r1, r2, cols_=None):
        for row in ws.iter_rows(min_row=r1, max_row=r2, min_col=1, max_col=cols_ or span):
            for c in row:
                c.border = _BOX

    def band(r, text):
        ws.merge_cells(f"A{r}:{last}{r}")
        c = ws[f"A{r}"]
        c.value, c.fill, c.font, c.alignment = text, _BAND, Font(bold=True, size=13), _CENTER
        box(r, r)

    r = 1
    band(r, "BATCH IDENTIFICATION")
    meta = META[kind]
    top = r + 1
    for i, (k, label) in enumerate(meta):
        row = top + i
        ws.merge_cells(f"C{row}:D{row}")
        ws.merge_cells(f"E{row}:F{row}")
        ws[f"C{row}"].value, ws[f"C{row}"].font = label, Font(bold=True, size=12)
        ws[f"E{row}"].value = _num(b["meta"].get(k, ""))
    bottom = top + len(meta) - 1
    ws.merge_cells(f"A{top}:B{bottom}")
    ws.merge_cells(f"G{top}:{last}{bottom}")
    box(top, bottom)
    r = bottom + 1
    if kind == "wga":
        band(r, "KIT / REAGENT DETAILS")
        for i, (_, label) in enumerate(KIT):
            c = ws.cell(r + 1, i + 1, label)
            c.font, c.alignment = Font(bold=True, size=12), _CENTER
        for i, (k, _) in enumerate(KIT):
            ws.cell(r + 2, i + 1, _num(b["kit"].get(k, "") or ("WGA" if k == "process" else ""))).alignment = _CENTER
        box(r + 1, r + 2)
        r += 3
        band(r, "QC CHECK")
        box(r + 1, r + 2)
        r += 3
    band(r, "SAMPLE DETAILS")
    for i, (_, label) in enumerate(cols):
        c = ws.cell(r + 1, i + 1, label)
        c.font, c.alignment = Font(bold=True, size=12), _CENTER
    prev = None
    for n, s in enumerate(b["samples"]):
        row = r + 2 + n
        first = s.get("patient") != prev  # the sheets write the patient and dates on a patient's first embryo only
        prev = s.get("patient")
        for i, (k, _) in enumerate(cols):
            v = s.get(k, "")
            if k in ("patient", "biopsy", "received") and not first:
                v = ""
            ws.cell(row, i + 1, _num(v) if k in ("sno", "dnaConc", "purified", "volume", "pool") else v).alignment = _CENTER
    box(r + 1, r + 1 + len(b["samples"]), width)
    for i, w in enumerate([8, 14, 14, 20, 26, 12, 16, 16, 16, 14, 14, 12, 18][:width]):
        ws.column_dimensions[chr(ord("A") + i)].width = w
    buf = io.BytesIO()
    wb.save(buf)
    name = f"{'WGA_Batch' if kind == 'wga' else 'Seq_Run'}_{re.sub(r'[^A-Za-z0-9]+', '_', b['meta']['batchNo'])}.xlsx"
    return buf.getvalue(), name
