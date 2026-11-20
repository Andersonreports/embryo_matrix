"""Interim built-in login (BUILTIN_LOGIN=true). Passwords are stored as scrypt hashes in the
existing `users` table; a signed cookie carries the session. When the app moves behind the
company's own login, set BUILTIN_LOGIN=false and the X-Auth-User / X-Auth-Role headers apply again."""
import base64, hashlib, hmac, json, os, secrets, time
from pathlib import Path

from .config import BACKEND_DIR

COOKIE = "em_session"
SESSION_SECONDS = 12 * 3600
_SECRET_FILE = Path(BACKEND_DIR) / ".session_secret"

def _secret() -> bytes:
    if not _SECRET_FILE.exists():
        _SECRET_FILE.write_text(secrets.token_hex(32))
        os.chmod(_SECRET_FILE, 0o600)
    return _SECRET_FILE.read_text().strip().encode()

def hash_password(pw: str) -> str:
    salt = os.urandom(16)
    h = hashlib.scrypt(pw.encode(), salt=salt, n=2**14, r=8, p=1)
    return f"scrypt${salt.hex()}${h.hex()}"

def verify_password(pw: str, stored: str) -> bool:
    try:
        _, salt, h = stored.split("$")
        got = hashlib.scrypt(pw.encode(), salt=bytes.fromhex(salt), n=2**14, r=8, p=1)
        return hmac.compare_digest(got.hex(), h)
    except Exception:
        return False

def make_token(username: str, role: str, email: str = "") -> str:
    # email is part of the login identity (usernames are not unique on their own), so it is carried
    # in the session and used to resolve the exact account on each request.
    body = base64.urlsafe_b64encode(json.dumps({"u": username, "r": role, "e": email, "exp": int(time.time()) + SESSION_SECONDS}).encode()).decode()
    return f"{body}.{hmac.new(_secret(), body.encode(), hashlib.sha256).hexdigest()}"

def read_token(token: str) -> dict | None:
    try:
        body, sig = token.rsplit(".", 1)
        if not hmac.compare_digest(hmac.new(_secret(), body.encode(), hashlib.sha256).hexdigest(), sig):
            return None
        d = json.loads(base64.urlsafe_b64decode(body))
        return {"username": d["u"], "role": d["r"], "email": d.get("e", "")} if d["exp"] > time.time() else None
    except Exception:
        return None


# ---------------------------------------------------------------------------
# Two-factor (email OTP). After a correct email+password the session is NOT issued
# yet: a short-lived pending record holds the account, and a 6-digit code is emailed.
# The browser carries an opaque pending key in the PENDING cookie; the real session
# cookie is only set once that code is verified. Kept in memory like the login-fail
# counters (single process); a restart just means the user signs in again.
# ---------------------------------------------------------------------------
PENDING = "em_2fa"
OTP_SECONDS = 10 * 60
OTP_MAX_ATTEMPTS = 5          # wrong-code tries before the pending record is burned
OTP_MAX_SENDS = 4            # initial send + resends, per pending record
_pending: dict[str, dict] = {}

def _prune_pending() -> None:
    now = time.time()
    for k in [k for k, v in _pending.items() if v["exp"] <= now]:
        _pending.pop(k, None)

def _hash_code(key: str, code: str) -> str:
    return hmac.new(_secret(), f"{key}:{code}".encode(), hashlib.sha256).hexdigest()

def new_code() -> str:
    return f"{secrets.randbelow(1_000_000):06d}"

def start_pending(username: str, role: str, email: str) -> tuple[str, str]:
    """Open a pending-2FA record and return (pending_key, code). Caller emails the code."""
    _prune_pending()
    key = secrets.token_urlsafe(24)
    code = new_code()
    _pending[key] = {"u": username, "r": role, "email": email,
                     "code": _hash_code(key, code), "exp": time.time() + OTP_SECONDS,
                     "attempts": 0, "sends": 1}
    return key, code

def peek_pending(key: str) -> dict | None:
    _prune_pending()
    v = _pending.get(key or "")
    if not v or v["exp"] <= time.time():
        return None
    return {"username": v["u"], "role": v["r"], "email": v["email"]}

def rotate_code(key: str) -> str | None:
    """Issue a fresh code for a resend. None if the record is gone or the resend cap is hit."""
    _prune_pending()
    v = _pending.get(key or "")
    if not v or v["exp"] <= time.time() or v["sends"] >= OTP_MAX_SENDS:
        return None
    code = new_code()
    v["code"] = _hash_code(key, code)
    v["attempts"] = 0
    v["sends"] += 1
    v["exp"] = time.time() + OTP_SECONDS
    return code

def verify_pending(key: str, code: str) -> dict | None:
    """Check a code. On success burn the record and return {username, role}. On failure
    count the attempt and burn the record once attempts run out."""
    _prune_pending()
    v = _pending.get(key or "")
    if not v or v["exp"] <= time.time():
        return None
    if hmac.compare_digest(v["code"], _hash_code(key, str(code or "").strip())):
        _pending.pop(key, None)
        return {"username": v["u"], "role": v["r"], "email": v["email"]}
    v["attempts"] += 1
    if v["attempts"] >= OTP_MAX_ATTEMPTS:
        _pending.pop(key, None)
    return None

def drop_pending(key: str) -> None:
    _pending.pop(key or "", None)
