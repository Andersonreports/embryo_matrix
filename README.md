# Embryo Matrix – Multi-Lab Web Application Starter

This is a clean source-code starter package for IT handover and deployment planning.

## Architecture
- Backend: FastAPI + SQLAlchemy
- Database: PostgreSQL in production (SQLite works for local demo)
- Frontend: simple responsive HTML/JS starter served by FastAPI
- Authentication: none of its own — this app is designed to run as a module
  behind another gated application. That parent app authenticates the user
  and forwards their identity to this service via `X-Auth-User` / `X-Auth-Role`
  request headers (see "Embedding behind a gated app" below).
- Multi-lab model: each operational record is associated with a lab; Admin/Head Office can be extended for cross-lab access.

## Modules scaffolded
- Labs
- Patient cases
- Embryo/sample records
- PGT tests (PGT-A / PGT-M / PGT-SR and extensible types)
- Dashboard counts
- Audit log foundation

## Important
This package contains no real patient data, passwords, API keys, or production credentials.
Before production use, IT must perform security review, validation, backup testing, privacy/compliance review, and configure HTTPS.

## Quick local run
1. Install Python 3.11+
2. Copy `.env.example` to `.env`
3. `pip install -r requirements.txt`
4. `uvicorn app.main:app --reload` (Windows: `start.bat`, Linux/macOS: `./start.sh`)
5. Open http://127.0.0.1:8001

## Embedding behind a gated app
This service has no login screen and does not verify any identity itself —
every `/api/*` route trusts the `X-Auth-User` and `X-Auth-Role` headers on the
incoming request. Anyone who can reach this service directly can act as any
user (including `admin`), so:
- Bind it to `127.0.0.1` only (the default in `start.bat` / `start.sh`) and
  never expose its port on the LAN or public internet directly.
- Put it behind the parent gated application, which must authenticate the
  user first, then proxy the request to this service, setting
  `X-Auth-User` / `X-Auth-Role` itself and **stripping any copies of those
  headers a client tried to send** so they can't be spoofed.
- `role == "admin"` is currently the only role this app checks (it gates
  clearing the activity/upload logs) — map your parent app's roles accordingly.

## Production
See `DEPLOYMENT.md`.
