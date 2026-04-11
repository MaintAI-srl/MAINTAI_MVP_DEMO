from pydantic import BaseModel
from typing import Optional, List
from datetime import datetime

class PianoManutenzioneBase(BaseModel):
    nome_codificato: str
    progressivo: int
    descrizione: Optional[str] = None
    stato: Optional[str] = "attivo"
    asset_id: Optional[int] = None
    impianto_id: Optional[int] = None
    sito_id: Optional[int] = None
    manuale_id: Optional[int] = None

class PianoManutenzioneCreate(PianoManutenzioneBase):
    pass

class PianoManutenzioneUpdate(BaseModel):
    nome_codificato: Optional[str] = None
    progressivo: Optional[int] = None
    descrizione: Optional[str] = None
    stato: Optional[str] = None
    asset_id: Optional[int] = None
    impianto_id: Optional[int] = None
    sito_id: Optional[int] = None
    manuale_id: Optional[int] = None

class PianoManutenzioneResponse(PianoManutenzioneBase):
    id: int
    tenant_id: Optional[int] = None
    created_at: datetime
    updated_at: datetime

    class Config:
        from_attributes = True

class TicketPianoAssign(BaseModel):
    ticket_id: int
    origine_piano: Optional[str] = "manuale_interno_piano"  # "manuale", "excel", "manuale_interno_piano"
