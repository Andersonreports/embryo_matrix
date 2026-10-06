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

def make_token(username: str, role: str) -> str:
    body = base64.urlsafe_b64encode(json.dumps({"u": username, "r": role, "exp": int(time.time()) + SESSION_SECONDS}).encode()).decode()
    return f"{body}.{hmac.new(_secret(), body.encode(), hashlib.sha256).hexdigest()}"

def read_token(token: str) -> dict | None:
    try:
        body, sig = token.rsplit(".", 1)
        if not hmac.compare_digest(hmac.new(_secret(), body.encode(), hashlib.sha256).hexdigest(), sig):
            return None
        d = json.loads(base64.urlsafe_b64decode(body))
        return {"username": d["u"], "role": d["r"]} if d["exp"] > time.time() else None
    except Exception:
        return None
