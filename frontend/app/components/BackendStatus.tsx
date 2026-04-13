"use client";

import { useEffect, useState, useCallback } from "react";
import { API_BASE } from "@/app/lib/api";

type Status = "checking" | "online" | "offline";

/**
 * Indicatore di connessione al backend.
 * Visibile solo quando il backend non è raggiungibile o è in fase di controllo.
 * Ping ogni 30s sull'endpoint /health.
 */
export function BackendStatus() {
  const [status, setStatus] = useState<Status>("checking");
  const [lastCheck, setLastCheck] = useState<Date | null>(null);

  const check = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE}/health`, {
        signal: AbortSignal.timeout(5000),
        cache: "no-store",
      });
      setStatus(res.ok ? "online" : "offline");
    } catch {
      setStatus("offline");
    }
    setLastCheck(new Date());
  }, []);

  useEffect(() => {
    check();
    const interval = setInterval(check, 30_000);
    return () => clearInterval(interval);
  }, [check]);

  // Non mostrare nulla se il backend è online
  if (status === "online") return null;

  const isChecking = status === "checking";

  return (
    <div
      className="fixed bottom-4 right-4 z-[9999] flex items-center gap-2 rounded-lg border border-gray-700 bg-gray-900/95 px-3 py-2 text-sm text-white shadow-xl backdrop-blur-sm"
      title={lastCheck ? `Ultimo controllo: ${lastCheck.toLocaleTimeString("it-IT")}` : undefined}
    >
      <span
        className={[
          "h-2 w-2 rounded-full",
          isChecking ? "animate-pulse bg-yellow-400" : "bg-red-500",
        ].join(" ")}
      />
      <span className="text-gray-200">
        {isChecking ? "Connessione in corso…" : "Backend non raggiungibile"}
      </span>
      {!isChecking && (
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
