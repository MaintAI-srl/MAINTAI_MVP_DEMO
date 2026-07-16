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
      window.innerWidth ||
      document.documentElement.clientWidth ||
      0;
    window.__mvVW = natural;
    // Diagnostica: leggibile su window.__mvVW / attributo body senza clutter UI
    try { document.body.setAttribute("data-vw", String(natural)); } catch {}

    const apply = () => {
      const coarse = !window.matchMedia || window.matchMedia("(pointer: coarse)").matches;
      const landscape = !!window.matchMedia && window.matchMedia("(orientation: landscape)").matches;
      // Nessun tetto stretto: molti telefoni riportano una viewport CSS larga
      // (fino a ~1220px con DPR≈1) e prima venivano esclusi → restavano piccoli.
      const want =
        coarse && !landscape && natural > 470 && natural < 1600
          ? `width=${DESIGN_WIDTH}, viewport-fit=cover`
          : "width=device-width, initial-scale=1, viewport-fit=cover";
      if (meta.getAttribute("content") !== want) meta.setAttribute("content", want);
      // Diagnostica temporanea visibile (rimuovere dopo conferma)
      try {
        const dbg = document.getElementById("mv-dbg");
        if (dbg) dbg.textContent = `vw ${natural}→${want.split(",")[0]}`;
      } catch {}
    };

    // Ri-applica in modo aggressivo: dopo l'hydration di React (che può
    // ripristinare il meta), su ripresa PWA e al cambio orientamento.
    apply();
    const t1 = window.setTimeout(apply, 150);
    const t2 = window.setTimeout(apply, 600);
    const onOrient = () => setTimeout(apply, 350);
    const onShow = () => apply();
    const onVis = () => { if (document.visibilityState === "visible") apply(); };
    window.addEventListener("orientationchange", onOrient);
    window.addEventListener("pageshow", onShow);
    document.addEventListener("visibilitychange", onVis);
    return () => {
      window.clearTimeout(t1);
      window.clearTimeout(t2);
      window.removeEventListener("orientationchange", onOrient);
      window.removeEventListener("pageshow", onShow);
      document.removeEventListener("visibilitychange", onVis);
    };
  }, []);

  // Diagnostica temporanea: mostra la larghezza CSS rilevata e il viewport
  // applicato. Serve a confermare il fix sul dispositivo reale; da rimuovere.
  return (
    <span
      id="mv-dbg"
      style={{
        position: "fixed",
        left: 3,
        bottom: 3,
        zIndex: 2147483647,
        fontSize: 9,
        lineHeight: 1,
        color: "rgba(148,163,184,0.55)",
        pointerEvents: "none",
        fontFamily: "monospace",
      }}
    />
  );
}
