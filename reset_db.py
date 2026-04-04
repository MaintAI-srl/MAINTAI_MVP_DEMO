"""
reset_db.py — Esegui UNA VOLTA SOLA, poi cancella questo file.

Cosa fa:
  1. Connette al DB tramite DATABASE_URL (legge da .env o variabile d'ambiente)
  2. Salva tutti gli utenti con ruolo superadmin
  3. Cancella tutti i dati rispettando l'ordine FK (senza droppare tabelle)
  4. Ripristina il tenant Demo + gli utenti superadmin salvati
  5. Stampa conferma di ogni operazione

Uso:
  cd <root progetto>
  DATABASE_URL="postgresql://..." python reset_db.py
  oppure, se hai backend/.env con DATABASE_URL:
  python reset_db.py
"""

import os
import sys
from pathlib import Path
from dotenv import load_dotenv

# Carica .env da backend/
load_dotenv(Path(__file__).parent / "backend" / ".env")

DATABASE_URL = os.getenv("DATABASE_URL")
if not DATABASE_URL:
    print("❌  DATABASE_URL non trovata. Impostala come variabile d'ambiente o in backend/.env")
    sys.exit(1)

if DATABASE_URL.startswith("sqlite"):
    print("⚠️  Stai usando SQLite locale, non PostgreSQL cloud.")
    risposta = input("Sei sicuro di voler continuare? (s/N): ").strip().lower()
    if risposta != "s":
        print("Annullato.")
        sys.exit(0)

from sqlalchemy import create_engine, text
from sqlalchemy.orm import sessionmaker

print(f"\n🔌  Connessione a: {DATABASE_URL[:60]}...")
engine = create_engine(DATABASE_URL)
Session = sessionmaker(bind=engine)

# ── STEP 1: Salva gli admin ────────────────────────────────────────────────
print("\n📋  STEP 1 — Salvo gli utenti superadmin...")
with engine.connect() as conn:
    rows = conn.execute(text(
        "SELECT id, username, password_hash, ruolo, is_active FROM utenti WHERE ruolo = 'superadmin'"
    )).fetchall()

if not rows:
    print("⚠️  Nessun utente superadmin trovato. Lo script ricrea admin/admin come default.")
    admins_salvati = []
else:
    admins_salvati = [
        {"username": r[1], "password_hash": r[2], "ruolo": r[3], "is_active": r[4]}
        for r in rows
    ]
    for a in admins_salvati:
        print(f"   ✅  Salvato: {a['username']} ({a['ruolo']})")

# ── Conferma utente ────────────────────────────────────────────────────────
print(f"\n⚠️  ATTENZIONE: verranno cancellati TUTTI i dati tranne {len(admins_salvati)} admin(s).")
print("   Tabelle interessate: ticket, asset, impianti, siti, tecnici, manuali,")
print("   attivita_manutenzione, analisi_guasti, diagnostic_sessions,")
print("   ticket_allegati, tecnici_assenze, email_config, utenti (non-admin), tenants")
risposta = input("\nDigita 'RESET' per confermare: ").strip()
if risposta != "RESET":
    print("Annullato.")
    sys.exit(0)

# ── STEP 2: DELETE in ordine FK corretto ──────────────────────────────────
ORDINE_CANCELLAZIONE = [
    # Foglie (nessuna FK uscente verso tabelle che cancellerei dopo)
    ("analisi_guasti",          "DELETE FROM analisi_guasti"),
    ("diagnostic_sessions",     "DELETE FROM diagnostic_sessions"),
    ("ticket_allegati",         "DELETE FROM ticket_allegati"),
    ("ticket (self-ref NULL)",  "UPDATE ticket SET parent_id = NULL"),
    ("ticket",                  "DELETE FROM ticket"),
    ("tecnici_assenze",         "DELETE FROM tecnici_assenze"),
    ("email_config",            "DELETE FROM email_config"),
    ("attivita_manutenzione",   "DELETE FROM attivita_manutenzione"),
    ("manuali",                 "DELETE FROM manuali"),
    ("tecnici",                 "DELETE FROM tecnici"),
    ("asset",                   "DELETE FROM asset"),
    ("impianti",                "DELETE FROM impianti"),
    ("siti",                    "DELETE FROM siti"),
    ("utenti",                  "DELETE FROM utenti"),   # tutti, li rimettiamo dopo
    ("tenants",                 "DELETE FROM tenants"),  # tutti, li rimettiamo dopo
]

print("\n🗑️   STEP 2 — Cancellazione dati...")
with engine.begin() as conn:
    for nome, sql in ORDINE_CANCELLAZIONE:
        result = conn.execute(text(sql))
        affected = result.rowcount if result.rowcount >= 0 else "n/a"
        print(f"   [{affected:>5} righe]  {nome}")

print("   ✅  Cancellazione completata.")

# ── STEP 3: Ricrea tenant Demo + admin ────────────────────────────────────
print("\n🌱  STEP 3 — Ripristino tenant Demo e utenti admin...")

from datetime import datetime, timezone

with engine.begin() as conn:
    # Tenant Demo
    conn.execute(text(
        "INSERT INTO tenants (nome, slug, is_active, created_at) "
        "VALUES ('Demo', 'demo', true, :now)"
    ), {"now": datetime.now(timezone.utc)})

    tenant_row = conn.execute(text("SELECT id FROM tenants WHERE slug='demo'")).fetchone()
    tenant_id = tenant_row[0]
    print(f"   ✅  Tenant Demo creato (id={tenant_id})")

    # Ripristina gli admin salvati
    if admins_salvati:
        for a in admins_salvati:
            conn.execute(text(
                "INSERT INTO utenti (username, password_hash, ruolo, is_active, tenant_id) "
                "VALUES (:username, :password_hash, :ruolo, :is_active, :tenant_id)"
            ), {**a, "tenant_id": tenant_id})
            print(f"   ✅  Ripristinato: {a['username']} ({a['ruolo']})")
    else:
        # Fallback: crea admin/admin
        from passlib.context import CryptContext
        pwd_ctx = CryptContext(schemes=["bcrypt"], deprecated="auto")
        hash_ = pwd_ctx.hash("admin")
        conn.execute(text(
            "INSERT INTO utenti (username, password_hash, ruolo, is_active, tenant_id) "
            "VALUES ('admin', :hash, 'superadmin', true, :tid)"
        ), {"hash": hash_, "tid": tenant_id})
        print("   ✅  Creato admin/admin (superadmin) — nessun admin precedente trovato")

print("\n✅  RESET COMPLETATO.")
print("   DB pulito. Dati rimasti: tenant Demo + utenti superadmin originali.")
print("   Puoi ora eliminare questo file reset_db.py")
