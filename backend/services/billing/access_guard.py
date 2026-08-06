"""Gate di scrittura per abbonamenti non in regola (modalità sola lettura).

Implementato come **dependency dei router**, non come middleware HTTP, per una
ragione precisa: il middleware dovrebbe aprirsi una sessione con `SessionLocal`,
scavalcando sia il routing demo/produzione di `get_db` sia gli override nei
test. Una dependency riceve la stessa sessione della richiesta e quindi si
comporta allo stesso modo in locale, in demo, in cloud e in test.

Cosa blocca: solo i metodi mutanti (POST/PUT/PATCH/DELETE) sui router di
prodotto. Restano sempre raggiungibili — anche a pagamento scaduto —
autenticazione, abbonamento, moduli, health ed **export**, perché sono i
percorsi con cui un cliente rientra in regola o porta via i propri dati.
"""

from __future__ import annotations

import time

from fastapi import Depends, Request
from sqlalchemy.orm import Session

from backend.core.dependencies import get_db
from backend.core.security import decode_payload_leniently, resolve_tenant_id_leniently
from backend.services.billing.entitlement_service import (
    ACCESS_FULL,
    resolve_entitlements,
)

MUTATING_METHODS = {"POST", "PUT", "PATCH", "DELETE"}

# Percorsi sempre consentiti, anche in sola lettura. Confronto per prefisso
# sul path della richiesta.
ALWAYS_ALLOWED_PREFIXES = (
    "/auth",
    "/billing",
    "/public",
    "/health",
    "/modules",
    "/v1/auth",
    "/v1/modules",
)

# Sotto-percorsi di export: un cliente moroso deve poter portare via i suoi dati.
# È anche un requisito di portabilità (GDPR art. 20), non solo una cortesia.
EXPORT_MARKERS = ("/export", "/esporta", "/download")


# Cache di processo con TTL breve, stessa scelta (e stesso rischio accettato)
# della configurazione moduli: evita una query per ogni richiesta mutante senza
# introdurre un'infrastruttura di cache condivisa.
_CACHE_TTL_SECONDS = 15.0
_cache: dict[int, tuple[float, str]] = {}


def invalidate_access_cache(tenant_id: int | None = None) -> None:
    """Da chiamare a ogni transizione di stato dell'abbonamento.

    Senza questo, un cliente che paga resterebbe in sola lettura fino a 15
    secondi dopo — brevissimo per noi, eternità per chi ha appena inserito la
    carta e vede ancora l'app bloccata.
    """
    if tenant_id is None:
        _cache.clear()
    else:
        _cache.pop(tenant_id, None)


def _cached_access_level(db: Session, tenant_id: int) -> str:
    now = time.monotonic()
    cached = _cache.get(tenant_id)
    if cached and cached[0] > now:
        return cached[1]
    level = resolve_entitlements(db, tenant_id).access_level
    _cache[tenant_id] = (now + _CACHE_TTL_SECONDS, level)
    return level


def _is_exempt(path: str) -> bool:
    if any(path.startswith(prefix) for prefix in ALWAYS_ALLOWED_PREFIXES):
        return True
    return any(marker in path for marker in EXPORT_MARKERS)


def enforce_write_access(request: Request, db: Session = Depends(get_db)) -> None:
    """Dependency: blocca le scritture quando l'abbonamento non è in regola."""
    if request.method not in MUTATING_METHODS:
        return
    if _is_exempt(request.url.path):
        return

    payload = decode_payload_leniently(request)
    if not payload:
        # Nessun token: l'autenticazione dell'endpoint dirà la sua. Non è
        # compito di questo gate produrre 401.
        return
    if payload.get("ruolo") == "superadmin":
        # Il superadmin opera *sui* tenant, incluso rimetterli in regola:
        # bloccarlo per lo stato commerciale del tenant impersonato sarebbe un
        # autogol operativo.
        return

    tenant_id = resolve_tenant_id_leniently(request, payload)
    if tenant_id is None:
        return

    try:
        level = _cached_access_level(db, tenant_id)
    except Exception:
        # Il livello commerciale non deve mai far cadere una richiesta: se non
        # si riesce a stabilire lo stato, si lascia passare (fail-open
        # deliberato — vedi la nota su retrocompatibilità in entitlement_service).
        return

    if level != ACCESS_FULL:
        from backend.services.billing.entitlement_service import require_write_access

        require_write_access(db, tenant_id)
