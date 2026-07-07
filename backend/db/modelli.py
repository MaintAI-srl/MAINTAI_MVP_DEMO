from datetime import datetime, timezone
from sqlalchemy import Column, Integer, Float, String, Text, ForeignKey, Boolean, DateTime, Date, Time, JSON, LargeBinary, event, Table
from sqlalchemy.orm import relationship
from backend.core.database import Base


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


# Tabella di associazione Piani ↔ Asset (Multi-Asset)
piano_asset_association = Table(
    'piani_assets_association',
    Base.metadata,
    Column('piano_id', Integer, ForeignKey('piani_manutenzione.id'), primary_key=True),
    Column('asset_id', Integer, ForeignKey('asset.id'), primary_key=True)
)


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
    token_version = Column(Integer, default=1, nullable=False)

    tenant = relationship("Tenant", back_populates="utenti")

class RevokedToken(Base):
    """Tabella per tenere traccia dei jti revocati a seguito del logout."""
    __tablename__ = "revoked_tokens"

    id = Column(Integer, primary_key=True, index=True)
    jti = Column(String, unique=True, index=True, nullable=False)
    created_at = Column(DateTime, default=_utcnow)


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
    tenant_id = Column(Integer, ForeignKey("tenants.id"), nullable=False, index=True)

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
    tenant_id = Column(Integer, ForeignKey("tenants.id"), nullable=False, index=True)


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
    fermo_on_schedule = Column(Boolean, default=False)   # se True: asset -> FERMO PROG. alla conferma del piano
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
    criticita = Column(String, nullable=True)  # A | B | C | null (classificazione critica)
    posizione_fisica = Column(String, nullable=True)

    # M2.1 — Costo fermo asset (€/ora)
    costo_orario_fermo = Column(Float, nullable=True)

    # M2.2 — Predisposizione ricambi (codice per futura integrazione modulo esterno)
    codice_ricambio_esterno = Column(String, nullable=True)

    # QR Code PNG base64 (generato alla creazione / rigenerabile via endpoint)
    qr_code_b64 = Column(Text, nullable=True)

    created_at = Column(DateTime, default=_utcnow)
    updated_at = Column(DateTime, default=_utcnow, onupdate=_utcnow)
    tenant_id = Column(Integer, ForeignKey("tenants.id"), nullable=False, index=True)

    impianto = relationship("Impianto", back_populates="assets")
    tickets = relationship("Ticket", back_populates="asset", cascade="all, delete-orphan")
    attivita = relationship("AttivitaManutenzione", cascade="all, delete-orphan")
    
    # Relazione multi-asset con i Piani
    piani = relationship("PianoManutenzione", secondary=piano_asset_association, back_populates="assets")


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
    telefono = Column(String, nullable=True)
    sede_indirizzo = Column(String, nullable=True)
    tenant_id = Column(Integer, ForeignKey("tenants.id"), nullable=False, index=True)

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
    tenant_id = Column(Integer, ForeignKey("tenants.id"), nullable=False, index=True)

    # Campi splitting/pianificazione AI (FASE 6)
    parent_ticket_id = Column(Integer, ForeignKey("ticket.id"), nullable=True)
    is_continuation = Column(Boolean, default=False)
    planned_start_time = Column(Time, nullable=True)

    # Audit trail — username JWT di chi ha creato / chiuso il ticket
    created_by = Column(String, nullable=True)
    closed_by  = Column(String, nullable=True)

    # Soft deletion — conservazione record con possibilità di recupero
    deleted_at = Column(DateTime, nullable=True)

    # Multi-tecnico — numero tecnici richiesti (workaround: default 1 finché non campo DB reale)
    tecnici_richiesti = Column(Integer, default=1, nullable=True)

    # Ore uomo (change request 2026-07-05) — required_man_hours = durata × tecnici in modalità auto
    required_man_hours = Column(Float, nullable=True)
    man_hours_calculation_mode = Column(String, default="manual", nullable=True)  # auto | manual

    # Multi-tecnico — tecnico di supporto opzionale assegnato all'intervento.
    # Il tecnico principale resta `tecnico_id`; questo è il secondo operatore.
    tecnico_supporto_id = Column(Integer, ForeignKey("tecnici.id"), nullable=True)

    # Note eliminazione — motivo obbligatorio alla cancellazione
    eliminazione_note = Column(Text, nullable=True)

    # Pianificazione manuale - ignora AI planner
    is_manual_plan = Column(Boolean, default=False)

    # Competenza richiesta esplicita (es: "ELETTRICISTA", "MECCANICO"). None → usa tipo come proxy
    competenza_richiesta = Column(String, nullable=True)

    # Riferimento al Piano di Manutenzione reale
    piano_manutenzione_id = Column(Integer, ForeignKey("piani_manutenzione.id"), nullable=True)
    origine_piano = Column(String, nullable=True) # "manuale", "excel", "manuale_interno_piano"

    # Origine unificata (v2.5.0)
    origin_type = Column(String, nullable=True)  # manual | from_task | from_email | from_pdf_plan

    # Dati ereditati dalla gerarchia Asset → Impianto → Sito (denormalizzati per query veloci)
    sito_name = Column(String, nullable=True)
    impianto_name = Column(String, nullable=True)

    # M2.2 — Predisposizione ricambi
    ricambio_note = Column(Text, nullable=True)        # nota libera ricambio usato / codice ricambio
    in_attesa_ricambio = Column(Boolean, default=False) # flag "bloccato in attesa ricambio"
    ricambio_quantita = Column(Float, nullable=True)    # quantità ricambio (predisposizione modulo ricambi)

    # Note libere del ticket — compilabili già in fase di creazione
    note = Column(Text, nullable=True)

    asset = relationship("Asset", back_populates="tickets")
    # Due FK verso `tecnici` (tecnico_id + tecnico_supporto_id): va indicato esplicitamente
    # quale colonna usa ciascuna relationship, altrimenti il mapper non sa risolvere il join.
    tecnico = relationship("Tecnico", foreign_keys=[tecnico_id])
    tecnico_supporto = relationship("Tecnico", foreign_keys=[tecnico_supporto_id])
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
    tenant_id = Column(Integer, ForeignKey("tenants.id"), nullable=False, index=True)
    
    # Collegamento al Piano di Manutenzione (Integrazione Piani/Manuali)
    piano_id = Column(Integer, ForeignKey("piani_manutenzione.id"), nullable=True, index=True)
    
    piano = relationship("PianoManutenzione", back_populates="manuali", foreign_keys=[piano_id])


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
    tenant_id = Column(Integer, ForeignKey("tenants.id"), nullable=False, index=True)

    # Campi unificazione Task/Piano (v2.5.0)
    generation_mode = Column(String, default="manual", nullable=True)  # manual | auto | disabled
    generate_days_before_due = Column(Integer, default=7, nullable=True)
    task_stato = Column(String, default="active", nullable=True)  # active | paused | archived
    source_type = Column(String, nullable=True)  # manual_task | manual_imported_from_manual
    last_generated_at = Column(DateTime, nullable=True)
    next_due_at = Column(DateTime, nullable=True)

    # Manutenzione su condizione (default calendario per retrocompatibilita)
    trigger_mode = Column(String, default="calendar", nullable=True)  # calendar | condition | calendar_or_condition
    condition_metric = Column(String, nullable=True)  # running_hours
    condition_threshold_hours = Column(Float, nullable=True)
    condition_last_done_hours = Column(Float, nullable=True)

    # Collegamento al Piano di Manutenzione (v2.5.1) — FK obbligatoria per nuovi task
    # Workaround: nullable=True per compatibilità con task esistenti senza piano (creati da manuali pre-v2.5.1)
    piano_id = Column(Integer, ForeignKey("piani_manutenzione.id"), nullable=True, index=True)
    is_repeatable = Column(Boolean, default=True, nullable=True)  # True = task ricorrente

    piano = relationship("PianoManutenzione", back_populates="tasks")


class AssetConditionReading(Base):
    """Lettura storica condizioni per singolo asset."""
    __tablename__ = "asset_condition_readings"

    id = Column(Integer, primary_key=True, index=True)
    asset_id = Column(Integer, ForeignKey("asset.id"), nullable=False, index=True)
    tenant_id = Column(Integer, ForeignKey("tenants.id"), nullable=True, index=True)
    metric = Column(String, nullable=False, default="running_hours", index=True)
    value = Column(Float, nullable=False)
    recorded_at = Column(DateTime, default=_utcnow, nullable=False, index=True)
    note = Column(Text, nullable=True)
    created_at = Column(DateTime, default=_utcnow)

    asset = relationship("Asset")


class AnalisiGuasto(Base):
    __tablename__ = "analisi_guasti"

    id = Column(Integer, primary_key=True, index=True)
    ticket_id = Column(Integer, ForeignKey("ticket.id"))
    metodo = Column(String)
    sintomi = Column(Text)
    analisi_json = Column(Text)
    ai_utilizzata = Column(Boolean)
    tenant_id = Column(Integer, ForeignKey("tenants.id"), nullable=False, index=True)

    ticket = relationship("Ticket", back_populates="analisi")


class DiagnosticSession(Base):
    __tablename__ = "diagnostic_sessions"

    id = Column(Integer, primary_key=True, index=True)
    ticket_id = Column(Integer, ForeignKey("ticket.id"))
    history = Column(Text, default="[]")
    status = Column(String, default="active")
    root_cause = Column(Text, nullable=True)
    created_at = Column(DateTime, default=lambda: datetime.now(timezone.utc))
    tenant_id = Column(Integer, ForeignKey("tenants.id"), nullable=False, index=True)

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
    tenant_id = Column(Integer, ForeignKey("tenants.id"), nullable=False, index=True)

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
    tenant_id = Column(Integer, ForeignKey("tenants.id"), nullable=False, index=True)

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


class AssetDocumento(Base):
    """Documenti allegati a un Asset (manuali, schemi, esplosi, certificati, ecc.)."""
    __tablename__ = "asset_documenti"

    id = Column(Integer, primary_key=True, index=True)
    tenant_id = Column(Integer, ForeignKey("tenants.id"), nullable=False, index=True)
    asset_id = Column(Integer, ForeignKey("asset.id"), nullable=False, index=True)
    nome = Column(String, nullable=False)
    tipo = Column(String, nullable=False)  # Esploso / Manuale / Schema / Certificato / Altro
    filename = Column(String, nullable=False)
    content_type = Column(String)
    file_data = Column(LargeBinary, nullable=False)
    esploso_analisi = Column(Text, nullable=True)  # JSON string con parti identificate da GPT-4o
    created_at = Column(DateTime, default=lambda: datetime.now(timezone.utc))

    asset = relationship("Asset")
    tenant = relationship("Tenant")


class PianoManutenzione(Base):
    """Contenitore strutturato del Piano di Manutenzione reale."""
    __tablename__ = "piani_manutenzione"

    id = Column(Integer, primary_key=True, index=True)
    tenant_id = Column(Integer, ForeignKey("tenants.id"), nullable=False, index=True)
    nome_codificato = Column(String, nullable=False, index=True) # es. "PM-2026-0001"
    progressivo = Column(Integer, nullable=False, index=True)
    descrizione = Column(Text, nullable=True)
    stato = Column(String, default="attivo")
    
    # Relazioni (collegamenti come da specifica)
    asset_id = Column(Integer, ForeignKey("asset.id"), nullable=True) # Backward compat (1° asset)
    impianto_id = Column(Integer, ForeignKey("impianti.id"), nullable=True)
    sito_id = Column(Integer, ForeignKey("siti.id"), nullable=True)
    manuale_id = Column(Integer, ForeignKey("manuali.id"), nullable=True) # Backward compat (principale)

    created_at = Column(DateTime, default=_utcnow)
    updated_at = Column(DateTime, default=_utcnow, onupdate=_utcnow)

    # I ticket aggregati in questo piano (scollegati ma NON eliminati alla cancellazione del piano)
    tickets = relationship("Ticket", back_populates="piano_manutenzione")
    # I task strutturali del piano — eliminati a cascata quando il piano viene cancellato
    tasks = relationship("AttivitaManutenzione", back_populates="piano", cascade="all, delete-orphan")

    # Nuove relazioni multi-asset e manuali multipli
    assets = relationship("Asset", secondary=piano_asset_association, back_populates="piani")
    manuali = relationship("Manuale", back_populates="piano", cascade="all, delete-orphan", foreign_keys="[Manuale.piano_id]")


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

    tenant_id = Column(Integer, ForeignKey("tenants.id"), nullable=False, index=True)


class PlannerFeedback(Base):
    """Feedback di esecuzione per il ciclo di apprendimento del planner."""
    __tablename__ = "planner_feedback"

    id = Column(Integer, primary_key=True, index=True)
    tenant_id = Column(Integer, ForeignKey("tenants.id"), nullable=True, index=True)
    ticket_id = Column(Integer, ForeignKey("ticket.id"), nullable=False, index=True)
    generated_plan_id = Column(Integer, ForeignKey("generated_plans.id"), nullable=True)

    # Dati pianificati (snapshot al momento del feedback)
    planned_date = Column(Date, nullable=True)
    planned_technician_id = Column(Integer, nullable=True)
    estimated_duration_hours = Column(Float, nullable=True)
    confidence_score_at_plan = Column(Float, nullable=True)

    # Dati di esecuzione reale
    actual_start = Column(DateTime, nullable=True)
    actual_finish = Column(DateTime, nullable=True)
    actual_duration_hours = Column(Float, nullable=True)
    actual_technician_id = Column(Integer, nullable=True)

    # Outcome e delta
    execution_outcome = Column(String, default="completed")  # completed|partial|cancelled|rescheduled
    duration_delta_hours = Column(Float, nullable=True)  # actual - estimated (positivo = più lungo)
    date_delta_days = Column(Integer, nullable=True)     # actual_date - planned_date (positivo = in ritardo)
    technician_changed = Column(Boolean, default=False)

    # Valutazione utente (opzionale)
    user_rating = Column(Integer, nullable=True)  # 1-5
    user_notes = Column(Text, nullable=True)

    # Classificatori per analytics
    ticket_tipo = Column(String, nullable=True)   # BD|PM|CM
    asset_id = Column(Integer, nullable=True)

    created_at = Column(DateTime, default=_utcnow)


class FailureMode(Base):
    """Knowledge base FMECA — dati standard per tipo asset industriale."""
    __tablename__ = "failure_modes"

    id = Column(Integer, primary_key=True, index=True)
    asset_type = Column(String, nullable=False, index=True)
    component = Column(String, nullable=False)
    failure_mode = Column(String, nullable=False)
    failure_cause = Column(String, nullable=True)
    failure_effect = Column(String, nullable=True)
    detection_method = Column(String, nullable=True)
    recommended_action = Column(String, nullable=True)
    mtbf_hours = Column(Float, nullable=True)
    severity = Column(Integer, nullable=False, default=5)
    occurrence = Column(Integer, nullable=False, default=5)
    detectability = Column(Integer, nullable=False, default=5)
    rpn = Column(Integer, nullable=False, default=125)
    peso_appreso = Column(Float, default=1.0)
    source = Column(String, default="seed")
    is_global = Column(Boolean, default=True)
    tenant_id = Column(Integer, ForeignKey("tenants.id"), nullable=True, index=True)
    created_at = Column(DateTime, default=_utcnow)


class FailureAnalysis(Base):
    """Risultato analisi FIE per un ticket — top 3 failure modes suggeriti."""
    __tablename__ = "failure_analysis"

    id = Column(Integer, primary_key=True, index=True)
    ticket_id = Column(Integer, ForeignKey("ticket.id"), nullable=False)
    failure_mode_id = Column(Integer, ForeignKey("failure_modes.id"), nullable=False)
    probability_score = Column(Float, nullable=False)
    rpn_weighted = Column(Float, nullable=False)
    ai_explanation = Column(Text, nullable=True)
    selected = Column(Boolean, default=False)
    tenant_id = Column(Integer, ForeignKey("tenants.id"), nullable=True, index=True)
    created_at = Column(DateTime, default=_utcnow)

    failure_mode = relationship("FailureMode")


class DiagnosticLearning(Base):
    """Storico conferme tecnico — alimenta il learning loop."""
    __tablename__ = "diagnostic_learning"

    id = Column(Integer, primary_key=True, index=True)
    ticket_id = Column(Integer, ForeignKey("ticket.id"), nullable=False)
    symptoms = Column(Text, nullable=False)
    diagnosed_failure_mode_id = Column(Integer, ForeignKey("failure_modes.id"), nullable=True)
    real_cause = Column(Text, nullable=False)
    action_taken = Column(Text, nullable=False)
    resolution_time_minutes = Column(Integer, nullable=True)
    success = Column(Boolean, default=True)
    tenant_id = Column(Integer, ForeignKey("tenants.id"), nullable=True, index=True)
    created_at = Column(DateTime, default=_utcnow)

    failure_mode = relationship("FailureMode")


# ─── M4 / M5 — Knowledge & Compliance ────────────────────────────────────────

class Procedura(Base):
    """Procedura operativa breve collegata a un asset (ispezione, LOTO, sostituzione…)."""
    __tablename__ = "procedure"

    id = Column(Integer, primary_key=True)
    asset_id = Column(Integer, ForeignKey("asset.id"), nullable=False, index=True)
    tenant_id = Column(Integer, ForeignKey("tenants.id"), nullable=True, index=True)
    titolo = Column(String, nullable=False)
    tipo = Column(String, default="ispezione")  # ispezione | sostituzione | taratura | loto | emergenza
    passi = Column(Text, default="[]")           # JSON array di stringhe
    revisione = Column(Integer, default=1)
    created_at = Column(DateTime, default=_utcnow)
    updated_at = Column(DateTime, default=_utcnow, onupdate=_utcnow)


class NotaAsset(Base):
    """Nota tecnica senior su un asset — upsert (una sola nota per asset)."""
    __tablename__ = "note_asset"

    id = Column(Integer, primary_key=True)
    asset_id = Column(Integer, ForeignKey("asset.id"), nullable=False, index=True)
    tenant_id = Column(Integer, ForeignKey("tenants.id"), nullable=True, index=True)
    testo = Column(Text, nullable=False)
    autore = Column(String, nullable=True)
    created_at = Column(DateTime, default=_utcnow)
    updated_at = Column(DateTime, default=_utcnow, onupdate=_utcnow)


class CheckPrimoLivello(Base):
    """Checklist di ispezione per operatori non autenticati (accesso via public_token)."""
    __tablename__ = "check_primo_livello"

    id = Column(Integer, primary_key=True)
    asset_id = Column(Integer, ForeignKey("asset.id"), nullable=False, index=True)
    tenant_id = Column(Integer, ForeignKey("tenants.id"), nullable=True, index=True)
    public_token = Column(String, nullable=False, unique=True, index=True)  # UUID per accesso pubblico
    token_active = Column(Boolean, default=True, nullable=False, server_default='1')
    token_expires_at = Column(DateTime(timezone=True), nullable=True)
    voci = Column(Text, default="[]")  # JSON: [{label, descrizione}]
    created_at = Column(DateTime, default=_utcnow)


class Attestato(Base):
    """Attestato di formazione / qualifica collegato a un tecnico."""
    __tablename__ = "attestati"

    id = Column(Integer, primary_key=True)
    tecnico_id = Column(Integer, ForeignKey("tecnici.id"), nullable=False, index=True)
    tenant_id = Column(Integer, ForeignKey("tenants.id"), nullable=True, index=True)
    tipo_corso = Column(String, nullable=False)
    ente_certificatore = Column(String, nullable=True)
    data_conseguimento = Column(Date, nullable=True)
    data_scadenza = Column(Date, nullable=True)
    note = Column(Text, nullable=True)
    created_at = Column(DateTime, default=_utcnow)


class TenantModuleConfig(Base):
    """Override per-tenant dei moduli attivi (gestito dal superadmin).

    Se un tenant non ha una riga qui vale la configurazione globale
    (env + backend/modules_state.json). La config globale resta un
    kill-switch: un modulo disattivato globalmente non è attivabile
    per singolo tenant."""
    __tablename__ = "tenant_module_config"

    id = Column(Integer, primary_key=True)
    tenant_id = Column(Integer, ForeignKey("tenants.id"), nullable=False, unique=True, index=True)
    enabled = Column(Text, nullable=False, default="[]")  # JSON: lista di module id
    updated_at = Column(DateTime, default=_utcnow, onupdate=_utcnow)
