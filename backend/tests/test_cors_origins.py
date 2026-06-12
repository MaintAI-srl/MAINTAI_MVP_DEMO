"""
Test fail-closed di _load_origins() (configurazione CORS).

In produzione gli origin locali/privati in CORS_ORIGINS devono BLOCCARE lo
startup (non solo loggare un warning); il wildcard '*' è sempre vietato perché
il middleware usa allow_credentials=True.
"""
from __future__ import annotations

import pytest

import backend.main as main_module
from backend.main import _load_origins, _PROD_ORIGINS, _DEV_ORIGINS


@pytest.fixture
def production(monkeypatch):
    monkeypatch.setattr(main_module, "IS_PRODUCTION", True)


@pytest.fixture
def development(monkeypatch):
    monkeypatch.setattr(main_module, "IS_PRODUCTION", False)


def test_production_rejects_localhost(production, monkeypatch):
    monkeypatch.setenv("CORS_ORIGINS", "https://app.cliente.it,http://localhost:3000")
    with pytest.raises(RuntimeError, match="locali/privati"):
        _load_origins()


@pytest.mark.parametrize("bad", [
    "http://127.0.0.1:3000",
    "http://192.168.1.50:3000",
    "http://10.0.0.5",
    "http://172.16.0.1",
])
def test_production_rejects_private_ips(production, monkeypatch, bad):
    monkeypatch.setenv("CORS_ORIGINS", bad)
    with pytest.raises(RuntimeError, match="locali/privati"):
        _load_origins()


@pytest.mark.parametrize("env_fixture", ["production", "development"])
def test_wildcard_always_rejected(env_fixture, request, monkeypatch):
    request.getfixturevalue(env_fixture)
    monkeypatch.setenv("CORS_ORIGINS", "*")
    with pytest.raises(RuntimeError, match="wildcard"):
        _load_origins()


def test_production_accepts_public_origin(production, monkeypatch):
    monkeypatch.setenv("CORS_ORIGINS", "https://app.cliente.it")
    origins = _load_origins()
    assert "https://app.cliente.it" in origins
    for o in _PROD_ORIGINS:
        assert o in origins
    for o in _DEV_ORIGINS:
        assert o not in origins


def test_production_allows_known_tauri_origins(production, monkeypatch):
    # Gli origin Tauri contengono "localhost" ma sono nell'allowlist di produzione.
    monkeypatch.setenv("CORS_ORIGINS", "http://tauri.localhost")
    origins = _load_origins()
    assert "http://tauri.localhost" in origins


def test_development_allows_localhost(development, monkeypatch):
    monkeypatch.setenv("CORS_ORIGINS", "http://localhost:5173")
    origins = _load_origins()
    assert "http://localhost:5173" in origins
    for o in _DEV_ORIGINS:
        assert o in origins
