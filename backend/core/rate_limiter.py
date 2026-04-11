"""
Modulo centralizzato per il rate limiting.

Usa slowapi. Obbligatorio per la sicurezza degli endpoint esposti.
"""

try:
    from slowapi import Limiter
    from slowapi.util import get_remote_address

    limiter = Limiter(key_func=get_remote_address)
    RATE_LIMITING_AVAILABLE = True
except ImportError as exc:
    raise RuntimeError(
        "\n"
        "FATAL: dipendenza 'slowapi' mancante.\n"
        "Il rate limiting è obbligatorio per proteggere gli endpoint (es. login) dal brute-force.\n"
        "Installa slowapi: pip install slowapi\n"
    ) from exc
