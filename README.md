# Embryo Matrix – Multi-Lab Web Application Starter

This is a clean source-code starter package for IT handover and deployment planning.

## Architecture
- Backend: FastAPI + SQLAlchemy
- Database: PostgreSQL in production (SQLite works for local demo)
- Frontend: simple responsive HTML/JS starter served by FastAPI
- Authentication: JWT login with role and lab scope
- Roles: admin, head_office, lab_user, embryologist, viewer
- Multi-lab model: each operational record is associated with a lab; Admin/Head Office can be extended for cross-lab access.

## Modules scaffolded
- Authentication / users
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
4. `uvicorn app.main:app --reload`
5. Open http://127.0.0.1:8000

## Production
See `DEPLOYMENT.md`.
