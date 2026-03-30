from pydantic import BaseModel, Field
from typing import Optional
from datetime import datetime


class SitoCreate(BaseModel):
    nome: str = Field(..., min_length=1)
    descrizione: Optional[str] = None
    ubicazione: Optional[str] = None
    citta: Optional[str] = None
    paese: Optional[str] = "Italia"
    responsabile: Optional[str] = None
    telefono_responsabile: Optional[str] = None
    email_responsabile: Optional[str] = None
    note: Optional[str] = None


class SitoUpdate(BaseModel):
    nome: Optional[str] = None
    descrizione: Optional[str] = None
    ubicazione: Optional[str] = None
    citta: Optional[str] = None
    paese: Optional[str] = None
    responsabile: Optional[str] = None
    telefono_responsabile: Optional[str] = None
    email_responsabile: Optional[str] = None
    note: Optional[str] = None


class SitoResponse(BaseModel):
    id: int
    nome: str
    descrizione: Optional[str] = None
    ubicazione: Optional[str] = None
    citta: Optional[str] = None
    paese: Optional[str] = None
    responsabile: Optional[str] = None
    telefono_responsabile: Optional[str] = None
    email_responsabile: Optional[str] = None
    note: Optional[str] = None
    created_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None
