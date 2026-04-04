"use client";

import { useEffect, useState } from "react";
import { apiGet, apiPost, apiDelete } from "../../lib/api";

type EmailConfigItem = {
  id: number;
  imap_server: string;
  imap_port: number;
  email_address: string;
  active: boolean;
  default_asset_id?: number | null;
  tenant_id?: number;
};

export default function EmailConfigPage() {
  const [configs, setConfigs] = useState<EmailConfigItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [isTestLoading, setIsTestLoading] = useState(false);

  const [form, setForm] = useState({
    imap_server: "imap.gmail.com",
    imap_port: 993,
    email_address: "",
    password: "",
  });

  async function loadData() {
    setLoading(true);
    try {
      const data = await apiGet<EmailConfigItem[]>("/email-config");
      setConfigs(data || []);
      setError("");
    } catch (err: any) {
      setError(err.message || "Errore di caricamento configurazioni");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadData();
  }, []);

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault();
    if (!form.imap_server || !form.email_address || !form.password) {
      setError("Compila tutti i campi obbligatori (Server, Email, Password)");
      return;
    }

    setIsTestLoading(true);
    setError("");
    setSuccess("");
    try {
      // Tenta il salvataggio: il backend farà una prova di Login IMAP
      await apiPost<EmailConfigItem>("/email-config", {
        imap_server: form.imap_server,
        imap_port: Number(form.imap_port),
        email_address: form.email_address,
        password: form.password,
        active: true
      });
      setSuccess("Connessione riuscita! Il polling in background è attivo per questa casella.");
      setForm({ ...form, email_address: "", password: "" }); // Reset campi sicuri
      loadData();
    } catch (err: any) {
      setError(err.message || "Credenziali non valide o Server irraggiungibile.");
    } finally {
      setIsTestLoading(false);
    }
  }

  async function handleDelete(id: number) {
    if (!window.confirm("Sicuro di voler rimuovere questa integrazione email? Smetterai di ricevere nuovi Ticket in automatico.")) return;
    try {
      await apiDelete(`/email-config/${id}`);
      setConfigs(c => c.filter(x => x.id !== id));
      setSuccess("Configurazione rimossa.");
    } catch (err: any) {
      setError(err.message || "Errore durante l'eliminazione");
    }
  }

  return (
    <div style={{ maxWidth: 800, margin: "0 auto", paddingBottom: 40 }}>
      {/* Header */}
      <div style={{ marginBottom: 24 }}>
        <h1 className="page-title" style={{ fontSize: 28, marginBottom: 8 }}>Integrazione Email-to-Ticket</h1>
        <p className="page-subtitle">
          Configura una casella di posta aziendale (es. <code>assistenza@azienda.com</code>) per trasformare automaticamente ogni email in entrata in un Ticket MaintAI.
        </p>
      </div>

      {error && (
        <div style={{ background: "rgba(220,38,38,0.15)", border: "1px solid var(--red)", color: "#fca5a5", padding: "16px", borderRadius: "8px", marginBottom: "20px" }}>
          ⚠️ {error}
        </div>
      )}
      {success && (
        <div style={{ background: "rgba(16,185,129,0.15)", border: "1px solid var(--green)", color: "var(--green)", padding: "16px", borderRadius: "8px", marginBottom: "20px" }}>
          ✅ {success}
        </div>
      )}

      {/* Form di aggiunta */}
      <div style={{ background: "var(--bg-card)", border: "1px solid var(--border)", borderRadius: "8px", padding: "24px", marginBottom: "30px", boxShadow: "0 4px 20px rgba(0,0,0,0.1)" }}>
        <h3 style={{ fontSize: 18, marginBottom: 16 }}>Aggiungi Nuova Sincronizzazione</h3>
        <form onSubmit={handleAdd} style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "16px" }}>
          <div style={{ gridColumn: "1 / -1" }}>
            <label style={{ display: "block", marginBottom: 6, fontSize: 13, color: "var(--text-secondary)" }}>Indirizzo Email Casella</label>
            <input 
              type="email" 
              className="input w-full" 
              placeholder="es. manutenzioni@azienda.com" 
              value={form.email_address}
              onChange={e => setForm({...form, email_address: e.target.value})}
            />
            <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 4 }}>Questo è l'indirizzo a cui gli operatori invieranno la mail.</div>
          </div>

          <div>
            <label style={{ display: "block", marginBottom: 6, fontSize: 13, color: "var(--text-secondary)" }}>IMAP Server</label>
            <input 
              type="text" 
              className="input w-full" 
              placeholder="es. imap.gmail.com" 
              value={form.imap_server}
              onChange={e => setForm({...form, imap_server: e.target.value})}
            />
          </div>

          <div>
            <label style={{ display: "block", marginBottom: 6, fontSize: 13, color: "var(--text-secondary)" }}>Porta IMAP</label>
            <input 
              type="number" 
              className="input w-full" 
              value={form.imap_port}
              onChange={e => setForm({...form, imap_port: Number(e.target.value)})}
            />
          </div>

          <div style={{ gridColumn: "1 / -1" }}>
            <label style={{ display: "block", marginBottom: 6, fontSize: 13, color: "var(--text-secondary)" }}>Password o "App Password"</label>
            <input 
              type="password" 
              className="input w-full" 
              placeholder="Password sicura" 
              value={form.password}
              onChange={e => setForm({...form, password: e.target.value})}
            />
            <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 4 }}>Se usi Gmail / O365 con 2FA, devi generare un'App Password nelle impostazioni della casella.</div>
          </div>

          <div style={{ gridColumn: "1 / -1", marginTop: "10px" }}>
            <button type="submit" disabled={isTestLoading} className="btn w-full" style={{ background: "var(--blue)", color: "white", padding: "12px", border: "none", borderRadius: "6px", cursor: isTestLoading ? "not-allowed" : "pointer", fontWeight: 600 }}>
              {isTestLoading ? "Verifica Connessione in corso..." : "Testa Connessione e Salva Sincronizzazione"}
            </button>
          </div>
        </form>
      </div>

      {/* Lista Configs attive */}
      <h3 style={{ fontSize: 18, marginBottom: 16 }}>Caselle Sincronizzate</h3>
      
      {loading ? (
        <div style={{ color: "var(--text-muted)" }}>Caricamento...</div>
      ) : configs.length === 0 ? (
        <div style={{ padding: "40px", textAlign: "center", border: "1px dashed var(--border)", borderRadius: "8px", color: "var(--text-muted)" }}>
          Nessuna integrazione email attiva.
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
          {configs.map(c => (
            <div key={c.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", background: "var(--bg-card)", border: "1px solid var(--border)", padding: "16px", borderRadius: "8px" }}>
              <div style={{ flex: 1 }}>
                <div style={{ fontWeight: 600, fontSize: 15, display: "flex", alignItems: "center", gap: "10px" }}>
                  ✉️ {c.email_address}
                  <span style={{ fontSize: 11, background: "rgba(16,185,129,0.2)", color: "var(--green)", padding: "2px 8px", borderRadius: "10px" }}>ATTIVA (Polling 5m)</span>
                </div>
                <div style={{ fontSize: 13, color: "var(--text-muted)", marginTop: 4, fontFamily: "var(--font-mono)" }}>
                  {c.imap_server}:{c.imap_port}
                </div>
              </div>
              <div>
                <button 
                  onClick={() => handleDelete(c.id)}
                  style={{ background: "transparent", border: "1px solid var(--red)", color: "var(--red)", borderRadius: "6px", padding: "6px 12px", fontSize: 12, cursor: "pointer" }}
                >
                  Disconnetti
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
