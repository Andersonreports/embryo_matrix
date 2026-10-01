"""Renders a submitted TRF to PDF for storage/sync, reusing the paper-template
layout - a read-only Python port of the render path in frontend/trf-doc.js
(trfPagesHtml with opts.edit=false). The stylesheet itself (frontend/trf-doc.css)
is loaded as-is, not duplicated, so the PDF stays visually in sync with the
in-app print preview.

Only the read-only branch is ported (no <input>/<textarea>/checkbox markup is
needed for a stored PDF), which is why this is a port rather than a shared
template: the editable form in trf-doc.js also builds inputs and wiring that
have no PDF equivalent.
"""
import html
import re
from pathlib import Path


FRONTEND_DIR = Path(__file__).resolve().parent.parent.parent / "frontend"
CSS_PATH = FRONTEND_DIR / "trf-doc.css"
LOGO_PATH = FRONTEND_DIR / "anderson-logo.png"

TRF_TEST_LABELS = {
    "PGT-A": "Preimplantation Genetic Testing - Aneuploidies (PGT-A)",
    "EMBRYO_SURE": "Embryo Sure - PGT-A (CNV with SNP)",
    "PGT-SR": "Preimplantation Genetic Testing - Structural Rearrangements (PGT-SR)",
    "PGT-HLA": "Preimplantation Genetic Testing - HLA C typing",
}
TRF_TEST_LABELS_M = {
    "PGT-M": "Mutation only",
    "PGT-A+M": "Aneuploidies + Mutation (PGT-A+M)",
    "PGT-A+M+HLA": "Aneuploidies + Mutation + HLA matching (PGT-A+M + HLA)",
}
EMBRYO_FIELDS = ("label", "grade", "cells", "day", "intact", "comments")


def esc(v) -> str:
    return html.escape(str(v if v is not None else ""), quote=True)


def fmt_date(v) -> str:
    m = re.match(r"^(\d{4})-(\d{2})-(\d{2})$", str(v or ""))
    return f"{m.group(3)} / {m.group(2)} / {m.group(1)}" if m else esc(v)


def _line(d: dict, label: str, key: str, date=False) -> str:
    val = d.get(key)
    shown = fmt_date(val) if (val and date) else (esc(val) if val else "&nbsp;")
    return f'<div class="td-line"><span class="td-label">{label}</span><span class="td-value">{shown}</span></div>'


def _para(d: dict, key: str) -> str:
    return f'<p class="td-para">{esc(d.get(key)) or "&nbsp;"}</p>'


def _box(value_on: bool, label: str) -> str:
    return f'<span class="td-check"><span class="td-box{" on" if value_on else ""}">{"✓" if value_on else ""}</span>{esc(label)}</span>'


def _blank(d: dict, key: str) -> str:
    v = d.get(key)
    return f'<span class="td-blank">{esc(v) if v else ""}</span>'


def _mirror(d: dict, key: str, date=False) -> str:
    v = d.get(key)
    if not v:
        return '<span class="td-blank"></span>'
    return f'<span class="td-blank">{fmt_date(v) if date else esc(v)}</span>'


def _section(title: str, body: str) -> str:
    return f'<section class="td-section"><h3>{title}</h3><div class="td-body">{body}</div></section>'


def _panel(*sections: str) -> str:
    return f'<div class="td-panel">{"".join(sections)}</div>'


def _footer(n: int) -> str:
    return (
        '<div class="td-footer"><p class="td-services">PGT-A, PGT-M &amp; PGT-SR | Clinical Exome Sequencing | '
        "Microarray | Male Infertility | Recurrent Pregnancy Loss | Carrier Screening | Amniotic Fluid Testing | "
        "POC Analysis | NIPS<br>Fertility Genetics | Genetic Counseling | Oncogenetics | Neurogenetics | "
        f'Infectious Genetics | New Born Screening</p><span class="td-pagenum">Pg.{n} of 3</span></div>'
    )


def _logo_row(is_m: bool = False) -> str:
    kicker = "Preimplantation Genetic Testing" + (" Mutation (PGT-M)" if is_m else "")
    return (
        f'<div class="td-logorow"><img src="file://{LOGO_PATH}" alt="Anderson Diagnostics &amp; Labs">'
        f'<div class="td-kicker">{kicker}</div></div>'
    )


def _title_row(title: str, note_html: str, box_html: str) -> str:
    return f'<div class="td-titlerow"><div><h2 class="td-title">{title}</h2>{note_html}</div><div class="td-titlebox">{box_html}</div></div>'


def _page1(d: dict, meta: dict) -> str:
    is_m = d.get("formType") == "PGT-M"
    tests = d.get("tests") or []
    gametes = d.get("gametes") or []
    ref_info = f'TRF ref: <b>{esc(meta.get("ref"))}</b>' if meta.get("ref") else ""
    submitted = meta.get("submittedAt")
    ref_line = ""
    if ref_info or submitted:
        submitted_html = f"<span>Submitted {esc(submitted)}</span>" if submitted else ""
        ref_line = f'<div class="td-ref">{ref_info}{submitted_html}</div>'
    ref_box = f'<div class="td-refbox"><div>{_line(d, "Date of Biopsy:", "biopsyDate", date=True)}</div>{ref_line}</div>'
    barcode_box = '<div class="td-barcode"><i>Affix barcode label here</i></div>'
    referring = (
        _line(d, "Referring Doctor:", "referringDoctor")
        + _line(d, "Name of Hospital /IVF Centre:", "hospital")
        + _line(d, "Address:", "address")
        + _line(d, "Phone:", "phone")
        + _line(d, "Email:", "email")
    )
    tests_body = "".join(f"<div>{_box(k in tests, label)}</div>" for k, label in (TRF_TEST_LABELS_M if is_m else TRF_TEST_LABELS).items())
    biopsy_days = "".join(_box(d.get("biopsyDay") == x, f"{x} Biopsy") for x in (("Day 5", "Day 6") if is_m else ("Day 3", "Day 5", "Day 6")))
    gamete_boxes = "".join(_box(x in gametes, x) for x in ("Self", "Donor Sperm", "Donor Oocyte"))
    if is_m:
        when = (f'<div class="td-line"><span class="td-label">Biopsy Date:</span><span class="td-value">'
                f'{fmt_date(d.get("biopsyDate")) if d.get("biopsyDate") else "&nbsp;"}</span></div>'
                + _line(d, "Biopsy Time:", "biopsyTime"))
    else:
        when = _line(d, "Specimen Collection Date:", "collectionDate", date=True) + _line(d, "Specimen Collection Time:", "collectionTime")
    specimen = (
        when
        + f'<div class="td-row">{biopsy_days}</div><p class="td-label td-sublabel">IVF Cycle details:</p>'
        + f'<div class="td-row"><span class="td-label">Gametes:</span>{gamete_boxes}</div>'
        + _line(d, "If Donor is used: Age of Donor;", "donorAge")
    )
    left_panel = _panel(
        _section("Referring details", referring),
        _section("Test requested", tests_body),
        _section("Specimen details", specimen),
    )
    patient_info = (
        _line(d, "Patient Name:", "patientName")
        + _line(d, "Date of Birth:", "patientDob", date=True)
        + _line(d, "UHID:", "uhid")
        + _line(d, "Aadhaar Card No:", "aadhaar")
        + _line(d, "Husband's Name:", "husbandName")
        + _line(d, "Date of Birth:", "husbandDob", date=True)
        + _line(d, "Email:", "patientEmail")
    )
    right_panel = _panel(
        _section("Patient Information", patient_info),
        _section("Test Indication", _para(d, "testIndication")),
        _section("Patient Clinical History", _para(d, "clinicalHistory")),
        _section("Mutation Details", _line(d, "Maternal Genotype", "maternalGenotype") + _line(d, "Paternal Genotype", "paternalGenotype"))
        if is_m
        else _section(
            "Karyotyping Details",
            _line(d, "Maternal Karyotype:", "maternalKaryotype") + _line(d, "Paternal Karyotype:", "paternalKaryotype"),
        ),
    )
    return (
        f'<div class="td-page">{_logo_row(is_m)}'
        + _title_row("Test Requisition Form", '<p class="td-note-strong">ALL Sections of this form must be completed.</p>', ref_box + barcode_box)
        + f'<div class="td-grid">{left_panel}{right_panel}</div>'
        + '<div class="td-sign"><div>Patient Signature: <span></span></div><div>Clinician Signature: <span></span><br>Clinician Seal:</div></div>'
        + '<p class="td-small">Storage and Transport: Store and ship refrigerated at -20ºC</p>'
        + '<p class="td-tiny">CONFIDENTIAL WHEN COMPLETED. The personal health information is collected for the purpose of clinical '
        + "laboratory testing only. Specimen processing at Central processing Lab at 150 PH Road, No. 150, Poonamallee High Road, "
        + "(Opp to Dasaprakash Hotel) Chennai – 600 084.</p>"
        + _footer(1)
        + "</div>"
    )


def _embryo_row(e: dict, i: int, total: int, is_m: bool = False) -> str:
    n = i + 1 if total else ""
    cells = "".join(f"<td>{esc(e.get(k))}</td>" for k in EMBRYO_FIELDS if not (is_m and k == "day"))
    return f"<tr><td>{n}</td>{cells}</tr>"


def _page2(d: dict) -> str:
    is_m = d.get("formType") == "PGT-M"
    embryos = d.get("embryos") or []
    rows = embryos if embryos else [{}]
    rows_html = "".join(_embryo_row(e, i, len(embryos), is_m) for i, e in enumerate(rows))
    meta_table = (
        '<table class="td-meta"><tr><td><div class="td-line"><span class="td-label">Patient name:</span>'
        f'<span class="td-value td-mirror">{esc(d.get("patientName")) or "&nbsp;"}</span></div></td>'
        '<td><div class="td-line"><span class="td-label">Date of Biopsy:</span>'
        f'<span class="td-value td-mirror-date">{fmt_date(d.get("biopsyDate")) if d.get("biopsyDate") else "&nbsp;"}</span></div></td></tr>'
        f'<tr><td>{_line(d, "IVF Lab contact No.:", "ivfLabContact")}</td>'
        f'<td><span class="td-label">Re-biopsy included in this case:</span> {_box(d.get("rebiopsy") == "Yes", "Yes")}{_box(d.get("rebiopsy") == "No", "No")}</td></tr></table>'
    )
    embryo_table = (
        '<table class="td-embryos"><thead><tr><th>Sl No.</th><th>' + ("Embryo tags" if is_m else "Embryo label") + '</th><th>Embryo Grade</th>'
        "<th>No. of cells biopsied</th>" + ("" if is_m else "<th>Day 5/ Day 6</th>") + "<th>Intact cells observed (Yes/No)</th><th>Comments</th></tr></thead>"
        f"<tbody>{rows_html}</tbody></table>"
    )
    return (
        f'<div class="td-page">{_logo_row(is_m)}'
        + _title_row("Biopsy worksheet", "", '<div class="td-barcode"><i>Affix barcode label here</i></div>')
        + meta_table + embryo_table
        + '<p class="td-small">• All negative controls should be labeled NC1, NC2, etc. If sending multiple negative '
        + "controls, please specify which embryo samples correspond to each NC.</p>"
        + f"<p>{_box(bool(d.get('dryRun')), 'Embryo Biopsy dry run')}</p>"
        + f'<div class="td-grid td-grid-tight"><div>{_line(d, "Embryologist Name:", "embryologistName")}</div>'
        + '<div>Embryologist Signature: <span class="td-signline"></span></div></div>'
        + _line(d, "Embryologist email address:", "embryologistEmail")
        + '<p class="td-small">Contact Anderson Diagnostics and Labs with any questions at enquiries@andersondiagnostics.com</p>'
        + _footer(2)
        + "</div>"
    )


def _page3(d: dict) -> str:
    relation = d.get("consentRelation")
    relation_html = f"<b>{esc(relation.lower())}</b>" if relation else "<b>wife/daughter</b>"
    return (
        f'<div class="td-page"><div class="td-formg-title"><h2>FORM G – FORM OF CONSENT</h2><p>[See Rule 10]</p></div>'
        f'<p class="td-legal">I, {_mirror(d, "patientName")}, {relation_html} of {_blank(d, "consentGuardianName")}. '
        f'Age {_blank(d, "consentAge")} years residing at {_blank(d, "patientAddress")}, hereby state that I have been '
        "explained fully the probable side effects and after effects of the pre-natal diagnostic procedures. I wish to "
        "undergo the pre-natal diagnostic procedures in my interest to find out the possibility of any abnormality "
        "(i.e. deformity or disorder) in the child I am carrying.</p>"
        '<p class="td-legal">I undertake not to terminate the pregnancy if the pre-natal procedure and any pre-natal '
        "tests conducted show the absence of deformity or disorders. I understand that the sex of the fetus will not "
        "be disclosed to me.</p>"
        '<p class="td-legal">I understand that breach of this undertaking will make me liable to penalty as prescribed '
        "in the Pre-natal Diagnostic Techniques (Regulation and Prevention of Misuse) Act, 1994 (57 of 1994).</p>"
        f'<div class="td-grid td-grid-tight"><div>Patient Signature: <span class="td-signline"></span></div><div>{_line(d, "Date:", "consentDate", date=True)}</div></div>'
        + _line(d, "Place:", "consentPlace")
        + f'<p class="td-legal">I have explained the contents of the above consent to the patient and her companion '
        f'(Name {_blank(d, "companionName")} Address {_blank(d, "companionAddress")} Relationship with patient {_blank(d, "companionRelation")}) '
        "in a language she/they understand.</p>"
        '<p class="td-legal-label">Name, Signature and/Registration number of Gynaecologist</p>'
        f'<div class="td-grid td-grid-tight">{_line(d, "Name:", "gynaecologistName")}{_line(d, "Registration No.:", "gynaecologistRegNo")}</div>'
        + _line(d, "Date:", "explanationDate", date=True)
        + '<p class="td-legal-label">Name, Address and Registration number of Genetic Clinic</p>'
        f'<div class="td-grid td-grid-tight">{_line(d, "Name:", "geneticClinicName")}{_line(d, "Registration No.:", "geneticClinicRegNo")}</div>'
        + _line(d, "Address:", "geneticClinicAddress")
        + _footer(3)
        + "</div>"
    )


def trf_pages_html(data: dict, meta: dict | None = None) -> str:
    d, meta = data or {}, meta or {}
    return _page1(d, meta) + _page2(d) + _page3(d)


def render_trf_pdf(data: dict, meta: dict | None = None) -> bytes:
    """Renders a submitted TRF's stored data to a PDF, matching the paper
    template layout used by the in-app print preview (frontend/trf-doc.js)."""
    title = f"TRF {meta.get('ref', '')} {data.get('patientName', '')}".strip() if meta else ""
    body = trf_pages_html(data, meta)
    html_doc = (
        f'<!doctype html><html><head><meta charset="utf-8"><title>{esc(title)}</title>'
        f'<link rel="stylesheet" href="file://{CSS_PATH}"></head><body class="td-print">{body}</body></html>'
    )
    # Imported here, not at module load: WeasyPrint needs the GTK/Pango system libraries,
    # which a Windows install may lack - the server must still start, and the caller
    # already treats a PDF render failure as non-fatal.
    from weasyprint import HTML
    return HTML(string=html_doc, base_url=str(FRONTEND_DIR)).write_pdf()
