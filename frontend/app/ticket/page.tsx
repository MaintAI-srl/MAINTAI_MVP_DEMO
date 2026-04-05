"use client";

import { useEffect, useState } from "react";
import { apiGet, apiPost, apiPut, apiPatch } from "../lib/api";
import { notify } from "@/lib/toast";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import UploadAllegati from "../components/UploadAllegati";
import StatusToggle from "../components/StatusToggle";
import { DataTable, type ColumnDef } from "@/components/ui/data-table";
import KanbanBoard, { type KanbanTicket } from "../components/KanbanBoard";

type Ticket = {
  id: number;
  titolo: string;
  asset_id: number;
  asset_name: string | null;
  priorita: string;
  tipo: string;
  stato: string;
  asset_stato?: string | null;
  durata_stimata_ore: number;
  fascia_oraria: string;
  descrizione?: string | null;
  planned_start?: string | null;
  planned_finish?: string | null;
  execution_start?: string | null;
  execution_finish?: string | null;
  parent_id?: number | null;
  diagnosi_eseguita?: boolean;
};

type Asset = { id: number; name: string };
type PagedResult = { items: Ticket[]; total: number; page: number; pages: number };

const STATI = ["Aperto", "Pianificato", "In corso", "Chiuso", "Eliminato"];
const STATI_ATTIVI = ["Aperto", "Pianificato", "In corso"];
const STATI_ARCHIVIO = ["Chiuso", "Eliminato"];

function statoStyle(s: string): React.CSSProperties {
  switch (s?.toLowerCase()) {
    case "aperto":      return { color: "#60a5fa", background: "rgba(96,165,250,0.1)",   border: "1px solid rgba(96,165,250,0.3)" };
    case "pianificato": return { color: "#a78bfa", background: "rgba(167,139,250,0.1)", border: "1px solid rgba(167,139,250,0.3)" };
    case "in corso":    return { color: "#fbbf24", background: "rgba(251,191,36,0.1)",  border: "1px solid rgba(251,191,36,0.3)" };
    case "chiuso":      return { color: "#34d399", background: "rgba(52,211,153,0.1)",  border: "1px solid rgba(52,211,153,0.3)" };
    case "eliminato":   return { color: "#f87171", background: "rgba(248,113,113,0.1)", border: "1px solid rgba(248,113,113,0.3)" };
    default:            return { color: "var(--text-secondary)", background: "rgba(156,163,175,0.1)", border: "1px solid rgba(156,163,175,0.3)" };
  }
}

function getPrioritaStyle(p: string): React.CSSProperties {
  switch (p?.toLowerCase()) {
    case "alta":  return { color: "#f87171", background: "rgba(248,113,113,0.1)", border: "1px solid rgba(248,113,113,0.3)" };
    case "media": return { color: "#fbbf24", background: "rgba(251,191,36,0.1)",  border: "1px solid rgba(251,191,36,0.3)" };
    case "bassa": return { color: "#34d399", background: "rgba(52,211,153,0.1)",  border: "1px solid rgba(52,211,153,0.3)" };
    default:      return { color: "var(--text-secondary)", background: "rgba(156,163,175,0.1)", border: "1px solid rgba(156,163,175,0.3)" };
  }
}

/** Converte ISO string → valore compatibile con datetime-local input */
function toDatetimeLocal(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "";
  // "YYYY-MM-DDTHH:mm"
  return d.toISOString().slice(0, 16);
}

/** Ora corrente come stringa datetime-local */
function nowDatetimeLocal(): string {
  return new Date().toISOString().slice(0, 16);
}

const dtInput: React.CSSProperties = { background: "rgba(255,255,255,0.05)", border: "1px solid rgba(148,163,184,0.2)", borderRadius: 7, color: "var(--text-primary)", padding: "7px 11px", fontSize: 12, width: "100%", outline: "none", colorScheme: "dark" };
const modalLabel: React.CSSProperties = { fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: ".1em", color: "var(--text-muted)", display: "block", marginBottom: 5 };

// ── Modale dettaglio ticket ───────────────────────────────────────────────

type DetailModalProps = {
  ticket: Ticket;
  onClose: () => void;
  onSaved: () => void;
};

function DetailModal({ ticket, onClose, onSaved }: DetailModalProps) {
  const [stato, setStato] = useState(ticket.stato);
  const [assetStato, setAssetStato] = useState(ticket.asset_stato ?? "");
  const [plannedStart, setPlannedStart] = useState(toDatetimeLocal(ticket.planned_start));
  const [plannedFinish, setPlannedFinish] = useState(toDatetimeLocal(ticket.planned_finish));
  const [executionStart, setExecutionStart] = useState(toDatetimeLocal(ticket.execution_start));
  const [executionFinish, setExecutionFinish] = useState(toDatetimeLocal(ticket.execution_finish));
  const [saving, setSaving] = useState(false);
  const [showAssetDialog, setShowAssetDialog] = useState(false);

  // Automazione: Cambio Stato
  function handleStatoChange(s: string) {
    setStato(s);
    // Se torna ad Aperto, pulisci pianificazione
    if (s === "Aperto") {
      setPlannedStart("");
      setPlannedFinish("");
    }
    // Se passa a In Corso, imposta inizio se vuoto
    if (s === "In corso" && !executionStart) setExecutionStart(nowDatetimeLocal());
    // Se passa a Chiuso, imposta fine se vuoto
    if (s === "Chiuso" && !executionFinish) setExecutionFinish(nowDatetimeLocal());
  }

  // Automazione: Cambio Data Pianificazione
  function handlePlannedChange(start: string) {
    setPlannedStart(start);
    if (start) {
      if (stato === "Aperto") setStato("Pianificato");
      // Auto-calcola fine basata su durata stimata
      const d = new Date(start);
      d.setMinutes(d.getMinutes() + (ticket.durata_stimata_ore || 1) * 60);
      setPlannedFinish(d.toISOString().slice(0, 16));
    }
  }

  // Funzioni di Pianificazione Rapida
  function quickPlan(hoursFromNow: number = 0, hourOfDay?: number) {
    const d = new Date();
    if (hourOfDay !== undefined) {
      d.setHours(hourOfDay, 0, 0, 0);
      if (hoursFromNow > 0) d.setDate(d.getDate() + 1);
    } else {
      d.setMinutes(d.getMinutes() + 15); // Un po' di margine
    }
    handlePlannedChange(d.toISOString().slice(0, 16));
  }

  async function doSave(assetStatoOverride?: string) {
    setSaving(true);
    try {
      const body: Record<string, string | null> = { stato };
      const as = assetStatoOverride !== undefined ? assetStatoOverride : assetStato;
      if (as) body.asset_stato = as;
      
      body.planned_start = plannedStart ? new Date(plannedStart).toISOString() : null;
      body.planned_finish = plannedFinish ? new Date(plannedFinish).toISOString() : null;
      body.execution_start = executionStart ? new Date(executionStart).toISOString() : null;
      body.execution_finish = executionFinish ? new Date(executionFinish).toISOString() : null;

      await apiPut(`/tickets/${ticket.id}`, body);
      onSaved();
      onClose();
    } catch {
      notify.error("Errore nel salvataggio.");
    } finally { setSaving(false); }
  }

  function handleSave() {
    // Validazione date: fine non può precedere inizio
    if (plannedStart && plannedFinish && new Date(plannedFinish) < new Date(plannedStart)) {
      notify.error("La data di fine pianificazione non può precedere quella di inizio.");
      return;
    }
    if (executionStart && executionFinish && new Date(executionFinish) < new Date(executionStart)) {
      notify.error("La data di fine esecuzione non può precedere quella di inizio.");
      return;
    }
    if (stato === "Chiuso") setShowAssetDialog(true);
    else doSave();
  }

  return (
    <DialogContent
      showCloseButton={false}
      className="max-w-[600px] max-h-[90vh] overflow-y-auto p-0 border-none"
      style={{
        background: "#111827",
        color: "var(--text-primary)",
        borderRadius: 12,
        boxShadow: "0 25px 60px rgba(0,0,0,0.8)",
        border: "1px solid #1f2937",
        width: "min(90vw, 680px)",
        maxWidth: "min(90vw, 680px)",
      }}
    >
      {/* Header Premium */}
      <div style={{ padding: "24px 28px", background: "linear-gradient(to bottom, rgba(59,130,246,0.05), transparent)", borderBottom: "1px solid rgba(255,255,255,0.05)", position: "relative" }}>
        {/* Pulsante chiusura — unico, position absolute */}
        <button
          onClick={onClose}
          style={{
            position: "absolute",
            top: 16,
            right: 16,
            background: "transparent",
            border: "none",
            color: "var(--text-muted)",
            cursor: "pointer",
            fontSize: 20,
            lineHeight: 1,
            zIndex: 10,
            padding: 4,
          }}
        >
          &times;
        </button>
        <div style={{ marginBottom: 12, paddingRight: 32 }}>
          <div style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: ".1em", color: "#3b82f6", marginBottom: 4 }}>
            Dettaglio Ticket #{ticket.id}
          </div>
          <DialogTitle style={{ fontSize: 20, fontWeight: 800, letterSpacing: "-0.01em", margin: 0 }}>
            {ticket.titolo}
          </DialogTitle>
        </div>
        
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <span style={{ ...getPrioritaStyle(ticket.priorita), fontSize: 10, padding: "2px 8px", borderRadius: 4, fontWeight: 700, textTransform: "uppercase" }}>{ticket.priorita}</span>
          <span style={{ fontSize: 13, color: "var(--text-soft)", fontWeight: 500 }}>{ticket.asset_name ?? "Asset non specificato"}</span>
          <span style={{ color: "rgba(255,255,255,0.1)" }}>|</span>
          <span style={{ fontSize: 13, color: "var(--text-muted)" }}>{ticket.tipo} · {ticket.durata_stimata_ore?.toFixed(1)}h</span>
        </div>
      </div>

      <div style={{ padding: "28px" }}>
        {/* Sezione Stato */}
        <div style={{ marginBottom: 32 }}>
          <label style={{ ...modalLabel, fontSize: 11, marginBottom: 12 }}>Stato Corrente</label>
          <StatusToggle 
            size="lg"
            currentValue={stato}
            onChange={(s) => handleStatoChange(s)}
            options={[
              { value: "Aperto", label: "Aperto", color: "#60a5fa" },
              { value: "Pianificato", label: "Pianificato", color: "#a78bfa" },
              { value: "In corso", label: "In corso", color: "#fbbf24" },
              { value: "Chiuso", label: "Chiuso", color: "#34d399" },
              { value: "Eliminato", label: "Eliminato", color: "#f87171" },
            ]}
          />
        </div>

        {/* Sezione Pianificazione */}
        <div style={{ marginBottom: 32, padding: 20, background: "rgba(255,255,255,0.02)", borderRadius: 12, border: "1px solid rgba(255,255,255,0.05)" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
             <label style={{ ...modalLabel, margin: 0 }}>Pianificazione Intervento</label>
             <div style={{ display: "flex", gap: 6 }}>
                <button onClick={() => quickPlan(0, 8)} style={{ fontSize: 10, padding: "4px 8px", background: "rgba(59,130,246,0.1)", color: "#60a5fa", border: "1px solid rgba(59,130,246,0.2)", borderRadius: 6, cursor: "pointer", fontWeight: 600 }}>OGGI 08:00</button>
                <button onClick={() => quickPlan(1, 8)} style={{ fontSize: 10, padding: "4px 8px", background: "rgba(255,255,255,0.05)", color: "var(--text-soft)", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 6, cursor: "pointer", fontWeight: 600 }}>DOMANI</button>
             </div>
          </div>
          
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
            <div>
              <label style={{ fontSize: 10, color: "var(--text-muted)", marginBottom: 6, display: "block" }}>Inizio Pianificato</label>
              <input type="datetime-local" style={dtInput} value={plannedStart} onChange={e => handlePlannedChange(e.target.value)} />
            </div>
            <div>
              <label style={{ fontSize: 10, color: "var(--text-muted)", marginBottom: 6, display: "block" }}>Fine Pianificata</label>
              <input type="datetime-local" style={dtInput} value={plannedFinish} onChange={e => setPlannedFinish(e.target.value)} />
            </div>
          </div>
        </div>

        {/* Sezione Esecuzione Dinamica */}
        <div style={{ marginBottom: 32 }}>
          <label style={{ ...modalLabel, marginBottom: 16 }}>Dati di Esecuzione Personale</label>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
            <div style={{ position: "relative" }}>
              <label style={{ fontSize: 10, color: "var(--text-muted)", marginBottom: 6, display: "block" }}>Inizio Reale</label>
              <input type="datetime-local" style={{ ...dtInput, border: executionStart ? "1px solid rgba(251,191,36,0.4)" : dtInput.border }} value={executionStart} onChange={e => {setExecutionStart(e.target.value); if(e.target.value && stato !== "In corso") setStato("In corso");}} />
              {!executionStart && (
                <button onClick={() => { setExecutionStart(nowDatetimeLocal()); setStato("In corso"); }}
                  style={{ position: "absolute", right: 10, top: 28, fontSize: 9, padding: "2px 6px", background: "#fbbf24", color: "#000", border: "none", borderRadius: 4, cursor: "pointer", fontWeight: 800 }}>
                  INIZIA ORA
                </button>
              )}
            </div>
            <div style={{ position: "relative" }}>
              <label style={{ fontSize: 10, color: "var(--text-muted)", marginBottom: 6, display: "block" }}>Fine Reale</label>
              <input type="datetime-local" style={{ ...dtInput, border: executionFinish ? "1px solid rgba(52,211,153,0.4)" : dtInput.border }} value={executionFinish} onChange={e => {setExecutionFinish(e.target.value); if(e.target.value && stato !== "Chiuso") setStato("Chiuso");}} />
              {!executionFinish && (
                <button onClick={() => { setExecutionFinish(nowDatetimeLocal()); setStato("Chiuso"); }}
                  style={{ position: "absolute", right: 10, top: 28, fontSize: 9, padding: "2px 6px", background: "#34d399", color: "#000", border: "none", borderRadius: 4, cursor: "pointer", fontWeight: 800 }}>
                  CHIUDI ORA
                </button>
              )}
            </div>
          </div>
        </div>

        {/* Descrizione & Allegati */}
        {ticket.descrizione && (
          <div style={{ marginBottom: 24 }}>
             <label style={modalLabel}>Descrizione / Note</label>
             <div style={{ fontSize: 13, color: "var(--text-soft)", lineHeight: 1.6, padding: "12px 16px", background: "rgba(255,255,255,0.03)", borderRadius: 8, border: "1px solid rgba(255,255,255,0.05)" }}>
                {ticket.descrizione}
             </div>
          </div>
        )}

        {/* Allegati */}
        <div style={{ marginBottom: 10 }}>
          <label style={{ ...modalLabel, marginBottom: 12 }}>Dati e Foto Intervento</label>
          <div style={{ padding: "8px", background: "rgba(255,255,255,0.02)", borderRadius: 12, border: "1px dashed rgba(255,255,255,0.1)" }}>
            <UploadAllegati ticketId={ticket.id} />
          </div>
        </div>
      </div>

      {/* Footer sticky-style */}
      <div style={{ padding: "20px 28px", background: "rgba(255,255,255,0.02)", borderTop: "1px solid rgba(255,255,255,0.05)", display: "flex", justifyContent: "flex-end", gap: 12 }}>
        <Button variant="outline" onClick={onClose} style={{ borderColor: "rgba(255,255,255,0.1)", color: "var(--text-muted)" }}>Annulla</Button>
        <Button onClick={handleSave} disabled={saving}
          style={{ background: "linear-gradient(135deg,#3b82f6,#2563eb)", minWidth: 120, fontWeight: 700, boxShadow: "0 4px 12px rgba(59,130,246,0.3)" }}>
          {saving ? "Salvataggio…" : "Salva Modifiche"}
        </Button>
      </div>

      {/* Sub-dialog: stato asset alla chiusura */}
      <Dialog open={showAssetDialog} onOpenChange={(o) => !o && setShowAssetDialog(false)}>
        <DialogContent
          showCloseButton={false}
          className="max-w-[420px]"
          style={{ background: "#0d1829", border: "1px solid rgba(59,130,246,0.3)", borderRadius: 16 }}
        >
          <DialogHeader>
            <div style={{ fontSize: 10, textTransform: "uppercase", letterSpacing: ".14em", color: "#3b82f6", fontWeight: 700 }}>Chiusura ticket #{ticket.id}</div>
            <DialogTitle style={{ fontSize: 18, fontWeight: 800 }}>
              Verifica Stato Asset
            </DialogTitle>
            <p style={{ margin: "8px 0 16px", fontSize: 13, color: "var(--text-soft)", lineHeight: 1.5 }}>
              Il ticket è concluso. In che stato si trova l&apos;asset <strong style={{ color: "var(--text-primary)" }}>{ticket.asset_name ?? `#${ticket.asset_id}`}</strong>?
            </p>
          </DialogHeader>
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            <button onClick={() => { setShowAssetDialog(false); doSave("service"); }}
              style={{ display: "flex", alignItems: "center", gap: 14, padding: "14px 18px", background: "rgba(52,211,153,0.06)", border: "1px solid rgba(52,211,153,0.25)", borderRadius: 12, cursor: "pointer", textAlign: "left" }}>
              <span style={{ fontSize: 22 }}>✅</span>
              <div>
                <div style={{ fontWeight: 700, fontSize: 14, color: "#34d399" }}>Operativo (Service)</div>
                <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 2 }}>L&apos;asset è pronto e funzionante.</div>
              </div>
            </button>
            <button onClick={() => { setShowAssetDialog(false); doSave("stopped"); }}
              style={{ display: "flex", alignItems: "center", gap: 14, padding: "14px 18px", background: "rgba(251,191,36,0.06)", border: "1px solid rgba(251,191,36,0.25)", borderRadius: 12, cursor: "pointer", textAlign: "left" }}>
              <span style={{ fontSize: 22 }}>⏸️</span>
              <div>
                <div style={{ fontWeight: 700, fontSize: 14, color: "#fbbf24" }}>Fermo (Stopped)</div>
                <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 2 }}>Asset in attesa di ulteriori verifiche.</div>
              </div>
            </button>
            <button onClick={() => { setShowAssetDialog(false); doSave("out of service"); }}
              style={{ display: "flex", alignItems: "center", gap: 14, padding: "14px 18px", background: "rgba(248,113,113,0.06)", border: "1px solid rgba(248,113,113,0.25)", borderRadius: 12, cursor: "pointer", textAlign: "left" }}>
              <span style={{ fontSize: 22 }}>🔴</span>
              <div>
                <div style={{ fontWeight: 700, fontSize: 14, color: "#f87171" }}>Fuori Servizio (OOS)</div>
                <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 2 }}>L&apos;asset richiede ulteriori interventi.</div>
              </div>
            </button>
          </div>
          <Button variant="ghost" className="w-full mt-2" onClick={() => { setShowAssetDialog(false); doSave(""); }} style={{ color: "var(--text-muted)", fontSize: 12 }}>
            Mantieni stato attuale
          </Button>
        </DialogContent>
      </Dialog>
    </DialogContent>
  );
}

// ── Pagina principale ─────────────────────────────────────────────────────

export default function TicketPage() {
  const [result, setResult] = useState<PagedResult | null>(null);
  const [archivio, setArchivio] = useState<PagedResult | null>(null);
  const [kanbanTickets, setKanbanTickets] = useState<KanbanTicket[]>([]);
  const [assets, setAssets] = useState<Asset[]>([]);
  const [tab, setTab] = useState<"attivi" | "archivio" | "kanban">("attivi");
  const [page, setPage] = useState(1);
  const [pageArch, setPageArch] = useState(1);
  const LIMIT = 25;


  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [ctxMenu, setCtxMenu] = useState<{ x: number; y: number; ticketId: number } | null>(null);
  const [detailTicket, setDetailTicket] = useState<Ticket | null>(null);

  // New ticket form
  const [titolo, setTitolo] = useState("");
  const [assetId, setAssetId] = useState<number>(0);
  const [priorita, setPriorita] = useState("Media");
  const [tipo, setTipo] = useState("CM");
  const [assetStato, setAssetStato] = useState("");
  const [stato, setStato] = useState("Aperto");
  const [durataOre, setDurataOre] = useState(2);
  const [fascia, setFascia] = useState("diurna");
  const [plannedStart, setPlannedStart] = useState("");
  const [plannedFinish, setPlannedFinish] = useState("");
  const [updatingId, setUpdatingId] = useState<number | null>(null);

  useEffect(() => {
    apiGet<Asset[]>("/assets")
      .then(d => { if (Array.isArray(d)) { setAssets(d); if (d.length > 0) setAssetId(d[0].id); } })
      .catch(() => {});
  }, []);

  useEffect(() => { loadAttivi(page); }, [page]);
  useEffect(() => { if (tab === "archivio") loadArchivio(pageArch); }, [tab, pageArch]);
  useEffect(() => { if (tab === "kanban") loadKanban(); }, [tab]);

  useEffect(() => {
    function handler() { setCtxMenu(null); }
    document.addEventListener("click", handler);
    return () => document.removeEventListener("click", handler);
  }, []);

  async function loadAttivi(p: number) {
    try {
      const d = await apiGet<PagedResult>(`/tickets?page=${p}&limit=${LIMIT}&stato=${STATI_ATTIVI.join(",")}`);
      setResult(d);
    } catch { notify.error("Errore caricamento ticket."); }
  }

  async function loadArchivio(p: number) {
    try {
      const d = await apiGet<PagedResult>(`/tickets?page=${p}&limit=${LIMIT}&stato=${STATI_ARCHIVIO.join(",")}`);
      setArchivio(d);
    } catch {}
  }

  async function loadKanban() {
    try {
      const d = await apiGet<PagedResult>(`/tickets?page=1&limit=200&stato=${STATI_ATTIVI.join(",")}`);
      setKanbanTickets(d.items);
    } catch { notify.error("Errore caricamento kanban."); }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!titolo.trim()) { notify.error("Il titolo del ticket è obbligatorio."); return; }
    if (!assetId || assetId === 0) { notify.error("Seleziona un asset valido."); return; }
    if (durataOre <= 0) { notify.error("La durata deve essere maggiore di zero."); return; }
    try {
      await apiPost("/tickets", {
        titolo, asset_id: Number(assetId), priorita, stato, tipo, asset_stato: assetStato || null,
        durata_stimata_ore: Number(durataOre), fascia_oraria: fascia,
        planned_start: plannedStart || null,
        planned_finish: plannedFinish || null,
      });
      setTitolo(""); setPriorita("Media"); setTipo("CM"); setAssetStato(""); setStato("Aperto"); setDurataOre(2); setFascia("diurna");
      setPlannedStart(""); setPlannedFinish("");
      loadAttivi(1); setPage(1);
    } catch { notify.error("Errore nel salvataggio ticket."); }
  }

  async function handleStatoChange(ticketId: number, nuovoStato: string) {
    setUpdatingId(ticketId);
    try {
      const body: Record<string, string | null> = { stato: nuovoStato };
      // Se torna Aperto, azzera le date di pianificazione
      if (nuovoStato === "Aperto") {
        body.planned_start = null;
        body.planned_finish = null;
      }
      await apiPut(`/tickets/${ticketId}`, body);
      await Promise.all([loadAttivi(page), tab === "archivio" ? loadArchivio(pageArch) : Promise.resolve()]);
    } catch { notify.error("Errore aggiornamento stato."); }
    finally { setUpdatingId(null); }
  }

  async function bulkUpdateStatus(nuovoStato: string) {
    if (selectedIds.size === 0) return;
    try {
      await apiPatch("/tickets/bulk-status", { ids: Array.from(selectedIds), stato: nuovoStato });
      setSelectedIds(new Set());
      await Promise.all([loadAttivi(page), tab === "archivio" ? loadArchivio(pageArch) : Promise.resolve()]);
    } catch { notify.error("Errore aggiornamento bulk."); }
  }

  function toggleSelect(id: number) {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  function toggleSelectAll(items: Ticket[]) {
    const allSelected = items.every(t => selectedIds.has(t.id));
    if (allSelected) {
      setSelectedIds(prev => { const next = new Set(prev); items.forEach(t => next.delete(t.id)); return next; });
    } else {
      setSelectedIds(prev => { const next = new Set(prev); items.forEach(t => next.add(t.id)); return next; });
    }
  }

  function handleSaved() {
    loadAttivi(page);
    if (tab === "archivio") loadArchivio(pageArch);
  }

  const tickets = result?.items ?? [];
  const archivioItems = archivio?.items ?? [];

  const ticketColumns: ColumnDef<Ticket>[] = [
    {
      id: "select",
      header: () => (
        <input
          type="checkbox"
          checked={tickets.length > 0 && tickets.every(t => selectedIds.has(t.id))}
          onChange={() => toggleSelectAll(tickets)}
          style={{ cursor: "pointer", accentColor: "#818cf8" }}
        />
      ),
      cell: ({ row }) => (
        <div onClick={e => e.stopPropagation()}>
          <input
            type="checkbox"
            checked={selectedIds.has(row.original.id)}
            onChange={() => toggleSelect(row.original.id)}
            style={{ cursor: "pointer", accentColor: "#818cf8" }}
          />
        </div>
      ),
      enableSorting: false,
    },
    { accessorKey: "id", header: "ID" },
    { accessorKey: "titolo", header: "Titolo" },
    {
      accessorKey: "asset_name",
      header: "Asset",
      cell: ({ getValue }) => getValue<string>() ?? "—",
    },
    {
      accessorKey: "tipo",
      header: "Tipo",
      cell: ({ row }) => {
        const t = row.original;
        return (
          <>
            <span style={{ fontSize: 11, padding: "2px 6px", borderRadius: 4, background: "rgba(255,255,255,0.08)", color: "var(--text-secondary)", border: "1px solid rgba(255,255,255,0.1)" }}>{t.tipo}</span>
            {t.diagnosi_eseguita && <span style={{ marginLeft: 5, fontSize: 10, padding: "1px 6px", borderRadius: 4, background: "rgba(99,102,241,0.15)", color: "#818cf8", border: "1px solid rgba(99,102,241,0.3)", fontWeight: 700 }}>AI</span>}
            {t.parent_id && <span style={{ marginLeft: 5, fontSize: 10, padding: "1px 6px", borderRadius: 4, background: "rgba(16,185,129,0.12)", color: "#6ee7b7", border: "1px solid rgba(16,185,129,0.3)", fontWeight: 700 }}>↳#{t.parent_id}</span>}
          </>
        );
      },
    },
    {
      accessorKey: "priorita",
      header: "Priorità",
      cell: ({ getValue }) => {
        const p = getValue<string>();
        return <span style={{ ...getPrioritaStyle(p), fontSize: 11, padding: "2px 8px", borderRadius: 4, fontWeight: 600 }}>{p}</span>;
      },
    },
    {
      accessorKey: "stato",
      header: "Stato",
      enableSorting: false,
      cell: ({ row }) => {
        const t = row.original;
        return (
          <div onClick={e => e.stopPropagation()}>
            <StatusToggle
              size="sm"
              currentValue={t.stato}
              onChange={(s) => handleStatoChange(t.id, s)}
              disabled={updatingId === t.id}
              options={[
                { value: "Aperto", label: "Ape", color: "#60a5fa" },
                { value: "Pianificato", label: "Pia", color: "#a78bfa" },
                { value: "In corso", label: "Cor", color: "#fbbf24" },
                { value: "Chiuso", label: "Chi", color: "#34d399" },
              ]}
            />
          </div>
        );
      },
    },
    { accessorKey: "fascia_oraria", header: "Fascia" },
    {
      accessorKey: "planned_start",
      header: "Pian. Inizio",
      cell: ({ getValue }) => {
        const v = getValue<string | null>();
        if (!v) return <span style={{ fontSize: 11, color: "var(--text-soft)" }}>—</span>;
        const d = new Date(v);
        return (
          <span style={{ fontSize: 11, color: "#a78bfa" }}>
            {d.toLocaleDateString("it-IT", { day: "2-digit", month: "2-digit" })}{" "}
            <span style={{ color: "var(--text-soft)" }}>{d.toLocaleTimeString("it-IT", { hour: "2-digit", minute: "2-digit" })}</span>
          </span>
        );
      },
    },
    {
      accessorKey: "planned_finish",
      header: "Pian. Fine",
      cell: ({ getValue }) => {
        const v = getValue<string | null>();
        if (!v) return <span style={{ fontSize: 11, color: "var(--text-soft)" }}>—</span>;
        const d = new Date(v);
        return (
          <span style={{ fontSize: 11, color: "#a78bfa" }}>
            {d.toLocaleDateString("it-IT", { day: "2-digit", month: "2-digit" })}{" "}
            <span style={{ color: "var(--text-soft)" }}>{d.toLocaleTimeString("it-IT", { hour: "2-digit", minute: "2-digit" })}</span>
          </span>
        );
      },
    },
    {
      id: "durata",
      header: "Durata",
      cell: ({ row }) => {
        const t = row.original;
        if (t.planned_start && t.planned_finish) {
          const mins = Math.round((new Date(t.planned_finish).getTime() - new Date(t.planned_start).getTime()) / 60000);
          if (mins > 0) {
            const h = Math.floor(mins / 60);
            const m = mins % 60;
            const label = h > 0 ? `${h}h${m > 0 ? ` ${m}m` : ""}` : `${m}m`;
            return <span style={{ fontSize: 11, color: "#fbbf24" }}>{label}</span>;
          }
        }
        return <span style={{ fontSize: 11, color: "var(--text-soft)" }}>{t.durata_stimata_ore ? `${t.durata_stimata_ore}h*` : "—"}</span>;
      },
    },
    {
      accessorKey: "execution_finish",
      header: "Eseguito",
      cell: ({ getValue }) => {
        const v = getValue<string | null>();
        return <span style={{ fontSize: 11, color: v ? "#34d399" : "var(--text-soft)" }}>{v ? new Date(v).toLocaleDateString("it-IT") : "—"}</span>;
      },
    },
    {
      id: "azioni",
      header: "Azioni",
      enableSorting: false,
      cell: ({ row }) => (
        <div onClick={e => e.stopPropagation()}>
          <a href={`/ticket/${row.original.id}/diagnostic`} style={{ fontSize: 11, padding: "4px 10px", border: "1px solid rgba(99,102,241,0.4)", color: "#818cf8", textDecoration: "none", borderRadius: 4, display: "inline-block" }}>
            DIAGNOSTICA →
          </a>
        </div>
      ),
    },
  ];

  return (
    <div>
      <div className="mb-8">
        <h1 className="page-title">Ticket</h1>
        <p className="page-subtitle">Ticket operativi che alimentano il planner automatico.</p>
      </div>


      <div className="dark-card card-body mb-8">
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}>
          <h2 style={{ marginTop: 0, marginBottom: 0 }}>Nuovo ticket</h2>
          <button 
            type="button" 
            onClick={() => {
              const token = localStorage.getItem("maintai_jwt");
              const url = new URL(`${window.location.origin === "http://localhost:3000" ? "http://localhost:8000" : "https://maintai-v3.onrender.com"}/export/tickets`);
              if (token) url.searchParams.append("token", token);
              window.open(url.toString(), "_blank");
            }}
            style={{ padding: "8px 16px", borderRadius: 8, background: "rgba(16,185,129,0.1)", border: "1px solid rgba(16,185,129,0.4)", color: "#10b981", fontWeight: 600, cursor: "pointer", display: "flex", gap: 8, alignItems: "center" }}
          >
            <span>📊</span> Esporta Excel
          </button>
        </div>
        <form onSubmit={handleSubmit} className="form-grid-3">
          <div className="span-3">
            <label className="label">Titolo</label>
            <input required className="input" value={titolo} onChange={e => setTitolo(e.target.value)} />
          </div>
          <div>
            <select required className="select" value={assetId} onChange={e => setAssetId(Number(e.target.value))}>
              <option value={0}>Seleziona un asset...</option> 
              {assets.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
            </select>
          </div>
          <div>
            <label className="label">Tipo</label>
            <select className="select" value={tipo} onChange={e => setTipo(e.target.value)}>
              <option value="PM">PM (Preventiva)</option>
              <option value="CM">CM (Correttiva)</option>
              <option value="BD">BD (Breakdown)</option>
              <option value="ISP">ISP (Ispezione)</option>
            </select>
          </div>
          <div>
            <label className="label">Priorità</label>
            <select className="select" value={priorita} onChange={e => setPriorita(e.target.value)}>
              <option>Alta</option><option>Media</option><option>Bassa</option>
            </select>
          </div>
          <div>
            <label className="label">Nuovo stato asset</label>
            <select className="select" value={assetStato} onChange={e => setAssetStato(e.target.value)}>
              <option value="">(Non modificare)</option>
              <option value="service">Service</option>
              <option value="stopped">Stopped</option>
              <option value="out of service">Out of Service</option>
            </select>
          </div>
          <div>
            <label className="label">Stato Ticket</label>
            <select className="select" value={stato} onChange={e => setStato(e.target.value)}>
              {STATI.map(s => <option key={s}>{s}</option>)}
            </select>
          </div>
          <div>
            <label className="label">Durata ore</label>
            <input required min="0.1" step="0.1" className="input" type="number" value={durataOre} onChange={e => setDurataOre(Number(e.target.value))} />
          </div>
          <div>
            <label className="label">Fascia</label>
            <select className="select" value={fascia} onChange={e => setFascia(e.target.value)}>
              <option value="diurna">diurna</option>
              <option value="notturna">notturna</option>
            </select>
          </div>
          <div>
            <label className="label">Inizio pianificato</label>
            <input className="input" type="datetime-local" value={plannedStart} onChange={e => setPlannedStart(e.target.value)} />
          </div>
          <div>
            <label className="label">Fine pianificata</label>
            <input className="input" type="datetime-local" value={plannedFinish} onChange={e => setPlannedFinish(e.target.value)} />
          </div>
          <div className="span-3">
            <button className="btn-primary" type="submit">Salva ticket</button>
          </div>
        </form>
      </div>

      {/* Bulk action bar */}
      {selectedIds.size > 0 && (
        <div style={{ display: "flex", gap: 8, alignItems: "center", padding: "8px 12px", background: "rgba(99,102,241,0.1)", border: "1px solid rgba(99,102,241,0.3)", borderRadius: 8, marginBottom: 12 }}>
          <span style={{ color: "#818cf8", fontSize: 12 }}>{selectedIds.size} selezionati</span>
          {["Pianificato", "In corso", "Chiuso", "Eliminato"].map(s => (
            <button key={s} onClick={() => bulkUpdateStatus(s)}
              style={{ fontSize: 11, padding: "3px 10px", border: "1px solid rgba(99,102,241,0.4)", color: "#818cf8", background: "transparent", cursor: "pointer", borderRadius: 4 }}>
              → {s}
            </button>
          ))}
          <button onClick={() => setSelectedIds(new Set())} style={{ marginLeft: "auto", fontSize: 11, color: "var(--text-muted)", background: "transparent", border: "none", cursor: "pointer" }}>Deseleziona</button>
        </div>
      )}

      {/* Tabs */}
      <div style={{ display: "flex", gap: 8, marginBottom: 16 }}>
        {(["attivi", "archivio", "kanban"] as const).map(t => (
          <button key={t} onClick={() => setTab(t)} style={{ padding: "6px 18px", borderRadius: 6, border: "1px solid", fontSize: 13, cursor: "pointer", background: tab === t ? "rgba(99,102,241,0.2)" : "transparent", color: tab === t ? "#818cf8" : "var(--text-muted)", borderColor: tab === t ? "rgba(99,102,241,0.5)" : "rgba(75,85,99,0.4)" }}>
            {t === "attivi" ? `Attivi (${result?.total ?? 0})` : t === "archivio" ? `Archivio (${archivio?.total ?? 0})` : "Kanban"}
          </button>
        ))}
      </div>

      {tab === "attivi" && (
        <DataTable
          data={tickets}
          columns={ticketColumns}
          manualPagination
          pageCount={result?.pages ?? 1}
          pageIndex={page - 1}
          onPageChange={(p) => setPage(p + 1)}
          emptyMessage="Nessun ticket attivo"
          onRowClick={(t) => setDetailTicket(t)}
          getRowProps={(t) => ({
            onContextMenu: (e) => { e.preventDefault(); setCtxMenu({ x: e.clientX, y: e.clientY, ticketId: t.id }); },
            style: { background: selectedIds.has(t.id) ? "rgba(99,102,241,0.06)" : undefined },
          })}
        />
      )}

      {tab === "archivio" && (
        <>
          <div style={{ color: "var(--text-muted)", fontSize: 12, marginBottom: 12 }}>
            Ticket chiusi ed eliminati — visibili all&apos;AI per analisi storiche.
          </div>
          <DataTable
            data={archivioItems}
            columns={ticketColumns}
            manualPagination
            pageCount={archivio?.pages ?? 1}
            pageIndex={pageArch - 1}
            onPageChange={(p) => setPageArch(p + 1)}
            emptyMessage="Nessun ticket archiviato"
            onRowClick={(t) => setDetailTicket(t)}
            getRowProps={(t) => ({
              onContextMenu: (e) => { e.preventDefault(); setCtxMenu({ x: e.clientX, y: e.clientY, ticketId: t.id }); },
              style: { background: selectedIds.has(t.id) ? "rgba(99,102,241,0.06)" : undefined },
            })}
          />
        </>
      )}

      {tab === "kanban" && (
        <KanbanBoard tickets={kanbanTickets} onRefresh={loadKanban} />
      )}

      {/* Context menu */}
      {ctxMenu && (
        <div
          style={{ position: "fixed", top: ctxMenu.y, left: ctxMenu.x, background: "var(--bg-elevated)", border: "1px solid rgba(59,130,246,0.3)", borderRadius: 8, zIndex: 1000, minWidth: 160, boxShadow: "0 8px 24px rgba(0,0,0,0.4)" }}
          onMouseLeave={() => setCtxMenu(null)}
        >
          {selectedIds.has(ctxMenu.ticketId) && selectedIds.size > 1 && (
            <div style={{ padding: "6px 16px", fontSize: 11, color: "#818cf8", borderBottom: "1px solid rgba(99,102,241,0.2)" }}>
              {selectedIds.size} selezionati
            </div>
          )}
          {STATI.map(s => (
            <button key={s} onClick={() => {
              if (selectedIds.has(ctxMenu.ticketId) && selectedIds.size > 1) {
                bulkUpdateStatus(s);
              } else {
                handleStatoChange(ctxMenu.ticketId, s);
              }
              setCtxMenu(null);
            }}
              style={{ display: "block", width: "100%", padding: "8px 16px", background: "transparent", border: "none", color: "var(--text-primary)", fontSize: 12, cursor: "pointer", textAlign: "left" }}>
              → {s}
            </button>
          ))}
        </div>
      )}

      {/* Detail modal */}
      <Dialog open={!!detailTicket} onOpenChange={(o) => !o && setDetailTicket(null)}>
        {detailTicket && (
          <DetailModal
            ticket={detailTicket}
            onClose={() => setDetailTicket(null)}
            onSaved={handleSaved}
          />
        )}
      </Dialog>
    </div>
  );
}
