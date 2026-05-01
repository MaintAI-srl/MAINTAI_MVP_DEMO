import asyncio
import logging
from datetime import datetime, timedelta, timezone

from backend.core.database import SessionLocal
from backend.db.modelli import AssetConditionReading, AttivitaManutenzione, Ticket
from backend.services.condition_maintenance_service import (
    condition_status,
    latest_running_hours_by_asset,
    normalize_trigger_mode,
    TRIGGER_CONDITION,
    TRIGGER_CALENDAR_OR_CONDITION,
)

logger = logging.getLogger("auto_ticket_service")


def _should_generate_calendar(task: AttivitaManutenzione, now: datetime) -> bool:
    """True se il task su calendario è in finestra di generazione."""
    next_due = task.next_due_at
    if next_due is None:
        base = task.last_generated_at or task.ultima_esecuzione
        if base is None:
            # Mai generato → genera subito
            return True
        if base.tzinfo is None:
            base = base.replace(tzinfo=timezone.utc)
        if not task.frequenza_giorni:
            return False
        next_due = base + timedelta(days=task.frequenza_giorni)
    elif next_due.tzinfo is None:
        next_due = next_due.replace(tzinfo=timezone.utc)

    days_before = task.generate_days_before_due or 7
    return next_due <= now + timedelta(days=days_before)


def _create_tickets_for_task(db, task: AttivitaManutenzione, now: datetime, origin: str) -> int:
    """Crea i ticket per un task (con chunking se durata > 8h). Restituisce quanti ticket primi-chunk creati."""
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
            origin_type=origin,
        )
        db.add(ticket)
        ore_rimanenti -= durata_chunk
        chunk_idx += 1

    # Aggiorna metadati task
    task.last_generated_at = now
    if task.frequenza_giorni:
        task.next_due_at = now + timedelta(days=task.frequenza_giorni)

    db.flush()
    return 1


def _run_auto_generation(db) -> int:
    """
    Genera automaticamente ticket per i task con generation_mode='auto'
    Supporta trigger_mode: calendar, condition, calendar_or_condition.
    Restituisce il numero di ticket creati.
    """
    now = datetime.now(timezone.utc)
    created_count = 0

    tasks = (
        db.query(AttivitaManutenzione)
        .filter(
            AttivitaManutenzione.generation_mode == "auto",
            AttivitaManutenzione.task_stato == "active",
        )
        .all()
    )

    if not tasks:
        return 0

    # Carica le letture più recenti per tutti gli asset coinvolti (una sola query)
    asset_ids = {t.asset_id for t in tasks if t.asset_id}
    # Group tasks by tenant for the readings query
    tenant_asset_map: dict[int, set[int]] = {}
    for task in tasks:
        if task.asset_id and task.tenant_id:
            tenant_asset_map.setdefault(task.tenant_id, set()).add(task.asset_id)

    readings: dict[int, AssetConditionReading] = {}
    for tenant_id, aids in tenant_asset_map.items():
        readings.update(latest_running_hours_by_asset(db, tenant_id, aids))

    for task in tasks:
        try:
            trigger_mode = normalize_trigger_mode(getattr(task, "trigger_mode", None))
            latest_reading = readings.get(task.asset_id) if task.asset_id else None
            cond = condition_status(task, latest_reading)

            should_generate = False

            if trigger_mode == TRIGGER_CONDITION:
                # Genera solo se la condizione ore è raggiunta o superata
                should_generate = cond["is_due"]

            elif trigger_mode == TRIGGER_CALENDAR_OR_CONDITION:
                # Genera se condizione raggiunta OPPURE finestra calendario
                cal_ok = bool(task.frequenza_giorni) and _should_generate_calendar(task, now)
                should_generate = cond["is_due"] or cal_ok

            else:
                # Modalità calendario pura (default)
                if not task.frequenza_giorni:
                    continue
                should_generate = _should_generate_calendar(task, now)

            if not should_generate:
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

            origin = "task_auto_generation_condition" if trigger_mode in (TRIGGER_CONDITION, TRIGGER_CALENDAR_OR_CONDITION) and cond["is_due"] else "task_auto_generation"
            _create_tickets_for_task(db, task, now, origin)
            created_count += 1
            logger.info(
                f"Auto-generato ticket per task #{task.id} "
                f"(tenant={task.tenant_id}, trigger={trigger_mode}, cond_is_due={cond['is_due']})"
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
