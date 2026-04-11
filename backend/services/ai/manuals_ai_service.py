
from sqlalchemy.orm import Session
from backend.db.modelli import Manuale
from backend.services.ai.openai_service import get_openai_client
from backend.services.ai.anonymization_service import anonymizer

def extract_maintenance_tasks(text: str) -> str:
    ai_client = get_openai_client()
    
    # Redact text for privacy
    text = anonymizer.mask_text(text)

    prompt = f"""
Sei un assistente esperto di manutenzione industriale.

Dal testo seguente estrai SOLO le attività di manutenzione.
Ignora contenuti commerciali, legali, descrizioni generiche e parti non utili alla pianificazione.

Restituisci JSON con questo formato:

[
  {{
    "impianto": "",
    "componente": "",
    "attivita": "",
    "frequenza": ""
  }}
]

Testo:
{text[:20000]}
""".strip()

    print(">>> OPENAI START extract_maintenance_tasks")
    print(">>> chars:", len(text))

    response = ai_client.chat.completions.create(
        model="gpt-4.1-mini",
        messages=[{"role": "user", "content": prompt}],
    )

    print(">>> OPENAI END extract_maintenance_tasks")

    return response.choices[0].message.content

def parse_manual_with_ai(text: str, filename: str) -> str:
    ai_client = get_openai_client()

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

Nome file: {filename}

TESTO MANUALE:
{text[:25000]}

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

    print(">>> OPENAI START parse_manual_with_ai, chars:", len(text))
    try:
        response = ai_client.chat.completions.create(
            model="gpt-4.1",
            messages=[
                {"role": "system", "content": system_message},
                {"role": "user", "content": prompt}
            ],
            response_format={"type": "json_schema", "json_schema": schema}
        )
        result = response.choices[0].message.content
        print(">>> OPENAI END parse_manual_with_ai, finish_reason:", response.choices[0].finish_reason)
        print(">>> RESULT PREVIEW:", result[:300] if result else "EMPTY")
        return result
    except Exception as exc:
        print(f">>> OPENAI ERROR con json_schema: {exc}")
        print(">>> Fallback su json_object...")
        response = ai_client.chat.completions.create(
            model="gpt-4.1",
            messages=[
                {"role": "system", "content": system_message},
                {"role": "user", "content": prompt}
            ],
            response_format={"type": "json_object"}
        )
        result = response.choices[0].message.content
        print(">>> FALLBACK RESULT PREVIEW:", result[:300] if result else "EMPTY")
        return result

def salva_manuale_db(
    db: Session,
    nome_file: str,
    pagine: int,
    metodo_lettura: str,
    testo_raw: str,
    json_estratto: str = "",
    tenant_id: int | None = None,
):
    print(">>> SALVATAGGIO MANUALE DB START")
    print(">>> nome_file:", nome_file)
    print(">>> pagine:", pagine)
    print(">>> metodo_lettura:", metodo_lettura)
    print(">>> testo_len:", len(testo_raw) if testo_raw else 0)
    print(">>> json_len:", len(json_estratto) if json_estratto else 0)

    nuovo_manuale = Manuale(
        nome_file=nome_file,
        pagine=pagine,
        metodo_lettura=metodo_lettura,
        testo_raw=testo_raw,
        json_estratto=json_estratto,
        tenant_id=tenant_id,
    )

    db.add(nuovo_manuale)
    db.commit()
    db.refresh(nuovo_manuale)

    print(">>> SALVATAGGIO MANUALE DB OK, id:", nuovo_manuale.id)

    return nuovo_manuale



