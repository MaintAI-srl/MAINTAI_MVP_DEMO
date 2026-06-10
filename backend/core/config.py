import os
from pathlib import Path

from dotenv import load_dotenv

from backend.core.logging_config import get_logger

logger = get_logger(__name__)

BASE_DIR = Path(__file__).resolve().parent.parent
ENV_PATH = BASE_DIR / ".env"

if ENV_PATH.exists():
    load_dotenv(ENV_PATH)

# Legge la chiave sia in maiuscolo (Render/produzione) che in minuscolo (.env locale)
OPENAI_API_KEY = os.getenv("OPENAI_API_KEY") or os.getenv("openai_api_key", "")
OPENAI_MODEL = os.getenv("OPENAI_MODEL") or os.getenv("openai_model", "gpt-4.1-mini")

# Versioning
VERSION = "3.3.1"
BUILD_DATE = "2026-06-10"


def init_backend() -> None:
    """
    Inizializzazione base del backend:
    - carica .env
    - verifica configurazione runtime di base
    """
    logger.info("INIT BACKEND START")

    if ENV_PATH.exists():
        logger.info(".env caricato da %s", ENV_PATH)
    else:
        logger.warning(".env NON trovato — variabili d'ambiente da OS (ok in deploy)")

    if OPENAI_API_KEY:
        logger.info("OpenAI API key presente")
    else:
        logger.warning("OpenAI API key NON presente — le feature AI saranno disabilitate")

    logger.info("Inizializzazione schema DB demandata a lifespan/init_db")

    logger.info("INIT BACKEND END")
