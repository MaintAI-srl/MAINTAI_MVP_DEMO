from pydantic import BaseModel, Field
from typing import Optional


class ImpiantoCreate(BaseModel):
    nome: str = Field(..., min_length=1, description="Nome impianto")
    descrizione: Optional[str] = None
    latitude: Optional[float] = None
    longitude: Optional[float] = None
    sito_id: Optional[int] = None
    tipologia: Optional[str] = None
    note: Optional[str] = None


class ImpiantoUpdate(BaseModel):
    nome: Optional[str] = None
    descrizione: Optional[str] = None
    latitude: Optional[float] = None
    longitude: Optional[float] = None
    sito_id: Optional[int] = None
    tipologia: Optional[str] = None
    note: Optional[str] = None


class ImpiantoResponse(BaseModel):
    id: int
    nome: str
    descrizione: Optional[str] = None
    latitude: Optional[float] = None
    longitude: Optional[float] = None
    sito_id: Optional[int] = None
    sito_nome: Optional[str] = None
    tipologia: Optional[str] = None
    note: Optional[str] = None


class GeneraImpiantiMultipliRequest(BaseModel):
    sito_id: int
    tipologia: str = Field(..., min_length=1)
    prefisso_nome: str = Field(..., min_length=1)
    quantita: int = Field(..., ge=1, le=99)
    dati_comuni: Optional[dict] = None
