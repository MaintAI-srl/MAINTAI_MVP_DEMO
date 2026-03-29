import sys
import os

# Aggiunge la root del progetto al path
sys.path.append(os.getcwd())

from backend.core.privacy import privacy_redactor

def test_privacy():
    print("--- TEST PRIVACY REDACTOR ---")
    
    # Test 1: Testo generico con PII
    text = "Contatta Mario Rossi al numero +39 333 1234567 o via mail mario.rossi@tech.it. Coordinate: 44.3072, 8.4811"
    sensitive = ["Mario Rossi"]
    redacted = privacy_redactor.redact_text(text, sensitive)
    
    print(f"Originale: {text}")
    print(f"Redacted:  {redacted}")
    
    assert "[SENSITIVE_DATA]" in redacted
    assert "[REDACTED]" in redacted
    assert "[COORD]" in redacted
    print("Test 1 Superato!")

    # Test 2: Dizionario complesso
    data = {
        "id": 101,
        "tecnico": "Alessandro Bianchi",
        "dettagli": {
            "cellulare": "+39 010 203040",
            "lat": 44.1,
            "lon": 8.5
        }
    }
    redacted_data = privacy_redactor.redact_data(data, ["Alessandro Bianchi"])
    print(f"\nOriginale dict: {data}")
    print(f"Redacted dict:  {redacted_data}")
    
    assert redacted_data["tecnico"] == "[SENSITIVE_DATA]"
    assert redacted_data["dettagli"]["lat"] == "[MASKED_POS]"
    print("Test 2 Superato!")

if __name__ == "__main__":
    test_privacy()
