from backend.services.ai.openai_service import get_openai_client
from backend.core.logging_config import get_logger
from backend.services.ai.anonymization_service import anonymizer
import json

logger = get_logger(__name__)

SYSTEM_PROMPT = """Sei un ingegnere esperto di manutenzione industriale che guida un tecnico sul campo verso la root cause di un guasto.

Hai accesso a:
- Scheda tecnica completa dell'asset (marca, modello, anno, note tecniche, vincoli)
- Storico guasti risolti sullo stesso asset (con root cause se disponibile)
- Piano di manutenzione programmata dell'asset
- Descrizione del guasto attuale

REGOLE FONDAMENTALI:
1. Leggi SEMPRE il contesto fornito prima di fare domande.
2. NON chiedere informazioni già presenti nella scheda asset (marca, modello, anno ecc.) — le hai già.
3. NON ripetere domande già poste nella conversazione.
4. Se lo storico guasti mostra una causa ricorrente, esplora PRIMA quella ipotesi.
5. Fai UNA sola domanda o verifica alla volta, partendo da quella più discriminante.
6. Nelle verifiche sul campo specifica: dove guardare, quale strumento usare, quale valore attendersi.
7. Concludi con la root cause appena hai elementi sufficienti — non trascinare la sessione.

STRATEGIA DI ANALISI:
- Per guasti BD (breakdown): priorità a verifiche rapide di campo (tensioni, pressioni, segnali di allarme).
- Per guasti ricorrenti già nello storico: punta direttamente alla causa già identificata in precedenza e verifica se è la stessa.
- Per PM/CM: valuta scostamenti dal piano di manutenzione o usura anomala rispetto alle ore attese.

Rispondi SEMPRE in questo formato JSON (nessun testo fuori dal JSON):
{
  "type": "question" | "check" | "conclusion",
  "content": "testo della domanda o istruzione di verifica (conciso, diretto)",
  "detail": "ragionamento: perché stai chiedendo questo, cosa ti aspetti di scoprire e come esclude o conferma un'ipotesi",
  "instrument": "strumento da usare (es: tester, termocamera, manometro) — null se type!=check",
  "expected_value": "valore o range normale atteso — null se non applicabile",
  "root_cause": "descrizione causa radice — solo se type=conclusion, altrimenti null",
  "recommended_actions": ["azione 1", "azione 2"]
}"""


def _build_context(
    ticket: dict,
    asset: dict | None,
    historical_tickets: list | None,
    maintenance_activities: list | None,
    manuali_context: list | None,
) -> str:
    lines = []

    # ── Ticket ───────────────────────────────────────────────────────────────
    lines.append("=== TICKET CORRENTE ===")
    lines.append(f"Tipo: {ticket.get('tipo', 'N/D')}  |  Priorità: {ticket.get('priorita', 'N/D')}  |  Aperto il: {ticket.get('created_at', 'N/D')}")
    lines.append(f"Titolo: {ticket.get('titolo', '')}")
    desc = ticket.get("descrizione", "").strip()
    lines.append(f"Descrizione guasto: {desc if desc else '(nessuna descrizione fornita)'}")

    # ── Asset ─────────────────────────────────────────────────────────────────
    lines.append("\n=== SCHEDA TECNICA ASSET ===")
    if asset:
        def _f(v): return str(v) if v not in (None, "", 0) else "N/D"
        lines.append(f"Nome: {_f(asset.get('nome'))}  |  Area: {_f(asset.get('area'))}  |  Posizione: {_f(asset.get('posizione_fisica'))}")
        lines.append(f"Marca: {_f(asset.get('marca'))}  |  Modello: {_f(asset.get('modello'))}  |  Matricola: {_f(asset.get('matricola'))}")
        lines.append(f"Anno installazione: {_f(asset.get('anno_installazione'))}  |  Anno produzione: {_f(asset.get('anno_produzione'))}")
        lines.append(f"Criticità: {_f(asset.get('criticita'))}  |  Fornitore: {_f(asset.get('fornitore'))}")
        if asset.get("descrizione"):
            lines.append(f"Descrizione: {asset['descrizione']}")
        if asset.get("note_tecniche"):
            lines.append(f"Note tecniche: {asset['note_tecniche']}")
        if asset.get("vincoli_operativi"):
            lines.append(f"Vincoli operativi: {asset['vincoli_operativi']}")
        if asset.get("vincoli_manutenzione"):
            lines.append(f"Vincoli manutenzione: {asset['vincoli_manutenzione']}")
    else:
        lines.append("(scheda asset non disponibile)")

    # ── Piano manutenzione ────────────────────────────────────────────────────
    if maintenance_activities:
        lines.append("\n=== PIANO DI MANUTENZIONE PROGRAMMATA ===")
        for a in maintenance_activities:
            row = f"- {a.get('nome', 'N/D')}"
            if a.get("frequenza_giorni"):
                row += f" | ogni {a['frequenza_giorni']}gg"
            if a.get("ultima_esecuzione"):
                row += f" | ultima: {a['ultima_esecuzione']}"
            if a.get("prossima_scadenza"):
                row += f" | prossima: {a['prossima_scadenza']}"
            lines.append(row)

    # ── Storico guasti ────────────────────────────────────────────────────────
    if historical_tickets:
        lines.append("\n=== STORICO GUASTI RISOLTI (stesso asset) ===")
        for t in historical_tickets:
            row = f"- #{t.get('id')} [{t.get('tipo', '?')}] {t.get('titolo', '')}"
            if t.get("data_apertura"):
                row += f"  ({t['data_apertura']})"
            if t.get("data_chiusura"):
                row += f" → chiuso {t['data_chiusura']}"
            lines.append(row)
            if t.get("descrizione", "").strip():
                lines.append(f"  Descrizione: {t['descrizione'][:200]}")
            if t.get("root_cause_identificata"):
                lines.append(f"  ► Root cause: {t['root_cause_identificata']}")
    else:
        lines.append("\n=== STORICO GUASTI ===\n(Nessun guasto precedente registrato per questo asset)")

    # ── Manuali tecnici ───────────────────────────────────────────────────────
    if manuali_context:
        lines.append("\n=== MANUALI TECNICI DISPONIBILI ===")
        for m in manuali_context:
            lines.append(f"- {m.get('nome', 'Manuale')}")
            if m.get("attivita_estratte"):
                for att in m["attivita_estratte"]:
                    if att:
                        lines.append(f"  · {att}")

    return "\n".join(lines)


def start_diagnostic_session(
    ticket: dict,
    asset: dict | None,
    historical_tickets: list | None = None,
    maintenance_activities: list | None = None,
    manuali_context: list | None = None,
) -> dict:
    client = get_openai_client()

    sensitive_words = []
    if ticket.get("tecnico"):
        sensitive_words.append(ticket["tecnico"])

    ticket = anonymizer.anonymize_data(ticket, sensitive_words)
    asset = anonymizer.anonymize_data(asset, sensitive_words)
    if historical_tickets:
        historical_tickets = anonymizer.anonymize_data(historical_tickets, sensitive_words)

    context = _build_context(ticket, asset, historical_tickets, maintenance_activities, manuali_context)

    # Istruzione iniziale: spiega all'AI cosa sa già e cosa deve fare
    user_msg = (
        f"{context}\n\n"
        "---\n"
        "Hai letto il contesto completo. Non chiedere informazioni già presenti sopra.\n"
        "Identifica l'ipotesi diagnostica più probabile in base al tipo di guasto e allo storico, "
        "poi fai la PRIMA domanda o verifica più discriminante per confermarla o escluderla."
    )

    messages = [
        {"role": "system", "content": SYSTEM_PROMPT},
        {"role": "user", "content": user_msg},
    ]

    response = client.chat.completions.create(
        model="gpt-4.1-mini",
        messages=messages,
        response_format={"type": "json_object"},
        temperature=0.3,  # più deterministico e focalizzato
    )

    result = json.loads(response.choices[0].message.content)

    # Salva nella history (esclude system)
    history = [
        {"role": "user", "content": user_msg},
        {"role": "assistant", "content": response.choices[0].message.content},
    ]

    return {"result": result, "history": history}


def continue_diagnostic_session(history: list, technician_reply: str) -> dict:
    client = get_openai_client()

    technician_reply = anonymizer.mask_text(technician_reply)

    messages = [
        {"role": "system", "content": SYSTEM_PROMPT},
        *history,
        {"role": "user", "content": technician_reply},
    ]

    response = client.chat.completions.create(
        model="gpt-4.1-mini",
        messages=messages,
        response_format={"type": "json_object"},
        temperature=0.3,
    )

    result = json.loads(response.choices[0].message.content)

    updated_history = history + [
        {"role": "user", "content": technician_reply},
        {"role": "assistant", "content": response.choices[0].message.content},
    ]

    return {"result": result, "history": updated_history}
