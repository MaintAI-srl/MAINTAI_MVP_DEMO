"use client";

import { useEffect, useState, useCallback, useMemo } from "react";
import { apiGet, apiPost, apiDelete, apiPut } from "../lib/api";
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
  asset_nome: string; // nome del primo asset (legacy compat)
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
  Alta: "bg-red-500/10 text-red-400 border border-red-500/20",
  Media: "bg-amber-500/10 text-amber-400 border border-amber-500/20",
  Bassa: "bg-green-500/10 text-green-400 border border-green-500/20",
};

const STATO_TASK_STYLES: Record<string, string> = {
  active: "bg-emerald-500/10 text-emerald-400 border border-emerald-500/20",
  paused: "bg-slate-500/10 text-slate-400 border border-slate-500/20",
  archived: "bg-red-500/10 text-red-400 border border-red-500/20",
};

// ─── Componenti UI ────────────────────────────────────────────────────────────

function Badge({ label, className }: { label: string; className?: string }) {
  return (
    <span className={cn("px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider", className)}>
      {label}
    </span>
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
            {assets.length === 0 && <div className="text-xs text-amber-400/80 italic p-2">Caricamento asset o nessun asset trovato...</div>}
          </div>

          <div>
            <label className="block text-[10px] font-bold text-white/40 uppercase tracking-widest mb-2">Descrizione Operativa</label>
            <textarea 
              value={form.descrizione} 
              onChange={e => setForm(f => ({ ...f, descrizione: e.target.value }))}
              placeholder="Inserisci scopo del piano, vincoli o note generali..."
              className="w-full bg-white/5 border border-white/5 rounded-xl p-3 text-sm text-white placeholder:text-white/20 focus:outline-none focus:ring-2 focus:ring-indigo-500/50 resize-none h-24 transition-all"
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

// ─── PIANI PAGE ───────────────────────────────────────────────────────────────

export default function PianiPage() {
  const [piani, setPiani] = useState<Piano[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedPianoId, setSelectedPianoId] = useState<number | null>(null);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [loadingTasks, setLoadingTasks] = useState(false);
  const [search, setSearch] = useState("");
  
  const [assets, setAssets] = useState<AssetOption[]>([]);
  const [showModalPiano, setShowModalPiano] = useState(false);
  const [pianoToEdit, setPianoToEdit] = useState<Piano | null>(null);

  // ── Data Fetching ──
  const fetchPiani = useCallback(async () => {
    setLoading(true);
    try {
      const res = await apiGet<{ items: Piano[] }>("/piani-manutenzione?limit=200");
      setPiani(res.items || []);
    } catch (err: any) { notify.error("Errore caricamento piani"); }
    finally { setLoading(false); }
  }, []);

  const fetchAssets = useCallback(async () => {
    try {
      const res = await apiGet<AssetOption[]>("/assets");
      setAssets(Array.isArray(res) ? res : []);
    } catch { setAssets([]); }
  }, []);

  const fetchTasks = useCallback(async (pid: number) => {
    setLoadingTasks(true);
    try {
      const res = await apiGet<{ items: Task[] }>(`/piani-manutenzione/${pid}/tasks?limit=500`);
      setTasks(res.items || []);
    } catch { notify.error("Errore caricamento task"); }
    finally { setLoadingTasks(false); }
  }, []);

  useEffect(() => { 
    fetchPiani();
    fetchAssets();
  }, [fetchPiani, fetchAssets]);

  useEffect(() => {
    if (selectedPianoId) fetchTasks(selectedPianoId);
    else setTasks([]);
  }, [selectedPianoId, fetchTasks]);

  // ── Logica UI ──
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
    if (pianoToEdit) {
      setPiani(prev => prev.map(old => old.id === p.id ? { ...old, ...p } : old));
    } else {
      setPiani(prev => [p, ...prev]);
    }
    setShowModalPiano(false);
    setPianoToEdit(null);
    setSelectedPianoId(p.id);
  };

  const deletePiano = async (pid: number) => {
    if (!confirm("Eliminare definitivamente questo piano e tutti i suoi task? I ticket collegati verranno scollegati ma non eliminati.")) return;
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
      notify.success(`${res.created} ticket generati in stato APERTO`);
      // Ricarica task per aggiornare last_generated e next_due
      fetchTasks(selectedPianoId!);
    } catch (err: any) { notify.error(err.message || "Errore generazione ticket"); }
  };

  return (
    <div className="flex h-full overflow-hidden bg-[#0a0f18]">
      
      {/* ── SIDEBAR PIANI ── */}
      <aside className="w-[300px] flex-shrink-0 border-r border-white/5 flex flex-col bg-[#0f172a]/50">
        <div className="p-4 border-b border-white/5 space-y-3">
          <div className="flex justify-between items-center">
            <h2 className="text-[11px] font-black text-white/40 uppercase tracking-[0.2em]">Piani Attivi</h2>
            <Badge label={piani.length.toString()} className="bg-white/5 text-white/60 border border-white/10" />
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
              className="w-full bg-white/5 border border-white/5 rounded-lg py-1.5 pl-8 pr-3 text-xs text-white placeholder:text-white/30 focus:outline-none focus:border-white/20 transition-all"
            />
            <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-white/30 text-xs">🔍</span>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto px-2 py-3 space-y-1.5 custom-scrollbar">
          {loading && piani.length === 0 ? (
            <div className="p-10 text-center animate-pulse text-white/20 text-xs italic">Caricamento in corso...</div>
          ) : filteredPiani.length === 0 ? (
            <div className="p-10 text-center text-white/20 text-xs italic">Nessun piano trovato</div>
          ) : (
            filteredPiani.map(p => (
              <div 
                key={p.id}
                onClick={() => setSelectedPianoId(p.id)}
                className={cn(
                  "p-3 rounded-xl border cursor-pointer transition-all group relative",
                  selectedPianoId === p.id 
                    ? "bg-indigo-500/10 border-indigo-500/50 shadow-inner" 
                    : "bg-transparent border-transparent hover:bg-white/5 hover:border-white/10"
                )}
              >
                <div className="flex justify-between items-start mb-1.5">
                  <span className={cn("text-xs font-black tracking-tighter", selectedPianoId === p.id ? "text-indigo-400" : "text-white/80")}>
                    {p.nome_codificato}
                  </span>
                  <div className="opacity-0 group-hover:opacity-100 transition-opacity flex gap-1">
                    <button onClick={(e) => { e.stopPropagation(); setPianoToEdit(p); setShowModalPiano(true); }} className="p-1 text-white/40 hover:text-white transition-colors">✎</button>
                    <button onClick={(e) => { e.stopPropagation(); deletePiano(p.id); }} className="p-1 text-red-500/40 hover:text-red-400 transition-colors">✕</button>
                  </div>
                </div>
                <div className="text-[10px] text-white/40 font-medium truncate mb-2">{p.asset_nome || "Multiple Assets"}</div>
                <div className="flex gap-2">
                  <div className="flex items-center gap-1 text-[9px] font-bold text-white/20 uppercase tracking-widest">
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" /> {p.task_count} Tasks
                  </div>
                  {p.open_ticket_count > 0 && (
                    <div className="flex items-center gap-1 text-[9px] font-bold text-indigo-400 uppercase tracking-widest">
                      <span className="w-1.5 h-1.5 rounded-full bg-indigo-500 animate-pulse" /> {p.open_ticket_count} Tickets
                    </div>
                  )}
                </div>
              </div>
            ))
          )}
        </div>
      </aside>

      {/* ── MAIN CONTENT ── */}
      <main className="flex-1 flex flex-col min-w-0">
        {!selectedPiano ? (
          <div className="flex-1 flex flex-col items-center justify-center text-center p-10">
            <div className="w-20 h-20 bg-white/5 rounded-full flex items-center justify-center text-3xl mb-4 text-white/10 border border-white/5">📋</div>
            <h2 className="text-lg font-bold text-white/50 mb-2">Modulo Piani di Manutenzione</h2>
            <p className="text-sm text-white/30 max-w-sm">
              Seleziona un piano dalla lista a sinistra per visualizzare le attività pianificate, i manuali e gestire la generazione dei ticket.
            </p>
          </div>
        ) : (
          <>
            {/* Header del Piano */}
            <header className="px-8 py-6 border-b border-white/5 bg-[#0f172a]/20 backdrop-blur-md">
              <div className="flex justify-between items-start">
                <div className="space-y-3">
                  <div className="flex items-center gap-3">
                    <h1 className="text-2xl font-black text-white tracking-widest uppercase">{selectedPiano.nome_codificato}</h1>
                    <Badge label={selectedPiano.stato} className={selectedPiano.stato === 'attivo' ? "bg-emerald-500/20 text-emerald-400" : "bg-slate-500/20 text-slate-400"} />
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {assets.filter(a => selectedPiano.asset_ids.includes(a.id)).map(a => (
                      <Badge key={a.id} label={a.nome} className="bg-indigo-500/10 text-indigo-300 border border-indigo-500/20" />
                    ))}
                  </div>
                  {selectedPiano.descrizione && (
                    <p className="text-sm text-white/40 max-w-2xl leading-relaxed italic">"{selectedPiano.descrizione}"</p>
                  )}
                </div>
                <div className="flex gap-3">
                  <div className="bg-white/5 border border-white/10 rounded-2xl px-5 py-3 flex flex-col items-center justify-center">
                    <span className="text-[10px] font-bold text-white/30 uppercase tracking-[0.2em] mb-1">Efficienza</span>
                    <span className="text-xl font-black text-emerald-400">92%</span>
                  </div>
                  <div className="bg-white/5 border border-white/10 rounded-2xl px-5 py-3 flex flex-col items-center justify-center">
                    <span className="text-[10px] font-bold text-white/30 uppercase tracking-[0.2em] mb-1">Scadenze 7g</span>
                    <span className="text-xl font-black text-amber-400">{tasks.filter(t => isOverdue(t.next_due_at)).length}</span>
                  </div>
                </div>
              </div>
              
              <div className="flex mt-8 border-b border-white/5">
                {["ATTIVITÀ E TASK", "MANUALI AI", "CRONOLOGIA TICKET"].map((tab, i) => (
                  <button 
                    key={tab} 
                    className={cn(
                      "px-6 py-3 text-[10px] font-black tracking-[0.2em] transition-all relative",
                      i === 0 ? "text-indigo-400" : "text-white/40 hover:text-white/60"
                    )}
                  >
                    {tab}
                    {i === 0 && <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-indigo-500" />}
                  </button>
                ))}
              </div>
            </header>

            {/* Content: Tasks Table */}
            <div className="flex-1 overflow-auto p-8 custom-scrollbar">
              <div className="flex justify-between items-center mb-6">
                <h3 className="text-[10px] font-black text-white/30 uppercase tracking-[0.2em]">Elenco Operativo Task ({tasks.length})</h3>
                <div className="flex gap-4">
                  <button className="text-[10px] font-bold text-indigo-400 hover:text-indigo-300 transition-colors uppercase tracking-widest">+ Aggiungi Task Manuale</button>
                  <button className="text-[10px] font-bold text-emerald-400 hover:text-emerald-300 transition-colors uppercase tracking-widest underline decoration-2 underline-offset-4 pointer-events-none opacity-50">Sincronizza AI PDF</button>
                </div>
              </div>

              {loadingTasks ? (
                <div className="grid grid-cols-1 gap-4">
                   {[1,2,3].map(i => <div key={i} className="h-16 bg-white/5 rounded-xl animate-pulse" />)}
                </div>
              ) : tasks.length === 0 ? (
                <div className="bg-white/5 border border-dashed border-white/10 rounded-2xl p-20 flex flex-col items-center justify-center gap-4">
                  <div className="text-4xl opacity-20">⚙️</div>
                  <p className="text-sm text-white/30 font-medium italic">Nessun task definito per questo piano.</p>
                  <button className="bg-white/10 hover:bg-white/20 text-white px-6 py-2 rounded-xl text-xs font-bold transition-all">Configura primo Task</button>
                </div>
              ) : (
                <div className="bg-[#0f172a]/30 border border-white/5 rounded-2xl overflow-hidden shadow-2xl">
                  <table className="w-full text-left border-collapse">
                    <thead>
                      <tr className="bg-white/5 border-b border-white/5">
                        <th className="px-5 py-4 text-[9px] font-black text-white/30 uppercase tracking-widest">Task / Codice</th>
                        <th className="px-5 py-4 text-[9px] font-black text-white/30 uppercase tracking-widest text-center">Frequenza</th>
                        <th className="px-5 py-4 text-[9px] font-black text-white/30 uppercase tracking-widest text-center">Durata</th>
                        <th className="px-5 py-4 text-[9px] font-black text-white/30 uppercase tracking-widest">Priorità</th>
                        <th className="px-5 py-4 text-[9px] font-black text-white/30 uppercase tracking-widest">Prossima Scadenza</th>
                        <th className="px-5 py-4 text-[9px] font-black text-white/30 uppercase tracking-widest text-right">Azioni</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-white/5">
                      {tasks.map(task => (
                        <tr key={task.id} className="hover:bg-white/[0.02] transition-colors group">
                          <td className="px-5 py-5 min-w-[200px]">
                            <div className="flex items-center gap-3">
                              <div className={cn("w-1.5 h-1.5 rounded-full", task.task_stato === 'active' ? "bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.5)]" : "bg-white/20")} />
                              <div>
                                <div className="text-xs font-bold text-white mb-0.5 tracking-tight group-hover:text-indigo-400 transition-colors">{task.nome || task.descrizione}</div>
                                <div className="text-[10px] text-white/20 font-bold tracking-widest uppercase">{task.codice || `#${task.id}`}</div>
                              </div>
                            </div>
                          </td>
                          <td className="px-5 py-5 text-center">
                            <span className="text-xs text-white/70 font-mono italic">{task.frequenza_giorni ? `${task.frequenza_giorni}g` : '—'}</span>
                          </td>
                          <td className="px-5 py-5 text-center">
                            <span className="text-xs text-white/70 font-mono italic">{task.durata_ore ? `${task.durata_ore}h` : '—'}</span>
                          </td>
                          <td className="px-5 py-5">
                             <Badge label={task.priorita} className={PRIORITA_STYLES[task.priorita] || PRIORITA_STYLES.Media} />
                          </td>
                          <td className="px-5 py-5">
                            <div className="flex flex-col">
                              <span className={cn("text-xs font-bold", isOverdue(task.next_due_at) ? "text-red-400" : "text-white/60")}>
                                {fmt(task.next_due_at)}
                              </span>
                              {task.last_generated_at && <span className="text-[9px] text-white/20">U.G: {fmt(task.last_generated_at)}</span>}
                            </div>
                          </td>
                          <td className="px-5 py-5 text-right space-x-2">
                             <button 
                                onClick={() => generaTicket(task)}
                                className="bg-indigo-500/10 hover:bg-indigo-500 text-indigo-400 hover:text-white px-3 py-1.5 rounded-lg text-[10px] font-bold uppercase tracking-widest transition-all border border-indigo-500/20"
                             >
                               Ticket
                             </button>
                             <button 
                                onClick={() => toggleTaskStato(task)}
                                className="p-1.5 rounded-lg bg-white/5 hover:bg-white/10 text-white/40 transition-all border border-white/5"
                                title={task.task_stato === 'active' ? "Pausa" : "Attiva"}
                             >
                               {task.task_stato === 'active' ? "⏸" : "▶"}
                             </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </>
        )}
      </main>

      {/* MODALS */}
      {showModalPiano && (
        <ModalPiano 
          assets={assets}
          piano={pianoToEdit}
          onClose={() => { setShowModalPiano(false); setPianoToEdit(null); }}
          onSaved={handlePianoSaved}
        />
      )}

      {/* Global CSS for scrollbar */}
      <style jsx global>{`
        .custom-scrollbar::-webkit-scrollbar { width: 4px; height: 4px; }
        .custom-scrollbar::-webkit-scrollbar-track { background: transparent; }
        .custom-scrollbar::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.05); border-radius: 10px; }
        .custom-scrollbar::-webkit-scrollbar-thumb:hover { background: rgba(255,255,255,0.1); }
      `}</style>
    </div>
  );
}
