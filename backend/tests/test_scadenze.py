from datetime import datetime, timedelta, timezone

from backend.core.security import get_password_hash
from backend.db.modelli import (
    Asset,
    AttivitaManutenzione,
    Impianto,
    PianoManutenzione,
    Sito,
    Tenant,
    Ticket,
    Utente,
)


def _tenant(db_session) -> Tenant:
    tenant = Tenant(nome="Tenant Scadenze", slug="tenant-scadenze", is_active=True)
    db_session.add(tenant)
    db_session.commit()
    db_session.refresh(tenant)
    return tenant


def _login(client, db_session, tenant: Tenant):
    user = Utente(
        username="planner_scadenze",
        password_hash=get_password_hash("Password123!"),
        ruolo="responsabile",
        tenant_id=tenant.id,
        is_active=True,
    )
    db_session.add(user)
    db_session.commit()
    response = client.post("/auth/login", data={"username": user.username, "password": "Password123!"})
    assert response.status_code == 200, response.text


def test_scadenziario_legge_scadenze_da_piani_manutenzione(client, db_session):
    tenant = _tenant(db_session)
    _login(client, db_session, tenant)

    sito = Sito(nome="Stazione", tenant_id=tenant.id)
    impianto = Impianto(nome="Antincendio", tenant_id=tenant.id, sito=sito)
    asset = Asset(nome="Naspi", tenant_id=tenant.id, impianto=impianto)
    piano = PianoManutenzione(
        nome_codificato="PM-2026-001",
        progressivo=1,
        tenant_id=tenant.id,
        asset_id=asset.id,
        stato="attivo",
    )
    db_session.add_all([sito, impianto, asset, piano])
    db_session.flush()

    now = datetime.now(timezone.utc)
    task = AttivitaManutenzione(
        piano_id=piano.id,
        asset_id=asset.id,
        nome="Controllo naspi",
        descrizione="Verifica periodica naspi",
        frequenza_giorni=180,
        durata_ore=1,
        priorita="Media",
        origine="Manuale",
        codice="cod.piano",
        prossima_scadenza=now + timedelta(days=12),
        tenant_id=tenant.id,
        task_stato="active",
        source_type="manual_task",
    )
    db_session.add(task)
    db_session.flush()

    closed_ticket = Ticket(
        titolo="Controllo naspi precedente",
        asset_id=asset.id,
        tipo="PM",
        priorita="Media",
        stato="Chiuso",
        durata_stimata_ore=1,
        fascia_oraria="diurna",
        attivita_manutenzione_id=task.id,
        piano_manutenzione_id=piano.id,
        execution_finish=now - timedelta(days=168),
        tenant_id=tenant.id,
    )
    next_ticket = Ticket(
        titolo="Controllo naspi prossimo",
        asset_id=asset.id,
        tipo="PM",
        priorita="Media",
        stato="Pianificato",
        durata_stimata_ore=1,
        fascia_oraria="diurna",
        attivita_manutenzione_id=task.id,
        piano_manutenzione_id=piano.id,
        planned_start=now + timedelta(days=12),
        tenant_id=tenant.id,
    )
    db_session.add_all([closed_ticket, next_ticket])
    db_session.commit()

    response = client.get("/scadenze/scadenziario")

    assert response.status_code == 200, response.text
    data = response.json()
    assert data["total"] == 1
    row = data["items"][0]
    assert row["sito"] == "Stazione"
    assert row["impianto"] == "Antincendio"
    assert row["asset"] == "Naspi"
    assert row["piano"] == "PM-2026-001"
    assert row["tipo"] == "LEGGE/PM"
    assert row["frequenza"] == "6M"
    assert row["ultima_ticket_id"] == closed_ticket.id
    assert row["prossima_ticket_id"] == next_ticket.id
    assert row["giorni_rimanenti"] == 12
