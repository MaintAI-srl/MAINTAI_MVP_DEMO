from backend.services.ai.openai_service import get_openai_client
from backend.services.ai.anonymization_service import anonymizer


def build_generic_context(ticket: dict, asset: dict | None, symptoms: str) -> str:
    # Redact inputs for privacy using the unified anonymizer
    ticket = anonymizer.anonymize_data(ticket)
    asset = anonymizer.anonymize_data(asset)
    symptoms = anonymizer.mask_text(symptoms)

    titolo = ticket.get("titolo", "")
    asset_name = asset["name"] if asset and asset.get("name") else "Asset sconosciuto"
    categoria = "Non specificata"

    return f"""
Contesto tecnico disponibile:
- Titolo ticket: {titolo}
- Asset: {asset_name}
- Priorità: {ticket.get("priorita", "")}
- Stato: {ticket.get("stato", "")}
- Fascia: {ticket.get("fascia", "")}
- Durata stimata intervento: {ticket.get("durata_ore", "")} ore
- Sintomi osservati: {symptoms}

Nota importante:
- Usa soprattutto i sintomi, il titolo del ticket, il nome asset e la logica manutentiva generale.
- Il guasto potrebbe essere elettrico, meccanico, pneumatico, idraulico, strumentale, di automazione, di processo, di utility o misto.
""".strip()


def analyze_problem_with_ai(ticket: dict, asset: dict | None, symptoms: str, method: str) -> str:
    ai_client = get_openai_client()
    context_block = build_generic_context(ticket, asset, symptoms)

    schema = {
        "name": "maintenance_problem_analysis_v2",
        "strict": True,
        "schema": {
            "type": "object",
            "properties": {
                "executive_summary": {
                    "type": "object",
                    "properties": {
                        "problem_statement": {"type": "string"},
                        "asset_context": {"type": "string"},
                        "failure_family": {"type": "string"},
                        "diagnostic_confidence": {"type": "string"},
                        "safe_condition_required": {"type": "boolean"}
                    },
                    "required": [
                        "problem_statement",
                        "asset_context",
                        "failure_family",
                        "diagnostic_confidence",
                        "safe_condition_required"
                    ],
                    "additionalProperties": False
                },
                "immediate_safety_actions": {
                    "type": "array",
                    "items": {"type": "string"}
                },
                "priority_checks": {
                    "type": "array",
                    "items": {
                        "type": "object",
                        "properties": {
                            "priority": {"type": "integer"},
                            "area": {"type": "string"},
                            "component_or_function": {"type": "string"},
                            "check_to_perform": {"type": "string"},
                            "technical_reason": {"type": "string"},
                            "how_to_execute": {"type": "string"},
                            "instrument_or_tool": {"type": "string"},
                            "expected_if_ok": {"type": "string"},
                            "finding_if_faulty": {"type": "string"},
                            "estimated_time_min": {"type": "integer"},
                            "requires_isolation_or_lockout": {"type": "boolean"}
                        },
                        "required": [
                            "priority",
                            "area",
                            "component_or_function",
                            "check_to_perform",
                            "technical_reason",
                            "how_to_execute",
                            "instrument_or_tool",
                            "expected_if_ok",
                            "finding_if_faulty",
                            "estimated_time_min",
                            "requires_isolation_or_lockout"
                        ],
                        "additionalProperties": False
                    }
                },
                "likely_causes": {
                    "type": "array",
                    "items": {
                        "type": "object",
                        "properties": {
                            "cause_hypothesis": {"type": "string"},
                            "confidence": {"type": "integer"},
                            "evidence_supporting": {
                                "type": "array",
                                "items": {"type": "string"}
                            },
                            "evidence_missing_or_against": {
                                "type": "array",
                                "items": {"type": "string"}
                            },
                            "confirmation_test": {"type": "string"}
                        },
                        "required": [
                            "cause_hypothesis",
                            "confidence",
                            "evidence_supporting",
                            "evidence_missing_or_against",
                            "confirmation_test"
                        ],
                        "additionalProperties": False
                    }
                },
                "recommended_actions": {
                    "type": "array",
                    "items": {
                        "type": "object",
                        "properties": {
                            "action": {"type": "string"},
                            "action_type": {"type": "string"},
                            "priority": {"type": "string"},
                            "reason": {"type": "string"}
                        },
                        "required": ["action", "action_type", "priority", "reason"],
                        "additionalProperties": False
                    }
                },
                "five_why": {
                    "type": "object",
                    "properties": {
                        "problem": {"type": "string"},
                        "why_chain": {
                            "type": "array",
                            "items": {"type": "string"}
                        },
                        "root_cause_hypothesis": {"type": "string"}
                    },
                    "required": ["problem", "why_chain", "root_cause_hypothesis"],
                    "additionalProperties": False
                },
                "ishikawa": {
                    "type": "object",
                    "properties": {
                        "machine": {"type": "array", "items": {"type": "string"}},
                        "method": {"type": "array", "items": {"type": "string"}},
                        "material": {"type": "array", "items": {"type": "string"}},
                        "manpower": {"type": "array", "items": {"type": "string"}},
                        "environment": {"type": "array", "items": {"type": "string"}},
                        "measurement": {"type": "array", "items": {"type": "string"}}
                    },
                    "required": ["machine", "method", "material", "manpower", "environment", "measurement"],
                    "additionalProperties": False
                },
                "fmeca": {
                    "type": "array",
                    "items": {
                        "type": "object",
                        "properties": {
                            "failure_mode": {"type": "string"},
                            "possible_cause": {"type": "string"},
                            "effect": {"type": "string"},
                            "severity": {"type": "integer"},
                            "occurrence": {"type": "integer"},
                            "detectability": {"type": "integer"},
                            "recommended_action": {"type": "string"}
                        },
                        "required": [
                            "failure_mode",
                            "possible_cause",
                            "effect",
                            "severity",
                            "occurrence",
                            "detectability",
                            "recommended_action"
                        ],
                        "additionalProperties": False
                    }
                },
                "missing_data": {
                    "type": "array",
                    "items": {"type": "string"}
                }
            },
            "required": [
                "executive_summary",
                "immediate_safety_actions",
                "priority_checks",
                "likely_causes",
                "recommended_actions",
                "five_why",
                "ishikawa",
                "fmeca",
                "missing_data"
            ],
            "additionalProperties": False
        }
    }

    prompt = f"""
Sei un ingegnere senior di manutenzione industriale e affidabilità impianti.

Non sei un assistente generico.
Devi ragionare come un professionista della manutenzione che deve aiutare una squadra tecnica a:
1. mettere in sicurezza
2. capire cosa controllare subito
3. ordinare le verifiche per priorità
4. distinguere sintomi, verifiche, cause probabili e azioni correttive
5. evitare conclusioni facili non supportate dai dati

{context_block}

Istruzioni fondamentali:
- Il guasto può essere di qualsiasi natura: elettrica, meccanica, pneumatica, idraulica, strumentale, automazione, processo, utility o combinata.
- Non assumere una disciplina tecnica specifica se i dati non la supportano chiaramente.
- Non dire "mancanza di manutenzione" o "manutenzione insufficiente" come causa principale, a meno che tu non riesca a specificare quale controllo preventivo mancava, su quale componente, e perché questo spiega i sintomi.
- Se i dati sono deboli o incompleti, abbassa la confidence e popola missing_data.
- Prima definisci i controlli prioritari, poi formula le ipotesi causa.
- Ogni controllo deve essere eseguibile sul campo da un manutentore o tecnico specializzato.
- Evita frasi vaghe come "controllare l'impianto", "fare una verifica generale", "verificare la manutenzione".
- Devi indicare oggetti tecnici concreti: componenti, segnali, parametri, misure, funzionalità, organi meccanici, catene di comando, sensori, alimentazioni, perdite, pressioni, temperature, vibrazioni, logiche di consenso, condizioni di processo.
- Per ogni causa ipotizzata indica anche cosa la confermerebbe.
- Se il riavvio o il ripristino è rischioso, devi dichiararlo chiaramente.
- diagnostic_confidence può essere solo: low, medium, high
- confidence nelle likely_causes deve essere un intero da 1 a 10
- severity, occurrence e detectability devono essere interi da 1 a 10
- action_type può essere solo: diagnostic, corrective, preventive
- priority può essere solo: high, medium, low
- Nessun markdown
- Nessun testo fuori dal JSON

Metodo richiesto: {method}

Regole metodologiche:
- Se method = "5why", approfondisci molto la catena causale ma mantieni comunque verifiche operative reali.
- Se method = "ishikawa", amplia le famiglie di causa ma senza perdere la concretezza operativa.
- Se method = "fmeca", ragiona per modi di guasto, effetti e controllabilità.
- Se method = "all", integra tutti gli approcci senza duplicazioni inutili.

Obiettivo qualità output:
- un manutentore deve poter leggere il JSON e sapere da dove partire
- un responsabile manutenzione deve capire priorità, rischio, lacune informative e prossime azioni
- le verifiche devono essere ordinate per utilità diagnostica, non per eleganza teorica
""".strip()

    response = ai_client.chat.completions.create(
        model="gpt-4.1",
        messages=[
            {
                "role": "system",
                "content": (
                    "Rispondi solo con dati strutturati validi secondo lo schema JSON. "
                    "Ragiona come un ingegnere senior di manutenzione industriale, "
                    "in modo concreto, prudente e orientato alla verifica."
                )
            },
            {
                "role": "user",
                "content": prompt
            }
        ],
        response_format={
            "type": "json_schema",
            "json_schema": schema
        }
    )

    return response.choices[0].message.content
