"use client";

import { useEffect, useState } from "react";
import { apiGet, apiPost, apiDelete } from "../../lib/api";
import { notify } from "@/lib/toast";

type EmailConfigItem = {
  id: number;
  imap_server: string;
  imap_port: number;
  email_address: string;
  active: boolean;
  default_asset_id?: number | null;
};

const PROVIDERS = [
  { label: "Gmail",        server: "imap.gmail.com",          port: 993 },
  { label: "Outlook/O365", server: "outlook.office365.com",   port: 993 },
  { label: "Yahoo",        server: "imap.mail.yahoo.com",     port: 993 },
  { label: "Libero",       server: "imapmail.libero.it",      port: 993 },
  { label: "Aruba",        server: "imapmail.aruba.it",       port: 993 },
  { label: "Personalizzato", server: "",                      port: 993 },
];

export default function EmailConfigPage() {
  const [configs, setConfigs]         = useState<EmailConfigItem[]>([]);
  const [loading, setLoading]         = useState(true);
  const [saving, setSaving]           = useState(false);
  const [selectedProvider, setSelectedProvider] = useState(0);

  const [form, setForm] = useState({
    imap_server:   "imap.gmail.com",
    imap_port:     993,
    email_address: "",
    password:      "",
  });

  async function loadData() {
    setLoading(true);
    try {
      const data = await apiGet<EmailConfigItem[]>("/email-config");
      setConfigs(data || []);
    } catch (err: unknown) {
      notify.error(err instanceof Error ? err.message : "Errore di caricamento configurazioni");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { loadData(); }, []);

  function handleProviderChange(idx: number) {
    setSelectedProvider(idx);
    const p = PROVIDERS[idx];
    setForm(f => ({ ...f, imap_server: p.server, imap_port: p.port }));
  }

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault();
    if (!form.imap_server || !form.email_address || !form.password) {
      notify.error("Compila tutti i campi obbligatori (Server, Email, Password)");
      return;
    }
    setSaving(true);
    try {
      await apiPost<EmailConfigItem>("/email-config", {
        imap_server:  form.imap_server,
        imap_port:    Number(form.imap_port),
        email_address: form.email_address,
        password:     form.password,
        active:       true,
      });
      notify.success("Connessione verificata e salvata. Il polling email è attivo ogni 5 minuti.");
      setForm(f => ({ ...f, email_address: "", password: "" }));
      loadData();
    } catch (err: unknown) {
      notify.error(err instanceof Error ? err.message : "Connessione fallita. Controlla le credenziali.");
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(id: number) {
    if (!window.confirm("Rimuovere questa integrazione email?")) return;
    try {
      await apiDelete(`/email-config/${id}`);
      setConfigs(c => c.filter(x => x.id !== id));
      notify.success("Configurazione rimossa.");
    } catch (err: unknown) {
      notify.error(err instanceof Error ? err.message : "Errore durante l'eliminazione");
    }
  }

  const isGmail = form.imap_server === "imap.gmail.com";

  return (
    <div style={{ maxWidth: 820, margin: "0 auto", paddingBottom: 40 }}>
      {/* Header */}
      <div style={{ marginBottom: 28 }}>
        <div style={{ fontSize: 11, fontWeight: 800, textTransform: "uppercase", letterSpacing: "0.2em", color: "var(--blue-bright)", marginBottom: 8 }}>
          Integrazione
        </div>
        <h1 className="page-title" style={{ fontSize: 30, marginBottom: 8 }}>Email → Ticket</h1>
        <p className="page-subtitle" style={{ color: "var(--text-secondary)" }}>
          Ogni email ricevuta sulla casella configurata viene convertita automaticamente in un Ticket aperto.
        </p>
      </div>


      {/* Form */}
      <div style={{ background: "var(--bg-card)", border: "1px solid var(--border)", borderRadius: 10, padding: 28, marginBottom: 32, boxShadow: "0 4px 24px rgba(0,0,0,0.1)" }}>
        <h3 style={{ fontSize: 17, fontWeight: 700, marginBottom: 20 }}>Aggiungi casella email</h3>

        {/* Selezione provider */}
        <div style={{ marginBottom: 20 }}>
          <label style={{ display: "block", marginBottom: 8, fontSize: 12, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.08em", color: "var(--text-muted)" }}>
            Provider
          </label>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            {PROVIDERS.map((p, i) => (
              <button
                key={i}
                type="button"
                onClick={() => handleProviderChange(i)}
                style={{
                  padding: "6px 14px", borderRadius: 20, fontSize: 13, fontWeight: 600, cursor: "pointer",
                  border: `1px solid ${selectedProvider === i ? "var(--blue)" : "var(--border)"}`,
                  background: selectedProvider === i ? "rgba(59,130,246,0.15)" : "var(--bg-overlay)",
                  color: selectedProvider === i ? "var(--blue)" : "var(--text-secondary)",
                  transition: "all 0.15s",
                }}
              >
                {p.label}
              </button>
            ))}
          </div>
        </div>

        <form onSubmit={handleAdd} style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
          <div style={{ gridColumn: "1 / -1" }}>
            <label style={{ display: "block", marginBottom: 6, fontSize: 13, color: "var(--text-secondary)" }}>
              Indirizzo email della casella *
            </label>
            <input
              type="email" className="input" style={{ width: "100%" }}
              placeholder="es. manutenzioni@azienda.com"
              value={form.email_address}
              onChange={e => setForm({ ...form, email_address: e.target.value })}
            />
          </div>

          <div>
            <label style={{ display: "block", marginBottom: 6, fontSize: 13, color: "var(--text-secondary)" }}>
              Server IMAP *
            </label>
            <input
              type="text" className="input" style={{ width: "100%" }}
              placeholder="imap.gmail.com"
              value={form.imap_server}
              onChange={e => setForm({ ...form, imap_server: e.target.value })}
            />
          </div>

          <div>
            <label style={{ display: "block", marginBottom: 6, fontSize: 13, color: "var(--text-secondary)" }}>
              Porta IMAP
            </label>
            <input
              type="number" className="input" style={{ width: "100%" }}
              value={form.imap_port}
              onChange={e => setForm({ ...form, imap_port: Number(e.target.value) })}
            />
          </div>

          <div style={{ gridColumn: "1 / -1" }}>
            <label style={{ display: "block", marginBottom: 6, fontSize: 13, color: "var(--text-secondary)" }}>
              Password *{isGmail && <span style={{ color: "var(--amber)", marginLeft: 8 }}>⚠ Gmail richiede App Password</span>}
            </label>
            <input
              type="password" className="input" style={{ width: "100%" }}
              placeholder={isGmail ? "App Password (16 caratteri senza spazi)" : "Password casella email"}
              value={form.password}
              onChange={e => setForm({ ...form, password: e.target.value })}
            />
            {isGmail && (
              <div style={{ marginTop: 10, padding: "12px 16px", background: "rgba(251,191,36,0.08)", border: "1px solid rgba(251,191,36,0.3)", borderRadius: 8, fontSize: 12, color: "var(--text-secondary)", lineHeight: 1.7 }}>
                <strong style={{ color: "var(--amber)" }}>Gmail: come generare l&apos;App Password</strong><br />
                1. Vai su <strong>myaccount.google.com</strong> → <strong>Sicurezza</strong><br />
                2. Attiva la <strong>Verifica in 2 passaggi</strong> (se non è già attiva)<br />
                3. Cerca <strong>&quot;Password per le app&quot;</strong> → seleziona &quot;Posta&quot; → &quot;Altro&quot;<br />
                4. Copia le 16 lettere generate e incollale qui sopra
              </div>
            )}
            {form.imap_server === "outlook.office365.com" && (
              <div style={{ marginTop: 10, padding: "12px 16px", background: "rgba(99,102,241,0.08)", border: "1px solid rgba(99,102,241,0.3)", borderRadius: 8, fontSize: 12, color: "var(--text-secondary)", lineHeight: 1.7 }}>
                <strong style={{ color: "#818cf8" }}>Outlook / O365:</strong> usa la tua password Microsoft normale, oppure genera una App Password se l&apos;account ha l&apos;autenticazione a più fattori attiva (<strong>account.microsoft.com</strong> → Sicurezza).
              </div>
            )}
          </div>

          <div style={{ gridColumn: "1 / -1" }}>
            <button
              type="submit"
              disabled={saving}
              className="btn"
              style={{ width: "100%", padding: "12px", background: "var(--blue)", color: "white", fontWeight: 700, fontSize: 14 }}
            >
              {saving ? "Verifica connessione in corso..." : "Testa connessione e salva"}
            </button>
          </div>
        </form>
      </div>

      {/* Lista caselle attive */}
      <h3 style={{ fontSize: 17, fontWeight: 700, marginBottom: 16 }}>Caselle sincronizzate</h3>

      {loading ? (
        <div style={{ color: "var(--text-muted)", padding: 20 }}>Caricamento...</div>
      ) : configs.length === 0 ? (
        <div style={{ padding: "40px", textAlign: "center", border: "1px dashed var(--border)", borderRadius: 10, color: "var(--text-muted)" }}>
          Nessuna casella email configurata.
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          {configs.map(c => (
            <div key={c.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", background: "var(--bg-card)", border: "1px solid var(--border)", padding: "18px 20px", borderRadius: 10 }}>
              <div>
                <div style={{ fontWeight: 700, fontSize: 15, display: "flex", alignItems: "center", gap: 10 }}>
                  ✉️ {c.email_address}
                  <span style={{ fontSize: 11, background: "rgba(16,185,129,0.15)", color: "var(--green)", padding: "2px 10px", borderRadius: 10, fontWeight: 600 }}>
                    ATTIVA · polling ogni 5min
                  </span>
                </div>
                <div style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 4, fontFamily: "var(--font-mono)" }}>
                  {c.imap_server}:{c.imap_port}
                </div>
              </div>
              <button
                onClick={() => handleDelete(c.id)}
                style={{ background: "transparent", border: "1px solid var(--red)", color: "var(--red)", borderRadius: 6, padding: "6px 14px", fontSize: 12, cursor: "pointer", fontWeight: 600 }}
              >
                Disconnetti
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
