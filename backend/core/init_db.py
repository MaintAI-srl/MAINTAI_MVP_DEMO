from sqlalchemy import text
from backend.core.database import engine, Base

# Import all models so SQLAlchemy registers them before create_all
from backend.db.modelli import (  # noqa: F401
    Tenant, Sito, Impianto, Asset, Tecnico, Ticket,
    Manuale, AttivitaManutenzione, AnalisiGuasto, DiagnosticSession,
    Utente, TecnicoAssenza, TicketAllegato, EmailConfig, PianoManutenzione, SystemLog, GeneratedPlan, RevokedToken, AssetDocumento,
    FailureMode, FailureAnalysis, DiagnosticLearning,
    Procedura, NotaAsset, CheckPrimoLivello, Attestato,
)
from backend.core.failure_seed import seed_failure_modes


def _apply_migrations():
    """Aggiunge colonne e tabelle mancanti (idempotente)."""
    # --- Migrazioni obsolete gestite da Alembic ---
    migrations = [
        "ALTER TABLE utenti ADD COLUMN token_version INTEGER NOT NULL DEFAULT 1"
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

    # Seed knowledge base FMECA per Failure Intelligence Engine
    from backend.core.database import SessionLocal
    with SessionLocal() as db:
        seed_failure_modes(db)

    # Seed default users
    import os
    from backend.core.database import DATABASE_URL, SessionLocal
    from backend.core.security import get_password_hash
    
    seed_admin_pwd = os.getenv("SEED_ADMIN_PASSWORD")
    seed_tecnico_pwd = os.getenv("SEED_TECNICO_PASSWORD")
    is_postgres = DATABASE_URL.lower().startswith("postgres")

    with SessionLocal() as db:
        # Recupera tenant Demo
        tenant_row = db.execute(text("SELECT id FROM tenants WHERE slug='demo'")).fetchone()
        tenant_id = tenant_row[0] if tenant_row else 1

        admin = db.query(Utente).filter(Utente.username == "admin").first()
        if not admin:
            if is_postgres and (not seed_admin_pwd or seed_admin_pwd == "admin"):
                raise RuntimeError(
                    "SEED_ADMIN_PASSWORD deve essere impostata a un valore sicuro "
                    "prima di creare l'utente admin iniziale in produzione."
                )
            db.add(Utente(
                username="admin",
                password_hash=get_password_hash(seed_admin_pwd or "admin"),
                ruolo="superadmin",
                tenant_id=tenant_id,
            ))
        else:
            # Forza ruolo superadmin, ma NON resettare la password (sovrascriverebbe i cambi utente)
            admin.ruolo = "superadmin"
            if not admin.tenant_id:
                admin.tenant_id = tenant_id
        db.commit()

        tecnico_user = db.query(Utente).filter(Utente.username == "tecnico").first()
        if not tecnico_user:
            if is_postgres and (not seed_tecnico_pwd or seed_tecnico_pwd == "tecnico"):
                raise RuntimeError(
                    "SEED_TECNICO_PASSWORD deve essere impostata a un valore sicuro "
                    "prima di creare l'utente tecnico iniziale in produzione."
                )
            tecnico_user = Utente(
                username="tecnico",
                password_hash=get_password_hash(seed_tecnico_pwd or "tecnico"),
                ruolo="tecnico",
                tenant_id=tenant_id,
            )
            db.add(tecnico_user)
            db.commit()
        else:
            if not tecnico_user.tenant_id:
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
