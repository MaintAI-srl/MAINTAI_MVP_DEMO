"""
Pseudonimizzazione REVERSIBILE dei dati inviati ai servizi AI esterni (OpenAI).

Differenza rispetto a ``AnonymizationService`` (redazione distruttiva, ``[SENSITIVE_DATA]``):
qui ogni entità sensibile viene sostituita con un **token deterministico** derivato dal suo
id ORM (``ASSET_3``, ``TECNICO_7``, ``SITO_2``). Il token è stabile fra richieste e fra
processi, quindi:

* il modello mantiene la **coerenza referenziale** — può collegare la pompa citata nella
  descrizione libera con l'asset dell'anagrafica — cosa impossibile con ``[SENSITIVE_DATA]``;
* la risposta dell'AI può essere **ri-tradotta** con i nomi reali via :meth:`restore` prima
  di arrivare all'utente o di essere salvata a DB;
* le conversazioni multi-turno (sessione diagnostica) restano coerenti senza dover
  persistere alcuna mappa: basta ricostruire il pseudonimizzatore dalle stesse entità.

Principio: si tokenizza **l'identificatore**, mai **la semantica tecnica**. Marca, modello,
categoria, criticità, misure, codici ricambio e parametri di processo restano in chiaro:
sono il valore diagnostico del prompt e non identificano il cliente.
"""

from __future__ import annotations

import re
from typing import Any, Iterable

from backend.services.ai.anonymization_service import anonymizer

# Lunghezza minima di un valore perché valga la pena sostituirlo: sotto questa soglia
# il rischio di falsi positivi supera il beneficio (es. un asset chiamato "P1").
_MIN_VALUE_LEN = 3
# I valori puramente numerici sono i più pericolosi da sostituire (si confondono con
# quantità, misure e codici ricambio): richiedono una soglia più alta.
_MIN_NUMERIC_VALUE_LEN = 6

_KIND_RE = re.compile(r"[^A-Z_]")

_COORDINATE_KEY_HINTS = ("latitude", "longitude", "gps", "coordinate", "lat", "lon")
_MASKED_POS = "[MASKED_POS]"


def _clean_kind(kind: str) -> str:
    return _KIND_RE.sub("", (kind or "").upper().replace(" ", "_")) or "ENTITA"


def _get(obj: Any, field: str) -> Any:
    """Legge un campo sia da un oggetto ORM sia da un dict."""
    if obj is None:
        return None
    if isinstance(obj, dict):
        return obj.get(field)
    return getattr(obj, field, None)


class Pseudonymizer:
    """
    Mappa bidirezionale valore reale ⇄ token, da istanziare **per richiesta**.

    Non è un singleton: tiene lo stato di una singola conversazione con l'AI. I token
    sono però deterministici, quindi due istanze costruite dalle stesse entità producono
    esattamente la stessa mappa.
    """

    def __init__(self) -> None:
        # valore reale (lowercase) → token
        self._to_token: dict[str, str] = {}
        # token → valore reale "primario" (il primo registrato per quel token)
        self._to_real: dict[str, str] = {}
        # token → tutti i valori registrati, per le statistiche
        self._values_by_token: dict[str, list[str]] = {}
        self._mask_re: re.Pattern[str] | None = None
        self._restore_re: re.Pattern[str] | None = None

    # ── Registrazione ────────────────────────────────────────────────────────

    def register(self, kind: str, entity_id: Any, *values: Any) -> str:
        """
        Registra uno o più valori reali sotto il token ``{KIND}_{entity_id}``.

        Il primo valore non vuoto diventa il valore "primario", cioè quello ripristinato
        da :meth:`restore`. Gli altri sono alias riconosciuti in input (es. nome proprio
        e nome completo di un tecnico).
        """
        token = f"{_clean_kind(kind)}_{entity_id}"

        for value in values:
            if value is None:
                continue
            text = str(value).strip()
            if not self._is_substitutable(text):
                continue

            key = text.lower()
            if key not in self._to_token:
                self._to_token[key] = token
                self._mask_re = None

            bucket = self._values_by_token.setdefault(token, [])
            if text not in bucket:
                bucket.append(text)

            if token not in self._to_real:
                self._to_real[token] = text
                self._restore_re = None

        return token

    @staticmethod
    def _is_substitutable(text: str) -> bool:
        if len(text) < _MIN_VALUE_LEN:
            return False
        if text.isdigit() and len(text) < _MIN_NUMERIC_VALUE_LEN:
            return False
        return True

    def token(self, kind: str, entity_id: Any) -> str:
        """Token deterministico di un'entità, anche se non ha valori registrati."""
        return f"{_clean_kind(kind)}_{entity_id}"

    # ── Registrazione per tipo di entità ─────────────────────────────────────

    def register_asset(self, asset: Any) -> str:
        """Registra un Asset (oggetto ORM o dict). Marca e modello restano in chiaro."""
        asset_id = _get(asset, "id")
        token = self.register("ASSET", asset_id, _get(asset, "nome"))
        self.register("CODICE_ASSET", asset_id, _get(asset, "codice"))
        self.register(
            "MATRICOLA_ASSET", asset_id,
            _get(asset, "matricola"), _get(asset, "numero_serie"),
        )
        self.register("FORNITORE_ASSET", asset_id, _get(asset, "fornitore"))
        self.register("POSIZIONE_ASSET", asset_id, _get(asset, "posizione_fisica"))
        return token

    def register_tecnico(self, tecnico: Any) -> str:
        """Registra un Tecnico. Competenze, orari e assenze restano in chiaro."""
        tecnico_id = _get(tecnico, "id")
        nome = (_get(tecnico, "nome") or "").strip()
        cognome = (_get(tecnico, "cognome") or "").strip()
        completo = " ".join(p for p in (nome, cognome) if p)
        # Il nome completo va registrato per primo: è il valore ripristinato da restore()
        # ed è il più lungo, quindi vince sul match dei singoli componenti.
        token = self.register("TECNICO", tecnico_id, completo, nome, cognome)
        self.register("TELEFONO_TECNICO", tecnico_id, _get(tecnico, "telefono"))
        self.register("INDIRIZZO_TECNICO", tecnico_id, _get(tecnico, "sede_indirizzo"))
        return token

    def register_sito(self, sito: Any) -> str:
        sito_id = _get(sito, "id")
        token = self.register("SITO", sito_id, _get(sito, "nome"))
        self.register("INDIRIZZO_SITO", sito_id, _get(sito, "ubicazione"))
        self.register("CITTA_SITO", sito_id, _get(sito, "citta"))
        self.register("RESPONSABILE_SITO", sito_id, _get(sito, "responsabile"))
        return token

    def register_impianto(self, impianto: Any) -> str:
        return self.register("IMPIANTO", _get(impianto, "id"), _get(impianto, "nome"))

    def register_tenant(self, tenant: Any) -> str:
        return self.register("AZIENDA", _get(tenant, "id"), _get(tenant, "nome"))

    def register_utente(self, utente: Any) -> str:
        return self.register("UTENTE", _get(utente, "id"), _get(utente, "username"))

    def register_many(self, kind: str, entities: Iterable[Any]) -> None:
        """Registra una collezione usando il metodo specifico del tipo indicato."""
        registrar = {
            "asset": self.register_asset,
            "tecnico": self.register_tecnico,
            "sito": self.register_sito,
            "impianto": self.register_impianto,
            "tenant": self.register_tenant,
            "utente": self.register_utente,
        }[kind.lower()]
        for entity in entities or []:
            registrar(entity)

    # ── Masking ──────────────────────────────────────────────────────────────

    def mask_text(self, text: Any) -> Any:
        """
        Sostituisce i valori registrati con i rispettivi token, poi applica le regex PII
        residue (email, telefoni) di ``AnonymizationService``.
        """
        if not isinstance(text, str) or not text:
            return text

        pattern = self._mask_pattern()
        if pattern is not None:
            text = pattern.sub(
                lambda m: self._to_token[m.group(0).lower()],
                text,
            )
        return anonymizer.mask_text(text)

    def mask_payload(self, data: Any) -> Any:
        """Applica il masking ricorsivamente a dict/list, oscurando le chiavi geografiche."""
        if isinstance(data, str):
            return self.mask_text(data)

        if isinstance(data, dict):
            masked: dict[Any, Any] = {}
            for key, value in data.items():
                key_lower = str(key).lower()
                if any(hint in key_lower for hint in _COORDINATE_KEY_HINTS):
                    masked[key] = _MASKED_POS
                else:
                    masked[key] = self.mask_payload(value)
            return masked

        if isinstance(data, list):
            return [self.mask_payload(item) for item in data]

        if isinstance(data, tuple):
            return tuple(self.mask_payload(item) for item in data)

        return data

    # ── Restore ──────────────────────────────────────────────────────────────

    def restore(self, data: Any) -> Any:
        """
        Operazione inversa: rimpiazza i token con i valori reali. Da applicare all'output
        dell'AI **prima** di mostrarlo all'utente o di persisterlo.
        """
        if isinstance(data, str):
            pattern = self._restore_pattern()
            if pattern is None or not data:
                return data
            return pattern.sub(lambda m: self._to_real[m.group(0)], data)

        if isinstance(data, dict):
            return {key: self.restore(value) for key, value in data.items()}

        if isinstance(data, list):
            return [self.restore(item) for item in data]

        if isinstance(data, tuple):
            return tuple(self.restore(item) for item in data)

        return data

    # ── Diagnostica ──────────────────────────────────────────────────────────

    def stats(self) -> dict[str, int]:
        """
        Conteggi per il logging. **Non ritorna mai contenuti**: i valori reali non devono
        finire in ``SystemLog`` (vedi ``backend/core/logger_db.py``).
        """
        by_kind: dict[str, int] = {}
        for token in self._to_real:
            kind = token.rsplit("_", 1)[0]
            by_kind[kind] = by_kind.get(kind, 0) + 1
        by_kind["_totale_valori"] = len(self._to_token)
        return by_kind

    def __len__(self) -> int:
        return len(self._to_token)

    # ── Interno ──────────────────────────────────────────────────────────────

    def _mask_pattern(self) -> re.Pattern[str] | None:
        if self._mask_re is None and self._to_token:
            # Match dal più lungo al più corto: "Mario Rossi" deve vincere su "Mario".
            values = sorted(self._to_token, key=len, reverse=True)
            alternation = "|".join(re.escape(v) for v in values)
            self._mask_re = re.compile(
                rf"(?<![0-9A-Za-zÀ-ÿ])(?:{alternation})(?![0-9A-Za-zÀ-ÿ])",
                re.IGNORECASE,
            )
        return self._mask_re

    def _restore_pattern(self) -> re.Pattern[str] | None:
        if self._restore_re is None and self._to_real:
            tokens = sorted(self._to_real, key=len, reverse=True)
            self._restore_re = re.compile(
                rf"\b(?:{'|'.join(re.escape(t) for t in tokens)})\b"
            )
        return self._restore_re


def build_pseudonymizer(
    *,
    assets: Iterable[Any] | None = None,
    tecnici: Iterable[Any] | None = None,
    siti: Iterable[Any] | None = None,
    impianti: Iterable[Any] | None = None,
    tenant: Any | None = None,
) -> Pseudonymizer:
    """Scorciatoia per costruire e popolare un pseudonimizzatore in una sola chiamata."""
    pseudo = Pseudonymizer()
    if tenant is not None:
        pseudo.register_tenant(tenant)
    pseudo.register_many("sito", siti or [])
    pseudo.register_many("impianto", impianti or [])
    pseudo.register_many("asset", assets or [])
    pseudo.register_many("tecnico", tecnici or [])
    return pseudo
