import logging
from datetime import datetime, timedelta, timezone
from sqlalchemy.orm import Session
from backend.core import storage
from backend.core.database import SessionLocal
from backend.db.modelli import Ticket, TicketAllegato, RevokedToken

logger = logging.getLogger("retention_service")

# I token JWT scadono dopo ACCESS_TOKEN_EXPIRE_MINUTES (7 giorni): una volta
# scaduti, la voce nella blacklist è inutile. Manteniamo un margine di sicurezza.
REVOKED_TOKEN_RETENTION_DAYS = 8


def cleanup_expired_revoked_tokens(db: Session, max_age_days: int = REVOKED_TOKEN_RETENTION_DAYS) -> int:
    """
    Elimina dalla blacklist i jti revocati più vecchi di max_age_days: il token
    originale è ormai scaduto per TTL, quindi la voce non serve più. Evita la
    crescita illimitata della tabella revoked_tokens.
    """
    cutoff = datetime.now(timezone.utc) - timedelta(days=max_age_days)
    deleted = (
        db.query(RevokedToken)
        .filter(RevokedToken.created_at < cutoff)
        .delete(synchronize_session=False)
    )
    if deleted:
        db.commit()
        logger.info("Retention Cleanup: eliminati %d token revocati scaduti (oltre %d giorni).", deleted, max_age_days)
    return deleted

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
                cleanup_expired_revoked_tokens(db)
            finally:
                db.close()
        except Exception as e:
            logger.error(f"Errore nel retention job: {e}")
            
        await asyncio.sleep(INTERVAL)
