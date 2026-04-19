import math
from sqlalchemy.orm import Session, joinedload
from backend.db.modelli import Ticket, Asset, Tecnico
from backend.schemas.ticket import TicketCreate, TicketUpdate
from backend.core.security import check_tenant_ownership


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
        "is_manual_plan": getattr(t, "is_manual_plan", False),
        "piano_manutenzione_id": getattr(t, "piano_manutenzione_id", None),
        "origine_piano": getattr(t, "origine_piano", None),
        "tenant_id": t.tenant_id,
    }


class TicketRepository:

    def get_paginated(
        self,
        db: Session,
        tenant_id: int | None,
        page: int = 1,
        limit: int = 25,
        stati: list[str] | None = None,
        tecnico_id: int | None = None,
        piano_id: int | None = None,
    ) -> dict:
        query = db.query(Ticket).options(joinedload(Ticket.asset))
        if tenant_id is not None:
            query = query.filter(Ticket.tenant_id == tenant_id)
        # Soft deletion: di default esclude i cancellati, ma l'archivio deve poter
        # mostrare i ticket in stato Eliminato.
        include_deleted = bool(stati and "Eliminato" in stati)
        if not include_deleted:
            query = query.filter(Ticket.deleted_at.is_(None))
        if stati:
            query = query.filter(Ticket.stato.in_(stati))
        if tecnico_id:
            query = query.filter(Ticket.tecnico_id == tecnico_id)
        if piano_id:
            query = query.filter(Ticket.piano_manutenzione_id == piano_id)
            
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

        # Validazione tenant per Asset e Tecnico
        if getattr(data, "asset_id", None):
            check_tenant_ownership(db, Asset, data.asset_id, tenant_id)
        if getattr(data, "tecnico_id", None):
            check_tenant_ownership(db, Tecnico, data.tecnico_id, tenant_id)

        if getattr(data, "asset_stato", None) is not None:
            asset = db.query(Asset).filter(Asset.id == data.asset_id, Asset.tenant_id == tenant_id).first()
            if asset:
                asset.stato = data.asset_stato

        if durata_totale <= 8.0:
            ticket = Ticket(**dump)
            # Auto-calc planned_finish
            if ticket.planned_start and ticket.durata_stimata_ore:
                from datetime import timedelta
                ticket.planned_finish = ticket.planned_start + timedelta(hours=float(ticket.durata_stimata_ore))
            
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

    def update(self, db: Session, ticket_id: int, data: TicketUpdate, tenant_id: int | None):
        query = db.query(Ticket).options(joinedload(Ticket.asset))
        query = query.filter(Ticket.id == ticket_id)
        if tenant_id is not None:
            query = query.filter(Ticket.tenant_id == tenant_id)
        ticket = query.first()
        if not ticket:
            return None
        fields_set = data.model_fields_set
        if data.stato is not None:
            ticket.stato = data.stato
        if getattr(data, "tipo", None) is not None:
            ticket.tipo = data.tipo
        if data.priorita is not None:
            ticket.priorita = data.priorita
        if getattr(data, "asset_stato", None) is not None:
            if ticket.asset:
                # L'asset del ticket è già implicitamente validato (ticket.tenant_id == asset.tenant_id)
                ticket.asset.stato = data.asset_stato
        if data.fascia_oraria is not None:
            ticket.fascia_oraria = data.fascia_oraria
        if data.durata_stimata_ore is not None:
            ticket.durata_stimata_ore = data.durata_stimata_ore
        if "tecnico_id" in fields_set:
            if data.tecnico_id:
                check_tenant_ownership(db, Tecnico, data.tecnico_id, tenant_id)
            ticket.tecnico_id = data.tecnico_id
        if "planned_start" in fields_set:
            ticket.planned_start = data.planned_start
        if "planned_finish" in fields_set:
            ticket.planned_finish = data.planned_finish
        if "is_manual_plan" in fields_set:
            ticket.is_manual_plan = data.is_manual_plan
        if "piano_manutenzione_id" in fields_set:
            ticket.piano_manutenzione_id = data.piano_manutenzione_id
        if "origine_piano" in fields_set:
            ticket.origine_piano = data.origine_piano

        if data.stato == "Aperto":
            ticket.planned_start = None
            ticket.planned_finish = None
            ticket.is_manual_plan = False
            ticket.deleted_at = None
        elif data.stato is not None and data.stato != "Eliminato":
            ticket.deleted_at = None

        # Ricalcola planned_finish solo quando non e stato fornito esplicitamente.
        if "planned_finish" not in fields_set and ticket.planned_start and ticket.durata_stimata_ore:
            from datetime import timedelta
            ticket.planned_finish = ticket.planned_start + timedelta(hours=float(ticket.durata_stimata_ore))
        elif not ticket.planned_start:
            ticket.planned_finish = None

        if "execution_start" in fields_set:
            ticket.execution_start = data.execution_start
        if "execution_finish" in fields_set:
            ticket.execution_finish = data.execution_finish
        if data.eliminazione_note is not None:
            ticket.eliminazione_note = data.eliminazione_note
        if data.stato == "Eliminato" and ticket.deleted_at is None:
            from datetime import datetime, timezone
            ticket.deleted_at = datetime.now(timezone.utc)
        db.commit()
        db.refresh(ticket)
        return _ticket_to_dict(ticket)


ticket_repository = TicketRepository()
