from pydantic_settings import BaseSettings, SettingsConfigDict

class Settings(BaseSettings):
    app_name: str = "Embryo Matrix"
    database_url: str = "sqlite:///./embryomatrix.db"
    secret_key: str = "change-me"
    access_token_minutes: int = 60 * 24 * 14  # 14 days — a shared-password lab tool shouldn't force frequent re-logins
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
    # Two fixed logins (no user table yet). Set these in .env — an account whose
    # username or password is blank cannot sign in. *_name is the display name
    # shown in the header pill (falls back to the username).
    admin_username: str = ""
    admin_password: str = ""
    admin_name: str = ""
    embryologist_username: str = ""
    embryologist_password: str = ""
    embryologist_name: str = ""
    # Key for image_sync/sync-images.ps1 (runs on the lab's storage PC and
    # pulls new embryo images down). It can only list images. Blank = disabled.
    image_sync_token: str = ""
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

settings = Settings()
