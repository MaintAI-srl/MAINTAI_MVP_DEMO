@echo off
setlocal
set "ROOT=%~dp0.."

echo =========================================
echo   MaintAI Desktop — Build Produzione
echo =========================================
echo.

REM Verifica prerequisiti
where rustc >nul 2>&1
if errorlevel 1 (
    echo ERRORE: Rust non trovato. Installa da https://rustup.rs/
    pause
    exit /b 1
)

where cargo >nul 2>&1
if errorlevel 1 (
    echo ERRORE: Cargo non trovato. Installa Rust da https://rustup.rs/
    pause
    exit /b 1
)

echo Versione Rust:
rustc --version
cargo --version
echo.

REM Verifica icone
if not exist "%ROOT%\frontend\src-tauri\icons\icon.ico" (
    echo AVVISO: Icone mancanti in frontend/src-tauri/icons/
    echo Genera le icone con:
    echo   cd frontend
    echo   npx @tauri-apps/cli@2 icon path\to\logo.png
    echo.
    echo Continuo senza icone personalizzate...
    echo.
)

REM ── Build frontend (static export) ───────────────────────────────
echo [1/2] Build frontend Next.js (static export)...
cd /d "%ROOT%\frontend"
npm run build:desktop
if errorlevel 1 (
    echo ERRORE: Build frontend fallita.
    pause
    exit /b 1
)
echo Frontend build OK — output in frontend/out/
echo.

REM ── Build Tauri ───────────────────────────────────────────────────
echo [2/2] Build Tauri (compilazione Rust + packaging Windows)...
echo Questo passaggio richiede diversi minuti alla prima esecuzione.
echo.
npm run tauri:build
if errorlevel 1 (
    echo ERRORE: Build Tauri fallita. Controlla i log sopra.
    pause
    exit /b 1
)

echo.
echo =========================================
echo   BUILD COMPLETATA
echo =========================================
echo.
echo Installer/eseguibili in:
echo   frontend\src-tauri\target\release\bundle\
echo.
echo Formati disponibili (Windows):
echo   - .msi   (installer)
echo   - .exe   (NSIS installer)
echo.

pause
endlocal
