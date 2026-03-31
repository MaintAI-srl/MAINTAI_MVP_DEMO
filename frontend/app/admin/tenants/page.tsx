"use client";

import { useEffect, useState } from "react";
import { apiGet, apiPost, apiPut } from "../../lib/api";
import { useAuth } from "../../lib/auth";
import { useRouter } from "next/navigation";

type Tenant = {
  id: number;
  nome: string;
  slug: string;
  is_active: boolean;
  created_at: string | null;
  n_utenti: number;
  n_siti: number;
  n_asset: number;
  n_tecnici: number;
  n_ticket: number;
  admin_username: string | null;
};

const card: React.CSSProperties = {
  background: "var(--bg-surface)",
  border: "1px solid var(--border-strong)",
  borderRadius: "12px",
  padding: "20px",
};

const input: React.CSSProperties = {
  width: "100%",
  padding: "10px 12px",
  background: "var(--bg-base)",
  border: "1px solid var(--border-strong)",
  borderRadius: "8px",
  color: "var(--text-primary)",
  fontSize: "14px",
  boxSizing: "border-box",
};

const btnPrimary: React.CSSProperties = {
  padding: "10px 20px",
  background: "var(--blue)",
  color: "#fff",
  border: "none",
  borderRadius: "8px",
  cursor: "pointer",
  fontWeight: 600,
  fontSize: "13px",
};

const btnSecondary: React.CSSProperties = {
  padding: "6px 14px",
  background: "transparent",
  color: "var(--text-secondary)",
  border: "1px solid var(--border-strong)",
  borderRadius: "6px",
  cursor: "pointer",
  fontSize: "12px",
};

const btnGreen: React.CSSProperties = {
  padding: "6px 14px",
  background: "rgba(16,185,129,0.15)",
  color: "var(--green)",
  border: "1px solid rgba(16,185,129,0.3)",
  borderRadius: "6px",
  cursor: "pointer",
  fontSize: "12px",
};

const btnRed: React.CSSProperties = {
  padding: "6px 14px",
  background: "rgba(239,68,68,0.12)",
  color: "var(--red)",
  border: "1px solid rgba(239,68,68,0.25)",
  borderRadius: "6px",
  cursor: "pointer",
  fontSize: "12px",
};

export default function TenantsPage() {
  const { user } = useAuth();
  const router = useRouter();
  const [tenants, setTenants] = useState<Tenant[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ nome: "", slug: "", admin_username: "", admin_password: "" });
  const [formError, setFormError] = useState("");
  const [saving, setSaving] = useState(false);

  // Modale aggiungi utente
  const [showAddUser, setShowAddUser] = useState<number | null>(null);
  const [userForm, setUserForm] = useState({ username: "", password: "", ruolo: "tecnico" });
  const [userError, setUserError] = useState("");
  const [userSaving, setUserSaving] = useState(false);

  useEffect(() => {
    if (user && user.ruolo !== "superadmin") {
      router.push("/dashboard");
    }
  }, [user, router]);

  const load = async () => {
    try {
      const data = await apiGet<Tenant[]>("/tenants");
      setTenants(data);
    } catch {
      setTenants([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const slugify = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

  const handleNomeChange = (v: string) => {
    setForm(f => ({ ...f, nome: v, slug: f.slug || slugify(v) }));
  };

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError("");
    setSaving(true);
    try {
      await apiPost("/tenants", form);
      setForm({ nome: "", slug: "", admin_username: "", admin_password: "" });
      setShowForm(false);
      await load();
    } catch (err: any) {
      setFormError(err.message || "Errore durante la creazione");
    } finally {
      setSaving(false);
    }
  };

  const toggleActive = async (t: Tenant) => {
    await apiPut(`/tenants/${t.id}`, { is_active: !t.is_active });
    await load();
  };

  const handleAddUser = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!showAddUser) return;
    setUserError("");
    setUserSaving(true);
    try {
      await apiPost(`/tenants/${showAddUser}/utenti`, userForm);
      setShowAddUser(null);
      setUserForm({ username: "", password: "", ruolo: "tecnico" });
      await load();
    } catch (err: any) {
      setUserError(err.message || "Errore");
    } finally {
      setUserSaving(false);
    }
  };

  if (!user || user.ruolo !== "superadmin") return null;

  return (
    <div style={{ padding: "24px", maxWidth: "1100px" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "24px" }}>
        <div>
          <h1 style={{ fontSize: "22px", fontWeight: 700, margin: 0 }}>Gestione Clienti</h1>
          <p style={{ color: "var(--text-secondary)", fontSize: "13px", margin: "4px 0 0" }}>
            Ogni cliente ha i propri dati isolati — siti, impianti, asset, tecnici, ticket.
          </p>
        </div>
        <button style={btnPrimary} onClick={() => setShowForm(!showForm)}>
          {showForm ? "✕ Annulla" : "+ Nuovo Cliente"}
        </button>
      </div>

      {/* Form creazione nuovo tenant */}
      {showForm && (
        <div style={{ ...card, marginBottom: "24px", borderColor: "var(--blue-border)" }}>
          <h3 style={{ fontSize: "14px", fontWeight: 600, marginBottom: "16px", color: "var(--blue)" }}>Nuovo Cliente</h3>
          <form onSubmit={handleCreate}>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px", marginBottom: "12px" }}>
              <div>
                <label style={{ fontSize: "11px", color: "var(--text-secondary)", display: "block", marginBottom: "4px" }}>NOME AZIENDA</label>
                <input style={input} required value={form.nome} onChange={e => handleNomeChange(e.target.value)} placeholder="Es. Industria Rossi S.p.A." />
              </div>
              <div>
                <label style={{ fontSize: "11px", color: "var(--text-secondary)", display: "block", marginBottom: "4px" }}>SLUG (identificatore univoco)</label>
                <input style={input} required value={form.slug} onChange={e => setForm(f => ({ ...f, slug: e.target.value }))} placeholder="es. industria-rossi" pattern="^[a-z0-9\-]+$" />
              </div>
              <div>
                <label style={{ fontSize: "11px", color: "var(--text-secondary)", display: "block", marginBottom: "4px" }}>USERNAME ADMIN</label>
                <input style={input} required value={form.admin_username} onChange={e => setForm(f => ({ ...f, admin_username: e.target.value }))} placeholder="admin_rossi" />
              </div>
              <div>
                <label style={{ fontSize: "11px", color: "var(--text-secondary)", display: "block", marginBottom: "4px" }}>PASSWORD ADMIN</label>
                <input style={input} required type="password" value={form.admin_password} onChange={e => setForm(f => ({ ...f, admin_password: e.target.value }))} placeholder="Min. 6 caratteri" minLength={6} />
              </div>
            </div>
            {formError && <div style={{ color: "var(--red)", fontSize: "12px", marginBottom: "10px" }}>{formError}</div>}
            <button type="submit" style={btnPrimary} disabled={saving}>{saving ? "Creazione..." : "Crea Cliente"}</button>
          </form>
        </div>
      )}

      {/* Lista tenant */}
      {loading ? (
        <div style={{ color: "var(--text-secondary)", textAlign: "center", padding: "48px" }}>Caricamento...</div>
      ) : tenants.length === 0 ? (
        <div style={{ ...card, textAlign: "center", padding: "48px", color: "var(--text-secondary)" }}>
          Nessun cliente trovato. Crea il primo.
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
          {tenants.map(t => (
            <div key={t.id} style={{ ...card, opacity: t.is_active ? 1 : 0.6 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
                <div>
                  <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                    <span style={{ fontSize: "16px", fontWeight: 700 }}>{t.nome}</span>
                    <span style={{ fontSize: "11px", background: "var(--bg-elevated)", padding: "2px 8px", borderRadius: "12px", color: "var(--text-secondary)" }}>
                      {t.slug}
                    </span>
                    {!t.is_active && (
                      <span style={{ fontSize: "11px", background: "rgba(239,68,68,0.1)", color: "var(--red)", padding: "2px 8px", borderRadius: "12px" }}>
                        SOSPESO
                      </span>
                    )}
                  </div>
                  <div style={{ fontSize: "12px", color: "var(--text-secondary)", marginTop: "6px" }}>
                    Admin: <strong>{t.admin_username || "—"}</strong>
                    {t.created_at && (
                      <span style={{ marginLeft: "16px" }}>
                        Creato: {new Date(t.created_at).toLocaleDateString("it-IT")}
                      </span>
                    )}
                  </div>
                </div>
                <div style={{ display: "flex", gap: "8px" }}>
                  <button style={btnSecondary} onClick={() => { setShowAddUser(t.id); setUserForm({ username: "", password: "", ruolo: "tecnico" }); setUserError(""); }}>
                    + Utente
                  </button>
                  <button style={t.is_active ? btnRed : btnGreen} onClick={() => toggleActive(t)}>
                    {t.is_active ? "Sospendi" : "Riattiva"}
                  </button>
                </div>
              </div>

              {/* Statistiche */}
              <div style={{ display: "flex", gap: "20px", marginTop: "14px", paddingTop: "14px", borderTop: "1px solid var(--border-strong)" }}>
                {[
                  { label: "Utenti", val: t.n_utenti },
                  { label: "Siti", val: t.n_siti },
                  { label: "Asset", val: t.n_asset },
                  { label: "Tecnici", val: t.n_tecnici },
                  { label: "Ticket", val: t.n_ticket },
                ].map(s => (
                  <div key={s.label} style={{ textAlign: "center" }}>
                    <div style={{ fontSize: "18px", fontWeight: 700, color: "var(--blue)" }}>{s.val}</div>
                    <div style={{ fontSize: "10px", color: "var(--text-secondary)", textTransform: "uppercase" }}>{s.label}</div>
                  </div>
                ))}
              </div>

              {/* Form aggiungi utente */}
              {showAddUser === t.id && (
                <div style={{ marginTop: "16px", paddingTop: "16px", borderTop: "1px solid var(--border-strong)" }}>
                  <h4 style={{ fontSize: "12px", color: "var(--text-secondary)", marginBottom: "10px" }}>AGGIUNGI UTENTE A {t.nome.toUpperCase()}</h4>
                  <form onSubmit={handleAddUser} style={{ display: "flex", gap: "10px", flexWrap: "wrap", alignItems: "flex-end" }}>
                    <div>
                      <label style={{ fontSize: "11px", color: "var(--text-secondary)", display: "block", marginBottom: "4px" }}>Username</label>
                      <input style={{ ...input, width: "160px" }} required value={userForm.username} onChange={e => setUserForm(f => ({ ...f, username: e.target.value }))} />
                    </div>
                    <div>
                      <label style={{ fontSize: "11px", color: "var(--text-secondary)", display: "block", marginBottom: "4px" }}>Password</label>
                      <input style={{ ...input, width: "140px" }} required type="password" value={userForm.password} onChange={e => setUserForm(f => ({ ...f, password: e.target.value }))} minLength={6} />
                    </div>
                    <div>
                      <label style={{ fontSize: "11px", color: "var(--text-secondary)", display: "block", marginBottom: "4px" }}>Ruolo</label>
                      <select style={{ ...input, width: "140px" }} value={userForm.ruolo} onChange={e => setUserForm(f => ({ ...f, ruolo: e.target.value }))}>
                        <option value="responsabile">Responsabile</option>
                        <option value="tecnico">Tecnico</option>
                      </select>
                    </div>
                    <button type="submit" style={btnPrimary} disabled={userSaving}>{userSaving ? "Salvo..." : "Aggiungi"}</button>
                    <button type="button" style={btnSecondary} onClick={() => setShowAddUser(null)}>Annulla</button>
                  </form>
                  {userError && <div style={{ color: "var(--red)", fontSize: "12px", marginTop: "8px" }}>{userError}</div>}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
