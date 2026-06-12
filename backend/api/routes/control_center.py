"""
Control Center Router — Centro di Controllo MaintAI
Vista geografica di supervisione: per ogni sito del tenant restituisce posizione
(coordinate impianti o geocoding Nominatim dell'indirizzo) e stato aggregato di
asset e work order, più un riepilogo globale per la testata della pagina.

Funzione adattata dal concept "Centro di Controllo" di MaintAI Alpha e
potenziata con la mappa Google Maps lato frontend (pagina /controllo).
"""
from __future__ import annotations

import logging

from fastapi import APIRouter, Depends
from sqlalchemy import func, or_
from sqlalchemy.orm import Session

from backend.api.routes.dashboard import _asset_stato_key
from backend.api.routes.emergency import _build_sito_address, _geocode
from backend.core.dependencies import get_db
from backend.core.security import get_current_tenant_id
from backend.db.modelli import Asset, Impianto, Sito, Tecnico, Ticket

logger = logging.getLogger(__name__)
router = APIRouter()

# Stati ticket considerati "attivi" ai fini della supervisione
ACTIVE_TICKET_STATES = ("Aperto", "In corso", "Pianificato")


def _sito_status(asset_stati: dict[str, int], ticket: dict[str, int]) -> str:
    """Classifica il sito: critico (guasti/BD), attenzione (lavori attivi), ok."""
    if asset_stati.get("out of service", 0) > 0 or ticket.get("bd_attivi", 0) > 0:
        return "critico"
    if ticket.get("aperti", 0) + ticket.get("in_corso", 0) > 0 or asset_stati.get("stopped", 0) > 0:
        return "attenzione"
    return "ok"


@router.get("/control-center/overview")
async def control_center_overview(
    db: Session = Depends(get_db),
    tenant_id: int = Depends(get_current_tenant_id),
):
    """
    Overview geografica del tenant per la mappa del Centro di Controllo.

    Response:
    {
      "siti": [{sito_id, nome, citta, indirizzo, lat, lon, posizione_fonte,
                n_impianti, n_asset, asset_stati, ticket, status}],
      "impianti": [{impianto_id, nome, sito_id, lat, lon, n_asset, asset_guasti}],
      "bd_tickets": [{ticket_id, titolo, priorita, stato, tipo, sito_id, lat, lon, ...}],
      "summary": {n_siti, siti_critici, assets, asset_stati, ticket_aperti,
                  ticket_in_corso, ticket_pianificati, bd_attivi,
                  tecnici, tecnici_disponibili}
    }
    """
    siti = db.query(Sito).filter(Sito.tenant_id == tenant_id).order_by(Sito.nome).all()
    impianti = db.query(Impianto).filter(Impianto.tenant_id == tenant_id).all()

    # ── Asset per (sito, stato) — una sola query aggregata ────────────────────
    asset_rows = (
        db.query(Impianto.sito_id, Asset.stato, func.count(Asset.id))
        .join(Asset, Asset.impianto_id == Impianto.id)
        .filter(Impianto.tenant_id == tenant_id, Asset.tenant_id == tenant_id)
        .group_by(Impianto.sito_id, Asset.stato)
        .all()
    )
    asset_per_sito: dict[int | None, dict[str, int]] = {}
    for sito_id, stato, cnt in asset_rows:
        bucket = asset_per_sito.setdefault(sito_id, {"service": 0, "stopped": 0, "out of service": 0})
        bucket[_asset_stato_key(stato)] = bucket.get(_asset_stato_key(stato), 0) + cnt

    # ── Asset per (impianto, stato) — per i marker di dettaglio ───────────────
    asset_imp_rows = (
        db.query(Asset.impianto_id, Asset.stato, func.count(Asset.id))
        .filter(Asset.tenant_id == tenant_id, Asset.impianto_id.isnot(None))
        .group_by(Asset.impianto_id, Asset.stato)
        .all()
    )
    asset_per_impianto: dict[int, dict[str, int]] = {}
    for imp_id, stato, cnt in asset_imp_rows:
        bucket = asset_per_impianto.setdefault(imp_id, {"service": 0, "stopped": 0, "out of service": 0})
        bucket[_asset_stato_key(stato)] = bucket.get(_asset_stato_key(stato), 0) + cnt

    # ── Ticket attivi per (sito, stato, tipo) ─────────────────────────────────
    ticket_rows = (
        db.query(Impianto.sito_id, Ticket.stato, Ticket.tipo, func.count(Ticket.id))
        .join(Asset, Asset.impianto_id == Impianto.id)
        .join(Ticket, Ticket.asset_id == Asset.id)
        .filter(
            Impianto.tenant_id == tenant_id,
            Ticket.tenant_id == tenant_id,
            Ticket.deleted_at.is_(None),
            Ticket.stato.in_(ACTIVE_TICKET_STATES),
        )
        .group_by(Impianto.sito_id, Ticket.stato, Ticket.tipo)
        .all()
    )
    ticket_per_sito: dict[int | None, dict[str, int]] = {}
    for sito_id, stato, tipo, cnt in ticket_rows:
        bucket = ticket_per_sito.setdefault(
            sito_id, {"aperti": 0, "in_corso": 0, "pianificati": 0, "bd_attivi": 0}
        )
        if stato == "Aperto":
            bucket["aperti"] += cnt
        elif stato == "In corso":
            bucket["in_corso"] += cnt
        elif stato == "Pianificato":
            bucket["pianificati"] += cnt
        if (tipo or "").upper() == "BD" and stato in ("Aperto", "In corso"):
            bucket["bd_attivi"] += cnt

    # ── Coordinate per sito: media impianti → fallback geocoding indirizzo ────
    impianti_per_sito: dict[int | None, list[Impianto]] = {}
    for imp in impianti:
        impianti_per_sito.setdefault(imp.sito_id, []).append(imp)

    siti_payload = []
    siti_critici = 0
    for sito in siti:
        sito_impianti = impianti_per_sito.get(sito.id, [])
        coords_imp = [
            (imp.latitude, imp.longitude)
            for imp in sito_impianti
            if imp.latitude is not None and imp.longitude is not None
        ]
        lat = lon = None
        posizione_fonte = None
        if coords_imp:
            lat = round(sum(c[0] for c in coords_imp) / len(coords_imp), 6)
            lon = round(sum(c[1] for c in coords_imp) / len(coords_imp), 6)
            posizione_fonte = "impianti"
        else:
            indirizzo = _build_sito_address(sito)
            if indirizzo:
                geo = await _geocode(indirizzo)
                if geo:
                    lat, lon = geo
                    posizione_fonte = "geocoding"

        asset_stati = asset_per_sito.get(sito.id, {"service": 0, "stopped": 0, "out of service": 0})
        ticket = ticket_per_sito.get(sito.id, {"aperti": 0, "in_corso": 0, "pianificati": 0, "bd_attivi": 0})
        status = _sito_status(asset_stati, ticket)
        if status == "critico":
            siti_critici += 1

        siti_payload.append({
            "sito_id": sito.id,
            "nome": sito.nome,
            "citta": sito.citta,
            "indirizzo": _build_sito_address(sito),
            "responsabile": sito.responsabile,
            "lat": lat,
            "lon": lon,
            "posizione_fonte": posizione_fonte,
            "n_impianti": len(sito_impianti),
            "n_asset": sum(asset_stati.values()),
            "asset_stati": {
                "service": asset_stati.get("service", 0),
                "stopped": asset_stati.get("stopped", 0),
                "out_of_service": asset_stati.get("out of service", 0),
            },
            "ticket": ticket,
            "status": status,
        })

    # ── Marker impianti (solo quelli con coordinate proprie) ──────────────────
    impianti_payload = [
        {
            "impianto_id": imp.id,
            "nome": imp.nome,
            "sito_id": imp.sito_id,
            "lat": imp.latitude,
            "lon": imp.longitude,
            "n_asset": sum(asset_per_impianto.get(imp.id, {}).values()),
            "asset_guasti": asset_per_impianto.get(imp.id, {}).get("out of service", 0),
        }
        for imp in impianti
        if imp.latitude is not None and imp.longitude is not None
    ]

    # Breakdown ed emergenze attive per la console operativa. Include anche ticket
    # senza coordinate: il pannello puo comunque aprire il dispatch tecnici.
    alert_rows = (
        db.query(Ticket, Asset, Impianto, Sito)
        .outerjoin(Asset, Ticket.asset_id == Asset.id)
        .outerjoin(Impianto, Asset.impianto_id == Impianto.id)
        .outerjoin(Sito, Impianto.sito_id == Sito.id)
        .filter(
            Ticket.tenant_id == tenant_id,
            Ticket.deleted_at.is_(None),
            Ticket.stato.in_(ACTIVE_TICKET_STATES),
            or_(
                func.upper(Ticket.tipo) == "BD",
                func.lower(Ticket.priorita) == "emergenza",
            ),
        )
        .order_by(Ticket.created_at.desc())
        .limit(100)
        .all()
    )
    bd_tickets_payload = []
    emergenze_attive_tot = 0
    for ticket_obj, asset_obj, imp_obj, sito_obj in alert_rows:
        is_emergenza = (ticket_obj.priorita or "").lower() == "emergenza"
        if is_emergenza:
            emergenze_attive_tot += 1

        lat = lon = None
        posizione_fonte = None
        if asset_obj and asset_obj.latitude is not None and asset_obj.longitude is not None:
            lat = asset_obj.latitude
            lon = asset_obj.longitude
            posizione_fonte = "asset"
        elif imp_obj and imp_obj.latitude is not None and imp_obj.longitude is not None:
            lat = imp_obj.latitude
            lon = imp_obj.longitude
            posizione_fonte = "impianto"
        elif sito_obj:
            indirizzo = _build_sito_address(sito_obj)
            geo = await _geocode(indirizzo) if indirizzo else None
            if geo:
                lat, lon = geo
                posizione_fonte = "geocoding"

        bd_tickets_payload.append({
            "ticket_id": ticket_obj.id,
            "titolo": ticket_obj.titolo or "",
            "descrizione": ticket_obj.descrizione or "",
            "priorita": ticket_obj.priorita or "",
            "stato": ticket_obj.stato or "",
            "tipo": ticket_obj.tipo or "",
            "asset_id": asset_obj.id if asset_obj else None,
            "asset_nome": asset_obj.nome if asset_obj else "",
            "impianto_id": imp_obj.id if imp_obj else None,
            "impianto_nome": imp_obj.nome if imp_obj else "",
            "sito_id": sito_obj.id if sito_obj else None,
            "sito_nome": sito_obj.nome if sito_obj else "",
            "indirizzo": _build_sito_address(sito_obj) if sito_obj else "",
            "tecnico_id": ticket_obj.tecnico_id,
            "lat": round(float(lat), 6) if lat is not None else None,
            "lon": round(float(lon), 6) if lon is not None else None,
            "posizione_fonte": posizione_fonte,
            "created_at": ticket_obj.created_at.isoformat() if ticket_obj.created_at else None,
        })

    bd_tickets_payload.sort(
        key=lambda t: (
            0 if (t["priorita"] or "").lower() == "emergenza" else 1,
            0 if t["stato"] == "Aperto" else 1,
        )
    )

    # ── Riepilogo globale (tenant-wide, come la dashboard) ────────────────────
    asset_tot_rows = (
        db.query(Asset.stato, func.count(Asset.id))
        .filter(Asset.tenant_id == tenant_id)
        .group_by(Asset.stato)
        .all()
    )
    asset_stati_tot = {"service": 0, "stopped": 0, "out of service": 0}
    for stato, cnt in asset_tot_rows:
        key = _asset_stato_key(stato)
        asset_stati_tot[key] = asset_stati_tot.get(key, 0) + cnt

    ticket_tot = dict(
        db.query(Ticket.stato, func.count(Ticket.id))
        .filter(
            Ticket.tenant_id == tenant_id,
            Ticket.deleted_at.is_(None),
            Ticket.stato.in_(ACTIVE_TICKET_STATES),
        )
        .group_by(Ticket.stato)
        .all()
    )
    bd_attivi_tot = (
        db.query(func.count(Ticket.id))
        .filter(
            Ticket.tenant_id == tenant_id,
            Ticket.deleted_at.is_(None),
            Ticket.tipo == "BD",
            Ticket.stato.in_(("Aperto", "In corso")),
        )
        .scalar()
        or 0
    )
    tecnici_total = db.query(func.count(Tecnico.id)).filter(Tecnico.tenant_id == tenant_id).scalar() or 0
    tecnici_disp = (
        db.query(func.count(Tecnico.id))
        .filter(Tecnico.tenant_id == tenant_id, Tecnico.stato == "in servizio")
        .scalar()
        or 0
    )

    return {
        "siti": siti_payload,
        "impianti": impianti_payload,
        "bd_tickets": bd_tickets_payload,
        "summary": {
            "n_siti": len(siti),
            "siti_critici": siti_critici,
            "assets": sum(asset_stati_tot.values()),
            "asset_stati": {
                "service": asset_stati_tot.get("service", 0),
                "stopped": asset_stati_tot.get("stopped", 0),
                "out_of_service": asset_stati_tot.get("out of service", 0),
            },
            "ticket_aperti": ticket_tot.get("Aperto", 0),
            "ticket_in_corso": ticket_tot.get("In corso", 0),
            "ticket_pianificati": ticket_tot.get("Pianificato", 0),
            "bd_attivi": bd_attivi_tot,
            "emergenze_attive": emergenze_attive_tot,
            "tecnici": tecnici_total,
            "tecnici_disponibili": tecnici_disp,
        },
    }
