"""Manage dashboard logins.
  python tools/manage_users.py add <username> [--role admin|senior_executive|team_lead|member|embryologist] [--password XXXX]
  python tools/manage_users.py passwd <username> [--password XXXX]
  python tools/manage_users.py remove <username>
  python tools/manage_users.py list
  python tools/manage_users.py setname <username> --embryologist "SINDHUJA N S"   (which sheet name this login's embryos are listed under)
Run from backend/ with the venv active. Without --password a random one is generated and printed."""
import argparse, secrets, sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from app.database import Base, engine, SessionLocal
from app.models import User
from app.auth import hash_password

ap = argparse.ArgumentParser()
ap.add_argument("cmd", choices=["add", "passwd", "remove", "list", "setname"])
ap.add_argument("username", nargs="?")
ap.add_argument("--role", default="member", choices=["admin", "senior_executive", "team_lead", "member", "embryologist"])
ap.add_argument("--password")
ap.add_argument("--client", help="fertility centre name (or part of it) for a login that represents a centre, e.g. MAMTA")
ap.add_argument("--embryologist", help="name in the sheets' Embryologist column (for embryologist logins)")
a = ap.parse_args()
Base.metadata.create_all(bind=engine)
from app import migrations
migrations.run()
db = SessionLocal()
if a.cmd == "list":
    for u in db.query(User).order_by(User.username):
        print(f"{u.username:24} {u.role:14} {u.embryologist_name or ''} {('centre: '+u.client_name) if u.client_name else ''}")
    sys.exit()
if not a.username:
    ap.error("username required")
name = a.username.strip().lower()
u = db.query(User).filter(User.username == name).first()
if a.cmd == "setname":
    if not u: sys.exit("No such user")
    u.embryologist_name = (a.embryologist or None); u.client_name = (a.client or None); db.commit(); print("ok"); sys.exit()
if a.cmd == "remove":
    if not u: sys.exit("No such user")
    db.delete(u); db.commit(); print("removed", name); sys.exit()
pw = a.password or secrets.token_urlsafe(9)
if a.cmd == "add":
    if u: sys.exit("User exists - use passwd")
    db.add(User(username=name, password_hash=hash_password(pw), role=a.role, embryologist_name=(a.embryologist or None)))
else:
    if not u: sys.exit("No such user")
    u.password_hash = hash_password(pw)
db.commit()
print(f"{name}: password = {pw}")
