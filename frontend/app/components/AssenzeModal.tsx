"use client";

import { useEffect, useState } from "react";
import { API_BASE } from "../lib/api";

type Assenza = {
  id: number;
  tecnico_id: number;
  data_inizio: string;
  data_fine: string;
  tipo_assenza: string;
  note?: string;
};

type Props = {
  tecnico: { id: number; nome: string; cognome?: string };
  onClose: () => void;
};

export default function AssenzeModal({ tecnico, onClose }: Props) {
  const [assenze, setAssenze] = useState<Assenza[]>([]);
  const [loading, setLoading] = useState(true);

  // Form
  const [dataInizio, setDataInizio] = useState("");
  const [dataFine, setDataFine] = useState("");
  const [tipo, setTipo] = useState("Ferie");
  const [note, setNote] = useState("");

  const nameFull = `${tecnico.nome} ${tecnico.cognome || ""}`.trim();

  useEffect(() => {
    loadAssenze();
  }, [tecnico.id]);

  async function loadAssenze() {
    setLoading(true);
    try {
      const res = await fetch(`${API_BASE}/tecnici/${tecnico.id}/assenze`);
      if (res.ok) setAssenze(await res.json());
    } finally {
      setLoading(false);
    }
  }

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault();
    if (!dataInizio || !dataFine) return alert("Inserisci inizio e fine");
    
    // Add timezone adjustment logic assuming local dates input
    const di = new Date(dataInizio);
    const df = new Date(dataFine);
    if (di > df) return alert("Inizio deve essere precedente a Fine");

    try {
      const res = await fetch(`${API_BASE}/tecnici/${tecnico.id}/assenze`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          data_inizio: new Date(dataInizio).toISOString(),
          data_fine: new Date(dataFine).toISOString(),
          tipo_assenza: tipo,
          note
        })
      });
      if (res.ok) {
        setDataInizio("");
        setDataFine("");
        setNote("");
        loadAssenze();
      } else {
        const error = await res.json();
        alert(error.detail || "Errore");
      }
    } catch (e) {
      alert("Errore di rete");
    }
  }

  async function handleDelete(id: number) {
    if (!confirm("Rimuovere questa assenza?")) return;
    try {
      const res = await fetch(`${API_BASE}/tecnici/assenze/${id}`, { method: "DELETE" });
      if (res.ok) loadAssenze();
    } catch {
      alert("Errore di rete");
    }
  }

  return (
    <div style={{
      position: "fixed", top: 0, left: 0, width: "100%", height: "100%",
      background: "rgba(0,0,0,0.6)", backdropFilter: "blur(4px)",
      zIndex: 9999, display: "flex", alignItems: "center", justifyContent: "center"
    }}>
      <div style={{
        background: "var(--card-bg)", border: "1px solid var(--border-color)",
        borderRadius: 16, width: "95%", maxWidth: 600, padding: 24, boxShadow: "0 25px 50px -12px rgba(0,0,0,0.5)"
      }}>
        <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 20 }}>
          <h2 style={{ fontSize: 20, fontWeight: 700 }}>Calendario Assenze · {nameFull}</h2>
          <button onClick={onClose} style={{ background: "none", border: "none", color: "var(--text-soft)", fontSize: 20, cursor: "pointer" }}>&times;</button>
        </div>

        {/* Add Form */}
        <form onSubmit={handleAdd} style={{ display: "flex", gap: 12, marginBottom: 24, padding: 16, background: "rgba(255,255,255,0.02)", borderRadius: 12, border: "1px solid rgba(255,255,255,0.05)", flexWrap: "wrap", alignItems: "flex-end" }}>
          <div style={{ flex: 1, minWidth: 120 }}>
            <label style={{ display: "block", fontSize: 11, marginBottom: 4, color: "var(--text-secondary)" }}>Dal</label>
            <input required type="date" value={dataInizio} onChange={e => setDataInizio(e.target.value)} style={{ width: "100%", padding: "8px 12px", borderRadius: 6, background: "var(--card-bg)", color: "white", border: "1px solid var(--border-color)" }} />
          </div>
          <div style={{ flex: 1, minWidth: 120 }}>
            <label style={{ display: "block", fontSize: 11, marginBottom: 4, color: "var(--text-secondary)" }}>Al</label>
            <input required type="date" value={dataFine} onChange={e => setDataFine(e.target.value)} style={{ width: "100%", padding: "8px 12px", borderRadius: 6, background: "var(--card-bg)", color: "white", border: "1px solid var(--border-color)" }} />
          </div>
          <div style={{ flex: 1, minWidth: 100 }}>
            <label style={{ display: "block", fontSize: 11, marginBottom: 4, color: "var(--text-secondary)" }}>Motivo</label>
            <select value={tipo} onChange={e => setTipo(e.target.value)} style={{ width: "100%", padding: "8px 12px", borderRadius: 6, background: "var(--card-bg)", color: "white", border: "1px solid var(--border-color)" }}>
              <option>Ferie</option>
              <option>Malattia</option>
              <option>Corso</option>
              <option>Permesso/Altro</option>
            </select>
          </div>
          <div style={{ flex: 2, minWidth: 200 }}>
            <label style={{ display: "block", fontSize: 11, marginBottom: 4, color: "var(--text-secondary)" }}>Note (Opzionale)</label>
            <input value={note} onChange={e => setNote(e.target.value)} placeholder="Dettagli..." style={{ width: "100%", padding: "8px 12px", borderRadius: 6, background: "var(--card-bg)", color: "white", border: "1px solid var(--border-color)" }} />
          </div>
          <div>
            <button type="submit" style={{ padding: "8px 16px", borderRadius: 6, background: "var(--blue-bright)", color: "white", border: "none", fontWeight: 600, cursor: "pointer", height: 36 }}>Aggiungi</button>
          </div>
        </form>

        {/* List */}
        <div>
          <h3 style={{ fontSize: 14, color: "var(--text-secondary)", marginBottom: 12 }}>Assenze Registrate</h3>
          {loading ? (
            <div style={{ textAlign: "center", padding: 20, color: "var(--text-soft)" }}>Caricamento in corso...</div>
          ) : assenze.length === 0 ? (
            <div style={{ textAlign: "center", padding: 30, background: "rgba(255,255,255,0.01)", borderRadius: 12, border: "1px dashed rgba(255,255,255,0.1)", color: "var(--text-soft)" }}>Nessuna assenza programmata.</div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 8, maxHeight: 300, overflowY: "auto" }}>
              {assenze.sort((a,b) => new Date(a.data_inizio).getTime() - new Date(b.data_inizio).getTime()).map(ass => {
                const start = new Date(ass.data_inizio).toLocaleDateString("it-IT");
                const end = new Date(ass.data_fine).toLocaleDateString("it-IT");
                const isPast = new Date(ass.data_fine).getTime() < Date.now();
                return (
                  <div key={ass.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "12px 16px", background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.06)", borderRadius: 8, opacity: isPast ? 0.6 : 1 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
                      <div style={{ width: 44, height: 44, borderRadius: 8, background: "rgba(59,130,246,0.1)", color: "var(--blue-bright)", display: "flex", alignItems: "center", justifyContent: "center", flexDirection: "column", lineHeight: 1.1 }}>
                        <strong style={{ fontSize: 16 }}>{new Date(ass.data_inizio).getDate()}</strong>
                        <span style={{ fontSize: 10, textTransform: "uppercase" }}>{new Date(ass.data_inizio).toLocaleString('it-IT', { month: 'short' })}</span>
                      </div>
                      <div>
                        <div style={{ fontWeight: 600, fontSize: 14, color: "var(--text-primary)" }}>
                          {ass.tipo_assenza} <span style={{ color: "var(--text-soft)", fontWeight: 400, marginLeft: 8 }}>{start} → {end}</span>
                        </div>
                        {ass.note && <div style={{ fontSize: 12, color: "var(--text-secondary)", marginTop: 4 }}>{ass.note}</div>}
                      </div>
                    </div>
                    <button onClick={() => handleDelete(ass.id)} style={{ background: "none", border: "1px solid rgba(248,113,113,0.3)", color: "#f87171", borderRadius: 6, padding: "6px 12px", fontSize: 12, cursor: "pointer", transition: "0.2s" }}>Rimuovi</button>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
