"""
Emergency Router — Mappa Emergenze MaintAI
Endpoint per trovare i tecnici più vicini al sito di un ticket di emergenza.
Usa Nominatim (OSM) per il geocoding con cache in-memory.
"""
from __future__ import annotations

import logging
from datetime import date, datetime, timezone
from math import atan2, cos, radians, sin, sqrt
from typing import Optional

import httpx
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from backend.core.dependencies import get_db
from backend.core.logger_db import db_error, db_info
from backend.core.security import get_current_tenant_id
from backend.db.modelli import Asset, Impianto, Sito, Tecnico, Ticket, TecnicoAssenza

logger = logging.getLogger(__name__)
router = APIRouter()

# ── Cache geocoding in-memory (indirizzo → (lat, lon) oppure None) ────────────
_geo_cache: dict[str, tuple[float, float] | None] = {}


async def _geocode(address: str) -> tuple[float, float] | None:
    """
    Geocodifica un indirizzo via Nominatim (OSM).
    Usa cache in-memory per evitare richieste ripetute.
    Ritorna (lat, lon) oppure None se non trovato.
    """
    if not address or not address.strip():
        return None
    key = address.strip().lower()
    if key in _geo_cache:
        return _geo_cache[key]
    try:
        async with httpx.AsyncClient(timeout=5.0) as client:
            r = await client.get(
                "https://nominatim.openstreetmap.org/search",
                params={"q": address, "format": "json", "limit": 1, "countrycodes": "it"},
                headers={"User-Agent": "MaintAI/3.0 contact@maintai.it"},
            )
            data = r.json()
            if data:
                result: tuple[float, float] = (float(data[0]["lat"]), float(data[0]["lon"]))
                _geo_cache[key] = result
                return result
    except Exception as exc:
        logger.warning("Geocoding fallito per '%s': %s", address, exc)
    _geo_cache[key] = None
    return None


def _haversine(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    """Distanza in km tra due punti geografici (formula haversine)."""
    R = 6371.0
    dlat = radians(lat2 - lat1)
    dlon = radians(lon2 - lon1)
    a = sin(dlat / 2) ** 2 + cos(radians(lat1)) * cos(radians(lat2)) * sin(dlon / 2) ** 2
    return R * 2 * atan2(sqrt(a), sqrt(1 - a))


def _tecnico_is_available(tecnico: Tecnico, db: Session, tenant_id: int) -> bool:
    """Verifica che il tecnico non sia in ferie o inattivo oggi."""
    stato = (tecnico.stato or "").lower()
    if stato in ("in ferie", "ferie", "assente", "inattivo", "fuori servizio"):
        return False
    today_dt = datetime.now(timezone.utc)
    assenza = (
        db.query(TecnicoAssenza)
        .filter(
            TecnicoAssenza.tecnico_id == tecnico.id,
            TecnicoAssenza.tenant_id == tenant_id,
            TecnicoAssenza.data_inizio <= today_dt,
            TecnicoAssenza.data_fine >= today_dt,
        )
        .first()
    )
    return assenza is None


def _build_sito_address(sito: Optional[Sito]) -> str:
    """Compone un indirizzo leggibile da un oggetto Sito."""
    if not sito:
        return ""
    parts = [p for p in [sito.ubicazione, sito.citta, "Italia"] if p and p.strip()]
    return ", ".join(parts)


@router.get("/emergency/nearest-technicians/{ticket_id}")
async def nearest_technicians(
    ticket_id: int,
    db: Session = Depends(get_db),
    tenant_id: int = Depends(get_current_tenant_id),
):
    """
    Trova i tecnici più vicini al sito di un ticket di emergenza.

    1. Carica il ticket → asset → impianto → sito e geocodifica l'indirizzo.
    2. Per ogni tecnico attivo:
       - Cerca un ticket "In corso" oggi per trovare il sito dove si trova.
       - In alternativa, cerca il primo ticket "Pianificato" oggi.
       - Fallback: usa `sede_indirizzo` del tecnico.
    3. Calcola distanza haversine.
    4. Ordina per distanza e restituisce top-3 + tutti.

    Response: { emergenza, tecnici_consigliati (top-3), tutti_tecnici }
    """
    # ── 1. Carica il ticket di emergenza ──────────────────────────────────────
    ticket = (
        db.query(Ticket)
        .filter(Ticket.id == ticket_id, Ticket.tenant_id == tenant_id)
        .first()
    )
    if not ticket:
        raise HTTPException(status_code=404, detail="Ticket non trovato")

    # ── 2. Ricava il sito del ticket tramite asset → impianto → sito ──────────
    asset = None
    impianto = None
    sito = None
    sito_nome = ""
    sito_indirizzo = ""

    if ticket.asset_id:
        asset = db.query(Asset).filter(Asset.id == ticket.asset_id, Asset.tenant_id == tenant_id).first()
    if asset and asset.impianto_id:
        impianto = db.query(Impianto).filter(Impianto.id == asset.impianto_id).first()
    if impianto and impianto.sito_id:
        sito = db.query(Sito).filter(Sito.id == impianto.sito_id).first()

    if sito:
        sito_nome = sito.nome or ""
        sito_indirizzo = _build_sito_address(sito)

    # Geocodifica sito emergenza
    emergenza_coords: tuple[float, float] | None = None
    if sito_indirizzo:
        emergenza_coords = await _geocode(sito_indirizzo)

    # ── 3. Carica tecnici attivi ───────────────────────────────────────────────
    tecnici_attivi = (
        db.query(Tecnico)
        .filter(Tecnico.tenant_id == tenant_id)
        .filter(Tecnico.stato.notin_(["in ferie", "ferie", "assente", "inattivo"]))
        .all()
    )

    today = date.today()
    today_start = datetime(today.year, today.month, today.day, 0, 0, 0, tzinfo=timezone.utc)
    today_end = datetime(today.year, today.month, today.day, 23, 59, 59, tzinfo=timezone.utc)

    # ── 4. Per ogni tecnico trova posizione e calcola distanza ────────────────
    tecnici_risultato = []

    for tec in tecnici_attivi:
        # Salta tecnici in assenza formale oggi
        if not _tecnico_is_available(tec, db, tenant_id):
            continue

        posizione_fonte = "sede"
        tec_indirizzo: str | None = None

        # A) Ticket "In corso" oggi → sito dove il tecnico sta lavorando
        ticket_in_corso = (
            db.query(Ticket)
            .filter(
                Ticket.tecnico_id == tec.id,
                Ticket.tenant_id == tenant_id,
                Ticket.stato == "In corso",
                Ticket.deleted_at.is_(None),
                Ticket.execution_start >= today_start,
            )
            .first()
        )
        if ticket_in_corso and ticket_in_corso.asset_id:
            a_lav = db.query(Asset).filter(Asset.id == ticket_in_corso.asset_id).first()
            if a_lav and a_lav.impianto_id:
                imp_lav = db.query(Impianto).filter(Impianto.id == a_lav.impianto_id).first()
                if imp_lav and imp_lav.sito_id:
                    sito_lav = db.query(Sito).filter(Sito.id == imp_lav.sito_id).first()
                    if sito_lav:
                        tec_indirizzo = _build_sito_address(sito_lav)
                        posizione_fonte = "in_lavorazione"

        # B) Primo ticket "Pianificato" oggi → sito pianificato
        if not tec_indirizzo:
            ticket_pianificato = (
                db.query(Ticket)
                .filter(
                    Ticket.tecnico_id == tec.id,
                    Ticket.tenant_id == tenant_id,
                    Ticket.stato == "Pianificato",
                    Ticket.deleted_at.is_(None),
                    Ticket.planned_start >= today_start,
                    Ticket.planned_start <= today_end,
                )
                .order_by(Ticket.planned_start.asc())
                .first()
            )
            if ticket_pianificato and ticket_pianificato.asset_id:
                a_pian = db.query(Asset).filter(Asset.id == ticket_pianificato.asset_id).first()
                if a_pian and a_pian.impianto_id:
                    imp_pian = db.query(Impianto).filter(Impianto.id == a_pian.impianto_id).first()
                    if imp_pian and imp_pian.sito_id:
                        sito_pian = db.query(Sito).filter(Sito.id == imp_pian.sito_id).first()
                        if sito_pian:
                            tec_indirizzo = _build_sito_address(sito_pian)
                            posizione_fonte = "in_piano"

        # C) Sede del tecnico
        if not tec_indirizzo:
            sede = getattr(tec, "sede_indirizzo", None)
            if sede and sede.strip():
                tec_indirizzo = sede
                posizione_fonte = "sede"

        # Geocodifica posizione tecnico
        tec_coords: tuple[float, float] | None = None
        if tec_indirizzo:
            tec_coords = await _geocode(tec_indirizzo)

        # Calcola distanza
        distanza_km: float | None = None
        if emergenza_coords and tec_coords:
            distanza_km = round(
                _haversine(
                    emergenza_coords[0], emergenza_coords[1],
                    tec_coords[0], tec_coords[1],
                ),
                2,
            )

        nome_completo = f"{tec.nome or ''} {tec.cognome or ''}".strip()
        telefono = getattr(tec, "telefono", None) or ""

        tecnici_risultato.append({
            "tecnico_id": tec.id,
            "nome": nome_completo,
            "competenze": tec.competenze or "",
            "telefono": telefono,
            "distanza_km": distanza_km,
            "posizione_fonte": posizione_fonte,
            "indirizzo_corrente": tec_indirizzo or "",
            "lat": tec_coords[0] if tec_coords else None,
            "lon": tec_coords[1] if tec_coords else None,
            "stato": tec.stato or "in servizio",
        })

    # ── 5. Ordina: prima chi ha distanza nota, poi gli altri ──────────────────
    tecnici_con_dist = sorted(
        [t for t in tecnici_risultato if t["distanza_km"] is not None],
        key=lambda x: x["distanza_km"],  # type: ignore[return-value]
    )
    tecnici_senza_dist = [t for t in tecnici_risultato if t["distanza_km"] is None]
    tutti_ordinati = tecnici_con_dist + tecnici_senza_dist

    db_info(
        "EMERGENCY",
        f"Ricerca tecnici più vicini per ticket {ticket_id}: {len(tutti_ordinati)} tecnici trovati",
        {"ticket_id": ticket_id, "sito": sito_nome, "coords": str(emergenza_coords)},
        tenant_id=tenant_id,
    )

    return {
        "emergenza": {
            "ticket_id": ticket_id,
            "ticket_titolo": ticket.titolo or "",
            "asset_nome": asset.nome if asset else "",
            "sito": sito_nome,
            "indirizzo": sito_indirizzo,
            "lat": emergenza_coords[0] if emergenza_coords else None,
            "lon": emergenza_coords[1] if emergenza_coords else None,
        },
        "tecnici_consigliati": tutti_ordinati[:3],
        "tutti_tecnici": tutti_ordinati,
    }
