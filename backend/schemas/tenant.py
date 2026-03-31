from pydantic import BaseModel, Field
from typing import Optional
from datetime import datetime


class TenantCreate(BaseModel):
    nome: str = Field(..., min_length=1, description="Nome del cliente/azienda")
    slug: str = Field(..., min_length=2, pattern=r"^[a-z0-9\-]+$", description="Identificatore univoco (solo minuscole, numeri, trattini)")
    admin_username: str = Field(..., min_length=3, description="Username admin per questo tenant")
    admin_password: str = Field(..., min_length=6, description="Password admin (min 6 caratteri)")


class TenantUpdate(BaseModel):
    nome: Optional[str] = None
    is_active: Optional[bool] = None


class TenantResponse(BaseModel):
    id: int
    nome: str
    slug: str
    is_active: bool
    created_at: Optional[datetime] = None
    n_utenti: Optional[int] = 0
    n_siti: Optional[int] = 0
    n_asset: Optional[int] = 0
    n_tecnici: Optional[int] = 0
    n_ticket: Optional[int] = 0
    admin_username: Optional[str] = None
