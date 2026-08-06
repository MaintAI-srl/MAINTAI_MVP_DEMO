"""Catalogo commerciale MaintAI — piani, quote e add-on.

Il catalogo è **definito nel codice**, non in tabella. Stessa scelta già fatta
per `MODULE_DEFINITIONS` in `backend/core/modules.py`, e per gli stessi motivi:

- un piano non è un dato del cliente ma una decisione di prodotto: sta nel repo,
  passa dalla code review, è versionato e si testa;
- una tabella `plans` + `plan_features` richiederebbe una UI di amministrazione
  che nessuno userebbe più di due volte l'anno, e aprirebbe la porta a stati
  incoerenti fra ambienti (piano presente in staging, assente in produzione);
- i **prezzi** restano comunque nel provider di pagamento (Stripe Price ID): qui
  ci sono solo per mostrarli in pagina, non per addebitarli.

Ciò che invece è dato del cliente — quale piano ha, quante licenze extra ha
comprato, fino a quando è pagato — sta in `subscriptions` (vedi
`backend/db/modelli.py`).

Convenzione prezzi: **centesimi di euro**, mai float (i float sui soldi si
sommano male).
"""

from __future__ import annotations

import os
from dataclasses import dataclass, field
from typing import Iterable


# Sentinella per "nessun limite". Preferita a None: i confronti numerici
# restano scritti una volta sola (`usage >= limit`) senza rami speciali.
UNLIMITED = -1


def is_unlimited(limit: int | None) -> bool:
    return limit is None or limit < 0


# ── Metriche soggette a quota ────────────────────────────────────────────────
# Due famiglie, con semantiche di misura diverse:
#
#   STOCK  — quanto ne esiste adesso (utenti, siti, asset). Si misura con una
#            COUNT sulla tabella: non serve un contatore, e soprattutto non può
#            andare in deriva rispetto alla realtà.
#   FLOW   — quanto se n'è consumato nel periodo (chiamate AI, export). Qui il
#            contatore serve davvero, perché il dato non è ricostruibile da una
#            COUNT sullo stato corrente.
#
# Il piano SaaS originale prevedeva `usage_counters` per tutte e due: è la
# ricetta per il bug "il contatore dice 3 utenti, la tabella ne ha 2".

METRIC_USERS = "users"
METRIC_SITES = "sites"
METRIC_ASSETS = "assets"
METRIC_AI_CALLS = "ai_calls"

STOCK_METRICS = (METRIC_USERS, METRIC_SITES, METRIC_ASSETS)
FLOW_METRICS = (METRIC_AI_CALLS,)
ALL_METRICS = STOCK_METRICS + FLOW_METRICS

METRIC_LABELS = {
    METRIC_USERS: "Utenti",
    METRIC_SITES: "Siti",
    METRIC_ASSETS: "Asset",
    METRIC_AI_CALLS: "Chiamate AI (mese)",
}


@dataclass(frozen=True)
class PlanDefinition:
    code: str
    name: str
    description: str
    # Prezzi in centesimi di euro, IVA esclusa.
    price_monthly: int
    price_yearly: int
    # Quote incluse nel canone base (gli add-on si sommano a queste).
    included_users: int
    included_sites: int
    included_assets: int
    included_ai_calls: int
    storage_mb: int
    support_level: str
    trial_days: int = 0
    # Moduli concessi dal piano. `None` = tutti quelli attivi globalmente.
    # NB: è un *tetto commerciale*, non la configurazione del cliente: i moduli
    # effettivi restano `globale ∩ piano` con sopra le decisioni del tenant.
    modules: tuple[str, ...] | None = None
    # Piano proponibile in self-service (compare su /pricing e in checkout).
    is_public: bool = True
    # Piano acquistabile online. False = "parlane con noi" (enterprise).
    is_self_serve: bool = True
    highlight: str | None = None
    features: tuple[str, ...] = field(default_factory=tuple)

    def limit_for(self, metric: str) -> int:
        return {
            METRIC_USERS: self.included_users,
            METRIC_SITES: self.included_sites,
            METRIC_ASSETS: self.included_assets,
            METRIC_AI_CALLS: self.included_ai_calls,
        }.get(metric, UNLIMITED)


@dataclass(frozen=True)
class AddonDefinition:
    code: str
    name: str
    description: str
    price_monthly: int
    metric: str
    # Quanta quota sblocca ogni unità acquistata.
    grants: int = 1


# ── Moduli per fascia ────────────────────────────────────────────────────────
# Solo l'ossatura: i moduli non elencati (weather, desktop_updates, guide_ai…)
# non sono argomenti di vendita e seguono la configurazione globale/tenant.

_CORE_MODULES = (
    "dashboard",
    "assets",
    "technicians",
    "tickets",
    "maintenance_plans",
    "deadlines",
    "planning",
    "system_logs",
    "user_admin",
    "mobile_app",
    "weather",
    "desktop_updates",
)

_PRO_MODULES = _CORE_MODULES + (
    "manuals",
    "diagnostic_ai",
    "condition_maintenance",
    "spare_parts",
    "bulk_import",
    "control_center",
    "compliance",
    "economic_reports",
    "emergency",
    "xr_viewer",
    "guide_ai",
    "agent_planner",
    "agent_rca",
    "agent_kpi",
    "agent_cost_controller",
    "agent_strategy",
    "email_to_ticket",
)


TRIAL_PLAN_CODE = "trial"
DEFAULT_PLAN_CODE = "start"


PLAN_DEFINITIONS: dict[str, PlanDefinition] = {
    # Il trial non è un piano commerciale: è il piano Pro a tempo, con quote
    # ridotte quanto basta a impedire che diventi un piano gratuito permanente.
    TRIAL_PLAN_CODE: PlanDefinition(
        code=TRIAL_PLAN_CODE,
        name="Prova gratuita",
        description="Tutte le funzioni del piano Professional per il periodo di prova.",
        price_monthly=0,
        price_yearly=0,
        included_users=5,
        included_sites=1,
        included_assets=50,
        included_ai_calls=100,
        storage_mb=512,
        support_level="email",
        trial_days=int(os.getenv("TRIAL_DAYS", "14")),
        modules=_PRO_MODULES,
        is_public=False,
        features=(
            "Tutte le funzioni Professional",
            "Nessuna carta di credito richiesta",
            "I dati restano tuoi alla conversione",
        ),
    ),
    "start": PlanDefinition(
        code="start",
        name="Start",
        description="Manutenzione strutturata per un singolo stabilimento.",
        price_monthly=25000,
        price_yearly=250000,
        included_users=3,
        included_sites=1,
        included_assets=150,
        included_ai_calls=200,
        storage_mb=2048,
        support_level="standard",
        modules=_CORE_MODULES,
        features=(
            "Ticket, work order e anagrafica asset",
            "Manutenzione preventiva e scadenziario",
            "Piano AI Felix (motore deterministico)",
            "Dashboard KPI e app tecnico",
            "3 utenti e 1 sito inclusi",
        ),
    ),
    "pro": PlanDefinition(
        code="pro",
        name="Professional",
        description="Multi-sito, diagnostica AI, magazzino e reportistica economica.",
        price_monthly=59000,
        price_yearly=590000,
        included_users=10,
        included_sites=3,
        included_assets=1000,
        included_ai_calls=2000,
        storage_mb=20480,
        support_level="prioritario",
        modules=_PRO_MODULES,
        highlight="Il più scelto",
        features=(
            "Tutto il piano Start",
            "Diagnostica AI e analisi manuali PDF",
            "Agenti AI, magazzino ricambi, centro di controllo",
            "Report economico e compliance attestati",
            "10 utenti e 3 siti inclusi",
        ),
    ),
    "enterprise": PlanDefinition(
        code="enterprise",
        name="Enterprise",
        description="Gruppi multi-stabilimento, SSO, SLA e onboarding assistito.",
        price_monthly=0,
        price_yearly=0,
        included_users=UNLIMITED,
        included_sites=UNLIMITED,
        included_assets=UNLIMITED,
        included_ai_calls=UNLIMITED,
        storage_mb=UNLIMITED,
        support_level="dedicato",
        modules=None,
        is_self_serve=False,
        features=(
            "Utenti, siti e asset illimitati",
            "SLA contrattualizzato e ambiente dedicato",
            "Onboarding e migrazione dati assistiti",
        ),
    ),
}


ADDON_DEFINITIONS: dict[str, AddonDefinition] = {
    "extra_user": AddonDefinition(
        code="extra_user",
        name="Utente aggiuntivo",
        description="Un utente nominale in più, oltre a quelli inclusi nel piano.",
        price_monthly=3900,
        metric=METRIC_USERS,
    ),
    "extra_site": AddonDefinition(
        code="extra_site",
        name="Sito aggiuntivo",
        description="Un ulteriore stabilimento con i suoi impianti e asset.",
        price_monthly=19000,
        metric=METRIC_SITES,
    ),
}


def get_plan(code: str | None) -> PlanDefinition | None:
    if not code:
        return None
    return PLAN_DEFINITIONS.get(code.strip().lower())


def require_plan(code: str) -> PlanDefinition:
    plan = get_plan(code)
    if plan is None:
        raise KeyError(f"Piano commerciale sconosciuto: {code!r}")
    return plan


def public_plans() -> list[PlanDefinition]:
    """Piani mostrabili nella pagina prezzi, dal più economico al più caro."""
    return sorted(
        (p for p in PLAN_DEFINITIONS.values() if p.is_public),
        key=lambda p: (not p.is_self_serve, p.price_monthly),
    )


def self_serve_plan_codes() -> set[str]:
    return {p.code for p in PLAN_DEFINITIONS.values() if p.is_self_serve and p.is_public}


def addons_for_metric(metric: str) -> list[AddonDefinition]:
    return [a for a in ADDON_DEFINITIONS.values() if a.metric == metric]


def plan_to_dict(plan: PlanDefinition) -> dict:
    return {
        "code": plan.code,
        "name": plan.name,
        "description": plan.description,
        "price_monthly": plan.price_monthly,
        "price_yearly": plan.price_yearly,
        "currency": "EUR",
        "included_users": plan.included_users,
        "included_sites": plan.included_sites,
        "included_assets": plan.included_assets,
        "included_ai_calls": plan.included_ai_calls,
        "storage_mb": plan.storage_mb,
        "support_level": plan.support_level,
        "trial_days": plan.trial_days,
        "is_self_serve": plan.is_self_serve,
        "highlight": plan.highlight,
        "features": list(plan.features),
        "modules": list(plan.modules) if plan.modules is not None else None,
    }


def addon_to_dict(addon: AddonDefinition) -> dict:
    return {
        "code": addon.code,
        "name": addon.name,
        "description": addon.description,
        "price_monthly": addon.price_monthly,
        "currency": "EUR",
        "metric": addon.metric,
        "grants": addon.grants,
    }


def format_price(cents: int, currency: str = "EUR") -> str:
    """Prezzo leggibile lato log/email. La UI formatta per conto suo."""
    symbol = {"EUR": "€", "USD": "$"}.get(currency, currency)
    return f"{cents / 100:,.2f} {symbol}".replace(",", "·").replace(".", ",").replace("·", ".")


def normalize_metrics(metrics: Iterable[str]) -> list[str]:
    return [m for m in metrics if m in ALL_METRICS]
