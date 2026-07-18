import type { Viewport } from "next";
import { Inter, Space_Grotesk, JetBrains_Mono } from "next/font/google";
import "./globals.css";
import { cn } from "@/lib/utils";
import RootShell from "./RootShell";

const inter = Inter({ subsets: ['latin'], variable: '--font-sans', display: 'swap' });
const spaceGrotesk = Space_Grotesk({ subsets: ['latin'], variable: '--font-display', display: 'swap' });
const jetbrainsMono = JetBrains_Mono({ subsets: ['latin'], variable: '--font-mono', display: 'swap', weight: ['400','500','600'] });

/**
 * Viewport "app-like": larghezza di design fissa 430px sui telefoni.
 *
 * Storia del bug (3 giorni di tentativi) e causa radice DEFINITIVA:
 * Next.js inietta SEMPRE il proprio meta viewport `width=device-width,
 * initial-scale=1` (non è disattivabile: anche con `export const viewport`
 * Next fonde il default `initialScale: 1`). Con `initial-scale=1` il browser
 * calcola la larghezza di layout come max(width, larghezza-ideale-device):
 * sul telefono dell'utente la larghezza ideale è ~860px → qualunque
 * `width=430` viene annullato e la UI resta minuscola. Verificato con
 * emulazione Chromium:
 *   width=430 (SENZA initial-scale) → innerWidth 430  ✅ (UI grande)
 *   width=430, initial-scale=1      → innerWidth 813  ❌
 *   width=430, initial-scale=0      → innerWidth 3252 ❌ (valore invalido)
 * Inoltre il browser del dispositivo IGNORA le modifiche al meta via JS dopo
 * il load (setAttribute non riflette), quindi non basta correggerlo a runtime.
 *
 * Soluzione a due livelli:
 *  1. STATICA (decisiva sul device): uno step di post-build
 *     (`scripts/patch-viewport.mjs`) riscrive nell'HTML prerenderizzato il
 *     meta di Next in `width=430, viewport-fit=cover` (SENZA initial-scale),
 *     così il PRIMO meta che il browser parsa al load è già corretto — anche
 *     sui browser che ignorano i cambi via JS. `/login` e `/mobile` (gli entry
 *     point del tecnico) sono statici, quindi coperti; la viewport impostata
 *     al primo load persiste per tutta la sessione SPA.
 *  2. RUNTIME (browser che onorano i cambi JS + route dinamiche): lo script
 *     inline qui sotto + `ViewportController` normalizzano TUTTI i meta
 *     viewport (React in idratazione ne ri-aggiunge uno con initial-scale=1)
 *     e rilassano a device-width in landscape/non-touch e a 768 sui tablet.
 * I browser desktop ignorano del tutto il meta viewport → desktop invariato.
 */
export const viewport: Viewport = {
  themeColor: "#f5f7fb",
};


const themeScript = `
  (function() {
    try {
      var t = localStorage.getItem('maintai_theme');
      document.documentElement.setAttribute('data-theme', (t === 'dark' || t === 'light') ? t : 'light');
    } catch(e) {}
  })();
`;

// Normalizza TUTTI i meta viewport (non solo l'ultimo): telefono portrait →
// width=430 SENZA initial-scale (app-like); landscape/non-touch → device-width;
// tablet portrait → 768. Sui browser che onorano i cambi JS agisce pre-paint.
const viewportRelaxScript = `(function(){try{var touch=(navigator.maxTouchPoints>0)||('ontouchstart' in window)||(window.matchMedia&&window.matchMedia('(pointer: coarse)').matches);function want(){var landscape=window.matchMedia&&window.matchMedia('(orientation: landscape)').matches;if(!touch||landscape)return 'width=device-width, initial-scale=1, viewport-fit=cover';var dpr=window.devicePixelRatio||1;var minDimPhys=window.screen?Math.min(screen.width,screen.height)*dpr:0;return 'width='+(minDimPhys>1500?768:430)+', viewport-fit=cover';}function apply(){try{var w=want();var ms=document.querySelectorAll('meta[name="viewport"]');for(var i=0;i<ms.length;i++){if(ms[i].getAttribute('content')!==w)ms[i].setAttribute('content',w);}}catch(e){}}apply();window.addEventListener('orientationchange',function(){setTimeout(apply,300);});}catch(e){}})();`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="it" suppressHydrationWarning className={cn("font-sans", inter.variable, spaceGrotesk.variable, jetbrainsMono.variable)}>
      <head>
        <title>MaintAI — Centro di Controllo</title>
        <link rel="manifest" href="/manifest.json" />
        <meta name="apple-mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
        <meta name="apple-mobile-web-app-title" content="MaintAI" />
        <link rel="apple-touch-icon" sizes="180x180" href="/icons/apple-touch-icon.png" />
        <meta name="mobile-web-app-capable" content="yes" />
        <meta name="application-name" content="MaintAI" />
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body>
        {/* Normalizzatore viewport a inizio <body> (pre-paint) per i browser
            che onorano i cambi via JS. La correzione DECISIVA per i telefoni
            che ignorano i cambi JS avviene invece nell'HTML statico via
            scripts/patch-viewport.mjs (post-build). */}
        <script dangerouslySetInnerHTML={{ __html: viewportRelaxScript }} />
        <RootShell>{children}</RootShell>
      </body>
    </html>
  );
}
