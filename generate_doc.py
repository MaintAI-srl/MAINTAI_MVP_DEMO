#!/usr/bin/env python3
"""Generate MaintAI Architecture Word document."""

from docx import Document
from docx.shared import Inches, Pt, RGBColor, Cm
from docx.enum.text import WD_ALIGN_PARAGRAPH
from docx.enum.table import WD_TABLE_ALIGNMENT, WD_ALIGN_VERTICAL
from docx.oxml.ns import qn
from docx.oxml import OxmlElement
import copy

# ── colour palette ──────────────────────────────────────────────────────────
DARK_BLUE   = RGBColor(0x0D, 0x1B, 0x3E)   # header / title bg
MID_BLUE    = RGBColor(0x1E, 0x40, 0x8F)   # section header
ACCENT_CYAN = RGBColor(0x00, 0xB4, 0xD8)   # highlight
LIGHT_GRAY  = RGBColor(0xF2, 0xF4, 0xF8)   # table alt row
WHITE       = RGBColor(0xFF, 0xFF, 0xFF)
TEXT_DARK   = RGBColor(0x1A, 0x1A, 0x2E)
GREEN_OK    = RGBColor(0x15, 0x80, 0x3D)
RED_ALERT   = RGBColor(0xDC, 0x26, 0x26)
ORANGE      = RGBColor(0xEA, 0x58, 0x0C)

# ── helpers ──────────────────────────────────────────────────────────────────

def set_cell_bg(cell, rgb: RGBColor):
    tc = cell._tc
    tcPr = tc.get_or_add_tcPr()
    shd = OxmlElement('w:shd')
    hex_color = f"{rgb.red:02X}{rgb.green:02X}{rgb.blue:02X}"
    shd.set(qn('w:val'), 'clear')
    shd.set(qn('w:color'), 'auto')
    shd.set(qn('w:fill'), hex_color)
    tcPr.append(shd)


def set_cell_border(cell, **kwargs):
    tc = cell._tc
    tcPr = tc.get_or_add_tcPr()
    tcBorders = OxmlElement('w:tcBorders')
    for edge in ('top', 'left', 'bottom', 'right'):
        tag = OxmlElement(f'w:{edge}')
        tag.set(qn('w:val'), kwargs.get('val', 'single'))
        tag.set(qn('w:sz'), kwargs.get('sz', '6'))
        tag.set(qn('w:space'), '0')
        tag.set(qn('w:color'), kwargs.get('color', 'FFFFFF'))
        tcBorders.append(tag)
    tcPr.append(tcBorders)


def cell_text(cell, text, bold=False, color=None, size=10, align=WD_ALIGN_PARAGRAPH.LEFT):
    para = cell.paragraphs[0]
    para.alignment = align
    run = para.add_run(text)
    run.bold = bold
    run.font.size = Pt(size)
    if color:
        run.font.color.rgb = color


def heading(doc, text, level=1):
    """Styled heading."""
    para = doc.add_paragraph()
    para.paragraph_format.space_before = Pt(18 if level == 1 else 12)
    para.paragraph_format.space_after = Pt(6)
    run = para.add_run(text)
    run.bold = True
    if level == 1:
        run.font.size = Pt(16)
        run.font.color.rgb = MID_BLUE
    elif level == 2:
        run.font.size = Pt(13)
        run.font.color.rgb = DARK_BLUE
    else:
        run.font.size = Pt(11)
        run.font.color.rgb = MID_BLUE
    # underline for h1
    if level == 1:
        run.font.underline = True
    return para


def body(doc, text, bold=False, color=None, indent=False):
    para = doc.add_paragraph()
    para.paragraph_format.space_after = Pt(4)
    if indent:
        para.paragraph_format.left_indent = Inches(0.25)
    run = para.add_run(text)
    run.font.size = Pt(10)
    run.bold = bold
    if color:
        run.font.color.rgb = color
    return para


def bullet(doc, text, level=0):
    para = doc.add_paragraph(style='List Bullet')
    para.paragraph_format.left_indent = Inches(0.25 * (level + 1))
    para.paragraph_format.space_after = Pt(2)
    run = para.add_run(text)
    run.font.size = Pt(10)
    return para


def code_block(doc, text):
    para = doc.add_paragraph()
    para.paragraph_format.left_indent = Inches(0.3)
    para.paragraph_format.space_before = Pt(2)
    para.paragraph_format.space_after = Pt(2)
    run = para.add_run(text)
    run.font.name = 'Courier New'
    run.font.size = Pt(9)
    run.font.color.rgb = RGBColor(0x2D, 0x6A, 0x4F)
    return para


def divider(doc):
    para = doc.add_paragraph()
    para.paragraph_format.space_before = Pt(2)
    para.paragraph_format.space_after = Pt(2)
    pPr = para._p.get_or_add_pPr()
    pBdr = OxmlElement('w:pBdr')
    bottom = OxmlElement('w:bottom')
    bottom.set(qn('w:val'), 'single')
    bottom.set(qn('w:sz'), '6')
    bottom.set(qn('w:space'), '1')
    bottom.set(qn('w:color'), '1E408F')
    pBdr.append(bottom)
    pPr.append(pBdr)


def add_header_banner(doc, title, subtitle):
    """Full-width dark blue banner at the top."""
    table = doc.add_table(rows=1, cols=1)
    table.alignment = WD_TABLE_ALIGNMENT.CENTER
    cell = table.cell(0, 0)
    set_cell_bg(cell, DARK_BLUE)
    cell.width = Inches(6.5)
    para = cell.paragraphs[0]
    para.alignment = WD_ALIGN_PARAGRAPH.CENTER
    para.paragraph_format.space_before = Pt(14)
    para.paragraph_format.space_after = Pt(4)
    r1 = para.add_run(title + '\n')
    r1.bold = True
    r1.font.size = Pt(22)
    r1.font.color.rgb = WHITE
    r2 = para.add_run(subtitle)
    r2.font.size = Pt(11)
    r2.font.color.rgb = ACCENT_CYAN
    doc.add_paragraph()  # spacing after banner


def add_info_box(doc, label, value, bg=LIGHT_GRAY):
    """Key-value info box (single row 2-col table)."""
    table = doc.add_table(rows=1, cols=2)
    table.alignment = WD_TABLE_ALIGNMENT.LEFT
    lc = table.cell(0, 0)
    vc = table.cell(0, 1)
    lc.width = Inches(1.8)
    vc.width = Inches(4.7)
    set_cell_bg(lc, MID_BLUE)
    set_cell_bg(vc, bg)
    cell_text(lc, label, bold=True, color=WHITE, size=9)
    cell_text(vc, value, size=9)
    doc.add_paragraph()


def styled_table(doc, headers, rows, col_widths=None):
    """Create a styled table with dark header row and alternating rows."""
    n_cols = len(headers)
    table = doc.add_table(rows=1 + len(rows), cols=n_cols)
    table.alignment = WD_TABLE_ALIGNMENT.LEFT
    table.style = 'Table Grid'

    # header
    hdr_row = table.rows[0]
    for i, h in enumerate(headers):
        cell = hdr_row.cells[i]
        set_cell_bg(cell, DARK_BLUE)
        cell_text(cell, h, bold=True, color=WHITE, size=9, align=WD_ALIGN_PARAGRAPH.CENTER)
        if col_widths:
            cell.width = Inches(col_widths[i])

    # data rows
    for ri, row_data in enumerate(rows):
        bg = LIGHT_GRAY if ri % 2 == 0 else WHITE
        for ci, val in enumerate(row_data):
            cell = table.rows[ri + 1].cells[ci]
            set_cell_bg(cell, bg)
            bold = ci == 0
            cell_text(cell, str(val), bold=bold, size=9)
            if col_widths:
                cell.width = Inches(col_widths[ci])

    doc.add_paragraph()
    return table


def ascii_diagram(doc, lines, title=None):
    """Render an ASCII architecture diagram as monospace block."""
    if title:
        p = doc.add_paragraph()
        r = p.add_run(title)
        r.bold = True
        r.font.size = Pt(10)
        r.font.color.rgb = MID_BLUE
    table = doc.add_table(rows=1, cols=1)
    table.alignment = WD_TABLE_ALIGNMENT.CENTER
    cell = table.cell(0, 0)
    set_cell_bg(cell, RGBColor(0xF8, 0xFA, 0xFC))
    para = cell.paragraphs[0]
    para.paragraph_format.space_before = Pt(6)
    para.paragraph_format.space_after = Pt(6)
    run = para.add_run('\n'.join(lines))
    run.font.name = 'Courier New'
    run.font.size = Pt(8)
    run.font.color.rgb = DARK_BLUE
    doc.add_paragraph()


# ── MAIN DOCUMENT ─────────────────────────────────────────────────────────────

doc = Document()

# Page margins
section = doc.sections[0]
section.left_margin   = Inches(1.0)
section.right_margin  = Inches(1.0)
section.top_margin    = Inches(0.8)
section.bottom_margin = Inches(0.8)

# ── COVER ────────────────────────────────────────────────────────────────────
add_header_banner(
    doc,
    "MaintAI — Documento di Architettura Tecnica",
    "Versione 3.3.1  |  Giugno 2026  |  Uso interno IT"
)

meta_rows = [
    ("Prodotto",       "MaintAI — Sistema di Gestione Manutenzione Industriale AI-Powered"),
    ("Versione",       "3.3.1 (2026-05-31)"),
    ("Audience",       "Team IT, DevOps, Security Officer"),
    ("Classificazione","Interno — non distribuire"),
    ("Autore",         "Generato da Claude Code — Anthropic"),
    ("Data",           "06 Giugno 2026"),
]
for label, value in meta_rows:
    add_info_box(doc, label, value)

doc.add_paragraph()
divider(doc)

# ── INDICE ───────────────────────────────────────────────────────────────────
heading(doc, "INDICE", 2)
toc_items = [
    "1. Panoramica del sistema",
    "2. Stack tecnologico",
    "3. Architettura applicativa (diagramma a livelli)",
    "4. Frontend — Next.js 15",
    "5. Backend — FastAPI",
    "6. Database e persistenza",
    "7. Multi-Tenancy",
    "8. Autenticazione e autorizzazione (JWT)",
    "9. Sicurezza — OWASP Top 10 e misure adottate",
    "10. Piano AI Felix — motore di pianificazione",
    "11. Integrazioni esterne",
    "12. Deploy e infrastruttura",
    "13. Variabili d'ambiente",
    "14. Modelli dati principali",
    "15. Logging e osservabilità",
]
for item in toc_items:
    bullet(doc, item)

doc.add_page_break()

# ═══════════════════════════════════════════════════════════════════════════════
# 1. PANORAMICA
# ═══════════════════════════════════════════════════════════════════════════════
heading(doc, "1. Panoramica del Sistema")
body(doc,
     "MaintAI è una piattaforma SaaS multi-tenant per la gestione della manutenzione industriale "
     "(impianti manifatturieri, energetici, portuali). Combina un motore di pianificazione "
     "deterministico con un layer di intelligenza artificiale (OpenAI GPT-4.1) per ottimizzare "
     "la schedulazione degli interventi tecnici, la diagnosi guasti e l'estrazione automatica di "
     "piani di manutenzione da manuali PDF.")

body(doc, "Utenti principali:", bold=True)
bullet(doc, "Responsabile Manutenzione / Planner — pianifica, coordina, visione globale KPI")
bullet(doc, "Tecnico sul campo — riceve piano, esegue interventi, usa AI per diagnosi guasti")
bullet(doc, "SuperAdmin — gestione multi-tenant, configurazione sistema")

doc.add_paragraph()
body(doc, "Funzionalità core:", bold=True)
features = [
    "Gestione gerarchica: Siti → Impianti → Asset con dati tecnici completi",
    "Ticket con 5 stati (Aperto / Pianificato / In corso / Chiuso / Eliminato)",
    "Piano AI Felix — motore deterministico + GPT opzionale, viste Gantt/Kanban/Calendario",
    "Sessione diagnostica AI guidata (RCA interattiva via OpenAI)",
    "Caricamento manuali PDF → estrazione automatica piano manutenzione",
    "Dashboard KPI in tempo reale (polling ogni 30s) con grafici Recharts",
    "Kanban board ticket drag-and-drop (@dnd-kit)",
    "Email-to-Ticket via polling IMAP (ogni 5 minuti)",
    "Gestione tecnici con assenze e orari di lavoro",
    "Log di sistema persistenti in DB (SystemLog)",
]
for f in features:
    bullet(doc, f)

divider(doc)

# ═══════════════════════════════════════════════════════════════════════════════
# 2. STACK TECNOLOGICO
# ═══════════════════════════════════════════════════════════════════════════════
heading(doc, "2. Stack Tecnologico")

styled_table(doc,
    headers=["Livello", "Tecnologia", "Versione", "Note"],
    rows=[
        ("Frontend",         "Next.js (App Router)",    "15.x",          "TypeScript, React 19"),
        ("UI / Stili",       "Tailwind CSS v4 + shadcn/ui", "4.x",      "Design system dark industrial"),
        ("Grafici",          "Recharts",                "2.x",           "Dashboard KPI"),
        ("Drag & Drop",      "@dnd-kit",                "6.x",           "Kanban board"),
        ("Toast / Notify",   "Sonner",                  "1.x",           "Notifiche UI"),
        ("Backend",          "FastAPI",                 "0.115.x",       "Python 3.12"),
        ("ORM",              "SQLAlchemy",              "2.x",           "Async-ready, multi-DB"),
        ("Migrations",       "Alembic",                 "1.x",           "batch_alter per SQLite"),
        ("Validazione",      "Pydantic v2",             "2.x",           "Schema request/response"),
        ("Rate Limiting",    "SlowAPI",                 "0.1.x",         "Wrapper slowapi su Starlette"),
        ("AI / LLM",         "OpenAI API",              "gpt-4.1 / mini","Pianificazione + diagnosi"),
        ("DB locale",        "SQLite",                  "3.x",           "Dev + ambiente demo"),
        ("DB cloud",         "PostgreSQL",              "15.x",          "Render managed"),
        ("Deploy frontend",  "Vercel",                  "—",             "Edge network globale"),
        ("Deploy backend",   "Render",                  "—",             "Container web service"),
        ("Meteo",            "Open-Meteo API",          "—",             "Vincoli meteo asset outdoor"),
        ("Email polling",    "IMAP (imaplib Python)",   "—",             "Email → Ticket automatico"),
    ],
    col_widths=[1.3, 1.7, 1.0, 2.5]
)

divider(doc)

# ═══════════════════════════════════════════════════════════════════════════════
# 3. ARCHITETTURA A LIVELLI
# ═══════════════════════════════════════════════════════════════════════════════
heading(doc, "3. Architettura Applicativa — Diagramma a Livelli")

ascii_diagram(doc, [
    "┌──────────────────────────────────────────────────────────────────┐",
    "│                    BROWSER / MOBILE CLIENT                       │",
    "│              Next.js 15  (Vercel — Edge CDN globale)             │",
    "│  ┌────────────┐  ┌───────────────┐  ┌────────────────────────┐  │",
    "│  │  App Pages │  │  Components   │  │  Auth Context (JWT)    │  │",
    "│  │ (App Router│  │ Kanban, Gantt │  │  useAuth hook          │  │",
    "│  │  SSR/CSR)  │  │ Calendar, KPI │  │  api.ts fetch client   │  │",
    "│  └────────────┘  └───────────────┘  └────────────────────────┘  │",
    "└───────────────────────────┬──────────────────────────────────────┘",
    "                            │  HTTPS/REST  (JWT Bearer Token)",
    "                            │  timeout: 30s standard / 120s AI",
    "┌───────────────────────────▼──────────────────────────────────────┐",
    "│                     BACKEND API LAYER                            │",
    "│              FastAPI  (Render — Python 3.12)                     │",
    "│  ┌──────────────────────────────────────────────────────────┐   │",
    "│  │  20 Router modules  (api/routes/*)                       │   │",
    "│  │  Auth/JWT │ Tickets │ Planning │ Assets │ Tecnici │ ...  │   │",
    "│  └──────────────────────────────────────────────────────────┘   │",
    "│  ┌─────────────────────┐  ┌────────────────────────────────┐    │",
    "│  │   Services Layer     │  │   Core Utilities               │    │",
    "│  │  planner_engine.py  │  │  security.py  (JWT decode)     │    │",
    "│  │  ai_planner_service │  │  dependencies.py (DB routing)  │    │",
    "│  │  pdf_service.py     │  │  logger_db.py (SystemLog)      │    │",
    "│  │  email_poller.py    │  │  rate_limiter.py (SlowAPI)     │    │",
    "│  │  weather_service.py │  │  storage.py  (Supabase)        │    │",
    "│  └─────────────────────┘  └────────────────────────────────┘   │",
    "└──────┬──────────────────────────────┬────────────────────────────┘",
    "       │                              │",
    "┌──────▼──────────┐        ┌──────────▼──────────────────────────┐",
    "│  PostgreSQL      │        │  API Esterne                        │",
    "│  (Render cloud)  │        │  OpenAI GPT-4.1 / GPT-4.1-mini     │",
    "│  — Produzione    │        │  Open-Meteo (previsioni meteo)      │",
    "│                  │        │  IMAP Server (email polling)        │",
    "│  SQLite          │        └─────────────────────────────────────┘",
    "│  — Dev / Demo    │",
    "└──────────────────┘",
], title="Figura 1 — Architettura a livelli MaintAI")

divider(doc)

# ═══════════════════════════════════════════════════════════════════════════════
# 4. FRONTEND
# ═══════════════════════════════════════════════════════════════════════════════
heading(doc, "4. Frontend — Next.js 15")

body(doc,
     "Il frontend è una Single Page Application con rendering ibrido (SSR + CSR) basata su "
     "Next.js 15 App Router. Viene deployato su Vercel con edge network globale.")

heading(doc, "4.1 Struttura directory frontend", 3)
code_block(doc, "frontend/app/")
code_block(doc, "  layout.tsx           — shell: sidebar, topbar, theme toggle")
code_block(doc, "  lib/")
code_block(doc, "    api.ts             — fetch client JWT, timeout adattivo, retry")
code_block(doc, "    auth.tsx           — AuthContext, useAuth hook")
code_block(doc, "    toast.ts           — notify.error/success/info/warning")
code_block(doc, "    version.ts         — VERSION corrente app")
code_block(doc, "  globals.css          — design system CSS custom properties")
code_block(doc, "  components/          — componenti riutilizzabili")
code_block(doc, "    ui/                — shadcn/ui (button, badge, card, dialog...)")
code_block(doc, "    KanbanBoard.tsx    — drag-and-drop @dnd-kit")
code_block(doc, "    StatusToggle.tsx   — toggle stati ticket inline")
code_block(doc, "  dashboard/           — KPI e grafici Recharts")
code_block(doc, "  ticket/              — tabella paginata, modal dettaglio, kanban")
code_block(doc, "  planning/            — Piano AI Felix (Gantt, Kanban, Calendario)")
code_block(doc, "  asset/ / assets/     — dettaglio e lista asset con filtri")
code_block(doc, "  tecnici/             — anagrafica + assenze")
code_block(doc, "  manuali/             — upload PDF + lista piani estratti")
code_block(doc, "  admin/               — logs, email, tenants (solo superadmin)")

heading(doc, "4.2 Design System", 3)
styled_table(doc,
    headers=["Token CSS", "Valore", "Uso"],
    rows=[
        ("background principale", "#0a0f1e",    "Dark industrial — sfondo pagina"),
        ("card surface",          "#111827",    "Pannelli e card"),
        ("elevated surface",      "#1f2937",    "Dropdown, modal elevated"),
        ("BD (Breakdown)",        "#ef4444 (rosso)", "Badge e highlight ticket BD"),
        ("PM (Preventiva)",       "#22c55e (verde)", "Badge ticket PM"),
        ("CM (Correttiva)",       "#f59e0b (ambra)", "Badge ticket CM"),
        ("accent principale",     "#00B4D8 (cyan)", "Link attivi, highlight"),
    ],
    col_widths=[2.0, 1.8, 2.7]
)

heading(doc, "4.3 Comunicazione con il backend", 3)
body(doc, "Tutto il traffico passa attraverso il client fetch centralizzato in api.ts:")
bullet(doc, "Header Authorization: Bearer <JWT> aggiunto automaticamente")
bullet(doc, "Timeout default: 30 secondi per API standard")
bullet(doc, "Timeout esteso: 120 secondi per endpoint AI (planning/generate, diagnostic)")
bullet(doc, "Gestione retry semantico per errori di rete")
bullet(doc, "La base URL è configurata via NEXT_PUBLIC_API_BASE (variabile Vercel)")

divider(doc)

# ═══════════════════════════════════════════════════════════════════════════════
# 5. BACKEND
# ═══════════════════════════════════════════════════════════════════════════════
heading(doc, "5. Backend — FastAPI")

body(doc,
     "Il backend è un'applicazione FastAPI (Python 3.12) organizzata in moduli per dominio. "
     "All'avvio esegue automaticamente le migration Alembic, inizializza il DB e avvia "
     "il poller email in background.")

heading(doc, "5.1 Struttura directory backend", 3)
code_block(doc, "backend/")
code_block(doc, "  main.py                — bootstrap: Alembic, init_db, email poller, 20 router")
code_block(doc, "  core/")
code_block(doc, "    config.py            — VERSION, OPENAI_API_KEY, init_backend()")
code_block(doc, "    database.py          — engine, SessionLocal, DATABASE_URL / DEMO_DATABASE_URL")
code_block(doc, "    dependencies.py      — get_db (routing demo vs prod)")
code_block(doc, "    security.py          — JWT decode, get_current_tenant_id, require_superadmin")
code_block(doc, "    logger_db.py         — log_to_db(), db_info(), db_error() → SystemLog")
code_block(doc, "    logging_config.py    — setup logging standard Python")
code_block(doc, "    exceptions.py        — AppError, handler FastAPI globale")
code_block(doc, "    rate_limiter.py      — SlowAPI limiter instance")
code_block(doc, "    storage.py           — Supabase bucket (file allegati)")
code_block(doc, "  db/")
code_block(doc, "    modelli.py           — TUTTI i modelli ORM in file unico")
code_block(doc, "  api/routes/            — 20 moduli router (un dominio per file)")
code_block(doc, "  services/")
code_block(doc, "    planner_engine.py    — motore deterministico puro (dataclass, no ORM)")
code_block(doc, "    planner_engine_bridge.py — adattatore ORM → PlannerEngine → plan_json")
code_block(doc, "    ai_planner_service.py    — motore GPT Felix + efficiency score")
code_block(doc, "    weather_service.py       — Open-Meteo API, WeatherData")
code_block(doc, "    email_poller.py          — IMAP polling ogni 5 min → crea Ticket")
code_block(doc, "    pdf_service.py           — parsing PDF manuali")
code_block(doc, "    ticket_service.py        — logica business ticket")
code_block(doc, "  tests/")
code_block(doc, "    test_planner_engine.py   — test unitari PlannerEngine (pytest)")

heading(doc, "5.2 Router FastAPI — 20 moduli", 3)
styled_table(doc,
    headers=["Modulo router", "Prefisso URL", "Funzione principale"],
    rows=[
        ("auth",           "/auth",         "Login, refresh token, profilo utente"),
        ("tickets",        "/tickets",      "CRUD ticket, cambio stato, allegati, export Excel"),
        ("planning",       "/planning",     "Generate piano, conferma, storico, deautorizzazione"),
        ("assets",         "/assets",       "CRUD asset, dati tecnici, storico guasti"),
        ("siti",           "/siti",         "CRUD siti geografici"),
        ("impianti",       "/impianti",     "CRUD impianti (figli di siti)"),
        ("tecnici",        "/tecnici",      "CRUD tecnici, competenze, assenze, orari"),
        ("manuali",        "/manuali",      "Upload PDF, gestione manuali"),
        ("piani",          "/piani",        "Piani manutenzione estratti da PDF"),
        ("diagnostic",     "/diagnostic",   "Sessioni diagnostica AI interattiva (RCA)"),
        ("dashboard",      "/dashboard",    "KPI aggregati, metriche real-time"),
        ("log",            "/log",          "Lettura SystemLog (admin)"),
        ("admin/tenants",  "/admin/tenants","Gestione tenant (solo superadmin)"),
        ("admin/email",    "/admin/email",  "Configurazione IMAP per tenant"),
        ("users",          "/users",        "Gestione utenti del tenant"),
        ("allegati",       "/allegati",     "Download file allegati ticket"),
        ("analisi",        "/analisi",      "Analisi guasto AI su asset"),
        ("notifiche",      "/notifiche",    "Notifiche in-app per utente"),
        ("qr",             "/qr",           "Endpoint pubblico QR code asset (no auth)"),
        ("health",         "/health",       "Health check, versione, stato sistema"),
    ],
    col_widths=[1.5, 1.5, 3.5]
)

divider(doc)

# ═══════════════════════════════════════════════════════════════════════════════
# 6. DATABASE
# ═══════════════════════════════════════════════════════════════════════════════
heading(doc, "6. Database e Persistenza")

body(doc,
     "MaintAI usa due database in parallelo secondo l'ambiente di esecuzione:")

styled_table(doc,
    headers=["Ambiente", "Database", "URL / Path", "Note"],
    rows=[
        ("Produzione cloud", "PostgreSQL 15", "Render managed DB", "Multi-tenant, alta disponibilità"),
        ("Demo / Sandbox",   "SQLite 3",      "demo.db (locale)",  "Utenti demo isolati, reset facile"),
        ("Sviluppo locale",  "SQLite 3",      "maintai.db",        "Dev rapido, no infra"),
    ],
    col_widths=[1.6, 1.5, 2.0, 1.9]
)

heading(doc, "6.1 Routing automatico del DB", 3)
body(doc,
     "La funzione get_db() in backend/core/dependencies.py analizza il JWT dell'utente "
     "alla ricezione di ogni richiesta:")
bullet(doc, "Se il token contiene is_demo=True → connessione a SQLite demo.db")
bullet(doc, "Altrimenti → connessione a PostgreSQL produzione")
body(doc, "Questo permette utenti demo completamente isolati senza modifiche al codice dei router.")

heading(doc, "6.2 Modelli ORM principali", 3)
styled_table(doc,
    headers=["Modello ORM", "Tabella DB", "Relazioni principali"],
    rows=[
        ("Tenant",               "tenants",               "1:N con tutti gli altri modelli"),
        ("Utente",               "utenti",                "N:1 Tenant, ruolo: admin/tecnico/viewer"),
        ("Sito",                 "siti",                  "N:1 Tenant, 1:N Impianti"),
        ("Impianto",             "impianti",              "N:1 Sito, 1:N Asset"),
        ("Asset",                "assets",                "N:1 Impianto, 1:N Ticket"),
        ("Tecnico",              "tecnici",               "N:1 Tenant, 1:N TecnicoAssenza"),
        ("Ticket",               "tickets",               "N:1 Asset, N:1 Tecnico, 1:N Allegati"),
        ("Manuale",              "manuali",               "N:1 Tenant, 1:N AttivitaManutenzione"),
        ("AttivitaManutenzione", "attivita_manutenzione", "N:1 Manuale"),
        ("AnalisiGuasto",        "analisi_guasto",        "N:1 Asset"),
        ("DiagnosticSession",    "diagnostic_sessions",   "N:1 Tenant, history JSON"),
        ("TecnicoAssenza",       "tecnico_assenze",       "N:1 Tecnico"),
        ("TicketAllegato",       "ticket_allegati",       "N:1 Ticket, path Supabase"),
        ("EmailConfig",          "email_configs",         "1:1 Tenant (config IMAP)"),
        ("SystemLog",            "system_logs",           "N:1 Tenant, livello/messaggio/timestamp"),
        ("GeneratedPlan",        "generated_plans",       "N:1 Tenant, plan_json, status"),
    ],
    col_widths=[2.0, 2.0, 2.5]
)

heading(doc, "6.3 Migrazioni Alembic", 3)
bullet(doc, "Ogni deploy esegue automaticamente alembic upgrade head all'avvio del backend")
bullet(doc, "Configurato con batch_alter_table per compatibilità SQLite (offline mode)")
bullet(doc, "La funzione _ensure_columns() in main.py è un fallback DDL idempotente per cloud deploy")
bullet(doc, "Le migration sono in backend/alembic/versions/")

divider(doc)

# ═══════════════════════════════════════════════════════════════════════════════
# 7. MULTI-TENANCY
# ═══════════════════════════════════════════════════════════════════════════════
heading(doc, "7. Multi-Tenancy")

body(doc,
     "MaintAI adotta un approccio shared-database / shared-schema con isolamento via tenant_id. "
     "Ogni tabella contiene una colonna tenant_id (FK → tenants.id) e ogni query filtra "
     "obbligatoriamente per tenant_id estratto dal JWT.")

ascii_diagram(doc, [
    "  JWT Token decodificato",
    "  ┌─────────────────────────────────────────┐",
    "  │  sub: 'username'                        │",
    "  │  tenant_id: 42          ◄── CHIAVE      │",
    "  │  ruolo: 'admin'                         │",
    "  │  is_demo: false                         │",
    "  │  exp: 1748900000                        │",
    "  └──────────────────┬──────────────────────┘",
    "                     │",
    "                     ▼  get_current_tenant_id()",
    "  ┌──────────────────────────────────────────────────────┐",
    "  │  Query ORM                                           │",
    "  │  db.query(Ticket)                                    │",
    "  │    .filter(Ticket.tenant_id == tenant_id)  ◄── OBBLIGATORIO",
    "  │    .filter(Ticket.id == ticket_id)                   │",
    "  │    .first()                                          │",
    "  └──────────────────────────────────────────────────────┘",
], title="Figura 2 — Isolamento dati multi-tenant via JWT")

body(doc, "Regole di isolamento:", bold=True)
bullet(doc, "Ogni route FastAPI estrae tenant_id dal JWT via Depends(get_current_tenant_id)")
bullet(doc, "Il SuperAdmin può impersonare un tenant tramite header X-Tenant-Id")
bullet(doc, "La funzione check_tenant_ownership() verifica che una risorsa appartenga al tenant corrente")
bullet(doc, "Il routing al DB demo/prod avviene in get_db() prima ancora di raggiungere i router")

styled_table(doc,
    headers=["Ruolo JWT", "Accesso", "Restrizioni"],
    rows=[
        ("superadmin", "Tutti i tenant", "Può usare X-Tenant-Id per impersonare"),
        ("admin",      "Solo tenant JWT", "CRUD completo sulle risorse del proprio tenant"),
        ("tecnico",    "Solo tenant JWT", "Sola lettura su planning; esecuzione ticket assegnati"),
        ("viewer",     "Solo tenant JWT", "Sola lettura su tutto"),
    ],
    col_widths=[1.3, 1.7, 3.5]
)

divider(doc)

# ═══════════════════════════════════════════════════════════════════════════════
# 8. AUTENTICAZIONE E AUTORIZZAZIONE
# ═══════════════════════════════════════════════════════════════════════════════
heading(doc, "8. Autenticazione e Autorizzazione (JWT)")

body(doc,
     "MaintAI usa JSON Web Token (JWT) firmati con HS256. Il token viene emesso "
     "dal backend al login e trasportato dal frontend nell'header HTTP "
     "Authorization: Bearer <token> su ogni richiesta.")

heading(doc, "8.1 Flusso di autenticazione", 3)
ascii_diagram(doc, [
    "  Browser                    FastAPI /auth/login",
    "     │                              │",
    "     │── POST /auth/login ─────────►│",
    "     │   {username, password}       │",
    "     │                              │── verifica hash bcrypt in DB",
    "     │                              │── genera JWT (HS256, exp 8h)",
    "     │◄── {access_token: '...'} ───│",
    "     │                              │",
    "     │── GET /tickets  ────────────►│",
    "     │   Authorization: Bearer <JWT>│",
    "     │                              │── decode JWT (security.py)",
    "     │                              │── estrae tenant_id, ruolo",
    "     │                              │── query filtrata per tenant_id",
    "     │◄── [{...ticket data...}] ───│",
], title="Figura 3 — Flusso autenticazione JWT")

heading(doc, "8.2 Dipendenze FastAPI", 3)
styled_table(doc,
    headers=["Dipendenza", "File", "Funzione"],
    rows=[
        ("get_current_user_payload", "core/security.py", "Decodifica JWT, ritorna payload completo"),
        ("get_current_tenant_id",   "core/security.py", "Estrae e valida tenant_id dal payload"),
        ("require_superadmin",      "core/security.py", "Blocca se ruolo != superadmin (HTTP 403)"),
        ("get_db",                  "core/dependencies.py", "Ritorna sessione DB corretta (demo o prod)"),
    ],
    col_widths=[2.2, 2.0, 2.3]
)

body(doc, "Tutti gli endpoint (eccetto /health e /qr/<uuid>) richiedono un JWT valido. "
     "Il token scade dopo 8 ore; il frontend gestisce il refresh tramite il flow login.")

divider(doc)

# ═══════════════════════════════════════════════════════════════════════════════
# 9. SICUREZZA
# ═══════════════════════════════════════════════════════════════════════════════
heading(doc, "9. Sicurezza — OWASP Top 10 e Misure Adottate")

body(doc,
     "Il progetto segue le linee guida OWASP Top 10, adattate allo stack FastAPI/SQLAlchemy/JWT. "
     "La documentazione di riferimento è in docs/SECURITY_GUIDELINES.md e "
     "docs/SECURITY_GUIDELINES_MAINTAI.md. L'ultimo audit è docs/SECURITY_AUDIT_2026-05-30.md.")

styled_table(doc,
    headers=["OWASP Top 10", "Rischio", "Misura adottata in MaintAI"],
    rows=[
        ("A01 — Broken Access Control",
         "Alta",
         "tenant_id obbligatorio su ogni query; check_tenant_ownership(); require_superadmin"),
        ("A02 — Cryptographic Failures",
         "Alta",
         "Password hash bcrypt; JWT HS256; cifratura at-rest Fernet (encrypt_data/decrypt_data)"),
        ("A03 — Injection",
         "Alta",
         "ORM SQLAlchemy con parametri bind (no raw SQL); validazione Pydantic v2 su tutti gli input"),
        ("A04 — Insecure Design",
         "Media",
         "Separazione services layer; nessun dato tenant cross-query; DB routing per isolamento demo"),
        ("A05 — Security Misconfiguration",
         "Media",
         "CORS origins lista bianca; header sicurezza FastAPI; env vars mai in codice sorgente"),
        ("A06 — Vulnerable Components",
         "Media",
         "Dipendenze pinned in requirements.txt; aggiornamenti regolari"),
        ("A07 — Auth Failures",
         "Alta",
         "JWT con exp; rate limiting /auth/login (SlowAPI); password min 8 char; no token in URL"),
        ("A08 — Software Integrity",
         "Bassa",
         "Deploy da branch main protetto; build Vercel + Render da repo controllato"),
        ("A09 — Logging Failures",
         "Media",
         "SystemLog persistente in DB; Python logging standard; log_to_db() su ogni operazione critica"),
        ("A10 — SSRF",
         "Media",
         "Open-Meteo e OpenAI chiamati solo da backend; nessun redirect URL utente verso rete interna"),
    ],
    col_widths=[2.2, 0.8, 3.5]
)

heading(doc, "9.1 Rate Limiting", 3)
body(doc,
     "SlowAPI (wrapper su Starlette) è configurato in backend/core/rate_limiter.py. "
     "Ogni endpoint sensibile usa il decorator @limiter.limit('N/periodo'):")
bullet(doc, "POST /auth/login → 10 richieste / minuto per IP")
bullet(doc, "POST /planning/generate → 5 richieste / minuto per utente")
bullet(doc, "POST /diagnostic/session → 20 richieste / minuto per utente")

heading(doc, "9.2 Upload file sicuro", 3)
bullet(doc, "Allegati ticket salvati su Supabase Storage (bucket privato)")
bullet(doc, "Validazione MIME type e dimensione massima lato backend (Pydantic)")
bullet(doc, "URL firmati (signed URL) per download — mai path diretto pubblico")
bullet(doc, "I manuali PDF vengono processati in-memory, non esposti via URL pubblico")

heading(doc, "9.3 Endpoint pubblico QR Code", 3)
body(doc,
     "L'endpoint /qr/<uuid> è l'unico endpoint senza autenticazione. Restituisce solo "
     "i dati tecnici pubblici di un asset identificato da UUID univoco. "
     "Non espone dati di tenant, utenti o ticket.")

divider(doc)

# ═══════════════════════════════════════════════════════════════════════════════
# 10. PIANO AI FELIX
# ═══════════════════════════════════════════════════════════════════════════════
heading(doc, "10. Piano AI Felix — Motore di Pianificazione")

body(doc,
     "Felix è il motore di pianificazione degli interventi di manutenzione. "
     "Supporta due modalità intercambiabili, selezionabili via parametro mode nell'API.")

styled_table(doc,
    headers=["Parametro mode", "Motore", "Velocità", "Requisiti"],
    rows=[
        ('"deterministic"', "PlannerEngine (Python puro)", "Istantaneo (< 1s)",  "Nessuno"),
        ('"ai"',            "OpenAI GPT-4.1",              "30–120 secondi",      "OPENAI_API_KEY"),
        ('"auto"',          "Deterministico se no key, AI se key presente", "—", "Default"),
    ],
    col_widths=[1.5, 2.2, 1.8, 1.0]
)

heading(doc, "10.1 PlannerEngine — Motore Deterministico", 3)
body(doc,
     "Il motore deterministico vive in backend/services/planner_engine.py. "
     "È implementato con sole dataclass Python — zero dipendenze ORM, "
     "100% testabile in isolamento con pytest.")

body(doc, "Logica di scheduling:", bold=True)
bullet(doc, "Prioritizza ticket BD (Breakdown) > PM (Preventiva) > CM (Correttiva) in ogni giornata")
bullet(doc, "Verifica disponibilità tecnico (assenze, orari, slot già occupati)")
bullet(doc, "Verifica competenze: Meccanico, Elettricista + PM/CM/BD come competenze implicite su ogni tecnico attivo")
bullet(doc, "Calcola slot temporali su griglia 08:00–17:00 (18 slot da 30 min)")
bullet(doc, "Split automatico WO su più giorni se la durata supera lo slot disponibile")
bullet(doc, "Calcola efficiency_score (0–100) con breakdown in 5 componenti")

heading(doc, "10.2 Formato plan_json (output comune)", 3)
code_block(doc, '{')
code_block(doc, '  "planned_workorders": [')
code_block(doc, '    {')
code_block(doc, '      "wo_id": 42,')
code_block(doc, '      "technician_id": 3,')
code_block(doc, '      "planned_date": "2026-04-07",')
code_block(doc, '      "time_slot": "08:00-10:00",')
code_block(doc, '      "duration_hours": 2.0,')
code_block(doc, '      "motivation": "...",')
code_block(doc, '      "is_continuation": false')
code_block(doc, '    }')
code_block(doc, '  ],')
code_block(doc, '  "deferred_workorders": [{"wo_id": 5, "reason": "..."}],')
code_block(doc, '  "efficiency_score": 78,')
code_block(doc, '  "efficiency_breakdown": {"copertura_backlog": 85, "utilizzo_tecnici": 70, ...}')
code_block(doc, '}')

heading(doc, "10.3 Flusso conferma piano", 3)
ascii_diagram(doc, [
    "  POST /planning/confirm/{plan_id}",
    "  ┌──────────────────────────────────────────────────────────────┐",
    "  │  1. Verifica piano in stato 'draft' e appartiene al tenant  │",
    "  │  2. Per ogni wo in planned_workorders:                      │",
    "  │     - Ticket.stato → 'Pianificato'                         │",
    "  │     - Ticket.tecnico_id = technician_id                    │",
    "  │     - Ticket.planned_start / planned_finish = time_slot    │",
    "  │  3. Asset con fermo_on_schedule=True → stato = 'Fermo'     │",
    "  │  4. GeneratedPlan.status → 'confirmed'                     │",
    "  │  5. Assegna plan_number progressivo (MAX+1 per tenant)     │",
    "  │  6. confirmed_by = username JWT corrente                   │",
    "  └──────────────────────────────────────────────────────────────┘",
], title="Figura 4 — Flusso conferma piano AI Felix")

divider(doc)

# ═══════════════════════════════════════════════════════════════════════════════
# 11. INTEGRAZIONI ESTERNE
# ═══════════════════════════════════════════════════════════════════════════════
heading(doc, "11. Integrazioni Esterne")

styled_table(doc,
    headers=["Servizio", "Protocollo", "Scopo", "Sicurezza"],
    rows=[
        ("OpenAI API",    "HTTPS REST",  "GPT-4.1 pianificazione; GPT-4.1-mini diagnosi e PDF parsing", "API Key in env; nessun dato PII inviato"),
        ("Open-Meteo",    "HTTPS REST",  "Previsioni meteo per vincoli asset outdoor",                  "API pubblica, no auth; chiamata solo da backend"),
        ("IMAP Server",   "IMAP/TLS",    "Polling email ogni 5 min → crea Ticket automaticamente",     "Credenziali cifrate in DB; TLS obbligatorio"),
        ("Supabase",      "HTTPS REST",  "Storage allegati ticket e manuali PDF",                      "Bucket privato; signed URL per download"),
        ("PostgreSQL",    "TCP 5432",    "DB produzione (Render managed)",                             "SSL TLS; IP allowlist Render"),
    ],
    col_widths=[1.3, 1.2, 2.5, 1.5]
)

heading(doc, "11.1 Email-to-Ticket", 3)
body(doc,
     "Il servizio email_poller.py si avvia in background thread all'avvio del backend. "
     "Ogni 5 minuti si connette al server IMAP configurato per tenant, "
     "legge le email non lette, e crea automaticamente Ticket con:")
bullet(doc, "Oggetto email → Ticket.titolo")
bullet(doc, "Corpo email → Ticket.descrizione")
bullet(doc, "Mittente → Ticket.segnalatore")
bullet(doc, "Tipo automatico: CM (Correttiva), priorità Media")
bullet(doc, "Allegati email → TicketAllegato su Supabase")

divider(doc)

# ═══════════════════════════════════════════════════════════════════════════════
# 12. DEPLOY E INFRASTRUTTURA
# ═══════════════════════════════════════════════════════════════════════════════
heading(doc, "12. Deploy e Infrastruttura")

ascii_diagram(doc, [
    "  GitHub Repository (main branch)",
    "       │",
    "       ├────────────────────────────┐",
    "       │                            │",
    "       ▼                            ▼",
    "  Vercel (Frontend)           Render (Backend)",
    "  ┌─────────────────┐        ┌───────────────────────┐",
    "  │ Next.js build   │        │ Docker container       │",
    "  │ Edge Network    │        │ Python 3.12 + FastAPI  │",
    "  │ CDN globale     │        │ uvicorn --host 0.0.0.0 │",
    "  │ HTTPS auto      │        │ Porta 8000             │",
    "  └────────┬────────┘        └──────────┬────────────┘",
    "           │                            │",
    "           │  HTTPS API calls           │  TCP/TLS",
    "           └─────────────────┐          ▼",
    "                             │    Render PostgreSQL",
    "                             │    ┌──────────────────┐",
    "                             │    │ DB managed        │",
    "                             └───►│ Backup automatico │",
    "                                  │ SSL enforced      │",
    "                                  └──────────────────┘",
], title="Figura 5 — Infrastruttura di deploy")

styled_table(doc,
    headers=["Componente", "Provider", "URL produzione", "Note"],
    rows=[
        ("Frontend", "Vercel",    "https://maintai.vercel.app",       "Deploy automatico da push su main"),
        ("Backend",  "Render",    "https://maintai-v3.onrender.com",  "Free tier: cold start 30–60s"),
        ("Database", "Render DB", "Internal network Render",           "PostgreSQL managed, backup daily"),
    ],
    col_widths=[1.3, 1.2, 2.5, 1.5]
)

body(doc,
     "NOTA — Render free tier: il backend può impiegare 30–60 secondi per svegliarsi "
     "dal cold start dopo inattività. Il frontend gestisce questa latenza con un timeout "
     "di 120 secondi per gli endpoint AI e 30 secondi per gli altri.",
     color=ORANGE)

divider(doc)

# ═══════════════════════════════════════════════════════════════════════════════
# 13. VARIABILI D'AMBIENTE
# ═══════════════════════════════════════════════════════════════════════════════
heading(doc, "13. Variabili d'Ambiente")

heading(doc, "13.1 Backend (backend/.env — Render Environment)", 3)
styled_table(doc,
    headers=["Variabile", "Tipo", "Descrizione", "Obbligatoria"],
    rows=[
        ("OPENAI_API_KEY",      "Secret",  "Chiave API OpenAI per GPT-4.1",             "No (senza: solo motore deterministico)"),
        ("OPENAI_MODEL",        "String",  "Modello OpenAI (default: gpt-4.1-mini)",    "No"),
        ("DATABASE_URL",        "Secret",  "URL PostgreSQL Render",                     "Sì (prod)"),
        ("DEMO_DATABASE_URL",   "Secret",  "URL SQLite demo (sqlite:///demo.db)",       "No"),
        ("SECRET_KEY",          "Secret",  "Chiave firma JWT (HS256)",                  "Sì"),
        ("CORS_ORIGINS",        "String",  "Lista URL frontend autorizzati (virgola)",  "Sì"),
        ("SUPABASE_URL",        "Secret",  "URL progetto Supabase per storage",         "No (senza: no allegati)"),
        ("SUPABASE_KEY",        "Secret",  "Service role key Supabase",                 "No"),
    ],
    col_widths=[2.0, 0.8, 2.5, 1.2]
)

heading(doc, "13.2 Frontend (Vercel Environment Variables)", 3)
styled_table(doc,
    headers=["Variabile", "Valore esempio", "Descrizione"],
    rows=[
        ("NEXT_PUBLIC_API_BASE", "https://maintai-v3.onrender.com", "URL base del backend FastAPI"),
    ],
    col_widths=[2.2, 2.5, 1.8]
)
body(doc,
     "ATTENZIONE — Le variabili NEXT_PUBLIC_* sono incluse nel bundle JavaScript "
     "e visibili nel browser. Non usarle mai per segreti.",
     color=RED_ALERT, bold=True)

divider(doc)

# ═══════════════════════════════════════════════════════════════════════════════
# 14. MODELLI DATI PRINCIPALI
# ═══════════════════════════════════════════════════════════════════════════════
heading(doc, "14. Modelli Dati Principali")

heading(doc, "14.1 Modello Ticket", 3)
styled_table(doc,
    headers=["Campo", "Tipo", "Valori / Note"],
    rows=[
        ("id",                "Integer PK",  "Auto-increment"),
        ("tenant_id",         "FK → Tenant", "Obbligatorio — isolamento multi-tenant"),
        ("asset_id",          "FK → Asset",  "Asset oggetto dell'intervento"),
        ("tecnico_id",        "FK → Tecnico","Assegnato alla conferma piano"),
        ("stato",             "String",      "Aperto / Pianificato / In corso / Chiuso / Eliminato"),
        ("tipo",              "String",      "BD (Breakdown) / PM (Preventiva) / CM (Correttiva)"),
        ("priorita",          "String",      "Alta / Media / Bassa"),
        ("durata_stimata_ore","Float",        "Usata dal planner per schedulazione"),
        ("planned_start",     "DateTime",    "Settato alla conferma piano (o manuale)"),
        ("planned_finish",    "DateTime",    "Settato alla conferma piano (o manuale)"),
        ("is_continuation",   "Boolean",     "True se frammento WO splittato su più giorni"),
        ("parent_ticket_id",  "FK → Ticket", "Ticket padre per continuazioni"),
    ],
    col_widths=[2.0, 1.5, 3.0]
)

heading(doc, "14.2 Modello GeneratedPlan (Piano storico)", 3)
styled_table(doc,
    headers=["Campo", "Tipo", "Descrizione"],
    rows=[
        ("id",                    "Integer PK",  "Auto-increment"),
        ("tenant_id",             "FK → Tenant", "Isolamento multi-tenant"),
        ("status",                "String",      "draft / confirmed / deauthorized"),
        ("plan_number",           "Integer",     "Progressivo per tenant (MAX+1 alla conferma)"),
        ("plan_json",             "JSON/TEXT",   "Struttura completa del piano (JSON su PG, TEXT su SQLite)"),
        ("confirmed_by",          "String",      "Username JWT di chi ha confermato"),
        ("deauthorized_by",       "String",      "Username di chi ha deautorizzato"),
        ("deauthorization_reason","String",      "Motivazione obbligatoria alla deautorizzazione"),
        ("created_at",            "DateTime",    "Timestamp creazione piano"),
        ("confirmed_at",          "DateTime",    "Timestamp conferma"),
    ],
    col_widths=[2.2, 1.5, 2.8]
)

divider(doc)

# ═══════════════════════════════════════════════════════════════════════════════
# 15. LOGGING E OSSERVABILITÀ
# ═══════════════════════════════════════════════════════════════════════════════
heading(doc, "15. Logging e Osservabilità")

body(doc,
     "MaintAI usa un sistema di logging a doppio canale: "
     "Python logging standard (stdout/file) + log persistenti nel DB (SystemLog).")

styled_table(doc,
    headers=["Canale", "Funzione", "Dove si legge", "Scopo"],
    rows=[
        ("Python logging", "logger.info/error/warning", "Stdout Render / file locale", "Debug tecnico, errori runtime"),
        ("SystemLog DB",   "log_to_db() / db_info() / db_error()", "Frontend /admin/logs", "Audit trail, visibilità utente admin"),
    ],
    col_widths=[1.5, 2.2, 1.8, 1.0]
)

heading(doc, "15.1 Struttura SystemLog", 3)
styled_table(doc,
    headers=["Campo", "Tipo", "Descrizione"],
    rows=[
        ("id",         "Integer PK", "Auto-increment"),
        ("tenant_id",  "FK",         "Isolamento log per tenant"),
        ("livello",    "String",     "INFO / WARNING / ERROR / CRITICAL"),
        ("messaggio",  "Text",       "Descrizione evento"),
        ("dettagli",   "JSON",       "Payload opzionale (traceback, parametri)"),
        ("created_at", "DateTime",   "Timestamp evento"),
    ],
    col_widths=[1.5, 1.2, 3.8]
)

heading(doc, "15.2 Health Check", 3)
body(doc,
     "L'endpoint GET /health (non autenticato) restituisce:")
bullet(doc, "status: ok")
bullet(doc, "version: versione corrente backend")
bullet(doc, "database: stato connessione DB (ok / error)")
bullet(doc, "uptime: secondi dall'avvio del processo")

doc.add_paragraph()
divider(doc)
doc.add_paragraph()

# ── FOOTER ───────────────────────────────────────────────────────────────────
footer_table = doc.add_table(rows=1, cols=1)
footer_table.alignment = WD_TABLE_ALIGNMENT.CENTER
fc = footer_table.cell(0, 0)
set_cell_bg(fc, DARK_BLUE)
para = fc.paragraphs[0]
para.alignment = WD_ALIGN_PARAGRAPH.CENTER
para.paragraph_format.space_before = Pt(8)
para.paragraph_format.space_after = Pt(8)
r = para.add_run(
    "MaintAI v3.3.1  |  Documento di Architettura Tecnica  |  Uso interno IT  |  Giugno 2026"
)
r.font.size = Pt(9)
r.font.color.rgb = ACCENT_CYAN

# ── SAVE ─────────────────────────────────────────────────────────────────────
out_path = "/home/user/MAINTAI_MVP_DEMO/MaintAI_Architettura_Tecnica_v3.3.1.docx"
doc.save(out_path)
print(f"Documento salvato: {out_path}")
