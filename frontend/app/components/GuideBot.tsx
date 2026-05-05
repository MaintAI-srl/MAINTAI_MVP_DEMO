"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import { apiPost } from "../lib/api";
import { useAuth } from "../lib/auth";
import {
  Bot,
  BrainCircuit,
  ChevronRight,
  Compass,
  Loader2,
  Maximize2,
  Minus,
  Send,
  Sparkles,
  User,
  X,
} from "lucide-react";

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

type QuestionIntent = "create" | "find" | "configure" | "customize" | "explain" | "troubleshoot" | "navigate" | "operate";

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
    suggestions: ["Come apro un ticket guasto?", "Che differenza c'e tra BD, PM e CM?", "Come cambio stato a un ticket?"],
  },
  "/planning": {
    title: "Piano AI MARCO",
    area: "Pianificazione manutenzione",
    summary: "Qui generi piani con MARCO, analizzi Gantt/Kanban/Calendario e confermi l'assegnazione ai tecnici.",
    actions: ["Generare un piano deterministico o AI", "Valutare efficienza e motivazioni", "Confermare o consultare lo storico piani"],
    suggestions: ["Come genero un piano?", "Cosa succede quando confermo?", "Perche un ticket viene differito?"],
  },
  "/diagnostic": {
    title: "Analisi Ingegneria AI",
    area: "Diagnostica guidata",
    summary: "Qui avvii sessioni RCA guidate per identificare cause probabili, verifiche e azioni consigliate.",
    actions: ["Selezionare un ticket o un guasto", "Rispondere alle domande diagnostiche", "Salvare conclusioni e prossime azioni"],
    suggestions: ["Come avvio una RCA?", "Che domande mi fara l'AI?", "Come uso il risultato sul ticket?"],
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
    summary: "Qui gestisci tecnici, disponibilita, competenze, orari e assenze.",
    actions: ["Aggiungere o modificare tecnici", "Registrare assenze", "Controllare disponibilita per il planner"],
    suggestions: ["Come registro un'assenza?", "Come influenzano il planner?", "Dove vedo i tecnici disponibili?"],
  },
  "/manuali": {
    title: "Manuali",
    area: "PDF e piani estratti",
    summary: "Qui carichi manuali PDF e fai estrarre automaticamente attivita manutentive.",
    actions: ["Caricare un PDF", "Avviare analisi", "Verificare il piano estratto"],
    suggestions: ["Come carico un manuale?", "Che cosa estrae l'AI?", "Dove ritrovo il piano?"],
  },
  "/piani": {
    title: "Piani",
    area: "Manutenzione preventiva",
    summary: "Qui consulti le attivita di manutenzione estratte dai manuali e rese pianificabili.",
    actions: ["Filtrare attivita", "Controllare frequenze", "Collegare attivita agli asset"],
    suggestions: ["Come uso un piano estratto?", "Come controllo le frequenze?", "Come nasce un'attivita PM?"],
  },
  "/admin/logs": {
    title: "Log di sistema",
    area: "Amministrazione",
    summary: "Qui leggi eventi, errori e attivita registrate dal backend.",
    actions: ["Filtrare log", "Individuare errori", "Verificare attivita utente o sistema"],
    suggestions: ["Come interpreto un errore?", "Cosa cercare nei log?", "Come verifico un problema backend?"],
  },
  "/admin/email": {
    title: "Email-to-Ticket",
    area: "Configurazione IMAP",
    summary: "Qui configuri la casella email che trasforma messaggi in ticket.",
    actions: ["Configurare host IMAP", "Testare connessione", "Controllare polling automatico"],
    suggestions: ["Come configuro email-to-ticket?", "Ogni quanto legge le email?", "Perche non crea ticket?"],
  },
};

function guideForPath(pathname: string): PageGuide {
  const exact = PAGE_GUIDES[pathname];
  if (exact) return exact;
  const prefix = Object.keys(PAGE_GUIDES).find((path) => pathname.startsWith(path) && path !== "/");
  return prefix ? PAGE_GUIDES[prefix] : {
    title: "MaintAI",
    area: "Guida generale",
    summary: "Felix puo guidarti tra dashboard, ticket, asset, tecnici, manuali, planning MARCO e diagnostica AI.",
    actions: ["Chiedere cosa fare nella pagina", "Chiedere il percorso nella sidebar", "Chiedere spiegazioni su stati, KPI o workflow"],
    suggestions: ["Cosa posso fare qui?", "Guidami nella pagina", "Qual e il prossimo passo?"],
  };
}

function detectIntent(question: string): QuestionIntent {
  const q = question.toLowerCase();
  if (/(crea|creare|aggiung|nuovo|inserisc|apri un ticket|registra)/.test(q)) return "create";
  if (/(trovo|trovare|cerca|dove vedo|visualizz|filtr|lista|cercare)/.test(q)) return "find";
  if (/(configur|impost|colleg|email|imap|utente|permess|tenant)/.test(q)) return "configure";
  if (/(personalizz|spost|drag|graf|riquadro|dashboard|kpi)/.test(q)) return "customize";
  if (/(errore|non funziona|non va|problema|blocc|accesso|server)/.test(q)) return "troubleshoot";
  if (/(che cos|cosa significa|perche|mtbf|oee|bd|pm|cm|stato)/.test(q)) return "explain";
  if (/(dove|pagina|menu|sidebar|sezione|vai|andare)/.test(q)) return "navigate";
  return "operate";
}

function topicSteps(pageGuide: PageGuide, question: string): string[] {
  const q = question.toLowerCase();
  if (q.includes("ticket")) {
    return [
      "Apri Operazioni > Ticket dalla sidebar, oppure entra dalla scheda Asset se il ticket riguarda una macchina specifica.",
      "Premi Nuovo ticket e scegli il tipo: BD per guasto, PM per preventiva, CM per correttiva.",
      "Seleziona asset, priorita, durata stimata e descrivi il problema in modo operativo.",
      "Salva: il ticket entra nel backlog e potra essere pianificato da MARCO.",
      "Controlla lo stato nella tabella o nella vista Kanban.",
    ];
  }
  if (q.includes("vincol")) {
    return [
      "Apri Risorse > Asset e seleziona la macchina interessata.",
      "Entra nella scheda tecnica dell'asset.",
      "Cerca vincoli operativi, vincoli manutenzione, vincoli meteo, orari o note tecniche.",
      "Aggiorna i vincoli prima di generare il piano: MARCO li usa per evitare assegnazioni non compatibili.",
      "Torna in Planning e rigenera il piano se hai modificato vincoli importanti.",
    ];
  }
  if (q.includes("manual")) {
    return [
      "Apri Risorse > Manuali.",
      "Carica il PDF del manuale tecnico.",
      "Avvia l'analisi AI e attendi l'estrazione delle attivita.",
      "Vai in Piani per controllare frequenze, descrizioni e asset collegati.",
      "Usa quelle attivita come base per ticket PM o pianificazione preventiva.",
    ];
  }
  if (q.includes("piano") || q.includes("marco") || q.includes("planning")) {
    return [
      "Apri Operazioni > Pianificazione.",
      "Aggiorna i ticket se sei appena rientrato nella pagina.",
      "Scegli modalita deterministica o AI e genera il piano.",
      "Controlla Gantt, Kanban, calendario, motivazioni e score efficienza.",
      "Conferma solo quando assegnazioni, date e ticket differiti sono corretti.",
    ];
  }
  if (q.includes("dashboard") || q.includes("graf") || q.includes("kpi")) {
    return [
      "Apri Dashboard.",
      "Premi Personalizza per entrare in modalita modifica.",
      "Trascina KPI, grafici e Dettaglio KPI per Asset nella posizione desiderata.",
      "Nei grafici scegli dati e tipologia: Torta, Barre, Area o Linea.",
      "Apri Dettaglio KPI per Asset e filtra per Sito, Codice, Asset, Area o Stato.",
    ];
  }
  return pageGuide.actions.map((action) => `Esegui: ${action}`);
}

function localGuideAnswer(pageGuide: PageGuide, question: string): string {
  const intent = detectIntent(question);
  const steps = topicSteps(pageGuide, question);
  const intentLabel: Record<QuestionIntent, string> = {
    create: "Creazione",
    find: "Ricerca o consultazione",
    configure: "Configurazione",
    customize: "Personalizzazione",
    explain: "Spiegazione",
    troubleshoot: "Risoluzione problema",
    navigate: "Navigazione",
    operate: "Procedura operativa",
  };

  return [
    `Ho capito: ${intentLabel[intent]}.`,
    `Contesto: ${pageGuide.title} - ${pageGuide.area}.`,
    "",
    "Procedura passo passo:",
    ...steps.map((step, index) => `${index + 1}. ${step}`),
    "",
    "Controllo finale:",
    "- Verifica che il dato sia salvato o visibile nella pagina.",
    "- Se il risultato non cambia, aggiorna la pagina e riprova il passaggio chiave.",
    "",
    "Vuoi che ti guidi sul prossimo click preciso?",
  ].join("\n");
}

export default function GuideBot() {
  const { isAuthenticated, user } = useAuth();
  const pathname = usePathname();
  const pageGuide = useMemo(() => guideForPath(pathname || "/"), [pathname]);
  const [isOpen, setIsOpen] = useState(false);
  const [isMinimized, setIsMinimized] = useState(false);
  const [messages, setMessages] = useState<Message[]>([
    { role: "assistant", content: "Ciao, sono Felix. Sono la guida operativa di MaintAI: dimmi cosa vuoi fare e ti rispondo con una procedura passo passo." }
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
      setMessages((prev) => [...prev, { role: "assistant", content: res.content || localGuideAnswer(pageGuide, userMsg) }]);
    } catch {
      setMessages((prev) => [...prev, {
        role: "assistant",
        content: localGuideAnswer(pageGuide, userMsg),
      }]);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed bottom-6 right-6 z-[9999] flex flex-col items-end">
      {isOpen && (
        <div className={`mb-4 w-[390px] md:w-[500px] bg-[#07111F]/95 backdrop-blur-xl border border-cyan-400/20 rounded-2xl shadow-2xl overflow-hidden flex flex-col transition-all duration-300 ${isMinimized ? "h-16" : "h-[660px]"}`}>
          <div className="p-4 bg-gradient-to-r from-cyan-500/15 via-blue-500/12 to-emerald-400/10 border-b border-white/10 flex items-center justify-between">
            <div className="flex items-center gap-3 min-w-0">
              <div className="w-10 h-10 rounded-xl bg-cyan-400/15 border border-cyan-300/30 flex items-center justify-center shadow-[0_0_22px_rgba(31,232,255,0.35)]">
                <BrainCircuit size={21} className="text-cyan-200" />
              </div>
              <div className="min-w-0">
                <h3 className="text-base font-black text-white tracking-[0.18em]">FELIX</h3>
                <div className="flex items-center gap-2">
                  <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
                  <span className="text-xs text-emerald-300 font-bold uppercase tracking-[0.16em]">Guida tutorial passo passo</span>
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
              <div className="px-5 py-4 border-b border-white/10 bg-white/[0.025]">
                <div className="flex items-center gap-2 text-cyan-200 text-sm font-black uppercase tracking-[0.14em]">
                  <Compass size={16} />
                  {pageGuide.title}
                </div>
                <p className="mt-2 text-sm leading-6 text-slate-200">{pageGuide.summary}</p>
                <div className="mt-3 grid grid-cols-1 gap-2">
                  {pageGuide.suggestions.slice(0, 3).map((suggestion) => (
                    <button
                      key={suggestion}
                      onClick={() => sendMessage(suggestion)}
                      className="group flex items-center justify-between gap-2 rounded-xl border border-cyan-300/20 bg-cyan-300/6 px-3.5 py-2.5 text-left text-sm font-bold text-slate-100 hover:border-cyan-300/45 hover:bg-cyan-300/12 transition-colors"
                    >
                      {suggestion}
                      <ChevronRight size={16} className="text-cyan-300 group-hover:translate-x-0.5 transition-transform" />
                    </button>
                  ))}
                </div>
              </div>

              <div ref={scrollRef} className="flex-1 overflow-y-auto p-5 space-y-4">
                {messages.map((m, i) => (
                  <div key={i} className={`flex gap-2 ${m.role === "user" ? "justify-end" : "justify-start"}`}>
                    {m.role === "assistant" && <Bot size={20} className="mt-2 shrink-0 text-cyan-300" />}
                    <div className={`max-w-[84%] whitespace-pre-wrap rounded-2xl p-3.5 text-base leading-7 ${
                      m.role === "user"
                        ? "bg-blue-600 text-white rounded-tr-md shadow-lg shadow-blue-900/20"
                        : "bg-white/6 border border-white/10 text-slate-100 rounded-tl-md"
                    }`}>
                      {m.content}
                    </div>
                    {m.role === "user" && <User size={20} className="mt-2 shrink-0 text-blue-200" />}
                  </div>
                ))}
                {loading && (
                  <div className="flex justify-start gap-2">
                    <Bot size={20} className="mt-2 text-cyan-300" />
                    <div className="bg-white/6 border border-white/10 px-4 py-3 rounded-2xl rounded-tl-md text-slate-300 flex items-center gap-2 text-base">
                      <Loader2 size={15} className="animate-spin text-cyan-300" />
                      Felix sta preparando la procedura...
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
                    placeholder={`Dimmi cosa vuoi fare in ${pageGuide.title}...`}
                    className="w-full bg-white/6 border border-white/10 rounded-xl py-3.5 pl-4 pr-12 text-base text-white placeholder:text-slate-500 focus:outline-none focus:border-cyan-300/50 focus:ring-1 focus:ring-cyan-300/30 transition-all"
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
