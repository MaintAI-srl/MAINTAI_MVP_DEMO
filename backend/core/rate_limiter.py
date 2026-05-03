"""
Modulo centralizzato per il rate limiting.

Usa slowapi. Il key_func legge l'IP reale del client anche dietro
Cloudflare / Render proxy (CF-Connecting-IP → X-Forwarded-For → REMOTE_ADDR).
"""

from fastapi import Request

def _real_client_ip(request: Request) -> str:
    """
    Restituisce l'IP reale del client, attraversando i proxy Cloudflare e Render.
    Priorità: CF-Connecting-IP > X-Forwarded-For (primo hop) > client.host
    """
    cf_ip = request.headers.get("cf-connecting-ip")
    if cf_ip:
        return cf_ip.strip()

    forwarded = request.headers.get("x-forwarded-for")
    if forwarded:
        return forwarded.split(",")[0].strip()

    if request.client:
        return request.client.host

    return "unknown"


try:
    from slowapi import Limiter

    limiter = Limiter(key_func=_real_client_ip)
    RATE_LIMITING_AVAILABLE = True
except ImportError as exc:
    raise RuntimeError(
        "\n"
        "FATAL: dipendenza 'slowapi' mancante.\n"
        "Il rate limiting è obbligatorio per proteggere gli endpoint (es. login) dal brute-force.\n"
        "Installa slowapi: pip install slowapi\n"
    ) from exc
