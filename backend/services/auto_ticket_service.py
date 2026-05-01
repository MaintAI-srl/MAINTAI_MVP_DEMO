import asyncio
import logging
from datetime import datetime, timedelta, timezone

from backend.core.database import SessionLocal
from backend.db.modelli import AttivitaManutenzione, Ticket

logger = logging.getLogger("auto_ticket_service")


def _run_auto_generation(db) -> int:
    """
    Genera automaticamente ticket per i task con generation_mode='auto'
    la cui prossima scadenza rientra nella finestra generate_days_before_due.
    Restituisce il numero di ticket creati.
    """
    now = datetime.now(timezone.utc)
    created_count = 0

    tasks = (
        db.query(AttivitaManutenzione)
        .filter(
            AttivitaManutenzione.generation_mode == "auto",
            AttivitaManutenzione.task_stato == "active",
            AttivitaManutenzione.frequenza_giorni.isnot(None),
        )
        .all()
    )

    for task in tasks:
        try:
            # Calcola prossima scadenza
            next_due = task.next_due_at
            if next_due is None:
                base = task.last_generated_at or task.ultima_esecuzione
                if base is None:
                    # Mai generato: genera subito
                    next_due = now
                else:
                    if base.tzinfo is None:
                        base = base.replace(tzinfo=timezone.utc)
                    next_due = base + timedelta(days=task.frequenza_giorni)
            elif next_due.tzinfo is None:
                next_due = next_due.replace(tzinfo=timezone.utc)

            days_before = task.generate_days_before_due or 7
            # Genera solo se la scadenza è entro la finestra di anticipo
            if next_due > now + timedelta(days=days_before):
                continue

            # Non generare se esiste già un ticket attivo per questo task
            existing = (
                db.query(Ticket)
                .filter(
                    Ticket.attivita_manutenzione_id == task.id,
                    Ticket.stato.in_(["Aperto", "Pianificato", "In corso"]),
                    Ticket.deleted_at.is_(None),
                )
                .first()
            )
            if existing:
                continue

            # Crea ticket (con chunking se durata > 8h)
            durata = float(task.durata_ore) if task.durata_ore else 1.0
            ore_rimanenti = durata
            chunk_idx = 1
            num_chunks = int(ore_rimanenti // 8) + (1 if ore_rimanenti % 8 > 0 else 0)

            while ore_rimanenti > 0:
                durata_chunk = min(8.0, ore_rimanenti)
                titolo_base = (task.nome or (task.descrizione[:120] if task.descrizione else f"Task #{task.id}"))[:120]
                titolo = f"{titolo_base} (Parte {chunk_idx}/{num_chunks})" if num_chunks > 1 else titolo_base

                ticket = Ticket(
                    titolo=titolo,
                    asset_id=task.asset_id,
                    tipo="PM",
                    priorita=task.priorita or "Media",
                    stato="Aperto",
                    durata_stimata_ore=durata_chunk,
                    fascia_oraria="diurna",
                    descrizione=task.descrizione or "",
                    attivita_manutenzione_id=task.id,
                    tenant_id=task.tenant_id,
                    origin_type="task_auto_generation",
                )
                db.add(ticket)
                ore_rimanenti -= durata_chunk
                chunk_idx += 1

            # Aggiorna metadati task
            task.last_generated_at = now
            task.next_due_at = now + timedelta(days=task.frequenza_giorni)

            db.flush()
            created_count += 1
            logger.info(
                f"Auto-generato ticket per task #{task.id} "
                f"(tenant={task.tenant_id}, next_due={next_due.date()})"
            )

        except Exception as exc:
            logger.error(f"Errore auto-generazione task #{task.id}: {exc}")

    if created_count > 0:
        db.commit()
        logger.info(f"Auto-ticket job: {created_count} ticket generati.")

    return created_count


async def run_auto_ticket_job():
    """Loop di background: controlla ogni ora se ci sono ticket da generare automaticamente."""
    INTERVAL = 3600  # 1 ora
    while True:
        try:
            db = SessionLocal()
            try:
                _run_auto_generation(db)
            finally:
                db.close()
        except Exception as exc:
            logger.error(f"Errore nel auto-ticket job: {exc}")

        await asyncio.sleep(INTERVAL)
