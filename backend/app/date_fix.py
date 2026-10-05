"""Repairs day/month-swapped dates in the rows the dashboard keeps - the Google Sheet itself is never touched.

The live sheet uses a US locale, so a date typed as 01-09-2026 (1 Sept) was stored as 9 Jan. Dates with a day above 12
(13-09-2026) could not be misread and are fine; those with a day of 12 or below may be swapped.

For every such date two readings exist: as stored (dd-mm) and flipped (mm-dd). The row's own sheet tells which one is real:
a sample sitting in the "September 2026" sheet was received in September (or the month before), so only one reading fits.
The other dates of the sample follow from that one in process order (received -> WGA -> sequencing -> reports), each inside
a plausible window after the previous step. A date is changed ONLY when exactly one reading fits; if both or neither fit it is
left exactly as stored and listed as "unclear". The original text is kept in row["_rawDates"] so any change can be traced.
"""
import re
from datetime import date, timedelta

MONTHS = ["january", "february", "march", "april", "may", "june", "july", "august",
          "september", "october", "november", "december"]

# Process order and the window (days relative to the previous step) a real date must fall into.
RECEIVED = "date sample received"
CHAIN = [  # (field, anchor, min days from anchor, max days from anchor)
    ("date of biopsy", "received", -30, 3),
    ("date trf received", "received", -10, 30),
    ("wga done on", "received", -1, 45),
    ("seq date", "wga|received", -1, 90),
    ("attune upload", "seq|wga|received", -1, 150),
    ("ngs report", "attune|seq|wga|received", -1, 180),
]
# Tight "usual gap" windows (days after the step named) taken from the sheet's own unambiguous dates (day above 12): e.g. the WGA
# is done 0-10 days after receipt, sequencing 0-5 days after WGA (99th percentile). Used only to choose between two readings that
# both fit the wide window above: if exactly one reading falls in the usual gap, that is the real one.
TIGHT = {
    ("date of biopsy", "received"): (-20, 2),
    ("date trf received", "received"): (-2, 3),
    ("wga done on", "received"): (-2, 20),
    ("seq date", "wga"): (-1, 15), ("seq date", "received"): (-1, 30),
    ("attune upload", "seq"): (0, 30), ("attune upload", "wga"): (0, 40), ("attune upload", "received"): (0, 50),
    ("ngs report", "attune"): (-5, 5), ("ngs report", "seq"): (0, 35), ("ngs report", "wga"): (0, 45), ("ngs report", "received"): (0, 55),
}
DATE_FIELDS = [RECEIVED] + [c[0] for c in CHAIN]
_TOKEN = re.compile(r"(\d{1,2})([-/.])(\d{1,2})\2(\d{4})")


def tab_month(label):
    m = re.match(r"^\s*([A-Za-z]+)\s+(\d{4})\s*$", str(label or ""))
    if m and m.group(1).lower() in MONTHS:
        return (int(m.group(2)), MONTHS.index(m.group(1).lower()) + 1)
    return None


def _mk(y, mo, d):
    try:
        return date(y, mo, d)
    except ValueError:
        return None


def readings(d, mo, y):
    """Possible real dates for a stored dd-mm-yyyy: as stored, plus the flipped reading when it exists."""
    out = [_mk(y, mo, d)]
    if d <= 12 and d != mo:
        out.append(_mk(y, d, mo))
    return [x for x in out if x]


def cand_dates(d, mo, y, tab):
    """Readings that are possible for this sheet: the live sheet only holds 2026 (its January tab also holds December 2025
    samples). A date typed with another year (e.g. 04-08-2025 in the April sheet) is a typo for 2026, so 2026 is tried too."""
    years = [y] if y == 2026 else [y, 2026]
    out = []
    for yy in years:
        for c in readings(d, mo, yy):
            ok = c.year == 2026 or (c.year == 2025 and c.month == 12 and tab == (2026, 1))
            if ok and c not in out:
                out.append(c)
    return out


def _fits_tab(dt, tab):
    diff = (tab[0] - dt.year) * 12 + (tab[1] - dt.month)
    return diff in (0, 1)   # received in the sheet's month, or the month before


def _within(dt, anchor, lo, hi):
    return anchor + timedelta(days=lo) <= dt <= anchor + timedelta(days=hi)


def _fmt(dt):
    return f"{dt.day:02d}-{dt.month:02d}-{dt.year}"


def _tokens(text):
    return [(m, int(m.group(1)), int(m.group(3)), int(m.group(4))) for m in _TOKEN.finditer(str(text or ""))]


def _pick(cands, test):
    """The single candidate that passes `test`, else None (None = zero or several fit: do not guess)."""
    ok = [c for c in cands if test(c)]
    return ok[0] if len(ok) == 1 else None


def normalize_row(row, today=None):
    """-> (fixes {field: new text}, unclear [field, ...]). The row itself is not modified."""
    today = today or date.today()
    tab = tab_month(row.get("_importSource"))
    fixes, unclear = {}, []
    resolved = {}      # step name -> chosen date (single, the latest when a cell holds several)

    def chosen_for(field, anchor_names, lo, hi, use_tab=False):
        """Resolve every date token in `field`. Returns the last resolved date (for anchoring) and the new text."""
        text = row.get(field)
        toks = _tokens(text)
        if not toks:
            return None, None
        anchor, anchor_name = None, None
        for n in anchor_names:
            if n in resolved:
                anchor, anchor_name = resolved[n], n
                break
        new_text, last, changed, bad = str(text), None, False, False
        pieces, pos = [], 0
        for m, d, mo, y in toks:
            cands = cand_dates(d, mo, y, tab) or readings(d, mo, y)
            pick = None
            if len(cands) == 1:
                pick = cands[0]                                   # cannot be flipped
            else:
                cands = [c for c in cands if c <= today + timedelta(days=1)] or cands   # never in the future
                if use_tab and tab:
                    pick = _pick(cands, lambda c: _fits_tab(c, tab))
                if pick is None and anchor is not None:
                    pick = _pick(cands, lambda c: _within(c, anchor, lo, hi))
                    if pick is None and (field, anchor_name) in TIGHT:
                        t_lo, t_hi = TIGHT[(field, anchor_name)]
                        pick = _pick(cands, lambda c: _within(c, anchor, t_lo, t_hi))
                if pick is None and len(cands) == 1:
                    pick = cands[0]
                if pick is None:
                    # No evidence either way. Confirmed by the lab: such dates are the month-first (mm-dd-yyyy) ones - the cell is a
                    # real date that kept its US display format after the sheet locale was changed to India - so take the
                    # day/month-swapped reading.
                    flipped = [c for c in cands if (c.month, c.day) == (d, mo)]
                    if flipped:
                        pick = flipped[0]
            if pick is None:
                bad = True
                pick_text = m.group(0)
            else:
                pick_text = _fmt(pick)
                last = pick if last is None or pick > last else last
                if pick_text != m.group(0).replace("/", "-").replace(".", "-") and pick_text != m.group(0):
                    changed = True
            pieces.append(text[pos:m.start()] if isinstance(text, str) else "")
            pieces.append(pick_text)
            pos = m.end()
        pieces.append(text[pos:] if isinstance(text, str) else "")
        new_text = "".join(pieces)
        if bad:
            unclear.append(field)
        elif changed:
            fixes[field] = new_text
        return last, new_text

    # 1. received date: the sheet tab decides (then, failing that, the later steps)
    last, _ = chosen_for(RECEIVED, [], 0, 0, use_tab=True)
    if last is not None:
        resolved["received"] = last
    elif RECEIVED in unclear:
        # both / neither reading fit the tab: try the sample's own later, unambiguous dates as anchors
        for later in ("wga done on", "seq date", "attune upload", "ngs report"):
            toks = _tokens(row.get(later))
            sure = [cand_dates(d, mo, y, tab)[0] for _, d, mo, y in toks if len(cand_dates(d, mo, y, tab)) == 1]
            if sure:
                anchor_date = min(sure)
                rtoks = _tokens(row.get(RECEIVED))
                if rtoks:
                    _, d, mo, y = rtoks[0]
                    pick = _pick(cand_dates(d, mo, y, tab), lambda c: -2 <= (anchor_date - c).days <= 120)
                    if pick:
                        resolved["received"] = pick
                        unclear.remove(RECEIVED)
                        text = row.get(RECEIVED)
                        if _fmt(pick) != str(text).strip():
                            fixes[RECEIVED] = re.sub(_TOKEN, _fmt(pick), str(text), count=1)
                break
    # 2. the rest of the chain, each inside its window after the previous step
    for field, anchors, lo, hi in CHAIN:
        names = [a for a in anchors.split("|")]
        last, _ = chosen_for(field, names, lo, hi)
        key = {"date of biopsy": "biopsy", "date trf received": "trf", "wga done on": "wga", "seq date": "seq",
               "attune upload": "attune", "ngs report": "ngs"}[field]
        if last is not None:
            resolved[key] = last
    return fixes, unclear


def apply_to_row(row, today=None):
    """Returns a copy of `row` with the fixes applied and the originals kept in _rawDates / _dateUnclear.
    Always starts from the original (raw) text, so running it again never compounds a change."""
    base = {**row, **(row.get("_rawDates") or {})}
    fixes, unclear = normalize_row(base, today)
    out = dict(base)
    raw = {}
    for f, new in fixes.items():
        raw[f] = base.get(f)
        out[f] = new
    out["_rawDates"] = raw
    out["_dateUnclear"] = unclear
    return out
