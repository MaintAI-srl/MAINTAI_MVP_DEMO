import re
from typing import Any, Dict, List, Union

class PrivacyRedactor:
    """
    Utility per la protezione dei dati (GDPR) prima dell'invio a LLM.
    Maschera PII (Personally Identifiable Information) e dati sensibili industriali.
    """
    
    EMAIL_RE = re.compile(r'[\w\.-]+@[\w\.-]+\.\w+')
    # Maschera telefoni con almeno 7 cifre per non confonderli con ID brevi
    PHONE_RE = re.compile(r'(\+\d{1,3}\s?)?(\d{3}\s?\d{3}\s?\d{4})|(\d{7,15})')
    # Maschera coordinate GPS (formato decimale)
    COORDINATES_RE = re.compile(r'(-?\d{1,3}\.\d{4,})')

    REDACTED = "[REDACTED]"
    SENSITIVE = "[SENSITIVE_DATA]"

    @classmethod
    def redact_text(cls, text: str, sensitive_words: List[str] = None) -> str:
        """
        Applica il masking al testo, incluse email, telefoni e parole specifiche (es. nomi).
        """
        if not isinstance(text, str):
            return text
        
        # 1. Redact Emails
        text = cls.EMAIL_RE.sub(cls.REDACTED, text)
        
        # 2. Redact Phone numbers
        text = cls.PHONE_RE.sub(cls.REDACTED, text)
            
        # 3. Redact Coordinates
        text = cls.COORDINATES_RE.sub("[COORD]", text)

        # 4. Redact Specific sensitive words (Technician names, plant names, etc.)
        if sensitive_words:
            for word in sensitive_words:
                if len(word) > 2: # Evita di mascherare particelle corte
                    reg = re.compile(re.escape(word), re.IGNORECASE)
                    text = reg.sub(cls.SENSITIVE, text)
                    
        return text

    @classmethod
    def redact_data(cls, data: Any, sensitive_words: List[str] = None) -> Any:
        """
        Redact ricorsivo da dizionari, liste o stringhe.
        """
        if isinstance(data, str):
            return cls.redact_text(data, sensitive_words)
        elif isinstance(data, dict):
            # Non inviamo mai lat/lon precisi come chiavi numeriche
            new_data = {}
            for k, v in data.items():
                if k in ["latitude", "longitude", "gps", "coordinate", "lat", "lon"]:
                    new_data[k] = "[MASKED_POS]"
                elif k in ["nome", "tecnico", "cognome"] and isinstance(v, str):
                    new_data[k] = cls.redact_text(v, sensitive_words)
                else:
                    new_data[k] = cls.redact_data(v, sensitive_words)
            return new_data
        elif isinstance(data, list):
            return [cls.redact_data(item, sensitive_words) for item in data]
        return data

privacy_redactor = PrivacyRedactor()
