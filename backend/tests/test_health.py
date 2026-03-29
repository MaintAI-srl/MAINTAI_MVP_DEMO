from backend.core.config import VERSION, BUILD_DATE


def test_root(client):
    """GET / deve restituire il messaggio di stato."""
    response = client.get("/")
    assert response.status_code == 200
    assert response.json()["message"] == "MaintAI backend attivo"


def test_version(client):
    """GET /version deve restituire versione e build date corrette."""
    response = client.get("/version")
    assert response.status_code == 200
    data = response.json()
    assert data["version"] == VERSION
    assert data["build_date"] == BUILD_DATE
    assert data["app"] == "MaintAI"
    assert data["status"] == "ok"


def test_health(client):
    """GET /health deve restituire lo stato del sistema con DB ok."""
    response = client.get("/health")
    assert response.status_code == 200
    data = response.json()
    assert data["status"] in ("ok", "degraded")
    assert data["database"] == "ok"
    assert "openai" in data
    assert data["version"] == VERSION
