"""
Bulk Import — Caricamento massivo Siti / Impianti / Asset da Excel.
Riservato esclusivamente ai superadmin.

Endpoint:
  GET  /admin/bulk-import/template         → scarica template Excel con esempio + colonne gialle
  POST /admin/bulk-import/preview          → carica file Excel, valida e restituisce anteprima
  POST /admin/bulk-import/execute/{token}  → esegue l'import per un tenant specifico

Struttura Excel (3 fogli):
  1. SITI     — Colonne obbligatorie gialle: nome
  2. IMPIANTI — Colonne obbligatorie gialle: nome, sito_nome
  3. ASSET    — Colonne obbligatorie gialle: nome, area, impianto_nome
"""
from __future__ import annotations

import io
import json
import logging
from datetime import date, datetime, timezone
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from fastapi.responses import StreamingResponse
from sqlalchemy.orm import Session

from backend.core.dependencies import get_db
from backend.core.security import require_superadmin
from backend.db.modelli import Asset, Impianto, Sito

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/admin/bulk-import", tags=["bulk-import"])

MAX_IMPORT_BYTES = 10 * 1024 * 1024  # 10 MB — limite upload Excel (anti memory-exhaustion)

# ── Definizione colonne per foglio ────────────────────────────────────────────

# (nome_colonna, obbligatoria, descrizione, esempio)
SITI_COLS: List[tuple] = [
    ("nome",                    True,  "Nome del sito (obbligatorio)",           "Porto Industriale Nord"),
    ("descrizione",             False, "Descrizione estesa del sito",             "Sito produttivo principale"),
    ("ubicazione",              False, "Indirizzo / ubicazione",                  "Via Industriale 42"),
    ("citta",                   False, "Città",                                   "Genova"),
    ("paese",                   False, "Paese (default: Italia)",                 "Italia"),
    ("responsabile",            False, "Nome responsabile di sito",               "Mario Rossi"),
    ("telefono_responsabile",   False, "Telefono del responsabile",               "+39 010 1234567"),
    ("email_responsabile",      False, "Email del responsabile",                  "m.rossi@azienda.it"),
    ("note",                    False, "Note libere",                             "Apertura 6:00-22:00"),
]

IMPIANTI_COLS: List[tuple] = [
    ("nome",        True,  "Nome impianto (obbligatorio)",                        "Linea Produzione A"),
    ("sito_nome",   True,  "Nome del sito padre (deve esistere nel foglio SITI)", "Porto Industriale Nord"),
    ("tipologia",   False, "Tipologia impianto (es. Produzione, Energia…)",       "Produzione"),
    ("descrizione", False, "Descrizione estesa",                                  "Linea confezionamento"),
    ("latitude",    False, "Latitudine GPS (per meteo)",                          "44.4056"),
    ("longitude",   False, "Longitudine GPS (per meteo)",                         "8.9463"),
    ("note",        False, "Note libere",                                          "Manutenzione ogni 6 mesi"),
]

ASSET_COLS: List[tuple] = [
    ("nome",                   True,  "Nome asset (obbligatorio)",                          "Compressore C-01"),
    ("area",                   True,  "Area / zona di appartenenza (obbligatorio)",         "Area Compressori"),
    ("impianto_nome",          True,  "Nome dell'impianto padre (deve esistere in IMPIANTI)", "Linea Produzione A"),
    ("codice",                 False, "Codice identificativo asset",                        "COMP-001"),
    ("descrizione",            False, "Descrizione tecnica",                                "Compressore a vite 37kW"),
    ("criticita",              False, "Criticità: bassa / media / alta (default: media)",   "alta"),
    ("stato",                  False, "Stato asset: OPERATIVO / FERMO PROG. / GUASTO",      "OPERATIVO"),
    ("marca",                  False, "Marca / costruttore",                                "Atlas Copco"),
    ("modello",                False, "Modello",                                            "GA37+"),
    ("matricola",              False, "Matricola",                                          "AC-2024-001"),
    ("numero_serie",           False, "Numero di serie",                                   "SN123456789"),
    ("anno_installazione",     False, "Anno di installazione (numerico)",                  "2020"),
    ("anno_produzione",        False, "Anno di produzione (numerico)",                     "2019"),
    ("fornitore",              False, "Nome fornitore/distributore",                        "Atlas Copco Italia"),
    ("data_acquisto",          False, "Data acquisto (YYYY-MM-DD)",                        "2020-03-15"),
    ("data_scadenza_garanzia", False, "Data scadenza garanzia (YYYY-MM-DD)",               "2025-03-15"),
    ("posizione_fisica",       False, "Posizione fisica nell'impianto",                    "Sala macchine piano -1"),
    ("limitazioni",            False, "Limitazioni operative",                             "no_notturno"),
    ("weather_constraint",     False, "Vincolo meteo: NONE/NO_RAIN/NO_WIND/NO_FROST",      "NONE"),
    ("note",                   False, "Note operative",                                    "Revisione ogni 2000h"),
    ("note_tecniche",          False, "Note tecniche dettagliate",                         "Olio Shell Corena"),
    ("vincoli_operativi",      False, "Vincoli operativi",                                 "Fermare prima della manutenzione"),
    ("vincoli_manutenzione",   False, "Vincoli specifici manutenzione",                    "Spegnere 2h prima"),
    ("fermo_on_schedule",      False, "Metti in FERMO PROG. al piano: SI/NO (default: NO)", "NO"),
]


# ── Stili Excel ───────────────────────────────────────────────────────────────

def _make_workbook() -> Any:
    """Crea un workbook openpyxl con il template compilato."""
    from openpyxl import Workbook
    from openpyxl.styles import (
        PatternFill, Font, Alignment, Border, Side, GradientFill
    )
    from openpyxl.utils import get_column_letter

    wb = Workbook()

    # Colori
    YELLOW_FILL    = PatternFill("solid", fgColor="FFD700")   # oro/giallo — obbligatorio
    GREY_FILL      = PatternFill("solid", fgColor="D9D9D9")   # grigio chiaro — opzionale
    HEADER_FILL    = PatternFill("solid", fgColor="1F4E79")   # blu scuro — intestazione
    EXAMPLE_FILL   = PatternFill("solid", fgColor="EBF3FB")   # azzurro chiaro — riga esempio
    LEGEND_REQ     = PatternFill("solid", fgColor="FFD700")
    LEGEND_OPT     = PatternFill("solid", fgColor="D9D9D9")

    WHITE_FONT     = Font(bold=True, color="FFFFFF", name="Calibri", size=11)
    BOLD_FONT      = Font(bold=True, name="Calibri", size=10)
    NORMAL_FONT    = Font(name="Calibri", size=10)
    SMALL_FONT     = Font(name="Calibri", size=9, italic=True, color="595959")

    thin_border    = Border(
        left=Side(style="thin", color="BFBFBF"),
        right=Side(style="thin", color="BFBFBF"),
        top=Side(style="thin", color="BFBFBF"),
        bottom=Side(style="thin", color="BFBFBF"),
    )

    def _setup_sheet(ws, title: str, cols: List[tuple], sheet_color: str):
        """Configura un foglio con header, legenda e riga esempio."""
        ws.title = title
        ws.sheet_properties.tabColor = sheet_color

        # ── Riga 1: Titolo foglio ────────────────────────────────────────────
        ws.merge_cells(f"A1:{get_column_letter(len(cols))}1")
        title_cell = ws["A1"]
        title_cell.value = f"  {title} — Template importazione MaintAI"
        title_cell.font = Font(bold=True, color="FFFFFF", size=13, name="Calibri")
        title_cell.fill = PatternFill("solid", fgColor="0D2137")
        title_cell.alignment = Alignment(vertical="center", horizontal="left")
        ws.row_dimensions[1].height = 28

        # ── Riga 2: Legenda ──────────────────────────────────────────────────
        ws.merge_cells(f"A2:{get_column_letter(len(cols))}2")
        leg_cell = ws["A2"]
        leg_cell.value = "  GIALLO = campo obbligatorio    GRIGIO = campo opzionale    La riga 4 è un esempio: modificarla o eliminarla prima dell'import"
        leg_cell.font = Font(size=9, italic=True, color="404040", name="Calibri")
        leg_cell.fill = PatternFill("solid", fgColor="F2F2F2")
        leg_cell.alignment = Alignment(vertical="center", horizontal="left")
        ws.row_dimensions[2].height = 18

        # ── Riga 3: Header colonne ───────────────────────────────────────────
        ws.row_dimensions[3].height = 22
        for col_idx, (col_name, required, desc, example) in enumerate(cols, start=1):
            cell = ws.cell(row=3, column=col_idx, value=col_name.upper())
            cell.font = WHITE_FONT
            cell.fill = HEADER_FILL
            cell.alignment = Alignment(horizontal="center", vertical="center")
            cell.border = thin_border

            # Colore colonna nel body: giallo o grigio
            col_fill = YELLOW_FILL if required else GREY_FILL
            # Header indicatore obbligatorietà — asterisco per required
            if required:
                cell.value = f"* {col_name.upper()}"

            # Larghezza colonna
            ws.column_dimensions[get_column_letter(col_idx)].width = max(18, len(col_name) + 4)

            # Commento colonna (descrizione) tramite Note
            # openpyxl non supporta commenti nativi senza openpyxl-image, usiamo riga desc
            # Riga 4: riga descrizione colonna (legenda interna)
            desc_cell = ws.cell(row=4, column=col_idx, value=desc)
            desc_cell.font = SMALL_FONT
            desc_cell.fill = PatternFill("solid", fgColor="FAFAFA")
            desc_cell.alignment = Alignment(wrap_text=True, vertical="top")
            desc_cell.border = thin_border

        ws.row_dimensions[4].height = 30

        # ── Riga 5: Header "colore" (obbligatorio/opzionale visivo) ──────────
        ws.row_dimensions[5].height = 18
        for col_idx, (col_name, required, desc, example) in enumerate(cols, start=1):
            marker_cell = ws.cell(row=5, column=col_idx, value="▼ obbligatorio" if required else "opzionale")
            marker_cell.font = Font(size=8, bold=required, name="Calibri",
                                    color="5C3317" if required else "595959")
            marker_cell.fill = YELLOW_FILL if required else GREY_FILL
            marker_cell.alignment = Alignment(horizontal="center")
            marker_cell.border = thin_border

        # ── Riga 6: Riga esempio ─────────────────────────────────────────────
        ws.row_dimensions[6].height = 20
        for col_idx, (col_name, required, desc, example) in enumerate(cols, start=1):
            ex_cell = ws.cell(row=6, column=col_idx, value=example)
            ex_cell.font = NORMAL_FONT
            ex_cell.fill = EXAMPLE_FILL
            ex_cell.alignment = Alignment(vertical="center")
            ex_cell.border = thin_border

        # ── Riga 7+: righe vuote per inserimento dati ────────────────────────
        for row in range(7, 207):  # 200 righe vuote
            for col_idx, (col_name, required, _, __) in enumerate(cols, start=1):
                cell = ws.cell(row=row, column=col_idx, value=None)
                cell.fill = YELLOW_FILL if required else PatternFill("solid", fgColor="FFFFFF")
                cell.font = NORMAL_FONT
                cell.border = Border(
                    left=Side(style="thin", color="E0E0E0"),
                    right=Side(style="thin", color="E0E0E0"),
                    top=Side(style="dotted", color="E0E0E0"),
                    bottom=Side(style="dotted", color="E0E0E0"),
                )
                cell.alignment = Alignment(vertical="center")

        # Freeze panes sotto l'header
        ws.freeze_panes = "A7"

        # Filtro automatico sugli header
        ws.auto_filter.ref = f"A3:{get_column_letter(len(cols))}{206}"

    # Configura i tre fogli
    ws_siti = wb.active
    _setup_sheet(ws_siti, "SITI", SITI_COLS, "1F78D1")

    ws_impianti = wb.create_sheet()
    _setup_sheet(ws_impianti, "IMPIANTI", IMPIANTI_COLS, "28A745")

    ws_asset = wb.create_sheet()
    _setup_sheet(ws_asset, "ASSET", ASSET_COLS, "E67E22")

    # ── Foglio ISTRUZIONI ────────────────────────────────────────────────────
    ws_help = wb.create_sheet("ISTRUZIONI")
    ws_help.sheet_properties.tabColor = "7F7F7F"
    instructions = [
        ("", ""),
        ("  GUIDA IMPORTAZIONE MASSIVA — MaintAI", ""),
        ("", ""),
        ("  COME USARE QUESTO FILE:", ""),
        ("  1.", "Compila il foglio SITI con i siti da importare"),
        ("  2.", "Compila il foglio IMPIANTI — la colonna 'sito_nome' DEVE corrispondere esattamente al campo 'nome' nel foglio SITI"),
        ("  3.", "Compila il foglio ASSET — la colonna 'impianto_nome' DEVE corrispondere esattamente al campo 'nome' nel foglio IMPIANTI"),
        ("  4.", "I campi con asterisco (*) sono OBBLIGATORI — le righe con valori mancanti verranno rifiutate"),
        ("  5.", "Elimina la riga di esempio (riga 6) prima di caricare, oppure lasciala — viene ignorata se è uguale all'esempio"),
        ("  6.", "Carica il file nella pagina Admin → Import Massivo"),
        ("", ""),
        ("  VALORI AMMESSI:", ""),
        ("  criticita",  "bassa / media / alta  (default: media se vuoto)"),
        ("  stato",      "OPERATIVO / FERMO PROG. / GUASTO  (default: OPERATIVO se vuoto)"),
        ("  weather_constraint", "NONE / NO_RAIN / NO_WIND / NO_FROST / OUTDOOR_ONLY / INDOOR_ONLY  (default: NONE)"),
        ("  fermo_on_schedule", "SI / NO  (default: NO se vuoto)"),
        ("  paese",      "qualsiasi stringa  (default: Italia se vuoto)"),
        ("  date",       "formato YYYY-MM-DD, es. 2024-03-15"),
        ("  latitude / longitude", "decimali con punto, es. 44.4056 / 8.9463"),
        ("", ""),
        ("  ORDINE DI IMPORT:", ""),
        ("  →", "Prima vengono creati i SITI"),
        ("  →", "Poi gli IMPIANTI (collegati ai siti per nome)"),
        ("  →", "Infine gli ASSET (collegati agli impianti per nome)"),
        ("", ""),
        ("  ATTENZIONE:", ""),
        ("  !", "Il nome del sito e dell'impianto deve essere ESATTO (case-insensitive)"),
        ("  !", "Se un sito o impianto con lo stesso nome esiste già, NON viene duplicato — viene usato quello esistente"),
        ("  !", "L'import è reversibile: contattare il superadmin per annullare"),
    ]
    for r, (col_a, col_b) in enumerate(instructions, start=1):
        ca = ws_help.cell(row=r, column=1, value=col_a)
        cb = ws_help.cell(row=r, column=2, value=col_b)
        if r == 2:
            ca.font = Font(bold=True, size=14, color="1F4E79", name="Calibri")
        elif col_a.strip().startswith(("COME", "VALORI", "ORDINE", "ATTENZIONE")):
            ca.font = Font(bold=True, size=11, color="1F4E79", name="Calibri")
        else:
            ca.font = Font(size=10, name="Calibri")
            cb.font = Font(size=10, name="Calibri")
    ws_help.column_dimensions["A"].width = 28
    ws_help.column_dimensions["B"].width = 80

    return wb


# ── Endpoint: download template ───────────────────────────────────────────────

@router.get("/template")
def download_template(
    _sa: dict = Depends(require_superadmin),
):
    """
    Scarica il template Excel per l'importazione massiva di Siti, Impianti e Asset.
    Colonne gialle = obbligatorie. Colonne grigie = opzionali. Riga 6 = esempio.
    """
    wb = _make_workbook()
    buf = io.BytesIO()
    wb.save(buf)
    buf.seek(0)

    filename = "maintai_bulk_import_template.xlsx"
    return StreamingResponse(
        buf,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


# ── Parsing Excel ─────────────────────────────────────────────────────────────

_EXAMPLE_NAMES = {
    "Porto Industriale Nord", "Linea Produzione A", "Compressore C-01",
}

def _cell_val(row, col_name: str, col_map: Dict[str, int]) -> Optional[str]:
    """Estrae il valore di una cella per nome colonna (strip + None se vuoto)."""
    idx = col_map.get(col_name)
    if idx is None:
        return None
    val = row[idx].value
    if val is None:
        return None
    s = str(val).strip()
    return s if s else None


def _parse_sheet(ws, expected_cols: List[tuple]) -> tuple[List[Dict], List[str]]:
    """
    Legge un foglio Excel e restituisce (righe_valide, errori).
    Ignora le prime 5 righe (titolo, legenda, header, descrizione, marker).
    Riga 6 = esempio — viene ignorata se il nome corrisponde ai nomi di esempio.
    """
    required = {c[0] for c in expected_cols if c[1]}
    col_names = [c[0] for c in expected_cols]

    # Leggi header da riga 3 (row index 3, 1-based)
    header_row = [ws.cell(row=3, column=c).value for c in range(1, ws.max_column + 1)]
    col_map: Dict[str, int] = {}
    for i, h in enumerate(header_row):
        if h:
            # Normalizza: rimuovi asterisco e spazi, lowercase
            key = str(h).replace("*", "").strip().lower()
            col_map[key] = i

    rows: List[Dict] = []
    errors: List[str] = []

    for row_num in range(6, ws.max_row + 1):
        row = [ws.cell(row=row_num, column=c) for c in range(1, ws.max_column + 1)]

        # Skip righe completamente vuote
        if all(c.value is None or str(c.value).strip() == "" for c in row):
            continue

        record: Dict[str, Any] = {}
        row_errors: List[str] = []

        for col_name in col_names:
            val = _cell_val(row, col_name, col_map)
            record[col_name] = val

        # Skip riga esempio
        nome = record.get("nome", "") or ""
        if nome in _EXAMPLE_NAMES:
            continue

        # Verifica obbligatori
        for req in required:
            if not record.get(req):
                row_errors.append(f"Riga {row_num}: campo obbligatorio '{req}' mancante")

        if row_errors:
            errors.extend(row_errors)
        else:
            rows.append({"_row": row_num, **record})

    return rows, errors


# ── Endpoint: preview ─────────────────────────────────────────────────────────

@router.post("/preview")
async def preview_import(
    file: UploadFile = File(...),
    tenant_id: int = Form(...),
    _sa: dict = Depends(require_superadmin),
    db: Session = Depends(get_db),
):
    """
    Carica un file Excel e restituisce un'anteprima dell'import senza scrivere nel DB.
    Valida i riferimenti tra SITI → IMPIANTI → ASSET.
    Parametri:
      - file: file .xlsx
      - tenant_id: ID del tenant destinatario dell'import
    """
    from openpyxl import load_workbook

    if not file.filename or not file.filename.lower().endswith(".xlsx"):
        raise HTTPException(400, "Il file deve essere in formato .xlsx")

    content = await file.read()
    if len(content) > MAX_IMPORT_BYTES:
        raise HTTPException(413, f"File troppo grande: massimo {MAX_IMPORT_BYTES // (1024 * 1024)} MB.")
    try:
        wb = load_workbook(io.BytesIO(content), read_only=False, data_only=True)
    except Exception as e:
        raise HTTPException(400, f"Impossibile leggere il file Excel: {e}")

    # Leggi i tre fogli
    ws_siti     = wb["SITI"]     if "SITI"     in wb.sheetnames else None
    ws_impianti = wb["IMPIANTI"] if "IMPIANTI" in wb.sheetnames else None
    ws_asset    = wb["ASSET"]    if "ASSET"    in wb.sheetnames else None

    if not ws_siti or not ws_impianti or not ws_asset:
        raise HTTPException(400, "Il file deve contenere i fogli: SITI, IMPIANTI, ASSET")

    all_errors: List[str] = []

    siti_rows, siti_errs = _parse_sheet(ws_siti, SITI_COLS)
    impianti_rows, imp_errs = _parse_sheet(ws_impianti, IMPIANTI_COLS)
    asset_rows, asset_errs = _parse_sheet(ws_asset, ASSET_COLS)

    all_errors.extend(siti_errs)
    all_errors.extend(imp_errs)
    all_errors.extend(asset_errs)

    # Verifica cross-references
    siti_nomi = {r["nome"].strip().lower() for r in siti_rows if r.get("nome")}
    # Aggiungi anche i siti già esistenti nel DB per il tenant
    siti_db = {
        s.nome.strip().lower()
        for s in db.query(Sito).filter(Sito.tenant_id == tenant_id).all()
    }
    siti_nomi_totali = siti_nomi | siti_db

    impianti_nomi = {r["nome"].strip().lower() for r in impianti_rows if r.get("nome")}
    impianti_db = {
        i.nome.strip().lower()
        for i in db.query(Impianto).filter(Impianto.tenant_id == tenant_id).all()
    }
    impianti_nomi_totali = impianti_nomi | impianti_db

    for r in impianti_rows:
        sito_ref = (r.get("sito_nome") or "").strip().lower()
        if sito_ref and sito_ref not in siti_nomi_totali:
            all_errors.append(
                f"Foglio IMPIANTI, riga {r['_row']}: sito_nome '{r['sito_nome']}' non trovato in SITI né nel DB"
            )

    for r in asset_rows:
        imp_ref = (r.get("impianto_nome") or "").strip().lower()
        if imp_ref and imp_ref not in impianti_nomi_totali:
            all_errors.append(
                f"Foglio ASSET, riga {r['_row']}: impianto_nome '{r['impianto_nome']}' non trovato in IMPIANTI né nel DB"
            )

    return {
        "valid": len(all_errors) == 0,
        "errors": all_errors,
        "counts": {
            "siti":     len(siti_rows),
            "impianti": len(impianti_rows),
            "asset":    len(asset_rows),
        },
        "preview": {
            "siti":     [_clean_row(r) for r in siti_rows[:5]],
            "impianti": [_clean_row(r) for r in impianti_rows[:5]],
            "asset":    [_clean_row(r) for r in asset_rows[:5]],
        },
    }


def _clean_row(r: Dict) -> Dict:
    """Rimuove la chiave interna _row per la serializzazione."""
    return {k: v for k, v in r.items() if k != "_row"}


# ── Endpoint: execute ─────────────────────────────────────────────────────────

@router.post("/execute")
async def execute_import(
    file: UploadFile = File(...),
    tenant_id: int = Form(...),
    _sa: dict = Depends(require_superadmin),
    db: Session = Depends(get_db),
):
    """
    Esegue l'import massivo dal file Excel nel tenant specificato.

    Logica:
    - SITI: cerca per nome (case-insensitive) nel tenant; se esiste lo usa, altrimenti lo crea.
    - IMPIANTI: cerca per nome nel tenant; se esiste lo usa, altrimenti lo crea collegato al sito.
    - ASSET: crea sempre (non fa dedup su nome perché lo stesso asset può avere più istanze).

    Tutti i record vengono creati con tenant_id = tenant_id specificato.
    L'operazione non è atomica a livello DB (commit per sezione) per facilitare il debug.
    """
    from openpyxl import load_workbook

    if not file.filename or not file.filename.lower().endswith(".xlsx"):
        raise HTTPException(400, "Il file deve essere in formato .xlsx")

    content = await file.read()
    if len(content) > MAX_IMPORT_BYTES:
        raise HTTPException(413, f"File troppo grande: massimo {MAX_IMPORT_BYTES // (1024 * 1024)} MB.")
    try:
        wb = load_workbook(io.BytesIO(content), read_only=False, data_only=True)
    except Exception as e:
        raise HTTPException(400, f"Impossibile leggere il file Excel: {e}")

    ws_siti     = wb["SITI"]     if "SITI"     in wb.sheetnames else None
    ws_impianti = wb["IMPIANTI"] if "IMPIANTI" in wb.sheetnames else None
    ws_asset    = wb["ASSET"]    if "ASSET"    in wb.sheetnames else None

    if not ws_siti or not ws_impianti or not ws_asset:
        raise HTTPException(400, "Il file deve contenere i fogli: SITI, IMPIANTI, ASSET")

    siti_rows, siti_errs = _parse_sheet(ws_siti, SITI_COLS)
    impianti_rows, imp_errs = _parse_sheet(ws_impianti, IMPIANTI_COLS)
    asset_rows, asset_errs = _parse_sheet(ws_asset, ASSET_COLS)

    all_errors = siti_errs + imp_errs + asset_errs
    if all_errors:
        raise HTTPException(422, {"errors": all_errors, "message": "Correggere gli errori prima di eseguire l'import"})

    created_siti: Dict[str, int] = {}      # nome_lower → id
    created_impianti: Dict[str, int] = {}  # nome_lower → id

    stats = {"siti_creati": 0, "siti_esistenti": 0,
             "impianti_creati": 0, "impianti_esistenti": 0,
             "asset_creati": 0}

    try:
        # ── SITI ─────────────────────────────────────────────────────────────────
        for r in siti_rows:
            nome_key = r["nome"].strip().lower()
            existing = (
                db.query(Sito)
                .filter(Sito.tenant_id == tenant_id, Sito.nome.ilike(r["nome"].strip()))
                .first()
            )
            if existing:
                created_siti[nome_key] = existing.id
                stats["siti_esistenti"] += 1
            else:
                sito = Sito(
                    nome=r["nome"].strip(),
                    descrizione=r.get("descrizione"),
                    ubicazione=r.get("ubicazione"),
                    citta=r.get("citta"),
                    paese=r.get("paese") or "Italia",
                    responsabile=r.get("responsabile"),
                    telefono_responsabile=r.get("telefono_responsabile"),
                    email_responsabile=r.get("email_responsabile"),
                    note=r.get("note"),
                    tenant_id=tenant_id,
                )
                db.add(sito)
                db.flush()  # ottieni l'id senza commit intermedio
                created_siti[nome_key] = sito.id
                stats["siti_creati"] += 1

        # Recupera anche siti già esistenti nel DB (non nel file)
        for s in db.query(Sito).filter(Sito.tenant_id == tenant_id).all():
            created_siti.setdefault(s.nome.strip().lower(), s.id)

        # ── IMPIANTI ──────────────────────────────────────────────────────────────
        for r in impianti_rows:
            nome_key = r["nome"].strip().lower()
            sito_nome_key = (r.get("sito_nome") or "").strip().lower()
            sito_id = created_siti.get(sito_nome_key)

            existing = (
                db.query(Impianto)
                .filter(Impianto.tenant_id == tenant_id, Impianto.nome.ilike(r["nome"].strip()))
                .first()
            )
            if existing:
                created_impianti[nome_key] = existing.id
                stats["impianti_esistenti"] += 1
            else:
                lat = _to_float(r.get("latitude"))
                lon = _to_float(r.get("longitude"))
                impianto = Impianto(
                    nome=r["nome"].strip(),
                    descrizione=r.get("descrizione"),
                    tipologia=r.get("tipologia"),
                    note=r.get("note"),
                    latitude=lat,
                    longitude=lon,
                    sito_id=sito_id,
                    tenant_id=tenant_id,
                )
                db.add(impianto)
                db.flush()
                created_impianti[nome_key] = impianto.id
                stats["impianti_creati"] += 1

        # Recupera anche impianti già esistenti nel DB
        for i in db.query(Impianto).filter(Impianto.tenant_id == tenant_id).all():
            created_impianti.setdefault(i.nome.strip().lower(), i.id)

        # ── ASSET ─────────────────────────────────────────────────────────────────
        for r in asset_rows:
            imp_nome_key = (r.get("impianto_nome") or "").strip().lower()
            impianto_id = created_impianti.get(imp_nome_key)

            asset = Asset(
                nome=r["nome"].strip(),
                area=r["area"].strip(),
                impianto_id=impianto_id,
                codice=r.get("codice"),
                descrizione=r.get("descrizione"),
                note=r.get("note") or "",
                criticita=_normalize_criticita(r.get("criticita")),
                stato=_normalize_stato(r.get("stato")),
                marca=r.get("marca"),
                modello=r.get("modello"),
                matricola=r.get("matricola"),
                numero_serie=r.get("numero_serie"),
                anno_installazione=_to_int(r.get("anno_installazione")),
                anno_produzione=_to_int(r.get("anno_produzione")),
                fornitore=r.get("fornitore"),
                data_acquisto=_to_date(r.get("data_acquisto")),
                data_scadenza_garanzia=_to_date(r.get("data_scadenza_garanzia")),
                posizione_fisica=r.get("posizione_fisica"),
                limitazioni=r.get("limitazioni"),
                weather_constraint=_normalize_weather(r.get("weather_constraint")),
                fermo_on_schedule=_to_bool(r.get("fermo_on_schedule")),
                note_tecniche=r.get("note_tecniche"),
                vincoli_operativi=r.get("vincoli_operativi"),
                vincoli_manutenzione=r.get("vincoli_manutenzione"),
                tenant_id=tenant_id,
            )
            db.add(asset)
            stats["asset_creati"] += 1

        # ── COMMIT ATOMICO UNICO ──────────────────────────────────────────────────
        db.commit()

    except Exception as e:
        db.rollback()
        logger.error('BulkImport rollback: %s', e)
        raise HTTPException(
            status_code=500,
            detail=f'Import fallito e annullato completamente: {str(e)}',
        )

    logger.info(
        "BulkImport: tenant=%d — siti +%d (exist %d), impianti +%d (exist %d), asset +%d",
        tenant_id,
        stats["siti_creati"], stats["siti_esistenti"],
        stats["impianti_creati"], stats["impianti_esistenti"],
        stats["asset_creati"],
    )

    return {
        "success": True,
        "message": (
            f"Import completato: {stats['siti_creati']} siti creati, "
            f"{stats['impianti_creati']} impianti creati, "
            f"{stats['asset_creati']} asset creati."
        ),
        "stats": stats,
    }


# ── Helper di conversione ────────────────────────────────────────────────────

def _to_float(val: Optional[str]) -> Optional[float]:
    if not val:
        return None
    try:
        return float(str(val).replace(",", "."))
    except (ValueError, TypeError):
        return None


def _to_int(val: Optional[str]) -> Optional[int]:
    if not val:
        return None
    try:
        return int(str(val).strip())
    except (ValueError, TypeError):
        return None


def _to_date(val: Optional[str]) -> Optional[date]:
    if not val:
        return None
    for fmt in ("%Y-%m-%d", "%d/%m/%Y", "%d-%m-%Y"):
        try:
            return datetime.strptime(str(val).strip(), fmt).date()
        except ValueError:
            continue
    return None


def _to_bool(val: Optional[str]) -> bool:
    if not val:
        return False
    return str(val).strip().upper() in ("SI", "SÌ", "YES", "1", "TRUE", "VERO")


def _normalize_criticita(val: Optional[str]) -> str:
    v = (val or "media").strip().lower()
    return v if v in ("bassa", "media", "alta") else "media"


def _normalize_stato(val: Optional[str]) -> str:
    v = (val or "service").strip().lower()
    if v in ("operativo", "in servizio", "in_servizio", "service"):
        return "service"
    if v in ("fermo", "fermo prog", "fermo prog.", "fermo programmato", "stopped"):
        return "stopped"
    if v in ("guasto", "fuori servizio", "oos", "out of service", "out_of_service"):
        return "out of service"
    return "service"


WEATHER_VALUES = {"NONE", "NO_RAIN", "NO_WIND", "NO_FROST", "OUTDOOR_ONLY", "INDOOR_ONLY"}

def _normalize_weather(val: Optional[str]) -> Optional[str]:
    if not val:
        return None
    v = str(val).strip().upper()
    return v if v in WEATHER_VALUES else None
