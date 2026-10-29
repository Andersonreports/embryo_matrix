"""Applies the day/month date repair to the dashboard's stored copy of the sheet rows NOW (the same repair the sync does when
DATE_FIX_ENABLED=true). Backs the database up first. Never touches the Google Sheet. Run only after checking the dry-run report.
Usage: .venv/bin/python tools/date_fix_apply.py"""
import json, sqlite3, sys, time
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from app.config import settings
from app.date_fix import apply_to_row

path = Path(settings.database_url.split("sqlite:///", 1)[1])
bak = path.with_name(f"embryomatrix.db.bak-before-datefix-{time.strftime('%Y%m%d-%H%M%S')}")
src = sqlite3.connect(path); dst = sqlite3.connect(bak); src.backup(dst); dst.close()
print("backup:", bak.name)
rows = json.loads(src.execute("select value from kv_store where key='embryomatrix-imported-cases'").fetchone()[0])
fixed = [apply_to_row(r) for r in rows]
changed = sum(1 for a, b in zip(rows, fixed) if a != b)
src.execute("update kv_store set value=? where key='embryomatrix-imported-cases'", (json.dumps(fixed),))
src.commit()
print("rows:", len(rows), "| rows updated:", changed)
