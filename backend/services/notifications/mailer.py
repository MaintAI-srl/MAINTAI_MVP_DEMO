"""Invio email transazionali (verifica indirizzo, reset password, benvenuto).

Senza `SMTP_URL` configurato l'email non viene inviata ma **registrata**: in
sviluppo il messaggio finisce nei log applicativi, dove è leggibile senza
montare un server di posta. È l'unica modalità in cui il link di verifica è
recuperabile senza casella reale — e resta una modalità di sviluppo, non un
fallback silenzioso in produzione: lì la mancanza di SMTP viene loggata come
errore, perché un utente che non riceve la mail di verifica è un utente perso.

Formato `SMTP_URL`: `smtp://utente:password@host:porta` oppure
`smtps://...` per TLS implicito. STARTTLS è automatico su porta 587.
"""

from __future__ import annotations

import logging
import os
import smtplib
from email.message import EmailMessage
from urllib.parse import unquote, urlparse

from backend.core.logger_db import db_error, db_info

logger = logging.getLogger(__name__)


def _from_address() -> str:
    return os.getenv("EMAIL_FROM", "MaintAI <no-reply@maintai.local>")


def is_configured() -> bool:
    return bool(os.getenv("SMTP_URL", "").strip())


def send_email(to: str, subject: str, body: str, *, category: str = "generic") -> bool:
    """Invia un'email. Ritorna True se consegnata al server SMTP.

    Non solleva mai: un errore di posta non deve far fallire la registrazione
    (l'utente esiste già, e c'è il reinvio). Fallisce invece *rumorosamente* nei
    log, perché una mail non partita è un problema che va visto.
    """
    smtp_url = os.getenv("SMTP_URL", "").strip()
    if not smtp_url:
        from backend.core.security import IS_PRODUCTION

        if IS_PRODUCTION:
            db_error("EMAIL", "SMTP non configurato: email non inviata", {"to": to, "subject": subject})
        else:
            # In sviluppo il corpo va nei log per intero: contiene il link di
            # verifica, che altrimenti sarebbe irrecuperabile.
            logger.info("[EMAIL non inviata — SMTP assente]\nA: %s\nOggetto: %s\n\n%s", to, subject, body)
        return False

    message = EmailMessage()
    message["From"] = _from_address()
    message["To"] = to
    message["Subject"] = subject
    message.set_content(body)

    try:
        parsed = urlparse(smtp_url)
        host = parsed.hostname or "localhost"
        port = parsed.port or (465 if parsed.scheme == "smtps" else 587)
        username = unquote(parsed.username) if parsed.username else None
        password = unquote(parsed.password) if parsed.password else None

        if parsed.scheme == "smtps":
            server = smtplib.SMTP_SSL(host, port, timeout=15)
        else:
            server = smtplib.SMTP(host, port, timeout=15)
        with server:
            if parsed.scheme != "smtps":
                try:
                    server.starttls()
                except smtplib.SMTPException:
                    logger.warning("SMTP: STARTTLS non disponibile su %s:%s", host, port)
            if username and password:
                server.login(username, password)
            server.send_message(message)

        db_info("EMAIL", f"Email inviata: {subject}", {"to": to, "categoria": category})
        return True
    except Exception as exc:
        # Il corpo non finisce nei log: può contenere token monouso.
        db_error("EMAIL", f"Invio email fallito: {exc}", {"to": to, "subject": subject})
        logger.exception("SMTP: invio fallito verso %s", to)
        return False
