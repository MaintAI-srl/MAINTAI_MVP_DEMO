"""
Security monitor — rilevamento base di intrusioni sul flusso di autenticazione.

ISO 27002 A.8.16 (monitoring activities) / NIS2 Art.21 §2b — SEC-008.

Tiene contatori in-memory a finestra scorrevole sui login falliti e scrive un
alert persistente in SystemLog (livello ERROR, modulo SECURITY) quando vengono
superate le soglie. L'alert viene emesso una sola volta per finestra per non
inondare il log.

Limiti noti (accettati per l'architettura attuale a singolo processo Render):
- stato in-memory: i contatori si azzerano al riavvio del processo;
- in deployment multi-worker i contatori sono per-worker (le soglie restano
  comunque un segnale utile, sommato al rate limiting slowapi per-IP).
"""

import threading
import time

from backend.core.logger_db import db_error

# Soglie: N login falliti nella finestra → alert
FAILED_LOGIN_WINDOW_SECONDS = 300   # 5 minuti
FAILED_LOGIN_USER_THRESHOLD = 10    # stesso username
FAILED_LOGIN_IP_THRESHOLD = 30      # stesso IP (anche su username diversi)

_lock = threading.Lock()
_failures_by_user: dict[str, list[float]] = {}
_failures_by_ip: dict[str, list[float]] = {}
_alerted_users: dict[str, float] = {}
_alerted_ips: dict[str, float] = {}


def _prune(events: list[float], now: float) -> list[float]:
    cutoff = now - FAILED_LOGIN_WINDOW_SECONDS
    return [t for t in events if t >= cutoff]


def record_failed_login(username: str, ip: str) -> None:
    """Registra un login fallito e scrive un alert in SystemLog oltre soglia."""
    now = time.monotonic()
    alerts: list[tuple[str, dict]] = []

    with _lock:
        user_events = _prune(_failures_by_user.get(username, []), now)
        user_events.append(now)
        _failures_by_user[username] = user_events

        ip_events = _prune(_failures_by_ip.get(ip, []), now)
        ip_events.append(now)
        _failures_by_ip[ip] = ip_events

        if len(user_events) >= FAILED_LOGIN_USER_THRESHOLD:
            last_alert = _alerted_users.get(username, 0.0)
            if now - last_alert >= FAILED_LOGIN_WINDOW_SECONDS:
                _alerted_users[username] = now
                alerts.append((
                    f"Possibile brute-force: {len(user_events)} login falliti per "
                    f"l'utente '{username}' in {FAILED_LOGIN_WINDOW_SECONDS // 60} minuti",
                    {"username": username, "ip": ip, "failed_attempts": len(user_events)},
                ))

        if len(ip_events) >= FAILED_LOGIN_IP_THRESHOLD:
            last_alert = _alerted_ips.get(ip, 0.0)
            if now - last_alert >= FAILED_LOGIN_WINDOW_SECONDS:
                _alerted_ips[ip] = now
                alerts.append((
                    f"Possibile attacco distribuito: {len(ip_events)} login falliti "
                    f"dall'IP {ip} in {FAILED_LOGIN_WINDOW_SECONDS // 60} minuti",
                    {"ip": ip, "failed_attempts": len(ip_events)},
                ))

    # Scrittura log fuori dal lock (apre una sessione DB)
    for message, extra in alerts:
        db_error("SECURITY", message, extra)


def record_successful_login(username: str) -> None:
    """Azzera il contatore dell'utente dopo un login riuscito."""
    with _lock:
        _failures_by_user.pop(username, None)
        _alerted_users.pop(username, None)
