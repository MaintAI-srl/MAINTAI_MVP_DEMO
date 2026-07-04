"use client";

import { useEffect, useState } from "react";
import { apiGet, apiPost, apiPut } from "../../lib/api";
import { notify } from "@/lib/toast";
import { useAuth } from "../../lib/auth";
import { useRouter } from "next/navigation";

type UtenteItem = {
  id: number;
  username: string;
  ruolo: string;
  is_active: boolean;
  tecnico_id: number | null;
  tecnico_nome: string | null;
};

const RUOLI = ["tecnico", "responsabile"];

const RUOLO_COLORS: Record<string, { color: string; bg: string }> = {
  responsabile: { color: "#818cf8", bg: "rgba(99,102,241,.12)" },
  tecnico:      { color: "#34d399", bg: "rgba(52,211,153,.1)" },
  superadmin:   { color: "#f59e0b", bg: "rgba(245,158,11,.1)" },
};

function ruoloBadge(ruolo: string) {
  const c = RUOLO_COLORS[ruolo] ?? { color: "var(--text-muted)", bg: "rgba(148,163,184,.1)" };
  return {
    color: c.color, background: c.bg,
    border: `1px solid ${c.color}40`,
    padding: "2px 8px", borderRadius: 4, fontSize: 11, fontWeight: 600 as const,
  };
}

// Generatore password sicura
function generatePassword() {
  const up = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
  const lo = "abcdefghijklmnopqrstuvwxyz";
  const di = "0123456789";
  const sp = "@$!%*?&#^_-";
  const all = up + lo + di + sp;
  let pwd = up[Math.floor(Math.random() * up.length)]
           + lo[Math.floor(Math.random() * lo.length)]
           + di[Math.floor(Math.random() * di.length)]
           + sp[Math.floor(Math.random() * sp.length)];
  for (let i = 0; i < 8; i++) pwd += all[Math.floor(Math.random() * all.length)];
  return pwd.split("").sort(() => Math.random() - 0.5).join("");
}

export default function AdminUtentiPage() {
  const { user } = useAuth();
  const router = useRouter();

  const [utenti, setUtenti] = useState<UtenteItem[]>([]);
  const [loading, setLoading] = useState(true);

  // Modal nuovo utente
  const [showModal, setShowModal] = useState(false);
  const [newUsername, setNewUsername] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [newRuolo, setNewRuolo] = useState("tecnico");
  const [showPwd, setShowPwd] = useState(false);
  const [saving, setSaving] = useState(false);

  // Modal reset password
  const [resetFor, setResetFor] = useState<UtenteItem | null>(null);
  const [resetPwd, setResetPwd] = useState("");
  const [showResetPwd, setShowResetPwd] = useState(false);
  const [resetting, setResetting] = useState(false);

  // Toggle stato
  const [togglingId, setTogglingId] = useState<number | null>(null);

  useEffect(() => {
    const ruolo = user?.ruolo;
    if (ruolo && ruolo !== "responsabile" && ruolo !== "superadmin") {
      router.replace("/dashboard");
      return;
    }
    load();
  }, [user, router]);

  async function load() {
    setLoading(true);
    try {
      const d = await apiGet<UtenteItem[]>("/utenti");
      setUtenti(d);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Errore";
      notify.error("Errore caricamento utenti: " + msg);
    } finally {
      setLoading(false);
    }
  }

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    if (!newUsername.trim()) { notify.error("Username obbligatorio."); return; }
    if (!newPassword) { notify.error("Password obbligatoria."); return; }
    setSaving(true);
    try {
      await apiPost("/utenti", { username: newUsername.trim(), password: newPassword, ruolo: newRuolo });
      notify.success(`Utente "${newUsername}" creato con successo.`);
      setShowModal(false);
      setNewUsername(""); setNewPassword(""); setNewRuolo("tecnico"); setShowPwd(false);
      await load();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Errore";
      notify.error(msg);
    } finally {
      setSaving(false);
    }
  }

  async function handleResetPassword(e: React.FormEvent) {
    e.preventDefault();
    if (!resetFor) return;
    if (!resetPwd) { notify.error("Inserisci la nuova password."); return; }
    setResetting(true);
    try {
      await apiPut(`/utenti/${resetFor.id}/password`, { new_password: resetPwd });
      notify.success(`Password di "${resetFor.username}" aggiornata. L'utente dovrà rifare il login.`);
      setResetFor(null); setResetPwd(""); setShowResetPwd(false);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Errore";
      notify.error(msg);
    } finally {
      setResetting(false);
    }
  }

  async function handleToggle(u: UtenteItem) {
    setTogglingId(u.id);
    try {
      const res = await apiPut<{ ok: boolean; is_active: boolean; message: string }>(`/utenti/${u.id}/toggle-active`, {});
      notify.success(res.message);
      setUtenti(prev => prev.map(x => x.id === u.id ? { ...x, is_active: res.is_active } : x));
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Errore";
      notify.error(msg);
    } finally {
      setTogglingId(null);
    }
  }

  const card: React.CSSProperties = {
    background: "var(--surface-2)", border: "1px solid rgba(255,255,255,.07)",
    borderRadius: 12, padding: "24px",
  };

  const inputStyle: React.CSSProperties = {
    width: "100%", background: "var(--border-subtle)",
    border: "1px solid rgba(59,130,246,.2)", borderRadius: 6,
    color: "var(--text-primary)", padding: "8px 12px", fontSize: 13, outline: "none",
    fontFamily: "inherit",
  };

  const btnPrimary: React.CSSProperties = {
    padding: "9px 20px", background: "#4f46e5", border: "none",
    borderRadius: 6, color: "#fff", cursor: "pointer", fontSize: 13, fontWeight: 600,
  };

  const btnSecondary: React.CSSProperties = {
    padding: "9px 16px", background: "transparent",
    border: "1px solid rgba(75,85,99,.5)", borderRadius: 6,
    color: "var(--text-secondary)", cursor: "pointer", fontSize: 13,
  };

  return (
    <div style={{ maxWidth: 900, margin: "0 auto", padding: "32px 24px" }}>
      {/* Header */}
      <div style={{ marginBottom: 28 }}>
        <div style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: ".12em", color: "#818cf8", fontWeight: 700, marginBottom: 6 }}>
          Impostazioni
        </div>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 16, flexWrap: "wrap" }}>
          <div>
            <h1 style={{ fontSize: 26, fontWeight: 800, color: "var(--text-primary)", margin: 0 }}>
              Gestione Utenti
            </h1>
            <p style={{ fontSize: 13, color: "var(--text-muted)", margin: "4px 0 0" }}>
              Crea, gestisci e monitora gli account del tuo tenant.
            </p>
          </div>
          <button onClick={() => setShowModal(true)} style={btnPrimary}>
            + Nuovo Utente
          </button>
        </div>
      </div>

      {/* Tabella utenti */}
      <div style={card}>
        <h2 style={{ fontSize: 15, fontWeight: 700, color: "var(--text-primary)", margin: "0 0 16px" }}>
          Utenti del tenant{utenti.length > 0 ? ` (${utenti.length})` : ""}
        </h2>

        {loading ? (
          <div style={{ textAlign: "center", padding: "40px 0", color: "var(--text-muted)", fontSize: 13 }}>
            Caricamento...
          </div>
        ) : utenti.length === 0 ? (
          <div style={{ textAlign: "center", padding: "40px 0", color: "var(--text-muted)", fontSize: 13 }}>
            Nessun utente trovato.
          </div>
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
              <thead>
                <tr style={{ borderBottom: "1px solid rgba(255,255,255,.07)" }}>
                  {["Username", "Ruolo", "Stato", "Tecnico collegato", "Azioni"].map(h => (
                    <th key={h} style={{ textAlign: "left", padding: "8px 12px", fontSize: 11, fontWeight: 700, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: ".08em" }}>
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {utenti.map(u => (
                  <tr key={u.id} style={{ borderBottom: "1px solid var(--border-subtle)", opacity: u.is_active ? 1 : 0.5 }}>
                    <td style={{ padding: "10px 12px", fontWeight: 600, color: "var(--text-primary)" }}>
                      {u.username}
                      {u.username === user?.username && (
                        <span style={{ marginLeft: 6, fontSize: 10, color: "#818cf8" }}>(tu)</span>
                      )}
                    </td>
                    <td style={{ padding: "10px 12px" }}>
                      <span style={ruoloBadge(u.ruolo)}>{u.ruolo}</span>
                    </td>
                    <td style={{ padding: "10px 12px" }}>
                      <span style={{
                        fontSize: 11, fontWeight: 600,
                        color: u.is_active ? "#34d399" : "#94a3b8",
                        background: u.is_active ? "rgba(52,211,153,.1)" : "rgba(148,163,184,.08)",
                        border: `1px solid ${u.is_active ? "rgba(52,211,153,.3)" : "rgba(148,163,184,.2)"}`,
                        padding: "2px 8px", borderRadius: 4,
                      }}>
                        {u.is_active ? "Attivo" : "Inattivo"}
                      </span>
                    </td>
                    <td style={{ padding: "10px 12px", color: "var(--text-soft)", fontSize: 12 }}>
                      {u.tecnico_nome ? (
                        <span style={{ color: "#f59e0b", fontWeight: 600 }}>{u.tecnico_nome}</span>
                      ) : (
                        <span style={{ color: "var(--text-muted)" }}>—</span>
                      )}
                    </td>
                    <td style={{ padding: "10px 12px" }}>
                      <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                        <button
                          onClick={() => { setResetFor(u); setResetPwd(""); setShowResetPwd(false); }}
                          style={{ fontSize: 11, padding: "3px 10px", border: "1px solid rgba(99,102,241,.4)", color: "#818cf8", background: "transparent", cursor: "pointer", borderRadius: 4 }}
                        >
                          Reset Password
                        </button>
                        {u.username !== user?.username && (
                          <button
                            onClick={() => handleToggle(u)}
                            disabled={togglingId === u.id}
                            style={{
                              fontSize: 11, padding: "3px 10px", borderRadius: 4, cursor: "pointer", background: "transparent",
                              border: `1px solid ${u.is_active ? "rgba(248,113,113,.4)" : "rgba(52,211,153,.4)"}`,
                              color: u.is_active ? "#f87171" : "#34d399",
                              opacity: togglingId === u.id ? 0.5 : 1,
                            }}
                          >
                            {togglingId === u.id ? "..." : u.is_active ? "Disattiva" : "Attiva"}
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Modal nuovo utente */}
      {showModal && (
        <div
          style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.7)", zIndex: 9998, display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}
          onClick={e => { if (e.target === e.currentTarget) setShowModal(false); }}
        >
          <div style={{ background: "var(--surface-2)", border: "1px solid var(--border-default)", borderRadius: 12, padding: 28, width: "100%", maxWidth: 420, position: "relative", zIndex: 9999 }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 20 }}>
              <h3 style={{ margin: 0, fontSize: 16, fontWeight: 700, color: "var(--text-primary)" }}>Nuovo Utente</h3>
              <button onClick={() => setShowModal(false)} style={{ background: "transparent", border: "none", color: "var(--text-muted)", cursor: "pointer", fontSize: 18, lineHeight: 1, padding: 4 }}>×</button>
            </div>
            <form onSubmit={handleCreate} style={{ display: "flex", flexDirection: "column", gap: 14 }}>
              <div>
                <label style={{ fontSize: 12, fontWeight: 600, color: "var(--text-secondary)", display: "block", marginBottom: 5 }}>Username *</label>
                <input
                  style={inputStyle}
                  value={newUsername}
                  onChange={e => setNewUsername(e.target.value)}
                  placeholder="Es. mario.rossi"
                  autoFocus
                />
              </div>
              <div>
                <label style={{ fontSize: 12, fontWeight: 600, color: "var(--text-secondary)", display: "block", marginBottom: 5 }}>Password *</label>
                <div style={{ position: "relative" }}>
                  <input
                    style={{ ...inputStyle, paddingRight: 80 }}
                    type={showPwd ? "text" : "password"}
                    value={newPassword}
                    onChange={e => setNewPassword(e.target.value)}
                    placeholder="Min 8 car., maiusc., num., simbolo"
                  />
                  <div style={{ position: "absolute", right: 6, top: "50%", transform: "translateY(-50%)", display: "flex", gap: 4 }}>
                    <button type="button" onClick={() => setShowPwd(p => !p)} style={{ fontSize: 10, padding: "2px 6px", background: "rgba(255,255,255,.07)", border: "1px solid var(--border-default)", borderRadius: 3, color: "var(--text-muted)", cursor: "pointer" }}>
                      {showPwd ? "Nascondi" : "Mostra"}
                    </button>
                    <button type="button" onClick={() => setNewPassword(generatePassword())} style={{ fontSize: 10, padding: "2px 6px", background: "rgba(99,102,241,.15)", border: "1px solid rgba(99,102,241,.3)", borderRadius: 3, color: "#818cf8", cursor: "pointer" }}>
                      Genera
                    </button>
                  </div>
                </div>
                <div style={{ fontSize: 10, color: "var(--text-muted)", marginTop: 3 }}>
                  Min 8 car. — maiusc., minusc., numero, simbolo (@$!%*?&#^_-)
                </div>
              </div>
              <div>
                <label style={{ fontSize: 12, fontWeight: 600, color: "var(--text-secondary)", display: "block", marginBottom: 5 }}>Ruolo</label>
                <select style={inputStyle} value={newRuolo} onChange={e => setNewRuolo(e.target.value)}>
                  {RUOLI.map(r => <option key={r} value={r}>{r}</option>)}
                </select>
              </div>
              <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 4 }}>
                <button type="button" onClick={() => setShowModal(false)} style={btnSecondary}>Annulla</button>
                <button type="submit" disabled={saving} style={{ ...btnPrimary, opacity: saving ? 0.7 : 1 }}>
                  {saving ? "Creazione..." : "Crea utente"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal reset password */}
      {resetFor && (
        <div
          style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.7)", zIndex: 9998, display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}
          onClick={e => { if (e.target === e.currentTarget) { setResetFor(null); setResetPwd(""); } }}
        >
          <div style={{ background: "var(--surface-2)", border: "1px solid var(--border-default)", borderRadius: 12, padding: 28, width: "100%", maxWidth: 400, position: "relative", zIndex: 9999 }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 20 }}>
              <h3 style={{ margin: 0, fontSize: 16, fontWeight: 700, color: "var(--text-primary)" }}>Reset Password</h3>
              <button onClick={() => { setResetFor(null); setResetPwd(""); }} style={{ background: "transparent", border: "none", color: "var(--text-muted)", cursor: "pointer", fontSize: 18, lineHeight: 1, padding: 4 }}>×</button>
            </div>
            <p style={{ margin: "0 0 16px", fontSize: 13, color: "var(--text-secondary)" }}>
              Nuova password per <strong style={{ color: "var(--text-primary)" }}>{resetFor.username}</strong>.
              Le sessioni attive verranno invalidate.
            </p>
            <form onSubmit={handleResetPassword} style={{ display: "flex", flexDirection: "column", gap: 14 }}>
              <div>
                <label style={{ fontSize: 12, fontWeight: 600, color: "var(--text-secondary)", display: "block", marginBottom: 5 }}>Nuova password *</label>
                <div style={{ position: "relative" }}>
                  <input
                    style={{ ...inputStyle, paddingRight: 80 }}
                    type={showResetPwd ? "text" : "password"}
                    value={resetPwd}
                    onChange={e => setResetPwd(e.target.value)}
                    placeholder="Min 8 car., maiusc., num., simbolo"
                    autoFocus
                  />
                  <div style={{ position: "absolute", right: 6, top: "50%", transform: "translateY(-50%)", display: "flex", gap: 4 }}>
                    <button type="button" onClick={() => setShowResetPwd(p => !p)} style={{ fontSize: 10, padding: "2px 6px", background: "rgba(255,255,255,.07)", border: "1px solid var(--border-default)", borderRadius: 3, color: "var(--text-muted)", cursor: "pointer" }}>
                      {showResetPwd ? "Nascondi" : "Mostra"}
                    </button>
                    <button type="button" onClick={() => setResetPwd(generatePassword())} style={{ fontSize: 10, padding: "2px 6px", background: "rgba(99,102,241,.15)", border: "1px solid rgba(99,102,241,.3)", borderRadius: 3, color: "#818cf8", cursor: "pointer" }}>
                      Genera
                    </button>
                  </div>
                </div>
              </div>
              <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
                <button type="button" onClick={() => { setResetFor(null); setResetPwd(""); }} style={btnSecondary}>Annulla</button>
                <button type="submit" disabled={resetting} style={{ ...btnPrimary, background: "#dc2626", opacity: resetting ? 0.7 : 1 }}>
                  {resetting ? "Aggiornamento..." : "Aggiorna password"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
