"""
Test della pseudonimizzazione reversibile verso i servizi AI esterni.

Tre livelli:
1. unità sul ``Pseudonymizer`` (token deterministici, roundtrip, non-regressione sui
   dati tecnici che le vecchie regex distruggevano);
2. zero-leak sui call site: si esegue ogni servizio AI con un client OpenAI finto e si
   verifica che nessun nome reale compaia nel payload effettivamente inviato;
3. guardia statica: un modulo che chiama OpenAI deve passare da un servizio di masking.
"""
from __future__ import annotations

import json
import re
from pathlib import Path
from types import SimpleNamespace

import pytest

from backend.db.modelli import Asset, FailureMode, Tecnico, Tenant
from backend.services.ai.anonymization_service import anonymizer
from backend.services.ai.pseudonymizer import Pseudonymizer, build_pseudonymizer


# ── Client OpenAI finto ───────────────────────────────────────────────────────

class _FakeCompletions:
    def __init__(self, sent: list[dict], content: str):
        self._sent = sent
        self._content = content

    def create(self, **kwargs):
        self._sent.append(kwargs)
        return SimpleNamespace(
            choices=[SimpleNamespace(
                message=SimpleNamespace(content=self._content),
                finish_reason="stop",
            )],
            usage=SimpleNamespace(prompt_tokens=10, completion_tokens=5, total_tokens=15),
        )


class _FakeClient:
    def __init__(self, sent: list[dict], content: str):
        self.chat = SimpleNamespace(completions=_FakeCompletions(sent, content))


def _install_fake_client(monkeypatch, module, content: str) -> list[dict]:
    """Sostituisce get_openai_client nel modulo indicato e ritorna i payload inviati."""
    sent: list[dict] = []
    monkeypatch.setattr(module, "get_openai_client", lambda: _FakeClient(sent, content))
    return sent


def _payload_text(sent: list[dict]) -> str:
    """Concatena tutti i messaggi inviati a OpenAI in un'unica stringa ispezionabile."""
    parts = []
    for call in sent:
        for message in call.get("messages", []):
            content = message.get("content")
            parts.append(content if isinstance(content, str) else json.dumps(content))
    return "\n".join(parts)


# ── 1. Unità sul Pseudonymizer ────────────────────────────────────────────────

def test_token_deterministico_e_indipendente_dall_istanza():
    """
    Due istanze costruite dagli stessi dati devono produrre la stessa mappa: è ciò che
    permette alla sessione diagnostica multi-turno di restare coerente senza persistere
    la mappa insieme alla history.
    """
    asset = {"id": 3, "nome": "Pompa Alimento P-102", "codice": "AST-0012"}
    uno, due = Pseudonymizer(), Pseudonymizer()
    uno.register_asset(asset)
    due.register_asset(asset)

    testo = "Guasto sulla Pompa Alimento P-102"
    assert uno.mask_text(testo) == due.mask_text(testo) == "Guasto sulla ASSET_3"


def test_roundtrip_mask_restore():
    pseudo = build_pseudonymizer(
        assets=[{"id": 7, "nome": "Compressore C1", "matricola": "SN-4471"}],
        tecnici=[{"id": 2, "nome": "Mario", "cognome": "Rossi"}],
    )
    originale = "Mario Rossi ha sostituito il filtro del Compressore C1 (SN-4471)."
    mascherato = pseudo.mask_text(originale)

    assert "Mario" not in mascherato
    assert "Compressore C1" not in mascherato
    assert "SN-4471" not in mascherato
    assert pseudo.restore(mascherato) == originale


def test_nome_completo_vince_sul_nome_singolo():
    """Il match è longest-first: 'Mario Rossi' non deve degradare in 'TECNICO_2 Rossi'."""
    pseudo = Pseudonymizer()
    pseudo.register_tecnico({"id": 2, "nome": "Mario", "cognome": "Rossi"})
    assert pseudo.mask_text("Assegnato a Mario Rossi") == "Assegnato a TECNICO_2"
    assert pseudo.restore("TECNICO_2 disponibile") == "Mario Rossi disponibile"


def test_restore_ricorsivo_su_strutture():
    pseudo = Pseudonymizer()
    pseudo.register_asset({"id": 5, "nome": "Nastro N3"})
    piano = {
        "planned_workorders": [{"wo_id": 1, "motivation": "Fermo di ASSET_5 previsto"}],
        "global_warnings": ["ASSET_5 in manutenzione"],
    }
    ripristinato = pseudo.restore(piano)
    assert ripristinato["planned_workorders"][0]["motivation"] == "Fermo di Nastro N3 previsto"
    assert ripristinato["global_warnings"] == ["Nastro N3 in manutenzione"]


def test_coordinate_mascherate_per_chiave():
    pseudo = Pseudonymizer()
    masked = pseudo.mask_payload({"latitude": 45.4642, "longitude": 9.19, "temperatura": 21.5})
    assert masked["latitude"] == "[MASKED_POS]"
    assert masked["longitude"] == "[MASKED_POS]"
    assert masked["temperatura"] == 21.5


def test_valori_troppo_corti_o_numerici_non_sostituiti():
    """Un asset chiamato 'P1' o un codice '42' non devono essere sostituiti ovunque."""
    pseudo = Pseudonymizer()
    pseudo.register_asset({"id": 1, "nome": "P1", "codice": "42"})
    testo = "Il P1 è a 42 gradi"
    assert pseudo.mask_text(testo) == testo


# ── 2. Non-regressione: i dati tecnici non devono essere distrutti ────────────

@pytest.mark.parametrize("testo", [
    "Codice ricambio 1234567 — sostituire ogni 2000 ore",
    "Tolleranza di accoppiamento 0.0254 mm",
    "Pressione di esercizio 1.23456 bar",
    "Matricola costruttore 987654321012",
    "Serrare a 12345678 Nm secondo tabella",
])
def test_dati_tecnici_restano_intatti(testo):
    """
    Regressione storica: la vecchia regex PHONE `(\\d{7,15})` trasformava ogni codice
    ricambio in [PHONE] e la vecchia regex COORDINATES ogni misura in [COORD], svuotando
    di senso proprio il parsing dei manuali per cui la chiamata viene fatta.
    """
    assert anonymizer.mask_text(testo) == testo


@pytest.mark.parametrize("testo,atteso", [
    ("Scrivi a mario.rossi@esempio.com", "[EMAIL]"),
    ("Chiama il +39 333 1234567", "[PHONE]"),
    ("Reperibile al 02 1234567", "[PHONE]"),
    ("Posizione lat: 45.123456", "[COORD]"),
])
def test_pii_ancora_mascherate(testo, atteso):
    assert atteso in anonymizer.mask_text(testo)


# ── 3. Zero-leak sui call site ────────────────────────────────────────────────

def test_diagnostic_non_invia_nomi_reali(monkeypatch):
    from backend.services.ai import diagnostic_service

    sent = _install_fake_client(
        monkeypatch, diagnostic_service,
        json.dumps({"type": "question", "content": "Verifica ASSET_9", "detail": "",
                    "instrument": None, "expected_value": None, "root_cause": None,
                    "recommended_actions": []}),
    )

    outcome = diagnostic_service.start_diagnostic_session(
        ticket={"id": 1, "titolo": "Rumore anomalo su Pompa Vuoto PV-7",
                "tipo": "BD", "descrizione": "Segnalato da Luigi Verdi", "tecnico": "Luigi Verdi"},
        asset={"id": 9, "nome": "Pompa Vuoto PV-7", "marca": "Siemens", "modello": "S7-1200",
               "matricola": "SN-556677", "fornitore": "Bianchi Service Srl",
               "posizione_fisica": "Capannone 2 - Nord"},
        historical_tickets=[{"id": 4, "titolo": "Perdita su Pompa Vuoto PV-7", "descrizione": ""}],
    )

    payload = _payload_text(sent)
    for riservato in ("Pompa Vuoto PV-7", "SN-556677", "Bianchi Service Srl", "Capannone 2 - Nord"):
        assert riservato not in payload, f"{riservato} inviato in chiaro a OpenAI"
    assert "ASSET_9" in payload
    # Marca e modello restano in chiaro: sono il contenuto diagnostico, non identificano il cliente
    assert "Siemens" in payload and "S7-1200" in payload
    # La risposta torna leggibile all'utente
    assert outcome["result"]["content"] == "Verifica Pompa Vuoto PV-7"


def test_problem_analysis_non_invia_nomi_reali(monkeypatch):
    from backend.services.ai import problem_analysis_service

    sent = _install_fake_client(
        monkeypatch, problem_analysis_service,
        json.dumps({"executive_summary": {"asset_context": "ASSET_4 fermo"}}),
    )

    risultato = problem_analysis_service.analyze_problem_with_ai(
        ticket={"titolo": "Blocco Estrusore E-44", "priorita": "Alta", "stato": "Aperto"},
        asset={"id": 4, "name": "Estrusore E-44", "nome": "Estrusore E-44",
               "codice": "EST-044", "matricola": "MTR-7788"},
        symptoms="L'Estrusore E-44 si ferma dopo 10 minuti",
        method="all",
    )

    payload = _payload_text(sent)
    assert "Estrusore E-44" not in payload
    assert "MTR-7788" not in payload
    assert "ASSET_4" in payload
    assert "Estrusore E-44" in risultato


def test_manuali_non_inviano_filename_utente_ne_ragione_sociale(monkeypatch):
    from backend.services.ai import manuals_ai_service

    sent = _install_fake_client(
        monkeypatch, manuals_ai_service,
        json.dumps({"asset": "ASSET_2", "source_file": "manuale.pdf", "plans": [], "diagnostics": []}),
    )

    pseudo = build_pseudonymizer(
        assets=[{"id": 2, "nome": "Caldaia CB-9"}],
        tenant={"id": 1, "nome": "Acciaierie Lombarde SpA"},
    )
    risultato = manuals_ai_service.parse_manual_with_ai(
        text="Manuale Caldaia CB-9 per Acciaierie Lombarde SpA. Ricambio 1234567 ogni 2000 h.",
        filename="Offerta_Acciaierie_Lombarde_commessa_4471.pdf",
        pseudo=pseudo,
    )

    payload = _payload_text(sent)
    assert "Acciaierie Lombarde" not in payload
    assert "commessa_4471" not in payload
    assert "Caldaia CB-9" not in payload
    # Il dato tecnico del manuale deve invece arrivare intatto
    assert "1234567" in payload and "2000 h" in payload
    assert "Caldaia CB-9" in risultato


def test_agents_service_non_invia_nomi_tecnici(monkeypatch, db_session):
    """
    Regressione del buco principale: i 5 agenti Felix inviavano nome e cognome reali dei
    tecnici e le label `[codice] nome` degli asset senza alcun masking.
    """
    from backend.services.ai import agents_service

    tenant = Tenant(nome="Cliente Demo", slug="cliente-demo")
    db_session.add(tenant)
    db_session.flush()
    db_session.add_all([
        Asset(nome="Turbina T-900", codice="TRB-900", tenant_id=tenant.id),
        Tecnico(nome="Giovanni", cognome="Esposito", competenze="Meccanico",
                ore_giornaliere=8, tenant_id=tenant.id),
    ])
    db_session.flush()

    sent = _install_fake_client(monkeypatch, agents_service, "Report: ASSET_1 critico, assegnare TECNICO_1.")

    esito = agents_service.run_agent(db_session, tenant.id, "agent_planner", username="tester")

    payload = _payload_text(sent)
    assert "Giovanni" not in payload and "Esposito" not in payload
    assert "Turbina T-900" not in payload and "TRB-900" not in payload
    # Il report consegnato all'utente torna con i nomi reali
    assert "Turbina T-900" in esito["output_md"]
    assert "Giovanni Esposito" in esito["output_md"]


def test_failure_engine_non_invia_scheda_asset_in_chiaro(monkeypatch, db_session):
    """`asset_info` non passava da alcun masking prima di questa modifica."""
    from backend.services import failure_engine

    tenant = Tenant(nome="Cliente FIE", slug="cliente-fie")
    db_session.add(tenant)
    db_session.flush()
    db_session.add(FailureMode(
        asset_type="pompa_centrifuga", component="Girante", failure_mode="Cavitazione",
        failure_cause="NPSH insufficiente", failure_effect="Perdita di portata",
        severity=7, occurrence=4, detectability=5, rpn=140, is_global=True,
    ))
    db_session.flush()

    sent = _install_fake_client(
        monkeypatch, failure_engine,
        json.dumps({"top3": [], "most_probable_cause": "Cavitazione su ASSET_11",
                    "overall_confidence": "medium"}),
    )

    risultato = failure_engine.analyze_failure(
        db=db_session,
        ticket_id=1,
        asset_type="pompa_centrifuga",
        symptoms="Vibrazioni sulla Pompa Servizi PS-11",
        description="Rilevato da Anna Neri",
        tenant_id=tenant.id,
        asset_info={"id": 11, "nome": "Pompa Servizi PS-11", "marca": "Grundfos",
                    "modello": "NB 65", "matricola": "GF-330011",
                    "note_tecniche": "Installata nel 2019"},
    )

    payload = _payload_text(sent)
    assert "Pompa Servizi PS-11" not in payload
    assert "GF-330011" not in payload
    assert "ASSET_11" in payload
    # Marca, modello e note tecniche restano: senza di essi l'analisi FMECA perde valore
    assert "Grundfos" in payload and "NB 65" in payload and "Installata nel 2019" in payload
    assert "Pompa Servizi PS-11" in risultato["most_probable_cause"]


def test_planner_context_pseudonimizzato():
    """
    Il payload dei due planner è ``pseudo.mask_payload(context)``: si verifica il
    meccanismo sul contesto, senza dover simulare meteo e sessione DB.
    """
    from backend.services.ai_planner_service import build_planning_pseudonymizer

    context = {
        "tecnici": [{"id": 4, "nome": "Chiara Fontana", "competenze": "Elettricista"}],
        "tickets": [{
            "id": 12, "asset_id": 6, "asset_nome": "Quadro QE-3",
            "titolo": "Allarme su Quadro QE-3",
            "descrizione": "Chiara Fontana ha rilevato surriscaldamento",
            "durata_stimata_ore": 2.0,
        }],
    }
    pseudo = build_planning_pseudonymizer(context)
    masked = pseudo.mask_payload(context)
    testo = json.dumps(masked, ensure_ascii=False)

    assert "Chiara Fontana" not in testo
    assert "Quadro QE-3" not in testo
    assert "TECNICO_4" in testo and "ASSET_6" in testo
    # I dati operativi non vengono toccati
    assert masked["tecnici"][0]["competenze"] == "Elettricista"
    assert masked["tickets"][0]["durata_stimata_ore"] == 2.0
    # E il piano torna leggibile
    assert pseudo.restore("ASSET_6 assegnato a TECNICO_4") == "Quadro QE-3 assegnato a Chiara Fontana"


def test_strip_metadati_immagine_esploso():
    """
    Un esploso non è pseudonimizzabile, ma i suoi metadati sì: autore, software CAD e
    commessa non devono uscire verso OpenAI insieme al disegno.
    """
    import io

    from PIL import Image

    from backend.api.routes.asset_documenti import _strip_image_metadata

    immagine = Image.new("RGB", (16, 12), (10, 20, 30))
    exif = immagine.getexif()
    exif[270] = "Commessa 4471 - Acciaierie Lombarde"  # ImageDescription
    exif[315] = "Ing. Mario Bianchi"                    # Artist
    buffer = io.BytesIO()
    immagine.save(buffer, format="JPEG", exif=exif.tobytes())
    originale = buffer.getvalue()

    assert b"Acciaierie Lombarde" in originale and b"Mario Bianchi" in originale

    pulita, content_type = _strip_image_metadata(originale, "image/jpeg")
    assert b"Acciaierie Lombarde" not in pulita
    assert b"Mario Bianchi" not in pulita
    assert content_type == "image/jpeg"
    # L'immagine resta valida e analizzabile
    assert Image.open(io.BytesIO(pulita)).size == (16, 12)


def test_strip_metadati_non_rompe_su_input_non_immagine():
    from backend.api.routes.asset_documenti import _strip_image_metadata

    dati, content_type = _strip_image_metadata(b"non-e-un-immagine", "image/jpeg")
    assert dati == b"non-e-un-immagine"
    assert content_type == "image/jpeg"


# ── 4. Guardia anti-regressione ───────────────────────────────────────────────

# Moduli che chiamano OpenAI senza inviare testo di dominio, con la ragione dell'esenzione.
_ESENZIONI_GUARDIA = {
    # Payload multimodale: l'immagine non è tokenizzabile. La mitigazione è la rimozione
    # dei metadati EXIF/IPTC/XMP in _strip_image_metadata + log dell'invio.
    "backend/api/routes/asset_documenti.py",
}

_CHIAMATE_OPENAI = re.compile(r"chat\.completions\.create|Runner\.run\(")
# Il riferimento può essere diretto (import del modulo) o indiretto (un helper come
# build_planning_pseudonymizer): in entrambi i casi il nome compare nel sorgente.
_MASKING = re.compile(r"[Pp]seudonymizer|anonymizer")


def test_ogni_modulo_che_chiama_openai_passa_da_un_masking():
    """
    Guardia strutturale: è esattamente il controllo che avrebbe intercettato il buco di
    agents_service.py, che chiamava OpenAI senza importare alcun servizio di masking.
    """
    radice = Path(__file__).resolve().parents[2]
    scoperti = []
    for percorso in (radice / "backend").rglob("*.py"):
        if "tests" in percorso.parts:
            continue
        sorgente = percorso.read_text(encoding="utf-8")
        if not _CHIAMATE_OPENAI.search(sorgente):
            continue
        relativo = percorso.relative_to(radice).as_posix()
        if relativo in _ESENZIONI_GUARDIA:
            continue
        if not _MASKING.search(sorgente):
            scoperti.append(relativo)

    assert not scoperti, (
        "Questi moduli chiamano OpenAI senza importare un servizio di masking: "
        f"{scoperti}. Usare backend/services/ai/pseudonymizer.py."
    )
