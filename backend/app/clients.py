"""Server-side twin of frontend/clients.js: maps the centre / hospital / location typed into the sample sheets onto a
master client (brand) and, where the row says enough, one of its branches. A client login uses this to see only its own
samples. The data comes from client_directory.json (tools/client_directory/export_json.js) - keep both in step."""
import json
import re
from pathlib import Path

_D = json.loads((Path(__file__).with_name("client_directory.json")).read_text(encoding="utf-8"))
_STOP = set(_D["STOP"])


def _lev(a: str, b: str) -> int:
    if a == b:
        return 0
    prev = list(range(len(b) + 1))
    for i in range(1, len(a) + 1):
        cur = [i]
        for j in range(1, len(b) + 1):
            cur.append(min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] != b[j - 1])))
        prev = cur
    return prev[len(b)]


def tokens(s) -> list:
    t = str(s or "").upper().replace("’", "'").replace("`", "'").replace("&", " AND ")
    t = re.sub(r"'S\b", "S", t).replace("'", "")
    t = re.sub(r"[^A-Z0-9]+", " ", t).strip()
    out = []
    for w in t.split(" "):
        if not w or w == "S" or w in _STOP or (len(w) >= 7 and _lev(w, "FERTILITY") <= 2):
            continue
        out.append(w[:-1] if len(w) > 4 and w.endswith("S") else w)
    return out


def compact(s) -> str:
    return re.sub(r"[^A-Z0-9]", "", str(s or "").upper())


def _branch_base(name: str) -> str:
    n = re.sub(r"\((NOVA IVF|MOTHERHOOD|MH)\)", "", name)
    n = re.sub(r"\(\s*A\s*UNIT[^)]*\)?", "", n, flags=re.I)
    n = re.sub(r"[\s)]+$", "", n)
    m = re.match(r"^(.*\S)\s*-\s*([^-]+?)\s*$", n)
    return m.group(1) if m and not re.search(r"\b(LTD|LIMITED|LLP)\b", m.group(2)) else n


_key_brand: dict = {}
_exact: dict = {}
_brand_branches: dict = {}
_loc_aliases: list = []


def _add_key(k: str, brand: str):
    if k and k not in _key_brand:
        _key_brand[k] = brand


for _b in _D["BRANCHES"]:
    _exact[compact(_b["name"])] = _b
    _brand_branches.setdefault(_b["brand"], []).append(_b)
for _b in _D["BRANCHES"]:
    _add_key(" ".join(tokens(_b["brand"])), _b["brand"])
    _add_key(" ".join(tokens(_branch_base(_b["name"]))), _b["brand"])
for _a in _D["ALIASES"]:
    _brand, _names = _a[0], _a[1]
    if len(_a) > 2 and _a[2]:
        _loc_aliases.append((_brand, {" ".join(tokens(n)) for n in _names}, re.compile(_a[2], re.I)))
        continue
    for _n in _names:
        _add_key(" ".join(tokens(_n)), _brand)
_NOT_LISTED = {" ".join(tokens(n)) for n in _D["NOT_LISTED_NAMES"]}
_keys = list(_key_brand)
_key_compact = {compact(k): k for k in _keys}


def _brand_from_text(s, location) -> str:
    toks = tokens(s)
    k = " ".join(toks)
    if not k or k in _NOT_LISTED:
        return ""
    for brand, keys, rx in _loc_aliases:
        if k in keys and rx.search(location or ""):
            return brand
    if k in _key_brand:
        return _key_brand[k]
    c = compact(k)
    if c in _key_compact:
        return _key_brand[_key_compact[c]]
    best, best_len = "", 0
    for key in _keys:
        kt = key.split(" ")
        if len(kt) <= len(toks) and len(kt) > best_len and kt == toks[:len(kt)] and (len(kt) > 1 or len(kt[0]) >= 4):
            best, best_len = key, len(kt)
    if best:
        return _key_brand[best]
    if len(toks[0]) >= 4:
        hits = {_key_brand[key] for key in _keys if len(toks) < len(key.split(" ")) and toks == key.split(" ")[:len(toks)]}
        if len(hits) == 1:
            return next(iter(hits))
    fz, fd, tie = "", 99, False
    for ck, key in _key_compact.items():
        ln = max(len(ck), len(c))
        if ck[0] != c[0] or abs(len(ck) - len(c)) > 2 or ln < 5:
            continue
        d = _lev(ck, c)
        lim = 1 if ln <= 7 else 2 if ln <= 14 else 3
        if d <= lim:
            if d < fd:
                fd, fz, tie = d, key, False
            elif d == fd and _key_brand[key] != _key_brand[fz]:
                tie = True
    if fz and not tie:
        return _key_brand[fz]
    return ""


def _pick_branch(brand: str, location, allow_only: bool = True):
    lst = _brand_branches.get(brand, [])
    if allow_only and len(lst) == 1:
        return lst[0]
    lt = compact(location)
    if not lt:
        return None
    hits = []
    for b in lst:
        bl = compact(b["branch"])
        if bl and (bl in lt or lt in bl or (len(bl) >= 5 and _lev(bl, lt) <= 2)):
            hits.append(b)
    return hits[0] if len(hits) == 1 else None


def resolve_client(center_name="", hospital_name="", location=""):
    """-> {"brand", "branch" (master entry or None), "listed"} or None when the directory has no match."""
    hc = compact(hospital_name)
    if hc and hc in _exact:
        b = _exact[hc]
        return {"brand": b["brand"], "branch": b, "listed": True}
    brand = ""
    if hospital_name:
        brand = _brand_from_text(hospital_name, location)
        if brand:
            exact = next((b for b in _brand_branches.get(brand, []) if _lev(compact(b["name"]), hc) <= 3), None)
            if exact:
                return {"brand": brand, "branch": exact, "listed": True}
    named_other = bool(brand)
    if not brand:
        brand = _brand_from_text(center_name, location)
    if not brand:
        return None
    return {"brand": brand, "branch": _pick_branch(brand, location, not named_other), "listed": brand in _brand_branches}


def directory() -> list:
    """Every master client with its branch names, for the user-admin pickers."""
    return [{"brand": b, "branches": sorted({x["branch"] for x in v if x["branch"]})} for b, v in sorted(_brand_branches.items())]
