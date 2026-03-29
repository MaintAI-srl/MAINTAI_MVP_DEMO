
assets = [
    {"id": 1, "name": "Cabina MT 01", "area": "Stabilimento Nord", "vincolo_orario": "", "note": "Controlli mensili"},
    {"id": 2, "name": "Trasformatore TR01", "area": "Reparto Laminazione", "vincolo_orario": "", "note": "Verifica termica"},
    {"id": 3, "name": "Carriponte CP12", "area": "Capannone 3", "vincolo_orario": "solo dalle 22:00", "note": "Slot notturno"},
    {"id": 4, "name": "Impianto FV Tetto A", "area": "Magazzino", "vincolo_orario": "solo diurno", "note": "Pulizia trimestrale"},
]

tecnici = [
    {"id": 1, "nome": "Marco Rossi", "skill": "cabina_mt,trasformatore", "ore_giornaliere": 8},
    {"id": 2, "nome": "Luca Bianchi", "skill": "carriponte,correttiva", "ore_giornaliere": 8},
    {"id": 3, "nome": "Davide Ferri", "skill": "fotovoltaico,verifiche", "ore_giornaliere": 8},
]

tickets = [
    {"id": 1, "titolo": "Verifica relè protezione", "asset_id": 1, "priorita": "Alta", "stato": "Aperto", "durata_ore": 2.0, "fascia": "diurna"},
    {"id": 2, "titolo": "Controllo olio e temperatura", "asset_id": 2, "priorita": "Media", "stato": "Pianificato", "durata_ore": 2.5, "fascia": "diurna"},
    {"id": 3, "titolo": "Verifica finecorsa e funi", "asset_id": 3, "priorita": "Alta", "stato": "Aperto", "durata_ore": 3.0, "fascia": "notturna"},
    {"id": 4, "titolo": "Pulizia moduli e check inverter", "asset_id": 4, "priorita": "Bassa", "stato": "Aperto", "durata_ore": 2.0, "fascia": "diurna"},
]
