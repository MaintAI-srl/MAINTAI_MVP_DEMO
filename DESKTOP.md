# MaintAI Desktop — Guida Tecnica

Versione: **2.8.2** — Tauri 2 + Next.js 15 + FastAPI

---

## Prerequisiti

| Strumento | Versione minima | Note |
|---|---|---|
| Node.js | 20 LTS | [nodejs.org](https://nodejs.org/) |
| Rust + Cargo | 1.77+ | `rustup.rs` — include automaticamente cargo |
| Python | 3.10+ | per il backend FastAPI |
| WebView2 Runtime | qualsiasi | già incluso in Windows 10/11 |

Installa Rust (una volta sola):
```
winget install Rustlang.Rustup
```
Poi riavvia il terminale.

---

## Struttura desktop

```
maintai_v3/
├── frontend/
│   ├── src-tauri/              ← configurazione Tauri
│   │   ├── Cargo.toml          ← dipendenze Rust
│   │   ├── build.rs
│   │   ├── tauri.conf.json     ← config app (nome, finestra, bundle)
│   │   ├── capabilities/
│   │   │   └── default.json    ← permessi WebView
│   │   ├── src/
│   │   │   ├── main.rs         ← entry point Rust
│   │   │   └── lib.rs          ← comandi Tauri (get_api_base, get_app_mode)
│   │   └── icons/              ← icone app (vedi §Icone)
│   ├── out/                    ← static export Next.js (generato da build:desktop)
│   └── package.json            ← include script tauri:dev, tauri:build, build:desktop
│
├── scripts/
│   ├── dev-desktop.bat         ← avvio sviluppo (backend + frontend + Tauri)
│   └── build-desktop.bat       ← build produzione Windows
│
└── backend/                    ← FastAPI invariato
```

---

## Modalità operative

### Modalità Cloud (default)
L'app desktop usa il **backend remoto su Render.com** e il frontend viene impacchettato staticamente.

- Backend API: `https://maintai-v3.onrender.com`
- Frontend: incluso nell'installer (static export)
- Nessun server locale necessario per l'utente finale

### Modalità Local Dev
Tutti i servizi girano in locale sul PC dello sviluppatore:

- Backend: `http://127.0.0.1:8000` (FastAPI dev)
- Frontend: `http://localhost:3000` (Next.js dev server)
- Tauri si collega al frontend Next.js già in esecuzione

---

## Avvio in sviluppo

### Opzione A — Script automatico (consigliato)
Avvia backend, frontend Next.js e finestra Tauri in sequenza:
```
scripts\dev-desktop.bat
```

### Opzione B — Manuale (3 terminali)

**Terminale 1 — Backend:**
```bash
python -m uvicorn backend.main:app --host 127.0.0.1 --port 8000 --reload
```

**Terminale 2 — Frontend:**
```bash
cd frontend
npm run dev
```

**Terminale 3 — Tauri:**
```bash
cd frontend
npm run tauri:dev
```

La finestra Tauri si apre connessa a `http://localhost:3000`.

---

## Build produzione (Windows)

### Prerequisiti icone (una volta sola)
Prepara un'immagine PNG quadrata (minimo 1024×1024 px) e genera le icone:
```bash
cd frontend
npx @tauri-apps/cli@2 icon path\to\logo.png
```
Questo crea tutti i formati richiesti in `src-tauri/icons/`.

### Build
```
scripts\build-desktop.bat
```
oppure manualmente:
```bash
cd frontend
npm run tauri:build
```

**Output** (dopo la build):
```
frontend/src-tauri/target/release/bundle/
  msi/    ← MaintAI Desktop_2.7.0_x64_en-US.msi
  nsis/   ← MaintAI Desktop_2.7.0_x64-setup.exe
```

La prima build Rust richiede 5–15 minuti (compila le dipendenze). Le build successive sono molto più veloci.

---

## Cambiare backend (cloud ↔ locale)

### Per la build desktop (cloud → altro URL)
Modifica lo script `build:desktop` in `frontend/package.json`:
```json
"build:desktop": "cross-env DESKTOP_BUILD=true NEXT_PUBLIC_API_BASE=https://tuo-backend.example.com next build"
```

### In sviluppo locale
Il frontend dev legge da `frontend/.env.local`:
```
NEXT_PUBLIC_API_BASE=http://127.0.0.1:8000
```

### Via variabile d'ambiente a runtime (Tauri)
Il comando Rust `get_api_base()` legge `MAINTAI_API_BASE` se presente:
```bash
set MAINTAI_API_BASE=http://127.0.0.1:8000
```

---

## Installazione dipendenze frontend (prima volta)

```bash
cd frontend
npm install
```

Installa `@tauri-apps/cli`, `cross-env` e tutte le dipendenze esistenti.

---

## Come funziona tecnicamente

1. **Build desktop**: `npm run build:desktop` esegue `next build` con `DESKTOP_BUILD=true`, che attiva `output: "export"` in `next.config.ts` → genera `frontend/out/` (HTML/CSS/JS statici).

2. **Packaging Tauri**: `tauri build` compila il codice Rust in `src-tauri/`, impacchetta `frontend/out/` nell'eseguibile e genera l'installer.

3. **A runtime**: La WebView2 di Windows carica i file statici dall'interno dell'app (origin `http://tauri.localhost`). Le API call vanno a `NEXT_PUBLIC_API_BASE` (baked in al build time).

4. **CORS**: Il backend FastAPI accetta richieste da `http://tauri.localhost` e `tauri://localhost` (aggiunto a `_DEFAULT_ORIGINS` in `backend/main.py`).

5. **BackendStatus**: Un componente React fa polling sull'endpoint `/health` ogni 30s e mostra un badge floating se il backend non risponde.

---

## Troubleshooting

| Problema | Soluzione |
|---|---|
| `rustc: command not found` | Installa Rust da rustup.rs, riavvia terminale |
| `tauri: command not found` | `cd frontend && npm install` |
| Build fallisce su icone mancanti | Genera icone con `npx @tauri-apps/cli@2 icon logo.png` |
| Finestra bianca in dev | Verifica che Next.js sia in esecuzione su porta 3000 |
| CORS error in desktop build | Verifica che `http://tauri.localhost` sia in `_DEFAULT_ORIGINS` del backend |
| Cookie JWT non funziona | WebView2 supporta cookie — verifica `SameSite` del cookie |
| Render.com lento al primo avvio | Il backend cold start può impiegare 30–60s; BackendStatus lo indica |

---

## Sicurezza del client desktop

- **Token JWT in localStorage (rischio accettato, documentato).** Il WebView Tauri non
  riceve cookie HttpOnly in modo affidabile, quindi al login il backend restituisce
  `access_token` nel body JSON **solo per i client desktop** (Origin Tauri o header
  `X-Client: desktop`; per il web il token vive esclusivamente nel cookie HttpOnly).
  Il client desktop lo conserva in `localStorage` (`maintai_jwt`): un eventuale XSS
  dentro l'app desktop potrebbe leggerlo. Mitigazioni: CSP definita in
  `tauri.conf.json` (niente `csp: null`), contenuto solo locale (`frontendDist`),
  nessun plugin `shell`, token con scadenza 24h + blacklist JTI al logout.
- **CSP**: definita in `src-tauri/tauri.conf.json` → `app.security.csp`. Se si
  aggiungono endpoint/CDN esterni vanno aggiunti a `connect-src`/`img-src`.
- **Capability**: `src-tauri/capabilities/default.json` espone solo `core:default`
  e `updater:default`. Non reintrodurre `shell:default` senza una necessità reale.
- **Chiave di firma updater**: la chiave privata Tauri NON deve mai essere committata
  (generata a suo tempo fuori dal repo come `tauri_signing_key.txt`); conservarla in
  un secret manager e proteggerla con password non vuota.
