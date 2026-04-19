@echo off
setlocal
set "ROOT=%~dp0.."

echo =========================================
echo   MaintAI Desktop — Avvio Sviluppo
echo =========================================
echo.

REM ── 1. Backend FastAPI ────────────────────────────────────────────
echo [1/3] Avvio Backend FastAPI (porta 8000)...
start "MaintAI Backend" cmd /k "cd /d %ROOT% && python -m uvicorn backend.main:app --host 127.0.0.1 --port 8000 --reload"

REM Attendi avvio backend
echo Attendo avvio backend (5s)...
timeout /t 5 /nobreak >nul

REM ── 2. Frontend Next.js ───────────────────────────────────────────
echo [2/3] Avvio Frontend Next.js (porta 3000)...
start "MaintAI Frontend" cmd /k "cd /d %ROOT%\frontend && npm run dev"

REM Attendi avvio frontend
echo Attendo avvio frontend (8s)...
timeout /t 8 /nobreak >nul

REM ── 3. Tauri Dev Window ───────────────────────────────────────────
echo [3/3] Avvio Tauri Desktop App...
echo.
echo NOTA: La finestra Tauri si collega a http://localhost:3000
echo       Chiudi questo terminale per fermare la sessione Tauri.
echo.
cd /d "%ROOT%\frontend"
npm run tauri:dev

endlocal
