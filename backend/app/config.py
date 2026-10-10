from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict

# backend/ — anchor the DB and .env here so they resolve the same whatever
# directory the server is launched from.
BACKEND_DIR = Path(__file__).resolve().parent.parent
# databases/ at the project root holds everything the server writes at run time: the SQLite database, its backups and the uploaded
# files. A server that still has them in the old place (backend/) keeps using that until they are moved.
DB_DIR = BACKEND_DIR.parent / "databases"
_pick = lambda new, old: new if new.exists() or not old.exists() else old

class Settings(BaseSettings):
    app_name: str = "Embryo Matrix"
    database_url: str = f"sqlite:///{_pick(DB_DIR / 'embryomatrix.db', BACKEND_DIR / 'embryomatrix.db').as_posix()}"
    uploads_dir: Path = _pick(DB_DIR / "uploads", BACKEND_DIR / "app" / "uploads")
    # Pipe-separated Google Sheet IDs. Each must be shared as "Anyone with the
    # link – Viewer" so the export endpoint is readable without auth. Every tab
    # in the spreadsheet is fetched automatically, so new tabs (e.g. next
    # month's) need no config change here.
    # Pipe-separated Google Sheet IDs; set SHEET_SOURCES in .env (kept out of git, since the sheets are link-readable).
    sheet_sources: str = ""
    sheet_sync_minutes: int = 10
    # Optional: URL of the Apps Script web app deployment in apps_script/Code.gs
    # (ends in /exec). When set, sheet_sync fetches through it instead of the
    # public xlsx export URL above — works even if the sheets aren't shared
    # "Anyone with the link", which matters once this app is on a shared
    # server/domain. Leave blank to keep using the xlsx export.
    sheet_api_url: str = ""
    sheet_api_token: str = ""
    # Key for image_sync/sync-images.ps1 (runs on the lab's storage PC and
    # pulls new embryo images down). It can only list images. Blank = disabled.
    image_sync_token: str = ""
    # Repair day/month-swapped dates in the dashboard's copy of the sheet rows (never written back to the Google Sheet).
    # Off until the dry-run report has been checked: set DATE_FIX_ENABLED=true in .env.
    date_fix_enabled: bool = False
    # Interim built-in login (users table + signed cookie). Off = trust X-Auth-User/X-Auth-Role from a proxy.
    builtin_login: bool = False
    # Where the "Edits sheet" button in the registry opens. Blank = the sheet the Apps Script created. Kept in .env (not in git: the sheet is link-readable).
    edits_sheet_url: str = ""
    # Outgoing email (TRF approved / not approved notices to the client). Blank SMTP_HOST = email off.
    smtp_host: str = ""
    smtp_port: int = 587
    smtp_user: str = ""
    smtp_password: str = ""
    smtp_security: str = "starttls"  # starttls | ssl | none
    smtp_from: str = ""
    smtp_from_name: str = "Anderson Diagnostics & Labs"
    model_config = SettingsConfigDict(env_file=BACKEND_DIR / ".env", extra="ignore")

settings = Settings()
