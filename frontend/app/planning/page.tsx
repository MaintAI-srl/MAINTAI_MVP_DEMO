"use client";

import { useEffect, useState, useMemo, useCallback } from "react";
import { toast } from "sonner";
import { apiGet, apiPost, apiPut } from "../lib/api";
import { DndContext, useDraggable, DragEndEvent, DragOverlay, useSensor, useSensors, PointerSensor } from "@dnd-kit/core";

import BadgeEfficienza from "./components/BadgeEfficienza";
import PannelloMotivazioni from "./components/PannelloMotivazioni";
import KanbanSettimanale from "./components/KanbanSettimanale";
import CalendarioMensile from "./components/CalendarioMensile";
import StoricoPiani from "./components/StoricoPiani";
import RollingAnalysisPanel from "./components/RollingAnalysisPanel";

import type {
  TicketData,
  TecnicoData,
  PlannedWO,
  DeferredWO,
  GeneratedPlan,
  EfficiencyBreakdown,
  EfficiencyMotivation,
} from "./types";

// ── Tipi risposta API tecnici ─────────────────────────────────────────────────
interface TecnicoAPI {
  id: number;
  nome: string;
  cognome: string | null;
  competenze: string;
  ore_giornaliere: number;
  orario_inizio: string;
  orario_fine: string;
  stato: string;
}

type VistaAttiva = "settimanale" | "mensile" | "rolling";
type Modalita = "manuale" | "ai";
type EngineMode = "deterministic" | "ai";

// ── Componente BacklogBar ─────────────────────────────────────────────────────
function BacklogBar({
  label,
  count,
  ore,
  color,
  borderColor,
  percent,
}: {
  label: string;
  count: number;
  ore: number;
  color: string;
  borderColor: string;
  percent: number;
}) {
  const [displayed, setDisplayed] = useState(0);

  useEffect(() => {
    let start = 0;
    const step = percent / 30;
    const timer = setInterval(() => {
      start += step;
      if (start >= percent) { setDisplayed(percent); clearInterval(timer); return; }
      setDisplayed(Math.round(start));
    }, 20);
    return () => clearInterval(timer);
  }, [percent]);

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11, marginBottom: 4 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <span style={{
            width: 8, height: 8, borderRadius: "50%",
            background: borderColor, flexShrink: 0,
            boxShadow: `0 0 6px ${borderColor}`,
          }} />
          <span style={{
            fontWeight: 700, fontSize: 12,
            background: color,
            WebkitBackgroundClip: "text",
            WebkitTextFillColor: "transparent",
          }}>{label}</span>
        </div>
        <span style={{ color: "#9ca3af" }}>{displayed}%</span>
      </div>
      <div style={{
        height: 6, background: "#1f2937",
        borderRadius: 3, overflow: "hidden", marginBottom: 4,
      }}>
        <div style={{
          height: "100%",
          width: `${displayed}%`,
          background: color,
          borderRadius: 3,
          transition: "width 0.05s linear",
          boxShadow: `0 0 8px ${borderColor}88`,
        }} />
      </div>
      <div style={{ fontSize: 10, color: "#6b7280" }}>
        {count} ticket · {ore.toFixed(1)}h stimate
      </div>
    </div>
  );
}

// ── Ticket draggabile per pianificazione manuale ──────────────────────────────
function DraggableTicket({
  ticket,
  onClickPlan,
}: {
  ticket: TicketData;
  onClickPlan: (t: TicketData) => void;
}) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: `ticket-${ticket.id}`,
    data: { ticketId: ticket.id },
  });

  const tipo = ticket.tipo ?? "CM";
  const tipoBg: Record<string, string> = { BD: "#7f1d1d44", PM: "#14532d44", CM: "#78350f44" };
  const tipoColor: Record<string, string> = { BD: "#fca5a5", PM: "#86efac", CM: "#fcd34d" };
  const prioBorder: Record<string, string> = { Alta: "#ef4444", Media: "#f59e0b", Bassa: "#6b7280" };

  const style: React.CSSProperties = {
    background: "#1a2332",
    border: `1px solid ${isDragging ? "#3b82f6" : "#2a3748"}`,
    borderRadius: 6,
    padding: "8px 10px",
    marginBottom: 6,
    cursor: isDragging ? "grabbing" : "grab",
    opacity: isDragging ? 0.4 : 1,
    position: "relative" as const,
    transform: transform ? `translate(${transform.x}px, ${transform.y}px)` : undefined,
    boxShadow: isDragging ? "0 4px 16px rgba(59,130,246,0.3)" : undefined,
    userSelect: "none" as const,
  };

  return (
    <div ref={setNodeRef} style={style} {...listeners} {...attributes}>
      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4, alignItems: "center" }}>
        <span style={{
          fontSize: 10, fontWeight: 700,
          background: tipoBg[tipo] ?? "#78350f44",
          color: tipoColor[tipo] ?? "#fcd34d",
          padding: "1px 5px", borderRadius: 3,
        }}>{tipo}</span>
        <span style={{
          fontSize: 9, fontWeight: 700,
          color: prioBorder[ticket.priorita ?? "Bassa"],
          textTransform: "uppercase" as const,
          letterSpacing: "0.05em",
        }}>{ticket.priorita ?? "—"}</span>
      </div>
      <div style={{ fontSize: 12, fontWeight: 600, color: "#e2e8f0", marginBottom: 2, lineHeight: 1.3 }}>
        #{ticket.id} {ticket.titolo ?? "—"}
      </div>
      {ticket.durata_stimata_ore && (
        <div style={{ fontSize: 10, color: "#6b7280", marginBottom: 4 }}>
          {ticket.durata_stimata_ore}h stimate
        </div>
      )}
      <button
        onPointerDown={e => e.stopPropagation()}
        onClick={e => { e.stopPropagation(); onClickPlan(ticket); }}
        style={{
          width: "100%",
          background: "#1f2937",
          border: "1px solid #374151",
          color: "#9ca3af",
          borderRadius: 4,
          padding: "4px 8px",
          fontSize: 10,
          cursor: "pointer",
        }}
      >
        ✏ Pianifica
      </button>
    </div>
  );
}

// ── Modale assegnazione manuale ────────────────────────────────────────────────
function ModalePianificaManuale({
  ticket,
  tecnici,
  onSave,
  onClose,
}: {
  ticket: TicketData;
  tecnici: TecnicoData[];
  onSave: (ticketId: number, tecnicoId: number, data: string) => void;
  onClose: () => void;
}) {
  const [tecnicoId, setTecnicoId] = useState<number>(tecnici[0]?.id ?? 0);
  const [data, setData] = useState(new Date().toISOString().slice(0, 10));

  return (
    <div style={{
      position: "fixed", inset: 0,
      background: "rgba(0,0,0,0.7)",
      display: "flex", alignItems: "center", justifyContent: "center",
      zIndex: 1000,
    }} onClick={onClose}>
      <div
        style={{
          background: "#111827",
          border: "1px solid #1f2937",
          borderRadius: 12,
          padding: 24,
          width: 360,
          boxShadow: "0 24px 60px rgba(0,0,0,0.6)",
        }}
        onClick={e => e.stopPropagation()}
      >
        <div style={{ fontSize: 15, fontWeight: 700, color: "#f9fafb", marginBottom: 4 }}>
          Pianifica Manualmente
        </div>
        <div style={{ fontSize: 12, color: "#9ca3af", marginBottom: 20 }}>
          #{ticket.id} — {ticket.titolo}
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <div>
            <label style={{ fontSize: 11, color: "#9ca3af", display: "block", marginBottom: 4 }}>
              Tecnico
            </label>
            <select
              value={tecnicoId}
              onChange={e => setTecnicoId(Number(e.target.value))}
              style={{
                width: "100%",
                background: "#1f2937",
                border: "1px solid #374151",
                color: "#f9fafb",
                borderRadius: 6,
                padding: "8px 10px",
                fontSize: 13,
              }}
            >
              {tecnici.map(t => (
                <option key={t.id} value={t.id}>
                  {t.nome} {t.cognome ?? ""}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label style={{ fontSize: 11, color: "#9ca3af", display: "block", marginBottom: 4 }}>
              Data pianificata
            </label>
            <input
              type="date"
              value={data}
              onChange={e => setData(e.target.value)}
              style={{
                width: "100%",
                background: "#1f2937",
                border: "1px solid #374151",
                color: "#f9fafb",
                borderRadius: 6,
                padding: "8px 10px",
                fontSize: 13,
                boxSizing: "border-box",
              }}
            />
          </div>
        </div>

        <div style={{ display: "flex", gap: 8, marginTop: 20 }}>
          <button onClick={onClose} style={{
            flex: 1, background: "#1f2937",
            border: "1px solid #374151", color: "#9ca3af",
            borderRadius: 6, padding: "9px 0",
            cursor: "pointer", fontSize: 13,
          }}>Annulla</button>
          <button
            onClick={() => { onSave(ticket.id, tecnicoId, data); onClose(); }}
            style={{
              flex: 1,
              background: "#065f46",
              border: "1px solid #059669",
              color: "#86efac",
              borderRadius: 6,
              padding: "9px 0",
              cursor: "pointer",
              fontSize: 13,
              fontWeight: 600,
            }}
          >
            Salva
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Pagina principale ──────────────────────────────────────────────────────────
export default function PlanningPage() {
  const [piano, setPiano] = useState<GeneratedPlan | null>(null);
  const [tickets, setTickets] = useState<TicketData[]>([]);
  const [tecnici, setTecnici] = useState<TecnicoData[]>([]);
  const [vistaAttiva, setVistaAttiva] = useState<VistaAttiva>("settimanale");
  const [modalita, setModalita] = useState<Modalita>("ai");
  const [weekStart, setWeekStart] = useState<Date>(() => {
    // Lunedì della settimana corrente
    const d = new Date();
    const dow = d.getDay();
    d.setDate(d.getDate() - (dow === 0 ? 6 : dow - 1));
    d.setHours(0, 0, 0, 0);
    return d;
  });
  const [selectedMese, setSelectedMese] = useState(new Date(new Date().getFullYear(), new Date().getMonth(), 1));
  const [loading, setLoading] = useState(true);
  const [generando, setGenerando] = useState(false);
  const [confermando, setConfermando] = useState(false);
  const [ticketDaPianificare, setTicketDaPianificare] = useState<TicketData | null>(null);
  const [storico, setStorico] = useState<GeneratedPlan[]>([]);
  const [engineMode, setEngineMode] = useState<EngineMode>("deterministic");
  const [valutando, setValutando] = useState(false);
  const [valutazioneScore, setValutazioneScore] = useState<number | null>(null);
  const [activeDragId, setActiveDragId] = useState<string | null>(null);

  // ── Mappe per lookup O(1) ──────────────────────────────────────────────────
  const ticketMap = useMemo(
    () => new Map(tickets.map(t => [t.id, t])),
    [tickets]
  );
  const tecnicoMap = useMemo(
    () => new Map(tecnici.map(t => [t.id, t])),
    [tecnici]
  );

  // ── Statistiche backlog ────────────────────────────────────────────────────
  const backlogStats = useMemo(() => {
    const open = tickets.filter(t => t.stato === "Aperto" || t.stato === "Pianificato");
    const totalOre = open.reduce((s, t) => s + (t.durata_stimata_ore ?? 0), 0);
    const bd = open.filter(t => t.tipo === "BD");
    const pm = open.filter(t => t.tipo === "PM");
    const cm = open.filter(t => t.tipo !== "BD" && t.tipo !== "PM");
    const bdOre = bd.reduce((s, t) => s + (t.durata_stimata_ore ?? 0), 0);
    const pmOre = pm.reduce((s, t) => s + (t.durata_stimata_ore ?? 0), 0);
    const cmOre = cm.reduce((s, t) => s + (t.durata_stimata_ore ?? 0), 0);
    return {
      total: open.length, totalOre,
      bd: { count: bd.length, ore: bdOre, pct: open.length ? (bd.length / open.length) * 100 : 0 },
      pm: { count: pm.length, ore: pmOre, pct: open.length ? (pm.length / open.length) * 100 : 0 },
      cm: { count: cm.length, ore: cmOre, pct: open.length ? (cm.length / open.length) * 100 : 0 },
    };
  }, [tickets]);

  // ── Dati piano ────────────────────────────────────────────────────────────
  const planJson = piano?.plan_json ?? null;
  const plannedWOs: PlannedWO[] = planJson?.planned_workorders ?? [];
  const deferredWOs: DeferredWO[] = planJson?.deferred_workorders ?? [];
  const effScore: number | undefined = planJson?.efficiency_score;
  const effBreakdown: EfficiencyBreakdown | undefined = planJson?.efficiency_breakdown;
  const effMotivations: EfficiencyMotivation[] = planJson?.efficiency_motivations ?? [];
  const globalWarnings: string[] = planJson?.global_warnings ?? [];

  // ── Caricamento dati ───────────────────────────────────────────────────────
  const loadStorico = useCallback(async () => {
    try {
      const res = await apiGet<GeneratedPlan[]>("/planning/history").catch(() => []);
      setStorico(res ?? []);
    } catch {
      // ignora errori storico silenziosamente
    }
  }, []);

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const [planRes, ticketsRes, tecniciRes] = await Promise.all([
        apiGet<GeneratedPlan | null>("/planning/current").catch(() => null),
        apiGet<{ items: TicketData[] }>("/tickets?stato=Aperto,Pianificato&limit=200"),
        apiGet<TecnicoAPI[]>("/tecnici"),
      ]);
      setPiano(planRes);
      setTickets(ticketsRes?.items ?? []);
      setTecnici(tecniciRes ?? []);
    } catch (e: any) {
      toast.error(e?.message ?? "Errore caricamento dati planning");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadStorico(); }, [loadStorico]);

  useEffect(() => { loadData(); }, [loadData]);

  // Ricarica i ticket quando la pagina torna in focus (es. utente era su /ticket e ha cambiato stati)
  useEffect(() => {
    function onVisibilityChange() {
      if (document.visibilityState === "visible") loadData();
    }
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => document.removeEventListener("visibilitychange", onVisibilityChange);
  }, [loadData]);

  // ── Genera piano AI ────────────────────────────────────────────────────────
  async function generateAIPlan() {
    setGenerando(true);
    try {
      const res = await apiPost<GeneratedPlan & { previous_efficiency_score?: number; score_improved?: boolean }>(
        "/planning/generate", { days: 7, mode: engineMode }
      );
      const newScore = (res.plan_json as any)?.efficiency_score as number | undefined;
      const prevScore = res.previous_efficiency_score;

      // Confronto con piano confermato precedente
      if (prevScore !== undefined && newScore !== undefined && newScore < prevScore) {
        toast.warning(
          `Piano AI generato (score: ${Math.round(newScore)}) — inferiore al piano precedente (${Math.round(prevScore)}). Puoi modificarlo manualmente o scartarlo.`,
          { duration: 8000 }
        );
      } else {
        toast.success(
          newScore !== undefined
            ? `Piano AI generato — score ${Math.round(newScore)}`
            : "Piano AI generato con successo"
        );
      }
      // Strip extra fields from GeneratedPlan to avoid TypeScript issues
      const { previous_efficiency_score: _p, score_improved: _s, ...cleanRes } = res as any;
      setPiano(cleanRes as GeneratedPlan);
      setValutazioneScore(null);
    } catch (e: any) {
      toast.error(e?.message ?? "Errore generazione piano AI");
    } finally {
      setGenerando(false);
    }
  }

  // ── Valutazione piano manuale ──────────────────────────────────────────────
  async function valutaPianoManuale() {
    setValutando(true);
    try {
      const res = await apiPost<{
        efficiency_score: number;
        efficiency_breakdown: Record<string, number>;
        efficiency_motivations: any[];
        ticket_pianificati: number;
        ticket_aperti: number;
      }>("/planning/evaluate", {});
      setValutazioneScore(res.efficiency_score);
      toast.success(
        `Valutazione completata — Score: ${Math.round(res.efficiency_score)} · ${res.ticket_pianificati} pianificati, ${res.ticket_aperti} aperti`,
        { duration: 6000 }
      );
    } catch (e: any) {
      toast.error(e?.message ?? "Errore valutazione piano");
    } finally {
      setValutando(false);
    }
  }

  // ── Conferma piano ─────────────────────────────────────────────────────────
  async function confirmPlan() {
    if (!piano) return;
    setConfermando(true);
    try {
      const confirmedPlan = await apiPost<GeneratedPlan>(`/planning/confirm/${piano.id}`);
      // Ricarica tickets aggiornati (stato → Pianificato, tecnico_id assegnato)
      const ticketsRes = await apiGet<{ items: TicketData[] }>(
        "/tickets?stato=Aperto,Pianificato&limit=200"
      );
      setTickets(ticketsRes?.items ?? []);
      const nAgg = plannedWOs.filter(w => !w.is_continuation).length;
      // Mantieni il piano visibile (solo status aggiornato) — le viste restano popolate
      setPiano(confirmedPlan ?? { ...piano, status: "confirmed" });
      toast.success(`Piano confermato — ${nAgg} ticket aggiornati`);
      loadStorico();
    } catch (e: any) {
      toast.error(e?.message ?? "Errore conferma piano");
    } finally {
      setConfermando(false);
    }
  }

  // ── Assegnazione manuale ───────────────────────────────────────────────────
  async function savePianificazioneManuale(
    ticketId: number,
    tecnicoId: number,
    data: string,
    plannedStart?: string,
    plannedFinish?: string,
  ) {
    try {
      await apiPut(`/tickets/${ticketId}`, {
        tecnico_id: tecnicoId,
        planned_start: plannedStart ?? `${data}T08:00:00`,
        planned_finish: plannedFinish ?? `${data}T17:00:00`,
        stato: "Pianificato",
      });
      toast.success(`Ticket #${ticketId} pianificato manualmente`);
      loadData();
    } catch (e: any) {
      toast.error(e?.message ?? "Errore salvataggio");
    }
  }

  // ── Sposta ticket nel piano (DnD calendario settimanale) ───────────────────
  async function moveTicket(
    woId: number,
    newDate: string,
    startHour: number,
    startMinute: number,
    tecnicoId?: number,
  ) {
    // Aggiornamento ottimistico del piano locale
    setPiano(prev => {
      if (!prev?.plan_json) return prev;
      const durH = (() => {
        const wo = prev.plan_json.planned_workorders.find(w => w.wo_id === woId);
        return wo?.duration_hours ?? 2;
      })();
      const endH = startHour + Math.floor((startMinute + durH * 60) / 60);
      const endM = Math.round((startMinute + durH * 60) % 60);
      const newStart = `${String(startHour).padStart(2,"0")}:${String(startMinute).padStart(2,"0")}`;
      const newEnd = `${String(endH).padStart(2,"0")}:${String(endM).padStart(2,"0")}`;

      const newWOs = prev.plan_json.planned_workorders.map(wo =>
        wo.wo_id !== woId ? wo : {
          ...wo,
          planned_date: newDate,
          planned_start_time: newStart,
          planned_end_time: newEnd,
          time_slot: `${newStart}-${newEnd}`,
          ...(tecnicoId ? { technician_id: tecnicoId } : {}),
        }
      );
      return { ...prev, plan_json: { ...prev.plan_json, planned_workorders: newWOs } };
    });

    try {
      await apiPost("/planning/move-ticket", {
        ticket_id: woId,
        new_date: newDate,
        new_start_hour: startHour,
        new_start_minute: startMinute,
        ...(tecnicoId ? { tecnico_id: tecnicoId } : {}),
      });
      loadData();
    } catch (e: any) {
      toast.error(e?.message ?? "Errore spostamento ticket");
      loadData(); // ripristina stato reale
    }
  }

  // ── Riassegna tecnico (doppio clic nel calendario) ─────────────────────────
  async function reassignTecnico(woId: number, newTecnicoId: number) {
    try {
      await apiPost("/planning/move-ticket", {
        ticket_id: woId,
        tecnico_id: newTecnicoId,
      });
      toast.success(`Ticket #${woId} riassegnato`);
      loadData();
    } catch (e: any) {
      toast.error(e?.message ?? "Errore riassegnazione");
    }
  }

  // ── DnD: gestione drop su slot del calendario settimanale ────────────────
  function handleDragEnd(event: DragEndEvent) {
    setActiveDragId(null);
    const { active, over } = event;
    if (!over) return;

    const activeId = String(active.id);
    const overId = String(over.id);

    if (!overId.startsWith("slot||")) return;

    // Parsing ID slot: "slot||YYYY-MM-DD||slotIndex"
    const parts = overId.split("||");
    const dateStr = parts[1];
    const slotIdx = Number(parts[2]);
    if (!dateStr || isNaN(slotIdx)) return;

    // Orario start dal slot index (ogni slot = 30 min, da 08:00)
    const totalMinutes = slotIdx * 30;
    const startHour = 8 + Math.floor(totalMinutes / 60);
    const startMinute = totalMinutes % 60;

    if (activeId.startsWith("ticket-")) {
      // Ticket dal pannello manuale sinistro → inserimento nel piano
      const ticketId = Number(activeId.replace("ticket-", ""));
      const ticket = ticketMap.get(ticketId);
      if (!ticket) return;
      const dur = ticket.durata_stimata_ore ?? 2;
      const totalEndMin = totalMinutes + dur * 60;
      const endH = 8 + Math.floor(totalEndMin / 60);
      const endM = Math.round(totalEndMin % 60);
      const startStr = `${dateStr}T${String(startHour).padStart(2,"0")}:${String(startMinute).padStart(2,"0")}:00`;
      const finishStr = `${dateStr}T${String(endH).padStart(2,"0")}:${String(endM).padStart(2,"0")}:00`;
      const firstTecnico = tecnici[0];
      if (firstTecnico) {
        savePianificazioneManuale(ticketId, firstTecnico.id, dateStr, startStr, finishStr);
      } else {
        // Nessun tecnico → apri modale
        setTicketDaPianificare(ticket);
      }
    } else if (activeId.startsWith("wo||")) {
      // WO già nel piano → spostamento
      const woId = Number(activeId.replace("wo||", ""));
      if (woId) moveTicket(woId, dateStr, startHour, startMinute);
    }
  }

  // ── Ticket non pianificati nell'AI (backlog del piano) ────────────────────
  const nonPianificatiEnriched = useMemo(
    () => deferredWOs.map(d => ({
      ...d,
      ticket: ticketMap.get(d.wo_id),
    })),
    [deferredWOs, ticketMap]
  );

  // ── Sensor DnD (deve stare prima di qualsiasi early return) ──────────────
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } })
  );

  // ── Ticket da mostrare nel pannello sinistro in modalità manuale ──────────
  // In modalità manuale mostra TUTTI i ticket (non solo quelli rimandati dall'AI)
  const ticketsPerPannelloManuale = useMemo(() => {
    return tickets
      .filter(t => t.stato === "Aperto" || t.stato === "Pianificato")
      .sort((a, b) => {
        const pScore = { Alta: 3, Media: 2, Bassa: 1 };
        const pa = pScore[a.priorita as keyof typeof pScore] ?? 1;
        const pb = pScore[b.priorita as keyof typeof pScore] ?? 1;
        if (pb !== pa) return pb - pa;
        const tScore = { BD: 3, CM: 2, PM: 1 };
        return (tScore[b.tipo as keyof typeof tScore] ?? 1) - (tScore[a.tipo as keyof typeof tScore] ?? 1);
      });
  }, [tickets]);

  if (loading) {
    return (
      <div style={{
        background: "#0a0f1e", minHeight: "100vh",
        display: "flex", alignItems: "center", justifyContent: "center",
        color: "#9ca3af", fontSize: 14,
      }}>
        Caricamento piano in corso...
      </div>
    );
  }

  return (
    <DndContext
      sensors={sensors}
      onDragStart={e => setActiveDragId(String(e.active.id))}
      onDragEnd={handleDragEnd}
      onDragCancel={() => setActiveDragId(null)}
    >
    <div style={{
      background: "#0a0f1e",
      minHeight: "100vh",
      color: "#f9fafb",
      fontFamily: "var(--font-body, system-ui)",
    }}>
      {/* ── HEADER ─────────────────────────────────────────────────────────── */}
      <div style={{
        background: "#111827",
        borderBottom: "1px solid #1f2937",
        padding: "14px 24px",
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        flexWrap: "wrap",
        gap: 12,
      }}>
        <div>
          <div style={{ fontSize: 20, fontWeight: 800, color: "#f9fafb", letterSpacing: "-0.5px" }}>
            ◈ Piano Manutenzione MARCO
          </div>
          <div style={{ fontSize: 12, color: "#6b7280", marginTop: 2 }}>
            {backlogStats.total} ticket in backlog · {backlogStats.totalOre.toFixed(0)}h stimate
          </div>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          {/* Toggle MANUALE / AI */}
          <div style={{
            display: "flex",
            background: "#1f2937",
            border: "1px solid #374151",
            borderRadius: 8,
            overflow: "hidden",
          }}>
            {(["manuale", "ai"] as Modalita[]).map(m => (
              <button
                key={m}
                onClick={() => setModalita(m)}
                style={{
                  padding: "8px 16px",
                  fontSize: 12,
                  fontWeight: 600,
                  cursor: "pointer",
                  border: "none",
                  background: modalita === m
                    ? (m === "ai"
                      ? "linear-gradient(135deg, #1d4ed8, #7c3aed)"
                      : "#374151")
                    : "transparent",
                  color: modalita === m ? "#fff" : "#9ca3af",
                  borderRight: m === "manuale" ? "1px solid #374151" : "none",
                  transition: "background 150ms",
                  boxShadow: modalita === m && m === "ai"
                    ? "0 0 16px rgba(99,102,241,0.4)"
                    : "none",
                }}
              >
                {m === "manuale" ? "✏ Manuale" : "⚡ AI"}
              </button>
            ))}
          </div>

          {/* Toggle engine: Deterministico / AI GPT */}
          {modalita === "ai" && (
            <div style={{
              display: "flex",
              background: "#1f2937",
              border: "1px solid #374151",
              borderRadius: 8,
              overflow: "hidden",
              fontSize: 11,
            }}>
              {(["deterministic", "ai"] as EngineMode[]).map(m => (
                <button
                  key={m}
                  onClick={() => setEngineMode(m)}
                  title={m === "deterministic" ? "Motore deterministico — istantaneo, nessuna API" : "Motore GPT — richiede OpenAI, più lento"}
                  style={{
                    padding: "7px 12px",
                    fontWeight: 600,
                    cursor: "pointer",
                    border: "none",
                    borderRight: m === "deterministic" ? "1px solid #374151" : "none",
                    background: engineMode === m
                      ? (m === "ai" ? "linear-gradient(135deg,#1d4ed8,#7c3aed)" : "#065f46")
                      : "transparent",
                    color: engineMode === m ? "#fff" : "#6b7280",
                    transition: "background 150ms",
                  }}
                >
                  {m === "deterministic" ? "⚙ Engine" : "🤖 GPT"}
                </button>
              ))}
            </div>
          )}

          {/* Bottone Ricarica dati */}
          <button
            onClick={loadData}
            disabled={loading}
            title="Ricarica ticket dal server"
            style={{
              background: "transparent",
              border: "1px solid #374151",
              color: "#6b7280",
              borderRadius: 8,
              padding: "9px 12px",
              fontSize: 14,
              cursor: loading ? "not-allowed" : "pointer",
            }}
          >
            {loading ? "…" : "↻"}
          </button>

          {/* Bottone Diagnostica DB */}
          <button
            onClick={async () => {
              try {
                const s = await apiGet<any>("/planning/status");
                const lines = [
                  `tenant_id: ${s.tenant_id ?? "null"}`,
                  `ticket pianificabili: ${s.ticket_pianificabili}`,
                  `tecnici in servizio: ${s.tecnici_in_servizio}`,
                  `OpenAI key: ${s.has_openai_key ? "sì" : "no"}`,
                  `ultimo piano: #${s.ultimo_piano_id ?? "-"} (${s.ultimo_piano_status ?? "-"})`,
                  `stati ticket: ${JSON.stringify(s.ticket_per_stato)}`,
                ];
                toast.info(lines.join(" | "), { duration: 10000 });
              } catch (e: any) {
                toast.error("Diagnostica fallita: " + (e?.message ?? "err"));
              }
            }}
            title="Diagnostica: verifica ticket e tecnici nel DB"
            style={{
              background: "transparent",
              border: "1px solid #374151",
              color: "#6b7280",
              borderRadius: 8,
              padding: "9px 12px",
              fontSize: 13,
              cursor: "pointer",
            }}
          >
            🔍 DB
          </button>

          {/* Bottone Valutazione Piano — solo in modalità manuale */}
          {modalita === "manuale" && (
            <button
              onClick={valutaPianoManuale}
              disabled={valutando}
              style={{
                background: valutando ? "#1f2937" : "#065f46",
                border: "1px solid #059669",
                color: valutando ? "#6b7280" : "#86efac",
                borderRadius: 8,
                padding: "9px 14px",
                fontSize: 13,
                fontWeight: 700,
                cursor: valutando ? "not-allowed" : "pointer",
                display: "flex",
                alignItems: "center",
                gap: 6,
              }}
            >
              {valutando ? "Valutando..." : (
                valutazioneScore !== null
                  ? `📊 Score: ${Math.round(valutazioneScore)}`
                  : "📊 Valutazione Piano"
              )}
            </button>
          )}

          {/* Bottone Genera AI */}
          {modalita === "ai" && (
            <button
              onClick={generateAIPlan}
              disabled={generando}
              style={{
                background: generando
                  ? "#1f2937"
                  : "linear-gradient(135deg, #1d4ed8, #7c3aed)",
                border: "none",
                color: "#fff",
                borderRadius: 8,
                padding: "9px 18px",
                fontSize: 13,
                fontWeight: 700,
                cursor: generando ? "not-allowed" : "pointer",
                boxShadow: generando ? "none" : "0 0 20px rgba(99,102,241,0.4)",
                display: "flex",
                alignItems: "center",
                gap: 8,
                transition: "filter 150ms",
              }}
              onMouseEnter={e => {
                if (!generando) (e.currentTarget as HTMLElement).style.filter = "brightness(1.1)";
              }}
              onMouseLeave={e => {
                (e.currentTarget as HTMLElement).style.filter = "";
              }}
            >
              {generando ? (
                <>
                  <span style={{
                    display: "inline-block",
                    width: 14, height: 14,
                    border: "2px solid #ffffff44",
                    borderTop: "2px solid #fff",
                    borderRadius: "50%",
                    animation: "spin 0.8s linear infinite",
                  }} />
                  Elaborazione...
                </>
              ) : (
                <>⚡ Genera Piano AI</>
              )}
            </button>
          )}

          {/* Bottone Conferma — visibile solo se c'è un draft */}
          {piano && piano.status === "draft" && (
            <button
              onClick={confirmPlan}
              disabled={confermando}
              style={{
                background: confermando ? "#1f2937" : "#065f46",
                border: "1px solid #059669",
                color: "#86efac",
                borderRadius: 8,
                padding: "9px 18px",
                fontSize: 13,
                fontWeight: 700,
                cursor: confermando ? "not-allowed" : "pointer",
              }}
            >
              {confermando ? "Confermando..." : "✓ Conferma Piano"}
            </button>
          )}
        </div>
      </div>

      {/* ── BODY ───────────────────────────────────────────────────────────── */}
      <div style={{
        display: "flex",
        gap: 0,
        height: "calc(100vh - 73px)",
      }}>
        {/* ── COLONNA SINISTRA (backlog + non pianificati) ──────────────────── */}
        <div style={{
          width: 300,
          flexShrink: 0,
          background: "#111827",
          borderRight: "1px solid #1f2937",
          display: "flex",
          flexDirection: "column",
          overflowY: "auto",
        }}>
          {/* Backlog status */}
          <div style={{
            padding: "16px 16px 0",
            borderTop: "2px solid #3b82f6",
          }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: "#6b7280", letterSpacing: "0.08em", marginBottom: 14 }}>
              BACKLOG
            </div>

            <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
              <BacklogBar
                label="BD — Guasti"
                count={backlogStats.bd.count}
                ore={backlogStats.bd.ore}
                color="linear-gradient(90deg, #ef4444, #fca5a5)"
                borderColor="#ef4444"
                percent={Math.round(backlogStats.bd.pct)}
              />
              <BacklogBar
                label="PM — Preventiva"
                count={backlogStats.pm.count}
                ore={backlogStats.pm.ore}
                color="linear-gradient(90deg, #22c55e, #86efac)"
                borderColor="#22c55e"
                percent={Math.round(backlogStats.pm.pct)}
              />
              <BacklogBar
                label="CM — Correttiva"
                count={backlogStats.cm.count}
                ore={backlogStats.cm.ore}
                color="linear-gradient(90deg, #f59e0b, #fcd34d)"
                borderColor="#f59e0b"
                percent={Math.round(backlogStats.cm.pct)}
              />
            </div>
          </div>

          {/* Avvisi globali */}
          {globalWarnings.length > 0 && (
            <div style={{ padding: "12px 16px", borderTop: "1px solid #1f2937", marginTop: 16 }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: "#6b7280", letterSpacing: "0.08em", marginBottom: 8 }}>
                AVVISI GLOBALI
              </div>
              {globalWarnings.map((w, i) => (
                <div key={i} style={{ fontSize: 11, color: "#f59e0b", marginBottom: 4 }}>⚠ {w}</div>
              ))}
            </div>
          )}

          {/* Divider */}
          <div style={{ height: 1, background: "#1f2937", margin: "16px 0 0" }} />

          {/* Pannello ticket — contenuto diverso per manuale vs AI */}
          <div style={{ flex: 1, padding: "12px 16px", overflowY: "auto" }}>
            {modalita === "manuale" ? (
              <>
                <div style={{
                  fontSize: 11, fontWeight: 700, color: "#6b7280",
                  letterSpacing: "0.08em", marginBottom: 4,
                  display: "flex", justifyContent: "space-between", alignItems: "center",
                }}>
                  <span>TICKET DA PIANIFICARE</span>
                  <span style={{
                    background: "#1e3a5f44", color: "#60a5fa",
                    border: "1px solid #3b82f655",
                    borderRadius: 3, padding: "1px 6px",
                  }}>{ticketsPerPannelloManuale.length}</span>
                </div>
                <div style={{ fontSize: 10, color: "#4b5563", marginBottom: 10 }}>
                  Trascina sul Gantt o clicca ✏ Pianifica
                </div>
                {ticketsPerPannelloManuale.length === 0 ? (
                  <div style={{ fontSize: 12, color: "#374151", textAlign: "center", padding: "20px 0" }}>
                    Nessun ticket aperto o pianificato
                  </div>
                ) : (
                  ticketsPerPannelloManuale.map(ticket => (
                    <DraggableTicket
                      key={ticket.id}
                      ticket={ticket}
                      onClickPlan={setTicketDaPianificare}
                    />
                  ))
                )}
              </>
            ) : (
              <>
                <div style={{
                  fontSize: 11, fontWeight: 700, color: "#6b7280",
                  letterSpacing: "0.08em", marginBottom: 12,
                  display: "flex", justifyContent: "space-between",
                }}>
                  <span>NON PIANIFICATI</span>
                  {nonPianificatiEnriched.length > 0 && (
                    <span style={{
                      background: "#7f1d1d44", color: "#fca5a5",
                      border: "1px solid #ef444455",
                      borderRadius: 3, padding: "1px 6px",
                    }}>
                      {nonPianificatiEnriched.length}
                    </span>
                  )}
                </div>

                {nonPianificatiEnriched.length === 0 ? (
                  <div style={{ fontSize: 12, color: "#374151", textAlign: "center", padding: "20px 0" }}>
                    {piano ? "Tutti i ticket sono stati pianificati ✓" : "Genera un piano per vedere i ticket non pianificati"}
                  </div>
                ) : (
                  nonPianificatiEnriched.map(({ wo_id, reason, ticket }) => {
                    const tipo = ticket?.tipo ?? "CM";
                    const tipoBg: Record<string, string> = { BD: "#7f1d1d44", PM: "#14532d44", CM: "#78350f44" };
                    const tipoColor: Record<string, string> = { BD: "#fca5a5", PM: "#86efac", CM: "#fcd34d" };
                    return (
                      <div key={wo_id} style={{
                        background: "#1a2332",
                        border: "1px solid #2a3748",
                        borderRadius: 6,
                        padding: "10px 10px",
                        marginBottom: 8,
                      }}>
                        <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
                          <span style={{
                            fontSize: 10, fontWeight: 700,
                            background: tipoBg[tipo] ?? "#78350f44",
                            color: tipoColor[tipo] ?? "#fcd34d",
                            padding: "1px 5px", borderRadius: 3,
                          }}>{tipo}</span>
                          <span style={{ fontSize: 10, color: "#6b7280" }}>#{wo_id}</span>
                        </div>
                        <div style={{ fontSize: 12, fontWeight: 600, color: "#e2e8f0", marginBottom: 2 }}>
                          {ticket?.titolo ?? "—"}
                        </div>
                        <div style={{ fontSize: 11, color: "#6b7280", marginBottom: 6, fontStyle: "italic" }}>
                          {reason}
                        </div>
                      </div>
                    );
                  })
                )}
              </>
            )}
          </div>
        </div>

        {/* ── COLONNA DESTRA (efficienza + viste) ──────────────────────────── */}
        <div style={{
          flex: 1,
          display: "flex",
          flexDirection: "column",
          overflowY: "auto",
          background: "#0a0f1e",
        }}>
          {/* Badge + motivazioni */}
          {effScore !== undefined && (
            <div style={{ padding: "16px 20px 0", display: "flex", flexDirection: "column", gap: 12 }}>
              <div style={{ display: "flex", gap: 16, alignItems: "flex-start" }}>
                <div style={{ flex: "0 0 340px" }}>
                  <BadgeEfficienza score={effScore} breakdown={effBreakdown ?? null} />
                </div>
                <div style={{ flex: 1 }}>
                  <PannelloMotivazioni motivations={effMotivations} score={effScore} />
                </div>
              </div>
            </div>
          )}

          {/* Tab viste */}
          <div style={{
            padding: "16px 20px 0",
            display: "flex",
            gap: 4,
            borderBottom: "1px solid #1f2937",
            paddingBottom: 0,
          }}>
            {(["settimanale", "mensile", "rolling"] as VistaAttiva[]).map(v => (
              <button
                key={v}
                onClick={() => setVistaAttiva(v)}
                style={{
                  padding: "10px 18px",
                  fontSize: 12,
                  fontWeight: 600,
                  cursor: "pointer",
                  border: "none",
                  background: "transparent",
                  color: vistaAttiva === v ? "#60a5fa" : "#6b7280",
                  borderBottom: vistaAttiva === v ? "2px solid #3b82f6" : "2px solid transparent",
                  transition: "color 150ms",
                }}
              >
                {v === "settimanale" ? "Settimana" : v === "mensile" ? "Mese" : "◈ Rolling"}
              </button>
            ))}

            {/* Info piano */}
            {piano && (
              <div style={{
                marginLeft: "auto",
                display: "flex",
                alignItems: "center",
                gap: 10,
                fontSize: 11,
                color: "#6b7280",
                paddingBottom: 10,
              }}>
                <span style={{
                  background: piano.status === "draft" ? "#1e3a5f" : "#065f46",
                  color: piano.status === "draft" ? "#60a5fa" : "#86efac",
                  border: `1px solid ${piano.status === "draft" ? "#3b82f655" : "#22c55e55"}`,
                  borderRadius: 3,
                  padding: "1px 6px",
                  fontSize: 10,
                  fontWeight: 700,
                }}>
                  {piano.status === "draft" ? "BOZZA" : "CONFERMATO"}
                </span>
                Piano {piano.horizon_days}gg ·{" "}
                {new Date(piano.created_at).toLocaleDateString("it-IT")}
                {piano.scadenza && (
                  <span style={{ color: "#9ca3af" }}>
                    · scade{" "}
                    <span style={{ color: new Date(piano.scadenza) < new Date() ? "#fca5a5" : "#e2e8f0", fontWeight: 600 }}>
                      {new Date(piano.scadenza).toLocaleDateString("it-IT", { day: "2-digit", month: "2-digit", year: "2-digit" })}
                    </span>
                  </span>
                )}
                {piano.completion_pct !== null && piano.completion_pct !== undefined && (
                  <span style={{ display: "flex", alignItems: "center", gap: 5 }}>
                    <div style={{ width: 48, height: 5, background: "#1f2937", borderRadius: 3, overflow: "hidden" }}>
                      <div style={{
                        width: `${Math.min(piano.completion_pct, 100)}%`,
                        height: "100%",
                        background: piano.completion_pct >= 80 ? "#86efac" : piano.completion_pct >= 40 ? "#fcd34d" : "#60a5fa",
                        borderRadius: 3,
                      }} />
                    </div>
                    <span style={{ color: "#9ca3af" }}>{piano.completion_pct}% chiusi</span>
                  </span>
                )}
              </div>
            )}
          </div>

          {/* Vista attiva */}
          <div style={{ flex: 1, padding: "16px 20px", overflowY: "auto" }}>
            {plannedWOs.length === 0 && !loading ? (
              <div style={{
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                justifyContent: "center",
                height: 300,
                gap: 16,
                color: "#4b5563",
              }}>
                <div style={{ fontSize: 40 }}>◈</div>
                <div style={{ fontSize: 15 }}>
                  {modalita === "ai"
                    ? "Clicca ⚡ Genera Piano AI per creare un piano ottimizzato"
                    : "Trascina un ticket dalla colonna sinistra nel calendario settimanale"}
                </div>
              </div>
            ) : (
              <>
                {vistaAttiva === "settimanale" && (
                  <KanbanSettimanale
                    wos={plannedWOs}
                    ticketMap={ticketMap}
                    tecnicoMap={tecnicoMap}
                    tecnici={tecnici}
                    weekStart={weekStart}
                    onWeekChange={setWeekStart}
                    onReassignTecnico={reassignTecnico}
                  />
                )}

                {vistaAttiva === "mensile" && (
                  <CalendarioMensile
                    wos={plannedWOs}
                    ticketMap={ticketMap}
                    mese={selectedMese}
                    onMeseChange={setSelectedMese}
                    onDayClick={(dateStr) => {
                      // Vai alla settimana del giorno cliccato nella vista settimanale
                      const d = new Date(dateStr + "T00:00:00");
                      const dow = d.getDay();
                      d.setDate(d.getDate() - (dow === 0 ? 6 : dow - 1));
                      d.setHours(0, 0, 0, 0);
                      setWeekStart(d);
                      setVistaAttiva("settimanale");
                    }}
                  />
                )}

                {vistaAttiva === "rolling" && (
                  <RollingAnalysisPanel />
                )}
              </>
            )}
          </div>
        </div>
      </div>

      {/* ── STORICO PIANI ──────────────────────────────────────────────────── */}
      <div style={{ padding: "0 24px 32px" }}>
        <StoricoPiani piani={storico} onRefresh={loadStorico} />
      </div>

      {/* Modale pianificazione manuale */}
      {ticketDaPianificare && (
        <ModalePianificaManuale
          ticket={ticketDaPianificare}
          tecnici={tecnici}
          onSave={savePianificazioneManuale}
          onClose={() => setTicketDaPianificare(null)}
        />
      )}

      <style>{`
        @keyframes spin {
          from { transform: rotate(0deg); }
          to { transform: rotate(360deg); }
        }
      `}</style>

      {/* DragOverlay: card floating durante il drag */}
      <DragOverlay dropAnimation={null}>
        {activeDragId !== null && (() => {
          const tipoBg: Record<string, string> = { BD: "#7f1d1d44", PM: "#14532d44", CM: "#78350f44" };
          const tipoColor: Record<string, string> = { BD: "#fca5a5", PM: "#86efac", CM: "#fcd34d" };

          let id: number | undefined;
          let label = "";
          let tipo = "CM";

          if (activeDragId.startsWith("ticket-")) {
            id = Number(activeDragId.replace("ticket-", ""));
            const t = ticketMap.get(id);
            tipo = t?.tipo ?? "CM";
            label = t?.titolo ?? "—";
          } else if (activeDragId.startsWith("wo||")) {
            id = Number(activeDragId.replace("wo||", ""));
            const wo = plannedWOs.find(w => w.wo_id === id);
            const t = id ? ticketMap.get(id) : undefined;
            tipo = t?.tipo ?? "CM";
            label = t?.titolo ?? `WO #${id}`;
          }

          if (!id) return null;
          return (
            <div style={{
              background: "#1a2332",
              border: "2px solid #3b82f6",
              borderRadius: 6,
              padding: "8px 10px",
              width: 220,
              boxShadow: "0 8px 32px rgba(0,0,0,0.5)",
              pointerEvents: "none",
            }}>
              <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
                <span style={{
                  fontSize: 10, fontWeight: 700,
                  background: tipoBg[tipo] ?? "#78350f44",
                  color: tipoColor[tipo] ?? "#fcd34d",
                  padding: "1px 5px", borderRadius: 3,
                }}>{tipo}</span>
                <span style={{ fontSize: 10, color: "#6b7280" }}>#{id}</span>
              </div>
              <div style={{ fontSize: 12, fontWeight: 600, color: "#e2e8f0" }}>
                {label}
              </div>
            </div>
          );
        })()}
      </DragOverlay>
    </div>
    </DndContext>
  );
}
