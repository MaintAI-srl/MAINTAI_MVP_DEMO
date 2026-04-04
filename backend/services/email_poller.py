import os
import time
import logging
from datetime import datetime, timezone
from sqlalchemy.orm import Session
from imap_tools import MailBox, AND
from backend.core.database import SessionLocal
from backend.db.modelli import EmailConfig, Ticket, TicketAllegato
import mimetypes

logger = logging.getLogger("email_poller")

# Configurazione logger (se non già configurato a livello root)
if not logger.handlers:
    ch = logging.StreamHandler()
    formatter = logging.Formatter('%(asctime)s - %(name)s - %(levelname)s - %(message)s')
    ch.setFormatter(formatter)
    logger.addHandler(ch)
    logger.setLevel(logging.INFO)

UPLOAD_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(__file__))), "frontend", "public", "uploads")
os.makedirs(UPLOAD_DIR, exist_ok=True)

def parse_and_create_tickets(db: Session, config: EmailConfig):
    try:
        # Tenta connessione
        with MailBox(config.imap_server, port=config.imap_port).login(config.email_address, config.password) as mailbox:
            # Cerca solo UNSEEN e le marca automaticamente come viste
            messages = mailbox.fetch(AND(seen=False), mark_seen=True)
            for msg in messages:
                # 1. Parsing base
                subject = msg.subject or "Ticket senza oggetto (da Email)"
                sender = msg.from_
                date_str = "Sconosciuta"
                if msg.date:
                    date_str = msg.date.strftime('%Y-%m-%d %H:%M:%S')

                # Preferiamo il plain text, altrimenti fallback ad HTML
                body = msg.text or msg.html or "Nessun corpo del messaggio fornito."
                
                descrizione = (
                    "--- Ticket generato automaticamente da Email ---\n\n"
                    f"Da: {sender}\n"
                    f"Data: {date_str}\n\n"
                    f"{body}"
                )

                # 2. Creazione Record Ticket
                titolo = (subject[:97] + "...") if len(subject) > 100 else subject
                
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
                    # Sanitize filename
                    safe_filename = "".join([c for c in att.filename if c.isalpha() or c.isdigit() or c in ' .-_']).rstrip()
                    if not safe_filename:
                        safe_filename = "allegato_sconosciuto"
                        
                    timestamp = int(time.time())
                    hashed_filename = f"{new_ticket.id}_{timestamp}_{safe_filename}"
                    file_path = os.path.join(UPLOAD_DIR, hashed_filename)
                    
                    # Salva su filesystem
                    with open(file_path, "wb") as f:
                        f.write(att.payload)
                        
                    mime_type, _ = mimetypes.guess_type(safe_filename)
                    dimensione = len(att.payload)
                    
                    nuovo_allegato = TicketAllegato(
                        ticket_id=new_ticket.id,
                        nome_file=safe_filename,
                        percorso=f"/uploads/{hashed_filename}", # Path servibile dal backend/frontend
                        tipo_mime=mime_type or "application/octet-stream",
                        dimensione_bytes=dimensione,
                        tenant_id=config.tenant_id
                    )
                    db.add(nuovo_allegato)
                
                if msg.attachments:
                    db.commit()
                    
                logger.info(f"Creato Ticket #{new_ticket.id} da email mittente {sender}")

    except Exception as e:
        logger.error(f"Errore connessione/operazione IMAP - tenant {config.tenant_id} - user {config.email_address}: {str(e)}")

def check_all_mailboxes():
    db = SessionLocal()
    try:
        active_configs = db.query(EmailConfig).filter(EmailConfig.active == True).all()
        for config in active_configs:
            parse_and_create_tickets(db, config)
    finally:
        db.close()
