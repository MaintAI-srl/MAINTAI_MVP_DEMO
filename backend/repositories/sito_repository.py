from sqlalchemy.orm import Session, joinedload
from backend.db.modelli import Sito, Impianto, Asset, Ticket
from backend.schemas.siti import SitoCreate, SitoUpdate


def _to_dict(sito: Sito) -> dict:
    return {
        "id": sito.id,
        "nome": sito.nome,
        "descrizione": sito.descrizione,
        "ubicazione": sito.ubicazione,
        "citta": sito.citta,
        "paese": sito.paese,
        "responsabile": sito.responsabile,
        "telefono_responsabile": sito.telefono_responsabile,
        "email_responsabile": sito.email_responsabile,
        "note": sito.note,
        "tenant_id": sito.tenant_id,
        "created_at": sito.created_at.isoformat() if sito.created_at else None,
        "updated_at": sito.updated_at.isoformat() if sito.updated_at else None,
    }


class SitoRepository:

    def get_all(self, db: Session, tenant_id: int) -> list[dict]:
        return [_to_dict(s) for s in db.query(Sito).filter(Sito.tenant_id == tenant_id).order_by(Sito.nome).all()]

    def get_by_id(self, db: Session, sito_id: int, tenant_id: int) -> dict | None:
        sito = db.query(Sito).filter(Sito.id == sito_id, Sito.tenant_id == tenant_id).first()
        return _to_dict(sito) if sito else None

    def create(self, db: Session, data: SitoCreate, tenant_id: int) -> dict:
        sito = Sito(
            nome=data.nome,
            descrizione=data.descrizione,
            ubicazione=data.ubicazione,
            citta=data.citta,
            paese=data.paese or "Italia",
            responsabile=data.responsabile,
            telefono_responsabile=data.telefono_responsabile,
            email_responsabile=data.email_responsabile,
            note=data.note,
            tenant_id=tenant_id,
        )
        db.add(sito)
        db.commit()
        db.refresh(sito)
        return _to_dict(sito)

    def update(self, db: Session, sito_id: int, data: SitoUpdate, tenant_id: int) -> dict | None:
        sito = db.query(Sito).filter(Sito.id == sito_id, Sito.tenant_id == tenant_id).first()
        if not sito:
            return None
        for field in ["nome", "descrizione", "ubicazione", "citta", "paese",
                      "responsabile", "telefono_responsabile", "email_responsabile", "note"]:
            val = getattr(data, field, None)
            if val is not None:
                setattr(sito, field, val)
        db.commit()
        db.refresh(sito)
        return _to_dict(sito)

    def delete(self, db: Session, sito_id: int, tenant_id: int) -> bool:
        sito = db.query(Sito).filter(Sito.id == sito_id, Sito.tenant_id == tenant_id).first()
        if not sito:
            return False
        db.delete(sito)
        db.commit()
        return True

    def get_tree(self, db: Session, sito_id: int, tenant_id: int) -> dict | None:
        sito = (
            db.query(Sito)
            .options(joinedload(Sito.impianti).joinedload(Impianto.assets))
            .filter(Sito.id == sito_id, Sito.tenant_id == tenant_id)
            .first()
        )
        if not sito:
            return None

        ticket_aperti = (
            db.query(Ticket)
            .join(Asset, Ticket.asset_id == Asset.id)
            .join(Impianto, Asset.impianto_id == Impianto.id)
            .filter(Impianto.sito_id == sito_id)
            .filter(Ticket.tenant_id == tenant_id)
            .filter(Ticket.stato.notin_(["Chiuso", "Eliminato"]))
            .count()
        )

        impianti_tree = []
        total_assets = 0
        asset_critici = 0

        for imp in sito.impianti:
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
                if a.criticita in ("alta", "critica"):
                    asset_critici += 1
                total_assets += 1

            imp_ticket_aperti = (
                db.query(Ticket)
                .join(Asset, Ticket.asset_id == Asset.id)
                .filter(Asset.impianto_id == imp.id)
                .filter(Ticket.tenant_id == tenant_id)
                .filter(Ticket.stato.notin_(["Chiuso", "Eliminato"]))
                .count()
            )

            impianti_tree.append({
                "id": imp.id,
                "nome": imp.nome,
                "tipologia": imp.tipologia,
                "note": imp.note,
                "assets": assets_list,
                "n_asset": len(assets_list),
                "ticket_aperti": imp_ticket_aperti,
            })

        return {
            **_to_dict(sito),
            "impianti": impianti_tree,
            "n_impianti": len(impianti_tree),
            "n_asset_totali": total_assets,
            "ticket_aperti": ticket_aperti,
            "asset_critici": asset_critici,
        }

    def get_all_tree(self, db: Session, tenant_id: int) -> list[dict]:
        siti = db.query(Sito).filter(Sito.tenant_id == tenant_id).order_by(Sito.nome).all()
        result = []
        for sito in siti:
            tree = self.get_tree(db, sito.id, tenant_id)
            if tree:
                result.append(tree)
        return result


sito_repository = SitoRepository()
