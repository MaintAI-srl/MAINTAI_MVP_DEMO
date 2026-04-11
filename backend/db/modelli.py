import json
from datetime import datetime, timezone, date
from sqlalchemy import Column, Integer, Float, String, Text, ForeignKey, Boolean, DateTime, Date, Time, JSON, event
from sqlalchemy.orm import relationship
from backend.core.database import Base


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


class Tenant(Base):
    """Tenant (cliente/azienda) - isolamento dati multi-utente."""
    __tablename__ = "tenants"

    id = Column(Integer, primary_key=True, index=True)
    nome = Column(String, nullable=False)
    slug = Column(String, unique=True, nullable=False, index=True)
    is_active = Column(Boolean, default=True)
    created_at = Column(DateTime, default=_utcnow)

    utenti = relationship("Utente", back_populates="tenant")
    siti = relationship("Sito", back_populates="tenant")
    tecnici = relationship("Tecnico", back_populates="tenant")


class Utente(Base):
    __tablename__ = "utenti"

    id = Column(Integer, primary_key=True, index=True)
    username = Column(String, unique=True, index=True, nullable=False)
    password_hash = Column(String, nullable=False)
    ruolo = Column(String, default="tecnico")  # "superadmin" | "responsabile" | "tecnico"
    is_active = Column(Boolean, default=True)
    tenant_id = Column(Integer, ForeignKey("tenants.id"), nullable=True)

    tenant = relationship("Tenant", back_populates="utenti")


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
    tenant_id = Column(Integer, ForeignKey("tenants.id"), nullable=True, index=True)

    impianti = relationship("Impianto", back_populates="sito", cascade="all, delete-orphan")
    tenant = relationship("Tenant", back_populates="siti")


class Impianto(Base):
    """Impianto (plant/facility) - contenitore di asset."""
    __tablename__ = "impianti"

    id = Column(Integer, primary_key=True, index=True)
    nome = Column(String, nullable=False)
    descrizione = Column(Text, nullable=True)

    assets = relationship("Asset", back_populates="impianto", cascade="all, delete-orphan")

    # Localizzazione meteo
    latitude = Column(Float, nullable=True)
    longitude = Column(Float, nullable=True)

    # Collegamento al sito
    sito_id = Column(Integer, ForeignKey("siti.id"), nullable=True)
    sito = relationship("Sito", back_populates="impianti")
    tipologia = Column(String, nullable=True)
    note = Column(String, nullable=True)
    tenant_id = Column(Integer, ForeignKey("tenants.id"), nullable=True, index=True)


class Asset(Base):
    __tablename__ = "asset"

    id = Column(Integer, primary_key=True, index=True)
    nome = Column(String)
    area = Column(String)
    vincolo_orario = Column(String, nullable=True)
    note = Column(Text)
    codice = Column(String, nullable=True, index=True)
    descrizione = Column(Text, nullable=True)
    anno = Column(Integer, nullable=True)
    impianto_id = Column(Integer, ForeignKey("impianti.id"), nullable=True)
    limitazioni = Column(Text, nullable=True)
    stato = Column(String, default="service")
    stato_changed_at = Column(DateTime, nullable=True)

    # Vincoli meteo
    weather_sunny_required = Column(Boolean, default=False)
    weather_max_wind_kmh = Column(Float, nullable=True)
    weather_max_rain_mm = Column(Float, nullable=True)

    # Campi AI Planning
    weather_constraint = Column(String, nullable=True)   # NONE | NO_RAIN | NO_WIND | NO_FROST | OUTDOOR_ONLY | INDOOR_ONLY
    fermo_on_schedule = Column(Boolean, default=False)   # se True: asset → FERMO alla conferma del piano
    latitude = Column(Float, nullable=True)
    longitude = Column(Float, nullable=True)

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
    criticita = Column(String, default="media")
    posizione_fisica = Column(String, nullable=True)

    created_at = Column(DateTime, default=_utcnow)
    updated_at = Column(DateTime, default=_utcnow, onupdate=_utcnow)
    tenant_id = Column(Integer, ForeignKey("tenants.id"), nullable=True, index=True)

    impianto = relationship("Impianto", back_populates="assets")
    tickets = relationship("Ticket", back_populates="asset", cascade="all, delete-orphan")
    attivita = relationship("AttivitaManutenzione", cascade="all, delete-orphan")


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
    tenant_id = Column(Integer, ForeignKey("tenants.id"), nullable=True, index=True)

    utente = relationship("Utente")
    assenze = relationship("TecnicoAssenza", back_populates="tecnico", cascade="all, delete-orphan")
    tenant = relationship("Tenant", back_populates="tecnici")


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
    tenant_id = Column(Integer, ForeignKey("tenants.id"), nullable=True, index=True)

    # Campi splitting/pianificazione AI (FASE 6)
    parent_ticket_id = Column(Integer, ForeignKey("ticket.id"), nullable=True)
    is_continuation = Column(Boolean, default=False)
    planned_start_time = Column(Time, nullable=True)

    # Audit trail — username JWT di chi ha creato il ticket
    created_by = Column(String, nullable=True)

    # Soft deletion — conservazione record con possibilità di recupero
    deleted_at = Column(DateTime, nullable=True)

    # Multi-tecnico — numero tecnici richiesti (workaround: default 1 finché non campo DB reale)
    tecnici_richiesti = Column(Integer, default=1, nullable=True)

    # Note eliminazione — motivo obbligatorio alla cancellazione
    eliminazione_note = Column(Text, nullable=True)

    # Pianificazione manuale - ignora AI planner
    is_manual_plan = Column(Boolean, default=False)

    # Riferimento al Piano di Manutenzione reale
    piano_manutenzione_id = Column(Integer, ForeignKey("piani_manutenzione.id"), nullable=True)
    origine_piano = Column(String, nullable=True) # "manuale", "excel", "manuale_interno_piano"

    asset = relationship("Asset", back_populates="tickets")
    tecnico = relationship("Tecnico")
    piano_manutenzione = relationship("PianoManutenzione", back_populates="tickets")
    children = relationship("Ticket", foreign_keys="Ticket.parent_id", back_populates="parent", lazy="dynamic", cascade="all, delete-orphan")
    parent = relationship("Ticket", foreign_keys="Ticket.parent_id", remote_side="Ticket.id", back_populates="children")
    analisi = relationship("AnalisiGuasto", back_populates="ticket", cascade="all, delete-orphan")
    sessioni = relationship("DiagnosticSession", back_populates="ticket", cascade="all, delete-orphan")
    allegati = relationship("TicketAllegato", back_populates="ticket", cascade="all, delete-orphan")


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
    tenant_id = Column(Integer, ForeignKey("tenants.id"), nullable=True, index=True)


class AttivitaManutenzione(Base):
    __tablename__ = "attivita_manutenzione"

    id = Column(Integer, primary_key=True, index=True)
    asset_id = Column(Integer, ForeignKey("asset.id"), nullable=True)
    manuale_id = Column(Integer, ForeignKey("manuali.id"), nullable=True)
    nome = Column(String, nullable=True)  # Nome sintetico attività
    descrizione = Column(Text)
    frequenza_giorni = Column(Integer)
    durata_ore = Column(Float)
    priorita = Column(String)
    origine = Column(String)
    codice = Column(String, nullable=True, index=True)  # Codice univoco piano — Null per attività da manuale
    ultima_esecuzione = Column(DateTime, nullable=True)
    prossima_scadenza = Column(DateTime, nullable=True)
    tenant_id = Column(Integer, ForeignKey("tenants.id"), nullable=True, index=True)


class AnalisiGuasto(Base):
    __tablename__ = "analisi_guasti"

    id = Column(Integer, primary_key=True, index=True)
    ticket_id = Column(Integer, ForeignKey("ticket.id"))
    metodo = Column(String)
    sintomi = Column(Text)
    analisi_json = Column(Text)
    ai_utilizzata = Column(Boolean)
    tenant_id = Column(Integer, ForeignKey("tenants.id"), nullable=True, index=True)

    ticket = relationship("Ticket", back_populates="analisi")


class DiagnosticSession(Base):
    __tablename__ = "diagnostic_sessions"

    id = Column(Integer, primary_key=True, index=True)
    ticket_id = Column(Integer, ForeignKey("ticket.id"))
    history = Column(Text, default="[]")
    status = Column(String, default="active")
    root_cause = Column(Text, nullable=True)
    created_at = Column(DateTime, default=lambda: datetime.now(timezone.utc))
    tenant_id = Column(Integer, ForeignKey("tenants.id"), nullable=True, index=True)

    ticket = relationship("Ticket", back_populates="sessioni")


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
    tenant_id = Column(Integer, ForeignKey("tenants.id"), nullable=True, index=True)

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
    tenant_id = Column(Integer, ForeignKey("tenants.id"), nullable=True, index=True)

    ticket = relationship("Ticket", back_populates="allegati")

class EmailConfig(Base):
    """Configurazione IMAP per importare email come Ticket via Polling."""
    __tablename__ = "email_config"

    id = Column(Integer, primary_key=True, index=True)
    tenant_id = Column(Integer, ForeignKey("tenants.id"), nullable=True, index=True)
    imap_server = Column(String)  # es. imap.gmail.com
    imap_port = Column(Integer, default=993)
    email_address = Column(String)
    password = Column(String) # Può essere crittografata (Fernet)
    is_encrypted = Column(Boolean, default=False)
    active = Column(Boolean, default=True)
    default_asset_id = Column(Integer, ForeignKey("asset.id"), nullable=True) # A chi intestare il ticket

    tenant = relationship("Tenant")
    default_asset = relationship("Asset")


class PianoManutenzione(Base):
    """Contenitore strutturato del Piano di Manutenzione reale."""
    __tablename__ = "piani_manutenzione"

    id = Column(Integer, primary_key=True, index=True)
    tenant_id = Column(Integer, ForeignKey("tenants.id"), nullable=True, index=True)
    nome_codificato = Column(String, nullable=False, index=True) # es. "PM-2026-0001"
    progressivo = Column(Integer, nullable=False, index=True)
    descrizione = Column(Text, nullable=True)
    stato = Column(String, default="attivo")
    
    # Relazioni (collegamenti come da specifica)
    asset_id = Column(Integer, ForeignKey("asset.id"), nullable=True)
    impianto_id = Column(Integer, ForeignKey("impianti.id"), nullable=True)
    sito_id = Column(Integer, ForeignKey("siti.id"), nullable=True)
    manuale_id = Column(Integer, ForeignKey("manuali.id"), nullable=True)

    created_at = Column(DateTime, default=_utcnow)
    updated_at = Column(DateTime, default=_utcnow, onupdate=_utcnow)

    # I ticket aggregati in questo piano
    tickets = relationship("Ticket", back_populates="piano_manutenzione", cascade="all, delete-orphan")


class SystemLog(Base):
    """Log persistente per eventi di sistema (Email Poller, Errori Critici, ecc.)"""
    __tablename__ = "system_logs"

    id = Column(Integer, primary_key=True, index=True)
    timestamp = Column(DateTime, default=lambda: datetime.now(timezone.utc), index=True)
    level = Column(String, index=True)      # INFO, WARNING, ERROR, CRITICAL
    module = Column(String, index=True)     # EMAIL_POLLER, AUTH, DB, AI
    message = Column(Text)
    extra_info = Column(Text, nullable=True) # JSON o stacktrace
    tenant_id = Column(Integer, ForeignKey("tenants.id"), nullable=True, index=True)

    tenant = relationship("Tenant")


class GeneratedPlan(Base):
    """Piano manutenzione generato dall'AI Planner."""
    __tablename__ = "generated_plans"

    id = Column(Integer, primary_key=True, index=True)
    created_at = Column(DateTime, default=_utcnow)
    status = Column(String, default="draft")    # draft | confirmed | deauthorized
    horizon_days = Column(Integer, default=7)
    plan_json = Column(JSON)

    # Conferma
    plan_number = Column(Integer, nullable=True, index=True)  # numero progressivo per tenant
    confirmed_at = Column(DateTime, nullable=True)
    confirmed_by = Column(String, nullable=True)  # username di chi ha confermato

    # Scadenza piano: ultima data pianificata tra i workorder del piano.
    # Calcolata al momento della conferma dal max(planned_date) dei planned_workorders.
    # Workaround: non esiste "deadline esplicita utente" — derivata dal piano stesso.
    scadenza = Column(DateTime, nullable=True)

    # Deautorizzazione (solo flag admin, non modifica i ticket)
    deauthorized_at = Column(DateTime, nullable=True)
    deauthorized_by = Column(String, nullable=True)
    deauthorization_reason = Column(String, nullable=True)

    tenant_id = Column(Integer, ForeignKey("tenants.id"), nullable=True, index=True)
