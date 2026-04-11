"use client";

import { useEffect, useState } from "react";
import { apiGet, apiPost, apiPut, apiDelete } from "../lib/api";
import { notify } from "@/lib/toast";

type PianoManutenzione = {
  id: number;
  nome_codificato: string;
  progressivo: number;
  descrizione: string | null;
  stato: string;
  asset_id: number | null;
  impianto_id: number | null;
  sito_id: number | null;
  manuale_id: number | null;
  created_at: string;
};

type Ticket = {
  id: number;
  titolo: string;
  stato: string;
  durata_stimata_ore: number;
  origine_piano: string | null;
};

export default function PianiManutenzionePage() {
  const [piani, setPiani] = useState<PianoManutenzione[]>([]);
  const [loading, setLoading] = useState(true);
  
  // Create state
  const [showNewForm, setShowNewForm] = useState(false);
  const [newCodice, setNewCodice] = useState("");
  const [newDescrizione, setNewDescrizione] = useState("");

  // Edit/Detail state
  const [selectedPiano, setSelectedPiano] = useState<PianoManutenzione | null>(null);
  const [pianoTickets, setPianoTickets] = useState<Ticket[]>([]);
  const [ticketsLoading, setTicketsLoading] = useState(false);

  useEffect(() => {
    loadPiani();
  }, []);

  async function loadPiani() {
    setLoading(true);
    try {
      const res = await apiGet<{items: PianoManutenzione[]}>("/piani-manutenzione?limit=100");
      setPiani(res.items);
    } catch {
      notify.error("Errore durante il caricamento dei Piani");
    } finally {
      setLoading(false);
    }
  }

  async function handleSubmitCreate(e: React.FormEvent) {
    e.preventDefault();
    if (!newCodice.trim()) {
      notify.error("Codice obbligatorio");
      return;
    }
    
    try {
      const payload = {
        nome_codificato: newCodice,
        progressivo: piani.length + 1,
        descrizione: newDescrizione || null,
        stato: "attivo"
      };
      await apiPost("/piani-manutenzione", payload);
      notify.success("Piano di manutenzione creato!");
      setShowNewForm(false);
      setNewCodice("");
      setNewDescrizione("");
      await loadPiani();
    } catch {
      notify.error("Errore, codice potebbe essere duplicato");
    }
  }

  async function openDetail(p: PianoManutenzione) {
    setSelectedPiano(p);
    setTicketsLoading(true);
    try {
       // Possiamo recuperare i ticket con una chiamata generica ai ticket filtrando lato frontend
       // Poiché non abbiamo un endpoint dedicato al momento, facciamo un loop backend limitato
       const tcks = await apiGet<{items: Ticket[]}>("/tickets?limit=500");
       setPianoTickets(tcks.items.filter((t: any) => t.piano_manutenzione_id === p.id));
    } catch (err) {
       console.error("Non è stato possibile estrarre i ticket associati");
    } finally {
       setTicketsLoading(false);
    }
  }

  async function deletePiano(id: number) {
    if (!confirm("Sei sicuro di voler scollegare i ticket ed eliminare questo piano?")) return;
    try {
      await apiDelete(`/piani-manutenzione/${id}`);
      notify.success("Piano eliminato");
      if (selectedPiano?.id === id) setSelectedPiano(null);
      await loadPiani();
    } catch {
      notify.error("Errore durante l'eliminazione");
    }
  }

  return (
    <div style={{ padding: "24px 32px", maxWidth: 1300, margin: "0 auto", color: "var(--text-primary)", display: "flex", gap: "24px", height: "100%" }}>
      
      {/* LEFT COL: Lista */}
      <div style={{ flex: 1, display: "flex", flexDirection: "column", background: "var(--bg-surface)", border: "1px solid var(--border)", borderRadius: 12, overflow: "hidden" }}>
        <div style={{ padding: 16, borderBottom: "1px solid var(--border)", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <h2 style={{ fontSize: 18, fontWeight: 700, margin: 0 }}>Strutture Piani</h2>
          <button 
            onClick={() => setShowNewForm(!showNewForm)}
            style={{ padding: "8px 12px", background: "var(--blue)", color: "#fff", border: "none", borderRadius: 6, fontWeight: 600, cursor: "pointer" }}
          >
            + Nuovo Piano
          </button>
        </div>

        {showNewForm && (
          <form onSubmit={handleSubmitCreate} style={{ padding: 16, borderBottom: "1px solid var(--border)", background: "rgba(59,130,246,0.05)", display: "flex", flexDirection: "column", gap: 12 }}>
            <input 
              placeholder="Nome codificato (es. PM-2026-A)" 
              value={newCodice} onChange={e => setNewCodice(e.target.value)} 
              style={{ padding: 10, background: "var(--bg-elevated)", border: "1px solid var(--border)", borderRadius: 6, color: "var(--text-primary)", outline: "none" }}
            />
            <input 
              placeholder="Descrizione opzionale" 
              value={newDescrizione} onChange={e => setNewDescrizione(e.target.value)} 
              style={{ padding: 10, background: "var(--bg-elevated)", border: "1px solid var(--border)", borderRadius: 6, color: "var(--text-primary)", outline: "none" }}
            />
            <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
              <button type="button" onClick={() => setShowNewForm(false)} style={{ padding: "8px 12px", background: "transparent", border: "1px solid var(--border)", borderRadius: 6, color: "var(--text-primary)", cursor: "pointer", fontSize: 12 }}>Annulla</button>
              <button type="submit" style={{ padding: "8px 12px", background: "var(--blue)", border: "none", borderRadius: 6, color: "#fff", cursor: "pointer", fontWeight: 600, fontSize: 12 }}>Salva</button>
            </div>
          </form>
        )}

        <div style={{ flex: 1, overflowY: "auto", padding: 16, display: "flex", flexDirection: "column", gap: 8 }}>
          {loading ? (
            <div style={{ textAlign: "center", padding: 40, color: "var(--text-muted)" }}>Caricamento...</div>
          ) : piani.length === 0 ? (
            <div style={{ textAlign: "center", padding: 40, color: "var(--text-muted)" }}>Nessun piano di manutenzione strutturato presente nel database.</div>
          ) : (
            piani.map(p => {
              const iso = selectedPiano?.id === p.id;
              return (
                <div key={p.id} onClick={() => openDetail(p)} style={{ 
                  padding: 12, borderRadius: 8, border: `1px solid ${iso ? 'var(--blue)' : 'var(--border)'}`, 
                  background: iso ? 'rgba(59,130,246,0.1)' : 'var(--bg-elevated)', cursor: "pointer", display: "flex", justifyContent: "space-between", alignItems: "center"
                }}>
                  <div>
                    <div style={{ fontWeight: 700, fontSize: 14, color: iso ? "var(--blue)" : "inherit" }}>{p.nome_codificato}</div>
                    {p.descrizione && <div style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 4 }}>{p.descrizione}</div>}
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                    <span style={{ fontSize: 11, background: "rgba(255,255,255,0.05)", padding: "2px 6px", borderRadius: 4, color: "var(--text-secondary)" }}>ID: {p.id}</span>
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>

      {/* RIGHT COL: Detail */}
      <div style={{ flex: 1, display: "flex", flexDirection: "column", background: "var(--bg-surface)", border: "1px solid var(--border)", borderRadius: 12, overflow: "hidden" }}>
        {selectedPiano ? (
          <>
            <div style={{ padding: 16, borderBottom: "1px solid var(--border)", display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
              <div>
                <h2 style={{ fontSize: 20, fontWeight: 800, margin: 0 }}>{selectedPiano.nome_codificato}</h2>
                <div style={{ fontSize: 13, color: "var(--text-muted)", marginTop: 4 }}>Struttura a database persistente</div>
              </div>
              <button 
                 onClick={() => deletePiano(selectedPiano.id)}
                 style={{ background: "rgba(239,68,68,0.1)", color: "#ef4444", border: "1px solid rgba(239,68,68,0.3)", padding: "6px 12px", borderRadius: 6, fontSize: 12, cursor: "pointer", fontWeight: 700 }}
              >
                Elimina Piano
              </button>
            </div>
            
            <div style={{ padding: 16 }}>
              <h3 style={{ fontSize: 14, color: "var(--text-secondary)", marginBottom: 12, textTransform: "uppercase", letterSpacing: "1px" }}>Ticket Collegati</h3>
              
              {ticketsLoading ? (
                 <div style={{ color: "var(--text-muted)", fontSize: 13 }}>Recupero ticket storici...</div>
              ) : pianoTickets.length === 0 ? (
                 <div style={{ padding: 24, background: "rgba(255,255,255,0.02)", border: "1px dashed var(--border)", borderRadius: 8, textAlign: "center" }}>
                   <div style={{ color: "var(--text-secondary)", fontSize: 13, marginBottom: 8 }}>Nessun ticket in questa struttura.</div>
                   <div style={{ color: "var(--text-muted)", fontSize: 11 }}>Utilizza le funzioni di import per popolare il piano (es. "aggiungi a piano xyz" dai manuali o scadenze).</div>
                 </div>
              ) : (
                <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                  {pianoTickets.map(t => (
                    <div key={t.id} style={{ padding: 12, background: "var(--bg-elevated)", border: "1px solid var(--border)", borderRadius: 8 }}>
                      <div style={{ fontWeight: 600, fontSize: 13 }}>{t.titolo}</div>
                      <div style={{ display: "flex", gap: 8, marginTop: 6, fontSize: 11 }}>
                        <span style={{ color: "var(--text-muted)", background: "rgba(255,255,255,0.05)", padding: "2px 6px", borderRadius: 4 }}>{t.durata_stimata_ore}h</span>
                        <span style={{ color: "var(--text-muted)", background: "rgba(255,255,255,0.05)", padding: "2px 6px", borderRadius: 4 }}>Origine: {t.origine_piano || "Sconosciuta"}</span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </>
        ) : (
          <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", color: "var(--text-muted)", fontSize: 14 }}>
            Seleziona un piano per vederne i dettagli.
          </div>
        )}
      </div>

    </div>
  );
}
