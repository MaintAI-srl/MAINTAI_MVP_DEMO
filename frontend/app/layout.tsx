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
 * Viewport standard: le pagine mobile vivono nella sezione dedicata /m,
 * progettata nativamente per schermi piccoli. Nessun hack di scaling.
 */
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#f5f7fb",
};

// Tema e classe dispositivo vengono applicati prima del paint;
// ViewportController riallinea la classe dopo l'hydration.
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
        <RootShell>{children}</RootShell>
      </body>
    </html>
  );
}
