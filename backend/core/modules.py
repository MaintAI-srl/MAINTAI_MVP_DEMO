from __future__ import annotations

import os
import json
import time
from dataclasses import asdict, dataclass
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
    "spare_parts": ModuleDefinition(
        id="spare_parts",
        name="Magazzino ricambi",
        description="Anagrafica ricambi, giacenze, movimenti e vincolo ricambi sulla pianificazione.",
        category="risorse",
        requires=("tickets",),
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
    "xr_viewer": ModuleDefinition(
        id="xr_viewer",
        name="Visore XR (prototipo)",
        description="Manuale PDF in realta mista su visore: QR asset, sessione WebXR immersive-ar, pannello di lettura.",
        category="campo",
        requires=("assets",),
        # Attivo di default. Tenerlo spento a livello globale rendeva il prototipo
        # irraggiungibile anche dopo averlo acceso sul singolo tenant: i moduli
        # effettivi di un tenant sono `override & globale` (vedi effective_enabled_ids),
        # quindi la config globale funziona da kill-switch. Si disattiva dalla
        # pagina Funzionalita, globalmente o per singolo cliente.
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
    # ── Agenti AI (trigger manuale dalla topbar) ─────────────────────────────
    "agent_planner": ModuleDefinition(
        id="agent_planner",
        name="Agente Planner",
        description="Esperto di scheduling lean: analizza backlog, carichi e assenze e suggerisce come ottimizzare il piano.",
        category="agenti",
        requires=("tickets", "technicians", "assets"),
    ),
    "agent_rca": ModuleDefinition(
        id="agent_rca",
        name="Agente RCA",
        description="Esperto di root cause analysis: Pareto dei guasti, cause ricorrenti e contromisure lean.",
        category="agenti",
        requires=("tickets", "assets"),
    ),
    "agent_cost_controller": ModuleDefinition(
        id="agent_cost_controller",
        name="Agente Cost Controller",
        description="Esperto di controllo costi di manutenzione: Pareto dei costi, muda e azioni di riduzione.",
        category="agenti",
        requires=("tickets", "assets"),
    ),
    "agent_kpi": ModuleDefinition(
        id="agent_kpi",
        name="Agente KPI",
        description="Esperto di KPI manutentivi: MTTR, backlog, mix PM/CM e lettura lean degli indicatori.",
        category="agenti",
        requires=("tickets",),
    ),
    "agent_strategy": ModuleDefinition(
        id="agent_strategy",
        name="Suggeritore Strategie Manutenzione",
        description="Esperto di strategie manutentive (RTF/preventiva/predittiva/TPM): propone la strategia giusta per asset.",
        category="agenti",
        requires=("tickets", "assets"),
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


def _env_baseline_enabled_ids() -> set[str]:
    """Moduli attivi secondo env + default di codice, prima delle decisioni salvate."""
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

    return enabled


def _configured_enabled_ids() -> set[str]:
    return _apply_decisions(_env_baseline_enabled_ids(), _global_decisions())


# ── Decisioni esplicite per modulo ───────────────────────────────────────────
# Una configurazione salvata NON è una whitelist: è l'insieme delle decisioni
# esplicite (accendi/spegni) prese sui moduli *noti al momento del salvataggio*.
#
# Con la whitelist ogni modulo introdotto dopo un salvataggio restava spento per
# sempre e nessun default di codice poteva riaccenderlo: è il bug per cui la
# pagina /xr non compariva e l'interruttore del cliente "tornava indietro" dopo
# il salvataggio (2026-07-26). Registrando anche l'elenco dei moduli noti al
# salvataggio (`known`), un modulo nuovo non ha decisione e ricade sul proprio
# default (globale) o sulla configurazione globale (tenant).


@dataclass(frozen=True)
class ModuleDecisions:
    on: frozenset[str] = frozenset()
    off: frozenset[str] = frozenset()


EMPTY_DECISIONS = ModuleDecisions()


def _decisions_from_raw(raw: Any) -> ModuleDecisions:
    """Interpreta una configurazione salvata come decisioni esplicite.

    Formato corrente: `{"enabled": [...], "known": [...]}` → `off = known - enabled`.

    Formato legacy (lista nuda, o dict senza `known`): whitelist. Non è
    possibile distinguere "spento per scelta" da "non esisteva ancora", quindi i
    moduli assenti ricadono sul default invece di restare spenti in modo
    invisibile e non diagnosticabile. Un modulo spento per scelta va rispento
    una volta: dal salvataggio successivo la decisione è registrata e persiste.
    """
    known_ids = set(MODULE_DEFINITIONS)

    if isinstance(raw, list):
        values: Any = raw
        known_raw: Any = None
    elif isinstance(raw, dict):
        values = raw.get("enabled")
        known_raw = raw.get("known")
    else:
        return EMPTY_DECISIONS

    if not isinstance(values, list):
        return EMPTY_DECISIONS

    on = {_normalize_module_id(str(value)) for value in values} & known_ids
    if not isinstance(known_raw, list):
        return ModuleDecisions(on=frozenset(on), off=frozenset())

    known_at_save = {_normalize_module_id(str(value)) for value in known_raw} & known_ids
    return ModuleDecisions(on=frozenset(on), off=frozenset(known_at_save - on))


def _raw_from_enabled(enabled: set[str]) -> dict[str, Any]:
    """Serializza le decisioni: cosa è attivo + cosa esisteva al salvataggio."""
    return {
        "enabled": sorted(enabled),
        "known": sorted(MODULE_DEFINITIONS),
        "version": 2,
    }


def _apply_decisions(base: set[str], decisions: ModuleDecisions) -> set[str]:
    return (base | set(decisions.on)) - set(decisions.off)


# ── Configurazione globale (DB, con il file come sorgente legacy) ────────────

_GLOBAL_CACHE_TTL_SECONDS = 30.0
_global_decisions_cache: tuple[float, ModuleDecisions] | None = None


def _read_state_file_decisions() -> ModuleDecisions | None:
    try:
        if not STATE_FILE.exists():
            return None
        return _decisions_from_raw(json.loads(STATE_FILE.read_text(encoding="utf-8")))
    except Exception:
        return None


def _load_global_decisions_from_db() -> ModuleDecisions | None:
    from backend.core.database import SessionLocal
    from backend.db.modelli import GlobalModuleConfig

    db = SessionLocal()
    try:
        row = db.query(GlobalModuleConfig).order_by(GlobalModuleConfig.id).first()
        if row is None:
            return None
        return _decisions_from_raw(json.loads(row.config or "{}"))
    finally:
        db.close()


def _global_decisions() -> ModuleDecisions:
    global _global_decisions_cache

    now = time.monotonic()
    cached = _global_decisions_cache
    if cached and cached[0] > now:
        return cached[1]

    decisions: ModuleDecisions | None = None
    try:
        decisions = _load_global_decisions_from_db()
    except Exception:
        # Tabella non ancora creata o DB momentaneamente non disponibile: si
        # ripiega sul file legacy senza mettere in cache l'errore.
        return _read_state_file_decisions() or EMPTY_DECISIONS

    if decisions is None:
        decisions = _read_state_file_decisions() or EMPTY_DECISIONS

    _global_decisions_cache = (now + _GLOBAL_CACHE_TTL_SECONDS, decisions)
    return decisions


def _set_global_decisions_cache(decisions: ModuleDecisions) -> None:
    global _global_decisions_cache

    _global_decisions_cache = (time.monotonic() + _GLOBAL_CACHE_TTL_SECONDS, decisions)
    _enabled_cache_clear()


def invalidate_module_caches() -> None:
    """Azzera le cache di processo della configurazione moduli."""
    global _global_decisions_cache

    _global_decisions_cache = None
    _tenant_override_cache.clear()
    _enabled_cache_clear()


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


_enabled_cache: tuple[float, frozenset[str]] | None = None


def _enabled_cache_clear() -> None:
    global _enabled_cache

    _enabled_cache = None


def enabled_module_ids() -> frozenset[str]:
    global _enabled_cache

    now = time.monotonic()
    cached = _enabled_cache
    if cached and cached[0] > now:
        return cached[1]
    value = frozenset(_resolve_dependencies(_configured_enabled_ids()))
    _enabled_cache = (now + _GLOBAL_CACHE_TTL_SECONDS, value)
    return value


def is_module_enabled(module_id: str) -> bool:
    return _normalize_module_id(module_id) in enabled_module_ids()


def _normalize_requested(module_ids: list[str]) -> set[str]:
    known = set(MODULE_DEFINITIONS)
    return {
        _normalize_module_id(module_id)
        for module_id in module_ids
        if _normalize_module_id(module_id) in known
    }


def _payload_from_enabled(
    enabled: frozenset[str],
    scope: str,
    tenant_id: int | None,
    has_override: bool,
    plan_allowed: frozenset[str] | None = None,
) -> dict[str, Any]:
    global_enabled = enabled_module_ids()
    modules = []
    for module_id, definition in MODULE_DEFINITIONS.items():
        item = asdict(definition)
        item["requires"] = list(definition.requires)
        item["enabled"] = module_id in enabled
        # Un modulo spento globalmente non è attivabile per singolo cliente: la
        # UI deve poterlo dire, invece di far "tornare indietro" l'interruttore
        # dopo un salvataggio andato a buon fine.
        item["blocked_by_global"] = module_id not in global_enabled
        # Stesso ragionamento per il tetto commerciale: se il modulo non è nel
        # piano, l'interruttore non deve promettere qualcosa che non accadrà.
        item["blocked_by_plan"] = plan_allowed is not None and module_id not in plan_allowed
        modules.append(item)

    return {
        "enabled": sorted(enabled),
        "disabled": sorted(set(MODULE_DEFINITIONS) - set(enabled)),
        "modules": modules,
        "scope": scope,
        "tenant_id": tenant_id,
        "has_override": has_override,
        "global_enabled": sorted(global_enabled),
        "blocked_by_global": sorted(set(MODULE_DEFINITIONS) - set(global_enabled)),
        "plan_allowed": sorted(plan_allowed) if plan_allowed is not None else None,
        "blocked_by_plan": (
            sorted(set(MODULE_DEFINITIONS) - set(plan_allowed)) if plan_allowed is not None else []
        ),
    }


def modules_payload() -> dict[str, Any]:
    return _payload_from_enabled(enabled_module_ids(), "global", None, False)


def _write_global_config(raw: dict[str, Any]) -> None:
    """Persiste la config globale nel DB primario.

    Sempre `SessionLocal`, mai la sessione della richiesta: la configurazione
    globale vale per tutto il deploy e non deve finire nel DB demo (`get_db`
    instrada su demo.db per i JWT con `is_demo=True`), altrimenti la lettura —
    che avviene sul DB primario — non la vedrebbe mai.
    """
    from backend.core.database import SessionLocal
    from backend.db.modelli import GlobalModuleConfig

    db = SessionLocal()
    try:
        row = db.query(GlobalModuleConfig).order_by(GlobalModuleConfig.id).first()
        if row is None:
            row = GlobalModuleConfig(id=1)
            db.add(row)
        row.config = json.dumps(raw, ensure_ascii=False)
        db.commit()
    finally:
        db.close()


def set_enabled_module_ids(module_ids: list[str]) -> dict[str, Any]:
    resolved = _resolve_dependencies(_normalize_requested(module_ids))
    raw = _raw_from_enabled(resolved)
    try:
        _write_global_config(raw)
    except Exception:
        # Se il DB non è disponibile la configurazione non va persa: si scrive il
        # file, che resta comunque letto come sorgente legacy all'avvio.
        STATE_FILE.parent.mkdir(parents=True, exist_ok=True)
        STATE_FILE.write_text(
            json.dumps(raw, ensure_ascii=False, indent=2), encoding="utf-8"
        )
    _set_global_decisions_cache(_decisions_from_raw(raw))
    # Un cambio globale può sbloccare/bloccare moduli per i tenant con override.
    _tenant_override_cache.clear()
    return modules_payload()


# ── Configurazione moduli per-tenant ─────────────────────────────────────────
# Override salvato in DB (tabella tenant_module_config, una riga per tenant).
# Semantica: se il tenant ha un override, i suoi moduli attivi sono
# (globale + accesi dal tenant) - (spenti dal tenant), il tutto intersecato con
# il globale (che resta un kill-switch); senza override vale la configurazione
# globale. Un modulo su cui il tenant non ha una decisione esplicita — tipico
# dei moduli introdotti dopo l'ultimo salvataggio — segue il globale.
# Cache in-memory con TTL breve per non interrogare il DB a ogni richiesta
# (stesso accepted-risk del rate limiter: cache per processo, worker singolo).

_TENANT_CACHE_TTL_SECONDS = 30.0
_tenant_override_cache: dict[int, tuple[float, ModuleDecisions | None]] = {}


def _load_tenant_decisions(db, tenant_id: int) -> ModuleDecisions | None:
    from backend.db.modelli import TenantModuleConfig

    row = (
        db.query(TenantModuleConfig)
        .filter(TenantModuleConfig.tenant_id == tenant_id)
        .first()
    )
    if row is None:
        return None
    try:
        raw = json.loads(row.enabled or "{}")
    except (TypeError, ValueError):
        return None
    return _decisions_from_raw(raw)


def get_tenant_decisions(db, tenant_id: int) -> ModuleDecisions | None:
    """Decisioni moduli del tenant, o None se il tenant usa la config globale."""
    now = time.monotonic()
    cached = _tenant_override_cache.get(tenant_id)
    if cached and cached[0] > now:
        return cached[1]
    try:
        decisions = _load_tenant_decisions(db, tenant_id)
    except Exception:
        # Tabella non ancora migrata o DB momentaneamente non disponibile:
        # fallback alla configurazione globale, senza cache dell'errore.
        return None
    _tenant_override_cache[tenant_id] = (now + _TENANT_CACHE_TTL_SECONDS, decisions)
    return decisions


def _plan_allowed_ids(db, tenant_id: int) -> frozenset[str] | None:
    """Moduli concessi dal piano commerciale, o None se non c'è restrizione.

    Il livello commerciale è il **terzo** livello di risoluzione, non un sistema
    parallelo di feature flag: si inserisce fra il kill-switch globale e le
    decisioni del tenant. La scelta è deliberata — due meccanismi di gating
    indipendenti sullo stesso modulo produrrebbero, prima o poi, un cliente che
    paga una funzione e non la vede, senza che nessuna delle due pagine di
    amministrazione sappia spiegare perché.

    Fail-open: se il livello commerciale non è leggibile, nessuna restrizione.
    """
    try:
        from backend.services.billing.entitlement_service import resolve_entitlements

        return resolve_entitlements(db, tenant_id).allowed_module_ids()
    except Exception:
        return None


def effective_enabled_ids(db, tenant_id: int | None) -> frozenset[str]:
    global_enabled = enabled_module_ids()
    if tenant_id is None:
        return global_enabled

    # Tetto commerciale: globale ∩ piano. È il massimo che il tenant può avere,
    # e resta il riferimento anche dopo le sue decisioni.
    plan_allowed = _plan_allowed_ids(db, tenant_id)
    ceiling = global_enabled if plan_allowed is None else frozenset(global_enabled & plan_allowed)

    decisions = get_tenant_decisions(db, tenant_id)
    if decisions is None:
        return frozenset(_resolve_dependencies(set(ceiling)))
    wanted = _apply_decisions(set(ceiling), decisions)
    # Kill-switch globale + tetto di piano: il tenant non può accendere né ciò
    # che è spento in globale né ciò che il suo piano non comprende.
    return frozenset(_resolve_dependencies(wanted & set(ceiling)))


def is_module_enabled_for_tenant(db, module_id: str, tenant_id: int | None) -> bool:
    return _normalize_module_id(module_id) in effective_enabled_ids(db, tenant_id)


def modules_payload_for(db, tenant_id: int | None) -> dict[str, Any]:
    if tenant_id is None:
        return modules_payload()
    has_override = get_tenant_decisions(db, tenant_id) is not None
    return _payload_from_enabled(
        effective_enabled_ids(db, tenant_id),
        "tenant" if has_override else "global",
        tenant_id,
        has_override,
        plan_allowed=_plan_allowed_ids(db, tenant_id),
    )


def set_tenant_enabled_module_ids(db, tenant_id: int, module_ids: list[str]) -> dict[str, Any]:
    from backend.db.modelli import TenantModuleConfig

    resolved = _resolve_dependencies(_normalize_requested(module_ids))

    row = (
        db.query(TenantModuleConfig)
        .filter(TenantModuleConfig.tenant_id == tenant_id)
        .first()
    )
    if row is None:
        row = TenantModuleConfig(tenant_id=tenant_id)
        db.add(row)
    row.enabled = json.dumps(_raw_from_enabled(resolved), ensure_ascii=False)
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
