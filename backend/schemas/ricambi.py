from pydantic import BaseModel, Field
from typing import Literal, Optional
from datetime import datetime


class RicambioCreate(BaseModel):
    codice: str = Field(..., min_length=1, max_length=100)
    descrizione: str = Field(..., min_length=1, max_length=500)
    categoria: str | None = Field(default=None, max_length=100)
    unita_misura: str | None = Field(default="pz", max_length=20)
    giacenza: float = Field(default=0, ge=0)
    scorta_minima: float | None = Field(default=0, ge=0)
    prezzo_unitario: float | None = Field(default=None, ge=0)
    fornitore: str | None = Field(default=None, max_length=200)
    ubicazione: str | None = Field(default=None, max_length=200)
    note: str | None = Field(default=None, max_length=2000)
    attivo: bool = True


class RicambioUpdate(BaseModel):
    codice: str | None = Field(default=None, min_length=1, max_length=100)
    descrizione: str | None = Field(default=None, min_length=1, max_length=500)
    categoria: str | None = Field(default=None, max_length=100)
    unita_misura: str | None = Field(default=None, max_length=20)
    scorta_minima: float | None = Field(default=None, ge=0)
    prezzo_unitario: float | None = Field(default=None, ge=0)
    fornitore: str | None = Field(default=None, max_length=200)
    ubicazione: str | None = Field(default=None, max_length=200)
    note: str | None = Field(default=None, max_length=2000)
    attivo: bool | None = None


class MovimentoCreate(BaseModel):
    tipo: Literal["carico", "scarico", "rettifica"]
    quantita: float = Field(..., ge=0)
    causale: str | None = Field(default=None, max_length=300)
    ticket_id: int | None = None


class TicketRicambioCreate(BaseModel):
    """Aggiunge un ricambio a un ticket (dal '+ ricambi').

    - ricambio_id valorizzato → ricambio a catalogo
    - ricambio_id None + descrizione → ricambio nuovo da acquistare (is_nuovo=True)
    """
    ricambio_id: int | None = None
    descrizione: str | None = Field(default=None, max_length=500)
    quantita: float = Field(default=1, gt=0)


class RicambioResponse(BaseModel):
    id: int
    codice: str
    descrizione: str
    categoria: str | None = None
    unita_misura: str | None = None
    giacenza: float
    scorta_minima: float | None = None
    prezzo_unitario: float | None = None
    fornitore: str | None = None
    ubicazione: str | None = None
    note: str | None = None
    attivo: bool = True
    prenotato: float = 0
    disponibile: float = 0
    sotto_scorta: bool = False
    created_at: Optional[datetime] = None
