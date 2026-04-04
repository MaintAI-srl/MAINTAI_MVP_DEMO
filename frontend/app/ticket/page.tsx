"use client";

import { useEffect, useState, useMemo } from "react";
import { apiGet, apiPost, apiPut, apiPatch } from "../lib/api";
import UploadAllegati from "../components/UploadAllegati";

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

function Pagination({ page, pages, onPage }: { page: number; pages: number; onPage: (p: number) => void }) {
  if (pages <= 1) return null;
  return (
    <div style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 16, justifyContent: "center" }}>
      <button onClick={() => onPage(page - 1)} disabled={page <= 1} style={btnPage}>‹</button>
      {Array.from({ length: pages }, (_, i) => i + 1).filter(p => Math.abs(p - page) <= 2 || p === 1 || p === pages).map((p, idx, arr) => {
        const prev = arr[idx - 1];
        return [
          prev && p - prev > 1 ? <span key={`e${p}`} style={{ color: "var(--text-muted)" }}>…</span> : null,
          <button key={p} onClick={() => onPage(p)} style={{ ...btnPage, ...(p === page ? { background: "rgba(99,102,241,0.3)", color: "#818cf8", border: "1px solid rgba(99,102,241,0.5)" } : {}) }}>{p}</button>
        ];
      })}
      <button onClick={() => onPage(page + 1)} disabled={page >= pages} style={btnPage}>›</button>
      <span style={{ color: "var(--text-muted)", fontSize: 12 }}>pag. {page}/{pages}</span>
    </div>
  );
}

const btnPage: React.CSSProperties = { padding: "4px 10px", background: "transparent", border: "1px solid rgba(75,85,99,0.5)", color: "var(--text-secondary)", borderRadius: 6, cursor: "pointer", fontSize: 13 };
const colFilterInput: React.CSSProperties = { marginTop: 3, width: "100%", background: "rgba(255,255,255,0.04)", border: "1px solid rgba(59,130,246,0.15)", borderRadius: 3, color: "var(--text-secondary)", padding: "2px 5px", fontSize: 10, outline: "none", fontFamily: "inherit" };
const dtInput: React.CSSProperties = { background: "rgba(255,255,255,0.05)", border: "1px solid rgba(148,163,184,0.2)", borderRadius: 7, color: "var(--text-primary)", padding: "7px 11px", fontSize: 12, width: "100%", outline: "none", colorScheme: "dark" };
const modalLabel: React.CSSProperties = { fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: ".1em", color: "var(--text-muted)", display: "block", marginBottom: 5 };

function SortTh({ label, col, sortCol, sortDir, colFilters, onSort, onFilter }: { label: string; col: string; sortCol: string | null; sortDir: "asc" | "desc"; colFilters: Record<string, string>; onSort: (c: string) => void; onFilter: (c: string, v: string) => void }) {
  const active = sortCol === col;
  return (
    <th>
      <div onClick={() => onSort(col)} style={{ cursor: "pointer", userSelect: "none", display: "flex", alignItems: "center", gap: 4, whiteSpace: "nowrap" }}>
        {label}
        <span style={{ fontSize: 9, opacity: active ? 1 : 0.25, color: active ? "#818cf8" : "inherit" }}>{active && sortDir === "desc" ? "↓" : "↑"}</span>
      </div>
      <input value={colFilters[col] ?? ""} onChange={e => onFilter(col, e.target.value)} onClick={e => e.stopPropagation()} placeholder="…" style={colFilterInput} />
    </th>
  );
}

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
  const [err, setErr] = useState("");
  const [showAssetDialog, setShowAssetDialog] = useState(false);

  // Quando si cambia stato → auto-fill date suggerite
  function handleStatoChange(s: string) {
    setStato(s);
    if (s === "In corso" && !executionStart) setExecutionStart(nowDatetimeLocal());
    if (s === "Chiuso" && !executionFinish) setExecutionFinish(nowDatetimeLocal());
  }

  async function doSave(assetStatoOverride?: string) {
    setSaving(true);
    setErr("");
    try {
      const body: Record<string, string | null> = { stato };
      const as = assetStatoOverride !== undefined ? assetStatoOverride : assetStato;
      if (as) body.asset_stato = as;
      if (plannedStart)    body.planned_start    = new Date(plannedStart).toISOString();
      else                 body.planned_start    = null;
      if (plannedFinish)   body.planned_finish   = new Date(plannedFinish).toISOString();
      else                 body.planned_finish   = null;
      if (executionStart)  body.execution_start  = new Date(executionStart).toISOString();
      else                 body.execution_start  = null;
      if (executionFinish) body.execution_finish = new Date(executionFinish).toISOString();
      else                 body.execution_finish = null;

      await apiPut(`/tickets/${ticket.id}`, body);
      onSaved();
      onClose();
    } catch { 
      setErr("Errore nel salvataggio."); 
    } finally { setSaving(false); }
  }

  function handleSave() {
    if (stato === "Chiuso") {
      setShowAssetDialog(true);
    } else {
      doSave();
    }
  }

  return (
    <div
      style={{ position: "fixed", inset: 0, zIndex: 2000, display: "flex", alignItems: "center", justifyContent: "center", background: "rgba(0,0,0,0.6)", backdropFilter: "blur(4px)" }}
      onClick={onClose}
    >
      <div
        style={{ background: "#0d1829", border: "1px solid rgba(59,130,246,0.25)", borderRadius: 16, padding: "28px 32px", width: "min(540px, 94vw)", maxHeight: "90vh", overflowY: "auto", boxShadow: "0 24px 64px rgba(0,0,0,0.6)" }}
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 20 }}>
          <div>
            <div style={{ fontSize: 10, textTransform: "uppercase", letterSpacing: ".14em", color: "var(--text-muted)", marginBottom: 4 }}>
              Ticket #{ticket.id}
            </div>
            <h2 style={{ margin: 0, fontSize: 16, fontWeight: 800, color: "var(--text-primary)", lineHeight: 1.3 }}>{ticket.titolo}</h2>
            <div style={{ marginTop: 8, display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
              <span style={{ ...getPrioritaStyle(ticket.priorita), fontSize: 11, padding: "2px 8px", borderRadius: 4, fontWeight: 600 }}>{ticket.priorita}</span>
              <span style={{ fontSize: 12, color: "var(--text-soft)" }}>{ticket.asset_name ?? "—"}</span>
              <span style={{ fontSize: 12, color: "var(--text-soft)" }}>{ticket.fascia_oraria} · {ticket.durata_stimata_ore?.toFixed(1)}h</span>
            </div>
          </div>
          <button onClick={onClose} style={{ background: "transparent", border: "none", color: "var(--text-muted)", fontSize: 20, cursor: "pointer", lineHeight: 1, padding: "0 4px" }}>×</button>
        </div>

        {err && <div style={{ color: "#fecaca", background: "rgba(127,29,29,.35)", border: "1px solid rgba(248,113,113,.35)", padding: "8px 12px", borderRadius: 7, marginBottom: 16, fontSize: 12 }}>{err}</div>}

        {/* Stato */}
        <div style={{ marginBottom: 20 }}>
          <label style={modalLabel}>Stato</label>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            {STATI.map(s => (
              <button key={s} onClick={() => handleStatoChange(s)}
                style={{ ...statoStyle(s), fontSize: 11, padding: "5px 12px", borderRadius: 6, cursor: "pointer", fontWeight: 600, opacity: stato === s ? 1 : 0.4, outline: stato === s ? "1px solid currentColor" : "none" }}>
                {s}
              </button>
            ))}
          </div>
        </div>

        {/* Link ticket figlio (generato da diagnostica) */}
        {ticket.diagnosi_eseguita && (
          <div style={{ marginBottom: 16, padding: "10px 14px", background: "rgba(99,102,241,0.08)", border: "1px solid rgba(99,102,241,0.25)", borderRadius: 8, fontSize: 12, color: "#a5b4fc" }}>
            Diagnostica AI eseguita — il ticket correttivo è stato generato automaticamente.
          </div>
        )}
        {ticket.parent_id && (
          <div style={{ marginBottom: 16, padding: "10px 14px", background: "rgba(16,185,129,0.08)", border: "1px solid rgba(16,185,129,0.25)", borderRadius: 8, fontSize: 12, color: "#6ee7b7" }}>
            Ticket correttivo figlio di <strong>#{ticket.parent_id}</strong> — creato da diagnostica AI.
          </div>
        )}

        {/* Date grid */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, marginBottom: 20 }}>
          <div>
            <label style={modalLabel}>Inizio pianificato</label>
            <input type="datetime-local" style={dtInput} value={plannedStart} onChange={e => setPlannedStart(e.target.value)} />
          </div>
          <div>
            <label style={modalLabel}>Fine pianificata</label>
            <input type="datetime-local" style={dtInput} value={plannedFinish} onChange={e => setPlannedFinish(e.target.value)} />
          </div>
          <div>
            <label style={modalLabel}>
              Inizio esecuzione
              {!executionStart && (
                <button onClick={() => { setExecutionStart(nowDatetimeLocal()); if (stato === "Aperto" || stato === "Pianificato") setStato("In corso"); }}
                  style={{ marginLeft: 8, fontSize: 9, padding: "1px 7px", border: "1px solid rgba(251,191,36,.4)", color: "#fbbf24", background: "transparent", borderRadius: 3, cursor: "pointer", fontWeight: 700 }}>
                  ORA
                </button>
              )}
            </label>
            <input type="datetime-local" style={dtInput} value={executionStart} onChange={e => setExecutionStart(e.target.value)} />
          </div>
          <div>
            <label style={modalLabel}>
              Fine esecuzione
              {!executionFinish && (
                <button onClick={() => { setExecutionFinish(nowDatetimeLocal()); if (stato !== "Chiuso") setStato("Chiuso"); }}
                  style={{ marginLeft: 8, fontSize: 9, padding: "1px 7px", border: "1px solid rgba(52,211,153,.4)", color: "#34d399", background: "transparent", borderRadius: 3, cursor: "pointer", fontWeight: 700 }}>
                  ORA
                </button>
              )}
            </label>
            <input type="datetime-local" style={dtInput} value={executionFinish} onChange={e => setExecutionFinish(e.target.value)} />
          </div>
        </div>

        {/* Allegati */}
        <div style={{ marginBottom: 24, padding: "16px", background: "rgba(255,255,255,0.02)", borderRadius: 12, border: "1px solid rgba(255,255,255,0.05)" }}>
          <label style={{ ...modalLabel, marginBottom: 12, display: "block" }}>Allegati e Foto Intervento</label>
          <UploadAllegati ticketId={ticket.id} />
        </div>

        {/* Actions */}
        <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
          <button onClick={onClose} style={{ padding: "8px 18px", background: "transparent", border: "1px solid rgba(75,85,99,.5)", color: "var(--text-secondary)", borderRadius: 8, cursor: "pointer", fontSize: 13 }}>
            Annulla
          </button>
          <button onClick={handleSave} disabled={saving}
            style={{ padding: "8px 20px", background: "linear-gradient(135deg,#6366f1,#4f46e5)", border: "none", color: "#fff", borderRadius: 8, cursor: "pointer", fontSize: 13, fontWeight: 700, opacity: saving ? 0.7 : 1 }}>
            {saving ? "Salvataggio…" : "Salva"}
          </button>
        </div>
      </div>

      {/* Sub-dialog: stato asset alla chiusura */}
      {showAssetDialog && (
        <div
          style={{ position: "fixed", inset: 0, zIndex: 3000, display: "flex", alignItems: "center", justifyContent: "center", background: "rgba(0,0,0,0.55)", backdropFilter: "blur(3px)" }}
          onClick={() => setShowAssetDialog(false)}
        >
          <div
            style={{ background: "#0d1829", border: "1px solid rgba(59,130,246,0.3)", borderRadius: 14, padding: "28px 30px", width: "min(420px, 90vw)", boxShadow: "0 20px 60px rgba(0,0,0,0.7)" }}
            onClick={e => e.stopPropagation()}
          >
            <div style={{ fontSize: 10, textTransform: "uppercase", letterSpacing: ".14em", color: "var(--text-muted)", marginBottom: 8 }}>Chiusura ticket #{ticket.id}</div>
            <h3 style={{ margin: "0 0 6px", fontSize: 15, fontWeight: 800, color: "var(--text-primary)" }}>
              L&apos;asset torna in servizio?
            </h3>
            <p style={{ margin: "0 0 22px", fontSize: 12, color: "var(--text-soft)", lineHeight: 1.5 }}>
              Seleziona lo stato dell&apos;asset <strong style={{ color: "var(--text-primary)" }}>{ticket.asset_name ?? `#${ticket.asset_id}`}</strong> dopo la chiusura del ticket.
            </p>
            <div style={{ display: "flex", flexDirection: "column", gap: 10, marginBottom: 20 }}>
              <button
                onClick={() => { setShowAssetDialog(false); doSave("service"); }}
                style={{ display: "flex", alignItems: "center", gap: 12, padding: "12px 16px", background: "rgba(52,211,153,0.08)", border: "1px solid rgba(52,211,153,0.35)", borderRadius: 9, cursor: "pointer", textAlign: "left" }}
              >
                <span style={{ fontSize: 18 }}>✅</span>
                <div>
                  <div style={{ fontWeight: 700, fontSize: 13, color: "#34d399" }}>Sì, torna in servizio</div>
                  <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 2 }}>Asset operativo — stato impostato a Service</div>
                </div>
              </button>
              <button
                onClick={() => { setShowAssetDialog(false); doSave("stopped"); }}
                style={{ display: "flex", alignItems: "center", gap: 12, padding: "12px 16px", background: "rgba(251,191,36,0.08)", border: "1px solid rgba(251,191,36,0.35)", borderRadius: 9, cursor: "pointer", textAlign: "left" }}
              >
                <span style={{ fontSize: 18 }}>⏸️</span>
                <div>
                  <div style={{ fontWeight: 700, fontSize: 13, color: "#fbbf24" }}>Fermo temporaneamente</div>
                  <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 2 }}>Asset in attesa — stato impostato a Stopped</div>
                </div>
              </button>
              <button
                onClick={() => { setShowAssetDialog(false); doSave("out of service"); }}
                style={{ display: "flex", alignItems: "center", gap: 12, padding: "12px 16px", background: "rgba(248,113,113,0.08)", border: "1px solid rgba(248,113,113,0.35)", borderRadius: 9, cursor: "pointer", textAlign: "left" }}
              >
                <span style={{ fontSize: 18 }}>🔴</span>
                <div>
                  <div style={{ fontWeight: 700, fontSize: 13, color: "#f87171" }}>No, fuori servizio</div>
                  <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 2 }}>Asset non operativo — stato impostato a Out of Service</div>
                </div>
              </button>
            </div>
            <button
              onClick={() => { setShowAssetDialog(false); doSave(""); }}
              style={{ width: "100%", padding: "8px", background: "transparent", border: "1px solid rgba(75,85,99,.4)", color: "var(--text-muted)", borderRadius: 7, cursor: "pointer", fontSize: 12 }}
            >
              Non modificare stato asset
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Pagina principale ─────────────────────────────────────────────────────

export default function TicketPage() {
  const [result, setResult] = useState<PagedResult | null>(null);
  const [archivio, setArchivio] = useState<PagedResult | null>(null);
  const [assets, setAssets] = useState<Asset[]>([]);
  const [tab, setTab] = useState<"attivi" | "archivio">("attivi");
  const [page, setPage] = useState(1);
  const [pageArch, setPageArch] = useState(1);
  const LIMIT = 25;

  const [sortCol, setSortCol] = useState<string | null>(null);
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");
  const [colFilters, setColFilters] = useState<Record<string, string>>({});
  function handleColFilter(col: string, val: string) { setColFilters(prev => ({ ...prev, [col]: val })); }

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
  const [error, setError] = useState("");
  const [updatingId, setUpdatingId] = useState<number | null>(null);

  useEffect(() => {
    apiGet<Asset[]>("/assets")
      .then(d => { if (Array.isArray(d)) { setAssets(d); if (d.length > 0) setAssetId(d[0].id); } })
      .catch(() => {});
  }, []);

  useEffect(() => { loadAttivi(page); }, [page]);
  useEffect(() => { if (tab === "archivio") loadArchivio(pageArch); }, [tab, pageArch]);

  useEffect(() => {
    function handler() { setCtxMenu(null); }
    document.addEventListener("click", handler);
    return () => document.removeEventListener("click", handler);
  }, []);

  async function loadAttivi(p: number) {
    try {
      const d = await apiGet<PagedResult>(`/tickets?page=${p}&limit=${LIMIT}&stato=${STATI_ATTIVI.join(",")}`);
      setResult(d);
    } catch { setError("Errore caricamento ticket."); }
  }

  async function loadArchivio(p: number) {
    try {
      const d = await apiGet<PagedResult>(`/tickets?page=${p}&limit=${LIMIT}&stato=${STATI_ARCHIVIO.join(",")}`);
      setArchivio(d);
    } catch {}
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!titolo.trim()) { setError("Il titolo del ticket è obbligatorio."); return; }
    if (!assetId || assetId === 0) { setError("Seleziona un asset valido."); return; }
    if (durataOre <= 0) { setError("La durata deve essere maggiore di zero."); return; }
    try {
      await apiPost("/tickets", {
        titolo, asset_id: Number(assetId), priorita, stato, tipo, asset_stato: assetStato || null,
        durata_stimata_ore: Number(durataOre), fascia_oraria: fascia,
        planned_start: plannedStart || null,
        planned_finish: plannedFinish || null,
      });
      setTitolo(""); setPriorita("Media"); setTipo("CM"); setAssetStato(""); setStato("Aperto"); setDurataOre(2); setFascia("diurna");
      setPlannedStart(""); setPlannedFinish(""); setError("");
      loadAttivi(1); setPage(1);
    } catch { setError("Errore nel salvataggio ticket."); }
  }

  async function handleStatoChange(ticketId: number, nuovoStato: string) {
    setUpdatingId(ticketId);
    try {
      await apiPut(`/tickets/${ticketId}`, { stato: nuovoStato });
      await Promise.all([loadAttivi(page), tab === "archivio" ? loadArchivio(pageArch) : Promise.resolve()]);
    } catch { setError("Errore aggiornamento stato."); }
    finally { setUpdatingId(null); }
  }

  async function bulkUpdateStatus(nuovoStato: string) {
    if (selectedIds.size === 0) return;
    try {
      await apiPatch("/tickets/bulk-status", { ids: Array.from(selectedIds), stato: nuovoStato });
      setSelectedIds(new Set());
      await Promise.all([loadAttivi(page), tab === "archivio" ? loadArchivio(pageArch) : Promise.resolve()]);
    } catch { setError("Errore aggiornamento bulk."); }
  }

  function handleSort(col: string) {
    if (sortCol === col) {
      if (sortDir === "asc") setSortDir("desc");
      else { setSortCol(null); setSortDir("asc"); }
    } else { setSortCol(col); setSortDir("asc"); }
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

  function applySort<T extends Record<string, unknown>>(data: T[]): T[] {
    let result = data;
    for (const [col, val] of Object.entries(colFilters)) {
      if (!val.trim()) continue;
      const t = val.toLowerCase();
      result = result.filter(item => String(item[col] ?? "").toLowerCase().includes(t));
    }
    if (sortCol) {
      result = [...result].sort((a, b) => {
        const cmp = String(a[sortCol] ?? "").localeCompare(String(b[sortCol] ?? ""), "it", { numeric: true });
        return sortDir === "asc" ? cmp : -cmp;
      });
    }
    return result;
  }

  const sortedTickets = useMemo(() => applySort(tickets as Record<string, unknown>[]) as Ticket[], [tickets, sortCol, sortDir, colFilters]);
  const sortedArchivio = useMemo(() => applySort(archivioItems as Record<string, unknown>[]) as Ticket[], [archivioItems, sortCol, sortDir, colFilters]);

  function TicketRow({ t }: { t: Ticket }) {
    return (
      <tr
        onClick={() => setDetailTicket(t)}
        onContextMenu={(e) => { e.preventDefault(); setCtxMenu({ x: e.clientX, y: e.clientY, ticketId: t.id }); }}
        style={{ background: selectedIds.has(t.id) ? "rgba(99,102,241,0.06)" : undefined, cursor: "pointer" }}
      >
        <td style={{ width: 36 }} onClick={e => e.stopPropagation()}>
          <input
            type="checkbox"
            checked={selectedIds.has(t.id)}
            onChange={() => toggleSelect(t.id)}
            style={{ cursor: "pointer", accentColor: "#818cf8" }}
          />
        </td>
        <td>{t.id}</td>
        <td>{t.titolo}</td>
        <td>{t.asset_name ?? "—"}</td>
        <td>
          <span style={{ fontSize: 11, padding: "2px 6px", borderRadius: 4, background: "rgba(255,255,255,0.08)", color: "var(--text-secondary)", border: "1px solid rgba(255,255,255,0.1)" }}>{t.tipo}</span>
          {t.diagnosi_eseguita && <span style={{ marginLeft: 5, fontSize: 10, padding: "1px 6px", borderRadius: 4, background: "rgba(99,102,241,0.15)", color: "#818cf8", border: "1px solid rgba(99,102,241,0.3)", fontWeight: 700 }}>AI</span>}
          {t.parent_id && <span style={{ marginLeft: 5, fontSize: 10, padding: "1px 6px", borderRadius: 4, background: "rgba(16,185,129,0.12)", color: "#6ee7b7", border: "1px solid rgba(16,185,129,0.3)", fontWeight: 700 }}>↳#{t.parent_id}</span>}
        </td>
        <td><span style={{ ...getPrioritaStyle(t.priorita), fontSize: 11, padding: "2px 8px", borderRadius: 4, fontWeight: 600 }}>{t.priorita}</span></td>
        <td onClick={e => e.stopPropagation()}>
          <select
            value={t.stato}
            disabled={updatingId === t.id}
            onChange={e => handleStatoChange(t.id, e.target.value)}
            style={{ ...statoStyle(t.stato), fontSize: 11, padding: "2px 8px", borderRadius: 4, fontWeight: 600, cursor: "pointer", appearance: "none", WebkitAppearance: "none" as never, outline: "none" }}
          >
            {STATI.map(s => <option key={s} value={s}>{s}</option>)}
          </select>
        </td>
        <td>{t.fascia_oraria}</td>
        <td style={{ fontSize: 11, color: "var(--text-soft)" }}>
          {t.planned_start ? new Date(t.planned_start).toLocaleDateString("it-IT") : "—"}
        </td>
        <td style={{ fontSize: 11, color: t.execution_finish ? "#34d399" : "var(--text-soft)" }}>
          {t.execution_finish ? new Date(t.execution_finish).toLocaleDateString("it-IT") : "—"}
        </td>
        <td onClick={e => e.stopPropagation()}>
          <a href={`/ticket/${t.id}/diagnostic`} style={{ fontSize: 11, padding: "4px 10px", border: "1px solid rgba(99,102,241,0.4)", color: "#818cf8", textDecoration: "none", borderRadius: 4, display: "inline-block" }}>
            DIAGNOSTICA →
          </a>
        </td>
      </tr>
    );
  }

  const currentItems = tab === "attivi" ? sortedTickets : sortedArchivio;

  const theadCols = (items: Ticket[]) => (
    <tr>
      <th style={{ width: 36 }}>
        <input type="checkbox" checked={items.length > 0 && items.every(t => selectedIds.has(t.id))} onChange={() => toggleSelectAll(items)} style={{ cursor: "pointer", accentColor: "#818cf8" }} />
      </th>
      <SortTh label="ID" col="id" sortCol={sortCol} sortDir={sortDir} colFilters={colFilters} onSort={handleSort} onFilter={handleColFilter} />
      <SortTh label="Titolo" col="titolo" sortCol={sortCol} sortDir={sortDir} colFilters={colFilters} onSort={handleSort} onFilter={handleColFilter} />
      <SortTh label="Asset" col="asset_name" sortCol={sortCol} sortDir={sortDir} colFilters={colFilters} onSort={handleSort} onFilter={handleColFilter} />
      <SortTh label="Tipo" col="tipo" sortCol={sortCol} sortDir={sortDir} colFilters={colFilters} onSort={handleSort} onFilter={handleColFilter} />
      <SortTh label="Priorità" col="priorita" sortCol={sortCol} sortDir={sortDir} colFilters={colFilters} onSort={handleSort} onFilter={handleColFilter} />
      <SortTh label="Stato" col="stato" sortCol={sortCol} sortDir={sortDir} colFilters={colFilters} onSort={handleSort} onFilter={handleColFilter} />
      <SortTh label="Fascia" col="fascia_oraria" sortCol={sortCol} sortDir={sortDir} colFilters={colFilters} onSort={handleSort} onFilter={handleColFilter} />
      <SortTh label="Pianificato" col="planned_start" sortCol={sortCol} sortDir={sortDir} colFilters={colFilters} onSort={handleSort} onFilter={handleColFilter} />
      <SortTh label="Eseguito" col="execution_finish" sortCol={sortCol} sortDir={sortDir} colFilters={colFilters} onSort={handleSort} onFilter={handleColFilter} />
      <th>Azioni</th>
    </tr>
  );

  return (
    <div>
      <div className="mb-8">
        <h1 className="page-title">Ticket</h1>
        <p className="page-subtitle">Ticket operativi che alimentano il planner automatico.</p>
      </div>

      {error && <div style={{ color: "#fecaca", background: "rgba(127,29,29,0.35)", border: "1px solid rgba(248,113,113,0.35)", padding: "12px 14px", borderRadius: 12, marginBottom: 16 }}>{error}</div>}

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
        {(["attivi", "archivio"] as const).map(t => (
          <button key={t} onClick={() => setTab(t)} style={{ padding: "6px 18px", borderRadius: 6, border: "1px solid", fontSize: 13, cursor: "pointer", background: tab === t ? "rgba(99,102,241,0.2)" : "transparent", color: tab === t ? "#818cf8" : "var(--text-muted)", borderColor: tab === t ? "rgba(99,102,241,0.5)" : "rgba(75,85,99,0.4)" }}>
            {t === "attivi" ? `Attivi (${result?.total ?? 0})` : `Archivio (${archivio?.total ?? 0})`}
          </button>
        ))}
      </div>

      {tab === "attivi" && (
        <>
          <div className="table-wrap">
            <table className="table">
              <thead>{theadCols(tickets)}</thead>
              <tbody>
                {currentItems.length === 0
                  ? <tr><td colSpan={11} style={{ textAlign: "center", opacity: 0.6 }}>Nessun ticket attivo</td></tr>
                  : currentItems.map(t => <TicketRow key={t.id} t={t} />)}
              </tbody>
            </table>
          </div>
          <Pagination page={page} pages={result?.pages ?? 1} onPage={p => setPage(p)} />
        </>
      )}

      {tab === "archivio" && (
        <>
          <div style={{ color: "var(--text-muted)", fontSize: 12, marginBottom: 12 }}>
            Ticket chiusi ed eliminati — visibili all&apos;AI per analisi storiche.
          </div>
          <div className="table-wrap">
            <table className="table">
              <thead>{theadCols(archivioItems)}</thead>
              <tbody>
                {sortedArchivio.length === 0
                  ? <tr><td colSpan={11} style={{ textAlign: "center", opacity: 0.6 }}>Nessun ticket archiviato</td></tr>
                  : sortedArchivio.map(t => <TicketRow key={t.id} t={t} />)}
              </tbody>
            </table>
          </div>
          <Pagination page={pageArch} pages={archivio?.pages ?? 1} onPage={p => setPageArch(p)} />
        </>
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
      {detailTicket && (
        <DetailModal
          ticket={detailTicket}
          onClose={() => setDetailTicket(null)}
          onSaved={handleSaved}
        />
      )}
    </div>
  );
}
