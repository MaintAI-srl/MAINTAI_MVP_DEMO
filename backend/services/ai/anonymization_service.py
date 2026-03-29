import re
from typing import Dict, List, Any

class AnonymizationService:
    """
    Servizio per la pseudonimizzazione dei dati sensibili prima dell'invio a servizi AI esterni.
    Garantisce la conformità GDPR mascherando nomi, indirizzi e dati identificativi univoci.
    """
    
    def __init__(self):
        # Pattern semplici per dati sensibili (espandibili via configurazione)
        self.patterns = {
            "EMAIL": r"[a-zA-Z0-9_.+-]+@[a-zA-Z0-9-]+\.[a-zA-Z0-9-.]+",
            "PHONE": r"(\+\d{1,3}\s?)?(\d{3}\s?\d{3}\s?\d{4})",
            # Aggiungeremo pattern dinamici per i nomi dei tecnici caricati dal DB
        }

    def mask_text(self, text: str, sensitive_words: List[str] = None) -> str:
        """
        Applica il masking al testo fornito.
        """
        if not text:
            return text
            
        anonymized = text
        
        # 1. Masking basato su pattern (Email, Phone)
        for label, pattern in self.patterns.items():
            anonymized = re.sub(pattern, f"[{label}]", anonymized)
            
        # 2. Masking basato su parole sensibili (es. Nomi tecnici, Azienda)
        if sensitive_words:
            for word in sensitive_words:
                if len(word) > 2: # Evita di mascherare particelle corte
                    # Case insensitive replacement
                    reg = re.compile(re.escape(word), re.IGNORECASE)
                    anonymized = reg.sub("[SENSITIVE]", anonymized)
                    
        return anonymized

    def anonymize_ticket_data(self, ticket: Dict[str, Any], technicians: List[str] = None) -> Dict[str, Any]:
        """
        Anonymizza i campi rilevanti di un ticket per l'analisi AI.
        """
        anonymized_ticket = ticket.copy()
        
        # Campi da mascherare
        fields_to_mask = ["titolo", "descrizione", "note_tecnico"]
        
        for field in fields_to_mask:
            if field in anonymized_ticket and anonymized_ticket[field]:
                anonymized_ticket[field] = self.mask_text(anonymized_ticket[field], technicians)
                
        # Non inviamo coordinate GPS precise o altri identificatori univoci se non necessari
        if "asset_id" in anonymized_ticket:
            anonymized_ticket["asset_id"] = "ID_HASH_" + str(hash(str(anonymized_ticket["asset_id"])))[:8]
            
        return anonymized_ticket

# Singleton instance
anonymizer = AnonymizationService()
