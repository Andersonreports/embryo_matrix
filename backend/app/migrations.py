"""Small in-place schema upgrades: create_all adds missing tables but not missing columns on existing ones."""
from sqlalchemy import inspect, text
from .database import engine

def _migrate_added_columns():
    """create_all only adds missing tables, not missing columns on tables that
    already exist. trf_submissions predates case_code/pdf_filename/pdf_file_path
    (added for the run/patient file-organization feature) - add them if missing."""
    insp = inspect(engine)
    if "trf_submissions" not in insp.get_table_names():
        return
    existing = {c["name"] for c in insp.get_columns("trf_submissions")}
    add = {
        "case_code": "VARCHAR(80)",
        "pdf_filename": "VARCHAR(255)",
        "pdf_file_path": "VARCHAR(500)",
        "status_note": "TEXT",
    }
    with engine.begin() as conn:
        for col, coltype in add.items():
            if col not in existing:
                conn.execute(text(f"ALTER TABLE trf_submissions ADD COLUMN {col} {coltype}"))


def _migrate_outcome_tests():
    insp = inspect(engine)
    if "embryo_outcomes" in insp.get_table_names() and "tests" not in {c["name"] for c in insp.get_columns("embryo_outcomes")}:
        with engine.begin() as conn:
            conn.execute(text("ALTER TABLE embryo_outcomes ADD COLUMN tests JSON"))


def _migrate_followup_owner():
    insp = inspect(engine)
    names = insp.get_table_names()
    with engine.begin() as conn:
        if "followups" in names and "owner" not in {c["name"] for c in insp.get_columns("followups")}:
            conn.execute(text("ALTER TABLE followups ADD COLUMN owner VARCHAR(120) DEFAULT ''"))
        if "users" in names and "embryologist_name" not in {c["name"] for c in insp.get_columns("users")}:
            conn.execute(text("ALTER TABLE users ADD COLUMN embryologist_name VARCHAR(120)"))
        if "users" in names and "client_name" not in {c["name"] for c in insp.get_columns("users")}:
            conn.execute(text("ALTER TABLE users ADD COLUMN client_name VARCHAR(120)"))


def run():
    _migrate_added_columns()
    _migrate_outcome_tests()
    _migrate_followup_owner()
