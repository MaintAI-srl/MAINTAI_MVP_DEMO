from pydantic import BaseModel, Field, field_validator
from typing import Literal, Optional
from datetime import datetime

TicketStato = Literal["Aperto", "Pianificato", "In corso", "Chiuso", "Eliminato"]

# Tipologie ticket ammesse (change request 2026-07-05: aggiunta MOD-STR "Modifica Straordinaria")
TIPI_TICKET_VALIDI = {"PM", "CM", "BD", "ISP", "MOD-STR"}


def _validate_tipo(value: str | None) -> str | None:
    if value is None:
        return value
    normalized = value.strip().upper()
    if normalized not in TIPI_TICKET_VALIDI:
        raise ValueError(f"Tipo ticket non valido: '{value}'. Valori ammessi: {sorted(TIPI_TICKET_VALIDI)}")
    return normalized


class TicketCreate(BaseModel):
    titolo: str = Field(..., min_length=1, max_length=500)
    asset_id: Optional[int] = None
    priorita: str
    tipo: str = "CM"
    stato: TicketStato
    asset_stato: str | None = None
    durata_stimata_ore: float = Field(..., gt=0, le=999)
    fascia_oraria: str
    descrizione: str | None = Field(default=None, max_length=5000)
    note: str | None = Field(default=None, max_length=5000)
    tecnico_id: int | None = None
    tecnico_supporto_id: int | None = None
    planned_start: Optional[datetime] = None
    planned_finish: Optional[datetime] = None
    piano_manutenzione_id: int | None = None
    origine_piano: str | None = None
    # M2.2 — Predisposizione ricambi (compilabile già in creazione)
    ricambio_note: str | None = Field(default=None, max_length=2000)
    ricambio_quantita: float | None = Field(default=None, ge=0)
    # Ore uomo (change request 2026-07-05)
    tecnici_richiesti: int | None = Field(default=None, ge=1, le=99)
    required_man_hours: float | None = Field(default=None, gt=0, le=9999)
    man_hours_calculation_mode: Literal["auto", "manual"] = "manual"

    _tipo_check = field_validator("tipo")(_validate_tipo)


class TicketUpdate(BaseModel):
    stato: TicketStato | None = None
    priorita: str | None = None
    tipo: str | None = None
    asset_stato: str | None = None
    fascia_oraria: str | None = None
    durata_stimata_ore: float | None = Field(default=None, gt=0, le=999)
    tecnico_id: int | None = None
    tecnico_supporto_id: int | None = None
    planned_start: Optional[datetime] = None
    planned_finish: Optional[datetime] = None
    execution_start: Optional[datetime] = None
    execution_finish: Optional[datetime] = None
    eliminazione_note: str | None = None  # Motivo eliminazione (obbligatorio lato UI)
    is_manual_plan: bool | None = None
    piano_manutenzione_id: int | None = None
    origine_piano: str | None = None
    note_vocali: str | None = Field(default=None, max_length=10000)  # Note vocali trascritte da mobile
    descrizione: str | None = Field(default=None, max_length=5000)
    note: str | None = Field(default=None, max_length=5000)
    # M2.2 — Predisposizione ricambi
    ricambio_note: str | None = Field(default=None, max_length=2000)
    ricambio_quantita: float | None = Field(default=None, ge=0)
    in_attesa_ricambio: bool | None = None
    # Ore uomo (change request 2026-07-05)
    tecnici_richiesti: int | None = Field(default=None, ge=1, le=99)
    required_man_hours: float | None = Field(default=None, gt=0, le=9999)
    man_hours_calculation_mode: Literal["auto", "manual"] | None = None

    _tipo_check = field_validator("tipo")(_validate_tipo)


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
    note: str | None = None
    tecnico_id: int | None = None
    tecnico_supporto_id: int | None = None
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
    # M2.2 — Predisposizione ricambi
    ricambio_note: str | None = None
    ricambio_quantita: float | None = None
    in_attesa_ricambio: bool = False
    # Ore uomo (change request 2026-07-05)
    tecnici_richiesti: int | None = None
    required_man_hours: float | None = None
    man_hours_calculation_mode: str = "manual"
