"""
Regression test — endpoint pubblici QR checklist di primo livello.

Bug: `token_expires_at` letto da SQLite (DB demo) o da colonne TIMESTAMP senza
timezone (fallback `_ensure_columns` su PostgreSQL) è un datetime naive; il
confronto con `datetime.now(timezone.utc)` (aware) sollevava TypeError e
trasformava in 500 tutte le richieste pubbliche via QR.
"""
import json
import uuid
from datetime import datetime, timedelta, timezone

import pytest

from backend.db.modelli import Asset, CheckPrimoLivello, Tenant, Ticket


@pytest.fixture
def check_setup(db_session):
    tenant = Tenant(nome="Tenant QR Test", slug=f"tenant-qr-{uuid.uuid4().hex[:8]}")
    db_session.add(tenant)
    db_session.flush()

    asset = Asset(nome="Compressore QR", area="Area Test", tenant_id=tenant.id)
    db_session.add(asset)
    db_session.flush()

    def _make_check(**kwargs) -> CheckPrimoLivello:
        check = CheckPrimoLivello(
            asset_id=asset.id,
            tenant_id=tenant.id,
            public_token=str(uuid.uuid4()),
            voci=json.dumps([{"label": "Controllo olio", "descrizione": None}]),
            token_active=True,
            **kwargs,
        )
        db_session.add(check)
        db_session.commit()
        return check

    return _make_check


def test_public_check_with_naive_expiry_returns_200(client, check_setup):
    """Un token_expires_at naive (SQLite/demo) non deve produrre 500."""
    naive_future = datetime.utcnow() + timedelta(days=30)  # naive di proposito
    check = check_setup(token_expires_at=naive_future)

    res = client.get(f"/check/public/{check.public_token}")
    assert res.status_code == 200
    body = res.json()
    assert body["asset_nome"] == "Compressore QR"
    assert "tenant_id" not in body  # dato interno, mai esposto sul pubblico
    assert "public_token" not in body


def test_public_check_with_naive_expired_token_returns_404(client, check_setup):
    naive_past = datetime.utcnow() - timedelta(days=1)
    check = check_setup(token_expires_at=naive_past)

    res = client.get(f"/check/public/{check.public_token}")
    assert res.status_code == 404


def test_public_check_with_aware_expiry_returns_200(client, check_setup):
    aware_future = datetime.now(timezone.utc) + timedelta(days=30)
    check = check_setup(token_expires_at=aware_future)

    res = client.get(f"/check/public/{check.public_token}")
    assert res.status_code == 200


def test_public_check_inactive_token_returns_404(client, check_setup, db_session):
    check = check_setup(token_expires_at=None)
    check.token_active = False
    db_session.commit()
    res = client.get(f"/check/public/{check.public_token}")
    assert res.status_code == 404


def test_public_segnala_with_naive_expiry_creates_ticket(client, check_setup, db_session):
    """Anche la segnalazione anomalia pubblica non deve rompersi con datetime naive."""
    naive_future = datetime.utcnow() + timedelta(days=30)
    check = check_setup(token_expires_at=naive_future)

    res = client.post(
        f"/check/public/{check.public_token}/segnala",
        json={"descrizione": "Perdita olio evidente", "operatore": "Mario"},
    )
    assert res.status_code == 201
    ticket_id = res.json()["ticket_id"]
    ticket = db_session.query(Ticket).filter(Ticket.id == ticket_id).first()
    assert ticket is not None
    assert ticket.tenant_id == check.tenant_id
    assert ticket.tipo == "BD"
