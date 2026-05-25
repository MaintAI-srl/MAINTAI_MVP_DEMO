from datetime import date, datetime, time
from sqlalchemy.orm import Session, joinedload
from backend.db.modelli import Tecnico, TecnicoAssenza
from backend.schemas.schemas import TecnicoCreate, TecnicoUpdate


class TecnicoRepository:

    def _to_dict(self, tecnico: Tecnico) -> dict:
        utente_username = None
        if tecnico.utente is not None:
            utente_username = tecnico.utente.username
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
            "telefono": getattr(tecnico, "telefono", None) or "",
            "sede_indirizzo": getattr(tecnico, "sede_indirizzo", None) or "",
            "utente_id": tecnico.utente_id,
            "utente_username": utente_username,
            "tenant_id": tecnico.tenant_id,
        }

    def get_all(self, db: Session, tenant_id: int | None) -> list[dict]:
        query = db.query(Tecnico).options(joinedload(Tecnico.utente))
        if tenant_id is not None:
            query = query.filter(Tecnico.tenant_id == tenant_id)
        return [self._to_dict(t) for t in query.order_by(Tecnico.cognome, Tecnico.nome).limit(500).all()]

    def get_disponibili(self, db: Session, tenant_id: int | None) -> list[dict]:
        """Restituisce tecnici senza assenza attiva oggi — fonte di verità: tabella assenze."""
        today = date.today()
        day_start = datetime.combine(today, time.min)
        day_end = datetime.combine(today, time.max)

        # Tecnici con assenza attiva oggi
        assenti_ids_q = db.query(TecnicoAssenza.tecnico_id).filter(
            TecnicoAssenza.data_inizio <= day_end,
            TecnicoAssenza.data_fine >= day_start,
        )
        if tenant_id is not None:
            assenti_ids_q = assenti_ids_q.filter(TecnicoAssenza.tenant_id == tenant_id)
        assenti_ids = {r[0] for r in assenti_ids_q.all()}

        query = db.query(Tecnico).options(joinedload(Tecnico.utente))
        if tenant_id is not None:
            query = query.filter(Tecnico.tenant_id == tenant_id)
        tutti = query.order_by(Tecnico.cognome, Tecnico.nome).limit(500).all()
        # Escludi tecnici assenti oggi e tecnici non in servizio per DB stato
        disponibili = [
            t for t in tutti
            if t.id not in assenti_ids
            and (t.stato or "in servizio").lower() in ("in servizio", "in_servizio")
        ]
        return [self._to_dict(t) for t in disponibili]

    def get_by_id(self, db: Session, tecnico_id: int, tenant_id: int | None) -> dict | None:
        query = db.query(Tecnico).options(joinedload(Tecnico.utente)).filter(Tecnico.id == tecnico_id)
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
            utente_id=data.utente_id,
            telefono=getattr(data, "telefono", None),
            sede_indirizzo=getattr(data, "sede_indirizzo", None),
            tenant_id=tenant_id,
        )
        db.add(tecnico)
        db.commit()
        db.refresh(tecnico)
        # Ricarica con utente per popolare utente_username
        tecnico = db.query(Tecnico).options(joinedload(Tecnico.utente)).filter(Tecnico.id == tecnico.id).first()
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
        if "utente_id" in data.model_fields_set:
            tecnico.utente_id = data.utente_id  # None = scollega
        if data.telefono is not None:
            tecnico.telefono = data.telefono
        if data.sede_indirizzo is not None:
            tecnico.sede_indirizzo = data.sede_indirizzo
        db.commit()
        db.refresh(tecnico)
        # Ricarica con utente per popolare utente_username
        tecnico = db.query(Tecnico).options(joinedload(Tecnico.utente)).filter(Tecnico.id == tecnico.id).first()
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
