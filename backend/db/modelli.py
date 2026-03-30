import json
from datetime import datetime, timezone, date
from sqlalchemy import Column, Integer, Float, String, Text, ForeignKey, Boolean, DateTime, Date, event
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


class Sito(Base):
    """Sito produttivo - livello gerarchico sopra l'Impianto."""
    __tablename__ = "siti"

    id = Column(Integer, primary_key=True, index=True)
    nome = Column(String, nullable=False)
    descrizione = Column(String, nullable=True)
    ubicazione = Column(String, nullable=True)
    citta = Column(String, nullable=True)
    paese = Column(String, default="Italia")
    responsabile = Column(String, nullable=True)
    telefono_responsabile = Column(String, nullable=True)
    email_responsabile = Column(String, nullable=True)
    note = Column(String, nullable=True)
    created_at = Column(DateTime, default=_utcnow)
    updated_at = Column(DateTime, default=_utcnow, onupdate=_utcnow)

    impianti = relationship("Impianto", back_populates="sito")


class Impianto(Base):
    """Impianto (plant/facility) - contenitore di asset."""
    __tablename__ = "impianti"

    id = Column(Integer, primary_key=True, index=True)
    nome = Column(String, nullable=False)
    descrizione = Column(Text, nullable=True)

    assets = relationship("Asset", back_populates="impianto")

    # Localizzazione meteo
    latitude = Column(Float, nullable=True)
    longitude = Column(Float, nullable=True)

    # Collegamento al sito
    sito_id = Column(Integer, ForeignKey("siti.id"), nullable=True)
    sito = relationship("Sito", back_populates="impianti")
    tipologia = Column(String, nullable=True)   # es. "Cabina MT", "Pompe", "HVAC"
    note = Column(String, nullable=True)


class Asset(Base):
    __tablename__ = "asset"

    id = Column(Integer, primary_key=True, index=True)
    # campi originali mantenuti per retrocompatibilita
    nome = Column(String)
    area = Column(String)
    vincolo_orario = Column(String, nullable=True)
    note = Column(Text)
    # campi estesi precedenti
    codice = Column(String, nullable=True, index=True)
    descrizione = Column(Text, nullable=True)
    anno = Column(Integer, nullable=True)
    impianto_id = Column(Integer, ForeignKey("impianti.id"), nullable=True)
    limitazioni = Column(Text, nullable=True)
    stato = Column(String, default="service")           # service | out of service | stopped
    stato_changed_at = Column(DateTime, nullable=True)

    # Vincoli meteo
    weather_sunny_required = Column(Boolean, default=False)
    weather_max_wind_kmh = Column(Float, nullable=True)
    weather_max_rain_mm = Column(Float, nullable=True)

    # Nuovi campi anagrafica
    anno_installazione = Column(Integer, nullable=True)
    anno_produzione = Column(Integer, nullable=True)
    marca = Column(String, nullable=True)
    modello = Column(String, nullable=True)
    matricola = Column(String, nullable=True)
    numero_serie = Column(String, nullable=True)
    fornitore = Column(String, nullable=True)
    data_acquisto = Column(Date, nullable=True)
    data_scadenza_garanzia = Column(Date, nullable=True)
    vincoli_operativi = Column(Text, nullable=True)
    vincoli_manutenzione = Column(Text, nullable=True)
    note_tecniche = Column(Text, nullable=True)
    criticita = Column(String, default="media")         # bassa, media, alta, critica
    posizione_fisica = Column(String, nullable=True)

    created_at = Column(DateTime, default=_utcnow)
    updated_at = Column(DateTime, default=_utcnow, onupdate=_utcnow)

    impianto = relationship("Impianto", back_populates="assets")


class Tecnico(Base):
    __tablename__ = "tecnici"

    id = Column(Integer, primary_key=True, index=True)
    utente_id = Column(Integer, ForeignKey("utenti.id"), nullable=True)
    nome = Column(String)
    competenze = Column(String)
    ore_giornaliere = Column(Integer)
    cognome = Column(String, nullable=True)
    stato = Column(String, default="in servizio")
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
    tipo = Column(String, default="CM")
    priorita = Column(String)
    stato = Column(String)
    durata_stimata_ore = Column(Float)
    fascia_oraria = Column(String)
    descrizione = Column(Text)
    attivita_manutenzione_id = Column(Integer, ForeignKey("attivita_manutenzione.id"), nullable=True)
    tecnico_id = Column(Integer, ForeignKey("tecnici.id"), nullable=True)
    planned_start = Column(DateTime, nullable=True)
    planned_finish = Column(DateTime, nullable=True)
    execution_start = Column(DateTime, nullable=True)
    execution_finish = Column(DateTime, nullable=True)
    created_at = Column(DateTime, default=_utcnow)
    updated_at = Column(DateTime, default=_utcnow, onupdate=_utcnow)
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
    tipo_assenza = Column(String, default="Ferie")
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
