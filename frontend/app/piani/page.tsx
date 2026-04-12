"use client";

import { useEffect, useState, useCallback, useMemo } from "react";
import { apiGet, apiPost, apiDelete, apiPut, apiUpload } from "../lib/api";
import { notify } from "@/lib/toast";
import { cn } from "@/lib/utils";

// ─── Tipi ─────────────────────────────────────────────────────────────────────

type AssetOption = { id: number; nome: string; area?: string; sito_nome?: string };

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

type TicketHistory = {
  id: number;
  titolo: string;
  stato: string;
  priorita: string;
  durata_stimata_ore: number;
  created_at: string | null;
};

type Manuale = {
  id: number;
  nome: string;
  pagine: number;
  metodo: string;
  stato: string;
  created_at: string | null;
  task_count?: number;
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmt(iso: string | null) {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("it-IT", { day: "2-digit", month: "short", year: "numeric" });
}

function isOverdue(iso: string | null) {
  return !!iso && new Date(iso) < new Date();
}

const PRIORITA_STYLES: Record<string, string> = {
  Alta: "bg-red-500/20 text-red-400 border border-red-500/30",
  Media: "bg-amber-500/20 text-amber-400 border border-amber-500/30",
  Bassa: "bg-emerald-500/20 text-emerald-400 border border-emerald-500/30",
};

const STATO_TICKET_STYLES: Record<string, string> = {
  Aperto: "text-blue-400 border-blue-500/20 bg-blue-500/10",
  Pianificato: "text-amber-400 border-amber-500/20 bg-amber-500/10",
  "In corso": "text-indigo-400 border-indigo-500/20 bg-indigo-500/10",
  Chiuso: "text-emerald-400 border-emerald-500/20 bg-emerald-500/10",
};

// ─── Componenti UI ────────────────────────────────────────────────────────────

function Badge({ label, className }: { label: string; className?: string }) {
  return (
    <span className={cn("px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider", className)}>
      {label}
    </span>
  );
}

// ─── MODAL: Crea/Modifica Task ───────────────────────────────────────────────

function ModalTask({ task, pianoId, onClose, onSaved }: {
  task?: Task | null;
  pianoId: number;
  onClose: () => void;
  onSaved: (t: Task) => void;
}) {
  const [form, setForm] = useState({
    nome: task?.nome || "",
    descrizione: task?.descrizione || "",
    frequenza_giorni: task?.frequenza_giorni || 30,
    durata_ore: task?.durata_ore || 1.0,
    priorita: task?.priorita || "Media",
    generation_mode: task?.generation_mode || "manual",
    is_repeatable: task?.is_repeatable ?? true,
  });
  const [saving, setSaving] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    try {
      const isEdit = !!task;
      const res = isEdit
        ? await apiPut<Task>(`/piani-manutenzione/${pianoId}/tasks/${task.id}`, form)
        : await apiPost<Task>(`/piani-manutenzione/${pianoId}/tasks`, form);
      
      notify.success(isEdit ? "Task aggiornato" : "Task creato");
      onSaved(res);
    } catch (err: any) {
      notify.error(err.message || "Errore salvataggio task");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-[60] flex items-center justify-center p-4">
      <div className="bg-[#111827] border border-white/10 rounded-2xl w-full max-w-lg shadow-2xl animate-in fade-in zoom-in duration-200 overflow-hidden">
        <div className="px-6 py-4 border-b border-white/5 flex justify-between items-center bg-white/5">
          <h3 className="text-sm font-bold text-white uppercase tracking-widest">
            {task ? "Modifica Task" : "Nuovo Task Manuale"}
          </h3>
          <button onClick={onClose} className="text-white/40 hover:text-white transition-colors text-xl">×</button>
        </div>
        <form onSubmit={submit} className="p-6 space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div className="col-span-2">
              <label className="block text-[10px] font-bold text-white/40 uppercase tracking-widest mb-1">Nome Task</label>
              <input 
                type="text" 
                value={form.nome} 
                onChange={e => setForm(f => ({ ...f, nome: e.target.value }))}
                className="w-full bg-white/5 border border-white/5 rounded-lg py-2 px-3 text-sm text-white focus:outline-none focus:border-indigo-500"
                placeholder="es. Controllo Filtri"
                required
              />
            </div>
            <div>
              <label className="block text-[10px] font-bold text-white/40 uppercase tracking-widest mb-1">Frequenza (Giorni)</label>
              <input 
                type="number" 
                value={form.frequenza_giorni} 
                onChange={e => setForm(f => ({ ...f, frequenza_giorni: parseInt(e.target.value) || 0 }))}
                className="w-full bg-white/5 border border-white/5 rounded-lg py-2 px-3 text-sm text-white focus:outline-none focus:border-indigo-500"
              />
            </div>
            <div>
              <label className="block text-[10px] font-bold text-white/40 uppercase tracking-widest mb-1">Durata Stimata (Ore)</label>
              <input 
                type="number" 
                step="0.5"
                value={form.durata_ore} 
                onChange={e => setForm(f => ({ ...f, durata_ore: parseFloat(e.target.value) || 0 }))}
                className="w-full bg-white/5 border border-white/5 rounded-lg py-2 px-3 text-sm text-white focus:outline-none focus:border-indigo-500"
              />
            </div>
            <div>
              <label className="block text-[10px] font-bold text-white/40 uppercase tracking-widest mb-1">Priorità</label>
              <select 
                value={form.priorita}
                onChange={e => setForm(f => ({ ...f, priorita: e.target.value }))}
                className="w-full bg-white/5 border border-white/5 rounded-lg py-2 px-3 text-sm text-white focus:outline-none focus:border-indigo-500"
              >
                <option value="Alta">Alta</option>
                <option value="Media">Media</option>
                <option value="Bassa">Bassa</option>
              </select>
            </div>
            <div className="flex items-center gap-2 pt-4">
               <input 
                 type="checkbox" 
                 checked={form.is_repeatable}
                 onChange={e => setForm(f => ({ ...f, is_repeatable: e.target.checked }))}
                 className="w-4 h-4 bg-white/5 border-white/10 rounded"
               />
               <label className="text-[10px] font-bold text-white/40 uppercase tracking-widest">Ricorrente</label>
            </div>
          </div>
          <div>
            <label className="block text-[10px] font-bold text-white/40 uppercase tracking-widest mb-1">Descrizione Task</label>
            <textarea 
               value={form.descrizione} 
               onChange={e => setForm(f => ({ ...f, descrizione: e.target.value }))}
               className="w-full bg-white/5 border border-white/5 rounded-lg py-2 px-3 text-sm text-white h-24 focus:outline-none focus:border-indigo-500 resize-none"
               required
            />
          </div>
          <div className="flex gap-2 pt-2">
            <button type="button" onClick={onClose} className="flex-1 py-2 rounded-xl border border-white/10 text-white/60 text-[10px] font-bold uppercase tracking-widest">Annulla</button>
            <button 
              type="submit" 
              disabled={saving}
              className="flex-1 py-2 rounded-xl bg-indigo-500 hover:bg-indigo-400 text-white text-[10px] font-bold tracking-widest transition-all"
            >
              {saving ? "Salvataggio..." : "Salva Task"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ─── DRAWER: Dettaglio Task ──────────────────────────────────────────────────

function DrawerTask({ task, pianoId, onClose, onUpdated }: {
  task: Task;
  pianoId: number;
  onClose: () => void;
  onUpdated: (t: Task) => void;
}) {
  const [history, setHistory] = useState<TicketHistory[]>([]);
  const [loading, setLoading] = useState(true);
  const [showEdit, setShowEdit] = useState(false);

  useEffect(() => {
    async function fetchHistory() {
      try {
        const res = await apiGet<TicketHistory[]>(`/piani-manutenzione/${pianoId}/tasks/${task.id}/tickets`);
        setHistory(Array.isArray(res) ? res : []);
      } catch { setHistory([]); }
      finally { setLoading(false); }
    }
    fetchHistory();
  }, [task.id, pianoId]);

  return (
    <div className="fixed inset-y-0 right-0 w-[450px] bg-[#0f172a] border-l border-white/10 shadow-[0_0_50px_rgba(0,0,0,0.5)] z-50 flex flex-col animate-in slide-in-from-right duration-300">
      <div className="p-6 border-b border-white/5 flex justify-between items-center bg-white/5">
        <div className="flex flex-col">
          <Badge label={task.codice || `#${task.id}`} className="bg-white/10 text-white/40 w-fit mb-1" />
          <h2 className="text-sm font-bold text-white uppercase tracking-widest truncate max-w-[300px]">{task.nome || task.descrizione}</h2>
        </div>
        <button onClick={onClose} className="text-white/40 hover:text-white text-2xl">×</button>
      </div>

      <div className="flex-1 overflow-y-auto p-6 space-y-8 custom-scrollbar">
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
             <div className="bg-white/5 rounded-2xl p-4 border border-white/5">
                <span className="block text-[9px] font-bold text-white/20 uppercase tracking-widest mb-1">Stato</span>
                <Badge label={task.task_stato} className={cn("text-[10px]", task.task_stato === 'active' ? "text-emerald-400 bg-emerald-500/10" : "text-slate-400 bg-slate-500/10")} />
             </div>
             <div className="bg-white/5 rounded-2xl p-4 border border-white/5">
                <span className="block text-[9px] font-bold text-white/20 uppercase tracking-widest mb-1">Priorità</span>
                <Badge label={task.priorita} className={PRIORITA_STYLES[task.priorita]} />
             </div>
             <div className="bg-white/5 rounded-2xl p-4 border border-white/5">
                <span className="block text-[9px] font-bold text-white/20 uppercase tracking-widest mb-1">Frequenza</span>
                <span className="text-white font-mono text-xs">{task.frequenza_giorni} giorni</span>
             </div>
             <div className="bg-white/5 rounded-2xl p-4 border border-white/5">
                <span className="block text-[9px] font-bold text-white/20 uppercase tracking-widest mb-1">Durata</span>
                <span className="text-white font-mono text-xs">{task.durata_ore} ore</span>
             </div>
          </div>

          <div className="bg-white/5 rounded-2xl p-4 border border-white/5 space-y-1">
             <span className="block text-[9px] font-bold text-white/20 uppercase tracking-widest mb-1">Descrizione Task</span>
             <p className="text-xs text-white/60 leading-relaxed italic">{task.descrizione}</p>
          </div>
          
          <button 
             onClick={() => setShowEdit(true)}
             className="w-full py-2.5 bg-white/5 hover:bg-white/10 border border-white/10 rounded-xl text-xs font-bold text-white tracking-widest transition-all"
          >
            MODIFICA PARAMETRI TASK
          </button>
        </div>

        <div className="space-y-4">
          <h3 className="text-[10px] font-black text-white/30 uppercase tracking-[0.2em]">Storico Ticket Generati</h3>
          {loading ? (
             <div className="animate-pulse space-y-2">
               {[1,2,3].map(i => <div key={i} className="h-12 bg-white/5 rounded-xl" />)}
             </div>
          ) : history.length === 0 ? (
             <div className="text-center py-10 text-[10px] text-white/20 italic uppercase tracking-widest border border-dashed border-white/5 rounded-2xl">
               Nessun ticket generato per questo task
             </div>
          ) : (
             <div className="space-y-2">
               {history.map(tk => (
                 <div key={tk.id} className="p-3 bg-white/5 hover:bg-white/[0.07] border border-white/5 rounded-xl transition-all cursor-pointer group">
                   <div className="flex justify-between items-start mb-1">
                     <span className="text-[11px] font-bold text-white group-hover:text-indigo-400 transition-colors">#{tk.id} {tk.titolo}</span>
                     <span className={cn("px-1.5 py-0.5 rounded text-[8px] font-bold uppercase border", STATO_TICKET_STYLES[tk.stato as keyof typeof STATO_TICKET_STYLES] || "text-white/40 border-white/10 bg-white/5")}>{tk.stato}</span>
                   </div>
                   <div className="flex gap-3 text-[9px] font-bold text-white/20 uppercase tracking-widest">
                     <span>📅 {fmt(tk.created_at)}</span>
                     <span>⏱ {tk.durata_stimata_ore}h</span>
                   </div>
                 </div>
               ))}
             </div>
          )}
        </div>
      </div>

      <div className="p-4 border-t border-white/5 bg-white/5">
        <button 
           onClick={onClose}
           className="w-full py-2 rounded-xl text-white/40 hover:text-white transition-colors text-[10px] font-bold uppercase tracking-widest"
        >
          Chiudi Dettaglio
        </button>
      </div>

      {showEdit && (
        <ModalTask 
           task={task} 
           pianoId={pianoId} 
           onClose={() => setShowEdit(false)} 
           onSaved={(updated) => { onUpdated(updated); setShowEdit(false); }} 
        />
      )}
    </div>
  );
}

// ─── MODAL: Crea/Modifica Piano ───────────────────────────────────────────────

function ModalPiano({ piano, assets, onClose, onSaved }: {
  piano?: Piano | null;
  assets: AssetOption[];
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
    if (form.asset_ids.length === 0) { notify.error("Seleziona almeno un asset"); return; }
    setSaving(true);
    try {
      const isEdit = !!piano;
      const res = isEdit
        ? await apiPut<Piano>(`/piani-manutenzione/${piano.id}`, form)
        : await apiPost<Piano>("/piani-manutenzione", form);
      
      notify.success(isEdit ? "Piano aggiornato" : `Piano ${res.nome_codificato} creato`);
      onSaved(res);
    } catch (err: any) {
      notify.error(err.message || "Errore salvataggio piano");
    } finally {
      setSaving(false);
    }
  }

  const toggleAsset = (id: number) => {
    setForm(f => ({
      ...f,
      asset_ids: f.asset_ids.includes(id) 
        ? f.asset_ids.filter(x => x !== id) 
        : [...f.asset_ids, id]
    }));
  };

  return (
    <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div className="bg-[#111827] border border-white/10 rounded-2xl w-full max-w-lg shadow-2xl overflow-hidden animate-in fade-in zoom-in duration-200">
        <div className="px-6 py-4 border-b border-white/5 flex justify-between items-center bg-white/5">
          <h3 className="text-sm font-bold text-white uppercase tracking-widest">
            {piano ? `Modifica Piano ${piano.nome_codificato}` : "Nuovo Piano di Manutenzione"}
          </h3>
          <button onClick={onClose} className="text-white/40 hover:text-white transition-colors text-xl">×</button>
        </div>
        
        <form onSubmit={submit} className="p-6 space-y-5">
          <div>
            <label className="block text-[10px] font-bold text-white/40 uppercase tracking-widest mb-2">Associa Asset ({form.asset_ids.length})</label>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 max-h-48 overflow-y-auto p-3 bg-black/20 rounded-xl border border-white/5 custom-scrollbar">
              {assets.map(a => (
                <div 
                  key={a.id} 
                  onClick={() => toggleAsset(a.id)}
                  className={cn(
                    "p-2 rounded-lg border text-xs cursor-pointer transition-all flex items-center gap-2",
                    form.asset_ids.includes(a.id) 
                      ? "bg-indigo-500/20 border-indigo-500 text-indigo-100" 
                      : "bg-white/5 border-white/5 text-white/60 hover:border-white/20"
                  )}
                >
                  <div className={cn("w-3 h-3 rounded-sm border flex items-center justify-center", form.asset_ids.includes(a.id) ? "bg-indigo-500 border-indigo-500" : "border-white/20")}>
                    {form.asset_ids.includes(a.id) && <span className="text-[8px] text-white">✓</span>}
                  </div>
                  <span className="truncate">{a.nome}</span>
                </div>
              ))}
            </div>
          </div>

          <div>
            <label className="block text-[10px] font-bold text-white/40 uppercase tracking-widest mb-2">Descrizione Operativa</label>
            <textarea 
              value={form.descrizione} 
              onChange={e => setForm(f => ({ ...f, descrizione: e.target.value }))}
              placeholder="Inserisci scopo del piano, vincoli o note generali..."
              className="w-full bg-white/5 border border-white/5 rounded-xl p-3 text-sm text-white focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 resize-none h-24 transition-all"
            />
          </div>

          <div className="flex gap-3 pt-2">
            <button type="button" onClick={onClose} className="flex-1 py-3 rounded-xl border border-white/10 text-white/60 text-xs font-bold hover:bg-white/5 transition-all uppercase tracking-widest">Annulla</button>
            <button 
              type="submit" 
              disabled={saving || form.asset_ids.length === 0} 
              className="flex-1 py-3 rounded-xl bg-indigo-500 hover:bg-indigo-400 disabled:opacity-50 text-white text-xs font-bold transition-all uppercase tracking-widest shadow-lg shadow-indigo-500/20"
            >
              {saving ? "Salvataggio..." : (piano ? "Aggiorna" : "Crea Piano")}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ─── MAIN PAGE ───────────────────────────────────────────────────────────────

export default function PianiPage() {
  const [piani, setPiani] = useState<Piano[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedPianoId, setSelectedPianoId] = useState<number | null>(null);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [manuali, setManuali] = useState<Manuale[]>([]);
  const [cronologia, setCronologia] = useState<TicketHistory[]>([]);
  
  const [activeTab, setActiveTab] = useState<"tasks" | "manuali" | "history">("tasks");
  const [loadingContent, setLoadingContent] = useState(false);
  const [search, setSearch] = useState("");
  
  const [assets, setAssets] = useState<AssetOption[]>([]);
  const [showModalPiano, setShowModalPiano] = useState(false);
  const [pianoToEdit, setPianoToEdit] = useState<Piano | null>(null);

  const [selectedTask, setSelectedTask] = useState<Task | null>(null);
  const [showModalTask, setShowModalTask] = useState(false);
  const [uploading, setUploading] = useState(false);

  // ── Data Fetching ──
  const fetchPiani = useCallback(async () => {
    setLoading(true);
    try {
      const res = await apiGet<{ items: Piano[] }>("/piani-manutenzione?limit=200");
      setPiani(res.items || []);
    } catch { notify.error("Errore caricamento piani"); }
    finally { setLoading(false); }
  }, []);

  const fetchAssets = useCallback(async () => {
    try {
      const res = await apiGet<AssetOption[]>("/assets");
      setAssets(Array.isArray(res) ? res : []);
    } catch { setAssets([]); }
  }, []);

  const fetchTasks = useCallback(async (pid: number) => {
    setLoadingContent(true);
    try {
      const res = await apiGet<{ items: Task[] }>(`/piani-manutenzione/${pid}/tasks?limit=500`);
      setTasks(res.items || []);
    } catch { notify.error("Errore task"); }
    finally { setLoadingContent(false); }
  }, []);

  const fetchManuali = useCallback(async (pid: number) => {
    setLoadingContent(true);
    try {
      const res = await apiGet<Manuale[]>(`/manuali?piano_id=${pid}`);
      setManuali(Array.isArray(res) ? res : []);
    } catch { notify.error("Errore manuali"); }
    finally { setLoadingContent(false); }
  }, []);

  const fetchCronologia = useCallback(async (pid: number) => {
    setLoadingContent(true);
    try {
      const res = await apiGet<{ items: TicketHistory[] }>(`/tickets?piano_id=${pid}&limit=200`);
      setCronologia(res.items || []);
    } catch { notify.error("Errore cronologia"); }
    finally { setLoadingContent(false); }
  }, []);

  useEffect(() => { fetchPiani(); fetchAssets(); }, [fetchPiani, fetchAssets]);

  useEffect(() => {
    if (!selectedPianoId) return;
    if (activeTab === "tasks") fetchTasks(selectedPianoId);
    else if (activeTab === "manuali") fetchManuali(selectedPianoId);
    else if (activeTab === "history") fetchCronologia(selectedPianoId);
  }, [selectedPianoId, activeTab, fetchTasks, fetchManuali, fetchCronologia]);

  const selectedPiano = useMemo(() => piani.find(p => p.id === selectedPianoId), [piani, selectedPianoId]);

  const filteredPiani = useMemo(() => {
    if (!search) return piani;
    const s = search.toLowerCase();
    return piani.filter(p => 
      p.nome_codificato.toLowerCase().includes(s) || 
      (p.descrizione && p.descrizione.toLowerCase().includes(s)) ||
      (p.asset_nome && p.asset_nome.toLowerCase().includes(s))
    );
  }, [piani, search]);

  const handlePianoSaved = (p: Piano) => {
    if (pianoToEdit) setPiani(prev => prev.map(old => old.id === p.id ? { ...old, ...p } : old));
    else setPiani(prev => [p, ...prev]);
    setShowModalPiano(false);
    setSelectedPianoId(p.id);
  };

  const deletePiano = async (pid: number) => {
    if (!confirm("Eliminare definitivamente questo piano e tutti i suoi task?")) return;
    try {
      await apiDelete(`/piani-manutenzione/${pid}`);
      setPiani(prev => prev.filter(p => p.id !== pid));
      if (selectedPianoId === pid) setSelectedPianoId(null);
      notify.success("Piano eliminato correttamente");
    } catch (err: any) { notify.error(err.message || "Errore eliminazione"); }
  };

  const toggleTaskStato = async (task: Task) => {
    const nuovoStato = task.task_stato === "active" ? "paused" : "active";
    try {
      await apiPut(`/piani-manutenzione/${selectedPianoId}/tasks/${task.id}`, { task_stato: nuovoStato });
      setTasks(prev => prev.map(t => t.id === task.id ? { ...t, task_stato: nuovoStato } : t));
    } catch { notify.error("Errore cambio stato task"); }
  };

  const generaTicket = async (task: Task) => {
    try {
      const res = await apiPost<{ created: number }>(`/piani-manutenzione/${selectedPianoId}/tasks/${task.id}/genera-ticket`, {});
      notify.success(`${res.created} ticket generati correttamente`);
      fetchTasks(selectedPianoId!);
    } catch (err: any) { notify.error(err.message || "Errore generazione ticket"); }
  };

  const handleUploadManual = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!e.target.files?.[0] || !selectedPianoId) return;
    setUploading(true);
    const fd = new FormData();
    fd.append("file", e.target.files[0]);
    try {
      await apiUpload(`/piani-manutenzione/${selectedPianoId}/import-pdf`, fd);
      notify.success("Manuale processato con successo. Attività estratte.");
      fetchTasks(selectedPianoId);
      fetchManuali(selectedPianoId);
      setActiveTab("tasks");
    } catch (err: any) { notify.error(err.message || "Errore upload manuale"); }
    finally { setUploading(false); }
  };

  return (
    <div className="flex h-full overflow-hidden bg-[#0a0f18]">
      
      {/* ── SIDEBAR PIANI ── */}
      <aside className="w-[300px] flex-shrink-0 border-r border-white/5 flex flex-col bg-[#0f172a]/50 backdrop-blur-3xl">
        <div className="p-4 border-b border-white/5 space-y-3">
          <div className="flex justify-between items-center">
            <h2 className="text-[11px] font-black text-white/40 uppercase tracking-[0.2em]">Piani Attivi</h2>
            <Badge label={piani.length.toString()} className="bg-white/5 text-white/60" />
          </div>
          <button 
            onClick={() => { setPianoToEdit(null); setShowModalPiano(true); }}
            className="w-full py-2.5 bg-indigo-500 hover:bg-indigo-400 text-white rounded-xl text-xs font-bold transition-all shadow-lg shadow-indigo-500/20 uppercase tracking-widest"
          >
            + Nuovo Piano
          </button>
          <div className="relative">
            <input 
              type="text" 
              placeholder="Cerca piani..." 
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="w-full bg-white/5 border border-white/5 rounded-lg py-1.5 pl-8 pr-3 text-xs text-white placeholder:text-white/30 focus:outline-none focus:border-indigo-500 transition-all"
            />
            <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-white/30 text-[10px]">🔍</span>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto px-2 py-3 space-y-1.5 custom-scrollbar">
          {loading && piani.length === 0 ? (
            <div className="p-10 text-center animate-pulse text-white/20 text-xs italic uppercase tracking-widest font-black">Caricamento...</div>
          ) : filteredPiani.length === 0 ? (
            <div className="p-10 text-center text-white/20 text-xs italic">Nessun piano</div>
          ) : (
            filteredPiani.map(p => (
              <div 
                key={p.id}
                onClick={() => { setSelectedPianoId(p.id); }}
                className={cn(
                  "p-3 rounded-xl border cursor-pointer transition-all group relative",
                  selectedPianoId === p.id 
                    ? "bg-indigo-500/10 border-indigo-500/50" 
                    : "bg-transparent border-transparent hover:bg-white/5 hover:border-white/10"
                )}
              >
                <div className="flex justify-between items-start mb-1.5">
                  <span className={cn("text-xs font-black tracking-tighter uppercase", selectedPianoId === p.id ? "text-indigo-400" : "text-white/80")}>
                    {p.nome_codificato}
                  </span>
                  <div className="opacity-0 group-hover:opacity-100 transition-opacity flex gap-1">
                    <button onClick={(e) => { e.stopPropagation(); setPianoToEdit(p); setShowModalPiano(true); }} className="p-1 hover:text-white text-white/40">✎</button>
                    <button onClick={(e) => { e.stopPropagation(); deletePiano(p.id); }} className="p-1 text-red-500/40 hover:text-red-400">✕</button>
                  </div>
                </div>
                <div className="text-[10px] text-white/40 font-bold truncate mb-2">{p.asset_nome || "Multiple Assets"}</div>
                <div className="flex gap-2">
                  <div className="flex items-center gap-1 text-[8px] font-black text-white/40 uppercase tracking-widest bg-white/5 px-1.5 py-0.5 rounded">
                    {p.task_count} TASKS
                  </div>
                  {p.open_ticket_count > 0 && (
                    <div className="flex items-center gap-1 text-[8px] font-black text-indigo-400 uppercase tracking-widest bg-indigo-500/10 px-1.5 py-0.5 rounded">
                      {p.open_ticket_count} TICKETS
                    </div>
                  )}
                </div>
              </div>
            ))
          )}
        </div>
      </aside>

      {/* ── MAIN CONTENT ── */}
      <main className="flex-1 flex flex-col min-w-0 relative">
        {!selectedPiano ? (
          <div className="flex-1 flex flex-col items-center justify-center text-center p-10">
            <div className="w-20 h-20 bg-white/5 rounded-[30px] flex items-center justify-center text-4xl mb-6 text-white/20 border border-white/5 rotate-12">📋</div>
            <h2 className="text-xl font-black text-white uppercase tracking-[0.3em] mb-3">MaintAI Planning</h2>
            <p className="text-sm text-white/30 max-w-sm font-medium leading-relaxed">
              Gestione avanzata dei piani di manutenzione programmata. Importa manuali, definisci task ciclici e monitora lo stato degli interventi per asset.
            </p>
          </div>
        ) : (
          <>
            {/* Header del Piano */}
            <header className="px-8 py-8 border-b border-white/5 bg-[#0f172a]/20 backdrop-blur-xl">
              <div className="flex justify-between items-start mb-8">
                <div className="space-y-4">
                  <div className="flex items-center gap-4">
                    <h1 className="text-3xl font-black text-white tracking-[0.1em] uppercase leading-none">{selectedPiano.nome_codificato}</h1>
                    <Badge label={selectedPiano.stato} className={cn(selectedPiano.stato === 'attivo' ? "bg-emerald-500/20 text-emerald-400" : "bg-slate-500/20 text-slate-400")} />
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {assets.filter(a => selectedPiano.asset_ids.includes(a.id)).map(a => (
                      <div key={a.id} className="bg-indigo-500/10 text-indigo-300 border border-indigo-500/20 px-3 py-1 rounded-full text-[10px] font-black uppercase tracking-widest">
                        {a.nome}
                      </div>
                    ))}
                  </div>
                  {selectedPiano.descrizione && (
                    <p className="text-sm text-white/40 max-w-2xl leading-relaxed italic border-l-2 border-white/10 pl-4 py-1">"{selectedPiano.descrizione}"</p>
                  )}
                </div>
                
                <div className="flex gap-4">
                   <div className="p-[1px] bg-gradient-to-b from-white/10 to-transparent rounded-2xl shadow-2xl">
                    <div className="bg-[#111827] rounded-2xl px-6 py-4 flex flex-col items-center justify-center min-w-[100px]">
                      <span className="text-[10px] font-black text-white/20 uppercase tracking-[0.2em] mb-1">Efficienza</span>
                      <span className="text-2xl font-black text-emerald-400">92<span className="text-[10px] text-emerald-400/40 ml-0.5">%</span></span>
                    </div>
                  </div>
                  <div className="p-[1px] bg-gradient-to-b from-white/10 to-transparent rounded-2xl shadow-2xl">
                    <div className="bg-[#111827] rounded-2xl px-6 py-4 flex flex-col items-center justify-center min-w-[100px]">
                      <span className="text-[10px] font-black text-white/20 uppercase tracking-[0.2em] mb-1">Ritardo</span>
                      <span className="text-2xl font-black text-red-500">{tasks.filter(t => isOverdue(t.next_due_at)).length}</span>
                    </div>
                  </div>
                </div>
              </div>
              
              <div className="flex gap-1">
                {[
                  { id: "tasks", label: "ATTIVITÀ E TASK", icon: "⚙️" },
                  { id: "manuali", label: "MANUALI TECNICI", icon: "📚" },
                  { id: "history", label: "CRONOLOGIA TICKET", icon: "📑" }
                ].map((tab) => (
                  <button 
                    key={tab.id} 
                    onClick={() => setActiveTab(tab.id as any)}
                    className={cn(
                      "px-6 py-3 text-[10px] font-black tracking-[0.2em] transition-all relative flex items-center gap-2 rounded-t-xl border-t border-x",
                      activeTab === tab.id 
                        ? "text-indigo-400 bg-white/5 border-white/10 shadow-inner" 
                        : "text-white/30 hover:text-white/50 border-transparent hover:bg-white/[0.02]"
                    )}
                  >
                    <span>{tab.icon}</span> {tab.label}
                    {activeTab === tab.id && <div className="absolute -bottom-[1px] left-0 right-0 h-[2px] bg-indigo-500 z-10" />}
                  </button>
                ))}
              </div>
            </header>

            {/* Content Area */}
            <div className="flex-1 overflow-auto p-8 custom-scrollbar">
              
              {/* TAB: TASKS */}
              {activeTab === "tasks" && (
                <div className="animate-in fade-in slide-in-from-bottom-2 duration-300">
                  <div className="flex justify-between items-center mb-8">
                    <h3 className="text-[11px] font-black text-white/40 uppercase tracking-[0.3em]">Gestione Ciclica Attività ({tasks.length})</h3>
                    <div className="flex gap-4">
                      <button 
                         onClick={() => { setSelectedTask(null); setShowModalTask(true); }}
                         className="px-5 py-2.5 bg-white/5 hover:bg-white/10 border border-white/10 rounded-xl text-[10px] font-bold text-white uppercase tracking-widest transition-all"
                      >
                        + Nuovo Task Manuale
                      </button>
                      <label className="px-5 py-2.5 bg-indigo-500/10 hover:bg-indigo-500 border border-indigo-500/20 rounded-xl text-[10px] font-bold text-indigo-400 hover:text-white uppercase tracking-widest cursor-pointer transition-all flex items-center gap-2">
                        {uploading ? "💾 Elaborazione AI..." : "📤 Importa Manuale PDF"}
                        <input type="file" className="hidden" accept=".pdf" onChange={handleUploadManual} disabled={uploading} />
                      </label>
                    </div>
                  </div>

                  {loadingContent ? (
                    <div className="space-y-3">
                       {[1,2,3,4,5].map(i => <div key={i} className="h-16 bg-white/5 rounded-2xl animate-pulse" />)}
                    </div>
                  ) : tasks.length === 0 ? (
                    <div className="bg-white/5 border border-dashed border-white/10 rounded-3xl p-32 flex flex-col items-center justify-center gap-6 text-center">
                      <div className="text-5xl opacity-20 filter grayscale">🔧</div>
                      <div className="space-y-1">
                        <p className="text-sm font-black text-white uppercase tracking-widest">Nessun task attivo</p>
                        <p className="text-xs text-white/20 italic">Aggiungi un task manualmente o importa un manuale tecnico.</p>
                      </div>
                    </div>
                  ) : (
                    <div className="grid grid-cols-1 gap-2.5">
                      {tasks.map(task => (
                        <div 
                           key={task.id} 
                           onClick={() => setSelectedTask(task)}
                           className="group bg-[#0f172a]/30 hover:bg-[#1e293b]/40 border border-white/5 hover:border-indigo-500/30 p-4 rounded-2xl transition-all cursor-pointer flex items-center gap-6"
                        >
                          <div className={cn("w-1.5 h-10 rounded-full", task.task_stato === 'active' ? "bg-emerald-500/50" : "bg-white/10")} />
                          <div className="flex-1 min-w-0">
                             <div className="text-xs font-black text-white group-hover:text-indigo-400 transition-colors uppercase tracking-tight truncate">{task.nome || task.descrizione}</div>
                             <div className="text-[10px] font-bold text-white/20 uppercase tracking-[0.2em] flex gap-3 mt-1">
                               <span>{task.codice || `#${task.id}`}</span>
                               <span>• {task.frequenza_giorni}g</span>
                               <span>• {task.durata_ore}h</span>
                             </div>
                          </div>
                          <div className="w-32">
                             <Badge label={task.priorita} className={PRIORITA_STYLES[task.priorita]} />
                          </div>
                          <div className="w-40 text-right">
                             <div className={cn("text-[11px] font-black", isOverdue(task.next_due_at) ? "text-red-500" : "text-white/50 text-indigo-400")}>{fmt(task.next_due_at)}</div>
                             <div className="text-[9px] font-bold text-white/20 uppercase tracking-widest">Prossima Scadenza</div>
                          </div>
                          <div className="flex gap-2 opacity-0 group-hover:opacity-100 transition-opacity pl-4">
                             <button 
                                onClick={(e) => { e.stopPropagation(); generaTicket(task); }}
                                className="px-4 py-2 bg-indigo-500 hover:bg-indigo-400 text-white rounded-xl text-[10px] font-bold uppercase tracking-widest shadow-lg shadow-indigo-500/20"
                             >
                               Ticket
                             </button>
                             <button 
                                onClick={(e) => { e.stopPropagation(); toggleTaskStato(task); }}
                                className="px-3 py-2 bg-white/10 hover:bg-white/20 text-white rounded-xl text-xs font-bold transition-all"
                             >
                               {task.task_stato === 'active' ? "⏸" : "▶"}
                             </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {/* TAB: MANUALI */}
              {activeTab === "manuali" && (
                <div className="animate-in fade-in slide-in-from-bottom-2 duration-300">
                   <div className="flex justify-between items-center mb-8">
                    <h3 className="text-[11px] font-black text-white/40 uppercase tracking-[0.3em]">Manuali Tecnici del Piano ({manuali.length})</h3>
                    <button className="text-[10px] font-bold text-indigo-400 hover:text-indigo-300 transition-colors uppercase tracking-widest pointer-events-none opacity-50">Consulta Libreria Globale</button>
                  </div>

                  {loadingContent ? (
                    <div className="grid grid-cols-2 gap-4">
                       {[1,2,3,4].map(i => <div key={i} className="h-32 bg-white/5 rounded-2xl animate-pulse" />)}
                    </div>
                  ) : manuali.length === 0 ? (
                    <div className="bg-white/5 border border-dashed border-white/10 rounded-3xl p-32 flex flex-col items-center justify-center gap-6 text-center">
                      <div className="text-5xl opacity-20 filter grayscale">📖</div>
                      <div className="space-y-1">
                        <p className="text-sm font-black text-white uppercase tracking-widest">Nessun Manuale</p>
                        <p className="text-xs text-white/20 italic">Trascina un PDF nel tab Task per iniziare l'analisi AI.</p>
                      </div>
                    </div>
                  ) : (
                    <div className="grid grid-cols-2 gap-4">
                      {manuali.map(m => (
                        <div key={m.id} className="p-5 bg-[#0f172a]/30 border border-white/5 rounded-2xl hover:border-indigo-500/50 transition-all flex items-start gap-4 h-full relative group">
                          <div className="w-12 h-12 bg-white/5 rounded-xl flex items-center justify-center text-xl shrink-0 group-hover:scale-110 transition-transform">📄</div>
                          <div className="flex-1 min-w-0">
                             <h4 className="text-xs font-black text-white uppercase tracking-tight truncate mb-1 pr-10">{m.nome}</h4>
                             <div className="flex gap-3 text-[9px] font-bold text-white/30 uppercase tracking-widest mb-4">
                               <span>{m.pagine} Pagine</span>
                               <span>• {m.metodo || 'Auto'}</span>
                               <span>• {fmt(m.created_at)}</span>
                             </div>
                             <div className="flex items-center gap-2">
                                <Badge label={`${m.task_count || 0} Tasks`} className="bg-emerald-500/10 text-emerald-400" />
                                <Badge label={m.stato} className="bg-white/5 text-white/40" />
                             </div>
                          </div>
                          <div className="absolute top-4 right-4">
                             <a 
                               href={`/manuali-viewer/${m.id}`} 
                               target="_blank" 
                               className="w-8 h-8 flex items-center justify-center text-white/40 hover:text-white bg-white/5 rounded-lg border border-white/10 hover:border-indigo-500/50 transition-all"
                               title="Sfoglia Manuale"
                             >
                               ↗
                             </a>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {/* TAB: CRONOLOGIA */}
              {activeTab === "history" && (
                <div className="animate-in fade-in slide-in-from-bottom-2 duration-300">
                   <div className="flex justify-between items-center mb-8">
                    <h3 className="text-[11px] font-black text-white/40 uppercase tracking-[0.3em]">Storico Interventi del Piano ({cronologia.length})</h3>
                    <div className="flex gap-2">
                       <button className="px-4 py-2 bg-white/5 hover:bg-white/10 rounded-xl text-[9px] font-bold text-white/40 hover:text-white uppercase tracking-widest transition-all">Scarica Report PDF</button>
                    </div>
                  </div>

                  {loadingContent ? (
                    <div className="space-y-2">
                       {[1,2,3,4,5,6].map(i => <div key={i} className="h-14 bg-white/5 rounded-xl animate-pulse" />)}
                    </div>
                  ) : cronologia.length === 0 ? (
                    <div className="p-32 text-center text-white/20 text-xs italic uppercase tracking-[0.2em]">Nessun ticket registrato per questo piano.</div>
                  ) : (
                    <div className="bg-[#0f172a]/30 border border-white/5 rounded-2xl overflow-hidden shadow-2xl">
                      <table className="w-full text-left border-collapse">
                        <thead>
                          <tr className="bg-white/5 border-b border-white/5">
                            <th className="px-5 py-4 text-[9px] font-black text-white/30 uppercase tracking-widest">Ticket</th>
                            <th className="px-5 py-4 text-[9px] font-black text-white/30 uppercase tracking-widest">Stato</th>
                            <th className="px-5 py-4 text-[9px] font-black text-white/30 uppercase tracking-widest">Data</th>
                            <th className="px-5 py-4 text-[9px] font-black text-white/30 uppercase tracking-widest">Pianificazione</th>
                            <th className="px-5 py-4 text-[9px] font-black text-white/30 uppercase tracking-widest text-right">Durata</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-white/5">
                          {cronologia.map(tk => (
                             <tr key={tk.id} className="hover:bg-white/[0.02] transition-colors group">
                               <td className="px-5 py-4">
                                  <div className="text-xs font-bold text-white mb-0.5 group-hover:text-indigo-400">#{tk.id} {tk.titolo}</div>
                                  <Badge label={tk.priorita} className={cn("text-[8px]", tk.priorita === 'Alta' ? 'text-red-400 border-red-500/20' : 'text-white/40 border-white/10')} />
                               </td>
                               <td className="px-5 py-4">
                                  <Badge label={tk.stato} className={STATO_TICKET_STYLES[tk.stato as keyof typeof STATO_TICKET_STYLES] || ""} />
                               </td>
                               <td className="px-5 py-4 text-xs text-white/40 font-mono">
                                  {fmt(tk.created_at)}
                               </td>
                               <td className="px-5 py-4 text-xs text-white/60">
                                  {tk.stato === 'Aperto' ? '—' : 'In Programma'}
                               </td>
                               <td className="px-5 py-4 text-right text-xs text-white/70 font-mono font-bold">
                                  {tk.durata_stimata_ore}h
                               </td>
                             </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              )}
            </div>
          </>
        )}
      </main>

      {/* MODALS & DRAWERS */}
      {selectedTask && (
        <DrawerTask 
           task={selectedTask} 
           pianoId={selectedPianoId!} 
           onClose={() => setSelectedTask(null)}
           onUpdated={(updated) => {
             setTasks(prev => prev.map(t => t.id === updated.id ? { ...t, ...updated } : t));
             setSelectedTask(updated);
           }}
        />
      )}

      {showModalPiano && (
        <ModalPiano 
          assets={assets}
          piano={pianoToEdit}
          onClose={() => { setShowModalPiano(false); setPianoToEdit(null); }}
          onSaved={handlePianoSaved}
        />
      )}

      {showModalTask && (
        <ModalTask 
           pianoId={selectedPianoId!} 
           onClose={() => setShowModalTask(false)}
           onSaved={(t) => {
             setTasks(prev => [t, ...prev]);
             setShowModalTask(false);
           }}
        />
      )}

      {/* Global CSS for scrollbar & transitions */}
      <style jsx global>{`
        .custom-scrollbar::-webkit-scrollbar { width: 4px; height: 4px; }
        .custom-scrollbar::-webkit-scrollbar-track { background: transparent; }
        .custom-scrollbar::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.05); border-radius: 10px; }
        .custom-scrollbar::-webkit-scrollbar-thumb:hover { background: rgba(255,255,255,0.1); }
        
        @keyframes fade-in { from { opacity: 0; } to { opacity: 1; } }
        @keyframes slide-in-right { from { transform: translateX(100%); } to { transform: translateX(0); } }
        .animate-in { animation-duration: 300ms; animation-fill-mode: both; }
        .fade-in { animation-name: fade-in; }
        .slide-in-from-right { animation-name: slide-in-right; }
      `}</style>
    </div>
  );
}
