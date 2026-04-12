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
  criticita?: string;
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
  updated_at: string | null;
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
  last_generated_at: string | null;
  next_due_at: string | null;
  open_ticket_count: number;
};

type Manuale = {
  id: number;
  nome: string;
  pagine: number;
  metodo: string;
  stato: string;
  task_count: number;
};

type TicketHistory = {
  id: number;
  titolo: string;
  stato: string;
  priorita: string;
  durata_stimata_ore: number;
  created_at: string | null;
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmt(iso: string | null) {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("it-IT", { day: "2-digit", month: "long", year: "numeric" });
}

const PRIORITA_STYLES: Record<string, string> = {
  Alta: "bg-red-500/10 text-red-500 border-red-500/20",
  Media: "bg-amber-500/10 text-amber-500 border-amber-500/20",
  Bassa: "bg-emerald-500/10 text-emerald-500 border-emerald-500/20",
};

const STATO_TICKET_STYLES: Record<string, string> = {
  Aperto: "text-blue-500 bg-blue-500/10 border-blue-500/20",
  Pianificato: "text-amber-500 bg-amber-500/10 border-amber-500/20",
  "In corso": "text-indigo-500 bg-indigo-500/10 border-indigo-500/20",
  Chiuso: "text-emerald-500 bg-emerald-500/10 border-emerald-500/20",
};

// ─── Componenti UI ────────────────────────────────────────────────────────────

function Badge({ label, className }: { label: string; className?: string }) {
  return (
    <span className={cn("px-2.5 py-0.5 rounded-full text-[10px] font-black uppercase tracking-widest border", className)}>
      {label}
    </span>
  );
}

// ─── Componente: Selezione Asset Scalabile ───────────────────────────────────

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
    } catch { notify.error("Errore ricerca asset"); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => {
    const timer = setTimeout(() => search(query), 300);
    return () => clearTimeout(timer);
  }, [query, search]);

  return (
    <div className="space-y-4">
      <div className="flex gap-2">
        <div className="relative flex-1">
          <input 
            type="text" 
            placeholder="Cerca per nome, codice o descrizione..."
            value={query}
            onChange={e => setQuery(e.target.value)}
            className="w-full bg-white/5 border border-white/10 rounded-xl py-2.5 pl-10 pr-4 text-sm text-white focus:outline-none focus:ring-2 focus:ring-indigo-500 transition-all"
          />
          <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-white/20">🔍</span>
        </div>
        <button 
          type="button"
          onClick={() => onSelectAll(results.map(r => r.id))}
          className="px-4 py-2 bg-indigo-500/10 hover:bg-indigo-500/20 text-indigo-400 text-[10px] font-black uppercase tracking-widest border border-indigo-500/20 rounded-xl transition-all"
        >
          Aggiungi Tutti
        </button>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 max-h-[300px] overflow-y-auto pr-2 custom-scrollbar">
        {loading ? (
          <div className="col-span-2 py-10 text-center text-white/20 italic text-xs uppercase tracking-widest">Ricerca in corso...</div>
        ) : results.length === 0 ? (
          <div className="col-span-2 py-10 text-center text-white/20 italic text-xs uppercase tracking-widest">Nessun asset trovato</div>
        ) : (
          results.map(asset => (
            <div 
              key={asset.id}
              onClick={() => onToggle(asset.id)}
              className={cn(
                "p-3 rounded-xl border cursor-pointer transition-all flex items-center justify-between group",
                selectedIds.includes(asset.id) 
                  ? "bg-indigo-500/10 border-indigo-500/50" 
                  : "bg-white/5 border-white/5 hover:border-white/20"
              )}
            >
              <div className="flex flex-col min-w-0">
                <span className={cn("text-sm font-bold truncate", selectedIds.includes(asset.id) ? "text-indigo-300" : "text-white/80")}>
                  {asset.nome}
                </span>
                <span className="text-[10px] text-white/30 truncate">{asset.codice} • {asset.impianto_nome}</span>
              </div>
              <div className={cn(
                "w-5 h-5 rounded-lg border flex items-center justify-center transition-all",
                selectedIds.includes(asset.id) ? "bg-indigo-500 border-indigo-500" : "border-white/20 group-hover:border-white/40"
              )}>
                {selectedIds.includes(asset.id) && <span className="text-white text-xs">✓</span>}
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

// ─── MODAL: Nuovo Piano ─────────────────────────────────────────────────────

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
      notify.error("Seleziona almeno un asset per procedere.");
      return;
    }
    setSaving(true);
    try {
      const res = piano 
        ? await apiPut<Piano>(`/piani-manutenzione/${piano.id}`, form)
        : await apiPost<Piano>("/piani-manutenzione", form);
      notify.success(piano ? "Piano aggiornato" : `Piano ${res.nome_codificato} creato con successo`);
      onSaved(res);
    } catch (err: unknown) {
      notify.error(err instanceof Error ? err.message : "Errore durante il salvataggio");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 bg-black/80 backdrop-blur-md z-[100] flex items-center justify-center p-4">
      <div className="bg-[#111827] border border-white/10 rounded-3xl w-full max-w-2xl shadow-2xl overflow-hidden animate-in fade-in zoom-in duration-200">
        <div className="px-8 py-6 border-b border-white/5 flex justify-between items-center bg-white/5">
          <div className="space-y-1">
            <h3 className="text-xl font-black text-white uppercase tracking-wider">
              {piano ? "Modifica Piano" : "Definizione Nuovo Piano"}
            </h3>
            <p className="text-sm text-white/30 font-medium italic">Configura il contesto operativo e associa gli asset.</p>
          </div>
          <button onClick={onClose} className="text-white/20 hover:text-white transition-colors text-3xl leading-none">&times;</button>
        </div>

        <form onSubmit={submit} className="p-8 space-y-8">
          <div>
            <label className="block text-[10px] font-black text-white/40 uppercase tracking-[0.2em] mb-3">Descrizione Operativa</label>
            <textarea 
              value={form.descrizione}
              onChange={e => setForm(f => ({ ...f, descrizione: e.target.value }))}
              placeholder="es. Piano Manutenzione Cabine MT - Sito Roma Nord..."
              className="w-full bg-white/5 border border-white/10 rounded-2xl p-4 text-sm text-white focus:outline-none focus:ring-2 focus:ring-indigo-500 transition-all resize-none h-24"
              required
            />
          </div>

          <div>
            <label className="block text-[10px] font-black text-white/40 uppercase tracking-[0.2em] mb-3">Asset Associati ({form.asset_ids.length} selezionati)</label>
            <AssetSelector 
              selectedIds={form.asset_ids} 
              onToggle={id => setForm(f => ({ ...f, asset_ids: f.asset_ids.includes(id) ? f.asset_ids.filter(x => x !== id) : [...f.asset_ids, id]}))}
              onSelectAll={ids => setForm(f => {
                const newIds = new Set([...f.asset_ids, ...ids]);
                return { ...f, asset_ids: Array.from(newIds) };
              })}
            />
          </div>

          <div className="flex gap-4 pt-4">
            <button 
              type="button" 
              onClick={onClose}
              className="flex-1 py-4 px-6 border border-white/10 rounded-2xl text-white/40 text-xs font-black uppercase tracking-widest hover:bg-white/5 transition-all"
            >
              Annulla
            </button>
            <button 
              type="submit"
              disabled={saving}
              className="flex-[2] py-4 px-6 bg-indigo-500 hover:bg-indigo-400 text-white rounded-2xl text-xs font-black uppercase tracking-widest transition-all shadow-xl shadow-indigo-500/20 disabled:opacity-50"
            >
              {saving ? "Salvataggio in corso..." : (piano ? "Aggiorna Configurazione" : "Inizializza Piano di Manutenzione")}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ─── DRAWER: Dettaglio Task ──────────────────────────────────────────────────

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
  const [history, setHistory] = useState<TicketHistory[]>([]);
  const [loading, setLoading] = useState(true);
  const [editMode, setEditMode] = useState(false);
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

  useEffect(() => {
    async function fetchHistory() {
      try {
        const res = await apiGet<TicketHistory[]>(`/piani-manutenzione/${pianoId}/tasks/${task.id}/tickets`);
        setHistory(res || []);
      } catch { setHistory([]); }
      finally { setLoading(false); }
    }
    fetchHistory();
  }, [task.id, pianoId]);

  async function handleSave() {
    try {
      const res = await apiPut<Task>(`/piani-manutenzione/${pianoId}/tasks/${task.id}`, form);
      notify.success("Parametri attività aggiornati");
      onUpdated(res);
      setEditMode(false);
    } catch (err: unknown) {
      notify.error(err instanceof Error ? err.message : "Errore aggiornamento task");
    }
  }

  return (
    <div className="fixed inset-y-0 right-0 w-full sm:w-[500px] bg-[#0c111d] border-l border-white/10 z-[80] shadow-[0_0_100px_rgba(0,0,0,0.8)] flex flex-col animate-in slide-in-from-right duration-500 ease-out">
      <div className="p-8 border-b border-white/5 flex justify-between items-center bg-white/5">
        <div className="space-y-1">
          <Badge label={task.codice || `#${task.id}`} className="bg-white/10 text-white/60 mb-1" />
          <h2 className="text-lg font-black text-white uppercase tracking-tight truncate max-w-[320px]">
            {task.nome || task.descrizione}
          </h2>
        </div>
        <button onClick={onClose} className="text-white/20 hover:text-white transition-colors text-3xl">&times;</button>
      </div>

      <div className="flex-1 overflow-y-auto p-8 space-y-10 custom-scrollbar">
        {/* PARAMETRI OPERATIVI */}
        <div className="space-y-6">
          <div className="flex justify-between items-end">
            <h3 className="text-[10px] font-black text-white/30 uppercase tracking-[0.2em]">Configurazione Operatva</h3>
            {!editMode ? (
              <button onClick={() => setEditMode(true)} className="text-[10px] font-black text-indigo-400 hover:text-indigo-300 uppercase tracking-widest decoration-dotted underline underline-offset-4">Modifica</button>
            ) : (
              <div className="flex gap-4">
                <button onClick={() => setEditMode(false)} className="text-[10px] font-black text-white/20 hover:text-white/40 uppercase tracking-widest">Annulla</button>
                <button onClick={handleSave} className="text-[10px] font-black text-emerald-400 hover:text-emerald-300 uppercase tracking-widest">Salva modifiche</button>
              </div>
            )}
          </div>

          {!editMode ? (
             <div className="grid grid-cols-2 gap-4">
              <div className="bg-white/5 p-4 rounded-2xl border border-white/5 space-y-1">
                <span className="text-[9px] font-black text-white/20 uppercase tracking-widest">Frequenza</span>
                <p className="text-sm font-bold text-white uppercase">{task.frequenza_giorni} giorni</p>
              </div>
              <div className="bg-white/5 p-4 rounded-2xl border border-white/5 space-y-1">
                <span className="text-[9px] font-black text-white/20 uppercase tracking-widest">Priorità</span>
                <Badge label={task.priorita} className={PRIORITA_STYLES[task.priorita]} />
              </div>
              <div className="bg-white/5 p-4 rounded-2xl border border-white/5 space-y-1">
                <span className="text-[9px] font-black text-white/20 uppercase tracking-widest">Durata Stimata</span>
                <p className="text-sm font-bold text-white uppercase">{task.durata_ore} ore uomo</p>
              </div>
              <div className="bg-white/5 p-4 rounded-2xl border border-white/5 space-y-1">
                <span className="text-[9px] font-black text-white/20 uppercase tracking-widest">Pianificazione</span>
                <p className="text-sm font-bold text-white uppercase">{task.generation_mode === 'auto' ? `Auto (${task.generate_days_before_due}g d'anticipo)` : 'Manuale'}</p>
              </div>
              <div className="col-span-2 bg-white/5 p-4 rounded-2xl border border-white/5 space-y-1">
                <span className="text-[9px] font-black text-white/20 uppercase tracking-widest">Istruzioni Operative</span>
                <p className="text-sm text-white/60 leading-relaxed italic">&quot;{task.descrizione}&quot;</p>
              </div>
            </div>
          ) : (
            <div className="space-y-4 animate-in fade-in duration-200">
               <div>
                <label className="text-[9px] font-black text-white/20 uppercase mb-1 block">Titolo Attività</label>
                <input type="text" value={form.nome} onChange={e => setForm(f => ({ ...f, nome: e.target.value }))} className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-2 text-sm text-white focus:outline-none focus:ring-1 focus:ring-indigo-500" />
              </div>
              <div>
                <label className="text-[9px] font-black text-white/20 uppercase mb-1 block">Descrizione/Istruzioni</label>
                <textarea value={form.descrizione} onChange={e => setForm(f => ({ ...f, descrizione: e.target.value }))} className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-2 text-sm text-white h-24 focus:outline-none focus:ring-1 focus:ring-indigo-500" />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="text-[9px] font-black text-white/20 uppercase mb-1 block">Frequenza (gg)</label>
                  <input type="number" value={form.frequenza_giorni} onChange={e => setForm(f => ({ ...f, frequenza_giorni: parseInt(e.target.value) || 0 }))} className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-2 text-sm text-white focus:outline-none" />
                </div>
                <div>
                  <label className="text-[9px] font-black text-white/20 uppercase mb-1 block">Durata (ore)</label>
                  <input type="number" step="0.5" value={form.durata_ore} onChange={e => setForm(f => ({ ...f, durata_ore: parseFloat(e.target.value) || 0 }))} className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-2 text-sm text-white focus:outline-none" />
                </div>
              </div>
            </div>
          )}
        </div>

        {/* STORICO TICKET */}
        <div className="space-y-6">
          <h3 className="text-[10px] font-black text-white/30 uppercase tracking-[0.2em]">Cronologia Interventi</h3>
          <div className="space-y-3">
            {loading ? (
              [1, 2, 3].map(i => <div key={i} className="h-20 bg-white/5 rounded-2xl animate-pulse" />)
            ) : history.length === 0 ? (
              <div className="py-12 text-center rounded-3xl border border-dashed border-white/5">
                <p className="text-xs text-white/20 uppercase font-black italic">Nessun ticket emesso</p>
              </div>
            ) : (
              history.map(ticket => (
                <div key={ticket.id} className="bg-white/5 border border-white/5 p-4 rounded-2xl hover:bg-white/[0.08] transition-all group">
                  <div className="flex justify-between items-start mb-2">
                    <span className="text-sm font-bold text-white group-hover:text-indigo-400 transition-colors">#{ticket.id} {ticket.titolo}</span>
                    <Badge label={ticket.stato} className={STATO_TICKET_STYLES[ticket.stato] || "bg-white/5 text-white/30 border-white/10"} />
                  </div>
                  <div className="flex gap-4 text-[10px] font-black text-white/20 uppercase tracking-widest">
                    <span>📅 {fmt(ticket.created_at)}</span>
                    <span>⏱ {ticket.durata_stimata_ore} ore</span>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      </div>

      <div className="p-8 border-t border-white/5 bg-white/5 flex gap-4">
        <button 
          onClick={onClose}
          className="flex-1 py-4 text-xs font-black uppercase text-white/30 hover:text-white transition-all tracking-[0.2em]"
        >
          Chiudi Pannello
        </button>
      </div>
    </div>
  );
}

// ─── PAGE COMPONENT ──────────────────────────────────────────────────────────

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
  const [uploading, setUploading] = useState(false);

  const [selectedTask, setSelectedTask] = useState<Task | null>(null);
  const [showModalPiano, setShowModalPiano] = useState(false);
  const [pianoToEdit, setPianoToEdit] = useState<Piano | null>(null);

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
    } catch (err: unknown) {
      notify.error(err instanceof Error ? err.message : `Errore caricamento ${tab}`);
    } finally {
      setFetchingContent(false);
    }
  }, []);

  useEffect(() => { fetchPiani(); }, [fetchPiani]);

  useEffect(() => {
    if (selectedPianoId) fetchContent(selectedPianoId, activeTab);
  }, [selectedPianoId, activeTab, fetchContent]);

  const filteredPiani = useMemo(() => {
    return piani.filter(p => 
      p.nome_codificato.toLowerCase().includes(searchQuery.toLowerCase()) ||
      p.descrizione?.toLowerCase().includes(searchQuery.toLowerCase())
    );
  }, [piani, searchQuery]);

  const selectedPiano = useMemo(() => piani.find(p => p.id === selectedPianoId), [piani, selectedPianoId]);

  async function deletePiano(id: number) {
    if (!confirm("Eliminare definitivamente questo piano di manutenzione? L'azione non è reversibile.")) return;
    try {
      await apiDelete(`/piani-manutenzione/${id}`);
      notify.success("Piano eliminato correttamente");
      setPiani(p => p.filter(x => x.id !== id));
      if (selectedPianoId === id) setSelectedPianoId(null);
    } catch (err: unknown) { 
      notify.error(err instanceof Error ? err.message : "Errore eliminazione"); 
    }
  }

  async function setTicketTask(task: Task) {
    try {
      const res = await apiPost<{ created: number }>(`/piani-manutenzione/${selectedPianoId}/tasks/${task.id}/genera-ticket`);
      notify.success(`${res.created} ticket generati correttamente`);
      fetchContent(selectedPianoId!, "tasks");
    } catch (err: unknown) { 
      notify.error(err instanceof Error ? err.message : "Errore generazione ticket"); 
    }
  }

  // Render Skeleton per lista
  const SkeletonItem = () => <div className="h-20 bg-white/5 border border-white/5 rounded-2xl animate-pulse" />;

  return (
    <div className="flex h-full bg-[#030712] overflow-hidden">
      
      {/* ── PANEL 1: SIDEBAR PIANI ── */}
      <aside className="w-[320px] flex-shrink-0 border-r border-white/10 bg-[#0c111d]/50 backdrop-blur-3xl flex flex-col">
        <div className="p-6 border-b border-white/10 space-y-4">
          <div className="flex justify-between items-center">
            <h2 className="text-[11px] font-black text-white/30 uppercase tracking-[0.2em]">Piani di Manutenzione</h2>
            <div className="w-6 h-6 rounded-lg bg-indigo-500/10 border border-indigo-500/20 flex items-center justify-center text-[10px] font-black text-indigo-400">
              {piani.length}
            </div>
          </div>
          <button 
            onClick={() => { setPianoToEdit(null); setShowModalPiano(true); }}
            className="w-full py-4 bg-indigo-500 hover:bg-indigo-400 text-white rounded-2xl text-[11px] font-black uppercase tracking-[0.1em] transition-all shadow-xl shadow-indigo-500/20"
          >
            + Definisci Nuovo Piano
          </button>
          <div className="relative">
            <input 
              type="text" 
              placeholder="Cerca piano..."
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              className="w-full bg-white/5 border border-white/5 rounded-xl py-2 px-9 text-xs text-white focus:outline-none focus:border-indigo-500 transition-all"
            />
            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-white/20 text-xs">🔍</span>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto px-4 py-6 space-y-2 custom-scrollbar">
          {loading ? (
             [1,2,3,4,5].map(i => <SkeletonItem key={i} />)
          ) : filteredPiani.length === 0 ? (
            <div className="text-center py-20 text-[10px] font-black text-white/10 uppercase tracking-widest italic">Nessun piano presente</div>
          ) : (
            filteredPiani.map(p => (
              <div 
                key={p.id}
                onClick={() => setSelectedPianoId(p.id)}
                className={cn(
                  "p-4 rounded-3xl border cursor-pointer transition-all relative group",
                  selectedPianoId === p.id 
                    ? "bg-indigo-500/10 border-indigo-500/50" 
                    : "bg-transparent border-transparent hover:bg-white/5 hover:border-white/10"
                )}
              >
                <div className="flex justify-between items-start mb-2">
                  <span className={cn("text-sm font-black uppercase tracking-tight", selectedPianoId === p.id ? "text-indigo-400" : "text-white/80")}>
                    {p.nome_codificato}
                  </span>
                  <div className="flex opacity-0 group-hover:opacity-100 transition-opacity">
                    <button onClick={(e) => { e.stopPropagation(); setPianoToEdit(p); setShowModalPiano(true); }} className="p-1.5 text-white/20 hover:text-white">✎</button>
                    <button onClick={(e) => { e.stopPropagation(); deletePiano(p.id); }} className="p-1.5 text-red-500/20 hover:text-red-500">✕</button>
                  </div>
                </div>
                <p className="text-[11px] text-white/40 font-medium line-clamp-2 mb-3 leading-relaxed">
                  {p.descrizione || "Nessuna descrizione configurata."}
                </p>
                <div className="flex gap-2">
                  <div className="bg-white/5 px-2 py-0.5 rounded text-[9px] font-black text-white/30 uppercase tracking-[0.1em]">
                    {p.asset_count} Asset
                  </div>
                  <div className="bg-white/5 px-2 py-0.5 rounded text-[9px] font-black text-white/30 uppercase tracking-[0.1em]">
                    {p.task_count} Task
                  </div>
                </div>
                {selectedPianoId === p.id && <div className="absolute left-0 top-1/2 -translate-y-1/2 w-1 h-8 bg-indigo-500 rounded-r-full" />}
              </div>
            ))
          )}
        </div>
      </aside>

      {/* ── PANEL 2: CONTENT AREA ── */}
      <main className="flex-1 flex flex-col min-w-0 bg-gradient-to-br from-[#030712] to-[#0c111d]">
        {!selectedPiano ? (
          <div className="flex-1 flex flex-col items-center justify-center text-center p-20 animate-in fade-in duration-700">
             <div className="w-32 h-32 bg-indigo-500/5 border border-indigo-500/10 rounded-[48px] flex items-center justify-center text-6xl text-indigo-500/20 mb-10 shadow-inner">⚡</div>
             <h2 className="text-4xl font-black text-white uppercase tracking-[0.4em] mb-4">Gestore Piani</h2>
             <p className="text-base text-white/20 max-w-lg font-medium leading-relaxed italic">
               Seleziona o crea un piano per definire attività cicliche, caricare manuali e monitorare lo stato di manutenzione programmata.
             </p>
          </div>
        ) : (
          <>
            {/* Header del Piano */}
            <header className="px-10 pt-10 pb-0 border-b border-white/10 bg-white/[0.02]">
              <div className="flex justify-between items-start mb-10">
                <div className="space-y-4">
                  <div className="flex items-center gap-6">
                    <h1 className="text-4xl font-black text-white tracking-widest uppercase leading-none">
                      {selectedPiano.nome_codificato}
                    </h1>
                    <Badge label={selectedPiano.stato} className="text-emerald-400 bg-emerald-500/10 border-emerald-500/20" />
                  </div>
                  {selectedPiano.descrizione && (
                    <p className="text-sm text-white/40 max-w-2xl leading-relaxed italic border-l-2 border-white/10 pl-4 py-1">&quot;{selectedPiano.descrizione}&quot;</p>
                  )}
                </div>

                <div className="flex gap-4">
                  <div className="bg-white/5 p-4 rounded-3xl border border-white/10 flex flex-col items-center justify-center min-w-[120px]">
                    <span className="text-[10px] font-black text-white/20 uppercase tracking-widest mb-1">Task Aperti</span>
                    <span className="text-3xl font-black text-indigo-400">{selectedPiano.task_count}</span>
                  </div>
                  <div className="bg-white/5 p-4 rounded-3xl border border-white/10 flex flex-col items-center justify-center min-w-[120px]">
                    <span className="text-[10px] font-black text-white/20 uppercase tracking-widest mb-1">Ticket Attivi</span>
                    <span className="text-3xl font-black text-amber-500">{selectedPiano.open_ticket_count}</span>
                  </div>
                </div>
              </div>

              {/* TABS */}
              <div className="flex gap-4">
                {[
                  { id: "tasks", label: "Attività e Task", icon: "⚙️" },
                  { id: "manuali", label: "Manuali Tecnici", icon: "📚" },
                  { id: "history", label: "Cronologia Ticket", icon: "📋" },
                ].map(tab => {
                  const active = activeTab === tab.id;
                  return (
                    <button 
                      key={tab.id}
                      onClick={() => setActiveTab(tab.id as any)}
                      className={cn(
                        "px-10 py-5 text-[11px] font-black uppercase tracking-[0.2em] transition-all relative flex items-center gap-3 rounded-t-3xl",
                        active 
                          ? "text-indigo-400 bg-[#0c111d] border-t border-x border-white/10" 
                          : "text-white/20 hover:text-white/40 hover:bg-white/[0.02]"
                      )}
                    >
                      <span className="text-base opacity-40">{tab.icon}</span> {tab.label}
                      {active && <div className="absolute -bottom-[2px] left-0 right-0 h-[4px] bg-[#0c111d] z-[20]" />}
                      {active && <div className="absolute bottom-[2px] left-6 right-6 h-[2px] bg-indigo-500/50 z-[30] rounded-full" />}
                    </button>
                  );
                })}
              </div>
            </header>

            {/* TAB CONTENT */}
            <div className="flex-1 overflow-y-auto p-10 custom-scrollbar bg-[#0c111d]">
              
              {/* TASKS VIEW */}
              {activeTab === "tasks" && (
                <div className="animate-in fade-in slide-in-from-bottom-5 duration-300 space-y-8">
                  <div className="flex justify-between items-center">
                    <div className="space-y-1">
                      <h3 className="text-xs font-black text-white uppercase tracking-widest">Ingegneria di Manutenzione</h3>
                      <p className="text-xs text-white/30 font-medium">Elenco dei task ciclici configurati per questo gruppo di asset.</p>
                    </div>
                    <div className="flex gap-4">
                       <label className={cn(
                        "flex items-center gap-3 px-6 py-3 border rounded-2xl text-[11px] font-black uppercase tracking-widest transition-all cursor-pointer shadow-lg shadow-indigo-500/10",
                        uploading 
                          ? "bg-white/5 text-white/20 border-white/5 cursor-not-allowed" 
                          : "bg-indigo-500/10 hover:bg-indigo-500 text-indigo-400 hover:text-white border-indigo-500/20"
                      )}>
                        <span>{uploading ? "⌛ Elaborazione AI..." : "📤 Upload Manuale PDF"}</span>
                        <input type="file" className="hidden" accept=".pdf" disabled={uploading}
                          onChange={async (e) => {
                             if (!e.target.files?.[0] || !selectedPianoId) return;
                             setUploading(true);
                             const fd = new FormData();
                             fd.append("file", e.target.files[0]);
                             try {
                               notify.info("Estrazione AI in corso...");
                               await apiUpload(`/piani-manutenzione/${selectedPianoId}/import-pdf`, fd);
                               notify.success("Manuale processato con successo. Attività estratte.");
                               fetchContent(selectedPianoId, "tasks");
                               fetchContent(selectedPianoId, "manuali");
                               setActiveTab("tasks");
                             } catch (err: unknown) { 
                               notify.error(err instanceof Error ? err.message : "Errore upload manuale"); 
                             }
                             finally { setUploading(false); }
                          }}
                        />
                      </label>
                      <button 
                        onClick={() => setSelectedTask(null)} // Da implementare se vogliamo create anche qui
                        className="px-6 py-3 bg-white/5 hover:bg-white/10 border border-white/10 text-white text-[11px] font-black uppercase tracking-widest rounded-2xl transition-all"
                      >
                        + Nuovo Task Manuale
                      </button>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 gap-2 border-t border-white/5 pt-6">
                    {fetchingContent ? (
                      [1,2,3,4,5].map(i => <SkeletonItem key={i} />)
                    ) : tasks.length === 0 ? (
                      <div className="py-32 text-center rounded-[40px] border border-dashed border-white/5 bg-white/[0.01]">
                        <p className="text-xl font-black text-white/10 uppercase tracking-[0.2em] italic underline decoration-dotted">Nessuna attività programmata</p>
                      </div>
                    ) : (
                      tasks.map(task => (
                        <div 
                          key={task.id}
                          onClick={() => setSelectedTask(task)}
                          className="group bg-white/5 hover:bg-white/[0.08] border border-white/5 hover:border-indigo-500/30 p-5 rounded-3xl transition-all cursor-pointer flex items-center gap-8"
                        >
                          <div className={cn("w-1.5 h-12 rounded-full", task.task_stato === 'active' ? 'bg-indigo-500 shadow-[0_0_10px_rgba(99,102,241,0.5)]' : 'bg-white/10')} />
                          <div className="flex-1 min-w-0">
                            <h4 className="text-sm font-black text-white group-hover:text-indigo-400 transition-colors uppercase tracking-tight truncate">{task.nome || task.descrizione}</h4>
                            <div className="flex gap-4 mt-1.5 text-[10px] font-black text-white/20 uppercase tracking-[0.1em]">
                              <span>{task.codice || `#${task.id}`}</span>
                              <span>• {task.frequenza_giorni}g</span>
                              <span>• {task.durata_ore}h</span>
                              {task.source_type === 'imported_from_manual' && <span className="text-indigo-500/50">ESTRATTO AI</span>}
                            </div>
                          </div>
                          <div className="w-40">
                             <Badge label={task.priorita} className={PRIORITA_STYLES[task.priorita]} />
                          </div>
                          <div className="w-48 text-right pr-4">
                            <span className="text-xs font-black text-indigo-300 block mb-0.5">{fmt(task.next_due_at)}</span>
                            <span className="text-[9px] font-black text-white/20 uppercase tracking-widest">Scadenza Attesa</span>
                          </div>
                          <div className="opacity-0 group-hover:opacity-100 transition-all flex gap-3 pl-4 border-l border-white/10">
                            <button 
                              onClick={(e) => { e.stopPropagation(); setTicketTask(task); }}
                              className="px-5 py-2.5 bg-indigo-500 text-white rounded-xl text-[10px] font-black uppercase tracking-widest shadow-lg shadow-indigo-500/20 active:scale-95 transition-all"
                            >
                              GENERA ORA
                            </button>
                          </div>
                        </div>
                      ))
                    )}
                  </div>
                </div>
              )}

              {/* MANUALI VIEW */}
              {activeTab === "manuali" && (
                <div className="animate-in fade-in slide-in-from-bottom-5 duration-300 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
                  {fetchingContent ? (
                     [1,2,3].map(i => <div key={i} className="h-60 bg-white/5 rounded-3xl animate-pulse" />)
                  ) : manuali.length === 0 ? (
                    <div className="col-span-full py-32 text-center text-white/20 text-xs font-black uppercase tracking-widest italic opacity-50 underline decoration-dotted">Nessun manuale tecnico archiviato per questo piano.</div>
                  ) : (
                    manuali.map(m => (
                      <div key={m.id} className="bg-white/5 border border-white/10 p-6 rounded-[32px] hover:bg-white/[0.08] transition-all flex flex-col justify-between group h-64">
                         <div className="space-y-4">
                           <div className="w-12 h-12 bg-white/5 rounded-2xl flex items-center justify-center text-2xl text-white/20 group-hover:text-red-500 transition-all group-hover:bg-red-500/10">PDF</div>
                           <h4 className="text-sm font-black text-white leading-tight uppercase group-hover:text-white transition-colors">{m.nome}</h4>
                           <div className="flex gap-3 text-[10px] font-black text-white/20 uppercase">
                             <span>{m.pagine} Pagine</span>
                             <span>• {m.task_count} Task estratti</span>
                           </div>
                         </div>
                         <button className="w-full py-3 bg-white/5 group-hover:bg-white/10 border border-white/10 rounded-2xl text-[10px] font-black text-white/40 group-hover:text-white uppercase tracking-widest transition-all">Sfoglia Documento</button>
                      </div>
                    ))
                  )}
                </div>
              )}

              {/* HISTORY VIEW */}
              {activeTab === "history" && (
                <div className="animate-in fade-in slide-in-from-bottom-5 duration-300 space-y-6">
                    <h3 className="text-xs font-black text-white/30 uppercase tracking-widest mb-10">Cronologia Completa Interventi Piano</h3>
                    <div className="space-y-3">
                      {fetchingContent ? (
                        [1,2,3,4,5].map(i => <SkeletonItem key={i} />)
                      ) : history.length === 0 ? (
                        <div className="py-32 text-center text-white/10 uppercase font-black italic underline decoration-dotted">Nessuna attività registrata nello storico.</div>
                      ) : (
                        history.map(tk => (
                          <div key={tk.id} className="bg-white/5 border border-white/5 p-5 rounded-3xl flex items-center justify-between group hover:bg-white/[0.07] transition-all">
                             <div className="flex items-center gap-6">
                                <span className="text-[10px] font-black text-white/10 group-hover:text-blue-500 transition-colors uppercase tracking-[0.2em] w-12 flex-shrink-0">T-{tk.id}</span>
                                <div>
                                   <h4 className="text-sm font-bold text-white group-hover:text-white transition-colors uppercase tracking-tight mb-0.5">{tk.titolo}</h4>
                                   <div className="flex gap-4 text-[10px] font-black text-white/20 uppercase tracking-widest">
                                      <span>Creato il {fmt(tk.created_at)}</span>
                                      <span>• Priorità {tk.priorita}</span>
                                   </div>
                                </div>
                             </div>
                             <Badge label={tk.stato} className={STATO_TICKET_STYLES[tk.stato] || "bg-white/5 text-white/30"} />
                          </div>
                        ))
                      )}
                    </div>
                </div>
              )}

            </div>
          </>
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

      {selectedTask && (
        <DrawerTask 
          task={selectedTask} 
          pianoId={selectedPianoId!} 
          onClose={() => setSelectedTask(null)}
          onUpdated={t => { 
            setTasks(prev => prev.map(old => old.id === t.id ? t : old)); 
            setSelectedTask(t);
          }}
        />
      )}

    </div>
  );
}
