# MaintAI — Deploy Cloud Gratuito
## Vercel (Frontend) + Render (Backend) + Supabase (DB + Storage)

> Guida operativa basata sul codice reale del progetto. Ogni comando è pronto da copiare.

---

## Prerequisiti

1. Account GitHub con il repo `maintai_v3` pushato (privato va bene)
2. Account Supabase — supabase.com (free)
3. Account Render — render.com (free)
4. Account Vercel — vercel.com (free)
5. Node.js + Python installati localmente per i test

---

## FASE 0 — Prima di tutto: push su GitHub

```bash
cd maintai_v3
git init                          # se non già inizializzato
echo ".env" >> .gitignore
echo "*.db" >> .gitignore
echo "uploads/" >> .gitignore
echo ".venv/" >> .gitignore
echo "__pycache__/" >> .gitignore
echo ".next/" >> .gitignore
echo "node_modules/" >> .gitignore
git add .
git commit -m "feat: initial cloud-ready commit"
git remote add origin https://github.com/TUO-USERNAME/maintai_v3.git
git push -u origin main
```

**Importante:** verifica che `.gitignore` escluda `.env` e `maintai.db` prima del push.

---

## FASE 1 — DATABASE: Supabase PostgreSQL

### 1.1 Crea il progetto Supabase

1. Vai su **supabase.com → New project**
2. Nome: `maintai`
3. Password database: scegli una password forte, salvala in un posto sicuro
4. Region: **West EU (Ireland)** — più vicina all'Italia
5. Clicca **Create new project** e aspetta ~2 minuti

### 1.2 Ottieni la connection string

1. Dashboard Supabase → **Settings → Database**
2. Sezione **Connection string** → tab **URI**
3. Copia la stringa, sarà tipo:
   ```
   postgresql://postgres:[TUA-PASSWORD]@db.abcdefgh.supabase.co:5432/postgres
   ```
4. **Sostituisci `[YOUR-PASSWORD]`** con la password che hai scelto

> ⚠️ Non usare la stringa "Transaction pooler" (porta 6543) — usa quella diretta porta 5432

### 1.3 Aggiorna il file `.env` locale

```bash
# backend/.env
DATABASE_URL=postgresql://postgres:TUA_PASSWORD@db.XXXXX.supabase.co:5432/postgres
OPENAI_API_KEY=sk-...
SECRET_KEY=una-stringa-casuale-lunga-almeno-32-caratteri
SUPABASE_URL=https://XXXXX.supabase.co
SUPABASE_SERVICE_KEY=eyJ...  # vedi sotto
SUPABASE_BUCKET=maintai-uploads
CORS_ORIGINS=http://localhost:3000,https://TUO-PROGETTO.vercel.app
```

Per `SUPABASE_SERVICE_KEY`: Dashboard → **Settings → API** → copia **service_role key** (NON la anon key — la service role bypassa le RLS policies e serve per lo storage)

### 1.4 Esegui le migrazioni Alembic su PostgreSQL

```bash
# dalla root del progetto (maintai_v3/)
cd maintai_v3

# Attiva il venv se ne hai uno
.venv\Scripts\activate  # Windows
# source .venv/bin/activate  # Linux/Mac

# Carica le env vars dal .env di backend
set DATABASE_URL=postgresql://postgres:...  # Windows
# export DATABASE_URL=postgresql://...      # Linux/Mac

# Esegui tutte le migrazioni
alembic upgrade head
```

Se va tutto bene vedi:
```
INFO  [alembic.runtime.migration] Running upgrade ... -> 5ee6edaf8646, ...
INFO  [alembic.runtime.migration] Running upgrade ... -> head
```

### 1.5 Migra i dati esistenti da SQLite a PostgreSQL

Se hai dati in `maintai.db` che vuoi migrare:

```bash
pip install pgloader  # oppure usa lo script Python sotto
```

Oppure script Python più semplice per i dati essenziali:

```bash
# Lancia dalla root del progetto con entrambe le env vars configurate
python -c "
import sqlite3, os
from sqlalchemy import create_engine, text

sqlite_url = 'sqlite:///maintai.db'
pg_url = os.environ['DATABASE_URL']

sq = create_engine(sqlite_url, connect_args={'check_same_thread': False})
pg = create_engine(pg_url)

# Tabelle da migrare in ordine (rispetta FK)
tables = ['utenti','impianti','asset','tecnici','manuali',
          'attivita_manutenzione','ticket','analisi_guasti',
          'diagnostic_sessions','ticket_allegati','tecnici_assenze']

for t in tables:
    with sq.connect() as sc:
        rows = sc.execute(text(f'SELECT * FROM {t}')).fetchall()
        if not rows:
            print(f'  {t}: vuota, skip')
            continue
        keys = sc.execute(text(f'SELECT * FROM {t} LIMIT 0')).keys()
    with pg.connect() as pc:
        pc.execute(text(f'DELETE FROM {t}'))  # pulisci prima
        for row in rows:
            cols = ', '.join(keys)
            vals = ', '.join([f':{k}' for k in keys])
            pc.execute(text(f'INSERT INTO {t} ({cols}) VALUES ({vals})'), dict(zip(keys, row)))
        pc.commit()
        print(f'  {t}: {len(rows)} righe migrate')
print('Migrazione completata.')
"
```

### 1.6 Compatibilità SQLite → PostgreSQL: cosa cambia nel codice

Il tuo modello usa solo tipi base (`String`, `Text`, `Integer`, `Float`, `Boolean`, `DateTime`) — **tutti compatibili** con PostgreSQL. Non ci sono query raw SQL specifiche per SQLite nel codice.

**Unica differenza rilevante:** `json_estratto = Column(Text)` e `history = Column(Text, default="[]")` — su PostgreSQL potresti usare `JSON` nativo, ma `Text` con `json.loads/dumps` funziona perfettamente — **nessuna modifica necessaria**.

---

## FASE 2 — FILE UPLOADS: Supabase Storage

### 2.1 Crea il bucket

1. Dashboard Supabase → **Storage → New bucket**
2. Nome: `maintai-uploads`
3. **Public bucket**: ✅ Sì (per servire file direttamente via URL)
4. Clicca **Save**

### 2.2 Modifiche al codice (già applicate)

Il codice è stato aggiornato per usare un modulo `backend/core/storage.py` che funziona:
- **In locale**: salva su `uploads/` (comportamento attuale)
- **Su Render**: salva su Supabase Storage

In `tickets.py` l'upload ora chiama `storage.save_file(content, filename)` che restituisce l'URL pubblico Supabase invece di `/uploads/filename`.

### 2.3 Impostazioni CORS del bucket Supabase

Dashboard → Storage → Policies → aggiungi questa policy per il bucket `maintai-uploads`:

```sql
-- Permetti lettura pubblica
CREATE POLICY "Public read" ON storage.objects
  FOR SELECT USING (bucket_id = 'maintai-uploads');

-- Permetti insert con service key
CREATE POLICY "Service key insert" ON storage.objects
  FOR INSERT WITH CHECK (bucket_id = 'maintai-uploads');
```

Oppure più semplice: nel bucket settings metti **Public** e il bucket sarà leggibile senza policy.

---

## FASE 3 — BACKEND: Deploy su Render

### 3.1 Crea il Web Service su Render

1. Vai su **render.com → New → Web Service**
2. Collega il repository GitHub `maintai_v3`
3. Configura:
   - **Name**: `maintai-backend`
   - **Root Directory**: `backend` ← importante!

     > Oppure lascia vuoto se usi il `render.yaml` in root
   - **Runtime**: Python 3
   - **Build Command**: `pip install -r requirements.txt`
   - **Start Command**: `uvicorn backend.main:app --host 0.0.0.0 --port $PORT`
   - **Plan**: Free

### 3.2 Variabili d'ambiente su Render

Dashboard → maintai-backend → **Environment** → aggiungi:

| Key | Value |
|-----|-------|
| `DATABASE_URL` | `postgresql://postgres:...@db.XXX.supabase.co:5432/postgres` |
| `OPENAI_API_KEY` | `sk-...` |
| `SECRET_KEY` | stringa casuale 32+ caratteri |
| `SUPABASE_URL` | `https://XXX.supabase.co` |
| `SUPABASE_SERVICE_KEY` | `eyJ...` (service_role key) |
| `SUPABASE_BUCKET` | `maintai-uploads` |
| `CORS_ORIGINS` | `https://maintai.vercel.app` (aggiorna dopo deploy Vercel) |
| `PYTHON_VERSION` | `3.11.0` |

> ⚠️ Non mettere mai queste variabili nel codice o nel repository.

### 3.3 File `render.yaml` (opzionale ma consigliato)

Crea `render.yaml` nella root del progetto per config-as-code:

```yaml
services:
  - type: web
    name: maintai-backend
    runtime: python
    buildCommand: pip install -r backend/requirements.txt
    startCommand: uvicorn backend.main:app --host 0.0.0.0 --port $PORT
    envVars:
      - key: DATABASE_URL
        sync: false   # inserisci manualmente dalla dashboard
      - key: OPENAI_API_KEY
        sync: false
      - key: SECRET_KEY
        sync: false
      - key: SUPABASE_URL
        sync: false
      - key: SUPABASE_SERVICE_KEY
        sync: false
      - key: SUPABASE_BUCKET
        value: maintai-uploads
      - key: PYTHON_VERSION
        value: 3.11.0
```

### 3.4 Gestire il cold start del free tier

Render free tier spegne il servizio dopo 15 minuti di inattività. La prima richiesta impiega ~30 secondi.

**Soluzione gratuita — keep-alive con UptimeRobot:**
1. Vai su **uptimerobot.com** (free)
2. Crea un monitor HTTP: `https://maintai-backend.onrender.com/health`
3. Intervallo: ogni **5 minuti**

Questo mantiene il backend sveglio 24/7 gratuitamente.

**Il tuo endpoint `/health` esiste già** — verificalo con `GET /health` dopo il deploy.

### 3.5 Migrazioni al primo avvio su Render

Dopo il primo deploy, esegui le migrazioni dal tuo PC locale (con `DATABASE_URL` di produzione):

```bash
# Windows
set DATABASE_URL=postgresql://postgres:...
alembic upgrade head

# oppure usa la Render Shell: Dashboard → Shell → esegui il comando direttamente
```

---

## FASE 4 — FRONTEND: Deploy su Vercel

### 4.1 Deploy

1. Vai su **vercel.com → New Project**
2. Importa il repository GitHub `maintai_v3`
3. **Root Directory**: `frontend` ← fondamentale
4. Framework: Next.js (rilevato automaticamente)
5. Clicca **Deploy**

### 4.2 Variabili d'ambiente su Vercel

Dashboard Vercel → Settings → **Environment Variables**:

| Key | Value | Environments |
|-----|-------|--------------|
| `NEXT_PUBLIC_API_BASE` | `https://maintai-backend.onrender.com` | Production, Preview, Development |

> Il nome del servizio Render (`maintai-backend`) è quello che hai scelto al punto 3.1.

### 4.3 Aggiorna CORS_ORIGINS su Render

Dopo il primo deploy Vercel, avrai l'URL definitivo (es. `https://maintai-abc123.vercel.app`).

Vai su Render → Environment → aggiorna `CORS_ORIGINS`:
```
https://maintai-abc123.vercel.app,https://maintai.vercel.app
```

Poi fai **Manual Deploy → Deploy latest commit** su Render per applicare.

### 4.4 Dominio custom (opzionale, gratuito)

Se hai un dominio, Vercel lo supporta gratuitamente:
Dashboard → Settings → Domains → aggiungi il tuo dominio.

---

## FASE 5 — TEST FINALE

### 5.1 Checklist di verifica

```
□ GET  https://maintai-backend.onrender.com/health  → {"status": "ok"}
□ POST https://maintai-backend.onrender.com/auth/login  → token JWT
□ GET  https://maintai.vercel.app  → pagina login
□ Login con credenziali  → dashboard carica
□ Lista ticket  → dati visibili
□ Crea nuovo ticket  → appare nella lista
□ Upload allegato foto  → URL Supabase Storage nella risposta
□ Upload PDF manuale  → parsing AI funziona
□ Diagnostica AI ticket  → chat risponde
□ Scheduler ricalcola  → piano aggiornato
□ Dashboard KPI  → numeri corretti
```

### 5.2 Log in real-time su Render

Dashboard Render → maintai-backend → **Logs** (tab in alto)

Per filtrare gli errori:
```bash
# Dalla Render Shell o dal tuo terminale con curl:
curl https://maintai-backend.onrender.com/health
```

Errori comuni e soluzioni:

| Errore | Causa | Soluzione |
|--------|-------|-----------|
| `502 Bad Gateway` | Backend non avviato | Controlla i log di build su Render |
| `CORS error` nel browser | CORS_ORIGINS non aggiornata | Aggiorna la var su Render + redeploy |
| `Connection refused to DB` | DATABASE_URL sbagliata | Verifica la stringa su Supabase → Settings → Database |
| `ModuleNotFoundError` | requirements.txt incompleto | Aggiungi il pacchetto mancante e fai push |
| `Upload file fallisce` | SUPABASE_SERVICE_KEY mancante | Aggiungi la key su Render |

### 5.3 Verifica upload file funziona

```bash
curl -X POST https://maintai-backend.onrender.com/tickets/1/allegati \
  -H "Authorization: Bearer TUO_TOKEN" \
  -F "file=@test.jpg"
# Risposta attesa: {"id": ..., "url": "https://XXX.supabase.co/storage/v1/object/public/maintai-uploads/..."}
```

---

## Riepilogo URL finali

| Servizio | URL |
|----------|-----|
| Frontend | `https://TUO-PROGETTO.vercel.app` |
| Backend API | `https://maintai-backend.onrender.com` |
| DB Supabase | Dashboard: `https://app.supabase.com/project/XXX` |
| Storage Supabase | `https://XXX.supabase.co/storage/v1/object/public/maintai-uploads/` |

---

## Costi (tutto free tier)

| Servizio | Piano | Limite | Note |
|----------|-------|--------|------|
| Vercel | Hobby | 100GB bandwidth/mese | Perfetto per Next.js |
| Render | Free | 750h/mese, cold start ~30s | Si spegne dopo 15min idle |
| Supabase | Free | 500MB DB, 1GB storage | PostgreSQL completo |
| UptimeRobot | Free | 50 monitor | Keep-alive per Render |

**Totale: €0/mese**

Quando avrai bisogno di eliminare il cold start: piano Starter Render = $7/mese.
