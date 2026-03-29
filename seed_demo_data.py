import os
import sys
import random
from datetime import date, datetime, timedelta, timezone

# Aggiunge la root del progetto al path
sys.path.append(os.getcwd())

from backend.core.database import SessionLocal, engine
from backend.db.modelli import Base, Impianto, Asset, Ticket, Tecnico, Utente
from backend.core.security import get_password_hash

def seed_demo():
    print("Pre-caricamento dati MASSIVI per la DEMO (120 Ticket)...")
    db = SessionLocal()
    
    try:
        # 1. Pulizia parziale (opzionale)
        
        # 2. Creazione 10 Impianti
        nomi_impianti = [
            "HQ Savona Centrale", "Genova Port Station", "Torino Innovation Hub",
            "Milano Data Center", "Venezia Lagoon Terminal", "Bologna Food Tech",
            "Firenze Heritage Site", "Roma Metropolitan Hub", "Napoli Vesuvio Energy",
            "Palermo Sun Field"
        ]
        impianti = []
        for nome in nomi_impianti:
            i = Impianto(
                nome=nome, 
                descrizione=f"Sito operativo di monitoraggio e controllo - {nome}",
                latitude=random.uniform(37.0, 46.0),
                longitude=random.uniform(7.0, 18.0)
            )
            db.add(i)
            impianti.append(i)
        
        db.commit()
        for i in impianti: db.refresh(i)
        
        # 3. Creazione 15 Asset
        tipi_asset = ["Inverter Solare", "Pompa Idraulica", "Trasformatore MT", "Quadro Elettrico", "Generatore Diesel", "Sensore IoT", "Turbina Eolica"]
        assets = []
        for k in range(15):
            nome_asset = f"{random.choice(tipi_asset)} {k+1:02d}"
            impianto = random.choice(impianti)
            a = Asset(
                nome=nome_asset,
                impianto_id=impianto.id,
                area=f"Area {random.randint(1,4)}",
                weather_sunny_required=(random.random() > 0.7),
                weather_max_wind_kmh=random.choice([None, 30, 40, 50]),
                weather_max_rain_mm=random.choice([None, 5, 10, 20]),
                stato="service"
            )
            db.add(a)
            assets.append(a)
        
        db.commit()
        for a in assets: db.refresh(a)
        
        # 4. Creazione 6 Tecnici Esperti (Filippo rimosso come richiesto)
        tecnici_data = [
            ("Mario", "Rossi", "Elettronica, PLC, Inverter"),
            ("Luigi", "Bianchi", "Idraulica, Pompe, Meccanica"),
            ("Elena", "Verdi", "Verifiche, Certificazioni, Ispezioni"),
            ("Giulia", "Neri", "Cabina MT, Quadri Elettrici"),
            ("Roberto", "Gialli", "General Maintenance, Backup Power"),
            ("Anna", "Viola", "Software, Monitoraggio IoT, Reti")
        ]
        tecnici_list = []
        for nome, cognome, skill in tecnici_data:
            t = Tecnico(
                nome=nome,
                cognome=cognome,
                competenze=skill,
                ore_giornaliere=8,
                stato="in servizio"
            )
            db.add(t)
            tecnici_list.append(t)
            
        # Creazione Utente Amministratore Filippo Nalesso (solo user, no tecnico)
        pass_hash = get_password_hash("filippo")
        u_filippo = Utente(username="filippo", password_hash=pass_hash, ruolo="responsabile")
        db.add(u_filippo)

        db.commit()
        for t in tecnici_list: db.refresh(t)
        
        # 5. Creazione 120 Ticket Distribuiti
        # Circa 40 Chiusi (storia) e 80 Aperti/Pianificati
        tipi = ["PM", "CM", "BD", "ISP"]
        priorita = ["Bassa", "Media", "Alta", "Critica"]
        stati = ["Aperto", "Pianificato", "In corso", "Chiuso"]
        
        now = datetime.now(timezone.utc)
        
        for j in range(1, 121):
            target_asset = random.choice(assets)
            tipo = random.choice(tipi)
            prio = random.choice(priorita)
            
            # Distribuzione stato: più Aperti/Pianificati (Demo Future)
            if j <= 40:
                stato = "Chiuso"
                # Data esecuzione del passato
                exec_finish = now - timedelta(days=random.randint(1, 180), hours=random.randint(0,23))
                exec_start = exec_finish - timedelta(hours=random.randint(1, 4))
                t_id = random.choice(tecnici_list).id
            else:
                stato = random.choice(["Aperto", "Pianificato", "Aperto", "Pianificato", "In corso"])
                exec_start = None
                exec_finish = None
                t_id = random.choice(tecnici_list).id if stato != "Aperto" else None
            
            # Durata stimata
            durata = random.uniform(0.5, 6.0)
            
            db.add(Ticket(
                titolo=f"Intervento {tipo} - {target_asset.nome} #{j:03d}",
                descrizione=f"Specifica intervento {tipo} per {target_asset.nome}. Priorità: {prio}.",
                asset_id=target_asset.id,
                tipo=tipo,
                priorita=prio,
                stato=stato,
                durata_stimata_ore=durata,
                fascia_oraria=random.choice(["diurna", "pomeriggio", "notte"]),
                tecnico_id=t_id,
                # Per i chiusi settiamo execution_start/finish
                execution_start=exec_start,
                execution_finish=exec_finish,
                created_at=now - timedelta(days=random.randint(0, 30))
            ))
            
        db.commit()
        print(f"DEMO DATA CARICATA: 10 Impianti, 15 Asset, 120 Ticket, 6 Tecnici.")
        print("Utente 'filippo' / 'filippo' (Responsabile) creato.")
        
    except Exception as e:
        print(f"ERRORE DURANTE IL SEED: {e}")
        db.rollback()
    finally:
        db.close()

if __name__ == "__main__":
    seed_demo()
