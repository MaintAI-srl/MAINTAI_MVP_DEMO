Dim WShell, Root
Set WShell = CreateObject("WScript.Shell")

Root = WShell.CurrentDirectory

' Percorso root del progetto (dove si trova questo file)
Root = CreateObject("Scripting.FileSystemObject").GetParentFolderName(WScript.ScriptFullName)

' Avvia Backend FastAPI in background
WShell.Run "cmd /c cd /d """ & Root & """ && python -m uvicorn backend.main:app --host 127.0.0.1 --port 8000", 1, False

' Attendi avvio backend
WScript.Sleep 4000

' Avvia Frontend Next.js in background
WShell.Run "cmd /c cd /d """ & Root & "\frontend"" && npm run dev", 1, False

' Attendi avvio frontend
WScript.Sleep 8000

' Avvia Tauri Desktop (con cargo nel PATH)
WShell.Run "cmd /c set PATH=%USERPROFILE%\.cargo\bin;%PATH% && cd /d """ & Root & "\frontend"" && npm run tauri:dev", 1, False
