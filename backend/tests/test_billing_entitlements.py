"""Test del livello commerciale: quote, accesso, ciclo di vita dell'abbonamento.

I casi coperti sono quelli in cui un errore costa soldi o clienti:
- un tenant storico senza abbonamento non deve subire limiti (regressione più
  probabile e più grave: chiuderebbe fuori tutti i clienti attuali);
- la quota deve bloccare *prima* di scrivere;
- la sola lettura non deve mai togliere l'accesso ai propri dati.
"""

from datetime import datetime, timedelta, timezone

import pytest

from backend.core.plans import METRIC_SITES, METRIC_USERS, get_plan
from backend.db.modelli import Sito, Subscription, Tenant, Utente
from backend.services.billing import subscription_service as subs
from backend.services.billing.entitlement_service import (
    ACCESS_FULL,
    ACCESS_READ_ONLY,
    PlanLimitExceeded,
    SubscriptionInactive,
    current_usage,
    record_usage,
    require_capacity,
    require_write_access,
    resolve_entitlements,
    usage_report,
)


def _utcnow():
    return datetime.now(timezone.utc)


@pytest.fixture
def tenant(db_session):
    t = Tenant(nome="Acciaierie Test", slug="acciaierie-test", is_active=True)
    db_session.add(t)
    db_session.flush()
    return t


def _add_users(db, tenant_id, count, prefix="u"):
    for i in range(count):
        db.add(Utente(
            username=f"{prefix}{i}@test.local",
            password_hash="x",
            ruolo="tecnico",
            tenant_id=tenant_id,
            is_active=True,
        ))
    db.flush()


# ── Retrocompatibilità ───────────────────────────────────────────────────────


def test_tenant_senza_abbonamento_non_ha_limiti(db_session, tenant):
    """Il cliente creato a mano dal superadmin continua a lavorare come prima."""
    ent = resolve_entitlements(db_session, tenant.id)

    assert ent.grandfathered is True
    assert ent.access_level == ACCESS_FULL
    assert ent.allowed_module_ids() is None  # nessun tetto commerciale sui moduli

    _add_users(db_session, tenant.id, 50)
    # Nessuna eccezione: 50 utenti su un tenant senza piano restano leciti.
    require_capacity(db_session, tenant.id, METRIC_USERS, 1)


# ── Quote ────────────────────────────────────────────────────────────────────


def test_quota_utenti_blocca_al_superamento(db_session, tenant):
    subs.activate_plan(db_session, tenant.id, "start")  # 3 utenti inclusi
    _add_users(db_session, tenant.id, 3)

    with pytest.raises(PlanLimitExceeded) as exc:
        require_capacity(db_session, tenant.id, METRIC_USERS, 1)

    detail = exc.value.detail
    assert detail["error"] == "plan_limit_reached"
    assert detail["metric"] == METRIC_USERS
    assert detail["current"] == 3
    assert detail["limit"] == 3
    # La UI deve poter offrire l'upgrade senza far riscrivere il form.
    assert detail["upgrade_url"] == "/settings/billing"


def test_addon_aumenta_la_quota(db_session, tenant):
    subs.activate_plan(db_session, tenant.id, "start", extra_users=2)
    _add_users(db_session, tenant.id, 3)

    require_capacity(db_session, tenant.id, METRIC_USERS, 1)  # 4° utente: ok grazie all'add-on
    _add_users(db_session, tenant.id, 2, prefix="extra")      # totale 5 = 3 inclusi + 2 add-on

    with pytest.raises(PlanLimitExceeded):
        require_capacity(db_session, tenant.id, METRIC_USERS, 1)


def test_utenti_disattivati_non_occupano_licenza(db_session, tenant):
    """Una licenza si libera disattivando l'utente, senza cancellarne lo storico."""
    subs.activate_plan(db_session, tenant.id, "start")
    _add_users(db_session, tenant.id, 3)

    user = db_session.query(Utente).filter(Utente.tenant_id == tenant.id).first()
    user.is_active = False
    db_session.flush()

    assert current_usage(db_session, tenant.id, METRIC_USERS) == 2
    require_capacity(db_session, tenant.id, METRIC_USERS, 1)


def test_quota_siti(db_session, tenant):
    subs.activate_plan(db_session, tenant.id, "start")  # 1 sito incluso
    db_session.add(Sito(nome="Stabilimento 1", tenant_id=tenant.id))
    db_session.flush()

    with pytest.raises(PlanLimitExceeded) as exc:
        require_capacity(db_session, tenant.id, METRIC_SITES, 1)
    assert exc.value.detail["metric"] == METRIC_SITES


def test_piano_enterprise_illimitato(db_session, tenant):
    subs.activate_plan(db_session, tenant.id, "enterprise")
    _add_users(db_session, tenant.id, 200)
    require_capacity(db_session, tenant.id, METRIC_USERS, 1)

    report = usage_report(db_session, tenant.id)
    utenti = next(m for m in report["metrics"] if m["metric"] == METRIC_USERS)
    assert utenti["unlimited"] is True
    assert utenti["limit"] is None


# ── Metriche di flusso ───────────────────────────────────────────────────────


def test_contatore_chiamate_ai_si_accumula(db_session, tenant):
    from backend.core.plans import METRIC_AI_CALLS

    subs.activate_plan(db_session, tenant.id, "start")  # 200 chiamate/mese
    assert current_usage(db_session, tenant.id, METRIC_AI_CALLS) == 0

    for _ in range(5):
        record_usage(db_session, tenant.id, METRIC_AI_CALLS, 1)
    db_session.flush()

    assert current_usage(db_session, tenant.id, METRIC_AI_CALLS) == 5


def test_contatore_ai_isolato_per_tenant(db_session, tenant):
    from backend.core.plans import METRIC_AI_CALLS

    altro = Tenant(nome="Altro", slug="altro-test", is_active=True)
    db_session.add(altro)
    db_session.flush()

    record_usage(db_session, tenant.id, METRIC_AI_CALLS, 7)
    db_session.flush()

    assert current_usage(db_session, tenant.id, METRIC_AI_CALLS) == 7
    assert current_usage(db_session, altro.id, METRIC_AI_CALLS) == 0


# ── Accesso e stati ──────────────────────────────────────────────────────────


def test_trial_attivo_consente_scrittura(db_session, tenant):
    subs.start_trial(db_session, tenant.id)
    ent = resolve_entitlements(db_session, tenant.id)

    assert ent.status == "trialing"
    assert ent.access_level == ACCESS_FULL
    require_write_access(db_session, tenant.id)


def test_trial_scaduto_va_in_sola_lettura(db_session, tenant):
    sub = subs.start_trial(db_session, tenant.id)
    sub.trial_ends_at = _utcnow() - timedelta(days=1)
    db_session.flush()

    ent = resolve_entitlements(db_session, tenant.id)
    assert ent.access_level == ACCESS_READ_ONLY
    assert ent.reason == "trial_expired"

    with pytest.raises(SubscriptionInactive) as exc:
        require_write_access(db_session, tenant.id)
    assert exc.value.status_code == 402
    assert exc.value.detail["reason"] == "trial_expired"


def test_past_due_entro_la_tolleranza_resta_scrivibile(db_session, tenant):
    """Una carta scaduta non deve fermare la manutenzione di uno stabilimento."""
    subs.activate_plan(db_session, tenant.id, "start")
    subs.mark_past_due(db_session, tenant.id)

    ent = resolve_entitlements(db_session, tenant.id)
    assert ent.access_level == ACCESS_FULL
    assert ent.reason == "past_due_grace"
    assert ent.warnings  # il banner deve avere qualcosa da dire


def test_past_due_oltre_la_tolleranza_va_in_sola_lettura(db_session, tenant):
    subs.activate_plan(db_session, tenant.id, "start")
    sub = subs.mark_past_due(db_session, tenant.id)
    sub.grace_period_ends_at = _utcnow() - timedelta(hours=1)
    db_session.flush()

    ent = resolve_entitlements(db_session, tenant.id)
    assert ent.access_level == ACCESS_READ_ONLY
    assert ent.reason == "past_due_expired"


def test_disdetta_a_fine_periodo_mantiene_accesso(db_session, tenant):
    subs.activate_plan(db_session, tenant.id, "start")
    subs.cancel_subscription(db_session, tenant.id, at_period_end=True)

    ent = resolve_entitlements(db_session, tenant.id)
    assert ent.cancel_at_period_end is True
    assert ent.access_level == ACCESS_FULL  # il periodo pagato resta del cliente


def test_disdetta_immediata_va_in_sola_lettura(db_session, tenant):
    subs.activate_plan(db_session, tenant.id, "start")
    subs.cancel_subscription(db_session, tenant.id, at_period_end=False)

    ent = resolve_entitlements(db_session, tenant.id)
    assert ent.status == "cancelled"
    assert ent.access_level == ACCESS_READ_ONLY


def test_riattivazione_ripristina_accesso(db_session, tenant):
    subs.activate_plan(db_session, tenant.id, "start")
    subs.cancel_subscription(db_session, tenant.id, at_period_end=False)
    subs.reactivate_subscription(db_session, tenant.id)

    ent = resolve_entitlements(db_session, tenant.id)
    assert ent.status == "active"
    assert ent.access_level == ACCESS_FULL


def test_piano_sconosciuto_non_chiude_fuori_il_cliente(db_session, tenant):
    """Togliere un piano dal listino non deve bloccare chi lo ha sottoscritto."""
    subs.activate_plan(db_session, tenant.id, "start")
    sub = db_session.query(Subscription).filter(Subscription.tenant_id == tenant.id).first()
    sub.plan_code = "piano_ritirato_2024"
    db_session.flush()

    ent = resolve_entitlements(db_session, tenant.id)
    assert ent.access_level == ACCESS_FULL
    assert ent.grandfathered is True
    assert ent.warnings


# ── Downgrade delle licenze ──────────────────────────────────────────────────


def test_downgrade_licenze_non_scende_sotto_l_uso_reale(db_session, tenant):
    subs.activate_plan(db_session, tenant.id, "start", extra_users=3)  # 3 + 3 = 6
    _add_users(db_session, tenant.id, 6)

    subs.set_addon_quantities(db_session, tenant.id, extra_users=0)
    sub = db_session.query(Subscription).filter(Subscription.tenant_id == tenant.id).first()

    # 6 utenti attivi, 3 inclusi nel piano → servono almeno 3 licenze extra.
    assert sub.extra_users == 3


# ── Moduli concessi dal piano ────────────────────────────────────────────────


def test_piano_start_non_concede_i_moduli_ai(db_session, tenant):
    from backend.core.modules import effective_enabled_ids

    subs.activate_plan(db_session, tenant.id, "start")
    enabled = effective_enabled_ids(db_session, tenant.id)

    assert "tickets" in enabled
    assert "planning" in enabled
    assert "diagnostic_ai" not in enabled
    assert "spare_parts" not in enabled


def test_upgrade_a_pro_sblocca_i_moduli_ai(db_session, tenant):
    from backend.core.modules import effective_enabled_ids, invalidate_module_caches

    subs.activate_plan(db_session, tenant.id, "pro")
    invalidate_module_caches()
    enabled = effective_enabled_ids(db_session, tenant.id)

    assert "diagnostic_ai" in enabled
    assert "spare_parts" in enabled


def test_tenant_senza_piano_vede_tutti_i_moduli_globali(db_session, tenant):
    from backend.core.modules import effective_enabled_ids, enabled_module_ids

    assert effective_enabled_ids(db_session, tenant.id) == enabled_module_ids()


def test_trial_concede_i_moduli_professional(db_session, tenant):
    from backend.core.modules import effective_enabled_ids, invalidate_module_caches

    subs.start_trial(db_session, tenant.id)
    invalidate_module_caches()
    enabled = effective_enabled_ids(db_session, tenant.id)

    # Il trial deve far vedere il prodotto completo: un trial mutilato non vende.
    assert "diagnostic_ai" in enabled
    assert "manuals" in enabled


def test_catalogo_piani_coerente():
    """Ogni modulo citato da un piano deve esistere davvero."""
    from backend.core.modules import MODULE_DEFINITIONS
    from backend.core.plans import PLAN_DEFINITIONS

    for plan in PLAN_DEFINITIONS.values():
        if plan.modules is None:
            continue
        sconosciuti = set(plan.modules) - set(MODULE_DEFINITIONS)
        assert not sconosciuti, f"Piano {plan.code}: moduli inesistenti {sconosciuti}"


def test_trial_non_e_vendibile_online():
    """Il trial non deve comparire in pagina prezzi né essere acquistabile."""
    from backend.core.plans import public_plans, self_serve_plan_codes

    assert "trial" not in {p.code for p in public_plans()}
    assert "trial" not in self_serve_plan_codes()
    # Enterprise è pubblico ma non self-serve: si vende parlando con qualcuno.
    assert "enterprise" not in self_serve_plan_codes()
    assert get_plan("enterprise").is_public is True
