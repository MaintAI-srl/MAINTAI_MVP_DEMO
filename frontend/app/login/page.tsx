"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "../lib/auth";
import { API_BASE } from "../lib/api";
import { notify } from "@/lib/toast";

export default function LoginPage() {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  
  const auth = useAuth();
  const router = useRouter();

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);

    try {
      const formBody = new URLSearchParams();
      formBody.append("username", username);
      formBody.append("password", password);

      const res = await fetch(`${API_BASE}/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: formBody,
      });

      if (!res.ok) {
        throw new Error("Credenziali non valide");
      }

      const data = await res.json();
      auth.login(data.access_token, data.username, data.ruolo, data.userid, data.tenant_id, data.tenant_nome);

      if (data.ruolo === "tecnico") {
        router.push("/mobile");
      } else {
        router.push("/dashboard");
      }
    } catch (err: any) {
      notify.error(err.message || "Errore durante il login");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{
      minHeight: "100vh",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      background: "var(--bg-base)",
      color: "var(--text-primary)",
    }}>
      <div style={{
        width: "100%",
        maxWidth: "400px",
        padding: "40px",
        background: "var(--bg-surface)",
        border: "1px solid #1f2937",
        borderRadius: "16px",
        boxShadow: "0 25px 50px -12px rgba(0, 0, 0, 0.5)",
      }}>
        <div style={{ textAlign: "center", marginBottom: "32px" }}>
          <img 
            src="/logo.png" 
            alt="MaintAI Logo" 
            style={{ width: "64px", height: "64px", objectFit: "contain", marginBottom: "16px", filter: "drop-shadow(0 0 16px rgba(59,130,246,0.3))" }} 
          />
          <h1 style={{ fontSize: "24px", margin: "0 0 8px 0", letterSpacing: "0.1em", fontWeight: 700 }}>MAINTAI</h1>
          <p style={{ color: "var(--text-secondary)", margin: 0, fontSize: "14px" }}>Accesso Operatori</p>
        </div>


        <form onSubmit={handleLogin} style={{ display: "flex", flexDirection: "column", gap: "20px" }}>
          <div>
            <label style={{ display: "block", fontSize: "12px", color: "var(--text-secondary)", marginBottom: "8px", textTransform: "uppercase", letterSpacing: "0.1em" }}>Username</label>
            <input 
              required
              autoFocus
              type="text" 
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              style={{
                width: "100%",
                padding: "12px",
                background: "var(--bg-base)",
                border: "1px solid #374151",
                borderRadius: "8px",
                color: "white",
                outline: "none",
                fontSize: "15px",
                boxSizing: "border-box"
              }}
            />
          </div>
          <div>
            <label style={{ display: "block", fontSize: "12px", color: "var(--text-secondary)", marginBottom: "8px", textTransform: "uppercase", letterSpacing: "0.1em" }}>Password</label>
            <input 
              required
              type="password" 
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              style={{
                width: "100%",
                padding: "12px",
                background: "var(--bg-base)",
                border: "1px solid #374151",
                borderRadius: "8px",
                color: "white",
                outline: "none",
                fontSize: "15px",
                boxSizing: "border-box"
              }}
            />
          </div>
          <button 
            type="submit" 
            disabled={loading}
            style={{
              marginTop: "8px",
              padding: "14px",
              background: loading ? "var(--border-strong)" : "linear-gradient(135deg, #3b82f6 0%, #2563eb 100%)",
              color: "white",
              border: "none",
              borderRadius: "8px",
              fontWeight: 600,
              fontSize: "15px",
              cursor: loading ? "not-allowed" : "pointer",
              transition: "all 0.2s"
            }}
          >
            {loading ? "Accesso in corso..." : "ACCEDI"}
          </button>
        </form>

        <div style={{ marginTop: "24px", textAlign: "center", fontSize: "11px", color: "var(--text-muted)" }}>
          Credenziali di test: admin/admin oppure tecnico/tecnico
        </div>
      </div>
    </div>
  );
}
