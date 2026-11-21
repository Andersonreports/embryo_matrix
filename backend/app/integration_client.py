"""Client for the IT team's genetics integration service (https://integration.andrsn.in).

IT built these endpoints to the requirements we gave them; this module is the one place the rest of
the app calls them. It mirrors the EmbryoMatrix.postman_collection.json IT supplied: 14 endpoints
under /genetics/* plus /report/get_genetics_file_viewer.

DORMANT UNTIL CONFIGURED. The whole integration is inert unless INTEGRATION_ENABLED=true AND auth is
set in backend/.env (service credentials, or a static token). Until then configured() is False, every
wiring point skips the call, and nothing about the existing Google-Sheet flows changes - the lab runs
on the Google Sheet until the database conversion lands.

AUTH (resolved - mirrors the Report-Automation project, which runs live against this same service).
The Authorization header is "Bearer <token>". The token is a short-lived (~15-min) JWT, so it is not
copied in statically; instead the client mints it:
  * _fetch_service_token() POSTs {"username","password"} (INTEGRATION_USERNAME / INTEGRATION_PASSWORD)
    to /auth/login and reads the JWT from the response's "token" field (falls back to "access_token"
    / data.token).
  * _bearer_token() caches that JWT and re-mints it ~30s before its "exp", so "calling the API again
    refreshes it" happens automatically; _request() also force-refreshes once on any 401 and retries.
The same service account Report-Automation uses authorises this app too (same service, same org).
INTEGRATION_TOKEN stays as an optional static override: if set it is sent as-is with no refresh.

Outbound HTTP uses the stdlib urllib, the same as edits_sheet.py / sheet_sync.py (no new dependency).
Every call is best-effort at the wiring points: failures are raised here and swallowed/logged by the
caller so a down integration never breaks a user action.
"""
from __future__ import annotations

import base64
import json
import logging
import threading
import time
import urllib.error
import urllib.parse
import urllib.request

from .config import settings

log = logging.getLogger(__name__)

TIMEOUT = 25
USER_AGENT = "EmbryoMatrix-Integration/1.0"
# Service-auth endpoint (same as Report-Automation; not one of the 14 /genetics endpoints).
AUTH_LOGIN_PATH = "/auth/login"


class IntegrationError(RuntimeError):
    """Any failure talking to the integration service (not configured, HTTP error, bad JSON)."""


# ---------------------------------------------------------------------------
# Configuration / auth
# ---------------------------------------------------------------------------

def _has_auth() -> bool:
    return bool(settings.integration_token.strip()
                or (settings.integration_username and settings.integration_password))


def configured() -> bool:
    """True only when the integration is switched on and has a way to authenticate (service credentials
    or a static token) and a base URL. Every wiring point checks this first, so the integration is
    completely inert until auth is set in .env."""
    return bool(settings.integration_enabled and settings.integration_base_url and _has_auth())


# --- Service token: mint via /auth/login, cache, auto-refresh (mirrors Report-Automation) ----------

_token_lock = threading.Lock()
_token: str | None = None
_token_expiry: float = 0.0


def _decode_jwt_exp(token: str):
    """Read the 'exp' (unix seconds) out of a JWT payload without verifying the signature. None if
    the token isn't a decodable JWT - the caller then falls back to a conservative fixed lifetime."""
    try:
        payload_b64 = token.split(".")[1]
        payload_b64 += "=" * (-len(payload_b64) % 4)
        payload = json.loads(base64.urlsafe_b64decode(payload_b64))
        return float(payload["exp"])
    except Exception:
        return None


def _fetch_service_token() -> str:
    """POST the service credentials to /auth/login and return the minted JWT. Raises IntegrationError."""
    if not (settings.integration_username and settings.integration_password):
        raise IntegrationError("Integration credentials are not set (INTEGRATION_USERNAME / INTEGRATION_PASSWORD in backend/.env)")
    url = _url(AUTH_LOGIN_PATH)
    data = json.dumps({"username": settings.integration_username,
                       "password": settings.integration_password}).encode("utf-8")
    req = urllib.request.Request(url, data=data,
                                 headers={"Content-Type": "application/json", "User-Agent": USER_AGENT},
                                 method="POST")
    try:
        with urllib.request.urlopen(req, timeout=TIMEOUT) as resp:
            payload = json.loads(resp.read().decode("utf-8"))
    except urllib.error.HTTPError as ex:
        raise IntegrationError(_http_detail("POST", AUTH_LOGIN_PATH, ex))
    except OSError as ex:  # URLError, socket timeout, other connectivity errors
        raise IntegrationError(f"auth/login -> could not reach integration service: {_conn_reason(ex)}")
    except ValueError:
        raise IntegrationError("auth/login -> response was not JSON")
    token = payload.get("token") or payload.get("access_token") or (payload.get("data") or {}).get("token")
    if not token:
        raise IntegrationError(f"auth/login response had no token field (keys: {list(payload.keys())})")
    return token


def _bearer_token(force_refresh: bool = False) -> str:
    """The token for the Authorization header. A static INTEGRATION_TOKEN wins and is sent as-is;
    otherwise a service JWT is minted on first use, cached, and re-minted ~30s before it expires
    (or when force_refresh is set, e.g. after a 401)."""
    static = settings.integration_token.strip()
    if static:
        return static
    global _token, _token_expiry
    with _token_lock:
        if force_refresh or _token is None or time.time() >= _token_expiry:
            _token = _fetch_service_token()
            exp = _decode_jwt_exp(_token)
            # Refresh 30s early; if exp couldn't be read, assume a conservative 13-minute life.
            _token_expiry = (exp - 30) if exp else (time.time() + 13 * 60)
        return _token


def _url(path: str, params: dict | None = None) -> str:
    base = settings.integration_base_url.rstrip("/")
    url = f"{base}/{path.lstrip('/')}"
    if params:
        clean = {k: v for k, v in params.items() if v is not None}
        if clean:
            url = f"{url}?{urllib.parse.urlencode(clean)}"
    return url


def _http_detail(method: str, path: str, ex: urllib.error.HTTPError) -> str:
    detail = ""
    try:
        detail = ex.read().decode("utf-8", "replace")[:500]
    except Exception:
        pass
    return f"{method} {path} -> HTTP {ex.code} {ex.reason} {detail}".strip()


def _conn_reason(ex: Exception) -> str:
    """Human-readable cause for a connectivity failure. Covers URLError (.reason), socket read
    timeouts (TimeoutError) and any other OSError, which urllib may let through unwrapped."""
    return str(getattr(ex, "reason", None) or ex) or ex.__class__.__name__


def _send(method: str, url: str, data: bytes | None, token: str):
    """One raw HTTP call with the given bearer token. Returns (body_bytes, content_type) or lets the
    urllib error propagate so the caller can decide whether to refresh-and-retry."""
    headers = {"Authorization": f"Bearer {token}", "User-Agent": USER_AGENT}
    if data is not None:
        headers["Content-Type"] = "application/json"
    req = urllib.request.Request(url, data=data, headers=headers, method=method.upper())
    with urllib.request.urlopen(req, timeout=TIMEOUT) as resp:
        return resp.read(), resp.headers.get("Content-Type", "")


def _request(method: str, path: str, *, json_body: dict | None = None, params: dict | None = None,
             expect_json: bool = True):
    """Make one call to the integration service. Returns parsed JSON (expect_json) or (bytes, content_type).
    Raises IntegrationError on any problem. Does NOT check configured() - callers that run unconditionally
    (the proxy routes) surface a clear 'not configured' error; best-effort callers guard with configured().
    On a 401 with a minted (non-static) token the token is force-refreshed and the call retried once."""
    if not (settings.integration_base_url and _has_auth()):
        raise IntegrationError("Integration service is not configured (set INTEGRATION_BASE_URL and either "
                               "INTEGRATION_USERNAME/INTEGRATION_PASSWORD or INTEGRATION_TOKEN in backend/.env)")
    url = _url(path, params)
    data = json.dumps(json_body).encode("utf-8") if json_body is not None else None
    can_refresh = not settings.integration_token.strip()  # only minted tokens can be refreshed
    try:
        body, ctype = _send(method, url, data, _bearer_token())
    except urllib.error.HTTPError as ex:
        if ex.code == 401 and can_refresh:
            try:
                body, ctype = _send(method, url, data, _bearer_token(force_refresh=True))
            except urllib.error.HTTPError as ex2:
                raise IntegrationError(_http_detail(method, path, ex2))
            except OSError as ex2:  # URLError, socket timeout, other connectivity errors
                raise IntegrationError(f"{method} {path} -> could not reach integration service: {_conn_reason(ex2)}")
        else:
            raise IntegrationError(_http_detail(method, path, ex))
    except OSError as ex:  # URLError (incl. its .reason), TimeoutError, other connectivity errors
        raise IntegrationError(f"{method} {path} -> could not reach integration service: {_conn_reason(ex)}")
    if not expect_json:
        return body, ctype
    try:
        return json.loads(body.decode("utf-8"))
    except ValueError:
        raise IntegrationError(f"{method} {path} -> expected JSON, got {ctype or 'unknown content'}")


# ---------------------------------------------------------------------------
# Small value helpers for building payloads
# ---------------------------------------------------------------------------

def _s(v) -> str:
    return "" if v is None else str(v).strip()


def _maybe_int(v):
    """IT sends ids/pool/index as integers in the sample payloads; coerce when the value is a plain
    integer string, otherwise pass the string through unchanged (never lose the original value)."""
    s = _s(v)
    if s.isdigit():
        return int(s)
    try:
        f = float(s)
        return int(f) if f.is_integer() else s
    except (TypeError, ValueError):
        return s


def _dt(v) -> str:
    """Normalise 'YYYY-MM-DD HH:MM' to 'YYYY-MM-DD HH:MM:SS' (IT's created_at/last_updated_at shape).
    Leaves anything else untouched."""
    s = _s(v)
    if len(s) == 16 and s[4] == "-" and s[13] == ":":
        return s + ":00"
    return s


# ===========================================================================
# 1. Report file viewer  - /report/get_genetics_file_viewer
# ===========================================================================

def get_genetics_file_viewer(file: str):
    """Fetch a genetics file (e.g. a report PDF) by its storage path. Returns (bytes, content_type)."""
    return _request("POST", "/report/get_genetics_file_viewer", params={"file": file}, expect_json=False)


# ===========================================================================
# 2/3. Push batch + sequence sample rows
# ===========================================================================

def add_batch_data(wga_batch_data: dict) -> dict:
    """Push one WGA batch sample row. wga_batch_data is a single flat record (see wga_sample_payload)."""
    return _request("POST", "/genetics/add_batch_data", json_body={"wga_batch_data": wga_batch_data})


def add_sequence_data(sequence_batch_data: dict) -> dict:
    """Push one sequencing sample row. sequence_batch_data is a single flat record (see seq_sample_payload)."""
    return _request("POST", "/genetics/add_sequence_data", json_body={"sequence_batch_data": sequence_batch_data})


# ===========================================================================
# 4..7. Reads: batches / sequence / NIPGS samples pending wga or sequence
# ===========================================================================

def get_batches_data() -> dict:
    return _request("GET", "/genetics/get_batches_data")


def get_sequence_data() -> dict:
    return _request("GET", "/genetics/get_sequence_data")


def get_nipgs_sample_data_without_wga(username: str, email: str, client_name: str) -> dict:
    # IT's path keeps their spelling "nigps".
    return _request("POST", "/genetics/get_nigps_sample_data_without_wga",
                    json_body={"username": _s(username), "email": _s(email), "client_name": _s(client_name)})


def get_nipgs_sample_data_without_sequence(username: str, email: str, client_name: str) -> dict:
    return _request("POST", "/genetics/get_nigps_sample_data_without_sequence",
                    json_body={"username": _s(username), "email": _s(email), "client_name": _s(client_name)})


# ===========================================================================
# 8..11. Users
# ===========================================================================

def insert_user(embryo_matrix_data: dict) -> dict:
    return _request("POST", "/genetics/insert_user", json_body={"embryo_matrix_data": embryo_matrix_data})


def update_user(embryo_matrix_data: dict) -> dict:
    return _request("POST", "/genetics/update_user", json_body={"embryo_matrix_data": embryo_matrix_data})


def get_embryo_matrix_users_list() -> dict:
    return _request("GET", "/genetics/get_embryo_matrix_users_list")


def get_embryologist_data(username: str = "", email: str = "", client_name: str = "") -> dict:
    # IT's collection sends this as a GET carrying a JSON body (disableBodyPruning). urllib lets us
    # attach a body to a GET, which matches the collection exactly.
    body = {"username": _s(username), "email": _s(email), "client_name": _s(client_name)}
    return _request("GET", "/genetics/get_embryologist_data", json_body=body)


# ===========================================================================
# 12..14. Auth (IT-side login + email OTP)
# ===========================================================================

def login_user(username: str, email: str, password: str) -> dict:
    return _request("POST", "/genetics/login_user",
                    json_body={"username": _s(username), "email": _s(email), "password": password})


def verify_user(username: str, email: str) -> dict:
    return _request("POST", "/genetics/verify_user",
                    json_body={"username": _s(username), "email": _s(email)})


def verify_otp_user(username: str, email: str, otp: str, hash: str) -> dict:
    return _request("POST", "/genetics/verify_otp_user",
                    json_body={"username": _s(username), "email": _s(email), "otp": _s(otp), "hash": hash})


# ---------------------------------------------------------------------------
# Client login orchestration (IT handles password check + OTP send/verify).
# NOTE: IT returned no response examples, so the parsing below is tolerant and MUST be checked against
# a real response during testing. _request already raises IntegrationError on any non-2xx, so reaching
# here means HTTP 2xx; we then look for a logical failure flag in the body.
# ---------------------------------------------------------------------------

_FAIL_WORDS = ("invalid", "wrong", "incorrect", "fail", "expire", "not found", "no user",
               "mismatch", "does not", "unauthor", "denied")


def _it_message(resp) -> str:
    if isinstance(resp, dict):
        return str(resp.get("message") or resp.get("error") or "")
    return ""


def _it_rejected(resp) -> bool:
    """True when a 2xx body still signals a logical failure (bad password / wrong OTP)."""
    if not isinstance(resp, dict):
        return False  # a bare 2xx with no/odd body -> treat as success
    for k in ("success", "ok", "status"):
        if k in resp and isinstance(resp[k], bool):
            return not resp[k]
    if "success" in resp and str(resp["success"]).strip().lower() in ("false", "0", "no"):
        return True
    msg = _it_message(resp).lower()
    return bool(msg) and any(w in msg for w in _FAIL_WORDS)


def _it_hash(resp) -> str:
    """Pull IT's OTP hash out of a login/verify response (several possible shapes)."""
    if not isinstance(resp, dict):
        return ""
    if resp.get("hash"):
        return str(resp["hash"])
    d = resp.get("data")
    if isinstance(d, str):
        return d
    if isinstance(d, dict) and d.get("hash"):
        return str(d["hash"])
    return ""


def client_login_start(username: str, email: str, password: str) -> tuple[bool, str, str]:
    """Check a client's password via login_user and make sure an OTP is sent, returning its hash.
    Returns (ok, otp_hash, message). ok=False => bad credentials. Raises IntegrationError on transport
    failure. If login_user doesn't itself return a hash, verify_user is called to send the OTP."""
    resp = login_user(username, email, password)
    if _it_rejected(resp):
        return False, "", _it_message(resp) or "Wrong username, email or password"
    h = _it_hash(resp)
    if not h:
        vresp = verify_user(username, email)
        if _it_rejected(vresp):
            return False, "", _it_message(vresp) or "Could not start verification"
        h = _it_hash(vresp)
    return True, h, ""


def client_otp_resend(username: str, email: str) -> str:
    """Ask IT to send a fresh OTP; returns the new hash ("" on failure). Raises on transport failure."""
    vresp = verify_user(username, email)
    return "" if _it_rejected(vresp) else _it_hash(vresp)


def client_otp_verify(username: str, email: str, code: str, hash: str) -> bool:
    """Verify a client's OTP via verify_otp_user. Raises IntegrationError on transport failure."""
    return not _it_rejected(verify_otp_user(username, email, code, hash))


def user_records(resp) -> list[dict]:
    """Best-effort: pull a list of user dicts out of a get_embryo_matrix_users_list / get_embryologist_data
    response. Tolerant of several shapes (list, {data:[...]}, {users:[...]}, a single record) - tune once
    IT's real response is seen."""
    if isinstance(resp, list):
        return [r for r in resp if isinstance(r, dict)]
    if isinstance(resp, dict):
        for key in ("data", "users", "result", "rows", "records"):
            v = resp.get(key)
            if isinstance(v, list):
                return [r for r in v if isinstance(r, dict)]
            if isinstance(v, dict):
                return [v]
        if any(k in resp for k in ("username", "email", "id")):
            return [resp]
    return []


# ===========================================================================
# Payload mappers: our internal shapes -> IT's flat record shapes
# ===========================================================================

def wga_sample_payload(b: dict, s: dict) -> dict:
    """Map one sample row of a WGA batch (batches.py) to IT's wga_batch_data record."""
    meta, kit = b.get("meta", {}), b.get("kit", {})
    return {
        "wga_batch_no": _s(meta.get("batchNo")),
        "instrument_id": _maybe_int(meta.get("instrumentId")),
        "instrument_name": _s(meta.get("instrument")),
        "prepared_by": _s(kit.get("preparedBy")),
        "checked_by": _s(kit.get("checkedBy")),
        "lot_no": _s(kit.get("lot")),
        "manufacturer": _s(kit.get("manufacturer")),
        "expiry_date": _s(kit.get("expiry")),
        "quantity_used": _s(kit.get("qty")),
        "kit": _s(kit.get("name")),
        "remarks": _s(s.get("remarks")),
        "patient_name": _s(s.get("patient")),
        "biopsy_date": _s(s.get("biopsy")),
        "received_date": _s(s.get("received")),
        "embryo_tag": _s(s.get("embryo")),
        "dna_concentration": _s(s.get("dnaConc")),
        "sample_type": _s(s.get("sampleType")),
        "index": _maybe_int(s.get("index")),
        "purified_wga_concentration": _s(s.get("purified")),
        "created_by": _s(b.get("createdBy")),
        "created_at": _dt(b.get("createdAt")),
        "last_updated_by": _s(b.get("resultsBy") or b.get("samplesEditedBy") or b.get("createdBy")),
        "last_updated_at": _dt(b.get("resultsAt") or b.get("samplesEditedAt") or b.get("createdAt")),
    }


def seq_sample_payload(b: dict, s: dict) -> dict:
    """Map one sample row of a sequencing batch (batches.py) to IT's sequence_batch_data record.
    Our seq meta has one date (Run Date); IT has run_date and sequence_date separately, so both are
    set from it - adjust if IT want them distinct."""
    meta, kit = b.get("meta", {}), b.get("kit", {})
    return {
        "run_id": _s(meta.get("batchNo")),
        "run_date": _s(meta.get("date")),
        "instrument_id": _maybe_int(meta.get("instrumentId")),
        "sequence_platform": _s(meta.get("instrument")),
        "sequence_date": _s(meta.get("date")),
        "prepared_by": _s(kit.get("preparedBy")),
        "checked_by": _s(kit.get("checkedBy")),
        "lot_no": _s(kit.get("lot")),
        "manufacturer": _s(kit.get("manufacturer")),
        "expiry_date": _s(kit.get("expiry")),
        "operator": _s(meta.get("operator")),
        "quantity_used": _s(kit.get("qty")),
        "kit": _s(kit.get("name")),
        "remarks": _s(s.get("remarks")),
        "patient_name": _s(s.get("patient")),
        "received_date": _s(s.get("received")),
        "embryo_tag": _s(s.get("embryo")),
        "dna_concentration": _s(s.get("dnaConc")),
        "volume": _s(s.get("volume")),
        "pool_number": _maybe_int(s.get("pool")),
        "index": _maybe_int(s.get("index")),
        "i5": _s(s.get("i5")),
        "i7": _s(s.get("i7")),
        "created_by": _s(b.get("createdBy")),
        "created_at": _dt(b.get("createdAt")),
        "last_updated_by": _s(b.get("resultsBy") or b.get("samplesEditedBy") or b.get("createdBy")),
        "last_updated_at": _dt(b.get("resultsAt") or b.get("samplesEditedAt") or b.get("createdAt")),
    }


def user_payload(*, username: str, email: str = "", password: str = "", client_name: str = "",
                 client_branch: str = "", embryologist_name: str = "", role: str = "", actor: str = "",
                 user_id=None, created_by: str = "", created_at: str = "") -> dict:
    """Map our user fields to IT's embryo_matrix_data record.
    - id: the DB row id (SERIAL/AUTO_INCREMENT), IT's unique user key. Sent whenever we have it.
      The Postman insert example omits it (DB generates on insert) while update sends it (id:101); we
      forward it in both because IT asked for the id to travel with the user, and sending the same id
      keeps both sides in step. Not shown in the UI.
    - email: our identity is the (username, email) PAIR - username alone isn't unique - so IT needs
      email to identify the user too. (The Postman example left it out; we include it deliberately.)
    - password is plaintext (IT's API expects it, like the Postman example); only sent when we have it
      (on create, or a reset)."""
    now = __import__("datetime").datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    # Match IT's Postman example, which carries ALL of these on BOTH insert and update (the only
    # difference there is that update also has "id"). created_by/created_at are always sent - IT's
    # insert requires them (omitting them gave HTTP 500 "Failed to insert data").
    rec = {
        "username": _s(username),
        "email": _s(email),
        "client_name": _s(client_name),
        "client_branch": _s(client_branch),
        "embryologist_name": _s(embryologist_name),
        "role": _s(role),
        "created_by": _s(created_by) or _s(actor) or "EmbryoMatrix",
        "created_at": _s(created_at) or now,
        "last_updated_by": _s(actor) or "EmbryoMatrix",
        "last_updated_at": now,
    }
    if user_id is not None:
        rec["id"] = user_id
    if password:
        rec["password"] = password
    return rec


# ===========================================================================
# Best-effort push of a whole batch (called from a background thread)
# ===========================================================================

def push_batch(b: dict) -> tuple[int, list[str]]:
    """Push every sample of a batch to IT (add_batch_data for wga, add_sequence_data for seq).
    Returns (count_sent, errors). Safe to call only when configured(); callers guard with it."""
    kind = b.get("kind")
    build = wga_sample_payload if kind == "wga" else seq_sample_payload
    send = add_batch_data if kind == "wga" else add_sequence_data
    sent, errors = 0, []
    for s in b.get("samples", []):
        try:
            send(build(b, s))
            sent += 1
        except IntegrationError as ex:
            errors.append(str(ex))
    return sent, errors
