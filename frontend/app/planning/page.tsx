"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import {
  DndContext,
  DragEndEvent,
  DragStartEvent,
  DragOverlay,
  PointerSensor,
  useSensor,
  useSensors,
  useDraggable,
  useDroppable,
} from "@dnd-kit/core";
import { apiGet, apiPost, apiPut } from "../lib/api";
import { notify } from "@/lib/toast";
import { format, addDays, subDays, parseISO, startOfWeek, isToday } from "date-fns";
import { it } from "date-fns/locale";

import BadgeEfficienza from "./components/BadgeEfficienza";
import StoricoPiani from "./components/StoricoPiani";
import PannelloMotivazioni from "./components/PannelloMotivazioni";
import WODetailDrawer from "./components/WODetailDrawer";
import DeferredWOPanel from "./components/DeferredWOPanel";
import ReplanModal from "./components/ReplanModal";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";

import type {
  TicketData,
  TecnicoData,
  PlannedWO,
  DeferredWO,
  GeneratedPlan,
  EfficiencyBreakdown,
  EfficiencyMotivation,
  ReplanResult,
} from "./types";
import { tipoStyle } from "./types";

// ─── Tipi ─────────────────────────────────────────────────────────────────────

type ViewMode = "day" | "week" | "2week";
type EngineMode = "deterministic" | "ai";

interface TecnicoAPI {
  id: number;
  nome: string;
  cognome: string | null;
  skill: string;
  ore_giornaliere: number;
  orario_inizio: string;
  orario_fine: string;
  stato: string;
}

// ─── Costanti Gantt ───────────────────────────────────────────────────────────

const DAY_START_H = 0;
const DAY_END_H = 24;
const HOUR_W = 80;
const DAY_W = 130;
const ROW_H = 72;
const LABEL_W = 200;

const PRIO_COLORS: Record<string, string> = {
  Alta: "#ef4444",
  Media: "#f59e0b",
  Bassa: "#22c55e",
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function getDays(base: Date, view: ViewMode): Date[] {
  if (view === "day") return [base];
  const mon = startOfWeek(base, { weekStartsOn: 1 });
  const count = view === "week" ? 7 : 14;
  return Array.from({ length: count }, (_, i) => addDays(mon, i));
}

function parseStart(ticket: TicketData): { date: string; hour: number; minute: number } | null {
  if (!ticket.planned_start) return null;
  try {
    const d = parseISO(ticket.planned_start);
    return { date: format(d, "yyyy-MM-dd"), hour: d.getHours(), minute: d.getMinutes() };
  } catch {
    return null;
  }
}

function clamp(v: number, min: number, max: number) {
  return Math.max(min, Math.min(max, v));
}

// ─── TicketBlock (draggable nel Gantt) ────────────────────────────────────────

function TicketBlock({ ticket, view, onClick }: { ticket: TicketData; view: ViewMode; onClick: () => void }) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: `t-${ticket.id}`,
    data: { ticket },
  });
  const s = tipoStyle(ticket.tipo);
  const dur = Math.max(0.5, ticket.durata_stimata_ore || 1);

  if (view === "day") {
    return (
      <div
        ref={setNodeRef} {...listeners} {...attributes}
        onClick={(e) => { e.stopPropagation(); onClick(); }}
        style={{
          position: "absolute",
          width: Math.max(36, dur * HOUR_W - 4),
          height: ROW_H - 12,
          background: s.bg,
          border: `1px solid ${s.border}`,
          borderLeft: `3px solid ${s.border}`,
          borderRadius: 3,
          padding: "4px 6px",
          cursor: isDragging ? "grabbing" : "grab",
          opacity: isDragging ? 0.25 : 1,
          overflow: "hidden",
          userSelect: "none",
          boxSizing: "border-box",
          zIndex: isDragging ? 0 : 2,
        }}
      >
        <div style={{ fontSize: 9, color: s.text, opacity: 0.7, letterSpacing: "0.08em" }}>{ticket.tipo} · {dur}h</div>
        <div style={{ fontSize: 11, color: s.text, fontWeight: 600, marginTop: 2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{ticket.titolo}</div>
        {ticket.asset_name && (
          <div style={{ fontSize: 9, color: s.text, opacity: 0.6, marginTop: 2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{ticket.asset_name}</div>
        )}
      </div>
    );
  }

  return (
    <div
      ref={setNodeRef} {...listeners} {...attributes}
      onClick={(e) => { e.stopPropagation(); onClick(); }}
      style={{
        background: s.bg, border: `1px solid ${s.border}`, borderLeft: `3px solid ${s.border}`,
        borderRadius: 3, padding: "3px 5px", marginBottom: 2,
        cursor: isDragging ? "grabbing" : "grab", opacity: isDragging ? 0.25 : 1,
        overflow: "hidden", userSelect: "none", width: "100%", boxSizing: "border-box", flexShrink: 0,
      }}
    >
      <div style={{ fontSize: 10, color: s.text, fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{ticket.titolo}</div>
      <div style={{ fontSize: 9, color: s.text, opacity: 0.7 }}>{ticket.tipo} · {dur}h</div>
    </div>
  );
}

// ─── UnscheduledItem (sidebar sinistra, draggabile) ───────────────────────────

function UnscheduledItem({ ticket, onClick }: { ticket: TicketData; onClick: () => void }) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: `t-${ticket.id}`,
    data: { ticket },
  });
  const s = tipoStyle(ticket.tipo);
  const prioColor = PRIO_COLORS[ticket.priorita] ?? "#6b7280";

  return (
    <div
      ref={setNodeRef} {...listeners} {...attributes}
      onClick={(e) => { e.stopPropagation(); onClick(); }}
      style={{
        background: "#1a2332", border: "1px solid #2a3748", borderLeft: `3px solid ${s.border}`,
        borderRadius: 4, padding: "8px 10px", marginBottom: 6,
        cursor: isDragging ? "grabbing" : "grab", opacity: isDragging ? 0.35 : 1, userSelect: "none",
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 3 }}>
        <span style={{ fontSize: 9, color: s.text, letterSpacing: "0.1em", background: `${s.border}20`, padding: "1px 5px", borderRadius: 2 }}>{ticket.tipo}</span>
        <span style={{ fontSize: 9, color: prioColor }}>● {ticket.priorita}</span>
      </div>
      <div style={{ fontSize: 12, color: "#e2e8f0", fontWeight: 600, lineHeight: 1.3, marginBottom: 3 }}>{ticket.titolo}</div>
      <div style={{ fontSize: 10, color: "#6b7280" }}>{ticket.durata_stimata_ore || 1}h · {ticket.asset_name || "—"}</div>
    </div>
  );
}

// ─── TecnicoLabel ─────────────────────────────────────────────────────────────

function TecnicoLabel({ tecnico }: { tecnico: TecnicoData }) {
  return (
    <div style={{
      width: LABEL_W, minWidth: LABEL_W, padding: "0 14px",
      display: "flex", alignItems: "center",
      borderRight: "1px solid #1f2937", background: "#111827",
      position: "sticky", left: 0, zIndex: 3,
    }}>
      <div>
        <div style={{ fontSize: 12, fontWeight: 600, color: "#f9fafb", lineHeight: 1.3 }}>
          {tecnico.nome} {tecnico.cognome ?? ""}
        </div>
        <div style={{ fontSize: 10, color: "#6b7280", marginTop: 1 }}>
          {(tecnico as any).skill ?? tecnico.competenze ?? ""}
        </div>
      </div>
    </div>
  );
}

// ─── DayRow ───────────────────────────────────────────────────────────────────

function DayRow({ tecnico, tickets, day, onTicketClick }: {
  tecnico: TecnicoData; tickets: TicketData[]; day: Date; onTicketClick: (t: TicketData) => void;
}) {
  const dateStr = format(day, "yyyy-MM-dd");
  const { setNodeRef, isOver } = useDroppable({
    id: `row-${tecnico.id}-${dateStr}`,
    data: { tecnico_id: tecnico.id, date: dateStr },
  });
  const dayTickets = tickets.filter((t) => { const p = parseStart(t); return p && p.date === dateStr; });
  const timelineW = (DAY_END_H - DAY_START_H) * HOUR_W;

  return (
    <div style={{ display: "flex", height: ROW_H, borderBottom: "1px solid #1f2937" }}>
      <TecnicoLabel tecnico={tecnico} />
      <div ref={setNodeRef} style={{
        position: "relative", width: timelineW, minWidth: timelineW, height: "100%",
        background: isOver ? "rgba(59,130,246,0.07)" : `repeating-linear-gradient(90deg, transparent 0, transparent ${HOUR_W - 1}px, rgba(255,255,255,0.04) ${HOUR_W - 1}px, rgba(255,255,255,0.04) ${HOUR_W}px)`,
        transition: "background 0.12s",
      }}>
        {dayTickets.map((t) => {
          const p = parseStart(t)!;
          const left = (p.hour - DAY_START_H) * HOUR_W + (p.minute / 60) * HOUR_W;
          return (
            <div key={t.id} style={{ position: "absolute", left, top: 6, zIndex: 2 }}>
              <TicketBlock ticket={t} view="day" onClick={() => onTicketClick(t)} />
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─── DayCell ──────────────────────────────────────────────────────────────────

function DayCell({ tecnico_id, date, tickets, onTicketClick, cellW }: {
  tecnico_id: number; date: string; tickets: TicketData[];
  onTicketClick: (t: TicketData) => void; cellW: number;
}) {
  const { setNodeRef, isOver } = useDroppable({
    id: `cell-${tecnico_id}-${date}`,
    data: { tecnico_id, date },
  });
  return (
    <div ref={setNodeRef} style={{
      width: cellW, minWidth: cellW, minHeight: ROW_H, padding: "4px 3px",
      borderRight: "1px solid #1f2937",
      background: isOver ? "rgba(59,130,246,0.08)" : "transparent",
      transition: "background 0.12s", overflow: "hidden",
      display: "flex", flexDirection: "column", gap: 1,
    }}>
      {tickets.map((t) => <TicketBlock key={t.id} ticket={t} view="week" onClick={() => onTicketClick(t)} />)}
    </div>
  );
}

// ─── MultiDayRow ──────────────────────────────────────────────────────────────

function MultiDayRow({ tecnico, tickets, days, view, onTicketClick }: {
  tecnico: TecnicoData; tickets: TicketData[]; days: Date[]; view: ViewMode; onTicketClick: (t: TicketData) => void;
}) {
  const cellW = view === "week" ? DAY_W : Math.round(DAY_W * 0.75);
  return (
    <div style={{ display: "flex", minHeight: ROW_H, borderBottom: "1px solid #1f2937" }}>
      <TecnicoLabel tecnico={tecnico} />
      {days.map((day) => {
        const dateStr = format(day, "yyyy-MM-dd");
        return (
          <DayCell
            key={dateStr} tecnico_id={tecnico.id} date={dateStr}
            tickets={tickets.filter((t) => { const p = parseStart(t); return p && p.date === dateStr; })}
            onTicketClick={onTicketClick} cellW={cellW}
          />
        );
      })}
    </div>
  );
}

// ─── TicketDetailDrawer ───────────────────────────────────────────────────────

function TicketDetailDrawer({ ticket, onClose }: { ticket: TicketData; onClose: () => void }) {
  const s = tipoStyle(ticket.tipo);
  const prioColor = PRIO_COLORS[ticket.priorita] ?? "#6b7280";
  const rows = [
    ["Stato", ticket.stato],
    ["Priorità", ticket.priorita],
    ["Tipo", ticket.tipo],
    ["Asset", ticket.asset_name || "—"],
    ["Durata stimata", ticket.durata_stimata_ore ? `${ticket.durata_stimata_ore}h` : "—"],
    ["Inizio pianificato", ticket.planned_start ? format(parseISO(ticket.planned_start), "dd/MM/yyyy HH:mm", { locale: it }) : "—"],
    ["Fine pianificata", ticket.planned_finish ? format(parseISO(ticket.planned_finish), "dd/MM/yyyy HH:mm", { locale: it }) : "—"],
  ] as const;

  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 9998, display: "flex" }} onClick={onClose}>
      <div style={{ flex: 1 }} />
      <div style={{
        width: 360, height: "100%", background: "#111827",
        borderLeft: "1px solid #1f2937", padding: 24, overflowY: "auto",
        display: "flex", flexDirection: "column", gap: 16,
      }} onClick={(e) => e.stopPropagation()}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
          <span style={{ fontSize: 9, letterSpacing: "0.15em", color: s.text, background: `${s.border}22`, border: `1px solid ${s.border}`, padding: "3px 8px" }}>
            {ticket.tipo} · #{ticket.id}
          </span>
          <button onClick={onClose} style={{ background: "transparent", border: "none", color: "#6b7280", cursor: "pointer", fontSize: 20, lineHeight: 1, padding: 0 }}>×</button>
        </div>
        <div>
          <div style={{ fontSize: 15, fontWeight: 700, color: "#f9fafb", lineHeight: 1.4 }}>{ticket.titolo}</div>
          {ticket.descrizione && <div style={{ fontSize: 12, color: "#9ca3af", marginTop: 8, lineHeight: 1.6 }}>{ticket.descrizione}</div>}
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 0 }}>
          {rows.map(([label, value]) => (
            <div key={label} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: 12, padding: "8px 0", borderBottom: "1px solid #1f2937" }}>
              <span style={{ color: "#6b7280" }}>{label}</span>
              <span style={{ color: label === "Priorità" ? prioColor : "#f9fafb", fontWeight: 500 }}>{value}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ─── Modale pianificazione manuale ────────────────────────────────────────────

const SLOT_PRESETS = [
  { label: "08:00", h: 8 }, { label: "09:00", h: 9 }, { label: "10:00", h: 10 },
  { label: "11:00", h: 11 }, { label: "13:00", h: 13 }, { label: "14:00", h: 14 },
  { label: "15:00", h: 15 }, { label: "16:00", h: 16 },
];

function ModalePianificaManuale({ ticket, tecnici, onSave, onClose }: {
  ticket: TicketData; tecnici: TecnicoData[];
  onSave: (ticketId: number, tecnicoId: number, data: string, start?: string, finish?: string) => void;
  onClose: () => void;
}) {
  const [tecnicoId, setTecnicoId] = useState<number>(tecnici[0]?.id ?? 0);
  const [data, setData] = useState(new Date().toISOString().slice(0, 10));
  const [oraInizio, setOraInizio] = useState(8);
  const durata = ticket.durata_stimata_ore || 1;
  const fineDecimale = oraInizio + durata;
  const oraFineLabel = `${String(Math.floor(fineDecimale)).padStart(2, "0")}:${String(Math.round((fineDecimale - Math.floor(fineDecimale)) * 60)).padStart(2, "0")}`;

  return (
    <Sheet open={true} onOpenChange={(o) => (!o && onClose())}>
      <SheetContent
        side="right"
        className="p-0 border-l border-slate-800"
        style={{ background: "#0f172a", color: "var(--text-primary)", display: "flex", flexDirection: "column", minWidth: 400 }}
      >
        <div style={{ padding: "24px 28px", borderBottom: "1px solid #1e293b", background: "linear-gradient(180deg, rgba(59,130,246,0.05), transparent)" }}>
          <div style={{ fontSize: 10, letterSpacing: "0.15em", color: "#3b82f6", fontWeight: 700, textTransform: "uppercase", marginBottom: 6 }}>Pianifica Manualmente</div>
          <SheetTitle style={{ color: "#f8fafc", fontSize: 20, fontWeight: 800 }}>#{ticket.id} — {ticket.titolo}</SheetTitle>
        </div>

        <div style={{ flex: 1, padding: "28px", display: "flex", flexDirection: "column", gap: 20 }}>
          <div>
            <label style={{ fontSize: 11, color: "#9ca3af", display: "block", marginBottom: 6, fontWeight: 700, letterSpacing: "0.05em" }}>TECNICO</label>
            <select value={tecnicoId} onChange={(e) => setTecnicoId(Number(e.target.value))} style={{ width: "100%", background: "#1e293b", border: "1px solid #334155", color: "#f9fafb", borderRadius: 8, padding: "10px 12px", fontSize: 14 }}>
              {tecnici.map((t) => <option key={t.id} value={t.id}>{t.nome} {t.cognome ?? ""}</option>)}
            </select>
          </div>
          <div>
            <label style={{ fontSize: 11, color: "#9ca3af", display: "block", marginBottom: 6, fontWeight: 700, letterSpacing: "0.05em" }}>DATA</label>
            <input type="date" value={data} onChange={(e) => setData(e.target.value)} style={{ width: "100%", background: "#1e293b", border: "1px solid #334155", color: "#f9fafb", borderRadius: 8, padding: "10px 12px", fontSize: 14, boxSizing: "border-box" }} />
          </div>
          <div>
            <label style={{ fontSize: 11, color: "#9ca3af", display: "block", marginBottom: 8, fontWeight: 700, letterSpacing: "0.05em" }}>ORA INIZIO</label>
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
              {SLOT_PRESETS.map((p) => (
                <button key={p.h} onClick={() => setOraInizio(p.h)} style={{ fontSize: 12, padding: "6px 12px", borderRadius: 6, cursor: "pointer", border: `1px solid ${oraInizio === p.h ? "#3b82f6" : "#334155"}`, background: oraInizio === p.h ? "rgba(59,130,246,0.15)" : "#1e293b", color: oraInizio === p.h ? "#60a5fa" : "#94a3b8", fontWeight: oraInizio === p.h ? 700 : 500 }}>
                  {p.label}
                </button>
              ))}
            </div>
          </div>
        </div>

        <div style={{ padding: "20px 28px", borderTop: "1px solid #1e293b", background: "rgba(15,23,42,0.9)", display: "flex", justifyContent: "flex-end", gap: 12 }}>
          <button onClick={onClose} style={{ padding: "9px 18px", background: "transparent", border: "1px solid #334155", color: "#9ca3af", borderRadius: 8, cursor: "pointer", fontSize: 13, fontWeight: 600 }}>Annulla</button>
          <button
            onClick={() => {
              const pad = (n: number) => String(n).padStart(2, "0");
              onSave(ticket.id, tecnicoId, data, `${data}T${pad(oraInizio)}:00:00`, `${data}T${oraFineLabel}:00`);
              onClose();
            }}
            style={{ padding: "9px 24px", background: "linear-gradient(135deg, #3b82f6, #2563eb)", border: "none", color: "#ffffff", borderRadius: 8, cursor: "pointer", fontSize: 13, fontWeight: 700, boxShadow: "0 4px 12px rgba(59,130,246,0.3)" }}
          >
            ✓ Pianifica ({String(oraInizio).padStart(2, "0")}:00 – {oraFineLabel})
          </button>
        </div>
      </SheetContent>
    </Sheet>
  );
}

// ─── Pagina principale ────────────────────────────────────────────────────────

export default function PianificazionePage() {
  // Gantt state
  const [view, setView] = useState<ViewMode>("week");
  const [currentDate, setCurrentDate] = useState(() => new Date());
  const [tecnici, setTecnici] = useState<TecnicoData[]>([]);
  const [scheduledTickets, setScheduledTickets] = useState<TicketData[]>([]);
  const [unscheduledTickets, setUnscheduledTickets] = useState<TicketData[]>([]);
  const [loading, setLoading] = useState(true);
  const [draggingTicket, setDraggingTicket] = useState<TicketData | null>(null);
  const [detailTicket, setDetailTicket] = useState<TicketData | null>(null);
  const [filterTipo, setFilterTipo] = useState("");
  const [selectedWO, setSelectedWO] = useState<{ wo: PlannedWO; ticket: TicketData; tecnico: TecnicoData } | null>(null);
  const [ticketDaPianificare, setTicketDaPianificare] = useState<TicketData | null>(null);

  // Piano AI state
  const [piano, setPiano] = useState<GeneratedPlan | null>(null);
  const [generando, setGenerando] = useState(false);
  const [confermando, setConfermando] = useState(false);
  const [engineMode, setEngineMode] = useState<EngineMode>("deterministic");
  const [storico, setStorico] = useState<GeneratedPlan[]>([]);
  const [replanModal, setReplanModal] = useState(false);

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));

  // ── Dati piano ──────────────────────────────────────────────────────────────
  const planJson = piano?.plan_json ?? null;
  const effScore: number | undefined = planJson?.efficiency_score;
  const effBreakdown: EfficiencyBreakdown | undefined = planJson?.efficiency_breakdown;

  // ── Lookup maps per WODetailDrawer ─────────────────────────────────────────
  const ticketMap = useMemo(() => {
    const map = new Map<number, TicketData>();
    [...scheduledTickets, ...unscheduledTickets].forEach((t) => map.set(t.id, t));
    return map;
  }, [scheduledTickets, unscheduledTickets]);

  const tecnicoMap = useMemo(() => {
    const map = new Map<number, TecnicoData>();
    tecnici.forEach((t) => map.set(t.id, t));
    return map;
  }, [tecnici]);

  // ── Statistiche backlog ─────────────────────────────────────────────────────
  const tipoCounts = useMemo(() => {
    const counts = { BD: 0, PM: 0, CM: 0 };
    unscheduledTickets.forEach((t) => {
      if (t.tipo in counts) counts[t.tipo as keyof typeof counts]++;
    });
    return counts;
  }, [unscheduledTickets]);

  // ── Caricamento dati ────────────────────────────────────────────────────────
  const loadStorico = useCallback(async () => {
    try {
      const res = await apiGet<GeneratedPlan[]>("/planning/history").catch(() => []);
      setStorico(res ?? []);
    } catch { /* silenzioso */ }
  }, []);

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const [tecniciRes, pianRes, inCorsoRes, apertiRes, planRes] = await Promise.all([
        apiGet<TecnicoAPI[]>("/tecnici"),
        apiGet<{ items: TicketData[] }>("/tickets?limit=200&stato=Pianificato"),
        apiGet<{ items: TicketData[] }>("/tickets?limit=100&stato=In%20corso"),
        apiGet<{ items: TicketData[] }>("/tickets?limit=200&stato=Aperto"),
        apiGet<GeneratedPlan | null>("/planning/current").catch(() => null),
      ]);

      setTecnici((tecniciRes ?? []).map((t) => ({ ...t, competenze: t.skill ?? "" })));
      const scheduled = [
        ...pianRes.items.filter((t) => t.planned_start != null),
        ...inCorsoRes.items.filter((t) => t.planned_start != null),
      ];
      setScheduledTickets(scheduled);
      setUnscheduledTickets(apertiRes.items.filter((t) => t.planned_start == null));
      setPiano(planRes);
    } catch (e: unknown) {
      notify.error(e instanceof Error ? e.message : "Errore caricamento dati");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadData(); loadStorico(); }, [loadData, loadStorico]);

  useEffect(() => {
    function onVisibilityChange() {
      if (document.visibilityState === "visible") loadData();
    }
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => document.removeEventListener("visibilitychange", onVisibilityChange);
  }, [loadData]);

  // ── Genera piano AI ─────────────────────────────────────────────────────────
  async function generateAIPlan() {
    setGenerando(true);
    try {
      const res = await apiPost<GeneratedPlan & { previous_efficiency_score?: number }>("/planning/generate", { days: 7, mode: engineMode });
      const newScore = (res.plan_json as any)?.efficiency_score as number | undefined;
      const prevScore = res.previous_efficiency_score;
      if (prevScore !== undefined && newScore !== undefined && newScore < prevScore) {
        notify.warning(`Piano generato (score: ${Math.round(newScore)}) — inferiore al precedente (${Math.round(prevScore)})`);
      } else {
        notify.success(newScore !== undefined ? `Piano generato — score ${Math.round(newScore)}` : "Piano generato");
      }
      const { previous_efficiency_score: _p, ...cleanRes } = res as any;
      setPiano(cleanRes as GeneratedPlan);
      await loadData(); // aggiorna il Gantt con i ticket ora pianificati
    } catch (e: unknown) {
      notify.error(e instanceof Error ? e.message : "Errore generazione piano AI");
    } finally {
      setGenerando(false);
    }
  }

  // ── Conferma piano ──────────────────────────────────────────────────────────
  async function confirmPlan() {
    if (!piano) return;
    setConfermando(true);
    try {
      const confirmed = await apiPost<GeneratedPlan>(`/planning/confirm/${piano.id}`);
      setPiano(confirmed ?? { ...piano, status: "confirmed" });
      notify.success("Piano confermato");
      await loadData();
      loadStorico();
    } catch (e: unknown) {
      notify.error(e instanceof Error ? e.message : "Errore conferma piano");
    } finally {
      setConfermando(false);
    }
  }

  // ── Pianificazione manuale ──────────────────────────────────────────────────
  async function savePianificazioneManuale(ticketId: number, tecnicoId: number, data: string, start?: string, finish?: string) {
    try {
      await apiPut(`/tickets/${ticketId}`, {
        tecnico_id: tecnicoId,
        planned_start: start ?? `${data}T08:00:00`,
        planned_finish: finish ?? `${data}T17:00:00`,
        stato: "Pianificato",
        is_manual_plan: true,
      });
      notify.success(`Ticket #${ticketId} pianificato`);
      loadData();
    } catch (e: unknown) {
      notify.error(e instanceof Error ? e.message : "Errore salvataggio");
    }
  }

  // ── DnD: drag start ─────────────────────────────────────────────────────────
  function handleDragStart(event: DragStartEvent) {
    const ticket = (event.active.data.current as { ticket?: TicketData })?.ticket;
    if (ticket) setDraggingTicket(ticket);
  }

  // ── DnD: drag end ───────────────────────────────────────────────────────────
  async function handleDragEnd(event: DragEndEvent) {
    setDraggingTicket(null);
    const { active, over } = event;
    if (!over) return;
    const ticket = (active.data.current as { ticket?: TicketData })?.ticket;
    if (!ticket) return;
    const dropData = over.data.current as { tecnico_id: number; date: string };

    let newHour = 8;
    let newMinute = 0;
    if (view === "day") {
      const droppableRect = over.rect;
      const draggedRect = event.active.rect.current.translated;
      if (draggedRect && droppableRect) {
        const relX = Math.max(0, draggedRect.left - droppableRect.left);
        const totalMin = (relX / HOUR_W) * 60;
        const rounded = Math.round(totalMin / 30) * 30;
        newHour = clamp(DAY_START_H + Math.floor(rounded / 60), DAY_START_H, DAY_END_H - 1);
        newMinute = rounded % 60;
      }
    }

    // Se il ticket non ha un tecnico assegnato e viene droppato → pianificazione manuale
    if (!ticket.tecnico_id || ticket.stato === "Aperto") {
      savePianificazioneManuale(ticket.id, dropData.tecnico_id, dropData.date,
        `${dropData.date}T${String(newHour).padStart(2,"0")}:${String(newMinute).padStart(2,"0")}:00`,
        `${dropData.date}T${String(newHour + (ticket.durata_stimata_ore || 1)).padStart(2,"0")}:00:00`
      );
      return;
    }

    try {
      await apiPost("/planning/move-ticket", {
        ticket_id: ticket.id,
        new_date: dropData.date,
        new_start_hour: newHour,
        new_start_minute: newMinute,
        tecnico_id: dropData.tecnico_id,
      });
      notify.success(`Ticket #${ticket.id} spostato`);
      await loadData();
    } catch (e: unknown) {
      notify.error(e instanceof Error ? e.message : "Errore spostamento ticket");
    }
  }

  // ── Navigazione data ────────────────────────────────────────────────────────
  function navigate(dir: 1 | -1) {
    const delta = view === "day" ? 1 : view === "week" ? 7 : 14;
    setCurrentDate((d) => (dir === 1 ? addDays(d, delta) : subDays(d, delta)));
  }

  const days = getDays(currentDate, view);
  const cellW = view === "week" ? DAY_W : Math.round(DAY_W * 0.75);
  const timelineMinW = LABEL_W + (view === "day" ? (DAY_END_H - DAY_START_H) * HOUR_W : days.length * cellW);
  const filteredUnscheduled = filterTipo ? unscheduledTickets.filter((t) => t.tipo === filterTipo) : unscheduledTickets;

  const dateLabel =
    view === "day"
      ? format(days[0]!, "EEEE d MMMM yyyy", { locale: it })
      : `${format(days[0]!, "d MMM", { locale: it })} – ${format(days[days.length - 1]!, "d MMM yyyy", { locale: it })}`;

  // ── Render ──────────────────────────────────────────────────────────────────
  return (
    <DndContext sensors={sensors} onDragStart={handleDragStart} onDragEnd={handleDragEnd}>
      <div style={{ display: "flex", flexDirection: "column", height: "100vh", background: "#0a0f1e", fontFamily: "'IBM Plex Mono', monospace", color: "#f9fafb" }}>

        {/* ── TOOLBAR ── */}
        <div style={{
          display: "flex", alignItems: "center", gap: 10, padding: "8px 16px",
          borderBottom: "1px solid #1f2937", background: "#111827",
          flexShrink: 0, flexWrap: "wrap",
        }}>
          {/* View toggle */}
          <div style={{ display: "flex", border: "1px solid #374151", borderRadius: 4, overflow: "hidden" }}>
            {(["day", "week", "2week"] as ViewMode[]).map((v, i, arr) => (
              <button key={v} onClick={() => setView(v)} style={{
                padding: "5px 10px", fontSize: 10, letterSpacing: "0.1em",
                background: view === v ? "#3b82f6" : "transparent",
                color: view === v ? "#fff" : "#9ca3af",
                border: "none", borderRight: i < arr.length - 1 ? "1px solid #374151" : "none",
                cursor: "pointer", fontFamily: "inherit",
              }}>
                {v === "day" ? "GIORNO" : v === "week" ? "SETTIMANA" : "2 SETT."}
              </button>
            ))}
          </div>

          {/* Date nav */}
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <button onClick={() => navigate(-1)} style={{ background: "transparent", border: "1px solid #374151", color: "#9ca3af", width: 28, height: 28, cursor: "pointer", fontSize: 16, lineHeight: 1 }}>‹</button>
            <button onClick={() => setCurrentDate(new Date())} style={{ background: "transparent", border: "1px solid #374151", color: "#9ca3af", padding: "4px 10px", fontSize: 10, letterSpacing: "0.1em", cursor: "pointer", fontFamily: "inherit" }}>OGGI</button>
            <button onClick={() => navigate(1)} style={{ background: "transparent", border: "1px solid #374151", color: "#9ca3af", width: 28, height: 28, cursor: "pointer", fontSize: 16, lineHeight: 1 }}>›</button>
          </div>

          <span style={{ fontSize: 13, color: "#e2e8f0", fontWeight: 600, textTransform: "capitalize" }}>{dateLabel}</span>

          <div style={{ flex: 1 }} />

          {/* Efficienza badge compatta */}
          {effScore !== undefined && (
            <span style={{
              fontSize: 11, fontWeight: 700, padding: "4px 10px", borderRadius: 4,
              background: effScore >= 80 ? "#14532d44" : effScore >= 60 ? "#78350f44" : "#7f1d1d44",
              color: effScore >= 80 ? "#86efac" : effScore >= 60 ? "#fcd34d" : "#fca5a5",
              border: `1px solid ${effScore >= 80 ? "#22c55e44" : effScore >= 60 ? "#f59e0b44" : "#ef444444"}`,
            }}>
              ◈ Score {Math.round(effScore)}
            </span>
          )}

          {/* Piano status badge */}
          {piano && (
            <span style={{
              fontSize: 10, fontWeight: 700, padding: "3px 8px", borderRadius: 3,
              background: piano.status === "draft" ? "#1e3a5f" : "#065f46",
              color: piano.status === "draft" ? "#60a5fa" : "#86efac",
              border: `1px solid ${piano.status === "draft" ? "#3b82f644" : "#22c55e44"}`,
            }}>
              {piano.status === "draft" ? "BOZZA" : "CONFERMATO"}
            </span>
          )}

          <span style={{ fontSize: 10, color: "#6b7280" }}>{tecnici.length} tecnici · {scheduledTickets.length} pianificati</span>

          {/* Engine toggle */}
          <div style={{ display: "flex", border: "1px solid #374151", borderRadius: 4, overflow: "hidden", fontSize: 10 }}>
            {(["deterministic", "ai"] as EngineMode[]).map((m, i) => (
              <button key={m} onClick={() => setEngineMode(m)} title={m === "deterministic" ? "Motore deterministico — istantaneo" : "Motore GPT — richiede OpenAI"} style={{
                padding: "5px 10px", fontWeight: 600, cursor: "pointer", border: "none",
                borderRight: i === 0 ? "1px solid #374151" : "none",
                background: engineMode === m ? (m === "ai" ? "linear-gradient(135deg,#1d4ed8,#7c3aed)" : "#065f46") : "transparent",
                color: engineMode === m ? "#fff" : "#6b7280", fontFamily: "inherit",
              }}>
                {m === "deterministic" ? "⚙ Engine" : "🤖 GPT"}
              </button>
            ))}
          </div>

          {/* Genera Piano AI */}
          <button onClick={generateAIPlan} disabled={generando} style={{
            background: generando ? "#1f2937" : "linear-gradient(135deg, #1d4ed8, #7c3aed)",
            border: "none", color: "#fff", borderRadius: 6, padding: "6px 14px",
            fontSize: 12, fontWeight: 700, cursor: generando ? "not-allowed" : "pointer",
            boxShadow: generando ? "none" : "0 0 14px rgba(99,102,241,0.4)",
            display: "flex", alignItems: "center", gap: 6,
          }}>
            {generando ? (
              <><span style={{ display: "inline-block", width: 12, height: 12, border: "2px solid #ffffff44", borderTop: "2px solid #fff", borderRadius: "50%", animation: "spin 0.8s linear infinite" }} />Elaborazione...</>
            ) : "⚡ Genera Piano AI"}
          </button>

          {/* Conferma piano */}
          {piano?.status === "draft" && (
            <button onClick={confirmPlan} disabled={confermando} style={{
              background: confermando ? "#1f2937" : "#065f46", border: "1px solid #059669",
              color: "#86efac", borderRadius: 6, padding: "6px 14px",
              fontSize: 12, fontWeight: 700, cursor: confermando ? "not-allowed" : "pointer",
            }}>
              {confermando ? "Confermando..." : "✓ Conferma"}
            </button>
          )}

          {/* Ricalcola piano */}
          {piano && (
            <button
              onClick={() => setReplanModal(true)}
              title="Ricalcola piano adattivamente"
              style={{
                background: "transparent",
                border: "1px solid #374151",
                color: "#9ca3af",
                borderRadius: 6,
                padding: "6px 12px",
                fontSize: 12,
                cursor: "pointer",
                fontFamily: "inherit",
              }}
            >
              ↻ Ricalcola
            </button>
          )}

          {/* Refresh */}
          <button onClick={loadData} disabled={loading} title="Aggiorna" style={{
            background: "transparent", border: "1px solid #374151", color: "#9ca3af",
            width: 28, height: 28, cursor: "pointer", fontSize: 14, opacity: loading ? 0.5 : 1,
          }}>↻</button>
        </div>

        {/* ── BODY ── */}
        <div style={{ display: "flex", flex: 1, overflow: "hidden" }}>

          {/* ── SIDEBAR sinistra ── */}
          <div style={{
            width: 256, minWidth: 256, borderRight: "1px solid #1f2937",
            background: "#111827", display: "flex", flexDirection: "column", overflow: "hidden",
          }}>
            {/* Header sidebar */}
            <div style={{ padding: "12px 12px 8px", borderBottom: "1px solid #1f2937", flexShrink: 0 }}>
              <div style={{ fontSize: 10, letterSpacing: "0.15em", color: "#6b7280", marginBottom: 8 }}>NON PIANIFICATI</div>
              <div style={{ display: "flex", gap: 5, flexWrap: "wrap", marginBottom: 8 }}>
                {(["", "BD", "PM", "CM"] as const).map((tipo) => {
                  const color = tipo === "BD" ? "#ef4444" : tipo === "PM" ? "#22c55e" : tipo === "CM" ? "#f59e0b" : "#6b7280";
                  const cnt = tipo ? tipoCounts[tipo] : unscheduledTickets.length;
                  return (
                    <button key={tipo || "all"} onClick={() => setFilterTipo(tipo)} style={{
                      fontSize: 9, padding: "2px 7px",
                      background: filterTipo === tipo ? `${color}22` : "transparent",
                      border: `1px solid ${color}`, color, borderRadius: 3, cursor: "pointer", fontFamily: "inherit",
                    }}>
                      {tipo || "TUTTI"} ({cnt})
                    </button>
                  );
                })}
              </div>
              <div style={{ fontSize: 10, color: "#4b5563" }}>Trascina sulla timeline o clicca per pianificare →</div>
            </div>

            {/* Lista ticket non pianificati */}
            <div style={{ flex: 1, overflowY: "auto", padding: 10 }}>
              {loading ? (
                <div style={{ color: "#4b5563", fontSize: 12, textAlign: "center", paddingTop: 24 }}>Caricamento...</div>
              ) : filteredUnscheduled.length === 0 ? (
                <div style={{ color: "#4b5563", fontSize: 12, textAlign: "center", paddingTop: 24 }}>Nessun ticket da pianificare</div>
              ) : (
                filteredUnscheduled.map((t) => (
                  <UnscheduledItem key={t.id} ticket={t} onClick={() => setTicketDaPianificare(t)} />
                ))
              )}
            </div>

            {/* Efficienza breakdown compatto — se piano esiste */}
            {effScore !== undefined && effBreakdown && (
              <div style={{ borderTop: "1px solid #1f2937", padding: "12px 12px 16px", flexShrink: 0 }}>
                <BadgeEfficienza score={effScore} breakdown={effBreakdown} />
              </div>
            )}

            {/* Pannello motivazioni — visibile automaticamente se score < 90 */}
            {effScore !== undefined && planJson?.efficiency_motivations && planJson.efficiency_motivations.length > 0 && (
              <div style={{ borderTop: "1px solid #1f2937", padding: "12px", flexShrink: 0 }}>
                <PannelloMotivazioni motivations={planJson.efficiency_motivations} score={effScore} />
              </div>
            )}

            {/* WO non pianificati con reason codes */}
            {planJson?.deferred_workorders && planJson.deferred_workorders.length > 0 && (
              <div style={{ borderTop: "1px solid #1f2937", padding: "12px", flexShrink: 0 }}>
                <DeferredWOPanel
                  deferredWOs={planJson.deferred_workorders}
                  allTickets={[...scheduledTickets, ...unscheduledTickets]}
                />
              </div>
            )}
          </div>

          {/* ── GANTT TIMELINE ── */}
          <div style={{ flex: 1, overflow: "auto", position: "relative", background: "#0a0f1e" }}>
            {loading ? (
              <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100%", color: "#6b7280", fontSize: 13 }}>
                Caricamento dati...
              </div>
            ) : (
              <div style={{ minWidth: timelineMinW }}>
                {/* Header colonne */}
                <div style={{
                  display: "flex", height: 40, borderBottom: "1px solid #1f2937",
                  background: "#111827", position: "sticky", top: 0, zIndex: 10,
                }}>
                  <div style={{
                    width: LABEL_W, minWidth: LABEL_W, display: "flex", alignItems: "center",
                    padding: "0 14px", borderRight: "1px solid #1f2937",
                    fontSize: 10, color: "#6b7280", letterSpacing: "0.1em",
                    position: "sticky", left: 0, background: "#111827", zIndex: 11,
                  }}>
                    TECNICO
                  </div>
                  {view === "day"
                    ? Array.from({ length: DAY_END_H - DAY_START_H }, (_, i) => (
                        <div key={i} style={{ width: HOUR_W, minWidth: HOUR_W, display: "flex", alignItems: "center", paddingLeft: 6, borderRight: "1px solid #1f2937", fontSize: 10, color: "#6b7280" }}>
                          {String(DAY_START_H + i).padStart(2, "0")}:00
                        </div>
                      ))
                    : days.map((day) => {
                        const today = isToday(day);
                        return (
                          <div key={day.toISOString()} style={{
                            width: cellW, minWidth: cellW, display: "flex", flexDirection: "column",
                            alignItems: "center", justifyContent: "center",
                            borderRight: "1px solid #1f2937",
                            background: today ? "rgba(59,130,246,0.07)" : "transparent",
                          }}>
                            <div style={{ fontSize: 9, color: today ? "#60a5fa" : "#6b7280", letterSpacing: "0.1em" }}>
                              {format(day, "EEE", { locale: it }).toUpperCase()}
                            </div>
                            <div style={{ fontSize: 13, fontWeight: today ? 700 : 500, color: today ? "#60a5fa" : "#e2e8f0" }}>
                              {format(day, "d")}
                            </div>
                          </div>
                        );
                      })}
                </div>

                {/* Righe tecnici */}
                {tecnici.length === 0 ? (
                  <div style={{ padding: 40, textAlign: "center", color: "#6b7280", fontSize: 13 }}>Nessun tecnico attivo trovato</div>
                ) : (
                  tecnici.map((tecnico) => {
                    const tickets = scheduledTickets.filter((t) => t.tecnico_id === tecnico.id);
                    const handleTicketClick = (t: TicketData) => {
                      // Se esiste un WO nel piano per questo ticket, apre il drawer explainability
                      const wo = planJson?.planned_workorders?.find((w) => w.wo_id === t.id) ?? null;
                      if (wo) {
                        const tec = tecnicoMap.get(wo.technician_id) ?? null;
                        const ticket = ticketMap.get(t.id) ?? t;
                        setSelectedWO({ wo, ticket, tecnico: tec ?? tecnico });
                      } else {
                        setDetailTicket(t);
                      }
                    };
                    if (view === "day") {
                      return <DayRow key={tecnico.id} tecnico={tecnico} tickets={tickets} day={days[0]!} onTicketClick={handleTicketClick} />;
                    }
                    return <MultiDayRow key={tecnico.id} tecnico={tecnico} tickets={tickets} days={days} view={view} onTicketClick={handleTicketClick} />;
                  })
                )}
              </div>
            )}
          </div>
        </div>

        {/* ── STORICO PIANI ── */}
        <div style={{ borderTop: "1px solid #1f2937", padding: "0 16px 24px", background: "#0a0f1e", maxHeight: 320, overflowY: "auto" }}>
          <StoricoPiani piani={storico} onRefresh={loadStorico} />
        </div>

        {/* Drag overlay */}
        <DragOverlay>
          {draggingTicket && (() => {
            const s = tipoStyle(draggingTicket.tipo);
            return (
              <div style={{
                background: s.bg, border: `2px solid ${s.border}`, borderRadius: 6,
                padding: "8px 12px", color: s.text, fontSize: 12, fontWeight: 600,
                boxShadow: "0 10px 30px rgba(0,0,0,0.6)", opacity: 0.92,
                pointerEvents: "none", userSelect: "none", minWidth: 160,
                transform: "rotate(2deg)",
              }}>
                <div style={{ fontSize: 10, opacity: 0.7, marginBottom: 3 }}>{draggingTicket.tipo} · #{draggingTicket.id}</div>
                <div>{draggingTicket.titolo}</div>
                <div style={{ fontSize: 10, opacity: 0.7, marginTop: 3 }}>{draggingTicket.durata_stimata_ore || 1}h</div>
              </div>
            );
          })()}
        </DragOverlay>
      </div>

      {/* Drawer dettaglio ticket */}
      {detailTicket && <TicketDetailDrawer ticket={detailTicket} onClose={() => setDetailTicket(null)} />}

      {/* Modale pianificazione manuale */}
      {ticketDaPianificare && (
        <ModalePianificaManuale
          ticket={ticketDaPianificare}
          tecnici={tecnici}
          onSave={savePianificazioneManuale}
          onClose={() => setTicketDaPianificare(null)}
        />
      )}

      {/* WODetailDrawer — "Perché Qui?" */}
      <WODetailDrawer
        wo={selectedWO?.wo ?? null}
        ticket={selectedWO?.ticket ?? null}
        tecnico={selectedWO?.tecnico ?? null}
        onClose={() => setSelectedWO(null)}
      />

      {/* ReplanModal — Ricalcolo adattivo */}
      <ReplanModal
        open={replanModal}
        piano={piano}
        onClose={() => setReplanModal(false)}
        onSuccess={(_result: ReplanResult) => {
          setReplanModal(false);
          loadData();
          loadStorico();
        }}
      />

      <style>{`
        @keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
      `}</style>
    </DndContext>
  );
}
