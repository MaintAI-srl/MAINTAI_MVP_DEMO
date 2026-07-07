from __future__ import annotations

import os
import json
from dataclasses import asdict, dataclass
from functools import lru_cache
from pathlib import Path
from typing import Any


TRUE_VALUES = {"1", "true", "yes", "y", "on", "enabled", "active"}
FALSE_VALUES = {"0", "false", "no", "n", "off", "disabled", "inactive"}
STATE_FILE = Path(os.getenv("MAINTAI_MODULES_STATE_FILE", "backend/modules_state.json"))


@dataclass(frozen=True)
class ModuleDefinition:
    id: str
    name: str
    description: str
    category: str
    default_enabled: bool = True
    requires: tuple[str, ...] = ()


MODULE_DEFINITIONS: dict[str, ModuleDefinition] = {
    "dashboard": ModuleDefinition(
        id="dashboard",
        name="Dashboard KPI",
        description="KPI operativi, grafici e indicatori in tempo reale.",
        category="operazioni",
    ),
    "assets": ModuleDefinition(
        id="assets",
        name="Siti, impianti e asset",
        description="Anagrafica tecnica, documenti asset, QR code, procedure e note.",
        category="risorse",
    ),
    "technicians": ModuleDefinition(
        id="technicians",
        name="Tecnici",
        description="Anagrafica tecnici, competenze, assenze e disponibilita.",
        category="risorse",
    ),
    "tickets": ModuleDefinition(
        id="tickets",
        name="Ticket",
        description="Gestione ticket, allegati, stati, export e kanban.",
        category="operazioni",
    ),
    "planning": ModuleDefinition(
        id="planning",
        name="Piano AI Felix",
        description="Pianificazione deterministica/AI, storico piani e feedback.",
        category="operazioni",
        requires=("tickets", "assets", "technicians"),
    ),
    "diagnostic_ai": ModuleDefinition(
        id="diagnostic_ai",
        name="Diagnostica AI",
        description="Sessioni RCA guidate, problem analysis e failure intelligence.",
        category="ai",
        requires=("tickets", "assets"),
    ),
    "maintenance_plans": ModuleDefinition(
        id="maintenance_plans",
        name="Piani di manutenzione",
        description="Task manutentivi, generazione ticket e piani multi-asset.",
        category="risorse",
        requires=("tickets", "assets"),
    ),
    "manuals": ModuleDefinition(
        id="manuals",
        name="Manuali PDF",
        description="Upload manuali, parsing PDF e import nei piani.",
        category="ai",
        requires=("maintenance_plans",),
    ),
    "deadlines": ModuleDefinition(
        id="deadlines",
        name="Scadenziario",
        description="Scadenze manutentive imminenti e calendario PM.",
        category="operazioni",
        requires=("maintenance_plans",),
    ),
    "condition_maintenance": ModuleDefinition(
        id="condition_maintenance",
        name="Manutenzione su condizione",
        description="Letture ore, soglie condition-based e trigger automatici.",
        category="operazioni",
        requires=("assets", "maintenance_plans"),
    ),
    "email_to_ticket": ModuleDefinition(
        id="email_to_ticket",
        name="Email to Ticket",
        description="Configurazione IMAP e polling automatico delle mailbox.",
        category="integrazioni",
        requires=("tickets",),
        # Change request 2026-07-05: funzione nascosta e disattivata di default.
        # Riattivabile via env MAINTAI_MODULE_EMAIL_TO_TICKET=true (endpoint + poller + UI).
        default_enabled=False,
    ),
    "system_logs": ModuleDefinition(
        id="system_logs",
        name="Log di sistema",
        description="Consultazione e pulizia dei log persistenti.",
        category="admin",
    ),
    "bulk_import": ModuleDefinition(
        id="bulk_import",
        name="Import massivo",
        description="Import strutturato da template Excel/CSV.",
        category="admin",
        requires=("assets", "technicians"),
    ),
    "tenant_admin": ModuleDefinition(
        id="tenant_admin",
        name="Gestione clienti",
        description="Amministrazione tenant e utenti tenant.",
        category="admin",
    ),
    "user_admin": ModuleDefinition(
        id="user_admin",
        name="Gestione utenti",
        description="Creazione utenti e reset password.",
        category="admin",
    ),
    "compliance": ModuleDefinition(
        id="compliance",
        name="Compliance attestati",
        description="Scadenziario attestati e certificazioni tecnici.",
        category="admin",
        requires=("technicians",),
    ),
    "economic_reports": ModuleDefinition(
        id="economic_reports",
        name="Report economico",
        description="Costi fermo, ricambi e reportistica economica.",
        category="admin",
        requires=("tickets", "assets"),
    ),
    "emergency": ModuleDefinition(
        id="emergency",
        name="Emergenze",
        description="Ricerca tecnici piu vicini e supporto emergenze.",
        category="operazioni",
        requires=("tickets", "technicians"),
    ),
    "control_center": ModuleDefinition(
        id="control_center",
        name="Centro di Controllo",
        description="Mappa di supervisione siti con stato asset e work order.",
        category="operazioni",
        requires=("assets",),
    ),
    "mobile_app": ModuleDefinition(
        id="mobile_app",
        name="App tecnico",
        description="Vista mobile per tecnici, piano del giorno, QR e voce.",
        category="campo",
        requires=("tickets", "assets"),
    ),
    "weather": ModuleDefinition(
        id="weather",
        name="Meteo",
        description="Widget meteo e vincoli meteo usati dalla pianificazione.",
        category="integrazioni",
    ),
    "desktop_updates": ModuleDefinition(
        id="desktop_updates",
        name="Aggiornamenti desktop",
        description="Manifest aggiornamenti per build Tauri desktop.",
        category="desktop",
    ),
    "guide_ai": ModuleDefinition(
        id="guide_ai",
        name="Guida AI",
        description="Assistente contestuale dell'applicazione.",
        category="ai",
        default_enabled=False,
    ),
}


def _normalize_module_id(value: str) -> str:
    return value.strip().lower().replace("-", "_")


def _split_env(*names: str) -> set[str]:
    values: set[str] = set()
    for name in names:
        raw = os.getenv(name, "")
        if not raw.strip():
            continue
        values.update(
            _normalize_module_id(part)
            for part in raw.split(",")
            if part.strip()
        )
    return values


def _env_bool(*names: str) -> bool | None:
    for name in names:
        raw = os.getenv(name)
        if raw is None:
            continue
        normalized = raw.strip().lower()
        if normalized in TRUE_VALUES:
            return True
        if normalized in FALSE_VALUES:
            return False
    return None


def _module_env_names(module_id: str) -> tuple[str, ...]:
    suffix = module_id.upper()
    return (
        f"MAINTAI_MODULE_{suffix}",
        f"MAINTAI_FEATURE_{suffix}",
        f"FEATURE_{suffix}",
    )


def _configured_enabled_ids() -> set[str]:
    known = set(MODULE_DEFINITIONS)
    explicit_enabled = _split_env("MAINTAI_MODULES_ENABLED", "FEATURE_MODULES_ENABLED")

    if explicit_enabled:
        enabled = explicit_enabled & known
    else:
        enabled = {
            module_id
            for module_id, definition in MODULE_DEFINITIONS.items()
            if definition.default_enabled
        }

    disabled = _split_env("MAINTAI_MODULES_DISABLED", "FEATURE_MODULES_DISABLED")
    enabled -= disabled & known

    for module_id in MODULE_DEFINITIONS:
        override = _env_bool(*_module_env_names(module_id))
        if override is True:
            enabled.add(module_id)
        elif override is False:
            enabled.discard(module_id)

    state_enabled = _read_state_enabled_ids()
    if state_enabled is not None:
        enabled = state_enabled & known

    return enabled


def _read_state_enabled_ids() -> set[str] | None:
    try:
        if not STATE_FILE.exists():
            return None
        payload = json.loads(STATE_FILE.read_text(encoding="utf-8"))
        values = payload.get("enabled")
        if not isinstance(values, list):
            return None
        return {_normalize_module_id(str(value)) for value in values}
    except Exception:
        return None


def _resolve_dependencies(enabled: set[str]) -> set[str]:
    resolved = set(enabled)
    changed = True
    while changed:
        changed = False
        for module_id in list(resolved):
            missing = [
                dependency
                for dependency in MODULE_DEFINITIONS[module_id].requires
                if dependency not in resolved
            ]
            if missing:
                resolved.remove(module_id)
                changed = True
    return resolved


@lru_cache(maxsize=1)
def enabled_module_ids() -> frozenset[str]:
    return frozenset(_resolve_dependencies(_configured_enabled_ids()))


def is_module_enabled(module_id: str) -> bool:
    return _normalize_module_id(module_id) in enabled_module_ids()


def _payload_from_enabled(
    enabled: frozenset[str],
    scope: str,
    tenant_id: int | None,
    has_override: bool,
) -> dict[str, Any]:
    modules = []
    for module_id, definition in MODULE_DEFINITIONS.items():
        item = asdict(definition)
        item["requires"] = list(definition.requires)
        item["enabled"] = module_id in enabled
        modules.append(item)

    return {
        "enabled": sorted(enabled),
        "disabled": sorted(set(MODULE_DEFINITIONS) - set(enabled)),
        "modules": modules,
        "scope": scope,
        "tenant_id": tenant_id,
        "has_override": has_override,
    }


def modules_payload() -> dict[str, Any]:
    return _payload_from_enabled(enabled_module_ids(), "global", None, False)


def set_enabled_module_ids(module_ids: list[str]) -> dict[str, Any]:
    known = set(MODULE_DEFINITIONS)
    normalized = {
        _normalize_module_id(module_id)
        for module_id in module_ids
        if _normalize_module_id(module_id) in known
    }
    resolved = _resolve_dependencies(normalized)
    STATE_FILE.parent.mkdir(parents=True, exist_ok=True)
    STATE_FILE.write_text(
        json.dumps({"enabled": sorted(resolved)}, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    enabled_module_ids.cache_clear()
    return modules_payload()


# ── Configurazione moduli per-tenant ─────────────────────────────────────────
# Override salvato in DB (tabella tenant_module_config, una riga per tenant).
# Semantica: se il tenant ha un override, i suoi moduli attivi sono
# override ∩ globale (la config globale resta un kill-switch); senza override
# vale la configurazione globale. Cache in-memory con TTL breve per non
# interrogare il DB a ogni richiesta (stesso accepted-risk del rate limiter:
# contatori per processo, deploy a singolo worker).

import time

_TENANT_CACHE_TTL_SECONDS = 30.0
_tenant_override_cache: dict[int, tuple[float, frozenset[str] | None]] = {}


def _load_tenant_override(db, tenant_id: int) -> frozenset[str] | None:
    from backend.db.modelli import TenantModuleConfig

    row = (
        db.query(TenantModuleConfig)
        .filter(TenantModuleConfig.tenant_id == tenant_id)
        .first()
    )
    if row is None:
        return None
    try:
        values = json.loads(row.enabled or "[]")
    except (TypeError, ValueError):
        return None
    if not isinstance(values, list):
        return None
    normalized = {_normalize_module_id(str(v)) for v in values} & set(MODULE_DEFINITIONS)
    return frozenset(_resolve_dependencies(normalized))


def get_tenant_override(db, tenant_id: int) -> frozenset[str] | None:
    """Override moduli del tenant, o None se il tenant usa la config globale."""
    now = time.monotonic()
    cached = _tenant_override_cache.get(tenant_id)
    if cached and cached[0] > now:
        return cached[1]
    try:
        override = _load_tenant_override(db, tenant_id)
    except Exception:
        # Tabella non ancora migrata o DB momentaneamente non disponibile:
        # fallback alla configurazione globale, senza cache dell'errore.
        return None
    _tenant_override_cache[tenant_id] = (now + _TENANT_CACHE_TTL_SECONDS, override)
    return override


def effective_enabled_ids(db, tenant_id: int | None) -> frozenset[str]:
    global_enabled = enabled_module_ids()
    if tenant_id is None:
        return global_enabled
    override = get_tenant_override(db, tenant_id)
    if override is None:
        return global_enabled
    return frozenset(_resolve_dependencies(set(override & global_enabled)))


def is_module_enabled_for_tenant(db, module_id: str, tenant_id: int | None) -> bool:
    return _normalize_module_id(module_id) in effective_enabled_ids(db, tenant_id)


def modules_payload_for(db, tenant_id: int | None) -> dict[str, Any]:
    if tenant_id is None:
        return modules_payload()
    has_override = get_tenant_override(db, tenant_id) is not None
    return _payload_from_enabled(
        effective_enabled_ids(db, tenant_id),
        "tenant" if has_override else "global",
        tenant_id,
        has_override,
    )


def set_tenant_enabled_module_ids(db, tenant_id: int, module_ids: list[str]) -> dict[str, Any]:
    from backend.db.modelli import TenantModuleConfig

    known = set(MODULE_DEFINITIONS)
    normalized = {
        _normalize_module_id(module_id)
        for module_id in module_ids
        if _normalize_module_id(module_id) in known
    }
    resolved = sorted(_resolve_dependencies(normalized))

    row = (
        db.query(TenantModuleConfig)
        .filter(TenantModuleConfig.tenant_id == tenant_id)
        .first()
    )
    if row is None:
        row = TenantModuleConfig(tenant_id=tenant_id)
        db.add(row)
    row.enabled = json.dumps(resolved, ensure_ascii=False)
    db.commit()
    _tenant_override_cache.pop(tenant_id, None)
    return modules_payload_for(db, tenant_id)


def clear_tenant_module_override(db, tenant_id: int) -> dict[str, Any]:
    from backend.db.modelli import TenantModuleConfig

    db.query(TenantModuleConfig).filter(
        TenantModuleConfig.tenant_id == tenant_id
    ).delete()
    db.commit()
    _tenant_override_cache.pop(tenant_id, None)
    return modules_payload_for(db, tenant_id)
