import logging
import os
from datetime import datetime, timedelta, timezone
from sqlalchemy.orm import Session
from backend.core import storage
from backend.core.database import SessionLocal
from backend.db.modelli import Ticket, TicketAllegato, SystemLog, RevokedToken

logger = logging.getLogger("retention_service")

# Retention log di sicurezza: NIS2 Art.21 / ISO 27002 A.8.15 richiedono MINIMO
# 12 mesi. Il valore è configurabile via env solo verso l'alto: valori sotto i
# 365 giorni vengono riportati al minimo di compliance.
LOG_RETENTION_MIN_DAYS = 365
try:
    LOG_RETENTION_DAYS = max(
        int(os.getenv("LOG_RETENTION_DAYS", str(LOG_RETENTION_MIN_DAYS))),
        LOG_RETENTION_MIN_DAYS,
    )
except ValueError:
    LOG_RETENTION_DAYS = LOG_RETENTION_MIN_DAYS

def cleanup_old_deleted_tickets(db: Session, max_age_days: int = 30):
    """
    Elimina permanentemente i ticket e i relativi file che sono stati soft-deleted 
    da più di max_age_days.
    """
    cutoff = datetime.now(timezone.utc) - timedelta(days=max_age_days)
    
    # Trova ticket degradati (soft-deleted prima del cutoff)
    tickets_to_delete = db.query(Ticket).filter(
        Ticket.deleted_at.is_not(None),
        Ticket.deleted_at < cutoff
    ).all()
    
    deleted_count = 0
    files_deleted_count = 0
    
    for t in tickets_to_delete:
        # 1. Trova e rimuovi allegati fisici
        allegati = db.query(TicketAllegato).filter(TicketAllegato.ticket_id == t.id).all()
        for alg in allegati:
            if alg.percorso:
                try:
                    storage.delete_file(alg.percorso)
                    files_deleted_count += 1
                except Exception as e:
                    logger.error(f"Impossibile rimuovere file {alg.percorso}: {e}")
        
        # 2. Elimina i record (la cascata orm gestirà i record TicketAllegato se configurata, 
        # altrimenti li eliminiamo esplicitamente)
        db.query(TicketAllegato).filter(TicketAllegato.ticket_id == t.id).delete()
        db.delete(t)
        deleted_count += 1
        
    if deleted_count > 0:
        db.commit()
        logger.info(f"Retention Cleanup: eliminati {deleted_count} ticket e {files_deleted_count} file (oltre {max_age_days} giorni).")
    
    return deleted_count

def cleanup_old_system_logs(db: Session, retention_days: int = LOG_RETENTION_DAYS) -> int:
    """
    Rotation dei log di sistema: elimina i SystemLog più vecchi della retention.
    La retention è di MINIMO 12 mesi (NIS2 Art.21, ISO 27002 A.8.15): i log
    dentro la finestra non vengono mai toccati.
    """
    retention_days = max(retention_days, LOG_RETENTION_MIN_DAYS)
    cutoff = datetime.now(timezone.utc) - timedelta(days=retention_days)

    deleted = (
        db.query(SystemLog)
        .filter(SystemLog.timestamp < cutoff)
        .delete(synchronize_session=False)
    )
    if deleted:
        db.commit()
        logger.info(
            f"Retention Log: eliminati {deleted} system_logs più vecchi di {retention_days} giorni."
        )
    return deleted


def cleanup_expired_revoked_tokens(db: Session, max_age_days: int = 30) -> int:
    """
    Pulizia della blacklist JTI: i token hanno vita massima di poche ore/giorni,
    quindi le voci più vecchie di max_age_days sono certamente scadute e la loro
    presenza in blacklist non serve più (il token sarebbe comunque rifiutato per exp).
    """
    cutoff = datetime.now(timezone.utc) - timedelta(days=max_age_days)

    deleted = (
        db.query(RevokedToken)
        .filter(RevokedToken.created_at < cutoff)
        .delete(synchronize_session=False)
    )
    if deleted:
        db.commit()
        logger.info(f"Retention Blacklist: eliminati {deleted} jti revocati più vecchi di {max_age_days} giorni.")
    return deleted


async def run_retention_job():
    """Loop di background per la pulizia giornaliera."""
    import asyncio
    # Esegui ogni 24 ore
    INTERVAL = 86400
    while True:
        try:
            db = SessionLocal()
            try:
                cleanup_old_deleted_tickets(db)
                cleanup_old_system_logs(db)
                cleanup_expired_revoked_tokens(db)
            finally:
                db.close()
        except Exception as e:
            logger.error(f"Errore nel retention job: {e}")

        await asyncio.sleep(INTERVAL)
