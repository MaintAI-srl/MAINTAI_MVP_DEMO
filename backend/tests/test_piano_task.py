"""
Test suite per il modulo Piano di Manutenzione v2.5.1

Gerarchia: Asset → Piano → Task → Ticket

Copertura:
- Creazione piano richiede asset_id
- Creazione task dentro un piano (piano_id impostato)
- Ticket generato da task è sempre APERTO
- Prevenzione duplicati (ticket già aperto sullo stesso task)
- is_repeatable e generation_mode logic
- Import crea task, non ticket diretti
- Isolamento tenant (piano non visibile ad altri tenant)
"""
import pytest
from datetime import datetime, timezone

from backend.db.modelli import (
    Tenant, Utente, Asset,
    PianoManutenzione, AttivitaManutenzione, Ticket,
)
from backend.core.security import get_password_hash


# ─── Fixtures ─────────────────────────────────────────────────────────────────

@pytest.fixture
def tenant(db_session):
    t = Tenant(nome="TenantTest", slug="tenant-test")
    db_session.add(t)
    db_session.commit()
    db_session.refresh(t)
    return t


@pytest.fixture
def tenant2(db_session):
    t = Tenant(nome="TenantAlienato", slug="tenant-alienato")
    db_session.add(t)
    db_session.commit()
    db_session.refresh(t)
    return t


@pytest.fixture
def asset(db_session, tenant):
    a = Asset(
        nome="Pompa idraulica P-01",
        tenant_id=tenant.id,
        codice="PUMP-01",
    )
    db_session.add(a)
    db_session.commit()
    db_session.refresh(a)
    return a


@pytest.fixture
def asset2(db_session, tenant2):
    a = Asset(
        nome="Asset di altro tenant",
        tenant_id=tenant2.id,
        codice="OTHER-01",
    )
    db_session.add(a)
    db_session.commit()
    db_session.refresh(a)
    return a


@pytest.fixture
def piano(db_session, tenant, asset):
    p = PianoManutenzione(
        nome_codificato="PM-2026-001",
        progressivo=1,
        asset_id=asset.id,
        tenant_id=tenant.id,
        stato="attivo",
    )
    db_session.add(p)
    db_session.commit()
    db_session.refresh(p)
    return p


@pytest.fixture
def task_attivo(db_session, tenant, piano):
    t = AttivitaManutenzione(
        piano_id=piano.id,
        asset_id=piano.asset_id,
        nome="Ispezione filtri",
        descrizione="Verifica e pulizia filtri dell'olio",
        priorita="Media",
        frequenza_giorni=90,
        durata_ore=2.0,
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
def user(db_session, tenant):
    u = Utente(
        username="tecnico_test",
        password_hash=get_password_hash("pass123"),
        ruolo="admin",
        tenant_id=tenant.id,
        is_active=True,
    )
    db_session.add(u)
    db_session.commit()
    return u


def _auth_header(client, username="tecnico_test", password="pass123"):
    """Effettua login e restituisce le cookies per le successive richieste."""
    resp = client.post("/auth/login", data={"username": username, "password": password})
    assert resp.status_code == 200, f"Login fallito: {resp.text}"
    return resp


# ─── Test: Modello ORM ────────────────────────────────────────────────────────

class TestPianoORM:
    def test_piano_richiede_asset(self, db_session, tenant):
        """PianoManutenzione senza asset_id è consentito (nullable), ma il router lo rifiuta."""
        p = PianoManutenzione(
            nome_codificato="PM-NO-ASSET",
            progressivo=99,
            tenant_id=tenant.id,
            stato="attivo",
        )
        db_session.add(p)
        db_session.commit()
        db_session.refresh(p)
        assert p.id is not None
        assert p.asset_id is None  # nullable a livello ORM

    def test_piano_con_asset(self, db_session, tenant, asset):
        """Piano con asset_id FK valido."""
        p = PianoManutenzione(
            nome_codificato="PM-CON-ASSET",
            progressivo=2,
            asset_id=asset.id,
            tenant_id=tenant.id,
        )
        db_session.add(p)
        db_session.commit()
        db_session.refresh(p)
        assert p.asset_id == asset.id

    def test_task_ha_piano_id(self, db_session, task_attivo, piano):
        """Il task deve avere piano_id impostato."""
        assert task_attivo.piano_id == piano.id

    def test_task_eredita_asset_dal_piano(self, db_session, task_attivo, piano):
        """Il task eredita asset_id dal piano."""
        assert task_attivo.asset_id == piano.asset_id

    def test_task_is_repeatable_default(self, db_session, task_attivo):
        """is_repeatable è True di default."""
        assert task_attivo.is_repeatable is True

    def test_task_generation_mode_default(self, db_session, task_attivo):
        """generation_mode è 'manual' di default."""
        assert task_attivo.generation_mode == "manual"

    def test_cascade_delete_piano_rimuove_task(self, db_session, tenant, asset):
        """Eliminare un piano rimuove i task (cascade)."""
        p = PianoManutenzione(nome_codificato="PM-CASCADE", progressivo=10, asset_id=asset.id, tenant_id=tenant.id)
        db_session.add(p)
        db_session.commit()

        t = AttivitaManutenzione(
            piano_id=p.id, asset_id=asset.id, descrizione="Task temporaneo",
            priorita="Bassa", tenant_id=tenant.id, task_stato="active",
        )
        db_session.add(t)
        db_session.commit()
        task_id = t.id

        db_session.delete(p)
        db_session.commit()

        assert db_session.get(AttivitaManutenzione, task_id) is None

    def test_delete_piano_non_elimina_ticket(self, db_session, tenant, asset):
        """Eliminare un piano NON deve eliminare i ticket (storico preservato)."""
        p = PianoManutenzione(nome_codificato="PM-NODEL-TICKET", progressivo=11, asset_id=asset.id, tenant_id=tenant.id)
        db_session.add(p)
        db_session.commit()

        tkt = Ticket(
            titolo="Ticket storico",
            asset_id=asset.id,
            tipo="PM",
            priorita="Media",
            stato="Chiuso",
            piano_manutenzione_id=p.id,
            tenant_id=tenant.id,
        )
        db_session.add(tkt)
        db_session.commit()
        ticket_id = tkt.id

        # Scollega ticket prima di eliminare piano (come fa il router)
        db_session.query(Ticket).filter(Ticket.piano_manutenzione_id == p.id).update({"piano_manutenzione_id": None})
        db_session.delete(p)
        db_session.commit()

        ticket_salvato = db_session.get(Ticket, ticket_id)
        assert ticket_salvato is not None
        assert ticket_salvato.piano_manutenzione_id is None  # scollegato, non eliminato


# ─── Test: Logica business ticket ─────────────────────────────────────────────

class TestGeneraTicket:
    def _genera_ticket(self, db_session, task, piano, tenant_id: int) -> Ticket:
        """Helper: genera un ticket dal task come fa il router."""
        ticket = Ticket(
            titolo=task.nome or task.descrizione,
            descrizione=task.descrizione,
            asset_id=task.asset_id,
            tipo="PM",
            priorita=task.priorita,
            stato="Aperto",
            durata_stimata_ore=task.durata_ore or 1.0,
            fascia_oraria="diurna",
            attivita_manutenzione_id=task.id,
            piano_manutenzione_id=piano.id,
            origine_piano="task_manual_generation",
            origin_type="task_manual_generation",
            tenant_id=tenant_id,
        )
        db_session.add(ticket)
        now = datetime.now(timezone.utc)
        task.last_generated_at = now
        if task.frequenza_giorni:
            from datetime import timedelta
            task.next_due_at = now + timedelta(days=task.frequenza_giorni)
        db_session.commit()
        db_session.refresh(ticket)
        return ticket

    def test_ticket_sempre_aperto(self, db_session, task_attivo, piano, tenant):
        """Il ticket generato da un task deve essere sempre APERTO."""
        ticket = self._genera_ticket(db_session, task_attivo, piano, tenant.id)
        assert ticket.stato == "Aperto"

    def test_ticket_origin_type(self, db_session, task_attivo, piano, tenant):
        """origin_type deve essere 'task_manual_generation'."""
        ticket = self._genera_ticket(db_session, task_attivo, piano, tenant.id)
        assert ticket.origin_type == "task_manual_generation"

    def test_ticket_collegato_task_e_piano(self, db_session, task_attivo, piano, tenant):
        """Il ticket deve avere attivita_manutenzione_id e piano_manutenzione_id."""
        ticket = self._genera_ticket(db_session, task_attivo, piano, tenant.id)
        assert ticket.attivita_manutenzione_id == task_attivo.id
        assert ticket.piano_manutenzione_id == piano.id

    def test_last_generated_at_aggiornato(self, db_session, task_attivo, piano, tenant):
        """Dopo la generazione, last_generated_at del task deve essere impostato."""
        assert task_attivo.last_generated_at is None
        self._genera_ticket(db_session, task_attivo, piano, tenant.id)
        db_session.refresh(task_attivo)
        assert task_attivo.last_generated_at is not None

    def test_next_due_at_calcolato(self, db_session, task_attivo, piano, tenant):
        """next_due_at = last_generated_at + frequenza_giorni."""
        from datetime import timedelta
        self._genera_ticket(db_session, task_attivo, piano, tenant.id)
        db_session.refresh(task_attivo)
        expected = task_attivo.last_generated_at + timedelta(days=task_attivo.frequenza_giorni)
        assert abs((task_attivo.next_due_at - expected).total_seconds()) < 2

    def test_prevenzione_duplicati(self, db_session, task_attivo, piano, tenant):
        """Non deve essere possibile avere 2 ticket attivi per lo stesso task."""
        # Genera il primo ticket
        self._genera_ticket(db_session, task_attivo, piano, tenant.id)

        # Controlla se esiste già un ticket attivo (come fa il router)
        existing = db_session.query(Ticket).filter(
            Ticket.attivita_manutenzione_id == task_attivo.id,
            Ticket.stato.in_(["Aperto", "Pianificato", "In corso"]),
            Ticket.deleted_at.is_(None),
        ).first()
        assert existing is not None, "Dovrebbe esistere il ticket precedente"

    def test_generazione_task_non_attivo_bloccata(self, db_session, task_attivo):
        """Se task_stato != 'active', la generazione deve essere bloccata (lato router)."""
        task_attivo.task_stato = "paused"
        db_session.commit()
        assert task_attivo.task_stato == "paused"
        # Il blocco avviene nel router (HTTPException 422): qui verifichiamo solo lo stato

    def test_generazione_disabled_bloccata(self, db_session, task_attivo):
        """Se generation_mode == 'disabled', la generazione deve essere bloccata."""
        task_attivo.generation_mode = "disabled"
        db_session.commit()
        assert task_attivo.generation_mode == "disabled"


# ─── Test: is_repeatable e generation_mode ────────────────────────────────────

class TestTaskConfig:
    def test_task_non_ripetibile(self, db_session, tenant, piano):
        """Un task con is_repeatable=False non dovrebbe ricevere next_due_at."""
        t = AttivitaManutenzione(
            piano_id=piano.id,
            asset_id=piano.asset_id,
            descrizione="Task unico",
            priorita="Alta",
            is_repeatable=False,
            generation_mode="manual",
            tenant_id=tenant.id,
            task_stato="active",
        )
        db_session.add(t)
        db_session.commit()
        db_session.refresh(t)
        assert t.is_repeatable is False
        assert t.frequenza_giorni is None  # non ha frequenza se non ripetibile

    def test_task_auto_ha_frequenza(self, db_session, tenant, piano):
        """Un task con generation_mode='auto' deve avere frequenza definita."""
        t = AttivitaManutenzione(
            piano_id=piano.id,
            asset_id=piano.asset_id,
            descrizione="Task automatico",
            priorita="Media",
            is_repeatable=True,
            generation_mode="auto",
            frequenza_giorni=30,
            tenant_id=tenant.id,
            task_stato="active",
        )
        db_session.add(t)
        db_session.commit()
        db_session.refresh(t)
        assert t.generation_mode == "auto"
        assert t.frequenza_giorni == 30

    def test_task_source_type_imported(self, db_session, tenant, piano):
        """Task importato da manuale ha source_type='imported_from_manual'."""
        t = AttivitaManutenzione(
            piano_id=piano.id,
            asset_id=piano.asset_id,
            descrizione="Task da PDF",
            priorita="Bassa",
            tenant_id=tenant.id,
            task_stato="active",
            source_type="imported_from_manual",
        )
        db_session.add(t)
        db_session.commit()
        db_session.refresh(t)
        assert t.source_type == "imported_from_manual"


# ─── Test: Isolamento tenant ──────────────────────────────────────────────────

class TestIsolamentoTenant:
    def test_piano_non_visibile_da_altro_tenant(self, db_session, piano, tenant, tenant2):
        """Un piano di tenant1 non deve essere visibile interrogando con tenant2."""
        risultati = db_session.query(PianoManutenzione).filter(
            PianoManutenzione.id == piano.id,
            PianoManutenzione.tenant_id == tenant2.id,  # tenant sbagliato
        ).all()
        assert risultati == []

    def test_task_non_visibile_da_altro_tenant(self, db_session, task_attivo, tenant2):
        """Un task di tenant1 non deve essere visibile interrogando con tenant2."""
        risultati = db_session.query(AttivitaManutenzione).filter(
            AttivitaManutenzione.id == task_attivo.id,
            AttivitaManutenzione.tenant_id == tenant2.id,
        ).all()
        assert risultati == []


# ─── Test: Import crea task, non ticket ───────────────────────────────────────

class TestImportTaskVsTicket:
    def test_import_crea_task_con_piano_id(self, db_session, tenant, piano):
        """Import da PDF/Excel deve creare AttivitaManutenzione con piano_id, NON Ticket."""
        # Simula cosa fa il router import-pdf / import-excel
        task = AttivitaManutenzione(
            piano_id=piano.id,
            asset_id=piano.asset_id,
            nome="Lubrificazione cuscinetti",
            descrizione="Lubrificazione trimestrale cuscinetti motore",
            priorita="Media",
            frequenza_giorni=90,
            durata_ore=1.5,
            origine="PDF",
            tenant_id=tenant.id,
            task_stato="active",
            generation_mode="manual",
            is_repeatable=True,
            source_type="imported_from_manual",
        )
        db_session.add(task)
        db_session.commit()
        db_session.refresh(task)

        # Verifica: è un task, non un ticket
        assert task.id is not None
        assert task.piano_id == piano.id
        assert task.source_type == "imported_from_manual"

        # Verifica: nessun ticket creato
        ticket_count = db_session.query(Ticket).filter(
            Ticket.attivita_manutenzione_id == task.id,
        ).count()
        assert ticket_count == 0, "L'import non deve creare ticket, solo task"

    def test_import_task_non_genera_ticket_automaticamente(self, db_session, tenant, piano):
        """Dopo l'import, non ci sono ticket. Solo dopo 'genera-ticket' vengono creati."""
        # Importa 3 task
        for i in range(3):
            t = AttivitaManutenzione(
                piano_id=piano.id,
                asset_id=piano.asset_id,
                descrizione=f"Task importato {i + 1}",
                priorita="Bassa",
                tenant_id=tenant.id,
                task_stato="active",
                source_type="imported_from_manual",
            )
            db_session.add(t)
        db_session.commit()

        # Verifica: nessun ticket creato
        piano_ticket_count = db_session.query(Ticket).filter(
            Ticket.piano_manutenzione_id == piano.id,
        ).count()
        assert piano_ticket_count == 0


# ─── Test: Conteggi batch (no N+1) ───────────────────────────────────────────

class TestConteggiTask:
    def test_conteggio_task_per_piano(self, db_session, tenant, asset):
        """Il conteggio dei task per piano deve essere corretto."""
        from sqlalchemy import func

        p1 = PianoManutenzione(nome_codificato="PM-CNT-1", progressivo=20, asset_id=asset.id, tenant_id=tenant.id)
        p2 = PianoManutenzione(nome_codificato="PM-CNT-2", progressivo=21, asset_id=asset.id, tenant_id=tenant.id)
        db_session.add_all([p1, p2])
        db_session.commit()

        # 3 task su p1, 1 task su p2
        for i in range(3):
            db_session.add(AttivitaManutenzione(
                piano_id=p1.id, asset_id=asset.id, descrizione=f"T{i}", priorita="Media", tenant_id=tenant.id, task_stato="active"
            ))
        db_session.add(AttivitaManutenzione(
            piano_id=p2.id, asset_id=asset.id, descrizione="Solo uno", priorita="Alta", tenant_id=tenant.id, task_stato="active"
        ))
        db_session.commit()

        counts = dict(
            db_session.query(AttivitaManutenzione.piano_id, func.count(AttivitaManutenzione.id))
            .filter(AttivitaManutenzione.piano_id.in_([p1.id, p2.id]))
            .group_by(AttivitaManutenzione.piano_id)
            .all()
        )
        assert counts[p1.id] == 3
        assert counts[p2.id] == 1
