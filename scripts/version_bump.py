import os
import re
from datetime import datetime

# Configurazione file e pattern regex per trovare la versione
FILES_TO_UPDATE = {
    "backend/core/config.py": {
        "version": r'VERSION = "([\d\.]+)"',
        "date": r'BUILD_DATE = "([\d-]+)"',
        "version_template": 'VERSION = "{version}"',
        "date_template": 'BUILD_DATE = "{date}"'
    },
    "frontend/app/lib/version.ts": {
        "version": r'export const VERSION = "([\d\.]+)";',
        "date": r'export const BUILD_DATE = "([\d-]+)";',
        "version_template": 'export const VERSION = "{version}";',
        "date_template": 'export const BUILD_DATE = "{date}";'
    },
    "frontend/package.json": {
        "version": r'"version": "([\d\.]+)"',
        "version_template": '"version": "{version}"'
    },
    "roadmap.md": {
        "version": r'\*Versione: ([\d\.]+) — Aggiornata al: [\d-]+\*',
        "version_template": '*Versione: {version} — Aggiornata al: {date}*'
    },
    "FUNZIONALITA.txt": {
        "version": r'Versione: ([\d\.]+) — Aggiornato al: [\d-]+',
        "version_template": 'Versione: {version} — Aggiornato al: {date}'
    }
}

def bump_version(new_version=None):
    today = datetime.now().strftime("%Y-%m-%d")
    
    # 1. Trova la versione attuale (usiamo roadmap.md come fonte della verità per l'utente)
    current_version = "1.2.1" # Fallback
    try:
        with open("roadmap.md", "r", encoding="utf-8") as f:
            content = f.read()
            match = re.search(FILES_TO_UPDATE["roadmap.md"]["version"], content)
            if match:
                current_version = match.group(1)
    except Exception as e:
        print(f"Errore lettura roadmap.md: {e}")

    # 2. Calcola la nuova versione se non fornita
    if not new_version:
        parts = current_version.split(".")
        if len(parts) == 3:
            parts[2] = str(int(parts[2]) + 1)
            new_version = ".".join(parts)
        else:
            new_version = current_version + ".1"

    print(f"Aggiornamento versione: {current_version} -> {new_version} (Data: {today})")

    # 3. Aggiorna tutti i file
    for filepath, config in FILES_TO_UPDATE.items():
        if not os.path.exists(filepath):
            print(f"Salto {filepath}: file non trovato")
            continue
            
        try:
            with open(filepath, "r", encoding="utf-8") as f:
                content = f.read()

            new_content = content
            
            # Update Version
            if "version" in config:
                new_content = re.sub(
                    config["version"], 
                    config["version_template"].format(version=new_version, date=today), 
                    new_content
                )
            
            # Update Date (if separate template exists)
            if "date" in config:
                new_content = re.sub(
                    config["date"], 
                    config["date_template"].format(date=today), 
                    new_content
                )

            with open(filepath, "w", encoding="utf-8") as f:
                f.write(new_content)
            
            print(f"✅ Aggiornato {filepath}")
            
        except Exception as e:
            print(f"❌ Errore aggiornamento {filepath}: {e}")

if __name__ == "__main__":
    import sys
    custom_v = sys.argv[1] if len(sys.argv) > 1 else None
    bump_version(custom_v)
