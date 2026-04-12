import logging

from openai import OpenAI

from backend.core.config import OPENAI_API_KEY, OPENAI_MODEL

logger = logging.getLogger(__name__)


def get_openai_client() -> OpenAI:
    """
    Ritorna il client OpenAI configurato.
    Nota sulla Privacy: Per policy standard di OpenAI (API Platform), i dati inviati tramite API
    NON vengono utilizzati per l'addestramento dei modelli.
    Questa configurazione garantisce la riservatezza industriale dei dati di MaintAI.
    """
    if not OPENAI_API_KEY:
        logger.warning("OPENAI_API_KEY non configurata — feature AI non disponibili")
        raise RuntimeError("OPENAI_API_KEY non configurata. Impostare la variabile d'ambiente OPENAI_API_KEY su Render.")

    return OpenAI(api_key=OPENAI_API_KEY)



def get_openai_model() -> str:
    return OPENAI_MODEL
