import os
from typing import Any

import openai
from fastapi import APIRouter, Depends
from pydantic import BaseModel, Field

from backend.core.logger_db import db_info
from backend.core.security import get_current_user_payload

router = APIRouter(prefix="/guide", tags=["guide"])


class ChatMessage(BaseModel):
    role: str
    content: str


class PageContext(BaseModel):
    path: str | None = None
    title: str | None = None
    area: str | None = None
    summary: str | None = None
    actions: list[str] = Field(default_factory=list)
    user_role: str | None = None


class GuideRequest(BaseModel):
    messages: list[ChatMessage]
    page_context: PageContext | None = None


PAGE_PLAYBOOK: dict[str, dict[str, Any]] = {
    "/dashboard": {
        "focus": "lettura KPI, grafici, widget drag and drop, dettaglio asset compatto",
        "steps": [
            "Usa Personalizza per riordinare KPI, grafici e dettaglio asset.",
            "Apri Dettaglio KPI per Asset se devi filtrare per sito, codice, asset, area o stato.",
            "Controlla MTBF, OEE, downtime e guasti per capire priorita manutentive.",
        ],
    },
    "/ticket": {
        "focus": "gestione ticket, stati, priorita, Kanban, export",
        "steps": [
            "Crea un ticket scegliendo tipo BD, PM o CM.",
            "Usa filtri e ricerca per isolare backlog e priorita.",
            "Aggiorna lo stato da tabella o Kanban: Aperto, Pianificato, In corso, Chiuso.",
        ],
    },
    "/planning": {
        "focus": "generazione piano Felix, efficienza, Gantt, Kanban, calendario, conferma",
        "steps": [
            "Ricarica ticket se i dati non sono aggiornati.",
            "Genera un piano in modalita deterministica o AI.",
            "Leggi motivazioni e score prima di confermare; la conferma assegna tecnico e date ai ticket.",
        ],
    },
    "/diagnostic": {
        "focus": "diagnostica AI, RCA guidata, analisi guasto",
        "steps": [
            "Seleziona il ticket o descrivi il problema.",
            "Rispondi alle domande guidate con sintomi, contesto e prove effettuate.",
            "Usa il risultato per decidere causa probabile e prossime azioni.",
        ],
    },
    "/assets": {
        "focus": "anagrafica asset, dati tecnici, filtri, stato operativo",
        "steps": [
            "Cerca per nome, codice, area o impianto.",
            "Apri la scheda asset per dati tecnici e ticket collegati.",
            "Verifica stato operativo e vincoli prima della pianificazione.",
        ],
    },
    "/tecnici": {
        "focus": "tecnici, disponibilita, competenze, assenze",
        "steps": [
            "Controlla chi e in servizio.",
            "Registra assenze e orari.",
            "Mantieni aggiornate le competenze per evitare assegnazioni errate nel planner.",
        ],
    },
    "/manuali": {
        "focus": "upload manuali PDF, estrazione piano manutenzione",
        "steps": [
            "Carica il PDF del manuale.",
            "Avvia l'analisi per estrarre attivita manutentive.",
            "Controlla il piano generato nella sezione Piani.",
        ],
    },
    "/piani": {
        "focus": "attivita manutentive estratte da manuali",
        "steps": [
            "Filtra le attivita per asset o frequenza.",
            "Verifica descrizioni, durata e periodicita.",
            "Usa le attivita come base per manutenzione preventiva.",
        ],
    },
}


MAINTAI_CONTEXT = """
Sei Felix, l'assistente virtuale ufficiale di MaintAI.
Rispondi sempre in italiano, con tono professionale, pratico e sicuro.
Il tuo compito non e fare conversazione generica: devi aiutare l'utente a usare il software.

Conosci MaintAI:
- Dashboard: KPI live, grafici, widget drag and drop, dettaglio KPI asset, MTBF, OEE, downtime, guasti.
- Ticket: stati Aperto, Pianificato, In corso, Chiuso, Eliminato; tipi BD, PM, CM; kanban e tabella.
- Planning MARCO: motore deterministico o AI, Gantt, Kanban settimanale, calendario, storico, conferma piano.
- Conferma piano: aggiorna ticket esistenti con stato Pianificato, tecnico, planned_start e planned_finish.
- Asset: gerarchia Siti > Impianti > Asset, dati tecnici, vincoli e stato operativo.
- Tecnici: disponibilita, assenze, competenze e orari.
- Manuali/Piani: upload PDF, estrazione automatica attivita manutentive, consultazione piani.
- Diagnostica AI: sessioni RCA guidate per problemi e guasti.
- Admin: tenant, log, utenti, email-to-ticket.

Regole:
- Se ricevi contesto pagina, parti da quello e spiega cosa si puo fare in quella pagina.
- Dai percorsi concreti nella sidebar quando utile.
- Rispondi come una guida/tutorial: riconosci l'obiettivo e dai una procedura numerata passo passo.
- Se l'utente chiede "cosa posso fare qui", proponi le azioni principali della pagina corrente.
- Se c'e un problema tecnico, separa diagnosi probabile, controlli e soluzione.
- Non inventare dati del database: spiega come verificarli nell'interfaccia.
- Chiudi chiedendo se l'utente vuole essere guidato nel prossimo click.
"""


def _match_playbook(path: str | None) -> dict[str, Any] | None:
    if not path:
        return None
    if path in PAGE_PLAYBOOK:
        return PAGE_PLAYBOOK[path]
    for prefix, playbook in PAGE_PLAYBOOK.items():
        if path.startswith(prefix):
            return playbook
    return None


def _fallback_answer(req: GuideRequest) -> str:
    ctx = req.page_context or PageContext()
    last = req.messages[-1].content if req.messages else ""
    title = ctx.title or "questa pagina"
    playbook = _match_playbook(ctx.path)
    actions = ctx.actions or (playbook.get("steps", []) if playbook else [])
    focus = playbook.get("focus") if playbook else ctx.summary

    low = last.lower()
    if "ticket" in low:
        steps = [
            "Apri Operazioni > Ticket dalla sidebar.",
            "Premi Nuovo ticket e scegli tipo BD, PM o CM.",
            "Compila asset, priorita, durata stimata e descrizione del problema.",
            "Salva il ticket e controlla che compaia nel backlog.",
            "Usa Kanban o tabella per seguire lo stato.",
        ]
    elif "vincol" in low:
        steps = [
            "Apri Risorse > Asset e seleziona l'asset interessato.",
            "Entra nella scheda tecnica.",
            "Cerca vincoli operativi, manutentivi, meteo, orari o note tecniche.",
            "Aggiorna i vincoli se sono incompleti.",
            "Rigenera il piano se i vincoli impattano la pianificazione.",
        ]
    elif "dashboard" in low or "graf" in low or "kpi" in low:
        steps = [
            "Apri Dashboard.",
            "Premi Personalizza.",
            "Trascina KPI, grafici e Dettaglio KPI per Asset.",
            "Scegli dati e tipologia dei grafici.",
            "Apri Dettaglio KPI per Asset e filtra le colonne.",
        ]
    else:
        steps = actions[:5] or [
            "Controlla i dati mostrati nella pagina.",
            "Usa filtri, pulsanti e pannelli disponibili.",
            "Apri il dettaglio del record se devi modificare o verificare dati.",
            "Salva o conferma l'operazione.",
            "Verifica che il risultato sia visibile nella pagina.",
        ]

    return "\n".join([
        f"Contesto: {title}.",
        f"Obiettivo rilevato: usare {focus or 'questa funzione di MaintAI'}.",
        "",
        "Procedura passo passo:",
        *[f"{idx + 1}. {step}" for idx, step in enumerate(steps)],
        "",
        "Controllo finale:",
        "- Verifica che il dato sia salvato o visibile nella pagina.",
        "- Se non cambia nulla, aggiorna la pagina e ripeti il passaggio chiave.",
        "",
        "Vuoi che ti guidi nel prossimo click preciso?",
    ])


@router.post("/chat")
async def guide_chat(
    req: GuideRequest,
    payload: dict = Depends(get_current_user_payload),
):
    api_key = os.getenv("OPENAI_API_KEY")
    if not api_key:
        return {"content": _fallback_answer(req)}

    ctx = req.page_context or PageContext()
    page_context = (
        f"Pagina corrente: {ctx.title or 'non specificata'}\n"
        f"Percorso: {ctx.path or 'non specificato'}\n"
        f"Area: {ctx.area or 'non specificata'}\n"
        f"Ruolo utente: {ctx.user_role or 'operatore'}\n"
        f"Descrizione pagina: {ctx.summary or 'non disponibile'}\n"
        f"Azioni disponibili: {', '.join(ctx.actions) if ctx.actions else 'non specificate'}"
    )

    messages: list[dict[str, str]] = [
        {"role": "system", "content": MAINTAI_CONTEXT},
        {"role": "system", "content": page_context},
    ]
    for msg in req.messages[-10:]:
        role = msg.role if msg.role in {"user", "assistant"} else "user"
        messages.append({"role": role, "content": msg.content})

    try:
        client = openai.AsyncOpenAI(api_key=api_key)
        response = await client.chat.completions.create(
            model=os.getenv("OPENAI_MODEL", "gpt-4.1-mini"),
            messages=messages,
            temperature=0.35,
            max_tokens=900,
        )
        answer = response.choices[0].message.content or _fallback_answer(req)
        db_info("GUIDE", f"Felix utilizzato da {payload.get('sub')} su {ctx.path or 'pagina sconosciuta'}")
        return {"content": answer}
    except Exception:
        return {"content": _fallback_answer(req)}
