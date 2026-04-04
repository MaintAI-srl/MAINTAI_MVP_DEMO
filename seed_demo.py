"""
seed_demo.py — Popola il DB con dati demo realistici (Porto Industriale).

Uso:
  $env:DATABASE_URL = "postgresql://..."
  python seed_demo.py

Crea:
  - 1 Sito (Porto Industriale Nord - Genova)
  - 3 Impianti (Gru di Banchina, Nastri Trasportatori, Utilities)
  - 15 Asset con anagrafica completa
  - 5 Tecnici con competenze diverse
  - 6 Attività di manutenzione programmate
  - 20 Ticket in vari stati (Aperto / Pianificato / In corso / Chiuso)
"""

import os
import sys
from pathlib import Path
from datetime import datetime, timezone, timedelta, date

from dotenv import load_dotenv

load_dotenv(Path(__file__).parent / "backend" / ".env")

DATABASE_URL = os.getenv("DATABASE_URL")
if not DATABASE_URL:
    print("DATABASE_URL non trovata.")
    sys.exit(1)

os.environ["DATABASE_URL"] = DATABASE_URL  # assicura sia visibile al modulo database

from backend.core.database import SessionLocal
from backend.db.modelli import (
    Tenant, Sito, Impianto, Asset, Tecnico, Ticket,
    AttivitaManutenzione, Utente,
)
from backend.core.security import get_password_hash

NOW = datetime.now(timezone.utc)

def d(days_offset: int) -> datetime:
    return NOW + timedelta(days=days_offset)

def main():
    with SessionLocal() as db:
        # ── Tenant Demo ──────────────────────────────────────────────────────
        tenant = db.query(Tenant).filter(Tenant.slug == "demo").first()
        if not tenant:
            print("Tenant Demo non trovato. Esegui prima reset_db.py")
            sys.exit(1)
        tid = tenant.id
        print(f"Tenant Demo id={tid}")

        # ── Utenti aggiuntivi ─────────────────────────────────────────────────
        def crea_utente(username, ruolo):
            u = db.query(Utente).filter(Utente.username == username).first()
            if not u:
                u = Utente(
                    username=username,
                    password_hash=get_password_hash(username),
                    ruolo=ruolo,
                    is_active=True,
                    tenant_id=tid,
                )
                db.add(u)
                db.flush()
            return u

        u_resp = crea_utente("responsabile", "responsabile")
        u_t1   = crea_utente("m.rossi",      "tecnico")
        u_t2   = crea_utente("l.ferrari",    "tecnico")
        u_t3   = crea_utente("a.bianchi",    "tecnico")
        u_t4   = crea_utente("s.conti",      "tecnico")
        u_t5   = crea_utente("g.neri",       "tecnico")
        db.commit()
        print("Utenti creati")

        # ── Sito ──────────────────────────────────────────────────────────────
        sito = Sito(
            nome="Porto Industriale Nord",
            descrizione="Terminal container e bulk — banchine 1-4",
            ubicazione="Via del Porto 1",
            citta="Genova",
            paese="Italia",
            responsabile="Ing. Roberto Marino",
            telefono_responsabile="+39 010 5551234",
            email_responsabile="r.marino@portonord.it",
            note="Operativo H24 - 365 giorni",
            tenant_id=tid,
        )
        db.add(sito)
        db.flush()
        print(f"Sito: {sito.nome} (id={sito.id})")

        # ── Impianti ──────────────────────────────────────────────────────────
        imp_gru = Impianto(
            nome="Gru di Banchina",
            descrizione="Gru a portale e mobili per movimentazione container",
            tipologia="Sollevamento",
            note="Manutenzione preventiva ogni 500h di lavoro",
            sito_id=sito.id,
            latitude=44.4056,
            longitude=8.9463,
            tenant_id=tid,
        )
        imp_nastri = Impianto(
            nome="Nastri Trasportatori",
            descrizione="Sistema nastri per movimentazione bulk (carbone, cereali)",
            tipologia="Trasporto",
            note="Ispezione giornaliera obbligatoria",
            sito_id=sito.id,
            tenant_id=tid,
        )
        imp_util = Impianto(
            nome="Utilities",
            descrizione="Sistemi elettrici, HVAC e aria compressa",
            tipologia="Servizi Ausiliari",
            note="Cabina HV in gestione con Terna",
            sito_id=sito.id,
            tenant_id=tid,
        )
        db.add_all([imp_gru, imp_nastri, imp_util])
        db.flush()
        print(f"Impianti creati: {imp_gru.nome}, {imp_nastri.nome}, {imp_util.nome}")

        # ── Asset ─────────────────────────────────────────────────────────────
        assets_data = [
            # --- Gru di Banchina ---
            dict(
                nome="Gru a Portale #1", area="Banchina 1",
                codice="GRU-P01", descrizione="Gru portale STS per container 40'",
                marca="Liebherr", modello="LHM 600", matricola="LHM600-2018-001",
                anno_produzione=2018, anno_installazione=2019,
                fornitore="Liebherr Italia Srl",
                data_acquisto=date(2018, 11, 10),
                data_scadenza_garanzia=date(2023, 11, 10),
                criticita="alta", stato="service",
                posizione_fisica="Banchina 1 - Testata Nord",
                note_tecniche="Portata max 100t. Certificazione RINA in scadenza apr 2026.",
                vincoli_operativi="Vento max 72 km/h. Stop automatico oltre soglia.",
                impianto_id=imp_gru.id, tenant_id=tid,
            ),
            dict(
                nome="Gru a Portale #2", area="Banchina 1",
                codice="GRU-P02", descrizione="Gru portale STS per container 40'",
                marca="Liebherr", modello="LHM 600", matricola="LHM600-2019-002",
                anno_produzione=2019, anno_installazione=2019,
                fornitore="Liebherr Italia Srl",
                data_acquisto=date(2019, 3, 15),
                criticita="alta", stato="service",
                posizione_fisica="Banchina 1 - Testata Sud",
                note_tecniche="Portata max 100t. Gemella GRU-P01.",
                vincoli_operativi="Vento max 72 km/h.",
                impianto_id=imp_gru.id, tenant_id=tid,
            ),
            dict(
                nome="Gru Mobile Harbor #1", area="Banchina 2",
                codice="GRU-M01", descrizione="Gru mobile multi-purpose",
                marca="Manitowoc", modello="MLC300",
                anno_produzione=2020, anno_installazione=2020,
                criticita="media", stato="service",
                posizione_fisica="Banchina 2",
                note_tecniche="Portata max 300t. Utilizzata per carichi eccezionali.",
                impianto_id=imp_gru.id, tenant_id=tid,
            ),
            dict(
                nome="Carrello RTG #1", area="Piazzale Container A",
                codice="RTG-01", descrizione="Rubber Tyre Gantry - stoccaggio container",
                marca="Konecranes", modello="RTG 16W",
                anno_produzione=2017, anno_installazione=2017,
                criticita="alta", stato="service",
                posizione_fisica="Piazzale A - Settore 1-4",
                vincoli_operativi="Non operare con vento > 65 km/h.",
                note_tecniche="Sistema anti-sway integrato. Revisione ciclindri idraulici ogni 2000h.",
                impianto_id=imp_gru.id, tenant_id=tid,
            ),
            dict(
                nome="Carrello RTG #2", area="Piazzale Container A",
                codice="RTG-02", descrizione="Rubber Tyre Gantry - stoccaggio container",
                marca="Konecranes", modello="RTG 16W",
                anno_produzione=2017, anno_installazione=2018,
                criticita="alta", stato="fermo",
                posizione_fisica="Piazzale A - Settore 5-8",
                note_tecniche="FERMO per sostituzione motore propulsione.",
                impianto_id=imp_gru.id, tenant_id=tid,
            ),
            # --- Nastri Trasportatori ---
            dict(
                nome="Nastro Principale A", area="Banchina 3",
                codice="NST-A01", descrizione="Nastro principale movimentazione carbone 1200t/h",
                marca="Continental", modello="ContiTech ST2500",
                anno_produzione=2016, anno_installazione=2016,
                criticita="alta", stato="service",
                posizione_fisica="Banchina 3 → Silos 1",
                note_tecniche="Velocità nastro 3.2 m/s. Larghezza 1400mm.",
                vincoli_operativi="Stop automatico se pioggia > 20mm/h.",
                impianto_id=imp_nastri.id, tenant_id=tid,
            ),
            dict(
                nome="Nastro Secondario B", area="Banchina 3",
                codice="NST-B01", descrizione="Nastro secondario ritorno 600t/h",
                marca="Continental", modello="ContiTech ST1500",
                anno_produzione=2016, anno_installazione=2016,
                criticita="media", stato="service",
                posizione_fisica="Banchina 3 → Silos 2",
                impianto_id=imp_nastri.id, tenant_id=tid,
            ),
            dict(
                nome="Stazione di Carico #1", area="Banchina 3",
                codice="STC-01", descrizione="Tripper car e chute di carico",
                criticita="media", stato="service",
                posizione_fisica="Head end nastro principale",
                impianto_id=imp_nastri.id, tenant_id=tid,
            ),
            dict(
                nome="Trituratore Primario", area="Zona Bulk",
                codice="TRI-01", descrizione="Frantumatore a impatto per cereali",
                marca="Metso", modello="NP1315",
                anno_produzione=2015, anno_installazione=2015,
                criticita="alta", stato="service",
                note_tecniche="Capacità 800t/h. Usura martelli controllata ogni 300h.",
                impianto_id=imp_nastri.id, tenant_id=tid,
            ),
            # --- Utilities ---
            dict(
                nome="Gruppo Elettrogeno Emergenza", area="Sala Macchine",
                codice="GEN-EM01", descrizione="Generatore emergenza 2000 kVA",
                marca="Caterpillar", modello="C175-16",
                anno_produzione=2019, anno_installazione=2019,
                fornitore="Finning Italia Srl",
                data_acquisto=date(2019, 6, 1),
                criticita="alta", stato="service",
                posizione_fisica="Sala macchine edificio C",
                note_tecniche="Test mensile 30 min obbligatorio. Autonomia 72h a pieno carico.",
                vincoli_manutenzione="Cambio olio ogni 500h.",
                impianto_id=imp_util.id, tenant_id=tid,
            ),
            dict(
                nome="Cabina Elettrica HV", area="Sottostazione",
                codice="CAB-HV01", descrizione="Sottostazione MT/BT 20kV - 400V",
                marca="ABB", modello="UniGear ZS1",
                anno_produzione=2018, anno_installazione=2018,
                criticita="alta", stato="service",
                posizione_fisica="Edificio A - Piano Terra",
                note_tecniche="Ispezione termografica annuale obbligatoria.",
                vincoli_manutenzione="Manutenzione solo in assenza di tensione.",
                impianto_id=imp_util.id, tenant_id=tid,
            ),
            dict(
                nome="Sistema HVAC Officina", area="Officina Manutenzione",
                codice="HVC-01", descrizione="Impianto climatizzazione officina 1200m2",
                marca="Carrier", modello="AquaSnap 30RQP",
                anno_produzione=2020, anno_installazione=2021,
                criticita="bassa", stato="service",
                posizione_fisica="Tetto Edificio B",
                impianto_id=imp_util.id, tenant_id=tid,
            ),
            dict(
                nome="Compressore Aria #1", area="Sala Compressori",
                codice="COMP-01", descrizione="Compressore a vite 11 bar / 75 kW",
                marca="Atlas Copco", modello="GA75+",
                anno_produzione=2017, anno_installazione=2017,
                criticita="media", stato="service",
                posizione_fisica="Sala compressori edificio C",
                note_tecniche="Pressione lavoro 7.5 bar. Filtri separatori da cambiare ogni 2000h.",
                impianto_id=imp_util.id, tenant_id=tid,
            ),
            dict(
                nome="Compressore Aria #2", area="Sala Compressori",
                codice="COMP-02", descrizione="Compressore a vite 11 bar / 75 kW (ridondante)",
                marca="Atlas Copco", modello="GA75+",
                anno_produzione=2020, anno_installazione=2020,
                criticita="media", stato="service",
                posizione_fisica="Sala compressori edificio C",
                impianto_id=imp_util.id, tenant_id=tid,
            ),
            dict(
                nome="Trasformatore TR1", area="Sottostazione",
                codice="TR-01", descrizione="Trasformatore di potenza 20MVA",
                marca="Siemens", modello="GEAFOL",
                anno_produzione=2015, anno_installazione=2015,
                criticita="alta", stato="service",
                posizione_fisica="Sottostazione Est",
                note_tecniche="Analisi olio dielettrico annuale. Temperatura max avvolgimento 140°C.",
                vincoli_manutenzione="Solo personale abilitato CEI 11-27.",
                impianto_id=imp_util.id, tenant_id=tid,
            ),
        ]

        asset_objs = []
        for a in assets_data:
            obj = Asset(**a)
            db.add(obj)
            asset_objs.append(obj)
        db.flush()
        print(f"{len(asset_objs)} asset creati")

        # Mappa codice → oggetto per riferimenti rapidi
        am = {a.codice: a for a in asset_objs}

        # ── Tecnici ───────────────────────────────────────────────────────────
        tecnici_data = [
            dict(nome="Marco", cognome="Rossi",    competenze="Meccanica, Idraulica, Gru a Portale",          ore_giornaliere=8, orario_inizio="07:00", orario_fine="15:00", utente_id=u_t1.id),
            dict(nome="Luca",  cognome="Ferrari",  competenze="Elettrotecnica, PLC Siemens, Quadri HV",       ore_giornaliere=8, orario_inizio="08:00", orario_fine="16:00", utente_id=u_t2.id),
            dict(nome="Andrea",cognome="Bianchi",  competenze="Meccanica, Nastri Trasportatori, Lubrificazione", ore_giornaliere=8, orario_inizio="07:00", orario_fine="15:00", utente_id=u_t3.id),
            dict(nome="Sara",  cognome="Conti",    competenze="Elettromeccanica, HVAC, Strumentazione",       ore_giornaliere=8, orario_inizio="08:00", orario_fine="16:00", utente_id=u_t4.id),
            dict(nome="Giorgio",cognome="Neri",    competenze="Idraulica, Pneumatica, Carrelli RTG",          ore_giornaliere=8, orario_inizio="06:00", orario_fine="14:00", utente_id=u_t5.id),
        ]
        tecnico_objs = []
        for t in tecnici_data:
            obj = Tecnico(**t, stato="in servizio", tenant_id=tid)
            db.add(obj)
            tecnico_objs.append(obj)
        db.flush()
        t_rossi, t_ferrari, t_bianchi, t_conti, t_neri = tecnico_objs
        print(f"{len(tecnico_objs)} tecnici creati")

        # ── Attività di Manutenzione ──────────────────────────────────────────
        attivita_data = [
            dict(
                asset_id=am["GRU-P01"].id,
                descrizione="Ispezione periodica gru a portale: funi portanti, carrucole, freni, sistema anti-sway",
                frequenza_giorni=30, durata_ore=4.0, priorita="alta",
                origine="Manuale Liebherr LHM600",
                ultima_esecuzione=d(-18),
                prossima_scadenza=d(12),
                tenant_id=tid,
            ),
            dict(
                asset_id=am["GRU-P02"].id,
                descrizione="Ispezione periodica gru a portale: funi portanti, carrucole, freni, sistema anti-sway",
                frequenza_giorni=30, durata_ore=4.0, priorita="alta",
                origine="Manuale Liebherr LHM600",
                ultima_esecuzione=d(-25),
                prossima_scadenza=d(5),
                tenant_id=tid,
            ),
            dict(
                asset_id=am["NST-A01"].id,
                descrizione="Ispezione nastro: tensione, allineamento, usura raschiatori, rulli di ritorno",
                frequenza_giorni=7, durata_ore=2.0, priorita="alta",
                origine="Piano manutenzione Continental",
                ultima_esecuzione=d(-5),
                prossima_scadenza=d(2),
                tenant_id=tid,
            ),
            dict(
                asset_id=am["GEN-EM01"].id,
                descrizione="Test mensile generatore emergenza: avviamento, prova a carico 30 min, livello carburante",
                frequenza_giorni=30, durata_ore=2.0, priorita="alta",
                origine="Norma CEI 64-8 / Piano sicurezza",
                ultima_esecuzione=d(-28),
                prossima_scadenza=d(2),
                tenant_id=tid,
            ),
            dict(
                asset_id=am["COMP-01"].id,
                descrizione="Manutenzione programmata compressore: sostituzione filtri aria/olio, verifica separatore",
                frequenza_giorni=90, durata_ore=3.0, priorita="media",
                origine="Manuale Atlas Copco GA75+",
                ultima_esecuzione=d(-60),
                prossima_scadenza=d(30),
                tenant_id=tid,
            ),
            dict(
                asset_id=am["RTG-01"].id,
                descrizione="Revisione impianto idraulico RTG: pompe, cilindri sterzo, livelli fluidi",
                frequenza_giorni=60, durata_ore=5.0, priorita="alta",
                origine="Manuale Konecranes RTG",
                ultima_esecuzione=d(-40),
                prossima_scadenza=d(20),
                tenant_id=tid,
            ),
        ]
        att_objs = []
        for a in attivita_data:
            obj = AttivitaManutenzione(**a)
            db.add(obj)
            att_objs.append(obj)
        db.flush()
        print(f"{len(att_objs)} attivita manutenzione create")

        # ── Ticket ────────────────────────────────────────────────────────────
        def ticket(titolo, asset_codice, tipo, priorita, stato, desc, durata,
                   tecnico=None, fascia="mattina",
                   ps=None, pf=None, es=None, ef=None):
            return Ticket(
                titolo=titolo,
                asset_id=am[asset_codice].id,
                tipo=tipo,
                priorita=priorita,
                stato=stato,
                descrizione=desc,
                durata_stimata_ore=durata,
                fascia_oraria=fascia,
                tecnico_id=tecnico.id if tecnico else None,
                planned_start=ps,
                planned_finish=pf,
                execution_start=es,
                execution_finish=ef,
                tenant_id=tid,
            )

        tickets = [
            # ── APERTI (problemi segnalati, da assegnare) ──────────────────
            ticket(
                "Rumore anomalo riduttore GRU-P01", "GRU-P01",
                "CM", "alta", "Aperto",
                "Operatore segnala rumore intermittente proveniente dal riduttore di sollevamento "
                "durante movimentazione carichi > 60t. Verificare usura ingranaggi e livello olio.",
                4.0,
            ),
            ticket(
                "Perdita olio cilindro sterzo RTG-02", "RTG-02",
                "CM", "alta", "Aperto",
                "Perdita olio idraulico rilevata sul cilindro sinistro dello sterzo. "
                "RTG-02 attualmente fermo in piazzale A settore 6. Urgente: stoccaggio rallentato.",
                6.0,
            ),
            ticket(
                "Surriscaldamento motore nastro B", "NST-B01",
                "CM", "media", "Aperto",
                "Sensore temperatura motore trazione nastro B segnala 92°C (soglia allarme 85°C). "
                "Verificare sistema raffreddamento e ventilazione locale.",
                3.0,
            ),
            ticket(
                "Sostituzione filtri HVAC officina", "HVC-01",
                "PM", "bassa", "Aperto",
                "Filtri G4 e F7 dell'impianto HVAC officina da sostituire per ciclo semestrale.",
                1.5,
            ),
            # ── PIANIFICATI (schedulati per i prossimi giorni) ─────────────
            ticket(
                "Ispezione periodica GRU-P02 (30gg)", "GRU-P02",
                "PM", "alta", "Pianificato",
                "Ispezione mensile programmata: funi portanti, pulegge, freni elettromeccanici, "
                "sistema anti-sway, lubrificazione generale.",
                4.0, t_rossi, "mattina",
                ps=d(2), pf=d(2),
            ),
            ticket(
                "Test mensile generatore emergenza GEN-EM01", "GEN-EM01",
                "PM", "alta", "Pianificato",
                "Test di avviamento automatico e prova a carico 30 minuti come da normativa CEI 64-8. "
                "Verificare livello carburante, parametri alternatore, sistema ATS.",
                2.0, t_ferrari, "pomeriggio",
                ps=d(2), pf=d(2),
            ),
            ticket(
                "Ispezione settimanale nastro principale A", "NST-A01",
                "PM", "alta", "Pianificato",
                "Controllo tensione nastro, allineamento su tutti i rulli, stato raschiatori, "
                "lubrificazione cuscinetti catene di trazione.",
                2.0, t_bianchi, "mattina",
                ps=d(3), pf=d(3),
            ),
            ticket(
                "Revisione sistema idraulico RTG-01", "RTG-01",
                "PM", "alta", "Pianificato",
                "Revisione 60-giorni: controllo pressioni circuito, sostituzione filtri oleodinamici, "
                "verifica tenuta cilindri sollevamento e sterzo.",
                5.0, t_neri, "mattina",
                ps=d(4), pf=d(4),
            ),
            ticket(
                "Manutenzione compressore COMP-01 (90gg)", "COMP-01",
                "PM", "media", "Pianificato",
                "Sostituzione filtro aria, filtro olio, separatore olio/aria. "
                "Verifica cinghia di trasmissione e tenuta valvole.",
                3.0, t_conti, "mattina",
                ps=d(5), pf=d(5),
            ),
            ticket(
                "Termografia quadro HV cabina elettrica", "CAB-HV01",
                "PM", "alta", "Pianificato",
                "Ispezione termografica annuale con telecamera IR su tutti i morsetti, "
                "sbarre, interruttori MT/BT. Redazione report.",
                4.0, t_ferrari, "mattina",
                ps=d(7), pf=d(7),
            ),
            # ── IN CORSO (interventi avviati oggi/ieri) ─────────────────────
            ticket(
                "Sostituzione motore propulsione RTG-02", "RTG-02",
                "CM", "alta", "In corso",
                "Sostituzione motore trazione sinistro RTG-02 danneggiato per sovraccarico. "
                "Ricambio Konecranes in consegna. Lavori iniziati ieri mattina.",
                16.0, t_neri, "mattina",
                ps=d(-1), pf=d(1),
                es=d(-1),
            ),
            ticket(
                "Allineamento nastro secondario B - rulli deviati", "NST-B01",
                "CM", "media", "In corso",
                "Nastro secondario B fuori allineamento su sezione centrale (rulli 45-52). "
                "Nastro ancora operativo a velocità ridotta. Riallineamento in corso.",
                3.0, t_bianchi, "mattina",
                ps=d(0), pf=d(0),
                es=d(0),
            ),
            ticket(
                "Sostituzione raschiatori nastro principale A", "NST-A01",
                "PM", "media", "In corso",
                "Sostituzione raschiatori primario e secondario nastro A. "
                "Usura > 80% rilevata in ultima ispezione.",
                2.5, t_bianchi, "pomeriggio",
                ps=d(0), pf=d(0),
                es=d(0),
            ),
            # ── CHIUSI (storico ultime 2 settimane) ────────────────────────
            ticket(
                "Lubrificazione generale GRU-P01 (mese precedente)", "GRU-P01",
                "PM", "media", "Chiuso",
                "Ciclo mensile di lubrificazione: funi, pulegge, ruote di corsa, "
                "ingranaggi aperti, perno bilanciere.",
                3.0, t_rossi, "mattina",
                ps=d(-20), pf=d(-20),
                es=d(-20), ef=d(-20),
            ),
            ticket(
                "Sostituzione fusibili protezione cabina HV", "CAB-HV01",
                "CM", "alta", "Chiuso",
                "Intervento urgente per scatto protezione MT. "
                "Sostituiti fusibili scomparto 4 e ripristinato alimentazione banchina 2.",
                2.0, t_ferrari, "mattina",
                ps=d(-15), pf=d(-15),
                es=d(-15), ef=d(-15),
            ),
            ticket(
                "Revisione impianto oleodinamico GRU-P01", "GRU-P01",
                "PM", "alta", "Chiuso",
                "Sostituzione olio idraulico (600L ISO VG 46), pulizia serbatoio, "
                "sostituzione filtri rientro e aspirazione.",
                6.0, t_neri, "mattina",
                ps=d(-12), pf=d(-12),
                es=d(-12), ef=d(-12),
            ),
            ticket(
                "Riparazione perdita pneumatica stazione carico", "STC-01",
                "CM", "media", "Chiuso",
                "Perdita aria compressa su distributore pneumatico chute principale. "
                "Sostituita guarnizione OR e raccordo rapido.",
                1.5, t_conti, "pomeriggio",
                ps=d(-10), pf=d(-10),
                es=d(-10), ef=d(-10),
            ),
            ticket(
                "Manutenzione programmata trituratore TRI-01", "TRI-01",
                "PM", "alta", "Chiuso",
                "Controllo e sostituzione martelli (usura 65%). "
                "Bilanciamento rotore, verifica spazio denti.",
                8.0, t_rossi, "mattina",
                ps=d(-8), pf=d(-8),
                es=d(-8), ef=d(-8),
            ),
            ticket(
                "Cambio olio gruppo elettrogeno emergenza", "GEN-EM01",
                "PM", "media", "Chiuso",
                "Cambio olio motore (Cat DEO-ULS 15W40), sostituzione filtro olio, "
                "filtro carburante, filtro aria. Ore motore: 498.",
                2.5, t_ferrari, "mattina",
                ps=d(-5), pf=d(-5),
                es=d(-5), ef=d(-5),
            ),
            ticket(
                "Ispezione RTG-01 post-utilizzo intensivo", "RTG-01",
                "PM", "alta", "Chiuso",
                "Ispezione straordinaria dopo picco operativo (3500 movimentazioni in 72h). "
                "Verifica ruote, freni, sistema controllo carico. Tutto OK.",
                3.0, t_neri, "mattina",
                ps=d(-3), pf=d(-3),
                es=d(-3), ef=d(-3),
            ),
        ]

        for t_obj in tickets:
            db.add(t_obj)
        db.flush()
        print(f"{len(tickets)} ticket creati")

        db.commit()
        print("\nSEED DEMO COMPLETATO.")
        print(f"  Sito:     {sito.nome}")
        print(f"  Impianti: 3")
        print(f"  Asset:    {len(asset_objs)}")
        print(f"  Tecnici:  {len(tecnico_objs)}")
        print(f"  Attivita: {len(att_objs)}")
        print(f"  Ticket:   {len(tickets)} (4 aperti, 6 pianificati, 3 in corso, 7 chiusi)")
        print("\nCredenziali:")
        print("  admin        / admin        (superadmin)")
        print("  responsabile / responsabile (responsabile)")
        print("  m.rossi      / m.rossi      (tecnico)")
        print("  l.ferrari    / l.ferrari    (tecnico)")
        print("  a.bianchi    / a.bianchi    (tecnico)")
        print("  s.conti      / s.conti      (tecnico)")
        print("  g.neri       / g.neri       (tecnico)")


if __name__ == "__main__":
    main()
