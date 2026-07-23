"use client";

import { useCallback, useEffect, useState } from "react";
import { apiGet, apiPost, apiDelete } from "../lib/api";
import { notify } from "@/lib/toast";

// Gestione dei ricambi richiesti da un ticket (il "+ ricambi").
// Un ricambio a catalogo con disponibilità sufficiente non blocca la
// pianificazione; un ricambio nuovo o insufficiente sì (proposta d'acquisto).

interface RigaRicambio {
  id: number;
  ricambio_id: number | null;
  codice: string | null;
  descrizione: string | null;
  quantita: number;
  unita_misura: string | null;
  is_nuovo: boolean;
  stato_acquisto: string | null;
  disponibile: number;
  sufficiente: boolean;
}

interface StatusResponse {
  ticket_id: number;
  righe: RigaRicambio[];
  bloccante: boolean;
  mancanti: string[];
}

interface CatalogItem {
  id: number;
  codice: string;
  descrizione: string;
  disponibile: number;
  unita_misura?: string | null;
}

export default function RicambiTicket({ ticketId, onChange }: { ticketId: number; onChange?: () => void }) {
  const [status, setStatus] = useState<StatusResponse | null>(null);
  const [catalog, setCatalog] = useState<CatalogItem[]>([]);
  const [mode, setMode] = useState<"catalogo" | "nuovo">("catalogo");
  const [selRicambio, setSelRicambio] = useState<string>("");
  const [descrNuovo, setDescrNuovo] = useState("");
  const [qta, setQta] = useState("1");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const data = await apiGet<StatusResponse>(`/tickets/${ticketId}/ricambi`);
      setStatus(data);
    } catch { /* modulo non attivo o errore: componente silenzioso */ }
  }, [ticketId]);

  const loadCatalog = useCallback(async () => {
    try {
      const data = await apiGet<{ ricambi: CatalogItem[] }>("/ricambi?solo_attivi=true");
      setCatalog(data.ricambi);
    } catch { /* silenzioso */ }
  }, []);

  useEffect(() => { load(); loadCatalog(); }, [load, loadCatalog]);

  const add = async () => {
    const q = Number(qta);
    if (!Number.isFinite(q) || q <= 0) { notify.warning("Quantità non valida"); return; }
    setBusy(true);
    try {
      const body = mode === "catalogo"
        ? { ricambio_id: Number(selRicambio), quantita: q }
        : { ricambio_id: null, descrizione: descrNuovo.trim(), quantita: q };
      if (mode === "catalogo" && !selRicambio) { notify.warning("Seleziona un ricambio"); setBusy(false); return; }
      if (mode === "nuovo" && !descrNuovo.trim()) { notify.warning("Indica la descrizione del ricambio nuovo"); setBusy(false); return; }
      const data = await apiPost<StatusResponse>(`/tickets/${ticketId}/ricambi`, body);
      setStatus(data);
      setSelRicambio(""); setDescrNuovo(""); setQta("1");
      onChange?.();
    } catch (e) {
      notify.error(e instanceof Error ? e.message : "Errore aggiunta ricambio");
    } finally {
      setBusy(false);
    }
  };

  const remove = async (rowId: number) => {
    setBusy(true);
    try {
      const data = await apiDelete<StatusResponse>(`/tickets/${ticketId}/ricambi/${rowId}`);
      setStatus(data);
      onChange?.();
    } catch {
      notify.error("Errore rimozione ricambio");
    } finally {
      setBusy(false);
    }
  };

  const inputSt: React.CSSProperties = {
    padding: "7px 10px", background: "var(--surface-2)", border: "1px solid rgba(148,163,184,0.2)",
    borderRadius: 7, color: "var(--text-primary)", fontSize: 13, outline: "none", boxSizing: "border-box", fontFamily: "inherit",
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      {/* Avviso vincolo pianificazione */}
      {status?.bloccante && (
        <div style={{ background: "rgba(239,68,68,0.08)", border: "1px solid rgba(239,68,68,0.35)", borderRadius: 8, padding: "8px 12px", fontSize: 12, color: "#fca5a5" }}>
          ⚠️ Ticket non pianificabile: ricambi da approvvigionare ({status.mancanti.join(", ")}). Il piano proporrà l&apos;acquisto.
        </div>
      )}
      {status && !status.bloccante && status.righe.length > 0 && (
        <div style={{ background: "rgba(34,197,94,0.08)", border: "1px solid rgba(34,197,94,0.30)", borderRadius: 8, padding: "8px 12px", fontSize: 12, color: "#86efac" }}>
          ✓ Ricambi disponibili a magazzino: il ticket è pianificabile.
        </div>
      )}

      {/* Righe ricambi */}
      {status && status.righe.length > 0 && (
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          {status.righe.map(r => (
            <div key={r.id} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, padding: "8px 10px", background: "var(--surface-2)", border: "1px solid var(--border-default)", borderRadius: 8 }}>
              <div style={{ display: "flex", flexDirection: "column", gap: 2, minWidth: 0 }}>
                <div style={{ fontSize: 13, color: "var(--text-primary)", fontWeight: 600, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                  {r.codice ? `${r.codice} — ` : ""}{r.descrizione}
                </div>
                <div style={{ fontSize: 11, color: "var(--text-muted)" }}>
                  Qtà {r.quantita}{r.unita_misura ? ` ${r.unita_misura}` : ""}
                  {r.is_nuovo
                    ? <span style={{ marginLeft: 8, color: "#f87171", fontWeight: 700 }}>NUOVO — da acquistare</span>
                    : <span style={{ marginLeft: 8, color: r.sufficiente ? "#22c55e" : "#f87171", fontWeight: 700 }}>
                        {r.sufficiente ? `disp. ${r.disponibile}` : `insufficiente (disp. ${r.disponibile})`}
                      </span>}
                </div>
              </div>
              <button type="button" onClick={() => remove(r.id)} disabled={busy} title="Rimuovi" style={{ background: "transparent", border: "none", cursor: "pointer", color: "#64748b", fontSize: 15 }}>✕</button>
            </div>
          ))}
        </div>
      )}

      {/* Aggiunta ricambio */}
      <div style={{ display: "flex", flexDirection: "column", gap: 8, padding: "10px", background: "var(--surface-2)", border: "1px dashed var(--border-default)", borderRadius: 8 }}>
        <div style={{ display: "flex", gap: 6 }}>
          <button type="button" onClick={() => setMode("catalogo")} style={{ flex: 1, padding: "6px", borderRadius: 6, fontSize: 12, fontWeight: 600, cursor: "pointer", border: "1px solid var(--border-default)", background: mode === "catalogo" ? "#1d4ed8" : "transparent", color: mode === "catalogo" ? "#fff" : "var(--text-soft)" }}>Da catalogo</button>
          <button type="button" onClick={() => setMode("nuovo")} style={{ flex: 1, padding: "6px", borderRadius: 6, fontSize: 12, fontWeight: 600, cursor: "pointer", border: "1px solid var(--border-default)", background: mode === "nuovo" ? "#1d4ed8" : "transparent", color: mode === "nuovo" ? "#fff" : "var(--text-soft)" }}>Nuovo (acquisto)</button>
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          {mode === "catalogo" ? (
            <select style={{ ...inputSt, flex: 1, minWidth: 180 }} value={selRicambio} onChange={e => setSelRicambio(e.target.value)}>
              <option value="">Seleziona ricambio…</option>
              {catalog.map(c => (
                <option key={c.id} value={c.id}>{c.codice} — {c.descrizione} (disp. {c.disponibile})</option>
              ))}
            </select>
          ) : (
            <input style={{ ...inputSt, flex: 1, minWidth: 180 }} value={descrNuovo} onChange={e => setDescrNuovo(e.target.value)} placeholder="Descrizione ricambio nuovo…" />
          )}
          <input style={{ ...inputSt, width: 80 }} type="number" min="1" step="1" value={qta} onChange={e => setQta(e.target.value)} title="Quantità" />
          <button type="button" onClick={add} disabled={busy} style={{ background: "#1d4ed8", color: "#fff", border: "none", borderRadius: 7, padding: "7px 16px", cursor: "pointer", fontSize: 13, fontWeight: 700 }}>+ Aggiungi</button>
        </div>
      </div>
    </div>
  );
}
