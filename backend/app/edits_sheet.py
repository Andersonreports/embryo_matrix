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
import urllib.parse
import urllib.request
from pathlib import Path
from threading import Lock

from .config import settings

PENDING_PATH = Path(__file__).parent / "data" / "edits_sheet_pending.json"
STATE_PATH = Path(__file__).parent / "data" / "edits_sheet.json"
_lock = Lock()
_cache = {"at": 0.0, "edits": None, "miss_at": 0.0}
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
            _cache["at"] = _cache["miss_at"] = 0.0
            return {"ok": True, "status": "saved"}
        except Exception as e:
            pending = [p for p in _read_json(PENDING_PATH, []) if not (p.get("key") == body["key"] and p.get("column") == body["column"])]
            pending.append(body)
            _write_json(PENDING_PATH, pending)
            return {"ok": False, "status": "queued", "error": str(e)}


def push_edit(entry: dict, row: list) -> dict:
    return _send_or_queue({
        "action": "editsUpsert", "key": record_key(entry["sampleId"], entry["embryo"]),
        "sampleId": entry["sampleId"], "embryo": entry["embryo"], "column": entry["column"],
        "editedBy": entry.get("editedBy", ""), "editedAt": entry.get("editedAt", ""),
        "row": [[str(h), "" if v is None else str(v)] for h, v in (row or [])],
    })


def push_revert(sample_id: str, embryo: str, column: str) -> dict:
    return _send_or_queue({"action": "editsRevert", "key": record_key(sample_id, embryo), "sampleId": sample_id, "embryo": embryo, "column": str(column or "").strip().lower()})


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
            except Exception:
                left = pending[i:]
                break
        _write_json(PENDING_PATH, left)
        if len(left) < len(pending):
            _cache["at"] = 0.0
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
    return {"configured": configured(), "url": _read_json(STATE_PATH, {}).get("url", ""), "pending": len(_read_json(PENDING_PATH, []))}
