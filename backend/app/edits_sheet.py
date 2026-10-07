# Live "EmbryoMatrix – Edited samples" Google Sheet, written through the Apps Script web app
# (apps_script/Code.gs, doPost). Every manual edit made in Samples > Embryo view upserts that
# embryo's whole row there; the app reads the edited values back from it (GET ?action=edits).
#
# The three source sheets are never written to - the script only writes to the spreadsheet
# it created itself. cell_edits.xlsx stays as the local copy: if the sheet can't be reached
# (script not redeployed yet, no internet), the push is queued here and retried later.
import json
import threading
import re
import time
from datetime import datetime, timedelta
import urllib.parse
import urllib.request
from pathlib import Path
from threading import Lock

from .config import settings

PENDING_PATH = Path(__file__).parent / "data" / "edits_sheet_pending.json"
STATE_PATH = Path(__file__).parent / "data" / "edits_sheet.json"
_lock = Lock()
_cache = {"at": 0.0, "edits": None, "miss_at": 0.0}
# Why the last push failed (shown on the Edits sheet button), cleared by the next successful push.
_last_error = {"text": ""}
OLD_DEPLOYMENT = ("SHEET_API_URL in backend/.env points to an Apps Script deployment without the edits support - "
                  "copy the current SHEET_API_URL / SHEET_API_TOKEN into this server's backend/.env and restart it")
CACHE_SECONDS = 30
# After a failed / unsupported read, wait this long before asking again - an Apps Script
# deployment without the edits support answers ?action=edits with all three source sheets.
MISS_SECONDS = 600


def _clean_id(v) -> str:
    return re.sub(r"[^A-Za-z0-9]", "", str(v or "")).upper()


def record_key(sample_id: str, embryo: str) -> str:
    return f"{_clean_id(sample_id)}|{_clean_id(embryo)}"


def configured() -> bool:
    return bool(settings.sheet_api_url)


def _read_json(path: Path, default):
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        return default


def _write_json(path: Path, value) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, ensure_ascii=False, indent=1), encoding="utf-8")


def _post(body: dict) -> dict:
    body = {**body, "token": settings.sheet_api_token}
    req = urllib.request.Request(
        settings.sheet_api_url, data=json.dumps(body).encode("utf-8"),
        headers={"Content-Type": "application/json", "User-Agent": "EmbryoMatrix-Edits/1.0"}, method="POST",
    )
    # Apps Script answers a POST with a 302 to the result page; urllib follows it as a GET.
    with urllib.request.urlopen(req, timeout=25) as resp:
        text = resp.read().decode("utf-8")
    try:
        out = json.loads(text)
    except ValueError:
        raise RuntimeError("The Apps Script web app didn't return JSON - redeploy it with the edits support (apps_script/Code.gs)")
    if out.get("error"):
        raise RuntimeError(f"Apps Script error: {out['error']}")
    # Only the edits-capable script answers {"ok": true}; an older deployment replies with
    # something else and writes nothing, so that must not count as sent.
    if body.get("action") in ("editsUpsert", "editsRevert") and out.get("ok") is not True:
        raise RuntimeError(OLD_DEPLOYMENT)
    if out.get("url"):
        _write_json(STATE_PATH, {"url": out["url"], "sheetId": out.get("sheetId", "")})
    return out


def _send_or_queue(body: dict) -> dict:
    """Push one change; on failure keep it (newest per record + column wins) for retry_pending()."""
    if not configured():
        return {"ok": False, "status": "not-configured"}
    with _lock:
        try:
            _post(body)
            _last_error["text"] = ""
            _cache["at"] = _cache["miss_at"] = 0.0
            return {"ok": True, "status": "saved"}
        except Exception as e:
            _last_error["text"] = str(e)
            pending = [p for p in _read_json(PENDING_PATH, []) if not (p.get("key") == body["key"] and p.get("column") == body["column"])]
            pending.append(body)
            _write_json(PENDING_PATH, pending)
            return {"ok": False, "status": "queued", "error": str(e)}


def _queue_and_send(body: dict) -> dict:
    """Queue the change and send it from a background thread, so saving an edit never waits on
    Google (a push takes seconds). Newest per record + column wins; failures stay queued."""
    if not configured():
        return {"ok": False, "status": "not-configured"}
    with _lock:
        pending = [p for p in _read_json(PENDING_PATH, []) if not (p.get("key") == body["key"] and p.get("column") == body["column"])]
        pending.append(body)
        _write_json(PENDING_PATH, pending)
    threading.Thread(target=retry_pending, daemon=True).start()
    return {"ok": True, "status": "sending"}


def push_edit(entry: dict, row: list) -> dict:
    return _queue_and_send({
        "action": "editsUpsert", "key": record_key(entry["sampleId"], entry["embryo"]),
        "sampleId": entry["sampleId"], "embryo": entry["embryo"], "column": entry["column"],
        "editedBy": entry.get("editedBy", ""), "editedAt": entry.get("editedAt", ""),
        "row": [[str(h), "" if v is None else str(v)] for h, v in (row or [])],
    })


def push_revert(sample_id: str, embryo: str, column: str) -> dict:
    return _queue_and_send({"action": "editsRevert", "key": record_key(sample_id, embryo), "sampleId": sample_id, "embryo": embryo, "column": str(column or "").strip().lower()})


def retry_pending() -> int:
    """Re-send queued changes in order; returns how many are still waiting."""
    if not configured():
        return 0
    with _lock:
        pending = _read_json(PENDING_PATH, [])
        left = []
        for i, body in enumerate(pending):
            try:
                _post(body)
                _last_error["text"] = ""
            except Exception as e:
                _last_error["text"] = str(e)
                left = pending[i:]
                break
        _write_json(PENDING_PATH, left)
        if len(left) < len(pending):
            _cache["at"] = _cache["miss_at"] = 0.0
        return len(left)


def _refresh() -> None:
    """Read the edited values from the sheet into the cache (network call - run off-request)."""
    # sheetId is a name no spreadsheet has: the new script answers ?action=edits before looking
    # at it, while an older deployment fails fast instead of reading all three source sheets.
    params = {"action": "edits", "sheetId": "embryomatrix-edits-only"}
    if settings.sheet_api_token:
        params["token"] = settings.sheet_api_token
    try:
        req = urllib.request.Request(f"{settings.sheet_api_url}?{urllib.parse.urlencode(params)}", headers={"User-Agent": "EmbryoMatrix-Edits/1.0"})
        with urllib.request.urlopen(req, timeout=25) as resp:
            out = json.loads(resp.read().decode("utf-8"))
    except Exception:
        _cache["miss_at"] = time.time()
        return
    if out.get("error") or "edits" not in out:  # error, or an old deployment that doesn't know ?action=edits
        _cache["miss_at"] = time.time()
        if "edits" not in out and not out.get("error"):
            _last_error["text"] = OLD_DEPLOYMENT
        return
    if out.get("url"):
        _write_json(STATE_PATH, {**_read_json(STATE_PATH, {}), "url": out["url"]})
    _cache.update(at=time.time(), edits=out["edits"], miss_at=0.0)


_refreshing = Lock()


def _background(work) -> None:
    if not _refreshing.acquire(blocking=False):
        return  # one refresh at a time
    def run():
        try:
            work()
        finally:
            _refreshing.release()
    threading.Thread(target=run, daemon=True).start()


def fetch_edits() -> list | None:
    """Last edited values read from the sheet, or None when it hasn't been read. Never blocks:
    when the copy is stale, queued pushes are retried and the sheet re-read in the background."""
    if not configured():
        return None
    now = time.time()
    stale = _cache["edits"] is None or now - _cache["at"] >= CACHE_SECONDS
    if stale and now - _cache["miss_at"] >= MISS_SECONDS:
        _background(lambda: (retry_pending(), _refresh()))
    return _cache["edits"]


def merged_edits(local: list) -> list:
    """The sheet's edited values win; local edits the sheet doesn't have yet (queued) are kept."""
    sheet = fetch_edits()
    if sheet is None:
        return local
    key = lambda e: (_clean_id(e.get("sampleId")), _clean_id(e.get("embryo")), str(e.get("column", "")).strip().lower())
    out = {key(e): e for e in local}  # incl. edits made before the sheet existed
    out.update({key(e): e for e in sheet})
    return list(out.values())


def status() -> dict:
    return {"configured": configured(), "url": _read_json(STATE_PATH, {}).get("url", ""), "pending": len(_read_json(PENDING_PATH, [])),
            "error": _last_error["text"]}


_backfilled: set = set()


def missing_from_sheet(local: list) -> list:
    """Local edits the sheet doesn't have (e.g. saved while this server pointed at an old deployment).
    Each is returned once per server run, so the caller can push it again."""
    sheet = _cache["edits"]
    if sheet is None:
        return []
    key = lambda e: (_clean_id(e.get("sampleId")), _clean_id(e.get("embryo")), str(e.get("column", "")).strip().lower())
    have = {key(e) for e in sheet}
    queued = {(p.get("key"), p.get("column")) for p in _read_json(PENDING_PATH, [])}
    out = []
    for e in local:
        k = key(e)
        if not str(e.get("value") or "").strip():
            continue  # a cleared cell: nothing to re-add
        if k in have or k in _backfilled or (record_key(e.get("sampleId"), e.get("embryo")), e.get("column")) in queued:
            continue
        _backfilled.add(k)
        out.append(e)
    return out


# Samples > Embryo view headers, in table order (matches EDITS_VIEW_COLUMNS in apps_script/Code.gs).
VIEW_COLUMNS = ['DATE OF BIOPSY', 'DATE SAMPLE RECEIVED', 'DATE TRF RECEIVED', 'RECEIVED BY', 'BOX NUMBER', 'SAMPLE ID', 'REMARKS', 'PATIENT NAME', 'NUMBER OF EMBRYOS', 'EMBRYO NAME', 'WGA CONC UNPURIFIED', 'WGA CONC PURIFIED', 'EMBRYO GRADE', 'KARYOTYPE', 'PGT RESULT', 'CONTROLS WGA SEQ CONTROLS', 'TEST NAME', 'CENTER NAME', 'LOCATION', 'EMBRYOLOGIST NAME', 'WGA DONE ON', 'WGA DONE BY', 'TRANSFERRED', 'TRANSFER DETAILS', 'KIT DETAIL', 'RUN ID', 'TAT']
_KEY_FOR = {'WGA CONC UNPURIFIED': 'dna conc unpurified', 'WGA CONC PURIFIED': 'dna conc purified'}


def _embryo_tags(name: str) -> list[str]:
    """Python twin of the app's expandEmbryoTags for the common shapes ("DS-1,2,3", "AS1, AS2")."""
    clean = re.sub(r"_L\d+$", "", str(name or "").strip(), flags=re.I)
    if "-" in clean:
        prefix, nums = clean.rsplit("-", 1)
        p = _clean_id(prefix)
        return [p + _clean_id(n) for n in nums.split(",") if _clean_id(n)]
    return [_clean_id(x) for x in clean.split(",") if _clean_id(x)]


def _edit_sample_id(r: dict) -> str:
    """Same rule as the app's editSampleId: sample ID / box number, else patient name + date received."""
    for k in ("sample id", "sample no", "box number"):
        if str(r.get(k) or "").strip():
            return str(r[k]).strip()
    return " ".join(x for x in (str(r.get("patient name") or "").strip(), str(r.get("date sample received") or "").strip()) if x)


def _tat(received: str, test: str) -> str:
    m = re.match(r"^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})", str(received or "").strip())
    if not m:
        return ""
    try:
        d = datetime(int(m[3]), int(m[2]), int(m[1]))
    except ValueError:
        return ""
    d += timedelta(days=21 if re.search(r"embryo\s*sure|hla", str(test or ""), re.I) else 10)
    return d.strftime("%d-%m-%Y")


def row_from_cases(cases: list, sample_id: str, embryo: str, values: dict) -> list:
    """The edited embryo's Embryo view row rebuilt from the synced sheet rows - used when the
    app sent an edit without its row (e.g. a browser tab opened before the app sent rows).
    `values` = this embryo's edited values {column key: value}. Returns [] if not found."""
    sid, tag = _clean_id(sample_id), _clean_id(embryo)
    for r in cases or []:
        if r.get("_stale") or _clean_id(_edit_sample_id(r)) != sid:
            continue
        name = str(r.get("embryo name") or "")
        tags = _embryo_tags(name)
        whole = [_clean_id(p) for p in name.split(",")] + [_clean_id(name)]
        if tag not in tags and tag not in whole:
            continue
        if tags and tag in tags and "-" in name:
            prefix = name.rsplit("-", 1)[0].strip()
            shown = f"{prefix}-{tag[len(_clean_id(prefix)):]}"
        else:
            shown = next((p.strip() for p in name.split(",") if _clean_id(p) == tag), name)
        row = []
        for h in VIEW_COLUMNS:
            key = _KEY_FOR.get(h, h.lower())
            if key in values:
                v = values[key]
            elif h == "EMBRYO NAME":
                v = shown
            elif h == "NUMBER OF EMBRYOS":
                v = "1"
            elif h == "TAT":
                v = _tat(r.get("date sample received"), r.get("test name"))
            else:
                v = r.get(key, "")
            row.append([h, "" if v is None else str(v)])
        return row
    return []


def full_row(cases: list, sample_id: str, embryo: str, edits: dict, shown: list | None = None) -> list:
    """The row written to the Edits sheet for one embryo - the same on every computer: all
    VIEW_COLUMNS in order, from the synced sheet rows, with the values the app showed for this
    embryo (per-embryo WGA / karyotype rather than the whole multi-embryo cell) laid over them,
    then every edit of this embryo on top. `edits` = {column key: value}; `shown` = [[header, value]]."""
    shown_map = {}
    for pair in shown or []:
        try:
            h, v = str(pair[0]).strip().upper(), "" if pair[1] is None else str(pair[1]).strip()
        except (IndexError, TypeError):
            continue
        if h in VIEW_COLUMNS and v and v not in ("-", "—"):
            shown_map[h] = v
    base = row_from_cases(cases, sample_id, embryo, {})
    if not base and not shown_map:
        return []
    values = {h: v for h, v in base} if base else {h: "" for h in VIEW_COLUMNS}
    values.update(shown_map)
    if not base:
        values.setdefault("SAMPLE ID", sample_id)
    for key, v in (edits or {}).items():
        h = next((hh for hh, kk in _KEY_FOR.items() if kk == key), str(key).upper())
        if h in values:
            values[h] = "" if v is None else str(v)
    return [[h, values.get(h, "")] for h in VIEW_COLUMNS]
