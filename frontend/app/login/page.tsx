"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "../lib/auth";
import { API_BASE, isTauri, saveTauriToken } from "../lib/api";
import { notify } from "@/lib/toast";

/** Tenta una fetch con timeout esplicito in ms. */
async function fetchWithTimeout(url: string, options: RequestInit, timeoutMs: number): Promise<Response> {
  const ctrl = new AbortController();
  const id = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: ctrl.signal });
  } finally {
    clearTimeout(id);
  }
}

export default function LoginPage() {
  const [username, setUsername]   = useState("");
  const [password, setPassword]   = useState("");
  const [loading, setLoading]     = useState(false);
  const [statusMsg, setStatusMsg] = useState<string | null>(null);
  const [backendOk, setBackendOk] = useState<boolean | null>(null);
  const [wakeSeconds, setWakeSeconds] = useState(0);

  const auth   = useAuth();
  const router = useRouter();

  // Al mount: sveglia aggressiva del backend — pinga ogni 4s finché non risponde
  useEffect(() => {
    let cancelled = false;
    let retryInterval: ReturnType<typeof setInterval> | null = null;
    let countInterval: ReturnType<typeof setInterval> | null = null;

    const tryPing = async () => {
      try {
        const r = await fetchWithTimeout(`${API_BASE}/health`, { method: "GET" }, 6000);
        if (r.ok && !cancelled) {
          if (retryInterval) clearInterval(retryInterval);
          if (countInterval) clearInterval(countInterval);
          setBackendOk(true);
          setStatusMsg(null);
          setWakeSeconds(0);
        }
      } catch { /* server ancora dormiente, continua */ }
    };

    const start = async () => {
      try {
        const r = await fetchWithTimeout(`${API_BASE}/health`, { method: "GET" }, 6000);
        if (!cancelled) setBackendOk(r.ok);
      } catch {
        if (!cancelled) {
          setBackendOk(false);
          setStatusMsg("Server in avvio...");
          let secs = 0;
          countInterval = setInterval(() => {
            if (cancelled) return;
            secs += 1;
            setWakeSeconds(secs);
          }, 1000);
          // Pinga ogni 4s — molto più reattivo del precedente 10s
          retryInterval = setInterval(tryPing, 4000);
        }
      }
    };

    start();
    return () => {
      cancelled = true;
      if (retryInterval) clearInterval(retryInterval);
      if (countInterval) clearInterval(countInterval);
    };
  }, []);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setStatusMsg(null);

    const formBody = new URLSearchParams();
    formBody.append("username", username);
    formBody.append("password", password);

    const opts: RequestInit = {
      method: "POST",
      credentials: "include",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        ...(isTauri() ? { "Origin": "http://tauri.localhost" } : {}),
      },
      body: formBody,
    };

    // Retry loop: fino a 3 tentativi, timeout crescente (20s / 40s / 60s)
    const timeouts = [20000, 40000, 60000];
    let lastError = "";

    for (let attempt = 0; attempt < timeouts.length; attempt++) {
      if (attempt > 0) {
        setStatusMsg(`🔄 Server in avvio... tentativo ${attempt + 1}/3`);
        await new Promise(r => setTimeout(r, 3000)); // pausa 3s tra tentativi
      }
      try {
        const res = await fetchWithTimeout(`${API_BASE}/auth/login`, opts, timeouts[attempt]);

        if (res.status === 401) {
          // Credenziali errate — non riprovare
          notify.error("Username o password errati");
          setStatusMsg(null);
          setLoading(false);
          return;
        }
        if (res.status === 403) {
          const body = await res.json().catch(() => ({}));
          notify.error(body.detail || "Account sospeso o disabilitato");
          setStatusMsg(null);
          setLoading(false);
          return;
        }
        if (res.status === 429) {
          notify.error("Troppi tentativi. Attendi 1 minuto e riprova.");
          setStatusMsg(null);
          setLoading(false);
          return;
        }
        if (!res.ok) {
          lastError = `Errore server (${res.status})`;
          continue; // riprova
        }

        const data = await res.json();
        if (isTauri() && data.access_token) saveTauriToken(data.access_token);
        auth.login(data.username, data.ruolo, data.userid, data.tenant_id, data.tenant_nome);
        setBackendOk(true);

        if (data.ruolo === "tecnico") router.push("/mobile");
        else router.push("/dashboard");
        return;

      } catch (err: unknown) {
        if (err instanceof Error && err.name === "AbortError") {
          lastError = "Server non raggiungibile (timeout)";
        } else {
          lastError = "Impossibile contattare il server";
        }
        // Continua al prossimo tentativo
      }
    }

    // Tutti e 3 i tentativi falliti
    notify.error(`${lastError}. Il server potrebbe essere in avvio. Riprova tra 30 secondi.`);
    setStatusMsg("⚠️ Server non disponibile — riprova tra poco");
    setLoading(false);
  };

  const isServerDown = backendOk === false;

  return (
    <div style={{
      minHeight: "100vh", display: "flex", alignItems: "center",
      justifyContent: "center", background: "var(--bg-base)", color: "var(--text-primary)",
    }}>
      <div style={{
        width: "100%", maxWidth: "400px", padding: "40px",
        background: "var(--bg-surface)", border: "1px solid var(--border-strong)",
        borderRadius: "16px", boxShadow: "0 25px 50px -12px rgba(0, 0, 0, 0.5)",
      }}>
        <div style={{ textAlign: "center", marginBottom: "32px" }}>
          <img src="/logo.png" alt="MaintAI Logo" style={{ width: "64px", height: "64px", objectFit: "contain", marginBottom: "16px", filter: "drop-shadow(0 0 16px rgba(59,130,246,0.3))" }} />
          <h1 style={{ fontSize: "24px", margin: "0 0 8px 0", letterSpacing: "0.1em", fontWeight: 700 }}>MAINTAI</h1>
          <p style={{ color: "var(--text-secondary)", margin: 0, fontSize: "14px" }}>Accesso Operatori</p>
        </div>

        {/* Banner stato server */}
        {statusMsg && (
          <div style={{
            marginBottom: 20, padding: "10px 14px",
            background: "rgba(251,191,36,0.08)", border: "1px solid rgba(251,191,36,0.3)",
            borderRadius: 8, fontSize: 13, color: "#fbbf24", textAlign: "center",
            display: "flex", alignItems: "center", justifyContent: "center", gap: 8,
          }}>
            <span style={{ display: "inline-block", animation: "spin 1s linear infinite" }}>⏳</span>
            {statusMsg}{wakeSeconds > 0 ? ` (${wakeSeconds}s)` : ""}
          </div>
        )}

        <form onSubmit={handleLogin} style={{ display: "flex", flexDirection: "column", gap: "20px" }}>
          <div>
            <label style={{ display: "block", fontSize: "12px", color: "var(--text-secondary)", marginBottom: "8px", textTransform: "uppercase", letterSpacing: "0.1em" }}>Username</label>
            <input
              required autoFocus type="text"
              value={username} onChange={(e) => setUsername(e.target.value)}
              disabled={loading}
              style={{
                width: "100%", padding: "12px",
                background: "var(--bg-base)", border: "1px solid var(--border-default)",
                borderRadius: "8px", color: "white", outline: "none",
                fontSize: "15px", boxSizing: "border-box",
                opacity: loading ? 0.6 : 1,
              }}
            />
          </div>
          <div>
            <label style={{ display: "block", fontSize: "12px", color: "var(--text-secondary)", marginBottom: "8px", textTransform: "uppercase", letterSpacing: "0.1em" }}>Password</label>
            <input
              required type="password"
              value={password} onChange={(e) => setPassword(e.target.value)}
              disabled={loading}
              style={{
                width: "100%", padding: "12px",
                background: "var(--bg-base)", border: "1px solid var(--border-default)",
                borderRadius: "8px", color: "white", outline: "none",
                fontSize: "15px", boxSizing: "border-box",
                opacity: loading ? 0.6 : 1,
              }}
            />
          </div>
          <button
            type="submit"
            disabled={loading}
            style={{
              marginTop: "8px", padding: "14px",
              background: loading ? "#1e3a5f" : "linear-gradient(135deg, #3b82f6 0%, #2563eb 100%)",
              color: "white", border: "none", borderRadius: "8px",
              fontWeight: 600, fontSize: "15px",
              cursor: loading ? "not-allowed" : "pointer",
              transition: "all 0.2s",
              display: "flex", alignItems: "center", justifyContent: "center", gap: 8,
            }}
          >
            {loading && <span style={{ fontSize: 16 }}>⏳</span>}
            {loading ? "Connessione in corso..." : "ACCEDI"}
          </button>
        </form>

        {/* Indicatore stato backend */}
        <div style={{ marginTop: 20, display: "flex", alignItems: "center", justifyContent: "center", gap: 6, fontSize: 11 }}>
          <span style={{
            width: 7, height: 7, borderRadius: "50%",
            background: backendOk === null ? "#94a3b8" : backendOk ? "#22c55e" : "#f59e0b",
            display: "inline-block",
            boxShadow: backendOk ? "0 0 6px #22c55e80" : backendOk === false ? "0 0 6px #f59e0b80" : "none",
          }} />
          <span style={{ color: "var(--text-muted)" }}>
            {backendOk === null ? "Verifica connessione..." : backendOk ? "Server operativo" : "Server in avvio..."}
          </span>
        </div>

        <style>{`@keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }`}</style>
      </div>
    </div>
  );
}
