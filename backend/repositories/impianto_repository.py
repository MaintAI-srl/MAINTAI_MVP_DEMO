from sqlalchemy.orm import Session
from backend.db.modelli import Impianto
from backend.schemas.impianti import ImpiantoCreate, ImpiantoUpdate


def _to_dict(imp: Impianto) -> dict:
    return {
        "id": imp.id,
        "nome": imp.nome,
        "descrizione": imp.descrizione or "",
    }


class ImpiantoRepository:

    def get_all(self, db: Session) -> list[dict]:
        return [_to_dict(i) for i in db.query(Impianto).order_by(Impianto.nome).all()]

    def get_by_id(self, db: Session, imp_id: int) -> dict | None:
        imp = db.query(Impianto).filter(Impianto.id == imp_id).first()
        return _to_dict(imp) if imp else None

    def create(self, db: Session, data: ImpiantoCreate) -> dict:
        imp = Impianto(nome=data.nome, descrizione=data.descrizione)
        db.add(imp)
        db.commit()
        db.refresh(imp)
        return _to_dict(imp)

    def update(self, db: Session, imp_id: int, data: ImpiantoUpdate) -> dict | None:
        imp = db.query(Impianto).filter(Impianto.id == imp_id).first()
        if not imp:
            return None
        if data.nome is not None:
            imp.nome = data.nome
        if data.descrizione is not None:
            imp.descrizione = data.descrizione
        db.commit()
        db.refresh(imp)
        return _to_dict(imp)

    def delete(self, db: Session, imp_id: int) -> bool:
        imp = db.query(Impianto).filter(Impianto.id == imp_id).first()
        if not imp:
            return False
        db.delete(imp)
        db.commit()
        return True


impianto_repository = ImpiantoRepository()
