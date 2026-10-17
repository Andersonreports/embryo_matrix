# WGA and sequencing batches made on the Batch creation page. Each batch is kept in batches.json, written to the
# PGS & NIPGS updates (edits) sheet through the Apps Script (action batchBlockSave: one block per batch in the
# "WGA Batches" / "Sequencing Batches" tab, laid out like the live batch record sheets - Batch identification,
# Kit / reagent, QC check, Sample details) and downloaded as an .xlsx of the same block. The bench fills in the
# results (WGA concentrations, barcodes...) and uploads that file back: apply_results() reads it, updates the
# batch and re-writes its block. The live batch sheets are never written to.
import io
import json
from datetime import date
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
    keys = [k for k, _ in SAMPLE_COLS[kind]] + ["sampleId", "test", "key", "editSid", "editTag"]
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
    """The batch's block for the edits sheet: the same grid, merges and styling as the .xlsx download."""
    return {"action": "batchBlockSave", "tab": KINDS[b["kind"]], "id": b["id"], **_layout(b)}


def retry_pending() -> int:
    """Send every unsent batch, oldest first; returns how many are still waiting."""
    if not edits_sheet.configured():
        return len([b for b in _load() if not (b.get("sent") and b.get("layout") == "block")])
    with _lock:
        items = _load()
        for b in items:
            # Batches sent before the block layout (one flat row per sample) are written again as a block.
            if b.get("sent") and b.get("layout") == "block":
                continue
            try:
                edits_sheet._post(_body(b))
                b["sent"], b["error"], b["layout"] = True, "", "block"
            except Exception as ex:
                b["error"] = str(ex)
                break
        _save(items)
        return len([b for b in items if not (b.get("sent") and b.get("layout") == "block")])


# ---- The batch block: one layout for the .xlsx download and the edits sheet ----
_THIN = Side(style="thin", color="000000")
_BOX = Border(left=_THIN, right=_THIN, top=_THIN, bottom=_THIN)
_BAND = PatternFill("solid", fgColor="CFE2F3")
_CENTER = Alignment(horizontal="center", vertical="center", wrap_text=True)
_WIDTHS = [8, 14, 14, 20, 26, 12, 16, 16, 16, 14, 14, 12, 18]
_NUMERIC = ("sno", "dnaConc", "purified", "volume", "pool")


def _num(v: str):
    return float(v) if re.fullmatch(r"\d+(\.\d+)?", v or "") else v


def _layout(b: dict) -> dict:
    """The block as a grid: rows of values (1-based positions below), merged ranges, section bands, bold cells,
    centred cells and bordered ranges. Rendered by xlsx() here and by batchBlockSave_ in the Apps Script."""
    kind, cols = b["kind"], SAMPLE_COLS[b["kind"]]
    width = len(cols)
    span = min(width, 8)  # the template's section bands and header block stop at column H
    grid, merges, bands, bold, center, boxes = {}, [], [], [], [], []

    def put(r, c, v, is_bold=False, is_center=False):
        grid[(r, c)] = "" if v is None else v
        if is_bold:
            bold.append([r, c])
        if is_center:
            center.append([r, c])

    def band(r, text):
        merges.append([r, 1, r, span])
        put(r, 1, text)
        bands.append(r)
        boxes.append([r, r, span])

    r = 1
    band(r, "BATCH IDENTIFICATION")
    meta = META[kind]
    top = r + 1
    for i, (k, label) in enumerate(meta):
        row = top + i
        merges += [[row, 3, row, 4], [row, 5, row, 6]]
        put(row, 3, label, is_bold=True)
        put(row, 5, b["meta"].get(k, ""))
    bottom = top + len(meta) - 1
    merges += [[top, 1, bottom, 2], [top, 7, bottom, span]]
    boxes.append([top, bottom, span])
    r = bottom + 1
    if kind == "wga":
        band(r, "KIT / REAGENT DETAILS")
        for i, (k, label) in enumerate(KIT):
            put(r + 1, i + 1, label, True, True)
            put(r + 2, i + 1, b["kit"].get(k, "") or ("WGA" if k == "process" else ""), is_center=True)
        boxes.append([r + 1, r + 2, span])
        r += 3
        band(r, "QC CHECK")
        boxes.append([r + 1, r + 2, span])
        r += 3
    band(r, "SAMPLE DETAILS")
    for i, (_, label) in enumerate(cols):
        put(r + 1, i + 1, label, True, True)
    prev = None
    for n, s in enumerate(b["samples"]):
        row = r + 2 + n
        first = s.get("patient") != prev  # the sheets write the patient and dates on a patient's first embryo only
        prev = s.get("patient")
        for i, (k, _) in enumerate(cols):
            v = s.get(k, "")
            if k in ("patient", "biopsy", "received") and not first:
                v = ""
            put(row, i + 1, v, is_center=True)
    last_row = r + 1 + len(b["samples"])
    boxes.append([r + 1, last_row, width])
    rows = [[grid.get((rr, cc), "") for cc in range(1, width + 1)] for rr in range(1, last_row + 1)]
    return {"rows": rows, "merges": merges, "bands": bands, "bold": bold, "center": center, "boxes": boxes,
            "span": span, "widths": _WIDTHS[:width]}


def xlsx(b: dict) -> tuple[bytes, str]:
    kind, lay = b["kind"], _layout(b)
    numeric_cols = {i + 1 for i, (k, _) in enumerate(SAMPLE_COLS[kind]) if k in _NUMERIC}
    sample_top = len(lay["rows"]) - len(b["samples"]) + 1
    wb = Workbook()
    ws = wb.active
    ws.title = ("WGA " if kind == "wga" else "Run ") + re.sub(r"[\\/*?:\[\]]", "-", b["meta"]["batchNo"])[:25]
    for r, row in enumerate(lay["rows"], 1):
        for c, v in enumerate(row, 1):
            if v != "":
                ws.cell(r, c, _num(v) if (r >= sample_top and c in numeric_cols) or (r < sample_top and c == 5) else v)
    for r1, c1, r2, c2 in lay["merges"]:
        ws.merge_cells(start_row=r1, start_column=c1, end_row=r2, end_column=c2)
    for r1, r2, c2 in lay["boxes"]:
        for row in ws.iter_rows(min_row=r1, max_row=r2, min_col=1, max_col=c2):
            for c in row:
                c.border = _BOX
    for r, c in lay["bold"]:
        ws.cell(r, c).font = Font(bold=True, size=12)
    for r, c in lay["center"]:
        ws.cell(r, c).alignment = _CENTER
    for r in lay["bands"]:
        c = ws.cell(r, 1)
        c.fill, c.font, c.alignment = _BAND, Font(bold=True, size=13), _CENTER
    for i, w in enumerate(lay["widths"]):
        ws.column_dimensions[chr(ord("A") + i)].width = w
    buf = io.BytesIO()
    wb.save(buf)
    name = f"{'WGA_Batch' if kind == 'wga' else 'Seq_Run'}_{re.sub(r'[^A-Za-z0-9]+', '_', b['meta']['batchNo'])}.xlsx"
    return buf.getvalue(), name


# ---- Results uploaded back: the downloaded block, filled in at the bench ----
# Sample columns the bench fills in, per kind; a blank cell in the file leaves the saved value alone.
RESULT_KEYS = {"wga": ("dnaConc", "purified", "index", "sampleType"),
               "seq": ("dnaConc", "volume", "pool", "index", "i7", "i5", "remarks", "sampleType")}


def _txt(v, dotted=False) -> str:
    if v is None:
        return ""
    if isinstance(v, (datetime, date)):
        return v.strftime("%d.%m.%Y" if dotted else "%d-%m-%Y")
    if isinstance(v, float):
        return f"{v:.4f}".rstrip("0").rstrip(".")
    return str(v).strip()


def _key(v) -> str:
    return re.sub(r"[^A-Z0-9]", "", str(v or "").upper())


def _sample_col(header: str, kind: str):
    """Which sample field a header in the uploaded file is - the sheets word some differently
    ("WGA Conc." for "DNA Conc.", "Index" for "Barcode / Index")."""
    h = re.sub(r"\s+", " ", header.lower()).strip()
    if not h:
        return None
    if "purified" in h:
        return "purified"
    if "conc" in h:
        return "dnaConc"
    if "barcode" in h or h in ("index", "index id"):
        return "index"
    for k, label in SAMPLE_COLS[kind]:
        if h == label.lower() or h.rstrip(".") == label.lower().rstrip("."):
            return k
    return None


def read_results(data: bytes) -> dict:
    """Read a filled-in batch block: {kind, batchNo, meta, kit, samples: [{field: value}]}."""
    from openpyxl import load_workbook
    try:
        wb = load_workbook(io.BytesIO(data), data_only=True)
    except Exception:
        raise ValueError("That isn't an Excel (.xlsx) file - upload the batch file you downloaded and filled in")
    ws = next((w for w in wb.worksheets if any(str(c.value or "").strip().upper() == "SAMPLE DETAILS"
                                               for row in w.iter_rows(max_col=3) for c in row)), wb.worksheets[0])
    rows = [[c for c in row] for row in ws.iter_rows(values_only=True)]
    labels = {r: [str(v or "").strip() for v in row] for r, row in enumerate(rows)}
    flat = [x.lower() for row in labels.values() for x in row]
    kind = "wga" if "wga batch no" in flat else "seq" if "run id" in flat else ""
    if not kind:
        raise ValueError("Couldn't find 'WGA Batch No' or 'Run ID' in the file - is this a batch file from this page?")

    def right_of(label):
        for r, row in labels.items():
            for c, x in enumerate(row):
                if x.lower() == label.lower():
                    for v in rows[r][c + 1:]:
                        if _txt(v):
                            return _txt(v)
                    return ""
        return ""

    meta = {k: right_of(label) for k, label in META[kind]}
    kit = {}
    if kind == "wga":
        for r, row in labels.items():
            low = [x.lower() for x in row]
            if "kit / reagent" in low and "lot no." in low and r + 1 < len(rows):
                for k, label in KIT:
                    if label.lower() in low:
                        kit[k] = _txt(rows[r + 1][low.index(label.lower())], dotted=(k == "expiry"))
                break
    head_r = next((r for r, row in labels.items() if "embryo tag" in [x.lower() for x in row]), None)
    if head_r is None:
        raise ValueError("Couldn't find the Sample Details header row (with 'Embryo Tag') in the file")
    cmap = {c: _sample_col(x, kind) for c, x in enumerate(labels[head_r])}
    samples, patient = [], ""
    for row in rows[head_r + 1:]:
        vals = {k: _txt(row[c]) for c, k in cmap.items() if k and c < len(row)}
        if not any(vals.values()):
            if samples:
                break
            continue
        if not vals.get("embryo"):
            continue
        patient = vals.get("patient") or patient  # the sheets write the patient on a patient's first embryo only
        vals["patient"] = patient
        samples.append(vals)
    return {"kind": kind, "batchNo": meta.get("batchNo", ""), "meta": meta, "kit": kit, "samples": samples}


def apply_results(data: bytes, user: str) -> dict:
    """Lay an uploaded, filled-in batch file over the batch made here with the same number. Returns the batch,
    the samples whose WGA concentrations changed (for the dashboard / edits sheet), and rows not matched."""
    got = read_results(data)
    kind, number = got["kind"], got["batchNo"]
    noun = "WGA batch" if kind == "wga" else "Run"
    with _lock:
        items = _load()
        b = next((x for x in items if x["kind"] == kind and _key(x["meta"]["batchNo"]) == _key(number)), None)
        if not b:
            raise ValueError(f"{noun} {number or '(no number in the file)'} wasn't made on this page - only batches created here can take results")
        for k, v in got["meta"].items():
            if v and k != "batchNo":
                b["meta"][k] = v[:200]
        for k, v in got["kit"].items():
            if v:
                b.setdefault("kit", {})[k] = v[:200]
        by_both = {(_key(s.get("patient")), _key(s.get("embryo"))): s for s in b["samples"]}
        by_tag = {}
        for s in b["samples"]:
            by_tag.setdefault(_key(s.get("embryo")), []).append(s)
        changed, unmatched, seen = [], [], set()
        for row in got["samples"]:
            s = by_both.get((_key(row.get("patient")), _key(row.get("embryo"))))
            if not s and len(by_tag.get(_key(row.get("embryo")), [])) == 1:
                s = by_tag[_key(row.get("embryo"))][0]
            if not s or id(s) in seen:
                unmatched.append(f"{row.get('patient', '')} {row.get('embryo', '')}".strip())
                continue
            seen.add(id(s))
            before = {k: s.get(k, "") for k in ("dnaConc", "purified")}
            for k in RESULT_KEYS[kind]:
                if row.get(k):
                    s[k] = row[k][:200]
            if kind == "wga" and any(s.get(k, "") != before[k] for k in before):
                changed.append(s)
        b["sent"], b["error"] = False, ""
        b["resultsAt"], b["resultsBy"] = datetime.now().strftime("%Y-%m-%d %H:%M"), user
        _save(items)
    threading.Thread(target=retry_pending, daemon=True).start()
    return {"batch": b, "changed": changed, "matched": len(seen), "unmatched": unmatched}
