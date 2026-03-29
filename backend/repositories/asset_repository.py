import re
from datetime import datetime, timezone
from sqlalchemy.orm import Session
from backend.db.modelli import Asset, Impianto
from backend.schemas.schemas import AssetCreate, AssetUpdate


def _to_dict(asset: Asset) -> dict:
    impianto_nome = None
    if asset.impianto:
        impianto_nome = asset.impianto.nome
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
        "limitazioni": asset.limitazioni or "",
        "stato": asset.stato or "service",
        "stato_changed_at": stato_changed_at,
        "weather_sunny_required": asset.weather_sunny_required or False,
        "weather_max_wind_kmh": asset.weather_max_wind_kmh,
        "weather_max_rain_mm": asset.weather_max_rain_mm,
    }



def _generate_codice(db: Session, descrizione: str) -> str:
    """Genera codice automatico: prima_parola_descrizione + numero_progressivo."""
    if not descrizione or not descrizione.strip():
        first_word = "asset"
    else:
        first_word = re.sub(r"[^a-zA-Z0-9]", "", descrizione.split()[0]).lower()
        if not first_word:
            first_word = "asset"
    existing = db.query(Asset).filter(Asset.codice.like(f"{first_word}%")).count()
    return f"{first_word}{existing + 1}"


class AssetRepository:

    def get_all(self, db: Session) -> list[dict]:
        from sqlalchemy.orm import joinedload
        assets = db.query(Asset).options(joinedload(Asset.impianto)).all()
        return [_to_dict(a) for a in assets]

    def get_by_id(self, db: Session, asset_id: int) -> dict | None:
        from sqlalchemy.orm import joinedload
        asset = db.query(Asset).options(joinedload(Asset.impianto)).filter(Asset.id == asset_id).first()
        return _to_dict(asset) if asset else None

    def generate_codice_preview(self, db: Session, descrizione: str) -> str:
        """Restituisce l'anteprima del codice che verrà generato automaticamente."""
        return _generate_codice(db, descrizione)

    def create(self, db: Session, data: AssetCreate) -> dict:
        nome_val = data.nome or data.name or ""
        codice_val = data.codice or None
        auto_generated = False
        if not codice_val:
            # descrizione usata per generare codice; fallback su nome
            source = data.descrizione or nome_val
            codice_val = _generate_codice(db, source)
            auto_generated = True

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
            stato=data.stato or "service",
            weather_sunny_required=data.weather_sunny_required or False,
            weather_max_wind_kmh=data.weather_max_wind_kmh,
            weather_max_rain_mm=data.weather_max_rain_mm,
        )

        db.add(asset)
        db.commit()
        db.refresh(asset)
        result = self.get_by_id(db, asset.id)
        if result:
            result["codice_auto_generated"] = auto_generated
        return result or _to_dict(asset)

    def update(self, db: Session, asset_id: int, data: AssetUpdate) -> dict | None:
        asset = db.query(Asset).filter(Asset.id == asset_id).first()
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
            asset.impianto_id = data.impianto_id
        if data.limitazioni is not None:
            asset.limitazioni = data.limitazioni
        if data.stato is not None and data.stato != asset.stato:
            asset.stato = data.stato
            asset.stato_changed_at = datetime.now(timezone.utc)
        elif data.stato is not None:
            asset.stato = data.stato
            
        if data.weather_sunny_required is not None:
            asset.weather_sunny_required = data.weather_sunny_required
        if data.weather_max_wind_kmh is not None:
            asset.weather_max_wind_kmh = data.weather_max_wind_kmh
        if data.weather_max_rain_mm is not None:
            asset.weather_max_rain_mm = data.weather_max_rain_mm

        db.commit()

        db.refresh(asset)
        return self.get_by_id(db, asset_id)

    def delete(self, db: Session, asset_id: int) -> bool:
        asset = db.query(Asset).filter(Asset.id == asset_id).first()
        if not asset:
            return False
        db.delete(asset)
        db.commit()
        return True

    def get_analytics(self, db: Session, asset_id: int) -> dict:
        from backend.db.modelli import Ticket
        from collections import Counter
        from datetime import timedelta

        # Carica tutti i ticket chiusi per quell'asset
        tickets = db.query(Ticket).filter(
            Ticket.asset_id == asset_id, 
            Ticket.stato == "Chiuso"
        ).order_by(Ticket.execution_finish.asc()).all()

        bd_tickets = [t for t in tickets if t.tipo == "BD" and t.execution_finish and t.execution_start]
        
        # 1. MTTR (Mean Time To Repair) - Ore medie di fermo per riparazione
        mttr_hours = 0
        if bd_tickets:
            durations = [(t.execution_finish - t.execution_start).total_seconds() / 3600 for t in bd_tickets]
            mttr_hours = sum(durations) / len(durations)

        # 2. MTBF (Mean Time Between Failures) - Giorni medi tra la fine di un guasto e l'inizio del successivo
        mtbf_days = 0
        if len(bd_tickets) > 1:
            intervals = []
            for i in range(len(bd_tickets) - 1):
                # Intervallo tra fine guasto i e inizio guasto i+1
                delta = bd_tickets[i+1].execution_start - bd_tickets[i].execution_finish
                intervals.append(max(0, delta.total_seconds() / 86400)) # in giorni
            mtbf_days = sum(intervals) / len(intervals)

        # 3. Distribuzione Tipi
        tipi_counts = Counter([t.tipo for t in tickets])

        # 4. Failure Trend (ultimi 6 mesi)
        now = datetime.now(timezone.utc)
        trend = []
        for i in range(5, -1, -1):
            m_start = (now - timedelta(days=i*30)).replace(day=1, hour=0, minute=0, second=0, microsecond=0)
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
                "inspections": tipi_counts.get("ISP", 0)
            },
            "failure_trend": trend,
            "availability_score": 100 - (min(100, (len(bd_tickets) * 1.5))) # Semplificato per demo
        }


asset_repository = AssetRepository()
