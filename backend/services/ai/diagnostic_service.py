from backend.services.ai.openai_service import get_openai_client
from backend.core.logging_config import get_logger
from backend.core.privacy import privacy_redactor
import json

logger = get_logger(__name__)

SYSTEM_PROMPT = """
Sei un esperto di manutenzione industriale che guida un tecnico verso la root cause di un guasto.

Regole fondamentali:
- Fai UNA sola domanda o suggerisci UNA sola verifica alla volta
- Quando mancano dati tecnici dell'asset (modello, anno, ore lavoro, ultima manutenzione) chiedili esplicitamente
- Quando è utile, chiedi misure specifiche: temperature, pressioni, assorbimenti, vibrazioni, portate
- Specifica sempre lo strumento da usare e il valore atteso se noto
- Se suggerisci una verifica sul campo, indica esattamente dove guardare e cosa misurare
- Quando hai abbastanza informazioni concludi con la root cause

Rispondi SEMPRE in questo formato JSON:
{
  "type": "question" | "check" | "conclusion",
  "content": "testo della domanda o verifica",
  "detail": "perché stai chiedendo questo e cosa ti aspetti di scoprire",
  "instrument": "strumento da usare se type=check, altrimenti null",
  "expected_value": "valore atteso o range normale se noto, altrimenti null",
  "root_cause": "solo se type=conclusion, altrimenti null",
  "recommended_actions": []
}
"""

def start_diagnostic_session(ticket: dict, asset: dict | None, historical_tickets: list | None = None) -> dict:
    client = get_openai_client()
    
    # Raccogliamo eventuali nomi sensibili da mascherare (es. tecnici assegnati)
    sensitive_words = []
    if ticket.get("tecnico"): sensitive_words.append(ticket["tecnico"])
    
    # Redact input data for privacy
    ticket = privacy_redactor.redact_data(ticket, sensitive_words)
    asset = privacy_redactor.redact_data(asset, sensitive_words)
    if historical_tickets:
        historical_tickets = privacy_redactor.redact_data(historical_tickets, sensitive_words)

    context = f"""
Ticket: {ticket.get('titolo')}
Descrizione: {ticket.get('descrizione')}
Area: {asset.get('area') if asset else 'sconosciuta'}
Priorità: {ticket.get('priorita')}
""".strip()


    if historical_tickets:
        history_text = "\n".join([f"- [{t['stato']}] {t['titolo']}" for t in historical_tickets])
        context += f"\n\nSTORICO MANUTENZIONI (ultimi 12 mesi per questo asset):\n{history_text}"

    messages = [
        {"role": "system", "content": SYSTEM_PROMPT},
        {"role": "user", "content": f"Nuovo ticket aperto:\n{context}\n\nFai la prima domanda diagnostica."}
    ]

    response = client.chat.completions.create(
        model="gpt-4.1-mini",
        messages=messages,
        response_format={"type": "json_object"}
    )

    result = json.loads(response.choices[0].message.content)
    
    # Salva nella history
    history = messages[1:]  # esclude system
    history.append({"role": "assistant", "content": response.choices[0].message.content})
    
    return {"result": result, "history": history}


def continue_diagnostic_session(history: list, technician_reply: str) -> dict:
    client = get_openai_client()
    
    # Redact technician reply for privacy
    technician_reply = privacy_redactor.redact_text(technician_reply)
    
    messages = [
        {"role": "system", "content": SYSTEM_PROMPT},
        *history,
        {"role": "user", "content": technician_reply}
    ]

    response = client.chat.completions.create(
        model="gpt-4.1-mini",
        messages=messages,
        response_format={"type": "json_object"}
    )

    result = json.loads(response.choices[0].message.content)
    
    updated_history = history + [
        {"role": "user", "content": technician_reply},
        {"role": "assistant", "content": response.choices[0].message.content}
    ]
    
    return {"result": result, "history": updated_history}