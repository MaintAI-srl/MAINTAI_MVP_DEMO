"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import { apiPost } from "../lib/api";
import { useAuth } from "../lib/auth";
import { Bot, BrainCircuit, ChevronRight, Compass, Loader2, Maximize2, MessageCircle, Minus, Send, Sparkles, User, X } from "lucide-react";

interface Message {
  role: "user" | "assistant";
  content: string;
}

type PageGuide = {
  title: string;
  area: string;
  summary: string;
  actions: string[];
  suggestions: string[];
};

const PAGE_GUIDES: Record<string, PageGuide> = {
  "/dashboard": {
    title: "Dashboard",
    area: "KPI e controllo operativo",
    summary: "Qui controlli KPI, grafici, stato asset e dettaglio asset. Puoi personalizzare la griglia con drag and drop.",
    actions: ["Personalizzare riquadri KPI e grafici", "Aprire il dettaglio asset compatto", "Filtrare asset per sito, codice, area o stato"],
    suggestions: ["Cosa posso fare in dashboard?", "Come personalizzo i grafici?", "Come leggo OEE e MTBF?"],
  },
  "/ticket": {
    title: "Ticket",
    area: "Gestione interventi",
    summary: "Qui gestisci ticket BD, PM e CM, cambi stato, filtri il backlog ed esporti la lista.",
    actions: ["Creare o modificare ticket", "Usare filtri e paginazione", "Passare alla vista Kanban per aggiornare lo stato"],
    suggestions: ["Come apro un ticket guasto?", "Che differenza c'è tra BD, PM e CM?", "Come cambio stato a un ticket?"],
  },
  "/planning": {
    title: "Piano AI MARCO",
    area: "Pianificazione manutenzione",
    summary: "Qui generi piani con MARCO, analizzi Gantt/Kanban/Calendario e confermi l'assegnazione ai tecnici.",
    actions: ["Generare un piano deterministico o AI", "Valutare efficienza e motivazioni", "Confermare o consultare lo storico piani"],
    suggestions: ["Come genero un piano?", "Cosa succede quando confermo?", "Perché un ticket viene differito?"],
  },
  "/diagnostic": {
    title: "Analisi Ingegneria AI",
    area: "Diagnostica guidata",
    summary: "Qui avvii sessioni RCA guidate per identificare cause probabili, verifiche e azioni consigliate.",
    actions: ["Selezionare un ticket o un guasto", "Rispondere alle domande diagnostiche", "Salvare conclusioni e prossime azioni"],
    suggestions: ["Come avvio una RCA?", "Che domande mi farà l'AI?", "Come uso il risultato sul ticket?"],
  },
  "/assets": {
    title: "Asset",
    area: "Anagrafica tecnica",
    summary: "Qui consulti e filtri gli asset con dati tecnici, stato operativo, area e impianto.",
    actions: ["Cercare asset", "Aprire il dettaglio tecnico", "Verificare stato, vincoli e dati manutentivi"],
    suggestions: ["Come trovo un asset?", "Dove modifico dati tecnici?", "Cosa significa asset fermo?"],
  },
  "/asset": {
    title: "Dettaglio Asset",
    area: "Scheda macchina",
    summary: "Qui vedi informazioni tecniche, ticket collegati, vincoli e dati manutentivi del singolo asset.",
    actions: ["Controllare dati tecnici", "Aprire ticket collegati", "Verificare vincoli operativi o meteo"],
    suggestions: ["Cosa devo controllare su un asset?", "Come collego un ticket?", "Dove vedo i vincoli?"],
  },
  "/tecnici": {
    title: "Tecnici",
    area: "Risorse operative",
    summary: "Qui gestisci tecnici, disponibilità, competenze, orari e assenze.",
    actions: ["Aggiungere o modificare tecnici", "Registrare assenze", "Controllare disponibilità per il planner"],
    suggestions: ["Come registro un'assenza?", "Come influenzano il planner?", "Dove vedo i tecnici disponibili?"],
  },
  "/manuali": {
    title: "Manuali",
    area: "PDF e piani estratti",
    summary: "Qui carichi manuali PDF e fai estrarre automaticamente attività manutentive.",
    actions: ["Caricare un PDF", "Avviare analisi", "Verificare il piano estratto"],
    suggestions: ["Come carico un manuale?", "Che cosa estrae l'AI?", "Dove ritrovo il piano?"],
  },
  "/piani": {
    title: "Piani",
    area: "Manutenzione preventiva",
    summary: "Qui consulti le attività di manutenzione estratte dai manuali e rese pianificabili.",
    actions: ["Filtrare attività", "Controllare frequenze", "Collegare attività agli asset"],
    suggestions: ["Come uso un piano estratto?", "Come controllo le frequenze?", "Come nasce un'attività PM?"],
  },
  "/admin/logs": {
    title: "Log di sistema",
    area: "Amministrazione",
    summary: "Qui leggi eventi, errori e attività registrate dal backend.",
    actions: ["Filtrare log", "Individuare errori", "Verificare attività utente o sistema"],
    suggestions: ["Come interpreto un errore?", "Cosa cercare nei log?", "Come verifico un problema backend?"],
  },
  "/admin/email": {
    title: "Email-to-Ticket",
    area: "Configurazione IMAP",
    summary: "Qui configuri la casella email che trasforma messaggi in ticket.",
    actions: ["Configurare host IMAP", "Testare connessione", "Controllare polling automatico"],
    suggestions: ["Come configuro email-to-ticket?", "Ogni quanto legge le email?", "Perché non crea ticket?"],
  },
};

function guideForPath(pathname: string): PageGuide {
  const exact = PAGE_GUIDES[pathname];
  if (exact) return exact;
  const prefix = Object.keys(PAGE_GUIDES).find((path) => pathname.startsWith(path) && path !== "/");
  return prefix ? PAGE_GUIDES[prefix] : {
    title: "MaintAI",
    area: "Guida generale",
    summary: "Felix può guidarti tra dashboard, ticket, asset, tecnici, manuali, planning MARCO e diagnostica AI.",
    actions: ["Chiedere cosa fare nella pagina", "Chiedere il percorso nella sidebar", "Chiedere spiegazioni su stati, KPI o workflow"],
    suggestions: ["Cosa posso fare qui?", "Guidami nella pagina", "Qual è il prossimo passo?"],
  };
}

export default function GuideBot() {
  const { isAuthenticated, user } = useAuth();
  const pathname = usePathname();
  const pageGuide = useMemo(() => guideForPath(pathname || "/"), [pathname]);
  const [isOpen, setIsOpen] = useState(false);
  const [isMinimized, setIsMinimized] = useState(false);
  const [messages, setMessages] = useState<Message[]>([
    { role: "assistant", content: "Ciao, sono Felix. Posso guidarti dentro MaintAI e spiegarti cosa fare nella pagina in cui ti trovi." }
  ]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [messages, isOpen, isMinimized]);

  if (!isAuthenticated) return null;

  const sendMessage = async (text?: string) => {
    const userMsg = (text ?? input).trim();
    if (!userMsg || loading) return;

    setInput("");
    setMessages((prev) => [...prev, { role: "user", content: userMsg }]);
    setLoading(true);

    try {
      const history = [...messages, { role: "user" as const, content: userMsg }].slice(-10);
      const res = await apiPost<{ content: string }>("/guide/chat", {
        messages: history,
        page_context: {
          path: pathname,
          title: pageGuide.title,
          area: pageGuide.area,
          summary: pageGuide.summary,
          actions: pageGuide.actions,
          user_role: user?.ruolo || "operatore",
        },
      });
      setMessages((prev) => [...prev, { role: "assistant", content: res.content }]);
    } catch {
      setMessages((prev) => [...prev, {
        role: "assistant",
        content: `Sono online ma non riesco a raggiungere il motore guida. Intanto posso dirti che in ${pageGuide.title} puoi: ${pageGuide.actions.join(", ")}.`,
      }]);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed bottom-6 right-6 z-[9999] flex flex-col items-end">
      {isOpen && (
        <div className={`mb-4 w-[360px] md:w-[460px] bg-[#07111F]/95 backdrop-blur-xl border border-cyan-400/20 rounded-2xl shadow-2xl overflow-hidden flex flex-col transition-all duration-300 ${isMinimized ? "h-16" : "h-[640px]"}`}>
          <div className="p-4 bg-gradient-to-r from-cyan-500/15 via-blue-500/12 to-emerald-400/10 border-b border-white/10 flex items-center justify-between">
            <div className="flex items-center gap-3 min-w-0">
              <div className="w-10 h-10 rounded-xl bg-cyan-400/15 border border-cyan-300/30 flex items-center justify-center shadow-[0_0_22px_rgba(31,232,255,0.35)]">
                <BrainCircuit size={21} className="text-cyan-200" />
              </div>
              <div className="min-w-0">
                <h3 className="text-sm font-black text-white tracking-[0.18em]">FELIX</h3>
                <div className="flex items-center gap-2">
                  <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
                  <span className="text-[10px] text-emerald-300 font-bold uppercase tracking-[0.16em]">Guida contestuale</span>
                </div>
              </div>
            </div>
            <div className="flex items-center gap-1">
              <button onClick={() => setIsMinimized(!isMinimized)} className="p-2 hover:bg-white/10 rounded-lg text-slate-300 transition-colors" aria-label={isMinimized ? "Espandi Felix" : "Minimizza Felix"}>
                {isMinimized ? <Maximize2 size={16} /> : <Minus size={16} />}
              </button>
              <button onClick={() => setIsOpen(false)} className="p-2 hover:bg-red-500/20 hover:text-red-300 rounded-lg text-slate-300 transition-colors" aria-label="Chiudi Felix">
                <X size={16} />
              </button>
            </div>
          </div>

          {!isMinimized && (
            <>
              <div className="px-4 py-3 border-b border-white/10 bg-white/[0.025]">
                <div className="flex items-center gap-2 text-cyan-200 text-xs font-bold uppercase tracking-[0.14em]">
                  <Compass size={14} />
                  {pageGuide.title}
                </div>
                <p className="mt-2 text-xs leading-5 text-slate-300">{pageGuide.summary}</p>
                <div className="mt-3 grid grid-cols-1 gap-2">
                  {pageGuide.suggestions.slice(0, 3).map((suggestion) => (
                    <button
                      key={suggestion}
                      onClick={() => sendMessage(suggestion)}
                      className="group flex items-center justify-between gap-2 rounded-xl border border-cyan-300/15 bg-cyan-300/5 px-3 py-2 text-left text-xs font-semibold text-slate-200 hover:border-cyan-300/35 hover:bg-cyan-300/10 transition-colors"
                    >
                      {suggestion}
                      <ChevronRight size={14} className="text-cyan-300 group-hover:translate-x-0.5 transition-transform" />
                    </button>
                  ))}
                </div>
              </div>

              <div ref={scrollRef} className="flex-1 overflow-y-auto p-4 space-y-4">
                {messages.map((m, i) => (
                  <div key={i} className={`flex gap-2 ${m.role === "user" ? "justify-end" : "justify-start"}`}>
                    {m.role === "assistant" && <Bot size={18} className="mt-2 shrink-0 text-cyan-300" />}
                    <div className={`max-w-[84%] whitespace-pre-wrap rounded-2xl p-3 text-sm leading-6 ${
                      m.role === "user"
                        ? "bg-blue-600 text-white rounded-tr-md shadow-lg shadow-blue-900/20"
                        : "bg-white/6 border border-white/10 text-slate-100 rounded-tl-md"
                    }`}>
                      {m.content}
                    </div>
                    {m.role === "user" && <User size={18} className="mt-2 shrink-0 text-blue-200" />}
                  </div>
                ))}
                {loading && (
                  <div className="flex justify-start gap-2">
                    <Bot size={18} className="mt-2 text-cyan-300" />
                    <div className="bg-white/6 border border-white/10 px-4 py-3 rounded-2xl rounded-tl-md text-slate-300 flex items-center gap-2 text-sm">
                      <Loader2 size={15} className="animate-spin text-cyan-300" />
                      Felix sta ragionando sulla pagina...
                    </div>
                  </div>
                )}
              </div>

              <div className="p-4 bg-black/25 border-t border-white/10">
                <div className="relative">
                  <input
                    type="text"
                    value={input}
                    onChange={(e) => setInput(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && sendMessage()}
                    placeholder={`Chiedi cosa fare in ${pageGuide.title}...`}
                    className="w-full bg-white/6 border border-white/10 rounded-xl py-3 pl-4 pr-12 text-sm text-white placeholder:text-slate-500 focus:outline-none focus:border-cyan-300/50 focus:ring-1 focus:ring-cyan-300/30 transition-all"
                  />
                  <button
                    onClick={() => sendMessage()}
                    disabled={!input.trim() || loading}
                    className="absolute right-1.5 top-1.5 p-2 bg-cyan-500 hover:bg-cyan-400 disabled:bg-slate-700 text-[#07111F] rounded-lg transition-all"
                    aria-label="Invia messaggio"
                  >
                    <Send size={17} />
                  </button>
                </div>
              </div>
            </>
          )}
        </div>
      )}

      <button
        onClick={() => {
          setIsOpen(true);
          setIsMinimized(false);
        }}
        className={`group relative flex items-center justify-center w-16 h-16 rounded-2xl shadow-2xl transition-all duration-500 transform hover:scale-105 active:scale-95 ${
          isOpen ? "scale-0 opacity-0 pointer-events-none" : "scale-100 opacity-100"
        }`}
        aria-label="Apri Felix"
      >
        <div className="absolute inset-0 rounded-2xl bg-cyan-400 blur-md opacity-35 group-hover:opacity-60 transition-opacity animate-pulse" />
        <div className="relative w-full h-full rounded-2xl bg-gradient-to-br from-cyan-400 to-blue-700 flex items-center justify-center border border-white/25">
          <Sparkles className="text-white group-hover:rotate-12 transition-transform" />
          <span className="absolute -top-1 -right-1 min-w-5 h-5 px-1 bg-emerald-400 text-[#07111F] border-2 border-[#07111F] rounded-full text-[10px] font-black flex items-center justify-center">AI</span>
        </div>
      </button>
    </div>
  );
}
