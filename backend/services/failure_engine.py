"""
Failure Intelligence Engine — analisi guasti AI-powered.
Usa OpenAI per matching sintomi -> failure modes dalla knowledge base FMECA.
"""
import json
from sqlalchemy.orm import Session
from backend.db.modelli import FailureMode, FailureAnalysis, DiagnosticLearning
from backend.services.ai.openai_service import get_openai_client
from backend.core.logging_config import get_logger

logger = get_logger(__name__)


def classify_rpn(rpn: int) -> str:
    if rpn <= 50:
        return "LOW"
    if rpn <= 150:
        return "MEDIUM"
    return "HIGH"


FIE_SYSTEM_PROMPT = """Sei un ingegnere esperto di affidabilità industriale e analisi FMECA (Failure Mode, Effects and Criticality Analysis).

Ti viene fornita una knowledge base di failure modes noti per un tipo di asset industriale, con i relativi valori di Severity, Occurrence, Detectability e RPN (Risk Priority Number = S×O×D).

Il tuo compito:
1. Analizza i sintomi e la descrizione del guasto forniti
2. Identifica i 3 failure modes più probabili dalla knowledge base in base ai sintomi
3. Per ognuno fornisci: probability_score (0-100), spiegazione del ragionamento, e se necessario correggi severity/occurrence/detectability in base ai sintomi specifici

REGOLE:
- Usa SOLO failure modes dalla knowledge base fornita — non inventare nuovi
- Il probability_score deve riflettere quanto i sintomi corrispondono al failure mode
- Considera anche il peso_appreso (>1.0 = confermato in passato su questo impianto)
- Se i sintomi non corrispondono bene a nessun failure mode, abbassa tutti i probability_score
- Fornisci explanation in italiano, tecnica e concisa

Rispondi SOLO con JSON valido in questo formato:
{
  "top3": [
    {
      "failure_mode_id": <int>,
      "probability_score": <0-100>,
      "severity_adjusted": <1-10>,
      "occurrence_adjusted": <1-10>,
      "detectability_adjusted": <1-10>,
      "explanation": "<ragionamento tecnico>"
    }
  ],
  "most_probable_cause": "<causa principale in una frase>",
  "overall_confidence": "<low|medium|high>",
  "general_explanation": "<sintesi analisi>"
}"""


def analyze_failure(
    db: Session,
    ticket_id: int,
    asset_type: str,
    symptoms: str,
    description: str,
    tenant_id: int,
    asset_info: dict | None = None,
) -> dict:
    """
    Analisi failure mode con OpenAI.
    Carica knowledge base FMECA dal DB, passa a GPT con i sintomi, ritorna top 3.
    """
    # Carica failure modes per questo tipo asset
    modes = db.query(FailureMode).filter(
        FailureMode.asset_type == asset_type,
        (FailureMode.is_global == True) | (FailureMode.tenant_id == tenant_id),
    ).order_by(FailureMode.rpn.desc()).all()

    if not modes:
        return {
            "failure_modes_ranked": [],
            "most_probable_cause": f"Nessun dato FMECA disponibile per tipo asset '{asset_type}'.",
            "recommended_actions": [],
            "priority": "UNKNOWN",
            "confidence_score": 0.0,
            "explanation": f"Tipo asset '{asset_type}' non presente nella knowledge base.",
            "asset_type_used": asset_type,
        }

    # Costruisci knowledge base per il prompt
    kb_lines = []
    for m in modes:
        kb_lines.append(
            f"ID:{m.id} | {m.component} | {m.failure_mode} | "
            f"Causa:{m.failure_cause} | Effetto:{m.failure_effect} | "
            f"S:{m.severity} O:{m.occurrence} D:{m.detectability} RPN:{m.rpn} "
            f"PesoAppreso:{round(m.peso_appreso, 2)}"
        )
    kb_text = "\n".join(kb_lines)

    asset_context = ""
    if asset_info:
        parts = []
        if asset_info.get("nome"):
            parts.append(f"Asset: {asset_info['nome']}")
        if asset_info.get("marca"):
            parts.append(f"Marca: {asset_info['marca']}")
        if asset_info.get("modello"):
            parts.append(f"Modello: {asset_info['modello']}")
        if asset_info.get("anno_installazione"):
            parts.append(f"Anno installazione: {asset_info['anno_installazione']}")
        if asset_info.get("note_tecniche"):
            parts.append(f"Note tecniche: {asset_info['note_tecniche']}")
        asset_context = "\n".join(parts)

    user_msg = f"""TIPO ASSET: {asset_type}
{asset_context}

SINTOMI RIPORTATI:
{symptoms}

DESCRIZIONE GUASTO:
{description or '(non fornita)'}

KNOWLEDGE BASE FMECA ({len(modes)} failure modes noti):
{kb_text}

Identifica i 3 failure modes più probabili in base ai sintomi. Usa solo failure modes dalla lista sopra."""

    client = get_openai_client()
    try:
        response = client.chat.completions.create(
            model="gpt-4.1-mini",
            messages=[
                {"role": "system", "content": FIE_SYSTEM_PROMPT},
                {"role": "user", "content": user_msg},
            ],
            response_format={"type": "json_object"},
            temperature=0.2,
        )
        result = json.loads(response.choices[0].message.content)
    except Exception as e:
        logger.error("FIE OpenAI error: %s", e)
        return {
            "failure_modes_ranked": [],
            "most_probable_cause": "Errore analisi AI — riprova.",
            "recommended_actions": [],
            "priority": "UNKNOWN",
            "confidence_score": 0.0,
            "explanation": str(e),
            "asset_type_used": asset_type,
        }

    # Mappa risultati GPT -> dati DB
    modes_by_id = {m.id: m for m in modes}
    ranked = []

    # Elimina FailureAnalysis precedenti per questo ticket
    db.query(FailureAnalysis).filter(
        FailureAnalysis.ticket_id == ticket_id,
        FailureAnalysis.tenant_id == tenant_id,
    ).delete()

    for item in result.get("top3", [])[:3]:
        fid = item.get("failure_mode_id")
        mode = modes_by_id.get(fid)
        if not mode:
            continue

        prob = float(item.get("probability_score", 0))
        sev_adj = int(item.get("severity_adjusted", mode.severity))
        occ_adj = int(item.get("occurrence_adjusted", mode.occurrence))
        det_adj = int(item.get("detectability_adjusted", mode.detectability))
        rpn_adj = sev_adj * occ_adj * det_adj

        fa = FailureAnalysis(
            ticket_id=ticket_id,
            failure_mode_id=fid,
            probability_score=prob / 100,
            rpn_weighted=rpn_adj * mode.peso_appreso,
            ai_explanation=item.get("explanation", ""),
            tenant_id=tenant_id,
        )
        db.add(fa)

        ranked.append({
            "rank": len(ranked) + 1,
            "failure_mode_id": fid,
            "component": mode.component,
            "failure_mode": mode.failure_mode,
            "failure_cause": mode.failure_cause,
            "failure_effect": mode.failure_effect,
            "detection_method": mode.detection_method,
            "recommended_action": mode.recommended_action,
            "severity": sev_adj,
            "occurrence": occ_adj,
            "detectability": det_adj,
            "rpn": rpn_adj,
            "rpn_class": classify_rpn(rpn_adj),
            "probability_score": prob,
            "mtbf_hours": mode.mtbf_hours,
            "ai_explanation": item.get("explanation", ""),
        })

    db.commit()

    best = ranked[0] if ranked else None
    confidence_map = {"low": 0.3, "medium": 0.6, "high": 0.9}
    confidence = confidence_map.get(result.get("overall_confidence", "medium"), 0.6)

    return {
        "failure_modes_ranked": ranked,
        "most_probable_cause": result.get("most_probable_cause", ""),
        "recommended_actions": [best["recommended_action"]] if best and best.get("recommended_action") else [],
        "priority": classify_rpn(best["rpn"]) if best else "UNKNOWN",
        "confidence_score": confidence,
        "explanation": result.get("general_explanation", ""),
        "asset_type_used": asset_type,
    }


def confirm_failure_mode(
    db: Session,
    ticket_id: int,
    failure_mode_id: int,
    symptoms: str,
    real_cause: str,
    action_taken: str,
    resolution_time_minutes: int,
    success: bool,
    tenant_id: int,
) -> dict:
    """Learning loop: tecnico conferma la causa reale. Aggiorna peso_appreso."""
    learning = DiagnosticLearning(
        ticket_id=ticket_id,
        diagnosed_failure_mode_id=failure_mode_id if failure_mode_id > 0 else None,
        symptoms=symptoms,
        real_cause=real_cause,
        action_taken=action_taken,
        resolution_time_minutes=resolution_time_minutes,
        success=success,
        tenant_id=tenant_id,
    )
    db.add(learning)

    if failure_mode_id > 0 and success:
        confirmed = db.query(FailureMode).filter(FailureMode.id == failure_mode_id).first()
        if confirmed:
            confirmed.peso_appreso = min(confirmed.peso_appreso * 1.10, 5.0)
            confirmed.source = "learned"
            # Diminuisce peso degli altri dello stesso asset_type
            others = db.query(FailureMode).filter(
                FailureMode.asset_type == confirmed.asset_type,
                FailureMode.id != failure_mode_id,
            ).all()
            for m in others:
                m.peso_appreso = max(m.peso_appreso * 0.95, 0.1)

    # Marca FailureAnalysis come selected
    db.query(FailureAnalysis).filter(
        FailureAnalysis.ticket_id == ticket_id,
        FailureAnalysis.failure_mode_id == failure_mode_id,
    ).update({"selected": True})

    db.commit()
    return {"status": "ok", "message": "Learning aggiornato con successo."}
