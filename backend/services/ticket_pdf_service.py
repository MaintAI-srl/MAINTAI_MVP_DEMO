"""
Generazione del PDF "Rapportino di Intervento" con firma di accettazione.

Usato sia dalla versione desktop (stampa/download) sia da quella mobile
(firma digitale sul touchscreen + download/condivisione del PDF).

Il layout è indipendente dall'ORM: riceve un dizionario di dati già risolti
(`ticket_data`) e i byte PNG della firma opzionale, così è facilmente testabile.

reportlab è una dipendenza pura-Python, senza binari di sistema, adatta al
deploy su Render. L'immagine della firma è un PNG (inchiostro scuro su sfondo
trasparente) embeddato con `mask='auto'` così resta leggibile su pagina bianca.
"""
from __future__ import annotations

import io
from datetime import datetime, timezone

from reportlab.lib import colors
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.lib.units import mm
from reportlab.lib.utils import ImageReader
from reportlab.platypus import (
    SimpleDocTemplate,
    Paragraph,
    Spacer,
    Table,
    TableStyle,
    HRFlowable,
    Image,
    KeepTogether,
)

# Palette coerente con l'identità MaintAI (blu cobalto industriale)
_COBALT = colors.HexColor("#2563eb")
_INK = colors.HexColor("#111827")
_MUTED = colors.HexColor("#6b7280")
_LINE = colors.HexColor("#e5e7eb")
_SURFACE = colors.HexColor("#f9fafb")


def _fmt_dt(value) -> str:
    """Formatta un datetime/ISO string in gg/mm/aaaa HH:MM (vuoto se assente)."""
    if not value:
        return "—"
    if isinstance(value, str):
        try:
            value = datetime.fromisoformat(value.replace("Z", "+00:00"))
        except ValueError:
            return value
    if isinstance(value, datetime):
        return value.strftime("%d/%m/%Y %H:%M")
    return str(value)


def _styles():
    ss = getSampleStyleSheet()
    styles = {
        "title": ParagraphStyle(
            "mt_title", parent=ss["Title"], fontSize=20, textColor=_INK,
            spaceAfter=2, leading=24,
        ),
        "sub": ParagraphStyle(
            "mt_sub", parent=ss["Normal"], fontSize=9, textColor=_MUTED, leading=12,
        ),
        "section": ParagraphStyle(
            "mt_section", parent=ss["Heading2"], fontSize=11, textColor=_COBALT,
            spaceBefore=14, spaceAfter=6, leading=14,
        ),
        "label": ParagraphStyle(
            "mt_label", parent=ss["Normal"], fontSize=8, textColor=_MUTED,
            leading=10, spaceAfter=1,
        ),
        "value": ParagraphStyle(
            "mt_value", parent=ss["Normal"], fontSize=10, textColor=_INK, leading=13,
        ),
        "body": ParagraphStyle(
            "mt_body", parent=ss["Normal"], fontSize=10, textColor=_INK, leading=15,
        ),
        "foot": ParagraphStyle(
            "mt_foot", parent=ss["Normal"], fontSize=8, textColor=_MUTED, leading=11,
        ),
        "signname": ParagraphStyle(
            "mt_signname", parent=ss["Normal"], fontSize=10, textColor=_INK, leading=13,
        ),
    }
    return styles


def _kv_pair(label: str, value: str, st) -> list:
    """Cella con etichetta piccola + valore, usata nella griglia dettagli."""
    return [
        Paragraph(label.upper(), st["label"]),
        Paragraph(value if value not in (None, "") else "—", st["value"]),
    ]


def build_ticket_report_pdf(ticket_data: dict, firma_png: bytes | None = None) -> bytes:
    """Costruisce il PDF del rapportino e ne restituisce i byte.

    ticket_data: dizionario con le chiavi usate sotto (tutte opzionali salvo id).
    firma_png: byte del PNG della firma cliente, oppure None se non firmato.
    """
    st = _styles()
    buf = io.BytesIO()
    doc = SimpleDocTemplate(
        buf, pagesize=A4,
        leftMargin=18 * mm, rightMargin=18 * mm,
        topMargin=16 * mm, bottomMargin=16 * mm,
        title=f"Rapportino intervento #{ticket_data.get('id', '')}",
        author="MaintAI",
    )

    story: list = []

    azienda = ticket_data.get("azienda") or "MaintAI"
    story.append(Paragraph(azienda, st["title"]))
    story.append(Paragraph(
        f"Rapportino di Intervento · Ticket #{ticket_data.get('id', '—')}", st["sub"]
    ))
    story.append(Spacer(1, 6))
    story.append(HRFlowable(width="100%", thickness=1, color=_LINE))
    story.append(Spacer(1, 4))

    # ── Dettagli intervento (griglia 2 colonne) ──────────────────────────────
    story.append(Paragraph("Dettagli intervento", st["section"]))

    asset_label = ticket_data.get("asset_nome") or "—"
    if ticket_data.get("asset_codice"):
        asset_label = f"{asset_label} ({ticket_data['asset_codice']})"

    rows = [
        (_kv_pair("Titolo", ticket_data.get("titolo", "—"), st),
         _kv_pair("Stato", ticket_data.get("stato", "—"), st)),
        (_kv_pair("Tipo", ticket_data.get("tipo", "—"), st),
         _kv_pair("Priorità", ticket_data.get("priorita", "—"), st)),
        (_kv_pair("Sito", ticket_data.get("sito_name", "—"), st),
         _kv_pair("Impianto", ticket_data.get("impianto_name", "—"), st)),
        (_kv_pair("Asset", asset_label, st),
         _kv_pair("Tecnico", ticket_data.get("tecnico_nome", "—"), st)),
        (_kv_pair("Inizio esecuzione", _fmt_dt(ticket_data.get("execution_start")), st),
         _kv_pair("Fine esecuzione", _fmt_dt(ticket_data.get("execution_finish")), st)),
        (_kv_pair("Durata stimata", (f"{ticket_data['durata_stimata_ore']} h" if ticket_data.get("durata_stimata_ore") is not None else "—"), st),
         _kv_pair("Ore uomo", (f"{ticket_data['required_man_hours']} h" if ticket_data.get("required_man_hours") is not None else "—"), st)),
    ]

    # Ogni "pair" è una lista [label, value]; costruiamo celle multi-paragrafo
    table_data = [[c[0], c[1]] for c in [(a, b) for a, b in rows]]
    # table_data ora è [[cellA, cellB], ...] dove cellX = [Paragraph,Paragraph]
    grid = Table(table_data, colWidths=[87 * mm, 87 * mm])
    grid.setStyle(TableStyle([
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("TOPPADDING", (0, 0), (-1, -1), 5),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 5),
        ("LEFTPADDING", (0, 0), (-1, -1), 8),
        ("RIGHTPADDING", (0, 0), (-1, -1), 8),
        ("BACKGROUND", (0, 0), (-1, -1), _SURFACE),
        ("BOX", (0, 0), (-1, -1), 0.5, _LINE),
        ("INNERGRID", (0, 0), (-1, -1), 0.5, _LINE),
    ]))
    story.append(grid)

    # ── Descrizione / Note ────────────────────────────────────────────────────
    descrizione = (ticket_data.get("descrizione") or "").strip()
    note = (ticket_data.get("note") or "").strip()
    if descrizione:
        story.append(Paragraph("Descrizione", st["section"]))
        story.append(Paragraph(descrizione.replace("\n", "<br/>"), st["body"]))
    if note:
        story.append(Paragraph("Note", st["section"]))
        story.append(Paragraph(note.replace("\n", "<br/>"), st["body"]))

    # ── Ricambi (se presenti) ──────────────────────────────────────────────────
    ricambio_note = (ticket_data.get("ricambio_note") or "").strip()
    if ricambio_note or ticket_data.get("ricambio_quantita") is not None:
        story.append(Paragraph("Ricambi utilizzati", st["section"]))
        qta = ticket_data.get("ricambio_quantita")
        testo = ricambio_note or "—"
        if qta is not None:
            testo = f"{testo} · Quantità: {qta}"
        story.append(Paragraph(testo, st["body"]))

    # ── Firma di accettazione ──────────────────────────────────────────────────
    sign_flowables: list = [Paragraph("Firma di accettazione del cliente", st["section"])]

    if firma_png:
        try:
            img_reader = ImageReader(io.BytesIO(firma_png))
            iw, ih = img_reader.getSize()
            # Scala mantenendo le proporzioni entro un box massimo
            max_w, max_h = 70 * mm, 28 * mm
            ratio = min(max_w / iw, max_h / ih) if iw and ih else 1
            img = Image(io.BytesIO(firma_png), width=iw * ratio, height=ih * ratio)
            img.hAlign = "LEFT"
            sign_flowables.append(img)
        except Exception:
            sign_flowables.append(Paragraph("(firma non disponibile)", st["sub"]))
        sign_flowables.append(HRFlowable(width=70 * mm, thickness=0.5, color=_INK))
        firmatario = ticket_data.get("firma_nome") or "Cliente"
        sign_flowables.append(Paragraph(f"<b>{firmatario}</b>", st["signname"]))
        if ticket_data.get("firma_data"):
            sign_flowables.append(
                Paragraph(f"Firmato il {_fmt_dt(ticket_data.get('firma_data'))}", st["sub"])
            )
    else:
        sign_flowables.append(Spacer(1, 26 * mm))
        sign_flowables.append(HRFlowable(width=70 * mm, thickness=0.5, color=_INK))
        sign_flowables.append(Paragraph("Firma del cliente", st["sub"]))

    story.append(KeepTogether(sign_flowables))

    # ── Footer ──────────────────────────────────────────────────────────────
    story.append(Spacer(1, 10))
    story.append(HRFlowable(width="100%", thickness=0.5, color=_LINE))
    generato = datetime.now(timezone.utc).astimezone().strftime("%d/%m/%Y %H:%M")
    story.append(Paragraph(
        f"Documento generato da MaintAI · {generato}", st["foot"]
    ))

    doc.build(story)
    return buf.getvalue()
