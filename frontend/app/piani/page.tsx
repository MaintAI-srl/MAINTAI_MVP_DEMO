"use client";

import { useEffect, useState, useCallback } from "react";
import { apiGet, apiPost, apiPut, apiDelete } from "../lib/api";
import { notify } from "@/lib/toast";

// ─── Tipi ────────────────────────────────────────────────────────────────────

type AssetOption = { id: number; nome: string };

type Piano = {
  id: number;
  nome_codificato: string;
  progressivo: number;
  descrizione: string | null;
  stato: string;
  asset_id: number | null;
  asset_nome: string;
  task_count: number;
  open_ticket_count: number;
  created_at: string | null;
  updated_at: string | null;
};

type Task = {
  id: number;
  piano_id: number | null;
  asset_id: number | null;
  asset_nome: string;
  nome: string | null;
  descrizione: string;
  frequenza_giorni: number | null;
  durata_ore: number | null;
  priorita: string;
  codice: string | null;
  is_repeatable: boolean;
  generation_mode: string;
  generate_days_before_due: number;
  task_stato: string;
  source_type: string | null;
  last_generated_at: string | null;
  next_due_at: string | null;
  open_ticket_count: number;
};

type TicketHistory = {
  id: number;
  titolo: string;
  stato: string;
  priorita: string;
  durata_stimata_ore: number;
  origin_type: string | null;
  created_at: string | null;
  planned_start: string | null;
  planned_finish: string | null;
  tecnico_id: number | null;
};

// ─── Helpers ─────────────────────────────────────────────────────────────────

function fmt(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("it-IT", { day: "2-digit", month: "short", year: "numeric" });
}

function isOverdue(iso: string | null): boolean {
  if (!iso) return false;
  return new Date(iso) < new Date();
}

function prioritaStyle(p: string): React.CSSProperties {
  switch (p?.toLowerCase()) {
    case "alta":  return { color: "#f87171", background: "rgba(248,113,113,0.1)", border: "1px solid rgba(248,113,113,0.3)" };
    case "media": return { color: "#fbbf24", background: "rgba(251,191,36,0.1)", border: "1px solid rgba(251,191,36,0.3)" };
    case "bassa": return { color: "#34d399", background: "rgba(52,211,153,0.1)", border: "1px solid rgba(52,211,153,0.3)" };
    default:      return { color: "var(--text-secondary)", background: "rgba(156,163,175,0.1)", border: "1px solid rgba(156,163,175,0.3)" };
  }
}

function statoTaskLabel(s: string) {
  return s === "active" ? "Attivo" : s === "paused" ? "In pausa" : s === "archived" ? "Archiviato" : s;
}

function statoTicketStyle(s: string): React.CSSProperties {
  switch (s) {
    case "Aperto":     return { color: "#60a5fa", background: "rgba(96,165,250,0.1)", border: "1px solid rgba(96,165,250,0.3)" };
    case "Pianificato": return { color: "#a78bfa", background: "rgba(167,139,250,0.1)", border: "1px solid rgba(167,139,250,0.3)" };
    case "In corso":   return { color: "#fbbf24", background: "rgba(251,191,36,0.1)", border: "1px solid rgba(251,191,36,0.3)" };
    case "Chiuso":     return { color: "#34d399", background: "rgba(52,211,153,0.1)", border: "1px solid rgba(52,211,153,0.3)" };
    default:           return { color: "#6b7280", background: "rgba(107,114,128,0.1)", border: "1px solid rgba(107,114,128,0.3)" };
  }
}

function Badge({ label, style }: { label: string; style?: React.CSSProperties }) {
  return (
    <span style={{ fontSize: 11, fontWeight: 600, padding: "2px 7px", borderRadius: 4, ...style }}>
      {label}
    </span>
  );
}

// ─── Modal: Crea Piano ────────────────────────────────────────────────────────

function CreaPianoModal({ assets, onClose, onCreated }: {
  assets: AssetOption[];
  onClose: () => void;
  onCreated: (piano: Piano) => void;
}) {
  const [form, setForm] = useState({ asset_id: "", nome_codificato: "", descrizione: "" });
  const [saving, setSaving] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.asset_id) { notify.error("Seleziona un asset"); return; }
    setSaving(true);
    try {
      const body: Record<string, unknown> = { asset_id: Number(form.asset_id) };
      if (form.nome_codificato.trim()) body.nome_codificato = form.nome_codificato.trim();
      if (form.descrizione.trim()) body.descrizione = form.descrizione.trim();
      const piano = await apiPost<Piano>("/piani-manutenzione", body);
      notify.success(`Piano ${piano.nome_codificato} creato`);
      onCreated(piano);
    } catch (err: unknown) {
      notify.error(err instanceof Error ? err.message : "Errore creazione piano");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.7)", zIndex: 9999, display: "flex", alignItems: "center", justifyContent: "center" }}>
      <div style={{ background: "#111827", border: "1px solid rgba(75,85,99,0.5)", borderRadius: 12, padding: 28, width: 440, maxWidth: "95vw" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}>
          <h3 style={{ margin: 0, fontSize: 16, fontWeight: 700, color: "var(--text-primary)" }}>Nuovo Piano di Manutenzione</h3>
          <button onClick={onClose} style={{ background: "none", border: "none", color: "var(--text-secondary)", cursor: "pointer", fontSize: 20, lineHeight: 1 }}>×</button>
        </div>
        <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          <div>
            <label style={{ fontSize: 12, color: "var(--text-secondary)", display: "block", marginBottom: 4 }}>Asset *</label>
            <select
              required
              value={form.asset_id}
              onChange={e => setForm(f => ({ ...f, asset_id: e.target.value }))}
              style={{ width: "100%", background: "#1f2937", border: "1px solid rgba(75,85,99,0.5)", color: "var(--text-primary)", borderRadius: 6, padding: "7px 10px", fontSize: 14 }}
            >
              <option value="">— Seleziona asset —</option>
              {assets.map(a => <option key={a.id} value={a.id}>{a.nome}</option>)}
            </select>
          </div>
          <div>
            <label style={{ fontSize: 12, color: "var(--text-secondary)", display: "block", marginBottom: 4 }}>Codice piano (auto-generato se vuoto)</label>
            <input
              value={form.nome_codificato}
              onChange={e => setForm(f => ({ ...f, nome_codificato: e.target.value }))}
              placeholder="es. PM-2026-001"
              style={{ width: "100%", background: "#1f2937", border: "1px solid rgba(75,85,99,0.5)", color: "var(--text-primary)", borderRadius: 6, padding: "7px 10px", fontSize: 14, boxSizing: "border-box" }}
            />
          </div>
          <div>
            <label style={{ fontSize: 12, color: "var(--text-secondary)", display: "block", marginBottom: 4 }}>Descrizione</label>
            <textarea
              value={form.descrizione}
              onChange={e => setForm(f => ({ ...f, descrizione: e.target.value }))}
              rows={2}
              style={{ width: "100%", background: "#1f2937", border: "1px solid rgba(75,85,99,0.5)", color: "var(--text-primary)", borderRadius: 6, padding: "7px 10px", fontSize: 14, resize: "vertical", boxSizing: "border-box" }}
            />
          </div>
          <div style={{ display: "flex", gap: 10, justifyContent: "flex-end", marginTop: 4 }}>
            <button type="button" onClick={onClose} style={{ padding: "7px 16px", background: "transparent", border: "1px solid rgba(75,85,99,0.5)", color: "var(--text-secondary)", borderRadius: 6, cursor: "pointer", fontSize: 13 }}>Annulla</button>
            <button type="submit" disabled={saving} style={{ padding: "7px 18px", background: "#6366f1", border: "none", color: "#fff", borderRadius: 6, cursor: saving ? "not-allowed" : "pointer", fontSize: 13, fontWeight: 600 }}>
              {saving ? "Salvataggio..." : "Crea Piano"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ─── Modal: Crea Task ─────────────────────────────────────────────────────────

function CreaTaskModal({ pianoId, onClose, onCreated }: {
  pianoId: number;
  onClose: () => void;
  onCreated: (task: Task) => void;
}) {
  const [form, setForm] = useState({
    descrizione: "",
    nome: "",
    frequenza_giorni: "",
    durata_ore: "",
    priorita: "Media",
    codice: "",
    is_repeatable: true,
    generation_mode: "manual",
  });
  const [saving, setSaving] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.descrizione.trim()) { notify.error("La descrizione è obbligatoria"); return; }
    setSaving(true);
    try {
      const body: Record<string, unknown> = {
        descrizione: form.descrizione.trim(),
        priorita: form.priorita,
        is_repeatable: form.is_repeatable,
        generation_mode: form.generation_mode,
      };
      if (form.nome.trim()) body.nome = form.nome.trim();
      if (form.codice.trim()) body.codice = form.codice.trim();
      if (form.frequenza_giorni) body.frequenza_giorni = Number(form.frequenza_giorni);
      if (form.durata_ore) body.durata_ore = Number(form.durata_ore);
      const task = await apiPost<Task>(`/piani-manutenzione/${pianoId}/tasks`, body);
      notify.success("Task creato");
      onCreated(task);
    } catch (err: unknown) {
      notify.error(err instanceof Error ? err.message : "Errore creazione task");
    } finally {
      setSaving(false);
    }
  }

  const inp: React.CSSProperties = { width: "100%", background: "#1f2937", border: "1px solid rgba(75,85,99,0.5)", color: "var(--text-primary)", borderRadius: 6, padding: "7px 10px", fontSize: 14, boxSizing: "border-box" };

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.7)", zIndex: 9999, display: "flex", alignItems: "center", justifyContent: "center" }}>
      <div style={{ background: "#111827", border: "1px solid rgba(75,85,99,0.5)", borderRadius: 12, padding: 28, width: 480, maxWidth: "95vw", maxHeight: "90vh", overflowY: "auto" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}>
          <h3 style={{ margin: 0, fontSize: 16, fontWeight: 700, color: "var(--text-primary)" }}>Nuovo Task di Manutenzione</h3>
          <button onClick={onClose} style={{ background: "none", border: "none", color: "var(--text-secondary)", cursor: "pointer", fontSize: 20, lineHeight: 1 }}>×</button>
        </div>
        <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <div>
            <label style={{ fontSize: 12, color: "var(--text-secondary)", display: "block", marginBottom: 4 }}>Descrizione *</label>
            <textarea required value={form.descrizione} onChange={e => setForm(f => ({ ...f, descrizione: e.target.value }))} rows={3} style={inp} />
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
            <div>
              <label style={{ fontSize: 12, color: "var(--text-secondary)", display: "block", marginBottom: 4 }}>Nome breve</label>
              <input value={form.nome} onChange={e => setForm(f => ({ ...f, nome: e.target.value }))} style={inp} placeholder="es. Ispezione filtri" />
            </div>
            <div>
              <label style={{ fontSize: 12, color: "var(--text-secondary)", display: "block", marginBottom: 4 }}>Codice</label>
              <input value={form.codice} onChange={e => setForm(f => ({ ...f, codice: e.target.value }))} style={inp} placeholder="es. T-001" />
            </div>
            <div>
              <label style={{ fontSize: 12, color: "var(--text-secondary)", display: "block", marginBottom: 4 }}>Frequenza (giorni)</label>
              <input type="number" min={1} value={form.frequenza_giorni} onChange={e => setForm(f => ({ ...f, frequenza_giorni: e.target.value }))} style={inp} placeholder="es. 90" />
            </div>
            <div>
              <label style={{ fontSize: 12, color: "var(--text-secondary)", display: "block", marginBottom: 4 }}>Durata (ore)</label>
              <input type="number" min={0.25} step={0.25} value={form.durata_ore} onChange={e => setForm(f => ({ ...f, durata_ore: e.target.value }))} style={inp} placeholder="es. 2" />
            </div>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
            <div>
              <label style={{ fontSize: 12, color: "var(--text-secondary)", display: "block", marginBottom: 4 }}>Priorità</label>
              <select value={form.priorita} onChange={e => setForm(f => ({ ...f, priorita: e.target.value }))} style={inp}>
                <option>Alta</option>
                <option>Media</option>
                <option>Bassa</option>
              </select>
            </div>
            <div>
              <label style={{ fontSize: 12, color: "var(--text-secondary)", display: "block", marginBottom: 4 }}>Generazione ticket</label>
              <select value={form.generation_mode} onChange={e => setForm(f => ({ ...f, generation_mode: e.target.value }))} style={inp}>
                <option value="manual">Manuale</option>
                <option value="auto">Automatica</option>
                <option value="disabled">Disabilitata</option>
              </select>
            </div>
          </div>
          <label style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer", fontSize: 13, color: "var(--text-secondary)" }}>
            <input type="checkbox" checked={form.is_repeatable} onChange={e => setForm(f => ({ ...f, is_repeatable: e.target.checked }))} />
            Task ricorrente (si ripete dopo ogni ciclo)
          </label>
          <div style={{ display: "flex", gap: 10, justifyContent: "flex-end", marginTop: 6 }}>
            <button type="button" onClick={onClose} style={{ padding: "7px 16px", background: "transparent", border: "1px solid rgba(75,85,99,0.5)", color: "var(--text-secondary)", borderRadius: 6, cursor: "pointer", fontSize: 13 }}>Annulla</button>
            <button type="submit" disabled={saving} style={{ padding: "7px 18px", background: "#6366f1", border: "none", color: "#fff", borderRadius: 6, cursor: saving ? "not-allowed" : "pointer", fontSize: 13, fontWeight: 600 }}>
              {saving ? "Salvataggio..." : "Crea Task"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ─── Pannello Dettaglio Task ──────────────────────────────────────────────────

function TaskDetailPanel({ task, pianoId, onTicketGenerated, onClose }: {
  task: Task;
  pianoId: number;
  onTicketGenerated: () => void;
  onClose: () => void;
}) {
  const [tickets, setTickets] = useState<TicketHistory[]>([]);
  const [loadingTickets, setLoadingTickets] = useState(false);
  const [generating, setGenerating] = useState(false);

  const fetchTickets = useCallback(async () => {
    setLoadingTickets(true);
    try {
      const data = await apiGet<TicketHistory[]>(`/piani-manutenzione/${pianoId}/tasks/${task.id}/tickets`);
      setTickets(Array.isArray(data) ? data : []);
    } catch {
      setTickets([]);
    } finally {
      setLoadingTickets(false);
    }
  }, [pianoId, task.id]);

  useEffect(() => { fetchTickets(); }, [fetchTickets]);

  async function handleGeneraTicket() {
    setGenerating(true);
    try {
      const res = await apiPost<{ created: number; ticket_ids: number[] }>(`/piani-manutenzione/${pianoId}/tasks/${task.id}/genera-ticket`, {});
      notify.success(`${res.created} ticket generati (ID: ${res.ticket_ids.join(", ")})`);
      onTicketGenerated();
      fetchTickets();
    } catch (err: unknown) {
      notify.error(err instanceof Error ? err.message : "Errore generazione ticket");
    } finally {
      setGenerating(false);
    }
  }

  return (
    <div style={{ background: "#0f1729", border: "1px solid rgba(75,85,99,0.4)", borderRadius: 10, padding: 20, display: "flex", flexDirection: "column", gap: 16, height: "100%", overflowY: "auto" }}>
      {/* Header */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
        <div>
          <div style={{ fontSize: 12, color: "var(--text-muted)", marginBottom: 3 }}>Dettaglio Task</div>
          <div style={{ fontSize: 15, fontWeight: 700, color: "var(--text-primary)" }}>{task.nome || task.descrizione}</div>
        </div>
        <button onClick={onClose} style={{ background: "none", border: "none", color: "var(--text-secondary)", cursor: "pointer", fontSize: 18, lineHeight: 1, padding: "2px 6px" }}>×</button>
      </div>

      {/* Metadati */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
        {[
          ["Priorità", <Badge key="p" label={task.priorita} style={prioritaStyle(task.priorita)} />],
          ["Stato", <Badge key="s" label={statoTaskLabel(task.task_stato)} style={task.task_stato === "active" ? { color: "#34d399", background: "rgba(52,211,153,0.1)", border: "1px solid rgba(52,211,153,0.3)" } : { color: "#fbbf24", background: "rgba(251,191,36,0.1)", border: "1px solid rgba(251,191,36,0.3)" }} />],
          ["Frequenza", task.frequenza_giorni ? `ogni ${task.frequenza_giorni} giorni` : "—"],
          ["Durata", task.durata_ore ? `${task.durata_ore}h` : "—"],
          ["Generazione", task.generation_mode === "manual" ? "Manuale" : task.generation_mode === "auto" ? "Automatica" : "Disabilitata"],
          ["Ricorrente", task.is_repeatable ? "Sì" : "No"],
          ["Ultimo ticket", fmt(task.last_generated_at)],
          ["Prossima scadenza", <span key="nd" style={isOverdue(task.next_due_at) ? { color: "#f87171", fontWeight: 700 } : {}}>{fmt(task.next_due_at)}</span>],
        ].map(([label, value], i) => (
          <div key={i} style={{ background: "rgba(255,255,255,0.03)", borderRadius: 6, padding: "8px 10px" }}>
            <div style={{ fontSize: 10, color: "var(--text-muted)", marginBottom: 3, textTransform: "uppercase", letterSpacing: "0.05em" }}>{label}</div>
            <div style={{ fontSize: 13, color: "var(--text-primary)" }}>{value}</div>
          </div>
        ))}
      </div>

      {task.descrizione && (
        <div style={{ background: "rgba(255,255,255,0.03)", borderRadius: 6, padding: "10px 12px" }}>
          <div style={{ fontSize: 10, color: "var(--text-muted)", marginBottom: 4, textTransform: "uppercase", letterSpacing: "0.05em" }}>Descrizione</div>
          <div style={{ fontSize: 13, color: "var(--text-secondary)", lineHeight: 1.5 }}>{task.descrizione}</div>
        </div>
      )}

      {/* CTA Genera Ticket */}
      <button
        onClick={handleGeneraTicket}
        disabled={generating || task.task_stato !== "active" || task.generation_mode === "disabled"}
        style={{
          padding: "9px 16px",
          background: task.task_stato === "active" && task.generation_mode !== "disabled" ? "#6366f1" : "rgba(75,85,99,0.3)",
          border: "none",
          color: "#fff",
          borderRadius: 7,
          cursor: generating || task.task_stato !== "active" || task.generation_mode === "disabled" ? "not-allowed" : "pointer",
          fontWeight: 600,
          fontSize: 13,
          width: "100%",
        }}
      >
        {generating ? "Generazione in corso..." : task.open_ticket_count > 0 ? `Genera Ticket (${task.open_ticket_count} attivi)` : "Genera Ticket"}
      </button>
      {task.open_ticket_count > 0 && (
        <div style={{ fontSize: 11, color: "#fbbf24", marginTop: -10, textAlign: "center" }}>
          Attenzione: esiste già un ticket attivo per questo task
        </div>
      )}

      {/* Storico Ticket */}
      <div>
        <div style={{ fontSize: 12, fontWeight: 600, color: "var(--text-secondary)", marginBottom: 8, textTransform: "uppercase", letterSpacing: "0.05em" }}>
          Storico Ticket {loadingTickets ? "(caricamento...)" : `(${tickets.length})`}
        </div>
        {tickets.length === 0 && !loadingTickets && (
          <div style={{ fontSize: 12, color: "var(--text-muted)", padding: "12px 0", textAlign: "center" }}>Nessun ticket generato da questo task</div>
        )}
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          {tickets.map(t => (
            <div key={t.id} style={{ background: "rgba(255,255,255,0.04)", borderRadius: 7, padding: "9px 12px", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 12, color: "var(--text-primary)", fontWeight: 600, marginBottom: 2, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>#{t.id} {t.titolo}</div>
                <div style={{ fontSize: 11, color: "var(--text-muted)" }}>{fmt(t.created_at)}{t.planned_start ? ` · pianif. ${fmt(t.planned_start)}` : ""}</div>
              </div>
              <Badge label={t.stato} style={statoTicketStyle(t.stato)} />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ─── Pagina Principale ────────────────────────────────────────────────────────

export default function PianiPage() {
  const [piani, setPiani] = useState<Piano[]>([]);
  const [loadingPiani, setLoadingPiani] = useState(true);
  const [selectedPiano, setSelectedPiano] = useState<Piano | null>(null);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [loadingTasks, setLoadingTasks] = useState(false);
  const [selectedTask, setSelectedTask] = useState<Task | null>(null);
  const [assets, setAssets] = useState<AssetOption[]>([]);

  const [showCreaPiano, setShowCreaPiano] = useState(false);
  const [showCreaTask, setShowCreaTask] = useState(false);

  // Filtri piani
  const [filterStato, setFilterStato] = useState("");

  // Fetch piani
  const fetchPiani = useCallback(async () => {
    setLoadingPiani(true);
    try {
      const params = new URLSearchParams({ limit: "100" });
      if (filterStato) params.set("stato", filterStato);
      const data = await apiGet<{ items: Piano[] }>(`/piani-manutenzione?${params}`);
      setPiani(data.items || []);
    } catch {
      notify.error("Errore caricamento piani");
    } finally {
      setLoadingPiani(false);
    }
  }, [filterStato]);

  // Fetch asset per il modal di creazione piano
  const fetchAssets = useCallback(async () => {
    try {
      const data = await apiGet<{ items: AssetOption[] }>("/assets?limit=200");
      setAssets(data.items || []);
    } catch {
      setAssets([]);
    }
  }, []);

  // Fetch task del piano selezionato
  const fetchTasks = useCallback(async (pianoId: number) => {
    setLoadingTasks(true);
    setSelectedTask(null);
    try {
      const data = await apiGet<{ items: Task[] }>(`/piani-manutenzione/${pianoId}/tasks?limit=200`);
      setTasks(data.items || []);
    } catch {
      notify.error("Errore caricamento task");
      setTasks([]);
    } finally {
      setLoadingTasks(false);
    }
  }, []);

  useEffect(() => { fetchPiani(); fetchAssets(); }, [fetchPiani, fetchAssets]);

  function selectPiano(piano: Piano) {
    setSelectedPiano(piano);
    fetchTasks(piano.id);
  }

  function handlePianoCreated(piano: Piano) {
    setPiani(prev => [{ ...piano, task_count: 0, open_ticket_count: 0 }, ...prev]);
    setShowCreaPiano(false);
    selectPiano({ ...piano, task_count: 0, open_ticket_count: 0 });
  }

  function handleTaskCreated(task: Task) {
    setTasks(prev => [task, ...prev]);
    setShowCreaTask(false);
    setPiani(prev => prev.map(p => p.id === selectedPiano?.id ? { ...p, task_count: p.task_count + 1 } : p));
  }

  function handleTicketGenerated() {
    if (selectedPiano) {
      fetchTasks(selectedPiano.id);
      setPiani(prev => prev.map(p => p.id === selectedPiano.id ? { ...p, open_ticket_count: p.open_ticket_count + 1 } : p));
    }
  }

  async function handleDeletePiano(pianoId: number, nome: string) {
    if (!confirm(`Eliminare il piano ${nome}? I task saranno eliminati, i ticket saranno scollegati.`)) return;
    try {
      await apiDelete(`/piani-manutenzione/${pianoId}`);
      setPiani(prev => prev.filter(p => p.id !== pianoId));
      if (selectedPiano?.id === pianoId) { setSelectedPiano(null); setTasks([]); setSelectedTask(null); }
      notify.success("Piano eliminato");
    } catch (err: unknown) {
      notify.error(err instanceof Error ? err.message : "Errore eliminazione piano");
    }
  }

  async function handleDeleteTask(taskId: number) {
    if (!selectedPiano) return;
    if (!confirm("Eliminare questo task?")) return;
    try {
      await apiDelete(`/piani-manutenzione/${selectedPiano.id}/tasks/${taskId}`);
      setTasks(prev => prev.filter(t => t.id !== taskId));
      if (selectedTask?.id === taskId) setSelectedTask(null);
      setPiani(prev => prev.map(p => p.id === selectedPiano.id ? { ...p, task_count: Math.max(0, p.task_count - 1) } : p));
      notify.success("Task eliminato");
    } catch (err: unknown) {
      notify.error(err instanceof Error ? err.message : "Errore eliminazione task");
    }
  }

  // ─── Layout ─────────────────────────────────────────────────────────────────

  const card: React.CSSProperties = { background: "#111827", borderRadius: 10, border: "1px solid rgba(75,85,99,0.4)" };
  const sectionHead: React.CSSProperties = { padding: "14px 16px", borderBottom: "1px solid rgba(75,85,99,0.3)", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 };
  const btnPrimary: React.CSSProperties = { padding: "5px 12px", background: "#6366f1", border: "none", color: "#fff", borderRadius: 6, cursor: "pointer", fontSize: 12, fontWeight: 600, whiteSpace: "nowrap" };
  const btnIcon: React.CSSProperties = { padding: "4px 8px", background: "transparent", border: "1px solid rgba(75,85,99,0.4)", color: "var(--text-secondary)", borderRadius: 5, cursor: "pointer", fontSize: 12 };

  return (
    <div style={{ padding: "20px 24px", height: "calc(100vh - 64px)", display: "flex", flexDirection: "column", gap: 0, fontFamily: "inherit" }}>
      {/* Header pagina */}
      <div style={{ marginBottom: 16 }}>
        <h1 style={{ fontSize: 20, fontWeight: 700, color: "var(--text-primary)", margin: 0 }}>Piani di Manutenzione</h1>
        <div style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 3 }}>Gerarchia: Asset → Piano → Task → Ticket</div>
      </div>

      {/* Corpo a 3 colonne */}
      <div style={{ flex: 1, display: "grid", gridTemplateColumns: "280px 1fr 320px", gap: 12, minHeight: 0 }}>

        {/* ── COLONNA SINISTRA: Lista Piani ─────────────────────────────────── */}
        <div style={{ ...card, display: "flex", flexDirection: "column", minHeight: 0 }}>
          <div style={sectionHead}>
            <div style={{ fontSize: 13, fontWeight: 700, color: "var(--text-primary)" }}>Piani ({piani.length})</div>
            <button style={btnPrimary} onClick={() => setShowCreaPiano(true)}>+ Nuovo</button>
          </div>
          <div style={{ padding: "8px", borderBottom: "1px solid rgba(75,85,99,0.2)" }}>
            <select value={filterStato} onChange={e => setFilterStato(e.target.value)} style={{ width: "100%", background: "#1f2937", border: "1px solid rgba(75,85,99,0.4)", color: "var(--text-secondary)", borderRadius: 5, padding: "4px 8px", fontSize: 12 }}>
              <option value="">Tutti gli stati</option>
              <option value="attivo">Attivo</option>
              <option value="sospeso">Sospeso</option>
              <option value="archiviato">Archiviato</option>
            </select>
          </div>
          <div style={{ flex: 1, overflowY: "auto", padding: 8 }}>
            {loadingPiani ? (
              <div style={{ color: "var(--text-muted)", fontSize: 12, padding: 16, textAlign: "center" }}>Caricamento...</div>
            ) : piani.length === 0 ? (
              <div style={{ color: "var(--text-muted)", fontSize: 12, padding: 16, textAlign: "center" }}>
                Nessun piano. Crea il primo piano per iniziare.
              </div>
            ) : (
              piani.map(piano => (
                <div
                  key={piano.id}
                  onClick={() => selectPiano(piano)}
                  style={{
                    padding: "10px 12px",
                    borderRadius: 7,
                    cursor: "pointer",
                    background: selectedPiano?.id === piano.id ? "rgba(99,102,241,0.15)" : "transparent",
                    border: selectedPiano?.id === piano.id ? "1px solid rgba(99,102,241,0.4)" : "1px solid transparent",
                    marginBottom: 4,
                    transition: "background 0.15s",
                  }}
                >
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 12, fontWeight: 700, color: "var(--text-primary)", marginBottom: 2 }}>{piano.nome_codificato}</div>
                      <div style={{ fontSize: 11, color: "var(--text-muted)", marginBottom: 5, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{piano.asset_nome || "—"}</div>
                      <div style={{ display: "flex", gap: 6 }}>
                        <span style={{ fontSize: 10, color: "var(--text-secondary)", background: "rgba(255,255,255,0.05)", padding: "2px 6px", borderRadius: 4 }}>{piano.task_count} task</span>
                        {piano.open_ticket_count > 0 && (
                          <span style={{ fontSize: 10, color: "#60a5fa", background: "rgba(96,165,250,0.1)", padding: "2px 6px", borderRadius: 4, border: "1px solid rgba(96,165,250,0.2)" }}>{piano.open_ticket_count} ticket</span>
                        )}
                      </div>
                    </div>
                    <button
                      onClick={e => { e.stopPropagation(); handleDeletePiano(piano.id, piano.nome_codificato); }}
                      style={{ ...btnIcon, color: "#f87171", borderColor: "rgba(248,113,113,0.3)", padding: "2px 6px", fontSize: 11, marginLeft: 4 }}
                      title="Elimina piano"
                    >
                      ✕
                    </button>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>

        {/* ── COLONNA CENTRALE: Lista Task del Piano Selezionato ──────────────── */}
        <div style={{ ...card, display: "flex", flexDirection: "column", minHeight: 0 }}>
          {!selectedPiano ? (
            <div style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", color: "var(--text-muted)" }}>
              <div style={{ fontSize: 40, marginBottom: 12, opacity: 0.3 }}>📋</div>
              <div style={{ fontSize: 14 }}>Seleziona un piano dalla lista</div>
              <div style={{ fontSize: 12, marginTop: 6 }}>per vedere i task di manutenzione</div>
            </div>
          ) : (
            <>
              {/* Header piano */}
              <div style={{ ...sectionHead, flexWrap: "wrap", gap: 8 }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 14, fontWeight: 700, color: "var(--text-primary)" }}>{selectedPiano.nome_codificato}</div>
                  <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 1 }}>
                    Asset: {selectedPiano.asset_nome || "—"} · {selectedPiano.task_count} task · {selectedPiano.open_ticket_count} ticket aperti
                    {selectedPiano.descrizione && ` · ${selectedPiano.descrizione}`}
                  </div>
                </div>
                <div style={{ display: "flex", gap: 6 }}>
                  <button style={btnIcon} onClick={() => selectedPiano && fetchTasks(selectedPiano.id)} title="Aggiorna">↻</button>
                  <button style={btnPrimary} onClick={() => setShowCreaTask(true)}>+ Task</button>
                </div>
              </div>

              {/* Lista task */}
              <div style={{ flex: 1, overflowY: "auto" }}>
                {loadingTasks ? (
                  <div style={{ color: "var(--text-muted)", fontSize: 12, padding: 20, textAlign: "center" }}>Caricamento task...</div>
                ) : tasks.length === 0 ? (
                  <div style={{ color: "var(--text-muted)", fontSize: 12, padding: 24, textAlign: "center" }}>
                    Nessun task in questo piano. Aggiungi il primo task.
                  </div>
                ) : (
                  <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
                    <thead>
                      <tr style={{ borderBottom: "1px solid rgba(75,85,99,0.3)" }}>
                        {["Codice", "Nome / Descrizione", "Frequenza", "Durata", "Priorità", "Stato", "Prossima Scadenza", ""].map(h => (
                          <th key={h} style={{ padding: "8px 10px", textAlign: "left", color: "var(--text-muted)", fontWeight: 600, fontSize: 10, textTransform: "uppercase", letterSpacing: "0.05em", whiteSpace: "nowrap" }}>{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {tasks.map(task => (
                        <tr
                          key={task.id}
                          onClick={() => setSelectedTask(task)}
                          style={{
                            borderBottom: "1px solid rgba(75,85,99,0.15)",
                            cursor: "pointer",
                            background: selectedTask?.id === task.id ? "rgba(99,102,241,0.08)" : "transparent",
                            transition: "background 0.1s",
                          }}
                        >
                          <td style={{ padding: "9px 10px", color: "var(--text-muted)", whiteSpace: "nowrap" }}>{task.codice || `#${task.id}`}</td>
                          <td style={{ padding: "9px 10px", maxWidth: 200 }}>
                            <div style={{ color: "var(--text-primary)", fontWeight: 600, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{task.nome || task.descrizione}</div>
                            {task.nome && task.descrizione !== task.nome && (
                              <div style={{ color: "var(--text-muted)", fontSize: 11, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{task.descrizione}</div>
                            )}
                          </td>
                          <td style={{ padding: "9px 10px", color: "var(--text-secondary)", whiteSpace: "nowrap" }}>{task.frequenza_giorni ? `${task.frequenza_giorni}g` : "—"}</td>
                          <td style={{ padding: "9px 10px", color: "var(--text-secondary)", whiteSpace: "nowrap" }}>{task.durata_ore ? `${task.durata_ore}h` : "—"}</td>
                          <td style={{ padding: "9px 10px" }}><Badge label={task.priorita} style={prioritaStyle(task.priorita)} /></td>
                          <td style={{ padding: "9px 10px" }}>
                            <Badge
                              label={statoTaskLabel(task.task_stato)}
                              style={task.task_stato === "active"
                                ? { color: "#34d399", background: "rgba(52,211,153,0.1)", border: "1px solid rgba(52,211,153,0.3)" }
                                : { color: "#fbbf24", background: "rgba(251,191,36,0.1)", border: "1px solid rgba(251,191,36,0.3)" }}
                            />
                          </td>
                          <td style={{ padding: "9px 10px", whiteSpace: "nowrap" }}>
                            <span style={isOverdue(task.next_due_at) ? { color: "#f87171", fontWeight: 700 } : { color: "var(--text-secondary)" }}>
                              {fmt(task.next_due_at)}
                            </span>
                          </td>
                          <td style={{ padding: "9px 8px", whiteSpace: "nowrap" }}>
                            {task.open_ticket_count > 0 && (
                              <span title="Ticket attivi" style={{ fontSize: 10, color: "#60a5fa", background: "rgba(96,165,250,0.1)", padding: "2px 5px", borderRadius: 4, border: "1px solid rgba(96,165,250,0.2)", marginRight: 4 }}>{task.open_ticket_count}</span>
                            )}
                            <button
                              onClick={e => { e.stopPropagation(); handleDeleteTask(task.id); }}
                              style={{ ...btnIcon, color: "#f87171", borderColor: "rgba(248,113,113,0.3)", padding: "2px 6px", fontSize: 11 }}
                              title="Elimina task"
                            >
                              ✕
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            </>
          )}
        </div>

        {/* ── COLONNA DESTRA: Dettaglio Task ─────────────────────────────────── */}
        <div style={{ minHeight: 0, overflow: "hidden" }}>
          {selectedTask && selectedPiano ? (
            <TaskDetailPanel
              task={selectedTask}
              pianoId={selectedPiano.id}
              onTicketGenerated={handleTicketGenerated}
              onClose={() => setSelectedTask(null)}
            />
          ) : (
            <div style={{ ...card, height: "100%", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", color: "var(--text-muted)" }}>
              <div style={{ fontSize: 36, marginBottom: 12, opacity: 0.3 }}>🔧</div>
              <div style={{ fontSize: 13 }}>Seleziona un task</div>
              <div style={{ fontSize: 11, marginTop: 4 }}>per vedere dettagli e generare ticket</div>
            </div>
          )}
        </div>

      </div>

      {/* Modali */}
      {showCreaPiano && <CreaPianoModal assets={assets} onClose={() => setShowCreaPiano(false)} onCreated={handlePianoCreated} />}
      {showCreaTask && selectedPiano && <CreaTaskModal pianoId={selectedPiano.id} onClose={() => setShowCreaTask(false)} onCreated={handleTaskCreated} />}
    </div>
  );
}
