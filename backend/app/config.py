from pathlib import Path

from urllib.parse import quote_plus

from pydantic import model_validator
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
    # Auto-clear the app's own activity_log: rows older than this many days are pruned daily, so the
    # table can't grow without bound. ONLY touches this app's activity_log table - no other server
    # logs. Set ACTIVITY_LOG_RETENTION_DAYS=0 in .env to turn the auto-clear off.
    activity_log_retention_days: int = 7
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
    # Logins live in two separate databases: client logins in PostgreSQL, team (staff) logins in MySQL.
    # Leave a URL blank to fall back to a local SQLite file (databases/user_clients.db / user_team.db),
    # so the split runs before the real servers are wired. Real values go in .env, e.g.
    #   CLIENTS_DB_URL=postgresql+psycopg://user:pass@host:5432/clients
    #   TEAM_DB_URL=mysql+pymysql://user:pass@host:3306/team
    clients_db_url: str = ""
    team_db_url: str = ""
    # Convenience alternative to writing TEAM_DB_URL by hand: give the MySQL parts separately and the
    # URL is assembled for you (user/password are URL-escaped, so special characters are safe). Used
    # only when TEAM_DB_URL is left blank. The same can be done for the client (PostgreSQL) side via
    # PG_* below.
    mysql_host: str = ""
    mysql_port: int = 3306
    mysql_user: str = ""
    mysql_password: str = ""
    mysql_database: str = ""
    # Same idea for the client (PostgreSQL) store; used only when CLIENTS_DB_URL is blank.
    pg_host: str = ""
    pg_port: int = 5432
    pg_user: str = ""
    pg_password: str = ""
    pg_database: str = ""
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
    # IT's genetics integration service (integration_client.py). The whole integration stays inert
    # until INTEGRATION_ENABLED=true AND credentials are set, so nothing changes about the live
    # Google-Sheet flows until auth is wired. Auth works exactly like the Report-Automation project
    # against the same service: the client POSTs INTEGRATION_USERNAME/PASSWORD to /auth/login to mint
    # a short-lived JWT, caches it, and re-mints ~30s before it expires (and once on any 401). The
    # same service account that Report-Automation uses authorises this app too (same service/org).
    # INTEGRATION_TOKEN is an optional static override: if set, it's sent as-is with no refresh.
    integration_base_url: str = "https://integration.andrsn.in"
    integration_username: str = ""
    integration_password: str = ""
    integration_token: str = ""
    integration_enabled: bool = False
    model_config = SettingsConfigDict(env_file=BACKEND_DIR / ".env", extra="ignore")

    @model_validator(mode="after")
    def _assemble_db_urls(self):
        # Build TEAM_DB_URL / CLIENTS_DB_URL from the discrete parts when the full URL wasn't given.
        if not self.team_db_url and self.mysql_host and self.mysql_user and self.mysql_database:
            self.team_db_url = (
                f"mysql+pymysql://{quote_plus(self.mysql_user)}:{quote_plus(self.mysql_password)}"
                f"@{self.mysql_host}:{self.mysql_port}/{self.mysql_database}"
            )
        if not self.clients_db_url and self.pg_host and self.pg_user and self.pg_database:
            self.clients_db_url = (
                f"postgresql+psycopg://{quote_plus(self.pg_user)}:{quote_plus(self.pg_password)}"
                f"@{self.pg_host}:{self.pg_port}/{self.pg_database}"
            )
        return self

settings = Settings()
