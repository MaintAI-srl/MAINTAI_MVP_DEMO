from pydantic import BaseModel, Field
from typing import Optional, List
from datetime import datetime



# ── Asset ──────────────────────────────────────────────────────────────────

class AssetCreate(BaseModel):
    nome: str = Field(..., min_length=1, description="Nome asset")
    # alias retrocompatibilità: 'name' accettato come alias
    name: Optional[str] = None
    area: str = Field(..., min_length=1)
    vincolo_orario: Optional[str] = None
    note: Optional[str] = None
    # nuovi campi
    codice: Optional[str] = None           # ID human-readable; se assente viene generato
    descrizione: Optional[str] = None
    anno: Optional[int] = Field(None, ge=1900, le=2100)
    impianto_id: Optional[int] = None
    limitazioni: Optional[str] = None
    stato: Optional[str] = "service"       # service | out of service | stopped
    
    # Nuovi vincoli Meteo
    weather_sunny_required: bool = False
    weather_max_wind_kmh: Optional[float] = None
    weather_max_rain_mm: Optional[float] = None


    def effective_nome(self) -> str:
        return self.nome or self.name or ""


class AssetUpdate(BaseModel):
    nome: Optional[str] = None
    name: Optional[str] = None             # retrocompatibilità
    area: Optional[str] = None
    vincolo_orario: Optional[str] = None
    note: Optional[str] = None
    codice: Optional[str] = None
    descrizione: Optional[str] = None
    anno: Optional[int] = None
    impianto_id: Optional[int] = None
    limitazioni: Optional[str] = None
    stato: Optional[str] = None
    weather_sunny_required: Optional[bool] = None
    weather_max_wind_kmh: Optional[float] = None
    weather_max_rain_mm: Optional[float] = None



class AssetResponse(BaseModel):
    id: int
    name: str
    nome: str
    area: str
    vincolo_orario: Optional[str] = None
    note: Optional[str] = None
    codice: Optional[str] = None
    descrizione: Optional[str] = None
    anno: Optional[int] = None
    impianto_id: Optional[int] = None
    impianto_nome: Optional[str] = None
    limitazioni: Optional[str] = None
    stato: str = "service"
    weather_sunny_required: bool = False
    weather_max_wind_kmh: Optional[float] = None
    weather_max_rain_mm: Optional[float] = None



# ── Tecnico ────────────────────────────────────────────────────────────────

class TecnicoCreate(BaseModel):
    nome: str = Field(..., min_length=1)
    cognome: Optional[str] = None
    skill: str = ""
    ore_giornaliere: int = Field(default=8, ge=1, le=24)
    stato: Optional[str] = "in servizio"
    orario_inizio: Optional[str] = "08:00"
    orario_fine: Optional[str] = "17:00"
    limitazioni_orarie: Optional[str] = None


class TecnicoUpdate(BaseModel):
    nome: Optional[str] = None
    cognome: Optional[str] = None
    skill: Optional[str] = None
    ore_giornaliere: Optional[int] = None
    stato: Optional[str] = None
    orario_inizio: Optional[str] = None
    orario_fine: Optional[str] = None
    limitazioni_orarie: Optional[str] = None


class TecnicoResponse(BaseModel):
    id: int
    nome: str
    cognome: Optional[str] = None
    skill: str
    ore_giornaliere: int
    stato: str = "in servizio"
    orario_inizio: Optional[str] = None
    orario_fine: Optional[str] = None
    limitazioni_orarie: Optional[str] = None


# ── Problem Analysis ───────────────────────────────────────────────────────

class ProblemAnalysisRequest(BaseModel):
    symptoms: str = Field(..., min_length=1)
    method: str = "all"


# ── Disponibilità tecnico (legacy) ─────────────────────────────────────────

class DisponibilitaTecnicoCreate(BaseModel):
    tecnico_id: int
    giorno_settimana: int
    ora_inizio: str
    ora_fine: str
    is_disponibile: bool = True


class DisponibilitaTecnicoResponse(BaseModel):
    tecnico_id: int
    giorno_settimana: int
    ora_inizio: str
    ora_fine: str
    is_disponibile: bool = True

class TecnicoAssenzaBase(BaseModel):
    data_inizio: datetime
    data_fine: datetime
    tipo_assenza: str = "Ferie"
    note: Optional[str] = None

class TecnicoAssenzaCreate(TecnicoAssenzaBase):
    pass

class TecnicoAssenzaResponse(TecnicoAssenzaBase):
    id: int
    tecnico_id: int

    class Config:
        from_attributes = True
