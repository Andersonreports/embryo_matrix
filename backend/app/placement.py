"""Where each uploaded file belongs in the lab PC's EmbryoMatrix folder:

    <Year>\\<MM - Month>\\RUN_<id>\\<Patient>\\   embryo images + TRF.pdf of that patient
    <Year>\\<MM - Month>\\RUN_<id>\\Results\\     the run's result spreadsheets

A run's year/month comes from the received date of the first sample listed for it in
the Sequencing Batch Record; a case's run comes from finding its patient + embryo in
that record (exact name match), else the run assigned manually in the app.
Anything that can't be placed goes to _Unassigned / TRFS / _ResultFiles.
"""
import re
from datetime import datetime

from sqlalchemy.orm import Session

from .models import KVStore, CaseRunAssignment

MONTHS = ["January", "February", "March", "April", "May", "June", "July",
          "August", "September", "October", "November", "December"]


def _clean(v) -> str:
    return re.sub(r"[^A-Z0-9]", "", re.sub(r"_L\d+$", "", str(v or "").upper()))


def _name_key(v) -> str:
    return re.sub(r"[^A-Z]", "", str(v or "").upper())


def _run_key(v) -> str:
    return re.sub(r"[^A-Z0-9]", "", re.sub(r"^RUN", "", str(v or "").upper()))


def _field(r: dict, names: list[str]) -> str:
    for n in names:
        for k, v in r.items():
            if (k == n or n in k) and v:
                return str(v).strip()
    return ""


def safe(name: str, fallback: str = "Unknown") -> str:
    s = re.sub(r'[<>:"/\\|?*\x00-\x1f]', "_", str(name or "")).strip().rstrip(".")
    return s or fallback


def _expand_tags(field: str) -> list[str]:
    field = (field or "").strip()
    m = re.match(r"^([A-Za-z]+)-?(\d+)((?:,\s*\d+)*)$", field)
    if m:
        prefix, first, rest = m.groups()
        return [f"{prefix}{n}".upper() for n in [first] + [x.strip() for x in rest.split(",") if x.strip()]]
    return [_clean(t) for t in field.split(",") if t.strip()]


def _parse_date(s: str):
    m = re.match(r"^\s*(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})\s*$", str(s or ""))
    if not m:
        return None
    d, mo, y = map(int, m.groups())
    try:
        return datetime(y, mo, d)
    except ValueError:
        return None


def _tab_month(label):
    m = re.match(r"^\s*([A-Za-z]+)\s+(\d{4})\s*$", str(label or ""))
    if m and m.group(1).capitalize() in MONTHS:
        return (int(m.group(2)), MONTHS.index(m.group(1).capitalize()) + 1)
    return None


def _month_from_filename(name):
    """(year, month) from the last dd-mm-yyyy style date in a file name (e.g. 'Analysis_RUN30-28-09-2026.xlsx')."""
    ms = list(re.finditer(r"(\d{2})[-_.]?(\d{2})[-_.]?(20\d{2})", str(name or "")))
    if not ms:
        return None
    d, mo, y = (int(x) for x in ms[-1].groups())
    return (y, mo) if 1 <= mo <= 12 and 1 <= d <= 31 else None


def _resolve_month(text, tab):
    """(year, month) a received-date cell most likely means, reading dd-mm-yyyy or the flipped mm-dd-yyyy."""
    m = re.match(r"^\s*(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})\s*$", str(text or ""))
    if not m:
        return None
    d, mo, y = int(m.group(1)), int(m.group(2)), int(m.group(3))
    reads = [(y, mo)] + ([(y, d)] if d <= 12 and d != mo else [])
    if tab and tab in reads:
        return tab
    now = datetime.now()
    ok = [r for r in reads if (r[0], r[1]) <= (now.year, now.month)]
    return (ok or reads)[0]


class Placement:
    def __init__(self, db: Session):
        def kv(key):
            row = db.get(KVStore, key)
            return (row.value if row else None) or []
        self.runs = kv("embryomatrix-sequencing-runs")
        self.rfiles = [f for f in kv("embryomatrix-result-files") if isinstance(f, dict)]
        self.manual = dict(db.query(CaseRunAssignment.case_code, CaseRunAssignment.run_id).all())
        # case id -> (patient, tags, received)
        self.cases: dict[str, dict] = {}
        received_by_key: dict[str, tuple] = {}   # key -> (received text, sheet-tab (year, month) or None)
        for r in kv("embryomatrix-imported-cases"):
            if r.get("_stale"):
                continue
            rec0 = _field(r, ["date sample received"])
            for t0 in _expand_tags(_field(r, ["embryo name", "embryo id", "embryo"])):
                received_by_key[f"{_clean(_field(r, ['patient name', 'patient']))}|{t0}|{_clean(_field(r, ['sample id']))}"] = (rec0, _tab_month(r.get('_importSource')))
            cid = _field(r, ["case id"]) or _field(r, ["sample id"])
            if not cid:
                continue
            c = self.cases.setdefault(cid, {"patient": _field(r, ["patient name", "patient"]), "tags": set(), "received": set()})
            c["tags"].update(_expand_tags(_field(r, ["embryo name", "embryo id", "embryo"])))
            rec = _field(r, ["date sample received"])
            if rec:
                c["received"].add(rec)
        # A result file carries the run number for every embryo in it, for ALL months (the
        # Sequencing Batch Record only lists runs from Sept 2026), and its samples are PGS-NGS
        # tracker rows - so the file's month is the received date of one of those rows.
        self.rf_by_embryo: dict[tuple, str] = {}
        self.rf_folder: dict[str, str] = {}
        self.rf_months: dict[str, tuple] = {}   # result-file id -> (year, month) its samples were mostly received in
        for f in self.rfiles:
            label = _run_key(f.get("run"))
            # The run's month = the month most of its samples were received in. The sheet's day/month order is unreliable
            # ("04-01-2026" may be 1 April), so each date is read the way that fits the sample's own sheet tab.
            tally: dict[tuple, int] = {}
            for k in f.get("samples") or []:
                rec, tab = received_by_key.get(k, (None, None))
                ym = _resolve_month(rec, tab)
                if ym:
                    tally[ym] = tally.get(ym, 0) + 1
            chosen = re.fullmatch(r"(\d{4})-(\d{2})", str(f.get("month") or ""))
            if chosen:
                tally = {(int(chosen.group(1)), int(chosen.group(2))): 1}   # the month the file was filed under wins
            elif (fm := _month_from_filename(f.get("fileName"))):
                tally = {fm: 1}   # no month filed: the date written in the file name decides
            if not tally:
                continue
            ym = sorted(tally.items(), key=lambda kv: (-kv[1], kv[0]))[0][0]
            self.rf_months[str(f.get("id"))] = ym
            if not label:
                continue
            month = f"{ym[0]}/{ym[1]:02d} - {MONTHS[ym[1] - 1]}"
            folder = f"{month}/RUN_{safe(label)}"
            self.rf_folder.setdefault(label, folder)
            for k in f.get("samples") or []:
                pat, tag = (k.split("|") + ["", ""])[:2]
                self.rf_by_embryo[(pat, tag)] = folder
        # (name key, tag) -> [run dicts]
        self.by_sample: dict[tuple, list] = {}
        for run in self.runs:
            for s in run.get("samples") or []:
                self.by_sample.setdefault((_name_key(s.get("patient")), _clean(s.get("embryo"))), []).append((run, s))

    def run_by_id(self, run_id):
        k = _run_key(run_id)
        return next((r for r in self.runs if _run_key(r.get("runId")) == k), None) if k else None

    def month_folder(self, run) -> str | None:
        """Year\\MM - Month from the first sample with a received date in the run.
        The sheet's locale sometimes swaps day and month ("09-03-2026" in the September
        tab), so a date is flipped when only the flipped reading agrees with the run's tab.
        With no dated sample at all, the tab's own month is used."""
        run = run or {}
        tm = re.match(r"^\s*([A-Za-z]+)\s+(\d{4})\s*$", str(run.get("tab") or ""))
        tab = None
        if tm and tm.group(1).capitalize() in MONTHS:
            tab = (int(tm.group(2)), MONTHS.index(tm.group(1).capitalize()) + 1)
        for s in run.get("samples") or []:
            d = _parse_date(s.get("received"))
            if not d:
                continue
            y, mo = d.year, d.month
            if tab and (y, mo) != tab and d.day <= 12 and (y, d.day) == tab:
                mo = d.day
            return f"{y}/{mo:02d} - {MONTHS[mo - 1]}"
        if tab:
            return f"{tab[0]}/{tab[1]:02d} - {MONTHS[tab[1] - 1]}"
        return None

    def run_folder(self, run_id, run=None) -> str | None:
        if run is None and _run_key(run_id) in self.rf_folder:
            return self.rf_folder[_run_key(run_id)]
        run = run or self.run_by_id(run_id)
        month = self.month_folder(run)
        if not month:
            return None
        return f"{month}/RUN_{safe(str((run or {}).get('runId') or run_id))}"

    def case_run(self, case_code):
        info = self.cases.get(case_code)
        if info:
            hits = []
            pk = _name_key(info["patient"])
            for t in info["tags"]:
                hits += self.by_sample.get((pk, t), [])
            if hits:
                # A re-sequenced embryo appears in several runs: prefer the one received on the row's date.
                exact = [h for h in hits if h[1].get("received") in info["received"]]
                return (exact or hits)[-1][0]
        if case_code in self.manual:
            return self.run_by_id(self.manual[case_code])
        return None

    def case_folder(self, case_code) -> str:
        """Folder (relative, '/'-separated) holding a case's images and TRF."""
        info = self.cases.get(case_code)
        patient = safe(info["patient"] if info and info["patient"] else case_code)
        if info:
            pc = _clean(info["patient"])
            for t in sorted(info["tags"]):
                folder = self.rf_by_embryo.get((pc, t))
                if folder:
                    return f"{folder}/{patient}"
        run = self.case_run(case_code)
        base = self.run_folder(None, run) if run else None
        if base:
            return f"{base}/{patient}"
        return f"_Unassigned/{patient}" + (f" ({safe(case_code)})" if info and info["patient"] else "")

    def result_folder(self, run_label) -> str:
        base = self.run_folder(run_label) if run_label else None
        return f"{base}/Results" if base else "_ResultFiles"
