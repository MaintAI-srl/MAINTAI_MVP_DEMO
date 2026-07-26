
import logging
import os

from sqlalchemy.orm import Session
from backend.db.modelli import Asset, Manuale, Tenant
from backend.services.ai.openai_service import get_openai_client
from backend.services.ai.prompt_security import UNTRUSTED_INPUT_POLICY, wrap_untrusted
from backend.services.ai.pseudonymizer import Pseudonymizer

logger = logging.getLogger(__name__)


def build_manual_pseudonymizer(db: Session, tenant_id: int | None) -> Pseudonymizer:
    """
    Registra ragione sociale del tenant e nomi asset: se il manuale è un documento
    personalizzato per il cliente (frontespizi, commesse, targhe), quei riferimenti
    escono come token invece che in chiaro.
    """
    pseudo = Pseudonymizer()
    if tenant_id is None:
        return pseudo
    tenant = db.query(Tenant).filter(Tenant.id == tenant_id).first()
    if tenant:
        pseudo.register_tenant(tenant)
    for asset in db.query(Asset).filter(Asset.tenant_id == tenant_id).all():
        pseudo.register_asset(asset)
    return pseudo


def parse_manual_with_ai(
    text: str,
    filename: str,
    pseudo: Pseudonymizer | None = None,
) -> str:
    """
    Estrae il piano di manutenzione dal testo di un manuale tecnico.

    ``pseudo`` (opzionale) permette al chiamante di registrare le entità del tenant
    (ragione sociale, asset) così che eventuali riferimenti presenti nel manuale escano
    come token. Il testo tecnico — codici ricambio, misure, tolleranze, matricole del
    costruttore — resta invece intatto: è l'informazione che si vuole estrarre.
    """
    ai_client = get_openai_client()

    pseudo = pseudo or Pseudonymizer()
    text = pseudo.mask_text(text)
    # Il nome del file è scelto dall'utente e può contenere cliente, sito o commessa:
    # verso OpenAI esce solo l'estensione, che è l'unica parte informativa per il parsing.
    safe_filename = f"manuale{os.path.splitext(filename or '')[1].lower()}"

    schema = {
        "name": "manual_maintenance_plan",
        "strict": True,
        "schema": {
            "type": "object",
            "properties": {
                "asset": {"type": "string"},
                "source_file": {"type": "string"},
                "plans": {
                    "type": "array",
                    "items": {
                        "type": "object",
                        "properties": {
                            "title": {"type": "string"},
                            "type": {"type": "string"},
                            "frequency": {
                                "type": "object",
                                "properties": {
                                    "value": {"type": ["number", "null"]},
                                    "unit": {"type": ["string", "null"]},
                                    "label": {"type": "string"}
                                },
                                "required": ["value", "unit", "label"],
                                "additionalProperties": False
                            },
                            "tasks": {
                                "type": "array",
                                "items": {"type": "string"}
                            },
                            "estimated_duration_hours": {"type": ["number", "null"]},
                            "priority": {"type": "string"},
                            "source_pages": {
                                "type": "array",
                                "items": {"type": "integer"}
                            },
                            "confidence": {"type": "number"}
                        },
                        "required": ["title", "type", "frequency", "tasks", "estimated_duration_hours", "priority", "source_pages", "confidence"],
                        "additionalProperties": False
                    }
                },
                "diagnostics": {
                    "type": "array",
                    "items": {
                        "type": "object",
                        "properties": {
                            "symptom": {"type": "string"},
                            "causes": {
                                "type": "array",
                                "items": {"type": "string"}
                            },
                            "remedies": {
                                "type": "array",
                                "items": {"type": "string"}
                            },
                            "source_pages": {
                                "type": "array",
                                "items": {"type": "integer"}
                            }
                        },
                        "required": ["symptom", "causes", "remedies", "source_pages"],
                        "additionalProperties": False
                    }
                }
            },
            "required": ["asset", "source_file", "plans", "diagnostics"],
            "additionalProperties": False
        }
    }

    prompt = f"""Sei un motore AI specializzato nell'estrazione di piani di manutenzione da manuali tecnici industriali (PDF).

Prima analizza il documento individuando tutte le sezioni rilevanti, poi estrai i dati in JSON senza perdere informazioni strutturate come tabelle o liste.

⚠️ IMPORTANTE:
- NON riassumere il documento
- NON fare spiegazioni
- NON restituire testo libero
- DEVI restituire SOLO JSON valido
- DEVI essere preciso e conservativo: se non sei sicuro, abbassa confidence ma non inventare

==================================================
🎯 OBIETTIVO
==================================================

Estrarre:
1. Piani di manutenzione (preventiva)
2. Controlli periodici
3. Attività ispettive
4. Attività consigliate (non obbligatorie)
5. Diagnostica (problemi/causa/rimedio)

==================================================
📌 REGOLE DI ESTRAZIONE
==================================================

1. Dai MASSIMA PRIORITÀ a:
- Tabelle
- Sezioni chiamate:
  - MANUTENZIONE
  - CONTROLLO PERIODICO
  - VERIFICHE
  - ISPEZIONI

2. NON confondere:
- descrizione tecnica → NON è manutenzione
- istruzioni installazione → NON è manutenzione
- diagnostica → separata

3. Se trovi una tabella tipo:
"Attività | Frequenza | Lista controlli"
→ DEVI trasformarla in piano manutenzione completo

4. Se trovi lista attività sotto una frequenza:
→ tutte diventano task dello stesso piano

5. Se trovi frasi tipo:
"si consiglia almeno una volta all'anno"
→ classificare come: "type": "recommended"

6. Se trovi più frequenze:
→ crea piani separati

==================================================
🧠 LOGICHE IMPORTANTI
==================================================

FREQUENZA:
- "settimanale" → 7 giorni
- "mensile" → 30 giorni
- "annuale" → 365 giorni
- se non chiaro → lascia null ma mantieni label

PRIORITÀ:
- sicurezza / antincendio → high
- manutenzione tecnica → medium
- controlli consigliati → low

DURATA:
- se non presente → null (NON inventare)

CONFIDENCE:
- tabella chiara → 0.9+
- testo ambiguo → 0.6–0.8
- deduzione → <0.6

==================================================
🚫 ERRORI DA NON FARE
==================================================

NON:
- generare una sola attività se ce ne sono molte
- perdere le sotto-attività
- unire manutenzione e diagnostica
- ignorare le tabelle
- inventare frequenze
- inventare task

{UNTRUSTED_INPUT_POLICY}

Nome file: {safe_filename}

TESTO MANUALE:
{wrap_untrusted("testo_manuale", text[:25000])}

Ora analizza il documento e genera l'output."""

    system_message = """Sei un motore AI specializzato nell'estrazione di piani di manutenzione da manuali tecnici industriali.

REGOLE ASSOLUTE:
- Restituisci SOLO JSON valido, nessun testo fuori dal JSON
- NON riassumere, NON spiegare, NON aggiungere testo libero
- Se non trovi dati certi abbassa confidence ma non inventare mai

OBIETTIVO: Estrarre dal documento:
1. Piani di manutenzione preventiva e periodica
2. Controlli e ispezioni con frequenza
3. Attività consigliate
4. Diagnostica (sintomo/causa/rimedio)

PRIORITÀ ESTRAZIONE:
- Cerca prima le TABELLE con colonne tipo: Attività | Frequenza | Note
- Cerca sezioni chiamate: MANUTENZIONE, CONTROLLO PERIODICO, VERIFICHE, ISPEZIONI
- NON estrarre: descrizioni tecniche, istruzioni installazione, specifiche costruttive

REGOLE FREQUENZA:
- settimanale = 7 giorni
- mensile = 30 giorni
- trimestrale = 90 giorni
- semestrale = 180 giorni
- annuale = 365 giorni
- se ambiguo lascia null ma compila label

REGOLE PRIORITÀ:
- sicurezza/antincendio = high
- manutenzione tecnica ordinaria = medium
- controlli consigliati = low"""

    logger.info("OPENAI parse_manual_with_ai start, chars=%d", len(text))
    try:
        response = ai_client.chat.completions.create(
            model="gpt-4.1",
            messages=[
                {"role": "system", "content": system_message},
                {"role": "user", "content": prompt}
            ],
            response_format={"type": "json_schema", "json_schema": schema}
        )
        result = pseudo.restore(response.choices[0].message.content)
        logger.info("OPENAI parse_manual_with_ai end, finish_reason=%s", response.choices[0].finish_reason)
        return result
    except Exception as exc:
        logger.warning("OPENAI parse_manual_with_ai json_schema fallback: %s", exc)
        response = ai_client.chat.completions.create(
            model="gpt-4.1",
            messages=[
                {"role": "system", "content": system_message},
                {"role": "user", "content": prompt}
            ],
            response_format={"type": "json_object"}
        )
        result = pseudo.restore(response.choices[0].message.content)
        logger.info("OPENAI parse_manual_with_ai fallback end")
        return result

def salva_manuale_db(
    db: Session,
    nome_file: str,
    pagine: int,
    metodo_lettura: str,
    testo_raw: str,
    json_estratto: str = "",
    tenant_id: int | None = None,
    piano_id: int | None = None,
):
    logger.info(
        "salva_manuale_db: file=%s pagine=%d metodo=%s testo_len=%d json_len=%d",
        nome_file, pagine, metodo_lettura,
        len(testo_raw) if testo_raw else 0,
        len(json_estratto) if json_estratto else 0,
    )

    nuovo_manuale = Manuale(
        nome_file=nome_file,
        pagine=pagine,
        metodo_lettura=metodo_lettura,
        testo_raw=testo_raw,
        json_estratto=json_estratto,
        tenant_id=tenant_id,
        piano_id=piano_id,
    )

    db.add(nuovo_manuale)
    db.commit()
    db.refresh(nuovo_manuale)

    logger.info("salva_manuale_db OK, id=%d", nuovo_manuale.id)

    return nuovo_manuale



