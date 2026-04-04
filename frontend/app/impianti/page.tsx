"use client";

import { useEffect, useState } from "react";
import { API_BASE, apiGet, apiPost, apiPut, apiDelete } from "../lib/api";

type Impianto = { 
  id: number; 
  nome: string; 
  descrizione: string; 
  latitude?: number; 
  longitude?: number 
};

export default function ImpiantiPage() {
  const [impianti, setImpianti] = useState<Impianto[]>([]);
  const [nome, setNome] = useState("");
  const [descrizione, setDescrizione] = useState("");
  const [latitude, setLatitude] = useState<string>("");
  const [longitude, setLongitude] = useState<string>("");
  const [editId, setEditId] = useState<number | null>(null);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [backendOk, setBackendOk] = useState<boolean | null>(null);

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
    setError("");
  }

  function cancelEdit() {
    setEditId(null);
    setNome(""); 
    setDescrizione(""); 
    setLatitude(""); 
    setLongitude(""); 
    setError("");
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!nome.trim()) { setError("Il nome impianto è obbligatorio."); return; }
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
    } catch (err: any) {
      setError(err.message || "Errore salvataggio.");
    } finally { setSaving(false); }
  }

  async function handleDelete(id: number) {
    if (!confirm("Eliminare questo impianto?")) return;
    try {
      await apiDelete(`/impianti/${id}`);
      await load();
    } catch {}
  }

  const cardStyle: React.CSSProperties = { background: "var(--bg-elevated)", border: "1px solid var(--border)", borderRadius: 12, padding: "20px 24px" };
  const inputStyle: React.CSSProperties = { background: "var(--bg-surface)", border: "1px solid var(--border-strong)", borderRadius: 7, color: "var(--text-primary)", padding: "8px 12px", fontSize: 13, width: "100%", outline: "none" };
  const btnPrimary: React.CSSProperties = { background: "linear-gradient(135deg,#6366f1,#4f46e5)", color: "#fff", border: "none", borderRadius: 8, padding: "8px 20px", fontWeight: 700, fontSize: 13, cursor: "pointer" };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
      <div>
        <div style={{ fontSize: 10, textTransform: "uppercase", letterSpacing: "0.18em", color: "var(--text-muted)", marginBottom: 6 }}>Registry</div>
        <h1 className="page-title">Impianti</h1>
        <p className="page-subtitle">Gestione degli impianti — contenitori di asset e piani di manutenzione.</p>
      </div>

      {backendOk === false && (
        <div style={{ color: "#fbbf24", background: "rgba(251,191,36,.08)", border: "1px solid rgba(251,191,36,.3)", padding: "12px 16px", borderRadius: 8, fontSize: 13 }}>
          ⚠️ Backend non raggiungibile su <code style={{ fontFamily: "monospace" }}>{API_BASE}</code>.<br />
          Apri il terminale nella cartella <strong>maintai_v3</strong> e lancia:<br />
          <code style={{ fontFamily: "monospace", fontSize: 12 }}>python -m uvicorn backend.main:app --reload</code>
        </div>
      )}
      {error && <div style={{ color: "#fecaca", background: "rgba(127,29,29,.35)", border: "1px solid rgba(248,113,113,.35)", padding: "10px 14px", borderRadius: 8 }}>{error}</div>}

      <div style={{ display: "grid", gridTemplateColumns: "380px 1fr", gap: 20, alignItems: "start" }}>
        {/* Form */}
        <div style={cardStyle}>
          <h2 style={{ margin: "0 0 16px", fontSize: 15, fontWeight: 800, color: "var(--text-primary)" }}>
            {editId !== null ? `Modifica impianto #${editId}` : "Nuovo impianto"}
          </h2>
          <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            <div>
              <label style={{ fontSize: 11, fontWeight: 700, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: ".1em", display: "block", marginBottom: 4 }}>Nome *</label>
              <input style={inputStyle} value={nome} onChange={e => setNome(e.target.value)} placeholder="Es. Stabilimento Nord" />
            </div>
            <div>
              <label style={{ fontSize: 11, fontWeight: 700, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: ".1em", display: "block", marginBottom: 4 }}>Descrizione</label>
              <textarea style={{ ...inputStyle, resize: "vertical", minHeight: 70 }} value={descrizione} onChange={e => setDescrizione(e.target.value)} placeholder="Descrizione opzionale..." />
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
              <div>
                <label style={{ fontSize: 11, fontWeight: 700, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: ".1em", display: "block", marginBottom: 4 }}>Latitudine</label>
                <input type="number" step="0.0001" style={inputStyle} value={latitude} onChange={e => setLatitude(e.target.value)} placeholder="es. 44.307" />
              </div>
              <div>
                <label style={{ fontSize: 11, fontWeight: 700, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: ".1em", display: "block", marginBottom: 4 }}>Longitudine</label>
                <input type="number" step="0.0001" style={inputStyle} value={longitude} onChange={e => setLongitude(e.target.value)} placeholder="es. 8.481" />
              </div>
            </div>
            <div style={{ display: "flex", gap: 8 }}>
              <button style={btnPrimary} type="submit" disabled={saving}>{saving ? "…" : editId !== null ? "Salva modifiche" : "Crea impianto"}</button>
              {editId !== null && (
                <button type="button" onClick={cancelEdit} style={{ ...btnPrimary, background: "transparent", border: "1px solid rgba(148,163,184,.3)", color: "var(--text-muted)" }}>Annulla</button>
              )}
            </div>
          </form>
        </div>

        {/* Lista */}
        <div style={cardStyle}>
          <h2 style={{ margin: "0 0 16px", fontSize: 15, fontWeight: 800, color: "var(--text-primary)" }}>Impianti registrati ({impianti.length})</h2>
          {impianti.length === 0 ? (
            <div style={{ color: "var(--text-muted)", textAlign: "center", padding: 24 }}>Nessun impianto registrato.</div>
          ) : (
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
              <thead>
                <tr style={{ borderBottom: "1px solid var(--border)" }}>
                  {["ID", "Nome", "Descrizione", "Coord", ""].map(h => (
                    <th key={h} style={{ padding: "8px 12px", textAlign: "left", fontSize: 10, fontWeight: 700, letterSpacing: ".1em", textTransform: "uppercase", color: "var(--text-muted)" }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {impianti.map(imp => (
                  <tr key={imp.id} style={{ borderBottom: "1px solid var(--border)" }}>
                    <td style={{ padding: "10px 12px", color: "var(--text-muted)", fontFamily: "monospace" }}>#{imp.id}</td>
                    <td style={{ padding: "10px 12px", fontWeight: 700, color: "var(--text-primary)" }}>{imp.nome}</td>
                    <td style={{ padding: "10px 12px", color: "var(--text-secondary)" }}>{imp.descrizione || "—"}</td>
                    <td style={{ padding: "10px 12px", fontSize: 11, color: "var(--text-muted)" }}>{imp.latitude ? `${imp.latitude}, ${imp.longitude}` : "—"}</td>
                    <td style={{ padding: "10px 12px" }}>
                      <button onClick={() => startEdit(imp)} style={{ marginRight: 8, fontSize: 11, padding: "3px 10px", border: "1px solid rgba(99,102,241,.4)", color: "#818cf8", background: "transparent", cursor: "pointer", borderRadius: 4 }}>Modifica</button>
                      <button onClick={() => handleDelete(imp.id)} style={{ fontSize: 11, padding: "3px 10px", border: "1px solid rgba(248,113,113,.3)", color: "#f87171", background: "transparent", cursor: "pointer", borderRadius: 4 }}>Elimina</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}
