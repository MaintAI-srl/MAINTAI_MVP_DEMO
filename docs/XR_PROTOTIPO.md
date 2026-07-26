# Prototipo XR — manuale PDF nel visore (Meta Quest 3)

Prototipo della pagina `/xr`: il tecnico inquadra il QR code sulla macchina, entra in
realtà mista dal browser del visore e si vede il manuale PDF su un pannello **alla propria
sinistra**, con la macchina sempre visibile in passthrough.

Modulo: `xr_viewer` — **disattivato di default**, si abilita per tenant da
*Impostazioni → Funzionalità*.

---

## 1. Flusso utente

1. `/xr` sul browser del Quest 3 (o su qualsiasi Chromium con emulatore WebXR).
2. **Scansiona QR** — la pagina accetta:
   - QR asset generati da `backend/services/qr_service.py` (`<app>/asset?id=<n>`);
   - QR pubblici del check di primo livello (`<app>/check/<token>`);
   - codice asset o ID digitato a mano (fallback se manca `BarcodeDetector`).
3. Scelta del PDF fra i documenti dell'asset (`GET /assets/{id}/documenti`, filtrati per PDF).
   Con un solo PDF il passaggio è automatico.
4. La prima pagina viene rasterizzata **prima** di entrare in XR: serve per l'anteprima e
   perché `requestSession()` va chiamata dentro il gesto utente, senza `await` intermedi.
5. **Entra in XR** → sessione `immersive-ar`, pannello posizionato a 1,05 m, ruotato di 38°
   verso sinistra rispetto alla direzione dello sguardo al momento dell'ingresso.

## 2. Comandi nel visore

| Controller | Azione |
|---|---|
| Stick ← / → | pagina precedente / successiva |
| Stick ↑ / ↓ | ingrandisci / rimpicciolisci il pannello (0,55× – 2,6×) |
| Grilletto | pagina successiva |
| Grip laterale | pagina precedente |
| A / X | riporta il pannello alla sinistra dello sguardo corrente |
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
- Nessun ancoraggio spaziale (`anchors`): il pannello resta fermo rispetto allo spazio di
  riferimento della sessione, non rispetto alla macchina.
- La scansione continua in XR dipende dall'accesso alla fotocamera del browser del visore:
  va verificata sul dispositivo, non è garantita dalla spec.
