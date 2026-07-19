"use client";

import { useEffect } from "react";

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
 * Mantiene coerente data-device-class dopo hydration, rotazione, resize e
 * ripresa della PWA. Il meta viewport resta quello standard di Next
 * (width=device-width, initial-scale=1) e non viene mai riscritto.
 */
export default function ViewportController() {
  useEffect(() => {
    const apply = () => {
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
    window.addEventListener("resize", scheduleApply);
    window.addEventListener("orientationchange", delayedApply);
    window.addEventListener("pageshow", scheduleApply);
    window.visualViewport?.addEventListener("resize", scheduleApply);
    document.addEventListener("visibilitychange", onVisibilityChange);

    return () => {
      window.cancelAnimationFrame(resizeFrame);
      window.removeEventListener("resize", scheduleApply);
      window.removeEventListener("orientationchange", delayedApply);
      window.removeEventListener("pageshow", scheduleApply);
      window.visualViewport?.removeEventListener("resize", scheduleApply);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, []);

  return null;
}
