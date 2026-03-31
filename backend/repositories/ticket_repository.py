import math
from sqlalchemy.orm import Session, joinedload
from backend.db.modelli import Ticket, Asset
from backend.schemas.ticket import TicketCreate, TicketUpdate


def _ticket_to_dict(t: Ticket) -> dict:
    return {
        "id": t.id,
        "titolo": t.titolo,
        "asset_id": t.asset_id,
        "asset_name": t.asset.nome if t.asset else None,
        "asset_stato": t.asset.stato if t.asset else None,
        "tipo": t.tipo or "CM",
        "priorita": t.priorita,
        "stato": t.stato,
        "durata_stimata_ore": t.durata_stimata_ore or 0,
        "fascia_oraria": t.fascia_oraria or "",
        "descrizione": t.descrizione,
        "tecnico_id": t.tecnico_id,
        "attivita_manutenzione_id": t.attivita_manutenzione_id,
        "planned_start": t.planned_start.isoformat() if t.planned_start else None,
        "planned_finish": t.planned_finish.isoformat() if t.planned_finish else None,
        "execution_start": t.execution_start.isoformat() if t.execution_start else None,
        "execution_finish": t.execution_finish.isoformat() if t.execution_finish else None,
        "parent_id": t.parent_id,
        "diagnosi_eseguita": t.diagnosi_eseguita or False,
        "tenant_id": t.tenant_id,
    }


class TicketRepository:

    def get_paginated(
        self,
        db: Session,
        tenant_id: int,
        page: int = 1,
        limit: int = 25,
        stati: list[str] | None = None,
        tecnico_id: int | None = None,
    ) -> dict:
        query = db.query(Ticket).options(joinedload(Ticket.asset)).filter(Ticket.tenant_id == tenant_id)
        if stati:
            query = query.filter(Ticket.stato.in_(stati))
        if tecnico_id:
            query = query.filter(Ticket.tecnico_id == tecnico_id)
        total = query.count()
        items = query.order_by(Ticket.id.desc()).offset((page - 1) * limit).limit(limit).all()
        return {
            "items": [_ticket_to_dict(t) for t in items],
            "total": total,
            "page": page,
            "pages": max(1, math.ceil(total / limit)),
        }

    def get_by_id(self, db: Session, ticket_id: int, tenant_id: int | None = None):
        query = db.query(Ticket).options(joinedload(Ticket.asset)).filter(Ticket.id == ticket_id)
        if tenant_id is not None:
            query = query.filter(Ticket.tenant_id == tenant_id)
        return query.first()

    def create(self, db: Session, data: TicketCreate, tenant_id: int):
        durata_totale = data.durata_stimata_ore or 1.0
        dump = data.model_dump(exclude={"asset_stato"})
        dump["tenant_id"] = tenant_id

        if getattr(data, "asset_stato", None) is not None:
            asset = db.query(Asset).filter(Asset.id == data.asset_id).first()
            if asset:
                asset.stato = data.asset_stato

        if durata_totale <= 8.0:
            ticket = Ticket(**dump)
            db.add(ticket)
            db.commit()
            db.refresh(ticket)
            return ticket

        ore_rimanenti = durata_totale
        chunk_idx = 1
        num_chunks = math.ceil(durata_totale / 8.0)
        primo_ticket = None

        while ore_rimanenti > 0:
            durata_chunk = min(8.0, ore_rimanenti)
            dump_chunk = dump.copy()
            dump_chunk["durata_stimata_ore"] = durata_chunk
            dump_chunk["titolo"] = f"{data.titolo} (Parte {chunk_idx}/{num_chunks})"

            ticket = Ticket(**dump_chunk)
            db.add(ticket)
            if chunk_idx == 1:
                primo_ticket = ticket

            ore_rimanenti -= durata_chunk
            chunk_idx += 1

        db.commit()
        db.refresh(primo_ticket)
        return primo_ticket

    def update(self, db: Session, ticket_id: int, data: TicketUpdate, tenant_id: int):
        ticket = (
            db.query(Ticket)
            .options(joinedload(Ticket.asset))
            .filter(Ticket.id == ticket_id, Ticket.tenant_id == tenant_id)
            .first()
        )
        if not ticket:
            return None
        if data.stato is not None:
            ticket.stato = data.stato
        if getattr(data, "tipo", None) is not None:
            ticket.tipo = data.tipo
        if data.priorita is not None:
            ticket.priorita = data.priorita
        if getattr(data, "asset_stato", None) is not None:
            if ticket.asset:
                ticket.asset.stato = data.asset_stato
        if data.fascia_oraria is not None:
            ticket.fascia_oraria = data.fascia_oraria
        if data.durata_stimata_ore is not None:
            ticket.durata_stimata_ore = data.durata_stimata_ore
        if "tecnico_id" in data.model_fields_set:
            ticket.tecnico_id = data.tecnico_id
        if "planned_start" in data.model_fields_set:
            ticket.planned_start = data.planned_start
        if "planned_finish" in data.model_fields_set:
            ticket.planned_finish = data.planned_finish
        if "execution_start" in data.model_fields_set:
            ticket.execution_start = data.execution_start
        if "execution_finish" in data.model_fields_set:
            ticket.execution_finish = data.execution_finish
        db.commit()
        db.refresh(ticket)
        return _ticket_to_dict(ticket)


ticket_repository = TicketRepository()
