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
    ("embryo", "Embryo Name"), ("test", "Test Name"), ("receivedDate", "Date Sample Received"),
    ("biopsyDate", "Date of Biopsy"), ("client", "Client"), ("center", "Center Name"), ("embryologist", "Embryologist Name"),
    ("controlTag", "Controls (WGA/Seq Controls)"), ("emptyTubes", "Empty Tubes"), ("trfReceived", "Date TRF Received"), ("remarks", "Remarks"),
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


def _key(sample_id, embryo) -> str:
    return edits_sheet.record_key(sample_id, embryo)


def add(values: dict, names: list, user: str) -> dict:
    """Add one entry per embryo name (a single blank-named one when there are none). Nothing is added
    when an embryo of this Sample ID was already added, or a name repeats in the form."""
    names = [str(n or "").strip() for n in names] or [""]
    now = datetime.now()
    with _lock:
        items = _load()
        have = {_key(e["values"].get("sampleId"), e["values"].get("embryo")) for e in items}
        seen, dup = set(), []
        for n in names:
            k = _key(values["sampleId"], n)
            if k in have or k in seen:
                dup.append(n or "(no embryo name)")
            seen.add(k)
        if dup:
            return {"ok": False, "duplicates": dup}
        for i, n in enumerate(names):
            items.append({"id": now.strftime("%Y%m%d%H%M%S%f") + str(i), "addedBy": user, "addedAt": now.strftime("%Y-%m-%d %H:%M"),
                          "values": {**values, "embryo": n}, "sent": False, "error": ""})
        _save(items)
    threading.Thread(target=retry_pending, daemon=True).start()
    return {"ok": True, "added": len(names), "sheet": "sending" if edits_sheet.configured() else "not-configured"}
