# "New Samples" tab of the PGS & NIPGS updates Google Sheet, written through the same Apps Script web app
# as the edits sheet (apps_script/Code.gs, action newSample). The source sheets are never written to.
# Every submitted sample is kept in new_samples.json; a push that fails stays marked unsent and is retried.
import json
import threading
from datetime import datetime
from pathlib import Path
from threading import Lock

from . import edits_sheet

LOG_PATH = Path(__file__).parent / "data" / "new_samples.json"
_lock = Lock()

# (form key, sheet header) - the order of the columns the sheet gets when a header is missing
FIELDS = [
    ("sampleId", "Sample ID"), ("patient", "Patient Name"), ("embryos", "Number of Embryos"),
    ("embryo", "Embryo Name"), ("test", "Test Name"), ("biopsyDate", "Date of Biopsy"),
    ("client", "Client"), ("center", "Center Name"), ("embryologist", "Embryologist Name"), ("remarks", "Remarks"),
]


def _load() -> list:
    try:
        return json.loads(LOG_PATH.read_text(encoding="utf-8"))
    except Exception:
        return []


def _save(items: list) -> None:
    LOG_PATH.parent.mkdir(parents=True, exist_ok=True)
    LOG_PATH.write_text(json.dumps(items, ensure_ascii=False, indent=1), encoding="utf-8")


def _body(entry: dict) -> dict:
    return {"action": "newSample", "id": entry["id"], "addedBy": entry["addedBy"], "addedAt": entry["addedAt"],
            "row": [[h, str(entry["values"].get(k, ""))] for k, h in FIELDS]}


def retry_pending() -> int:
    """Send every unsent sample, oldest first; returns how many are still waiting."""
    if not edits_sheet.configured():
        return len([e for e in _load() if not e.get("sent")])
    with _lock:
        items = _load()
        for e in items:
            if e.get("sent"):
                continue
            try:
                edits_sheet._post(_body(e))
                e["sent"], e["error"] = True, ""
            except Exception as ex:
                e["error"] = str(ex)
                break
        _save(items)
        return len([e for e in items if not e.get("sent")])


def add(values: dict, user: str) -> dict:
    now = datetime.now()
    entry = {"id": now.strftime("%Y%m%d%H%M%S%f"), "addedBy": user, "addedAt": now.strftime("%Y-%m-%d %H:%M"),
             "values": values, "sent": False, "error": ""}
    with _lock:
        _save(_load() + [entry])
    threading.Thread(target=retry_pending, daemon=True).start()
    return {"ok": True, "id": entry["id"], "sheet": "sending" if edits_sheet.configured() else "not-configured"}
