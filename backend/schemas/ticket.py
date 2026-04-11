from pydantic import BaseModel, Field
from typing import Optional
from datetime import datetime


class TicketCreate(BaseModel):
    titolo: str = Field(..., min_length=1)
    asset_id: int
    priorita: str
    tipo: str = "CM"
    stato: str
    asset_stato: str | None = None
    durata_stimata_ore: float = Field(..., ge=0)
    fascia_oraria: str
    descrizione: str | None = None
    tecnico_id: int | None = None
    planned_start: Optional[datetime] = None
    planned_finish: Optional[datetime] = None


class TicketUpdate(BaseModel):
    stato: str | None = None
    priorita: str | None = None
    tipo: str | None = None
    asset_stato: str | None = None
    fascia_oraria: str | None = None
    durata_stimata_ore: float | None = None
    tecnico_id: int | None = None
    planned_start: Optional[datetime] = None
    planned_finish: Optional[datetime] = None
    execution_start: Optional[datetime] = None
    execution_finish: Optional[datetime] = None
    eliminazione_note: str | None = None  # Motivo eliminazione (obbligatorio lato UI)
    is_manual_plan: bool | None = None


class TicketResponse(BaseModel):
    id: int
    titolo: str
    asset_id: int
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
