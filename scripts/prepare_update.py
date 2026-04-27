#!/usr/bin/env python3
"""
Firma gli installer Tauri e aggiorna backend/update_manifest.json.

Uso:
    python scripts/prepare_update.py <versione>

Esempio:
    python scripts/prepare_update.py 3.1.7

Prerequisiti:
    - L'installer deve essere stato buildato con: scripts/build-desktop.bat
    - La chiave privata deve essere in tauri_signing_key.txt (nella root)
      oppure nella variabile d'ambiente TAURI_SIGNING_PRIVATE_KEY

Output:
    - Aggiorna backend/update_manifest.json con versione, firma e URL
    - Stampa i prossimi passi da eseguire manualmente
"""

import subprocess
import json
import sys
import os
from pathlib import Path
from datetime import datetime, timezone

# ── Configurazione ──────────────────────────────────────────────────────────

VERSION = sys.argv[1] if len(sys.argv) > 1 else "3.1.6"
ROOT = Path(__file__).parent.parent

# Directory output build Tauri (default impostato in tauri.conf.json / build-desktop.bat)
BUILD_DIR = Path(os.environ.get("TAURI_BUILD_DIR", "C:/Temp/maintai_build/release/bundle"))
MANIFEST = ROOT / "backend" / "update_manifest.json"
KEY_FILE = ROOT / "tauri_signing_key.txt"

# URL base per il download degli installer (aggiornare con il repository reale)
GITHUB_REPO = "alexMaster9982/maintai_v3"
DOWNLOAD_BASE = f"https://github.com/{GITHUB_REPO}/releases/download/v{VERSION}"

# ── Percorsi installer ──────────────────────────────────────────────────────

# NSIS installer (Windows x64)
NSIS = BUILD_DIR / "nsis" / f"MaintAI Desktop_{VERSION}_x64-setup.exe"

# ── Lettura chiave privata ──────────────────────────────────────────────────

def load_private_key() -> str:
    """Carica la chiave privata dal file o dalla variabile d'ambiente."""
    # Priorità 1: variabile d'ambiente
    key_env = os.environ.get("TAURI_SIGNING_PRIVATE_KEY", "").strip()
    if key_env:
        return key_env

    # Priorità 2: file tauri_signing_key.txt
    if KEY_FILE.exists():
        content = KEY_FILE.read_text(encoding="utf-8").strip()
        # Il file contiene il base64 della chiave (incluso header "untrusted comment")
        # Tauri si aspetta l'intero contenuto base64 del file
        return content

    return ""


def sign_file(file_path: Path, private_key: str) -> str:
    """
    Firma un file con tauri signer e restituisce la firma base64.
    La firma viene scritta in <file>.sig dal CLI.
    """
    if not file_path.exists():
        print(f"ERRORE: file non trovato: {file_path}")
        sys.exit(1)

    env = os.environ.copy()
    env["TAURI_SIGNING_PRIVATE_KEY"] = private_key
    env["TAURI_SIGNING_PRIVATE_KEY_PASSWORD"] = ""

    result = subprocess.run(
        ["npx", "@tauri-apps/cli@2", "signer", "sign", str(file_path), "--ci"],
        capture_output=True,
        text=True,
        env=env,
        cwd=str(ROOT / "frontend"),
        shell=True,
    )

    if result.returncode != 0:
        print(f"ERRORE firma {file_path.name}:")
        print(result.stderr)
        sys.exit(1)

    sig_file = Path(str(file_path) + ".sig")
    if not sig_file.exists():
        print(f"ERRORE: file .sig non generato per {file_path.name}")
        sys.exit(1)

    signature = sig_file.read_text(encoding="utf-8").strip()
    print(f"  Firmato: {file_path.name}")
    return signature


# ── Main ────────────────────────────────────────────────────────────────────

def main():
    print(f"Preparazione release MaintAI Desktop v{VERSION}")
    print("=" * 50)

    # Carica chiave privata
    private_key = load_private_key()
    if not private_key:
        print("ERRORE: chiave privata non trovata.")
        print(f"  Opzione 1: crea {KEY_FILE} con la chiave privata")
        print("  Opzione 2: imposta la variabile TAURI_SIGNING_PRIVATE_KEY")
        sys.exit(1)
    print("  Chiave privata: trovata")

    # Firma installer Windows
    print(f"\nFirma installer Windows...")
    nsis_signature = sign_file(NSIS, private_key)

    # URL download
    nsis_url = f"{DOWNLOAD_BASE}/{NSIS.name}"

    # Costruisce manifest
    manifest = {
        "version": VERSION,
        "notes": f"MaintAI Desktop v{VERSION}",
        "pub_date": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
        "platforms": {
            "windows-x86_64": {
                "signature": nsis_signature,
                "url": nsis_url,
            }
        },
    }

    # Scrivi manifest
    with open(MANIFEST, "w", encoding="utf-8") as f:
        json.dump(manifest, f, indent=2, ensure_ascii=False)
        f.write("\n")

    print(f"\nManifest aggiornato: {MANIFEST}")
    print(f"  Versione : {VERSION}")
    print(f"  Firma    : {nsis_signature[:40]}...")
    print(f"  URL      : {nsis_url}")

    print("\n" + "=" * 50)
    print("Prossimi passi:")
    print(f"  1. Carica {NSIS.name} su GitHub Releases (tag v{VERSION})")
    print(f"     URL: https://github.com/{GITHUB_REPO}/releases/new?tag=v{VERSION}")
    print(f"  2. Commit e push di backend/update_manifest.json")
    print(f"  3. Deploy backend su Render (o push automatico)")
    print(f"  4. Le app desktop v<{VERSION} riceveranno l'aggiornamento al prossimo avvio")


if __name__ == "__main__":
    main()
