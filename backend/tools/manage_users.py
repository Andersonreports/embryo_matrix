"""Manage dashboard logins.
  python tools/manage_users.py add <username> [--role admin|lab_user] [--password XXXX]
  python tools/manage_users.py passwd <username> [--password XXXX]
  python tools/manage_users.py remove <username>
  python tools/manage_users.py list
Run from backend/ with the venv active. Without --password a random one is generated and printed."""
import argparse, secrets, sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from app.database import Base, engine, SessionLocal
from app.models import User
from app.auth import hash_password

ap = argparse.ArgumentParser()
ap.add_argument("cmd", choices=["add", "passwd", "remove", "list"])
ap.add_argument("username", nargs="?")
ap.add_argument("--role", default="lab_user")
ap.add_argument("--password")
a = ap.parse_args()
Base.metadata.create_all(bind=engine)
db = SessionLocal()
if a.cmd == "list":
    for u in db.query(User).order_by(User.username):
        print(f"{u.username:24} {u.role}")
    sys.exit()
if not a.username:
    ap.error("username required")
name = a.username.strip().lower()
u = db.query(User).filter(User.username == name).first()
if a.cmd == "remove":
    if not u: sys.exit("No such user")
    db.delete(u); db.commit(); print("removed", name); sys.exit()
pw = a.password or secrets.token_urlsafe(9)
if a.cmd == "add":
    if u: sys.exit("User exists - use passwd")
    db.add(User(username=name, password_hash=hash_password(pw), role=a.role))
else:
    if not u: sys.exit("No such user")
    u.password_hash = hash_password(pw)
db.commit()
print(f"{name}: password = {pw}")
