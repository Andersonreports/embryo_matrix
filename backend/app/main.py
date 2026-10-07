import asyncio
import json
import re
import secrets
import time
import uuid
from datetime import datetime, timedelta, timezone
from pathlib import Path
from fastapi import FastAPI, Depends, HTTPException, Request, UploadFile, File, Form
from fastapi.responses import FileResponse, JSONResponse, RedirectResponse, Response
from fastapi.staticfiles import StaticFiles
from fastapi.middleware.gzip import GZipMiddleware
from sqlalchemy.orm import Session
from sqlalchemy import func
from .config import settings
from .database import Base, engine, get_db, SessionLocal
from .placement import Placement, safe as _safe_name
from .models import Lab, PatientCase, EmbryoSample, PGTTest, KVStore, CaseImage, ProtocolDocument, ActivityLog, TrfSubmission, CaseRunAssignment, User, Followup, EmbryoOutcome, OutcomeHistory
from .schemas import LabCreate, CaseCreate, SampleCreate, TestCreate, KVValue, CellEditIn
from .sheet_sync import parse_sources, sync_sources
from . import auth, cell_edits, edits_sheet, storage, trf_fill, trf_pdf
from sqlalchemy import inspect, text
import mimetypes

Base.metadata.create_all(bind=engine)

from .migrations import run as _run_migrations
_run_migrations()

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
STATIC = Path(__file__).parent.parent.parent / "frontend"
UPLOADS = Path(__file__).parent / "uploads"
UPLOADS.mkdir(exist_ok=True)
app.mount("/static", StaticFiles(directory=STATIC), name="static")

@app.get("/uploads/{path:path}")
def serve_upload(path: str):
    """Files under uploads/ may be gzip-compressed at rest (storage.py) - this
    decompresses transparently, so every consumer (browser UI, the lab-PC sync
    script, an export download) gets plain original bytes over a normal GET,
    with no client-side unzip step required. Old, pre-compression files (no
    .gz) are served as-is."""
    full = (UPLOADS / path).resolve()
    if UPLOADS.resolve() not in full.parents or not full.is_file():
        raise HTTPException(404, "Not found")
    data = storage.read_decompressed(full)
    guess_name = path[:-3] if path.endswith(".gz") else path
    content_type = mimetypes.guess_type(guess_name)[0] or "application/octet-stream"
    return Response(content=data, media_type=content_type,
                    headers={"Content-Disposition": f'inline; filename="{Path(guess_name).name}"'})

# No login of its own: this app is embedded behind another gated application,
# which authenticates the user and forwards their identity on every request via
# the X-Auth-User / X-Auth-Role headers. Those headers must be set (and any
# client-supplied copies stripped) by the trusted proxy in front of this
# service — this app does not verify them itself, so it must never be reachable
# except through that proxy.
# role -> unix time of that role's most recent identified request. In-memory
# only: resets when the server restarts.
_last_seen: dict[str, float] = {}
_login_fails: dict[str, list[float]] = {}
ACTIVE_WINDOW_SECONDS = 5 * 60

def log_activity(db: Session, action: str, detail: str = "", user: dict | None = None, request: Request | None = None):
    if user is None and request is not None:
        user = getattr(request.state, "user", None)
    user = user or {}
    db.add(ActivityLog(username=user.get("username") or "", role=user.get("role") or "", action=action, detail=detail))
    db.commit()

FULL_ACCESS_ROLES = {"admin", "team_lead"}
# Role -> (method, path regex) pairs it may call. admin and team_lead may call everything;
# a role not listed here can only sign in/out and ask who it is.
_ROLE_RULES = {
    "member": [
        ("GET", r"/api/(store/.+|cases|cases/[^/]+/images|images|case-runs|dashboard|cell-edits|edits-sheet|result-file-months|sync-sheet/status)"),
        ("GET", r"/uploads/.+"), ("POST", r"/api/sync-sheet"), ("POST", r"/api/cases/[^/]+/images"),
    ],
    "embryologist": [
        ("POST", r"/api/(trf|trf-image|trf/preview-pdf)"), ("GET", r"/api/trf-image/[^/]+"),
        ("GET", r"/api/followups"), ("POST", r"/api/followups/save"),
    ],
}
_ALWAYS_OK = {("GET", "/api/whoami"), ("POST", "/api/logout")}

def role_allows(role: str, method: str, path: str) -> bool:
    if role in FULL_ACCESS_ROLES or (method, path) in _ALWAYS_OK:
        return True
    return any(m == method and re.fullmatch(rx, path) for m, rx in _ROLE_RULES.get(role, []))

@app.middleware("http")
async def identify_user(request: Request, call_next):
    path = request.url.path
    sync_key = request.headers.get("x-image-sync-key", "")
    # Same key covers every "pull files down to the lab PC" endpoint, not just images —
    # it only ever grants read/list access, never write, so widening its scope is safe.
    SYNC_PATHS = {"/api/images", "/api/protocols", "/api/result-files", "/api/trf-files", "/api/case-runs"}
    if sync_key and path in SYNC_PATHS and request.method == "GET":
        if settings.image_sync_token and secrets.compare_digest(sync_key.encode(), settings.image_sync_token.encode()):
            request.state.user = {"username": "File sync", "role": "sync"}
            return await call_next(request)
        return JSONResponse({"detail": "Invalid sync key"}, status_code=401)
    if settings.builtin_login:
        # Own login: identity comes only from the signed session cookie; the X-Auth headers are ignored.
        sess = auth.read_token(request.cookies.get(auth.COOKIE, ""))
        request.state.user = sess or {}
        if not sess and path not in ("/login", "/api/login", "/api/health") and not path.startswith("/static/login"):
            if path.startswith("/api/"):
                return JSONResponse({"detail": "Sign in required"}, status_code=401)
            if path == "/":
                return RedirectResponse("/login")
        if sess and path.startswith(("/api/", "/uploads/")) and not role_allows(sess["role"], request.method, path):
            return JSONResponse({"detail": "Your role does not have access to this"}, status_code=403)
        username, role = (sess or {}).get("username", ""), (sess or {}).get("role", "")
    else:
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

@app.get("/login")
def login_page():
    return FileResponse(STATIC / "login.html")

@app.post("/api/login")
async def login(request: Request, db: Session = Depends(get_db)):
    ip = (request.client.host if request.client else "")
    now = time.time()
    recent = [t for t in _login_fails.get(ip, []) if now - t < 600]
    if len(recent) >= 10:
        raise HTTPException(429, "Too many attempts - try again in a few minutes")
    body = await request.json()
    u = db.query(User).filter(User.username == str(body.get("username", "")).strip().lower()).first()
    if not u or not auth.verify_password(str(body.get("password", "")), u.password_hash):
        _login_fails[ip] = recent + [now]
        raise HTTPException(401, "Wrong username or password")
    log_activity(db, "login", "", user={"username": u.username, "role": u.role})
    resp = JSONResponse({"ok": True})
    resp.set_cookie(auth.COOKIE, auth.make_token(u.username, u.role), max_age=auth.SESSION_SECONDS, httponly=True, samesite="lax")
    return resp

@app.post("/api/logout")
def logout():
    resp = JSONResponse({"ok": True})
    resp.delete_cookie(auth.COOKIE)
    return resp

@app.get("/")
def home():
    return FileResponse(STATIC / "index.html")

@app.get("/api/health")
def health():
    return {"status": "ok", "application": settings.app_name}

@app.get("/api/whoami")
def whoami(request: Request):
    user = request.state.user or {}
    return {"username": user.get("username") or "", "role": user.get("role") or "", "signedIn": settings.builtin_login}

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

RESULT_FILES_KEY = "embryomatrix-result-files"

def _result_files(db: Session):
    row = db.get(KVStore, RESULT_FILES_KEY)
    return row, (list(row.value) if row and isinstance(row.value, list) else [])

def _save_result_files(db: Session, row, files):
    if row:
        row.value = files
    else:
        db.add(KVStore(key=RESULT_FILES_KEY, value=files))
    db.commit()

@app.post("/api/result-files")
def add_result_file(
    request: Request,
    id: str = Form(""),
    fileName: str = Form(""),
    run: str = Form(""),
    at: str = Form(""),
    samples: str = Form("[]"),
    sampleNames: str = Form("[]"),
    matched: int = Form(0),
    month: str = Form(""),
    file: UploadFile | None = File(None),
    db: Session = Depends(get_db),
):
    """Register an uploaded result file and the samples it filled in, so a later
    upload for the same samples can be refused until this one is deleted. The
    original spreadsheet itself is saved too (like images/protocols), so it can
    be synced out to the lab PC instead of only keeping the values we parsed
    from it."""
    user = request.state.user
    row, files = _result_files(db)
    stored_name = None
    if file is not None and file.filename:
        ext = Path(file.filename).suffix
        stored_name = storage.write_compressed(UPLOADS, f"{uuid.uuid4().hex}{ext}", file.file)
    entry = {
        "id": id or uuid.uuid4().hex,
        "fileName": fileName,
        "run": run,
        "at": at,
        "samples": json.loads(samples) if samples else [],
        "sampleNames": json.loads(sampleNames) if sampleNames else [],
        "matched": matched,
        "by": user.get("username") or "",
        "role": user.get("role") or "",
        "filePath": stored_name,
        # Month the result file belongs to (the folder it came from, e.g. "2026-01"). Drives the Month column and the Windows folder.
        "month": month if re.fullmatch(r"\d{4}-(0[1-9]|1[0-2])", month or "") else "",
    }
    files.append(entry)
    _save_result_files(db, row, files)
    return {"value": files}

@app.get("/api/result-files")
def list_result_files_for_sync(since: str = "", db: Session = Depends(get_db)):
    """For the lab PC sync script: every uploaded result file that actually has a
    stored original (older entries made before file storage was added have none)."""
    _, files = _result_files(db)
    files = [f for f in files if f.get("filePath")]
    if since:
        files = [f for f in files if str(f.get("at") or "") > since]
    files.sort(key=lambda f: str(f.get("at") or ""))
    pl = Placement(db)
    return [{
        "id": f["id"], "fileName": f.get("fileName"), "run": f.get("run"),
        "at": f.get("at"), "matched": f.get("matched"),
        "url": f"/uploads/{f['filePath']}",
        "relPath": f"{pl.file_result_folder(f)}/{_safe_name(f.get('fileName'), 'resultfile_' + str(f['id']))}",
    } for f in files]

@app.patch("/api/result-files/{file_id}/month")
def set_result_file_month(file_id: str, payload: KVValue, request: Request, db: Session = Depends(get_db)):
    month = str((payload.value or {}).get("month", "")) if isinstance(payload.value, dict) else ""
    if month and not re.fullmatch(r"\d{4}-(0[1-9]|1[0-2])", month):
        raise HTTPException(422, "month must look like 2026-01")
    row, files = _result_files(db)
    files = [dict(f) for f in files]   # copies: editing the stored dicts in place would hide the change from SQLAlchemy
    hit = next((f for f in files if f.get("id") == file_id), None)
    if not hit:
        raise HTTPException(404, "Not found")
    hit["month"] = month
    _save_result_files(db, row, files)
    log_activity(db, "result_month", f"{hit.get('fileName')} → month {month or 'auto'}", request=request)
    return {"id": file_id, "month": month}

@app.get("/api/result-file-months")
def result_file_months(db: Session = Depends(get_db)):
    """Which month each uploaded result file's run belongs to (same rule as its Windows folder), for the Upload result list."""
    pl = Placement(db)
    return {fid: {"year": ym[0], "month": ym[1]} for fid, ym in pl.rf_months.items()}

@app.delete("/api/result-files/{file_id}")
def delete_result_file(file_id: str, request: Request, db: Session = Depends(get_db)):
    row, files = _result_files(db)
    gone = next((f for f in files if f.get("id") == file_id), None)
    files = [f for f in files if f.get("id") != file_id]
    _save_result_files(db, row, files)
    if gone and gone.get("filePath"):
        path = UPLOADS / gone["filePath"]
        if path.exists():
            path.unlink()
    label = (gone or {}).get("fileName") or file_id
    log_activity(db, "result_delete", f"{label} · results removed from {len((gone or {}).get('samples', []))} embryo(s)", request=request)
    return {"value": files}

@app.post("/api/result-files/log-delete")
def log_legacy_result_delete(payload: KVValue, request: Request, db: Session = Depends(get_db)):
    # Earlier uploads (before file tracking) have no registry entry; still record who removed them.
    data = payload.value if isinstance(payload.value, dict) else {}
    log_activity(db, "result_delete", f"{data.get('fileName') or 'Earlier upload'} · results removed from {int(data.get('count', 0))} embryo(s)", request=request)
    return {"ok": True}

# --- Manual cell edits: written to the live "Edited samples" Google Sheet (edits_sheet.py)
# and kept in their own .xlsx as the local copy (cell_edits.py), not the database ---

@app.get("/api/cell-edits")
def get_cell_edits(db: Session = Depends(get_db)):
    local = cell_edits.list_edits()
    merged = edits_sheet.merged_edits(local)
    # Edits saved here that never reached the sheet (old deployment, offline) are sent again.
    missing = edits_sheet.missing_from_sheet(local)
    if missing:
        kv = db.get(KVStore, "embryomatrix-imported-cases")
        rows = kv.value if kv else []
        for e in missing:
            mine = {x["column"]: x["value"] for x in local
                    if edits_sheet.record_key(x["sampleId"], x["embryo"]) == edits_sheet.record_key(e["sampleId"], e["embryo"])}
            edits_sheet.push_edit(e, edits_sheet.row_from_cases(rows, e["sampleId"], e["embryo"], mine))
    return merged

@app.get("/api/edits-sheet")
def get_edits_sheet():
    edits_sheet.fetch_edits()  # kicks off a background retry / re-read when stale
    return edits_sheet.status()

@app.post("/api/cell-edits")
def post_cell_edit(payload: CellEditIn, request: Request, db: Session = Depends(get_db)):
    user = request.state.user or {}
    try:
        entry = cell_edits.save_edit(
            sample_id=payload.sampleId, embryo=payload.embryo, column=payload.column,
            value=payload.value, user=user.get("username") or "Unknown",
        )
    except ValueError as e:
        raise HTTPException(400, str(e))
    where = f"{entry['sampleId']}" + (f" embryo {entry['embryo']}" if entry["embryo"] else "")
    log_activity(db, "cell_edit", f"{where} · {entry['column']}: '{entry['oldValue']}' → '{entry['value']}'", request=request)
    row = payload.row
    if not row:  # app sent no row (e.g. an old browser tab) - rebuild it from the synced sheet rows
        kv = db.get(KVStore, "embryomatrix-imported-cases")
        mine = {e["column"]: e["value"] for e in cell_edits.list_edits()
                if edits_sheet.record_key(e["sampleId"], e["embryo"]) == edits_sheet.record_key(entry["sampleId"], entry["embryo"])}
        row = edits_sheet.row_from_cases(kv.value if kv else [], entry["sampleId"], entry["embryo"], {**mine, entry["column"]: entry["value"]})
    edits_sheet.retry_pending()
    entry["sheet"] = edits_sheet.push_edit(entry, row)
    return entry

@app.delete("/api/cell-edits")
def remove_cell_edit(sampleId: str, column: str, embryo: str = "", request: Request = None, db: Session = Depends(get_db)):
    ok = cell_edits.delete_edit(sampleId, embryo, column)
    edits_sheet.push_revert(sampleId, embryo, column)
    if ok:
        where = f"{sampleId}" + (f" embryo {embryo}" if embryo else "")
        log_activity(db, "cell_edit_revert", f"{where} · {column} reverted to sheet value", request=request)
    return {"ok": ok}

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
        disk_name = storage.write_compressed(UPLOADS, stored_name, f.file)
        img = CaseImage(
            case_code=case_code,
            embryo_label=embryo_label or None,
            filename=f.filename or stored_name,
            content_type=f.content_type or "application/octet-stream",
            file_path=disk_name,
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
    # So the lab-PC sync script can place images under RUN_{run}\{case}\... once a
    # run is assigned, instead of always under the unassigned/staging path.
    case_codes = {r.case_code for r in rows}
    run_by_case = dict(
        db.query(CaseRunAssignment.case_code, CaseRunAssignment.run_id)
        .filter(CaseRunAssignment.case_code.in_(case_codes)).all()
    ) if case_codes else {}
    pl = Placement(db)
    def image_path(r):
        prefix = f"{_safe_name(r.embryo_label)}_" if r.embryo_label and not r.embryo_label.lower().startswith("general") else ""
        return f"{pl.case_folder(r.case_code)}/{prefix}{r.id}_{_safe_name(r.filename, f'image{r.id}')}"
    return [{
        "id": r.id, "caseId": r.case_code, "embryo": r.embryo_label,
        "filename": r.filename, "url": f"/uploads/{r.file_path}",
        "addedAt": r.added_at.isoformat(), "runId": run_by_case.get(r.case_code),
        "relPath": image_path(r),
    } for r in rows]

@app.get("/api/cases/{case_code}/images")
def list_case_images(case_code: str, db: Session = Depends(get_db)):
    rows = db.query(CaseImage).filter(CaseImage.case_code == case_code).order_by(CaseImage.added_at.desc()).all()
    return [{
        "id": r.id, "caseId": r.case_code, "embryo": r.embryo_label,
        "filename": r.filename, "url": f"/uploads/{r.file_path}",
        "addedAt": r.added_at.isoformat(),
    } for r in rows]

@app.post("/api/images/{image_id}/replace")
def replace_image(image_id: int, request: Request, file: UploadFile = File(...), db: Session = Depends(get_db)):
    """Swap an image for a new file. Kept on the same case + embryo; stored as a NEW row so the lab-PC sync downloads
    the new picture (it never deletes local copies, so the old file stays on that PC)."""
    old = db.get(CaseImage, image_id)
    if not old:
        raise HTTPException(404, "Not found")
    if not (file.content_type or "").startswith("image/"):
        raise HTTPException(422, "Please choose an image file")
    ext = Path(file.filename or "").suffix
    disk_name = storage.write_compressed(UPLOADS, f"{uuid.uuid4().hex}{ext}", file.file)
    new = CaseImage(case_code=old.case_code, embryo_label=old.embryo_label, filename=file.filename or disk_name,
                    content_type=file.content_type or "application/octet-stream", file_path=disk_name)
    old_path = UPLOADS / old.file_path
    old_name = old.filename
    db.add(new); db.delete(old); db.commit(); db.refresh(new)
    if old_path.exists():
        old_path.unlink()
    log_activity(db, "image_replace", f"{old_name} → {new.filename} on case {new.case_code}" + (f", embryo {new.embryo_label}" if new.embryo_label else ""), request=request)
    return {"id": new.id, "caseId": new.case_code, "embryo": new.embryo_label, "filename": new.filename,
            "url": f"/uploads/{new.file_path}", "addedAt": new.added_at.isoformat()}

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

# --- Case run assignment: manually links a case to a sequencing run so the lab-PC
# sync script can move that case's TRF/images out of staging into a run folder. ---

@app.patch("/api/cases/{case_code}/run")
def assign_case_run(case_code: str, payload: KVValue, request: Request, db: Session = Depends(get_db)):
    run_id = str((payload.value or {}).get("runId", "")).strip() if isinstance(payload.value, dict) else ""
    if not run_id:
        raise HTTPException(400, "runId is required")
    user = request.state.user or {}
    row = db.get(CaseRunAssignment, case_code)
    if row:
        row.run_id = run_id
        row.assigned_by = user.get("username") or ""
    else:
        db.add(CaseRunAssignment(case_code=case_code, run_id=run_id, assigned_by=user.get("username") or ""))
    db.commit()
    log_activity(db, "case_run_assign", f"{case_code} → RUN {run_id}", request=request)
    return {"caseCode": case_code, "runId": run_id}

@app.get("/api/case-runs")
def list_case_runs(db: Session = Depends(get_db)):
    """For the lab-PC sync script: every case's assigned run, so it can decide
    which cases' staged files need to move into a run folder."""
    rows = db.query(CaseRunAssignment).all()
    return [{"caseCode": r.case_code, "runId": r.run_id, "assignedAt": r.assigned_at.isoformat()} for r in rows]

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
    disk_name = storage.write_compressed(UPLOADS, stored_name, file.file)
    doc = ProtocolDocument(
        title=title or Path(file.filename or stored_name).stem,
        filename=file.filename or stored_name,
        content_type=file.content_type or "application/octet-stream",
        file_path=disk_name,
    )
    db.add(doc); db.commit(); db.refresh(doc)
    log_activity(db, "protocol_upload", f"{doc.title} ({doc.filename})", request=request)
    return {
        "id": doc.id, "title": doc.title, "filename": doc.filename,
        "url": f"/uploads/{doc.file_path}", "uploadedAt": doc.uploaded_at.isoformat(),
    }

@app.get("/api/protocols")
def list_protocols(since_id: int = 0, db: Session = Depends(get_db)):
    q = db.query(ProtocolDocument)
    if since_id:
        q = q.filter(ProtocolDocument.id > since_id)
    rows = q.order_by(ProtocolDocument.uploaded_at.desc()).all()
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

# --- Digital TRF: the PGT test requisition form, filled in on the app's TRFs tab ---
# Like the rest of this app it has no login of its own and relies on the gated proxy in
# front of it; TRFs hold Aadhaar numbers, so that must be in place before go-live.

TRF_TESTS = {
    "PGT-A": "Preimplantation Genetic Testing - Aneuploidies (PGT-A)",
    "EMBRYO_SURE": "Embryo Sure - PGT-A (CNV with SNP)",
    "PGT-SR": "Preimplantation Genetic Testing - Structural Rearrangements (PGT-SR)",
    "PGT-HLA": "Preimplantation Genetic Testing - HLA C typing",
    # PGT-M requisition form
    "PGT-M": "Mutation only",
    "PGT-A+M": "Aneuploidies + Mutation (PGT-A+M)",
    "PGT-A+M+HLA": "Aneuploidies + Mutation + HLA matching (PGT-A+M + HLA)",
}
TRF_TEXT_FIELDS = (
    "biopsyDate", "referringDoctor", "hospital", "address", "phone", "email",
    "patientName", "patientDob", "uhid", "aadhaar", "husbandName", "husbandDob", "patientEmail",
    "collectionDate", "collectionTime", "biopsyDay", "donorAge", "testIndication", "clinicalHistory",
    "maternalKaryotype", "paternalKaryotype", "biopsyTime", "maternalGenotype", "paternalGenotype", "ivfLabContact", "rebiopsy", "embryologistName", "embryologistEmail",
    # Form G (PNDT Act consent)
    "consentRelation", "consentGuardianName", "consentAge", "patientAddress", "consentDate", "consentPlace",
    "companionName", "companionAddress", "companionRelation", "gynaecologistName", "gynaecologistRegNo",
    "explanationDate", "geneticClinicName", "geneticClinicAddress", "geneticClinicRegNo",
    # Outcome follow-up consent (asked now; the pregnancy results themselves come later, outside the TRF)
    "followupConsent", "followupContact", "followupPhoneEmail", "followupExpected",
)
TRF_EMBRYO_FIELDS = ("label", "grade", "cells", "day", "intact", "comments")
TRF_IMG_RE = re.compile(r"^[0-9a-f]{32}\.(jpg|png|webp)$")
TRF_IMG_MAX_PER_EMBRYO = 6
_trf_img_recent: dict[str, list[float]] = {}
TRF_STATUSES = ("New", "Approved", "Rejected")
_trf_recent: dict[str, list[float]] = {}  # client IP -> recent submit times, for a simple rate limit

def _require_lab_user(request: Request):
    user = request.state.user or {}
    if user.get("role") == "sync":  # the lab-PC file sync key never reads TRFs
        raise HTTPException(403, "Not allowed")
    return user

def _clean_trf(raw: dict) -> dict:
    s = lambda v, n=2000: str(v or "").strip()[:n]
    data = {k: s(raw.get(k)) for k in TRF_TEXT_FIELDS}
    data["formType"] = "PGT-M" if raw.get("formType") == "PGT-M" else "PGT-A"
    data["aadhaar"] = "".join(ch for ch in data["aadhaar"] if ch.isdigit())
    data["tests"] = [t for t in (raw.get("tests") or []) if t in TRF_TESTS]
    data["gametes"] = [g for g in (raw.get("gametes") or []) if g in ("Self", "Donor Sperm", "Donor Oocyte")]
    data["dryRun"] = bool(raw.get("dryRun"))
    data["followupConsent"] = data["followupConsent"] if data["followupConsent"] in ("Yes", "No") else ""
    embryos = []
    for e in (raw.get("embryos") or [])[:60]:
        row = {k: s((e or {}).get(k), 500) for k in TRF_EMBRYO_FIELDS}
        imgs = [i for i in ((e or {}).get("images") or []) if isinstance(i, str) and TRF_IMG_RE.match(i)
                and (UPLOADS / f"trfimg-{i}.gz").is_file()][:TRF_IMG_MAX_PER_EMBRYO]
        if any(row.values()) or imgs:
            if imgs:
                row["images"] = imgs
            embryos.append(row)
    data["embryos"] = embryos
    return data

def _trf_summary(t: TrfSubmission) -> dict:
    d = t.data or {}
    return {
        "id": t.id, "ref": t.ref, "submittedAt": _iso_utc(t.submitted_at), "status": t.status,
        "clinic": t.clinic, "patient": t.patient_name, "doctor": d.get("referringDoctor", ""),
        "tests": d.get("tests", []), "formType": d.get("formType", "PGT-A"), "biopsyDate": d.get("biopsyDate", ""), "embryos": len(d.get("embryos", [])),
        "statusBy": t.status_by, "statusAt": _iso_utc(t.status_at), "statusNote": t.status_note or "",
        "caseCode": t.case_code, "pdfUrl": f"/api/trf/{t.id}/pdf" if t.pdf_file_path else None,
    }

def _generate_trf_pdf(db: Session, t: TrfSubmission):
    """Best-effort: a PDF render failure shouldn't fail the submission itself -
    the data is already saved either way."""
    try:
        # A short locale-style stamp, like the browser's toLocaleString() - the raw ISO
        # timestamp is too long for the template's ref box and wraps/overlaps.
        submitted = t.submitted_at.strftime("%d/%m/%Y, %I:%M:%S %p")
        meta = {"ref": t.ref, "submittedAt": submitted}
        try:  # the paper template itself, filled in
            pdf_bytes = trf_fill.render_trf_filled_pdf(t.data or {}, meta)
        except Exception as fill_exc:
            print(f"TRF template fill failed for {t.ref}, using the HTML layout: {fill_exc}")
            pdf_bytes = trf_pdf.render_trf_pdf(t.data or {}, meta)
        stored_name = f"{uuid.uuid4().hex}.pdf"
        disk_name = storage.write_compressed_bytes(UPLOADS, stored_name, pdf_bytes)
        t.pdf_filename, t.pdf_file_path = f"{t.ref}.pdf", disk_name
        db.commit()
    except Exception as exc:
        print(f"TRF PDF render failed for {t.ref}: {exc}")

@app.post("/api/trf")
async def submit_trf(request: Request, db: Session = Depends(get_db)):
    body = await request.body()
    if len(body) > 200_000:
        raise HTTPException(413, "Form is too large")
    ip = (request.headers.get("x-forwarded-for") or (request.client.host if request.client else "")).split(",")[0].strip()
    now = time.time()
    recent = [t for t in _trf_recent.get(ip, []) if now - t < 3600]
    if len(recent) >= 30:
        raise HTTPException(429, "Too many submissions from this network. Please try again later.")
    try:
        raw = json.loads(body or b"{}")
    except ValueError:
        raise HTTPException(400, "Invalid form data")
    data = _clean_trf(raw if isinstance(raw, dict) else {})
    missing = [label for key, label in (("hospital", "Hospital / IVF centre"), ("referringDoctor", "Referring doctor"),
               ("phone", "Phone"), ("patientName", "Patient name"), ("biopsyDate", "Date of biopsy")) if not data[key]]
    if not data["tests"]:
        missing.append("Test requested")
    if not data["embryos"]:
        missing.append("At least one embryo in the biopsy worksheet")
    if data["aadhaar"] and len(data["aadhaar"]) != 12:
        raise HTTPException(422, "Aadhaar number must be 12 digits")
    if missing:
        raise HTTPException(422, "Please fill in: " + ", ".join(missing))
    ref = ""
    for _ in range(10):
        ref = f"TRF-{datetime.utcnow():%y%m%d}-{secrets.token_hex(2).upper()}"
        if not db.query(TrfSubmission.id).filter(TrfSubmission.ref == ref).first():
            break
    t = TrfSubmission(ref=ref, clinic=data["hospital"][:255], patient_name=data["patientName"][:255], data=data)
    db.add(t); db.commit(); db.refresh(t)
    _generate_trf_pdf(db, t)
    _create_followup_from_trf(db, t, (request.state.user or {}).get("username") or "")
    _trf_recent[ip] = recent + [now]
    log_activity(db, "trf_submit", f"{t.ref} · {t.patient_name} · {t.clinic}", request=request)
    return {"ref": t.ref, "submittedAt": _iso_utc(t.submitted_at)}

@app.post("/api/trf-image")
async def upload_trf_image(request: Request, file: UploadFile = File(...)):
    """A photo of one embryo, attached to a TRF being filled in on the public form. The form sends
    back the returned id with the embryo row; only lab users can view it (GET /api/trf-image/{id})."""
    ip = (request.headers.get("x-forwarded-for") or (request.client.host if request.client else "")).split(",")[0].strip()
    now = time.time()
    recent = [t for t in _trf_img_recent.get(ip, []) if now - t < 3600]
    if len(recent) >= 150:
        raise HTTPException(429, "Too many images from this network. Please try again later.")
    data = await file.read(8 * 1024 * 1024 + 1)
    if len(data) > 8 * 1024 * 1024:
        raise HTTPException(413, "Image is too large (max 8 MB)")
    if data[:3] == b"\xff\xd8\xff":
        ext = "jpg"
    elif data[:8] == b"\x89PNG\r\n\x1a\n":
        ext = "png"
    elif data[:4] == b"RIFF" and data[8:12] == b"WEBP":
        ext = "webp"
    else:
        raise HTTPException(415, "Please choose a JPG, PNG or WebP image")
    name = f"{uuid.uuid4().hex}.{ext}"
    storage.write_compressed_bytes(UPLOADS, f"trfimg-{name}", data)
    _trf_img_recent[ip] = recent + [now]
    return {"id": name}

@app.get("/api/trf-image/{name}")
def get_trf_image(name: str, request: Request):
    _require_lab_user(request)
    if not TRF_IMG_RE.match(name):
        raise HTTPException(404, "Not found")
    full = (UPLOADS / f"trfimg-{name}.gz").resolve()
    if UPLOADS.resolve() not in full.parents or not full.is_file():
        raise HTTPException(404, "Not found")
    mt = {"jpg": "image/jpeg", "png": "image/png", "webp": "image/webp"}[name.rsplit(".", 1)[1]]
    return Response(content=storage.read_decompressed(full), media_type=mt, headers={"Cache-Control": "private, max-age=86400"})

@app.get("/api/trf")
def list_trfs(request: Request, db: Session = Depends(get_db)):
    _require_lab_user(request)
    rows = db.query(TrfSubmission).order_by(TrfSubmission.submitted_at.desc()).all()
    return [_trf_summary(t) for t in rows]

@app.get("/api/trf/{trf_id}")
def get_trf(trf_id: int, request: Request, db: Session = Depends(get_db)):
    _require_lab_user(request)
    t = db.get(TrfSubmission, trf_id)
    if not t:
        raise HTTPException(404, "Not found")
    return {**_trf_summary(t), "data": t.data}

@app.delete("/api/trf/{trf_id}")
def delete_trf(trf_id: int, request: Request, db: Session = Depends(get_db)):
    """Permanently removes a submitted TRF and its stored PDF."""
    _require_lab_user(request)
    t = db.get(TrfSubmission, trf_id)
    if not t:
        raise HTTPException(404, "Not found")
    ref, patient, pdf = t.ref, t.patient_name, t.pdf_file_path
    images = [i for e in (t.data or {}).get("embryos", []) for i in e.get("images", [])]
    db.delete(t)
    db.commit()
    for i in images:
        p = (UPLOADS / f"trfimg-{i}.gz").resolve()
        if UPLOADS.resolve() in p.parents and p.is_file():
            p.unlink()
    if pdf:
        path = (UPLOADS / pdf).resolve()
        if UPLOADS.resolve() in path.parents and path.is_file():
            path.unlink()
    log_activity(db, "trf_delete", f"{ref} · {patient} deleted", request=request)
    return {"ok": True}

_trf_preview_recent: dict[str, list[float]] = {}

@app.post("/api/trf/preview-pdf")
async def preview_trf_pdf(request: Request):
    """The TRF as the filled paper template, straight from the entered data (nothing is saved) - used by
    Preview and Print / PDF in the app."""
    body = await request.body()
    if len(body) > 200_000:
        raise HTTPException(413, "Form is too large")
    ip = (request.headers.get("x-forwarded-for") or (request.client.host if request.client else "")).split(",")[0].strip()
    now = time.time()
    recent = [t for t in _trf_preview_recent.get(ip, []) if now - t < 600]
    if len(recent) >= 40:
        raise HTTPException(429, "Too many previews. Please wait a few minutes.")
    _trf_preview_recent[ip] = recent + [now]
    try:
        raw = json.loads(body or b"{}")
    except ValueError:
        raise HTTPException(400, "Invalid form data")
    data = _clean_trf((raw.get("data") if isinstance(raw, dict) else None) or {})
    meta_in = raw.get("meta") if isinstance(raw, dict) and isinstance(raw.get("meta"), dict) else {}
    meta = {"ref": str(meta_in.get("ref") or "")[:40], "submittedAt": str(meta_in.get("submittedAtText") or "")[:40]}
    try:
        pdf = trf_fill.render_trf_filled_pdf(data, meta)
    except Exception as exc:
        print(f"TRF preview failed: {exc}")
        raise HTTPException(500, "The TRF could not be rendered")
    return Response(content=pdf, media_type="application/pdf", headers={"Content-Disposition": 'inline; filename="TRF.pdf"'})

@app.get("/api/trf/{trf_id}/pdf")
def download_trf_pdf(trf_id: int, request: Request, db: Session = Depends(get_db)):
    """The TRF's PDF as a normal .pdf download named after the TRF (the stored copy is gzip-compressed at rest)."""
    _require_lab_user(request)
    t = db.get(TrfSubmission, trf_id)
    if not t or not t.pdf_file_path:
        raise HTTPException(404, "Not found")
    full = (UPLOADS / t.pdf_file_path).resolve()
    if UPLOADS.resolve() not in full.parents or not full.is_file():
        raise HTTPException(404, "Not found")
    safe = re.sub(r'[^A-Za-z0-9._ -]+', "", f"TRF {t.ref} {t.patient_name}".strip()) or "TRF"
    return Response(content=storage.read_decompressed(full), media_type="application/pdf",
                    headers={"Content-Disposition": f'attachment; filename="{safe}.pdf"'})

@app.patch("/api/trf/{trf_id}")
def update_trf_status(trf_id: int, payload: KVValue, request: Request, db: Session = Depends(get_db)):
    user = _require_lab_user(request)
    t = db.get(TrfSubmission, trf_id)
    if not t:
        raise HTTPException(404, "Not found")
    status = str((payload.value or {}).get("status", "")) if isinstance(payload.value, dict) else ""
    if status == "Received":  # old name of Approved
        status = "Approved"
    if status not in TRF_STATUSES:
        raise HTTPException(400, "Unknown status")
    note = str(payload.value.get("note") or "").strip()[:1000]
    if status == "Rejected" and not note:
        raise HTTPException(422, "Please give a reason for rejecting this TRF")
    t.status, t.status_by, t.status_at, t.status_note = status, user.get("username") or "", datetime.utcnow(), note
    db.commit()
    log_activity(db, "trf_status", f"{t.ref} · {t.patient_name} → {status}" + (f" · {note}" if note else ""), request=request)
    return _trf_summary(t)

@app.patch("/api/trf/{trf_id}/case")
def link_trf_case(trf_id: int, payload: KVValue, request: Request, db: Session = Depends(get_db)):
    """Links a submitted TRF to a case, since the clinic-typed patient name has
    no reliable automatic match - a lab user confirms it. This is what lets the
    lab-PC sync script route the TRF's PDF into that case's folder."""
    _require_lab_user(request)
    t = db.get(TrfSubmission, trf_id)
    if not t:
        raise HTTPException(404, "Not found")
    case_code = str((payload.value or {}).get("caseCode", "")).strip() if isinstance(payload.value, dict) else ""
    t.case_code = case_code or None
    if case_code:
        _rekey_followup(db, f"trf:{t.ref}", case_code)
    db.commit()
    log_activity(db, "trf_link_case", f"{t.ref} → case {case_code or '(unlinked)'}", request=request)
    return _trf_summary(t)

# --- Clinical outcome follow-up ---
OUTCOME_STATUSES = ("Not transferred", "Transferred", "Implantation successful", "Implantation unsuccessful",
                    "Clinical pregnancy", "Miscarriage", "Live birth", "Outcome unknown")
# Retired statuses: "Ongoing pregnancy" is the same as "Clinical pregnancy"; "Transfer planned" is not yet transferred.
_OUTCOME_ALIASES = {"Ongoing pregnancy": "Clinical pregnancy", "Transfer planned": "Not transferred"}
_outcome_status = lambda v: _OUTCOME_ALIASES.get(v or "", v or "")
FOLLOWUP_STATES = ("", "awaiting", "completed", "not_applicable")
_PERIOD_MONTHS = {"Within 1 month": 1, "1–3 months": 3, "3–6 months": 6, "6–12 months": 12}

def _add_months(d, n):
    from datetime import date
    y, mo = divmod(d.month - 1 + n, 12)
    y, mo = d.year + y, mo + 1
    day = min(d.day, [31, 29 if y % 4 == 0 and (y % 100 or y % 400 == 0) else 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][mo - 1])
    return date(y, mo, day)

def _age_from_trf(data: dict, at: datetime):
    dob = str(data.get("patientDob") or "")
    try:
        b = datetime.strptime(dob[:10], "%Y-%m-%d")
        return at.year - b.year - ((at.month, at.day) < (b.month, b.day))
    except ValueError:
        pass
    digits = "".join(ch for ch in str(data.get("consentAge") or "") if ch.isdigit())
    return int(digits) if digits and 14 <= int(digits) <= 70 else None

def _create_followup_from_trf(db: Session, t: TrfSubmission, owner: str = ""):
    """A submitted TRF that answered the follow-up consent question opens a follow-up record. Never fails the submission."""
    try:
        d = t.data or {}
        consent = d.get("followupConsent")
        if consent not in ("Yes", "No"):
            return
        key = f"trf:{t.ref}"
        if db.query(Followup.id).filter(Followup.case_key == key).first():
            return
        months = _PERIOD_MONTHS.get(d.get("followupExpected", ""), 3)
        due = _add_months(t.submitted_at.date(), months).isoformat()
        db.add(Followup(
            case_key=key, source="trf", trf_ref=t.ref, patient=t.patient_name, clinic=t.clinic, region="",
            embryologist=d.get("embryologistName", ""), test=", ".join(d.get("tests", [])), month=t.submitted_at.strftime("%Y-%m"),
            age=_age_from_trf(d, t.submitted_at), embryos=[{"label": e.get("label", ""), "result": ""} for e in d.get("embryos", []) if e.get("label")],
            consent=consent, contact_name=d.get("followupContact", ""), contact_detail=d.get("followupPhoneEmail", ""),
            expected_period=d.get("followupExpected", ""), due_date=due, state="not_applicable" if consent == "No" else "",
            updated_by="TRF", owner=owner))
        db.commit()
    except Exception as exc:
        db.rollback()
        print(f"Follow-up record for {t.ref} failed: {exc}")

FURTHER_TESTS = ("tera", "nips")
TEST_WHERE = ("", "Not done", "Anderson", "Other lab")

def _clean_further_tests(raw) -> dict:
    """TERA / NIPS done on an embryo after PGT-A: where it was done, the lab (if not Anderson), date, result and details."""
    out = {}
    if not isinstance(raw, dict):
        return out
    for k in FURTHER_TESTS:
        t = raw.get(k)
        if not isinstance(t, dict):
            continue
        where = str(t.get("where") or "")
        if where not in TEST_WHERE:
            where = ""
        date = str(t.get("date") or "").strip()[:10]
        item = {"where": where, "lab": str(t.get("lab") or "").strip()[:120] if where == "Other lab" else "",
                "date": date if len(date) == 10 else "", "biopsyTime": str(t.get("biopsyTime") or "").strip()[:5] if k == "tera" else "",
                "result": str(t.get("result") or "").strip()[:300], "note": str(t.get("note") or "").strip()[:1000]}
        if any(item.values()):
            out[k] = item
    return out

def _rekey_followup(db: Session, old: str, new: str):
    f = db.query(Followup).filter(Followup.case_key == old).first()
    if not f or db.query(Followup.id).filter(Followup.case_key == new).first():
        return
    f.case_key = new
    for o in db.query(EmbryoOutcome).filter(EmbryoOutcome.case_key == old).all():
        o.case_key = new

def _hist_out(h: OutcomeHistory) -> dict:
    return {"status": h.status, "previous": h.previous_status, "date": h.event_date, "note": h.note, "tests": h.tests or {}, "by": h.changed_by, "at": _iso_utc(h.changed_at)}

def _fu_out(f: Followup, outs: list, hist: dict | None = None) -> dict:
    return {
        "caseKey": f.case_key, "source": f.source, "trfRef": f.trf_ref, "patient": f.patient, "clinic": f.clinic, "region": f.region,
        "embryologist": f.embryologist, "test": f.test, "month": f.month, "age": f.age, "embryos": f.embryos or [],
        "consent": f.consent, "contactName": f.contact_name, "contactDetail": f.contact_detail, "expectedPeriod": f.expected_period,
        "dueDate": f.due_date, "state": f.state, "note": f.note, "updatedBy": f.updated_by, "updatedAt": _iso_utc(f.updated_at),
        "createdAt": _iso_utc(f.created_at),
        "outcomes": [{"embryo": o.embryo_label, "status": _outcome_status(o.status), "date": o.event_date, "note": o.note, "tests": o.tests or {}, "by": o.updated_by, "at": _iso_utc(o.updated_at), "history": (hist or {}).get(o.embryo_label, [])} for o in outs],
    }

def _norm_name(v: str) -> str:
    return "".join(ch for ch in str(v or "").upper() if ch.isalnum())

def _embryologist_sees(db: Session, user: dict, f: Followup) -> bool:
    """An embryologist login sees only the follow-ups of their own embryos: TRFs they submitted, or patients whose
    Embryologist in the sheet is the name saved on their login (falls back to the username)."""
    if user.get("role") != "embryologist":
        return True
    uname = user.get("username") or ""
    if f.owner and f.owner == uname:
        return True
    u = db.query(User).filter(User.username == uname.lower()).first()
    if u and u.client_name and _norm_name(u.client_name) in _norm_name(f.clinic):
        return True
    mine = _norm_name((u.embryologist_name if u and u.embryologist_name else uname))
    theirs = _norm_name(f.embryologist)
    unmapped = not (u and (u.embryologist_name or u.client_name))
    if unmapped and mine and mine in _norm_name(f.clinic):
        return True
    return bool(mine and theirs and (mine == theirs or (unmapped and mine in theirs)))

# --- Embryos assigned to an embryologist (from the sample sheet) ---
# Same spelling-variant -> real-name map as EMBRYOLOGIST_ALIASES in frontend/app.js (keep the two in step).
_EMB_ALIASES = {'SINDHUJA': 'SINDHUJA N S', 'SINDHIYA': 'SINDHUJA N S', 'SINDHIYANS': 'SINDHUJA N S', 'SIADHUDA': 'SINDHUJA N S', 'DRNSSINDHUJA': 'SINDHUJA N S', 'SINOHUJANS': 'SINDHUJA N S', 'SINDHUJANS': 'SINDHUJA N S', 'CHITRAKAMBIR': 'CHITRA KAMBLE', 'SNEHAHALDARKAR': 'SNEHA HALDANKAR', 'SNEHAHALDAKAR': 'SNEHA HALDANKAR', 'HALDARKAR': 'SNEHA HALDANKAR', 'JAYARAMANR': 'JAYARAMAN', 'RJAYARAMAN': 'JAYARAMAN', 'RAJASHEKHARU': 'RAJASHEKAR U', 'RAJSHEKARU': 'RAJASHEKAR U', 'RAJASHEKAR': 'RAJASHEKAR U', 'RAJASHEKHAR': 'RAJASHEKAR U', 'RAJSHEKAR': 'RAJASHEKAR U', 'RAJSHEKHAR': 'RAJASHEKAR U', 'RAJASHEKHARV': 'RAJASHEKAR U', 'NISHANTHSINGH': 'NISHANTH SINGH', 'NISHNTHSINGH': 'NISHANTH SINGH', 'NISHANTH': 'NISHANTH SINGH', 'ARCHANAMANIKUE': 'ARCHANA MANIKERE', 'ARCHANAMANIKUR': 'ARCHANA MANIKERE', 'ARCHANAMARIKERE': 'ARCHANA MANIKERE', 'RAJPRIYAPANDIAN': 'RAJ PRIYA PANDIAN', 'RAJPRIYA': 'RAJ PRIYA PANDIAN', 'UDAYKIRAN': 'UDAY KIRAN', 'UDAYAKIRAN': 'UDAY KIRAN', 'UDHAYKIRAN': 'UDAY KIRAN', 'UADYAKIRAN': 'UDAY KIRAN', 'UDAYKIRAND': 'UDAY KIRAN', 'UDAYAKIRAND': 'UDAY KIRAN', 'TEJANISHUKLA': 'TEJASVI SHUKLA', 'TEJASISHUKLA': 'TEJASVI SHUKLA', 'TEJASSHUKLA': 'TEJASVI SHUKLA', 'TEJASWISHUKLA': 'TEJASVI SHUKLA', 'TEJASVISUKLA': 'TEJASVI SHUKLA', 'TEJASISURKCA': 'TEJASVI SHUKLA', 'VIDYALAKSHMIRBHAT': 'VIDYA LAKSHMI R BHAT', 'VIDHYALAKSHMIRBHAT': 'VIDYA LAKSHMI R BHAT', 'MADUSUDHAN': 'MADHUSUDHAN RAO', 'MADUSUDAN': 'MADHUSUDHAN RAO', 'MADUSUDANRAO': 'MADHUSUDHAN RAO', 'MADHUSUDHAN': 'MADHUSUDHAN RAO', 'MADHUSUDAN': 'MADHUSUDHAN RAO', 'MADHUSUDANRAO': 'MADHUSUDHAN RAO', 'MOHDABDAS': 'MOHD AQDAS', 'MOHDADDAS': 'MOHD AQDAS', 'MOHDABDOS': 'MOHD AQDAS'}
_MONTHS = {m: i + 1 for i, m in enumerate(["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"])}
_sheet_cache: dict = {"at": 0.0, "rows": []}

def _canon_embryologist(raw: str) -> str:
    n = _norm_name(raw)
    return _norm_name(_EMB_ALIASES.get(n, raw))

def _sheet_rows(db: Session) -> list:
    if time.time() - _sheet_cache["at"] > 60:
        row = db.get(KVStore, "embryomatrix-imported-cases")
        _sheet_cache["rows"] = [r for r in ((row.value if row else None) or []) if isinstance(r, dict) and not r.get("_stale")]
        _sheet_cache["at"] = time.time()
    return _sheet_cache["rows"]

def _field(r: dict, *names):
    for n in names:
        for k, v in r.items():
            if (k == n or n in k) and v not in (None, ""):
                return str(v).strip()
    return ""

def _embryo_labels(raw: str) -> list:
    parts = [x.strip() for x in re.split(r"[,;/]+", str(raw or "")) if x.strip()]
    if not parts:
        return []
    out, prefix0 = [], re.match(r"^[^0-9]*", parts[0]).group(0)
    for part in parts:
        nums = re.findall(r"\d+", part)
        if not nums:
            out.append(part)
            continue
        prefix = re.match(r"^[^0-9]*", part).group(0) or prefix0
        out.extend(f"{prefix}{n}" for n in nums)
    return list(dict.fromkeys(out))

def _embryo_result(r: dict, label: str) -> str:
    tag = "".join(ch for ch in label.upper() if ch.isalnum())
    d = (r.get("_embryoResults") or {}).get(tag)
    if not d:
        return "No result"
    text_ = f"{d.get('conclusion', '')} {d.get('pgt result', '')}".lower()
    if str(d.get("qc", "")).upper() == "FAIL" or "inconclusive" in text_ or "no dna" in text_:
        return "Inconclusive"
    concl = str(d.get("conclusion", "")).lower()
    if "no copy number" in concl:
        return "Euploid"
    if "mosaic" in text_:
        return "Mosaic"
    if "abnormal" in text_ or "aneuploid" in text_:
        return "Aneuploid"
    if "normal" in text_ or "euploid" in text_:
        return "Euploid"
    return "No result"

def _month_of(tab: str) -> str:
    m = re.match(r"^\s*([A-Za-z]{3})[A-Za-z]*\s+(\d{4})", str(tab or ""))
    return f"{m.group(2)}-{_MONTHS[m.group(1).upper()]:02d}" if m and m.group(1).upper() in _MONTHS else ""

def _sync_sheet_followups(db: Session, emb_name: str, client_name: str = "", loose: bool = False):
    """Make sure every patient listed under this embryologist in the sample sheet has a follow-up record."""
    want, want_client = _norm_name(emb_name), _norm_name(client_name)
    if not want and not want_client:
        return
    cases: dict = {}
    for r in _sheet_rows(db):
        canon = _canon_embryologist(_field(r, "embryologist name", "embryologist"))
        by_name = bool(want) and (canon == want or (loose and want in canon))
        by_client = bool(want_client) and want_client in _norm_name(_field(r, "center name", "hospital clinic name", "client"))
        if not (by_name or by_client):
            continue
        patient = _field(r, "patient name", "patient")
        cid = _field(r, "case id") or _field(r, "sample id", "sample no", "box number")
        if not patient or not cid or _norm_name(cid) in ("NA", "N", "NONE"):
            continue
        c = cases.setdefault((_norm_name(patient), _norm_name(cid)), {"key": cid, "patient": patient, "r": r, "embryos": {}})
        for lab in _embryo_labels(_field(r, "embryo name", "embryo id", "embryo")):
            c["embryos"].setdefault(lab, _embryo_result(r, lab))
    if not cases:
        return
    have = {k for (k,) in db.query(Followup.case_key).all()}
    due = datetime.utcnow().date().isoformat()  # needs filling in now
    added = 0
    for c in cases.values():
        if c["key"][:120] in have or not c["embryos"]:
            continue
        r = c["r"]
        db.add(Followup(case_key=c["key"][:120], source="sheet", patient=c["patient"][:255], clinic=_field(r, "center name", "hospital clinic name", "client")[:255],
                        region=_field(r, "location", "region")[:120], embryologist=(_field(r, "embryologist name", "embryologist") or emb_name)[:120], test=_field(r, "test name", "test")[:255],
                        month=_month_of(r.get("_importSource")), embryos=[{"label": k, "result": v} for k, v in c["embryos"].items()], consent="Yes",
                        due_date=due, updated_by="Sheet"))
        added += 1
    if added:
        db.commit()

@app.get("/api/followups")
def list_followups(request: Request, db: Session = Depends(get_db)):
    user = request.state.user or {}
    if user.get("role") == "embryologist":
        u = db.query(User).filter(User.username == (user.get("username") or "").lower()).first()
        if u:
            try:
                if u.embryologist_name or u.client_name:
                    _sync_sheet_followups(db, u.embryologist_name or "", u.client_name or "")
                else:  # no explicit link: the login name is matched against the sheet's Embryologist and centre names
                    _sync_sheet_followups(db, u.username, u.username, loose=True)
            except Exception as exc:
                db.rollback()
                print(f"Sheet follow-up sync failed for {u.username}: {exc}")
    outs: dict[str, list] = {}
    for o in db.query(EmbryoOutcome).all():
        outs.setdefault(o.case_key, []).append(o)
    hist: dict[str, dict] = {}
    for h in db.query(OutcomeHistory).order_by(OutcomeHistory.id).all():
        hist.setdefault(h.case_key, {}).setdefault(h.embryo_label, []).append(_hist_out(h))
    rows = [f for f in db.query(Followup).order_by(Followup.updated_at.desc()).all() if _embryologist_sees(db, user, f)]
    return {"statuses": list(OUTCOME_STATUSES), "items": [_fu_out(f, outs.get(f.case_key, []), hist.get(f.case_key)) for f in rows]}

@app.get("/api/embryologist-links")
def embryologist_links(request: Request, db: Session = Depends(get_db)):
    """Which sheet embryologist name each embryologist login sees the embryos of."""
    return [{"username": u.username, "name": u.embryologist_name or "", "client": u.client_name or ""} for u in db.query(User).filter(User.role == "embryologist").order_by(User.username).all()]

@app.post("/api/embryologist-links")
def set_embryologist_link(payload: dict, request: Request, db: Session = Depends(get_db)):
    u = db.query(User).filter(User.username == str(payload.get("username", "")).strip().lower(), User.role == "embryologist").first()
    if not u:
        raise HTTPException(404, "No such embryologist login")
    u.embryologist_name = str(payload.get("name", "")).strip()[:120] or None
    u.client_name = str(payload.get("client", "")).strip()[:120] or None
    db.commit()
    log_activity(db, "followup_save", f"Login {u.username} linked to embryologist '{u.embryologist_name or '—'}' / centre '{u.client_name or '—'}'", request=request)
    return {"username": u.username, "name": u.embryologist_name or "", "client": u.client_name or ""}

@app.post("/api/followups/bulk")
def bulk_followups(payload: dict, request: Request, db: Session = Depends(get_db)):
    """Team lead / admin: start follow-ups for many patients at once (e.g. every patient of one embryologist)."""
    user = request.state.user or {}
    s = lambda v, n=255: str(v or "").strip()[:n]
    made = skipped = 0
    for it in (payload.get("items") or [])[:2000]:
        if not isinstance(it, dict):
            continue
        key = s(it.get("caseKey"), 120)
        if not key or db.query(Followup.id).filter(Followup.case_key == key).first():
            skipped += 1
            continue
        d = it.get("followup") or {}
        emb = [{"label": s(e.get("label"), 80), "result": s(e.get("result"), 40)} for e in (d.get("embryos") or [])[:80] if isinstance(e, dict) and s(e.get("label"), 80)]
        due = s(d.get("dueDate"), 10)
        db.add(Followup(case_key=key, source="manual", patient=s(d.get("patient")), clinic=s(d.get("clinic")), region=s(d.get("region"), 120),
                        embryologist=s(d.get("embryologist"), 120), test=s(d.get("test")), month=s(d.get("month"), 20), embryos=emb,
                        consent="Yes", due_date=due if len(due) == 10 else None, updated_by=user.get("username") or ""))
        made += 1
    db.commit()
    log_activity(db, "followup_save", f"Started {made} follow-up(s) from the sheet ({skipped} already existed)", request=request)
    return {"created": made, "skipped": skipped}

@app.post("/api/followups/save")
def save_followup(payload: dict, request: Request, db: Session = Depends(get_db)):
    """Create or update one follow-up record and its per-embryo outcomes in one call. An embryologist may only update
    records that already exist (they come from submitted TRFs or are started by a team lead / admin)."""
    user = request.state.user or {}
    s = lambda v, n=255: str(v or "").strip()[:n]
    key = s(payload.get("caseKey"), 120)
    if not key:
        raise HTTPException(422, "caseKey is required")
    f = db.query(Followup).filter(Followup.case_key == key).first()
    if f and not _embryologist_sees(db, user, f):
        raise HTTPException(403, "This follow-up belongs to another embryologist")
    if not f:
        if user.get("role") == "embryologist":
            raise HTTPException(403, "Only a team lead or admin can start a follow-up")
        f = Followup(case_key=key, source="manual")
        db.add(f)
    meta = payload.get("followup") or {}
    for attr, k, n in (("patient", "patient", 255), ("clinic", "clinic", 255), ("region", "region", 120), ("embryologist", "embryologist", 120),
                       ("test", "test", 255), ("month", "month", 20), ("contact_name", "contactName", 255), ("contact_detail", "contactDetail", 255),
                       ("expected_period", "expectedPeriod", 60)):
        if k in meta:
            setattr(f, attr, s(meta[k], n))
    if "consent" in meta and meta["consent"] in ("Yes", "No"):
        f.consent = meta["consent"]
    if "age" in meta:
        try:
            a = int(meta["age"]); f.age = a if 10 <= a <= 80 else None
        except (TypeError, ValueError):
            f.age = None
    if "embryos" in meta and isinstance(meta["embryos"], list):
        f.embryos = [{"label": s(e.get("label"), 80), "result": s(e.get("result"), 40)} for e in meta["embryos"][:80] if isinstance(e, dict) and s(e.get("label"), 80)]
    if "dueDate" in meta:
        d = s(meta["dueDate"], 10)
        f.due_date = d if len(d) == 10 else None
    if "state" in meta:
        if meta["state"] not in FOLLOWUP_STATES:
            raise HTTPException(422, "Unknown state")
        f.state = meta["state"]
    if "note" in meta:
        f.note = s(meta["note"], 2000)
    f.updated_at, f.updated_by = datetime.utcnow(), user.get("username") or ""
    changes = []
    for o in payload.get("outcomes") or []:
        if not isinstance(o, dict):
            continue
        label, status = s(o.get("embryo"), 80), _outcome_status(s(o.get("status"), 40))
        if not label or (status and status not in OUTCOME_STATUSES):
            continue
        row = db.query(EmbryoOutcome).filter(EmbryoOutcome.case_key == key, EmbryoOutcome.embryo_label == label).first()
        date = s(o.get("date"), 10)
        date = date if len(date) == 10 else None
        tests = _clean_further_tests(o.get("tests"))
        if not status and not tests and not row:
            continue
        if not row:
            row = EmbryoOutcome(case_key=key, embryo_label=label); db.add(row)
        new_note = s(o.get("note"), 1000)
        new_tests = tests if "tests" in o else (row.tests or {})
        prev = (row.status or "", row.event_date or None, row.note or "", row.tests or {})
        if row.status != status:
            changes.append(f"{label}: {row.status or '—'} → {status or '—'}")
        if prev != (status, date, new_note, new_tests):
            db.add(OutcomeHistory(case_key=key, embryo_label=label, status=status, previous_status=prev[0], event_date=date, note=new_note,
                                  tests=new_tests, changed_by=user.get("username") or ""))
        row.status, row.event_date, row.note = status, date, new_note
        if "tests" in o:
            row.tests = tests
        row.updated_at, row.updated_by = datetime.utcnow(), user.get("username") or ""
    db.commit()
    log_activity(db, "followup_save", f"{f.patient or key} · " + ("; ".join(changes) if changes else (f.state or "details updated")), request=request)
    outs = db.query(EmbryoOutcome).filter(EmbryoOutcome.case_key == key).all()
    hist: dict = {}
    for h in db.query(OutcomeHistory).filter(OutcomeHistory.case_key == key).order_by(OutcomeHistory.id).all():
        hist.setdefault(h.embryo_label, []).append(_hist_out(h))
    return _fu_out(f, outs, hist)

@app.get("/api/trf-files")
def list_trf_files_for_sync(since_id: int = 0, db: Session = Depends(get_db)):
    """For the lab-PC sync script: submitted TRFs that have a generated PDF,
    plus enough to route it - the linked case (if any) and that case's
    assigned run. No Aadhaar/DOB/address fields here, unlike /api/trf."""
    q = db.query(TrfSubmission).filter(TrfSubmission.pdf_file_path.isnot(None))
    if since_id:
        q = q.filter(TrfSubmission.id > since_id)
    rows = q.order_by(TrfSubmission.id).all()
    case_codes = {r.case_code for r in rows if r.case_code}
    run_by_case = dict(
        db.query(CaseRunAssignment.case_code, CaseRunAssignment.run_id)
        .filter(CaseRunAssignment.case_code.in_(case_codes)).all()
    ) if case_codes else {}
    pl = Placement(db)
    def trf_path(r):
        if r.case_code:
            return f"{pl.case_folder(r.case_code)}/TRF.pdf"
        return f"TRFS/{_safe_name(f'{r.ref}_{r.patient_name}')}.pdf"
    return [{
        "id": r.id, "ref": r.ref, "patient": r.patient_name, "caseCode": r.case_code,
        "runId": run_by_case.get(r.case_code) if r.case_code else None,
        "url": f"/uploads/{r.pdf_file_path}", "relPath": trf_path(r),
    } for r in rows]

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
    return result

@app.post("/api/log-export")
def log_export(payload: KVValue, request: Request, db: Session = Depends(get_db)):
    name = str((payload.value or {}).get("file", ""))[:200] if isinstance(payload.value, dict) else ""
    log_activity(db, "export", name or "Data export", request=request)
    return {"ok": True}

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

_background_tasks: set = set()  # keep a reference so the sync task is not garbage-collected

@app.on_event("startup")
async def _startup_sheet_sync():
    sources = parse_sources(settings.sheet_sources)
    if not sources:
        return
    # Run the first sync in the background: awaiting it here held up startup, so the
    # server answered nothing (the tunnel showed 502) until every workbook was fetched.
    async def first_then_periodic():
        db = SessionLocal()
        try:
            await asyncio.to_thread(sync_sources, db, sources)
        except Exception:
            pass
        finally:
            db.close()
        await _background_sheet_sync()
    _background_tasks.add(asyncio.create_task(first_then_periodic()))
