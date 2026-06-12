"""
Modulo centralizzato per il rate limiting.

Usa slowapi. Il key_func legge l'IP reale del client anche dietro
Cloudflare / Render proxy (CF-Connecting-IP → X-Forwarded-For → REMOTE_ADDR).

Fiducia negli header proxy
--------------------------
Gli header `CF-Connecting-IP` e `X-Forwarded-For` sono spoofabili se l'app
NON è dietro un reverse proxy che li sovrascrive. Vengono quindi onorati solo
se `TRUST_PROXY_HEADERS` è attivo (default: attivo, perché il deploy di
riferimento è Render — che sanifica `X-Forwarded-For` — eventualmente dietro
Cloudflare). Per deployment esposti direttamente a internet senza proxy
impostare `TRUST_PROXY_HEADERS=0`, altrimenti un client può eludere il rate
limit forgiando l'header.

Limite noto (documentato, accepted risk)
----------------------------------------
I contatori slowapi sono **in-memory per processo**: con N worker uvicorn il
limite effettivo è ~N volte quello dichiarato e i contatori si azzerano al
restart. Il deploy attuale usa un singolo worker; per scalare orizzontalmente
serve uno storage condiviso (es. `Limiter(storage_uri="redis://...")`).
"""

import os

from fastapi import Request

_TRUST_PROXY_HEADERS = os.getenv("TRUST_PROXY_HEADERS", "1").lower() in ("1", "true", "yes")


def _real_client_ip(request: Request) -> str:
    """
    Restituisce l'IP reale del client, attraversando i proxy Cloudflare e Render.
    Priorità: CF-Connecting-IP > X-Forwarded-For (primo hop) > client.host.
    Gli header proxy sono ignorati se TRUST_PROXY_HEADERS è disattivo.
    """
    if _TRUST_PROXY_HEADERS:
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
