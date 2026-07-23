"""
Ricambi Service — logica di magazzino ricambi e vincolo sulla pianificazione.

Concetti chiave:
- giacenza:    quantità fisica a magazzino (colonna Ricambio.giacenza)
- prenotato:   quantità impegnata dai ticket in stato Pianificato/In corso
- disponibile: giacenza - prenotato

Vincolo pianificazione (modulo spare_parts):
Un ticket con ricambi NON è pianificabile se anche un solo ricambio richiesto
è mancante (ricambio nuovo non a catalogo) oppure insufficiente a magazzino.
In tal caso il ticket viene deferito con proposta d'acquisto.

Tutte le query filtrano per tenant_id (isolamento multi-tenant).
"""
from __future__ import annotations

from collections import defaultdict
from typing import Any, Dict, List, Optional, Tuple

from sqlalchemy.orm import Session

from backend.db.modelli import MovimentoRicambio, Ricambio, Ticket, TicketRicambio

# Stati ticket che "impegnano" (prenotano) i ricambi a magazzino.
STATI_IMPEGNO = ("Pianificato", "In corso")

# Ordinamento priorità per l'allocazione equa dello stock nel gate.
_TIPO_W = {"BD": 4, "CM": 3, "ISP": 2, "MOD-STR": 2, "PM": 1}
_PRIO_W = {"Alta": 3, "Media": 2, "Bassa": 1}


# ── Disponibilità ─────────────────────────────────────────────────────────────

def reserved_by_ricambio(
    db: Session,
    tenant_id: Optional[int],
    exclude_ticket_ids: Optional[set[int]] = None,
) -> Dict[int, float]:
    """Quantità prenotata per ricambio (ticket in Pianificato/In corso).

    `exclude_ticket_ids` esclude dal conteggio i ticket che stanno per essere
    ri-pianificati, così non consumano due volte la propria prenotazione.
    """
    q = (
        db.query(TicketRicambio.ricambio_id, TicketRicambio.quantita, TicketRicambio.ticket_id)
        .join(Ticket, Ticket.id == TicketRicambio.ticket_id)
        .filter(
            TicketRicambio.ricambio_id.isnot(None),
            Ticket.stato.in_(STATI_IMPEGNO),
        )
    )
    if tenant_id is not None:
        q = q.filter(TicketRicambio.tenant_id == tenant_id)

    reserved: Dict[int, float] = defaultdict(float)
    exclude = exclude_ticket_ids or set()
    for ricambio_id, quantita, ticket_id in q.all():
        if ticket_id in exclude:
            continue
        reserved[ricambio_id] += float(quantita or 0)
    return dict(reserved)


def availability_map(
    db: Session,
    tenant_id: Optional[int],
    exclude_ticket_ids: Optional[set[int]] = None,
) -> Dict[int, Dict[str, float]]:
    """Mappa {ricambio_id: {giacenza, prenotato, disponibile}} per il tenant."""
    q = db.query(Ricambio)
    if tenant_id is not None:
        q = q.filter(Ricambio.tenant_id == tenant_id)
    reserved = reserved_by_ricambio(db, tenant_id, exclude_ticket_ids)

    result: Dict[int, Dict[str, float]] = {}
    for r in q.all():
        giacenza = float(r.giacenza or 0)
        prenotato = reserved.get(r.id, 0.0)
        result[r.id] = {
            "giacenza": giacenza,
            "prenotato": prenotato,
            "disponibile": giacenza - prenotato,
        }
    return result


# ── Riepilogo ricambi di un ticket ────────────────────────────────────────────

def ticket_ricambi_rows(db: Session, tenant_id: Optional[int], ticket_id: int) -> List[TicketRicambio]:
    q = db.query(TicketRicambio).filter(TicketRicambio.ticket_id == ticket_id)
    if tenant_id is not None:
        q = q.filter(TicketRicambio.tenant_id == tenant_id)
    return q.order_by(TicketRicambio.id.asc()).all()


def ticket_ricambi_status(
    db: Session,
    tenant_id: Optional[int],
    ticket_id: int,
    avail: Optional[Dict[int, Dict[str, float]]] = None,
) -> Dict[str, Any]:
    """Riepilogo ricambi del ticket con stato disponibilità per riga.

    Ritorna: righe con {id, ricambio_id, codice, descrizione, quantita, is_nuovo,
    disponibile, sufficiente} + flag globale `bloccante` e lista `mancanti`.
    La disponibilità è calcolata escludendo la prenotazione del ticket stesso,
    così il ticket "vede" lo stock come se non avesse ancora prenotato.
    """
    if avail is None:
        avail = availability_map(db, tenant_id, exclude_ticket_ids={ticket_id})

    rows = ticket_ricambi_rows(db, tenant_id, ticket_id)
    ricambio_ids = [r.ricambio_id for r in rows if r.ricambio_id]
    ricambi_map: Dict[int, Ricambio] = {}
    if ricambio_ids:
        rq = db.query(Ricambio).filter(Ricambio.id.in_(ricambio_ids))
        if tenant_id is not None:
            rq = rq.filter(Ricambio.tenant_id == tenant_id)
        ricambi_map = {r.id: r for r in rq.all()}

    out_rows: List[Dict[str, Any]] = []
    mancanti: List[str] = []
    bloccante = False
    for tr in rows:
        ric = ricambi_map.get(tr.ricambio_id) if tr.ricambio_id else None
        is_nuovo = bool(tr.is_nuovo) or tr.ricambio_id is None or ric is None
        disponibile = avail.get(tr.ricambio_id, {}).get("disponibile", 0.0) if tr.ricambio_id else 0.0
        sufficiente = (not is_nuovo) and disponibile >= float(tr.quantita or 0)
        if is_nuovo or not sufficiente:
            bloccante = True
            label = tr.descrizione or (ric.descrizione if ric else f"ricambio #{tr.id}")
            mancanti.append(label)
        out_rows.append({
            "id": tr.id,
            "ricambio_id": tr.ricambio_id,
            "codice": ric.codice if ric else None,
            "descrizione": tr.descrizione or (ric.descrizione if ric else None),
            "quantita": float(tr.quantita or 0),
            "unita_misura": ric.unita_misura if ric else None,
            "is_nuovo": is_nuovo,
            "stato_acquisto": tr.stato_acquisto,
            "disponibile": round(disponibile, 3),
            "sufficiente": sufficiente,
        })

    return {
        "ticket_id": ticket_id,
        "righe": out_rows,
        "bloccante": bloccante,
        "mancanti": mancanti,
    }


# ── Gate di pianificazione ────────────────────────────────────────────────────

def _priority_key(t: Ticket) -> Tuple[int, int, Any]:
    tipo_w = _TIPO_W.get((t.tipo or "").upper(), 1)
    prio_w = _PRIO_W.get(t.priorita or "Media", 2)
    # Priorità decrescente (tipo, priorità), poi FIFO su created_at.
    return (-tipo_w, -prio_w, t.created_at or 0)


def partition_by_spare_parts(
    db: Session,
    tenant_id: Optional[int],
    plannable_tickets: List[Ticket],
) -> Tuple[List[Ticket], List[Dict[str, Any]]]:
    """Divide i ticket pianificabili in (schedulabili, bloccati_da_ricambi).

    Consuma lo stock disponibile in ordine di priorità: se un ticket con
    ricambi non trova disponibilità sufficiente (o richiede un ricambio nuovo),
    finisce tra i bloccati con proposta d'acquisto e NON viene passato al motore.
    Il gate è un no-op per i ticket senza ricambi (zero impatto sul flusso legacy).
    """
    plannable_ids = {t.id for t in plannable_tickets}
    # Disponibilità di partenza: esclude le prenotazioni dei ticket in gioco,
    # perché sono proprio quelli che stiamo (ri)pianificando ora.
    avail = availability_map(db, tenant_id, exclude_ticket_ids=plannable_ids)
    remaining: Dict[int, float] = {rid: v["disponibile"] for rid, v in avail.items()}

    # Carica in blocco le righe ricambi dei ticket pianificabili
    rows_by_ticket: Dict[int, List[TicketRicambio]] = defaultdict(list)
    if plannable_ids:
        q = db.query(TicketRicambio).filter(TicketRicambio.ticket_id.in_(plannable_ids))
        if tenant_id is not None:
            q = q.filter(TicketRicambio.tenant_id == tenant_id)
        for tr in q.all():
            rows_by_ticket[tr.ticket_id].append(tr)

    schedulable: List[Ticket] = []
    blocked: List[Dict[str, Any]] = []

    for ticket in sorted(plannable_tickets, key=_priority_key):
        rows = rows_by_ticket.get(ticket.id, [])
        if not rows:
            schedulable.append(ticket)  # nessun ricambio → nessun vincolo
            continue

        mancanti: List[str] = []
        # Verifica fattibilità senza mutare lo stato finché non è tutto ok
        needed: Dict[int, float] = defaultdict(float)
        for tr in rows:
            qty = float(tr.quantita or 0)
            is_nuovo = bool(tr.is_nuovo) or tr.ricambio_id is None
            if is_nuovo:
                mancanti.append(tr.descrizione or "ricambio nuovo da acquistare")
                continue
            if tr.ricambio_id not in remaining:
                mancanti.append(tr.descrizione or f"ricambio #{tr.ricambio_id}")
                continue
            needed[tr.ricambio_id] += qty

        if not mancanti:
            for rid, qty in needed.items():
                if remaining.get(rid, 0.0) < qty:
                    mancanti.append(f"ricambio #{rid} (disponibili {remaining.get(rid, 0.0):.0f}, servono {qty:.0f})")

        if mancanti:
            blocked.append({
                "wo_id": ticket.id,
                "reason": "Ricambio non disponibile a magazzino — richiede approvvigionamento",
                "reason_code": "SPARE_PART_MISSING",
                "reason_detail": "; ".join(mancanti),
                "mancanti": mancanti,
                "earliest_possible_date": None,
            })
        else:
            for rid, qty in needed.items():
                remaining[rid] = remaining.get(rid, 0.0) - qty
            schedulable.append(ticket)

    return schedulable, blocked


# ── Movimenti di magazzino ────────────────────────────────────────────────────

def register_movimento(
    db: Session,
    tenant_id: int,
    ricambio: Ricambio,
    tipo: str,
    quantita: float,
    causale: Optional[str] = None,
    utente: Optional[str] = None,
    ticket_id: Optional[int] = None,
    commit: bool = True,
) -> MovimentoRicambio:
    """Applica un movimento (carico/scarico/rettifica) aggiornando la giacenza.

    - carico:    giacenza += quantita
    - scarico:   giacenza -= quantita (non scende sotto 0)
    - rettifica: imposta la giacenza al valore `quantita` (inventario)
    """
    q = float(quantita or 0)
    if tipo == "carico":
        ricambio.giacenza = float(ricambio.giacenza or 0) + q
    elif tipo == "scarico":
        ricambio.giacenza = max(0.0, float(ricambio.giacenza or 0) - q)
    elif tipo == "rettifica":
        ricambio.giacenza = max(0.0, q)
    else:
        raise ValueError(f"Tipo movimento non valido: {tipo}")

    mov = MovimentoRicambio(
        tenant_id=tenant_id,
        ricambio_id=ricambio.id,
        ticket_id=ticket_id,
        tipo=tipo,
        quantita=q,
        giacenza_dopo=float(ricambio.giacenza or 0),
        causale=causale,
        utente=utente,
    )
    db.add(mov)
    if commit:
        db.commit()
        db.refresh(mov)
    return mov
