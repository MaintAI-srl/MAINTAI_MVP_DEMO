"""
Opportunistic Maintenance Service — suggerisce ticket PM da eseguire opportunisticamente.

Quando un tecnico ha slot liberi durante un intervento, questo servizio propone
ticket PM dello stesso impianto/area compatibili con le sue competenze e il tempo disponibile.

Criterio di selezione:
  insertion_score = 0.4 * proximity_score + 0.4 * urgency_score + 0.2 * fit_score

Ritorna i top-5 candidati ordinati per insertion_score DESC.
"""
from __future__ import annotations

import logging
import re
from typing import Dict, List, Optional

from sqlalchemy.orm import Session

from backend.db.modelli import Asset, Impianto, Tecnico, Ticket

logger = logging.getLogger(__name__)

_PRIORITA_URGENCY: Dict[str, float] = {
    "alta": 1.0,
    "media": 0.6,
    "bassa": 0.2,
}


def _split_competenze(raw: Optional[str]) -> List[str]:
    if not raw:
        return []
    parts = re.split(r"[,;\s]+", raw.strip())
    return [p.strip().upper() for p in parts if p.strip()]


async def find_opportunistic_suggestions(
    db: Session,
    technician_id: int,
    date_str: str,
    free_slot_hours: float,
    tenant_id: int,
    top_n: int = 5,
) -> List[Dict]:
    """
    Trova ticket PM da suggerire come manutenzione opportunistica.

    Args:
        db: sessione DB
        technician_id: ID tecnico con slot libero
        date_str: data dello slot libero "YYYY-MM-DD"
        free_slot_hours: ore libere disponibili (già clampate dal chiamante)
        tenant_id: isolamento multi-tenant
        top_n: numero massimo di suggerimenti da restituire

    Returns:
        Lista di dict con ticket candidati ordinati per insertion_score
    """
    # Carica il tecnico
    tecnico = db.query(Tecnico).filter(
        Tecnico.id == technician_id,
        Tecnico.tenant_id == tenant_id,
    ).first()
    if not tecnico:
        logger.warning("Opportunistic: tecnico #%d non trovato", technician_id)
        return []

    comp_tecnico = _split_competenze(tecnico.competenze)
    # Aggiungi tipi impliciti (coerente con il bridge)
    for tipo in ["PM", "CM", "BD"]:
        if tipo not in comp_tecnico:
            comp_tecnico.append(tipo)

    # Carica tutti gli impianti in cui il tecnico è attivo oggi (via Ticket pianificati)
    impianti_tecnico: set = set()
    tickets_tecnico_oggi = db.query(Ticket).filter(
        Ticket.tenant_id == tenant_id,
        Ticket.tecnico_id == technician_id,
        Ticket.stato == "Pianificato",
        Ticket.planned_start.isnot(None),
    ).all()
    for tk in tickets_tecnico_oggi:
        if tk.asset_id:
            asset = db.query(Asset).filter(Asset.id == tk.asset_id).first()
            if asset and asset.impianto_id:
                impianti_tecnico.add(asset.impianto_id)

    # Carica tutti gli asset del tenant per lookup
    assets_all = db.query(Asset).filter(Asset.tenant_id == tenant_id).all()
    asset_map: Dict[int, Asset] = {a.id: a for a in assets_all}

    # Carica impianti per nome
    impianti_map: Dict[int, Impianto] = {}
    impianto_ids = list({a.impianto_id for a in assets_all if a.impianto_id})
    if impianto_ids:
        impianti = db.query(Impianto).filter(Impianto.id.in_(impianto_ids)).all()
        impianti_map = {i.id: i for i in impianti}

    # Carica ticket candidati: aperti/pianificati, durata <= free_slot_hours
    # Preferenza per PM ma include CM se vicino
    candidate_tickets = db.query(Ticket).filter(
        Ticket.tenant_id == tenant_id,
        Ticket.stato.in_(["Aperto", "Pianificato"]),
        Ticket.durata_stimata_ore <= free_slot_hours,
        Ticket.tecnico_id.is_(None),  # non già assegnato
        Ticket.deleted_at.is_(None),
    ).all()

    if not candidate_tickets:
        return []

    suggestions = []
    for ticket in candidate_tickets:
        # Verifica skill match (semplice: tecnico deve avere il tipo come competenza)
        ticket_comp = (ticket.competenza_richiesta or ticket.tipo or "CM").strip().upper()
        if ticket_comp not in comp_tecnico:
            continue

        # Proximity score
        asset = asset_map.get(ticket.asset_id) if ticket.asset_id else None
        impianto_id = asset.impianto_id if asset else None
        impianto_nome = impianti_map.get(impianto_id, None)

        if impianto_id and impianto_id in impianti_tecnico:
            proximity_score = 1.0
        elif asset and any(
            a2.impianto_id == impianto_id
            for a2 in assets_all
            if a2.impianto_id and a2.impianto_id in impianti_tecnico
        ):
            proximity_score = 0.5
        else:
            proximity_score = 0.2

        # Urgency score
        urgency_score = _PRIORITA_URGENCY.get((ticket.priorita or "media").lower(), 0.4)

        # Fit score: quanto la durata del ticket si adatta allo slot disponibile
        durata = float(ticket.durata_stimata_ore or 1.0)
        if free_slot_hours > 0:
            fit_score = 1.0 - abs(durata - free_slot_hours) / max(durata, free_slot_hours)
        else:
            fit_score = 0.0
        fit_score = max(0.0, fit_score)

        insertion_score = round(
            0.4 * proximity_score + 0.4 * urgency_score + 0.2 * fit_score, 3
        )

        suggestions.append({
            "ticket_id": ticket.id,
            "titolo": ticket.titolo or f"Ticket #{ticket.id}",
            "tipo": ticket.tipo or "CM",
            "durata_stimata_ore": durata,
            "insertion_score": insertion_score,
            "proximity_score": round(proximity_score, 3),
            "urgency_score": round(urgency_score, 3),
            "fit_score": round(fit_score, 3),
            "impianto_nome": impianto_nome.nome if impianto_nome else None,
        })

    # Ordina per insertion_score DESC e restituisci top_n
    suggestions.sort(key=lambda x: x["insertion_score"], reverse=True)
    return suggestions[:top_n]
