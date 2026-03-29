from pydantic import BaseModel, Field


class ImpiantoCreate(BaseModel):
    nome: str = Field(..., min_length=1, description="Nome impianto")
    descrizione: str | None = None
    latitude: float | None = None
    longitude: float | None = None



class ImpiantoUpdate(BaseModel):
    nome: str | None = None
    descrizione: str | None = None
    latitude: float | None = None
    longitude: float | None = None



class ImpiantoResponse(BaseModel):
    id: int
    nome: str
    descrizione: str | None = None
    latitude: float | None = None
    longitude: float | None = None

