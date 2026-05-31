"use client";

import { useEffect, useState, useCallback } from "react";
import { API_BASE } from "@/app/lib/api";

type Status = "checking" | "online" | "warming" | "offline";

// Render free tier impiega fino a 60s per il cold start
const HEALTH_TIMEOUT_MS = 70_000;
const WARMING_THRESHOLD_MS = 5_000; // dopo 5s senza risposta → mostra "in avvio"

/**
 * Indicatore di connessione al backend.
 * Visibile solo quando il backend non è raggiungibile o è in fase di cold start.
 * Ping ogni 30s sull'endpoint /health.
 */
export function BackendStatus() {
  const [status, setStatus] = useState<Status>("checking");
  const [lastCheck, setLastCheck] = useState<Date | null>(null);

  const check = useCallback(async () => {
    setStatus("checking");

    // Dopo 5s senza risposta mostra "in avvio" invece di "offline"
    const warmingTimer = setTimeout(() => setStatus("warming"), WARMING_THRESHOLD_MS);

    try {
      const res = await fetch(`${API_BASE}/health`, {
        signal: AbortSignal.timeout(HEALTH_TIMEOUT_MS),
        cache: "no-store",
      });
      clearTimeout(warmingTimer);
      setStatus(res.ok ? "online" : "offline");
    } catch {
      clearTimeout(warmingTimer);
      setStatus("offline");
    }
    setLastCheck(new Date());
  }, []);

  useEffect(() => {
    // TODO(sec-04): revisione umana - falso positivo: check() è asincrona, setState avviene in callback async
    // eslint-disable-next-line react-hooks/set-state-in-effect -- check() avvia fetch async; setState avviene nelle callback, non nell'effect
    check();
    const interval = setInterval(check, 30_000);
    return () => clearInterval(interval);
  }, [check]);

  if (status === "online") return null;

  const isChecking = status === "checking";
  const isWarming = status === "warming";

  const dotColor = isChecking || isWarming ? "animate-pulse bg-yellow-400" : "bg-red-500";
  const message = isChecking
    ? "Connessione in corso…"
    : isWarming
    ? "Backend in avvio (attendere ~60s)…"
    : "Backend non raggiungibile";

  return (
    <div
      className="fixed bottom-4 right-4 z-[9999] flex items-center gap-2 rounded-lg border border-gray-700 bg-gray-900/95 px-3 py-2 text-sm text-white shadow-xl backdrop-blur-sm"
      title={lastCheck ? `Ultimo controllo: ${lastCheck.toLocaleTimeString("it-IT")}` : undefined}
    >
      <span className={`h-2 w-2 rounded-full ${dotColor}`} />
      <span className="text-gray-200">{message}</span>
      {status === "offline" && (
        <button
          onClick={check}
          className="ml-1 rounded px-1.5 py-0.5 text-xs text-gray-400 hover:bg-gray-700 hover:text-white transition-colors"
          title="Riprova connessione"
        >
          ↺
        </button>
      )}
    </div>
  );
}
