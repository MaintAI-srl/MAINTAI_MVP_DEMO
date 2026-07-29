"use client";

import { useEffect, useState } from "react";
import { apiGet, apiPost, apiPut } from "../../lib/api";
import { useAuth } from "../../lib/auth";
import { useRouter } from "next/navigation";
import { notify } from "@/lib/toast";
import { getTenantContext, setTenantContext } from "../../components/TenantContextSwitcher";
import { getLocaleTag, useT, tn } from "@/app/lib/i18n";

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

type Utente = {
  id: number;
  username: string;
  ruolo: string;
  is_active: boolean;
};

const card: React.CSSProperties = {
  background: "var(--bg-surface)",
  border: "1px solid var(--border-strong)",
  borderRadius: "12px",
  padding: "20px",
};

const inp: React.CSSProperties = {
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

const btnSm: React.CSSProperties = {
  padding: "5px 12px",
  background: "transparent",
  color: "var(--text-secondary)",
  border: "1px solid var(--border-strong)",
  borderRadius: "6px",
  cursor: "pointer",
  fontSize: "12px",
};

const btnGreen: React.CSSProperties = {
  padding: "5px 12px",
  background: "rgba(16,185,129,0.15)",
  color: "var(--green)",
  border: "1px solid rgba(16,185,129,0.3)",
  borderRadius: "6px",
  cursor: "pointer",
  fontSize: "12px",
};

const btnRed: React.CSSProperties = {
  padding: "5px 12px",
  background: "rgba(239,68,68,0.12)",
  color: "var(--red)",
  border: "1px solid rgba(239,68,68,0.25)",
  borderRadius: "6px",
  cursor: "pointer",
  fontSize: "12px",
};

const RUOLO_COLORS: Record<string, string> = {
  superadmin: "#a78bfa",
  responsabile: "var(--blue)",
  tecnico: "var(--green)",
};

export default function TenantsPage() {
  const tr = useT();
  const { user } = useAuth();
  const router = useRouter();

  const [tenants, setTenants] = useState<Tenant[]>([]);
  const [loading, setLoading] = useState(true);

  // Form nuovo tenant
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ nome: "", slug: "", admin_username: "", admin_password: "" });
  const [formError, setFormError] = useState("");
  const [saving, setSaving] = useState(false);

  // Lista utenti per tenant (espansa)
  const [expandedUtenti, setExpandedUtenti] = useState<number | null>(null);
  const [utentiMap, setUtentiMap] = useState<Record<number, Utente[]>>({});
  const [utentiLoading, setUtentiLoading] = useState(false);

  // Form aggiungi utente
  const [showAddUser, setShowAddUser] = useState<number | null>(null);
  const [userForm, setUserForm] = useState({ username: "", password: "", ruolo: "tecnico" });
  const [userError, setUserError] = useState("");
  const [userSaving, setUserSaving] = useState(false);

  // Reset password utente
  const [resetPwd, setResetPwd] = useState<{ tenantId: number; userId: number; username: string } | null>(null);
  const [resetPwdVal, setResetPwdVal] = useState("");
  const [resetPwdSaving, setResetPwdSaving] = useState(false);

  useEffect(() => {
    if (user && user.ruolo !== "superadmin") router.push("/dashboard");
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

  const loadUtenti = async (tenantId: number) => {
    if (expandedUtenti === tenantId) {
      setExpandedUtenti(null);
      return;
    }
    setUtentiLoading(true);
    setExpandedUtenti(tenantId);
    try {
      const data = await apiGet<Utente[]>(`/tenants/${tenantId}/utenti`);
      setUtentiMap(m => ({ ...m, [tenantId]: data }));
    } catch {
      setUtentiMap(m => ({ ...m, [tenantId]: [] }));
    } finally {
      setUtentiLoading(false);
    }
  };

  const slugify = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError("");
    setSaving(true);
    try {
      await apiPost("/tenants", form);
      setForm({ nome: "", slug: "", admin_username: "", admin_password: "" });
      setShowForm(false);
      await load();
    } catch (err: unknown) {
      setFormError(err instanceof Error ? err.message : "Errore durante la creazione");
    } finally {
      setSaving(false);
    }
  };

  const toggleActive = async (t: Tenant) => {
    try {
      await apiPut(`/tenants/${t.id}`, { is_active: !t.is_active });
    } catch (err: unknown) {
      notify.error(err instanceof Error ? err.message : "Errore aggiornamento tenant");
    }
    await load();
  };

  // Passa al contesto del tenant e apri la dashboard per gestirlo
  const gestisciTenant = (t: Tenant) => {
    setTenantContext(String(t.id));
    window.location.href = "/dashboard";
  };

  const activeContext = typeof window !== "undefined" ? getTenantContext() : null;

  const handleAddUser = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!showAddUser) return;
    setUserError("");
    setUserSaving(true);
    try {
      await apiPost(`/tenants/${showAddUser}/utenti`, userForm);
      setShowAddUser(null);
      setUserForm({ username: "", password: "", ruolo: "tecnico" });
      // Ricarica lista utenti se espansa
      if (expandedUtenti === showAddUser) {
        const data = await apiGet<Utente[]>(`/tenants/${showAddUser}/utenti`);
        setUtentiMap(m => ({ ...m, [showAddUser]: data }));
      }
      await load();
    } catch (err: unknown) {
      setUserError(err instanceof Error ? err.message : "Errore");
    } finally {
      setUserSaving(false);
    }
  };

  const handleResetPwd = async () => {
    if (!resetPwd) return;
    if (resetPwdVal.length < 4) { notify.error("Password troppo corta (min 4 caratteri)"); return; }
    setResetPwdSaving(true);
    try {
      await apiPut(`/tenants/${resetPwd.tenantId}/utenti/${resetPwd.userId}/password`, { new_password: resetPwdVal });
      notify.success(tn("Password di \"{username}\" aggiornata", { username: resetPwd.username }));
      setResetPwd(null);
      setResetPwdVal("");
    } catch (err: unknown) {
      notify.error(err instanceof Error ? err.message : "Errore reset password");
    } finally {
      setResetPwdSaving(false);
    }
  };

  if (!user || user.ruolo !== "superadmin") return null;

  return (
    <div style={{ padding: "24px", maxWidth: "1100px" }}>
      {/* Header */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "24px" }}>
        <div>
          <h1 style={{ fontSize: "22px", fontWeight: 700, margin: 0 }}>{tr("Gestione Clienti")}</h1>
          <p style={{ color: "var(--text-secondary)", fontSize: "13px", margin: "4px 0 0" }}>
            {tr("Ogni cliente ha dati completamente isolati — siti, impianti, asset, tecnici, ticket.")}
          </p>
        </div>
        <button style={btnPrimary} onClick={() => { setShowForm(!showForm); setFormError(""); }}>
          {showForm ? "✕ Annulla" : tr("+ Nuovo Cliente")}
        </button>
      </div>

      {/* Form nuovo tenant */}
      {showForm && (
        <div style={{ ...card, marginBottom: "24px", borderColor: "rgba(59,130,246,0.4)" }}>
          <h3 style={{ fontSize: "14px", fontWeight: 600, marginBottom: "16px", color: "var(--blue)" }}>{tr("Nuovo Cliente")}</h3>
          <form onSubmit={handleCreate}>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px", marginBottom: "12px" }}>
              <div>
                <label style={{ fontSize: "11px", color: "var(--text-secondary)", display: "block", marginBottom: "4px" }}>{tr("NOME AZIENDA")}</label>
                <input style={inp} required value={form.nome}
                  onChange={e => setForm(f => ({ ...f, nome: e.target.value, slug: f.slug || slugify(e.target.value) }))}
                  placeholder={tr("Es. Industria Rossi S.p.A.")} />
              </div>
              <div>
                <label style={{ fontSize: "11px", color: "var(--text-secondary)", display: "block", marginBottom: "4px" }}>{tr("SLUG (univoco, solo minuscole/trattini)")}</label>
                <input style={inp} required value={form.slug}
                  onChange={e => setForm(f => ({ ...f, slug: e.target.value }))}
                  placeholder="industria-rossi" pattern="^[a-z0-9\-]+$" />
              </div>
              <div>
                <label style={{ fontSize: "11px", color: "var(--text-secondary)", display: "block", marginBottom: "4px" }}>{tr("USERNAME ADMIN")}</label>
                <input style={inp} required value={form.admin_username}
                  onChange={e => setForm(f => ({ ...f, admin_username: e.target.value }))}
                  placeholder="admin_rossi" />
              </div>
              <div>
                <label style={{ fontSize: "11px", color: "var(--text-secondary)", display: "block", marginBottom: "4px" }}>{tr("PASSWORD ADMIN (min 6 caratteri)")}</label>
                <input style={inp} required type="password" value={form.admin_password}
                  onChange={e => setForm(f => ({ ...f, admin_password: e.target.value }))}
                  placeholder="••••••••" minLength={6} />
              </div>
            </div>
            {formError && <div style={{ color: "var(--red)", fontSize: "12px", marginBottom: "10px" }}>{formError}</div>}
            <button type="submit" style={btnPrimary} disabled={saving}>{saving ? tr("Creazione...") : tr("Crea Cliente")}</button>
          </form>
        </div>
      )}

      {/* Lista tenant */}
      {loading ? (
        <div style={{ color: "var(--text-secondary)", textAlign: "center", padding: "48px" }}>{tr("Caricamento...")}</div>
      ) : tenants.length === 0 ? (
        <div style={{ ...card, textAlign: "center", padding: "48px", color: "var(--text-secondary)" }}>
          {tr("Nessun cliente. Creane uno con \"+ Nuovo Cliente\".")}
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: "14px" }}>
          {tenants.map(t => (
            <div key={t.id} style={{ ...card, opacity: t.is_active ? 1 : 0.65 }}>

              {/* Header tenant */}
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
                <div>
                  <div style={{ display: "flex", alignItems: "center", gap: "10px", flexWrap: "wrap" }}>
                    <span style={{ fontSize: "17px", fontWeight: 700 }}>{t.nome}</span>
                    <span style={{ fontSize: "11px", background: "var(--bg-elevated)", padding: "2px 8px", borderRadius: "12px", color: "var(--text-secondary)", fontFamily: "monospace" }}>
                      {t.slug}
                    </span>
                    <span style={{ fontSize: "11px", padding: "2px 8px", borderRadius: "12px", background: t.is_active ? "rgba(16,185,129,0.1)" : "rgba(239,68,68,0.1)", color: t.is_active ? "var(--green)" : "var(--red)" }}>
                      {t.is_active ? tr("● ATTIVO") : "● SOSPESO"}
                    </span>
                  </div>
                  {t.created_at && (
                    <div style={{ fontSize: "12px", color: "var(--text-secondary)", marginTop: "4px" }}>
                      {tr("Creato il")} {new Date(t.created_at).toLocaleDateString(getLocaleTag())}
                    </div>
                  )}
                </div>
                <div style={{ display: "flex", gap: "8px", flexShrink: 0 }}>
                  {activeContext === String(t.id) ? (
                    <span style={{ ...btnGreen, cursor: "default", display: "inline-flex", alignItems: "center", gap: 5 }}>
                      {tr("● Contesto attivo")}
                    </span>
                  ) : (
                    <button
                      style={{ ...btnSm, color: "var(--blue)", borderColor: "rgba(59,130,246,0.35)" }}
                      onClick={() => gestisciTenant(t)}
                      title={`Passa al contesto di ${t.nome} e gestisci le sue funzionalità`}
                    >
                      {tr("⇄ Gestisci")}
                    </button>
                  )}
                  <button style={btnSm} onClick={() => { setShowAddUser(showAddUser === t.id ? null : t.id); setUserForm({ username: "", password: "", ruolo: "tecnico" }); setUserError(""); }}>
                    {tr("+ Utente")}
                  </button>
                  <button style={t.is_active ? btnRed : btnGreen} onClick={() => toggleActive(t)}>
                    {t.is_active ? "Sospendi" : "Riattiva"}
                  </button>
                </div>
              </div>

              {/* Statistiche */}
              <div style={{ display: "flex", gap: "24px", marginTop: "14px", paddingTop: "14px", borderTop: "1px solid var(--border-strong)", flexWrap: "wrap" }}>
                {[
                  { label: "Siti", val: t.n_siti },
                  { label: tr("Asset"), val: t.n_asset },
                  { label: tr("Tecnici"), val: t.n_tecnici },
                  { label: tr("Ticket"), val: t.n_ticket },
                ].map(s => (
                  <div key={s.label} style={{ textAlign: "center", minWidth: "50px" }}>
                    <div style={{ fontSize: "20px", fontWeight: 700, color: "var(--blue)" }}>{s.val}</div>
                    <div style={{ fontSize: "10px", color: "var(--text-secondary)", textTransform: "uppercase", letterSpacing: "0.5px" }}>{tr(s.label)}</div>
                  </div>
                ))}

                {/* Pulsante utenti con contatore */}
                <button
                  onClick={() => loadUtenti(t.id)}
                  style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: "6px", padding: "6px 14px", background: expandedUtenti === t.id ? "rgba(59,130,246,0.12)" : "transparent", border: "1px solid var(--border-strong)", borderRadius: "8px", cursor: "pointer", color: expandedUtenti === t.id ? "var(--blue)" : "var(--text-secondary)", fontSize: "13px" }}
                >
                  👤 {t.n_utenti} {t.n_utenti === 1 ? tr("utente") : tr("utenti")}
                  <span style={{ fontSize: "10px" }}>{expandedUtenti === t.id ? "▲" : "▼"}</span>
                </button>
              </div>

              {/* Lista utenti espansa */}
              {expandedUtenti === t.id && (
                <div style={{ marginTop: "14px", paddingTop: "14px", borderTop: "1px solid var(--border-strong)" }}>
                  <div style={{ fontSize: "11px", color: "var(--text-secondary)", textTransform: "uppercase", letterSpacing: "0.5px", marginBottom: "10px" }}>
                    {tr("Utenti di")} {t.nome}
                  </div>
                  {utentiLoading ? (
                    <div style={{ color: "var(--text-secondary)", fontSize: "13px" }}>{tr("Caricamento...")}</div>
                  ) : (utentiMap[t.id] || []).length === 0 ? (
                    <div style={{ color: "var(--text-secondary)", fontSize: "13px" }}>{tr("Nessun utente trovato.")}</div>
                  ) : (
                    <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
                      {(utentiMap[t.id] || []).map(u => (
                        <div key={u.id} style={{ display: "flex", alignItems: "center", gap: "12px", padding: "8px 12px", background: "var(--bg-elevated)", borderRadius: "8px" }}>
                          <span style={{ fontSize: "14px", fontWeight: 600, flex: 1 }}>{u.username}</span>
                          <span style={{ fontSize: "11px", padding: "2px 10px", borderRadius: "12px", background: "rgba(0,0,0,0.2)", color: RUOLO_COLORS[u.ruolo] || "var(--text-secondary)", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.5px" }}>
                            {u.ruolo}
                          </span>
                          {!u.is_active && (
                            <span style={{ fontSize: "11px", color: "var(--red)" }}>disabilitato</span>
                          )}
                          <button
                            style={{ ...btnSm, fontSize: "11px", padding: "3px 10px" }}
                            onClick={() => { setResetPwd({ tenantId: t.id, userId: u.id, username: u.username }); setResetPwdVal(""); }}
                          >
                            {tr("🔑 Reset pwd")}
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {/* Form aggiungi utente inline */}
              {showAddUser === t.id && (
                <div style={{ marginTop: "14px", paddingTop: "14px", borderTop: "1px solid var(--border-strong)" }}>
                  <div style={{ fontSize: "11px", color: "var(--text-secondary)", textTransform: "uppercase", letterSpacing: "0.5px", marginBottom: "10px" }}>
                    {tr("Nuovo utente per")} {t.nome}
                  </div>
                  <form onSubmit={handleAddUser} style={{ display: "flex", gap: "10px", flexWrap: "wrap", alignItems: "flex-end" }}>
                    <div>
                      <label style={{ fontSize: "11px", color: "var(--text-secondary)", display: "block", marginBottom: "4px" }}>{tr("USERNAME")}</label>
                      <input style={{ ...inp, width: "170px" }} required value={userForm.username}
                        onChange={e => setUserForm(f => ({ ...f, username: e.target.value }))} placeholder="mario.rossi" />
                    </div>
                    <div>
                      <label style={{ fontSize: "11px", color: "var(--text-secondary)", display: "block", marginBottom: "4px" }}>{tr("PASSWORD")}</label>
                      <input style={{ ...inp, width: "150px" }} required type="password" value={userForm.password}
                        onChange={e => setUserForm(f => ({ ...f, password: e.target.value }))} placeholder={tr("min. 6 caratteri")} minLength={6} />
                    </div>
                    <div>
                      <label style={{ fontSize: "11px", color: "var(--text-secondary)", display: "block", marginBottom: "4px" }}>{tr("RUOLO")}</label>
                      <select style={{ ...inp, width: "150px" }} value={userForm.ruolo}
                        onChange={e => setUserForm(f => ({ ...f, ruolo: e.target.value }))}>
                        <option value="responsabile">{tr("Responsabile")}</option>
                        <option value="tecnico">{tr("Tecnico")}</option>
                      </select>
                    </div>
                    <button type="submit" style={btnPrimary} disabled={userSaving}>
                      {userSaving ? "Salvo..." : "Aggiungi"}
                    </button>
                    <button type="button" style={btnSm} onClick={() => setShowAddUser(null)}>{tr("Annulla")}</button>
                  </form>
                  {userError && <div style={{ color: "var(--red)", fontSize: "12px", marginTop: "8px" }}>{userError}</div>}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Modal reset password */}
      {resetPwd && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.75)", zIndex: 9999, display: "flex", alignItems: "center", justifyContent: "center", backdropFilter: "blur(4px)" }}>
          <div style={{ background: "var(--surface-2)", border: "1px solid rgba(239,68,68,0.4)", borderRadius: "16px", padding: "28px", width: 380, boxShadow: "0 24px 60px rgba(0,0,0,0.6)" }}>
            <div style={{ fontWeight: 800, fontSize: "16px", color: "#f87171", marginBottom: "6px" }}>{tr("Reset Password")}</div>
            <div style={{ fontSize: "13px", color: "var(--text-muted)", marginBottom: "20px" }}>
              {tr("Nuova password per")} <strong style={{ color: "var(--text-primary)" }}>{resetPwd.username}</strong>
            </div>
            <input
              type="password"
              autoFocus
              value={resetPwdVal}
              onChange={e => setResetPwdVal(e.target.value)}
              placeholder={tr("Min 8 char (Maiusc, minusc, num, sim)")}
              style={{ ...inp, marginBottom: "8px" }}
              onKeyDown={e => { if (e.key === "Enter") handleResetPwd(); if (e.key === "Escape") setResetPwd(null); }}
            />
            <div style={{ fontSize: "11px", color: "var(--text-muted)", marginBottom: "20px", display: "flex",flexDirection: "column", gap:"2px" }}>
              <div>{tr("• Almeno 8 caratteri")}</div>
              <div>{tr("• Lettere maiuscole e minuscole")}</div>
              <div>{tr("• Almeno un numero e un simbolo (@$!%*?&#^_-)")}</div>
            </div>
            <div style={{ display: "flex", gap: "10px" }}>
              <button style={{ ...btnSm, flex: 1, padding: "10px" }} onClick={() => setResetPwd(null)}>{tr("Annulla")}</button>
              <button
                style={{ flex: 2, padding: "10px", background: "rgba(239,68,68,0.15)", color: "#f87171", border: "1px solid rgba(239,68,68,0.3)", borderRadius: "8px", cursor: "pointer", fontWeight: 700, fontSize: "13px" }}
                disabled={resetPwdSaving || resetPwdVal.length < 8}
                onClick={handleResetPwd}
              >
                {resetPwdSaving ? "Salvo..." : "Conferma Reset"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
