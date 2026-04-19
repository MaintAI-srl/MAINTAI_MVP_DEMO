from pydantic import BaseModel, Field
from typing import Literal, Optional
from datetime import datetime

TicketStato = Literal["Aperto", "Pianificato", "In corso", "Chiuso", "Eliminato"]


class TicketCreate(BaseModel):
    titolo: str = Field(..., min_length=1, max_length=500)
    asset_id: Optional[int] = None
    priorita: str
    tipo: str = "CM"
    stato: TicketStato
    asset_stato: str | None = None
    durata_stimata_ore: float = Field(..., gt=0)
    fascia_oraria: str
    descrizione: str | None = Field(default=None, max_length=5000)
    tecnico_id: int | None = None
    planned_start: Optional[datetime] = None
    planned_finish: Optional[datetime] = None
    piano_manutenzione_id: int | None = None
    origine_piano: str | None = None


class TicketUpdate(BaseModel):
    stato: TicketStato | None = None
    priorita: str | None = None
    tipo: str | None = None
    asset_stato: str | None = None
    fascia_oraria: str | None = None
    durata_stimata_ore: float | None = Field(default=None, gt=0)
    tecnico_id: int | None = None
    planned_start: Optional[datetime] = None
    planned_finish: Optional[datetime] = None
    execution_start: Optional[datetime] = None
    execution_finish: Optional[datetime] = None
    eliminazione_note: str | None = None  # Motivo eliminazione (obbligatorio lato UI)
    is_manual_plan: bool | None = None
    piano_manutenzione_id: int | None = None
    origine_piano: str | None = None


class TicketResponse(BaseModel):
    id: int
    titolo: str
    asset_id: Optional[int] = None
    asset_name: str | None = None
    priorita: str
    tipo: str = "CM"
    stato: str
    asset_stato: str | None = None
    durata_stimata_ore: float
    fascia_oraria: str
    descrizione: str | None = None
    tecnico_id: int | None = None
    attivita_manutenzione_id: int | None = None
    planned_start: Optional[datetime] = None
    planned_finish: Optional[datetime] = None
    execution_start: Optional[datetime] = None
    execution_finish: Optional[datetime] = None
    parent_id: int | None = None
    diagnosi_eseguita: bool = False
    is_manual_plan: bool = False
    piano_manutenzione_id: int | None = None
    origine_piano: str | None = None
