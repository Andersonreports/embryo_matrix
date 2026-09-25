import io
import json
import re
import urllib.parse
import urllib.request
from datetime import date, datetime, timezone

import openpyxl
from sqlalchemy.orm import Session

from .config import settings
from .models import KVStore

IMPORTED_CASES_KEY = "embryomatrix-imported-cases"
IMPORT_HISTORY_KEY = "embryomatrix-import-history"
SYNC_STATUS_KEY = "embryomatrix-sheet-sync-status"
# DNA readings from the WGA batch sheets, per embryo tag ("AS1: 18.8, AS2: 25").
DNA_UNPURIFIED_FIELD = "dna conc unpurified"
DNA_PURIFIED_FIELD = "dna conc purified"
DNA_OLD_FIELD = "dna conc"  # single combined column used before the split
# Sequencing batch run(s) a sample was processed in, from the "Run ID" line above each
# run's table in the batch record sheet ("106A", or "101A, 106A" for a re-biopsy).
RUN_ID_FIELD = "run id"


def _normalize_header(h, i: int) -> str:
    cleaned = re.sub(r"[^a-z0-9]+", " ", str(h or "").lower()).strip()
    return cleaned or f"column {i + 1}"


def _cell(v) -> str:
    if v is None:
        return ""
    if isinstance(v, datetime):
        return v.strftime("%d-%m-%Y") if v.time() == datetime.min.time() else v.strftime("%d-%m-%Y %H:%M")
    if isinstance(v, date):
        return v.strftime("%d-%m-%Y")
    if isinstance(v, float):
        return str(int(v)) if v.is_integer() else str(v)
    return str(v).strip()


def fetch_workbook_tabs(sheet_id: str) -> list[tuple[str, list[dict]]]:
    """Fetches every tab of a spreadsheet as (tab_name, rows) pairs. Prefers the
    Apps Script web app (apps_script/Code.gs) when SHEET_API_URL is configured,
    since it works even when the sheet isn't shared "Anyone with the link" and
    doesn't depend on this server being able to reach docs.google.com directly.
    Falls back to the public xlsx export otherwise."""
    if settings.sheet_api_url:
        return _fetch_via_apps_script(sheet_id)
    return _fetch_via_xlsx_export(sheet_id)


def _fetch_via_apps_script(sheet_id: str) -> list[tuple[str, list[dict]]]:
    params = {"sheetId": sheet_id}
    if settings.sheet_api_token:
        params["token"] = settings.sheet_api_token
    url = f"{settings.sheet_api_url}?{urllib.parse.urlencode(params)}"
    req = urllib.request.Request(url, headers={"User-Agent": "EmbryoMatrix-Sync/1.0"})
    with urllib.request.urlopen(req, timeout=60) as resp:
        payload = json.loads(resp.read().decode("utf-8"))
    if payload.get("error"):
        raise RuntimeError(f"Apps Script error: {payload['error']}")
    tabs = []
    for source in payload.get("sources", []):
        for tab in source.get("tabs", []):
            tabs.append((tab["name"], tab["rows"]))
    return tabs


def _fetch_via_xlsx_export(sheet_id: str) -> list[tuple[str, list[dict]]]:
    """Downloads the whole spreadsheet (every tab in one request) and parses each
    tab the same way the frontend's CSV import does: first row is headers, blank
    rows are skipped. New tabs added later (e.g. next month) are picked up automatically."""
    url = f"https://docs.google.com/spreadsheets/d/{sheet_id}/export?format=xlsx"
    req = urllib.request.Request(url, headers={"User-Agent": "EmbryoMatrix-Sync/1.0"})
    with urllib.request.urlopen(req, timeout=60) as resp:
        raw = resp.read()
    wb = openpyxl.load_workbook(io.BytesIO(raw), read_only=True, data_only=True)
    tabs = []
    for ws in wb.worksheets:
        rows_iter = ws.iter_rows(values_only=True)
        try:
            header_row = next(rows_iter)
        except StopIteration:
            continue
        headers = [_normalize_header(h, i) for i, h in enumerate(header_row)]
        records = []
        for row in rows_iter:
            if not any(_cell(cell) for cell in row):
                continue
            records.append({headers[i]: _cell(row[i]) if i < len(row) else "" for i in range(len(headers))})
        tabs.append((ws.title, records))
    wb.close()
    return tabs


def _field(r: dict, names: list[str]) -> str:
    for n in names:
        for k, v in r.items():
            if (k == n or n in k) and v:
                return str(v).strip()
    return ""


def _clean_id(v: str) -> str:
    v = re.sub(r"_L\d+$", "", (v or "").upper())
    return re.sub(r"[^A-Z0-9]", "", v)


def _result_identity(r: dict) -> tuple[str, str]:
    raw = _field(r, ["sample name", "embryo name", "embryo"])
    clean = re.sub(r"_L\d+$", "", raw, flags=re.I).strip()
    cut = clean.rfind("-")
    if cut > 0:
        patient = re.sub(r"[^a-z0-9]", "", clean[:cut], flags=re.I)
        embryo = re.sub(r"[^a-z0-9]", "", clean[cut + 1:], flags=re.I)
        return patient, embryo
    return "", _clean_id(clean)


def _record_key(r: dict) -> str:
    id_patient, id_embryo = _result_identity(r)
    patient = _field(r, ["patient name", "patient"]) or id_patient
    embryo = _field(r, ["embryo id", "embryo name", "sample name", "sample id"]) or id_embryo
    return f"{_clean_id(patient)}|{_clean_id(embryo)}"


def _name_key(name: str) -> str:
    return re.sub(r"[^A-Z]", "", (name or "").upper())


def _expand_embryo_tags(field: str) -> list[str]:
    """'KK-1,2' -> ['KK1','KK2']; 'PH1,2' -> ['PH1','PH2']; 'MS2' -> ['MS2'];
    'SY1BL,SY2BL' -> ['SY1BL','SY2BL'] (already full tags, dash-less prefix rule doesn't fit)."""
    field = (field or "").strip()
    if not field:
        return []
    m = re.match(r"^([A-Za-z]+)-?(\d+)((?:,\s*\d+)*)$", field)
    if m:
        prefix, first, rest = m.groups()
        nums = [first] + [n.strip() for n in rest.split(",") if n.strip()]
        return [f"{prefix}{n}".upper() for n in nums]
    return [t.strip().upper() for t in field.split(",") if t.strip()]


def _find_dna_header_row(rows: list[dict]) -> dict | None:
    """Batch-run sheets (WGA/sequencing logs) bury their real table header a dozen
    rows into a report template instead of row 1, so the generic row-1-as-header
    parse produces useless 'column N' keys and every row gets skipped downstream.
    Find the row that actually reads 'Patient Name' / 'Embryo Tag' / 'DNA Conc' so
    we can pull real values out of it despite the column keys being garbage."""
    for r in rows:
        labels = {str(v).strip().lower(): k for k, v in r.items()}
        if "patient name" in labels and "embryo tag" in labels and any("dna conc" in lbl for lbl in labels):
            # "DNA Conc. (ng/uL)" is the unpurified reading; "Purified WGA Conc." the purified one.
            dna_key = next(k for lbl, k in labels.items() if "dna conc" in lbl and "purified" not in lbl)
            purified_key = next((k for lbl, k in labels.items() if "purified" in lbl and "conc" in lbl), None)
            return {"patient": labels["patient name"], "embryo": labels["embryo tag"], "dna_conc": dna_key, "purified": purified_key}
    return None


def _extract_dna_records(rows: list[dict]) -> list[dict]:
    header = _find_dna_header_row(rows)
    if not header:
        return []
    records = []
    last_patient = ""
    seen_header = False
    run_id = ""
    for r in rows:
        # A tab can hold several runs stacked one under another, each headed by a
        # "Run ID | 106A" line; the value is the first filled cell after the label.
        cells = [str(v).strip() for v in r.values()]
        if "run id" in (c.lower() for c in cells):
            i = next(i for i, c in enumerate(cells) if c.lower() == "run id")
            run_id = next((c for c in cells[i + 1:] if c), "")
            last_patient = ""
            continue
        if str(r.get(header["patient"], "")).strip().lower() == "patient name":
            seen_header = True  # the table header, repeated for every run
            continue
        if not seen_header:
            continue
        patient = str(r.get(header["patient"], "")).strip()
        if patient:
            last_patient = patient
        embryo = str(r.get(header["embryo"], "")).strip()
        dna_conc = str(r.get(header["dna_conc"], "")).strip()
        purified = str(r.get(header["purified"], "")).strip() if header["purified"] else ""
        if not last_patient or not embryo or not (dna_conc or purified or run_id):
            continue
        records.append({"patient": last_patient, "embryo_tag": embryo.upper(), "dna_conc": dna_conc, "purified": purified, "run": run_id})
    return records


def _apply_dna_conc(by_key: dict, dna_records: list[dict]) -> None:
    """Merges DNA concentration readings (identified only by patient name + a
    per-embryo tag, e.g. 'KK2') onto the coarser per-specimen tracker rows
    (identified by patient name + a compound embryo field like 'KK-1,2')."""
    if not dna_records:
        return
    by_patient: dict[str, list[dict]] = {}
    for rec in dna_records:
        by_patient.setdefault(_name_key(rec["patient"]), []).append(rec)
    name_index: list[tuple[str, str]] = []
    for key, row in by_key.items():
        pname = _field(row, ["patient name", "patient"])
        if pname:
            name_index.append((_name_key(pname), key))
    for pkey, recs in by_patient.items():
        if not pkey:
            continue
        for nk, key in name_index:
            if pkey not in nk and nk not in pkey:
                continue
            row = by_key[key]
            tags = set(_expand_embryo_tags(_field(row, ["embryo name", "embryo id", "sample name"])))
            matches = [rec for rec in recs if rec["embryo_tag"] in tags]
            if not matches:
                continue
            joined = lambda f: ", ".join(sorted({f"{m['embryo_tag']}: {m[f]}" for m in matches if m[f]}))
            out = {k: v for k, v in row.items() if k != DNA_OLD_FIELD}
            for field_name, rec_key in ((DNA_UNPURIFIED_FIELD, "dna_conc"), (DNA_PURIFIED_FIELD, "purified")):
                if joined(rec_key):
                    out[field_name] = joined(rec_key)
            runs = sorted({m["run"] for m in matches if m.get("run")})
            if runs:
                out[RUN_ID_FIELD] = ", ".join(runs)
            by_key[key] = out


def parse_sources(sheet_ids: str) -> list[str]:
    return [s.strip() for s in sheet_ids.split("|") if s.strip()]


def sync_sources(db: Session, sheet_ids: list[str]) -> dict:
    """Fetch every tab of each configured spreadsheet and upsert its rows into the
    same imported-cases store the UI reads on load, keyed by patient+embryo identity
    so re-syncing updates existing records instead of duplicating them. Tabs are
    discovered automatically, so new ones (e.g. next month's) need no config change."""
    store = db.get(KVStore, IMPORTED_CASES_KEY)
    previous_by_key = {_record_key(r): r for r in (store.value if store else []) or []}
    fresh_rows: dict[str, dict] = {}
    fresh_order: list[str] = []
    added = updated = skipped = 0
    errors = []
    tab_labels = []
    dna_records = []
    imported_at = datetime.now(timezone.utc).isoformat()

    for sheet_id in sheet_ids:
        try:
            tabs = fetch_workbook_tabs(sheet_id)
        except Exception as e:
            errors.append(f"{sheet_id}: {e}")
            continue
        for label, rows in tabs:
            tab_labels.append(label)
            dna_records.extend(_extract_dna_records(rows))
            for r in rows:
                # A cell that just repeats its own column heading (e.g. "Transfer
                # Details" typed under the Transfer Details column) isn't data.
                r = {k: ("" if not k.startswith("column ") and str(v).strip().lower() == k else v) for k, v in r.items()}
                key = _record_key(r)
                if not key or key == "|":
                    skipped += 1
                    continue
                if key in previous_by_key:
                    updated += 1
                else:
                    added += 1
                # Carry forward anything already on this row (e.g. a manually
                # uploaded QC/result merge) that the live sheet doesn't provide.
                merged = {**previous_by_key.get(key, {}), **fresh_rows.get(key, {}), **r,
                          "_mergedAt": imported_at, "_importSource": label, "_stale": False}
                if key not in fresh_rows:
                    fresh_order.append(key)
                fresh_rows[key] = merged

    _apply_dna_conc(fresh_rows, dna_records)
    if errors:
        # At least one workbook failed to fetch this round (the Apps Script
        # endpoint is occasionally flaky - timeouts, transient 404s). Treating
        # that as "every row from that workbook is gone" would wrongly push
        # thousands of still-current rows to the stale tail. Fall back to a
        # plain in-place upsert instead: keep every previous row's position,
        # patch in whatever we did manage to fetch, append genuinely new rows.
        merged_rows = list(previous_by_key.values())
        index_by_key = {key: i for i, key in enumerate(previous_by_key)}
        for key, row in fresh_rows.items():
            if key in index_by_key:
                merged_rows[index_by_key[key]] = row
            else:
                merged_rows.append(row)
        stale_rows = []
    else:
        # Every configured workbook fetched cleanly, so this run's tab/row order
        # is a complete, trustworthy picture of the live sheet - use it as the
        # row order (matching the sheet) instead of each key's original
        # insertion position, which drifts from the sheet over time. Rows no
        # longer present anywhere (deleted upstream) are kept, not discarded,
        # but pushed after the current ones so today's order stays exact.
        stale_rows = [{**row, "_stale": True} for key, row in previous_by_key.items() if key not in fresh_rows]
        merged_rows = [fresh_rows[k] for k in fresh_order] + stale_rows
    # A stable sequence number per row, independent of the patient-name grouping
    # the UI does for the case view. Two rows with the same patient name across
    # different tabs collapse into one "case" client-side, and that case's slot
    # in the case list is pinned by whichever row was seen FIRST overall — so a
    # patient with an earlier-month row and a Pending row would otherwise show up
    # near the top of a Pending-only view instead of in the Pending tab's actual
    # position. Sorting by this sequence lets the table honor sheet order even
    # when case-grouping reorders things.
    for i, row in enumerate(merged_rows):
        row["_seq"] = i
        # The old combined column held the unpurified "DNA Conc." reading; carry it over once.
        if DNA_OLD_FIELD in row:
            old = row.pop(DNA_OLD_FIELD)
            if old and not row.get(DNA_UNPURIFIED_FIELD):
                row[DNA_UNPURIFIED_FIELD] = old
    # Whether anything besides the per-run bookkeeping fields differs from what the
    # UI already has, so a page that just loaded the data can skip re-downloading it.
    volatile = ("_mergedAt", "_seq")
    strip = lambda rows: [{k: v for k, v in r.items() if k not in volatile} for r in rows]
    changed = strip((store.value if store else []) or []) != strip(merged_rows)
    if store:
        store.value = merged_rows
    else:
        db.add(KVStore(key=IMPORTED_CASES_KEY, value=merged_rows))

    history_row = db.get(KVStore, IMPORT_HISTORY_KEY)
    history = (history_row.value if history_row else []) or []
    history.insert(0, {
        "id": str(int(datetime.now(timezone.utc).timestamp() * 1000)),
        "importedAt": imported_at,
        "source": "Live Google Sheets sync",
        "added": added, "updated": updated, "skipped": skipped, "total": len(merged_rows),
        "stale": len(stale_rows), "errors": errors,
    })
    if history_row:
        history_row.value = history[:100]
    else:
        db.add(KVStore(key=IMPORT_HISTORY_KEY, value=history[:100]))

    status = {
        "lastSyncedAt": imported_at, "added": added, "updated": updated, "skipped": skipped,
        "total": len(merged_rows), "stale": len(stale_rows), "sources": tab_labels, "errors": errors,
        "changed": changed,
    }
    status_row = db.get(KVStore, SYNC_STATUS_KEY)
    if status_row:
        status_row.value = status
    else:
        db.add(KVStore(key=SYNC_STATUS_KEY, value=status))

    db.commit()
    return status
