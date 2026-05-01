"use client";

import { useState, useEffect, useCallback } from "react";
import {
  DndContext,
  DragEndEvent,
  DragStartEvent,
  DragOverlay,
  PointerSensor,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import { useDraggable, useDroppable } from "@dnd-kit/core";
import { apiGet, apiPost } from "@/app/lib/api";
import { TicketData, TecnicoData, tipoStyle } from "../types";
import { notify } from "@/lib/toast";
import { format, addDays, subDays, parseISO, startOfWeek, isToday } from "date-fns";
import { it } from "date-fns/locale";

// ─── Constants ────────────────────────────────────────────────────────────────

type ViewMode = "day" | "week" | "2week";

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

// ─── TicketBlock (draggable) ──────────────────────────────────────────────────

function TicketBlock({
  ticket,
  view,
  onClick,
}: {
  ticket: TicketData;
  view: ViewMode;
  onClick: () => void;
}) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: `g-t-${ticket.id}`,
    data: { ticket },
  });

  const s = tipoStyle(ticket.tipo);
  const dur = Math.max(0.5, ticket.durata_stimata_ore || 1);

  if (view === "day") {
    return (
      <div
        ref={setNodeRef}
        {...listeners}
        {...attributes}
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
        <div style={{ fontSize: 9, color: s.text, opacity: 0.7, letterSpacing: "0.08em" }}>
          {ticket.tipo} · {dur}h
        </div>
        <div style={{ fontSize: 11, color: s.text, fontWeight: 600, marginTop: 2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {ticket.titolo}
        </div>
        {ticket.asset_name && (
          <div style={{ fontSize: 9, color: s.text, opacity: 0.6, marginTop: 2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {ticket.asset_name}
          </div>
        )}
      </div>
    );
  }

  return (
    <div
      ref={setNodeRef}
      {...listeners}
      {...attributes}
      onClick={(e) => { e.stopPropagation(); onClick(); }}
      style={{
        background: s.bg,
        border: `1px solid ${s.border}`,
        borderLeft: `3px solid ${s.border}`,
        borderRadius: 3,
        padding: "3px 5px",
        marginBottom: 2,
        cursor: isDragging ? "grabbing" : "grab",
        opacity: isDragging ? 0.25 : 1,
        overflow: "hidden",
        userSelect: "none",
        width: "100%",
        boxSizing: "border-box",
        flexShrink: 0,
      }}
    >
      <div style={{ fontSize: 10, color: s.text, fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
        {ticket.titolo}
      </div>
      <div style={{ fontSize: 9, color: s.text, opacity: 0.7 }}>{ticket.tipo} · {dur}h</div>
    </div>
  );
}

// ─── UnscheduledItem ──────────────────────────────────────────────────────────

function UnscheduledItem({ ticket, onClick }: { ticket: TicketData; onClick: () => void }) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: `g-t-${ticket.id}`,
    data: { ticket },
  });
  const s = tipoStyle(ticket.tipo);
  const prioColor = PRIO_COLORS[ticket.priorita] ?? "#6b7280";

  return (
    <div
      ref={setNodeRef}
      {...listeners}
      {...attributes}
      onClick={(e) => { e.stopPropagation(); onClick(); }}
      style={{
        background: "var(--bg-elevated)",
        border: "1px solid var(--border-strong)",
        borderLeft: `3px solid ${s.border}`,
        borderRadius: 4,
        padding: "8px 10px",
        marginBottom: 6,
        cursor: isDragging ? "grabbing" : "grab",
        opacity: isDragging ? 0.35 : 1,
        userSelect: "none",
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 3 }}>
        <span style={{ fontSize: 9, color: s.text, letterSpacing: "0.1em", background: `${s.border}20`, padding: "1px 5px", borderRadius: 2 }}>
          {ticket.tipo}
        </span>
        <span style={{ fontSize: 9, color: prioColor }}>● {ticket.priorita}</span>
      </div>
      <div style={{ fontSize: 12, color: "var(--text-primary)", fontWeight: 600, lineHeight: 1.3, marginBottom: 3 }}>
        {ticket.titolo}
      </div>
      <div style={{ fontSize: 10, color: "var(--text-muted)" }}>
        {ticket.durata_stimata_ore || 1}h · {ticket.asset_name || "—"}
      </div>
    </div>
  );
}

// ─── TecnicoLabel ─────────────────────────────────────────────────────────────

function TecnicoLabel({ tecnico }: { tecnico: TecnicoData }) {
  return (
    <div
      style={{
        width: LABEL_W,
        minWidth: LABEL_W,
        padding: "0 14px",
        display: "flex",
        alignItems: "center",
        borderRight: "1px solid var(--border)",
        background: "var(--bg-surface)",
        position: "sticky",
        left: 0,
        zIndex: 3,
      }}
    >
      <div>
        <div style={{ fontSize: 12, fontWeight: 600, color: "var(--text-primary)", lineHeight: 1.3 }}>
          {tecnico.nome} {tecnico.cognome ?? ""}
        </div>
        <div style={{ fontSize: 10, color: "var(--text-muted)", marginTop: 1 }}>
          {(tecnico as any).skill ?? tecnico.competenze ?? ""}
        </div>
      </div>
    </div>
  );
}

// ─── DayRow ───────────────────────────────────────────────────────────────────

function DayRow({
  tecnico,
  tickets,
  day,
  onTicketClick,
}: {
  tecnico: TecnicoData;
  tickets: TicketData[];
  day: Date;
  onTicketClick: (t: TicketData) => void;
}) {
  const dateStr = format(day, "yyyy-MM-dd");
  const { setNodeRef, isOver } = useDroppable({
    id: `g-row-${tecnico.id}-${dateStr}`,
    data: { tecnico_id: tecnico.id, date: dateStr },
  });

  const dayTickets = tickets.filter((t) => {
    const p = parseStart(t);
    return p && p.date === dateStr;
  });

  const timelineW = (DAY_END_H - DAY_START_H) * HOUR_W;

  return (
    <div style={{ display: "flex", height: ROW_H, borderBottom: "1px solid var(--border)" }}>
      <TecnicoLabel tecnico={tecnico} />
      <div
        ref={setNodeRef}
        style={{
          position: "relative",
          width: timelineW,
          minWidth: timelineW,
          height: "100%",
          background: isOver
            ? "rgba(59,130,246,0.07)"
            : `repeating-linear-gradient(90deg, transparent 0, transparent ${HOUR_W - 1}px, var(--border-subtle) ${HOUR_W - 1}px, var(--border-subtle) ${HOUR_W}px)`,
          transition: "background 0.12s",
        }}
      >
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

function DayCell({
  tecnico_id,
  date,
  tickets,
  onTicketClick,
  cellW,
}: {
  tecnico_id: number;
  date: string;
  tickets: TicketData[];
  onTicketClick: (t: TicketData) => void;
  cellW: number;
}) {
  const { setNodeRef, isOver } = useDroppable({
    id: `g-cell-${tecnico_id}-${date}`,
    data: { tecnico_id, date },
  });

  return (
    <div
      ref={setNodeRef}
      style={{
        width: cellW,
        minWidth: cellW,
        minHeight: ROW_H,
        padding: "4px 3px",
        borderRight: "1px solid var(--border)",
        background: isOver ? "rgba(59,130,246,0.08)" : "transparent",
        transition: "background 0.12s",
        overflow: "hidden",
        display: "flex",
        flexDirection: "column",
        gap: 1,
      }}
    >
      {tickets.map((t) => (
        <TicketBlock key={t.id} ticket={t} view="week" onClick={() => onTicketClick(t)} />
      ))}
    </div>
  );
}

// ─── MultiDayRow ──────────────────────────────────────────────────────────────

function MultiDayRow({
  tecnico,
  tickets,
  days,
  view,
  onTicketClick,
}: {
  tecnico: TecnicoData;
  tickets: TicketData[];
  days: Date[];
  view: ViewMode;
  onTicketClick: (t: TicketData) => void;
}) {
  const cellW = view === "week" ? DAY_W : Math.round(DAY_W * 0.75);

  return (
    <div style={{ display: "flex", minHeight: ROW_H, borderBottom: "1px solid var(--border)" }}>
      <TecnicoLabel tecnico={tecnico} />
      {days.map((day) => {
        const dateStr = format(day, "yyyy-MM-dd");
        return (
          <DayCell
            key={dateStr}
            tecnico_id={tecnico.id}
            date={dateStr}
            tickets={tickets.filter((t) => {
              const p = parseStart(t);
              return p && p.date === dateStr;
            })}
            onTicketClick={onTicketClick}
            cellW={cellW}
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
    [
      "Inizio pianificato",
      ticket.planned_start
        ? format(parseISO(ticket.planned_start), "dd/MM/yyyy HH:mm", { locale: it })
        : "—",
    ],
    [
      "Fine pianificata",
      ticket.planned_finish
        ? format(parseISO(ticket.planned_finish), "dd/MM/yyyy HH:mm", { locale: it })
        : "—",
    ],
  ] as const;

  return (
    <div
      style={{ position: "fixed", inset: 0, zIndex: 9998, display: "flex" }}
      onClick={onClose}
    >
      <div style={{ flex: 1 }} />
      <div
        style={{
          width: 360,
          height: "100%",
          background: "var(--bg-surface)",
          borderLeft: "1px solid var(--border-strong)",
          padding: 24,
          overflowY: "auto",
          display: "flex",
          flexDirection: "column",
          gap: 16,
          fontFamily: "'IBM Plex Mono', monospace",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
          <span
            style={{
              fontSize: 9,
              letterSpacing: "0.15em",
              color: s.text,
              background: `${s.border}22`,
              border: `1px solid ${s.border}`,
              padding: "3px 8px",
            }}
          >
            {ticket.tipo} · #{ticket.id}
          </span>
          <button
            onClick={onClose}
            style={{ background: "transparent", border: "none", color: "var(--text-muted)", cursor: "pointer", fontSize: 20, lineHeight: 1, padding: 0 }}
          >
            ×
          </button>
        </div>

        <div>
          <div style={{ fontSize: 15, fontWeight: 700, color: "var(--text-primary)", lineHeight: 1.4 }}>
            {ticket.titolo}
          </div>
          {ticket.descrizione && (
            <div style={{ fontSize: 12, color: "var(--text-secondary)", marginTop: 8, lineHeight: 1.6 }}>
              {ticket.descrizione}
            </div>
          )}
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 0 }}>
          {rows.map(([label, value]) => (
            <div
              key={label}
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                fontSize: 12,
                padding: "8px 0",
                borderBottom: "1px solid var(--border)",
              }}
            >
              <span style={{ color: "var(--text-muted)" }}>{label}</span>
              <span
                style={{
                  color:
                    label === "Priorità"
                      ? prioColor
                      : label === "Stato"
                      ? "var(--text-secondary)"
                      : "var(--text-primary)",
                  fontWeight: 500,
                }}
              >
                {value}
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ─── GanttRisorse (componente principale, self-contained) ─────────────────────

export default function GanttRisorse() {
  const [view, setView] = useState<ViewMode>("week");
  const [currentDate, setCurrentDate] = useState(() => new Date());
  const [tecnici, setTecnici] = useState<TecnicoData[]>([]);
  const [scheduledTickets, setScheduledTickets] = useState<TicketData[]>([]);
  const [unscheduledTickets, setUnscheduledTickets] = useState<TicketData[]>([]);
  const [loading, setLoading] = useState(true);
  const [draggingTicket, setDraggingTicket] = useState<TicketData | null>(null);
  const [detailTicket, setDetailTicket] = useState<TicketData | null>(null);
  const [filterTipo, setFilterTipo] = useState("");

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } })
  );

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const [tecniciRes, pianRes, inCorsoRes, apertiRes] = await Promise.all([
        apiGet<TecnicoData[]>("/tecnici"),
        apiGet<{ items: TicketData[] }>("/tickets?limit=200&stato=Pianificato"),
        apiGet<{ items: TicketData[] }>("/tickets?limit=100&stato=In%20corso"),
        apiGet<{ items: TicketData[] }>("/tickets?limit=200&stato=Aperto"),
      ]);

      setTecnici(Array.isArray(tecniciRes) ? tecniciRes : []);

      const scheduled = [
        ...pianRes.items.filter((t) => t.planned_start != null),
        ...inCorsoRes.items.filter((t) => t.planned_start != null),
      ];
      setScheduledTickets(scheduled);
      setUnscheduledTickets(apertiRes.items.filter((t) => t.planned_start == null));
    } catch (e: unknown) {
      notify.error(e instanceof Error ? e.message : "Errore caricamento dati");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadData(); }, [loadData]);

  const days = getDays(currentDate, view);

  function navigate(dir: 1 | -1) {
    const delta = view === "day" ? 1 : view === "week" ? 7 : 14;
    setCurrentDate((d) => (dir === 1 ? addDays(d, delta) : subDays(d, delta)));
  }

  function handleDragStart(event: DragStartEvent) {
    const ticket = (event.active.data.current as { ticket?: TicketData })?.ticket;
    if (ticket) setDraggingTicket(ticket);
  }

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

  const filteredUnscheduled = filterTipo
    ? unscheduledTickets.filter((t) => t.tipo === filterTipo)
    : unscheduledTickets;

  const tipoCounts = { BD: 0, PM: 0, CM: 0 };
  unscheduledTickets.forEach((t) => {
    if (t.tipo in tipoCounts) tipoCounts[t.tipo as keyof typeof tipoCounts]++;
  });

  const dateLabel =
    view === "day"
      ? format(days[0]!, "EEEE d MMMM yyyy", { locale: it })
      : `${format(days[0]!, "d MMM", { locale: it })} – ${format(days[days.length - 1]!, "d MMM yyyy", { locale: it })}`;

  const cellW = view === "week" ? DAY_W : Math.round(DAY_W * 0.75);
  const timelineMinW =
    LABEL_W + (view === "day" ? (DAY_END_H - DAY_START_H) * HOUR_W : days.length * cellW);

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        height: "100%",
        background: "var(--bg-base)",
        fontFamily: "'IBM Plex Mono', monospace",
        overflow: "hidden",
      }}
    >
      {/* Toolbar */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 12,
          padding: "8px 16px",
          borderBottom: "1px solid var(--border)",
          background: "var(--bg-surface)",
          flexShrink: 0,
          flexWrap: "wrap",
        }}
      >
        <div
          style={{
            display: "flex",
            border: "1px solid var(--border-strong)",
            borderRadius: 4,
            overflow: "hidden",
          }}
        >
          {(["day", "week", "2week"] as ViewMode[]).map((v, i, arr) => (
            <button
              key={v}
              onClick={() => setView(v)}
              style={{
                padding: "5px 10px",
                fontSize: 10,
                letterSpacing: "0.1em",
                background: view === v ? "#3b82f6" : "transparent",
                color: view === v ? "#fff" : "var(--text-secondary)",
                border: "none",
                borderRight: i < arr.length - 1 ? "1px solid var(--border-strong)" : "none",
                cursor: "pointer",
                fontFamily: "inherit",
              }}
            >
              {v === "day" ? "GIORNO" : v === "week" ? "SETTIMANA" : "2 SETT."}
            </button>
          ))}
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <button
            onClick={() => navigate(-1)}
            style={{ background: "transparent", border: "1px solid var(--border-strong)", color: "var(--text-secondary)", width: 28, height: 28, cursor: "pointer", fontSize: 16, lineHeight: 1 }}
          >
            ‹
          </button>
          <button
            onClick={() => setCurrentDate(new Date())}
            style={{ background: "transparent", border: "1px solid var(--border-strong)", color: "var(--text-secondary)", padding: "4px 10px", fontSize: 10, letterSpacing: "0.1em", cursor: "pointer", fontFamily: "inherit" }}
          >
            OGGI
          </button>
          <button
            onClick={() => navigate(1)}
            style={{ background: "transparent", border: "1px solid var(--border-strong)", color: "var(--text-secondary)", width: 28, height: 28, cursor: "pointer", fontSize: 16, lineHeight: 1 }}
          >
            ›
          </button>
        </div>

        <span style={{ fontSize: 13, color: "var(--text-primary)", fontWeight: 600, textTransform: "capitalize" }}>
          {dateLabel}
        </span>

        <div style={{ flex: 1 }} />

        <span style={{ fontSize: 11, color: "var(--text-muted)" }}>
          {tecnici.length} tecnici · {scheduledTickets.length} pianificati
        </span>

        <button
          onClick={loadData}
          disabled={loading}
          title="Aggiorna"
          style={{ background: "transparent", border: "1px solid var(--border-strong)", color: "var(--text-secondary)", width: 28, height: 28, cursor: "pointer", fontSize: 14, opacity: loading ? 0.5 : 1 }}
        >
          ↻
        </button>
      </div>

      {/* Main content */}
      <DndContext sensors={sensors} onDragStart={handleDragStart} onDragEnd={handleDragEnd}>
        <div style={{ display: "flex", flex: 1, overflow: "hidden" }}>

          {/* Sidebar: ticket non pianificati */}
          <div
            style={{
              width: 256,
              minWidth: 256,
              borderRight: "1px solid var(--border)",
              background: "var(--bg-surface)",
              display: "flex",
              flexDirection: "column",
              overflow: "hidden",
            }}
          >
            <div style={{ padding: "12px 12px 8px", borderBottom: "1px solid var(--border)", flexShrink: 0 }}>
              <div style={{ fontSize: 10, letterSpacing: "0.15em", color: "var(--text-muted)", marginBottom: 8 }}>
                NON PIANIFICATI
              </div>

              <div style={{ display: "flex", gap: 5, flexWrap: "wrap", marginBottom: 8 }}>
                {(["", "BD", "PM", "CM"] as const).map((tipo) => {
                  const color =
                    tipo === "BD" ? "#ef4444" : tipo === "PM" ? "#22c55e" : tipo === "CM" ? "#f59e0b" : "var(--text-muted)";
                  const cnt = tipo ? tipoCounts[tipo] : unscheduledTickets.length;
                  return (
                    <button
                      key={tipo || "all"}
                      onClick={() => setFilterTipo(tipo)}
                      style={{
                        fontSize: 9,
                        padding: "2px 7px",
                        background: filterTipo === tipo ? `${color}22` : "transparent",
                        border: `1px solid ${color}`,
                        color,
                        borderRadius: 3,
                        cursor: "pointer",
                        fontFamily: "inherit",
                      }}
                    >
                      {tipo || "TUTTI"} ({cnt})
                    </button>
                  );
                })}
              </div>

              <div style={{ fontSize: 11, color: "var(--text-disabled)" }}>
                Trascina sulla timeline →
              </div>
            </div>

            <div style={{ flex: 1, overflowY: "auto", padding: 10 }}>
              {loading ? (
                <div style={{ color: "var(--text-disabled)", fontSize: 12, textAlign: "center", paddingTop: 24 }}>
                  Caricamento...
                </div>
              ) : filteredUnscheduled.length === 0 ? (
                <div style={{ color: "var(--text-disabled)", fontSize: 12, textAlign: "center", paddingTop: 24 }}>
                  Nessun ticket da pianificare
                </div>
              ) : (
                filteredUnscheduled.map((t) => (
                  <UnscheduledItem key={t.id} ticket={t} onClick={() => setDetailTicket(t)} />
                ))
              )}
            </div>
          </div>

          {/* Timeline */}
          <div style={{ flex: 1, overflow: "auto", position: "relative" }}>
            {loading ? (
              <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100%", color: "var(--text-muted)", fontSize: 13 }}>
                Caricamento dati...
              </div>
            ) : (
              <div style={{ minWidth: timelineMinW }}>

                {/* Column header */}
                <div
                  style={{
                    display: "flex",
                    height: 40,
                    borderBottom: "1px solid var(--border-strong)",
                    background: "var(--bg-surface)",
                    position: "sticky",
                    top: 0,
                    zIndex: 10,
                  }}
                >
                  <div
                    style={{
                      width: LABEL_W,
                      minWidth: LABEL_W,
                      display: "flex",
                      alignItems: "center",
                      padding: "0 14px",
                      borderRight: "1px solid var(--border)",
                      fontSize: 10,
                      color: "var(--text-muted)",
                      letterSpacing: "0.1em",
                      position: "sticky",
                      left: 0,
                      background: "var(--bg-surface)",
                      zIndex: 11,
                    }}
                  >
                    TECNICO
                  </div>

                  {view === "day"
                    ? Array.from({ length: DAY_END_H - DAY_START_H }, (_, i) => (
                        <div
                          key={i}
                          style={{
                            width: HOUR_W,
                            minWidth: HOUR_W,
                            display: "flex",
                            alignItems: "center",
                            paddingLeft: 6,
                            borderRight: "1px solid var(--border)",
                            fontSize: 10,
                            color: "var(--text-muted)",
                          }}
                        >
                          {String(DAY_START_H + i).padStart(2, "0")}:00
                        </div>
                      ))
                    : days.map((day) => {
                        const today = isToday(day);
                        return (
                          <div
                            key={day.toISOString()}
                            style={{
                              width: cellW,
                              minWidth: cellW,
                              display: "flex",
                              flexDirection: "column",
                              alignItems: "center",
                              justifyContent: "center",
                              borderRight: "1px solid var(--border)",
                              background: today ? "rgba(59,130,246,0.07)" : "transparent",
                            }}
                          >
                            <div style={{ fontSize: 9, color: today ? "#60a5fa" : "var(--text-muted)", letterSpacing: "0.1em" }}>
                              {format(day, "EEE", { locale: it }).toUpperCase()}
                            </div>
                            <div style={{ fontSize: 13, fontWeight: today ? 700 : 500, color: today ? "#60a5fa" : "var(--text-primary)" }}>
                              {format(day, "d")}
                            </div>
                          </div>
                        );
                      })}
                </div>

                {/* Righe tecnici */}
                {tecnici.length === 0 ? (
                  <div style={{ padding: 40, textAlign: "center", color: "var(--text-muted)", fontSize: 13 }}>
                    Nessun tecnico attivo trovato
                  </div>
                ) : (
                  tecnici.map((tecnico) => {
                    const tickets = scheduledTickets.filter((t) => t.tecnico_id === tecnico.id);
                    if (view === "day") {
                      return (
                        <DayRow
                          key={tecnico.id}
                          tecnico={tecnico}
                          tickets={tickets}
                          day={days[0]!}
                          onTicketClick={setDetailTicket}
                        />
                      );
                    }
                    return (
                      <MultiDayRow
                        key={tecnico.id}
                        tecnico={tecnico}
                        tickets={tickets}
                        days={days}
                        view={view}
                        onTicketClick={setDetailTicket}
                      />
                    );
                  })
                )}
              </div>
            )}
          </div>
        </div>

        {/* Drag overlay */}
        <DragOverlay>
          {draggingTicket && (() => {
            const s = tipoStyle(draggingTicket.tipo);
            return (
              <div
                style={{
                  background: s.bg,
                  border: `1px solid ${s.border}`,
                  borderLeft: `3px solid ${s.border}`,
                  borderRadius: 3,
                  padding: "8px 12px",
                  color: s.text,
                  fontSize: 12,
                  fontWeight: 600,
                  boxShadow: "0 10px 30px rgba(0,0,0,0.6)",
                  opacity: 0.92,
                  pointerEvents: "none",
                  userSelect: "none",
                  fontFamily: "'IBM Plex Mono', monospace",
                  minWidth: 160,
                }}
              >
                <div style={{ fontSize: 10, opacity: 0.7, marginBottom: 3 }}>
                  {draggingTicket.tipo} · #{draggingTicket.id}
                </div>
                <div>{draggingTicket.titolo}</div>
                <div style={{ fontSize: 10, opacity: 0.7, marginTop: 3 }}>
                  {draggingTicket.durata_stimata_ore || 1}h
                </div>
              </div>
            );
          })()}
        </DragOverlay>
      </DndContext>

      {/* Detail drawer */}
      {detailTicket && (
        <TicketDetailDrawer ticket={detailTicket} onClose={() => setDetailTicket(null)} />
      )}
    </div>
  );
}
