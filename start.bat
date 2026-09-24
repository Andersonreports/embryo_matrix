@echo off
setlocal
cd /d "%~dp0"

if not exist ".venv\Scripts\python.exe" (
    echo Setting up virtual environment...
    python -m venv .venv
    ".venv\Scripts\python.exe" -m pip install -q --upgrade pip
    ".venv\Scripts\python.exe" -m pip install -q fastapi==0.115.6 "uvicorn[standard]==0.34.0" sqlalchemy "psycopg[binary]" pydantic-settings==2.7.1 "python-jose[cryptography]==3.3.0" "passlib[bcrypt]==1.7.4" python-multipart==0.0.20 openpyxl==3.1.5
)

set PORT=8001
echo Starting Embryo Matrix on http://127.0.0.1:%PORT%
start "" cmd /c "timeout /t 3 >nul & start http://127.0.0.1:%PORT%"
".venv\Scripts\python.exe" -m uvicorn app.main:app --host 127.0.0.1 --port %PORT% --reload

echo.
echo Server stopped. Press any key to close this window.
pause >nul
