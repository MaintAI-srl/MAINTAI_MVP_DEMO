"use client";

import { useEffect, useState, useMemo } from "react";
import { apiGet, apiPost, apiPut, apiDelete, apiUpload } from "../lib/api";
import { notify } from "@/lib/toast";

type Asset = { id: number; name: string };

type Task = {
  id: number;
  nome: string | null;
  descrizione: string;
  frequenza_giorni: number | null;
  durata_ore: number | null;
  priorita: string;
  asset_id: number | null;
  asset_name: string;
  manuale_id: number | null;
  origine: string;
  codice: string | null;
  ticket_id: number | null;
  open_ticket_count: number;
  generation_mode: string;
  generate_days_before_due: number | null;
  task_stato: string;
  source_type: string | null;
  last_generated_at: string | null;
  next_due_at: string | null;
};

type TicketHistory = {
  id: number;
  titolo: string;
  stato: string;
  priorita: string;
  durata_stimata_ore: number;
  created_at: string | null;
  planned_start: string | null;
  tecnico_id: number | null;
};

type PagedTasks = { items: Task[]; total: number; page: number; pages: number };

const PRIORITA_OPTIONS = ["Alta", "Media", "Bassa"];
const PAGE_LIMIT = 25;

function prioritaStyle(p: string): React.CSSProperties {
  switch (p?.toLowerCase()) {
    case "alta":  return { color: "#f87171", background: "rgba(248,113,113,0.1)", border: "1px solid rgba(248,113,113,0.3)" };
    case "media": return { color: "#fbbf24", background: "rgba(251,191,36,0.1)", border: "1px solid rgba(251,191,36,0.3)" };
    case "bassa": return { color: "#34d399", background: "rgba(52,211,153,0.1)", border: "1px solid rgba(52,211,153,0.3)" };
    default: return { color: "var(--text-secondary)", background: "rgba(156,163,175,0.1)", border: "1px solid rgba(156,163,175,0.3)" };
  }
}

function statoStyle(s: string): React.CSSProperties {
  switch (s) {
    case "active":   return { color: "#34d399", background: "rgba(52,211,153,0.1)", border: "1px solid rgba(52,211,153,0.3)" };
    case "paused":   return { color: "#fbbf24", background: "rgba(251,191,36,0.1)", border: "1px solid rgba(251,191,36,0.3)" };
    case "archived": return { color: "#6b7280", background: "rgba(107,114,128,0.1)", border: "1px solid rgba(107,114,128,0.3)" };
    default: return {};
  }
}

function statoLabel(s: string) {
  return s === "active" ? "Attivo" : s === "paused" ? "In pausa" : s === "archived" ? "Archiviato" : s;
}

function sourceLabel(s: string | null) {
  if (!s) return "";
  return s === "manual_task" ? "Manuale" : s === "manual_imported_from_manual" ? "Da manuale/PDF" : s;
}

function formatDate(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("it-IT", { day: "2-digit", month: "short", year: "numeric" });
}

function isOverdue(next_due_at: string | null): boolean {
  if (!next_due_at) return false;
  return new Date(next_due_at) < new Date();
}

function Pagination({ page, pages, onPage }: { page: number; pages: number; onPage: (p: number) => void }) {
  if (pages <= 1) return null;
  const btn: React.CSSProperties = { padding: "4px 10px", background: "transparent", border: "1px solid rgba(75,85,99,0.5)", color: "var(--text-secondary)", borderRadius: 6, cursor: "pointer", fontSize: 13 };
  return (
    <div style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 16, justifyContent: "center" }}>
      <button onClick={() => onPage(page - 1)} disabled={page <= 1} style={btn}>‹</button>
      {Array.from({ length: pages }, (_, i) => i + 1)
        .filter(p => Math.abs(p - page) <= 2 || p === 1 || p === pages)
        .map((p, idx, arr) => {
          const prev = arr[idx - 1];
          return [
            prev && p - prev > 1 ? <span key={`e${p}`} style={{ color: "var(--text-muted)" }}>…</span> : null,
            <button key={p} onClick={() => onPage(p)} style={{ ...btn, ...(p === page ? { background: "rgba(99,102,241,0.3)", color: "#818cf8", borderColor: "rgba(99,102,241,0.5)" } : {}) }}>{p}</button>,
          ];
        })}
      <button onClick={() => onPage(page + 1)} disabled={page >= pages} style={btn}>›</button>
      <span style={{ color: "var(--text-muted)", fontSize: 12 }}>pag. {page}/{pages}</span>
    </div>
  );
}

export default function PianiUnificatiPage() {
  const [result, setResult] = useState<PagedTasks | null>(null);
  const [assets, setAssets] = useState<Asset[]>([]);
  const [loading, setLoading] = useState(true);
  const [currentPage, setCurrentPage] = useState(1);
  const [filterAsset, setFilterAsset] = useState("");
  const [filterPriorita, setFilterPriorita] = useState("");
  const [filterStato, setFilterStato] = useState("active");
  const [filterSource, setFilterSource] = useState("");

  // Detail panel
  const [selectedTask, setSelectedTask] = useState<Task | null>(null);
  const [taskTickets, setTaskTickets] = useState<TicketHistory[]>([]);
  const [ticketsLoading, setTicketsLoading] = useState(false);

  // Create form
  const [showNewForm, setShowNewForm] = useState(false);
  const [newNome, setNewNome] = useState("");
  const [newDescrizione, setNewDescrizione] = useState("");
  const [newCodice, setNewCodice] = useState("");
  const [newFrequenza, setNewFrequenza] = useState("");
  const [newDurata, setNewDurata] = useState("");
  const [newPriorita, setNewPriorita] = useState("Media");
  const [newAssetId, setNewAssetId] = useState("");
  const [newGenMode, setNewGenMode] = useState("manual");
  const [creating, setCreating] = useState(false);

  // Edit state (inline in detail panel)
  const [editing, setEditing] = useState(false);
  const [editNome, setEditNome] = useState("");
  const [editDescrizione, setEditDescrizione] = useState("");
  const [editFrequenza, setEditFrequenza] = useState("");
  const [editDurata, setEditDurata] = useState("");
  const [editPriorita, setEditPriorita] = useState("");
  const [editAssetId, setEditAssetId] = useState("");
  const [editGenMode, setEditGenMode] = useState("manual");
  const [editTaskStato, setEditTaskStato] = useState("active");
  const [saving, setSaving] = useState(false);

  // Genera ticket
  const [generatingId, setGeneratingId] = useState<number | null>(null);

  // Import
  const [importing, setImporting] = useState(false);

  // Delete confirm
  const [confirmDelId, setConfirmDelId] = useState<number | null>(null);

  const tasks = result?.items ?? [];

  useEffect(() => {
    apiGet<Asset[]>("/assets").then(setAssets).catch(() => {});
  }, []);

  useEffect(() => { setCurrentPage(1); }, [filterAsset, filterPriorita, filterStato, filterSource]);
  useEffect(() => { loadTasks(currentPage); }, [filterAsset, filterPriorita, filterStato, filterSource, currentPage]);

  async function loadTasks(p: number) {
    setLoading(true);
    try {
      const params = new URLSearchParams({ page: String(p), limit: String(PAGE_LIMIT) });
      if (filterAsset) params.set("asset_id", filterAsset);
      if (filterPriorita) params.set("priorita", filterPriorita);
      if (filterStato) params.set("task_stato", filterStato);
      if (filterSource) params.set("source_type", filterSource);
      const d = await apiGet<PagedTasks>(`/piani?${params}`);
      setResult(d);
    } catch {
      notify.error("Impossibile caricare i task.");
    } finally {
      setLoading(false);
    }
  }

  async function openDetail(t: Task) {
    setSelectedTask(t);
    setEditing(false);
    setTaskTickets([]);
    setTicketsLoading(true);
    try {
      const tickets = await apiGet<TicketHistory[]>(`/piani/${t.id}/tickets`);
      setTaskTickets(tickets);
    } catch {
      // non critico
    } finally {
      setTicketsLoading(false);
    }
  }

  function startEdit(t: Task) {
    setEditNome(t.nome || "");
    setEditDescrizione(t.descrizione || "");
    setEditFrequenza(t.frequenza_giorni != null ? String(t.frequenza_giorni) : "");
    setEditDurata(t.durata_ore != null ? String(t.durata_ore) : "");
    setEditPriorita(t.priorita);
    setEditAssetId(t.asset_id != null ? String(t.asset_id) : "");
    setEditGenMode(t.generation_mode || "manual");
    setEditTaskStato(t.task_stato || "active");
    setEditing(true);
  }

  async function saveEdit() {
    if (!selectedTask) return;
    setSaving(true);
    try {
      const body: Record<string, unknown> = {
        nome: editNome || null,
        descrizione: editDescrizione,
        priorita: editPriorita,
        generation_mode: editGenMode,
        task_stato: editTaskStato,
      };
      if (editFrequenza !== "") body.frequenza_giorni = Number(editFrequenza);
      if (editDurata !== "") body.durata_ore = Number(editDurata);
      if (editAssetId !== "") body.asset_id = Number(editAssetId);

      const updated = await apiPut<Task>(`/piani/${selectedTask.id}`, body);
      setResult(prev => prev ? { ...prev, items: prev.items.map(t => t.id === selectedTask.id ? { ...t, ...updated } : t) } : prev);
      setSelectedTask(prev => prev ? { ...prev, ...updated } : prev);
      setEditing(false);
      notify.success("Task aggiornato.");
    } catch {
      notify.error("Errore durante il salvataggio.");
    } finally {
      setSaving(false);
    }
  }

  async function generaTicket(taskId: number) {
    setGeneratingId(taskId);
    try {
      const d = await apiPost<{ created: number; skipped: number }>("/piani/genera-ticket", { attivita_ids: [taskId] });
      if (d.created > 0) {
        notify.success(`Ticket generato con successo.`);
        await loadTasks(currentPage);
        if (selectedTask?.id === taskId) {
          const updated = await apiGet<PagedTasks>(`/piani?page=1&limit=200`);
          const fresh = updated.items.find(t => t.id === taskId);
          if (fresh) {
            setSelectedTask(fresh);
            const tickets = await apiGet<TicketHistory[]>(`/piani/${taskId}/tickets`);
            setTaskTickets(tickets);
          }
        }
      } else {
        notify.warning("Esiste già un ticket aperto per questo task.");
      }
    } catch {
      notify.error("Errore durante la generazione del ticket.");
    } finally {
      setGeneratingId(null);
    }
  }

  async function createTask() {
    if (!newDescrizione.trim() && !newNome.trim()) { notify.error("Nome o descrizione obbligatori."); return; }
    setCreating(true);
    try {
      await apiPost("/piani", {
        nome: newNome.trim() || null,
        descrizione: newDescrizione.trim() || newNome.trim(),
        codice: newCodice.trim() || null,
        frequenza_giorni: newFrequenza ? Number(newFrequenza) : null,
        durata_ore: newDurata ? Number(newDurata) : null,
        priorita: newPriorita,
        asset_id: newAssetId ? Number(newAssetId) : null,
        generation_mode: newGenMode,
        source_type: "manual_task",
      });
      setShowNewForm(false);
      setNewNome(""); setNewDescrizione(""); setNewCodice(""); setNewFrequenza("");
      setNewDurata(""); setNewPriorita("Media"); setNewAssetId(""); setNewGenMode("manual");
      notify.success("Task creato.");
      await loadTasks(currentPage);
    } catch {
      notify.error("Errore durante la creazione.");
    } finally {
      setCreating(false);
    }
  }

  async function deleteTask(id: number) {
    try {
      await apiDelete(`/piani/${id}`);
      setConfirmDelId(null);
      if (selectedTask?.id === id) setSelectedTask(null);
      notify.success("Task eliminato.");
      await loadTasks(currentPage);
    } catch {
      notify.error("Errore durante l'eliminazione.");
    }
  }

  async function handleImport(file: File) {
    setImporting(true);
    const formData = new FormData();
    formData.append("file", file);
    try {
      // Il backend ora crea TASK (AttivitaManutenzione) tramite un piano temporaneo
      // Usiamo l'endpoint import generico che lavora direttamente su attivita_manutenzione
      // Per ora usiamo import-pdf senza piano specifico: creiamo un piano temporaneo
      // oppure usiamo l'endpoint dei manuali già esistente.
      // Soluzione: caricare il file come manuale → il piano manutenzione lo estrae come task
      const res: any = await apiUpload("/manuali/upload", formData);
      if (res && res.id) {
        notify.success(`PDF importato. I task sono stati estratti e sono disponibili nella lista.`);
        await loadTasks(1);
        setCurrentPage(1);
      }
    } catch (err: any) {
      notify.error(`Errore durante l'importazione: ${err.message || "Errore generico"}`);
    } finally {
      setImporting(false);
    }
  }

  async function exportCSV() {
    try {
      const res = await fetch(
        (process.env.NEXT_PUBLIC_API_BASE ?? "https://maintai-v3.onrender.com") + "/piani/export",
        { credentials: "include" }
      );
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "task_manutenzione.csv";
      a.click();
      URL.revokeObjectURL(url);
    } catch {
      notify.error("Errore durante l'esportazione CSV.");
    }
  }

  const noTicketTasks = tasks.filter(t => t.open_ticket_count === 0 && t.task_stato === "active");

  async function generaTutti() {
    if (noTicketTasks.length === 0) return;
    try {
      const d = await apiPost<{ created: number; skipped: number }>("/piani/genera-ticket", {
        attivita_ids: noTicketTasks.map(t => t.id),
      });
      notify.success(`${d.created} ticket creati, ${d.skipped} già presenti.`);
      await loadTasks(currentPage);
    } catch {
      notify.error("Errore durante la generazione massiva.");
    }
  }

  return (
    <div style={{ display: "flex", height: "100%", overflow: "hidden" }}>
      {/* ── LEFT: TASK LIST ── */}
      <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden", padding: "24px 0 24px 24px", minWidth: 0 }}>

        {/* Header */}
        <div style={{ marginBottom: 20, paddingRight: 24 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 16 }}>
            <div>
              <h1 className="page-title" style={{ marginBottom: 4 }}>Piano di Manutenzione — TASK</h1>
              <p className="page-subtitle" style={{ margin: 0 }}>
                Task ricorrenti di manutenzione. Ogni task genera ticket assegnabili al piano AI.
              </p>
            </div>
            <div style={{ display: "flex", gap: 8, flexShrink: 0 }}>
              <button
                onClick={() => setShowNewForm(v => !v)}
                style={{ padding: "8px 14px", borderRadius: 8, background: "rgba(99,102,241,0.15)", border: "1px solid rgba(99,102,241,0.4)", color: "#818cf8", fontWeight: 700, cursor: "pointer", fontSize: 13 }}
              >
                + Nuovo Task
              </button>
              <label style={{ padding: "8px 14px", borderRadius: 8, background: "rgba(59,130,246,0.1)", border: "1px solid rgba(59,130,246,0.3)", color: "#60a5fa", fontWeight: 700, cursor: importing ? "default" : "pointer", fontSize: 13, opacity: importing ? 0.6 : 1 }}>
                {importing ? "Importazione..." : "Import PDF"}
                <input type="file" accept=".pdf" hidden onChange={e => e.target.files?.[0] && handleImport(e.target.files[0])} disabled={importing} />
              </label>
              <button
                onClick={exportCSV}
                style={{ padding: "8px 14px", borderRadius: 8, background: "rgba(34,197,94,0.1)", border: "1px solid rgba(34,197,94,0.4)", color: "#22c55e", fontWeight: 700, cursor: "pointer", fontSize: 13 }}
              >
                Export CSV
              </button>
            </div>
          </div>

          {/* New Task Form */}
          {showNewForm && (
            <div style={{ background: "var(--bg-card)", border: "1px solid rgba(99,102,241,0.25)", borderRadius: 12, padding: "16px 20px", marginBottom: 16, borderTop: "2px solid #6366f1" }}>
              <h3 style={{ margin: "0 0 14px", fontSize: 13, fontWeight: 800 }}>Nuovo Task di Manutenzione</h3>
              <div style={{ display: "grid", gridTemplateColumns: "1.5fr 1fr 1fr 1fr 1fr 1.5fr", gap: 10, marginBottom: 12 }}>
                <div>
                  <div style={{ fontSize: 10, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: ".1em", marginBottom: 3 }}>Nome Task *</div>
                  <input className="input" value={newNome} onChange={e => setNewNome(e.target.value)} placeholder="Es. Controllo livello olio" style={{ fontSize: 12 }} />
                </div>
                <div>
                  <div style={{ fontSize: 10, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: ".1em", marginBottom: 3 }}>Codice</div>
                  <input className="input" value={newCodice} onChange={e => setNewCodice(e.target.value)} placeholder="PM-001" style={{ fontSize: 12 }} />
                </div>
                <div>
                  <div style={{ fontSize: 10, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: ".1em", marginBottom: 3 }}>Freq (gg)</div>
                  <input className="input" type="number" value={newFrequenza} onChange={e => setNewFrequenza(e.target.value)} placeholder="90" style={{ fontSize: 12 }} />
                </div>
                <div>
                  <div style={{ fontSize: 10, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: ".1em", marginBottom: 3 }}>Durata (h)</div>
                  <input className="input" type="number" step="0.5" value={newDurata} onChange={e => setNewDurata(e.target.value)} placeholder="2" style={{ fontSize: 12 }} />
                </div>
                <div>
                  <div style={{ fontSize: 10, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: ".1em", marginBottom: 3 }}>Priorità</div>
                  <select className="select" value={newPriorita} onChange={e => setNewPriorita(e.target.value)} style={{ fontSize: 12 }}>
                    {PRIORITA_OPTIONS.map(p => <option key={p} value={p}>{p}</option>)}
                  </select>
                </div>
                <div>
                  <div style={{ fontSize: 10, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: ".1em", marginBottom: 3 }}>Asset</div>
                  <select className="select" value={newAssetId} onChange={e => setNewAssetId(e.target.value)} style={{ fontSize: 12 }}>
                    <option value="">— nessuno —</option>
                    {assets.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
                  </select>
                </div>
              </div>
              <div style={{ marginBottom: 10 }}>
                <div style={{ fontSize: 10, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: ".1em", marginBottom: 3 }}>Descrizione estesa (opzionale)</div>
                <textarea className="input" value={newDescrizione} onChange={e => setNewDescrizione(e.target.value)} placeholder="Istruzioni dettagliate..." style={{ fontSize: 12, minHeight: 56, fontFamily: "inherit", resize: "vertical", width: "100%", boxSizing: "border-box" }} />
              </div>
              <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                <button onClick={createTask} disabled={creating} style={{ padding: "7px 20px", background: "linear-gradient(135deg,#6366f1,#4f46e5)", color: "#fff", border: "none", borderRadius: 8, fontWeight: 700, fontSize: 12, cursor: creating ? "not-allowed" : "pointer", opacity: creating ? 0.7 : 1 }}>
                  {creating ? "Salvataggio..." : "Crea Task"}
                </button>
                <button onClick={() => setShowNewForm(false)} style={{ padding: "7px 16px", background: "transparent", border: "1px solid rgba(148,163,184,.2)", color: "var(--text-muted)", borderRadius: 8, cursor: "pointer", fontSize: 12 }}>Annulla</button>
              </div>
            </div>
          )}

          {/* Filters */}
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
            <select className="select" value={filterAsset} onChange={e => setFilterAsset(e.target.value)} style={{ minWidth: 160, fontSize: 12 }}>
              <option value="">Tutti gli asset</option>
              {assets.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
            </select>
            <select className="select" value={filterPriorita} onChange={e => setFilterPriorita(e.target.value)} style={{ minWidth: 130, fontSize: 12 }}>
              <option value="">Tutte le priorità</option>
              {PRIORITA_OPTIONS.map(p => <option key={p} value={p}>{p}</option>)}
            </select>
            <select className="select" value={filterStato} onChange={e => setFilterStato(e.target.value)} style={{ minWidth: 130, fontSize: 12 }}>
              <option value="">Tutti gli stati</option>
              <option value="active">Attivi</option>
              <option value="paused">In pausa</option>
              <option value="archived">Archiviati</option>
            </select>
            <select className="select" value={filterSource} onChange={e => setFilterSource(e.target.value)} style={{ minWidth: 140, fontSize: 12 }}>
              <option value="">Tutte le origini</option>
              <option value="manual_task">Manuale</option>
              <option value="manual_imported_from_manual">Da PDF/manuale</option>
            </select>
            <button onClick={() => { setFilterAsset(""); setFilterPriorita(""); setFilterStato("active"); setFilterSource(""); }} style={{ padding: "5px 12px", background: "transparent", border: "1px solid rgba(75,85,99,0.5)", color: "var(--text-secondary)", borderRadius: 6, cursor: "pointer", fontSize: 12 }}>Azzera</button>
            {noTicketTasks.length > 0 && (
              <button onClick={generaTutti} style={{ padding: "5px 14px", background: "rgba(99,102,241,0.15)", border: "1px solid rgba(99,102,241,0.4)", color: "#818cf8", borderRadius: 6, cursor: "pointer", fontSize: 12, fontWeight: 600 }}>
                Genera tutti i ticket ({noTicketTasks.length})
              </button>
            )}
            <span style={{ marginLeft: "auto", color: "var(--text-muted)", fontSize: 12 }}>{result?.total ?? 0} task totali</span>
          </div>
        </div>

        {/* Task List */}
        <div style={{ flex: 1, overflowY: "auto", paddingRight: 24 }}>
          {loading ? (
            <div style={{ textAlign: "center", padding: 40, color: "var(--text-muted)" }}>Caricamento...</div>
          ) : tasks.length === 0 ? (
            <div style={{ textAlign: "center", padding: 48, color: "var(--text-muted)", fontSize: 14 }}>
              Nessun task trovato. Crea un task manuale o importa un PDF per generare il piano di manutenzione.
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              {tasks.map(t => {
                const active = selectedTask?.id === t.id;
                const overdue = isOverdue(t.next_due_at);
                return (
                  <div
                    key={t.id}
                    onClick={() => openDetail(t)}
                    style={{
                      padding: "12px 16px",
                      borderRadius: 10,
                      border: `1px solid ${active ? "rgba(99,102,241,0.5)" : overdue ? "rgba(248,113,113,0.3)" : "var(--border)"}`,
                      background: active ? "rgba(99,102,241,0.08)" : overdue ? "rgba(248,113,113,0.04)" : "var(--bg-surface)",
                      cursor: "pointer",
                      display: "flex",
                      gap: 12,
                      alignItems: "center",
                      transition: "all 0.15s",
                    }}
                  >
                    {/* Stato dot */}
                    <div style={{
                      width: 8, height: 8, borderRadius: "50%", flexShrink: 0,
                      background: t.task_stato === "active" ? "#34d399" : t.task_stato === "paused" ? "#fbbf24" : "#6b7280",
                    }} />

                    {/* Name + meta */}
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontWeight: 700, fontSize: 13, color: active ? "#818cf8" : "var(--text-primary)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                        {t.nome || t.descrizione}
                      </div>
                      <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 3, display: "flex", gap: 12 }}>
                        {t.asset_name && <span>{t.asset_name}</span>}
                        {t.frequenza_giorni && <span>ogni {t.frequenza_giorni}gg</span>}
                        {t.durata_ore && <span>{t.durata_ore.toFixed(1)}h</span>}
                        {overdue && <span style={{ color: "#f87171", fontWeight: 700 }}>SCADUTO</span>}
                        {t.next_due_at && !overdue && <span style={{ color: "var(--text-secondary)" }}>scade {formatDate(t.next_due_at)}</span>}
                      </div>
                    </div>

                    {/* Badges */}
                    <div style={{ display: "flex", gap: 6, flexShrink: 0, alignItems: "center" }}>
                      <span style={{ ...prioritaStyle(t.priorita), fontSize: 10, padding: "2px 6px", borderRadius: 4, fontWeight: 700 }}>{t.priorita}</span>
                      {t.source_type === "manual_imported_from_manual" && (
                        <span style={{ fontSize: 10, padding: "2px 6px", borderRadius: 4, color: "#60a5fa", background: "rgba(59,130,246,0.1)", border: "1px solid rgba(59,130,246,0.2)" }}>PDF</span>
                      )}
                      {t.open_ticket_count > 0 ? (
                        <span style={{ fontSize: 10, padding: "2px 6px", borderRadius: 4, color: "#34d399", background: "rgba(52,211,153,0.1)", border: "1px solid rgba(52,211,153,0.2)" }}>
                          {t.open_ticket_count} aperto
                        </span>
                      ) : (
                        <span style={{ fontSize: 10, padding: "2px 6px", borderRadius: 4, color: "#fbbf24", background: "rgba(251,191,36,0.08)", border: "1px solid rgba(251,191,36,0.2)" }}>no ticket</span>
                      )}
                      <button
                        onClick={e => { e.stopPropagation(); setConfirmDelId(t.id); }}
                        style={{ fontSize: 12, padding: "2px 7px", border: "1px solid rgba(248,113,113,0.3)", color: "#f87171", background: "transparent", borderRadius: 4, cursor: "pointer" }}
                      >✕</button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
          <Pagination page={currentPage} pages={result?.pages ?? 1} onPage={p => setCurrentPage(p)} />
        </div>
      </div>

      {/* ── RIGHT: DETAIL PANEL ── */}
      <div style={{
        width: 400,
        flexShrink: 0,
        background: "var(--bg-surface)",
        borderLeft: "1px solid var(--border)",
        display: "flex",
        flexDirection: "column",
        overflow: "hidden",
      }}>
        {selectedTask ? (
          <>
            {/* Detail header */}
            <div style={{ padding: "20px 20px 16px", borderBottom: "1px solid var(--border)" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 12 }}>
                <div style={{ flex: 1, minWidth: 0, paddingRight: 8 }}>
                  <div style={{ fontSize: 15, fontWeight: 800, color: "var(--text-primary)", lineHeight: 1.3, wordBreak: "break-word" }}>
                    {selectedTask.nome || selectedTask.descrizione}
                  </div>
                  {selectedTask.codice && (
                    <div style={{ fontSize: 11, color: "var(--blue)", marginTop: 4, fontFamily: "monospace" }}>{selectedTask.codice}</div>
                  )}
                </div>
                <button onClick={() => setSelectedTask(null)} style={{ background: "transparent", border: "none", color: "var(--text-muted)", fontSize: 18, cursor: "pointer", flexShrink: 0 }}>✕</button>
              </div>

              {/* Badges row */}
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                <span style={{ ...prioritaStyle(selectedTask.priorita), fontSize: 11, padding: "2px 8px", borderRadius: 4, fontWeight: 700 }}>{selectedTask.priorita}</span>
                <span style={{ ...statoStyle(selectedTask.task_stato), fontSize: 11, padding: "2px 8px", borderRadius: 4, fontWeight: 700 }}>{statoLabel(selectedTask.task_stato)}</span>
                <span style={{ fontSize: 11, padding: "2px 8px", borderRadius: 4, color: "var(--text-secondary)", background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.08)" }}>
                  {sourceLabel(selectedTask.source_type)}
                </span>
              </div>
            </div>

            {/* Scrollable body */}
            <div style={{ flex: 1, overflowY: "auto", padding: "16px 20px" }}>

              {editing ? (
                /* Edit Form */
                <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                  <div>
                    <div style={{ fontSize: 10, color: "var(--text-muted)", textTransform: "uppercase", marginBottom: 3 }}>Nome</div>
                    <input className="input" value={editNome} onChange={e => setEditNome(e.target.value)} style={{ fontSize: 13 }} />
                  </div>
                  <div>
                    <div style={{ fontSize: 10, color: "var(--text-muted)", textTransform: "uppercase", marginBottom: 3 }}>Descrizione</div>
                    <textarea className="input" value={editDescrizione} onChange={e => setEditDescrizione(e.target.value)} style={{ fontSize: 12, minHeight: 60, fontFamily: "inherit", resize: "vertical", width: "100%", boxSizing: "border-box" }} />
                  </div>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                    <div>
                      <div style={{ fontSize: 10, color: "var(--text-muted)", textTransform: "uppercase", marginBottom: 3 }}>Freq (gg)</div>
                      <input className="input" type="number" value={editFrequenza} onChange={e => setEditFrequenza(e.target.value)} style={{ fontSize: 12 }} />
                    </div>
                    <div>
                      <div style={{ fontSize: 10, color: "var(--text-muted)", textTransform: "uppercase", marginBottom: 3 }}>Durata (h)</div>
                      <input className="input" type="number" step="0.5" value={editDurata} onChange={e => setEditDurata(e.target.value)} style={{ fontSize: 12 }} />
                    </div>
                  </div>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                    <div>
                      <div style={{ fontSize: 10, color: "var(--text-muted)", textTransform: "uppercase", marginBottom: 3 }}>Priorità</div>
                      <select className="select" value={editPriorita} onChange={e => setEditPriorita(e.target.value)} style={{ fontSize: 12 }}>
                        {PRIORITA_OPTIONS.map(p => <option key={p} value={p}>{p}</option>)}
                      </select>
                    </div>
                    <div>
                      <div style={{ fontSize: 10, color: "var(--text-muted)", textTransform: "uppercase", marginBottom: 3 }}>Stato Task</div>
                      <select className="select" value={editTaskStato} onChange={e => setEditTaskStato(e.target.value)} style={{ fontSize: 12 }}>
                        <option value="active">Attivo</option>
                        <option value="paused">In pausa</option>
                        <option value="archived">Archiviato</option>
                      </select>
                    </div>
                  </div>
                  <div>
                    <div style={{ fontSize: 10, color: "var(--text-muted)", textTransform: "uppercase", marginBottom: 3 }}>Asset</div>
                    <select className="select" value={editAssetId} onChange={e => setEditAssetId(e.target.value)} style={{ fontSize: 12 }}>
                      <option value="">— nessuno —</option>
                      {assets.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
                    </select>
                  </div>
                  <div>
                    <div style={{ fontSize: 10, color: "var(--text-muted)", textTransform: "uppercase", marginBottom: 3 }}>Modalità generazione ticket</div>
                    <select className="select" value={editGenMode} onChange={e => setEditGenMode(e.target.value)} style={{ fontSize: 12 }}>
                      <option value="manual">Manuale (solo su richiesta)</option>
                      <option value="auto">Automatica (alla scadenza)</option>
                      <option value="disabled">Disabilitata</option>
                    </select>
                  </div>
                  <div style={{ display: "flex", gap: 8 }}>
                    <button onClick={saveEdit} disabled={saving} style={{ flex: 1, padding: "8px", background: "linear-gradient(135deg,#6366f1,#4f46e5)", color: "#fff", border: "none", borderRadius: 8, fontWeight: 700, cursor: saving ? "not-allowed" : "pointer", fontSize: 13, opacity: saving ? 0.7 : 1 }}>
                      {saving ? "Salvataggio..." : "Salva modifiche"}
                    </button>
                    <button onClick={() => setEditing(false)} style={{ padding: "8px 14px", background: "transparent", border: "1px solid var(--border)", color: "var(--text-muted)", borderRadius: 8, cursor: "pointer", fontSize: 13 }}>Annulla</button>
                  </div>
                </div>
              ) : (
                /* View Mode */
                <>
                  {/* Info grid */}
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 20 }}>
                    <div>
                      <div style={{ fontSize: 10, color: "var(--text-muted)", textTransform: "uppercase", marginBottom: 4 }}>Asset</div>
                      <div style={{ fontSize: 13, color: selectedTask.asset_name ? "#818cf8" : "var(--text-muted)" }}>{selectedTask.asset_name || "—"}</div>
                    </div>
                    <div>
                      <div style={{ fontSize: 10, color: "var(--text-muted)", textTransform: "uppercase", marginBottom: 4 }}>Frequenza</div>
                      <div style={{ fontSize: 13 }}>{selectedTask.frequenza_giorni ? `ogni ${selectedTask.frequenza_giorni}gg` : "—"}</div>
                    </div>
                    <div>
                      <div style={{ fontSize: 10, color: "var(--text-muted)", textTransform: "uppercase", marginBottom: 4 }}>Durata stimata</div>
                      <div style={{ fontSize: 13 }}>{selectedTask.durata_ore ? `${selectedTask.durata_ore.toFixed(1)}h` : "—"}</div>
                    </div>
                    <div>
                      <div style={{ fontSize: 10, color: "var(--text-muted)", textTransform: "uppercase", marginBottom: 4 }}>Generazione</div>
                      <div style={{ fontSize: 13 }}>{selectedTask.generation_mode === "manual" ? "Manuale" : selectedTask.generation_mode === "auto" ? "Automatica" : "Disabilitata"}</div>
                    </div>
                    <div>
                      <div style={{ fontSize: 10, color: "var(--text-muted)", textTransform: "uppercase", marginBottom: 4 }}>Ultimo ticket</div>
                      <div style={{ fontSize: 13 }}>{formatDate(selectedTask.last_generated_at)}</div>
                    </div>
                    <div>
                      <div style={{ fontSize: 10, color: "var(--text-muted)", textTransform: "uppercase", marginBottom: 4 }}>Prossima scadenza</div>
                      <div style={{ fontSize: 13, color: isOverdue(selectedTask.next_due_at) ? "#f87171" : "inherit" }}>
                        {formatDate(selectedTask.next_due_at)}
                        {isOverdue(selectedTask.next_due_at) && " ⚠"}
                      </div>
                    </div>
                  </div>

                  {/* Descrizione estesa */}
                  {selectedTask.descrizione && selectedTask.descrizione !== selectedTask.nome && (
                    <div style={{ marginBottom: 20, padding: "10px 12px", background: "rgba(255,255,255,0.02)", border: "1px solid var(--border)", borderRadius: 8 }}>
                      <div style={{ fontSize: 10, color: "var(--text-muted)", textTransform: "uppercase", marginBottom: 6 }}>Descrizione</div>
                      <div style={{ fontSize: 12, color: "var(--text-secondary)", lineHeight: 1.6 }}>{selectedTask.descrizione}</div>
                    </div>
                  )}

                  {/* Prossime scadenze previste */}
                  {selectedTask.frequenza_giorni && (
                    <div style={{ marginBottom: 20 }}>
                      <div style={{ fontSize: 10, color: "var(--text-muted)", textTransform: "uppercase", marginBottom: 8 }}>Prossime scadenze</div>
                      {Array.from({ length: Math.min(6, Math.floor(365 / selectedTask.frequenza_giorni)) }, (_, i) => {
                        const d = new Date();
                        d.setDate(d.getDate() + (i + 1) * selectedTask.frequenza_giorni!);
                        return (
                          <div key={i} style={{ fontSize: 12, color: "var(--text-secondary)", padding: "4px 0", borderBottom: "1px solid rgba(59,130,246,0.06)" }}>
                            {d.toLocaleDateString("it-IT", { day: "2-digit", month: "short", year: "numeric" })}
                          </div>
                        );
                      })}
                    </div>
                  )}

                  {/* Action buttons */}
                  <div style={{ display: "flex", gap: 8, marginBottom: 20 }}>
                    <button
                      onClick={() => generaTicket(selectedTask.id)}
                      disabled={generatingId === selectedTask.id || selectedTask.task_stato !== "active" || selectedTask.generation_mode === "disabled"}
                      style={{
                        flex: 1, padding: "10px", borderRadius: 8, fontWeight: 700, fontSize: 13, cursor: "pointer",
                        background: selectedTask.open_ticket_count > 0 ? "rgba(52,211,153,0.1)" : "rgba(251,191,36,0.15)",
                        border: selectedTask.open_ticket_count > 0 ? "1px solid rgba(52,211,153,0.3)" : "1px solid rgba(251,191,36,0.4)",
                        color: selectedTask.open_ticket_count > 0 ? "#34d399" : "#fbbf24",
                        opacity: generatingId === selectedTask.id || selectedTask.task_stato !== "active" || selectedTask.generation_mode === "disabled" ? 0.5 : 1,
                      }}
                    >
                      {generatingId === selectedTask.id ? "Generazione..." : selectedTask.open_ticket_count > 0 ? `${selectedTask.open_ticket_count} ticket aperti` : "+ Genera Ticket"}
                    </button>
                    <button onClick={() => startEdit(selectedTask)} style={{ padding: "10px 14px", borderRadius: 8, background: "rgba(99,102,241,0.1)", border: "1px solid rgba(99,102,241,0.3)", color: "#818cf8", fontWeight: 700, fontSize: 13, cursor: "pointer" }}>
                      Modifica
                    </button>
                  </div>

                  {/* Ticket history */}
                  <div>
                    <div style={{ fontSize: 11, color: "var(--text-muted)", textTransform: "uppercase", fontWeight: 700, marginBottom: 10, letterSpacing: "0.08em" }}>Storico Ticket</div>
                    {ticketsLoading ? (
                      <div style={{ fontSize: 12, color: "var(--text-muted)" }}>Caricamento...</div>
                    ) : taskTickets.length === 0 ? (
                      <div style={{ fontSize: 12, color: "var(--text-muted)", padding: "12px", background: "rgba(255,255,255,0.02)", border: "1px dashed var(--border)", borderRadius: 8, textAlign: "center" }}>
                        Nessun ticket generato per questo task.
                      </div>
                    ) : (
                      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                        {taskTickets.map(t => (
                          <div key={t.id} style={{ padding: "10px 12px", background: "var(--bg-elevated)", border: "1px solid var(--border)", borderRadius: 8 }}>
                            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4 }}>
                              <span style={{ fontSize: 12, fontWeight: 600 }}>#{t.id} — {t.titolo}</span>
                              <span style={{
                                fontSize: 10, padding: "1px 6px", borderRadius: 4, fontWeight: 700,
                                color: t.stato === "Chiuso" ? "#6b7280" : t.stato === "In corso" ? "#60a5fa" : t.stato === "Pianificato" ? "#818cf8" : "#fbbf24",
                                background: t.stato === "Chiuso" ? "rgba(107,114,128,0.1)" : "rgba(251,191,36,0.08)",
                                border: "1px solid rgba(255,255,255,0.1)",
                              }}>
                                {t.stato}
                              </span>
                            </div>
                            <div style={{ fontSize: 11, color: "var(--text-muted)", display: "flex", gap: 10 }}>
                              <span>{t.durata_stimata_ore}h</span>
                              {t.created_at && <span>creato {formatDate(t.created_at)}</span>}
                              {t.planned_start && <span>pianificato {formatDate(t.planned_start)}</span>}
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </>
              )}
            </div>
          </>
        ) : (
          <div style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", color: "var(--text-muted)", fontSize: 14, padding: 32, textAlign: "center" }}>
            <div style={{ fontSize: 32, marginBottom: 12, opacity: 0.3 }}>◩</div>
            Seleziona un task per vederne i dettagli, modificarlo o generare un ticket.
          </div>
        )}
      </div>

      {/* Delete confirm modal */}
      {confirmDelId !== null && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.7)", zIndex: 1000, display: "flex", alignItems: "center", justifyContent: "center", backdropFilter: "blur(4px)" }} onClick={() => setConfirmDelId(null)}>
          <div style={{ background: "var(--bg-surface)", border: "1px solid rgba(248,113,113,0.25)", borderRadius: 14, padding: "28px", width: 420, boxShadow: "0 24px 64px rgba(0,0,0,0.5)" }} onClick={e => e.stopPropagation()}>
            <div style={{ fontSize: 20, marginBottom: 12 }}>⚠️</div>
            <h2 style={{ margin: "0 0 10px", fontSize: 16, fontWeight: 800 }}>Elimina task</h2>
            <p style={{ color: "var(--text-secondary)", fontSize: 13, marginBottom: 22, lineHeight: 1.6 }}>
              Il task verrà eliminato. I ticket già generati verranno scollegati ma non eliminati.
            </p>
            <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
              <button onClick={() => setConfirmDelId(null)} style={{ background: "transparent", border: "1px solid var(--border)", color: "var(--text-primary)", padding: "8px 16px", borderRadius: 8, cursor: "pointer", fontSize: 13 }}>Annulla</button>
              <button onClick={() => deleteTask(confirmDelId)} style={{ background: "rgba(248,113,113,0.15)", border: "1px solid rgba(248,113,113,0.4)", color: "#f87171", padding: "8px 16px", borderRadius: 8, cursor: "pointer", fontWeight: 700, fontSize: 13 }}>Elimina</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
