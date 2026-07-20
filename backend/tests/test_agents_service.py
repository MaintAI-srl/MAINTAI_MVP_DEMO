"""Test unitari degli Agenti AI: Pareto, costi EUR, moduli e consuntivo consumi."""
from datetime import datetime, timezone

from backend.core.modules import MODULE_DEFINITIONS
from backend.db.modelli import AiUsageLog, Tenant
from backend.services.ai.agents_service import (
    AGENT_DEFINITIONS,
    build_pareto,
    estimate_cost_eur,
    list_agents,
    recent_runs,
    usage_summary,
)


def test_agent_modules_registrati_nel_menu_funzionalita():
    """Ogni agente deve essere un modulo attivabile/disattivabile (categoria 'agenti')."""
    for agent_id in AGENT_DEFINITIONS:
        assert agent_id in MODULE_DEFINITIONS, f"modulo mancante per {agent_id}"
        assert MODULE_DEFINITIONS[agent_id].category == "agenti"


def test_list_agents_espone_i_cinque_agenti():
    ids = [a["id"] for a in list_agents()]
    assert ids == [
        "agent_planner",
        "agent_rca",
        "agent_cost_controller",
        "agent_kpi",
        "agent_strategy",
    ]
    for agent in list_agents():
        assert agent["nome"] and agent["nome_breve"] and agent["colore"]


def test_build_pareto_ordina_e_calcola_cumulata():
    pareto = build_pareto({"A": 50, "B": 30, "C": 15, "D": 5}, "test", "u")
    labels = [i["label"] for i in pareto["items"]]
    assert labels == ["A", "B", "C", "D"]
    assert pareto["totale"] == 100
    assert pareto["items"][1]["cum_pct"] == 80.0
    # A e B costruiscono il primo 80% → vital few; C e D no
    assert [i["vital"] for i in pareto["items"]] == [True, True, False, False]


def test_build_pareto_vuoto_o_zero_restituisce_none():
    assert build_pareto({}, "t", "u") is None
    assert build_pareto({"A": 0}, "t", "u") is None


def test_estimate_cost_eur_usa_prezzi_modello():
    # gpt-4.1-mini: 0.40/1M input + 1.60/1M output (USD), cambio default 0.92
    cost = estimate_cost_eur("gpt-4.1-mini", 1_000_000, 1_000_000)
    assert abs(cost - (0.40 + 1.60) * 0.92) < 1e-6
    # Modello sconosciuto → fallback prezzi mini
    assert estimate_cost_eur("modello-x", 1000, 1000) == estimate_cost_eur("gpt-4.1-mini", 1000, 1000)
    assert estimate_cost_eur(None, 0, 0) == 0.0


def test_usage_summary_e_recent_runs_filtrano_per_tenant(db_session):
    t1 = Tenant(nome="T1", slug="t1-agents", is_active=True)
    t2 = Tenant(nome="T2", slug="t2-agents", is_active=True)
    db_session.add_all([t1, t2])
    db_session.commit()

    now = datetime.now(timezone.utc).replace(tzinfo=None)
    db_session.add_all([
        AiUsageLog(tenant_id=t1.id, feature="agent_kpi", model="gpt-4.1-mini",
                   prompt_tokens=100, completion_tokens=50, cost_eur=0.5,
                   status="ok", output_md="# Report", created_by="alice", created_at=now),
        AiUsageLog(tenant_id=t1.id, feature="agent_rca", model="gpt-4.1-mini",
                   prompt_tokens=100, completion_tokens=50, cost_eur=0.25,
                   status="ok", output_md="# RCA", created_by="alice", created_at=now),
        AiUsageLog(tenant_id=t2.id, feature="agent_kpi", model="gpt-4.1-mini",
                   prompt_tokens=100, completion_tokens=50, cost_eur=9.0,
                   status="ok", output_md="# Altro tenant", created_by="bob", created_at=now),
    ])
    db_session.commit()

    summary = usage_summary(db_session, t1.id)
    assert summary["totale_eur"] == 0.75
    assert summary["mese_eur"] == 0.75
    assert summary["oggi_eur"] == 0.75
    assert summary["runs"] == 2

    runs = recent_runs(db_session, t1.id)
    assert len(runs) == 2
    assert all(r["output_md"] != "# Altro tenant" for r in runs)

    solo_kpi = recent_runs(db_session, t1.id, agent_id="agent_kpi")
    assert len(solo_kpi) == 1
    assert solo_kpi[0]["agent_id"] == "agent_kpi"


def test_collectors_non_esplodono_su_tenant_vuoto(db_session):
    tenant = Tenant(nome="Empty", slug="empty-agents", is_active=True)
    db_session.add(tenant)
    db_session.commit()

    for definition in AGENT_DEFINITIONS.values():
        context = definition.collector(db_session, tenant.id)
        assert isinstance(context["summary"], str) and context["summary"]
        # Su tenant vuoto il Pareto può legittimamente mancare
        assert context["pareto"] is None or context["pareto"]["items"]
