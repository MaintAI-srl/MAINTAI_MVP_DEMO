from pydantic import BaseModel, ConfigDict
from typing import Optional
from datetime import datetime


# ── Piano di Manutenzione ────────────────────────────────────────────────────

class PianoManutenzioneCreate(BaseModel):
    """Crea un nuovo Piano di Manutenzione. asset_id è obbligatorio per nuovi piani."""
    nome_codificato: Optional[str] = None     # auto-generato se assente (PM-YYYY-NNN)
    progressivo: Optional[int] = None         # auto-generato se assente
    descrizione: Optional[str] = None
    stato: Optional[str] = "attivo"
    asset_id: Optional[int] = None           # Deprecato: usa asset_ids
    asset_ids: Optional[list[int]] = []      # Nuova gestione multi-asset
    impianto_id: Optional[int] = None
    sito_id: Optional[int] = None
    manuale_id: Optional[int] = None


class PianoManutenzioneUpdate(BaseModel):
    nome_codificato: Optional[str] = None
    descrizione: Optional[str] = None
    stato: Optional[str] = None
    asset_id: Optional[int] = None
    asset_ids: Optional[list[int]] = None
    impianto_id: Optional[int] = None
    sito_id: Optional[int] = None


class PianoManutenzioneResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    nome_codificato: str
    progressivo: int
    descrizione: Optional[str] = None
    stato: Optional[str] = "attivo"
    asset_id: Optional[int] = None
    asset_ids: list[int] = []
    impianto_id: Optional[int] = None
    sito_id: Optional[int] = None
    manuale_id: Optional[int] = None
    tenant_id: Optional[int] = None
    created_at: datetime
    updated_at: datetime


class PianoManutenzioneListItem(BaseModel):
    """Piano arricchito con conteggi per la lista."""
    model_config = ConfigDict(from_attributes=True)

    id: int
    nome_codificato: str
    progressivo: int
    descrizione: Optional[str] = None
    stato: Optional[str] = "attivo"
    asset_id: Optional[int] = None
    asset_nome: Optional[str] = None
    asset_count: int = 0
    task_count: int = 0
    open_ticket_count: int = 0
    created_at: datetime
    updated_at: datetime


# ── Task (AttivitaManutenzione) ──────────────────────────────────────────────

class TaskCreate(BaseModel):
    """Crea un nuovo Task dentro un Piano. piano_id viene passato via path param."""
    nome: Optional[str] = None
    descrizione: str
    frequenza_giorni: Optional[int] = None
    durata_ore: Optional[float] = None
    priorita: str = "Media"
    codice: Optional[str] = None
    is_repeatable: bool = True
    generation_mode: str = "manual"           # manual | auto | disabled
    generate_days_before_due: int = 7
    source_type: str = "manual_task"          # manual_task | imported_from_manual


class TaskUpdate(BaseModel):
    nome: Optional[str] = None
    descrizione: Optional[str] = None
    frequenza_giorni: Optional[int] = None
    durata_ore: Optional[float] = None
    priorita: Optional[str] = None
    codice: Optional[str] = None
    is_repeatable: Optional[bool] = None
    generation_mode: Optional[str] = None
    generate_days_before_due: Optional[int] = None
    task_stato: Optional[str] = None


class TaskResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    piano_id: Optional[int] = None
    asset_id: Optional[int] = None
    asset_nome: Optional[str] = None
    nome: Optional[str] = None
    descrizione: Optional[str] = None
    frequenza_giorni: Optional[int] = None
    durata_ore: Optional[float] = None
    priorita: str = "Media"
    codice: Optional[str] = None
    is_repeatable: Optional[bool] = True
    generation_mode: Optional[str] = "manual"
    generate_days_before_due: Optional[int] = 7
    task_stato: Optional[str] = "active"
    source_type: Optional[str] = None
    last_generated_at: Optional[datetime] = None
    next_due_at: Optional[datetime] = None
    open_ticket_count: int = 0


# Mantenuto per backward compatibility con /piani-manutenzione/{id}/ticket
class TicketPianoAssign(BaseModel):
    ticket_id: int
    origine_piano: Optional[str] = "manuale_interno_piano"
