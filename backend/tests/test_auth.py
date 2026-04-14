from backend.core.security import get_password_hash
from backend.db.modelli import Utente


def _create_user(db_session, username: str, password: str, ruolo: str = "admin"):
    user = Utente(
        username=username,
        password_hash=get_password_hash(password),
        ruolo=ruolo,
    )
    db_session.add(user)
    db_session.commit()
    return user


def test_login_success(client, db_session):
    """Login con credenziali valide deve impostare il cookie JWT e restituire i metadati utente."""
    _create_user(db_session, "operatore1", "password123")

    response = client.post(
        "/auth/login",
        data={"username": "operatore1", "password": "password123"},
    )
    assert response.status_code == 200
    data = response.json()
    # Il JWT è emesso nel cookie HttpOnly, non nel body JSON
    assert "maintai_jwt" in response.cookies
    assert data["username"] == "operatore1"
    assert data["ruolo"] == "admin"


def test_login_wrong_password(client, db_session):
    """Login con password errata deve restituire 401."""
    _create_user(db_session, "operatore2", "corretto")

    response = client.post(
        "/auth/login",
        data={"username": "operatore2", "password": "sbagliato"},
    )
    assert response.status_code == 401


def test_login_unknown_user(client):
    """Login con utente inesistente deve restituire 401."""
    response = client.post(
        "/auth/login",
        data={"username": "fantasma", "password": "qualsiasi"},
    )
    assert response.status_code == 401


def test_login_missing_fields(client):
    """Login senza campi obbligatori deve restituire 422."""
    response = client.post("/auth/login", data={})
    assert response.status_code == 422
