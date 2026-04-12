"use client";

import { useEffect, useState, useCallback } from "react";
import { apiGet, apiPost, apiDelete } from "../lib/api";
import { notify } from "@/lib/toast";

// ─── Tipi ─────────────────────────────────────────────────────────────────────

type AssetOption = { id: number; nome: string; name?: string; area?: string; sito_nome?: string };

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
};

type Task = {
  id: number;
  piano_id: number | null;
  asset_id: number | null;
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
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmt(iso: string | null) {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("it-IT", { day: "2-digit", month: "short", year: "numeric" });
}
function isOverdue(iso: string | null) {
  return !!iso && new Date(iso) < new Date();
}
function prioritaBadge(p: string): React.CSSProperties {
  if (p === "Alta")  return { color: "#f87171", background: "rgba(248,113,113,0.12)", border: "1px solid rgba(248,113,113,0.3)" };
  if (p === "Media") return { color: "#fbbf24", background: "rgba(251,191,36,0.12)", border: "1px solid rgba(251,191,36,0.3)" };
  return { color: "#34d399", background: "rgba(52,211,153,0.12)", border: "1px solid rgba(52,211,153,0.3)" };
}
function statoTaskBadge(s: string): React.CSSProperties {
  if (s === "active")   return { color: "#34d399", background: "rgba(52,211,153,0.12)", border: "1px solid rgba(52,211,153,0.3)" };
  if (s === "paused")   return { color: "#fbbf24", background: "rgba(251,191,36,0.12)", border: "1px solid rgba(251,191,36,0.3)" };
  return { color: "#6b7280", background: "rgba(107,114,128,0.12)", border: "1px solid rgba(107,114,128,0.3)" };
}
function statoTaskLabel(s: string) {
  return s === "active" ? "Attivo" : s === "paused" ? "In pausa" : "Archiviato";
}
function statoTicketBadge(s: string): React.CSSProperties {
  if (s === "Aperto")     return { color: "#60a5fa", background: "rgba(96,165,250,0.12)", border: "1px solid rgba(96,165,250,0.3)" };
  if (s === "Pianificato") return { color: "#a78bfa", background: "rgba(167,139,250,0.12)", border: "1px solid rgba(167,139,250,0.3)" };
  if (s === "In corso")   return { color: "#fbbf24", background: "rgba(251,191,36,0.12)", border: "1px solid rgba(251,191,36,0.3)" };
  if (s === "Chiuso")     return { color: "#34d399", background: "rgba(52,211,153,0.12)", border: "1px solid rgba(52,211,153,0.3)" };
  return { color: "#6b7280", background: "rgba(107,114,128,0.12)", border: "1px solid rgba(107,114,128,0.3)" };
}

function Chip({ label, style }: { label: string; style?: React.CSSProperties }) {
  return <span style={{ fontSize: 11, fontWeight: 600, padding: "2px 7px", borderRadius: 4, ...style }}>{label}</span>;
}

const S = {
  card: { background: "#111827", border: "1px solid rgba(75,85,99,0.4)", borderRadius: 10 } as React.CSSProperties,
  head: { padding: "12px 16px", borderBottom: "1px solid rgba(75,85,99,0.3)", display: "flex", alignItems: "center", gap: 10 } as React.CSSProperties,
  btnPrimary: { padding: "6px 14px", background: "#6366f1", border: "none", color: "#fff", borderRadius: 6, cursor: "pointer", fontSize: 12, fontWeight: 600 } as React.CSSProperties,
  btnGhost: { padding: "5px 10px", background: "transparent", border: "1px solid rgba(75,85,99,0.5)", color: "var(--text-secondary)", borderRadius: 6, cursor: "pointer", fontSize: 12 } as React.CSSProperties,
  btnDanger: { padding: "4px 8px", background: "transparent", border: "1px solid rgba(248,113,113,0.3)", color: "#f87171", borderRadius: 5, cursor: "pointer", fontSize: 11 } as React.CSSProperties,
  inp: { width: "100%", background: "#1f2937", border: "1px solid rgba(75,85,99,0.5)", color: "var(--text-primary)", borderRadius: 6, padding: "7px 10px", fontSize: 13, boxSizing: "border-box" as const },
};

// ─── Modal: Crea Piano ────────────────────────────────────────────────────────

function ModalCreaPiano({ assets, loadingAssets, onClose, onCreated }: {
  assets: AssetOption[];
  loadingAssets: boolean;
  onClose: () => void;
  onCreated: (p: Piano) => void;
}) {
  const [form, setForm] = useState({ asset_id: "", nome_codificato: "", descrizione: "" });
  const [saving, setSaving] = useState(false);

  async function submit(e: React.FormEvent) {
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
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.75)", zIndex: 9999, display: "flex", alignItems: "center", justifyContent: "center" }}>
      <div style={{ background: "#111827", border: "1px solid rgba(75,85,99,0.5)", borderRadius: 12, padding: 28, width: 440, maxWidth: "95vw" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}>
          <h3 style={{ margin: 0, fontSize: 15, fontWeight: 700, color: "var(--text-primary)" }}>Nuovo Piano di Manutenzione</h3>
          <button onClick={onClose} style={{ background: "none", border: "none", color: "var(--text-muted)", cursor: "pointer", fontSize: 20 }}>×</button>
        </div>
        <form onSubmit={submit} style={{ display: "flex", flexDirection: "column", gap: 14 }}>

          {/* Asset obbligatorio */}
          <div>
            <label style={{ fontSize: 12, color: "var(--text-secondary)", display: "block", marginBottom: 4 }}>
              Asset * <span style={{ color: "var(--text-muted)", fontWeight: 400 }}>(obbligatorio)</span>
            </label>
            {loadingAssets ? (
              <div style={{ ...S.inp, color: "var(--text-muted)", padding: "8px 10px" }}>Caricamento asset...</div>
            ) : assets.length === 0 ? (
              <div style={{ background: "rgba(251,191,36,0.08)", border: "1px solid rgba(251,191,36,0.3)", borderRadius: 6, padding: "10px 12px", fontSize: 12, color: "#fbbf24" }}>
                Nessun asset disponibile. <a href="/assets" style={{ color: "#818cf8", textDecoration: "underline" }}>Crea prima un asset nel modulo Siti &amp; Asset.</a>
              </div>
            ) : (
              <select
                required
                value={form.asset_id}
                onChange={e => setForm(f => ({ ...f, asset_id: e.target.value }))}
                style={{ ...S.inp }}
              >
                <option value="">— Seleziona asset —</option>
                {assets.map(a => (
                  <option key={a.id} value={a.id}>
                    {a.nome || a.name}{a.sito_nome ? ` · ${a.sito_nome}` : ""}{a.area ? ` · ${a.area}` : ""}
                  </option>
                ))}
              </select>
            )}
          </div>

          <div>
            <label style={{ fontSize: 12, color: "var(--text-secondary)", display: "block", marginBottom: 4 }}>Codice piano <span style={{ color: "var(--text-muted)", fontWeight: 400 }}>(auto se vuoto)</span></label>
            <input value={form.nome_codificato} onChange={e => setForm(f => ({ ...f, nome_codificato: e.target.value }))} placeholder="es. PM-2026-001" style={{ ...S.inp }} />
          </div>

          <div>
            <label style={{ fontSize: 12, color: "var(--text-secondary)", display: "block", marginBottom: 4 }}>Descrizione</label>
            <textarea value={form.descrizione} onChange={e => setForm(f => ({ ...f, descrizione: e.target.value }))} rows={2} style={{ ...S.inp, resize: "vertical" }} />
          </div>

          <div style={{ display: "flex", gap: 10, justifyContent: "flex-end", marginTop: 4 }}>
            <button type="button" onClick={onClose} style={S.btnGhost}>Annulla</button>
            <button type="submit" disabled={saving || assets.length === 0} style={{ ...S.btnPrimary, opacity: saving || assets.length === 0 ? 0.6 : 1, cursor: saving || assets.length === 0 ? "not-allowed" : "pointer" }}>
              {saving ? "Creazione..." : "Crea Piano"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ─── Modal: Crea Task ─────────────────────────────────────────────────────────

function ModalCreaTask({ pianoId, onClose, onCreated }: {
  pianoId: number;
  onClose: () => void;
  onCreated: (t: Task) => void;
}) {
  const [form, setForm] = useState({
    descrizione: "", nome: "", frequenza_giorni: "", durata_ore: "",
    priorita: "Media", codice: "", is_repeatable: true, generation_mode: "manual", generate_days_before_due: "7",
  });
  const [saving, setSaving] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.descrizione.trim()) { notify.error("La descrizione è obbligatoria"); return; }
    setSaving(true);
    try {
      const body: Record<string, unknown> = {
        descrizione: form.descrizione.trim(),
        priorita: form.priorita,
        is_repeatable: form.is_repeatable,
        generation_mode: form.generation_mode,
        generate_days_before_due: Number(form.generate_days_before_due) || 7,
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

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.75)", zIndex: 9999, display: "flex", alignItems: "center", justifyContent: "center" }}>
      <div style={{ background: "#111827", border: "1px solid rgba(75,85,99,0.5)", borderRadius: 12, padding: 24, width: 500, maxWidth: "95vw", maxHeight: "90vh", overflowY: "auto" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 18 }}>
          <h3 style={{ margin: 0, fontSize: 15, fontWeight: 700, color: "var(--text-primary)" }}>Nuovo Task</h3>
          <button onClick={onClose} style={{ background: "none", border: "none", color: "var(--text-muted)", cursor: "pointer", fontSize: 20 }}>×</button>
        </div>
        <form onSubmit={submit} style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <div>
            <label style={{ fontSize: 12, color: "var(--text-secondary)", display: "block", marginBottom: 3 }}>Descrizione *</label>
            <textarea required value={form.descrizione} onChange={e => setForm(f => ({ ...f, descrizione: e.target.value }))} rows={3} style={{ ...S.inp, resize: "vertical" }} />
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
            <div>
              <label style={{ fontSize: 12, color: "var(--text-secondary)", display: "block", marginBottom: 3 }}>Nome breve</label>
              <input value={form.nome} onChange={e => setForm(f => ({ ...f, nome: e.target.value }))} style={S.inp} placeholder="es. Ispezione filtri" />
            </div>
            <div>
              <label style={{ fontSize: 12, color: "var(--text-secondary)", display: "block", marginBottom: 3 }}>Codice</label>
              <input value={form.codice} onChange={e => setForm(f => ({ ...f, codice: e.target.value }))} style={S.inp} placeholder="es. T-001" />
            </div>
            <div>
              <label style={{ fontSize: 12, color: "var(--text-secondary)", display: "block", marginBottom: 3 }}>Frequenza (giorni)</label>
              <input type="number" min={1} value={form.frequenza_giorni} onChange={e => setForm(f => ({ ...f, frequenza_giorni: e.target.value }))} style={S.inp} placeholder="es. 90" />
            </div>
            <div>
              <label style={{ fontSize: 12, color: "var(--text-secondary)", display: "block", marginBottom: 3 }}>Durata (ore)</label>
              <input type="number" min={0.25} step={0.25} value={form.durata_ore} onChange={e => setForm(f => ({ ...f, durata_ore: e.target.value }))} style={S.inp} placeholder="es. 2" />
            </div>
            <div>
              <label style={{ fontSize: 12, color: "var(--text-secondary)", display: "block", marginBottom: 3 }}>Priorità</label>
              <select value={form.priorita} onChange={e => setForm(f => ({ ...f, priorita: e.target.value }))} style={S.inp}>
                <option>Alta</option><option>Media</option><option>Bassa</option>
              </select>
            </div>
            <div>
              <label style={{ fontSize: 12, color: "var(--text-secondary)", display: "block", marginBottom: 3 }}>Generazione ticket</label>
              <select value={form.generation_mode} onChange={e => setForm(f => ({ ...f, generation_mode: e.target.value }))} style={S.inp}>
                <option value="manual">Solo manuale</option>
                <option value="auto">Automatica</option>
                <option value="disabled">Disabilitata</option>
              </select>
            </div>
          </div>
          {form.generation_mode === "auto" && (
            <div>
              <label style={{ fontSize: 12, color: "var(--text-secondary)", display: "block", marginBottom: 3 }}>Genera ticket N giorni prima della scadenza</label>
              <input type="number" min={1} max={365} value={form.generate_days_before_due} onChange={e => setForm(f => ({ ...f, generate_days_before_due: e.target.value }))} style={S.inp} />
            </div>
          )}
          <label style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer", fontSize: 13, color: "var(--text-secondary)" }}>
            <input type="checkbox" checked={form.is_repeatable} onChange={e => setForm(f => ({ ...f, is_repeatable: e.target.checked }))} />
            Task ricorrente (si ripete dopo ogni ciclo)
          </label>
          <div style={{ display: "flex", gap: 10, justifyContent: "flex-end", marginTop: 4 }}>
            <button type="button" onClick={onClose} style={S.btnGhost}>Annulla</button>
            <button type="submit" disabled={saving} style={{ ...S.btnPrimary, opacity: saving ? 0.6 : 1 }}>
              {saving ? "Creazione..." : "Crea Task"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ─── Pannello dettaglio Task (drawer destro) ──────────────────────────────────

function TaskDetail({ task, pianoId, onClose, onTicketGenerated }: {
  task: Task;
  pianoId: number;
  onClose: () => void;
  onTicketGenerated: () => void;
}) {
  const [tickets, setTickets] = useState<TicketHistory[]>([]);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await apiGet<TicketHistory[]>(`/piani-manutenzione/${pianoId}/tasks/${task.id}/tickets`);
      setTickets(Array.isArray(data) ? data : []);
    } catch { setTickets([]); } finally { setLoading(false); }
  }, [pianoId, task.id]);

  useEffect(() => { load(); }, [load]);

  async function generaTicket() {
    setGenerating(true);
    try {
      const res = await apiPost<{ created: number; ticket_ids: number[] }>(`/piani-manutenzione/${pianoId}/tasks/${task.id}/genera-ticket`, {});
      notify.success(`${res.created} ticket generati`);
      onTicketGenerated();
      load();
    } catch (err: unknown) {
      notify.error(err instanceof Error ? err.message : "Errore generazione ticket");
    } finally { setGenerating(false); }
  }

  const canGenerate = task.task_stato === "active" && task.generation_mode !== "disabled";

  return (
    <div style={{ ...S.card, display: "flex", flexDirection: "column", height: "100%", minHeight: 0 }}>
      <div style={{ ...S.head, justifyContent: "space-between" }}>
        <div style={{ fontSize: 13, fontWeight: 700, color: "var(--text-primary)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", flex: 1 }}>
          {task.nome || task.descrizione}
        </div>
        <button onClick={onClose} style={{ background: "none", border: "none", color: "var(--text-muted)", cursor: "pointer", fontSize: 16, flexShrink: 0 }}>×</button>
      </div>

      <div style={{ flex: 1, overflowY: "auto", padding: 14, display: "flex", flexDirection: "column", gap: 12 }}>
        {/* Metadati compatti */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
          {([
            ["Priorità", <Chip key="p" label={task.priorita} style={prioritaBadge(task.priorita)} />],
            ["Stato", <Chip key="s" label={statoTaskLabel(task.task_stato)} style={statoTaskBadge(task.task_stato)} />],
            ["Frequenza", task.frequenza_giorni ? `ogni ${task.frequenza_giorni}g` : "—"],
            ["Durata", task.durata_ore ? `${task.durata_ore}h` : "—"],
            ["Generazione", task.generation_mode === "manual" ? "Manuale" : task.generation_mode === "auto" ? `Auto (${task.generate_days_before_due}g prima)` : "Disabilitata"],
            ["Ricorrente", task.is_repeatable ? "Sì" : "No"],
            ["Ultima gen.", fmt(task.last_generated_at)],
            ["Prossima scad.", <span key="nd" style={isOverdue(task.next_due_at) ? { color: "#f87171", fontWeight: 700 } : {}}>{fmt(task.next_due_at)}</span>],
          ] as [string, React.ReactNode][]).map(([label, val], i) => (
            <div key={i} style={{ background: "rgba(255,255,255,0.03)", borderRadius: 6, padding: "7px 10px" }}>
              <div style={{ fontSize: 10, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 2 }}>{label}</div>
              <div style={{ fontSize: 12, color: "var(--text-primary)" }}>{val}</div>
            </div>
          ))}
        </div>

        {task.descrizione && (
          <div style={{ background: "rgba(255,255,255,0.03)", borderRadius: 6, padding: "8px 10px" }}>
            <div style={{ fontSize: 10, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 4 }}>Descrizione</div>
            <div style={{ fontSize: 12, color: "var(--text-secondary)", lineHeight: 1.5 }}>{task.descrizione}</div>
          </div>
        )}

        {/* Genera Ticket */}
        <button
          onClick={generaTicket}
          disabled={generating || !canGenerate}
          style={{ ...S.btnPrimary, width: "100%", padding: "9px", fontSize: 13, opacity: !canGenerate ? 0.5 : 1, cursor: !canGenerate ? "not-allowed" : "pointer" }}
        >
          {generating ? "Generazione..." : task.open_ticket_count > 0 ? `Genera Ticket (${task.open_ticket_count} già attivi)` : "Genera Ticket"}
        </button>
        {task.open_ticket_count > 0 && (
          <div style={{ fontSize: 11, color: "#fbbf24", marginTop: -8, textAlign: "center" }}>
            Esiste già un ticket attivo per questo task
          </div>
        )}
        {!canGenerate && (
          <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: -8, textAlign: "center" }}>
            {task.task_stato !== "active" ? "Task non attivo" : "Generazione disabilitata"}
          </div>
        )}

        {/* Storico ticket */}
        <div>
          <div style={{ fontSize: 11, fontWeight: 600, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 8 }}>
            Storico Ticket {loading ? "…" : `(${tickets.length})`}
          </div>
          {!loading && tickets.length === 0 && (
            <div style={{ fontSize: 12, color: "var(--text-muted)", textAlign: "center", padding: "12px 0" }}>Nessun ticket generato</div>
          )}
          <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
            {tickets.map(t => (
              <div key={t.id} style={{ background: "rgba(255,255,255,0.04)", borderRadius: 6, padding: "8px 10px", display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 11, fontWeight: 600, color: "var(--text-primary)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>#{t.id} {t.titolo}</div>
                  <div style={{ fontSize: 10, color: "var(--text-muted)" }}>{fmt(t.created_at)}</div>
                </div>
                <Chip label={t.stato} style={statoTicketBadge(t.stato)} />
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Pagina principale ─────────────────────────────────────────────────────────

export default function PianiPage() {
  const [piani, setPiani] = useState<Piano[]>([]);
  const [loadingPiani, setLoadingPiani] = useState(true);
  const [selectedPiano, setSelectedPiano] = useState<Piano | null>(null);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [loadingTasks, setLoadingTasks] = useState(false);
  const [selectedTask, setSelectedTask] = useState<Task | null>(null);

  const [assets, setAssets] = useState<AssetOption[]>([]);
  const [loadingAssets, setLoadingAssets] = useState(false);

  const [showCreaPiano, setShowCreaPiano] = useState(false);
  const [showCreaTask, setShowCreaTask] = useState(false);

  // ── Fetch piani ──────────────────────────────────────────────────────────────
  const fetchPiani = useCallback(async () => {
    setLoadingPiani(true);
    try {
      const data = await apiGet<{ items: Piano[] }>("/piani-manutenzione?limit=100");
      setPiani(data.items || []);
    } catch { notify.error("Errore caricamento piani"); }
    finally { setLoadingPiani(false); }
  }, []);

  // ── Fetch asset reali ────────────────────────────────────────────────────────
  // GET /assets restituisce direttamente un array, NON { items: [] }
  const fetchAssets = useCallback(async () => {
    setLoadingAssets(true);
    try {
      const data = await apiGet<AssetOption[]>("/assets");
      setAssets(Array.isArray(data) ? data : []);
    } catch { setAssets([]); }
    finally { setLoadingAssets(false); }
  }, []);

  // ── Fetch task del piano selezionato ─────────────────────────────────────────
  const fetchTasks = useCallback(async (pianoId: number) => {
    setLoadingTasks(true);
    setSelectedTask(null);
    try {
      const data = await apiGet<{ items: Task[] }>(`/piani-manutenzione/${pianoId}/tasks?limit=200`);
      setTasks(data.items || []);
    } catch { notify.error("Errore caricamento task"); setTasks([]); }
    finally { setLoadingTasks(false); }
  }, []);

  useEffect(() => { fetchPiani(); }, [fetchPiani]);

  // Carica asset solo quando l'utente apre il modal crea piano
  function apriCreaPiano() {
    if (assets.length === 0 && !loadingAssets) fetchAssets();
    setShowCreaPiano(true);
  }

  function selectPiano(p: Piano) {
    setSelectedPiano(p);
    fetchTasks(p.id);
  }

  function pianoClosed() {
    setSelectedPiano(null);
    setTasks([]);
    setSelectedTask(null);
  }

  function handlePianoCreated(p: Piano) {
    setPiani(prev => [{ ...p, task_count: 0, open_ticket_count: 0 }, ...prev]);
    setShowCreaPiano(false);
    selectPiano({ ...p, task_count: 0, open_ticket_count: 0 });
  }

  function handleTaskCreated(t: Task) {
    setTasks(prev => [t, ...prev]);
    setShowCreaTask(false);
    setPiani(prev => prev.map(p => p.id === selectedPiano?.id ? { ...p, task_count: p.task_count + 1 } : p));
  }

  function handleTicketGenerated() {
    if (selectedPiano) {
      fetchTasks(selectedPiano.id);
      setPiani(prev => prev.map(p => p.id === selectedPiano.id ? { ...p, open_ticket_count: p.open_ticket_count + 1 } : p));
    }
  }

  async function deletePiano(id: number, nome: string) {
    if (!confirm(`Eliminare il piano ${nome}? I task saranno eliminati, i ticket saranno scollegati.`)) return;
    try {
      await apiDelete(`/piani-manutenzione/${id}`);
      setPiani(prev => prev.filter(p => p.id !== id));
      if (selectedPiano?.id === id) pianoClosed();
      notify.success("Piano eliminato");
    } catch (err: unknown) { notify.error(err instanceof Error ? err.message : "Errore"); }
  }

  async function deleteTask(taskId: number) {
    if (!selectedPiano || !confirm("Eliminare questo task?")) return;
    try {
      await apiDelete(`/piani-manutenzione/${selectedPiano.id}/tasks/${taskId}`);
      setTasks(prev => prev.filter(t => t.id !== taskId));
      if (selectedTask?.id === taskId) setSelectedTask(null);
      setPiani(prev => prev.map(p => p.id === selectedPiano.id ? { ...p, task_count: Math.max(0, p.task_count - 1) } : p));
      notify.success("Task eliminato");
    } catch (err: unknown) { notify.error(err instanceof Error ? err.message : "Errore"); }
  }

  // ── Layout adattivo ──────────────────────────────────────────────────────────
  // Stato A: nessun piano                → vista compatta centrata
  // Stato B: piani presenti, nessuno sel.→ 2 colonne (lista + empty)
  // Stato C: piano sel., nessun task sel.→ 2 colonne (lista stretta + task wide)
  // Stato D: piano + task selezionati   → 3 colonne

  const showDetail = !!selectedTask && !!selectedPiano;
  const showTasks  = !!selectedPiano;
  const noPiani    = !loadingPiani && piani.length === 0;

  const gridCols = showDetail
    ? "240px 1fr 320px"
    : showTasks
      ? "240px 1fr"
      : "1fr";

  return (
    <div style={{ padding: "20px 24px", height: "calc(100vh - 64px)", display: "flex", flexDirection: "column", gap: 16, fontFamily: "inherit" }}>

      {/* ── Header ── */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 10 }}>
        <div>
          <h1 style={{ fontSize: 18, fontWeight: 700, color: "var(--text-primary)", margin: 0 }}>Piani di Manutenzione</h1>
          <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 2 }}>Asset → Piano → Task → Ticket</div>
        </div>
        <button onClick={apriCreaPiano} style={S.btnPrimary}>+ Nuovo Piano</button>
      </div>

      {/* ── Stato A: nessun piano → empty state centrale ── */}
      {noPiani ? (
        <div style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 12 }}>
          <div style={{ fontSize: 40, opacity: 0.2 }}>📋</div>
          <div style={{ fontSize: 15, fontWeight: 600, color: "var(--text-secondary)" }}>Nessun piano di manutenzione</div>
          <div style={{ fontSize: 13, color: "var(--text-muted)", textAlign: "center", maxWidth: 360 }}>
            Crea il primo piano associandolo a un asset esistente. I task del piano genereranno i ticket operativi.
          </div>
          <button onClick={apriCreaPiano} style={{ ...S.btnPrimary, padding: "8px 20px", fontSize: 13, marginTop: 4 }}>Crea primo Piano</button>
        </div>
      ) : loadingPiani ? (
        <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", color: "var(--text-muted)", fontSize: 13 }}>Caricamento piani...</div>
      ) : (
        /* ── Corpo a colonne adattive ── */
        <div style={{ flex: 1, display: "grid", gridTemplateColumns: gridCols, gap: 12, minHeight: 0, transition: "grid-template-columns 0.2s" }}>

          {/* ── Colonna Lista Piani ── */}
          <div style={{ ...S.card, display: "flex", flexDirection: "column", minHeight: 0 }}>
            <div style={{ ...S.head, justifyContent: "space-between" }}>
              <span style={{ fontSize: 12, fontWeight: 700, color: "var(--text-primary)" }}>Piani ({piani.length})</span>
              <button onClick={apriCreaPiano} style={{ ...S.btnPrimary, padding: "4px 10px", fontSize: 11 }}>+</button>
            </div>
            <div style={{ flex: 1, overflowY: "auto", padding: 6 }}>
              {piani.map(piano => (
                <div
                  key={piano.id}
                  onClick={() => selectPiano(piano)}
                  style={{
                    padding: "9px 10px", borderRadius: 7, cursor: "pointer", marginBottom: 3,
                    background: selectedPiano?.id === piano.id ? "rgba(99,102,241,0.15)" : "transparent",
                    border: selectedPiano?.id === piano.id ? "1px solid rgba(99,102,241,0.4)" : "1px solid transparent",
                  }}
                >
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 12, fontWeight: 700, color: "var(--text-primary)", marginBottom: 1 }}>{piano.nome_codificato}</div>
                      <div style={{ fontSize: 11, color: "var(--text-muted)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{piano.asset_nome || "—"}</div>
                      <div style={{ display: "flex", gap: 5, marginTop: 4 }}>
                        <span style={{ fontSize: 10, color: "var(--text-muted)", background: "rgba(255,255,255,0.05)", padding: "1px 5px", borderRadius: 3 }}>{piano.task_count} task</span>
                        {piano.open_ticket_count > 0 && <span style={{ fontSize: 10, color: "#60a5fa", background: "rgba(96,165,250,0.1)", padding: "1px 5px", borderRadius: 3, border: "1px solid rgba(96,165,250,0.2)" }}>{piano.open_ticket_count} ticket</span>}
                      </div>
                    </div>
                    <button onClick={e => { e.stopPropagation(); deletePiano(piano.id, piano.nome_codificato); }} style={{ ...S.btnDanger, padding: "2px 5px", fontSize: 10, marginLeft: 4, flexShrink: 0 }}>✕</button>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* ── Colonna Task (visibile solo se piano selezionato) ── */}
          {showTasks && (
            <div style={{ ...S.card, display: "flex", flexDirection: "column", minHeight: 0 }}>
              {/* Header piano + azioni */}
              <div style={{ ...S.head, justifyContent: "space-between", flexWrap: "wrap", gap: 6 }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13, fontWeight: 700, color: "var(--text-primary)" }}>{selectedPiano!.nome_codificato}</div>
                  <div style={{ fontSize: 11, color: "var(--text-muted)" }}>
                    {selectedPiano!.asset_nome || "—"} · {selectedPiano!.task_count} task · {selectedPiano!.open_ticket_count} ticket aperti
                  </div>
                </div>
                <div style={{ display: "flex", gap: 6, flexShrink: 0 }}>
                  <button style={S.btnGhost} onClick={() => fetchTasks(selectedPiano!.id)} title="Aggiorna">↻</button>
                  <button style={S.btnPrimary} onClick={() => setShowCreaTask(true)}>+ Task</button>
                </div>
              </div>

              {/* Lista task */}
              <div style={{ flex: 1, overflowY: "auto" }}>
                {loadingTasks ? (
                  <div style={{ padding: 20, color: "var(--text-muted)", fontSize: 12, textAlign: "center" }}>Caricamento task...</div>
                ) : tasks.length === 0 ? (
                  <div style={{ padding: 32, display: "flex", flexDirection: "column", alignItems: "center", gap: 10, color: "var(--text-muted)" }}>
                    <div style={{ fontSize: 28, opacity: 0.2 }}>🔧</div>
                    <div style={{ fontSize: 13 }}>Nessun task in questo piano</div>
                    <button onClick={() => setShowCreaTask(true)} style={S.btnPrimary}>Aggiungi Task</button>
                  </div>
                ) : (
                  <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
                    <thead>
                      <tr style={{ borderBottom: "1px solid rgba(75,85,99,0.3)" }}>
                        {["Codice", "Nome / Descrizione", "Freq.", "Dur.", "Priorità", "Stato", "Prossima scad.", ""].map(h => (
                          <th key={h} style={{ padding: "7px 10px", textAlign: "left", color: "var(--text-muted)", fontWeight: 600, fontSize: 10, textTransform: "uppercase", letterSpacing: "0.05em", whiteSpace: "nowrap" }}>{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {tasks.map(t => (
                        <tr
                          key={t.id}
                          onClick={() => setSelectedTask(prev => prev?.id === t.id ? null : t)}
                          style={{ borderBottom: "1px solid rgba(75,85,99,0.12)", cursor: "pointer", background: selectedTask?.id === t.id ? "rgba(99,102,241,0.08)" : "transparent" }}
                        >
                          <td style={{ padding: "8px 10px", color: "var(--text-muted)", whiteSpace: "nowrap" }}>{t.codice || `#${t.id}`}</td>
                          <td style={{ padding: "8px 10px", maxWidth: 200 }}>
                            <div style={{ fontWeight: 600, color: "var(--text-primary)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{t.nome || t.descrizione}</div>
                            {t.nome && t.descrizione !== t.nome && <div style={{ color: "var(--text-muted)", fontSize: 11, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{t.descrizione}</div>}
                          </td>
                          <td style={{ padding: "8px 10px", color: "var(--text-secondary)", whiteSpace: "nowrap" }}>{t.frequenza_giorni ? `${t.frequenza_giorni}g` : "—"}</td>
                          <td style={{ padding: "8px 10px", color: "var(--text-secondary)", whiteSpace: "nowrap" }}>{t.durata_ore ? `${t.durata_ore}h` : "—"}</td>
                          <td style={{ padding: "8px 10px" }}><Chip label={t.priorita} style={prioritaBadge(t.priorita)} /></td>
                          <td style={{ padding: "8px 10px" }}><Chip label={statoTaskLabel(t.task_stato)} style={statoTaskBadge(t.task_stato)} /></td>
                          <td style={{ padding: "8px 10px", whiteSpace: "nowrap" }}>
                            <span style={isOverdue(t.next_due_at) ? { color: "#f87171", fontWeight: 700 } : { color: "var(--text-secondary)" }}>{fmt(t.next_due_at)}</span>
                          </td>
                          <td style={{ padding: "8px 8px", whiteSpace: "nowrap" }}>
                            {t.open_ticket_count > 0 && <span style={{ fontSize: 10, color: "#60a5fa", background: "rgba(96,165,250,0.1)", padding: "1px 5px", borderRadius: 3, border: "1px solid rgba(96,165,250,0.2)", marginRight: 4 }}>{t.open_ticket_count}</span>}
                            <button onClick={e => { e.stopPropagation(); deleteTask(t.id); }} style={S.btnDanger} title="Elimina task">✕</button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            </div>
          )}

          {/* ── Dettaglio Task (drawer destro — solo se task selezionato) ── */}
          {showDetail && (
            <TaskDetail
              task={selectedTask!}
              pianoId={selectedPiano!.id}
              onClose={() => setSelectedTask(null)}
              onTicketGenerated={handleTicketGenerated}
            />
          )}

        </div>
      )}

      {/* Modali */}
      {showCreaPiano && (
        <ModalCreaPiano
          assets={assets}
          loadingAssets={loadingAssets}
          onClose={() => setShowCreaPiano(false)}
          onCreated={handlePianoCreated}
        />
      )}
      {showCreaTask && selectedPiano && (
        <ModalCreaTask
          pianoId={selectedPiano.id}
          onClose={() => setShowCreaTask(false)}
          onCreated={handleTaskCreated}
        />
      )}
    </div>
  );
}
