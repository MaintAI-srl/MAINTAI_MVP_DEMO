# Prototipo XR — manuale PDF nel visore (Meta Quest 3)

Prototipo della pagina `/xr`: il tecnico inquadra il QR code sulla macchina, entra in
realtà mista dal browser del visore e si vede il manuale PDF su un pannello **alla propria
sinistra**, con la macchina sempre visibile in passthrough.

Modulo: `xr_viewer` — **attivo di default**, si disattiva da *Impostazioni → Funzionalità*.

> **Nota sulla configurazione moduli.** La config globale è un kill-switch: i moduli
> effettivi di un tenant sono intersecati con quelli globali (`effective_enabled_ids` in
> `backend/core/modules.py`), quindi un modulo spento globalmente non è attivabile sul
> singolo cliente. Ora la pagina Funzionalità lo dichiara con il badge *spenta
> globalmente* e un avviso al salvataggio, invece di far "tornare indietro" l'interruttore
> con un messaggio di successo.
>
> Una configurazione salvata registra le **decisioni esplicite** più l'elenco dei moduli
> noti al momento del salvataggio (`{"enabled": [...], "known": [...]}`), non una
> whitelist: un modulo introdotto dopo non ha una decisione e ricade sul proprio default
> (globale) o sulla configurazione globale (tenant). Con la whitelist ogni modulo nuovo
> restava spento per sempre e nessun default poteva riaccenderlo — è il motivo per cui
> `/xr` non compariva neanche dopo aver messo `default_enabled=True`.

---

## 1. Flusso utente

**Ingresso immediato.** Il pulsante *Entra subito in XR* apre la sessione senza documento:
si arriva in realtà mista con un pannello di attesa e il manuale si sceglie dopo. È il
percorso della web app installata sul visore, che deve portare in XR al primo tocco.
La sessione **non può** partire da sola all'apertura: `requestSession` esige una user
activation, quindi un tocco resta obbligatorio (limite del browser, non del prototipo).

Il percorso guidato QR → documento → XR resta disponibile sotto.


1. `/xr` sul browser del Quest 3 (o su qualsiasi Chromium con emulatore WebXR).
2. **Scansiona QR** — la pagina accetta:
   - QR asset generati da `backend/services/qr_service.py` (`<app>/asset?id=<n>`);
   - QR pubblici del check di primo livello (`<app>/check/<token>`);
   - codice asset o ID digitato a mano (fallback se manca `BarcodeDetector`).
   La decodifica passa da `frontend/app/lib/qrDecode.ts`: usa `BarcodeDetector` se il
   browser lo espone, altrimenti **jsQR**. Il fallback non è teorico — il browser del Meta
   Quest non implementa `BarcodeDetector`, quindi sul visore non veniva letto **nessun QR**
   e restava solo l'inserimento manuale del codice.
3. Scelta del PDF fra i documenti dell'asset (`GET /assets/{id}/documenti`, filtrati per PDF).
   Con un solo PDF il passaggio è automatico.
4. La prima pagina viene rasterizzata **prima** di entrare in XR: serve per l'anteprima e
   perché `requestSession()` va chiamata dentro il gesto utente, senza `await` intermedi.
5. **Entra in XR** → sessione `immersive-ar`, pannello a 1,05 m, ruotato di 38° verso
   sinistra rispetto allo sguardo, **agganciato alla testa**: si muove con lo sguardo e
   resta sempre nello stesso punto del campo visivo.

## 1-bis. Posizione, movimento e occlusione

Il pannello parte **centrato davanti allo sguardo** (`PANEL_YAW_DEG = 0`). Prima partiva
a 38° a sinistra: sul visore finiva ai margini del campo visivo o fuori, e non c'era modo
di riportarlo davanti.

**Spostarlo:** punta il pannello col controller e tieni premuto il **grip**. Il pannello
segue il raggio alla distanza a cui l'hai agganciato e ruota per restare rivolto verso di
te (trascinandolo di lato resterebbe altrimenti di taglio e illeggibile). **A / X** lo
riporta davanti.

**Occlusione con il mondo reale:** con il modulo WebXR *depth sensing* il pannello passa
**dietro** mani e oggetti invece di coprirli. Il fragment shader confronta la profondità
del frammento con la distanza reale misurata dal visore in quel punto e scarta ciò che sta
dietro, con un margine di 5 cm (`OCCLUSION_BIAS_M`) perché la depth map è a bassa
risoluzione e rumorosa sui bordi.

> **Compromesso non aggirabile.** Un `XRQuadLayer` lo compone il runtime alla risoluzione
> nativa del display — è ciò che rende il testo leggibile — ma non conosce la depth map,
> quindi resta sempre sopra al mondo reale. L'occlusione richiede di disegnare il pannello
> nel projection layer con il nostro shader, che è più morbido. La scelta è esposta come
> spunta in pagina: attiva di default (occlusione), togliendola si torna al testo più
> nitido. Cambia il percorso di rendering, quindi ha effetto dall'avvio sessione successivo.

> **La feature `layers` si chiede solo senza occlusione.** Con `layers` attiva il render
> state va popolato con i layer del binding; impostare invece un `baseLayer` — necessario
> per disegnare col nostro shader — fa **fallire la sessione** sul browser del Quest
> ("session failed / base layer"). Le due strade sono alternative, non combinabili.

Il formato della depth map cambia per dispositivo e la variante di shader viene scelta a
compile-time (`buildFragmentSource`): `luminance-alpha` (intero a 16 bit spezzato su due
canali da 8) oppure `float32` (metri già pronti nel canale rosso).

`depth-sensing` viene richiesto **solo** se l'occlusione è spuntata: se un runtime
rifiutasse la sessione per via di quella feature, basta togliere la spunta per rientrare in
XR. Un retry automatico non sarebbe affidabile — dopo un `await` la user activation
richiesta da `requestSession` è persa.

### Ancoraggio

Due modalità, commutabili con il **click dello stick** (o dal pulsante in pagina):

| Modalità | Comportamento | Come è implementata |
|---|---|---|
| `testa` (default) | il pannello segue la testa, come un HUD | il quad layer vive nel **viewer space**: è il compositore a tenerlo agganciato alla posa della testa, quindi zero latenza e zero jitter, senza inseguirla da JavaScript per frame |
| `fisso` | il pannello resta dove è stato piazzato nella stanza e il tecnico ci gira intorno | quad layer nel `local-floor`, posizionato una volta sola (comportamento della prima versione) |

Tutta la sovraimpressione — pagina PDF, barra HUD, avvisi — è **una sola texture su un
solo pannello**, quindi l'ancoraggio vale per tutto insieme.

Note implementative:

- lo `space` di un `XRQuadLayer` si fissa alla creazione: cambiare ancoraggio ricrea il
  layer (succede solo alla pressione di un tasto, costo irrilevante);
- nel fallback WebGL, senza layer, la testa va inseguita a mano: la matrice mondo del
  pannello è `posa_testa × offset`, con l'offset espresso nello spazio della testa;
- se il visore non espone il reference space `viewer` si degrada automaticamente a `fisso`
  con un avviso nell'HUD.

## 2. Comandi nel visore

| Controller | Azione |
|---|---|
| Stick ← / → | pagina precedente / successiva |
| Stick ↑ / ↓ | ingrandisci / rimpicciolisci il pannello (0,55× – 2,6×) |
| Grilletto | pagina successiva |
| Grip tenuto premuto | punta il pannello e trascinalo dove vuoi |
| Click dello stick | aggancia alla testa / fissa nella stanza |
| A / X | riporta il pannello davanti a te |
| B / Y | zoom al 100% |

La barra in basso sul pannello mostra asset, documento, pagina corrente e i comandi.

## 3. Architettura

```
frontend/app/xr/
  page.tsx                  UI 2D: capability check, QR, scelta PDF, avvio sessione
  lib/pdfRaster.ts          pdf.js → canvas, cache LRU 4 pagine, prefetch ±1
  lib/xrPdfViewer.ts        sessione WebXR, posizionamento, texture, input controller
  lib/qrTarget.ts           QR → asset (3 formati) + elenco PDF dell'asset
  lib/liveQrScanner.ts      scansione QR continua durante la sessione
```

### Perché due percorsi di rendering

- **WebXR Layers** (preferito, supportato dal browser Quest): il PDF è un `XRQuadLayer`.
  Il compositore campiona la texture alla risoluzione nativa del display senza passare
  dal render target dell'app — è la differenza fra un manuale leggibile e uno no.
  Si richiede anche `quality = "text-optimized"` (estensione Meta) in best-effort.
- **Fallback WebGL**: quad texturizzato disegnato a mano nel projection layer, per i
  browser senza il modulo `layers`. Funziona ovunque, testo più morbido.

Il percorso attivo è mostrato nella UI 2D durante la sessione.

### Texture

Ogni pagina è rasterizzata a 2400 px di altezza (`PAGE_TEXTURE_HEIGHT`) e composta su un
canvas con la barra HUD; il canvas viene caricato nella texture del layer con
`texSubImage2D`. Cache di 4 pagine (~20 MB l'una) con prefetch della pagina precedente e
successiva: in XR il caricamento di una pagina si nota molto più che a schermo.

## 4. Scansione QR: cosa funziona oggi sul Quest

La scansione avviene **prima** di entrare in XR, con `getUserMedia` + `BarcodeDetector`.
Sul Quest è l'unica via disponibile: l'accesso raw alla camera *dentro* una sessione WebXR
(modulo `camera-access`) arriva solo con Horizon OS v77 — vedi la
[richiesta sul forum Meta](https://communityforums.atmeta.com/discussions/Questions_Discussions/request-webxr-raw-camera-access-camera-access-feature-in-quest-browser/1367463)
e la [Passthrough Camera API](https://developers.meta.com/horizon/documentation/spatial-sdk/spatial-sdk-pca-overview/).

In più, l'opzione **"continua a leggere i QR durante la sessione XR"** (attiva di default)
tiene vivo lo stream della fotocamera anche dentro la sessione e lo campiona ogni 600 ms
con `setInterval` — non con `requestAnimationFrame`, che dentro `immersive-ar` non viene
più consegnato alla finestra. Se il tecnico inquadra un'altra macchina, il pannello cambia
manuale da solo (con avviso nell'HUD). Se lo stream non è ottenibile durante la sessione,
la funzione si disattiva in silenzio e resta valida la scansione fatta prima.

## 5. Configurazione e taratura

| Costante | File | Default | Note |
|---|---|---|---|
| `PANEL_DISTANCE_M` | `lib/xrPdfViewer.ts` | 1.05 | distanza del pannello |
| `PANEL_YAW_DEG` | idem | 38 | rotazione verso sinistra |
| `PANEL_HEIGHT_M` | idem | 1.15 | altezza a zoom 1 |
| `QUAD_EXTENT_FACTOR` | idem | 0.5 | **da verificare sul dispositivo** (vedi sotto) |
| `PAGE_TEXTURE_HEIGHT` | `lib/pdfRaster.ts` | 2400 | risoluzione di rasterizzazione |

`QUAD_EXTENT_FACTOR`: la spec descrive `XRQuadLayer.width/height` come dimensioni in metri,
ma diverse implementazioni le trattano come semi-estensioni. Con 0.5 il pannello esce alto
`PANEL_HEIGHT_M` nel secondo caso e la metà nel primo — comunque leggibile e ingrandibile
con lo stick. Se sul Quest risulta piccolo, portare la costante a `1.0`.

### Asset pdf.js

Worker, cmaps, standard fonts, moduli wasm (JBIG2/JPEG2000 dei manuali scansionati) e
profili ICC vengono copiati in `frontend/public/pdfjs/` da
`scripts/copy_pdfjs_assets.mjs`, agganciato agli script `dev`, `build` e `build:desktop`.
La cartella è in `.gitignore`: si rigenera a ogni build. Il percorso statico same-origin
tiene il worker compatibile con la CSP (`worker-src 'self' blob:` in `next.config.ts`).

## 5-bis. Installazione come app del Meta Quest

`/xr` si installa sul visore come **web app a sé**, distinta dall'app principale:

| | App principale | Visore XR |
|---|---|---|
| manifest | `/manifest.json` | `/xr-manifest.webmanifest` |
| `id` | `maintai-enterprise-v3` | `maintai-xr-viewer` |
| `start_url` | `/` | `/xr` |
| `display` | `standalone` | `fullscreen` |
| icone | `icons/icon-*.png` | `icons/xr-icon-*.png` |

`id` e manifest diversi producono **due voci separate** nella libreria del Quest: quella
XR parte a tutto schermo direttamente sul visore, senza barra del browser né dashboard.
Il manifest è agganciato solo alle rotte `/xr` da `frontend/app/xr/layout.tsx`
(`metadata.manifest`), quindi le altre pagine continuano a installare l'app principale.

Dal browser del visore: **menu ⋮ → Installa**. Quando il browser espone
`beforeinstallprompt` (Chromium, quindi anche il browser del Quest) la pagina mostra un
pulsante *Installa MaintAI XR* che apre direttamente il dialogo di sistema.

Dettagli che contano:

- `scope` resta `/` di proposito. Login e rotte asset stanno fuori da `/xr`: con uno scope
  più stretto la navigazione uscirebbe dalla finestra dell'app riaprendo la barra del browser.
- Il service worker è già quello dell'app (`/sw.js`, scope `/`, registrato da `RootShell`):
  non ne serve un secondo perché l'app risulti installabile.
- Gli asset di pdf.js (`/pdfjs/*`) sono ora in cache-first nel service worker: sono
  immutabili a parità di deploy, e così un manuale si apre anche con rete instabile in reparto.
- Le icone si rigenerano con `node scripts/generate_xr_icons.mjs` (usa `sharp`, che arriva
  con le dipendenze del frontend). Le PNG prodotte **vanno committate**: il build di Vercel
  non le rigenera.

Resta una **web app**, non un pacchetto nativo: gira nel runtime del browser del visore.
È distribuibile sullo Horizon Store come *Web App*; un'app nativa (Unity/OpenXR, APK
firmato) sarebbe un binario separato con un'altra pipeline, non un'evoluzione di questo
codice.

## 6. Requisiti

- **HTTPS** (o `localhost`): WebXR e `getUserMedia` richiedono un contesto sicuro.
- Header `Permissions-Policy: xr-spatial-tracking=(self)` — già impostato in `next.config.ts`.
- Utente autenticato: il PDF viene scaricato da `/assets/{id}/documenti/{doc}/file` con il
  cookie di sessione, quindi vale il normale isolamento per tenant.

## 7. Limiti noti del prototipo

- Nessuna interazione puntatore sul pannello (niente scroll continuo, zoom su regione,
  ricerca testo): la navigazione è per pagina.
- Un solo pannello alla volta; il cambio documento riusa lo stesso layer, quindi un PDF con
  proporzioni diverse viene incorniciato (letterbox) invece di ridimensionare il pannello.
- Nessun ancoraggio spaziale (`anchors`): in modalità `fisso` il pannello resta fermo
  rispetto allo spazio di riferimento della sessione, non rispetto alla macchina.
- L'occlusione dipende dalla depth map del visore: bassa risoluzione, quindi il bordo fra
  pannello e mano è approssimato di qualche centimetro. Se il visore non espone
  `depth-sensing` la UI lo dichiara e il pannello resta sopra al mondo reale.
- L'ancoraggio `testa` è rigido (segue anche inclinazione e rollio della testa, come ogni
  HUD). Un inseguimento "morbido" — zona morta più smorzamento, che lascia scorrere la
  pagina con gli occhi prima di trascinare il pannello — è un'aggiunta naturale se alla
  prova sul campo il vincolo rigido risulta pesante nelle letture lunghe.
- La scansione continua in XR dipende dall'accesso alla fotocamera del browser del visore:
  va verificata sul dispositivo, non è garantita dalla spec. Se il visore non espone
  fotocamere alle pagine web, **nessun decoder può funzionare** — è un limite di
  piattaforma, non del codice. Lo scanner mostra ora una riga diagnostica (decoder in uso,
  risoluzione, frame analizzati) e, in caso di errore, il **nome** dell'eccezione
  `getUserMedia` più il numero di `videoinput` rilevati: `NotFoundError` con `videoinput: 0`
  significa che il dispositivo non espone alcuna fotocamera, e insistere sulla scansione è
  inutile. In quel caso il manuale va scelto dalla pagina prima di entrare in XR.
