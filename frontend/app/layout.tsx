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
 * Storia del bug: il root layout era un client component senza export
 * `viewport`, quindi Next appendeva il SUO meta default
 * `width=device-width, initial-scale=1` DOPO qualsiasi meta manuale — e i
 * browser applicano l'ULTIMO meta viewport → ogni tentativo di scaling era
 * annullato e sui telefoni con viewport CSS larga (~800-1200px) la UI era
 * minuscola. Next appende comunque il proprio meta per ultimo (e vi forza
 * initial-scale=1, che farebbe vincere la larghezza schermo su width=430),
 * perciò la normalizzazione avviene con lo script a inizio <body>: parsato
 * dopo tutti i meta, riscrive l'ultimo pre-paint.
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

// Rilassa il viewport dove 430 non va bene (solo browser che onorano i
// cambi dinamici): non-touch/landscape → device-width, tablet → 768.
// Agisce sull'ULTIMO meta viewport: è quello che i browser applicano.
const viewportRelaxScript = `(function(){try{var ms=document.querySelectorAll('meta[name="viewport"]');var m=ms[ms.length-1];if(!m)return;var touch=(navigator.maxTouchPoints>0)||('ontouchstart' in window)||(window.matchMedia&&window.matchMedia('(pointer: coarse)').matches);function apply(){try{var landscape=window.matchMedia&&window.matchMedia('(orientation: landscape)').matches;var dpr=window.devicePixelRatio||1;var minDimPhys=window.screen?Math.min(screen.width,screen.height)*dpr:0;var want=(!touch||landscape)?'width=device-width, initial-scale=1, viewport-fit=cover':('width='+(minDimPhys>1500?768:430)+', viewport-fit=cover');if(m.getAttribute('content')!==want)m.setAttribute('content',want);}catch(e){}}apply();window.addEventListener('orientationchange',function(){setTimeout(apply,350);});}catch(e){}})();`;

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
        {/* ⚡ FIX DIMENSIONAMENTO MOBILE (definitivo) — meta viewport statico a
            INIZIO BODY. React 19 fa l'hoisting nell'<head> di ogni <meta> reso
            come JSX, MA il contenuto iniettato con dangerouslySetInnerHTML NON
            viene hoistato: resta nel body, parsato DOPO tutti i meta dell'head
            (incluso quello che Next appende con initial-scale=1). I browser
            mobili applicano l'ULTIMO meta viewport → vince width=430 e la UI
            viene scalata "app-like" SENZA dipendere da JS (verificato sul
            campo: il browser del dispositivo ignora setAttribute sul meta, ma
            onora il meta statico servito dall'HTML). Desktop ignora del tutto
            il meta viewport → invariato. */}
        <div
          style={{ display: "none" }}
          dangerouslySetInnerHTML={{
            __html: '<meta name="viewport" content="width=430, viewport-fit=cover">',
          }}
        />
        {/* Rilassa il viewport dove 430 non va bene (landscape/non-touch →
            device-width, tablet → 768) sui browser che onorano i cambi via JS.
            Parsato dopo il meta statico, agisce sull'ultimo meta. */}
        <script dangerouslySetInnerHTML={{ __html: viewportRelaxScript }} />
        <RootShell>{children}</RootShell>
      </body>
    </html>
  );
}
