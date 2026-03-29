@echo off
cd /d "%~dp0"
echo Avvio MaintAI Backend...
echo Directory: %CD%
python -m uvicorn backend.main:app --host 127.0.0.1 --port 8000 --reload
pause
