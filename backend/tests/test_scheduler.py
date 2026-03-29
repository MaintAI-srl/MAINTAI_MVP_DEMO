import pytest
from datetime import datetime, date, timedelta
from backend.db.modelli import Ticket, Asset, Tecnico
from sqlalchemy.orm import Session

def test_db_session(db_session: Session):
    """Verifica che il DB in-memory sia funzionante."""
    new_asset = Asset(nome="Test Asset", area="Prod")
    db_session.add(new_asset)
    db_session.commit()
    
    asset = db_session.query(Asset).filter(Asset.nome == "Test Asset").first()
    assert asset is not None
    assert asset.area == "Prod"

def test_scheduler_api(client):
    """Verifica l'endpoint dello scheduler (mocked)."""
    # Creiamo un asset e un tecnico
    response_asset = client.post("/assets", json={
        "nome": "Pressa Alpha",
        "area": "Stampaggio",
        "note": "Test"
    })
    assert response_asset.status_code == 201
    asset_id = response_asset.json()["id"]
    
    response_tecnico = client.post("/tecnici", json={
        "nome": "Mario",
        "cognome": "Rossi",
        "skill": "Elettricista",
        "ore_giornaliere": 8
    })
    assert response_tecnico.status_code == 201
    
    # Creiamo un ticket
    client.post("/tickets", json={
        "titolo": "Guasto idraulico",
        "asset_id": asset_id,
        "priorita": "Alta",
        "stato": "Aperto",
        "durata_stimata_ore": 2,
        "fascia_oraria": "mattina",
        "descrizione": "Perdita olio"
    })
    
    # Eseguiamo ricalcolo scheduler
    response = client.post("/scheduler/ricalcola")
    assert response.status_code == 200
    data = response.json()
    assert "items" in data
