from pydantic import BaseModel, ConfigDict, Field
from typing import Optional
from datetime import datetime, date



# ── Asset ──────────────────────────────────────────────────────────────────

class AssetCreate(BaseModel):
    nome: str = Field(..., min_length=1, description="Nome asset")
    name: Optional[str] = None             # retrocompatibilita
    area: str = Field(..., min_length=1)
    vincolo_orario: Optional[str] = None
    note: Optional[str] = None
    codice: Optional[str] = None
    descrizione: Optional[str] = None
    anno: Optional[int] = Field(None, ge=1900, le=2100)
    impianto_id: Optional[int] = None
    limitazioni: Optional[str] = None
    stato: Optional[str] = "service"
    # Vincoli meteo
    weather_sunny_required: bool = False
    weather_max_wind_kmh: Optional[float] = None
    weather_max_rain_mm: Optional[float] = None
    # Nuovi campi anagrafica
    anno_installazione: Optional[int] = None
    anno_produzione: Optional[int] = None
    marca: Optional[str] = None
    modello: Optional[str] = None
    matricola: Optional[str] = None
    numero_serie: Optional[str] = None
    fornitore: Optional[str] = None
    data_acquisto: Optional[date] = None
    data_scadenza_garanzia: Optional[date] = None
    vincoli_operativi: Optional[str] = None
    vincoli_manutenzione: Optional[str] = None
    note_tecniche: Optional[str] = None
    criticita: Optional[str] = None  # A | B | C | null
    posizione_fisica: Optional[str] = None
    # M2.1
    costo_orario_fermo: Optional[float] = None
    # M2.2
    codice_ricambio_esterno: Optional[str] = None

    def effective_nome(self) -> str:
        return self.nome or self.name or ""


class AssetUpdate(BaseModel):
    nome: Optional[str] = None
    name: Optional[str] = None
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
    # Nuovi campi anagrafica
    anno_installazione: Optional[int] = None
    anno_produzione: Optional[int] = None
    marca: Optional[str] = None
    modello: Optional[str] = None
    matricola: Optional[str] = None
    numero_serie: Optional[str] = None
    fornitore: Optional[str] = None
    data_acquisto: Optional[date] = None
    data_scadenza_garanzia: Optional[date] = None
    vincoli_operativi: Optional[str] = None
    vincoli_manutenzione: Optional[str] = None
    note_tecniche: Optional[str] = None
    criticita: Optional[str] = None
    posizione_fisica: Optional[str] = None
    # M2.1
    costo_orario_fermo: Optional[float] = None
    # M2.2
    codice_ricambio_esterno: Optional[str] = None


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
    sito_id: Optional[int] = None
    sito_nome: Optional[str] = None
    limitazioni: Optional[str] = None
    stato: str = "service"
    weather_sunny_required: bool = False
    weather_max_wind_kmh: Optional[float] = None
    weather_max_rain_mm: Optional[float] = None
    # Nuovi campi anagrafica
    anno_installazione: Optional[int] = None
    anno_produzione: Optional[int] = None
    marca: Optional[str] = None
    modello: Optional[str] = None
    matricola: Optional[str] = None
    numero_serie: Optional[str] = None
    fornitore: Optional[str] = None
    data_acquisto: Optional[date] = None
    data_scadenza_garanzia: Optional[date] = None
    vincoli_operativi: Optional[str] = None
    vincoli_manutenzione: Optional[str] = None
    note_tecniche: Optional[str] = None
    criticita: Optional[str] = None
    posizione_fisica: Optional[str] = None
    # M2.1
    costo_orario_fermo: Optional[float] = None
    # M2.2
    codice_ricambio_esterno: Optional[str] = None



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
    utente_id: Optional[int] = None
    telefono: Optional[str] = None
    sede_indirizzo: Optional[str] = None


class TecnicoUpdate(BaseModel):
    nome: Optional[str] = None
    cognome: Optional[str] = None
    skill: Optional[str] = None
    ore_giornaliere: Optional[int] = None
    stato: Optional[str] = None
    orario_inizio: Optional[str] = None
    orario_fine: Optional[str] = None
    limitazioni_orarie: Optional[str] = None
    utente_id: Optional[int] = None  # collega account utente al profilo tecnico (mobile access)
    telefono: Optional[str] = None
    sede_indirizzo: Optional[str] = None


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
    utente_id: Optional[int] = None
    utente_username: Optional[str] = None


# ── Problem Analysis ───────────────────────────────────────────────────────

class GeneraAssetMultipliRequest(BaseModel):
    impianto_id: int
    prefisso_nome: str = Field(..., min_length=1)
    quantita: int = Field(..., ge=1, le=99)
    area: str = "Generale"
    criticita: str = "media"
    marca: Optional[str] = None
    modello: Optional[str] = None


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

    model_config = ConfigDict(from_attributes=True)
