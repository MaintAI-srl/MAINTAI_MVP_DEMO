from sqlalchemy import text
from backend.core.database import engine, Base

# Import all models so SQLAlchemy registers them before create_all
from backend.db.modelli import (  # noqa: F401
    Impianto, Asset, Tecnico, Ticket,
    Manuale, AttivitaManutenzione, AnalisiGuasto, DiagnosticSession, Utente
)


def _apply_migrations():
    """Aggiunge colonne e tabelle mancanti (idempotente)."""
    migrations = [
        # --- v1 ---
        "ALTER TABLE asset ADD COLUMN vincolo_orario TEXT",
        "ALTER TABLE ticket ADD COLUMN attivita_manutenzione_id INTEGER REFERENCES attivita_manutenzione(id)",
        "ALTER TABLE manuali ADD COLUMN version INTEGER DEFAULT 1",
        "ALTER TABLE manuali ADD COLUMN stato TEXT DEFAULT 'attivo'",
        "ALTER TABLE ticket ADD COLUMN tecnico_id INTEGER REFERENCES tecnici(id)",
        # --- v2: impianti ---
        "CREATE TABLE IF NOT EXISTS impianti (id INTEGER PRIMARY KEY AUTOINCREMENT, nome TEXT NOT NULL, descrizione TEXT)",
        # --- v2: asset nuovi campi ---
        "ALTER TABLE asset ADD COLUMN codice TEXT",
        "ALTER TABLE asset ADD COLUMN descrizione TEXT",
        "ALTER TABLE asset ADD COLUMN anno INTEGER",
        "ALTER TABLE asset ADD COLUMN impianto_id INTEGER REFERENCES impianti(id)",
        "ALTER TABLE asset ADD COLUMN limitazioni TEXT",
        "ALTER TABLE asset ADD COLUMN stato TEXT DEFAULT 'service'",
        # --- v2: tecnici nuovi campi ---
        "ALTER TABLE tecnici ADD COLUMN cognome TEXT",
        "ALTER TABLE tecnici ADD COLUMN stato TEXT DEFAULT 'in servizio'",
        "ALTER TABLE tecnici ADD COLUMN orario_inizio TEXT DEFAULT '08:00'",
        "ALTER TABLE tecnici ADD COLUMN orario_fine TEXT DEFAULT '17:00'",
        "ALTER TABLE tecnici ADD COLUMN limitazioni_orarie TEXT",
        # --- v2: ticket date fields ---
        "ALTER TABLE ticket ADD COLUMN planned_start DATETIME",
        "ALTER TABLE ticket ADD COLUMN planned_finish DATETIME",
        "ALTER TABLE ticket ADD COLUMN execution_start DATETIME",
        "ALTER TABLE ticket ADD COLUMN execution_finish DATETIME",
        # --- v2: attivita_manutenzione scadenze ---
        "ALTER TABLE attivita_manutenzione ADD COLUMN ultima_esecuzione DATETIME",
        "ALTER TABLE attivita_manutenzione ADD COLUMN prossima_scadenza DATETIME",
        # --- v2: ticket descrizione ---
        "ALTER TABLE ticket ADD COLUMN descrizione TEXT",
        # --- v3: ticket tipo ---
        "ALTER TABLE ticket ADD COLUMN tipo TEXT DEFAULT 'CM'",
        # --- v4: utenti e auth ---
        "CREATE TABLE IF NOT EXISTS utenti (id INTEGER PRIMARY KEY AUTOINCREMENT, username TEXT UNIQUE NOT NULL, password_hash TEXT NOT NULL, ruolo TEXT DEFAULT 'tecnico', is_active BOOLEAN DEFAULT 1)",
        # --- v5: missing columns bugfix ---
        "ALTER TABLE asset ADD COLUMN stato_changed_at DATETIME",
        "ALTER TABLE asset ADD COLUMN created_at DATETIME",
        "ALTER TABLE asset ADD COLUMN updated_at DATETIME",
        "ALTER TABLE ticket ADD COLUMN parent_id INTEGER REFERENCES ticket(id)",
        "ALTER TABLE ticket ADD COLUMN diagnosi_eseguita BOOLEAN DEFAULT 0",
        "ALTER TABLE ticket ADD COLUMN created_at DATETIME",
        "ALTER TABLE ticket ADD COLUMN updated_at DATETIME",
        # --- v6: technician user link ---
        "ALTER TABLE tecnici ADD COLUMN utente_id INTEGER REFERENCES utenti(id)",
        # --- v7: tecnico assenze ---
        "CREATE TABLE IF NOT EXISTS tecnici_assenze (id INTEGER PRIMARY KEY AUTOINCREMENT, tecnico_id INTEGER REFERENCES tecnici(id) NOT NULL, data_inizio DATETIME NOT NULL, data_fine DATETIME NOT NULL, tipo_assenza TEXT DEFAULT 'Ferie', note TEXT)",
        # --- v8: allegati ticket ---
        "CREATE TABLE IF NOT EXISTS ticket_allegati (id INTEGER PRIMARY KEY AUTOINCREMENT, ticket_id INTEGER REFERENCES ticket(id) NOT NULL, nome_file TEXT NOT NULL, percorso TEXT NOT NULL, tipo_mime TEXT, dimensione_bytes INTEGER, creato_il DATETIME)",
        # --- v9: firma digitale ---
        "ALTER TABLE ticket ADD COLUMN firma_percorso TEXT"
    ]
    with engine.connect() as conn:
        for stmt in migrations:
            try:
                conn.execute(text(stmt))
                conn.commit()
            except Exception:
                pass  # colonna/tabella già presente


def init_db():
    Base.metadata.create_all(bind=engine)
    _apply_migrations()

    # Seed default users
    from backend.core.database import SessionLocal
    from backend.core.security import get_password_hash
    with SessionLocal() as db:
        admin = db.query(Utente).filter(Utente.username == "admin").first()
        if not admin:
            db.add(Utente(username="admin", password_hash=get_password_hash("admin"), ruolo="responsabile"))
        
        tecnico_user = db.query(Utente).filter(Utente.username == "tecnico").first()
        if not tecnico_user:
            tecnico_user = Utente(username="tecnico", password_hash=get_password_hash("tecnico"), ruolo="tecnico")
            db.add(tecnico_user)
            db.commit()

        # Link tecnico user to the first tecnico record if exists
        tecnico_worker = db.query(Tecnico).filter(Tecnico.id == 1).first()
        if tecnico_worker and not tecnico_worker.utente_id:
            tecnico_worker.utente_id = tecnico_user.id
            db.commit()
