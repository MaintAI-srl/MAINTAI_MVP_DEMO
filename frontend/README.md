# MaintAI Frontend

Frontend Next.js di MaintAI.

## Sviluppo

```bash
npm run dev
npm run build
npm run lint
```

## Moduli

La sidebar e i controlli globali leggono i moduli esposti dal backend su `/modules`.
Per disattivare feature in deploy usare, lato backend:

```bash
MAINTAI_MODULES_DISABLED=diagnostic_ai,email_to_ticket
```

Oppure definire una allowlist:

```bash
MAINTAI_MODULES_ENABLED=dashboard,assets,tickets,technicians
```

Override puntuale:

```bash
MAINTAI_MODULE_PLANNING=false
MAINTAI_MODULE_GUIDE_AI=true
```

Il frontend usa il payload runtime del backend, quindi mostra solo i moduli attivi.
