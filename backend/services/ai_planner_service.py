"""
AI Planner Service — Felix, il Planner Senior di Manutenzione Industriale.
Genera piani manutenzione ottimizzati usando OpenAI + previsioni meteo Open-Meteo.
"""
from __future__ import annotations

import json
import logging
import re
import time as _time
from datetime import date, datetime, timedelta, time
from typing import Any, Dict, List, Optional, Tuple

from sqlalchemy.orm import Session, joinedload

from backend.services.ai.openai_service import get_openai_client, get_openai_model
from backend.services.weather_service import get_weather_forecast, WeatherData
from backend.db.modelli import Ticket, Tecnico, Asset, GeneratedPlan, TecnicoAssenza
from backend.services.ai.anonymization_service import anonymizer

logger = logging.getLogger(__name__)

# ── Cache in-memoria per collect_planning_context ────────────────────────────
# Riduce latenza e consumo token per AI planning su tenant con dati statici.
# TTL di 5 minuti: sufficiente a coprire retry rapidi senza esporre dati stale.
# Chiave: (tenant_id, days) → (timestamp, result)
_CTX_CACHE: Dict[Tuple[int, int, str], Tuple[float, Dict[str, Any]]] = {}
_CTX_TTL_SECONDS = 300  # 5 minuti

FELIX_SYSTEM_PROMPT = """Sei Felix, motore di Maintenance Planning & Scheduling per un'azienda di service/manutenzione industriale con 20+ anni di esperienza in impianti energetici, portuali e manifatturieri. Pianifichi con la precisione di un esperto certificato RCM e TPM.

OBIETTIVO
Genera un piano settimanale e una proposta di assegnazione giornaliera massimizzando produttività, saturazione utile delle ore disponibili, rispetto di priorità, vincoli operativi e qualità del lavoro. Distingui sempre tra PLANNING e SCHEDULING.

═══════════════════════════════════════
PRINCIPI GUIDA — PLANNING
═══════════════════════════════════════
1. Pianifica il lavoro futuro, non inseguire il lavoro già in esecuzione.
2. Usa lo storico per asset/componente e riusa i job plan esistenti quando possibile.
3. Per ogni WO considera implicitamente: scopo, prerequisiti, permessi, ricambi/materiali, DPI, skill minime, ore uomo, durata stimata, finestre operative, rischi HSE, dipendenze.
4. Le stime devono essere realistiche e basate su storico e feedback tecnici.
5. Il job plan guida il tecnico senza sostituirne la competenza: dettaglio sufficiente, non eccessivo.
6. Ogni decisione deve aumentare il wrench time e ridurre attese, spostamenti, indisponibilità materiali e interruzioni.

═══════════════════════════════════════
PRINCIPI GUIDA — SCHEDULING
═══════════════════════════════════════
7. Non schedulare WO senza un job plan minimo credibile.
8. Costruisci prima un piano SETTIMANALE per tecnico, poi la proposta GIORNALIERA.
9. Usa le ore realmente disponibili al netto di assenze, vincoli orari e spostamenti.
10. Schedula il 100% delle ore disponibili, riservando una quota controllata ai lavori reattivi/interrompibili.
11. Rispetta priorità: emergenza > sicurezza > fermo impianto > compliance > produzione > preventiva > migliorativa.
    In MaintAI: BD (Breakdown) > CM (Correttiva) > PM (Preventiva). I BD hanno sempre priorità assoluta.
12. Verifica coerenza con operations/produzione: il lavoro scelto deve essere quello giusto in quella finestra.
13. L'assegnazione giornaliera si adatta al progresso reale e ai nuovi urgenti senza distruggere il piano settimanale.
14. Evita ripianificazioni nervose: modifica il piano solo per ragioni forti e tracciabili.

═══════════════════════════════════════
REGOLE DECISIONALI OBBLIGATORIE
═══════════════════════════════════════
R1 — PRIORITÀ BD: i guasti Breakdown hanno priorità assoluta e vengono pianificati prima di qualsiasi altro WO, senza negoziazione.
R2 — BILANCIAMENTO: il backlog settimanale (esclusi BD) deve tendere al 70% PM e 30% CM. Se il backlog non lo permette, avvicinati privilegiando i PM.
R3 — SKILL MATCH: assegna ogni WO esclusivamente al tecnico con le skill richieste. Con più candidati validi, preferisci chi ha più ore disponibili (saturazione utile), poi vicinanza logistica, poi continuità sullo stesso asset. Non usare sempre il tecnico migliore: preserva capacità critica per lavori ad alta complessità.
R4 — VINCOLI METEO: rispetta sempre i vincoli asset. NO_RAIN blocca con precipitazioni previste. NO_FROST blocca sotto 2°C. NO_WIND blocca sopra 40 km/h. Se meteo non disponibile, pianifica e aggiungi warning.
R5 — ASSET IN FERMO PROG.: se un asset ha fermo_on_schedule attivo, inseriscilo in fermo_assets. L'asset entrerà in FERMO PROG. alla conferma del piano.
R6 — LOGISTICA: raggruppa WO compatibili per area, asset, sistema, fermata, skill. Favorisci lotti che riducono micro-spostamenti. Almeno 30 min di buffer tra interventi consecutivi dello stesso tecnico.
R7 — BUFFER REATTIVO: ogni giorno deve avere un buffer esplicito per urgenze, coerente con lo storico del sito.
R8 — WO NON PRONTE: se mancano materiali, permessi o condizioni minime, non schedulare il WO come eseguibile: inseriscilo nei deferred con motivazione che indica il collo di bottiglia.
R9 — READINESS FIRST: non confondere "priorità alta" con "fare subito". Considera readiness, impatto sistemico e convenienza operativa.
R10 — INSERIMENTO PROATTIVO: se possibile, aggiungi attività preventive insieme ai reattivi sulla stessa area o sistema.

═══════════════════════════════════════
OUTPUT — MAPPATURA SUL JSON SCHEMA
═══════════════════════════════════════
Mappa il tuo piano nel JSON schema richiesto nel modo seguente:

• planned_workorders → WO schedulati (piano settimanale + proposta giornaliera integrata)
  - motivation: sintetizza la scelta (max 2 righe), il raggruppamento logistico applicato, il buffer usato
  - warnings: meteo, mancanza materiali, rischi HSE, skill borderline, dipendenze irrisolte

• deferred_workorders → WO non pronte o non schedulabili
  - reason: collo di bottiglia specifico (skill mancante, materiali, meteo, finestra non disponibile, compliance)

• fermo_assets → asset che entrano in FERMO PROG. alla conferma

• global_warnings → eccezioni, conflitti di risorse, sovraccarichi/sottoutilizzi, rischi compliance, note di ottimizzazione aggregate

• efficiency_score (0–100) → stima della schedule compliance prevista considerando:
  - saturazione utile delle ore disponibili (peso 30%)
  - copertura backlog pronto (peso 25%)
  - rispetto priorità (peso 20%)
  - bilanciamento BD/CM/PM (peso 15%)
  - ottimizzazione logistica e raggruppamenti (peso 10%)

• efficiency_breakdown → KPI calcolati: copertura_backlog, utilizzo_tecnici, rispetto_priorita, bilanciamento_tipo, ottimizzazione_logistica
• efficiency_motivations → spiegazione dei KPI sotto target con azione correttiva proposta

═══════════════════════════════════════
ISTRUZIONE FINALE
═══════════════════════════════════════
Prima di generare il piano:
1. valida readiness delle WO (materiali, permessi, skill, finestre);
2. separa planning da scheduling;
3. costruisci il piano settimanale per tecnico;
4. costruisci la proposta giornaliera integrata;
5. evidenzia eccezioni, colli di bottiglia e KPI nel JSON.

═══════════════════════════════════════
CAMPI AGGIUNTIVI PER WORKORDER
═══════════════════════════════════════
Per ogni workorder pianificato, valorizza i seguenti campi opzionali (puoi usare null se non hai informazioni sufficienti):

- confidence_score (float 0.0-1.0): probabilità stimata che il WO venga eseguito come pianificato.
  Considera: disponibilità materiali, skill del tecnico, stabilità meteo, complessità operativa.
  1.0 = certezza massima, 0.5 = incerto, 0.3 = piano di riserva.
  Esempi: PM su asset stabile con tecnico dedicato → 0.90. BD urgente con meteo avverso → 0.60.

- risk_level: "LOW" se confidence_score >= 0.85, "MEDIUM" se >= 0.65, "HIGH" se < 0.65.
  Usa null se confidence_score è null.

- complexity: "SIMPLE" se durata <= 2h e 1 tecnico. "COMPLEX" se durata > 8h o multi-tecnico o dipendenze critiche. "STANDARD" altrimenti.

VINCOLO ASSOLUTO: rispondi SEMPRE e SOLO con un oggetto JSON valido secondo lo schema fornito.
Non aggiungere testo, commenti o markdown fuori dal JSON. Il JSON deve essere completo e parseable."""

RESPONSE_SCHEMA = {
    "name": "ai_maintenance_plan",
    "strict": True,
    "schema": {
        "type": "object",
        "properties": {
            "planned_workorders": {
                "type": "array",
                "items": {
                    "type": "object",
                    "properties": {
                        "wo_id": {"type": "integer"},
                        "technician_id": {"type": "integer"},
                        "planned_date": {"type": "string"},
                        "time_slot": {"type": "string"},
                        "motivation": {"type": "string"},
                        "warnings": {"type": "array", "items": {"type": "string"}},
                        "confidence_score": {"anyOf": [{"type": "number", "minimum": 0, "maximum": 1}, {"type": "null"}]},
                        "risk_level": {"anyOf": [{"type": "string", "enum": ["LOW", "MEDIUM", "HIGH"]}, {"type": "null"}]},
                        "complexity": {"anyOf": [{"type": "string", "enum": ["SIMPLE", "STANDARD", "COMPLEX"]}, {"type": "null"}]},
                    },
                    "required": ["wo_id", "technician_id", "planned_date", "time_slot", "motivation", "warnings", "confidence_score", "risk_level", "complexity"],
                    "additionalProperties": False,
                },
            },
            "deferred_workorders": {
                "type": "array",
                "items": {
                    "type": "object",
                    "properties": {
                        "wo_id": {"type": "integer"},
                        "reason": {"type": "string"},
                    },
                    "required": ["wo_id", "reason"],
                    "additionalProperties": False,
                },
            },
            "fermo_assets": {
                "type": "array",
                "items": {
                    "type": "object",
                    "properties": {
                        "asset_id": {"type": "integer"},
                        "triggered_by_wo_id": {"type": "integer"},
                    },
                    "required": ["asset_id", "triggered_by_wo_id"],
                    "additionalProperties": False,
                },
            },
            "global_warnings": {
                "type": "array",
                "items": {"type": "string"},
            },
        },
        "required": ["planned_workorders", "deferred_workorders", "fermo_assets", "global_warnings"],
        "additionalProperties": False,
    },
}


def _is_breakdown(ticket: Ticket) -> bool:
    """Determina se un ticket è un guasto/breakdown ad alta priorità."""
    tipo = (ticket.tipo or "").upper()
    titolo = (ticket.titolo or "").lower()
    desc = (ticket.descrizione or "").lower()
    return (
        "BD" in tipo
        or "BREAKDOWN" in tipo
        or "GUASTO" in tipo
        or "guasto" in titolo
        or "guasto" in desc
        or "breakdown" in titolo
        or "breakdown" in desc
    )


def _tecnico_has_skill_legacy_unused(tecnico: Tecnico, ticket: Ticket) -> bool:
    """Implementazione legacy permissiva, mantenuta solo per riferimento storico."""
    if not tecnico.competenze:
        return False
    competenze = (tecnico.competenze or "").lower()
    tipo = (ticket.tipo or "").lower()
    titolo = (ticket.titolo or "").lower()
    desc = (ticket.descrizione or "").lower()
    keywords = set(tipo.split() + titolo.split() + desc.split()[:10])
    comp_keywords = set(competenze.replace(",", " ").replace(";", " ").split())
    # Match se almeno una keyword tecnica è in comune
    common = keywords & comp_keywords
    # Sempre True se il tecnico ha "generico" o "tuttofare" nelle competenze
    if "generico" in competenze or "tuttofare" in competenze or "generale" in competenze:
        return True
    return len(common) > 0 or len(comp_keywords) > 0  # fallback permissivo per ora


def _split_competenze(raw: Optional[str]) -> List[str]:
    if not raw:
        return []
    return [p.strip().upper() for p in re.split(r"[,;\s]+", raw.strip()) if p.strip()]


def _tecnico_has_skill(tecnico: Tecnico, ticket: Ticket) -> bool:
    """Skill hard matching: competenza_richiesta esplicita, altrimenti tipo ticket."""
    skills = _split_competenze(tecnico.competenze)
    if not skills:
        return False

    normalized = {s.upper() for s in skills}
    if normalized & {"GENERICO", "TUTTOFARE", "GENERALE"}:
        return True

    required = (ticket.competenza_richiesta or ticket.tipo or "").strip().upper()
    return bool(required and required in normalized)


def _check_weather_constraint(
    weather_constraint: Optional[str],
    weather_data: Optional[Any],
) -> Optional[str]:
    """
    Controlla se il vincolo meteo dell'asset è violato.
    Ritorna stringa di warning se violato, None se ok.
    """
    if not weather_constraint or weather_constraint == "NONE":
        return None
    if weather_data is None:
        return f"Dati meteo non disponibili per vincolo {weather_constraint} — pianificare con cautela"

    if weather_constraint == "NO_RAIN" and weather_data.precipitation_mm > 0.5:
        return f"Precipitazioni previste ({weather_data.precipitation_mm}mm) — vincolo NO_RAIN violato"
    if weather_constraint == "NO_FROST" and weather_data.is_freezing:
        return f"Temperatura sotto 2°C ({weather_data.temperature_c}°C) — vincolo NO_FROST violato"
    if weather_constraint == "NO_WIND" and weather_data.is_high_wind:
        return f"Vento elevato ({weather_data.wind_speed_kmh}km/h) — vincolo NO_WIND violato"
    if weather_constraint == "OUTDOOR_ONLY" and weather_data.is_stormy:
        return f"Condizioni meteo avverse (codice {weather_data.weather_code}) — vincolo OUTDOOR_ONLY violato"
    return None


async def collect_planning_context(
    db: Session,
    days: int = 7,
    asset_ids: Optional[List[int]] = None,
    tenant_id: Optional[int] = None,
    start_date: Optional[date] = None,
    include_weekends: bool = False,
    workday_end_hour: int = 17,
) -> Dict[str, Any]:
    """
    Raccoglie tutto il contesto necessario per la pianificazione AI:
    ticket aperti/pianificati, tecnici, asset, previsioni meteo.

    Risultato cachato in memoria per 5 minuti per tenant+days.
    Il cache si bypassa automaticamente quando asset_ids è specificato
    (contesto filtrato per asset specifici, non globalizzabile).
    """
    # Cache bypass se asset_ids è specificato (query personalizzata non globalizzabile)
    today = start_date or date.today()
    cache_key: Tuple[int, int, str] | None = (tenant_id, days, today.isoformat()) if tenant_id and not asset_ids else None
    if cache_key is not None:
        cached = _CTX_CACHE.get(cache_key)
        if cached is not None:
            ts, result = cached
            if _time.monotonic() - ts < _CTX_TTL_SECONDS:
                logger.info("collect_planning_context: cache HIT (tenant=%d, days=%d)", tenant_id, days)
                return result

    raw_horizon_dates = [today + timedelta(days=i) for i in range(days)]
    horizon_dates = raw_horizon_dates if include_weekends else [d for d in raw_horizon_dates if d.weekday() < 5]

    # --- Ticket ---
    ticket_query = db.query(Ticket).filter(
        Ticket.stato.in_(["Aperto", "Pianificato"])
    )
    if tenant_id:
        ticket_query = ticket_query.filter(Ticket.tenant_id == tenant_id)
    if asset_ids:
        ticket_query = ticket_query.filter(Ticket.asset_id.in_(asset_ids))
    all_tickets = ticket_query.all()

    # Separiamo i ticket manuali (da considerare come locked e non ripianificabili)
    tickets = []
    locked_tickets = []
    for t in all_tickets:
        is_locked = getattr(t, "is_manual_plan", False) or (t.tecnico_id is not None and t.planned_start is not None)
         # I ticket già pianificati sono considerati locked in AI engine per non rigenerarli! Wait, l'AI è stateless e riceve ticket pianificati da riorganizzare
         # secondo l'implementazione attuale. Ma la directive dice: "Un ticket con tecnico_id e planned_start va considerato locked implicito."
         # Seguiamo la directive alla lettera:
        if is_locked:
            locked_tickets.append(t)
        else:
            tickets.append(t)

    # --- Tecnici ---
    tecnico_query = db.query(Tecnico).filter(Tecnico.stato == "in servizio")
    if tenant_id:
        tecnico_query = tecnico_query.filter(Tecnico.tenant_id == tenant_id)
    tecnici = tecnico_query.all()

    tecnico_ids = [tc.id for tc in tecnici]
    assenze_map: Dict[int, List[date]] = {}
    if tecnico_ids:
        assenze_query = db.query(TecnicoAssenza).filter(
            TecnicoAssenza.tecnico_id.in_(tecnico_ids),
            TecnicoAssenza.data_fine >= today,
            TecnicoAssenza.data_inizio <= horizon_dates[-1],
        )
        if tenant_id:
            assenze_query = assenze_query.filter(TecnicoAssenza.tenant_id == tenant_id)
        for assenza in assenze_query.all():
            inizio = assenza.data_inizio.date() if isinstance(assenza.data_inizio, datetime) else assenza.data_inizio
            fine = assenza.data_fine.date() if isinstance(assenza.data_fine, datetime) else assenza.data_fine
            giorno = max(inizio, today)
            fine_eff = min(fine, horizon_dates[-1])
            while giorno <= fine_eff:
                assenze_map.setdefault(assenza.tecnico_id, []).append(giorno)
                giorno += timedelta(days=1)

    # --- Asset dai ticket ---
    # joinedload(Asset.impianto) garantisce che la relazione sia caricata nella stessa query
    # ed evita DetachedInstanceError quando si accede a asset.impianto dentro una funzione async.
    asset_ids_from_tickets = list({t.asset_id for t in tickets if t.asset_id})
    asset_query = db.query(Asset).options(joinedload(Asset.impianto)).filter(Asset.id.in_(asset_ids_from_tickets))
    assets = asset_query.all()
    asset_map: Dict[int, Asset] = {a.id: a for a in assets}

    # --- Meteo per ogni location unica ---
    # Usa le coordinate dell'asset oppure dell'impianto associato
    location_weather: Dict[str, Dict[str, Any]] = {}
    unique_locations: Dict[str, tuple] = {}

    assets_senza_coordinate: List[str] = []
    for asset in assets:
        lat = asset.latitude
        lon = asset.longitude
        # Fallback: coordinate dell'impianto (precaricato con joinedload)
        if (lat is None or lon is None) and asset.impianto:
            lat = asset.impianto.latitude
            lon = asset.impianto.longitude
        if lat is not None and lon is not None:
            key = f"{round(lat,3)}_{round(lon,3)}"
            unique_locations[key] = (lat, lon)
        elif asset.weather_constraint and asset.weather_constraint != "NONE":
            # Asset con vincolo meteo ma senza coordinate: impossibile validare
            assets_senza_coordinate.append(f"{asset.nome or asset.id} (vincolo: {asset.weather_constraint})")

    if assets_senza_coordinate:
        logger.warning(
            "collect_planning_context: %d asset con vincolo meteo mancano di coordinate — "
            "la valutazione meteo non sarà possibile: %s",
            len(assets_senza_coordinate),
            ", ".join(assets_senza_coordinate),
        )
    if unique_locations:
        logger.info(
            "collect_planning_context: recupero meteo per %d location uniche su orizzonte %d giorni",
            len(unique_locations), days,
        )

    for loc_key, (lat, lon) in unique_locations.items():
        location_weather[loc_key] = {}
        for d in horizon_dates:
            weather = await get_weather_forecast(lat, lon, d)
            location_weather[loc_key][str(d)] = {
                "temperature_c": weather.temperature_c if weather else None,
                "wind_speed_kmh": weather.wind_speed_kmh if weather else None,
                "precipitation_mm": weather.precipitation_mm if weather else None,
                "is_stormy": weather.is_stormy if weather else None,
                "is_freezing": weather.is_freezing if weather else None,
                "is_high_wind": weather.is_high_wind if weather else None,
                "weather_code": weather.weather_code if weather else None,
                "available": weather is not None,
            }

    # --- Costruzione contesto strutturato ---
    tickets_data = []
    for t in tickets:
        asset = asset_map.get(t.asset_id) if t.asset_id else None
        lat = None
        lon = None
        if asset:
            lat = asset.latitude
            lon = asset.longitude
            if (lat is None or lon is None) and asset.impianto:
                lat = asset.impianto.latitude
                lon = asset.impianto.longitude
        loc_key = f"{round(lat,3)}_{round(lon,3)}" if lat is not None and lon is not None else None

        weather_by_date = location_weather.get(loc_key, {}) if loc_key else {}

        # Calcola vincoli meteo per ogni giorno dell'orizzonte
        day_constraints = {}
        if asset and asset.weather_constraint:
            for d in horizon_dates:
                wd_raw = weather_by_date.get(str(d))
                if wd_raw and wd_raw.get("available"):
                    wd = WeatherData(
                        temperature_c=wd_raw["temperature_c"],
                        wind_speed_kmh=wd_raw["wind_speed_kmh"],
                        precipitation_mm=wd_raw["precipitation_mm"],
                        weather_code=wd_raw["weather_code"],
                        is_stormy=wd_raw["is_stormy"],
                        is_freezing=wd_raw["is_freezing"],
                        is_high_wind=wd_raw["is_high_wind"],
                    )
                    warning = _check_weather_constraint(asset.weather_constraint, wd)
                else:
                    warning = _check_weather_constraint(asset.weather_constraint, None)
                day_constraints[str(d)] = warning

        # Skill check per tecnici disponibili
        qualified_tecnici = [tc.id for tc in tecnici if _tecnico_has_skill(tc, t)]

        tickets_data.append({
            "id": t.id,
            "titolo": t.titolo,
            "tipo": t.tipo,
            "priorita": t.priorita,
            "stato": t.stato,
            "durata_stimata_ore": t.durata_stimata_ore,
            "competenza_richiesta": t.competenza_richiesta,
            "fascia_oraria": t.fascia_oraria,
            "descrizione": t.descrizione,
            "asset_id": t.asset_id,
            "asset_nome": anonymizer.mask_text(asset.nome) if asset else None,
            "asset_area": asset.area if asset else None,
            "asset_weather_constraint": asset.weather_constraint if asset else None,
            "asset_fermo_on_schedule": asset.fermo_on_schedule if asset else False,
            "is_breakdown": _is_breakdown(t),
            "qualified_tecnici_ids": qualified_tecnici,
            "weather_by_day": day_constraints,
        })

    locked_data = []
    for t in locked_tickets:
        locked_data.append({
            "id": t.id,
            "tecnico_id": t.tecnico_id,
            "planned_start": str(t.planned_start) if t.planned_start else None,
            "planned_finish": str(t.planned_finish) if t.planned_finish else None,
            "durata_stimata_ore": t.durata_stimata_ore,
            "is_manual_plan": getattr(t, "is_manual_plan", False)
        })

    tecnici_data = []
    for tc in tecnici:
        tecnici_data.append({
            "id": tc.id,
            "nome": f"{tc.nome} {tc.cognome or ''}".strip(),
            "competenze": tc.competenze,
            "ore_giornaliere": max(tc.ore_giornaliere or 8, workday_end_hour - 8) if workday_end_hour > 17 else (tc.ore_giornaliere or 8),
            "orario_inizio": tc.orario_inizio or "08:00",
            "orario_fine": f"{workday_end_hour:02d}:00" if workday_end_hour > 17 else (tc.orario_fine or "17:00"),
            "giorni_assenza": [d.isoformat() for d in assenze_map.get(tc.id, [])],
        })

    # --- Storico piani recenti (#3) ---
    piani_recenti_data = []
    piani_recenti_str = ""
    ticket_ids_deferred_counts: Dict[int, int] = {}
    try:
        piani_recenti = db.query(GeneratedPlan).filter(
            GeneratedPlan.tenant_id == tenant_id,
            GeneratedPlan.status == "confirmed",
        ).order_by(GeneratedPlan.id.desc()).limit(2).all()

        for piano in piani_recenti:
            if not piano.plan_json:
                continue
            wos = piano.plan_json.get("planned_workorders", [])
            n_wo = len([w for w in wos if not w.get("is_continuation", False)])
            deferred = piano.plan_json.get("deferred_workorders", [])
            pn = piano.plan_number or piano.id
            piani_recenti_data.append({
                "plan_number": pn,
                "wo_count": n_wo,
                "deferred_count": len(deferred),
            })
            # Conta ticket ricorrentemente rimandati
            for d in deferred:
                wid = d.get("wo_id")
                if wid:
                    ticket_ids_deferred_counts[wid] = ticket_ids_deferred_counts.get(wid, 0) + 1

        if piani_recenti_data:
            piani_recenti_str = "\n".join(
                f"- Piano #{p['plan_number']}: {p['wo_count']} WO pianificati, {p['deferred_count']} rimandati"
                for p in piani_recenti_data
            )
            # Ticket rimandati ricorrenti (in 2+ piani)
            ricorrenti = [wid for wid, cnt in ticket_ids_deferred_counts.items() if cnt >= 2]
            if ricorrenti:
                piani_recenti_str += f"\nTicket ricorrentemente rimandati (id): {ricorrenti}"
    except Exception as exc:
        logger.warning("collect_planning_context: errore caricamento storico piani: %s", exc)

    # --- Statistiche esecuzioni feedback (#9) ---
    feedback_stats_str = ""
    try:
        from sqlalchemy import func as _func
        cutoff_30d = datetime.now() - timedelta(days=30)
        feedback_rows = db.query(
            Ticket.tipo,
            _func.count(Ticket.id).label("count"),
            _func.avg(Ticket.durata_stimata_ore).label("durata_stimata_media"),
        ).filter(
            Ticket.tenant_id == tenant_id,
            Ticket.stato == "Chiuso",
            Ticket.execution_finish >= cutoff_30d,
            Ticket.execution_start.isnot(None),
            Ticket.execution_finish.isnot(None),
        ).group_by(Ticket.tipo).all()

        if feedback_rows:
            lines = []
            for row in feedback_rows:
                if row.tipo and row.count:
                    durata_str = f"{round(float(row.durata_stimata_media), 1)}h (stimata media)" if row.durata_stimata_media else "N/A"
                    lines.append(f"- {row.tipo}: {row.count} completati, durata {durata_str}")
            if lines:
                feedback_stats_str = "\n".join(lines)
    except Exception as exc:
        logger.warning("collect_planning_context: errore query feedback stats: %s", exc)

    result = {
        "horizon_dates": [str(d) for d in horizon_dates],
        "tickets": tickets_data,
        "locked_tickets": locked_data,
        "tecnici": tecnici_data,
        "weather_available": len(location_weather) > 0,
        # Diagnostica meteo: utile per UI e debug
        "weather_locations_count": len(unique_locations),
        "weather_assets_no_coords": assets_senza_coordinate,
        "assenze_map": assenze_map,
        # Storico e feedback (#3, #9)
        "piani_recenti_str": piani_recenti_str,
        "feedback_stats_str": feedback_stats_str,
    }

    # Salva in cache se applicabile
    if cache_key is not None:
        _CTX_CACHE[cache_key] = (_time.monotonic(), result)
        logger.info("collect_planning_context: cache SET (tenant=%d, days=%d)", tenant_id, days)

    return result


async def generate_ai_plan(
    db: Session,
    days: int = 7,
    asset_ids: Optional[List[int]] = None,
    tenant_id: Optional[int] = None,
    start_date: Optional[date] = None,
    include_weekends: bool = False,
    workday_end_hour: int = 17,
) -> Dict[str, Any]:
    """
    Genera un piano manutenzione AI completo.
    Ritorna il dizionario JSON del piano oppure {"error": ..., "raw_response": ...} in caso di fallimento.
    """
    context = await collect_planning_context(
        db,
        days=days,
        asset_ids=asset_ids,
        tenant_id=tenant_id,
        start_date=start_date,
        include_weekends=include_weekends,
        workday_end_hour=workday_end_hour,
    )

    if not context["tickets"]:
        return {
            "planned_workorders": [],
            "deferred_workorders": [],
            "fermo_assets": [],
            "global_warnings": ["Nessun ticket aperto o pianificato trovato nel sistema."],
        }

    if not context["tecnici"]:
        wo_ids = [t["id"] for t in context["tickets"]]
        return {
            "planned_workorders": [],
            "deferred_workorders": [{"wo_id": wid, "reason": "Nessun tecnico disponibile in servizio"} for wid in wo_ids],
            "fermo_assets": [],
            "global_warnings": ["Nessun tecnico in servizio trovato nel sistema."],
        }

    # ── Anonymizzazione GDPR prima dell'invio a OpenAI ───────────────────────
    # I nomi reali dei tecnici vengono sostituiti con token Tecnico-{id}.
    # titolo e descrizione dei ticket vengono mascherati (email, telefoni, nomi).
    _tecnico_names = [tc["nome"] for tc in context["tecnici"] if tc.get("nome")]
    _sensitive_words = [w for name in _tecnico_names for w in name.split() if len(w) > 2]

    anon_tecnici = [
        {**tc, "nome": f"Tecnico-{tc['id']}"}
        for tc in context["tecnici"]
    ]
    anon_tickets = [
        {
            **t,
            "titolo": anonymizer.mask_text(t.get("titolo") or "", _sensitive_words),
            "descrizione": anonymizer.mask_text(t.get("descrizione") or "", _sensitive_words),
        }
        for t in context["tickets"]
    ]
    # ─────────────────────────────────────────────────────────────────────────

    # Sezioni storico e feedback da includere nel prompt
    storico_section = ""
    if context.get("piani_recenti_str"):
        storico_section = f"""
STORICO PIANI RECENTI:
{context['piani_recenti_str']}
"""
    feedback_section = ""
    if context.get("feedback_stats_str"):
        feedback_section = f"""
STATISTICHE ESECUZIONI (ultimi 30gg):
{context['feedback_stats_str']}
Nota: considera queste durate reali per stimare meglio i tempi.
"""

    user_message = f"""Genera un piano manutenzione ottimizzato per i prossimi {days} giorni.

ORIZZONTE TEMPORALE: {context['horizon_dates'][0]} → {context['horizon_dates'][-1]}

TECNICI DISPONIBILI:
{json.dumps(anon_tecnici, ensure_ascii=False, indent=2)}

WORK ORDERS DA PIANIFICARE (ticket):
{json.dumps(anon_tickets, ensure_ascii=False, indent=2)}

WORK ORDERS GIA' PIANIFICATI (locked_tickets - consumano orario ma NON DEVONO ASSOLUTAMENTE essere restituiti nell'output!):
{json.dumps(context['locked_tickets'], ensure_ascii=False, indent=2)}

NOTE METEO:
- Dati meteo disponibili: {'SI' if context['weather_available'] else 'NO — pianifica comunque, aggiungi warning generali'}
- I vincoli meteo per giorno sono già calcolati nel campo weather_by_day di ogni ticket
- Se weather_by_day[data] != null, il vincolo è violato per quel giorno{storico_section}{feedback_section}

SCHEMA RISPOSTA RICHIESTO:
{{
  "planned_workorders": [
    {{
      "wo_id": <int>,
      "technician_id": <int>,
      "planned_date": "YYYY-MM-DD",
      "time_slot": "HH:MM-HH:MM",
      "motivation": "<max 2 righe>",
      "warnings": ["<eventuale warning>"]
    }}
  ],
  "deferred_workorders": [
    {{
      "wo_id": <int>,
      "reason": "<motivazione esatta>"
    }}
  ],
  "fermo_assets": [
    {{
      "asset_id": <int>,
      "triggered_by_wo_id": <int>
    }}
  ],
  "global_warnings": ["<warning globale>"]
}}

Ogni ticket deve apparire esattamente una volta: o in planned_workorders o in deferred_workorders.
"""

    try:
        ai_client = get_openai_client()
        model = get_openai_model()

        response = ai_client.chat.completions.create(
            model=model,
            messages=[
                {"role": "system", "content": FELIX_SYSTEM_PROMPT},
                {"role": "user", "content": user_message},
            ],
            response_format={
                "type": "json_schema",
                "json_schema": RESPONSE_SCHEMA,
            },
            temperature=0.2,
            max_tokens=4096,
        )

        raw = response.choices[0].message.content
        plan_result = json.loads(raw)

        # Integra splitting e calcolo orari (con buffer spostamento impianti #5)
        technician_hours = {tc["id"]: max(tc.get("ore_giornaliere", 8), workday_end_hour - 8) if workday_end_hour > 17 else tc.get("ore_giornaliere", 8) for tc in context["tecnici"]}
        # Mappa asset_id → impianto_id per il buffer spostamento
        asset_impianto_map: Dict[int, Optional[int]] = {}
        for t in context["tickets"]:
            aid = t.get("asset_id")
            # Non abbiamo impianto_id direttamente nel ticket context — usiamo None per ora
            # (il bridge deterministico ha questa info, l'AI usa il buffer semplificato)
            if aid:
                asset_impianto_map[aid] = None
        plan_result["planned_workorders"] = calculate_split_assignments(
            plan_result.get("planned_workorders", []),
            technician_hours,
            include_weekends=include_weekends,
            workday_end=workday_end_hour,
        )

        # Calcola efficienza piano con parametri reali (#1, #13)
        today_d = start_date or date.today()
        end_d = today_d + timedelta(days=days - 1)
        efficiency_data = calculate_plan_efficiency(
            plan_result,
            context["tecnici"],
            total_backlog=len(context["tickets"]),
            plan_start_date=today_d,
            plan_end_date=end_d,
            absences=context.get("assenze_map"),
            include_weekends=include_weekends,
        )
        plan_result["efficiency_score"] = efficiency_data["efficiency_score"]
        plan_result["efficiency_breakdown"] = efficiency_data["efficiency_breakdown"]
        plan_result["efficiency_motivations"] = efficiency_data.get("efficiency_motivations", [])
        # Aggiungi metadati ore (#13)
        plan_result.setdefault("plan_metadata", {}).update({
            "ore_disponibili_teoriche": efficiency_data.get("ore_disponibili_teoriche"),
            "ore_disponibili_effettive": efficiency_data.get("ore_disponibili_effettive"),
            "ore_assegnate": efficiency_data.get("ore_assegnate"),
        })

        return plan_result

    except json.JSONDecodeError as exc:
        logger.error("AI Planner: errore parsing JSON risposta: %s", exc)
        return {"error": f"Errore parsing risposta AI: {exc}", "raw_response": raw if "raw" in dir() else ""}
    except Exception as exc:
        logger.error("AI Planner: errore chiamata OpenAI: %s", exc)
        return {"error": f"Errore chiamata AI: {exc}", "raw_response": ""}


# ── Ticket Splitting ───────────────────────────────────────────────────────────

WORKDAY_START = 8.0    # 08:00
WORKDAY_END   = 17.0   # 17:00
WORKDAY_HOURS = WORKDAY_END - WORKDAY_START  # 9 ore lorde
BUFFER_STESSO_IMPIANTO  = 0.25  # 15 min buffer stesso impianto (#5)
BUFFER_IMPIANTO_DIVERSO = 1.0   # 1 ora buffer impianto diverso (#5)
BUFFER_HOURS  = BUFFER_STESSO_IMPIANTO  # default legacy (compatibilità)


def _next_workday(d: date, include_weekends: bool = False) -> date:
    """Ritorna il prossimo giorno schedulabile."""
    next_d = d + timedelta(days=1)
    while not include_weekends and next_d.weekday() >= 5:
        next_d += timedelta(days=1)
    return next_d


def _hours_to_time(h: float) -> str:
    hh = int(h)
    mm = int(round((h - hh) * 60))
    if mm == 60:
        hh += 1
        mm = 0
    return f"{hh:02d}:{mm:02d}"


def calculate_split_assignments(
    planned_wos: list,
    technician_hours: dict,
    asset_impianto_map: Optional[Dict[int, Optional[int]]] = None,
    include_weekends: bool = False,
    workday_end: int = 17,
) -> list:
    """
    Riceve la lista planned_workorders dall'AI (con wo_id, technician_id, planned_date, duration_hours)
    e calcola orari inizio/fine con splitting se un WO supera le ore disponibili.

    technician_hours: dict {tech_id: ore_giornaliere} — fallback ore se non disponibile
    asset_impianto_map: dict {asset_id: impianto_id} — per buffer spostamento (#5)

    Ritorna lista arricchita con:
    - planned_start_time: "HH:MM"
    - planned_end_time:   "HH:MM"
    - is_continuation:    bool
    - parent_wo_id:       int | None
    - continuation_wos:   list (WO figli da aggiungere)
    """
    # Tracking ultima ora occupata per (tech_id, date_str)
    tech_day_end: Dict[tuple, float] = {}
    # Tracking ultimo impianto per tecnico nel giorno per buffer spostamento (#5)
    tech_last_impianto: Dict[tuple, Optional[int]] = {}

    result = []
    continuations = []

    for wo in planned_wos:
        tech_id = wo.get("technician_id")
        day = wo.get("planned_date", "")

        # Ricava durata dal time_slot se duration_hours non disponibile
        duration = float(wo.get("duration_hours", 0.0))
        if duration == 0.0:
            slot = wo.get("time_slot", "")
            if slot and "-" in slot:
                try:
                    parts = slot.split("-")
                    start_parts = parts[0].strip().split(":")
                    end_parts = parts[1].strip().split(":")
                    s_h = int(start_parts[0]) + int(start_parts[1]) / 60.0
                    e_h = int(end_parts[0]) + int(end_parts[1]) / 60.0
                    duration = max(e_h - s_h, 0.5)
                except (IndexError, ValueError):
                    duration = 2.0
            else:
                duration = 2.0

        key = (tech_id, day)
        start_h = tech_day_end.get(key, WORKDAY_START)
        if start_h > WORKDAY_START:
            # Buffer spostamento adattivo (#5)
            curr_asset_id = wo.get("asset_id")
            curr_impianto = (asset_impianto_map or {}).get(curr_asset_id) if curr_asset_id else None
            last_impianto = tech_last_impianto.get(key)
            if last_impianto is not None and curr_impianto is not None and last_impianto != curr_impianto:
                buffer = BUFFER_IMPIANTO_DIVERSO
            else:
                buffer = BUFFER_STESSO_IMPIANTO
            start_h += buffer

        effective_workday_end = float(workday_end)
        available = effective_workday_end - start_h

        enriched = {**wo}

        # Traccia impianto per prossimo buffer calcolo (#5)
        curr_asset_id = wo.get("asset_id")
        curr_impianto_id = (asset_impianto_map or {}).get(curr_asset_id) if curr_asset_id else None

        if duration <= available:
            end_h = start_h + duration
            enriched["planned_start_time"] = _hours_to_time(start_h)
            enriched["planned_end_time"]   = _hours_to_time(end_h)
            enriched["duration_hours"]     = duration
            enriched["is_continuation"]    = wo.get("is_continuation", False)
            enriched["parent_wo_id"]       = wo.get("parent_wo_id", None)
            enriched["continuation_wos"]   = []
            enriched["confidence_score"]   = wo.get("confidence_score", None)
            enriched["risk_level"]         = wo.get("risk_level", None)
            enriched["complexity"]         = wo.get("complexity", None)
            tech_day_end[key] = end_h
            tech_last_impianto[key] = curr_impianto_id
            result.append(enriched)
        else:
            # Tronca al turno corrente
            trunc_end = effective_workday_end
            enriched["planned_start_time"] = _hours_to_time(start_h)
            enriched["planned_end_time"]   = _hours_to_time(trunc_end)
            enriched["is_continuation"]    = wo.get("is_continuation", False)
            enriched["parent_wo_id"]       = wo.get("parent_wo_id", None)
            enriched["duration_hours"]     = available
            enriched["confidence_score"]   = wo.get("confidence_score", None)
            enriched["risk_level"]         = wo.get("risk_level", None)
            enriched["complexity"]         = wo.get("complexity", None)
            tech_day_end[key] = trunc_end
            tech_last_impianto[key] = curr_impianto_id

            # WO di continuazione
            remaining = duration - available
            try:
                next_day = _next_workday(date.fromisoformat(day), include_weekends=include_weekends)
            except ValueError:
                next_day = date.today() + timedelta(days=1)

            cont_wo: Dict[str, Any] = {
                **wo,
                "planned_date":      str(next_day),
                "planned_start_time": _hours_to_time(WORKDAY_START),
                "duration_hours":    remaining,
                "is_continuation":   True,
                "parent_wo_id":      wo["wo_id"],
                "title":             "[CONTINUAZIONE] " + wo.get("title", f"WO #{wo['wo_id']}"),
                "warnings":          list(wo.get("warnings", [])) + ["Continuazione da giorno precedente"],
            }
            enriched["continuation_wos"] = [cont_wo]
            continuations.append(cont_wo)
            result.append(enriched)

    # Calcola orari per i WO di continuazione e aggiungili
    for cont in continuations:
        tech_id = cont["technician_id"]
        day = cont["planned_date"]
        duration = float(cont["duration_hours"])
        key = (tech_id, day)
        start_h = tech_day_end.get(key, WORKDAY_START)
        if start_h > WORKDAY_START:
            start_h += BUFFER_HOURS
        end_h = min(start_h + duration, float(workday_end))
        cont["planned_start_time"] = _hours_to_time(start_h)
        cont["planned_end_time"]   = _hours_to_time(end_h)
        cont["continuation_wos"]   = []
        tech_day_end[key] = end_h
        result.append(cont)

    return result


# ── Efficienza Piano ───────────────────────────────────────────────────────────

def calculate_plan_efficiency(
    plan: Dict[str, Any],
    technicians: list,
    total_backlog: int,
    plan_start_date: Optional[date] = None,
    plan_end_date: Optional[date] = None,
    absences: Optional[Dict[int, List[date]]] = None,
    include_weekends: bool = False,
) -> Dict[str, Any]:
    """
    Calcola efficiency score 0-100 con breakdown per 5 fattori e motivazioni testuali.

    Parametri aggiuntivi opzionali (#1, #13):
    - plan_start_date / plan_end_date: orizzonte per calcolo ore reali
    - absences: dict {tecnico_id: [giorni_assenza]} per detrarre le assenze
    """
    import math as _math_local
    planned = plan.get("planned_workorders", [])
    deferred = plan.get("deferred_workorders", [])

    n_planned = len([w for w in planned if not w.get("is_continuation")])
    n_total = n_planned + len(deferred)

    # 1. Copertura backlog (30%)
    copertura = (n_planned / max(n_total, 1)) * 100

    # 2. Utilizzo tecnici (25%) — ore reali con assenze (#1)
    ore_assegnate = sum(
        float(w.get("duration_hours", 2))
        for w in planned
        if not w.get("is_continuation")
    )

    # Calcola ore disponibili teoriche e reali
    if plan_start_date and plan_end_date:
        range_dates = [
            plan_start_date + timedelta(days=i)
            for i in range((plan_end_date - plan_start_date).days + 1)
        ]
        ore_teoriche = 0.0
        ore_effettive = 0.0
        for tecnico in technicians:
            tid = tecnico.get("id")
            ore_gg = float(tecnico.get("ore_giornaliere", 8))
            # Giorni lavorativi teorici (lunedì-venerdì nell'orizzonte)
            giorni_teorici = range_dates if include_weekends else [d for d in range_dates if d.weekday() < 5]
            ore_teoriche += ore_gg * len(giorni_teorici)
            # Giorni lavorativi reali (escludi assenze)
            assenze_tecnico = (absences or {}).get(tid, [])
            giorni_reali = [d for d in giorni_teorici if d not in assenze_tecnico]
            ore_effettive += ore_gg * len(giorni_reali)
    else:
        # Fallback: assume 5 giorni lavorativi (comportamento legacy)
        ore_teoriche = sum(float(t.get("ore_giornaliere", 8)) * 5 for t in technicians)
        ore_effettive = ore_teoriche

    ore_disponibili = ore_effettive or 1.0
    utilizzo = min((ore_assegnate / ore_disponibili) * 100, 100)

    # 3. Bilanciamento 70/30 — solo PM e CM, esclude BD, penalità logaritmica (#6)
    types = [w.get("wo_type", w.get("tipo", "PM")) for w in planned if not w.get("is_continuation")]
    n_pm = sum(1 for t in types if "PM" in str(t).upper() and "BD" not in str(t).upper())
    n_cm = sum(1 for t in types if "CM" in str(t).upper() and "BD" not in str(t).upper())
    n_schedulabili = n_pm + n_cm
    if n_schedulabili == 0:
        bilanciamento = 100  # nessun ticket schedulabile → score neutro
        ratio_pm = 70.0      # valore neutro per motivazioni
    else:
        ratio_pm = (n_pm / n_schedulabili) * 100
        scostamento = abs(ratio_pm - 70)
        # Penalità logaritmica: meno aggressiva per scostamenti piccoli
        bilanciamento = max(0, 100 - _math_local.log1p(scostamento) * 20)

    # 4. Match skill (15%) — proxy: WO non rimandati per mancanza skill
    skill_ko = sum(
        1 for d in deferred
        if "skill" in d.get("reason", "").lower() or "qualific" in d.get("reason", "").lower()
    )
    skill_score = max(0, 100 - (skill_ko / max(n_total, 1)) * 100)

    # 5. Ottimizzazione meteo (10%)
    wo_with_meteo_warning = sum(
        1 for w in planned
        if any(
            "meteo" in (x or "").lower()
            or "pioggia" in (x or "").lower()
            or "vento" in (x or "").lower()
            or "gelo" in (x or "").lower()
            for x in w.get("warnings", [])
        )
    )
    meteo_score = max(0, 100 - (wo_with_meteo_warning / max(n_planned, 1)) * 100)

    efficiency = (
        copertura    * 0.30
        + utilizzo   * 0.25
        + bilanciamento * 0.20
        + skill_score   * 0.15
        + meteo_score   * 0.10
    )

    # ── Motivazioni per componenti sotto target ───────────────────────────────
    n_deferred = len(deferred)
    motivations = []

    if copertura < 85:
        motivations.append({
            "componente": "Copertura backlog",
            "valore": round(copertura, 1),
            "target": 85,
            "spiegazione": (
                f"{n_deferred} ticket non pianificati su {n_total} totali "
                f"({round(100 - copertura)}% del backlog rimandato)."
            ),
            "suggerimento": (
                "Aggiungi disponibilità tecnici nei giorni mancanti o sposta "
                "i ticket meno urgenti alla settimana successiva."
            ),
        })

    if utilizzo < 70:
        ore_libere = round(ore_disponibili - ore_assegnate, 1)
        motivations.append({
            "componente": "Utilizzo tecnici",
            "valore": round(utilizzo, 1),
            "target": 70,
            "spiegazione": (
                f"Capacità tecnici usata al {round(utilizzo)}%: "
                f"{ore_libere}h non assegnate su {round(ore_disponibili, 1)}h disponibili."
            ),
            "suggerimento": (
                "Carica più ticket in backlog o attiva interventi PM preventivi "
                "per riempire i turni liberi."
            ),
        })

    if bilanciamento < 80:
        motivations.append({
            "componente": "Bilanciamento PM/CM (target 70/30)",
            "valore": round(ratio_pm, 1),
            "target": 70,
            "spiegazione": (
                f"Rapporto PM su schedulabili (PM+CM): {round(ratio_pm)}% (target 70%). "
                f"{n_cm} CM vs {n_pm} PM (BD esclusi dal KPI)."
            ),
            "suggerimento": (
                "Aggiungi attività PM preventive al backlog per avvicinarsi "
                "al rapporto 70/30."
            ),
        })

    if skill_score < 90:
        motivations.append({
            "componente": "Match competenze tecnici",
            "valore": round(skill_score, 1),
            "target": 90,
            "spiegazione": (
                f"{skill_ko} ticket rimandati per assenza di tecnici qualificati."
            ),
            "suggerimento": (
                "Verifica le competenze assegnate ai tecnici o inserisci un "
                "tecnico con le skill richieste."
            ),
        })

    if meteo_score < 90:
        motivations.append({
            "componente": "Ottimizzazione meteo",
            "valore": round(meteo_score, 1),
            "target": 90,
            "spiegazione": (
                f"{wo_with_meteo_warning} ticket pianificati con avvisi meteo "
                "attivi sui vincoli asset."
            ),
            "suggerimento": (
                "Sposta gli interventi all'aperto a giorni con previsioni "
                "favorevoli o rivedi i vincoli meteo degli asset."
            ),
        })

    return {
        "efficiency_score": round(efficiency, 1),
        "efficiency_breakdown": {
            "copertura_backlog":    round(copertura, 1),
            "utilizzo_tecnici":     round(utilizzo, 1),
            "bilanciamento_70_30":  round(bilanciamento, 1),
            "match_skill":          round(skill_score, 1),
            "ottimizzazione_meteo": round(meteo_score, 1),
        },
        "efficiency_motivations": motivations,
        # Metadati ore per UI (#13)
        "ore_disponibili_teoriche": round(ore_teoriche, 1),
        "ore_disponibili_effettive": round(ore_disponibili, 1),
        "ore_assegnate": round(ore_assegnate, 1),
    }
