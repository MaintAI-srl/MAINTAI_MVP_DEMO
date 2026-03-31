from datetime import date, datetime

from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel
from sqlalchemy.orm import Session

from backend.core.dependencies import get_db
from backend.core.security import get_current_tenant_id
from backend.db.modelli import Ticket, Asset, Tecnico, Impianto
from backend.services.scheduler_service import generate_plan
from backend.services.weather_service import get_forecast_for_scheduler


router = APIRouter()

STATI_ATTIVI = ("Aperto", "Pianificato", "In corso")


class RicalcolaRequest(BaseModel):
    start_date: str | None = None


def _parse_date(s: str | None) -> date:
    if s:
        try:
            return date.fromisoformat(s)
        except ValueError:
            pass
    return date.today()


def _load_tickets(db: Session, tenant_id: int) -> list[dict]:
    return [
        {
            "id": t.id,
            "titolo": t.titolo,
            "asset_id": t.asset_id,
            "priorita": t.priorita or "Bassa",
            "fascia_oraria": t.fascia_oraria or "diurna",
            "durata_stimata_ore": t.durata_stimata_ore or 1,
            "tecnico_id": t.tecnico_id,
            "planned_start": t.planned_start.isoformat() if t.planned_start else None,
            "planned_finish": t.planned_finish.isoformat() if t.planned_finish else None,
        }
        for t in db.query(Ticket).filter(
            Ticket.tenant_id == tenant_id,
            Ticket.stato.in_(STATI_ATTIVI),
        ).all()
    ]


def _load_tecnici(db: Session, tenant_id: int) -> list[dict]:
    return [
        {
            "id": t.id,
            "nome": t.nome,
            "skill": t.competenze or "",
            "ore_giornaliere": t.ore_giornaliere or 8,
            "stato": t.stato or "in servizio",
        }
        for t in db.query(Tecnico).filter(Tecnico.tenant_id == tenant_id).all()
    ]


def _load_assenze(db: Session, tenant_id: int) -> list[dict]:
    from backend.db.modelli import TecnicoAssenza
    return [
        {
            "tecnico_id": a.tecnico_id,
            "data_inizio": a.data_inizio,
            "data_fine": a.data_fine,
            "tipo_assenza": a.tipo_assenza,
        }
        for a in db.query(TecnicoAssenza).join(
            Tecnico, TecnicoAssenza.tecnico_id == Tecnico.id
        ).filter(Tecnico.tenant_id == tenant_id).all()
    ]


def _load_assets(db: Session, tenant_id: int) -> dict[int, dict]:
    return {
        a.id: {
            "name": a.nome,
            "vincolo_orario": a.vincolo_orario or "",
            "weather_sunny_required": a.weather_sunny_required,
            "weather_max_wind_kmh": a.weather_max_wind_kmh,
            "weather_max_rain_mm": a.weather_max_rain_mm,
        }
        for a in db.query(Asset).filter(Asset.tenant_id == tenant_id).all()
    }


async def _get_forecast(db: Session) -> dict:
    impianto = db.query(Impianto).filter(Impianto.latitude.isnot(None)).first()
    if impianto:
        lat, lon = impianto.latitude, impianto.longitude
    else:
        lat, lon = 44.307, 8.481
    return await get_forecast_for_scheduler(lat, lon)


@router.get("/scheduler/gantt")
async def scheduler_gantt(
    start_date: str | None = Query(None),
    db: Session = Depends(get_db),
    tenant_id: int = Depends(get_current_tenant_id),
):
    forecast = await _get_forecast(db)
    assets_meta = _load_assets(db, tenant_id)
    result = generate_plan(
        _load_tickets(db, tenant_id),
        _load_tecnici(db, tenant_id),
        assets_meta,
        _parse_date(start_date),
        forecast_data=forecast,
        assenze_tecnici=_load_assenze(db, tenant_id),
    )
    result["forecast"] = {str(k): v for k, v in forecast.items()}
    result["assets_metadata"] = assets_meta
    return result


def _split_long_tickets(db: Session, tenant_id: int):
    MAX_HOURS = 8.0
    tickets = db.query(Ticket).filter(
        Ticket.tenant_id == tenant_id,
        Ticket.stato.in_(("Aperto", "Pianificato")),
        Ticket.durata_stimata_ore > MAX_HOURS,
    ).all()

    for t in tickets:
        remaining = t.durata_stimata_ore - MAX_HOURS
        t.durata_stimata_ore = MAX_HOURS
        if "(Parte" not in t.titolo:
            t.titolo = f"{t.titolo} (Parte 1)"

        part = 2
        while remaining > 0:
            chunk = min(remaining, MAX_HOURS)
            new_ticket = Ticket(
                titolo=f"{t.titolo.replace(' (Parte 1)', '').strip()} (Parte {part})",
                descrizione=t.descrizione,
                asset_id=t.asset_id,
                tecnico_id=t.tecnico_id,
                priorita=t.priorita,
                fascia_oraria=t.fascia_oraria,
                durata_stimata_ore=chunk,
                stato=t.stato,
                attivita_manutenzione_id=t.attivita_manutenzione_id,
                planned_start=t.planned_start,
                planned_finish=t.planned_finish,
                tenant_id=tenant_id,
            )
            db.add(new_ticket)
            remaining -= chunk
            part += 1

    if tickets:
        db.commit()


async def run_scheduler_and_persist(db: Session, start: date | None = None, tenant_id: int | None = None) -> dict:
    """Esegue il piano scheduler e persiste planned_start, planned_finish, tecnico_id su ogni Ticket."""
    start_date = start or date.today()

    if tenant_id:
        _split_long_tickets(db, tenant_id)

    forecast = await _get_forecast(db)
    assets_meta = _load_assets(db, tenant_id) if tenant_id else {}
    result = generate_plan(
        _load_tickets(db, tenant_id) if tenant_id else [],
        _load_tecnici(db, tenant_id) if tenant_id else [],
        assets_meta,
        start_date,
        forecast_data=forecast,
        assenze_tecnici=_load_assenze(db, tenant_id) if tenant_id else [],
    )
    result["forecast"] = {str(k): v for k, v in forecast.items()}
    result["assets_metadata"] = assets_meta

    for item in result["items"]:
        if item.get("locked"):
            continue

        ticket_id = item["id"]
        planned_start = item.get("planned_start")
        planned_finish = item.get("planned_finish")
        tecnico_id = item.get("tecnico_id")

        update_fields: dict = {}
        if planned_start:
            update_fields["planned_start"] = datetime.fromisoformat(planned_start)
        if planned_finish:
            update_fields["planned_finish"] = datetime.fromisoformat(planned_finish)
        if tecnico_id is not None:
            update_fields["tecnico_id"] = tecnico_id
        update_fields["stato"] = "Pianificato"

        if update_fields:
            filter_cond = [
                Ticket.id == ticket_id,
                Ticket.stato.in_(("Aperto", "Pianificato")),
            ]
            if tenant_id:
                filter_cond.append(Ticket.tenant_id == tenant_id)
            db.query(Ticket).filter(*filter_cond).update(update_fields, synchronize_session=False)

    db.commit()
    return result


@router.post("/scheduler/ricalcola")
async def scheduler_ricalcola(
    data: RicalcolaRequest | None = None,
    db: Session = Depends(get_db),
    tenant_id: int = Depends(get_current_tenant_id),
):
    start = _parse_date(data.start_date if data else None)
    return await run_scheduler_and_persist(db, start, tenant_id)
