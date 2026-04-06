"""
Modulo centralizzato per il rate limiting.

Usa slowapi se disponibile; altrimenti fornisce un no-op stub
per garantire che il codice funzioni anche senza la dipendenza installata.
"""

try:
    from slowapi import Limiter
    from slowapi.util import get_remote_address

    limiter = Limiter(key_func=get_remote_address)
    RATE_LIMITING_AVAILABLE = True
except ImportError:
    # Stub no-op: i decorator @limiter.limit(...) non fanno nulla
    class _NoOpLimiter:
        def limit(self, *args, **kwargs):
            def decorator(func):
                return func
            return decorator

    limiter = _NoOpLimiter()
    RATE_LIMITING_AVAILABLE = False
