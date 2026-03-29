from openai import OpenAI

from backend.core.config import OPENAI_API_KEY, OPENAI_MODEL


def get_openai_client() -> OpenAI:
    """
    Ritorna il client OpenAI configurato. 
    Nota sulla Privacy: Per policy standard di OpenAI (API Platform), i dati inviati tramite API 
    NON vengono utilizzati per l'addestramento dei modelli. 
    Questa configurazione garantisce la riservatezza industriale dei dati di MaintAI.
    """
    if not OPENAI_API_KEY:
        logger.error("OPENAI_API_KEY non configurata nel file .env")
        raise RuntimeError("OPENAI_API_KEY non configurata")

    return OpenAI(api_key=OPENAI_API_KEY)



def get_openai_model() -> str:
    return OPENAI_MODEL
