from datetime import datetime, timezone

from backend.core.security import get_password_hash
from backend.db.modelli import (
    Asset,
    AttivitaManutenzione,
    Impianto,
    PianoManutenzione,
    Sito,
    Tenant,
    Utente,
)


def _tenant(db_session) -> Tenant:
    tenant = Tenant(nome="Tenant Condizioni", slug="tenant-condizioni", is_active=True)
    db_session.add(tenant)
    db_session.commit()
    db_session.refresh(tenant)
    return tenant


def _login(client, db_session, tenant: Tenant):
    user = Utente(
        username="planner_condizioni",
        password_hash=get_password_hash("Password123!"),
        ruolo="responsabile",
        tenant_id=tenant.id,
        is_active=True,
    )
    db_session.add(user)
    db_session.commit()
    response = client.post("/auth/login", data={"username": user.username, "password": "Password123!"})
    assert response.status_code == 200, response.text


def _asset_tree(db_session, tenant: Tenant):
    sito = Sito(nome="Sito Test", tenant_id=tenant.id)
    impianto = Impianto(nome="Linea Test", tenant_id=tenant.id, sito=sito)
    asset_a = Asset(nome="Compressore A", codice="CMP-A", tenant_id=tenant.id, impianto=impianto)
    asset_b = Asset(nome="Compressore B", codice="CMP-B", tenant_id=tenant.id, impianto=impianto)
    db_session.add_all([sito, impianto, asset_a, asset_b])
    db_session.flush()
    return asset_a, asset_b


def test_running_hours_are_isolated_per_asset_and_trigger_condition_tasks(client, db_session):
    tenant = _tenant(db_session)
    _login(client, db_session, tenant)
    asset_a, asset_b = _asset_tree(db_session, tenant)

    piano = PianoManutenzione(
        nome_codificato="PM-COND-001",
        progressivo=1,
        tenant_id=tenant.id,
        asset_id=asset_a.id,
        stato="attivo",
    )
    db_session.add(piano)
    db_session.flush()

    task = AttivitaManutenzione(
        piano_id=piano.id,
        asset_id=asset_a.id,
        nome="Cambio filtro compressore",
        frequenza_giorni=None,
        durata_ore=1,
        priorita="Media",
        origine="Manuale",
        codice="COND-001",
        tenant_id=tenant.id,
        task_stato="active",
        source_type="manual_task",
        trigger_mode="condition",
        condition_metric="running_hours",
        condition_threshold_hours=100,
        condition_last_done_hours=250,
    )
    db_session.add(task)
    db_session.commit()

    response_a = client.post(f"/conditions/running-hours/assets/{asset_a.id}", json={"value": 360})
    response_b = client.post(f"/conditions/running-hours/assets/{asset_b.id}", json={"value": 900})
    assert response_a.status_code == 201, response_a.text
    assert response_b.status_code == 201, response_b.text

    response = client.get("/conditions/running-hours/assets")
    assert response.status_code == 200, response.text
    items = {item["asset_id"]: item for item in response.json()["items"]}

    assert items[asset_a.id]["current_hours"] == 360
    assert items[asset_a.id]["due_tasks"][0]["task_id"] == task.id
    assert items[asset_a.id]["due_tasks"][0]["due_at_hours"] == 350
    assert items[asset_b.id]["current_hours"] == 900
    assert items[asset_b.id]["condition_tasks"] == []


def test_running_hours_cannot_decrease(client, db_session):
    tenant = _tenant(db_session)
    _login(client, db_session, tenant)
    asset, _ = _asset_tree(db_session, tenant)

    first = client.post(f"/conditions/running-hours/assets/{asset.id}", json={"value": 120})
    second = client.post(f"/conditions/running-hours/assets/{asset.id}", json={"value": 119})

    assert first.status_code == 201, first.text
    assert second.status_code == 422


def test_scadenziario_includes_condition_only_tasks_without_mock_dates(client, db_session):
    tenant = _tenant(db_session)
    _login(client, db_session, tenant)
    asset, _ = _asset_tree(db_session, tenant)

    piano = PianoManutenzione(
        nome_codificato="PM-COND-002",
        progressivo=2,
        tenant_id=tenant.id,
        asset_id=asset.id,
        stato="attivo",
    )
    db_session.add(piano)
    db_session.flush()

    task = AttivitaManutenzione(
        piano_id=piano.id,
        asset_id=asset.id,
        nome="Verifica cuscinetti",
        durata_ore=1,
        priorita="Alta",
        origine="Manuale",
        codice="COND-002",
        tenant_id=tenant.id,
        task_stato="active",
        source_type="manual_task",
        trigger_mode="condition",
        condition_metric="running_hours",
        condition_threshold_hours=50,
        condition_last_done_hours=1000,
    )
    db_session.add(task)
    db_session.commit()

    posted = client.post(
        f"/conditions/running-hours/assets/{asset.id}",
        json={"value": 1040, "recorded_at": datetime.now(timezone.utc).isoformat()},
    )
    assert posted.status_code == 201, posted.text

    response = client.get("/scadenze/scadenziario")
    assert response.status_code == 200, response.text
    data = response.json()
    rows = [row for row in data["items"] if row["id"] == task.id]

    assert len(rows) == 1
    row = rows[0]
    assert row["trigger_mode"] == "condition"
    assert row["trigger_kind"] == "condition"
    assert row["prossima_data"] is None
    assert row["giorni_rimanenti"] is None
    assert row["current_running_hours"] == 1040
    assert row["condition_due_at_hours"] == 1050
    assert row["condition_remaining_hours"] == 10
