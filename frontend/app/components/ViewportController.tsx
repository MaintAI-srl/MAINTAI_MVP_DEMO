"use client";

import { useEffect } from "react";

const DESIGN_WIDTH = 430;
const TABLET_WIDTH = 768;

export type DeviceClass = "mobile" | "tablet" | "desktop";

/**
 * Classifica il layout usando insieme viewport, user agent e input primario.
 * Il controllo fisico copre i browser mobili che dichiarano una viewport
 * desktop, senza scambiare per telefono un portatile touch con mouse/trackpad.
 */
export function detectDeviceClass(): DeviceClass {
  if (typeof window === "undefined") return "desktop";

  const viewportWidth = Math.round(window.visualViewport?.width ?? window.innerWidth);
  const userAgent = navigator.userAgent || "";
  const touchPoints = navigator.maxTouchPoints || 0;
  const coarsePointer = window.matchMedia?.("(pointer: coarse)").matches ?? false;
  const phoneUserAgent = /Mobi|iPhone|iPod|Windows Phone/i.test(userAgent)
    || (/Android/i.test(userAgent) && /Mobile/i.test(userAgent));
  const tabletUserAgent = /iPad|Tablet|PlayBook|Silk/i.test(userAgent)
    || (/Android/i.test(userAgent) && !/Mobile/i.test(userAgent))
    || (/Macintosh/i.test(userAgent) && touchPoints > 1);
  const dpr = window.devicePixelRatio || 1;
  const shortestPhysicalSide = window.screen
    ? Math.min(window.screen.width, window.screen.height) * dpr
    : 0;
  const portableTouch = coarsePointer || phoneUserAgent || tabletUserAgent;

  if (
    viewportWidth <= 640
    || phoneUserAgent
    || (portableTouch && !tabletUserAgent && shortestPhysicalSide > 0 && shortestPhysicalSide <= 1500)
  ) {
    return "mobile";
  }

  if (
    viewportWidth <= 1024
    || tabletUserAgent
    || (portableTouch && shortestPhysicalSide > 1500)
  ) {
    return "tablet";
  }

  return "desktop";
}

export function isCompactDevice() {
  if (typeof document === "undefined") return false;
  const deviceClass = document.documentElement.dataset.deviceClass ?? detectDeviceClass();
  return deviceClass === "mobile" || deviceClass === "tablet";
}

/**
 * Mantiene coerenti viewport e data-device-class dopo hydration, rotazione,
 * resize e ripresa della PWA. Il viewport statico decisivo viene applicato dal
 * post-build; qui riallineiamo i browser che accettano modifiche runtime.
 */
export default function ViewportController() {
  useEffect(() => {
    const touch =
      navigator.maxTouchPoints > 0
      || "ontouchstart" in window
      || (window.matchMedia?.("(pointer: coarse)").matches ?? false);

    const apply = () => {
      const landscape = window.matchMedia?.("(orientation: landscape)").matches ?? false;
      const dpr = window.devicePixelRatio || 1;
      const shortestPhysicalSide = window.screen
        ? Math.min(window.screen.width, window.screen.height) * dpr
        : 0;
      const viewport = !touch || landscape
        ? "width=device-width, initial-scale=1, viewport-fit=cover"
        : `width=${shortestPhysicalSide > 1500 ? TABLET_WIDTH : DESIGN_WIDTH}, viewport-fit=cover`;

      document.querySelectorAll('meta[name="viewport"]').forEach((meta) => {
        if (meta.getAttribute("content") !== viewport) meta.setAttribute("content", viewport);
      });
      document.documentElement.dataset.deviceClass = detectDeviceClass();
    };

    let resizeFrame = 0;
    const scheduleApply = () => {
      window.cancelAnimationFrame(resizeFrame);
      resizeFrame = window.requestAnimationFrame(apply);
    };
    const delayedApply = () => window.setTimeout(scheduleApply, 350);
    const onVisibilityChange = () => {
      if (document.visibilityState === "visible") scheduleApply();
    };

    apply();
    const hydrationTimer = window.setTimeout(apply, 150);
    const settleTimer = window.setTimeout(apply, 600);
    window.addEventListener("resize", scheduleApply);
    window.addEventListener("orientationchange", delayedApply);
    window.addEventListener("pageshow", scheduleApply);
    window.visualViewport?.addEventListener("resize", scheduleApply);
    document.addEventListener("visibilitychange", onVisibilityChange);

    return () => {
      window.cancelAnimationFrame(resizeFrame);
      window.clearTimeout(hydrationTimer);
      window.clearTimeout(settleTimer);
      window.removeEventListener("resize", scheduleApply);
      window.removeEventListener("orientationchange", delayedApply);
      window.removeEventListener("pageshow", scheduleApply);
      window.visualViewport?.removeEventListener("resize", scheduleApply);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, []);

  return null;
}
