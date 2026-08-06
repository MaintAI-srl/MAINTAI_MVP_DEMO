"""Schemi Pydantic del livello commerciale.

Validazione stretta sui campi che finiscono nel provider di pagamento o in
un'anagrafica fiscale: qui un input non validato non produce solo un errore, ma
un cliente creato male o un addebito sbagliato.
"""

from __future__ import annotations

import re

from typing import Literal, Optional

from pydantic import BaseModel, Field, field_validator

BillingInterval = Literal["monthly", "yearly"]

# Validazione email fatta in casa invece di `EmailStr`: quest'ultimo tira dentro
# la dipendenza `email-validator`, e il controllo sintattico non è comunque ciò
# che stabilisce se un indirizzo esiste — lo stabilisce la mail di verifica.
_EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s.]+(\.[^@\s.]+)+$")


def _validate_email(value: str) -> str:
    value = (value or "").strip().lower()
    if not _EMAIL_RE.match(value) or len(value) > 254:
        raise ValueError("Indirizzo email non valido.")
    return value


class _EmailField(BaseModel):
    """Base con il validatore email condiviso dai modelli che ne hanno uno."""

    @field_validator("email", "billing_email", mode="after", check_fields=False)
    @classmethod
    def _check_email(cls, value):
        return _validate_email(value) if value else value


class CheckoutRequest(BaseModel):
    plan_code: str = Field(..., min_length=2, max_length=40)
    billing_interval: BillingInterval = "monthly"
    extra_users: int = Field(0, ge=0, le=500)
    extra_sites: int = Field(0, ge=0, le=100)


class ChangePlanRequest(BaseModel):
    plan_code: str = Field(..., min_length=2, max_length=40)
    billing_interval: Optional[BillingInterval] = None


class ChangeQuantitiesRequest(BaseModel):
    extra_users: Optional[int] = Field(None, ge=0, le=500)
    extra_sites: Optional[int] = Field(None, ge=0, le=100)


class CancelRequest(BaseModel):
    # La disdetta immediata rinuncia al tempo già pagato: la si chiede
    # esplicitamente, non è il default.
    at_period_end: bool = True
    reason: Optional[str] = Field(None, max_length=500)


class SignupRequest(_EmailField):
    """Registrazione pubblica.

    Un solo passaggio raccoglie azienda + amministratore: chiedere prima
    l'account e poi l'azienda raddoppia i punti di abbandono senza aggiungere
    informazione.
    """

    email: str = Field(..., max_length=254)
    password: str = Field(..., min_length=12, max_length=200)
    nome_referente: str = Field(..., min_length=2, max_length=120)
    azienda: str = Field(..., min_length=2, max_length=200)
    paese: str = Field("IT", min_length=2, max_length=2)
    vat_number: Optional[str] = Field(None, max_length=32)
    plan_code: Optional[str] = Field(None, max_length=40)
    accetta_termini: bool
    accetta_privacy: bool

    @field_validator("accetta_termini", "accetta_privacy")
    @classmethod
    def _must_accept(cls, value: bool) -> bool:
        # Consenso obbligatorio e registrato: senza, non c'è base giuridica per
        # il trattamento. Un default a True nel form non sarebbe consenso.
        if not value:
            raise ValueError("È necessario accettare termini di servizio e informativa privacy.")
        return value

    @field_validator("paese")
    @classmethod
    def _upper_country(cls, value: str) -> str:
        return value.upper()


class VerifyEmailRequest(BaseModel):
    token: str = Field(..., min_length=16, max_length=512)


class ForgotPasswordRequest(_EmailField):
    email: str = Field(..., max_length=254)


class ResetPasswordRequest(BaseModel):
    token: str = Field(..., min_length=16, max_length=512)
    new_password: str = Field(..., min_length=12, max_length=200)


class CompanyProfileUpdate(_EmailField):
    nome: Optional[str] = Field(None, min_length=1, max_length=200)
    legal_name: Optional[str] = Field(None, max_length=200)
    vat_number: Optional[str] = Field(None, max_length=32)
    billing_email: Optional[str] = Field(None, max_length=254)
    country: Optional[str] = Field(None, min_length=2, max_length=2)
