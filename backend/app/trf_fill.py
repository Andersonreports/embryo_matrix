"""Fills the lab's original paper TRF templates (PGT-A / PGT-M, 3 pages each) with a submission's data,
then adds a 4th page for the outcome follow-up consent (not on the paper forms).

The templates are the real PDFs (backend/app/data/trf_template_{a,m}.pdf), so every label, line, box,
logo, header and footer is exactly the paper form. The submission is typed on top: an overlay page
is drawn with WeasyPrint (absolutely positioned text, ticks and dots, in PDF points measured from
the template) and merged onto each template page with pypdf.

All coordinates are in points from the top-left of the A4 page (595.276 x 841.89).
"""
import html
import io
import re
from pathlib import Path

DATA_DIR = Path(__file__).resolve().parent / "data"
TEMPLATES = {"A": DATA_DIR / "trf_template_a.pdf", "M": DATA_DIR / "trf_template_m.pdf"}
PAGE_W, PAGE_H = 595.276, 841.89
INK = "#12202b"

# Template rows of the biopsy worksheet table (identical on both forms) and its column edges.
ROW_EDGES = [289.0, 319.3, 348.3, 377.3, 406.3, 435.3, 464.3, 493.6, 522.6, 551.6, 580.6, 609.6]
COLS = {
    "A": [("label", 76.0, 148.3), ("grade", 148.3, 218.0), ("cells", 218.0, 301.0), ("day", 301.0, 386.6),
          ("intact", 386.6, 475.6), ("comments", 475.6, 572.9)],
    "M": [("label", 76.0, 174.3), ("grade", 174.3, 289.3), ("cells", 289.3, 386.6),
          ("intact", 386.6, 475.6), ("comments", 475.6, 572.9)],
}
SERIAL_COL = (23.0, 76.0)

TEST_ORDER = {"A": ["PGT-A", "EMBRYO_SURE", "PGT-SR", "PGT-HLA"], "M": ["PGT-M", "PGT-A+M", "PGT-A+M+HLA"]}
# centres of the tick-boxes on page 1
TEST_BOX = {"A": [(20.5, 414.1), (21.2, 432.8), (21.2, 449.8), (20.8, 468.1)],
            "M": [(22.8, 407.6), (21.2, 431.5), (23.0, 456.8)]}
DAY_BOX = {"A": {"Day 3": (27.2, 544.9), "Day 5": (111.5, 544.9), "Day 6": (202.0, 545.1)},
           "M": {"Day 5": (79.8, 543.8), "Day 6": (172.2, 545.4)}}
GAMETE_BOX = {"Self": (75.2, 582.4), "Donor Sperm": (114.8, 582.9), "Donor Oocyte": (192.5, 582.1)}


def esc(v) -> str:
    return html.escape(str(v if v is not None else ""), quote=True)


def fmt_date(v) -> str:
    m = re.match(r"^(\d{4})-(\d{2})-(\d{2})$", str(v or ""))
    return f"{m.group(3)} / {m.group(2)} / {m.group(1)}" if m else str(v or "")


class Overlay:
    """Collects absolutely positioned bits for one page."""

    def __init__(self):
        self.parts: list[str] = []

    def text(self, x, base, value, size=9.0, maxw=None, bold=True, min_size=5.5, align="left", color=INK, italic=False):
        value = str(value or "").strip()
        if not value:
            return
        w = lambda s: len(value) * s * (0.56 if bold else 0.5)
        if maxw:
            while w(size) > maxw and size > min_size:
                size = round(size - 0.25, 2)
        left = x
        if align == "center" and maxw:
            left = x + max(0, (maxw - w(size))) / 2
        top = base - size * 0.84
        style = (f"left:{left:.2f}pt;top:{top:.2f}pt;font-size:{size}pt;"
                 f"font-weight:{'700' if bold else '400'};color:{color};{'font-style:italic;' if italic else ''}")
        self.parts.append(f'<span class="t" style="{style}">{esc(value)}</span>')

    def wrapped(self, x, top, value, width, size=7.5, line_h=None, max_lines=6, bold=False):
        """Paragraph text inside a box; shrinks a little if it would not fit."""
        value = str(value or "").strip()
        if not value:
            return
        line_h = line_h or size * 1.25
        style = (f"left:{x:.2f}pt;top:{top:.2f}pt;width:{width:.2f}pt;font-size:{size}pt;line-height:{line_h}pt;"
                 f"max-height:{line_h * max_lines:.1f}pt;overflow:hidden;white-space:normal;color:{INK};"
                 f"font-weight:{'700' if bold else '500'};")
        self.parts.append(f'<span class="t" style="{style}">{esc(value)}</span>')

    def cover(self, x0, y0, x1, y1):
        self.parts.append(f'<span class="w" style="left:{x0:.2f}pt;top:{y0:.2f}pt;width:{x1 - x0:.2f}pt;height:{y1 - y0:.2f}pt"></span>')

    def tick(self, cx, cy, size=9.0):
        s = size
        self.parts.append(
            f'<svg class="t" style="left:{cx - s / 2:.2f}pt;top:{cy - s / 2:.2f}pt" width="{s}pt" height="{s}pt" viewBox="0 0 10 10">'
            f'<path d="M1.2 5.4 L4 8.2 L9 1.6" fill="none" stroke="{INK}" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>')

    def dot(self, cx, cy, r=2.7):
        self.parts.append(
            f'<svg class="t" style="left:{cx - r:.2f}pt;top:{cy - r:.2f}pt" width="{2 * r}pt" height="{2 * r}pt" viewBox="0 0 10 10">'
            f'<circle cx="5" cy="5" r="5" fill="{INK}"/></svg>')

    def html(self) -> str:
        return f'<div class="pg">{"".join(self.parts)}</div>'


def _lines_wrap(value: str, width_chars: int) -> list[str]:
    words, lines, cur = str(value or "").split(), [], ""
    for wd in words:
        if len(cur) + len(wd) + (1 if cur else 0) <= width_chars:
            cur = f"{cur} {wd}".strip()
        else:
            if cur:
                lines.append(cur)
            cur = wd
    if cur:
        lines.append(cur)
    return lines


def _page1(d: dict, kind: str, meta: dict) -> Overlay:
    o = Overlay()
    # Date of biopsy (the template shows a grey dd / mm / yyyy hint - covered, then the date typed)
    o.cover(377.5, 105.5, 463, 120.5)
    o.text(386, 116.0, fmt_date(d.get("biopsyDate")), 9.5)
    if meta.get("ref"):
        o.text(466, 112.0, f'TRF ref: {meta["ref"]}', 6.4, 112, bold=True)
    if meta.get("submittedAt"):
        o.text(466, 121.0, f'Submitted {meta["submittedAt"]}', 5.8, 112, bold=False)
    # Referring details
    o.text(113.5, 236.0, d.get("referringDoctor"), 9, 164)
    hosp = str(d.get("hospital") or "")
    if len(hosp) > 30:
        parts = _lines_wrap(hosp, 36)[:2]
        if len(parts) == 2:
            o.text(114.5, 256.5, parts[0], 7.2, 163)
            o.text(114.5, 264.4, parts[1], 7.2, 163)
        else:
            o.text(114.5, 264.4, hosp, 7.2, 163)
    else:
        o.text(114.5, 264.4, hosp, 8.5, 163)
    addr_lines = _lines_wrap(d.get("address"), 46)
    first = addr_lines[0] if addr_lines else ""
    rest = " ".join(addr_lines[1:])
    o.text(71, 289.6, first, 8, 205, min_size=6)
    o.text(26, 313.6, rest, 8, 250, min_size=6)
    o.text(59.5, 339.3, d.get("phone"), 9, 218)
    o.text(60, 361.3, d.get("email"), 8.5, 217, min_size=6)
    # Patient information (right column); the hint text of the date lines is covered first
    o.text(389, 237.3, d.get("patientName"), 9.5, 175)
    for hint_y0, hint_y1, base, key in ((247.0, 262.5, 261.0, "patientDob"), (326.0, 342.5, 342.6, "husbandDob")):
        if d.get(key):
            o.cover(388, hint_y0, 463, hint_y1)
            o.text(389, base, fmt_date(d.get(key)), 9)
    o.text(389, 280.6, d.get("uhid"), 9, 175)
    aad = re.sub(r"\D", "", str(d.get("aadhaar") or ""))
    o.text(389, 300.3, " ".join(aad[i:i + 4] for i in range(0, len(aad), 4)) if len(aad) == 12 else d.get("aadhaar"), 9, 175)
    o.text(389, 321.3, d.get("husbandName"), 9, 175)
    o.text(389, 364.0, d.get("patientEmail"), 8.5, 175, min_size=6)
    # Test indication / clinical history text boxes
    if kind == "A":
        o.wrapped(309, 400.5, d.get("testIndication"), 268, 7.3, max_lines=3)
        o.wrapped(309, 460.0, d.get("clinicalHistory"), 268, 7.3, max_lines=7)
    else:
        o.wrapped(309, 400.5, d.get("testIndication"), 268, 7.3, max_lines=4)
        o.wrapped(309, 467.5, d.get("clinicalHistory"), 268, 7.3, max_lines=6)
    if kind == "A":
        o.text(405, 569.9, d.get("maternalKaryotype"), 9, 163)
        o.text(405, 592.9, d.get("paternalKaryotype"), 9, 163)
    else:
        o.text(405, 569.9, d.get("maternalGenotype"), 9, 163)
        o.text(405, 592.9, d.get("paternalGenotype"), 9, 163)
    # Tests requested
    tests = d.get("tests") or []
    for key, (cx, cy) in zip(TEST_ORDER[kind], TEST_BOX[kind]):
        if key in tests:
            o.tick(cx, cy, 9)
    # Specimen details
    if kind == "A":
        o.text(133, 511.5, fmt_date(d.get("collectionDate")), 9)
        o.text(135, 529.7, d.get("collectionTime"), 9)
    else:
        o.text(82, 511.4, fmt_date(d.get("biopsyDate")), 9)
        o.text(83, 529.9, d.get("biopsyTime"), 9)
    day = d.get("biopsyDay")
    if day in DAY_BOX[kind]:
        o.dot(*DAY_BOX[kind][day])
    for g in d.get("gametes") or []:
        if g in GAMETE_BOX:
            o.tick(*GAMETE_BOX[g], 9)
    o.text(155, 606.3, d.get("donorAge"), 9, 120)
    return o


def _embryo_pages(d: dict, kind: str, meta: dict) -> list[Overlay]:
    embryos = d.get("embryos") or []
    pages = []
    for start in range(0, max(len(embryos), 1), 11):
        chunk = embryos[start:start + 11]
        o = Overlay()
        o.text(95, 177.0, d.get("patientName"), 9.5, 195)
        o.cover(383.5, 164.5, 462, 180)
        o.text(384, 177.0, fmt_date(d.get("biopsyDate")), 9.5)
        o.text(124.5, 207.6, d.get("ivfLabContact"), 9, 150)
        rb = d.get("rebiopsy")
        if rb == "Yes":
            o.dot(474.8, 201.6, 3.4)
        elif rb == "No":
            o.dot(524.1, 201.6, 3.4)
        for i, e in enumerate(chunk):
            y0, y1 = ROW_EDGES[i], ROW_EDGES[i + 1]
            base = (y0 + y1) / 2 + 3.4
            o.text(SERIAL_COL[0], base, start + i + 1, 9.5, SERIAL_COL[1] - SERIAL_COL[0], align="center")
            for key, x0, x1 in COLS[kind]:
                o.text(x0 + 2, base, e.get(key), 9 if key != "comments" else 7.5, x1 - x0 - 4, align="center" if key != "comments" else "left", min_size=5.5)
        if kind == "A":
            if d.get("dryRun"):
                o.tick(20.6, 680.3, 9)
            o.text(110, 712.0, d.get("embryologistName"), 9, 190)
            o.text(170, 737.6, d.get("embryologistEmail"), 9, 360, min_size=6)
        else:
            o.text(90, 732.4, d.get("embryologistEmail"), 9, 360, min_size=6)
        pages.append(o)
    return pages


def _page3(d: dict, kind: str) -> Overlay:
    o = Overlay()
    rel = str(d.get("consentRelation") or "")
    if kind == "A":
        o.text(98, 138.1, d.get("patientName"), 9, 138)
        o.text(337, 138.1, d.get("consentGuardianName"), 9, 125)
        o.text(14, 154.1, d.get("consentAge"), 9, 52)
        o.text(180, 154.1, d.get("patientAddress"), 8.5, 340, min_size=5.5)
        o.text(58, 558.6, d.get("companionName"), 8.5, 140)
        o.text(273, 558.6, d.get("companionAddress"), 8.5, 248, min_size=5.5)
        o.text(168, 573.1, d.get("companionRelation"), 8.5, 120)
        wife_x = 262
    else:
        o.text(98, 138.1, d.get("patientName"), 9, 160)
        o.text(362, 138.1, d.get("consentGuardianName"), 9, 165)
        o.text(112, 154.1, d.get("consentAge"), 9, 52)
        o.text(278, 154.1, d.get("patientAddress"), 8.5, 250, min_size=5.5)
        o.text(58, 560.4, d.get("companionName"), 8.5, 198)
        o.text(312, 560.4, d.get("companionAddress"), 8.5, 202, min_size=5.5)
        o.text(352, 576.5, d.get("companionRelation"), 8.5, 164)
        wife_x = 285
    if rel in ("Wife", "Daughter"):
        o.text(wife_x, 124.2, f"({rel})", 6.2, 60, bold=True)
    o.text(48, 460.5, fmt_date(d.get("consentDate")), 9)
    o.text(48, 489.0, d.get("consentPlace"), 9, 200)
    g_name, g_reg = d.get("gynaecologistName"), d.get("gynaecologistRegNo")
    if g_name or g_reg:
        o.text(100, 688.0, f"Name: {g_name or ''}", 9, 250)
        o.text(360, 688.0, f"Reg. No.: {g_reg or ''}", 9, 190)
    o.text(50, 704.0, fmt_date(d.get("explanationDate")), 9)
    c_name, c_reg, c_addr = d.get("geneticClinicName"), d.get("geneticClinicRegNo"), d.get("geneticClinicAddress")
    if c_name or c_reg:
        o.text(100, 750.0, f"Name: {c_name or ''}", 9, 250)
        o.text(360, 750.0, f"Reg. No.: {c_reg or ''}", 9, 190)
    if c_addr:
        o.text(100, 766.0, f"Address: {c_addr}", 8.5, 440, min_size=5.5)
    return o


# Page 4 (both forms): the outcome follow-up consent. The paper templates have no such page, so it
# is drawn whole, in Form G's style, with the same top curve, corner arch and footer artwork.
STATIC_DIR = Path(__file__).resolve().parents[2] / "frontend"
FOLLOWUP_CSS = f"""
@page {{ size: {PAGE_W}pt {PAGE_H}pt; margin: 0 }}
html, body {{ margin: 0; padding: 0 }}
.fp {{ position: relative; width: {PAGE_W}pt; height: {PAGE_H}pt; overflow: hidden; color: #222;
      font: 12pt/1.55 'Liberation Sans', Arial, Helvetica, sans-serif }}
.fp-top {{ position: absolute; left: 0; top: 0; width: 100%; height: 41.7pt }}
.fp-foot {{ position: absolute; left: 0; bottom: 0; width: 100% }}
.fp-pg {{ position: absolute; right: 14pt; bottom: 0; width: 80pt; height: 30pt; padding-top: 6pt; box-sizing: border-box; background: #fff; text-align: right; font-size: 8pt; color: #444 }}
.fp-body {{ position: absolute; left: 46pt; right: 46pt; top: 84pt }}
h2 {{ margin: 0 0 4pt; text-align: center; font-size: 19pt; font-weight: 800; letter-spacing: .3pt }}
h2 + p {{ margin-top: 30pt }}
p {{ margin: 0 0 18pt; line-height: 1.8 }}
.fp-first {{ text-indent: 36pt }}
.fp-blank {{ display: inline-block; border-bottom: 1pt solid #555; padding: 0 4pt; text-align: center; font-weight: 700; color: {INK}; line-height: 1.3; text-indent: 0 }}
.fp-opt {{ display: inline-block; margin-right: 22pt; font-weight: 700 }}
.fp-box {{ display: inline-block; width: 11pt; height: 11pt; border: 1.2pt solid #222; margin-right: 7pt; vertical-align: -1.5pt;
          text-align: center; font-size: 10pt; line-height: 11pt }}
.fp-line {{ display: flex; margin: 0 0 20pt }}
.fp-line b {{ white-space: nowrap; margin-right: 8pt }}
.fp-val {{ flex: 1; border-bottom: 1pt solid #555; min-height: 15pt; font-weight: 700; color: {INK} }}
.fp-sign {{ display: flex; gap: 40pt; margin-top: 46pt }}
.fp-sign .fp-line {{ flex: 1 }}
"""


def _followup_page_html(d: dict) -> str:
    consent = str(d.get("followupConsent") or "")
    box = lambda v, label: f'<span class="fp-opt"><span class="fp-box">{"&#10003;" if consent == v else ""}</span>{label}</span>'
    blank = lambda v, w: f'<span class="fp-blank" style="min-width:{w}pt">{esc(v)}</span>'
    return (f'<div class="fp"><img class="fp-top" src="trf-top.png">'
            f'<img class="fp-foot" src="trf-footer-3.png"><span class="fp-pg">Pg.4</span><div class="fp-body">'
            '<h2>OUTCOME FOLLOW-UP CONSENT</h2>'
            f'<p class="fp-first">I, {blank(d.get("patientName"), 150)}, hereby give my consent to Anderson Diagnostics &amp; Labs to obtain '
            'information on the embryo transfer and the pregnancy outcome following this Preimplantation Genetic Testing from my treating clinic.</p>'
            '<p>I understand that only my consent and the clinic&#39;s contact details are recorded in this form. The outcome itself will be '
            'collected later by the laboratory and will be kept confidential.</p>'
            f'<p>{box("Yes", "I agree")}{box("No", "I do not agree")} to this outcome follow-up.</p>'
            f'<p>The clinic may be contacted through {blank(d.get("followupContact"), 130)} at {blank(d.get("followupPhoneEmail"), 150)}. '
            f'The expected period of embryo transfer, if known, is {blank(str(d.get("followupExpected") or "").lower(), 90)}.</p>'
            '<div class="fp-sign"><div class="fp-line"><b>Patient Signature:</b><span class="fp-val"></span></div>'
            '<div class="fp-line"><b>Date:</b><span class="fp-val"></span></div></div>'
            '</div></div>')


OVERLAY_CSS = f"""
@page {{ size: {PAGE_W}pt {PAGE_H}pt; margin: 0 }}
html, body {{ margin: 0; padding: 0; background: transparent }}
.pg {{ position: relative; width: {PAGE_W}pt; height: {PAGE_H}pt; page-break-after: always; overflow: hidden;
      font-family: 'Liberation Sans', Arial, Helvetica, sans-serif }}
.t {{ position: absolute; white-space: nowrap; line-height: 1 }}
.w {{ position: absolute; background: #fff }}
"""


def render_trf_filled_pdf(data: dict, meta: dict | None = None) -> bytes:
    from pypdf import PdfReader, PdfWriter
    from weasyprint import HTML

    d, meta = data or {}, meta or {}
    kind = "M" if d.get("formType") == "PGT-M" else "A"
    worksheet = _embryo_pages(d, kind, meta)
    overlays = [_page1(d, kind, meta), worksheet[0], _page3(d, kind)]
    body = "".join(o.html() for o in overlays)
    overlay_pdf = HTML(string=f"<!doctype html><html><head><meta charset='utf-8'><style>{OVERLAY_CSS}</style></head><body>{body}</body></html>").write_pdf()
    tpl = PdfReader(str(TEMPLATES[kind]))
    ov = PdfReader(io.BytesIO(overlay_pdf))
    out = PdfWriter()
    for i, page in enumerate(tpl.pages):
        if i < len(ov.pages):
            page.merge_page(ov.pages[i])
        out.add_page(page)
    # more than 11 embryos: further copies of the worksheet page carry rows 12+
    for extra in worksheet[1:]:
        ex_pdf = HTML(string=f"<!doctype html><html><head><meta charset='utf-8'><style>{OVERLAY_CSS}</style></head><body>{extra.html()}</body></html>").write_pdf()
        page = PdfReader(str(TEMPLATES[kind])).pages[1]
        page.merge_page(PdfReader(io.BytesIO(ex_pdf)).pages[0])
        out.add_page(page)
    fu_pdf = HTML(string=f"<!doctype html><html><head><meta charset='utf-8'><style>{FOLLOWUP_CSS}</style></head><body>{_followup_page_html(d)}</body></html>",
                  base_url=str(STATIC_DIR) + "/").write_pdf()
    out.add_page(PdfReader(io.BytesIO(fu_pdf)).pages[0])
    buf = io.BytesIO()
    out.write(buf)
    return buf.getvalue()
