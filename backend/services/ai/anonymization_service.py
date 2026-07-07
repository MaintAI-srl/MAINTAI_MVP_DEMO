import re
import logging
from typing import Dict, List, Any

logger = logging.getLogger(__name__)

class AnonymizationService:
    """
    Servizio UNIFICATO per la pseudonimizzazione dei dati sensibili (GDPR).
    Maschera PII (Personally Identifiable Information) e dati sensibili industriali
    prima dell'invio a servizi AI esterni o salvataggio in aree a visibilità condivisa.
    """
    
    def __init__(self):
        self.patterns = {
            "EMAIL": r"[a-zA-Z0-9_.+-]+@[a-zA-Z0-9-]+\.[a-zA-Z0-9-.]+",
            "PHONE": r"(\+\d{1,3}\s?)?(\d{3}\s?\d{3}\s?\d{4})|(\d{7,15})",
            "COORDINATES": r"(-?\d{1,3}\.\d{4,})",
        }
        self.REDACTED = "[REDACTED]"
        self.SENSITIVE = "[SENSITIVE_DATA]"

    def mask_text(self, text: str, sensitive_words: List[str] = None) -> str:
        """
        Applica il masking al testo fornito tramite regex e blacklist di parole.
        """
        if not text or not isinstance(text, str):
            return text
            
        anonymized = text
        
        # 1. Masking basato su pattern (Email, Phone, Coordinates)
        for label, pattern in self.patterns.items():
            mask = "[COORD]" if label == "COORDINATES" else f"[{label}]"
            anonymized = re.sub(pattern, mask, anonymized)
            
        # 2. Masking basato su parole sensibili (es. Nomi tecnici, Clienti)
        if sensitive_words:
            for word in sensitive_words:
                if word and len(str(word)) > 2:
                    reg = re.compile(re.escape(str(word)), re.IGNORECASE)
                    anonymized = reg.sub(self.SENSITIVE, anonymized)
                    
        return anonymized

    def anonymize_data(self, data: Any, sensitive_words: List[str] = None) -> Any:
        """
        Applica l'anonymization in modo ricorsivo a dizionari, liste o valori singoli.
        Rileva campi sensibili per nome chiave (es. 'nome', 'latitude').
        """
        if isinstance(data, str):
            return self.mask_text(data, sensitive_words)
        
        elif isinstance(data, dict):
            new_data = {}
            for k, v in data.items():
                k_lower = k.lower()
                # 1. Maschera chiavi geografiche note
                if any(x in k_lower for x in ["latitude", "longitude", "gps", "coordinate", "lat", "lon"]):
                    new_data[k] = "[MASKED_POS]"
                # 2. Maschera chiavi nominali note se sono stringhe
                elif any(x in k_lower for x in ["nome", "tecnico", "cognome", "username", "email"]):
                    new_data[k] = self.anonymize_data(v, sensitive_words)
                # 3. Ricorsione generica
                else:
                    new_data[k] = self.anonymize_data(v, sensitive_words)
            return new_data
            
        elif isinstance(data, list):
            return [self.anonymize_data(item, sensitive_words) for item in data]
            
        return data

    def anonymize_ticket_data(self, ticket: Dict[str, Any], technicians: List[str] = None) -> Dict[str, Any]:
        """
        Legacy wrapper per compatibilità con i controller esistenti.
        """
        # Campi specifici da proteggere nel dict del ticket
        fields_to_mask = ["titolo", "descrizione", "note_tecnico"]
        protected_ticket = ticket.copy()
        
        for field in fields_to_mask:
            if field in protected_ticket and protected_ticket[field]:
                protected_ticket[field] = self.mask_text(protected_ticket[field], technicians)
                
        # Hash dell'asset_id per non inviare l'asset ID reale se non richiesto
        if "asset_id" in protected_ticket and protected_ticket["asset_id"]:
            protected_ticket["asset_id"] = "ID_HASH_" + str(hash(str(protected_ticket["asset_id"])))[:8]
            
        return protected_ticket

# Singleton instance per l'intero backend
anonymizer = AnonymizationService()
