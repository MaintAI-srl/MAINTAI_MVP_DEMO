"""Agenti AI MaintAI — trigger manuale dalla topbar.

Cinque agenti "super esperti" del proprio dominio (Planner, RCA, Cost Controller,
KPI, Suggeritore Strategie). Ognuno:
- raccoglie un contesto compatto dal DB, sempre filtrato per tenant;
- calcola in Python (deterministico) l'analisi di Pareto dove serve, così il
  modello ragiona su numeri già corretti invece di inventarli;
- interroga OpenAI con un prompt da esperto lean (TPM, kaizen, muda, 5 perché);
- registra il run in AiUsageLog con il costo stimato in EUR (badge topbar).

Nessun dato viene inviato a OpenAI oltre al contesto aggregato qui costruito.
"""
from __future__ import annotations

import os
from collections import defaultdict
from datetime import datetime, timedelta, timezone
from typing import Any, Callable

from sqlalchemy.orm import Session

from backend.core.logging_config import get_logger
from backend.db.modelli import (
    AiUsageLog,
    Asset,
    PianoManutenzione,
    Tecnico,
    TecnicoAssenza,
    Ticket,
)
from backend.services.ai.openai_service import get_openai_client, get_openai_model

logger = get_logger(__name__)

# ── Prezzi OpenAI (USD per 1M token: input, output) e cambio EUR ─────────────
# Prezzi listino API; per modelli non in tabella si usa il fallback "mini".
_MODEL_PRICES_USD: dict[str, tuple[float, float]] = {
    "gpt-4.1": (2.00, 8.00),
    "gpt-4.1-mini": (0.40, 1.60),
    "gpt-4.1-nano": (0.10, 0.40),
    "gpt-4o": (2.50, 10.00),
    "gpt-4o-mini": (0.15, 0.60),
}
_FALLBACK_PRICE_USD = _MODEL_PRICES_USD["gpt-4.1-mini"]


def _eur_per_usd() -> float:
    try:
        return float(os.getenv("AI_EUR_PER_USD", "0.92"))
    except ValueError:
        return 0.92


def estimate_cost_eur(model: str | None, prompt_tokens: int, completion_tokens: int) -> float:
    price_in, price_out = _MODEL_PRICES_USD.get(model or "", _FALLBACK_PRICE_USD)
    usd = (prompt_tokens / 1_000_000) * price_in + (completion_tokens / 1_000_000) * price_out
    return round(usd * _eur_per_usd(), 6)


def _now_utc_naive() -> datetime:
    # Le colonne DateTime sono senza timezone: confronto con naive UTC.
    return datetime.now(timezone.utc).replace(tzinfo=None)


# ── Pareto (80/20) deterministico ────────────────────────────────────────────

def build_pareto(values: dict[str, float], titolo: str, unita: str, max_items: int = 15) -> dict[str, Any] | None:
    """Analisi di Pareto: item ordinati per valore con % cumulata e flag 'vital few'.

    `concentrated` dice se esiste una vera concentrazione 80/20: i "vital few"
    (le voci che costruiscono il primo ~80% del totale) devono essere al massimo
    la metà delle voci. Con distribuzioni piatte il flag è False e la UI/l'agente
    non devono presentare i primi item come cause dominanti."""
    rows = [(label, val) for label, val in values.items() if val > 0]
    if not rows:
        return None
    rows.sort(key=lambda r: r[1], reverse=True)
    total = sum(v for _, v in rows)

    items = []
    cumulative = 0.0
    vital_count = 0
    for label, val in rows:
        pct = round(val / total * 100, 1)
        starts_before_80 = cumulative / total * 100 < 80
        cumulative += val
        if starts_before_80:
            vital_count += 1
        items.append({
            "label": label,
            "value": round(val, 2),
            "pct": pct,
            "cum_pct": round(cumulative / total * 100, 1),
            # "vital few": gli item che costruiscono il primo ~80% del totale
            "vital": starts_before_80,
        })

    concentrated = len(rows) >= 4 and vital_count / len(rows) <= 0.5

    others = None
    if len(items) > max_items:
        tail = items[max_items:]
        others = {
            "count": len(tail),
            "value": round(sum(i["value"] for i in tail), 2),
            "pct": round(sum(i["pct"] for i in tail), 1),
        }
        items = items[:max_items]

    return {
        "titolo": titolo,
        "unita": unita,
        "totale": round(total, 2),
        "items": items,
        "n_voci": len(rows),
        "vital_count": vital_count,
        "concentrated": concentrated,
        "others": others,
    }


def _pareto_md(pareto: dict[str, Any] | None) -> str:
    if not pareto:
        return "Nessun dato sufficiente per l'analisi di Pareto."
    if pareto["concentrated"]:
        concentrazione = (
            f"Concentrazione 80/20: SI — {pareto['vital_count']} voci su {pareto['n_voci']} "
            "generano l'80% del totale: concentra l'analisi su queste."
        )
    else:
        concentrazione = (
            f"Concentrazione 80/20: NO — servono {pareto['vital_count']} voci su {pareto['n_voci']} "
            "per arrivare all'80%: distribuzione piatta, NON presentare i primi item come cause "
            "dominanti; ragiona per famiglie/pattern trasversali."
        )
    lines = [
        f"Analisi di Pareto — {pareto['titolo']} (totale: {pareto['totale']} {pareto['unita']})",
        concentrazione,
        "| # | Voce | Valore | % | % cumulata |",
        "|---|------|--------|---|------------|",
    ]
    for i, item in enumerate(pareto["items"], 1):
        lines.append(
            f"| {i} | {item['label']} | {item['value']} | {item['pct']}% | {item['cum_pct']}% |"
        )
    if pareto.get("others"):
        o = pareto["others"]
        lines.append(f"| — | Altre {o['count']} voci | {o['value']} | {o['pct']}% | 100% |")
    return "\n".join(lines)


# ── Raccolta contesto per agente (sempre tenant-filtered) ────────────────────

_ACTIVE_STATES = ("Aperto", "Pianificato", "In corso")


def _asset_label(asset: Asset | None) -> str:
    if not asset:
        return "Asset non specificato"
    code = f"[{asset.codice}] " if asset.codice else ""
    return f"{code}{asset.nome or 'Asset ' + str(asset.id)}"


def _tickets_attivi(db: Session, tenant_id: int) -> list[Ticket]:
    return (
        db.query(Ticket)
        .filter(
            Ticket.tenant_id == tenant_id,
            Ticket.stato.in_(_ACTIVE_STATES),
            Ticket.deleted_at.is_(None),
        )
        .all()
    )


def _assets_map(db: Session, tenant_id: int) -> dict[int, Asset]:
    return {a.id: a for a in db.query(Asset).filter(Asset.tenant_id == tenant_id).all()}


def _collect_planner(db: Session, tenant_id: int) -> dict[str, Any]:
    tickets = _tickets_attivi(db, tenant_id)
    assets = _assets_map(db, tenant_id)
    tecnici = (
        db.query(Tecnico)
        .filter(Tecnico.tenant_id == tenant_id, Tecnico.stato == "in servizio")
        .all()
    )
    now = _now_utc_naive()
    assenze = (
        db.query(TecnicoAssenza)
        .filter(
            TecnicoAssenza.tenant_id == tenant_id,
            TecnicoAssenza.data_fine >= now,
            TecnicoAssenza.data_inizio <= now + timedelta(days=14),
        )
        .all()
    )

    backlog_ore: dict[str, float] = defaultdict(float)
    per_stato: dict[str, int] = defaultdict(int)
    per_priorita: dict[str, int] = defaultdict(int)
    for t in tickets:
        per_stato[t.stato] += 1
        per_priorita[t.priorita or "n/d"] += 1
        backlog_ore[_asset_label(assets.get(t.asset_id))] += t.durata_stimata_ore or 0

    capacita = sum(t.ore_giornaliere or 8 for t in tecnici)
    righe_tecnici = [
        f"- {t.nome} {t.cognome or ''} — competenze: {t.competenze or 'n/d'}, "
        f"{t.ore_giornaliere or 8}h/g ({t.orario_inizio or '08:00'}-{t.orario_fine or '17:00'})"
        for t in tecnici
    ]
    righe_assenze = [
        f"- Tecnico #{a.tecnico_id}: {a.tipo_assenza} dal {a.data_inizio:%d/%m} al {a.data_fine:%d/%m}"
        for a in assenze
    ] or ["- Nessuna assenza nei prossimi 14 giorni"]

    summary = "\n".join([
        f"TICKET ATTIVI: {len(tickets)} — per stato: {dict(per_stato)} — per priorita: {dict(per_priorita)}",
        f"ORE BACKLOG TOTALI: {round(sum(backlog_ore.values()), 1)}h — CAPACITA GIORNALIERA SQUADRA: {capacita}h ({len(tecnici)} tecnici)",
        "TECNICI IN SERVIZIO:",
        *righe_tecnici,
        "ASSENZE PROSSIMI 14 GIORNI:",
        *righe_assenze,
    ])
    pareto = build_pareto(backlog_ore, "Ore di backlog per asset", "ore")
    return {"summary": summary, "pareto": pareto}


def _collect_rca(db: Session, tenant_id: int) -> dict[str, Any]:
    since = _now_utc_naive() - timedelta(days=180)
    guasti = (
        db.query(Ticket)
        .filter(
            Ticket.tenant_id == tenant_id,
            Ticket.tipo.in_(("BD", "CM")),
            Ticket.deleted_at.is_(None),
            Ticket.created_at >= since,
        )
        .order_by(Ticket.created_at.desc())
        .all()
    )
    assets = _assets_map(db, tenant_id)

    guasti_per_asset: dict[str, float] = defaultdict(float)
    for t in guasti:
        guasti_per_asset[_asset_label(assets.get(t.asset_id))] += 1

    recenti = [
        f"- [{t.tipo}] {t.titolo} — asset: {_asset_label(assets.get(t.asset_id))}, "
        f"priorita {t.priorita or 'n/d'}, stato {t.stato}"
        + (f", nota: {(t.descrizione or '')[:120]}" if t.descrizione else "")
        for t in guasti[:25]
    ] or ["- Nessun guasto negli ultimi 180 giorni"]

    summary = "\n".join([
        f"GUASTI/CORRETTIVE ULTIMI 180 GIORNI: {len(guasti)} ticket (BD+CM)",
        "ULTIMI EVENTI (max 25):",
        *recenti,
    ])
    pareto = build_pareto(guasti_per_asset, "Numero guasti per asset (180 gg)", "guasti")
    return {"summary": summary, "pareto": pareto}


def _collect_cost_controller(db: Session, tenant_id: int) -> dict[str, Any]:
    since = _now_utc_naive() - timedelta(days=180)
    tickets = (
        db.query(Ticket)
        .filter(
            Ticket.tenant_id == tenant_id,
            Ticket.deleted_at.is_(None),
            Ticket.created_at >= since,
        )
        .all()
    )
    assets = _assets_map(db, tenant_id)

    ore_uomo_per_asset: dict[str, float] = defaultdict(float)
    costo_fermo_per_asset: dict[str, float] = defaultdict(float)
    ore_per_tipo: dict[str, float] = defaultdict(float)
    for t in tickets:
        ore = t.required_man_hours or ((t.durata_stimata_ore or 0) * (t.tecnici_richiesti or 1))
        label = _asset_label(assets.get(t.asset_id))
        ore_uomo_per_asset[label] += ore
        ore_per_tipo[t.tipo or "n/d"] += ore
        asset = assets.get(t.asset_id)
        if asset and asset.costo_orario_fermo and t.tipo == "BD":
            # Stima costo fermo: durata intervento × costo orario fermo asset
            costo_fermo_per_asset[label] += (t.durata_stimata_ore or 0) * asset.costo_orario_fermo

    con_costo = [a for a in assets.values() if a.costo_orario_fermo]
    summary = "\n".join([
        f"TICKET ULTIMI 180 GIORNI: {len(tickets)} — ore uomo per tipo: "
        + ", ".join(f"{k}: {round(v, 1)}h" for k, v in sorted(ore_per_tipo.items())),
        f"ORE UOMO TOTALI: {round(sum(ore_uomo_per_asset.values()), 1)}h",
        f"ASSET CON COSTO ORARIO FERMO CENSITO: {len(con_costo)}/{len(assets)}",
        f"COSTO FERMO STIMATO DA BREAKDOWN (180 gg): {round(sum(costo_fermo_per_asset.values()), 0)} EUR"
        if costo_fermo_per_asset else
        "COSTO FERMO: non stimabile (nessun asset con costo_orario_fermo valorizzato coinvolto in BD)",
    ])
    # Pareto sul costo fermo se disponibile, altrimenti sulle ore uomo
    pareto = (
        build_pareto(costo_fermo_per_asset, "Costo fermo stimato per asset (180 gg)", "EUR")
        or build_pareto(ore_uomo_per_asset, "Ore uomo per asset (180 gg)", "ore")
    )
    return {"summary": summary, "pareto": pareto}


def _collect_kpi(db: Session, tenant_id: int) -> dict[str, Any]:
    now = _now_utc_naive()
    since_90 = now - timedelta(days=90)
    tickets = (
        db.query(Ticket)
        .filter(Ticket.tenant_id == tenant_id, Ticket.deleted_at.is_(None))
        .all()
    )
    assets = _assets_map(db, tenant_id)

    per_stato: dict[str, int] = defaultdict(int)
    per_tipo: dict[str, int] = defaultdict(int)
    carico_per_asset: dict[str, float] = defaultdict(float)
    mttr_ore: list[float] = []
    chiusi_90 = 0
    creati_90 = 0
    eta_backlog_giorni: list[float] = []
    for t in tickets:
        per_stato[t.stato] += 1
        per_tipo[t.tipo or "n/d"] += 1
        if t.created_at and t.created_at >= since_90:
            creati_90 += 1
        if t.stato == "Chiuso":
            if t.updated_at and t.updated_at >= since_90:
                chiusi_90 += 1
            if t.execution_start and t.execution_finish and t.execution_finish > t.execution_start:
                mttr_ore.append((t.execution_finish - t.execution_start).total_seconds() / 3600)
        elif t.stato in _ACTIVE_STATES:
            carico_per_asset[_asset_label(assets.get(t.asset_id))] += t.durata_stimata_ore or 0
            if t.created_at:
                eta_backlog_giorni.append((now - t.created_at).total_seconds() / 86400)

    pm = per_tipo.get("PM", 0)
    cm_bd = per_tipo.get("CM", 0) + per_tipo.get("BD", 0)
    summary = "\n".join([
        f"TICKET TOTALI: {len(tickets)} — per stato: {dict(per_stato)} — per tipo: {dict(per_tipo)}",
        f"MIX PM vs CM+BD: {pm} vs {cm_bd} (target lean: quota preventiva crescente)",
        f"MTTR MEDIO (chiusi con tempi reali): {round(sum(mttr_ore) / len(mttr_ore), 1) if mttr_ore else 'n/d'} ore su {len(mttr_ore)} interventi",
        f"ULTIMI 90 GIORNI: creati {creati_90}, chiusi {chiusi_90}",
        f"ETA MEDIA BACKLOG ATTIVO: {round(sum(eta_backlog_giorni) / len(eta_backlog_giorni), 1) if eta_backlog_giorni else 'n/d'} giorni ({len(eta_backlog_giorni)} ticket attivi)",
    ])
    pareto = build_pareto(carico_per_asset, "Ore di carico attivo per asset", "ore")
    return {"summary": summary, "pareto": pareto}


def _collect_strategy(db: Session, tenant_id: int) -> dict[str, Any]:
    since = _now_utc_naive() - timedelta(days=365)
    assets = _assets_map(db, tenant_id)
    tickets = (
        db.query(Ticket)
        .filter(
            Ticket.tenant_id == tenant_id,
            Ticket.deleted_at.is_(None),
            Ticket.created_at >= since,
        )
        .all()
    )
    piani = db.query(PianoManutenzione).filter(PianoManutenzione.tenant_id == tenant_id).all()
    asset_con_piano: set[int] = set()
    for p in piani:
        if p.asset_id:
            asset_con_piano.add(p.asset_id)
        asset_con_piano.update(a.id for a in p.assets)

    guasti_per_asset_id: dict[int, int] = defaultdict(int)
    for t in tickets:
        if t.tipo == "BD" and t.asset_id:
            guasti_per_asset_id[t.asset_id] += 1

    righe_asset = []
    criticita_pareto: dict[str, float] = defaultdict(float)
    for a in sorted(assets.values(), key=lambda x: guasti_per_asset_id.get(x.id, 0), reverse=True)[:30]:
        n_guasti = guasti_per_asset_id.get(a.id, 0)
        righe_asset.append(
            f"- {_asset_label(a)} — criticita: {a.criticita or 'n/d'}, guasti 12 mesi: {n_guasti}, "
            f"costo fermo: {a.costo_orario_fermo or 'n/d'} EUR/h, "
            f"piano PM: {'SI' if a.id in asset_con_piano else 'NO'}, anno: {a.anno_installazione or a.anno or 'n/d'}"
        )
        # Indice di attenzione: guasti pesati per criticita (A=3, B=2, C=1)
        peso = {"A": 3.0, "B": 2.0, "C": 1.0}.get((a.criticita or "").upper(), 1.5)
        if n_guasti:
            criticita_pareto[_asset_label(a)] = n_guasti * peso

    summary = "\n".join([
        f"ASSET CENSITI: {len(assets)} — con piano di manutenzione: {len(asset_con_piano)} — piani PM attivi: {len(piani)}",
        f"GUASTI (BD) ULTIMI 12 MESI: {sum(guasti_per_asset_id.values())}",
        "PARCO ASSET (top 30 per guasti):",
        *(righe_asset or ["- Nessun asset censito"]),
    ])
    pareto = build_pareto(criticita_pareto, "Indice di attenzione (guasti x criticita) per asset", "punti")
    return {"summary": summary, "pareto": pareto}


# ── Definizione agenti ───────────────────────────────────────────────────────

_LEAN_FOOTER = (
    "Applica sempre i principi lean: elimina i muda (attese, movimenti, difetti, "
    "sovra-manutenzione), pensa in ottica kaizen (miglioramento continuo a piccoli passi), "
    "usa i dati di Pareto forniti per concentrare le azioni sul 20% di cause che genera "
    "l'80% degli effetti. Non inventare numeri: usa solo i dati del contesto. "
    "Rispondi SEMPRE in italiano, in Markdown, con sezioni chiare e azioni concrete "
    "ordinate per impatto. Chiudi con una sezione 'Prossimi 3 passi' operativa."
)


class AgentDefinition:
    def __init__(
        self,
        id: str,
        nome: str,
        nome_breve: str,
        descrizione: str,
        colore: str,
        system_prompt: str,
        collector: Callable[[Session, int], dict[str, Any]],
    ):
        self.id = id
        self.nome = nome
        self.nome_breve = nome_breve
        self.descrizione = descrizione
        self.colore = colore
        self.system_prompt = system_prompt
        self.collector = collector


AGENT_DEFINITIONS: dict[str, AgentDefinition] = {
    "agent_planner": AgentDefinition(
        id="agent_planner",
        nome="Agente Planner",
        nome_breve="Planner",
        descrizione="Ottimizzazione lean del piano: backlog, carichi, assenze e sequenze.",
        colore="#5b8fff",
        system_prompt=(
            "Sei l'Agente Planner di MaintAI: un pianificatore di manutenzione industriale "
            "senior con 25 anni di esperienza in scheduling di squadre tecniche, teoria dei "
            "vincoli (TOC), livellamento dei carichi (heijunka) e pianificazione pull. "
            "Analizzi backlog, capacita della squadra e assenze e produci raccomandazioni "
            "di schedulazione: cosa pianificare prima e perche, come bilanciare i tecnici, "
            "dove il backlog supera la capacita e come recuperare, quali ticket accorpare "
            "per ridurre i setup (stesso asset/area). Evidenzia i colli di bottiglia. "
            + _LEAN_FOOTER
        ),
        collector=_collect_planner,
    ),
    "agent_rca": AgentDefinition(
        id="agent_rca",
        nome="Agente RCA",
        nome_breve="RCA",
        descrizione="Root cause analysis lean: Pareto guasti, 5 perche e contromisure.",
        colore="#ef4444",
        system_prompt=(
            "Sei l'Agente RCA di MaintAI: un esperto mondiale di root cause analysis in "
            "ambito manutenzione industriale (metodi: 5 perche, Ishikawa/fishbone, FMEA, "
            "8D). Parti SEMPRE dal Pareto dei guasti fornito: identifica i 'vital few' "
            "asset, ipotizza per ciascuno le cause radice piu probabili (distingui cause "
            "tecniche, organizzative e sistemiche), proponi contromisure permanenti e non "
            "solo rimedi tampone, e suggerisci quali dati raccogliere per confermare le "
            "ipotesi. Segnala pattern ricorrenti tra i titoli/descrizioni dei guasti. "
            + _LEAN_FOOTER
        ),
        collector=_collect_rca,
    ),
    "agent_cost_controller": AgentDefinition(
        id="agent_cost_controller",
        nome="Agente Cost Controller",
        nome_breve="Costi",
        descrizione="Controllo costi lean: Pareto costi fermo/ore uomo e riduzione muda.",
        colore="#f59e0b",
        system_prompt=(
            "Sei l'Agente Cost Controller di MaintAI: un controller industriale esperto di "
            "costi di manutenzione (life cycle cost, costo del fermo impianto, ore uomo, "
            "trade-off preventiva vs correttiva). Parti dal Pareto dei costi fornito: "
            "individua dove si concentra la spesa, quantifica quando possibile il costo "
            "del fermo evitabile, indica i muda economici (interventi ripetuti sullo stesso "
            "asset, sovra-manutenzione, attese ricambi) e proponi azioni di riduzione costi "
            "con stima qualitativa del beneficio. Se mancano dati di costo (es. asset senza "
            "costo orario fermo), segnala esplicitamente quali dati censire per primo. "
            + _LEAN_FOOTER
        ),
        collector=_collect_cost_controller,
    ),
    "agent_kpi": AgentDefinition(
        id="agent_kpi",
        nome="Agente KPI",
        nome_breve="KPI",
        descrizione="Lettura esperta dei KPI: MTTR, backlog, mix PM/CM, trend e target.",
        colore="#22c55e",
        system_prompt=(
            "Sei l'Agente KPI di MaintAI: un esperto di performance management della "
            "manutenzione (standard EN 15341, world class maintenance). Leggi i KPI "
            "calcolati dal sistema (MTTR, backlog e sua eta, mix PM vs CM/BD, throughput "
            "creati/chiusi) e produci una diagnosi onesta: cosa e in salute, cosa no, "
            "confronto con benchmark di settore, e quali KPI mancanti varrebbe la pena "
            "misurare (MTBF, OEE, schedule compliance). Per ogni KPI critico proponi un "
            "target realistico a 90 giorni e l'azione lean per raggiungerlo. "
            + _LEAN_FOOTER
        ),
        collector=_collect_kpi,
    ),
    "agent_strategy": AgentDefinition(
        id="agent_strategy",
        nome="Suggeritore Strategie Manutenzione",
        nome_breve="Strategie",
        descrizione="Strategia per asset: run-to-failure, preventiva, predittiva, TPM.",
        colore="#a78bfa",
        system_prompt=(
            "Sei il Suggeritore Strategie Manutenzione di MaintAI: un consulente senior di "
            "ingegneria di manutenzione esperto di RCM (Reliability Centered Maintenance), "
            "TPM e selezione della strategia ottimale per asset (run-to-failure, preventiva "
            "a tempo, su condizione, predittiva). Usa il Pareto dell'indice di attenzione "
            "(guasti x criticita) per raccomandare, asset per asset (o per famiglia), la "
            "strategia piu adatta considerando criticita, storico guasti, costo del fermo "
            "e presenza/assenza di un piano PM. Evidenzia gli asset critici SENZA piano di "
            "manutenzione: sono il primo gap da chiudere. Proponi anche dove introdurre "
            "manutenzione autonoma (TPM) e ispezioni di primo livello. "
            + _LEAN_FOOTER
        ),
        collector=_collect_strategy,
    ),
}


def list_agents() -> list[dict[str, Any]]:
    return [
        {
            "id": d.id,
            "nome": d.nome,
            "nome_breve": d.nome_breve,
            "descrizione": d.descrizione,
            "colore": d.colore,
        }
        for d in AGENT_DEFINITIONS.values()
    ]


def run_agent(db: Session, tenant_id: int, agent_id: str, username: str | None) -> dict[str, Any]:
    """Esegue un agente (trigger manuale): contesto → OpenAI → log consumo EUR."""
    definition = AGENT_DEFINITIONS[agent_id]
    context = definition.collector(db, tenant_id)
    pareto = context.get("pareto")

    user_message = "\n\n".join([
        "Questi sono i dati aggregati aggiornati dell'impianto (gia filtrati per il cliente):",
        context["summary"],
        _pareto_md(pareto),
        "Produci ora il tuo report da esperto.",
    ])

    client = get_openai_client()
    model = get_openai_model()
    started = _now_utc_naive()
    try:
        response = client.chat.completions.create(
            model=model,
            messages=[
                {"role": "system", "content": definition.system_prompt},
                {"role": "user", "content": user_message},
            ],
            temperature=0.3,
            max_tokens=2000,
            timeout=110.0,
        )
    except Exception as exc:
        _log_usage(
            db, tenant_id, agent_id, model,
            prompt_tokens=0, completion_tokens=0, cost_eur=0.0,
            status="error", output_md=None, error=str(exc)[:2000], username=username,
        )
        raise

    output_md = (response.choices[0].message.content or "").strip()
    usage = getattr(response, "usage", None)
    prompt_tokens = getattr(usage, "prompt_tokens", 0) or 0
    completion_tokens = getattr(usage, "completion_tokens", 0) or 0
    cost_eur = estimate_cost_eur(model, prompt_tokens, completion_tokens)

    run_row = _log_usage(
        db, tenant_id, agent_id, model,
        prompt_tokens=prompt_tokens, completion_tokens=completion_tokens,
        cost_eur=cost_eur, status="ok", output_md=output_md, error=None, username=username,
    )
    # Nel log vanno solo valori fidati: definition.id dal registry, tenant forzato a int
    logger.info(
        "Agente %s eseguito — tenant %s, %s+%s token, %.4f EUR, %.1fs",
        definition.id, int(tenant_id), prompt_tokens, completion_tokens, cost_eur,
        (_now_utc_naive() - started).total_seconds(),
    )
    return {
        "run_id": run_row.id,
        "agent_id": agent_id,
        "nome": definition.nome,
        "output_md": output_md,
        "pareto": pareto,
        "model": model,
        "prompt_tokens": prompt_tokens,
        "completion_tokens": completion_tokens,
        "cost_eur": cost_eur,
        "created_at": run_row.created_at.isoformat() if run_row.created_at else None,
    }


def _log_usage(
    db: Session, tenant_id: int, feature: str, model: str | None, *,
    prompt_tokens: int, completion_tokens: int, cost_eur: float,
    status: str, output_md: str | None, error: str | None, username: str | None,
) -> AiUsageLog:
    row = AiUsageLog(
        tenant_id=tenant_id,
        feature=feature,
        model=model,
        prompt_tokens=prompt_tokens,
        completion_tokens=completion_tokens,
        cost_eur=cost_eur,
        status=status,
        output_md=output_md,
        error=error,
        created_by=username,
    )
    db.add(row)
    db.commit()
    db.refresh(row)
    return row


def usage_summary(db: Session, tenant_id: int) -> dict[str, Any]:
    """Consumo AI in EUR per il tenant: oggi, mese corrente, totale."""
    from sqlalchemy import func

    now = _now_utc_naive()
    month_start = now.replace(day=1, hour=0, minute=0, second=0, microsecond=0)
    day_start = now.replace(hour=0, minute=0, second=0, microsecond=0)

    base = db.query(func.coalesce(func.sum(AiUsageLog.cost_eur), 0.0)).filter(
        AiUsageLog.tenant_id == tenant_id
    )
    total = float(base.scalar() or 0.0)
    month = float(base.filter(AiUsageLog.created_at >= month_start).scalar() or 0.0)
    today = float(base.filter(AiUsageLog.created_at >= day_start).scalar() or 0.0)
    runs = (
        db.query(func.count(AiUsageLog.id))
        .filter(AiUsageLog.tenant_id == tenant_id)
        .scalar()
        or 0
    )
    return {
        "totale_eur": round(total, 4),
        "mese_eur": round(month, 4),
        "oggi_eur": round(today, 4),
        "runs": int(runs),
    }


def recent_runs(db: Session, tenant_id: int, agent_id: str | None = None, limit: int = 20) -> list[dict[str, Any]]:
    query = db.query(AiUsageLog).filter(
        AiUsageLog.tenant_id == tenant_id,
        AiUsageLog.feature.in_(list(AGENT_DEFINITIONS)),
    )
    if agent_id:
        query = query.filter(AiUsageLog.feature == agent_id)
    rows = query.order_by(AiUsageLog.created_at.desc()).limit(min(limit, 50)).all()
    return [
        {
            "id": r.id,
            "agent_id": r.feature,
            "model": r.model,
            "status": r.status,
            "cost_eur": r.cost_eur,
            "output_md": r.output_md,
            "created_by": r.created_by,
            "created_at": r.created_at.isoformat() if r.created_at else None,
        }
        for r in rows
    ]
