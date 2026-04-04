import os
from pathlib import Path

from dotenv import load_dotenv

from backend.core.database import engine, Base
from backend.core.logging_config import get_logger

logger = get_logger(__name__)

BASE_DIR = Path(__file__).resolve().parent.parent
ENV_PATH = BASE_DIR / ".env"

if ENV_PATH.exists():
    load_dotenv(ENV_PATH)

OPENAI_API_KEY = os.getenv("OPENAI_API_KEY", "")
OPENAI_MODEL = os.getenv("OPENAI_MODEL", "gpt-4.1-mini")

# Versioning
VERSION = "1.6.4"
BUILD_DATE = "2026-04-04"


def init_backend() -> None:
    """
    Inizializzazione base del backend:
    - carica .env
    - inizializza DB
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

    try:
        Base.metadata.create_all(bind=engine)
        logger.info("Database inizializzato")
    except Exception as e:
        logger.error("ERRORE inizializzazione DB: %s", str(e))

    logger.info("INIT BACKEND END")