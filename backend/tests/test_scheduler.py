from backend.core.security import get_password_hash
from backend.db.modelli import Asset, Tenant, Utente
from sqlalchemy.orm import Session

def test_db_session(db_session: Session):
    """Verifica che il DB in-memory sia funzionante."""
    new_asset = Asset(nome="Test Asset", area="Prod")
    db_session.add(new_asset)
    db_session.commit()
    
    asset = db_session.query(Asset).filter(Asset.nome == "Test Asset").first()
    assert asset is not None
    assert asset.area == "Prod"

def test_scheduler_api(client, db_session: Session):
    """Verifica l'endpoint dello scheduler (mocked)."""
    tenant = Tenant(nome="Tenant Test", slug="tenant-test")
    db_session.add(tenant)
    db_session.flush()
    user = Utente(
        username="scheduler_test",
        password_hash=get_password_hash("password123"),
        ruolo="responsabile",
        tenant_id=tenant.id,
    )
    db_session.add(user)
    db_session.commit()

    login = client.post(
        "/auth/login",
        data={"username": "scheduler_test", "password": "password123"},
    )
    assert login.status_code == 200

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
