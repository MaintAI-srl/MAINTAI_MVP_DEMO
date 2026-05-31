"""
Test di integrazione HTTP per il router genera-ticket (POST /piani-manutenzione/{piano_id}/tasks/{task_id}/genera-ticket).

Testa il flusso reale end-to-end via TestClient, non il solo modello ORM.
"""
import pytest
from backend.db.modelli import (
    Tenant, Utente, Asset, Impianto, Sito,
    PianoManutenzione, AttivitaManutenzione, Ticket,
    piano_asset_association,
)
from backend.core.security import get_password_hash


# ─── Fixtures ─────────────────────────────────────────────────────────────────

@pytest.fixture
def tenant(db_session):
    t = Tenant(nome="TenantGenTicket", slug="tenant-gen-ticket")
    db_session.add(t)
    db_session.commit()
    db_session.refresh(t)
    return t


@pytest.fixture
def user(db_session, tenant):
    u = Utente(
        username="admin_gen",
        password_hash=get_password_hash("pass123"),
        ruolo="responsabile",
        tenant_id=tenant.id,
        is_active=True,
    )
    db_session.add(u)
    db_session.commit()
    return u


@pytest.fixture
def asset(db_session, tenant):
    a = Asset(
        nome="Compressore C-01",
        tenant_id=tenant.id,
        codice="COMP-01",
    )
    db_session.add(a)
    db_session.commit()
    db_session.refresh(a)
    return a


@pytest.fixture
def piano_con_assets(db_session, tenant, asset):
    """Piano con asset collegato via relazione many-to-many (come fa il router reale)."""
    p = PianoManutenzione(
        nome_codificato="PM-2026-TEST",
        progressivo=100,
        asset_id=asset.id,  # legacy FK
        tenant_id=tenant.id,
        stato="attivo",
    )
    p.assets = [asset]  # molti-a-molti — come il router CREATE
    db_session.add(p)
    db_session.commit()
    db_session.refresh(p)
    return p


@pytest.fixture
def piano_senza_assets(db_session, tenant, asset):
    """Piano con solo asset_id legacy (nessuna riga in piani_assets_association)."""
    p = PianoManutenzione(
        nome_codificato="PM-2026-LEGACY",
        progressivo=101,
        asset_id=asset.id,
        tenant_id=tenant.id,
        stato="attivo",
    )
    # NON imposta p.assets — simula piano creato prima della many-to-many
    db_session.add(p)
    db_session.commit()
    db_session.refresh(p)
    return p


@pytest.fixture
def task(db_session, tenant, piano_con_assets, asset):
    t = AttivitaManutenzione(
        piano_id=piano_con_assets.id,
        asset_id=asset.id,
        nome="Sostituzione cinghia",
        descrizione="Verifica e sostituzione cinghia di trasmissione",
        priorita="Alta",
        frequenza_giorni=180,
        durata_ore=3.0,
        tenant_id=tenant.id,
        task_stato="active",
        generation_mode="manual",
        is_repeatable=True,
        source_type="manual_task",
    )
    db_session.add(t)
    db_session.commit()
    db_session.refresh(t)
    return t


@pytest.fixture
def task_long(db_session, tenant, piano_con_assets, asset):
    """Task con durata > 8h — deve generare più chunk."""
    t = AttivitaManutenzione(
        piano_id=piano_con_assets.id,
        asset_id=asset.id,
        nome="Revisione completa",
        descrizione="Revisione generale impianto",
        priorita="Media",
        frequenza_giorni=365,
        durata_ore=10.0,  # > 8h → 2 ticket
        tenant_id=tenant.id,
        task_stato="active",
        generation_mode="manual",
        is_repeatable=True,
        source_type="manual_task",
    )
    db_session.add(t)
    db_session.commit()
    db_session.refresh(t)
    return t


@pytest.fixture
def task_paused(db_session, tenant, piano_con_assets, asset):
    t = AttivitaManutenzione(
        piano_id=piano_con_assets.id,
        asset_id=asset.id,
        nome="Task in pausa",
        descrizione="Non deve generare ticket",
        priorita="Bassa",
        frequenza_giorni=90,
        durata_ore=1.0,
        tenant_id=tenant.id,
        task_stato="paused",
        generation_mode="manual",
    )
    db_session.add(t)
    db_session.commit()
    db_session.refresh(t)
    return t


@pytest.fixture
def task_disabled(db_session, tenant, piano_con_assets, asset):
    t = AttivitaManutenzione(
        piano_id=piano_con_assets.id,
        asset_id=asset.id,
        nome="Task disabilitato",
        descrizione="Generazione disabilitata",
        priorita="Bassa",
        frequenza_giorni=90,
        durata_ore=1.0,
        tenant_id=tenant.id,
        task_stato="active",
        generation_mode="disabled",
    )
    db_session.add(t)
    db_session.commit()
    db_session.refresh(t)
    return t


def _login(client, username="admin_gen", password="pass123"):
    resp = client.post("/auth/login", data={"username": username, "password": password})
    assert resp.status_code == 200, f"Login fallito: {resp.text}"
    return resp


def _url(piano_id, task_id):
    return f"/piani-manutenzione/{piano_id}/tasks/{task_id}/genera-ticket"


# ─── Test suite ───────────────────────────────────────────────────────────────

class TestGeneraTicketRouter:

    def test_genera_ticket_base(self, client, user, piano_con_assets, task):
        """Caso nominale: genera 1 ticket APERTO per un task attivo con asset."""
        _login(client)
        resp = client.post(_url(piano_con_assets.id, task.id))
        assert resp.status_code == 200, resp.text
        data = resp.json()
        assert data["created"] == 1
        assert len(data["ticket_ids"]) == 1
        assert data["assets_count"] == 1

    def test_ticket_generato_e_aperto(self, client, user, db_session, piano_con_assets, task):
        """Il ticket creato deve avere stato APERTO."""
        _login(client)
        resp = client.post(_url(piano_con_assets.id, task.id))
        assert resp.status_code == 200
        ticket_id = resp.json()["ticket_ids"][0]
        ticket = db_session.get(Ticket, ticket_id)
        assert ticket is not None
        assert ticket.stato == "Aperto"

    def test_ticket_collegato_a_task_e_piano(self, client, user, db_session, piano_con_assets, task):
        """Il ticket deve avere i FK corretti verso task e piano."""
        _login(client)
        resp = client.post(_url(piano_con_assets.id, task.id))
        assert resp.status_code == 200
        ticket_id = resp.json()["ticket_ids"][0]
        ticket = db_session.get(Ticket, ticket_id)
        assert ticket.attivita_manutenzione_id == task.id
        assert ticket.piano_manutenzione_id == piano_con_assets.id
        assert ticket.origin_type == "task_manual_generation"

    def test_last_generated_at_aggiornato(self, client, user, db_session, piano_con_assets, task):
        """Dopo la generazione, last_generated_at deve essere valorizzato."""
        _login(client)
        assert task.last_generated_at is None
        resp = client.post(_url(piano_con_assets.id, task.id))
        assert resp.status_code == 200
        db_session.refresh(task)
        assert task.last_generated_at is not None

    def test_next_due_at_calcolato(self, client, user, db_session, piano_con_assets, task):
        """next_due_at = last_generated_at + frequenza_giorni."""
        from datetime import timedelta
        _login(client)
        resp = client.post(_url(piano_con_assets.id, task.id))
        assert resp.status_code == 200
        db_session.refresh(task)
        expected = task.last_generated_at + timedelta(days=task.frequenza_giorni)
        assert abs((task.next_due_at - expected).total_seconds()) < 5

    def test_chunking_durata_lunga(self, client, user, db_session, piano_con_assets, task_long):
        """Task con 10h deve generare 2 ticket (8h + 2h)."""
        _login(client)
        resp = client.post(_url(piano_con_assets.id, task_long.id))
        assert resp.status_code == 200, resp.text
        data = resp.json()
        assert data["created"] == 2, f"Attesi 2 ticket per durata 10h, ottenuti {data['created']}"
        ids = data["ticket_ids"]
        t1 = db_session.get(Ticket, ids[0])
        t2 = db_session.get(Ticket, ids[1])
        assert t1.durata_stimata_ore == 8.0
        assert t2.durata_stimata_ore == 2.0
        assert "(Parte 1/2)" in t1.titolo
        assert "(Parte 2/2)" in t2.titolo

    def test_prevenzione_duplicati(self, client, user, piano_con_assets, task):
        """Seconda chiamata con ticket attivo deve restituire 409."""
        _login(client)
        resp1 = client.post(_url(piano_con_assets.id, task.id))
        assert resp1.status_code == 200
        resp2 = client.post(_url(piano_con_assets.id, task.id))
        assert resp2.status_code == 409
        assert "già un ticket attivo" in resp2.json()["detail"]

    def test_task_paused_bloccato(self, client, user, piano_con_assets, task_paused):
        """Task in stato paused deve restituire 422."""
        _login(client)
        resp = client.post(_url(piano_con_assets.id, task_paused.id))
        assert resp.status_code == 422
        assert "non è attivo" in resp.json()["detail"]

    def test_task_disabled_bloccato(self, client, user, piano_con_assets, task_disabled):
        """Task con generation_mode=disabled deve restituire 422."""
        _login(client)
        resp = client.post(_url(piano_con_assets.id, task_disabled.id))
        assert resp.status_code == 422
        assert "disabilitata" in resp.json()["detail"]

    def test_piano_inesistente_404(self, client, user, task):
        """Piano ID inesistente deve restituire 404."""
        _login(client)
        resp = client.post(_url(99999, task.id))
        assert resp.status_code == 404

    def test_task_inesistente_404(self, client, user, piano_con_assets):
        """Task ID inesistente deve restituire 404."""
        _login(client)
        resp = client.post(_url(piano_con_assets.id, 99999))
        assert resp.status_code == 404

    def test_piano_legacy_senza_many_to_many(self, client, user, db_session, piano_senza_assets, asset):
        """Piano con solo asset_id legacy (no M2M) — fallback deve funzionare via task.asset_id."""
        _login(client)
        # Crea un task per questo piano legacy
        task = AttivitaManutenzione(
            piano_id=piano_senza_assets.id,
            asset_id=asset.id,  # FK diretto sul task
            nome="Task legacy",
            descrizione="Test fallback asset",
            priorita="Media",
            frequenza_giorni=30,
            durata_ore=2.0,
            tenant_id=piano_senza_assets.tenant_id,
            task_stato="active",
            generation_mode="manual",
        )
        db_session.add(task)
        db_session.commit()
        db_session.refresh(task)

        resp = client.post(_url(piano_senza_assets.id, task.id))
        assert resp.status_code == 200, f"Fallback asset_id non funziona: {resp.text}"
        assert resp.json()["created"] == 1

    def test_piano_senza_asset_restituisce_422(self, client, user, db_session, tenant):
        """Piano senza nessun asset (né M2M né legacy) deve restituire 422."""
        _login(client)
        # Piano senza asset
        piano_vuoto = PianoManutenzione(
            nome_codificato="PM-NOASSET",
            progressivo=200,
            tenant_id=tenant.id,
            stato="attivo",
        )
        db_session.add(piano_vuoto)
        db_session.commit()
        db_session.refresh(piano_vuoto)

        task = AttivitaManutenzione(
            piano_id=piano_vuoto.id,
            asset_id=None,  # nessun asset diretto sul task
            nome="Task senza asset",
            descrizione="Nessun asset",
            priorita="Bassa",
            frequenza_giorni=30,
            durata_ore=1.0,
            tenant_id=tenant.id,
            task_stato="active",
            generation_mode="manual",
        )
        db_session.add(task)
        db_session.commit()
        db_session.refresh(task)

        resp = client.post(_url(piano_vuoto.id, task.id))
        assert resp.status_code == 422
        assert "Nessun asset" in resp.json()["detail"]

    def test_non_autenticato_restituisce_401(self, client, piano_con_assets, task):
        """Senza login deve restituire 401."""
        resp = client.post(_url(piano_con_assets.id, task.id))
        assert resp.status_code == 401

    def test_piano_legacy_fallback_via_piano_asset_id(self, client, user, db_session, tenant, asset):
        """Piano senza M2M ma con piano.asset_id — usa fallback su piano.asset_id."""
        _login(client)
        piano = PianoManutenzione(
            nome_codificato="PM-2026-PIANOASSET",
            progressivo=102,
            asset_id=asset.id,  # legacy FK sul piano
            tenant_id=tenant.id,
            stato="attivo",
        )
        db_session.add(piano)
        db_session.commit()
        db_session.refresh(piano)

        # Task SENZA asset_id diretto
        task = AttivitaManutenzione(
            piano_id=piano.id,
            asset_id=None,  # nessun asset sul task
            nome="Task senza asset diretto",
            descrizione="Fallback su piano.asset_id",
            priorita="Media",
            frequenza_giorni=60,
            durata_ore=2.0,
            tenant_id=tenant.id,
            task_stato="active",
            generation_mode="manual",
        )
        db_session.add(task)
        db_session.commit()
        db_session.refresh(task)

        resp = client.post(_url(piano.id, task.id))
        assert resp.status_code == 200, f"Fallback piano.asset_id non funziona: {resp.text}"
        assert resp.json()["created"] == 1
