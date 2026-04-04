from sqlalchemy import text
from backend.core.database import engine, Base

# Import all models so SQLAlchemy registers them before create_all
from backend.db.modelli import (  # noqa: F401
    Tenant, Sito, Impianto, Asset, Tecnico, Ticket,
    Manuale, AttivitaManutenzione, AnalisiGuasto, DiagnosticSession,
    Utente, TecnicoAssenza, TicketAllegato
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
        "CREATE TABLE IF NOT EXISTS impianti (id INTEGER PRIMARY KEY, nome TEXT NOT NULL, descrizione TEXT)",
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
        "CREATE TABLE IF NOT EXISTS utenti (id INTEGER PRIMARY KEY, username TEXT UNIQUE NOT NULL, password_hash TEXT NOT NULL, ruolo TEXT DEFAULT 'tecnico', is_active BOOLEAN DEFAULT 1)",
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
        "CREATE TABLE IF NOT EXISTS tecnici_assenze (id INTEGER PRIMARY KEY, tecnico_id INTEGER REFERENCES tecnici(id) NOT NULL, data_inizio DATETIME NOT NULL, data_fine DATETIME NOT NULL, tipo_assenza TEXT DEFAULT 'Ferie', note TEXT)",
        # --- v8: allegati ticket ---
        "CREATE TABLE IF NOT EXISTS ticket_allegati (id INTEGER PRIMARY KEY, ticket_id INTEGER REFERENCES ticket(id) NOT NULL, nome_file TEXT NOT NULL, percorso TEXT NOT NULL, tipo_mime TEXT, dimensione_bytes INTEGER, creato_il DATETIME)",
        # --- v9: firma digitale ---
        "ALTER TABLE ticket ADD COLUMN firma_percorso TEXT",
        # --- v10: siti ---
        "CREATE TABLE IF NOT EXISTS siti (id INTEGER PRIMARY KEY, nome TEXT NOT NULL, descrizione TEXT, ubicazione TEXT, citta TEXT, paese TEXT DEFAULT 'Italia', responsabile TEXT, telefono_responsabile TEXT, email_responsabile TEXT, note TEXT, created_at DATETIME, updated_at DATETIME)",
        # --- v10: impianti nuovi campi ---
        "ALTER TABLE impianti ADD COLUMN sito_id INTEGER REFERENCES siti(id)",
        "ALTER TABLE impianti ADD COLUMN tipologia TEXT",
        "ALTER TABLE impianti ADD COLUMN note TEXT",
        "ALTER TABLE impianti ADD COLUMN latitude REAL",
        "ALTER TABLE impianti ADD COLUMN longitude REAL",
        # --- v10: asset nuovi campi anagrafica ---
        "ALTER TABLE asset ADD COLUMN anno_installazione INTEGER",
        "ALTER TABLE asset ADD COLUMN anno_produzione INTEGER",
        "ALTER TABLE asset ADD COLUMN marca TEXT",
        "ALTER TABLE asset ADD COLUMN modello TEXT",
        "ALTER TABLE asset ADD COLUMN matricola TEXT",
        "ALTER TABLE asset ADD COLUMN numero_serie TEXT",
        "ALTER TABLE asset ADD COLUMN fornitore TEXT",
        "ALTER TABLE asset ADD COLUMN data_acquisto DATE",
        "ALTER TABLE asset ADD COLUMN data_scadenza_garanzia DATE",
        "ALTER TABLE asset ADD COLUMN vincoli_operativi TEXT",
        "ALTER TABLE asset ADD COLUMN vincoli_manutenzione TEXT",
        "ALTER TABLE asset ADD COLUMN note_tecniche TEXT",
        "ALTER TABLE asset ADD COLUMN criticita TEXT DEFAULT 'media'",
        "ALTER TABLE asset ADD COLUMN posizione_fisica TEXT",
        # --- v11: multi-tenancy ---
        "CREATE TABLE IF NOT EXISTS tenants (id INTEGER PRIMARY KEY, nome TEXT NOT NULL, slug TEXT UNIQUE NOT NULL, is_active BOOLEAN DEFAULT 1, created_at DATETIME)",
        "ALTER TABLE utenti ADD COLUMN tenant_id INTEGER REFERENCES tenants(id)",
        "ALTER TABLE siti ADD COLUMN tenant_id INTEGER REFERENCES tenants(id)",
        "ALTER TABLE impianti ADD COLUMN tenant_id INTEGER REFERENCES tenants(id)",
        "ALTER TABLE asset ADD COLUMN tenant_id INTEGER REFERENCES tenants(id)",
        "ALTER TABLE tecnici ADD COLUMN tenant_id INTEGER REFERENCES tenants(id)",
        "ALTER TABLE ticket ADD COLUMN tenant_id INTEGER REFERENCES tenants(id)",
        "ALTER TABLE manuali ADD COLUMN tenant_id INTEGER REFERENCES tenants(id)",
        "ALTER TABLE attivita_manutenzione ADD COLUMN tenant_id INTEGER REFERENCES tenants(id)",
        # --- v12: multi-tenancy sub-tables ---
        "ALTER TABLE tecnici_assenze ADD COLUMN tenant_id INTEGER REFERENCES tenants(id)",
        "ALTER TABLE analisi_guasti ADD COLUMN tenant_id INTEGER REFERENCES tenants(id)",
        "ALTER TABLE diagnostic_sessions ADD COLUMN tenant_id INTEGER REFERENCES tenants(id)",
        "ALTER TABLE ticket_allegati ADD COLUMN tenant_id INTEGER REFERENCES tenants(id)",
    ]
    for stmt in migrations:
        try:
            with engine.begin() as conn:
                conn.execute(text(stmt))
        except Exception:
            pass  # colonna/tabella già presente


def _seed_tenant_and_migrate_data():
    """Crea il tenant Demo (id=1) e assegna i dati esistenti ad esso."""
    from backend.core.database import SessionLocal
    from datetime import datetime, timezone
    
    with SessionLocal() as db:
        # Crea tenant Demo se non esiste (usiamo ORM per compatibilità cross-db)
        demo_tenant = db.query(Tenant).filter(Tenant.slug == 'demo').first()
        if not demo_tenant:
            demo_tenant = Tenant(
                nome='Demo', 
                slug='demo', 
                is_active=True, 
                created_at=datetime.now(timezone.utc)
            )
            db.add(demo_tenant)
            db.commit()
            db.refresh(demo_tenant)
        
        tenant_id = demo_tenant.id

        # Assegna tutti i dati esistenti senza tenant al tenant Demo
        tables = [
            "utenti", "siti", "impianti", "asset", "tecnici", "ticket", 
            "manuali", "attivita_manutenzione", "tecnici_assenze", 
            "analisi_guasti", "diagnostic_sessions", "ticket_allegati"
        ]
        for table in tables:
            try:
                # Update tramite SQL testuale per velocità, ma con parametri sicuri
                db.execute(text(f"UPDATE {table} SET tenant_id=:tid WHERE tenant_id IS NULL"), {"tid": tenant_id})
            except Exception:
                pass
        db.commit()

        # Promuovi admin a superadmin (usiamo ORM per sicurezza)
        admin = db.query(Utente).filter(Utente.username == "admin").first()
        if admin:
            admin.ruolo = "superadmin"
            db.commit()


def init_db():
    Base.metadata.create_all(bind=engine)
    _apply_migrations()
    _seed_tenant_and_migrate_data()

    # Seed default users
    from backend.core.database import SessionLocal
    from backend.core.security import get_password_hash
    with SessionLocal() as db:
        # Recupera tenant Demo
        tenant_row = db.execute(text("SELECT id FROM tenants WHERE slug='demo'")).fetchone()
        tenant_id = tenant_row[0] if tenant_row else 1

        admin = db.query(Utente).filter(Utente.username == "admin").first()
        if not admin:
            db.add(Utente(
                username="admin",
                password_hash=get_password_hash("admin"),
                ruolo="superadmin",
                tenant_id=tenant_id,
            ))

        tecnico_user = db.query(Utente).filter(Utente.username == "tecnico").first()
        if not tecnico_user:
            tecnico_user = Utente(
                username="tecnico",
                password_hash=get_password_hash("tecnico"),
                ruolo="tecnico",
                tenant_id=tenant_id,
            )
            db.add(tecnico_user)
            db.commit()
        elif not tecnico_user.tenant_id:
            tecnico_user.tenant_id = tenant_id
            db.commit()

        # Link tecnico user to the first tecnico record if exists
        tecnico_worker = db.query(Tecnico).filter(Tecnico.id == 1).first()
        if tecnico_worker and not tecnico_worker.utente_id:
            tecnico_user_now = db.query(Utente).filter(Utente.username == "tecnico").first()
            if tecnico_user_now:
                tecnico_worker.utente_id = tecnico_user_now.id
                db.commit()


if __name__ == "__main__":
    print("Avvio migrazioni e inizializzazione database...")
    init_db()
    print("Database aggiornato con successo.")
