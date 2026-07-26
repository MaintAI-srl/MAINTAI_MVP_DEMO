import type { Metadata, Viewport } from "next";

/**
 * Il visore XR si installa sul Meta Quest come **web app a sé**, separata da
 * quella principale (`/manifest.json`): manifest e `id` diversi producono due
 * voci distinte nella libreria del visore, e questa parte direttamente su `/xr`
 * a tutto schermo invece che sulla dashboard.
 *
 * `scope` resta `/` di proposito: il login e le rotte asset stanno fuori da
 * `/xr`, e con uno scope più stretto uscirebbero dalla finestra dell'app
 * riaprendo la barra del browser.
 *
 * Il service worker è già registrato da RootShell (`/sw.js`, scope `/`), quindi
 * l'app risulta installabile senza registrarne un secondo.
 */
export const metadata: Metadata = {
  title: "Visore XR · MaintAI",
  description:
    "Manuale PDF in realtà mista sul visore: QR asset, sessione WebXR immersive-ar, pannello agganciato allo sguardo.",
  manifest: "/xr-manifest.webmanifest",
  appleWebApp: {
    capable: true,
    title: "MaintAI XR",
    statusBarStyle: "black-translucent",
  },
};

export const viewport: Viewport = {
  themeColor: "#0a0f1e",
  viewportFit: "cover",
};

export default function XrLayout({ children }: { children: React.ReactNode }) {
  return children;
}
