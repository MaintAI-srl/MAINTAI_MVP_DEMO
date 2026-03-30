from sqlalchemy.orm import Session, joinedload
from backend.db.modelli import Impianto, Asset, Ticket
from backend.schemas.impianti import ImpiantoCreate, ImpiantoUpdate


def _to_dict(imp: Impianto) -> dict:
    sito_nome = imp.sito.nome if imp.sito else None
    return {
        "id": imp.id,
        "nome": imp.nome,
        "descrizione": imp.descrizione or "",
        "latitude": imp.latitude,
        "longitude": imp.longitude,
        "sito_id": imp.sito_id,
        "sito_nome": sito_nome,
        "tipologia": imp.tipologia,
        "note": imp.note,
    }


class ImpiantoRepository:

    def get_all(self, db: Session) -> list[dict]:
        impianti = db.query(Impianto).options(joinedload(Impianto.sito)).order_by(Impianto.nome).all()
        return [_to_dict(i) for i in impianti]

    def get_by_id(self, db: Session, imp_id: int) -> dict | None:
        imp = db.query(Impianto).options(joinedload(Impianto.sito)).filter(Impianto.id == imp_id).first()
        return _to_dict(imp) if imp else None

    def create(self, db: Session, data: ImpiantoCreate) -> dict:
        imp = Impianto(
            nome=data.nome,
            descrizione=data.descrizione,
            latitude=data.latitude,
            longitude=data.longitude,
            sito_id=data.sito_id,
            tipologia=data.tipologia,
            note=data.note,
        )
        db.add(imp)
        db.commit()
        db.refresh(imp)
        return self.get_by_id(db, imp.id) or _to_dict(imp)

    def update(self, db: Session, imp_id: int, data: ImpiantoUpdate) -> dict | None:
        imp = db.query(Impianto).filter(Impianto.id == imp_id).first()
        if not imp:
            return None
        for field in ["nome", "descrizione", "latitude", "longitude", "sito_id", "tipologia", "note"]:
            val = getattr(data, field, None)
            if val is not None:
                setattr(imp, field, val)
        db.commit()
        db.refresh(imp)
        return self.get_by_id(db, imp_id)

    def delete(self, db: Session, imp_id: int) -> bool:
        imp = db.query(Impianto).filter(Impianto.id == imp_id).first()
        if not imp:
            return False
        db.delete(imp)
        db.commit()
        return True

    def get_tree(self, db: Session, imp_id: int) -> dict | None:
        imp = (
            db.query(Impianto)
            .options(joinedload(Impianto.sito), joinedload(Impianto.assets))
            .filter(Impianto.id == imp_id)
            .first()
        )
        if not imp:
            return None

        ticket_aperti = (
            db.query(Ticket)
            .join(Asset, Ticket.asset_id == Asset.id)
            .filter(Asset.impianto_id == imp_id)
            .filter(Ticket.stato.notin_(["Chiuso", "Eliminato"]))
            .count()
        )

        assets_list = []
        for a in imp.assets:
            assets_list.append({
                "id": a.id,
                "nome": a.nome,
                "codice": a.codice,
                "stato": a.stato,
                "criticita": a.criticita or "media",
                "area": a.area,
                "marca": a.marca,
                "modello": a.modello,
            })

        return {
            **_to_dict(imp),
            "assets": assets_list,
            "n_asset": len(assets_list),
            "ticket_aperti": ticket_aperti,
        }

    def genera_multipli(self, db: Session, sito_id: int, tipologia: str,
                        prefisso_nome: str, quantita: int,
                        dati_comuni: dict | None) -> list[dict]:
        dati_comuni = dati_comuni or {}
        created = []
        for i in range(1, quantita + 1):
            nome = f"{prefisso_nome} {str(i).zfill(2)}"
            imp = Impianto(
                nome=nome,
                sito_id=sito_id,
                tipologia=tipologia,
                descrizione=dati_comuni.get("descrizione"),
                note=dati_comuni.get("note"),
            )
            db.add(imp)
            db.flush()  # ottieni id senza commit
            created.append(imp)
        db.commit()
        for imp in created:
            db.refresh(imp)
        return [self.get_by_id(db, imp.id) for imp in created]


impianto_repository = ImpiantoRepository()
