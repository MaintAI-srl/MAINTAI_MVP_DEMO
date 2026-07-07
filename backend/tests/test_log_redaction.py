"""
Test della redaction centralizzata nei log persistenti (logger_db).

Chiavi sensibili (password, token, authorization, cookie, raw, prompt, ...)
non devono mai finire in chiaro in SystemLog.extra_info; i pattern di segreti
nelle stringhe libere (JWT, API key, URL con credenziali) vanno oscurati e gli
extra molto lunghi (es. risposte raw AI) troncati.
"""
from __future__ import annotations

import json

from backend.core.logger_db import (
    _redact, _redact_text, _serialize_extra, _normalize_args, _MAX_EXTRA_LEN, _REDACTED,
)


def test_sensitive_keys_redacted():
    extra = {
        "password": "SuperSegreta1!",
        "access_token": "abc123",
        "Authorization": "Bearer abcdefghijklmnopqrstuvwxyz",
        "cookie": "session=xyz",
        "raw": "risposta raw del modello",
        "prompt": "prompt completo inviato a OpenAI",
        "username": "mario",
    }
    redacted = _redact(extra)
    for key in ("password", "access_token", "Authorization", "cookie", "raw", "prompt"):
        assert redacted[key] == _REDACTED, key
    assert redacted["username"] == "mario"


def test_nested_structures_redacted():
    extra = {"request": {"headers": {"authorization": "Bearer xyz"}}, "items": [{"token": "t"}]}
    redacted = _redact(extra)
    assert redacted["request"]["headers"]["authorization"] == _REDACTED
    assert redacted["items"][0]["token"] == _REDACTED


def test_secret_patterns_in_text_redacted():
    text = (
        "chiamata con chiave sk-abcdefghijklmnop e header "
        "Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.abcdefghijklmnop su "
        "postgresql://user:Password1!@db.example.com:5432/db"
    )
    out = _redact_text(text)
    assert "sk-abcdefghijklmnop" not in out
    assert "Password1!" not in out
    assert "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9" not in out
    assert _REDACTED in out


def test_long_extra_truncated():
    extra = {"dettaglio": "x" * (_MAX_EXTRA_LEN * 2)}
    serialized = _serialize_extra(extra)
    assert len(serialized) <= _MAX_EXTRA_LEN + len("…[TRUNCATED]")
    assert serialized.endswith("…[TRUNCATED]")


def test_serialized_extra_has_no_password():
    serialized = _serialize_extra({"user": "mario", "password": "SuperSegreta1!"})
    data = json.loads(serialized)
    assert data["password"] == _REDACTED
    assert "SuperSegreta1!" not in serialized


def test_tenant_id_can_be_in_extra_for_legacy_calls():
    module, message, extra, tenant_id = _normalize_args(
        ("AUTH", "login ok", {"tenant_id": 7, "ip": "127.0.0.1"})
    )
    assert module == "AUTH"
    assert message == "login ok"
    assert extra["tenant_id"] == 7
    assert tenant_id == 7
