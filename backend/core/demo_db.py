"""
demo_db.py — Inizializzazione e seeding automatico del demo.db.

Viene chiamato all'avvio del server (lifespan). Se il demo.db non ha tabelle,
le crea e popola con dati realistici (Porto Industriale Nord - Genova).
Idempotente: se i dati esistono già non li duplica.
"""
from __future__ import annotations

import logging
from datetime import datetime, timezone, timedelta

from sqlalchemy import text

from backend.core.database import Base, demo_engine, DemoSessionLocal
from backend.db.modelli import (  # noqa: F401  (registra i modelli nel metadata)
    Tenant, Sito, Impianto, Asset, Tecnico, Ticket,
    Utente, AttivitaManutenzione, GeneratedPlan,
    TecnicoAssenza, TicketAllegato, EmailConfig, SystemLog,
    AnalisiGuasto, DiagnosticSession, Manuale,
)
from backend.core.security import get_password_hash

logger = logging.getLogger(__name__)

NOW = datetime.now(timezone.utc)


def _d(days: int) -> datetime:
    return NOW + timedelta(days=days)


def init_demo_db() -> None:
    """Crea le tabelle sul demo_engine e popola i dati demo se vuoto."""
    try:
        # 1. Crea tutte le tabelle (idempotente)
        Base.metadata.create_all(bind=demo_engine)
        logger.info("demo_db: tabelle create/verificate su demo.db")
    except Exception as exc:
        logger.error("demo_db: errore create_all: %s", exc)
        return

    try:
        with DemoSessionLocal() as db:
            # Controlla se i dati esistono già
            existing = db.execute(text("SELECT COUNT(*) FROM ticket")).scalar()
            if existing and existing > 0:
                logger.info("demo_db: già popolato (%d ticket) — skip seed", existing)
                return

            logger.info("demo_db: seeding dati demo...")
            _seed(db)
            logger.info("demo_db: seeding completato")
    except Exception as exc:
        logger.error("demo_db: errore seeding: %s", exc)


def _seed(db) -> None:
    # ── Tenant ────────────────────────────────────────────────────────────────
    tenant = db.query(Tenant).filter(Tenant.slug == "demo").first()
    if not tenant:
        tenant = Tenant(
            nome="MaintAI Demo",
            slug="demo",
            is_active=True,
            created_at=NOW,
        )
        db.add(tenant)
        db.commit()
        db.refresh(tenant)
    tid = tenant.id

    # ── Utente demo ───────────────────────────────────────────────────────────
    demo_user = db.query(Utente).filter(Utente.username == "demo").first()
    if not demo_user:
        db.add(Utente(
            username="demo",
            password_hash=get_password_hash("demo123"),
            ruolo="responsabile",
            tenant_id=tid,
        ))
        db.commit()

    admin_user = db.query(Utente).filter(Utente.username == "admin").first()
    if not admin_user:
        db.add(Utente(
            username="admin",
            password_hash=get_password_hash("admin"),
            ruolo="superadmin",
            tenant_id=tid,
        ))
        db.commit()

    # ── Sito ──────────────────────────────────────────────────────────────────
    sito = db.query(Sito).filter(Sito.tenant_id == tid).first()
    if not sito:
        sito = Sito(
            nome="Porto Industriale Nord",
            citta="Genova",
            paese="Italia",
            tenant_id=tid,
        )
        db.add(sito)
        db.commit()
        db.refresh(sito)

    # ── Impianti ──────────────────────────────────────────────────────────────
    imp_names = ["Gru di Banchina", "Nastri Trasportatori", "Utilities & Servizi"]
    impianti = []
    for nome in imp_names:
        imp = db.query(Impianto).filter(
            Impianto.nome == nome,
            Impianto.tenant_id == tid,
        ).first()
        if not imp:
            imp = Impianto(
                nome=nome,
                sito_id=sito.id,
                tenant_id=tid,
            )
            db.add(imp)
            db.commit()
            db.refresh(imp)
        impianti.append(imp)

    # ── Asset ──────────────────────────────────────────────────────────────────
    asset_defs = [
        # (nome, impianto_idx, area, stato)
        ("Gru portainer GR-01", 0, "Banchina A", "In servizio"),
        ("Gru portainer GR-02", 0, "Banchina B", "In servizio"),
        ("Motore gru MG-01",    0, "Banchina A", "Manutenzione"),
        ("Nastro trasportatore NT-01", 1, "Magazzino 1", "In servizio"),
        ("Nastro trasportatore NT-02", 1, "Magazzino 2", "In servizio"),
        ("Motore nastro MN-01",        1, "Magazzino 1", "In servizio"),
        ("Compressore aria CA-01",     2, "Sala Macchine", "In servizio"),
        ("Generatore diesel GD-01",    2, "Sala Macchine", "In servizio"),
        ("Quadro elettrico QE-01",     2, "Cabina MT",     "In servizio"),
        ("Pompa antincendio PA-01",    2, "Stazione Pompaggio", "In servizio"),
    ]
    assets = []
    for nome, imp_idx, area, stato in asset_defs:
        a = db.query(Asset).filter(
            Asset.nome == nome,
            Asset.tenant_id == tid,
        ).first()
        if not a:
            a = Asset(
                nome=nome,
                impianto_id=impianti[imp_idx].id,
                area=area,
                stato=stato,
                tenant_id=tid,
            )
            db.add(a)
            db.commit()
            db.refresh(a)
        assets.append(a)

    # ── Tecnici ────────────────────────────────────────────────────────────────
    tecnici_defs = [
        ("Mario",   "Rossi",    "Meccanico,Elettricista",  8,  "08:00", "17:00"),
        ("Luigi",   "Ferrari",  "Meccanico,Idraulico",     8,  "08:00", "17:00"),
        ("Elena",   "Verdi",    "Elettricista,Strumentista", 8, "08:00", "17:00"),
        ("Giulia",  "Neri",     "Meccanico,Saldatore",     8,  "08:00", "17:00"),
        ("Roberto", "Gallo",    "Elettricista,PLC",        8,  "08:00", "17:00"),
    ]
    tecnici = []
    for nome, cognome, comp, ore, inizio, fine in tecnici_defs:
        t = db.query(Tecnico).filter(
            Tecnico.nome == nome,
            Tecnico.tenant_id == tid,
        ).first()
        if not t:
            t = Tecnico(
                nome=nome,
                cognome=cognome,
                competenze=comp,
                ore_giornaliere=ore,
                orario_inizio=inizio,
                orario_fine=fine,
                stato="in servizio",
                tenant_id=tid,
            )
            db.add(t)
            db.commit()
            db.refresh(t)
        tecnici.append(t)

    # ── Ticket ────────────────────────────────────────────────────────────────
    ticket_defs = [
        # (titolo, tipo, priorita, stato, asset_idx, durata_h, days_offset)
        ("Ispezione mensile Gru GR-01",         "PM", "Alta",   "Aperto",     0, 3.0,  1),
        ("Lubrificazione rinvii cinematici",    "PM", "Media",  "Aperto",     1, 2.0,  2),
        ("Guasto motore principale MG-01",      "BD", "Alta",   "Aperto",     2, 4.0,  0),
        ("Sostituzione cinghia NT-01",          "CM", "Media",  "Aperto",     3, 2.5,  3),
        ("Controllo tensionamento nastro NT-02","PM", "Bassa",  "Aperto",     4, 1.5,  4),
        ("Verifica motore nastro MN-01",        "CM", "Media",  "Aperto",     5, 2.0,  2),
        ("Tagliando compressore CA-01",         "PM", "Alta",   "Aperto",     6, 3.5,  1),
        ("Test generatore diesel GD-01",        "PM", "Alta",   "Aperto",     7, 2.0,  1),
        ("Controllo quadro elettrico QE-01",    "PM", "Media",  "Aperto",     8, 1.5,  5),
        ("Verifica pompa antincendio PA-01",    "PM", "Alta",   "Aperto",     9, 2.5,  2),
        ("Manutenzione straordinaria Gru GR-02","CM", "Alta",   "Aperto",     1, 5.0,  3),
        ("Revisione impianto idraulico GR-01",  "CM", "Media",  "Aperto",     0, 3.0,  4),
        # Ticket chiusi (storico)
        ("PM trimestrale Gru GR-01",            "PM", "Alta",   "Chiuso",     0, 3.0, -30),
        ("Riparazione sensore livello CA-01",   "CM", "Media",  "Chiuso",     6, 1.5, -20),
        ("Sostituzione filtri GD-01",           "PM", "Bassa",  "Chiuso",     7, 2.0, -15),
        ("Revisione freni Gru GR-02",           "CM", "Alta",   "Chiuso",     1, 4.0, -10),
        ("Ispezione sicurezza PA-01",           "PM", "Alta",   "Chiuso",     9, 2.0, -5),
        # In corso
        ("Revisione quadro MT — in corso",      "CM", "Alta",   "In corso",   8, 6.0,  0),
        ("Sostituzione guarnizioni CA-01",      "CM", "Media",  "In corso",   6, 3.0,  0),
        # Pianificato
        ("Revisione annuale nastri NT",         "PM", "Media",  "Pianificato", 3, 4.0, 7),
    ]

    for titolo, tipo, priorita, stato, asset_idx, durata, days in ticket_defs:
        exists = db.query(Ticket).filter(
            Ticket.titolo == titolo,
            Ticket.tenant_id == tid,
        ).first()
        if not exists:
            data = _d(days)
            tecnico_id = None
            if stato in ("Pianificato", "In corso", "Chiuso"):
                idx = hash(titolo) % len(tecnici)
                tecnico_id = tecnici[idx].id
            planned_start = None
            planned_finish = None
            if stato == "Pianificato":
                planned_start = data
                planned_finish = data + timedelta(hours=durata)
            db.add(Ticket(
                titolo=titolo,
                tipo=tipo,
                priorita=priorita,
                stato=stato,
                asset_id=assets[asset_idx].id,
                durata_stimata_ore=durata,
                tecnico_id=tecnico_id,
                planned_start=planned_start,
                planned_finish=planned_finish,
                tenant_id=tid,
                created_at=data - timedelta(days=3),
            ))

    db.commit()
    logger.info(
        "demo_db seed: %d ticket, %d tecnici, %d asset",
        db.execute(text("SELECT COUNT(*) FROM ticket")).scalar(),
        db.execute(text("SELECT COUNT(*) FROM tecnici")).scalar(),
        db.execute(text("SELECT COUNT(*) FROM asset")).scalar(),
    )
