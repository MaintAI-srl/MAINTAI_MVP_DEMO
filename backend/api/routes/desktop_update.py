"""
Endpoint per l'auto-updater Tauri 2 di MaintAI Desktop.

GET /desktop/update — restituisce il manifest dell'ultima versione disponibile.
Il manifest viene letto da backend/update_manifest.json, aggiornato ad ogni release
dallo script scripts/prepare_update.py.

Questo endpoint NON richiede autenticazione: il client Tauri lo interroga prima
del login. La sicurezza è garantita dalla firma crittografica dell'installer
(minisign keypair generata con `tauri signer generate`).
"""

import json
import os
import logging

from fastapi import APIRouter
from fastapi.responses import JSONResponse, Response

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/desktop", tags=["desktop"])

# Percorso assoluto del manifest, relativo a questo file
_UPDATE_MANIFEST = os.path.join(
    os.path.dirname(__file__),
    "..",
    "..",
    "update_manifest.json",
)


@router.get("/update", summary="Manifest aggiornamento MaintAI Desktop")
async def get_update_manifest():
    """
    Endpoint interrogato dall'auto-updater Tauri all'avvio dell'app desktop.

    Restituisce il manifest JSON con versione, note di rilascio, data e URL
    dell'installer firmato per ogni piattaforma.

    Se il manifest non esiste o non contiene una versione valida, risponde 204
    (nessun aggiornamento disponibile) in modo che Tauri non mostri errori.
    """
    manifest_path = os.path.abspath(_UPDATE_MANIFEST)
    try:
        with open(manifest_path, "r", encoding="utf-8") as f:
            manifest = json.load(f)
    except FileNotFoundError:
        logger.info("desktop/update: manifest non trovato, nessun aggiornamento disponibile")
        return Response(status_code=204)
    except json.JSONDecodeError as exc:
        logger.error("desktop/update: manifest JSON non valido: %s", exc)
        return Response(status_code=204)

    # Valida campi minimi attesi da Tauri
    version = manifest.get("version", "").strip()
    if not version:
        logger.info("desktop/update: manifest senza versione, nessun aggiornamento disponibile")
        return Response(status_code=204)

    # Verifica che almeno una piattaforma abbia URL e firma valorizzati
    platforms = manifest.get("platforms", {})
    has_valid_platform = any(
        p.get("url") and p.get("signature")
        for p in platforms.values()
    )
    if not has_valid_platform:
        logger.info("desktop/update: manifest senza piattaforme valide (url/signature vuoti)")
        return Response(status_code=204)

    logger.info("desktop/update: manifest v%s restituito", version)
    return JSONResponse(content=manifest)
