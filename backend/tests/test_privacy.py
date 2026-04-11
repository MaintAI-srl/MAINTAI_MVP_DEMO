import pytest
from backend.services.ai.anonymization_service import anonymizer

def test_email_redaction():
    text = "Invia una mail a mario.rossi@esempio.com per il guasto."
    redacted = anonymizer.mask_text(text)
    assert "mario.rossi@esempio.com" not in redacted
    assert "[EMAIL]" in redacted or "[REDACTED]" in redacted

def test_phone_redaction():
    text = "Il tecnico risponde al +39 333 1234567."
    redacted = anonymizer.mask_text(text)
    assert "+39 333 1234567" not in redacted
    assert "[PHONE]" in redacted or "[REDACTED]" in redacted

def test_recursive_redaction():
    data = {
        "user": "Mario Rossi",
        "contacts": {
            "email": "mario@rossi.it",
            "notes": "Chiamare 02 1234567"
        },
        "tags": ["manutenzione", "urgent@high.com"]
    }
    redacted = anonymizer.anonymize_data(data)
    # email field is detected by key name 'email'
    assert redacted["contacts"]["email"] == "[EMAIL]"
    assert "[PHONE]" in redacted["contacts"]["notes"]
    assert redacted["tags"][1] == "[EMAIL]"
    assert redacted["tags"][0] == "manutenzione"

def test_sensor_masking():
    data = {"latitude": "45.123456", "temp": 25}
    redacted = anonymizer.anonymize_data(data)
    assert redacted["latitude"] == "[MASKED_POS]"
    assert redacted["temp"] == 25
