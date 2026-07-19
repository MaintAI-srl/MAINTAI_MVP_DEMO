import type { Viewport } from "next";
import { Inter, Space_Grotesk, JetBrains_Mono } from "next/font/google";
import "./globals.css";
import { cn } from "@/lib/utils";
import RootShell from "./RootShell";

const inter = Inter({ subsets: ["latin"], variable: "--font-sans", display: "swap" });
const spaceGrotesk = Space_Grotesk({ subsets: ["latin"], variable: "--font-display", display: "swap" });
const jetbrainsMono = JetBrains_Mono({
  subsets: ["latin"],
  variable: "--font-mono",
  display: "swap",
  weight: ["400", "500", "600"],
});

/**
 * Il post-build riscrive il viewport statico dei telefoni a width=430 senza
 * initial-scale. Questo export mantiene il solo colore tema, evitando che Next
 * reintroduca una configurazione viewport incompatibile con quella correzione.
 */
export const viewport: Viewport = {
  themeColor: "#f5f7fb",
};

// Tema e classe dispositivo vengono applicati prima del paint. La classe e il
// fallback CSS restano efficaci anche quando un browser mobile espone una
// viewport desktop; ViewportController li riallinea dopo l'hydration.
const bootstrapScript = `
  (function() {
    try {
      var root = document.documentElement;
      var t = localStorage.getItem('maintai_theme');
      root.setAttribute('data-theme', (t === 'dark' || t === 'light') ? t : 'light');

      var vw = Math.round((window.visualViewport && window.visualViewport.width) || window.innerWidth || 0);
      var ua = navigator.userAgent || '';
      var touches = navigator.maxTouchPoints || 0;
      var coarse = !!(window.matchMedia && window.matchMedia('(pointer: coarse)').matches);
      var phone = /Mobi|iPhone|iPod|Windows Phone/i.test(ua) || (/Android/i.test(ua) && /Mobile/i.test(ua));
      var tablet = /iPad|Tablet|PlayBook|Silk/i.test(ua) || (/Android/i.test(ua) && !/Mobile/i.test(ua)) || (/Macintosh/i.test(ua) && touches > 1);
      var dpr = window.devicePixelRatio || 1;
      var minPhys = window.screen ? Math.min(window.screen.width, window.screen.height) * dpr : 0;
      var portableTouch = coarse || phone || tablet;
      var deviceClass = (vw <= 640 || phone || (portableTouch && !tablet && minPhys > 0 && minPhys <= 1500))
        ? 'mobile'
        : ((vw <= 1024 || tablet || (portableTouch && minPhys > 1500)) ? 'tablet' : 'desktop');
      root.setAttribute('data-device-class', deviceClass);
    } catch(e) {}
  })();
`;

// Normalizza tutti i meta viewport: telefono portrait -> width=430 senza
// initial-scale; tablet portrait -> 768; landscape/non-touch -> device-width.
const viewportRelaxScript = `(function(){try{var touch=(navigator.maxTouchPoints>0)||('ontouchstart' in window)||(window.matchMedia&&window.matchMedia('(pointer: coarse)').matches);function want(){var landscape=window.matchMedia&&window.matchMedia('(orientation: landscape)').matches;if(!touch||landscape)return 'width=device-width, initial-scale=1, viewport-fit=cover';var dpr=window.devicePixelRatio||1;var minDimPhys=window.screen?Math.min(screen.width,screen.height)*dpr:0;return 'width='+(minDimPhys>1500?768:430)+', viewport-fit=cover';}function apply(){try{var w=want();var ms=document.querySelectorAll('meta[name="viewport"]');for(var i=0;i<ms.length;i++){if(ms[i].getAttribute('content')!==w)ms[i].setAttribute('content',w);}}catch(e){}}apply();window.addEventListener('orientationchange',function(){setTimeout(apply,300);});}catch(e){}})();`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html
      lang="it"
      suppressHydrationWarning
      className={cn("font-sans", inter.variable, spaceGrotesk.variable, jetbrainsMono.variable)}
    >
      <head>
        <title>MaintAI — Centro di Controllo</title>
        <link rel="manifest" href="/manifest.json" />
        <meta name="apple-mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
        <meta name="apple-mobile-web-app-title" content="MaintAI" />
        <link rel="apple-touch-icon" sizes="180x180" href="/icons/apple-touch-icon.png" />
        <meta name="mobile-web-app-capable" content="yes" />
        <meta name="application-name" content="MaintAI" />
        <script dangerouslySetInnerHTML={{ __html: bootstrapScript }} />
      </head>
      <body>
        <script dangerouslySetInnerHTML={{ __html: viewportRelaxScript }} />
        <RootShell>{children}</RootShell>
      </body>
    </html>
  );
}
