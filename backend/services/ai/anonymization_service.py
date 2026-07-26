import re
import logging
from typing import List, Any

logger = logging.getLogger(__name__)


# ── Pattern PII ───────────────────────────────────────────────────────────────
# I pattern sono volutamente *conservativi*: devono colpire i contatti personali senza
# mai toccare i dati tecnici (codici ricambio, matricole, misure, pressioni, tolleranze).
# Una regex troppo avida qui degrada direttamente la qualità dell'AI, perché cancella
# proprio le informazioni per cui il prompt viene inviato.

_EMAIL = r"[a-zA-Z0-9_.+-]+@[a-zA-Z0-9-]+\.[a-zA-Z0-9-.]+"

# Telefoni: servono un prefisso internazionale, un prefisso nazionale con separatore,
# oppure una parola chiave esplicita. NON esiste più l'alternativa "qualunque sequenza
# di 7-15 cifre": divorava ogni codice ricambio dei manuali PDF.
# I separatori fra etichetta e valore usano **una sola classe di caratteri a ripetizione
# limitata** (`[.\s:]{0,4}`) invece di sequenze tipo `\.?\s*:?\s*`: due quantificatori
# ambigui sulla stessa stringa di spazi producono backtracking polinomiale, ed è input
# non fidato (descrizioni ticket, testo dei manuali). Vedi CodeQL py/polynomial-redos.
_PHONE = (
    r"(?:\+\d{1,3}[\s./-]?(?:\d[\s./-]?){6,13}\d)"          # +39 333 1234567
    r"|(?:\b0\d{1,3}[\s./-]\d{5,8}\b)"                      # 02 1234567 (fisso italiano)
    r"|(?:\b3\d{2}[\s./-]\d{6,7}\b)"                        # 333 1234567 (mobile italiano)
    r"|(?:(?:tel|telefono|cell|cellulare|fax|phone|mobile)[.\s:]{0,4}\+?\d[\d\s./-]{5,20})"
)

# Coordinate: solo se introdotte da un'etichetta geografica esplicita. In testo libero
# "0.0254 mm" o "1.2345 bar" sono misure, non posizioni.
_COORDINATES = (
    r"(?:(?:lat|latitudine|latitude|lon|lng|long|longitudine|longitude|gps|coord\w*)"
    r"[\s:=]{0,4})(-?\d{1,3}\.\d{4,})"
)


class AnonymizationService:
    """
    Servizio di redazione PII (GDPR) per testo libero e strutture dati.

    Copre i contatti personali (email, telefoni) e le posizioni geografiche. È usato:
    * dai job in background per non scrivere PII nei log (``email_poller``);
    * come passata finale di sicurezza dai servizi AI, **dopo** la pseudonimizzazione
      reversibile di ``backend/services/ai/pseudonymizer.py``.

    Per i dati identificativi di dominio (asset, tecnici, siti, impianti, azienda) si usa
    il ``Pseudonymizer``, non questa classe: qui la sostituzione è distruttiva e farebbe
    perdere al modello la coerenza referenziale.
    """

    def __init__(self):
        self.patterns = {
            "EMAIL": _EMAIL,
            "PHONE": _PHONE,
        }
        # Le coordinate sono trattate a parte: la sostituzione conserva solo l'etichetta.
        self.coordinate_pattern = re.compile(_COORDINATES, re.IGNORECASE)
        self.REDACTED = "[REDACTED]"
        self.SENSITIVE = "[SENSITIVE_DATA]"

    def mask_text(self, text: str, sensitive_words: List[str] = None) -> str:
        """
        Applica il masking al testo fornito tramite regex e blacklist di parole.

        ``sensitive_words`` è una redazione *distruttiva*: da usare solo dove non serve
        ripristinare il valore. Per i dati di dominio preferire il ``Pseudonymizer``.
        """
        if not text or not isinstance(text, str):
            return text

        anonymized = text

        # 1. Masking basato su pattern (Email, Phone)
        for label, pattern in self.patterns.items():
            anonymized = re.sub(pattern, f"[{label}]", anonymized, flags=re.IGNORECASE)

        # 2. Coordinate: mantiene l'etichetta, maschera solo il valore numerico
        anonymized = self.coordinate_pattern.sub(
            lambda m: m.group(0).replace(m.group(1), "[COORD]"), anonymized
        )

        # 3. Masking basato su parole sensibili (es. Nomi tecnici, Clienti)
        if sensitive_words:
            for word in sensitive_words:
                if word and len(str(word)) > 2:
                    reg = re.compile(re.escape(str(word)), re.IGNORECASE)
                    anonymized = reg.sub(self.SENSITIVE, anonymized)

        return anonymized

    def anonymize_data(self, data: Any, sensitive_words: List[str] = None) -> Any:
        """
        Applica l'anonymization in modo ricorsivo a dizionari, liste o valori singoli.
        Le chiavi geografiche note vengono oscurate per intero.
        """
        if isinstance(data, str):
            return self.mask_text(data, sensitive_words)

        elif isinstance(data, dict):
            new_data = {}
            for k, v in data.items():
                k_lower = str(k).lower()
                if any(x in k_lower for x in ["latitude", "longitude", "gps", "coordinate", "lat", "lon"]):
                    new_data[k] = "[MASKED_POS]"
                else:
                    new_data[k] = self.anonymize_data(v, sensitive_words)
            return new_data

        elif isinstance(data, list):
            return [self.anonymize_data(item, sensitive_words) for item in data]

        return data


# Singleton instance per l'intero backend
anonymizer = AnonymizationService()
