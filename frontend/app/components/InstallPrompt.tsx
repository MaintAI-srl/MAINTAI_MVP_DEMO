"use client";

import { useEffect, useState } from "react";
import { Download, Share, SquarePlus, X } from "lucide-react";

/**
 * Banner di installazione PWA mostrato al primo avvio.
 *
 * - Android / Chrome / Edge: intercetta `beforeinstallprompt` e mostra un
 *   pulsante "Installa" che apre il prompt nativo di installazione.
 * - iOS / iPadOS Safari: non esiste API di installazione — mostra le
 *   istruzioni manuali (Condividi → Aggiungi alla schermata Home).
 * - Se l'app è già in esecuzione standalone (installata) non mostra nulla.
 * - La chiusura viene ricordata in localStorage e il banner riproposto
 *   solo dopo DISMISS_DAYS giorni.
 */

type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed"; platform: string }>;
};

const DISMISS_KEY = "maintai_install_prompt_dismissed_at";
const INSTALLED_KEY = "maintai_install_prompt_installed";
const DISMISS_DAYS = 14;

function isStandalone(): boolean {
  if (typeof window === "undefined") return true;
  return (
    window.matchMedia("(display-mode: standalone)").matches ||
    window.matchMedia("(display-mode: minimal-ui)").matches ||
    // Safari iOS espone navigator.standalone fuori dallo standard
    (navigator as unknown as { standalone?: boolean }).standalone === true
  );
}

function isIosSafari(): boolean {
  if (typeof navigator === "undefined") return false;
  const ua = navigator.userAgent;
  const isIos =
    /iphone|ipad|ipod/i.test(ua) ||
    // iPadOS 13+ si presenta come macOS ma è touch
    (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  // Escludi Chrome/Firefox/Edge su iOS: usano comunque il motore Safari ma
  // non hanno la voce "Aggiungi alla schermata Home" nello stesso punto.
  const isAltBrowser = /crios|fxios|edgios/i.test(ua);
  return isIos && !isAltBrowser;
}

function wasDismissedRecently(): boolean {
  try {
    if (localStorage.getItem(INSTALLED_KEY) === "true") return true;
    const raw = localStorage.getItem(DISMISS_KEY);
    if (!raw) return false;
    const ts = Number(raw);
    if (!Number.isFinite(ts)) return false;
    return Date.now() - ts < DISMISS_DAYS * 24 * 60 * 60 * 1000;
  } catch {
    return false;
  }
}

export default function InstallPrompt() {
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [mode, setMode] = useState<"hidden" | "native" | "ios">("hidden");
  const [installing, setInstalling] = useState(false);

  useEffect(() => {
    if (isStandalone() || wasDismissedRecently()) return;

    const onBeforeInstall = (e: Event) => {
      e.preventDefault();
      setDeferredPrompt(e as BeforeInstallPromptEvent);
      setMode("native");
    };
    const onInstalled = () => {
      try { localStorage.setItem(INSTALLED_KEY, "true"); } catch { /* storage pieno o bloccato */ }
      setMode("hidden");
      setDeferredPrompt(null);
    };

    window.addEventListener("beforeinstallprompt", onBeforeInstall);
    window.addEventListener("appinstalled", onInstalled);

    // iOS non emette mai beforeinstallprompt: mostra le istruzioni dopo un
    // breve delay per non coprire il primo paint della pagina.
    let iosTimer: ReturnType<typeof setTimeout> | undefined;
    if (isIosSafari()) {
      iosTimer = setTimeout(() => {
        setMode((m) => (m === "hidden" ? "ios" : m));
      }, 2500);
    }

    return () => {
      window.removeEventListener("beforeinstallprompt", onBeforeInstall);
      window.removeEventListener("appinstalled", onInstalled);
      if (iosTimer) clearTimeout(iosTimer);
    };
  }, []);

  function dismiss() {
    try { localStorage.setItem(DISMISS_KEY, String(Date.now())); } catch { /* storage pieno o bloccato */ }
    setMode("hidden");
  }

  async function install() {
    if (!deferredPrompt) return;
    setInstalling(true);
    try {
      await deferredPrompt.prompt();
      const choice = await deferredPrompt.userChoice;
      if (choice.outcome === "accepted") {
        try { localStorage.setItem(INSTALLED_KEY, "true"); } catch { /* storage pieno o bloccato */ }
        setMode("hidden");
      } else {
        dismiss();
      }
    } catch {
      dismiss();
    } finally {
      setInstalling(false);
      setDeferredPrompt(null);
    }
  }

  if (mode === "hidden") return null;

  return (
    <div
      role="dialog"
      aria-label="Installa MaintAI"
      className="m-fade-up"
      style={{
        position: "fixed",
        left: 12,
        right: 12,
        bottom: "calc(12px + env(safe-area-inset-bottom, 0px))",
        zIndex: 9990,
        maxWidth: 480,
        margin: "0 auto",
        background: "rgba(15,20,35,0.92)",
        backdropFilter: "blur(24px) saturate(1.6)",
        WebkitBackdropFilter: "blur(24px) saturate(1.6)",
        border: "1px solid rgba(255,255,255,0.10)",
        borderRadius: 22,
        padding: "16px 16px 14px",
        boxShadow: "0 24px 64px rgba(0,0,0,0.55)",
        color: "#F5F5F7",
      }}
    >
      <button
        aria-label="Chiudi"
        onClick={dismiss}
        className="m-press"
        style={{
          position: "absolute", top: 10, right: 10,
          width: 30, height: 30, borderRadius: "50%",
          background: "rgba(255,255,255,0.07)", border: "1px solid rgba(255,255,255,0.10)",
          color: "rgba(235,235,245,0.6)", cursor: "pointer",
          display: "flex", alignItems: "center", justifyContent: "center",
        }}
      >
        <X size={15} strokeWidth={2.2} />
      </button>

      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 10 }}>
        {/* eslint-disable-next-line @next/next/no-img-element -- icona statica piccola del banner */}
        <img
          src="/logo.png"
          alt="MaintAI"
          style={{
            width: 44, height: 44, borderRadius: 12, objectFit: "contain",
            background: "rgba(10,132,255,0.12)", border: "1px solid rgba(10,132,255,0.30)",
            padding: 6, flexShrink: 0,
          }}
        />
        <div style={{ minWidth: 0 }}>
          <div style={{ fontWeight: 800, fontSize: 15, letterSpacing: "-0.01em", lineHeight: 1.2 }}>
            Installa MaintAI
          </div>
          <div style={{ fontSize: 12, color: "rgba(235,235,245,0.6)", marginTop: 2, lineHeight: 1.4 }}>
            Aggiungi l&apos;app alla schermata Home per l&apos;accesso rapido, anche offline.
          </div>
        </div>
      </div>

      {mode === "native" ? (
        <button
          className="m-press"
          onClick={install}
          disabled={installing}
          style={{
            width: "100%", height: 46, borderRadius: 14, border: "none",
            background: "linear-gradient(135deg, #0A84FF 0%, #0064D2 100%)",
            color: "#fff", fontWeight: 800, fontSize: 14, cursor: "pointer",
            boxShadow: "0 8px 24px rgba(10,132,255,0.40)",
            display: "flex", alignItems: "center", justifyContent: "center", gap: 8,
          }}
        >
          <Download size={17} strokeWidth={2.3} />
          {installing ? "Installazione…" : "INSTALLA APP"}
        </button>
      ) : (
        <div style={{
          background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.08)",
          borderRadius: 14, padding: "11px 13px",
          fontSize: 12.5, lineHeight: 1.6, color: "rgba(235,235,245,0.75)",
        }}>
          <span style={{ display: "inline-flex", alignItems: "center", gap: 5 }}>
            1. Tocca <Share size={14} strokeWidth={2.2} style={{ color: "#0A84FF" }} aria-label="Condividi" />
            <b style={{ color: "#F5F5F7" }}>Condividi</b>
          </span>
          <br />
          <span style={{ display: "inline-flex", alignItems: "center", gap: 5 }}>
            2. Scegli <SquarePlus size={14} strokeWidth={2.2} style={{ color: "#0A84FF" }} aria-label="Aggiungi" />
            <b style={{ color: "#F5F5F7" }}>Aggiungi alla schermata Home</b>
          </span>
        </div>
      )}
    </div>
  );
}
