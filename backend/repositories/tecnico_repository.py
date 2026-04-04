from sqlalchemy.orm import Session
from backend.db.modelli import Tecnico
from backend.schemas.schemas import TecnicoCreate, TecnicoUpdate


class TecnicoRepository:

    def _to_dict(self, tecnico: Tecnico) -> dict:
        return {
            "id": tecnico.id,
            "nome": tecnico.nome,
            "cognome": tecnico.cognome or "",
            "skill": tecnico.competenze or "",
            "ore_giornaliere": tecnico.ore_giornaliere or 8,
            "stato": tecnico.stato or "in servizio",
            "orario_inizio": tecnico.orario_inizio or "08:00",
            "orario_fine": tecnico.orario_fine or "17:00",
            "limitazioni_orarie": tecnico.limitazioni_orarie or "",
            "utente_id": tecnico.utente_id,
            "tenant_id": tecnico.tenant_id,
        }

    def get_all(self, db: Session, tenant_id: int | None) -> list[dict]:
        query = db.query(Tecnico)
        if tenant_id is not None:
            query = query.filter(Tecnico.tenant_id == tenant_id)
        return [self._to_dict(t) for t in query.all()]

    def get_disponibili(self, db: Session, tenant_id: int | None) -> list[dict]:
        query = db.query(Tecnico).filter(Tecnico.stato == "in servizio")
        if tenant_id is not None:
            query = query.filter(Tecnico.tenant_id == tenant_id)
        return [self._to_dict(t) for t in query.all()]

    def get_by_id(self, db: Session, tecnico_id: int, tenant_id: int | None) -> dict | None:
        query = db.query(Tecnico).filter(Tecnico.id == tecnico_id)
        if tenant_id is not None:
            query = query.filter(Tecnico.tenant_id == tenant_id)
        t = query.first()
        return self._to_dict(t) if t else None

    def create(self, db: Session, data: TecnicoCreate, tenant_id: int) -> dict:
        tecnico = Tecnico(
            nome=data.nome,
            cognome=data.cognome,
            competenze=data.skill,
            ore_giornaliere=data.ore_giornaliere,
            stato=data.stato or "in servizio",
            orario_inizio=data.orario_inizio or "08:00",
            orario_fine=data.orario_fine or "17:00",
            limitazioni_orarie=data.limitazioni_orarie,
            tenant_id=tenant_id,
        )
        db.add(tecnico)
        db.commit()
        db.refresh(tecnico)
        return self._to_dict(tecnico)

    def update(self, db: Session, tecnico_id: int, data: TecnicoUpdate, tenant_id: int | None) -> dict | None:
        query = db.query(Tecnico).filter(Tecnico.id == tecnico_id)
        if tenant_id is not None:
            query = query.filter(Tecnico.tenant_id == tenant_id)
        tecnico = query.first()
        if not tecnico:
            return None
        if data.nome is not None:
            tecnico.nome = data.nome
        if data.cognome is not None:
            tecnico.cognome = data.cognome
        if data.skill is not None:
            tecnico.competenze = data.skill
        if data.ore_giornaliere is not None:
            tecnico.ore_giornaliere = data.ore_giornaliere
        if data.stato is not None:
            tecnico.stato = data.stato
        if data.orario_inizio is not None:
            tecnico.orario_inizio = data.orario_inizio
        if data.orario_fine is not None:
            tecnico.orario_fine = data.orario_fine
        if data.limitazioni_orarie is not None:
            tecnico.limitazioni_orarie = data.limitazioni_orarie
        db.commit()
        db.refresh(tecnico)
        return self._to_dict(tecnico)

    def delete(self, db: Session, tecnico_id: int, tenant_id: int | None) -> bool:
        query = db.query(Tecnico).filter(Tecnico.id == tecnico_id)
        if tenant_id is not None:
            query = query.filter(Tecnico.tenant_id == tenant_id)
        tecnico = query.first()
        if not tecnico:
            return False
        db.delete(tecnico)
        db.commit()
        return True


tecnico_repository = TecnicoRepository()
