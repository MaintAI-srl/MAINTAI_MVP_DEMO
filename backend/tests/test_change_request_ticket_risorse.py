"""Test change request 2026-07-05 — MOD-STR, ore uomo, email-to-ticket disattivato.

Copre i casi richiesti dal documento MAINTAI_CHANGE_REQUEST_TICKET_RISORSE_ASSENZE §11.
"""
import pytest
from pydantic import ValidationError
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from backend.core.database import Base
from backend.core.modules import MODULE_DEFINITIONS
from backend.db.modelli import Tenant, Asset
from backend.repositories.ticket_repository import ticket_repository
from backend.schemas.ticket import TicketCreate, TicketUpdate, TIPI_TICKET_VALIDI
from backend.services.man_hours import calculate_required_man_hours


def _make_ticket_payload(**overrides):
    payload = dict(
        titolo="Test", asset_id=1, priorita="Media", stato="Aperto",
        durata_stimata_ore=2.0, fascia_oraria="diurna",
    )
    payload.update(overrides)
    return payload


@pytest.fixture()
def db():
    engine = create_engine("sqlite:///:memory:")
    Base.metadata.create_all(engine)
    session = sessionmaker(bind=engine)()
    session.add(Tenant(id=1, nome="T", slug="t"))
    session.commit()
    session.add(Asset(id=1, nome="A", tenant_id=1))
    session.commit()
    yield session
    session.close()


# ── §11.2 Calcolo ore uomo ───────────────────────────────────────────────────

@pytest.mark.parametrize("durata,tecnici,atteso", [
    (2, 1, 2.0),
    (2, 2, 4.0),
    (4.5, 2, 9.0),
    (7.5, 2, 15.0),
    (None, 2, None),
    (2, None, None),
    (0, 2, None),
    (2, 0, None),
])
def test_calcolo_ore_uomo(durata, tecnici, atteso):
    assert calculate_required_man_hours(durata, tecnici) == atteso


# ── §11.1 Tipo ticket MOD-STR ────────────────────────────────────────────────

def test_mod_str_in_tipi_validi():
    assert "MOD-STR" in TIPI_TICKET_VALIDI


def test_mod_str_accettato_in_creazione():
    t = TicketCreate(**_make_ticket_payload(tipo="MOD-STR"))
    assert t.tipo == "MOD-STR"


def test_mod_str_accettato_in_modifica():
    u = TicketUpdate(tipo="mod-str")
    assert u.tipo == "MOD-STR"  # normalizzato upper


def test_tipo_non_valido_rifiutato():
    with pytest.raises(ValidationError):
        TicketCreate(**_make_ticket_payload(tipo="FANTASIA"))
    with pytest.raises(ValidationError):
        TicketUpdate(tipo="XX")


def test_mod_str_persistito_e_restituito(db):
    tk = ticket_repository.create(db, TicketCreate(**_make_ticket_payload(tipo="MOD-STR")), 1)
    assert tk.tipo == "MOD-STR"
    listed = ticket_repository.get_paginated(db, tenant_id=1)
    assert listed["items"][0]["tipo"] == "MOD-STR"


# ── §11.3 Modalità auto/manuale ──────────────────────────────────────────────

def test_create_auto_calcola_ore_uomo(db):
    tk = ticket_repository.create(db, TicketCreate(**_make_ticket_payload(
        durata_stimata_ore=4, tecnici_richiesti=2, man_hours_calculation_mode="auto",
    )), 1)
    assert tk.required_man_hours == 8.0


def test_update_auto_ricalcola(db):
    tk = ticket_repository.create(db, TicketCreate(**_make_ticket_payload(
        durata_stimata_ore=4, tecnici_richiesti=2, man_hours_calculation_mode="auto",
    )), 1)
    r = ticket_repository.update(db, tk.id, TicketUpdate(durata_stimata_ore=6), 1)
    assert r["required_man_hours"] == 12.0
    r = ticket_repository.update(db, tk.id, TicketUpdate(tecnici_richiesti=3), 1)
    assert r["required_man_hours"] == 18.0


def test_update_manuale_non_sovrascrive(db):
    tk = ticket_repository.create(db, TicketCreate(**_make_ticket_payload(
        durata_stimata_ore=4, tecnici_richiesti=2, man_hours_calculation_mode="manual",
        required_man_hours=5,
    )), 1)
    assert tk.required_man_hours == 5.0
    # cambio durata in modalità manuale: il valore resta quello dell'utente
    r = ticket_repository.update(db, tk.id, TicketUpdate(durata_stimata_ore=6), 1)
    assert r["required_man_hours"] == 5.0


def test_override_manuale_setta_modalita(db):
    tk = ticket_repository.create(db, TicketCreate(**_make_ticket_payload(
        durata_stimata_ore=4, tecnici_richiesti=2, man_hours_calculation_mode="auto",
    )), 1)
    r = ticket_repository.update(db, tk.id, TicketUpdate(required_man_hours=15), 1)
    assert r["required_man_hours"] == 15.0
    assert r["man_hours_calculation_mode"] == "manual"


def test_manual_to_auto_ricalcola(db):
    tk = ticket_repository.create(db, TicketCreate(**_make_ticket_payload(
        durata_stimata_ore=4, tecnici_richiesti=2, man_hours_calculation_mode="manual",
        required_man_hours=99,
    )), 1)
    r = ticket_repository.update(db, tk.id, TicketUpdate(man_hours_calculation_mode="auto"), 1)
    assert r["required_man_hours"] == 8.0


# ── §3.5 Validazioni limiti ──────────────────────────────────────────────────

def test_validazioni_limiti():
    with pytest.raises(ValidationError):
        TicketCreate(**_make_ticket_payload(tecnici_richiesti=0))
    with pytest.raises(ValidationError):
        TicketCreate(**_make_ticket_payload(tecnici_richiesti=100))
    with pytest.raises(ValidationError):
        TicketCreate(**_make_ticket_payload(durata_stimata_ore=1000))
    with pytest.raises(ValidationError):
        TicketCreate(**_make_ticket_payload(required_man_hours=10000))


# ── §11.4 Email to ticket disattivato ────────────────────────────────────────

def test_email_to_ticket_disattivato_di_default():
    assert MODULE_DEFINITIONS["email_to_ticket"].default_enabled is False
