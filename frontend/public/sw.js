/**
 * MaintAI Service Worker v2.0
 *
 * Strategia: Network-First con fallback cache per le risorse statiche.
 * Per le API: cache-then-network solo per GET su endpoint specifici (ticket, assets).
 *
 * NON cachea:
 * - POST/PUT/PATCH/DELETE (mutazioni)
 * - Endpoint di autenticazione
 * - Endpoint AI/planning (dati sempre freschi)
 *
 * Cachea per uso offline (tecnico sul campo):
 * - App shell (HTML, CSS, JS, immagini)
 * - GET /tickets (ultimo snapshot)
 * - GET /assets (catalogo asset)
 * - GET /tecnici/me (profilo tecnico)
 */

const CACHE_NAME = "maintai-v2.1";
const STATIC_CACHE = "maintai-static-v2.1";

// Risorse dell'app shell da pre-cachare all'installazione
const APP_SHELL = [
  "/",
  "/logo.png",
  "/manifest.json",
];

// Pattern di URL API che possono essere cachati per uso offline
const CACHEABLE_API_PATTERNS = [
  /\/tickets\?/,
  /\/assets$/,
  /\/tecnici\/me/,
  /\/scadenze\/imminenti/,
];

// Pattern da NON cachare mai
const NEVER_CACHE_PATTERNS = [
  /\/auth\//,
  /\/planning\//,
  /\/diagnostic/,
  /\/problem-analysis/,
  /\/manuali\/\d+\/analisi/,
  /\/ws\//,
];

self.addEventListener("install", (event) => {
  console.log("[MaintAI SW] Installing v2.1...");
  event.waitUntil(
    caches.open(STATIC_CACHE).then((cache) => {
      return cache.addAll(APP_SHELL).catch((err) => {
        console.warn("[MaintAI SW] Pre-cache parziale:", err);
      });
    })
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  console.log("[MaintAI SW] Activating v2.1...");
  // Pulizia vecchie cache
  event.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys
          .filter((k) => k !== CACHE_NAME && k !== STATIC_CACHE)
          .map((k) => {
            console.log("[MaintAI SW] Eliminata cache obsoleta:", k);
            return caches.delete(k);
          })
      );
    })
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // Solo GET
  if (request.method !== "GET") return;

  // Ignora richieste non-http (chrome-extension, ecc.)
  if (!url.protocol.startsWith("http")) return;

  // API calls
  if (url.pathname.startsWith("/api/") || url.origin !== self.location.origin) {
    // Controlla se è un endpoint che non va mai cachato
    if (NEVER_CACHE_PATTERNS.some((p) => p.test(url.pathname))) {
      return;
    }

    // Controlla se è un endpoint cacheabile
    if (CACHEABLE_API_PATTERNS.some((p) => p.test(url.pathname + url.search))) {
      event.respondWith(networkFirstWithCache(request));
      return;
    }

    // API non cachabile: pass-through
    return;
  }

  // Risorse statiche (app shell): network-first con fallback cache
  event.respondWith(networkFirstWithCache(request));
});

/**
 * Network-First: prova la rete, se fallisce serve dalla cache.
 * Se la rete risponde, aggiorna la cache per il prossimo utilizzo offline.
 */
async function networkFirstWithCache(request) {
  try {
    const networkResponse = await fetch(request);

    // Salva in cache solo risposte valide
    if (networkResponse.ok) {
      const cache = await caches.open(CACHE_NAME);
      cache.put(request, networkResponse.clone());
    }

    return networkResponse;
  } catch (err) {
    // Rete non disponibile: cerca nella cache
    const cached = await caches.match(request);
    if (cached) {
      console.log("[MaintAI SW] Offline — servito da cache:", request.url);
      return cached;
    }

    // Nessuna cache disponibile: ritorna risposta offline personalizzata
    if (request.headers.get("Accept")?.includes("text/html")) {
      return new Response(
        `<!DOCTYPE html>
        <html lang="it">
        <head>
          <meta charset="utf-8">
          <meta name="viewport" content="width=device-width, initial-scale=1">
          <title>MaintAI — Offline</title>
          <style>
            body {
              margin: 0; padding: 40px; font-family: system-ui, sans-serif;
              background: #020617; color: #e2e8f0; display: flex;
              flex-direction: column; align-items: center; justify-content: center;
              min-height: 100vh; text-align: center;
            }
            .icon { font-size: 48px; margin-bottom: 16px; }
            h1 { font-size: 20px; margin: 0 0 8px; color: #60a5fa; }
            p { font-size: 14px; color: #94a3b8; max-width: 360px; line-height: 1.5; }
            button {
              margin-top: 24px; padding: 12px 24px; background: #3b82f6;
              color: white; border: none; border-radius: 8px; font-size: 14px;
              font-weight: 600; cursor: pointer;
            }
          </style>
        </head>
        <body>
          <div class="icon">📡</div>
          <h1>Connessione assente</h1>
          <p>MaintAI non riesce a raggiungere il server. Verifica la connessione e riprova.</p>
          <button onclick="location.reload()">Riprova</button>
        </body>
        </html>`,
        { headers: { "Content-Type": "text/html" }, status: 503 }
      );
    }

    // Per API calls senza cache: errore JSON
    return new Response(
      JSON.stringify({ error: true, message: "Dispositivo offline — dati non disponibili nella cache locale." }),
      { headers: { "Content-Type": "application/json" }, status: 503 }
    );
  }
}
