"use client";

import { useEffect, useState } from "react";
import { API_BASE, apiGet, apiPost, apiPut, apiDelete } from "../lib/api";
import { notify } from "@/lib/toast";

type Impianto = {
  id: number;
  nome: string;
  descrizione: string;
  latitude?: number;
  longitude?: number
};

const inputStyle: React.CSSProperties = {
  background: "var(--border-subtle)",
  border: "1px solid rgba(148,163,184,0.15)",
  borderRadius: 8,
  color: "var(--text-primary)",
  padding: "9px 13px",
  fontSize: 13,
  width: "100%",
  outline: "none",
  fontFamily: "inherit",
  transition: "border-color 0.15s",
};

const labelStyle: React.CSSProperties = {
  fontSize: 10, fontWeight: 700, color: "var(--text-muted)",
  textTransform: "uppercase", letterSpacing: ".12em", display: "block", marginBottom: 5,
};

export default function ImpiantiPage() {
  const [impianti, setImpianti] = useState<Impianto[]>([]);
  const [search, setSearch] = useState("");
  const [nome, setNome] = useState("");
  const [descrizione, setDescrizione] = useState("");
  const [latitude, setLatitude] = useState<string>("");
  const [longitude, setLongitude] = useState<string>("");
  const [editId, setEditId] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);
  const [backendOk, setBackendOk] = useState<boolean | null>(null);
  const [modalDelId, setModalDelId] = useState<number | null>(null);

  useEffect(() => { load(); }, []);

  async function load() {
    try {
      const d = await apiGet<Impianto[]>("/impianti");
      setImpianti(Array.isArray(d) ? d : []);
      setBackendOk(true);
    } catch {
      setBackendOk(false);
    }
  }

  function startEdit(imp: Impianto) {
    setEditId(imp.id);
    setNome(imp.nome);
    setDescrizione(imp.descrizione);
    setLatitude(imp.latitude ? String(imp.latitude) : "");
    setLongitude(imp.longitude ? String(imp.longitude) : "");
  }

  function cancelEdit() {
    setEditId(null);
    setNome("");
    setDescrizione("");
    setLatitude("");
    setLongitude("");
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!nome.trim()) { notify.error("Il nome impianto è obbligatorio."); return; }
    setSaving(true);
    try {
      const path = editId !== null ? `/impianti/${editId}` : `/impianti`;
      const payload = {
        nome,
        descrizione,
        latitude: latitude ? Number(latitude) : null,
        longitude: longitude ? Number(longitude) : null
      };
      if (editId !== null) {
        await apiPut(path, payload);
      } else {
        await apiPost(path, payload);
      }
      await load();
      cancelEdit();
    } catch (err: unknown) {
      notify.error(err instanceof Error ? err.message : "Errore salvataggio.");
    } finally { setSaving(false); }
  }

  async function handleConfirmDelete() {
    if (modalDelId === null) return;
    try {
      await apiDelete(`/impianti/${modalDelId}`);
      await load();
    } catch { notify.error("Errore durante l'eliminazione."); }
    finally { setModalDelId(null); }
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 0 }}>
      {/* ── HERO ── */}
      <div style={{
        position: "relative", overflow: "hidden",
        background: "linear-gradient(135deg, rgba(99,102,241,0.08) 0%, rgba(139,92,246,0.05) 50%, transparent 100%)",
        borderBottom: "1px solid rgba(99,102,241,0.12)",
        padding: "36px 32px 28px",
        marginBottom: 28,
      }}>
        {/* mesh grid */}
        <div style={{ position: "absolute", inset: 0, backgroundImage: "linear-gradient(rgba(99,102,241,0.04) 1px, transparent 1px), linear-gradient(90deg, rgba(99,102,241,0.04) 1px, transparent 1px)", backgroundSize: "32px 32px", pointerEvents: "none" }} />
        {/* glow */}
        <div style={{ position: "absolute", top: -60, right: -60, width: 280, height: 280, borderRadius: "50%", background: "radial-gradient(circle, rgba(99,102,241,0.12) 0%, transparent 70%)", pointerEvents: "none" }} />

        <div style={{ position: "relative" }}>
          <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: "0.2em", textTransform: "uppercase", color: "#818cf8", marginBottom: 8 }}>Registry</div>
          <h1 style={{ margin: 0, fontSize: 32, fontWeight: 900, fontFamily: "'Barlow Condensed', sans-serif", background: "linear-gradient(135deg, #e2e8f0 0%, #818cf8 100%)", WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent", lineHeight: 1.1, marginBottom: 6 }}>
            Impianti
          </h1>
          <p style={{ margin: 0, color: "var(--text-muted)", fontSize: 13 }}>
            Gestione degli impianti — contenitori di asset e piani di manutenzione.
          </p>
        </div>

        {/* KPI strip */}
        <div style={{ display: "flex", gap: 16, marginTop: 20, flexWrap: "wrap" }}>
          {[
            { label: "Impianti totali", value: impianti.length, color: "#818cf8" },
            { label: "Con coordinate", value: impianti.filter(i => i.latitude).length, color: "#34d399" },
            { label: "Senza descrizione", value: impianti.filter(i => !i.descrizione).length, color: "#fbbf24" },
          ].map(k => (
            <div key={k.label} style={{ background: "var(--border-subtle)", border: "1px solid rgba(255,255,255,0.07)", borderRadius: 10, padding: "10px 18px", minWidth: 110 }}>
              <div style={{ fontSize: 9, textTransform: "uppercase", letterSpacing: ".12em", color: "var(--text-muted)", marginBottom: 4 }}>{k.label}</div>
              <div style={{ fontSize: 22, fontWeight: 800, color: k.color, lineHeight: 1 }}>{k.value}</div>
            </div>
          ))}
        </div>
      </div>

      {backendOk === false && (
        <div style={{ color: "#fbbf24", background: "rgba(251,191,36,.08)", border: "1px solid rgba(251,191,36,.3)", padding: "12px 16px", borderRadius: 8, fontSize: 13, margin: "0 32px 20px" }}>
          ⚠️ Backend non raggiungibile su <code style={{ fontFamily: "monospace" }}>{API_BASE}</code>. Lancia: <code style={{ fontFamily: "monospace", fontSize: 12 }}>python -m uvicorn backend.main:app --reload</code>
        </div>
      )}

      <div style={{ display: "grid", gridTemplateColumns: "380px 1fr", gap: 20, alignItems: "start", padding: "0 32px 32px" }}>
        {/* Form */}
        <div style={{ background: "var(--bg-card)", border: "1px solid rgba(99,102,241,0.2)", borderRadius: 14, padding: "22px 24px", borderTop: "2px solid #6366f1" }}>
          <h2 style={{ margin: "0 0 18px", fontSize: 14, fontWeight: 800, color: "var(--text-primary)", letterSpacing: ".02em" }}>
            {editId !== null ? `Modifica impianto #${editId}` : "Nuovo impianto"}
          </h2>
          <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: 13 }}>
            <div>
              <label style={labelStyle}>Nome *</label>
              <input style={inputStyle} value={nome} onChange={e => setNome(e.target.value)} placeholder="Es. Stabilimento Nord" />
            </div>
            <div>
              <label style={labelStyle}>Descrizione</label>
              <textarea style={{ ...inputStyle, resize: "vertical", minHeight: 70 }} value={descrizione} onChange={e => setDescrizione(e.target.value)} placeholder="Descrizione opzionale..." />
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
              <div>
                <label style={labelStyle}>Latitudine</label>
                <input type="number" step="0.0001" style={inputStyle} value={latitude} onChange={e => setLatitude(e.target.value)} placeholder="es. 44.307" />
              </div>
              <div>
                <label style={labelStyle}>Longitudine</label>
                <input type="number" step="0.0001" style={inputStyle} value={longitude} onChange={e => setLongitude(e.target.value)} placeholder="es. 8.481" />
              </div>
            </div>
            <div style={{ display: "flex", gap: 8, marginTop: 4 }}>
              <button
                type="submit"
                disabled={saving}
                style={{ flex: 1, background: "linear-gradient(135deg,#6366f1,#4f46e5)", color: "#fff", border: "none", borderRadius: 8, padding: "9px 20px", fontWeight: 700, fontSize: 13, cursor: saving ? "not-allowed" : "pointer", opacity: saving ? 0.7 : 1 }}
              >
                {saving ? "Salvataggio..." : editId !== null ? "Salva modifiche" : "Crea impianto"}
              </button>
              {editId !== null && (
                <button type="button" onClick={cancelEdit} style={{ padding: "9px 16px", background: "transparent", border: "1px solid rgba(148,163,184,.2)", color: "var(--text-muted)", borderRadius: 8, cursor: "pointer", fontSize: 13 }}>Annulla</button>
              )}
            </div>
          </form>
        </div>

        {/* Lista */}
        <div style={{ background: "var(--bg-card)", border: "1px solid rgba(255,255,255,0.07)", borderRadius: 14, padding: "22px 24px" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 14 }}>
            <h2 style={{ margin: 0, fontSize: 14, fontWeight: 800, color: "var(--text-primary)" }}>Impianti registrati</h2>
            <span style={{ fontSize: 11, background: "rgba(99,102,241,0.12)", color: "#818cf8", border: "1px solid rgba(99,102,241,0.25)", borderRadius: 20, padding: "2px 10px", fontWeight: 700 }}>{impianti.length}</span>
          </div>
          {/* Barra di ricerca */}
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Cerca per nome impianto..."
            style={{ width: "100%", background: "var(--border-subtle)", border: "1px solid rgba(148,163,184,0.15)", borderRadius: 8, color: "var(--text-primary)", padding: "8px 12px", fontSize: 13, outline: "none", fontFamily: "inherit", marginBottom: 14, boxSizing: "border-box" }}
          />
          {(() => {
            const term = search.trim().toLowerCase();
            const filtered = term ? impianti.filter(i => i.nome.toLowerCase().includes(term) || (i.descrizione || "").toLowerCase().includes(term)) : impianti;
            return filtered.length === 0 ? (
              <div style={{ color: "var(--text-muted)", textAlign: "center", padding: "32px 0", fontSize: 13 }}>{impianti.length === 0 ? "Nessun impianto registrato." : "Nessun impianto corrisponde alla ricerca."}</div>
            ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {filtered.map(imp => (
                <div key={imp.id} style={{ background: "var(--border-subtle)", border: "1px solid var(--border-subtle)", borderRadius: 10, padding: "14px 16px", display: "flex", alignItems: "center", gap: 14, transition: "background 0.15s" }}>
                  <div style={{ width: 36, height: 36, borderRadius: 9, background: "linear-gradient(135deg,rgba(99,102,241,0.2),rgba(139,92,246,0.1))", border: "1px solid rgba(99,102,241,0.25)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 13, fontWeight: 800, color: "#818cf8", flexShrink: 0 }}>
                    {imp.id}
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontWeight: 700, fontSize: 14, color: "var(--text-primary)", marginBottom: 2 }}>{imp.nome}</div>
                    <div style={{ fontSize: 12, color: "var(--text-muted)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {imp.descrizione || "Nessuna descrizione"}
                      {imp.latitude && <span style={{ marginLeft: 10, color: "#34d399" }}>📍 {imp.latitude}, {imp.longitude}</span>}
                    </div>
                  </div>
                  <div style={{ display: "flex", gap: 6, flexShrink: 0 }}>
                    <button onClick={() => startEdit(imp)} style={{ fontSize: 11, padding: "4px 12px", border: "1px solid rgba(99,102,241,.35)", color: "#818cf8", background: "rgba(99,102,241,0.08)", cursor: "pointer", borderRadius: 6, fontWeight: 600 }}>Modifica</button>
                    <button onClick={() => setModalDelId(imp.id)} style={{ fontSize: 11, padding: "4px 12px", border: "1px solid rgba(248,113,113,.3)", color: "#f87171", background: "rgba(248,113,113,0.06)", cursor: "pointer", borderRadius: 6, fontWeight: 600 }}>Elimina</button>
                  </div>
                </div>
              ))}
            </div>
          );
          })()}
        </div>
      </div>

      {/* Modal Conferma Elimina */}
      {modalDelId !== null && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.7)", zIndex: 1000, display: "flex", alignItems: "center", justifyContent: "center", backdropFilter: "blur(4px)" }} onClick={() => setModalDelId(null)}>
          <div style={{ background: "var(--bg-surface)", border: "1px solid rgba(248,113,113,0.25)", borderRadius: 14, padding: "28px 28px 24px", width: 480, boxShadow: "0 24px 64px rgba(0,0,0,0.5)" }} onClick={e => e.stopPropagation()}>
            <div style={{ width: 44, height: 44, borderRadius: 12, background: "rgba(248,113,113,0.12)", border: "1px solid rgba(248,113,113,0.25)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 20, marginBottom: 16 }}>⚠️</div>
            <h2 style={{ margin: "0 0 10px", fontSize: 17, fontWeight: 800 }}>Elimina Impianto</h2>
            <p style={{ color: "var(--text-secondary)", fontSize: 13, marginBottom: 24, lineHeight: 1.6 }}>
              Sei sicuro? L'operazione eliminerà a cascata <strong>tutti i dati collegati</strong> (Asset, Piani, Ticket, Documenti, Analisi). Azione irreversibile.
            </p>
            <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
              <button onClick={() => setModalDelId(null)} style={{ background: "transparent", border: "1px solid var(--border)", color: "var(--text-primary)", padding: "8px 18px", borderRadius: 8, cursor: "pointer", fontSize: 13 }}>Annulla</button>
              <button onClick={handleConfirmDelete} style={{ background: "rgba(248,113,113,0.15)", border: "1px solid rgba(248,113,113,0.4)", color: "#f87171", padding: "8px 18px", borderRadius: 8, cursor: "pointer", fontWeight: 700, fontSize: 13 }}>Elimina definitivamente</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
