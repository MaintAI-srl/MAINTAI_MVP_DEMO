"""
Test della configurazione moduli globale: decisioni esplicite vs whitelist.

Regressione 2026-07-26: una configurazione salvata era una whitelist, quindi ogni
modulo introdotto dopo un salvataggio restava spento per sempre e nessun
`default_enabled=True` poteva riaccenderlo. Sintomo: la pagina /xr non compariva
e l'interruttore del cliente "tornava indietro" dopo il salvataggio.

Eseguibili con: python -m pytest backend/tests/test_module_decisions.py -v
"""
from __future__ import annotations

import pytest

from backend.core.modules import (
    EMPTY_DECISIONS,
    MODULE_DEFINITIONS,
    ModuleDecisions,
    _apply_decisions,
    _decisions_from_raw,
    _raw_from_enabled,
    _set_global_decisions_cache,
    enabled_module_ids,
    invalidate_module_caches,
    is_module_enabled,
)


@pytest.fixture(autouse=True)
def _clean_module_caches():
    invalidate_module_caches()
    yield
    invalidate_module_caches()


# ── Lettura delle configurazioni salvate ──────────────────────────────────────

def test_new_format_derives_explicit_off_from_known():
    known = ["dashboard", "assets", "tickets"]
    decisions = _decisions_from_raw({"enabled": ["dashboard", "assets"], "known": known})

    assert decisions.on == frozenset({"dashboard", "assets"})
    assert decisions.off == frozenset({"tickets"}), "cio' che era noto e non attivo e' spento per scelta"


def test_module_absent_from_known_has_no_decision():
    """Il cuore del fix: un modulo introdotto dopo il salvataggio non ha decisione."""
    known = sorted(set(MODULE_DEFINITIONS) - {"xr_viewer"})
    decisions = _decisions_from_raw({"enabled": known, "known": known})

    assert "xr_viewer" not in decisions.on
    assert "xr_viewer" not in decisions.off, (
        "un modulo che non esisteva al salvataggio non deve risultare spento per scelta"
    )


def test_legacy_bare_list_is_read_without_implicit_off():
    decisions = _decisions_from_raw(["dashboard", "assets"])

    assert decisions.on == frozenset({"dashboard", "assets"})
    assert decisions.off == frozenset(), (
        "nel formato legacy non si distingue 'spento per scelta' da 'non esisteva': "
        "i moduli assenti ricadono sul default"
    )


def test_legacy_dict_without_known_is_read_without_implicit_off():
    decisions = _decisions_from_raw({"enabled": ["dashboard", "tickets"]})

    assert decisions.on == frozenset({"dashboard", "tickets"})
    assert decisions.off == frozenset()


def test_unknown_module_ids_are_discarded():
    decisions = _decisions_from_raw({"enabled": ["dashboard", "modulo-inesistente"], "known": ["dashboard"]})

    assert decisions.on == frozenset({"dashboard"})
    assert "modulo-inesistente" not in decisions.on


def test_module_ids_are_normalized():
    decisions = _decisions_from_raw({"enabled": [" Dashboard ", "spare-parts"]})

    assert "dashboard" in decisions.on
    assert "spare_parts" in decisions.on


@pytest.mark.parametrize("raw", [None, 42, "stringa", {"altro": []}, {"enabled": "non-una-lista"}])
def test_payload_malformato_non_produce_decisioni(raw):
    assert _decisions_from_raw(raw) == EMPTY_DECISIONS


def test_roundtrip_serializza_i_moduli_noti():
    raw = _raw_from_enabled({"dashboard", "assets"})

    assert raw["enabled"] == ["assets", "dashboard"]
    assert set(raw["known"]) == set(MODULE_DEFINITIONS), "il salvataggio registra i moduli noti"

    decisions = _decisions_from_raw(raw)
    assert decisions.on == frozenset({"dashboard", "assets"})
    assert "tickets" in decisions.off


# ── Applicazione delle decisioni ──────────────────────────────────────────────

def test_apply_decisions_accende_e_spegne():
    base = {"dashboard", "tickets"}
    decisions = ModuleDecisions(on=frozenset({"assets"}), off=frozenset({"tickets"}))

    assert _apply_decisions(base, decisions) == {"dashboard", "assets"}


def test_apply_decisions_lascia_intatto_cio_su_cui_non_decide():
    base = {"dashboard", "xr_viewer"}

    assert _apply_decisions(base, EMPTY_DECISIONS) == base


# ── Effetto end-to-end sulla configurazione globale ───────────────────────────

def test_default_di_un_modulo_nuovo_sopravvive_a_una_config_salvata_prima():
    """Il caso reale: config globale salvata prima che xr_viewer esistesse."""
    known_allora = sorted(set(MODULE_DEFINITIONS) - {"xr_viewer"})
    _set_global_decisions_cache(
        _decisions_from_raw({"enabled": known_allora, "known": known_allora})
    )

    assert is_module_enabled("xr_viewer"), (
        "un modulo default_enabled=True introdotto dopo l'ultimo salvataggio deve risultare "
        "attivo: con la whitelist restava spento per sempre e invisibile in UI"
    )


def test_spegnimento_esplicito_globale_e_rispettato():
    raw = _raw_from_enabled(set(MODULE_DEFINITIONS) - {"xr_viewer"})
    _set_global_decisions_cache(_decisions_from_raw(raw))

    assert not is_module_enabled("xr_viewer"), "una scelta esplicita di spegnimento deve valere"
    assert is_module_enabled("dashboard")


def test_dipendenze_risolte_sulla_config_globale():
    # "manuals" richiede "maintenance_plans": spegnendo il prerequisito cade anche il dipendente
    raw = _raw_from_enabled(set(MODULE_DEFINITIONS) - {"maintenance_plans"})
    _set_global_decisions_cache(_decisions_from_raw(raw))

    enabled = enabled_module_ids()
    assert "maintenance_plans" not in enabled
    assert "manuals" not in enabled, "un modulo senza le sue dipendenze non resta attivo"
