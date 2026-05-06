import re
from datetime import datetime, timezone
from sqlalchemy.orm import Session, joinedload
from backend.db.modelli import Asset, Impianto, Ticket, AttivitaManutenzione
from backend.schemas.schemas import AssetCreate, AssetUpdate
from backend.core.security import check_tenant_ownership


def _normalize_asset_stato(stato: str | None) -> str:
    value = (stato or "service").strip().lower()
    if value in {"operativo", "in servizio", "in_servizio", "service"}:
        return "service"
    if value in {"fermo", "fermo prog", "fermo prog.", "fermo programmato", "stopped"}:
        return "stopped"
    if value in {"guasto", "fuori servizio", "oos", "out of service", "out_of_service"}:
        return "out of service"
    return "service"


def _to_dict(asset: Asset) -> dict:
    impianto_nome = None
    sito_id = None
    sito_nome = None
    if asset.impianto:
        impianto_nome = asset.impianto.nome
        if asset.impianto.sito:
            sito_id = asset.impianto.sito.id
            sito_nome = asset.impianto.sito.nome
    stato_changed_at = None
    if asset.stato_changed_at:
        stato_changed_at = asset.stato_changed_at.isoformat()
    return {
        "id": asset.id,
        "name": asset.nome,
        "nome": asset.nome,
        "area": asset.area or "",
        "vincolo_orario": asset.vincolo_orario or "",
        "note": asset.note or "",
        "codice": asset.codice or "",
        "descrizione": asset.descrizione or "",
        "anno": asset.anno,
        "impianto_id": asset.impianto_id,
        "impianto_nome": impianto_nome,
        "sito_id": sito_id,
        "sito_nome": sito_nome,
        "limitazioni": asset.limitazioni or "",
        "stato": _normalize_asset_stato(asset.stato),
        "stato_changed_at": stato_changed_at,
        "weather_sunny_required": asset.weather_sunny_required or False,
        "weather_max_wind_kmh": asset.weather_max_wind_kmh,
        "weather_max_rain_mm": asset.weather_max_rain_mm,
        "anno_installazione": asset.anno_installazione,
        "anno_produzione": asset.anno_produzione,
        "marca": asset.marca,
        "modello": asset.modello,
        "matricola": asset.matricola,
        "numero_serie": asset.numero_serie,
        "fornitore": asset.fornitore,
        "data_acquisto": asset.data_acquisto.isoformat() if asset.data_acquisto else None,
        "data_scadenza_garanzia": asset.data_scadenza_garanzia.isoformat() if asset.data_scadenza_garanzia else None,
        "vincoli_operativi": asset.vincoli_operativi,
        "vincoli_manutenzione": asset.vincoli_manutenzione,
        "note_tecniche": asset.note_tecniche,
        "criticita": asset.criticita or "media",
        "posizione_fisica": asset.posizione_fisica,
        "tenant_id": asset.tenant_id,
    }


def _generate_codice(db: Session, descrizione: str, tenant_id: int) -> str:
    if not descrizione or not descrizione.strip():
        first_word = "asset"
    else:
        first_word = re.sub(r"[^a-zA-Z0-9]", "", descrizione.split()[0]).lower()
        if not first_word:
            first_word = "asset"
    existing = db.query(Asset).filter(
        Asset.codice.like(f"{first_word}%"),
        Asset.tenant_id == tenant_id,
    ).count()
    return f"{first_word}{existing + 1}"


_NEW_ANAGRAFICA_FIELDS = [
    "anno_installazione", "anno_produzione", "marca", "modello",
    "matricola", "numero_serie", "fornitore", "data_acquisto",
    "data_scadenza_garanzia", "vincoli_operativi", "vincoli_manutenzione",
    "note_tecniche", "criticita", "posizione_fisica",
]


class AssetRepository:

    def get_all(self, db: Session, tenant_id: int, query: str = None, sito_id: int = None, impianto_id: int = None, limit: int = 100, page: int = 1) -> list[dict]:
        from sqlalchemy import or_
        q = db.query(Asset).options(joinedload(Asset.impianto).joinedload(Impianto.sito))
        
        if tenant_id is not None:
            q = q.filter(Asset.tenant_id == tenant_id)
        
        if query:
            p = f"%{query}%"
            q = q.filter(or_(Asset.nome.ilike(p), Asset.codice.ilike(p), Asset.descrizione.ilike(p)))
            
        if impianto_id:
            q = q.filter(Asset.impianto_id == impianto_id)
        
        if sito_id:
            q = q.filter(Asset.impianto.has(Impianto.sito_id == sito_id))
            
        assets = q.order_by(Asset.nome).offset((page - 1) * limit).limit(limit).all()
        return [_to_dict(a) for a in assets]

    def get_by_id(self, db: Session, asset_id: int, tenant_id: int | None) -> dict | None:
        query = db.query(Asset).options(joinedload(Asset.impianto).joinedload(Impianto.sito))
        query = query.filter(Asset.id == asset_id)
        if tenant_id is not None:
            query = query.filter(Asset.tenant_id == tenant_id)
        asset = query.first()
        return _to_dict(asset) if asset else None

    def generate_codice_preview(self, db: Session, descrizione: str, tenant_id: int) -> str:
        return _generate_codice(db, descrizione, tenant_id)

    def create(self, db: Session, data: AssetCreate, tenant_id: int) -> dict:
        nome_val = data.nome or data.name or ""
        codice_val = data.codice or None
        auto_generated = False
        if not codice_val:
            source = data.descrizione or nome_val
            codice_val = _generate_codice(db, source, tenant_id)
            auto_generated = True

        if data.impianto_id:
            check_tenant_ownership(db, Impianto, data.impianto_id, tenant_id)
        
        asset = Asset(
            nome=nome_val,
            area=data.area,
            vincolo_orario=data.vincolo_orario or "",
            note=data.note or "",
            codice=codice_val,
            descrizione=data.descrizione or "",
            anno=data.anno,
            impianto_id=data.impianto_id,
            limitazioni=data.limitazioni or "",
            stato=_normalize_asset_stato(data.stato),
            weather_sunny_required=data.weather_sunny_required or False,
            weather_max_wind_kmh=data.weather_max_wind_kmh,
            weather_max_rain_mm=data.weather_max_rain_mm,
            anno_installazione=data.anno_installazione,
            anno_produzione=data.anno_produzione,
            marca=data.marca,
            modello=data.modello,
            matricola=data.matricola,
            numero_serie=data.numero_serie,
            fornitore=data.fornitore,
            data_acquisto=data.data_acquisto,
            data_scadenza_garanzia=data.data_scadenza_garanzia,
            vincoli_operativi=data.vincoli_operativi,
            vincoli_manutenzione=data.vincoli_manutenzione,
            note_tecniche=data.note_tecniche,
            criticita=data.criticita or "media",
            posizione_fisica=data.posizione_fisica,
            tenant_id=tenant_id,
        )

        db.add(asset)
        db.commit()
        db.refresh(asset)
        result = self.get_by_id(db, asset.id, tenant_id)
        if result:
            result["codice_auto_generated"] = auto_generated
        return result or _to_dict(asset)

    def update(self, db: Session, asset_id: int, data: AssetUpdate, tenant_id: int) -> dict | None:
        query = db.query(Asset).filter(Asset.id == asset_id)
        if tenant_id is not None:
            query = query.filter(Asset.tenant_id == tenant_id)
        asset = query.first()
        if not asset:
            return None
        nome_val = data.nome or data.name
        if nome_val is not None:
            asset.nome = nome_val
        if data.area is not None:
            asset.area = data.area
        if data.vincolo_orario is not None:
            asset.vincolo_orario = data.vincolo_orario
        if data.note is not None:
            asset.note = data.note
        if data.codice is not None:
            asset.codice = data.codice
        if data.descrizione is not None:
            asset.descrizione = data.descrizione
        if data.anno is not None:
            asset.anno = data.anno
        if "impianto_id" in data.model_fields_set:
            if data.impianto_id:
                check_tenant_ownership(db, Impianto, data.impianto_id, tenant_id)
            asset.impianto_id = data.impianto_id
        if data.limitazioni is not None:
            asset.limitazioni = data.limitazioni
        if data.stato is not None and _normalize_asset_stato(data.stato) != _normalize_asset_stato(asset.stato):
            asset.stato = _normalize_asset_stato(data.stato)
            asset.stato_changed_at = datetime.now(timezone.utc)
        elif data.stato is not None:
            asset.stato = _normalize_asset_stato(data.stato)
        if data.weather_sunny_required is not None:
            asset.weather_sunny_required = data.weather_sunny_required
        if data.weather_max_wind_kmh is not None:
            asset.weather_max_wind_kmh = data.weather_max_wind_kmh
        if data.weather_max_rain_mm is not None:
            asset.weather_max_rain_mm = data.weather_max_rain_mm
        for field in _NEW_ANAGRAFICA_FIELDS:
            val = getattr(data, field, None)
            if val is not None:
                setattr(asset, field, val)
        db.commit()
        db.refresh(asset)
        return self.get_by_id(db, asset_id, tenant_id)

    def delete(self, db: Session, asset_id: int, tenant_id: int) -> bool:
        query = db.query(Asset).filter(Asset.id == asset_id)
        if tenant_id is not None:
            query = query.filter(Asset.tenant_id == tenant_id)
        asset = query.first()
        if not asset:
            return False
        db.delete(asset)
        db.commit()
        return True

    def get_dettaglio_completo(self, db: Session, asset_id: int, tenant_id: int) -> dict | None:
        asset = (
            db.query(Asset)
            .options(joinedload(Asset.impianto).joinedload(Impianto.sito))
            .filter(Asset.id == asset_id, Asset.tenant_id == tenant_id)
            .first()
        )
        if not asset:
            return None
        base = _to_dict(asset)
        piani = db.query(AttivitaManutenzione).filter(
            AttivitaManutenzione.asset_id == asset_id
        ).all()
        base["piani_manutenzione"] = [
            {
                "id": p.id,
                "descrizione": p.descrizione,
                "frequenza_giorni": p.frequenza_giorni,
                "durata_ore": p.durata_ore,
                "priorita": p.priorita,
                "prossima_scadenza": p.prossima_scadenza.isoformat() if p.prossima_scadenza else None,
            }
            for p in piani
        ]
        tickets = (
            db.query(Ticket)
            .filter(Ticket.asset_id == asset_id, Ticket.tenant_id == tenant_id)
            .order_by(Ticket.created_at.desc())
            .limit(10)
            .all()
        )
        base["tickets"] = [
            {
                "id": t.id,
                "titolo": t.titolo,
                "stato": t.stato,
                "priorita": t.priorita,
                "tipo": t.tipo,
                "created_at": t.created_at.isoformat() if t.created_at else None,
            }
            for t in tickets
        ]
        return base

    def genera_multipli(self, db: Session, data, tenant_id: int) -> list[dict]:
        created = []
        for i in range(1, data.quantita + 1):
            nome = f"{data.prefisso_nome} {str(i).zfill(2)}"
            codice_val = _generate_codice(db, nome, tenant_id)
            asset = Asset(
                nome=nome,
                area=data.area,
                impianto_id=data.impianto_id,
                criticita=data.criticita or "media",
                marca=data.marca,
                modello=data.modello,
                stato="service",
                note="",
                codice=codice_val,
                tenant_id=tenant_id,
            )
            db.add(asset)
            db.flush()
            created.append(asset.id)
        db.commit()
        return [self.get_by_id(db, aid, tenant_id) for aid in created]

    def get_analytics(self, db: Session, asset_id: int, tenant_id: int) -> dict:
        from collections import Counter
        from datetime import timedelta

        tickets = db.query(Ticket).filter(
            Ticket.asset_id == asset_id,
            Ticket.tenant_id == tenant_id,
            Ticket.stato == "Chiuso",
        ).order_by(Ticket.execution_finish.asc()).all()

        bd_tickets = [t for t in tickets if t.tipo == "BD" and t.execution_finish and t.execution_start]

        mttr_hours = 0
        if bd_tickets:
            durations = [(t.execution_finish - t.execution_start).total_seconds() / 3600 for t in bd_tickets]
            mttr_hours = sum(durations) / len(durations)

        mtbf_days = 0
        if len(bd_tickets) > 1:
            intervals = []
            for i in range(len(bd_tickets) - 1):
                delta = bd_tickets[i + 1].execution_start - bd_tickets[i].execution_finish
                intervals.append(max(0, delta.total_seconds() / 86400))
            mtbf_days = sum(intervals) / len(intervals)

        tipi_counts = Counter([t.tipo for t in tickets])
        now = datetime.now(timezone.utc)
        trend = []
        for i in range(5, -1, -1):
            m_start = (now - timedelta(days=i * 30)).replace(day=1, hour=0, minute=0, second=0, microsecond=0)
            m_end = (m_start + timedelta(days=32)).replace(day=1)
            count = len([t for t in bd_tickets if m_start <= t.execution_finish.replace(tzinfo=timezone.utc) < m_end])
            trend.append({"mese": m_start.strftime("%b"), "guasti": count})

        return {
            "asset_id": asset_id,
            "mtbf_days": round(mtbf_days, 1),
            "mttr_hours": round(mttr_hours, 1),
            "stats": {
                "total": len(tickets),
                "breakdowns": len(bd_tickets),
                "preventive": tipi_counts.get("PM", 0),
                "corrective": tipi_counts.get("CM", 0),
                "inspections": tipi_counts.get("ISP", 0),
            },
            "failure_trend": trend,
            "availability_score": 100 - (min(100, (len(bd_tickets) * 1.5))),
        }


asset_repository = AssetRepository()
