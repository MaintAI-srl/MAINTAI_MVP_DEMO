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
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";

import type {
  TicketData,
  TecnicoData,
  PlannedWO,
  GeneratedPlan,
  EfficiencyBreakdown,
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
  assenza_corrente?: TecnicoData["assenza_corrente"];
}

import { createContext, useContext } from "react";

// ─── Costanti Gantt ───────────────────────────────────────────────────────────

const DAY_START_H = 7;
const DAY_END_H = 19;
const BASE_HOUR_W = 80;
const BASE_DAY_W = 156;
const BASE_ROW_H = 82;
const LABEL_W = 238;

const ZoomContext = createContext<number>(1);
function useZoom() { return useContext(ZoomContext); }

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

function formatLocalDateTimeSeconds(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}:00`;
}

function planDateTime(dateStr: string, timeStr?: string | null): string {
  const time = (timeStr || "08:00").split(":").slice(0, 2).join(":");
  return `${dateStr}T${time}:00`;
}

function ticketHours(ticket: TicketData | null | undefined): number {
  return Math.max(0.5, Number(ticket?.durata_stimata_ore) || 1);
}

function isTecnicoOperativo(tecnico: TecnicoData, dataToCheck?: string): boolean {
  // Controlla sempre lo stato base: solo "in servizio" è pianificabile
  const statoOk = ["in servizio", "in_servizio"].includes((tecnico.stato || "").toLowerCase());
  if (!statoOk) return false;
  // Se viene fornita una data specifica, controlla le assenze per quella data
  if (dataToCheck && tecnico.assenze) {
    return !tecnico.assenze.some(a => {
      if (!a.data_inizio || !a.data_fine) return false;
      const start = a.data_inizio.split("T")[0];
      const end = a.data_fine.split("T")[0];
      return dataToCheck >= start && dataToCheck <= end;
    });
  }
  // Senza data specifica, controlla assenza_corrente
  return !tecnico.assenza_corrente;
}

function plannedDate(ticket: TicketData): string | null {
  const parsed = parseStart(ticket);
  return parsed?.date ?? null;
}

function scheduledHoursFor(
  tickets: TicketData[],
  tecnicoId: number,
  date: string,
  excludeTicketId?: number,
): number {
  return tickets.reduce((sum, ticket) => {
    if (ticket.id === excludeTicketId) return sum;
    if (ticket.tecnico_id !== tecnicoId) return sum;
    if (plannedDate(ticket) !== date) return sum;
    return sum + ticketHours(ticket);
  }, 0);
}

function capacityInfo(
  tecnico: TecnicoData,
  date: string,
  tickets: TicketData[],
  excludeTicket?: TicketData | null,
) {
  const operativo = isTecnicoOperativo(tecnico, date);
  const capacity = operativo ? Number(tecnico.ore_giornaliere || 8) : 0;
  const assigned = scheduledHoursFor(tickets, tecnico.id, date, excludeTicket?.id);
  const remaining = Math.max(0, capacity - assigned);
  const needed = ticketHours(excludeTicket);
  const canAccept = operativo && (!excludeTicket || remaining >= needed);
  return { operativo, capacity, assigned, remaining, needed, canAccept };
}

// ─── Lane calculator ──────────────────────────────────────────────────────────

function computeLanes(dayWOs: TicketData[]) {
  const sorted = [...dayWOs].sort((a, b) => {
    const pa = parseStart(a), pb = parseStart(b);
    const ha = pa ? pa.hour + pa.minute / 60 : 8;
    const hb = pb ? pb.hour + pb.minute / 60 : 8;
    return ha - hb;
  });
  const laneEndTime: number[] = [];
  const assignments: number[] = [];

  for (const wo of sorted) {
    const p = parseStart(wo);
    const startH = p ? p.hour + p.minute / 60 : 8;
    const dur = ticketHours(wo);
    const endH = startH + dur;
    
    // allow a slight overlap (0.01h) to prevent precision issues
    let lane = laneEndTime.findIndex(end => startH >= end - 0.01);
    if (lane === -1) lane = laneEndTime.length;
    laneEndTime[lane] = endH;
    assignments.push(lane);
  }

  const totalLanes = laneEndTime.length || 1;
  const laneMap = new Map(sorted.map((wo, i) => [wo.gantt_key ?? wo.id, { lane: assignments[i] }]));
  return { laneMap, totalLanes };
}

// ─── TicketBlock (draggable nel Gantt) ────────────────────────────────────────

function TicketBlock({ ticket, view, onClick }: { ticket: TicketData; view: ViewMode; onClick: () => void }) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: `t-${ticket.id}`,
    data: { ticket },
  });
  const s = tipoStyle(ticket.tipo);
  const dur = ticketHours(ticket);

  if (view === "day") {
    const zoom = useZoom();
    const HOUR_W = BASE_HOUR_W * zoom;
    const ROW_H = BASE_ROW_H * zoom;
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
          borderRadius: 8,
          padding: "7px 9px",
          cursor: isDragging ? "grabbing" : "grab",
          opacity: isDragging ? 0.25 : 1,
          overflow: "hidden",
          userSelect: "none",
          boxSizing: "border-box",
          zIndex: isDragging ? 0 : 2,
          boxShadow: `0 10px 24px rgba(0,0,0,0.42), 0 0 16px ${s.border}22, inset 0 1px 0 rgba(255,255,255,0.12)`,
          transition: "filter 0.12s, transform 0.12s",
        }}
        onMouseEnter={(e) => {
          (e.currentTarget as HTMLDivElement).style.filter = "brightness(1.16)";
          (e.currentTarget as HTMLDivElement).style.transform = "translateY(-1px)";
        }}
        onMouseLeave={(e) => {
          (e.currentTarget as HTMLDivElement).style.filter = "brightness(1)";
          (e.currentTarget as HTMLDivElement).style.transform = "translateY(0)";
        }}
      >
        <div style={{ fontSize: 9, color: s.text, opacity: 0.7, letterSpacing: "0.08em" }}>{ticket.tipo} · {dur}h</div>
        <div style={{ fontSize: 11, color: s.text, fontWeight: 700, marginTop: 2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {ticket.is_plan_draft ? "BOZZA · " : ""}{ticket.titolo}
        </div>
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
        borderRadius: 8, padding: "5px 7px", marginBottom: 4,
        cursor: isDragging ? "grabbing" : "grab", opacity: isDragging ? 0.25 : 1,
        overflow: "hidden", userSelect: "none", width: "100%", boxSizing: "border-box", flexShrink: 0,
        boxShadow: `0 8px 18px rgba(0,0,0,0.36), 0 0 14px ${s.border}18, inset 0 1px 0 rgba(255,255,255,0.12)`,
        transition: "filter 0.12s, transform 0.12s",
      }}
      onMouseEnter={(e) => {
        (e.currentTarget as HTMLDivElement).style.filter = "brightness(1.15)";
        (e.currentTarget as HTMLDivElement).style.transform = "translateY(-1px)";
      }}
      onMouseLeave={(e) => {
        (e.currentTarget as HTMLDivElement).style.filter = "brightness(1)";
        (e.currentTarget as HTMLDivElement).style.transform = "translateY(0)";
      }}
    >
      <div style={{ fontSize: 10, color: s.text, fontWeight: 700, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
        {ticket.is_plan_draft ? "BOZZA · " : ""}{ticket.titolo}
      </div>
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
        background: "var(--border-subtle)", border: "1px solid var(--border-subtle)", borderLeft: `3px solid ${s.border}`,
        borderRadius: 6, padding: "8px 10px", marginBottom: 6,
        cursor: isDragging ? "grabbing" : "grab", opacity: isDragging ? 0.35 : 1, userSelect: "none",
        boxShadow: "0 2px 4px rgba(0,0,0,0.3)",
        transition: "background 0.12s, border-color 0.12s",
      }}
      onMouseEnter={(e) => {
        (e.currentTarget as HTMLDivElement).style.background = "rgba(59,130,246,0.05)";
        (e.currentTarget as HTMLDivElement).style.borderColor = "rgba(59,130,246,0.2)";
      }}
      onMouseLeave={(e) => {
        (e.currentTarget as HTMLDivElement).style.background = "var(--border-subtle)";
        (e.currentTarget as HTMLDivElement).style.borderColor = "var(--border-subtle)";
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 3 }}>
        <span style={{ fontSize: 9, color: s.text, letterSpacing: "0.1em", background: `${s.border}22`, border: `1px solid ${s.border}44`, padding: "1px 5px", borderRadius: 4 }}>{ticket.tipo}</span>
        <span style={{ fontSize: 9, color: prioColor }}>● {ticket.priorita}</span>
      </div>
      <div style={{ fontSize: 12, color: "#e2e8f0", fontWeight: 600, lineHeight: 1.3, marginBottom: 3 }}>{ticket.titolo}</div>
      <div style={{ fontSize: 10, color: "rgba(100,116,139,0.8)" }}>{ticket.durata_stimata_ore || 1}h · {ticket.asset_name || "—"}</div>
    </div>
  );
}

// ─── TecnicoLabel ─────────────────────────────────────────────────────────────

function TecnicoLabel({ tecnico, capacity }: { tecnico: TecnicoData; capacity?: { capacity: number; assigned: number; remaining: number } }) {
  const operativo = isTecnicoOperativo(tecnico);
  const cap = capacity?.capacity ?? (operativo ? Number(tecnico.ore_giornaliere || 8) : 0);
  const remaining = capacity?.remaining ?? cap;
  const assigned = capacity?.assigned ?? 0;
  const usagePct = cap > 0 ? clamp((assigned / cap) * 100, 0, 100) : 0;
  
  // Display row differently only if the capacity is 0 across the viewed period
  const totalOperativo = cap > 0 || operativo;
  
  return (
    <div style={{
      width: LABEL_W, minWidth: LABEL_W, padding: "0 14px",
      display: "flex", alignItems: "center",
      borderRight: "1px solid rgba(59,130,246,0.1)",
      background: totalOperativo
        ? "linear-gradient(90deg, #0b1628 0%, rgba(12,22,40,0.96) 100%)"
        : "linear-gradient(90deg, rgba(48,18,22,0.92) 0%, rgba(12,22,40,0.82) 100%)",
      position: "sticky", left: 0, zIndex: 3,
      opacity: totalOperativo ? 1 : 0.72,
    }}>
      <div style={{ width: "100%" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
          <div style={{ fontSize: 12, fontWeight: 800, color: "#e2e8f0", lineHeight: 1.3 }}>
            {tecnico.nome} {tecnico.cognome ?? ""}
          </div>
          <div style={{
            fontSize: 10, fontWeight: 900, color: remaining > 0 ? "#a6f6ff" : "#fca5a5",
            border: `1px solid ${remaining > 0 ? "rgba(31,232,255,0.28)" : "rgba(224,82,82,0.45)"}`,
            background: remaining > 0 ? "rgba(31,232,255,0.08)" : "rgba(224,82,82,0.13)",
            borderRadius: 999, padding: "2px 7px", whiteSpace: "nowrap",
          }}>
            {remaining.toFixed(1)}h libere
          </div>
        </div>
        <div style={{ fontSize: 10, color: "rgba(148,163,184,0.78)", marginTop: 2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {tecnico.skill ?? tecnico.competenze ?? ""}
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 7 }}>
          <div style={{ flex: 1, height: 5, borderRadius: 999, background: "rgba(83,97,116,0.22)", overflow: "hidden" }}>
            <div style={{
              width: `${usagePct}%`, height: "100%", borderRadius: 999,
              background: usagePct > 92 ? "#e05252" : usagePct > 72 ? "#f2b84b" : "#38d978",
              boxShadow: usagePct > 92 ? "0 0 10px rgba(224,82,82,0.45)" : "0 0 10px rgba(56,217,120,0.28)",
            }} />
          </div>
          <span style={{ fontSize: 9, color: "rgba(166,246,255,0.72)", whiteSpace: "nowrap" }}>{assigned.toFixed(1)}/{cap.toFixed(1)}h</span>
        </div>
        {!totalOperativo && (
          <div style={{
            display: "inline-flex",
            marginTop: 6,
            padding: "2px 7px",
            borderRadius: 999,
            border: "1px solid rgba(224,82,82,0.45)",
            background: "rgba(224,82,82,0.15)",
            color: "#fca5a5",
            fontSize: 9,
            fontWeight: 900,
            letterSpacing: "0.06em",
            textTransform: "uppercase",
          }}>
            Non disponibile
          </div>
        )}
      </div>
    </div>
  );
}

// ─── DayRow ───────────────────────────────────────────────────────────────────

function DayRow({ tecnico, tickets, allTickets, day, draggingTicket, onTicketClick }: {
  tecnico: TecnicoData; tickets: TicketData[]; allTickets: TicketData[]; day: Date; draggingTicket: TicketData | null; onTicketClick: (t: TicketData) => void;
}) {
  const dateStr = format(day, "yyyy-MM-dd");
  const { setNodeRef, isOver } = useDroppable({
    id: `row-${tecnico.id}-${dateStr}`,
    data: { tecnico_id: tecnico.id, date: dateStr },
  });
  const dayTickets = tickets.filter((t) => { const p = parseStart(t); return p && p.date === dateStr; });
  const { laneMap, totalLanes } = computeLanes(dayTickets);
  const cap = capacityInfo(tecnico, dateStr, allTickets);
  const dropCap = capacityInfo(tecnico, dateStr, allTickets, draggingTicket);
  
  const zoom = useZoom();
  const HOUR_W = BASE_HOUR_W * zoom;
  const ROW_H = BASE_ROW_H * zoom;
  const timelineW = (DAY_END_H - DAY_START_H) * HOUR_W;
  
  // Calculate dynamic height if there are multiple lanes
  const laneHeight = ROW_H - 12; // Height of TicketBlock
  const dynamicHeight = Math.max(ROW_H, 6 + totalLanes * (laneHeight + 4));

  const invalidDrop = isOver && draggingTicket && !dropCap.canAccept;
  const validDrop = isOver && draggingTicket && dropCap.canAccept;

  return (
    <div style={{ display: "flex", height: dynamicHeight, borderBottom: "1px solid rgba(31,78,107,0.25)" }}>
      <TecnicoLabel tecnico={tecnico} capacity={cap} />
      <div ref={setNodeRef} style={{
        position: "relative", width: timelineW, minWidth: timelineW, height: "100%",
        background: validDrop
          ? `linear-gradient(90deg, rgba(31,232,255,0.18), rgba(56,217,120,0.09)), repeating-linear-gradient(90deg, transparent 0, transparent ${HOUR_W - 1}px, rgba(31,232,255,0.12) ${HOUR_W - 1}px, rgba(31,232,255,0.12) ${HOUR_W}px)`
          : invalidDrop
            ? `linear-gradient(90deg, rgba(224,82,82,0.18), rgba(242,184,75,0.08)), repeating-linear-gradient(90deg, transparent 0, transparent ${HOUR_W - 1}px, rgba(224,82,82,0.12) ${HOUR_W - 1}px, rgba(224,82,82,0.12) ${HOUR_W}px)`
            : `repeating-linear-gradient(90deg, transparent 0, transparent ${HOUR_W - 1}px, rgba(31,78,107,0.14) ${HOUR_W - 1}px, rgba(31,78,107,0.14) ${HOUR_W}px)`,
        boxShadow: validDrop ? "inset 0 0 0 2px rgba(31,232,255,0.55), inset 0 0 32px rgba(31,232,255,0.12)" : invalidDrop ? "inset 0 0 0 2px rgba(224,82,82,0.55)" : "none",
        transition: "background 0.12s, box-shadow 0.12s",
      }}>
        {isOver && draggingTicket && (
          <div style={{
            position: "absolute", right: 12, top: 10, zIndex: 4,
            fontSize: 11, fontWeight: 900,
            color: dropCap.canAccept ? "#a6f6ff" : "#fca5a5",
            background: dropCap.canAccept ? "rgba(7,17,31,0.88)" : "rgba(80,20,24,0.92)",
            border: `1px solid ${dropCap.canAccept ? "rgba(31,232,255,0.48)" : "rgba(224,82,82,0.58)"}`,
            borderRadius: 999, padding: "5px 10px",
            boxShadow: dropCap.canAccept ? "0 0 18px rgba(31,232,255,0.18)" : "0 0 18px rgba(224,82,82,0.18)",
          }}>
            {dropCap.canAccept ? `Disponibile: ${dropCap.remaining.toFixed(1)}h` : !dropCap.operativo ? "Non disponibile" : `Capienza insufficiente: ${dropCap.remaining.toFixed(1)}h`}
          </div>
        )}
        {dayTickets.map((t) => {
          const p = parseStart(t)!;
          const left = (p.hour - DAY_START_H) * HOUR_W + (p.minute / 60) * HOUR_W;
          const laneInfo = laneMap.get(t.gantt_key ?? t.id) ?? { lane: 0 };
          const top = 6 + laneInfo.lane * (laneHeight + 4);
          return (
            <div key={t.gantt_key ?? t.id} style={{ position: "absolute", left, top, zIndex: 2 }}>
              <TicketBlock ticket={t} view="day" onClick={() => onTicketClick(t)} />
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─── DayCell ──────────────────────────────────────────────────────────────────

function DayCell({ tecnico, date, tickets, allTickets, draggingTicket, onTicketClick, cellW }: {
  tecnico: TecnicoData; date: string; tickets: TicketData[]; allTickets: TicketData[]; draggingTicket: TicketData | null;
  onTicketClick: (t: TicketData) => void; cellW: number;
}) {
  const { setNodeRef, isOver } = useDroppable({
    id: `cell-${tecnico.id}-${date}`,
    data: { tecnico_id: tecnico.id, date },
  });
  const cap = capacityInfo(tecnico, date, allTickets);
  const dropCap = capacityInfo(tecnico, date, allTickets, draggingTicket);
  const validDrop = isOver && draggingTicket && dropCap.canAccept;
  const invalidDrop = isOver && draggingTicket && !dropCap.canAccept;
  
  const zoom = useZoom();
  const ROW_H = BASE_ROW_H * zoom;
  
  // Find if there is an absence specifically for this day
  const assenzaGiorno = tecnico.assenze?.find(a => {
    if (!a.data_inizio || !a.data_fine) return false;
    const start = a.data_inizio.split("T")[0];
    const end = a.data_fine.split("T")[0];
    return date >= start && date <= end;
  });

  return (
    <div ref={setNodeRef} style={{
      width: cellW, minWidth: cellW, minHeight: ROW_H, padding: "4px 3px",
      borderRight: "1px solid rgba(31,78,107,0.18)",
      background: validDrop
        ? "linear-gradient(180deg, rgba(31,232,255,0.18), rgba(56,217,120,0.08))"
        : invalidDrop
          ? "linear-gradient(180deg, rgba(224,82,82,0.2), rgba(242,184,75,0.08))"
          : assenzaGiorno
            ? "linear-gradient(180deg, rgba(80,20,24,0.26), rgba(13,27,42,0.12))"
            : cap.operativo && cap.remaining > 0
              ? "linear-gradient(180deg, rgba(13,27,42,0.18), transparent)"
              : "linear-gradient(180deg, rgba(80,20,24,0.16), rgba(13,27,42,0.08))",
      boxShadow: validDrop ? "inset 0 0 0 2px rgba(31,232,255,0.55), inset 0 0 26px rgba(31,232,255,0.13)" : invalidDrop ? "inset 0 0 0 2px rgba(224,82,82,0.55)" : "none",
      transition: "background 0.12s, box-shadow 0.12s", overflow: "hidden",
      display: "flex", flexDirection: "column", gap: 1,
      position: "relative",
    }}>
      {assenzaGiorno && (
        <div style={{ position: "absolute", top: 2, right: 4, fontSize: 8, color: "rgba(252,165,165,0.6)", textTransform: "uppercase", letterSpacing: "0.1em" }}>
          {assenzaGiorno.tipo_assenza}
        </div>
      )}
      <div style={{
        display: "flex", justifyContent: "space-between", alignItems: "center",
        fontSize: 9, fontWeight: 900, color: cap.remaining > 0 ? "rgba(166,246,255,0.72)" : "rgba(252,165,165,0.82)",
        padding: "1px 4px 3px", flexShrink: 0,
      }}>
        <span>{cap.remaining.toFixed(1)}h</span>
        <span style={{ opacity: 0.62 }}>{cap.capacity.toFixed(0)}h</span>
      </div>
      {tickets.map((t) => <TicketBlock key={t.gantt_key ?? t.id} ticket={t} view="week" onClick={() => onTicketClick(t)} />)}
    </div>
  );
}

// ─── MultiDayRow ──────────────────────────────────────────────────────────────

function MultiDayRow({ tecnico, tickets, allTickets, days, view, draggingTicket, onTicketClick }: {
  tecnico: TecnicoData; tickets: TicketData[]; allTickets: TicketData[]; days: Date[]; view: ViewMode; draggingTicket: TicketData | null; onTicketClick: (t: TicketData) => void;
}) {
  const zoom = useZoom();
  const DAY_W = BASE_DAY_W * zoom;
  const ROW_H = BASE_ROW_H * zoom;
  const cellW = view === "week" ? DAY_W : Math.round(DAY_W * 0.75);
  const rowCapacity = days.reduce((acc, day) => {
    const c = capacityInfo(tecnico, format(day, "yyyy-MM-dd"), allTickets);
    acc.capacity += c.capacity;
    acc.assigned += c.assigned;
    acc.remaining += c.remaining;
    return acc;
  }, { capacity: 0, assigned: 0, remaining: 0 });
  return (
    <div style={{ display: "flex", minHeight: ROW_H, borderBottom: "1px solid rgba(31,78,107,0.25)" }}>
      <TecnicoLabel tecnico={tecnico} capacity={rowCapacity} />
      {days.map((day) => {
        const dateStr = format(day, "yyyy-MM-dd");
        return (
          <DayCell
            key={dateStr} tecnico={tecnico} date={dateStr}
            tickets={tickets.filter((t) => { const p = parseStart(t); return p && p.date === dateStr; })}
            allTickets={allTickets}
            draggingTicket={draggingTicket}
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
        width: 360, height: "100%", background: "var(--surface-2)",
        borderLeft: "1px solid var(--border-strong)", padding: 24, overflowY: "auto",
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
            <div key={label} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: 12, padding: "8px 0", borderBottom: "1px solid var(--border-strong)" }}>
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
  const [tecnicoId, setTecnicoId] = useState<number>((tecnici.find(t => isTecnicoOperativo(t)) ?? tecnici[0])?.id ?? 0);
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
              {tecnici.map((t) => (
                <option key={t.id} value={t.id} disabled={!isTecnicoOperativo(t)}>
                  {t.nome} {t.cognome ?? ""} · {isTecnicoOperativo(t) ? `${t.ore_giornaliere || 8}h/gg` : `non disponibile (${t.stato})`}
                </option>
              ))}
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
  const [effPanelOpen, setEffPanelOpen] = useState(true);
  const [ticketDaPianificare, setTicketDaPianificare] = useState<TicketData | null>(null);

  // Piano AI state
  const [piano, setPiano] = useState<GeneratedPlan | null>(null);
  const [generando, setGenerando] = useState(false);
  const [confermando, setConfermando] = useState(false);
  const [engineMode, setEngineMode] = useState<EngineMode>("deterministic");
  const [storico, setStorico] = useState<GeneratedPlan[]>([]);
  const [replanModal, setReplanModal] = useState(false);
  const [zoom, setZoom] = useState(1);
  // Selettore orizzonte pianificazione (#14)
  const [horizonDays, setHorizonDays] = useState(7);
  const [includeWeekends, setIncludeWeekends] = useState(false);
  const [allowOvertime, setAllowOvertime] = useState(false);

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));

  // ── Dati piano ──────────────────────────────────────────────────────────────
  const planJson = piano?.plan_json ?? { planned_workorders: [], deferred_workorders: [], fermo_assets: [], global_warnings: [] };
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

  // ── Contatori deferred dai piani storici (#12) ─────────────────────────────
  const deferredCounts = useMemo((): Record<number, number> => {
    const counts: Record<number, number> = {};
    storico.forEach((plan) => {
      if (plan.status !== "confirmed") return;
      (plan.plan_json?.deferred_workorders ?? []).forEach((d) => {
        if (d.wo_id != null) {
          counts[d.wo_id] = (counts[d.wo_id] ?? 0) + 1;
        }
      });
    });
    return counts;
  }, [storico]);

  // ── Statistiche backlog ─────────────────────────────────────────────────────
  const tipoCounts = useMemo(() => {
    const counts = { BD: 0, PM: 0, CM: 0 };
    const plannedDraftIds = new Set((planJson?.planned_workorders ?? []).map((wo) => wo.wo_id));
    unscheduledTickets.filter((t) => !plannedDraftIds.has(t.id)).forEach((t) => {
      if (t.tipo in counts) counts[t.tipo as keyof typeof counts]++;
    });
    return counts;
  }, [planJson?.planned_workorders, unscheduledTickets]);

  const ganttTickets = useMemo(() => {
    if (!piano || piano.status === "draft") return scheduledTickets;

    const draftWos = planJson?.planned_workorders ?? [];
    if (!draftWos.length) return scheduledTickets;

    const draftIds = new Set(draftWos.map((wo) => wo.wo_id));
    const lockedOrPersisted = scheduledTickets.filter((t) => !draftIds.has(t.id));
    const draftTickets: TicketData[] = draftWos.map((wo) => {
      const base = ticketMap.get(wo.wo_id);
      const start = planDateTime(wo.planned_date, wo.planned_start_time);
      const finish = planDateTime(wo.planned_date, wo.planned_end_time);
      return {
        id: wo.wo_id,
        titolo: base?.titolo ?? `Ticket #${wo.wo_id}`,
        asset_id: base?.asset_id ?? 0,
        asset_name: base?.asset_name ?? null,
        tipo: base?.tipo ?? "CM",
        priorita: base?.priorita ?? "Media",
        stato: piano?.status === "draft" ? "Bozza piano" : (base?.stato ?? "Pianificato"),
        durata_stimata_ore: wo.duration_hours ?? base?.durata_stimata_ore ?? 1,
        fascia_oraria: base?.fascia_oraria ?? "",
        descrizione: base?.descrizione ?? null,
        tecnico_id: wo.technician_id,
        planned_start: start,
        planned_finish: finish,
        gantt_key: `${piano?.id ?? "draft"}-${wo.wo_id}-${wo.planned_date}-${wo.planned_start_time}-${wo.is_continuation ? "cont" : "main"}`,
        is_plan_draft: piano?.status === "draft",
      };
    });

    return [...lockedOrPersisted, ...draftTickets];
  }, [piano?.id, piano?.status, planJson?.planned_workorders, scheduledTickets, ticketMap]);

  // ── Caricamento dati ────────────────────────────────────────────────────────
  const loadStorico = useCallback(async () => {
    try {
      const res = await apiGet<GeneratedPlan[]>("/planning/history").catch(() => []);
      setStorico(res ?? []);
    } catch { /* silenzioso */ }
  }, []);

  const loadData = useCallback(async (background = false) => {
    if (!background) setLoading(true);
    try {
      const [tecniciRes, activeRes, planRes] = await Promise.all([
        apiGet<TecnicoAPI[]>("/tecnici"),
        apiGet<{ items: TicketData[] }>("/tickets?limit=200&stato=Aperto,Pianificato,In%20corso"),
        apiGet<GeneratedPlan | null>("/planning/current").catch(() => null),
      ]);

      setTecnici((tecniciRes ?? []).map((t) => ({ ...t, competenze: t.skill ?? "" })));
      const activeTickets = activeRes.items ?? [];
      const scheduled = activeTickets.filter((t) => t.planned_start != null);
      const unscheduled = activeTickets.filter((t) => t.planned_start == null);
      setScheduledTickets(scheduled);
      setUnscheduledTickets(unscheduled);
      setPiano(planRes);
    } catch (e: unknown) {
      notify.error(e instanceof Error ? e.message : "Errore caricamento dati");
    } finally {
      if (!background) setLoading(false);
    }
  }, []);

  useEffect(() => { loadData(); loadStorico(); }, [loadData, loadStorico]);

  useEffect(() => {
    function onVisibilityChange() {
      if (document.visibilityState === "visible") loadData(true);
    }
    function onDataChanged() {
      loadData(true);
    }
    document.addEventListener("visibilitychange", onVisibilityChange);
    window.addEventListener("focus", onDataChanged);
    window.addEventListener("maintai:data-changed", onDataChanged);
    return () => {
      document.removeEventListener("visibilitychange", onVisibilityChange);
      window.removeEventListener("focus", onDataChanged);
      window.removeEventListener("maintai:data-changed", onDataChanged);
    };
  }, [loadData]);

  // ── Genera piano AI ─────────────────────────────────────────────────────────
  async function generateAIPlan() {
    setGenerando(true);
    try {
      const res = await apiPost<GeneratedPlan & { previous_efficiency_score?: number }>("/planning/generate", {
        days: horizonDays,
        mode: engineMode,
        include_weekends: includeWeekends,
        allow_overtime: allowOvertime,
      });
      const { previous_efficiency_score: prevScore, ...cleanRes } = res;
      const newScore = res.plan_json?.efficiency_score;
      if (prevScore !== undefined && newScore !== undefined && newScore < prevScore) {
        notify.warning(`Piano generato (score: ${Math.round(newScore)}) — inferiore al precedente (${Math.round(prevScore)})`);
      } else {
        notify.success(newScore !== undefined ? `Piano generato — score ${Math.round(newScore)}` : "Piano generato");
      }
      setPiano(cleanRes);
      const planStart = cleanRes.plan_json?.plan_metadata?.planning_start_date;
      setCurrentDate(planStart ? parseISO(planStart) : new Date());
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
      const ticket = ticketMap.get(ticketId) ?? ticketDaPianificare;
      const tecnico = tecnicoMap.get(tecnicoId);
      if (ticket && tecnico) {
        const c = capacityInfo(tecnico, data, ganttTickets, ticket);
        if (!c.operativo) {
          notify.warning(`${tecnico.nome} ${tecnico.cognome ?? ""} non disponibile: ticket non pianificato`);
          return;
        }
        if (c.remaining < ticketHours(ticket)) {
          notify.warning(`Capienza insufficiente: servono ${ticketHours(ticket).toFixed(1)}h, restano ${c.remaining.toFixed(1)}h`);
          return;
        }
        
        // --- OPTIMISTIC UPDATE ---
        const newStart = start ?? `${data}T08:00:00`;
        const newFinish = finish ?? `${data}T17:00:00`;
        
        const updateTicketList = (list: TicketData[]) => {
          return list.map(t => t.id === ticketId ? { ...t, tecnico_id: tecnicoId, planned_start: newStart, planned_finish: newFinish, stato: "Pianificato" } : t);
        };
        
        if (ticket.planned_start) {
          setScheduledTickets(prev => updateTicketList(prev));
        } else {
          const updatedTicket = { ...ticket, tecnico_id: tecnicoId, planned_start: newStart, planned_finish: newFinish, stato: "Pianificato" };
          setScheduledTickets(prev => [...prev, updatedTicket]);
          setUnscheduledTickets(prev => prev.filter(t => t.id !== ticketId));
        }
        // -------------------------

        await apiPut(`/tickets/${ticketId}`, {
          tecnico_id: tecnicoId,
          planned_start: newStart,
          planned_finish: newFinish,
          stato: "Pianificato",
          is_manual_plan: true,
        });
        notify.success(`Ticket #${ticketId} pianificato`);
        loadData(true); // background sync
      }
    } catch (e: unknown) {
      notify.error(e instanceof Error ? e.message : "Errore salvataggio");
      loadData(true); // revert in case of error
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

    const droppedTicket = (active.data.current as { ticket?: TicketData })?.ticket;
    if (!droppedTicket) return;

    const dropTarget = over.data.current as { tecnico_id?: number; date?: string } | undefined;
    if (!dropTarget?.tecnico_id || !dropTarget?.date) return;
    const targetTecnico = tecnicoMap.get(dropTarget.tecnico_id);
    if (!targetTecnico) return;

    const dropCapacity = capacityInfo(targetTecnico, dropTarget.date, ganttTickets, droppedTicket);
    if (!dropCapacity.operativo) {
      notify.warning(`${targetTecnico.nome} ${targetTecnico.cognome ?? ""} non disponibile: assegnazione rifiutata`);
      return;
    }
    if (dropCapacity.remaining < ticketHours(droppedTicket)) {
      notify.warning(`Capienza insufficiente per ${targetTecnico.nome}: restano ${dropCapacity.remaining.toFixed(1)}h, il ticket richiede ${ticketHours(droppedTicket).toFixed(1)}h`);
      return;
    }

    let newHour = 8;
    let newMinute = 0;
    if (view === "day") {
      const droppableRect = over.rect;
      const draggedRect = event.active.rect.current.translated;
      if (draggedRect && droppableRect) {
        const relX = Math.max(0, draggedRect.left - droppableRect.left);
        const totalMin = (relX / (BASE_HOUR_W * zoom)) * 60;
        const rounded = Math.round(totalMin / 30) * 30;
        newHour = clamp(DAY_START_H + Math.floor(rounded / 60), DAY_START_H, DAY_END_H - 1);
        newMinute = rounded % 60;
      }
    }

    // --- OPTIMISTIC UPDATE ---
    const newStartStr = `${String(newHour).padStart(2, "0")}:${String(newMinute).padStart(2, "0")}`;
    const durationHours = droppedTicket.durata_stimata_ore || 1;
    const newEndDec = newHour + (newMinute/60) + durationHours;
    const newEndH = Math.floor(newEndDec);
    const newEndM = Math.round((newEndDec - newEndH) * 60);
    const newEndStr = `${String(newEndH).padStart(2, "0")}:${String(newEndM).padStart(2, "0")}`;

    if (piano?.status === "draft") {
       // Optimistic update for draft
       const newWos = [...(piano.plan_json?.planned_workorders || [])];
       const woIndex = newWos.findIndex(w => w.wo_id === droppedTicket.id);
       if (woIndex >= 0) {
           newWos[woIndex] = {
               ...newWos[woIndex],
               technician_id: dropTarget.tecnico_id,
               planned_date: dropTarget.date,
               planned_start_time: newStartStr,
               planned_end_time: newEndStr,
           };
           setPiano({
               ...piano,
               plan_json: {
                   ...piano.plan_json,
                   planned_workorders: newWos
               }
           });
       }
    } else {
       // Optimistic update for confirmed/db
       const newStartIso = `${dropTarget.date}T${newStartStr}:00`;
       const newEndIso = `${dropTarget.date}T${newEndStr}:00`;
       const updateTicketList = (list: TicketData[]) => list.map(t => t.id === droppedTicket.id ? { ...t, tecnico_id: dropTarget.tecnico_id, planned_start: newStartIso, planned_finish: newEndIso, stato: "Pianificato" } : t);
       
       if (droppedTicket.planned_start) {
         setScheduledTickets(prev => updateTicketList(prev));
       } else {
         setScheduledTickets(prev => [...prev, { ...droppedTicket, tecnico_id: dropTarget.tecnico_id, planned_start: newStartIso, planned_finish: newEndIso, stato: "Pianificato" }]);
         setUnscheduledTickets(prev => prev.filter(t => t.id !== droppedTicket.id));
       }
    }
    // -------------------------

    try {
      await apiPost("/planning/move-ticket", {
        ticket_id: droppedTicket.id,
        new_date: dropTarget.date,
        new_start_hour: newHour,
        new_start_minute: newMinute,
        tecnico_id: dropTarget.tecnico_id,
        skip_engine_validation: piano?.status === "draft",
      });
      notify.success(`Ticket #${droppedTicket.id} spostato`);
      loadData(true);
    } catch (e: unknown) {
      notify.error(e instanceof Error ? e.message : "Errore spostamento ticket");
      loadData(true);
    }
  }
  // ── Navigazione data ────────────────────────────────────────────────────────
  function navigate(dir: 1 | -1) {
    const delta = view === "day" ? 1 : view === "week" ? 7 : 14;
    setCurrentDate((d) => (dir === 1 ? addDays(d, delta) : subDays(d, delta)));
  }

  const days = getDays(currentDate, view);
  const cellW = view === "week" ? BASE_DAY_W * zoom : Math.round(BASE_DAY_W * zoom * 0.75);
  const timelineMinW = LABEL_W + (view === "day" ? (DAY_END_H - DAY_START_H) * (BASE_HOUR_W * zoom) : days.length * cellW);
  const plannedDraftIds = new Set((planJson?.planned_workorders ?? []).map((wo) => wo.wo_id));
  const visibleUnscheduledTickets = unscheduledTickets;
  const filteredUnscheduled = filterTipo ? visibleUnscheduledTickets.filter((t) => t.tipo === filterTipo) : visibleUnscheduledTickets;
  const columnCapacity = useMemo(() => {
    const map = new Map<string, { capacity: number; assigned: number; remaining: number; unavailable: number }>();
    days.forEach((day) => {
      const date = format(day, "yyyy-MM-dd");
      const totals = tecnici.reduce((acc, tecnico) => {
        const c = capacityInfo(tecnico, date, ganttTickets);
        acc.capacity += c.capacity;
        acc.assigned += c.assigned;
        acc.remaining += c.remaining;
        if (!c.operativo) acc.unavailable += 1;
        return acc;
      }, { capacity: 0, assigned: 0, remaining: 0, unavailable: 0 });
      map.set(date, totals);
    });
    return map;
  }, [days, tecnici, ganttTickets]);
  const visibleTotals = useMemo(() => {
    return days.reduce((acc, day) => {
      const c = columnCapacity.get(format(day, "yyyy-MM-dd"));
      if (!c) return acc;
      acc.capacity += c.capacity;
      acc.assigned += c.assigned;
      acc.remaining += c.remaining;
      return acc;
    }, { capacity: 0, assigned: 0, remaining: 0 });
  }, [columnCapacity, days]);

  const dateLabel =
    view === "day"
      ? format(days[0]!, "EEEE d MMMM yyyy", { locale: it })
      : `${format(days[0]!, "d MMM", { locale: it })} – ${format(days[days.length - 1]!, "d MMM yyyy", { locale: it })}`;

  // ── Render ──────────────────────────────────────────────────────────────────
  return (
    <ZoomContext.Provider value={zoom}>
    <DndContext sensors={sensors} onDragStart={handleDragStart} onDragEnd={handleDragEnd}>
      <div style={{ display: "flex", flexDirection: "column", height: "100vh", background: "var(--surface-1)", fontFamily: "'IBM Plex Mono', monospace", color: "#f9fafb" }}>

        {/* ── TOOLBAR ── */}
        <div style={{
          display: "flex", alignItems: "center", gap: 8, padding: "0 16px",
          borderBottom: "1px solid rgba(59,130,246,0.15)",
          background: "linear-gradient(90deg, #0a1628 0%, #0d1e38 100%)",
          flexShrink: 0, flexWrap: "wrap", height: 52,
        }}>
          {/* View toggle */}
          <div style={{ display: "flex", gap: 3 }}>
            {(["day", "week", "2week"] as ViewMode[]).map((v) => (
              <button key={v} onClick={() => setView(v)} style={{
                padding: "5px 10px", fontSize: 10, letterSpacing: "0.1em",
                background: view === v ? "rgba(59,130,246,0.15)" : "transparent",
                color: view === v ? "#60a5fa" : "rgba(148,163,184,0.7)",
                border: view === v ? "1px solid rgba(59,130,246,0.3)" : "1px solid transparent",
                borderRadius: 5,
                cursor: "pointer", fontFamily: "inherit", fontWeight: view === v ? 700 : 500,
                transition: "all 0.12s",
              }}>
                {v === "day" ? "GIORNO" : v === "week" ? "SETTIMANA" : "2 SETT."}
              </button>
            ))}
          </div>

          {/* Date nav */}
          <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
            <button onClick={() => navigate(-1)} style={{ background: "transparent", border: "1px solid rgba(59,130,246,0.2)", color: "rgba(148,163,184,0.8)", width: 28, height: 28, cursor: "pointer", fontSize: 16, lineHeight: 1, borderRadius: 5 }}>‹</button>
            <button onClick={() => setCurrentDate(new Date())} style={{ background: "transparent", border: "1px solid rgba(59,130,246,0.2)", color: "rgba(148,163,184,0.8)", padding: "4px 10px", fontSize: 10, letterSpacing: "0.1em", cursor: "pointer", fontFamily: "inherit", borderRadius: 5 }}>OGGI</button>
            <button onClick={() => navigate(1)} style={{ background: "transparent", border: "1px solid rgba(59,130,246,0.2)", color: "rgba(148,163,184,0.8)", width: 28, height: 28, cursor: "pointer", fontSize: 16, lineHeight: 1, borderRadius: 5 }}>›</button>
          </div>

          {/* Controlli Zoom */}
          <div style={{ display: "flex", alignItems: "center", gap: 6, borderLeft: "1px solid rgba(255,255,255,0.08)", paddingLeft: 12 }}>
            <button
              onClick={() => setZoom(z => Math.max(0.6, z - 0.2))}
              style={{ background: "transparent", border: "1px solid rgba(255,255,255,0.12)", color: "#9ca3af", width: 26, height: 26, borderRadius: 6, cursor: "pointer", fontSize: 16, lineHeight: 1, display: "flex", alignItems: "center", justifyContent: "center" }}
              title="Zoom Out"
            >
              -
            </button>
            <span style={{ fontSize: 11, color: "#9ca3af", minWidth: 32, textAlign: "center", fontWeight: 600 }}>
              {Math.round(zoom * 100)}%
            </span>
            <button
              onClick={() => setZoom(z => Math.min(2.0, z + 0.2))}
              style={{ background: "transparent", border: "1px solid rgba(255,255,255,0.12)", color: "#9ca3af", width: 26, height: 26, borderRadius: 6, cursor: "pointer", fontSize: 16, lineHeight: 1, display: "flex", alignItems: "center", justifyContent: "center" }}
              title="Zoom In"
            >
              +
            </button>
          </div>

          <span style={{ fontSize: 13, color: "#e2e8f0", fontWeight: 700, textTransform: "capitalize" }}>{dateLabel}</span>

          <div style={{ flex: 1 }} />

          {/* Efficienza badge compatta — pill premium */}
          <div style={{ display: "none" }}>
          {effScore !== undefined && (
            <span style={{
              fontSize: 11, fontWeight: 800, padding: "4px 12px", borderRadius: 20,
              background: effScore >= 80
                ? "linear-gradient(135deg, rgba(20,83,45,0.6), rgba(5,150,105,0.3))"
                : effScore >= 60
                  ? "linear-gradient(135deg, rgba(120,53,15,0.6), rgba(245,158,11,0.2))"
                  : "linear-gradient(135deg, rgba(127,29,29,0.6), rgba(239,68,68,0.2))",
              color: effScore >= 80 ? "#86efac" : effScore >= 60 ? "#fcd34d" : "#fca5a5",
              border: `1px solid ${effScore >= 80 ? "rgba(34,197,94,0.4)" : effScore >= 60 ? "rgba(245,158,11,0.4)" : "rgba(239,68,68,0.4)"}`,
              boxShadow: effScore >= 80
                ? "0 0 10px rgba(34,197,94,0.15)"
                : effScore >= 60
                  ? "0 0 10px rgba(245,158,11,0.15)"
                  : "0 0 10px rgba(239,68,68,0.15)",
              letterSpacing: "0.05em",
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

          <span style={{ fontSize: 10, color: "#6b7280" }}>
            {tecnici.length} tecnici · {ganttTickets.length} in Gantt · {visibleTotals.remaining.toFixed(1)}h libere
          </span>

          {/* Engine toggle */}
          <div style={{ display: "flex", gap: 3, fontSize: 11 }}>
            {(["deterministic", "ai"] as EngineMode[]).map((m) => (
              <button key={m} onClick={() => setEngineMode(m)} title={m === "deterministic" ? "Motore deterministico — istantaneo" : "Motore GPT — richiede OpenAI"} style={{
                padding: "4px 10px", fontWeight: 600, cursor: "pointer",
                border: engineMode === m
                  ? (m === "ai" ? "1px solid rgba(124,58,237,0.5)" : "1px solid rgba(5,150,105,0.5)")
                  : "1px solid transparent",
                borderRadius: 6,
                background: engineMode === m ? (m === "ai" ? "linear-gradient(135deg,rgba(29,78,216,0.5),rgba(124,58,237,0.5))" : "rgba(6,95,70,0.6)") : "transparent",
                color: engineMode === m ? "#fff" : "rgba(100,116,139,0.7)", fontFamily: "inherit",
                transition: "all 0.12s",
              }}>
                {m === "deterministic" ? "⚙ Engine" : "🤖 GPT"}
              </button>
            ))}
          </div>

          {/* Selettore orizzonte pianificazione (#14) */}
          <div style={{ display: "flex", gap: 3 }}>
            {[7, 14, 30].map((d) => (
              <button
                key={d}
                onClick={() => setHorizonDays(d)}
                style={{
                  padding: "5px 10px", fontSize: 11, fontWeight: 700,
                  borderRadius: 6, border: "1px solid var(--border-default, #374151)",
                  background: horizonDays === d ? "rgba(99,102,241,0.25)" : "transparent",
                  color: horizonDays === d ? "#a5b4fc" : "rgba(148,163,184,0.7)",
                  cursor: "pointer", fontFamily: "inherit",
                  transition: "all 0.12s",
                }}
              >
                {d}gg
              </button>
            ))}
          </div>

          <button
            onClick={() => setIncludeWeekends((v) => !v)}
            title="Include o esclude sabato e domenica dalla generazione piano"
            style={{
              padding: "5px 10px", fontSize: 10, fontWeight: 800,
              borderRadius: 6,
              border: includeWeekends ? "1px solid rgba(34,197,94,0.45)" : "1px solid rgba(55,65,81,0.8)",
              background: includeWeekends ? "rgba(6,95,70,0.45)" : "transparent",
              color: includeWeekends ? "#86efac" : "rgba(148,163,184,0.75)",
              cursor: "pointer", fontFamily: "inherit",
              letterSpacing: "0.06em",
            }}
          >
            {includeWeekends ? "SAB-DOM ON" : "LUN-VEN"}
          </button>

          <button
            onClick={() => setAllowOvertime((v) => !v)}
            title="Programma nel turno standard 08-17 o consenti estensione fino alle 21"
            style={{
              padding: "5px 10px", fontSize: 10, fontWeight: 800,
              borderRadius: 6,
              border: allowOvertime ? "1px solid rgba(245,158,11,0.5)" : "1px solid rgba(55,65,81,0.8)",
              background: allowOvertime ? "rgba(120,53,15,0.45)" : "transparent",
              color: allowOvertime ? "#fcd34d" : "rgba(148,163,184,0.75)",
              cursor: "pointer", fontFamily: "inherit",
              letterSpacing: "0.06em",
            }}
          >
            {allowOvertime ? "08-21" : "08-17"}
          </button>

          {/* Genera Piano AI */}
          <button onClick={generateAIPlan} disabled={generando} style={{
            background: generando ? "rgba(31,41,55,0.8)" : "linear-gradient(135deg, #1d4ed8, #7c3aed)",
            border: "none", color: "#fff", borderRadius: 8, padding: "8px 20px",
            fontSize: 12, fontWeight: 800, cursor: generando ? "not-allowed" : "pointer",
            boxShadow: generando ? "none" : "0 0 18px rgba(99,102,241,0.45), 0 4px 12px rgba(29,78,216,0.3)",
            display: "flex", alignItems: "center", gap: 6, transition: "box-shadow 0.12s",
          }}>
            {generando ? (
              <><span style={{ display: "inline-block", width: 12, height: 12, border: "2px solid #ffffff44", borderTop: "2px solid #fff", borderRadius: "50%", animation: "spin 0.8s linear infinite" }} />Elaborazione...</>
            ) : "⚡ Genera Piano AI"}
          </button>

          {/* Conferma piano */}
          {piano?.status === "draft" && (
            <button onClick={confirmPlan} disabled={confermando} style={{
              background: confermando ? "rgba(31,41,55,0.8)" : "#065f46",
              border: "1px solid #059669",
              color: "#86efac", borderRadius: 8, padding: "8px 16px",
              fontSize: 12, fontWeight: 700, cursor: confermando ? "not-allowed" : "pointer",
              transition: "all 0.12s",
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
                border: "1px solid rgba(55,65,81,0.8)",
                color: "rgba(148,163,184,0.8)",
                borderRadius: 6,
                padding: "6px 12px",
                fontSize: 12,
                cursor: "pointer",
                fontFamily: "inherit",
                transition: "border-color 0.12s, color 0.12s",
              }}
            >
              ↻ Ricalcola
            </button>
          )}

          </div>

          <span style={{ fontSize: 10, color: "#6b7280" }}>
            {tecnici.length} tecnici · {ganttTickets.length} in Gantt · {visibleTotals.remaining.toFixed(1)}h libere
          </span>

          {/* Refresh */}
          <button onClick={() => loadData()} disabled={loading} title="Aggiorna" style={{
            background: "transparent", border: "1px solid rgba(55,65,81,0.8)", color: "rgba(148,163,184,0.8)",
            width: 28, height: 28, cursor: "pointer", fontSize: 14, opacity: loading ? 0.5 : 1,
            borderRadius: 6, transition: "border-color 0.12s",
          }}>↻</button>
        </div>

        {/* ── BODY ── */}
        <div style={{ display: "flex", flex: 1, overflow: "hidden" }}>

          {/* ── SIDEBAR sinistra ── */}
          <div style={{
            width: 256, minWidth: 256, borderRight: "1px solid rgba(59,130,246,0.1)",
            background: "var(--surface-1)", display: "flex", flexDirection: "column", overflow: "hidden",
          }}>
            {/* Header sidebar */}
            <div style={{
              padding: "10px 12px", flexShrink: 0,
              background: "linear-gradient(90deg, rgba(59,130,246,0.08), transparent)",
              borderBottom: "1px solid rgba(59,130,246,0.12)",
            }}>
              <div style={{ fontSize: 10, letterSpacing: "0.15em", color: "rgba(148,163,184,0.7)", marginBottom: 8, fontWeight: 700 }}>NON PIANIFICATI</div>
              <div style={{ display: "flex", gap: 5, flexWrap: "wrap", marginBottom: 8 }}>
                {(["", "BD", "PM", "CM"] as const).map((tipo) => {
                  const color = tipo === "BD" ? "#ef4444" : tipo === "PM" ? "#22c55e" : tipo === "CM" ? "#f59e0b" : "#6b7280";
                  const cnt = tipo ? tipoCounts[tipo] : visibleUnscheduledTickets.length;
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
                  <UnscheduledItem key={t.id} ticket={t} onClick={() => setDetailTicket(t)} />
                ))
              )}
            </div>

          </div>

          {/* ── GANTT TIMELINE ── */}
          <div style={{ flex: 1, overflow: "auto", position: "relative", background: "#060d1a" }}>
            {loading ? (
              <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100%", color: "#6b7280", fontSize: 13 }}>
                Caricamento dati...
              </div>
            ) : (
              <div style={{ minWidth: timelineMinW }}>
                {/* Header colonne */}
                <div style={{
                  display: "flex", height: 40,
                  borderBottom: "1px solid rgba(59,130,246,0.12)",
                  background: "linear-gradient(180deg, var(--surface-1) 0%, #0a1422 100%)",
                  position: "sticky", top: 0, zIndex: 10,
                }}>
                  <div style={{
                    width: LABEL_W, minWidth: LABEL_W, display: "flex", alignItems: "center",
                    padding: "0 14px", borderRight: "1px solid rgba(59,130,246,0.1)",
                    fontSize: 10, color: "rgba(148,163,184,0.7)", letterSpacing: "0.08em", fontWeight: 700,
                    position: "sticky", left: 0,
                    background: "linear-gradient(180deg, var(--surface-1) 0%, #0a1422 100%)", zIndex: 11,
                  }}>
                    TECNICO · ORE RESIDUE
                  </div>
                  {view === "day"
                    ? Array.from({ length: DAY_END_H - DAY_START_H }, (_, i) => (
                        <div key={i} style={{ width: BASE_HOUR_W * zoom, minWidth: BASE_HOUR_W * zoom, display: "flex", alignItems: "center", paddingLeft: 6, borderRight: "1px solid rgba(59,130,246,0.06)", fontSize: 10, color: "rgba(148,163,184,0.7)", fontWeight: 700, letterSpacing: "0.08em" }}>
                          {String(DAY_START_H + i).padStart(2, "0")}:00
                        </div>
                      ))
                    : days.map((day) => {
                        const today = isToday(day);
                        const cap = columnCapacity.get(format(day, "yyyy-MM-dd"));
                        return (
                          <div key={day.toISOString()} style={{
                            width: cellW, minWidth: cellW, display: "flex", flexDirection: "column",
                            alignItems: "center", justifyContent: "center",
                            borderRight: "1px solid rgba(59,130,246,0.06)",
                            background: today ? "rgba(59,130,246,0.15)" : "transparent",
                          }}>
                            <div style={{ fontSize: 9, color: today ? "#60a5fa" : "rgba(148,163,184,0.7)", letterSpacing: "0.08em", fontWeight: 700 }}>
                              {format(day, "EEE", { locale: it }).toUpperCase()}
                            </div>
                            <div style={{
                              fontSize: 13, fontWeight: 700, color: today ? "#60a5fa" : "#e2e8f0",
                              textShadow: today ? "0 0 8px rgba(96,165,250,0.6)" : "none",
                            }}>
                              {format(day, "d")}
                            </div>
                            <div style={{ fontSize: 9, color: (cap?.remaining ?? 0) > 0 ? "#a6f6ff" : "#fca5a5", fontWeight: 900, marginTop: 2 }}>
                              {(cap?.remaining ?? 0).toFixed(1)}h / {(cap?.capacity ?? 0).toFixed(0)}h
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
                    const tickets = ganttTickets.filter((t) => t.tecnico_id === tecnico.id);
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
                      return (
                        <DayRow
                          key={tecnico.id}
                          tecnico={tecnico}
                          tickets={tickets}
                          allTickets={ganttTickets}
                          day={days[0]!}
                          draggingTicket={draggingTicket}
                          onTicketClick={handleTicketClick}
                        />
                      );
                    }
                    return (
                      <MultiDayRow
                        key={tecnico.id}
                        tecnico={tecnico}
                        tickets={tickets}
                        allTickets={ganttTickets}
                        days={days}
                        view={view}
                        draggingTicket={draggingTicket}
                        onTicketClick={handleTicketClick}
                      />
                    );
                  })
                )}
              </div>
            )}
          </div>


        </div>

        {/* ── STORICO PIANI ── */}
        <div style={{ display: "none",
          borderTop: "1px solid rgba(59,130,246,0.08)",
          padding: "0 16px 24px",
          background: "linear-gradient(180deg, #060d1a 0%, #040a14 100%)",
          maxHeight: 320, overflowY: "auto",
        }}>
          <StoricoPiani piani={storico} onRefresh={loadStorico} />
        </div>

        {/* Drag overlay */}
        <DragOverlay dropAnimation={null}>
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
        onSuccess={() => {
          setReplanModal(false);
          loadData();
          loadStorico();
        }}
      />

      <style>{`
        @keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
      `}</style>
    </DndContext>
    </ZoomContext.Provider>
  );
}
