import pytest
from backend.core.privacy import privacy_redactor

def test_email_redaction():
    text = "Invia una mail a mario.rossi@esempio.com per il guasto."
    redacted = privacy_redactor.redact_text(text)
    assert "mario.rossi@esempio.com" not in redacted
    assert "[REDACTED]" in redacted

def test_phone_redaction():
    text = "Il tecnico risponde al +39 333 1234567."
    redacted = privacy_redactor.redact_text(text)
    assert "+39 333 1234567" not in redacted
    assert "[REDACTED]" in redacted

def test_recursive_redaction():
    data = {
        "user": "Mario Rossi",
        "contacts": {
            "email": "mario@rossi.it",
            "notes": "Chiamare 02 1234567"
        },
        "tags": ["manutenzione", "urgent@high.com"]
    }
    redacted = privacy_redactor.redact_data(data)
    assert redacted["contacts"]["email"] == "[REDACTED]"
    assert "[REDACTED]" in redacted["contacts"]["notes"]
    assert redacted["tags"][1] == "[REDACTED]"
    assert redacted["tags"][0] == "manutenzione"
