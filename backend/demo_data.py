import random
from datetime import datetime, timedelta, timezone, date
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from backend.db.modelli import Base, Tenant, Sito, Impianto, Asset, Tecnico, Ticket, Utente
from backend.core.security import get_password_hash
from pathlib import Path

# Configurazione database demo
_PROJECT_ROOT = Path(__file__).resolve().parent.parent
DEMO_DB_PATH = _PROJECT_ROOT / "demo.db"
DEMO_DATABASE_URL = f"sqlite:///{DEMO_DB_PATH}"

def seed_demo_db():
    engine = create_engine(DEMO_DATABASE_URL, connect_args={"check_same_thread": False})
    Base.metadata.drop_all(bind=engine) # Pulisci se esistente
    Base.metadata.create_all(bind=engine)
    
    SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
    db = SessionLocal()
    
    try:
        # 1. Tenant Demo
        tenant = Tenant(nome="MaintAI Demo Corp", slug="demo", is_active=True)
        db.add(tenant)
        db.commit()
        db.refresh(tenant)
        
        # 2. Utente Demo
        demo_user = Utente(
            username="demo",
            password_hash=get_password_hash("demo123"),
            ruolo="responsabile",
            tenant_id=tenant.id
        )
        db.add(demo_user)
        db.commit()

        # 3. Siti (3)
        siti_data = [
            {"nome": "Porto di Genova", "citta": "Genova", "ubicazione": "Molo Vecchio 12"},
            {"nome": "Stabilimento Milano", "citta": "Milano", "ubicazione": "Via Mecenate 84"},
            {"nome": "Centrale Savona", "citta": "Vado Ligure", "ubicazione": "Zona Industriale B"},
        ]
        siti = []
        for s in siti_data:
            sito = Sito(**s, tenant_id=tenant.id)
            db.add(sito)
            siti.append(sito)
        db.commit()

        # 4. Impianti (uno per sito)
        impianti = []
        for i, sito in enumerate(siti):
            impianto = Impianto(
                nome=f"Impianto {sito.nome}",
                descrizione=f"Infrastruttura principale {sito.nome}",
                sito_id=sito.id,
                tenant_id=tenant.id,
                tipologia="Logistica" if i == 0 else "Produzione" if i == 1 else "Energia"
            )
            db.add(impianto)
            impianti.append(impianto)
        db.commit()

        # 5. Tecnici (5)
        tecnici_data = [
            ("Marco Rossi", "Elettricista"),
            ("Luca Bianchi", "Meccanico"),
            ("Giuseppe Verdi", "Idraulico"),
            ("Anna Bruni", "Automazione"),
            ("Stefano Neri", "Manutentore"),
        ]
        tecnici = []
        for nome_completo, comp in tecnici_data:
            nome, cognome = nome_completo.split()
            tecnico = Tecnico(
                nome=nome,
                cognome=cognome,
                competenze=comp,
                ore_giornaliere=8,
                tenant_id=tenant.id,
                stato="in servizio"
            )
            db.add(tecnico)
            tecnici.append(tecnico)
        db.commit()

        # 6. Asset (15)
        asset_tipi = [
            ("Pompa Centrifuga P-101", "Pompa", "Alfa Laval", "CP-500", "SN-98231"),
            ("Motore Elettrico M-202", "Motore", "Siemens", "1LA7", "SN-11223"),
            ("Compressore Aria C-303", "Compressore", "Atlas Copco", "GA 37", "SN-44556"),
            ("Quadro Elettrico QE-01", "Quadro Elettrico", "Schneider", "Prisma", "SN-00998"),
            ("Nastro Trasportatore NT-05", "Nastro Trasportatore", "Habasit", "ST-200", "SN-77889"),
        ]
        
        assets = []
        for i in range(15):
            tipologia, area, marca, modello, matricola = asset_tipi[i % 5]
            impianto = impianti[i // 5]
            asset = Asset(
                nome=f"{tipologia} #{i+1:02d}",
                area=area,
                marca=marca,
                modello=modello,
                matricola=f"{matricola}-D{i+1}",
                anno_installazione=2020 - (i % 4),
                impianto_id=impianto.id,
                tenant_id=tenant.id,
                criticita="alta" if i % 3 == 0 else "media",
                stato="service" if i != 7 else "down" # Uno in downtime
            )
            db.add(asset)
            assets.append(asset)
        db.commit()

        # 7. Ticket (20)
        # 13 Chiusi, 7 Aperti (di cui 2 critici)
        stati = ["aperto", "in lavorazione", "chiuso"]
        tipi = ["CM", "PM", "ISP", "BD"] # Corrective, Preventive, Inspection, Breakdown
        priorita = ["bassa", "media", "alta", "critica"]
        
        now = datetime.now(timezone.utc)
        
        for i in range(20):
            t_id = i + 1
            asset = assets[i % 15]
            tecnico = tecnici[i % 5]
            
            tipo = tipi[i % 4]
            prio = priorita[3] if i < 2 else priorita[i % 3] # I primi 2 sono critici
            stato = "chiuso" if i >= 7 else ("aperto" if i % 2 == 0 else "in lavorazione")
            
            # Date coerenti
            created = now - timedelta(days=random.randint(5, 45))
            
            ticket = Ticket(
                titolo=f"Intervento {tipo} su {asset.nome}",
                descrizione=f"Attività di {tipo} programmata per l'asset {asset.nome}. Verificare integrità componenti.",
                asset_id=asset.id,
                tipo=tipo,
                priorita=prio,
                stato=stato,
                durata_stimata_ore=float(random.randint(1, 6)),
                tecnico_id=tecnico.id,
                created_at=created,
                tenant_id=tenant.id
            )
            
            if stato == "chiuso":
                ticket.execution_start = created + timedelta(hours=2)
                ticket.execution_finish = ticket.execution_start + timedelta(hours=ticket.durata_stimata_ore + random.random())
            elif stato == "in lavorazione":
                ticket.execution_start = now - timedelta(hours=random.randint(1, 4))
                
            # Uno scaduto
            if i == 5:
                ticket.planned_finish = now - timedelta(days=2)
                ticket.stato = "aperto"
                ticket.priorita = "alta"

            db.add(ticket)
        
        db.commit()
        print(f"Database DEMO popolato con successo in {DEMO_DB_PATH}")
        
    except Exception as e:
        db.rollback()
        print(f"Errore durante il seeding del DB demo: {e}")
        raise e
    finally:
        db.close()

if __name__ == "__main__":
    seed_demo_db()
