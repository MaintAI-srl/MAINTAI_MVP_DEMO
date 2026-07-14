/**
 * MaintAI Service Worker v3.2
 *
 * Strategie cache:
 *   - HTML / bundle Next.js → Network-only (sempre aggiornati dal deploy Vercel)
 *   - API GET selezionate   → Network-First con fallback cache (offline tecnico)
 *   - Push notifications    → riceve messaggi push dal backend, mostra notifiche native
 *
 * Cachea per uso offline (tecnico sul campo):
 *   - GET /tickets (snapshot interventi)
 *   - GET /assets  (catalogo asset)
 *   - GET /assets/{id}/kpi, /assets/{id}/storico, /storico/*
 *   - GET /tecnici/me (profilo)
 *   - GET /scadenze/imminenti
 *   - GET /mobile (shell app tecnico)
 *
 * NON cachea mai:
 *   - POST/PUT/PATCH/DELETE
 *   - Autenticazione
 *   - AI/planning (dati sempre freschi)
 */

const CACHE_NAME = "maintai-v3.2";

const CACHEABLE_API_PATTERNS = [
  /\/tickets(\?|$)/,
  /\/assets(\?|$)/,
  /\/assets\/\d+(\/kpi|\/storico|\/check-primo-livello|$)/,
  /\/storico\//,
  /\/tecnici\/me(\?|$)/,
  /\/scadenze\/imminenti/,
];

const NEVER_CACHE_PATTERNS = [
  /\/auth\//,
  /\/planning\//,
  /\/diagnostic/,
  /\/problem-analysis/,
  /\/manuali\/\d+\/analisi/,
  /\/emergency\//,
  /\/ws\//,
  /\/report\//,
];

// ── Install ───────────────────────────────────────────────────────────────────
self.addEventListener("install", (event) => {
  console.log("[MaintAI SW] v3.2 installing...");
  self.skipWaiting();
  event.waitUntil(caches.open(CACHE_NAME).then(() => {}));
});

// ── Activate — pulisce cache obsolete ────────────────────────────────────────
self.addEventListener("activate", (event) => {
  console.log("[MaintAI SW] v3.2 activating...");
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(
        keys.filter((k) => k !== CACHE_NAME).map((k) => {
          console.log("[MaintAI SW] Cache obsoleta rimossa:", k);
          return caches.delete(k);
        })
      ))
      .then(() => self.clients.claim())
  );
});

// ── Fetch — Network-First per API cacheabili ──────────────────────────────────
self.addEventListener("fetch", (event) => {
  const { request } = event;
  const url = new URL(request.url);

  if (request.method !== "GET") return;
  if (!url.protocol.startsWith("http")) return;
  if (request.cache === "no-store" || request.headers.get("Cache-Control")?.includes("no-store")) return;

  // HTML e bundle Next.js: sempre dalla rete
  if (
    request.mode === "navigate" ||
    request.destination === "document" ||
    url.pathname === "/" ||
    url.pathname.startsWith("/_next/")
  ) {
    event.respondWith(fetch(request, { cache: "no-store" }).catch(() => offlinePage()));
    return;
  }

  // API cacheabili
  const isApi = !url.pathname.startsWith("/_next/") && (
    url.origin !== self.location.origin || url.pathname.startsWith("/api/")
  );
  if (isApi) {
    if (NEVER_CACHE_PATTERNS.some((p) => p.test(url.pathname))) return;
    if (CACHEABLE_API_PATTERNS.some((p) => p.test(url.pathname + url.search))) {
      event.respondWith(networkFirstWithCache(request));
      return;
    }
    return; // pass-through
  }

  // Risorse statiche (immagini, font, ecc.)
  event.respondWith(fetch(request).catch(() => caches.match(request)));
});

async function networkFirstWithCache(request) {
  try {
    const res = await fetch(request);
    if (res.ok) {
      const cache = await caches.open(CACHE_NAME);
      cache.put(request, res.clone());
    }
    return res;
  } catch {
    const cached = await caches.match(request);
    if (cached) {
      console.log("[MaintAI SW] Offline — da cache:", request.url);
      return cached;
    }
    return new Response(
      JSON.stringify({ error: true, offline: true, message: "Dispositivo offline — dati non disponibili nella cache locale." }),
      { status: 503, headers: { "Content-Type": "application/json" } }
    );
  }
}

function offlinePage() {
  return new Response(
    `<!DOCTYPE html>
<html lang="it">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>MaintAI — Offline</title>
  <style>
    *{box-sizing:border-box;margin:0;padding:0}
    body{background:#020617;color:#e2e8f0;font-family:system-ui,sans-serif;
         display:flex;flex-direction:column;align-items:center;justify-content:center;
         min-height:100dvh;text-align:center;padding:32px 20px;gap:16px}
    .icon{font-size:52px}
    h1{font-size:22px;font-weight:800;color:#60a5fa}
    p{font-size:14px;color:#94a3b8;max-width:340px;line-height:1.6}
    button{margin-top:8px;padding:14px 32px;background:#2563eb;color:#fff;
           border:none;border-radius:10px;font-size:15px;font-weight:700;
           cursor:pointer;letter-spacing:.02em}
    .badge{font-size:11px;color:#475569;margin-top:24px;letter-spacing:.08em;text-transform:uppercase}
  </style>
</head>
<body>
  <div class="icon">📡</div>
  <h1>Connessione assente</h1>
  <p>MaintAI non riesce a raggiungere il server.<br>
     I tuoi dati in cache sono ancora disponibili se li hai visitati di recente.</p>
  <button onclick="location.reload()">↺ Riprova</button>
  <div class="badge">MaintAI — Sistema di Gestione Manutenzione</div>
</body>
</html>`,
    { status: 503, headers: { "Content-Type": "text/html" } }
  );
}

// ── Push Notifications ────────────────────────────────────────────────────────
self.addEventListener("push", (event) => {
  let data = { title: "MaintAI", body: "Nuovo aggiornamento disponibile.", tag: "maintai-generic" };
  try {
    if (event.data) data = { ...data, ...event.data.json() };
  } catch {}

  const options = {
    body: data.body,
    tag: data.tag ?? "maintai-generic",
    icon: "/icons/icon-192.png",
    badge: "/icons/icon-96.png",
    vibrate: data.tag === "emergenza" ? [500, 150, 500, 150, 800] : [200, 100, 200],
    requireInteraction: data.tag === "emergenza", // emergenza rimane finché non viene toccata
    data: { url: data.url ?? "/mobile", tag: data.tag },
    actions: data.tag === "emergenza"
      ? [{ action: "open", title: "🚨 Apri emergenza" }]
      : [{ action: "open", title: "Apri" }],
  };

  event.waitUntil(self.registration.showNotification(data.title, options));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const targetUrl = event.notification.data?.url ?? "/mobile";

  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clients) => {
      // Porta in primo piano un tab già aperto se esiste
      for (const client of clients) {
        if (client.url.includes(self.location.origin) && "focus" in client) {
          client.focus();
          client.navigate(targetUrl);
          return;
        }
      }
      // Altrimenti apri nuova finestra
      if (self.clients.openWindow) return self.clients.openWindow(targetUrl);
    })
  );
});
