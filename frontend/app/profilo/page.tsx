"use client";
import { useState } from "react";
import { useAuth } from "../lib/auth";
import { apiPost } from "../lib/api";

export default function ProfiloPage() {
  const { user } = useAuth();
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState({ type: "", text: "" });

  const handlePasswordChange = async (e: React.FormEvent) => {
    e.preventDefault();
    if (newPassword !== confirmPassword) {
      setMessage({ type: "error", text: "Le password non coincidono" });
      return;
    }
    setLoading(true);
    setMessage({ type: "", text: "" });
    try {
      await apiPost("/auth/change-password", {
        current_password: currentPassword,
        new_password: newPassword,
      });
      setMessage({ type: "success", text: "Password aggiornata con successo" });
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
    } catch (err: unknown) {
      setMessage({ type: "error", text: err instanceof Error ? err.message : "Errore durante l'aggiornamento" });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{ maxWidth: "600px", margin: "0 auto", padding: "40px 20px" }}>
      <div className="card" style={{ padding: "32px" }}>
        <div style={{ marginBottom: "32px", borderBottom: "1px solid var(--border-dim)", paddingBottom: "24px" }}>
          <h1 style={{ fontSize: "20px", fontWeight: 700, marginBottom: "8px" }}>MIO PROFILO</h1>
          <p style={{ color: "var(--text-muted)", fontSize: "14px" }}>Gestisci le tue credenziali e le impostazioni account</p>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "24px", marginBottom: "40px" }}>
          <div>
            <label style={{ display: "block", fontSize: "10px", fontWeight: 700, color: "var(--text-muted)", marginBottom: "8px", textTransform: "uppercase" }}>Username</label>
            <div style={{ padding: "12px", background: "var(--bg-base)", border: "1px solid var(--border)", borderRadius: "8px", color: "var(--text-secondary)" }}>
              {user?.username}
            </div>
          </div>
          <div>
            <label style={{ display: "block", fontSize: "10px", fontWeight: 700, color: "var(--text-muted)", marginBottom: "8px", textTransform: "uppercase" }}>Ruolo</label>
            <div style={{ padding: "12px", background: "var(--bg-base)", border: "1px solid var(--border)", borderRadius: "8px", color: "var(--text-secondary)", textTransform: "capitalize" }}>
              {user?.ruolo}
            </div>
          </div>
          <div style={{ gridColumn: "span 2" }}>
            <label style={{ display: "block", fontSize: "10px", fontWeight: 700, color: "var(--text-muted)", marginBottom: "8px", textTransform: "uppercase" }}>Tenant / Azienda</label>
            <div style={{ padding: "12px", background: "var(--bg-base)", border: "1px solid var(--border)", borderRadius: "8px", color: "var(--text-primary)", fontWeight: 600 }}>
              ◈ {user?.tenant_nome || "Nessun Tenant"}
            </div>
          </div>
        </div>

        <form onSubmit={handlePasswordChange} style={{ borderTop: "1px solid var(--border-dim)", paddingTop: "32px" }}>
          <h2 style={{ fontSize: "14px", fontWeight: 700, marginBottom: "24px", letterSpacing: "1px" }}>🔒 CAMBIA PASSWORD</h2>
          
          <div style={{ display: "flex", flexDirection: "column", gap: "20px" }}>
            <div>
              <label style={{ display: "block", fontSize: "11px", marginBottom: "8px" }}>Password Attuale</label>
              <input
                type="password"
                className="input"
                required
                value={currentPassword}
                onChange={(e) => setCurrentPassword(e.target.value)}
                placeholder="••••••••"
              />
            </div>
            
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "20px" }}>
              <div>
                <label style={{ display: "block", fontSize: "11px", marginBottom: "8px" }}>Nuova Password</label>
                <input
                  type="password"
                  className="input"
                  required
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  placeholder="Min. 8 caratteri"
                />
              </div>
              <div>
                <label style={{ display: "block", fontSize: "11px", marginBottom: "8px" }}>Conferma Password</label>
                <input
                  type="password"
                  className="input"
                  required
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  placeholder="Ripeti password"
                />
              </div>
            </div>

            {message.text && (
              <div 
                style={{ 
                  padding: "12px", 
                  borderRadius: "8px", 
                  fontSize: "13px",
                  background: message.type === "success" ? "#064e3b" : "#7f1d1d",
                  color: message.type === "success" ? "#6ee7b7" : "#fca5a5",
                  border: "1px solid " + (message.type === "success" ? "#059669" : "#dc2626")
                }}
              >
                {message.type === "success" ? "✓" : "⚠"} {message.text}
              </div>
            )}

            <button 
              type="submit" 
              className="btn btn-primary" 
              style={{ marginTop: "12px", width: "100%" }}
              disabled={loading}
            >
              {loading ? "Aggiornamento in corso..." : "AGGIORNA PASSWORD"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
