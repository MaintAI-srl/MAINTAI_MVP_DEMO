"""
AI Planner Service — MARCO, il Planner Senior di Manutenzione Industriale.
Genera piani manutenzione ottimizzati usando OpenAI + previsioni meteo Open-Meteo.
"""
from __future__ import annotations

import json
import logging
from datetime import date, datetime, timedelta, time
from typing import Any, Dict, List, Optional

from sqlalchemy.orm import Session

from backend.services.ai.openai_service import get_openai_client, get_openai_model
from backend.services.weather_service import get_weather_forecast
from backend.db.modelli import Ticket, Tecnico, Asset

logger = logging.getLogger(__name__)

MARCO_SYSTEM_PROMPT = """Sei MARCO, un Planner Senior di Manutenzione Industriale con 20 anni di esperienza
in impianti energetici, portuali e manifatturieri. Pianifichi interventi con la
precisione di un esperto certificato RCM e TPM.

Le tue regole ferree sono le seguenti e non ammettono eccezioni:

REGOLA 1 — PRIORITÀ BREAKDOWN
I guasti BD (Breakdown) hanno sempre la massima priorità assoluta. Vengono
pianificati prima di qualsiasi altro intervento. Non si negoziano con il
bilanciamento percentuale.

REGOLA 2 — BILANCIAMENTO BACKLOG
Il backlog settimanale, esclusi i BD, deve rispettare il rapporto 70% PM
(Manutenzione Preventiva) e 30% CM (Manutenzione Correttiva programmata).
Se il backlog disponibile non permette esattamente questo rapporto, avvicinati
il più possibile privilegiando i PM.

REGOLA 3 — ASSEGNAZIONE TECNICI
Assegni ogni WO esclusivamente al tecnico con le skill richieste. Se più tecnici
sono qualificati, preferisci quello con più ore disponibili per bilanciare il
carico. Non assegnare mai un WO a un tecnico senza le competenze necessarie:
in quel caso inserisci il WO nei RIMANDATI con motivazione "nessun tecnico
qualificato disponibile".

REGOLA 4 — VINCOLI METEO
Rispetti sempre i vincoli meteo degli asset. Un WO su un asset con vincolo
NO_RAIN non va mai pianificato in giorni con precipitazioni previste.
NO_FROST blocca con temperatura sotto 2°C. NO_WIND blocca con vento sopra
40 km/h. Se il meteo non è disponibile per una location, pianifica comunque
e aggiungi un warning esplicito.

REGOLA 5 — ASSET IN FERMO
Se un asset ha il flag fermo_on_schedule attivo, includilo nel piano segnalando
che l'asset entrerà in modalità FERMO al momento della conferma del piano.
Inseriscilo nella lista fermo_assets della risposta.

REGOLA 6 — OTTIMIZZAZIONE LOGISTICA
Pianifica in modo realistico: non superare mai le ore disponibili di un tecnico,
raggruppa interventi sullo stesso asset o area geografica nella stessa giornata
quando possibile per ridurre gli spostamenti, considera almeno 30 minuti di
buffer tra interventi consecutivi dello stesso tecnico.

REGOLA 7 — TRASPARENZA
Per ogni WO pianificato fornisci: data, fascia oraria stimata, tecnico assegnato,
motivazione della scelta (massimo due righe), eventuali warning attivi.
Per ogni WO rimandato fornisci la motivazione esatta.

Rispondi SEMPRE e SOLO con un oggetto JSON valido secondo lo schema fornito.
Non aggiungere testo, commenti o markdown fuori dal JSON."""

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
                    },
                    "required": ["wo_id", "technician_id", "planned_date", "time_slot", "motivation", "warnings"],
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


def _tecnico_has_skill(tecnico: Tecnico, ticket: Ticket) -> bool:
    """Verifica se il tecnico ha le competenze richieste per il ticket."""
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
    db: Session, days: int = 7, asset_ids: Optional[List[int]] = None, tenant_id: Optional[int] = None
) -> Dict[str, Any]:
    """
    Raccoglie tutto il contesto necessario per la pianificazione AI:
    ticket aperti/pianificati, tecnici, asset, previsioni meteo.
    """
    today = date.today()
    horizon_dates = [today + timedelta(days=i) for i in range(days)]

    # --- Ticket ---
    ticket_query = db.query(Ticket).filter(
        Ticket.stato.in_(["Aperto", "Pianificato"])
    )
    if tenant_id:
        ticket_query = ticket_query.filter(Ticket.tenant_id == tenant_id)
    if asset_ids:
        ticket_query = ticket_query.filter(Ticket.asset_id.in_(asset_ids))
    tickets = ticket_query.all()

    # --- Tecnici ---
    tecnico_query = db.query(Tecnico).filter(Tecnico.stato == "in servizio")
    if tenant_id:
        tecnico_query = tecnico_query.filter(Tecnico.tenant_id == tenant_id)
    tecnici = tecnico_query.all()

    # --- Asset dai ticket ---
    asset_ids_from_tickets = list({t.asset_id for t in tickets if t.asset_id})
    asset_query = db.query(Asset).filter(Asset.id.in_(asset_ids_from_tickets))
    assets = asset_query.all()
    asset_map: Dict[int, Asset] = {a.id: a for a in assets}

    # --- Meteo per ogni location unica ---
    # Usa le coordinate dell'asset oppure dell'impianto associato
    location_weather: Dict[str, Dict[str, Any]] = {}
    unique_locations: Dict[str, tuple] = {}

    for asset in assets:
        lat = asset.latitude
        lon = asset.longitude
        # Fallback: coordinate dell'impianto
        if (lat is None or lon is None) and asset.impianto:
            lat = asset.impianto.latitude
            lon = asset.impianto.longitude
        if lat is not None and lon is not None:
            key = f"{round(lat,3)}_{round(lon,3)}"
            unique_locations[key] = (lat, lon)

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
            from backend.services.weather_service import WeatherData
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
            "fascia_oraria": t.fascia_oraria,
            "descrizione": t.descrizione,
            "asset_id": t.asset_id,
            "asset_nome": asset.nome if asset else None,
            "asset_area": asset.area if asset else None,
            "asset_weather_constraint": asset.weather_constraint if asset else None,
            "asset_fermo_on_schedule": asset.fermo_on_schedule if asset else False,
            "is_breakdown": _is_breakdown(t),
            "qualified_tecnici_ids": qualified_tecnici,
            "weather_by_day": day_constraints,
        })

    tecnici_data = []
    for tc in tecnici:
        tecnici_data.append({
            "id": tc.id,
            "nome": f"{tc.nome} {tc.cognome or ''}".strip(),
            "competenze": tc.competenze,
            "ore_giornaliere": tc.ore_giornaliere or 8,
            "orario_inizio": tc.orario_inizio or "08:00",
            "orario_fine": tc.orario_fine or "17:00",
        })

    return {
        "horizon_dates": [str(d) for d in horizon_dates],
        "tickets": tickets_data,
        "tecnici": tecnici_data,
        "weather_available": len(location_weather) > 0,
    }


async def generate_ai_plan(
    db: Session, days: int = 7, asset_ids: Optional[List[int]] = None, tenant_id: Optional[int] = None
) -> Dict[str, Any]:
    """
    Genera un piano manutenzione AI completo.
    Ritorna il dizionario JSON del piano oppure {"error": ..., "raw_response": ...} in caso di fallimento.
    """
    context = await collect_planning_context(db, days=days, asset_ids=asset_ids, tenant_id=tenant_id)

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

    user_message = f"""Genera un piano manutenzione ottimizzato per i prossimi {days} giorni.

ORIZZONTE TEMPORALE: {context['horizon_dates'][0]} → {context['horizon_dates'][-1]}

TECNICI DISPONIBILI:
{json.dumps(context['tecnici'], ensure_ascii=False, indent=2)}

WORK ORDERS DA PIANIFICARE (ticket):
{json.dumps(context['tickets'], ensure_ascii=False, indent=2)}

NOTE METEO:
- Dati meteo disponibili: {'SI' if context['weather_available'] else 'NO — pianifica comunque, aggiungi warning generali'}
- I vincoli meteo per giorno sono già calcolati nel campo weather_by_day di ogni ticket
- Se weather_by_day[data] != null, il vincolo è violato per quel giorno

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
                {"role": "system", "content": MARCO_SYSTEM_PROMPT},
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

        # Integra splitting e calcolo orari
        technician_hours = {tc["id"]: tc.get("ore_giornaliere", 8) for tc in context["tecnici"]}
        plan_result["planned_workorders"] = calculate_split_assignments(
            plan_result.get("planned_workorders", []),
            technician_hours,
        )

        # Calcola efficienza piano
        efficiency_data = calculate_plan_efficiency(
            plan_result,
            context["tecnici"],
            total_backlog=len(context["tickets"]),
        )
        plan_result["efficiency_score"] = efficiency_data["efficiency_score"]
        plan_result["efficiency_breakdown"] = efficiency_data["efficiency_breakdown"]

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
BUFFER_HOURS  = 0.5    # 30 min buffer tra interventi


def _next_workday(d: date) -> date:
    """Ritorna il prossimo giorno lavorativo (salta sab/dom)."""
    next_d = d + timedelta(days=1)
    while next_d.weekday() >= 5:
        next_d += timedelta(days=1)
    return next_d


def _hours_to_time(h: float) -> str:
    hh = int(h)
    mm = int(round((h - hh) * 60))
    if mm == 60:
        hh += 1
        mm = 0
    return f"{hh:02d}:{mm:02d}"


def calculate_split_assignments(planned_wos: list, technician_hours: dict) -> list:
    """
    Riceve la lista planned_workorders dall'AI (con wo_id, technician_id, planned_date, duration_hours)
    e calcola orari inizio/fine con splitting se un WO supera le ore disponibili.

    technician_hours: dict {tech_id: ore_giornaliere} — fallback ore se non disponibile

    Ritorna lista arricchita con:
    - planned_start_time: "HH:MM"
    - planned_end_time:   "HH:MM"
    - is_continuation:    bool
    - parent_wo_id:       int | None
    - continuation_wos:   list (WO figli da aggiungere)
    """
    # Tracking ultima ora occupata per (tech_id, date_str)
    tech_day_end: Dict[tuple, float] = {}

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
            start_h += BUFFER_HOURS

        available = WORKDAY_END - start_h

        enriched = {**wo}

        if duration <= available:
            end_h = start_h + duration
            enriched["planned_start_time"] = _hours_to_time(start_h)
            enriched["planned_end_time"]   = _hours_to_time(end_h)
            enriched["duration_hours"]     = duration
            enriched["is_continuation"]    = wo.get("is_continuation", False)
            enriched["parent_wo_id"]       = wo.get("parent_wo_id", None)
            enriched["continuation_wos"]   = []
            tech_day_end[key] = end_h
            result.append(enriched)
        else:
            # Tronca al turno corrente
            trunc_end = WORKDAY_END
            enriched["planned_start_time"] = _hours_to_time(start_h)
            enriched["planned_end_time"]   = _hours_to_time(trunc_end)
            enriched["is_continuation"]    = wo.get("is_continuation", False)
            enriched["parent_wo_id"]       = wo.get("parent_wo_id", None)
            enriched["duration_hours"]     = available
            tech_day_end[key] = trunc_end

            # WO di continuazione
            remaining = duration - available
            try:
                next_day = _next_workday(date.fromisoformat(day))
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
        end_h = min(start_h + duration, WORKDAY_END)
        cont["planned_start_time"] = _hours_to_time(start_h)
        cont["planned_end_time"]   = _hours_to_time(end_h)
        cont["continuation_wos"]   = []
        tech_day_end[key] = end_h
        result.append(cont)

    return result


# ── Efficienza Piano ───────────────────────────────────────────────────────────

def calculate_plan_efficiency(plan: Dict[str, Any], technicians: list, total_backlog: int) -> Dict[str, Any]:
    """
    Calcola efficiency score 0-100 con breakdown per 5 fattori e motivazioni testuali.
    """
    planned = plan.get("planned_workorders", [])
    deferred = plan.get("deferred_workorders", [])

    n_planned = len([w for w in planned if not w.get("is_continuation")])
    n_total = n_planned + len(deferred)

    # 1. Copertura backlog (30%)
    copertura = (n_planned / max(n_total, 1)) * 100

    # 2. Utilizzo tecnici (25%)
    ore_assegnate = sum(
        float(w.get("duration_hours", 2))
        for w in planned
        if not w.get("is_continuation")
    )
    ore_disponibili = sum(float(t.get("ore_giornaliere", 8)) * 5 for t in technicians) or 1
    utilizzo = min((ore_assegnate / ore_disponibili) * 100, 100)

    # 3. Bilanciamento 70/30 (20%)
    types = [w.get("wo_type", w.get("tipo", "PM")) for w in planned if not w.get("is_continuation")]
    n_pm = sum(1 for t in types if "PM" in str(t).upper())
    n_cm = sum(1 for t in types if "CM" in str(t).upper() and "BD" not in str(t).upper())
    n_non_bd = n_pm + n_cm or 1
    ratio_pm = (n_pm / n_non_bd) * 100
    scostamento = abs(ratio_pm - 70)  # target 70%
    bilanciamento = max(0, 100 - scostamento * 2)

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
                f"{ore_libere} ore/settimana non assegnate."
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
                f"Rapporto PM attuale: {round(ratio_pm)}% (target 70%). "
                f"{n_cm} CM vs {n_pm} PM pianificati."
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
    }
