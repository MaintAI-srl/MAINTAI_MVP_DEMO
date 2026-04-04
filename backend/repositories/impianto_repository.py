from backend.db.modelli import Impianto, Asset, Ticket, Sito
from backend.schemas.impianti import ImpiantoCreate, ImpiantoUpdate
from backend.core.security import check_tenant_ownership


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
        "tenant_id": imp.tenant_id,
    }


class ImpiantoRepository:

    def get_all(self, db: Session, tenant_id: int) -> list[dict]:
        query = db.query(Impianto).options(joinedload(Impianto.sito))
        if tenant_id is not None:
            query = query.filter(Impianto.tenant_id == tenant_id)
        impianti = query.order_by(Impianto.nome).all()
        return [_to_dict(i) for i in impianti]

    def get_by_id(self, db: Session, imp_id: int, tenant_id: int) -> dict | None:
        query = db.query(Impianto).options(joinedload(Impianto.sito))
        query = query.filter(Impianto.id == imp_id)
        if tenant_id is not None:
            query = query.filter(Impianto.tenant_id == tenant_id)
        imp = query.first()
        return _to_dict(imp) if imp else None

    def create(self, db: Session, data: ImpiantoCreate, tenant_id: int) -> dict:
        if data.sito_id:
            check_tenant_ownership(db, Sito, data.sito_id, tenant_id)
            
        imp = Impianto(
            nome=data.nome,
            descrizione=data.descrizione,
            latitude=data.latitude,
            longitude=data.longitude,
            sito_id=data.sito_id,
            tipologia=data.tipologia,
            note=data.note,
            tenant_id=tenant_id,
        )
        db.add(imp)
        db.commit()
        db.refresh(imp)
        return self.get_by_id(db, imp.id, tenant_id) or _to_dict(imp)

    def update(self, db: Session, imp_id: int, data: ImpiantoUpdate, tenant_id: int | None) -> dict | None:
        query = db.query(Impianto).filter(Impianto.id == imp_id)
        if tenant_id is not None:
            query = query.filter(Impianto.tenant_id == tenant_id)
        imp = query.first()
        if not imp:
            return None
        for field in ["nome", "descrizione", "latitude", "longitude", "sito_id", "tipologia", "note"]:
            val = getattr(data, field, None)
            if val is not None:
                if field == "sito_id" and val:
                    check_tenant_ownership(db, Sito, val, tenant_id)
                setattr(imp, field, val)
        db.commit()
        db.refresh(imp)
        return self.get_by_id(db, imp_id, tenant_id)

    def delete(self, db: Session, imp_id: int, tenant_id: int | None) -> bool:
        query = db.query(Impianto).filter(Impianto.id == imp_id)
        if tenant_id is not None:
            query = query.filter(Impianto.tenant_id == tenant_id)
        imp = query.first()
        if not imp:
            return False
        db.delete(imp)
        db.commit()
        return True

    def get_tree(self, db: Session, imp_id: int, tenant_id: int | None) -> dict | None:
        query = db.query(Impianto).options(joinedload(Impianto.sito), joinedload(Impianto.assets))
        query = query.filter(Impianto.id == imp_id)
        if tenant_id is not None:
            query = query.filter(Impianto.tenant_id == tenant_id)
        imp = query.first()
        if not imp:
            return None

        ticket_aperti = (
            db.query(Ticket)
            .join(Asset, Ticket.asset_id == Asset.id)
            .filter(Asset.impianto_id == imp_id)
            .filter(Ticket.tenant_id == tenant_id)
            .filter(Ticket.stato.notin_(["Chiuso", "Eliminato"]))
            .count()
        )

        assets_list = [
            {
                "id": a.id,
                "nome": a.nome,
                "codice": a.codice,
                "stato": a.stato,
                "criticita": a.criticita or "media",
                "area": a.area,
                "marca": a.marca,
                "modello": a.modello,
            }
            for a in imp.assets
        ]

        return {
            **_to_dict(imp),
            "assets": assets_list,
            "n_asset": len(assets_list),
            "ticket_aperti": ticket_aperti,
        }

    def genera_multipli(self, db: Session, sito_id: int, tipologia: str,
                        prefisso_nome: str, quantita: int,
                        dati_comuni: dict | None, tenant_id: int) -> list[dict]:
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
                tenant_id=tenant_id,
            )
            db.add(imp)
            db.flush()
            created.append(imp)
        db.commit()
        for imp in created:
            db.refresh(imp)
        return [self.get_by_id(db, imp.id, tenant_id) for imp in created]


impianto_repository = ImpiantoRepository()
