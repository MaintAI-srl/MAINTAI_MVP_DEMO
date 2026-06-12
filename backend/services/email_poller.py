import os
import re
import uuid
import logging
from html import unescape
from sqlalchemy.orm import Session
from imap_tools import MailBox, AND
from backend.core.database import SessionLocal
from backend.db.modelli import EmailConfig, Ticket, TicketAllegato, Tenant
from backend.core.security import decrypt_data
from backend.core.logger_db import db_info, db_error
from backend.core import storage
import mimetypes

from backend.services.ai.anonymization_service import anonymizer
from backend.core.file_validation import validate_upload

logger = logging.getLogger("email_poller")
ALLOWED_EXTENSIONS = {'.pdf', '.jpg', '.jpeg', '.png', '.docx', '.xlsx', '.csv', '.txt'}
MAX_EMAIL_ATTACHMENT_BYTES = 20 * 1024 * 1024  # 20 MB
HTML_TAG_RE = re.compile(r"<[^>]+>")

# Configurazione logger (se non già configurato a livello root)
if not logger.handlers:
    ch = logging.StreamHandler()
    formatter = logging.Formatter('%(asctime)s - %(name)s - %(levelname)s - %(message)s')
    ch.setFormatter(formatter)
    logger.addHandler(ch)
    logger.setLevel(logging.INFO)

def _html_to_text(html: str) -> str:
    text = HTML_TAG_RE.sub(" ", html or "")
    return re.sub(r"\s+", " ", unescape(text)).strip()


def _message_body_text(msg) -> str:
    if msg.text:
        return msg.text
    if msg.html:
        return _html_to_text(msg.html)
    return "Nessun corpo del messaggio fornito."


def _safe_attachment_name(filename: str | None) -> str:
    raw = filename or "allegato_sconosciuto"
    safe = "".join(c for c in raw if c.isalnum() or c in " .-_").strip(" .")
    return safe or "allegato_sconosciuto"

def parse_and_create_tickets(db: Session, config: EmailConfig):
    try:
        # Decifratura password se necessario (supporto legacy per password in chiaro)
        imap_pass = decrypt_data(config.password) if config.is_encrypted else config.password
        
        # Tenta connessione
        with MailBox(config.imap_server, port=config.imap_port).login(config.email_address, imap_pass) as mailbox:
            # Cerca solo UNSEEN e le marca automaticamente come viste
            messages = mailbox.fetch(AND(seen=False), mark_seen=True)
            for msg in messages:
                # 1. Parsing base
                subject = msg.subject or "Ticket senza oggetto (da Email)"
                # Anonymize sender and subject for security (F-13.1)
                safe_sender = anonymizer.mask_text(msg.from_ or "")
                safe_subject = anonymizer.mask_text(subject)
                
                date_str = "Sconosciuta"
                if msg.date:
                    date_str = msg.date.strftime('%Y-%m-%d %H:%M:%S')

                # Preferiamo il plain text; l'HTML viene convertito per evitare markup nel ticket.
                body = _message_body_text(msg)
                
                # Anonymize body before saving (GDPR F-13)
                safe_body = anonymizer.mask_text(body)
                
                descrizione = (
                    "--- Ticket generato automaticamente da Email ---\n\n"
                    f"Da: {safe_sender}\n"
                    f"Data: {date_str}\n\n"
                    f"{safe_body}"
                )

                # 2. Creazione Record Ticket
                titolo = (safe_subject[:97] + "...") if len(safe_subject) > 100 else safe_subject
                
                new_ticket = Ticket(
                    titolo=titolo,
                    descrizione=descrizione,
                    asset_id=config.default_asset_id,
                    tipo="CM",
                    priorita="Media",
                    stato="Aperto",
                    tenant_id=config.tenant_id,
                    durata_stimata_ore=1.0,
                    fascia_oraria="diurna",
                )
                db.add(new_ticket)
                db.commit()
                db.refresh(new_ticket)

                # 3. Gestione Allegati (immagini, pdf...)
                for att in msg.attachments:
                    safe_filename = _safe_attachment_name(att.filename)

                    # Whitelist check (F-09)
                    _, ext = os.path.splitext(safe_filename.lower())
                    if ext not in ALLOWED_EXTENSIONS:
                        logger.warning("Allegato ignorato (estensione non permessa): %s", safe_filename)
                        continue

                    payload = att.payload or b""
                    dimensione = len(payload)
                    if dimensione > MAX_EMAIL_ATTACHMENT_BYTES:
                        logger.warning(
                            "Allegato ignorato (troppo grande): %s (%d byte)",
                            safe_filename,
                            dimensione,
                        )
                        continue

                    # Validazione magic bytes + contenuto (non blocca la creazione del ticket)
                    allowed_exts_plain = {e.lstrip(".") for e in ALLOWED_EXTENSIONS}
                    try:
                        validate_upload(payload, safe_filename, allowed_exts_plain)
                    except ValueError as val_err:
                        logger.warning(
                            "Allegato email ignorato (validazione fallita): %s — %s",
                            safe_filename,
                            val_err,
                        )
                        continue

                    stored_filename = f"email_{new_ticket.id}_{uuid.uuid4().hex[:8]}_{safe_filename}"
                    url = storage.save_file(payload, stored_filename)
                        
                    mime_type, _ = mimetypes.guess_type(safe_filename)
                    
                    nuovo_allegato = TicketAllegato(
                        ticket_id=new_ticket.id,
                        nome_file=safe_filename,
                        percorso=url,
                        tipo_mime=mime_type or "application/octet-stream",
                        dimensione_bytes=dimensione,
                        tenant_id=config.tenant_id
                    )
                    db.add(nuovo_allegato)
                
                if msg.attachments:
                    db.commit()
                    
                msg_log = f"Creato Ticket #{new_ticket.id} da email mittente {safe_sender}"
                logger.info(msg_log)
                db_info("EMAIL_POLLER", msg_log, {"ticket_id": new_ticket.id, "sender": safe_sender}, config.tenant_id)

    except Exception as e:
        safe_account = anonymizer.mask_text(config.email_address or "")
        err_msg = f"Errore IMAP - tenant {config.tenant_id} ({safe_account}): {str(e)}"
        logger.error(err_msg)
        db_error("EMAIL_POLLER", err_msg, {"error": str(e)}, config.tenant_id)

def check_all_mailboxes():
    db = SessionLocal()
    try:
        active_configs = (
            db.query(EmailConfig)
            .join(Tenant, EmailConfig.tenant_id == Tenant.id)
            .filter(EmailConfig.active == True, Tenant.is_active == True)
            .all()
        )
        for config in active_configs:
            parse_and_create_tickets(db, config)
    finally:
        db.close()
