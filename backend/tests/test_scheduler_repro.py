"""
Riproduzione scenario screenshot: 5 tecnici (1 in ferie), skill miste, ~30 ticket.
Verifica che il backlog venga pianificato su TUTTI i tecnici disponibili e i giorni.
"""
from __future__ import annotations

import asyncio
from datetime import date, datetime, timedelta

from backend.db.modelli import Asset, Tecnico, TecnicoAssenza, Tenant, Ticket
from backend.services.auto_scheduler_bridge import generate_auto_schedule_plan


def _monday(d: date) -> date:
    while d.weekday() != 0:
        d += timedelta(days=1)
    return d


MONDAY = _monday(date(2026, 6, 1))


def test_repro_screenshot_fills_all_technicians(db_session):
    tenant = Tenant(nome="T", slug="repro", is_active=True)
    db_session.add(tenant)
    db_session.commit()
    db_session.refresh(tenant)

    def tec(nome, comp):
        t = Tecnico(nome=nome, competenze=comp, ore_giornaliere=8, stato="in servizio",
                    orario_inizio="08:00", orario_fine="17:00", tenant_id=tenant.id)
        db_session.add(t)
        db_session.commit()
        db_session.refresh(t)
        return t

    luca = tec("luca", "meccanico,HVAC,PLE")
    luigi = tec("luigi", "Media Tensione")
    pinco = tec("pinco", "meccanico")
    dario = tec("dario", "FGAS,HVAC,ELETTRICISTA")
    marco = tec("marco", "elettricista")

    # luca in ferie tutta la settimana
    db_session.add(TecnicoAssenza(
        tecnico_id=luca.id, data_inizio=datetime.combine(MONDAY, datetime.min.time()),
        data_fine=datetime.combine(MONDAY + timedelta(days=11), datetime.min.time()),
        tipo_assenza="Ferie", tenant_id=tenant.id,
    ))
    db_session.commit()

    def asset(nome):
        a = Asset(nome=nome, tenant_id=tenant.id)
        db_session.add(a)
        db_session.commit()
        db_session.refresh(a)
        return a

    def ticket(titolo, tipo, dur, comp=None, prio="Media", a=None):
        db_session.add(Ticket(
            titolo=titolo, asset_id=(a.id if a else asset(titolo).id), tipo=tipo,
            priorita=prio, stato="Aperto", durata_stimata_ore=dur,
            competenza_richiesta=comp, tenant_id=tenant.id,
        ))

    # Mix realistico: molti PM generici (competenza None) + alcuni a skill specifica
    for i in range(12):
        ticket(f"Controllo generico {i}", "PM", 2.0)        # generici → chiunque
    ticket("Nastro non parte", "BD", 4.0)                    # generico
    ticket("bloccato e non funzionante", "BD", 2.0)         # generico
    ticket("Intervento su pompa 01", "CM", 2.0)             # generico
    ticket("Controllo 500h", "PM", 2.0)                     # generico
    ticket("Controllo mensile agitatore", "PM", 2.0)        # generico
    for i in range(3):
        ticket(f"Verifica connessioni CABINA MT {i}", "PM", 1.0, comp="ELETTRICISTA")
    ticket("controllo comandi motore elettrico MU 01", "PM", 3.5, comp="ELETTRICISTA")
    ticket("controllo comandi motore elettrico MU 02", "PM", 3.5, comp="ELETTRICISTA")
    ticket("Controllo HVAC", "PM", 2.0, comp="HVAC")        # dario ha HVAC
    # PLE → solo luca: in ferie nei primi giorni, ma l'orizzonte si estende fino
    # al suo rientro → devono comunque essere pianificati (luca al rientro).
    ticket("Ispezione visiva Montacarichi 06", "PM", 4.0, comp="PLE")
    ticket("Ispezione visiva Montacarichi 02", "PM", 8.0, comp="PLE")
    # Skill che NESSUN tecnico possiede → genuinamente non schedulabile (SKILL).
    ticket("Lavoro subacqueo", "CM", 2.0, comp="SOMMOZZATORE")
    db_session.commit()

    total = db_session.query(Ticket).filter(Ticket.tenant_id == tenant.id).count()

    plan = asyncio.run(generate_auto_schedule_plan(
        db=db_session, days=7, tenant_id=tenant.id, start_date=MONDAY,
    ))

    summary = plan["scheduling_summary"]
    wos = plan["planned_workorders"]
    deferred = plan["deferred_workorders"]
    by_tech = {}
    for wo in wos:
        by_tech[wo["technician_id"]] = by_tech.get(wo["technician_id"], 0) + 1

    print("\n=== REPRO ===")
    print(f"tickets totali: {total}")
    print(f"schedulati: {summary['tickets_scheduled']}  esclusi: {summary['tickets_excluded']}")
    print(f"effective_days: {plan['plan_metadata'].get('effective_days')}")
    print(f"per tecnico: {by_tech}")
    print(f"deferred reasons: {[(d['wo_id'], d.get('reason_code')) for d in deferred]}")

    # Pinco (meccanico) DEVE ricevere lavoro generico
    assert by_tech.get(pinco.id, 0) > 0, "Pinco (meccanico) è rimasto vuoto!"
    # Tutti i 4 tecnici disponibili subito devono essere impiegati
    used = {luigi.id, pinco.id, dario.id, marco.id} & set(by_tech.keys())
    assert len(used) == 4, f"Non tutti i tecnici disponibili impiegati: {used}"
    # I PLE vengono pianificati su luca al rientro dalle ferie (orizzonte esteso)
    assert by_tech.get(luca.id, 0) == 2, "I ticket PLE non sono stati pianificati su luca al rientro"
    # Solo il ticket con skill inesistente resta non schedulato
    assert summary["tickets_excluded"] == 1
    assert deferred[0]["reason_code"] == "NON_SCHEDULABILE_SKILL_ASSENTE"
    assert summary["tickets_scheduled"] == total - 1, "Backlog non svuotato come atteso"
