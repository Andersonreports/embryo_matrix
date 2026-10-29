#!/usr/bin/env python3
"""Generate apps_script/Code.deploy.gs (gitignored) from apps_script/Code.gs (the committed template).

Code.gs ships with placeholders so it is safe to commit. The deploy copy is what you paste into the
Apps Script editor, with the real IDs filled in. Sheet IDs are not secret (they appear in share URLs);
the SHARED_SECRET is, so it is read back from the existing deploy file rather than stored here. Run:

    python3 tools/make_apps_script_deploy.py

then paste apps_script/Code.deploy.gs into Extensions > Apps Script and redeploy a new version.
"""
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SRC = ROOT / "apps_script" / "Code.gs"
OUT = ROOT / "apps_script" / "Code.deploy.gs"

# Not secrets - these IDs are in the spreadsheets' own share URLs.
SOURCE_SHEET_IDS = [
    "1NFf6g80p9zzPPvqp1I1t4CzlJS3IMwQyc8rkvONvBBU",
    "1zJefmlYQV4dqtxeofBj_m8kmfsvFY1hj5eqLtOHChuQ",
    "1qqIBCdgfSsZHs_v1rO2sHQA2eeiPZxejZvampgEC4Dc",
]
# The "PGS & NIPGS updates" sheet holds both the edits tab and the WGA/Sequencing Batches tabs.
UPDATES_SHEET_ID = "1tpNserj-GCigSfkg3uhH_io_yiSZjkn9px6MGzK-_Tg"


def existing_secret() -> str:
    """Read the shared secret from the current deploy file so it is never hardcoded here or in git."""
    if OUT.exists():
        m = re.search(r"var SHARED_SECRET_PLACEHOLDER = '([^']+)'", OUT.read_text())
        if m and m.group(1) != "REPLACE_WITH_A_LONG_RANDOM_STRING":
            return m.group(1)
    return ""


def main() -> int:
    src = SRC.read_text()
    secret = existing_secret()
    if not secret:
        print("No shared secret found in the existing Code.deploy.gs. Paste it in once (replace\n"
              "REPLACE_WITH_A_LONG_RANDOM_STRING) and re-run, or set it in the Apps Script editor.",
              file=sys.stderr)
    # Drop the doc-comment header: keep from the first real statement onward.
    out = src[src.index("var SHARED_SECRET_PLACEHOLDER"):]
    if secret:
        out = out.replace("var SHARED_SECRET_PLACEHOLDER = 'REPLACE_WITH_A_LONG_RANDOM_STRING';",
                          f"var SHARED_SECRET_PLACEHOLDER = '{secret}';", 1)
    out = out.replace(
        "var DEFAULT_SHEET_IDS = [\n  'SHEET_ID_1',\n  'SHEET_ID_2',\n  'SHEET_ID_3',\n];",
        "var DEFAULT_SHEET_IDS = [\n  '" + "',\n  '".join(SOURCE_SHEET_IDS) + "',\n];", 1)
    out = out.replace("var EDITS_SHEET_ID_SETTING = 'PASTE_THE_GOOGLE_SHEET_ID_HERE';",
                      f"var EDITS_SHEET_ID_SETTING = '{UPDATES_SHEET_ID}';", 1)
    out = out.replace("var NEW_SAMPLES_SHEET_ID_SETTING = 'PASTE_THE_PGS_NIPGS_UPDATES_SHEET_ID_HERE';",
                      f"var NEW_SAMPLES_SHEET_ID_SETTING = '{UPDATES_SHEET_ID}';", 1)
    OUT.write_text(out)
    left = [p for p in ("SHEET_ID_1", "PASTE_THE_GOOGLE_SHEET_ID_HERE",
                        "PASTE_THE_PGS_NIPGS_UPDATES_SHEET_ID_HERE") if p in out]
    print(f"Wrote {OUT.relative_to(ROOT)} ({out.count(chr(10)) + 1} lines).")
    print("Secret filled." if secret else "Secret NOT filled - paste it in the editor.")
    print(("Still unfilled: " + ", ".join(left)) if left else "All sheet IDs filled.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
