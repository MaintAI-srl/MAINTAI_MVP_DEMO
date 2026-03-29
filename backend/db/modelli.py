import json
from datetime import datetime, timezone
from sqlalchemy import Column, Integer, Float, String, Text, ForeignKey, Boolean, DateTime, event
from sqlalchemy.orm import relationship
from backend.core.database import Base


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


class Utente(Base):
    __tablename__ = "utenti"

    id = Column(Integer, primary_key=True, index=True)
    username = Column(String, unique=True, index=True, nullable=False)
    password_hash = Column(String, nullable=False)
    ruolo = Column(String, default="tecnico")  # "responsabile" o "tecnico"
    is_active = Column(Boolean, default=True)


class Impianto(Base):
    """Impianto (plant/facility) — contenitore di asset."""
    __tablename__ = "impianti"

    id = Column(Integer, primary_key=True, index=True)
    nome = Column(String, nullable=False)
    descrizione = Column(Text, nullable=True)

    assets = relationship("Asset", back_populates="impianto")
    
    # Nuovi campi per localizzazione meteo
    latitude = Column(Float, nullable=True)
    longitude = Column(Float, nullable=True)



class Asset(Base):
    __tablename__ = "asset"

    id = Column(Integer, primary_key=True, index=True)
    # campi originali mantenuti per retrocompatibilità
    nome = Column(String)
    area = Column(String)
    vincolo_orario = Column(String, nullable=True)
    note = Column(Text)
    # nuovi campi
    codice = Column(String, nullable=True, index=True)       # ID human-readable opzionale
    descrizione = Column(Text, nullable=True)                 # descrizione estesa
    anno = Column(Integer, nullable=True)                     # anno installazione
    impianto_id = Column(Integer, ForeignKey("impianti.id"), nullable=True)
    limitazioni = Column(Text, nullable=True)                 # vincoli liberi (testo)
    stato = Column(String, default="service")                 # service | out of service | stopped
    stato_changed_at = Column(DateTime, nullable=True)        # when stato last changed
    
    # Nuovi vincoli per Scheduler Meteo
    weather_sunny_required = Column(Boolean, default=False)
    weather_max_wind_kmh = Column(Float, nullable=True)
    weather_max_rain_mm = Column(Float, nullable=True)

    created_at = Column(DateTime, default=_utcnow)

    updated_at = Column(DateTime, default=_utcnow, onupdate=_utcnow)

    impianto = relationship("Impianto", back_populates="assets")


class Tecnico(Base):
    __tablename__ = "tecnici"

    id = Column(Integer, primary_key=True, index=True)
    utente_id = Column(Integer, ForeignKey("utenti.id"), nullable=True) # Linked user account
    # campi originali
    nome = Column(String)
    competenze = Column(String)        # skill list CSV
    ore_giornaliere = Column(Integer)
    # nuovi campi
    cognome = Column(String, nullable=True)
    stato = Column(String, default="in servizio")   # in servizio | ferie | malattia | corso
    orario_inizio = Column(String, nullable=True, default="08:00")
    orario_fine = Column(String, nullable=True, default="17:00")
    limitazioni_orarie = Column(Text, nullable=True)

    utente = relationship("Utente")
    assenze = relationship("TecnicoAssenza", back_populates="tecnico", cascade="all, delete-orphan")

class Ticket(Base):
    __tablename__ = "ticket"

    id = Column(Integer, primary_key=True, index=True)
    titolo = Column(String)
    asset_id = Column(Integer, ForeignKey("asset.id"))
    tipo = Column(String, default="CM")  # PM, CM, BD, ISP
    priorita = Column(String)
    stato = Column(String)
    durata_stimata_ore = Column(Float)  # Float per supportare durate non intere (es. 1.5h)
    fascia_oraria = Column(String)
    descrizione = Column(Text)
    attivita_manutenzione_id = Column(Integer, ForeignKey("attivita_manutenzione.id"), nullable=True)
    tecnico_id = Column(Integer, ForeignKey("tecnici.id"), nullable=True)
    # nuovi campi date/ora
    planned_start = Column(DateTime, nullable=True)
    planned_finish = Column(DateTime, nullable=True)
    execution_start = Column(DateTime, nullable=True)
    execution_finish = Column(DateTime, nullable=True)
    created_at = Column(DateTime, default=_utcnow)
    updated_at = Column(DateTime, default=_utcnow, onupdate=_utcnow)
    # v3.4 — interdipendenza ticket
    parent_id = Column(Integer, ForeignKey("ticket.id"), nullable=True)
    diagnosi_eseguita = Column(Boolean, default=False)
    firma_percorso = Column(String, nullable=True)

    asset = relationship("Asset")
    tecnico = relationship("Tecnico")
    children = relationship("Ticket", foreign_keys="Ticket.parent_id", back_populates="parent", lazy="dynamic")
    parent = relationship("Ticket", foreign_keys="Ticket.parent_id", remote_side="Ticket.id", back_populates="children")


class Manuale(Base):
    __tablename__ = "manuali"

    id = Column(Integer, primary_key=True, index=True)
    nome_file = Column(String)
    pagine = Column(Integer)
    metodo_lettura = Column(String)
    testo_raw = Column(Text)
    json_estratto = Column(Text)
    version = Column(Integer, default=1)
    stato = Column(String, default="attivo")


class AttivitaManutenzione(Base):
    __tablename__ = "attivita_manutenzione"

    id = Column(Integer, primary_key=True, index=True)
    asset_id = Column(Integer, ForeignKey("asset.id"))
    manuale_id = Column(Integer, ForeignKey("manuali.id"))

    descrizione = Column(Text)
    frequenza_giorni = Column(Integer)
    durata_ore = Column(Float)
    priorita = Column(String)
    origine = Column(String)
    # tracciamento esecuzioni per aggiornamento scadenze
    ultima_esecuzione = Column(DateTime, nullable=True)
    prossima_scadenza = Column(DateTime, nullable=True)


class AnalisiGuasto(Base):
    __tablename__ = "analisi_guasti"

    id = Column(Integer, primary_key=True, index=True)
    ticket_id = Column(Integer, ForeignKey("ticket.id"))

    metodo = Column(String)
    sintomi = Column(Text)
    analisi_json = Column(Text)
    ai_utilizzata = Column(Boolean)

    ticket = relationship("Ticket")


class DiagnosticSession(Base):
    __tablename__ = "diagnostic_sessions"

    id = Column(Integer, primary_key=True, index=True)
    ticket_id = Column(Integer, ForeignKey("ticket.id"))
    history = Column(Text, default="[]")
    status = Column(String, default="active")
    root_cause = Column(Text, nullable=True)
    created_at = Column(DateTime, default=lambda: datetime.now(timezone.utc))

    ticket = relationship("Ticket")


@event.listens_for(Asset.stato, 'set')
def receive_set(target, value, oldvalue, initiator):
    if value != oldvalue:
        target.stato_changed_at = datetime.now(timezone.utc)

class TecnicoAssenza(Base):
    __tablename__ = "tecnici_assenze"

    id = Column(Integer, primary_key=True, index=True)
    tecnico_id = Column(Integer, ForeignKey("tecnici.id"), nullable=False, index=True)
    data_inizio = Column(DateTime, nullable=False)
    data_fine = Column(DateTime, nullable=False)
    tipo_assenza = Column(String, default="Ferie")  # Ferie, Malattia, Corso, Altro
    note = Column(Text, nullable=True)

    tecnico = relationship("Tecnico", back_populates="assenze")

class TicketAllegato(Base):
    __tablename__ = "ticket_allegati"

    id = Column(Integer, primary_key=True, index=True)
    ticket_id = Column(Integer, ForeignKey("ticket.id"))
    nome_file = Column(String(255), nullable=False)
    percorso = Column(String(512), nullable=False)
    tipo_mime = Column(String(100), nullable=True)
    dimensione_bytes = Column(Integer, nullable=True)
    creato_il = Column(DateTime, default=lambda: datetime.now(timezone.utc))

    ticket = relationship("Ticket", backref="allegati")
