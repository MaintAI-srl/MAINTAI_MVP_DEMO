"use client";

import { useEffect } from "react";

/**
 * Normalizzatore viewport "app-like".
 *
 * Alcuni telefoni (specie Android di fascia media/economica) riportano una
 * viewport CSS larga (~700-800px) e disegnano tutta l'interfaccia in piccolo
 * sullo schermo fisico. Qui, sui dispositivi touch in verticale con viewport
 * larga, fissiamo una larghezza di design (430px): il browser riflette il
 * layout a 430px e lo scala verso l'alto → UI grande, "come un'app nativa".
 *
 * Uno script inline in <head> (layout.tsx) fa lo stesso pre-paint per evitare
 * il flash; questo componente RI-AFFERMA il valore dopo l'hydration di React
 * (che altrimenti potrebbe ripristinare il meta al valore dell'HTML server) e
 * lo aggiorna al cambio di orientamento.
 *
 * La decisione usa una larghezza "naturale" catturata UNA volta (stashata su
 * window.__mvVW dallo script inline): così i re-apply sono idempotenti e non
 * innescano loop quando il cambio di viewport modifica innerWidth.
 */
const DESIGN_WIDTH = 430;

declare global {
  interface Window { __mvVW?: number }
}

export default function ViewportController() {
  useEffect(() => {
    const meta = document.querySelector('meta[name="viewport"]') as HTMLMetaElement | null;
    if (!meta) return;

    const natural =
      window.__mvVW ||
      document.documentElement.clientWidth ||
      window.innerWidth ||
      0;
    window.__mvVW = natural;

    const apply = () => {
      const coarse = !window.matchMedia || window.matchMedia("(pointer: coarse)").matches;
      const landscape = !!window.matchMedia && window.matchMedia("(orientation: landscape)").matches;
      const want =
        coarse && !landscape && natural > 470 && natural < 1024
          ? `width=${DESIGN_WIDTH}, viewport-fit=cover`
          : "width=device-width, initial-scale=1, viewport-fit=cover";
      if (meta.getAttribute("content") !== want) meta.setAttribute("content", want);
    };

    apply();
    const onOrient = () => setTimeout(apply, 350);
    window.addEventListener("orientationchange", onOrient);
    return () => window.removeEventListener("orientationchange", onOrient);
  }, []);

  return null;
}
