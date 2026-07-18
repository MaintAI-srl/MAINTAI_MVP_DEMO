"use client";

import { useEffect } from "react";

/**
 * Controller del viewport "app-like".
 *
 * L'HTML servito dal server contiene GIÀ `width=430` nel meta viewport
 * (layout.tsx): è la larghezza di design, onorata da tutti i browser mobili
 * al parse iniziale — inclusi quelli che ignorano le modifiche via JS
 * (verificato sul campo: setAttribute applicato ma innerWidth invariato).
 * I browser desktop ignorano del tutto il meta viewport → desktop invariato.
 *
 * Questo componente si limita a RILASSARE il viewport dove 430 non va bene,
 * sui browser che onorano i cambi dinamici:
 *  - dispositivi non-touch (sicurezza) e landscape → device-width
 *  - tablet in portrait (lato corto schermo > 620px) → width=768
 * e ri-afferma il valore dopo l'hydration di React e ai cambi di stato
 * (orientamento, ripresa PWA).
 */
const DESIGN_WIDTH = 430;
const TABLET_WIDTH = 768;

export default function ViewportController() {
  useEffect(() => {
    // React, in idratazione, ri-aggiunge il meta viewport di Next
    // (`width=device-width, initial-scale=1`) in coda all'head: normalizziamo
    // quindi TUTTI i meta viewport, non solo uno, così è indifferente quale il
    // browser applichi (primo, ultimo o merge delle proprietà).

    // Touch detection robusta: matchMedia('pointer: coarse') su alcuni Android
    // dà falsi negativi → usiamo anche maxTouchPoints / ontouchstart.
    const touch =
      (typeof navigator !== "undefined" && navigator.maxTouchPoints > 0) ||
      "ontouchstart" in window ||
      (!!window.matchMedia && window.matchMedia("(pointer: coarse)").matches);

    const apply = () => {
      const landscape = !!window.matchMedia && window.matchMedia("(orientation: landscape)").matches;
      // Telefono vs tablet in PIXEL FISICI (css × dpr): i telefoni economici
      // riportano screen.width CSS larghi (~800) e in px CSS sembrerebbero
      // tablet; un vero tablet ha lato corto fisico > ~1500px.
      const dpr = window.devicePixelRatio || 1;
      const minDimPhys = window.screen ? Math.min(window.screen.width, window.screen.height) * dpr : 0;
      const want =
        !touch || landscape
          ? "width=device-width, initial-scale=1, viewport-fit=cover"
          : `width=${minDimPhys > 1500 ? TABLET_WIDTH : DESIGN_WIDTH}, viewport-fit=cover`;
      const metas = document.querySelectorAll('meta[name="viewport"]');
      metas.forEach((m) => {
        if (m.getAttribute("content") !== want) m.setAttribute("content", want);
      });
      // Diagnostica temporanea visibile (rimuovere dopo conferma sul device)
      try {
        const dbg = document.getElementById("mv-dbg");
        if (dbg) {
          const s = window.screen ? `${window.screen.width}x${window.screen.height}` : "?";
          dbg.textContent = `s${s} t${touch ? 1 : 0} iw${window.innerWidth} → ${want.split(",")[0]}`;
        }
      } catch {}
    };

    // Ri-applica dopo l'hydration di React (che può ripristinare il meta),
    // su ripresa PWA e al cambio orientamento.
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

  // Diagnostica temporanea: schermo, touch, innerWidth e viewport applicato.
  // Serve a confermare il fix sul dispositivo reale; da rimuovere dopo.
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
