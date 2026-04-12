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

const PRIORITA_STYLES: Record<string, string> = {
  Alta: "bg-red-600 text-white border-red-700 shadow-sm shadow-red-500/20",
  Media: "bg-amber-500 text-white border-amber-600 shadow-sm shadow-amber-500/20",
  Bassa: "bg-emerald-500 text-white border-emerald-600 shadow-sm shadow-emerald-500/20",
};

// ─── Componenti UI Base (Leggibili) ───────────────────────────────────────────

function Badge({ label, className }: { label: string; className?: string }) {
  return (
    <span className={cn("px-2.5 py-0.5 rounded-full text-[10px] font-semibold uppercase tracking-wider border", className)}>
      {label}
    </span>
  );
}

// ─── Selezione Asset Scalabile (RIOMOLOGATA) ────────────────────────────────

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
    <div className="space-y-4">
      <div className="flex gap-3">
        <div className="relative flex-1">
          <input 
            type="text" 
            placeholder="Cerca asset... (nome o codice)"
            value={query}
            onChange={e => setQuery(e.target.value)}
            className="w-full bg-white/5 border border-white/20 rounded-xl py-2.5 pl-10 pr-4 text-sm text-white focus:outline-none focus:ring-1 focus:ring-indigo-500 transition-all placeholder:text-white/20 font-medium"
          />
          <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-white/40 text-lg">🔍</span>
        </div>
        <button 
          type="button"
          onClick={() => onSelectAll(results.map(r => r.id))}
          className="px-5 py-2.5 bg-indigo-500/10 hover:bg-indigo-500/20 text-indigo-400 text-xs font-bold uppercase tracking-wider border border-indigo-500/20 rounded-xl transition-all"
        >
          Seleziona Gruppo
        </button>
      </div>

      <div className="grid grid-cols-1 gap-2 max-h-[300px] overflow-y-auto pr-2 custom-scrollbar border border-white/10 rounded-xl p-2 bg-black/20">
        {loading ? (
          <div className="py-12 text-center text-white/30 text-[10px] uppercase tracking-widest animate-pulse font-bold">In ricarca asset...</div>
        ) : results.length === 0 ? (
          <div className="py-12 text-center text-white/30 text-[10px] uppercase tracking-widest font-bold">Nessun asset trovato</div>
        ) : (
          results.map(asset => (
            <div 
              key={asset.id}
              onClick={() => onToggle(asset.id)}
              className={cn(
                "p-3 rounded-lg border cursor-pointer transition-all flex items-center justify-between group",
                selectedIds.includes(asset.id) 
                  ? "bg-indigo-600/10 border-indigo-500/40" 
                  : "bg-white/5 border-transparent hover:border-white/10"
              )}
            >
              <div className="flex flex-col min-w-0">
                <span className={cn("text-sm font-semibold truncate", selectedIds.includes(asset.id) ? "text-white" : "text-white/80")}>
                  {asset.nome}
                </span>
                <span className="text-[10px] text-white/30 font-bold uppercase tracking-wider">{asset.codice} • {asset.sito_nome}</span>
              </div>
              <div className={cn(
                "w-5 h-5 rounded border flex items-center justify-center transition-all",
                selectedIds.includes(asset.id) ? "bg-indigo-500 border-indigo-500" : "border-white/10 group-hover:border-white/20"
              )}>
                {selectedIds.includes(asset.id) && <span className="text-white text-[10px]">✓</span>}
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

// ─── MODAL: Nuovo / Modifica Piano ──────────────────────────────────────────

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
    <div className="fixed inset-0 bg-black/60 backdrop-blur-md z-[100] flex items-center justify-center p-4 overflow-y-auto">
      <div className="bg-[#0f172a] border border-white/10 rounded-3xl w-full max-w-4xl shadow-2xl overflow-hidden my-auto">
        <div className="px-8 py-6 border-b border-white/5 flex justify-between items-center bg-white/5">
          <div className="space-y-1">
            <h3 className="text-xl font-bold text-white uppercase tracking-wider">
              {piano ? "Gestione Configurazione" : "Nuovo Piano di Manutenzione"}
            </h3>
            <p className="text-xs text-white/40 font-semibold uppercase tracking-widest">Definizione perimetro e asset</p>
          </div>
          <button onClick={onClose} className="text-white/20 hover:text-white transition-colors text-3xl">&times;</button>
        </div>

        <form onSubmit={submit} className="p-8 space-y-8">
          <div>
            <label className="block text-[10px] font-bold text-indigo-400 uppercase tracking-widest mb-3">Descrizione Operativa</label>
            <textarea 
              value={form.descrizione}
              onChange={e => setForm(f => ({ ...f, descrizione: e.target.value }))}
              placeholder="es. Piano Manutenzione Preventiva Q.E. Bassa Tensione..."
              className="w-full bg-white/5 border border-white/10 rounded-xl p-4 text-sm text-white focus:outline-none focus:ring-1 focus:ring-indigo-500 transition-all resize-none h-24 placeholder:text-white/10"
              required
            />
          </div>

          <div>
            <label className="block text-[10px] font-bold text-indigo-400 uppercase tracking-widest mb-3">Selezione Asset ({form.asset_ids.length})</label>
            <AssetSelector 
              selectedIds={form.asset_ids} 
              onToggle={id => setForm(f => ({ ...f, asset_ids: f.asset_ids.includes(id) ? f.asset_ids.filter(x => x !== id) : [...f.asset_ids, id]}))}
              onSelectAll={ids => setForm(f => {
                const newIds = new Set([...f.asset_ids, ...ids]);
                return { ...f, asset_ids: Array.from(newIds) };
              })}
            />
          </div>

          <div className="flex gap-4 pt-2">
            <button 
              type="button" 
              onClick={onClose}
              className="px-6 py-3 border border-white/10 rounded-xl text-white/40 text-xs font-bold uppercase tracking-widest hover:bg-white/5 transition-all"
            >
              Annulla
            </button>
            <button 
              type="submit"
              disabled={saving}
              className="flex-1 py-3 px-6 bg-indigo-600 hover:bg-indigo-500 text-white rounded-xl text-xs font-bold uppercase tracking-widest transition-all shadow-lg shadow-indigo-600/20 disabled:opacity-50"
            >
              {saving ? "Salvando..." : (piano ? "Aggiorna Piano" : "Crea Piano Operativo")}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ─── DRAWER: Dettaglio Task (MODIFICABILE) ───────────────────────────────

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

  return (
    <div className="fixed inset-y-0 right-0 w-full sm:w-[500px] bg-[#0c111d] border-l border-white/10 z-[80] shadow-2xl flex flex-col p-0">
      <div className="p-8 border-b border-white/5 flex justify-between items-center bg-white/5">
        <div className="space-y-2">
          <Badge label={task.codice || "TASK"} className="bg-indigo-600 text-white border-none" />
          <h2 className="text-xl font-bold text-white tracking-tight truncate max-w-[350px]">
            {isNew ? "Nuova Attività" : (task.nome || "Modifica Attività")}
          </h2>
        </div>
        <button onClick={onClose} className="text-white/20 hover:text-white transition-colors text-4xl leading-none">&times;</button>
      </div>

      <div className="flex-1 overflow-y-auto p-8 space-y-8 custom-scrollbar">
        <div className="space-y-6">
          <div>
            <label className="text-[10px] font-bold text-indigo-400 uppercase tracking-widest block mb-2">Titolo Attività</label>
            <input 
              type="text" 
              value={form.nome} 
              onChange={e => setForm(f => ({ ...f, nome: e.target.value }))} 
              className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-2.5 text-sm text-white focus:outline-none focus:border-indigo-500"
            />
          </div>
          <div>
            <label className="text-[10px] font-bold text-indigo-400 uppercase tracking-widest block mb-2">Descrizione / Istruzioni</label>
            <textarea 
              value={form.descrizione} 
              onChange={e => setForm(f => ({ ...f, descrizione: e.target.value }))} 
              className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-2.5 text-sm text-white h-32 focus:outline-none focus:border-indigo-500"
            />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="text-[10px] font-bold text-indigo-400 uppercase tracking-widest block mb-2">Frequenza (Giorni)</label>
              <input 
                type="number" 
                value={form.frequenza_giorni} 
                onChange={e => setForm(f => ({ ...f, frequenza_giorni: parseInt(e.target.value) || 1 }))} 
                className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-2.5 text-sm text-white focus:outline-none"
              />
            </div>
            <div>
              <label className="text-[10px] font-bold text-indigo-400 uppercase tracking-widest block mb-2">Durata Stimata (Ore)</label>
              <input 
                type="number" 
                step="0.5" 
                value={form.durata_ore} 
                onChange={e => setForm(f => ({ ...f, durata_ore: parseFloat(e.target.value) || 0 }))} 
                className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-2.5 text-sm text-white focus:outline-none"
              />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="text-[10px] font-bold text-indigo-400 uppercase tracking-widest block mb-2">Priorità</label>
              <select 
                value={form.priorita}
                onChange={e => setForm(f => ({ ...f, priorita: e.target.value }))}
                className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-2.5 text-sm text-white font-semibold"
              >
                <option value="Alta">Alta</option>
                <option value="Media">Media</option>
                <option value="Bassa">Bassa</option>
              </select>
            </div>
            <div>
              <label className="text-[10px] font-bold text-indigo-400 uppercase tracking-widest block mb-2">Anticipo Generazione (gg)</label>
              <input 
                type="number" 
                value={form.generate_days_before_due} 
                onChange={e => setForm(f => ({ ...f, generate_days_before_due: parseInt(e.target.value) || 0 }))} 
                className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-2.5 text-sm text-white focus:outline-none"
              />
            </div>
          </div>
        </div>
      </div>

      <div className="p-8 border-t border-white/5 bg-white/5 flex gap-4">
        <button onClick={onClose} className="flex-1 py-3.5 text-xs font-bold uppercase text-white/40 hover:text-white transition-all tracking-widest">Annulla</button>
        <button 
          onClick={handleSave} 
          disabled={saving}
          className="flex-1 py-3.5 bg-indigo-600 text-white rounded-xl text-xs font-bold uppercase tracking-widest shadow-lg shadow-indigo-600/20"
        >
          {saving ? "Salvataggio..." : "Salva Modifiche"}
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

  // ── Rendering Sidebar ───────────────────────────────────────────────────────

  return (
    <div className="full-bleed-page flex bg-[#030712]">
      
      {/* ── PANEL 1: SB PIANI (400px) ── */}
      <aside className="w-[400px] flex-shrink-0 border-r border-white/10 bg-[#0c111d] flex flex-col">
        <div className="p-6 border-b border-white/5 flex flex-col gap-4">
          <div className="flex justify-between items-center">
            <h2 className="text-xs font-bold text-indigo-400 uppercase tracking-widest">Piani Attivi</h2>
            <Badge label={piani.length.toString()} className="bg-indigo-600/10 text-indigo-500 border-indigo-500/20 px-2" />
          </div>
          <button 
            onClick={() => { setPianoToEdit(null); setShowModalPiano(true); }}
            className="w-full py-3.5 bg-indigo-600 hover:bg-indigo-500 text-white rounded-xl text-xs font-bold uppercase tracking-widest transition-all shadow-lg shadow-indigo-600/20"
          >
            + Definisci Nuovo Piano
          </button>
          <div className="relative">
            <input 
              type="text" 
              placeholder="Cerca piano operativo..."
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              className="w-full bg-white/5 border border-white/10 rounded-xl py-3 pl-10 pr-4 text-sm text-white focus:outline-none focus:ring-1 focus:ring-indigo-500 transition-all"
            />
            <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-white/30 text-lg">🔍</span>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-4 space-y-3 custom-scrollbar">
          {loading ? (
             [1,2,3,4,5].map(i => <div key={i} className="h-28 bg-white/5 rounded-3xl animate-pulse border border-white/5" />)
          ) : filteredPiani.length === 0 ? (
            <div className="text-center py-20 text-xs font-black text-white/10 uppercase tracking-[0.3em] italic">Nessun piano disponibile</div>
          ) : (
            filteredPiani.map(p => (
              <div 
                key={p.id}
                onClick={() => setSelectedPianoId(p.id)}
                className={cn(
                  "p-5 rounded-2xl border cursor-pointer transition-all relative group",
                  selectedPianoId === p.id 
                    ? "bg-indigo-600/10 border-indigo-500/30" 
                    : "bg-transparent border-transparent hover:bg-white/5 hover:border-white/10"
                )}
              >
                <div className="flex justify-between items-start mb-2">
                  <span className={cn("text-sm font-bold tracking-tight", selectedPianoId === p.id ? "text-white" : "text-white/80")}>
                    {p.nome_codificato}
                  </span>
                  <button 
                    onClick={(e) => { e.stopPropagation(); setPianoToEdit(p); setShowModalPiano(true); }}
                    className="opacity-0 group-hover:opacity-100 p-1 text-white/20 hover:text-white transition-all"
                  >
                    ✎
                  </button>
                </div>
                <p className="text-xs text-white/40 line-clamp-2 leading-relaxed mb-3">
                  {p.descrizione || "Nessuna specifica tecnica aggiuntiva."}
                </p>
                <div className="flex gap-3">
                  <span className="text-[10px] font-bold uppercase tracking-wider text-indigo-400 bg-indigo-500/10 px-2 py-0.5 rounded">
                     {p.asset_count} Asset
                  </span>
                  <span className="text-[10px] font-bold uppercase tracking-wider text-white/30">
                     {p.task_count} Task
                  </span>
                </div>
                {selectedPianoId === p.id && <div className="absolute left-0 top-1/2 -translate-y-1/2 w-1 h-8 bg-indigo-500 rounded-r-full shadow-[0_0_10px_rgba(99,102,241,0.4)]" />}
              </div>
            ))
          )}
        </div>
      </aside>

      {/* ── PANEL 2: MAIN VIEW ── */}
      <main className="flex-1 flex flex-col min-w-0 bg-[#030712]">
        {!selectedPiano ? (
          <div className="flex-1 flex flex-col items-center justify-center text-center p-12">
             <div className="w-24 h-24 bg-indigo-600/5 border border-indigo-600/10 rounded-3xl flex items-center justify-center text-5xl text-indigo-600/20 mb-8">⚡</div>
             <h2 className="text-2xl font-bold text-white uppercase tracking-widest mb-4">Gestore Piani</h2>
             <p className="text-sm text-white/30 max-w-md leading-relaxed border-t border-white/5 pt-6">
               Seleziona un piano operativo dalla sidebar o inizializzane uno nuovo per gestire scadenze, manuali e asset industriali.
             </p>
          </div>
        ) : (
          <div className="flex-1 flex flex-col overflow-hidden animate-in fade-in duration-500">
            {/* Header Piano */}
            <header className="px-8 pt-8 pb-0 border-b border-white/10 bg-[#0c111d]/50 backdrop-blur-xl">
              <div className="flex justify-between items-start mb-8">
                <div className="space-y-4">
                  <div className="flex items-center gap-6">
                    <h1 className="text-3xl font-bold text-white tracking-tight leading-none">
                      {selectedPiano.nome_codificato}
                    </h1>
                    <Badge label={selectedPiano.stato} className="text-indigo-400 bg-indigo-500/10 border-indigo-500/20" />
                  </div>
                  <p className="text-sm text-white/40 max-w-3xl font-medium border-l-2 border-indigo-600 pl-4 py-1">
                    {selectedPiano.descrizione || "Configurazione standard."}
                  </p>
                </div>

                <div className="flex gap-4">
                  <div className="bg-white/5 border border-white/10 p-4 rounded-2xl flex flex-col items-center justify-center min-w-[120px]">
                    <span className="text-[10px] font-bold text-white/30 uppercase tracking-widest mb-1">Attività Totali</span>
                    <span className="text-2xl font-bold text-white">{selectedPiano.task_count}</span>
                  </div>
                  <div className="bg-white/5 border border-white/10 p-4 rounded-2xl flex flex-col items-center justify-center min-w-[120px]">
                    <span className="text-[10px] font-bold text-white/30 uppercase tracking-widest mb-1">Ticket Aperti</span>
                    <span className="text-2xl font-bold text-amber-500">{selectedPiano.open_ticket_count}</span>
                  </div>
                </div>
              </div>

              {/* TABS */}
              <div className="flex gap-8">
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
                        "px-1 py-4 text-xs font-bold uppercase tracking-widest transition-all relative flex items-center gap-2 group",
                        active ? "text-indigo-400" : "text-white/30 hover:text-white/60"
                      )}
                    >
                      <span className={cn("text-base grayscale group-hover:grayscale-0 transition-all", active ? "grayscale-0" : "")}>{tab.icon}</span> 
                      {tab.label}
                      {active && <div className="absolute bottom-0 left-0 right-0 h-1 bg-indigo-500 rounded-t-full shadow-[0_-2px_8px_rgba(99,102,241,0.4)]" />}
                    </button>
                  );
                })}
              </div>
            </header>

            {/* TAB CONTENT */}
            <div className="flex-1 overflow-y-auto p-8 bg-[#0c111d] custom-scrollbar">
              
              {/* TASKS VIEW */}
              {activeTab === "tasks" && (
                <div className="space-y-8">
                  <div className="flex justify-between items-center">
                    <div className="space-y-1">
                      <h3 className="text-lg font-bold text-white uppercase tracking-wider">Piano Operativo</h3>
                      <p className="text-xs font-semibold text-white/30 uppercase tracking-widest">Definizione frequenze e priorità degli interventi</p>
                    </div>
                    <div className="flex gap-3">
                      <label className={cn(
                        "px-6 py-3 rounded-xl text-[10px] font-bold uppercase tracking-widest transition-all cursor-pointer flex items-center gap-3 border",
                        uploading ? "bg-white/5 text-white/20 border-white/10" : "bg-indigo-600 hover:bg-indigo-500 text-white border-indigo-700 shadow-lg shadow-indigo-600/20"
                      )}>
                        {uploading ? "⌛ Elaborazione..." : "📤 Importa PDF"}
                        <input 
                          type="file" className="hidden" accept=".pdf" disabled={uploading}
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
                        className="px-6 py-3 bg-white/5 hover:bg-white/10 border border-white/10 text-white text-[10px] font-bold uppercase tracking-widest rounded-xl transition-all"
                      >
                        + Aggiungi Task
                      </button>
                    </div>
                  </div>

                  <div className="space-y-3">
                    {fetchingContent ? (
                       [1,2,3,4,5].map(i => <div key={i} className="h-20 bg-white/5 rounded-2xl animate-pulse" />)
                    ) : tasks.length === 0 ? (
                      <div className="py-24 text-center border-2 border-dashed border-white/5 rounded-[40px] bg-white/[0.01]">
                        <p className="text-xl font-bold text-white/10 uppercase tracking-widest italic">Nessun task programmato</p>
                      </div>
                    ) : (
                      tasks.map(task => (
                        <div 
                          key={task.id}
                          onClick={() => setSelectedTask(task)}
                          className="group bg-white/5 hover:bg-white/[0.08] border border-white/5 hover:border-indigo-600/30 p-5 rounded-3xl transition-all cursor-pointer flex items-center gap-6"
                        >
                          <div className={cn("w-1.5 h-12 rounded-full", task.task_stato === 'active' ? 'bg-indigo-500 shadow-[0_0_10px_rgba(99,102,241,0.4)]' : 'bg-white/10')} />
                          <div className="flex-1 min-w-0">
                            <h4 className="text-sm font-semibold text-white tracking-tight truncate group-hover:text-indigo-400 transition-colors">
                              {task.nome || task.descrizione}
                            </h4>
                            <div className="flex gap-4 mt-2">
                              <span className="text-[10px] font-bold uppercase tracking-wider text-white/30 border-r border-white/10 pr-4">#{task.codice || task.id}</span>
                              <span className="text-[10px] font-bold uppercase tracking-wider text-white/30">Ogni {task.frequenza_giorni}g</span>
                              <span className="text-[10px] font-bold uppercase tracking-wider text-white/30">{task.durata_ore} Ore</span>
                            </div>
                          </div>
                          <div className="w-32 flex justify-center">
                            <Badge label={task.priorita} className={cn(PRIORITA_STYLES[task.priorita], "px-2 py-0.5")} />
                          </div>
                          <div className="w-48 text-right pr-4">
                            <span className="text-base font-bold text-indigo-400 block tracking-tight uppercase">{fmt(task.next_due_at).split(',')[0]}</span>
                            <span className="text-[9px] font-bold text-white/20 uppercase tracking-widest">Scadenza</span>
                          </div>
                          <div className="opacity-0 group-hover:opacity-100 transition-all pl-6 border-l border-white/10 h-12 flex items-center">
                            <button 
                              onClick={(e) => { e.stopPropagation(); generateTicket(task); }}
                              className="px-5 py-2.5 bg-indigo-600 text-white rounded-xl text-[9px] font-bold uppercase tracking-widest shadow-md shadow-indigo-600/20 active:scale-95 transition-all"
                            >
                              Genera Ticket
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
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8 animate-in fade-in duration-300">
                  {fetchingContent ? (
                     [1,2,3].map(i => <div key={i} className="h-72 bg-white/5 rounded-[40px] animate-pulse" />)
                  ) : manuali.length === 0 ? (
                    <div className="col-span-full py-40 text-center text-white/10 text-xl font-black uppercase tracking-widest italic opacity-50 border-4 border-dashed border-white/5 rounded-[60px]">
                      Nessun documento tecnico caricato.
                    </div>
                  ) : (
                    manuali.map(m => (
                      <div key={m.id} className="bg-white/5 border border-white/10 p-6 rounded-3xl hover:bg-white/[0.08] transition-all flex flex-col justify-between group h-64">
                         <div className="space-y-4">
                           <div className="w-12 h-12 bg-red-600/10 rounded-xl flex items-center justify-center text-xs text-red-500 font-bold border border-red-600/20">PDF</div>
                           <h4 className="text-base font-bold text-white leading-tight group-hover:text-indigo-400 transition-colors">{m.nome}</h4>
                           <div className="flex gap-4 text-[10px] font-bold text-white/30 uppercase tracking-wider">
                             <span>{m.pagine} Pagine</span>
                             <span>• {m.task_count} Task</span>
                           </div>
                         </div>
                         <button className="w-full py-3 bg-white/5 group-hover:bg-indigo-600 border border-white/10 group-hover:border-indigo-500 rounded-xl text-[10px] font-bold text-white/40 group-hover:text-white uppercase tracking-widest transition-all">Sfoglia Documento</button>
                      </div>
                    ))
                  )}
                </div>
              )}

              {/* HISTORY VIEW (placeholder robusto) */}
              {activeTab === "history" && (
                <div className="space-y-10 animate-in fade-in duration-300">
                   <h3 className="text-xl font-black text-white uppercase tracking-tight">Storico Interventi del Piano</h3>
                   <div className="space-y-4">
                      {fetchingContent ? (
                        [1,2,3,4,5].map(i => <div key={i} className="h-20 bg-white/5 rounded-3xl animate-pulse" />)
                      ) : history.length === 0 ? (
                        <div className="py-40 text-center text-white/10 text-xl font-black uppercase tracking-widest italic opacity-50 border-4 border-dashed border-white/5 rounded-[60px]">
                          Nessun ticket emesso per questo piano.
                        </div>
                      ) : (
                        history.map(tk => (
                          <div key={tk.id} className="bg-white/5 border border-white/10 p-4 rounded-2xl flex items-center justify-between group hover:bg-[#1e293b] transition-all">
                             <div className="flex items-center gap-6">
                                <span className="text-[10px] font-bold text-indigo-500 bg-indigo-500/10 px-2 py-0.5 rounded-full uppercase tracking-wider border border-indigo-500/20">T-{tk.id}</span>
                                <div>
                                   <h4 className="text-sm font-semibold text-white tracking-tight group-hover:text-white transition-colors">{tk.titolo}</h4>
                                   <div className="flex gap-4 mt-1 text-[10px] font-bold text-white/30 uppercase tracking-widest">
                                      <span>Creato il {fmt(tk.created_at)}</span>
                                      <span>• Priorità {tk.priorita}</span>
                                   </div>
                                </div>
                             </div>
                             <Badge label={tk.stato} className="text-indigo-400 bg-indigo-500/10 border-indigo-500/20" />
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
