from datetime import datetime, timedelta

from backend.core.security import get_password_hash
from backend.db.modelli import Asset, GeneratedPlan, Tenant, Ticket, Utente


def _make_user(db_session, tenant: Tenant, username: str = "planner_reg"):
    user = Utente(
        username=username,
        password_hash=get_password_hash("Password123!"),
        ruolo="responsabile",
        tenant_id=tenant.id,
        is_active=True,
    )
    db_session.add(user)
    db_session.commit()
    return user


def _login(client, username: str = "planner_reg"):
    response = client.post(
        "/auth/login",
        data={"username": username, "password": "Password123!"},
    )
    assert response.status_code == 200, response.text


def _tenant(db_session, slug: str = "tenant-regressions") -> Tenant:
    tenant = Tenant(nome="Tenant Regressions", slug=slug, is_active=True)
    db_session.add(tenant)
    db_session.commit()
    db_session.refresh(tenant)
    return tenant


def _asset(db_session, tenant: Tenant) -> Asset:
    asset = Asset(nome="Pompa P-01", tenant_id=tenant.id)
    db_session.add(asset)
    db_session.commit()
    db_session.refresh(asset)
    return asset


def _ticket(db_session, tenant: Tenant, asset: Asset, durata: float = 2.0) -> Ticket:
    ticket = Ticket(
        titolo="Intervento test",
        asset_id=asset.id,
        tipo="CM",
        priorita="Media",
        stato="Aperto",
        durata_stimata_ore=durata,
        fascia_oraria="diurna",
        tenant_id=tenant.id,
    )
    db_session.add(ticket)
    db_session.commit()
    db_session.refresh(ticket)
    return ticket


def test_bulk_status_pianificato_calcola_fine_e_manual_flag(client, db_session):
    tenant = _tenant(db_session)
    _make_user(db_session, tenant)
    asset = _asset(db_session, tenant)
    ticket = _ticket(db_session, tenant, asset, durata=1.5)
    _login(client)

    start = "2026-04-20T08:30:00"
    response = client.patch(
        "/tickets/bulk-status",
        json={
            "ids": [ticket.id],
            "stato": "Pianificato",
            "planned_start": start,
            "is_manual_plan": True,
        },
    )

    assert response.status_code == 200, response.text
    db_session.refresh(ticket)
    assert ticket.stato == "Pianificato"
    assert ticket.is_manual_plan is True
    assert ticket.planned_start == datetime.fromisoformat(start)
    assert ticket.planned_finish == datetime.fromisoformat(start) + timedelta(hours=1.5)


def test_ticket_eliminato_resta_visibile_in_archivio(client, db_session):
    tenant = _tenant(db_session, "tenant-archive")
    _make_user(db_session, tenant)
    asset = _asset(db_session, tenant)
    ticket = _ticket(db_session, tenant, asset)
    _login(client)

    response = client.put(
        f"/tickets/{ticket.id}",
        json={"stato": "Eliminato", "eliminazione_note": "Duplicato"},
    )
    assert response.status_code == 200, response.text
    db_session.refresh(ticket)
    assert ticket.deleted_at is not None

    archive = client.get("/tickets?stato=Chiuso,Eliminato")
    assert archive.status_code == 200, archive.text
    ids = {item["id"] for item in archive.json()["items"]}
    assert ticket.id in ids


def test_confirm_plan_aggrega_frammenti_stesso_ticket(client, db_session):
    tenant = _tenant(db_session, "tenant-split-confirm")
    _make_user(db_session, tenant)
    asset = _asset(db_session, tenant)
    ticket = _ticket(db_session, tenant, asset, durata=10.0)
    plan = GeneratedPlan(
        status="draft",
        horizon_days=7,
        tenant_id=tenant.id,
        plan_json={
            "planned_workorders": [
                {
                    "wo_id": ticket.id,
                    "technician_id": 1,
                    "planned_date": "2026-04-20",
                    "planned_start_time": "08:00",
                    "planned_end_time": "16:00",
                    "duration_hours": 8,
                    "is_continuation": False,
                    "parent_wo_id": None,
                },
                {
                    "wo_id": ticket.id,
                    "technician_id": 1,
                    "planned_date": "2026-04-21",
                    "planned_start_time": "08:00",
                    "planned_end_time": "10:00",
                    "duration_hours": 2,
                    "is_continuation": True,
                    "parent_wo_id": ticket.id,
                },
            ],
            "deferred_workorders": [],
            "fermo_assets": [],
            "global_warnings": [],
        },
    )
    db_session.add(plan)
    db_session.commit()
    db_session.refresh(plan)
    _login(client)

    response = client.post(f"/planning/confirm/{plan.id}")

    assert response.status_code == 200, response.text
    db_session.refresh(ticket)
    assert ticket.planned_start == datetime.fromisoformat("2026-04-20T08:00:00")
    assert ticket.planned_finish == datetime.fromisoformat("2026-04-21T10:00:00")
