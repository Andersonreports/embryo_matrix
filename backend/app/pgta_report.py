import base64
import difflib
import io
import json
import os
import re
import uuid
from datetime import datetime
from pathlib import Path

from fastapi import APIRouter, BackgroundTasks, Depends, File, HTTPException, Request, UploadFile
from fastapi.responses import FileResponse
from sqlalchemy.orm import Session

from .config import settings
from .database import get_db
from .models import KVStore, TrfSubmission

router = APIRouter(prefix="/api/pgta", tags=["pgta"])

# ── Directory layout ──────────────────────────────────────────────────────────
_BASE = Path(__file__).parent.parent.parent          # project root
ASSETS_PGTA = str(_BASE / "assets" / "pgta")
UPLOADS = settings.uploads_dir

PGTA_CNV_DIR   = UPLOADS / "pgta_cnv"
PGTA_TEMP_DIR  = UPLOADS / "pgta_temp"
PGTA_REPORT_DIR = UPLOADS / "pgta_reports"

for _d in (PGTA_CNV_DIR, PGTA_TEMP_DIR, PGTA_REPORT_DIR):
    _d.mkdir(parents=True, exist_ok=True)

# ── Lazy imports (reportlab / python-docx only loaded when needed) ─────────────
def _get_template():
    from .pgta_template import PGTAReportTemplate
    return PGTAReportTemplate(assets_dir=ASSETS_PGTA)

def _get_docx_gen():
    from .pgta_docx_generator import PGTADocxGenerator
    return PGTADocxGenerator(assets_dir=ASSETS_PGTA)

# ── Helpers ────────────────────────────────────────────────────────────────────
def _resolve_cnv_images(embryos: list) -> tuple:
    tmp_paths = []
    for emb in embryos:
        b64 = (emb.get("cnv_image_b64") or "").strip()
        if not b64:
            continue
        try:
            if "," in b64:
                b64 = b64.split(",", 1)[1]
            img_bytes = base64.b64decode(b64)
            tmp_name = f"cnv_{uuid.uuid4().hex}.png"
            tmp_path = str(PGTA_TEMP_DIR / tmp_name)
            with open(tmp_path, "wb") as f:
                f.write(img_bytes)
            emb["cnv_image_path"] = tmp_path
            tmp_paths.append(tmp_path)
        except Exception as exc:
            print(f"[cnv_resolve] embryo '{emb.get('embryo_id', '?')}': {exc}")
    return embryos, tmp_paths

def _id_seg(value: str) -> str:
    raw = re.sub(r'\.0+$', '', str(value or '').strip())
    return re.sub(r'[^A-Za-z0-9]', '', raw)

def _parts(raw: str) -> list:
    return [p for p in re.sub(r'[^a-zA-Z0-9 ]', '', str(raw or '')).strip().split() if p]

# ── CNV image upload ───────────────────────────────────────────────────────────
@router.post("/upload-cnv")
async def pgta_upload_cnv(file: UploadFile = File(...)):
    ext = os.path.splitext(file.filename)[1].lower()
    if ext not in ('.png', '.jpg', '.jpeg'):
        return {"error": "Only PNG/JPG images allowed"}
    unique_name = f"{uuid.uuid4().hex}{ext}"
    save_path = PGTA_CNV_DIR / unique_name
    with open(save_path, "wb") as f:
        f.write(await file.read())
    return {"path": str(save_path), "name": unique_name, "url": f"/api/pgta/cnv-image/{unique_name}"}


@router.get("/cnv-image/{filename}")
def pgta_get_cnv_image(filename: str):
    path = PGTA_CNV_DIR / os.path.basename(filename)
    if not path.exists():
        raise HTTPException(404, "Image not found")
    return FileResponse(str(path))

# ── Preview ────────────────────────────────────────────────────────────────────
@router.post("/preview")
async def pgta_preview(request: Request):
    try:
        data = await request.json()
        patient_data = data.get("patient_data", {})
        p_parts = [p for p in re.sub(r'[^a-zA-Z0-9 ]', '', str(patient_data.get("patient_name", "") or "")).strip().split() if p]
        name_seg = p_parts[0].upper() if p_parts else "PREVIEW"
        sample_seg = _id_seg(patient_data.get("sample_number", ""))
        file_id = (
            f"PGTA_{sample_seg}_{name_seg}_{uuid.uuid4().hex[:8]}.pdf"
            if sample_seg else
            f"PGTA_{name_seg}_{uuid.uuid4().hex[:8]}.pdf"
        )
        filepath = str(PGTA_TEMP_DIR / file_id)
        embryos = data.get("embryos_data", [])
        embryos, tmp = _resolve_cnv_images(embryos)
        _get_template().generate_pdf(
            filepath, patient_data, embryos,
            show_logo=data.get("show_logo", True),
            show_grid=data.get("show_grid", False),
        )
        for p in tmp:
            try:
                os.remove(p)
            except Exception:
                pass
        return {"preview_url": f"/api/pgta/preview-file/{file_id}"}
    except Exception as e:
        import traceback
        traceback.print_exc()
        return {"error": str(e)}


@router.get("/preview-file/{filename}")
def pgta_preview_file(filename: str):
    path = PGTA_TEMP_DIR / os.path.basename(filename)
    if not path.exists():
        raise HTTPException(404, "Preview not found")
    return FileResponse(str(path), media_type="application/pdf")

# ── Generate ───────────────────────────────────────────────────────────────────
@router.post("/generate")
async def pgta_generate(request: Request, background_tasks: BackgroundTasks):
    try:
        data = await request.json()
        patient_info = data.get("patient_info") or data.get("patient_data", {})
        embryos = data.get("embryos") or data.get("embryos_data", [])
        options = data.get("options", {})
        show_logo = options.get("show_logo", True)
        show_grid = options.get("show_grid", False)
        formats = options.get("formats", ["pdf"])

        embryos, tmp_cnv = _resolve_cnv_images(embryos)

        p_parts = _parts(patient_info.get("patient_name", ""))
        s_parts = _parts(patient_info.get("spouse_name", ""))
        p_first = p_parts[0].upper() if p_parts else "UNKNOWN"
        p_init = p_parts[-1][0].upper() if len(p_parts) > 1 else (p_parts[0][0].upper() if p_parts else "X")
        s_raw = str(patient_info.get("spouse_name", "") or "").strip().upper()
        if s_parts and s_raw not in ("WO", "W/O", "NA", "N/A", ""):
            s_first = s_parts[0].upper()
            s_init = s_parts[-1][0].upper() if len(s_parts) > 1 else s_parts[0][0].upper()
            name_seg = f"{p_first}_{s_first}_{p_init}_{s_init}"
        else:
            name_seg = f"{p_first}_{p_init}"

        logo_tag = "withlogo" if show_logo else "withoutlogo"
        sample_seg = _id_seg(patient_info.get("sample_number"))
        base_fn = "_".join(s for s in (sample_seg, name_seg, "PGTA", logo_tag) if s)
        results = {}

        if "pdf" in formats:
            fn = base_fn + ".pdf"
            fp = str(PGTA_REPORT_DIR / fn)
            _get_template().generate_pdf(fp, patient_info, embryos, show_logo=show_logo, show_grid=show_grid)
            results["pdf"] = {
                "file": fn,
                "url": f"/api/pgta/download/{fn}",
                "download_url": f"/api/pgta/download/{fn}",
            }

        if "docx" in formats:
            fn = base_fn + ".docx"
            fp = str(PGTA_REPORT_DIR / fn)
            _get_docx_gen().generate_docx(fp, patient_info, embryos, show_logo=show_logo, show_grid=show_grid)
            results["docx"] = {
                "file": fn,
                "url": f"/api/pgta/download/{fn}",
                "download_url": f"/api/pgta/download/{fn}",
            }

        for p in tmp_cnv:
            try:
                os.remove(p)
            except Exception:
                pass

        return {"status": "success", "results": results}
    except Exception as e:
        import traceback
        traceback.print_exc()
        return {"error": str(e)}


@router.get("/download/{filename}")
def pgta_download(filename: str):
    path = PGTA_REPORT_DIR / os.path.basename(filename)
    if not path.exists():
        raise HTTPException(404, "File not found")
    media_type = (
        "application/pdf"
        if filename.lower().endswith(".pdf")
        else "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
    )
    return FileResponse(str(path), media_type=media_type, filename=filename)

# ── Autosave (KVStore-backed, shared across the lab network) ───────────────────
@router.post("/autosave")
async def pgta_autosave_push(request: Request, db: Session = Depends(get_db)):
    body = await request.json()
    draft_key = str(body.get("draft_key") or "").strip().lower()
    mode = str(body.get("mode") or "single").strip()
    payload = body.get("data") or {}
    if not draft_key:
        raise HTTPException(400, "draft_key required")
    kv_key = f"pgta-autosave:{mode}:{draft_key}"
    row = db.get(KVStore, kv_key)
    entry = {"data": payload, "saved_at": datetime.utcnow().isoformat()}
    if row:
        row.value = entry
    else:
        db.add(KVStore(key=kv_key, value=entry))
    db.commit()
    return {"status": "saved"}


@router.get("/autosave")
def pgta_autosave_pull(draft_key: str, mode: str = "single", db: Session = Depends(get_db)):
    kv_key = f"pgta-autosave:{mode}:{draft_key.strip().lower()}"
    row = db.get(KVStore, kv_key)
    if not row:
        raise HTTPException(404, "No autosave found.")
    return row.value

# ── Compare ────────────────────────────────────────────────────────────────────
@router.post("/compare")
async def pgta_compare(manual: UploadFile = File(...), automated: UploadFile = File(...)):
    def extract(data: bytes, fname: str) -> list:
        if fname.lower().endswith(".pdf"):
            try:
                import pdfplumber
                lines = []
                with pdfplumber.open(io.BytesIO(data)) as pdf:
                    for pg in pdf.pages:
                        t = pg.extract_text()
                        if t:
                            lines.extend(t.splitlines())
                return [l.strip() for l in lines if l.strip()]
            except Exception as e:
                return [f"[PDF error: {e}]"]
        elif fname.lower().endswith(".docx"):
            try:
                from docx import Document
                doc = Document(io.BytesIO(data))
                return [p.text.strip() for p in doc.paragraphs if p.text.strip()]
            except Exception as e:
                return [f"[DOCX error: {e}]"]
        return ["[Unsupported format]"]

    mb, ab = await manual.read(), await automated.read()
    ml, al = extract(mb, manual.filename), extract(ab, automated.filename)
    d = difflib.HtmlDiff(wrapcolumn=80)
    html_diff = d.make_table(
        ml, al,
        fromdesc=f"Manual — {manual.filename}",
        todesc=f"Automated — {automated.filename}",
        context=True, numlines=3,
    )
    changes = [
        (t, i1, i2, j1, j2)
        for t, i1, i2, j1, j2 in difflib.SequenceMatcher(None, ml, al).get_opcodes()
        if t != "equal"
    ]
    return {"html_diff": html_diff, "total_changes": len(changes), "match": len(changes) == 0}

# ── Patient search (uses TRF submissions for date-range lookup) ────────────────
@router.post("/patients")
async def pgta_patients(request: Request, db: Session = Depends(get_db)):
    body = await request.json()
    from_date = str(body.get("from_date") or "").strip()
    to_date = str(body.get("to_date") or "").strip()
    if not from_date or not to_date:
        raise HTTPException(400, "from_date and to_date required")
    try:
        dt_from = datetime.strptime(from_date, "%Y-%m-%d")
        dt_to = datetime.strptime(to_date, "%Y-%m-%d").replace(hour=23, minute=59, second=59)
    except ValueError:
        raise HTTPException(400, "Dates must be YYYY-MM-DD")

    rows = (
        db.query(TrfSubmission)
        .filter(TrfSubmission.submitted_at >= dt_from, TrfSubmission.submitted_at <= dt_to)
        .order_by(TrfSubmission.submitted_at.desc())
        .limit(200)
        .all()
    )
    patients = []
    for r in rows:
        d = r.data or {}
        patients.append({
            "patient_name": r.patient_name or d.get("patient_name", ""),
            "gender": d.get("gender", ""),
            "age": d.get("age", ""),
            "patient_no": d.get("patient_no", "") or d.get("patient_id", ""),
            "lab_no": d.get("lab_no", "") or d.get("sample_number", ""),
            "sample_receipt_date": str(r.submitted_at.date()) if r.submitted_at else "",
            "biopsy_date": d.get("biopsy_date", "") or d.get("sample_collected_date", "") or d.get("collection_date", ""),
            "sample_collected_time": d.get("sample_collected_date", "") or d.get("collection_date", ""),
            "referring_doctor": d.get("referring_doctor", "") or d.get("doctor_name", ""),
            "client_name": r.clinic or d.get("clinic_name", "") or d.get("hospital", ""),
        })
    return {"patients": patients}

# ── Open-folder stub (desktop-only feature; not applicable in web mode) ─────────
@router.get("/open-folder-dialog")
def pgta_open_folder_dialog():
    return {}
