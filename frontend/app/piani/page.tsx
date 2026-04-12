"use client";

import { useEffect, useState, useCallback, useMemo } from "react";
import { apiGet, apiPost, apiDelete, apiPut, apiUpload } from "../lib/api";
import { notify } from "@/lib/toast";
import { cn } from "@/lib/utils";

// ─── Tipi ─────────────────────────────────────────────────────────────────────

type AssetOption = { 
  id: number; 
  nome: string; 
  codice?: string;
  impianto_nome?: string; 
  sito_nome?: string;
};

type Piano = {
  id: number;
  nome_codificato: string;
  progressivo: number;
  descrizione: string | null;
  stato: string;
  asset_ids: number[];
  asset_nome: string; 
  asset_count: number;
  task_count: number;
  open_ticket_count: number;
  created_at: string | null;
};

type Task = {
  id: number;
  piano_id: number | null;
  asset_id: number | null;
  asset_nome: string | null;
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
  next_due_at: string | null;
};

type Manuale = {
  id: number;
  nome: string;
  pagine: number;
  task_count: number;
  created_at: string | null;
};

type TicketHistory = {
  id: number;
  titolo: string;
  stato: string;
  priorita: string;
  created_at: string | null;
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmt(iso: string | null) {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("it-IT", { 
    day: "2-digit", 
    month: "2-digit", 
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit"
  });
}

const PRIORITA_STYLES: Record<string, { dot: string; badge: string }> = {
  Alta:   { dot: "bg-red-500",     badge: "bg-red-500/15 text-red-400 border-red-500/25" },
  Media:  { dot: "bg-amber-400",   badge: "bg-amber-400/15 text-amber-400 border-amber-400/25" },
  Bassa:  { dot: "bg-emerald-500", badge: "bg-emerald-500/15 text-emerald-400 border-emerald-500/25" },
};

// ─── Componenti UI Base ────────────────────────────────────────────────────────

function StatoBadge({ label }: { label: string }) {
  return (
    <span style={{
      display: "inline-flex", alignItems: "center", gap: 5,
      padding: "3px 10px", borderRadius: 6, border: "1px solid",
      fontSize: 11, fontWeight: 600, letterSpacing: "0.04em",
      background: "rgba(99,102,241,0.1)", color: "#a5b4fc",
      borderColor: "rgba(99,102,241,0.3)"
    }}>
      {label}
    </span>
  );
}

function PrioritaBadge({ label }: { label: string }) {
  const style = PRIORITA_STYLES[label] || PRIORITA_STYLES["Media"];
  return (
    <span className={cn("inline-flex items-center px-2.5 py-0.5 rounded-md border text-xs font-semibold", style.badge)}>
      {label}
    </span>
  );
}

// ─── Selezione Asset ──────────────────────────────────────────────────────────

function AssetSelector({ 
  selectedIds, 
  onToggle, 
  onSelectAll 
}: { 
  selectedIds: number[], 
  onToggle: (id: number) => void,
  onSelectAll: (ids: number[]) => void
}) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<AssetOption[]>([]);
  const [loading, setLoading] = useState(false);

  const search = useCallback(async (q: string) => {
    setLoading(true);
    try {
      const res = await apiGet<AssetOption[]>(`/assets?query=${encodeURIComponent(q)}&limit=50`);
      setResults(res || []);
    } catch { 
      notify.error("Errore nel recupero degli asset"); 
      setResults([]);
    }
    finally { setLoading(false); }
  }, []);

  useEffect(() => {
    const timer = setTimeout(() => search(query), 300);
    return () => clearTimeout(timer);
  }, [query, search]);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      {/* Search row */}
      <div style={{ display: "flex", gap: 10 }}>
        <div style={{ position: "relative", flex: 1 }}>
          <input 
            type="text" 
            placeholder="Cerca asset per nome o codice..."
            value={query}
            onChange={e => setQuery(e.target.value)}
            style={{
              width: "100%", background: "var(--bg-surface)",
              border: "1px solid var(--border-strong)", borderRadius: 8,
              padding: "9px 12px 9px 36px", fontSize: 13, color: "var(--text-primary)",
              outline: "none", fontFamily: "var(--font-body)"
            }}
          />
          <span style={{ position: "absolute", left: 11, top: "50%", transform: "translateY(-50%)", fontSize: 14, opacity: 0.4 }}>🔍</span>
        </div>
        <button 
          type="button"
          onClick={() => onSelectAll(results.map(r => r.id))}
          style={{
            padding: "9px 16px", background: "var(--bg-overlay)",
            border: "1px solid var(--border-strong)", borderRadius: 8,
            color: "var(--text-secondary)", fontSize: 12, fontWeight: 600,
            cursor: "pointer", whiteSpace: "nowrap", transition: "all 0.15s"
          }}
        >
          Seleziona gruppo
        </button>
      </div>

      {/* List */}
      <div style={{
        maxHeight: 280, overflowY: "auto",
        border: "1px solid var(--border)", borderRadius: 8,
        background: "rgba(0,0,0,0.15)"
      }}>
        {loading ? (
          <div style={{ padding: "32px 0", textAlign: "center", color: "var(--text-muted)", fontSize: 13 }}>
            Ricerca in corso...
          </div>
        ) : results.length === 0 ? (
          <div style={{ padding: "32px 0", textAlign: "center", color: "var(--text-muted)", fontSize: 13 }}>
            Nessun asset trovato
          </div>
        ) : (
          results.map(asset => {
            const selected = selectedIds.includes(asset.id);
            return (
              <div 
                key={asset.id}
                onClick={() => onToggle(asset.id)}
                style={{
                  display: "flex", alignItems: "center", justifyContent: "space-between",
                  padding: "10px 14px", cursor: "pointer", borderBottom: "1px solid var(--border)",
                  background: selected ? "rgba(99,102,241,0.08)" : "transparent",
                  transition: "background 0.15s"
                }}
              >
                <div style={{ display: "flex", flexDirection: "column", gap: 2, minWidth: 0 }}>
                  <span style={{ fontSize: 13, fontWeight: 600, color: selected ? "var(--text-primary)" : "var(--text-secondary)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {asset.nome}
                  </span>
                  <span style={{ fontSize: 11, color: "var(--text-muted)" }}>
                    {[asset.codice, asset.sito_nome].filter(Boolean).join(" · ")}
                  </span>
                </div>
                <div style={{
                  width: 18, height: 18, borderRadius: 4, flexShrink: 0,
                  border: selected ? "none" : "2px solid var(--border-strong)",
                  background: selected ? "#6366f1" : "transparent",
                  display: "flex", alignItems: "center", justifyContent: "center",
                  transition: "all 0.15s"
                }}>
                  {selected && <span style={{ color: "white", fontSize: 11, lineHeight: 1 }}>✓</span>}
                </div>
              </div>
            );
          })
        )}
      </div>

      {selectedIds.length > 0 && (
        <div style={{ fontSize: 12, color: "var(--text-muted)" }}>
          <span style={{ color: "#a5b4fc", fontWeight: 600 }}>{selectedIds.length}</span> asset selezionati
        </div>
      )}
    </div>
  );
}

// ─── MODAL: Nuovo / Modifica Piano ────────────────────────────────────────────

function ModalPiano({ piano, onClose, onSaved }: {
  piano?: Piano | null;
  onClose: () => void;
  onSaved: (p: Piano) => void;
}) {
  const [form, setForm] = useState({
    descrizione: piano?.descrizione || "",
    asset_ids: piano?.asset_ids || [],
    stato: piano?.stato || "attivo",
  });
  const [saving, setSaving] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (form.asset_ids.length === 0) {
      notify.error("Associa almeno un asset al piano.");
      return;
    }
    setSaving(true);
    try {
      const res = piano 
        ? await apiPut<Piano>(`/piani-manutenzione/${piano.id}`, form)
        : await apiPost<Piano>("/piani-manutenzione", form);
      notify.success(piano ? "Configurazione salvata" : "Nuovo piano creato con successo");
      onSaved(res);
    } catch (err: unknown) {
      notify.error(err instanceof Error ? err.message : "Errore salvataggio");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div style={{
      position: "fixed", inset: 0, background: "rgba(0,0,0,0.65)",
      backdropFilter: "blur(6px)", zIndex: 100,
      display: "flex", alignItems: "center", justifyContent: "center",
      padding: 24, overflowY: "auto"
    }}>
      <div style={{
        background: "var(--bg-elevated)", border: "1px solid var(--border)",
        borderRadius: 16, width: "100%", maxWidth: 720,
        boxShadow: "0 24px 64px rgba(0,0,0,0.5)", overflow: "hidden", margin: "auto"
      }}>
        {/* Header */}
        <div style={{
          padding: "20px 28px", borderBottom: "1px solid var(--border)",
          display: "flex", justifyContent: "space-between", alignItems: "flex-start",
          background: "var(--bg-surface)"
        }}>
          <div>
            <h3 style={{ fontSize: 18, fontWeight: 700, color: "var(--text-primary)", margin: 0, marginBottom: 4 }}>
              {piano ? "Modifica Piano" : "Nuovo Piano di Manutenzione"}
            </h3>
            <p style={{ fontSize: 13, color: "var(--text-muted)", margin: 0 }}>
              {piano ? `Piano: ${piano.nome_codificato}` : "Definisci il perimetro e gli asset associati"}
            </p>
          </div>
          <button 
            onClick={onClose} 
            style={{ background: "none", border: "none", color: "var(--text-muted)", fontSize: 24, cursor: "pointer", lineHeight: 1, padding: 4 }}
          >
            ×
          </button>
        </div>

        <form onSubmit={submit} style={{ padding: 28, display: "flex", flexDirection: "column", gap: 24 }}>
          {/* Descrizione */}
          <div>
            <label style={{ display: "block", fontSize: 12, fontWeight: 600, color: "var(--text-muted)", marginBottom: 8, letterSpacing: "0.05em", textTransform: "uppercase" }}>
              Descrizione operativa
            </label>
            <textarea 
              value={form.descrizione}
              onChange={e => setForm(f => ({ ...f, descrizione: e.target.value }))}
              placeholder="Es. Piano Manutenzione Preventiva Q.E. Bassa Tensione — Reparto Nord"
              style={{
                width: "100%", background: "var(--bg-surface)",
                border: "1px solid var(--border-strong)", borderRadius: 8,
                padding: "12px 14px", fontSize: 13, color: "var(--text-primary)",
                resize: "vertical", minHeight: 90, outline: "none",
                fontFamily: "var(--font-body)", lineHeight: 1.6,
                boxSizing: "border-box"
              }}
              required
            />
          </div>

          {/* Selezione Asset */}
          <div>
            <label style={{ display: "block", fontSize: 12, fontWeight: 600, color: "var(--text-muted)", marginBottom: 8, letterSpacing: "0.05em", textTransform: "uppercase" }}>
              Selezione asset per il piano
            </label>
            <AssetSelector 
              selectedIds={form.asset_ids} 
              onToggle={id => setForm(f => ({ ...f, asset_ids: f.asset_ids.includes(id) ? f.asset_ids.filter(x => x !== id) : [...f.asset_ids, id]}))}
              onSelectAll={ids => setForm(f => {
                const newIds = new Set([...f.asset_ids, ...ids]);
                return { ...f, asset_ids: Array.from(newIds) };
              })}
            />
          </div>

          {/* Footer buttons */}
          <div style={{ display: "flex", gap: 12, paddingTop: 4, borderTop: "1px solid var(--border)" }}>
            <button 
              type="button" 
              onClick={onClose}
              style={{
                padding: "10px 20px", border: "1px solid var(--border-strong)",
                borderRadius: 8, color: "var(--text-secondary)", fontSize: 13,
                fontWeight: 600, background: "transparent", cursor: "pointer"
              }}
            >
              Annulla
            </button>
            <button 
              type="submit"
              disabled={saving}
              style={{
                flex: 1, padding: "10px 20px", background: saving ? "#4f46e5" : "#6366f1",
                border: "1px solid #4f46e5", borderRadius: 8,
                color: "white", fontSize: 13, fontWeight: 700,
                cursor: saving ? "not-allowed" : "pointer", opacity: saving ? 0.75 : 1,
                transition: "all 0.15s"
              }}
            >
              {saving ? "Salvataggio..." : (piano ? "Aggiorna Piano" : "Crea Piano Operativo")}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ─── DRAWER: Dettaglio Task ────────────────────────────────────────────────────

function DrawerTask({ 
  task, 
  pianoId, 
  onClose, 
  onUpdated 
}: { 
  task: Task; 
  pianoId: number; 
  onClose: () => void; 
  onUpdated: (t: Task) => void 
}) {
  const [form, setForm] = useState({
    nome: task.nome || "",
    descrizione: task.descrizione || "",
    frequenza_giorni: task.frequenza_giorni || 30,
    durata_ore: task.durata_ore || 1,
    priorita: task.priorita || "Media",
    task_stato: task.task_stato || "active",
    is_repeatable: task.is_repeatable ?? true,
    generate_days_before_due: task.generate_days_before_due || 7,
  });
  const [saving, setSaving] = useState(false);
  const isNew = !task.id;

  async function handleSave() {
    setSaving(true);
    try {
      const res = isNew
        ? await apiPost<Task>(`/piani-manutenzione/${pianoId}/tasks`, form)
        : await apiPut<Task>(`/piani-manutenzione/${pianoId}/tasks/${task.id}`, form);
      notify.success(isNew ? "Attività creata" : "Attività aggiornata");
      onUpdated(res);
      onClose();
    } catch (err: unknown) {
      notify.error(err instanceof Error ? err.message : "Errore salvataggio task");
    } finally {
      setSaving(false);
    }
  }

  const fieldLabel = (text: string) => (
    <label style={{ display: "block", fontSize: 11, fontWeight: 600, color: "var(--text-muted)", marginBottom: 6, letterSpacing: "0.05em", textTransform: "uppercase" }}>
      {text}
    </label>
  );

  const fieldInput = (props: React.InputHTMLAttributes<HTMLInputElement>) => (
    <input 
      {...props}
      style={{
        width: "100%", background: "var(--bg-surface)",
        border: "1px solid var(--border-strong)", borderRadius: 8,
        padding: "9px 12px", fontSize: 13, color: "var(--text-primary)",
        outline: "none", fontFamily: "var(--font-body)", boxSizing: "border-box",
        ...props.style
      }}
    />
  );

  return (
    <div style={{
      position: "fixed", insetBlock: 0, right: 0, width: "min(500px, 100vw)",
      background: "var(--bg-elevated)", borderLeft: "1px solid var(--border)",
      zIndex: 80, boxShadow: "-8px 0 40px rgba(0,0,0,0.3)",
      display: "flex", flexDirection: "column"
    }}>
      {/* Header */}
      <div style={{
        padding: "20px 24px", borderBottom: "1px solid var(--border)",
        background: "var(--bg-surface)", display: "flex", justifyContent: "space-between", alignItems: "flex-start"
      }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          {task.codice && (
            <span style={{ fontSize: 10, fontFamily: "var(--font-mono)", color: "var(--blue-bright)", fontWeight: 600, letterSpacing: "0.1em", background: "rgba(59,130,246,0.1)", padding: "2px 8px", borderRadius: 4, border: "1px solid rgba(59,130,246,0.2)", alignSelf: "flex-start" }}>
              {task.codice}
            </span>
          )}
          <h2 style={{ fontSize: 18, fontWeight: 700, color: "var(--text-primary)", margin: 0, maxWidth: 360, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {isNew ? "Nuova Attività" : (task.nome || "Modifica Attività")}
          </h2>
        </div>
        <button onClick={onClose} style={{ background: "none", border: "none", color: "var(--text-muted)", fontSize: 26, cursor: "pointer", lineHeight: 1, padding: 4 }}>×</button>
      </div>

      {/* Body */}
      <div style={{ flex: 1, overflowY: "auto", padding: 24, display: "flex", flexDirection: "column", gap: 20 }}>
        <div>
          {fieldLabel("Titolo Attività")}
          {fieldInput({ type: "text", value: form.nome, onChange: e => setForm(f => ({ ...f, nome: e.target.value })) })}
        </div>

        <div>
          {fieldLabel("Descrizione / Istruzioni operative")}
          <textarea 
            value={form.descrizione} 
            onChange={e => setForm(f => ({ ...f, descrizione: e.target.value }))} 
            style={{
              width: "100%", background: "var(--bg-surface)",
              border: "1px solid var(--border-strong)", borderRadius: 8,
              padding: "9px 12px", fontSize: 13, color: "var(--text-primary)",
              minHeight: 110, resize: "vertical", outline: "none",
              fontFamily: "var(--font-body)", lineHeight: 1.6, boxSizing: "border-box"
            }}
          />
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
          <div>
            {fieldLabel("Frequenza (giorni)")}
            {fieldInput({ 
              type: "number", value: form.frequenza_giorni,
              onChange: e => setForm(f => ({ ...f, frequenza_giorni: parseInt(e.target.value) || 1 }))
            })}
          </div>
          <div>
            {fieldLabel("Durata stimata (ore)")}
            {fieldInput({ 
              type: "number", step: "0.5", value: form.durata_ore,
              onChange: e => setForm(f => ({ ...f, durata_ore: parseFloat(e.target.value) || 0 }))
            })}
          </div>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
          <div>
            {fieldLabel("Priorità")}
            <select 
              value={form.priorita}
              onChange={e => setForm(f => ({ ...f, priorita: e.target.value }))}
              style={{
                width: "100%", background: "var(--bg-surface)",
                border: "1px solid var(--border-strong)", borderRadius: 8,
                padding: "9px 12px", fontSize: 13, color: "var(--text-primary)",
                outline: "none", fontFamily: "var(--font-body)", appearance: "none", cursor: "pointer"
              }}
            >
              <option value="Alta">Alta</option>
              <option value="Media">Media</option>
              <option value="Bassa">Bassa</option>
            </select>
          </div>
          <div>
            {fieldLabel("Anticipo generazione (gg)")}
            {fieldInput({ 
              type: "number", value: form.generate_days_before_due,
              onChange: e => setForm(f => ({ ...f, generate_days_before_due: parseInt(e.target.value) || 0 }))
            })}
          </div>
        </div>
      </div>

      {/* Footer */}
      <div style={{
        padding: "16px 24px", borderTop: "1px solid var(--border)",
        background: "var(--bg-surface)", display: "flex", gap: 12
      }}>
        <button 
          onClick={onClose} 
          style={{
            flex: 1, padding: "10px 16px", border: "1px solid var(--border-strong)",
            borderRadius: 8, color: "var(--text-secondary)", fontSize: 13,
            fontWeight: 600, background: "transparent", cursor: "pointer"
          }}
        >
          Annulla
        </button>
        <button 
          onClick={handleSave} 
          disabled={saving}
          style={{
            flex: 2, padding: "10px 16px", background: "#6366f1",
            border: "1px solid #4f46e5", borderRadius: 8,
            color: "white", fontSize: 13, fontWeight: 700,
            cursor: saving ? "not-allowed" : "pointer", opacity: saving ? 0.75 : 1,
            transition: "all 0.15s"
          }}
        >
          {saving ? "Salvataggio..." : "Salva Modifiche"}
        </button>
      </div>
    </div>
  );
}

// ─── PAGE COMPONENT ───────────────────────────────────────────────────────────

export default function PianiPage() {
  const [piani, setPiani] = useState<Piano[]>([]);
  const [selectedPianoId, setSelectedPianoId] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");

  const [activeTab, setActiveTab] = useState<"tasks" | "manuali" | "history">("tasks");
  const [tasks, setTasks] = useState<Task[]>([]);
  const [manuali, setManuali] = useState<Manuale[]>([]);
  const [history, setHistory] = useState<TicketHistory[]>([]);
  const [fetchingContent, setFetchingContent] = useState(false);

  const [selectedTask, setSelectedTask] = useState<Task | null>(null);
  const [showModalPiano, setShowModalPiano] = useState(false);
  const [pianoToEdit, setPianoToEdit] = useState<Piano | null>(null);
  const [uploading, setUploading] = useState(false);

  const fetchPiani = useCallback(async () => {
    setLoading(true);
    try {
      const res = await apiGet<{ items: Piano[] }>("/piani-manutenzione?limit=500");
      setPiani(res.items || []);
    } catch { notify.error("Impossibile caricare i piani"); }
    finally { setLoading(false); }
  }, []);

  const fetchContent = useCallback(async (pid: number, tab: string) => {
    setFetchingContent(true);
    try {
      if (tab === "tasks") {
        const res = await apiGet<{ items: Task[] }>(`/piani-manutenzione/${pid}/tasks?limit=500`);
        setTasks(res.items || []);
      } else if (tab === "manuali") {
        const res = await apiGet<Manuale[]>(`/manuali?piano_id=${pid}`);
        setManuali(res || []);
      } else if (tab === "history") {
        const res = await apiGet<{ items: TicketHistory[] }>(`/tickets?piano_id=${pid}&limit=200`);
        setHistory(res.items || []);
      }
    } catch { notify.error(`Errore caricamento ${tab}`); }
    finally { setFetchingContent(false); }
  }, []);

  useEffect(() => { fetchPiani(); }, [fetchPiani]);

  useEffect(() => {
    if (selectedPianoId) fetchContent(selectedPianoId, activeTab);
  }, [selectedPianoId, activeTab, fetchContent]);

  const filteredPiani = useMemo(() => {
    return piani.filter(p => 
      p.nome_codificato.toLowerCase().includes(searchQuery.toLowerCase()) ||
      (p.descrizione || "").toLowerCase().includes(searchQuery.toLowerCase())
    );
  }, [piani, searchQuery]);

  const selectedPiano = useMemo(() => piani.find(p => p.id === selectedPianoId), [piani, selectedPianoId]);

  async function generateTicket(task: Task) {
    const pid = selectedPianoId;
    if (!pid) return;
    try {
      const res = await apiPost<{ created: number }>(`/piani-manutenzione/${pid}/tasks/${task.id}/genera-ticket`);
      notify.success(`${res.created} ticket generati con successo in stato APERTO`);
      fetchContent(pid, "tasks");
    } catch (err: unknown) { notify.error(err instanceof Error ? err.message : "Errore generazione ticket"); }
  }

  // ── RENDER ───────────────────────────────────────────────────────────────────

  return (
    <div className="full-bleed-page" style={{ display: "flex", background: "var(--bg-base)", minHeight: "100%" }}>
      
      {/* ── SIDEBAR PIANI (440px) ── */}
      <aside style={{ 
        width: 440, flexShrink: 0, 
        borderRight: "1px solid var(--border)", 
        background: "var(--bg-surface)",
        display: "flex", flexDirection: "column"
      }}>
        {/* Sidebar header */}
        <div style={{ padding: "20px 20px 16px", borderBottom: "1px solid var(--border)", display: "flex", flexDirection: "column", gap: 14 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <div>
              <div style={{ fontSize: 11, fontWeight: 600, color: "var(--text-muted)", letterSpacing: "0.12em", textTransform: "uppercase", marginBottom: 2 }}>
                Piani operativi
              </div>
              <div style={{ fontSize: 22, fontWeight: 800, color: "var(--text-primary)", lineHeight: 1 }}>
                Piano di Manutenzione
              </div>
            </div>
            <span style={{
              fontSize: 13, fontWeight: 700, color: "var(--blue-bright)",
              background: "rgba(59,130,246,0.1)", border: "1px solid rgba(59,130,246,0.2)",
              padding: "3px 10px", borderRadius: 20, fontFamily: "var(--font-mono)"
            }}>
              {piani.length}
            </span>
          </div>

          <button 
            onClick={() => { setPianoToEdit(null); setShowModalPiano(true); }}
            style={{
              width: "100%", padding: "10px 16px",
              background: "#6366f1", border: "1px solid #4f46e5",
              borderRadius: 8, color: "white", fontSize: 13, fontWeight: 700,
              cursor: "pointer", transition: "all 0.15s", display: "flex",
              alignItems: "center", justifyContent: "center", gap: 8
            }}
          >
            <span style={{ fontSize: 18, lineHeight: 1 }}>+</span> Definisci Nuovo Piano
          </button>

          <div style={{ position: "relative" }}>
            <input 
              type="text" 
              placeholder="Cerca piano operativo..."
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              style={{
                width: "100%", background: "var(--bg-elevated)",
                border: "1px solid var(--border-strong)", borderRadius: 8,
                padding: "9px 12px 9px 36px", fontSize: 13, color: "var(--text-primary)",
                outline: "none", fontFamily: "var(--font-body)", boxSizing: "border-box"
              }}
            />
            <span style={{ position: "absolute", left: 11, top: "50%", transform: "translateY(-50%)", fontSize: 14, opacity: 0.4 }}>🔍</span>
          </div>
        </div>

        {/* Sidebar list */}
        <div style={{ flex: 1, overflowY: "auto", padding: "12px 12px" }}>
          {loading ? (
            [1,2,3,4,5].map(i => (
              <div key={i} style={{ height: 90, background: "var(--bg-elevated)", borderRadius: 10, marginBottom: 8, animation: "pulse 1.4s infinite" }} />
            ))
          ) : filteredPiani.length === 0 ? (
            <div style={{ textAlign: "center", padding: "48px 16px", color: "var(--text-disabled)", fontSize: 13 }}>
              Nessun piano disponibile
            </div>
          ) : (
            filteredPiani.map(p => {
              const isSelected = selectedPianoId === p.id;
              return (
                <div 
                  key={p.id}
                  onClick={() => setSelectedPianoId(p.id)}
                  style={{
                    padding: "14px 16px", borderRadius: 10,
                    border: `1px solid ${isSelected ? "rgba(99,102,241,0.4)" : "transparent"}`,
                    background: isSelected ? "rgba(99,102,241,0.08)" : "transparent",
                    cursor: "pointer", marginBottom: 4, position: "relative",
                    transition: "all 0.15s"
                  }}
                  className="hover-row"
                >
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 6 }}>
                    <span style={{ fontSize: 14, fontWeight: 700, color: isSelected ? "var(--text-primary)" : "var(--text-secondary)" }}>
                      {p.nome_codificato}
                    </span>
                    <button 
                      onClick={(e) => { e.stopPropagation(); setPianoToEdit(p); setShowModalPiano(true); }}
                      style={{ background: "none", border: "none", color: "var(--text-muted)", fontSize: 14, cursor: "pointer", opacity: 0, transition: "opacity 0.15s" }}
                      className="edit-btn"
                    >
                      ✎
                    </button>
                  </div>
                  <p style={{ fontSize: 12, color: "var(--text-muted)", lineHeight: 1.5, marginBottom: 8, overflow: "hidden", display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical" as any }}>
                    {p.descrizione || "Nessuna specifica tecnica aggiuntiva."}
                  </p>
                  <div style={{ display: "flex", gap: 12 }}>
                    <span style={{ fontSize: 11, fontWeight: 600, color: "var(--blue-bright)", background: "rgba(59,130,246,0.08)", padding: "2px 8px", borderRadius: 4, border: "1px solid rgba(59,130,246,0.15)" }}>
                      {p.asset_count} asset
                    </span>
                    <span style={{ fontSize: 11, color: "var(--text-muted)" }}>
                      {p.task_count} task
                    </span>
                    {p.open_ticket_count > 0 && (
                      <span style={{ fontSize: 11, fontWeight: 600, color: "var(--amber)", background: "rgba(245,158,11,0.08)", padding: "2px 8px", borderRadius: 4, border: "1px solid rgba(245,158,11,0.15)" }}>
                        {p.open_ticket_count} aperti
                      </span>
                    )}
                  </div>
                  {isSelected && (
                    <div style={{ position: "absolute", left: 0, top: "50%", transform: "translateY(-50%)", width: 3, height: 40, background: "#6366f1", borderRadius: "0 2px 2px 0" }} />
                  )}
                </div>
              );
            })
          )}
        </div>
      </aside>

      {/* ── MAIN VIEW ── */}
      <main style={{ flex: 1, display: "flex", flexDirection: "column", minWidth: 0, background: "var(--bg-base)" }}>
        {!selectedPiano ? (
          /* Empty state — sobrio e utile */
          <div style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: 48, textAlign: "center" }}>
            <div style={{ width: 64, height: 64, background: "rgba(99,102,241,0.08)", border: "1px solid rgba(99,102,241,0.15)", borderRadius: 16, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 28, marginBottom: 20 }}>
              ⚡
            </div>
            <h2 style={{ fontSize: 20, fontWeight: 700, color: "var(--text-primary)", margin: "0 0 8px" }}>
              Seleziona un piano
            </h2>
            <p style={{ fontSize: 13, color: "var(--text-muted)", maxWidth: 380, lineHeight: 1.6, margin: 0 }}>
              Scegli un piano operativo dalla sidebar per visualizzare task, manuali e cronologia interventi. Puoi anche creare un nuovo piano con il pulsante in alto a sinistra.
            </p>
          </div>
        ) : (
          <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
            {/* Header Piano */}
            <header style={{
              padding: "24px 32px 0", borderBottom: "1px solid var(--border)",
              background: "var(--bg-surface)"
            }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 20 }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 8, flexWrap: "wrap" }}>
                    <h1 style={{ fontSize: 26, fontWeight: 800, color: "var(--text-primary)", margin: 0, letterSpacing: "-0.02em" }}>
                      {selectedPiano.nome_codificato}
                    </h1>
                    <StatoBadge label={selectedPiano.stato} />
                  </div>
                  {selectedPiano.descrizione && (
                    <p style={{ fontSize: 13, color: "var(--text-secondary)", margin: 0, lineHeight: 1.5, borderLeft: "3px solid #6366f1", paddingLeft: 12, maxWidth: 600 }}>
                      {selectedPiano.descrizione}
                    </p>
                  )}
                </div>

                <div style={{ display: "flex", gap: 12, flexShrink: 0, marginLeft: 24 }}>
                  <div style={{ background: "var(--bg-elevated)", border: "1px solid var(--border)", borderRadius: 10, padding: "12px 20px", textAlign: "center", minWidth: 110 }}>
                    <div style={{ fontSize: 10, fontWeight: 600, color: "var(--text-muted)", letterSpacing: "0.1em", textTransform: "uppercase", marginBottom: 4 }}>Attività</div>
                    <div style={{ fontSize: 24, fontWeight: 800, color: "var(--text-primary)" }}>{selectedPiano.task_count}</div>
                  </div>
                  <div style={{ background: "var(--bg-elevated)", border: "1px solid var(--border)", borderRadius: 10, padding: "12px 20px", textAlign: "center", minWidth: 110 }}>
                    <div style={{ fontSize: 10, fontWeight: 600, color: "var(--text-muted)", letterSpacing: "0.1em", textTransform: "uppercase", marginBottom: 4 }}>Ticket aperti</div>
                    <div style={{ fontSize: 24, fontWeight: 800, color: selectedPiano.open_ticket_count > 0 ? "var(--amber)" : "var(--text-primary)" }}>
                      {selectedPiano.open_ticket_count}
                    </div>
                  </div>
                </div>
              </div>

              {/* TABS */}
              <div style={{ display: "flex", gap: 4 }}>
                {[
                  { id: "tasks",   label: "Attività e Task",    icon: "⚙️" },
                  { id: "manuali", label: "Manuali Tecnici",    icon: "📚" },
                  { id: "history", label: "Cronologia Ticket",  icon: "📋" },
                ].map(tab => {
                  const active = activeTab === tab.id;
                  return (
                    <button 
                      key={tab.id}
                      onClick={() => setActiveTab(tab.id as any)}
                      style={{
                        padding: "10px 18px", border: "none", background: "transparent",
                        fontSize: 13, fontWeight: active ? 700 : 500,
                        color: active ? "var(--text-primary)" : "var(--text-muted)",
                        cursor: "pointer", position: "relative",
                        borderBottom: active ? "2px solid #6366f1" : "2px solid transparent",
                        transition: "all 0.15s", display: "flex", alignItems: "center", gap: 6
                      }}
                    >
                      <span>{tab.icon}</span> {tab.label}
                    </button>
                  );
                })}
              </div>
            </header>

            {/* TAB CONTENT */}
            <div style={{ flex: 1, overflowY: "auto", padding: "28px 32px", background: "var(--bg-base)" }}>
              
              {/* TASKS */}
              {activeTab === "tasks" && (
                <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                    <div>
                      <h3 style={{ fontSize: 16, fontWeight: 700, color: "var(--text-primary)", margin: "0 0 4px" }}>Piano operativo</h3>
                      <p style={{ fontSize: 12, color: "var(--text-muted)", margin: 0 }}>Frequenze e priorità degli interventi pianificati</p>
                    </div>
                    <div style={{ display: "flex", gap: 10 }}>
                      <label style={{
                        padding: "9px 16px", borderRadius: 8, fontSize: 12, fontWeight: 600,
                        cursor: uploading ? "not-allowed" : "pointer",
                        background: uploading ? "var(--bg-overlay)" : "var(--bg-overlay)",
                        border: "1px solid var(--border-strong)", color: "var(--text-secondary)",
                        display: "flex", alignItems: "center", gap: 8, transition: "all 0.15s"
                      }}>
                        {uploading ? "⌛ Elaborazione..." : "📤 Importa PDF"}
                        <input 
                          type="file" style={{ display: "none" }} accept=".pdf" disabled={uploading}
                          onChange={async (e) => {
                            if (!e.target.files?.[0]) return;
                            setUploading(true);
                            const fd = new FormData();
                            fd.append("file", e.target.files[0]);
                            try {
                              notify.info("Analisi AI in corso...");
                              const pid = selectedPianoId;
                              if (!pid) throw new Error("Seleziona prima un piano");
                              await apiUpload(`/piani-manutenzione/${pid}/import-pdf`, fd);
                              notify.success("Manuale importato. Task estratti.");
                              fetchContent(pid, "tasks");
                              fetchContent(pid, "manuali");
                            } catch (err: unknown) { notify.error(err instanceof Error ? err.message : "Errore import"); }
                            finally { setUploading(false); }
                          }}
                        />
                      </label>
                      <button
                        onClick={() => setSelectedTask({ id: 0, nome: "", descrizione: "", frequenza_giorni: 30, durata_ore: 1, priorita: "Media", task_stato: "active", is_repeatable: true, generate_days_before_due: 7, piano_id: selectedPianoId, asset_id: null, asset_nome: null, codice: null, generation_mode: "manual", source_type: "manual_task", next_due_at: null } as unknown as Task)}
                        style={{
                          padding: "9px 16px", background: "#6366f1", border: "1px solid #4f46e5",
                          borderRadius: 8, color: "white", fontSize: 12, fontWeight: 700,
                          cursor: "pointer", display: "flex", alignItems: "center", gap: 6
                        }}
                      >
                        + Aggiungi Task
                      </button>
                    </div>
                  </div>

                  <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                    {fetchingContent ? (
                      [1,2,3,4].map(i => <div key={i} style={{ height: 72, background: "var(--bg-elevated)", borderRadius: 10, animation: "pulse 1.4s infinite" }} />)
                    ) : tasks.length === 0 ? (
                      <div style={{ padding: "48px 24px", textAlign: "center", border: "1px dashed var(--border)", borderRadius: 12 }}>
                        <div style={{ fontSize: 14, color: "var(--text-muted)" }}>Nessun task programmato</div>
                        <div style={{ fontSize: 12, color: "var(--text-disabled)", marginTop: 6 }}>
                          Aggiungi task manualmente o importa un manuale PDF
                        </div>
                      </div>
                    ) : (
                      tasks.map(task => (
                        <div 
                          key={task.id}
                          onClick={() => setSelectedTask(task)}
                          style={{
                            display: "flex", alignItems: "center", gap: 16,
                            padding: "14px 18px", background: "var(--bg-elevated)",
                            border: "1px solid var(--border)", borderRadius: 10,
                            cursor: "pointer", transition: "all 0.15s"
                          }}
                          className="hover-row"
                        >
                          <div style={{ width: 3, height: 40, borderRadius: 2, background: task.task_stato === "active" ? "#6366f1" : "var(--border-strong)", flexShrink: 0 }} />
                          
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={{ fontSize: 14, fontWeight: 600, color: "var(--text-primary)", marginBottom: 4, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                              {task.nome || task.descrizione}
                            </div>
                            <div style={{ display: "flex", gap: 16 }}>
                              <span style={{ fontSize: 11, color: "var(--text-muted)", fontFamily: "var(--font-mono)" }}>#{task.codice || task.id}</span>
                              <span style={{ fontSize: 11, color: "var(--text-muted)" }}>ogni {task.frequenza_giorni}g</span>
                              <span style={{ fontSize: 11, color: "var(--text-muted)" }}>{task.durata_ore}h</span>
                            </div>
                          </div>

                          <PrioritaBadge label={task.priorita} />

                          <div style={{ textAlign: "right", minWidth: 100 }}>
                            <div style={{ fontSize: 13, fontWeight: 700, color: "var(--blue-bright)" }}>{fmt(task.next_due_at).split(",")[0]}</div>
                            <div style={{ fontSize: 10, color: "var(--text-disabled)", textTransform: "uppercase", letterSpacing: "0.08em" }}>Scadenza</div>
                          </div>

                          <button 
                            onClick={(e) => { e.stopPropagation(); generateTicket(task); }}
                            style={{
                              padding: "7px 14px", background: "rgba(99,102,241,0.1)",
                              border: "1px solid rgba(99,102,241,0.25)", borderRadius: 7,
                              color: "#a5b4fc", fontSize: 11, fontWeight: 600,
                              cursor: "pointer", whiteSpace: "nowrap", transition: "all 0.15s"
                            }}
                          >
                            Genera Ticket
                          </button>
                        </div>
                      ))
                    )}
                  </div>
                </div>
              )}

              {/* MANUALI */}
              {activeTab === "manuali" && (
                <div>
                  <h3 style={{ fontSize: 16, fontWeight: 700, color: "var(--text-primary)", margin: "0 0 20px" }}>Manuali Tecnici</h3>
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))", gap: 16 }}>
                    {fetchingContent ? (
                      [1,2,3].map(i => <div key={i} style={{ height: 200, background: "var(--bg-elevated)", borderRadius: 12, animation: "pulse 1.4s infinite" }} />)
                    ) : manuali.length === 0 ? (
                      <div style={{ gridColumn: "1/-1", padding: "48px 24px", textAlign: "center", border: "1px dashed var(--border)", borderRadius: 12 }}>
                        <div style={{ fontSize: 14, color: "var(--text-muted)" }}>Nessun documento tecnico caricato</div>
                        <div style={{ fontSize: 12, color: "var(--text-disabled)", marginTop: 6 }}>Importa un PDF dalla sezione Attività</div>
                      </div>
                    ) : (
                      manuali.map(m => (
                        <div key={m.id} style={{ background: "var(--bg-elevated)", border: "1px solid var(--border)", borderRadius: 12, padding: 20, display: "flex", flexDirection: "column", justifyContent: "space-between", minHeight: 180, transition: "border-color 0.15s" }}>
                          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                            <div style={{ width: 40, height: 40, background: "rgba(239,68,68,0.1)", borderRadius: 8, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 11, fontWeight: 700, color: "var(--red)", border: "1px solid rgba(239,68,68,0.2)" }}>PDF</div>
                            <h4 style={{ fontSize: 14, fontWeight: 700, color: "var(--text-primary)", margin: 0, lineHeight: 1.4 }}>{m.nome}</h4>
                            <div style={{ display: "flex", gap: 12, fontSize: 11, color: "var(--text-muted)" }}>
                              <span>{m.pagine} pagine</span>
                              <span>·  {m.task_count} task</span>
                            </div>
                          </div>
                          <button style={{ width: "100%", padding: "8px 0", marginTop: 12, background: "var(--bg-overlay)", border: "1px solid var(--border)", borderRadius: 8, color: "var(--text-secondary)", fontSize: 12, fontWeight: 600, cursor: "pointer" }}>
                            Sfoglia documento
                          </button>
                        </div>
                      ))
                    )}
                  </div>
                </div>
              )}

              {/* HISTORY */}
              {activeTab === "history" && (
                <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
                  <h3 style={{ fontSize: 16, fontWeight: 700, color: "var(--text-primary)", margin: 0 }}>Storico Interventi del Piano</h3>
                  <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                    {fetchingContent ? (
                      [1,2,3,4].map(i => <div key={i} style={{ height: 68, background: "var(--bg-elevated)", borderRadius: 10, animation: "pulse 1.4s infinite" }} />)
                    ) : history.length === 0 ? (
                      <div style={{ padding: "48px 24px", textAlign: "center", border: "1px dashed var(--border)", borderRadius: 12 }}>
                        <div style={{ fontSize: 14, color: "var(--text-muted)" }}>Nessun ticket emesso per questo piano</div>
                      </div>
                    ) : (
                      history.map(tk => (
                        <div key={tk.id} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "12px 18px", background: "var(--bg-elevated)", border: "1px solid var(--border)", borderRadius: 10, transition: "background 0.15s" }} className="hover-row">
                          <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
                            <span style={{ fontSize: 11, fontFamily: "var(--font-mono)", color: "var(--blue-bright)", background: "rgba(59,130,246,0.08)", padding: "2px 8px", borderRadius: 4, border: "1px solid rgba(59,130,246,0.15)" }}>
                              T-{tk.id}
                            </span>
                            <div>
                              <div style={{ fontSize: 13, fontWeight: 600, color: "var(--text-primary)", marginBottom: 2 }}>{tk.titolo}</div>
                              <div style={{ fontSize: 11, color: "var(--text-muted)" }}>
                                {fmt(tk.created_at)}  ·  Priorità {tk.priorita}
                              </div>
                            </div>
                          </div>
                          <StatoBadge label={tk.stato} />
                        </div>
                      ))
                    )}
                  </div>
                </div>
              )}
            </div>
          </div>
        )}
      </main>

      {/* OVERLAYS */}
      {showModalPiano && (
        <ModalPiano 
          piano={pianoToEdit} 
          onClose={() => setShowModalPiano(false)} 
          onSaved={p => { fetchPiani(); setShowModalPiano(false); setSelectedPianoId(p.id); }} 
        />
      )}

      {selectedTask !== null && selectedPianoId && (
        <DrawerTask 
          task={selectedTask} 
          pianoId={selectedPianoId} 
          onClose={() => setSelectedTask(null)}
          onUpdated={t => { 
            if (selectedPianoId) fetchContent(selectedPianoId, "tasks");
            setSelectedTask(null);
          }}
        />
      )}
    </div>
  );
}
