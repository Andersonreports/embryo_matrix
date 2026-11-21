"""Logins live in two separate databases: client logins (the role shown as "Client", internally
`embryologist`) in PostgreSQL, team/staff logins in MySQL. Each connection falls back to a local
SQLite file when its URL is blank, so the split runs before the real servers are wired.

The rest of the app talks to users ONLY through this module's repository functions (find/create/
update/delete/list). They return a plain UserView whose attributes mirror the old ORM row
(username, email, password_hash, role, client_name, client_branch, embryologist_name) so call
sites that read u.client_name etc. keep working. Creation and role changes route to the right
database automatically: client role -> PostgreSQL, every other role -> MySQL.
"""
from __future__ import annotations

import logging
from dataclasses import dataclass
from datetime import datetime

from sqlalchemy import create_engine, String, Integer, DateTime, func, or_, UniqueConstraint
from sqlalchemy.orm import sessionmaker, DeclarativeBase, Mapped, mapped_column

from .config import settings, DB_DIR

# The single role that means "a fertility-centre / client login". Kept as the existing value so
# the app's many role checks (sidebar, follow-ups, TRFs, whoami) do not have to change.
CLIENT_ROLE = "embryologist"


def _sqlite_engine(sqlite_name: str):
    DB_DIR.mkdir(parents=True, exist_ok=True)
    return create_engine(f"sqlite:///{(DB_DIR / sqlite_name).as_posix()}", connect_args={"check_same_thread": False})


def _engine(url: str, sqlite_name: str):
    """Build an engine for a configured URL, or a local SQLite file when the URL is blank. If a
    configured URL can't be built (e.g. its driver isn't installed), fall back to the local SQLite
    file and log it, so a misconfiguration never takes the whole app down on startup."""
    if not url:
        return _sqlite_engine(sqlite_name)
    if url.startswith("sqlite"):
        return create_engine(url, connect_args={"check_same_thread": False})
    try:
        return create_engine(url, pool_pre_ping=True)
    except Exception:
        logging.getLogger(__name__).exception("Could not open user database %s - falling back to local SQLite", sqlite_name)
        return _sqlite_engine(sqlite_name)


clients_engine = _engine(settings.clients_db_url, "user_clients.db")
team_engine = _engine(settings.team_db_url, "user_team.db")
ClientSession = sessionmaker(bind=clients_engine, autoflush=False, autocommit=False)
TeamSession = sessionmaker(bind=team_engine, autoflush=False, autocommit=False)


class ClientBase(DeclarativeBase):
    pass


class TeamBase(DeclarativeBase):
    pass


class ClientUser(ClientBase):
    __tablename__ = "client_users"
    # Identity is the (username, email) pair - username alone is not unique.
    __table_args__ = (UniqueConstraint("username", "email", name="uq_client_users_user_email"),)
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    username: Mapped[str] = mapped_column(String(80), index=True)
    email: Mapped[str | None] = mapped_column(String(190), index=True, nullable=True)
    password_hash: Mapped[str] = mapped_column(String(255))
    role: Mapped[str] = mapped_column(String(30), default=CLIENT_ROLE)
    client_name: Mapped[str | None] = mapped_column(String(120), nullable=True)
    client_branch: Mapped[str | None] = mapped_column(String(120), nullable=True)
    embryologist_name: Mapped[str | None] = mapped_column(String(120), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)


class TeamUser(TeamBase):
    __tablename__ = "team_users"
    # Identity is the (username, email) pair - username alone is not unique.
    __table_args__ = (UniqueConstraint("username", "email", name="uq_team_users_user_email"),)
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    # Anderson employee ID. Every staff member is an Anderson employee, so this is required for a
    # team login (the app enforces it when creating one). Clients live in client_users, which has no
    # such column, so a client never carries an employee ID.
    anderson_emp_id: Mapped[int | None] = mapped_column(Integer, nullable=True)
    username: Mapped[str] = mapped_column(String(80), index=True)
    email: Mapped[str | None] = mapped_column(String(190), index=True, nullable=True)
    password_hash: Mapped[str] = mapped_column(String(255))
    role: Mapped[str] = mapped_column(String(30), default="member")
    # Team rows never represent a client, but the columns are kept identical so routing is purely
    # a matter of which table a row lives in - the view shape is the same either way.
    client_name: Mapped[str | None] = mapped_column(String(120), nullable=True)
    client_branch: Mapped[str | None] = mapped_column(String(120), nullable=True)
    embryologist_name: Mapped[str | None] = mapped_column(String(120), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)


@dataclass
class UserView:
    username: str
    email: str | None
    password_hash: str
    role: str
    client_name: str | None
    client_branch: str | None
    embryologist_name: str | None
    store: str  # 'client' | 'team'
    anderson_emp_id: int | None = None  # team logins only; always None for a client
    # The table's primary-key id (SERIAL / AUTO_INCREMENT). Not shown in the UI, but forwarded to the
    # IT integration as the unique user key. Note: client_users and team_users have independent id
    # sequences, so this is unique only WITHIN a store, not across both.
    id: int | None = None

    @property
    def is_client(self) -> bool:
        return self.store == "client"


def _model_session(store: str):
    return (ClientUser, ClientSession) if store == "client" else (TeamUser, TeamSession)


def _store_for_role(role: str) -> str:
    return "client" if (role or "") == CLIENT_ROLE else "team"


def _to_view(row, store: str) -> UserView:
    return UserView(username=row.username, email=row.email, password_hash=row.password_hash,
                    role=row.role, client_name=row.client_name, client_branch=row.client_branch,
                    embryologist_name=row.embryologist_name, store=store,
                    anderson_emp_id=getattr(row, "anderson_emp_id", None),
                    id=getattr(row, "id", None))


def init() -> None:
    """Bootstrap tables for the LOCAL SQLite fallback only, so development runs before the real
    databases are wired. The real client (PostgreSQL) and team (MySQL) databases are created and
    owned by IT - we never issue DDL against them; we only connect to the tables they provide.
    (The expected columns are documented in backend/USER_TABLES_SCHEMA.sql for IT to create.)"""
    if clients_engine.dialect.name == "sqlite":
        ClientBase.metadata.create_all(bind=clients_engine)
    if team_engine.dialect.name == "sqlite":
        TeamBase.metadata.create_all(bind=team_engine)


# ---- reads -------------------------------------------------------------------

def find_by_username(username: str) -> UserView | None:
    uname = (username or "").strip().lower()
    if not uname:
        return None
    for store in ("client", "team"):
        M, S = _model_session(store)
        with S() as s:
            row = s.query(M).filter(func.lower(M.username) == uname).first()
            if row:
                return _to_view(row, store)
    return None


def find_by_login(ident: str) -> UserView | None:
    """Look an account up by email or username, across both stores. (Kept for callers that still
    identify by a single field; login now uses find_by_credentials.)"""
    ident = (ident or "").strip().lower()
    if not ident:
        return None
    for store in ("client", "team"):
        M, S = _model_session(store)
        with S() as s:
            row = s.query(M).filter(or_(func.lower(M.email) == ident, func.lower(M.username) == ident)).first()
            if row:
                return _to_view(row, store)
    return None


def find_by_credentials(username: str, email: str) -> UserView | None:
    """Login identity = the (username, email) PAIR. Neither field is unique on its own: one mailbox
    can be shared by several usernames (a team address, or one client centre's address), and the
    same username can recur under different mailboxes (two 'sanjai's at different clients, told apart
    by their client email). Only the pair is unique, so we match on both."""
    uname = (username or "").strip().lower()
    em = (email or "").strip().lower()
    if not uname:
        return None
    for store in ("client", "team"):
        M, S = _model_session(store)
        with S() as s:
            row = s.query(M).filter(func.lower(M.username) == uname,
                                    func.lower(func.coalesce(M.email, "")) == em).first()
            if row:
                return _to_view(row, store)
    return None


def credentials_exist(username: str, email: str) -> bool:
    """True if the (username, email) pair is already taken (used to block duplicate logins)."""
    return find_by_credentials(username, email) is not None


def username_exists(username: str) -> bool:
    return find_by_username(username) is not None


def email_in_use(email: str, exclude_username: str = "") -> bool:
    email = (email or "").strip().lower()
    ex = (exclude_username or "").strip().lower()
    if not email:
        return False
    for store in ("client", "team"):
        M, S = _model_session(store)
        with S() as s:
            if s.query(M).filter(func.lower(M.email) == email, func.lower(M.username) != ex).first():
                return True
    return False


def role_of(username: str) -> str | None:
    v = find_by_username(username)
    return v.role if v else None


def count_role(roles, excluding: str = "") -> int:
    ex = (excluding or "").strip().lower()
    rset = list(roles)
    n = 0
    for store in ("client", "team"):
        M, S = _model_session(store)
        with S() as s:
            n += s.query(M).filter(M.role.in_(rset), func.lower(M.username) != ex).count()
    return n


def list_all() -> list[UserView]:
    out: list[UserView] = []
    for store in ("client", "team"):
        M, S = _model_session(store)
        with S() as s:
            out += [_to_view(r, store) for r in s.query(M).all()]
    out.sort(key=lambda v: v.username)
    return out


def clients_with_name() -> list[UserView]:
    """Client logins that carry a client_name (used by the client-assignment audit)."""
    M, S = _model_session("client")
    with S() as s:
        rows = s.query(M).filter(M.client_name != None, M.client_name != "").all()  # noqa: E711
        return [_to_view(r, "client") for r in rows]


def list_embryologists() -> list[UserView]:
    M, S = _model_session("client")
    with S() as s:
        rows = s.query(M).filter(M.role == CLIENT_ROLE).order_by(M.username).all()
        return [_to_view(r, "client") for r in rows]


# ---- writes ------------------------------------------------------------------

def create(*, username: str, email: str | None, password_hash: str, role: str,
           client_name: str | None = None, client_branch: str | None = None,
           embryologist_name: str | None = None, anderson_emp_id: int | None = None) -> UserView:
    store = _store_for_role(role)
    M, S = _model_session(store)
    kwargs = dict(username=username, email=email, password_hash=password_hash, role=role,
                  client_name=client_name, client_branch=client_branch, embryologist_name=embryologist_name)
    # anderson_emp_id exists only on the team table; never pass it to a client row.
    if store == "team":
        kwargs["anderson_emp_id"] = anderson_emp_id
    with S() as s:
        row = M(**kwargs)
        s.add(row)
        s.commit()
        s.refresh(row)
        return _to_view(row, store)


def _locate(s, M, username: str, email: str):
    """Re-fetch the one row for a (username, email) pair inside an open session."""
    return s.query(M).filter(func.lower(M.username) == (username or "").strip().lower(),
                             func.lower(func.coalesce(M.email, "")) == (email or "").strip().lower()).first()


def update(username: str, changes: dict, email: str = "") -> UserView | None:
    """Apply changes (any of email, password_hash, role, client_name, client_branch,
    embryologist_name) to the login identified by the (username, email) pair. A role change that
    crosses the client/team line moves the row to the other database. The row is always located by
    its CURRENT email, so a change to the email field still targets the right row."""
    v = find_by_credentials(username, email)
    if not v:
        return None
    new_role = changes.get("role", v.role)
    if _store_for_role(new_role) != v.store:
        merged = {
            "username": v.username,
            "email": changes.get("email", v.email),
            "password_hash": changes.get("password_hash", v.password_hash),
            "role": new_role,
            "client_name": changes.get("client_name", v.client_name),
            "client_branch": changes.get("client_branch", v.client_branch),
            "embryologist_name": changes.get("embryologist_name", v.embryologist_name),
            "anderson_emp_id": changes.get("anderson_emp_id", v.anderson_emp_id),
        }
        delete(v.username, v.email or "")
        return create(**merged)
    M, S = _model_session(v.store)
    with S() as s:
        row = _locate(s, M, v.username, v.email or "")
        if not row:
            return None
        for k in ("email", "password_hash", "role", "client_name", "client_branch", "embryologist_name", "anderson_emp_id"):
            if k in changes and hasattr(row, k):  # client rows have no anderson_emp_id column
                setattr(row, k, changes[k])
        s.commit()
        s.refresh(row)
        return _to_view(row, v.store)


def delete(username: str, email: str = "") -> bool:
    v = find_by_credentials(username, email)
    if not v:
        return False
    M, S = _model_session(v.store)
    with S() as s:
        row = _locate(s, M, v.username, v.email or "")
        if row:
            s.delete(row)
            s.commit()
    return True
