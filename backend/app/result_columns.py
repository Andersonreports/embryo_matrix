"""Read the columns of a stored result file back out, for result files uploaded before the
Approve results page saved them at upload time.

Each result-file entry already lists its embryos' sample names exactly as they are written in
the file ("ADAMALADIVYA-DAR1_L00"), so no patient matching is needed: find the summary sheet,
find those rows, and return the sheet's header (as written) with each embryo's values.
"""
import csv
import io
import re
from datetime import date, datetime

# Words a summary header row contains (same idea as recordsFrom() in app.js).
_SIGNALS = {"patient name", "sample id", "sample name", "sample", "embryo name", "test", "qc", "conclusion", "result",
            "mapd", "embryo details", "ir final results", "test name", "result summary", "kinship result", "cnv qc", "karyotype"}


def _norm_head(v) -> str:
    return re.sub(r"[^a-z0-9]+", " ", str(v or "").lower()).strip()


def _norm_name(v) -> str:
    return re.sub(r"\s+", "", str(v or "")).upper()


def _text(v) -> str:
    if v is None:
        return ""
    if isinstance(v, datetime):
        return v.strftime("%d-%m-%Y") if not (v.hour or v.minute or v.second) else v.strftime("%d-%m-%Y %H:%M")
    if isinstance(v, date):
        return v.strftime("%d-%m-%Y")
    if isinstance(v, float):
        return str(int(v)) if v.is_integer() else f"{v:.6g}"
    return str(v).strip()


def _is_red(cell) -> bool:
    """True when the cell's text is coloured red in the file (a red font: FF0000 or a close shade)."""
    try:
        col = cell.font.color if cell.font is not None else None
    except AttributeError:
        return False
    if col is None:
        return False
    rgb = None
    if col.type == "rgb" and isinstance(col.rgb, str):
        rgb = col.rgb[-6:]
    elif col.type == "indexed" and isinstance(col.indexed, int):
        from openpyxl.styles.colors import COLOR_INDEX
        rgb = COLOR_INDEX[col.indexed][-6:] if 0 <= col.indexed < len(COLOR_INDEX) else None
    if not rgb or not re.fullmatch(r"[0-9A-Fa-f]{6}", rgb):
        return False
    r, g, b = int(rgb[0:2], 16), int(rgb[2:4], 16), int(rgb[4:6], 16)
    return r >= 0xB0 and g <= 0x70 and b <= 0x70


def _sheets(data: bytes, file_name: str):
    """[(sheet name, [[(value, red), ...] per row])] of an .xlsx/.xlsm or .csv file."""
    if file_name.lower().endswith((".csv", ".txt")):
        text = data.decode("utf-8-sig", errors="replace")
        return [(file_name, [[(v, False) for v in r] for r in csv.reader(io.StringIO(text))])]
    from openpyxl import load_workbook
    wb = load_workbook(io.BytesIO(data), read_only=True, data_only=True)
    try:
        out = []
        for ws in wb.worksheets:
            rows = []
            for r in ws.iter_rows():
                rows.append([(c.value, c.value not in (None, "") and _is_red(c)) for c in r])
            out.append((ws.title, rows))
        return out
    finally:
        wb.close()


def read_columns(data: bytes, file_name: str, sample_names: list, keys: list):
    """-> (columns, {key: [values]}, {key: [indexes of columns whose text is red]}).
    Raises ValueError when the file has none of the samples."""
    want = {}
    for k, n in zip(keys, sample_names):
        if n:
            want.setdefault(_norm_name(n), []).append(k)
    best = None
    for title, rows in _sheets(data, file_name):
        low = title.lower()
        if "detail" in low or "inconclusive" in low or not rows:
            continue
        # header row: the one among the first 20 with the most summary words
        hi, score = -1, 1
        for i, r in enumerate(rows[:20]):
            s = len(_SIGNALS & {_norm_head(c[0]) for c in r})
            if s > score:
                hi, score = i, s
        if hi < 0:
            continue
        head = [_text(c[0]) for c in rows[hi]]
        hits = {}
        for r in rows[hi + 1:]:
            for v, _red in r:
                ks = want.get(_norm_name(v)) if v not in (None, "") else None
                if ks:
                    for k in ks:
                        hits.setdefault(k, r)
                    break
        if hits and (best is None or len(hits) > len(best[1])):
            best = (head, hits)
    if not best:
        raise ValueError("none of this file's samples were found in it")
    head, hits = best
    width = max([len(head)] + [len(r) for r in hits.values()])
    head = head + [""] * (width - len(head))
    vals = {k: [_text(c[0]) for c in r] + [""] * (width - len(r)) for k, r in hits.items()}
    reds = {k: [bool(c[1]) for c in r] + [False] * (width - len(r)) for k, r in hits.items()}
    # keep named columns, and unnamed ones only when some embryo has a value there
    keep = [i for i in range(width) if head[i] or any(v[i] for v in vals.values())]
    columns = [head[i] or f"Column {i + 1}" for i in keep]
    red = {k: [n for n, i in enumerate(keep) if reds[k][i]] for k in hits}
    return columns, {k: [v[i] for i in keep] for k, v in vals.items()}, {k: v for k, v in red.items() if v}
