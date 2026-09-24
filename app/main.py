import asyncio
import secrets
import shutil
import time
import uuid
from datetime import datetime, timezone
from pathlib import Path
from fastapi import FastAPI, Depends, HTTPException, Request, UploadFile, File, Form
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from fastapi.middleware.gzip import GZipMiddleware
from sqlalchemy.orm import Session
from sqlalchemy import func
from .config import settings
from .database import Base, engine, get_db, SessionLocal
from .models import Lab, PatientCase, EmbryoSample, PGTTest, KVStore, CaseImage, ProtocolDocument, ActivityLog
from .schemas import LabCreate, CaseCreate, SampleCreate, TestCreate, KVValue
from .sheet_sync import parse_sources, sync_sources

Base.metadata.create_all(bind=engine)

def _seed_activity_from_upload_log():
    db = SessionLocal()
    try:
        if db.query(ActivityLog.id).first():
            return
        row = db.get(KVStore, "embryomatrix-upload-log")
        for e in (row.value if row and isinstance(row.value, list) else []):
            try:
                at = datetime.fromisoformat(str(e.get("at", "")).replace("Z", "+00:00")).astimezone(timezone.utc).replace(tzinfo=None)
            except ValueError:
                at = datetime.utcnow()
            db.add(ActivityLog(at=at, username=e.get("by") or "", role=e.get("role") or "", action="result_upload",
                               detail=f"{', '.join(e.get('files', []))} · {e.get('matched', 0)} sample(s) matched"))
        db.commit()
    finally:
        db.close()

_seed_activity_from_upload_log()
app = FastAPI(title=settings.app_name)
# The case store is ~11 MB of JSON; compressing it cuts page-load time sharply over the tunnel.
app.add_middleware(GZipMiddleware, minimum_size=1024)
STATIC = Path(__file__).parent / "static"
UPLOADS = Path(__file__).parent / "uploads"
UPLOADS.mkdir(exist_ok=True)
app.mount("/static", StaticFiles(directory=STATIC), name="static")
app.mount("/uploads", StaticFiles(directory=UPLOADS), name="uploads")

# No login of its own: this app is embedded behind another gated application,
# which authenticates the user and forwards their identity on every request via
# the X-Auth-User / X-Auth-Role headers. Those headers must be set (and any
# client-supplied copies stripped) by the trusted proxy in front of this
# service — this app does not verify them itself, so it must never be reachable
# except through that proxy.
# role -> unix time of that role's most recent identified request. In-memory
# only: resets when the server restarts.
_last_seen: dict[str, float] = {}
ACTIVE_WINDOW_SECONDS = 5 * 60

def log_activity(db: Session, action: str, detail: str = "", user: dict | None = None, request: Request | None = None):
    if user is None and request is not None:
        user = getattr(request.state, "user", None)
    user = user or {}
    db.add(ActivityLog(username=user.get("username") or "", role=user.get("role") or "", action=action, detail=detail))
    db.commit()

@app.middleware("http")
async def identify_user(request: Request, call_next):
    path = request.url.path
    sync_key = request.headers.get("x-image-sync-key", "")
    if sync_key and path == "/api/images" and request.method == "GET":
        if settings.image_sync_token and secrets.compare_digest(sync_key.encode(), settings.image_sync_token.encode()):
            request.state.user = {"username": "Image sync", "role": "sync"}
            return await call_next(request)
        return JSONResponse({"detail": "Invalid image sync key"}, status_code=401)
    username = request.headers.get("x-auth-user", "")
    role = request.headers.get("x-auth-role", "")
    request.state.user = {"username": username, "role": role} if username else {}
    if username:
        _last_seen[role or ""] = time.time()
    response = await call_next(request)
    # Make browsers revalidate the page shell so UI updates show without a hard refresh.
    if path == "/" or path.startswith("/static/"):
        response.headers["Cache-Control"] = "no-cache"
    return response

@app.get("/")
def home():
    return FileResponse(STATIC / "index.html")

@app.get("/api/health")
def health():
    return {"status": "ok", "application": settings.app_name}

@app.get("/api/whoami")
def whoami(request: Request):
    user = request.state.user or {}
    return {"username": user.get("username") or "", "role": user.get("role") or ""}

def _iso_utc(dt: datetime | None) -> str | None:
    return dt.replace(tzinfo=timezone.utc).isoformat() if dt else None

@app.get("/api/activity-log")
def activity_log(limit: int = 1000, db: Session = Depends(get_db)):
    rows = db.query(ActivityLog).order_by(ActivityLog.at.desc(), ActivityLog.id.desc()).limit(max(1, min(limit, 5000))).all()
    now = time.time()
    seen_pairs = (
        db.query(ActivityLog.username, ActivityLog.role)
        .filter(ActivityLog.username != "")
        .distinct()
        .all()
    )
    users = []
    for username, role in seen_pairs:
        last_active = db.query(func.max(ActivityLog.at)).filter(ActivityLog.username == username, ActivityLog.role == role).scalar()
        seen = _last_seen.get(role)
        users.append({
            "username": username, "role": role,
            "lastSeen": _iso_utc(last_active),
            "active": bool(seen and now - seen < ACTIVE_WINDOW_SECONDS),
        })
    events = [{"id": r.id, "at": _iso_utc(r.at), "username": r.username, "role": r.role, "action": r.action, "detail": r.detail} for r in rows]
    return {"users": users, "events": events}

@app.post("/api/labs")
def create_lab(data: LabCreate, db: Session = Depends(get_db)):
    obj = Lab(**data.model_dump()); db.add(obj); db.commit(); db.refresh(obj)
    return {"id": obj.id, "code": obj.code, "name": obj.name}

@app.get("/api/labs")
def labs(db: Session = Depends(get_db)):
    return [{"id": x.id, "code": x.code, "name": x.name} for x in db.query(Lab).all()]

@app.post("/api/cases")
def create_case(data: CaseCreate, db: Session = Depends(get_db)):
    obj = PatientCase(**data.model_dump()); db.add(obj); db.commit(); db.refresh(obj)
    return {"id": obj.id, "case_code": obj.case_code, "status": obj.status}

@app.get("/api/cases")
def cases(db: Session = Depends(get_db)):
    return [{"id": x.id, "case_code": x.case_code, "patient_ref": x.patient_ref, "lab_id": x.lab_id, "status": x.status} for x in db.query(PatientCase).all()]

@app.post("/api/samples")
def create_sample(data: SampleCreate, db: Session = Depends(get_db)):
    obj = EmbryoSample(**data.model_dump()); db.add(obj); db.commit(); db.refresh(obj)
    return {"id": obj.id, "sample_code": obj.sample_code, "status": obj.status}

@app.post("/api/tests")
def create_test(data: TestCreate, db: Session = Depends(get_db)):
    obj = PGTTest(**data.model_dump()); db.add(obj); db.commit(); db.refresh(obj)
    return {"id": obj.id, "test_type": obj.test_type, "result_status": obj.result_status}

@app.get("/api/dashboard")
def dashboard(db: Session = Depends(get_db)):
    return {
        "labs": db.query(func.count(Lab.id)).scalar(),
        "cases": db.query(func.count(PatientCase.id)).scalar(),
        "samples": db.query(func.count(EmbryoSample.id)).scalar(),
        "tests": db.query(func.count(PGTTest.id)).scalar(),
    }

# --- Frontend persistence: replaces the EmbryoMatrix UI's localStorage with real server storage ---

@app.get("/api/store/{key}")
def get_store(key: str, db: Session = Depends(get_db)):
    row = db.get(KVStore, key)
    return {"value": row.value if row else None}

@app.put("/api/store/{key}")
def put_store(key: str, payload: KVValue, db: Session = Depends(get_db)):
    row = db.get(KVStore, key)
    if row:
        row.value = payload.value
    else:
        row = KVStore(key=key, value=payload.value)
        db.add(row)
    db.commit()
    return {"ok": True}

UPLOAD_LOG_KEY = "embryomatrix-upload-log"

@app.post("/api/upload-log")
def append_upload_log(payload: KVValue, request: Request, db: Session = Depends(get_db)):
    # Uploader comes from the login token, not the request body, so the log
    # always names the account that was actually signed in.
    user = request.state.user
    data = payload.value if isinstance(payload.value, dict) else {}
    entry = {
        "files": [str(f) for f in data.get("files", [])],
        "matched": int(data.get("matched", 0)),
        "at": data.get("at"),
        "by": user.get("username") or "",
        "role": user.get("role") or "",
    }
    row = db.get(KVStore, UPLOAD_LOG_KEY)
    log = list(row.value) if row and isinstance(row.value, list) else []
    log.append(entry)
    log_activity(db, "result_upload", f"{', '.join(entry['files'])} · {entry['matched']} sample(s) matched", user=user)
    if row:
        row.value = log
    else:
        db.add(KVStore(key=UPLOAD_LOG_KEY, value=log))
    db.commit()
    return {"value": log}

def _require_admin(request: Request):
    if (request.state.user or {}).get("role") != "admin":
        raise HTTPException(403, "Only the admin can reset logs")

@app.delete("/api/upload-log")
def reset_upload_log(request: Request, db: Session = Depends(get_db)):
    _require_admin(request)
    row = db.get(KVStore, UPLOAD_LOG_KEY)
    if row:
        row.value = []
    db.commit()
    log_activity(db, "log_reset", "Result upload log cleared", request=request)
    return {"value": []}

@app.delete("/api/activity-log")
def reset_activity_log(request: Request, db: Session = Depends(get_db)):
    _require_admin(request)
    db.query(ActivityLog).delete()
    db.commit()
    # Leave one entry behind so the log shows who cleared it (and so the
    # startup seed from the upload log doesn't refill an empty table).
    log_activity(db, "log_reset", "Activity log cleared", request=request)
    return {"ok": True}

@app.post("/api/cases/{case_code}/images")
def upload_case_images(
    case_code: str,
    request: Request,
    embryo_label: str = Form(""),
    files: list[UploadFile] = File(...),
    db: Session = Depends(get_db),
):
    saved = []
    for f in files:
        ext = Path(f.filename or "").suffix
        stored_name = f"{uuid.uuid4().hex}{ext}"
        with (UPLOADS / stored_name).open("wb") as out:
            shutil.copyfileobj(f.file, out)
        img = CaseImage(
            case_code=case_code,
            embryo_label=embryo_label or None,
            filename=f.filename or stored_name,
            content_type=f.content_type or "application/octet-stream",
            file_path=stored_name,
        )
        db.add(img); db.commit(); db.refresh(img)
        saved.append({
            "id": img.id, "caseId": img.case_code, "embryo": img.embryo_label,
            "filename": img.filename, "url": f"/uploads/{img.file_path}",
            "addedAt": img.added_at.isoformat(),
        })
    where = f"case {case_code}" + (f", embryo {embryo_label}" if embryo_label else "")
    log_activity(db, "image_upload", f"{len(saved)} image(s) for {where}: {', '.join(x['filename'] for x in saved)}", request=request)
    return saved

@app.get("/api/images")
def list_all_images(since_id: int = 0, db: Session = Depends(get_db)):
    q = db.query(CaseImage)
    if since_id:
        q = q.filter(CaseImage.id > since_id)
    rows = q.order_by(CaseImage.added_at.desc()).all()
    return [{
        "id": r.id, "caseId": r.case_code, "embryo": r.embryo_label,
        "filename": r.filename, "url": f"/uploads/{r.file_path}",
        "addedAt": r.added_at.isoformat(),
    } for r in rows]

@app.get("/api/cases/{case_code}/images")
def list_case_images(case_code: str, db: Session = Depends(get_db)):
    rows = db.query(CaseImage).filter(CaseImage.case_code == case_code).order_by(CaseImage.added_at.desc()).all()
    return [{
        "id": r.id, "caseId": r.case_code, "embryo": r.embryo_label,
        "filename": r.filename, "url": f"/uploads/{r.file_path}",
        "addedAt": r.added_at.isoformat(),
    } for r in rows]

@app.delete("/api/images/{image_id}")
def delete_image(image_id: int, request: Request, db: Session = Depends(get_db)):
    img = db.get(CaseImage, image_id)
    if not img:
        raise HTTPException(404, "Not found")
    path = UPLOADS / img.file_path
    if path.exists():
        path.unlink()
    detail = f"{img.filename} from case {img.case_code}" + (f", embryo {img.embryo_label}" if img.embryo_label else "")
    db.delete(img); db.commit()
    log_activity(db, "image_delete", detail, request=request)
    return {"ok": True}

# --- Protocol documents: lab-uploaded SOPs shown as separate cards in the Protocols tab ---

@app.post("/api/protocols")
def upload_protocol(
    request: Request,
    title: str = Form(""),
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
):
    ext = Path(file.filename or "").suffix
    stored_name = f"{uuid.uuid4().hex}{ext}"
    with (UPLOADS / stored_name).open("wb") as out:
        shutil.copyfileobj(file.file, out)
    doc = ProtocolDocument(
        title=title or Path(file.filename or stored_name).stem,
        filename=file.filename or stored_name,
        content_type=file.content_type or "application/octet-stream",
        file_path=stored_name,
    )
    db.add(doc); db.commit(); db.refresh(doc)
    log_activity(db, "protocol_upload", f"{doc.title} ({doc.filename})", request=request)
    return {
        "id": doc.id, "title": doc.title, "filename": doc.filename,
        "url": f"/uploads/{doc.file_path}", "uploadedAt": doc.uploaded_at.isoformat(),
    }

@app.get("/api/protocols")
def list_protocols(db: Session = Depends(get_db)):
    rows = db.query(ProtocolDocument).order_by(ProtocolDocument.uploaded_at.desc()).all()
    return [{
        "id": r.id, "title": r.title, "filename": r.filename,
        "url": f"/uploads/{r.file_path}", "uploadedAt": r.uploaded_at.isoformat(),
    } for r in rows]

@app.delete("/api/protocols/{protocol_id}")
def delete_protocol(protocol_id: int, request: Request, db: Session = Depends(get_db)):
    doc = db.get(ProtocolDocument, protocol_id)
    if not doc:
        raise HTTPException(404, "Not found")
    path = UPLOADS / doc.file_path
    if path.exists():
        path.unlink()
    detail = f"{doc.title} ({doc.filename})"
    db.delete(doc); db.commit()
    log_activity(db, "protocol_delete", detail, request=request)
    return {"ok": True}

# --- Live Google Sheets sync: pulls case/sample rows into the same store the UI reads ---

_SYNC_COOLDOWN_SECONDS = 60
_last_manual_sync = 0.0

@app.post("/api/sync-sheet")
def sync_sheet_now(request: Request, db: Session = Depends(get_db)):
    sources = parse_sources(settings.sheet_sources)
    if not sources:
        raise HTTPException(400, "No sheet sources configured")
    # Every page load asks for a sync; if one ran moments ago, reuse it instead of
    # re-fetching every workbook (several viewers opening at once would stack up).
    global _last_manual_sync
    last = db.get(KVStore, "embryomatrix-sheet-sync-status")
    if last and last.value and time.time() - _last_manual_sync < _SYNC_COOLDOWN_SECONDS:
        return {**last.value, "changed": False, "cached": True}
    _last_manual_sync = time.time()
    result = sync_sources(db, sources)
    log_activity(db, "sheet_sync", "Manual Google Sheets sync", request=request)
    return result

@app.get("/api/sync-sheet/status")
def sync_sheet_status(db: Session = Depends(get_db)):
    row = db.get(KVStore, "embryomatrix-sheet-sync-status")
    return row.value if row else {"lastSyncedAt": None}

async def _background_sheet_sync():
    while True:
        await asyncio.sleep(settings.sheet_sync_minutes * 60)
        sources = parse_sources(settings.sheet_sources)
        if not sources:
            continue
        db = SessionLocal()
        try:
            await asyncio.to_thread(sync_sources, db, sources)
        except Exception:
            pass
        finally:
            db.close()

@app.on_event("startup")
async def _startup_sheet_sync():
    sources = parse_sources(settings.sheet_sources)
    if not sources:
        return
    db = SessionLocal()
    try:
        await asyncio.to_thread(sync_sources, db, sources)
    except Exception:
        pass
    finally:
        db.close()
    asyncio.create_task(_background_sheet_sync())
