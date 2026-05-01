"use client";

import { useState } from "react";
import { useDroppable, useDraggable } from "@dnd-kit/core";
import type { PlannedWO, TicketData, TecnicoData } from "../types";
import { tipoStyle, GIORNI_SETTIMANA, MESI } from "../types";

// ── Costanti layout ───────────────────────────────────────────────────────────

const HOUR_HEIGHT = 64;   // px per ora
const DAY_START = 8;      // 08:00
const DAY_END = 17;       // 17:00
const DAY_HOURS = DAY_END - DAY_START;   // 9 ore
const TOTAL_H = DAY_HOURS * HOUR_HEIGHT; // altezza totale griglia
const HEADER_H = 52;                     // header con i giorni
const HOUR_LABEL_W = 52;                 // larghezza colonna etichette ore
const SLOTS_PER_DAY = DAY_HOURS * 2;     // slot 30 min per giorno = 18

// Etichette ore
const HOUR_LABELS = Array.from({ length: DAY_HOURS + 1 }, (_, i) =>
  `${String(DAY_START + i).padStart(2, "0")}:00`
);

// ── Utilities date ────────────────────────────────────────────────────────────

function startOfWeek(d: Date): Date {
  const day = d.getDay();
  const diff = day === 0 ? -6 : 1 - day; // aggiusta a lunedì
  const mon = new Date(d);
  mon.setDate(d.getDate() + diff);
  mon.setHours(0, 0, 0, 0);
  return mon;
}

function getWeekDays(weekStart: Date): Date[] {
  return Array.from({ length: 7 }, (_, i) => {
    const d = new Date(weekStart);
    d.setDate(d.getDate() + i);
    return d;
  });
}

function dateToStr(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function formatDayHeader(d: Date): { dow: string; day: string; mon: string } {
  return {
    dow: GIORNI_SETTIMANA[d.getDay()],
    day: String(d.getDate()).padStart(2, "0"),
    mon: MESI[d.getMonth()].slice(0, 3),
  };
}

function timeStrToHours(t: string | undefined | null): number {
  if (!t) return DAY_START;
  const [hStr, mStr] = t.split(":");
  const h = parseInt(hStr ?? "8", 10);
  const m = parseInt(mStr ?? "0", 10);
  return (isNaN(h) ? DAY_START : h) + (isNaN(m) ? 0 : m) / 60;
}

function hoursToTopPx(h: number): number {
  return Math.max(0, (h - DAY_START) * HOUR_HEIGHT);
}

function hoursToHeightPx(h: number): number {
  return Math.max(HOUR_HEIGHT / 2, h * HOUR_HEIGHT);
}

// ── Lane calculator (evita sovrapposizioni nell'UI) ───────────────────────────

interface LaneInfo { lane: number; totalLanes: number }

function computeLanes(dayWOs: PlannedWO[]): Map<number, LaneInfo> {
  const sorted = [...dayWOs].sort(
    (a, b) => timeStrToHours(a.planned_start_time) - timeStrToHours(b.planned_start_time)
  );
  const laneEndTime: number[] = [];
  const assignments: number[] = [];

  for (const wo of sorted) {
    const startH = timeStrToHours(wo.planned_start_time);
    const endH = timeStrToHours(wo.planned_end_time) || startH + 1;
    let lane = laneEndTime.findIndex(end => startH >= end);
    if (lane === -1) lane = laneEndTime.length;
    laneEndTime[lane] = endH;
    assignments.push(lane);
  }

  const total = laneEndTime.length || 1;
  return new Map(sorted.map((wo, i) => [wo.wo_id, { lane: assignments[i], totalLanes: total }]));
}

// ── Props ─────────────────────────────────────────────────────────────────────

interface Props {
  wos: PlannedWO[];
  ticketMap: Map<number, TicketData>;
  tecnicoMap: Map<number, TecnicoData>;
  tecnici: TecnicoData[];
  weekStart: Date;
  onWeekChange: (d: Date) => void;
  onReassignTecnico: (woId: number, newTecnicoId: number) => void;
}

// ── Droppable: cella slot 30-min in un giorno ─────────────────────────────────

function DroppableSlot({ id, top }: { id: string; top: number }) {
  const { setNodeRef, isOver } = useDroppable({ id });
  const slotH = HOUR_HEIGHT / 2;
  return (
    <div
      ref={setNodeRef}
      style={{
        position: "absolute",
        left: 0, right: 0,
        top, height: slotH,
        zIndex: 1,
        background: isOver ? "rgba(59,130,246,0.25)" : "transparent",
        outline: isOver ? "2px dashed #60a5fa" : "none",
        borderRadius: 4,
        pointerEvents: "auto",
        transition: "background 60ms, outline 60ms",
        boxShadow: isOver ? "inset 0 0 0 1px rgba(96,165,250,0.5)" : "none",
      }}
    >
      {isOver && (
        <div style={{
          position: "absolute",
          left: "50%",
          top: "50%",
          transform: "translate(-50%, -50%)",
          fontSize: 10,
          color: "#60a5fa",
          fontWeight: 700,
          pointerEvents: "none",
          whiteSpace: "nowrap",
          letterSpacing: "0.05em",
        }}>
          ➕ Rilascia qui
        </div>
      )}
    </div>
  );
}

// ── Draggable: blocco ticket nel calendario ───────────────────────────────────

function WOBlock({
  wo, ticket, tecnico, top, height, left, width, onDoubleClick,
}: {
  wo: PlannedWO;
  ticket: TicketData | undefined;
  tecnico: TecnicoData | undefined;
  top: number;
  height: number;
  left: string;
  width: string;
  onDoubleClick: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: `wo||${wo.wo_id}`,
    data: { woId: wo.wo_id },
  });

  const tipo = ticket?.tipo ?? "CM";
  const stile = tipoStyle(tipo, wo.is_continuation);

  return (
    <div
      ref={setNodeRef}
      {...listeners}
      {...attributes}
      onDoubleClick={e => { e.stopPropagation(); onDoubleClick(); }}
      style={{
        position: "absolute",
        top: top + 2,
        height: Math.max(height - 4, 20),
        left,
        width,
        boxSizing: "border-box",
        background: stile.bg,
        border: `1px ${stile.borderStyle ?? "solid"} ${stile.border}`,
        borderRadius: 5,
        padding: "4px 6px",
        fontSize: 11,
        fontWeight: 600,
        color: stile.text,
        overflow: "hidden",
        cursor: isDragging ? "grabbing" : "grab",
        opacity: isDragging ? 0.7 : 1,
        zIndex: isDragging ? 50 : 3,
        userSelect: "none",
        transform: transform ? `translate(${transform.x}px,${transform.y}px)` : undefined,
        boxShadow: isDragging
          ? "0 8px 32px rgba(59,130,246,0.5), 0 2px 8px rgba(0,0,0,0.5)"
          : "0 2px 8px rgba(0,0,0,0.35)",
        outline: isDragging ? "2px solid rgba(96,165,250,0.7)" : "none",
        transition: isDragging ? "none" : "filter 100ms",
      }}
      title="Trascina per spostare · Doppio clic per riassegnare tecnico"
    >
      <div style={{ lineHeight: 1.3, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
        #{wo.wo_id} {ticket?.titolo ?? "—"}
      </div>
      {height >= 36 && (
        <div style={{ fontSize: 10, opacity: 0.72, marginTop: 2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {tecnico ? `${tecnico.nome}${tecnico.cognome ? " " + tecnico.cognome : ""}` : "—"}
        </div>
      )}
      {height >= 56 && wo.planned_start_time && (
        <div style={{ fontSize: 9, opacity: 0.55, marginTop: 1 }}>
          {wo.planned_start_time}–{wo.planned_end_time}
        </div>
      )}
    </div>
  );
}

// ── Modale riassegnazione tecnico ─────────────────────────────────────────────

function ReassignModal({
  woId, tecnici, currentTecnicoId, onSave, onClose,
}: {
  woId: number;
  tecnici: TecnicoData[];
  currentTecnicoId: number | undefined;
  onSave: (newTecnicoId: number) => void;
  onClose: () => void;
}) {
  const [selected, setSelected] = useState(currentTecnicoId ?? tecnici[0]?.id ?? 0);

  return (
    <div
      onClick={onClose}
      style={{
        position: "fixed", inset: 0,
        background: "rgba(0,0,0,0.7)",
        display: "flex", alignItems: "center", justifyContent: "center",
        zIndex: 9999,
      }}
    >
      <div onClick={e => e.stopPropagation()} style={{
        background: "var(--surface-2)",
        border: "1px solid var(--border-strong)",
        borderRadius: 12,
        padding: 24,
        width: 320,
        boxShadow: "0 24px 60px rgba(0,0,0,0.6)",
      }}>
        <div style={{ fontSize: 14, fontWeight: 700, color: "#f9fafb", marginBottom: 4 }}>
          Riassegna Tecnico
        </div>
        <div style={{ fontSize: 12, color: "#6b7280", marginBottom: 16 }}>
          Ticket #{woId} · Doppio clic nel piano per modificare
        </div>

        <label style={{ fontSize: 11, color: "#9ca3af", display: "block", marginBottom: 4 }}>
          Nuovo tecnico
        </label>
        <select
          value={selected}
          onChange={e => setSelected(Number(e.target.value))}
          style={{
            width: "100%", background: "var(--border-strong)", border: "1px solid #374151",
            color: "#f9fafb", borderRadius: 6, padding: "8px 10px",
            fontSize: 13, marginBottom: 16,
          }}
        >
          {tecnici.map(t => (
            <option key={t.id} value={t.id}>
              {t.nome} {t.cognome ?? ""}
            </option>
          ))}
        </select>

        <div style={{ display: "flex", gap: 8 }}>
          <button onClick={onClose} style={{
            flex: 1, background: "var(--border-strong)", border: "1px solid #374151",
            color: "#9ca3af", borderRadius: 6, padding: "9px 0",
            cursor: "pointer", fontSize: 13,
          }}>Annulla</button>
          <button
            onClick={() => { onSave(selected); onClose(); }}
            style={{
              flex: 1, background: "#065f46", border: "1px solid #059669",
              color: "#86efac", borderRadius: 6, padding: "9px 0",
              cursor: "pointer", fontSize: 13, fontWeight: 600,
            }}
          >Salva</button>
        </div>
      </div>
    </div>
  );
}

// ── Componente principale ─────────────────────────────────────────────────────

export default function KanbanSettimanale({
  wos, ticketMap, tecnicoMap, tecnici, weekStart, onWeekChange, onReassignTecnico,
}: Props) {
  const [reassigning, setReassigning] = useState<{ woId: number; tecnicoId: number | undefined } | null>(null);

  const weekDays = getWeekDays(weekStart);
  const weekDayStrs = weekDays.map(dateToStr);
  const todayStr = dateToStr(new Date());

  // Raggruppa WO per giorno (solo quelli nella settimana visualizzata)
  const wosByDate = new Map<string, PlannedWO[]>();
  for (const ds of weekDayStrs) wosByDate.set(ds, []);
  for (const wo of wos) {
    if (weekDayStrs.includes(wo.planned_date)) {
      wosByDate.get(wo.planned_date)!.push(wo);
    }
  }

  // Intestazione settimana
  const firstDay = weekDays[0];
  const lastDay = weekDays[6];
  const periodLabel = `${String(firstDay.getDate()).padStart(2,"0")} ${MESI[firstDay.getMonth()].slice(0,3)} — ${String(lastDay.getDate()).padStart(2,"0")} ${MESI[lastDay.getMonth()].slice(0,3)} ${lastDay.getFullYear()}`;

  return (
    <>
      {/* Navigazione settimana */}
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 12, justifyContent: "center" }}>
        <button
          onClick={() => {
            const prev = new Date(weekStart);
            prev.setDate(prev.getDate() - 7);
            onWeekChange(prev);
          }}
          style={{ background: "var(--border-strong)", border: "1px solid #374151", color: "#9ca3af", borderRadius: 6, padding: "6px 14px", cursor: "pointer", fontSize: 14 }}
        >‹</button>

        <span style={{ fontSize: 13, fontWeight: 600, color: "#e2e8f0", minWidth: 200, textAlign: "center" }}>
          {periodLabel}
        </span>

        <button
          onClick={() => {
            const next = new Date(weekStart);
            next.setDate(next.getDate() + 7);
            onWeekChange(next);
          }}
          style={{ background: "var(--border-strong)", border: "1px solid #374151", color: "#9ca3af", borderRadius: 6, padding: "6px 14px", cursor: "pointer", fontSize: 14 }}
        >›</button>

        <button
          onClick={() => onWeekChange(startOfWeek(new Date()))}
          style={{ background: "transparent", border: "1px solid #3b82f655", color: "#3b82f6", borderRadius: 6, padding: "6px 10px", cursor: "pointer", fontSize: 11 }}
        >Questa settimana</button>
      </div>

      {/* Hint DnD */}
      <div style={{ fontSize: 10, color: "#374151", textAlign: "center", marginBottom: 8 }}>
        Trascina i blocchi per spostare · Doppio clic per riassegnare tecnico
      </div>

      {/* Calendario */}
      <div style={{ overflowX: "auto", borderRadius: 8, border: "1px solid var(--border-strong)" }}>
        <div style={{
          display: "grid",
          gridTemplateColumns: `${HOUR_LABEL_W}px repeat(7, minmax(110px, 1fr))`,
          gridTemplateRows: `${HEADER_H}px ${TOTAL_H}px`,
          minWidth: 900,
          background: "#0f172a",
        }}>

          {/* ── Cella angolo top-left ─────────────────────────────── */}
          <div style={{
            gridRow: 1, gridColumn: 1,
            background: "#1e293b",
            borderRight: "1px solid var(--border-strong)",
            borderBottom: "1px solid #334155",
          }} />

          {/* ── Intestazioni giorni ─────────────────────────────── */}
          {weekDays.map((day, i) => {
            const { dow, day: dayNum, mon } = formatDayHeader(day);
            const isToday = dateToStr(day) === todayStr;
            const isWeekend = day.getDay() === 0 || day.getDay() === 6;
            return (
              <div key={i} style={{
                gridRow: 1,
                gridColumn: i + 2,
                background: isWeekend ? "#162032" : "#1e293b",
                borderRight: i < 6 ? "1px solid var(--border-strong)" : "none",
                borderBottom: "1px solid #334155",
                borderTop: isToday ? "3px solid #3b82f6" : "3px solid transparent",
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                justifyContent: "center",
                gap: 2,
              }}>
                <div style={{ fontSize: 10, color: isToday ? "#3b82f6" : isWeekend ? "#94a3b8" : "#64748b", fontWeight: 600, letterSpacing: "0.08em" }}>
                  {dow.toUpperCase()}
                </div>
                <div style={{ fontSize: 16, fontWeight: 700, color: isToday ? "#60a5fa" : isWeekend ? "#cbd5e1" : "#e2e8f0" }}>
                  {dayNum}
                </div>
                <div style={{ fontSize: 10, color: isWeekend ? "#64748b" : "#475569" }}>{mon}</div>
                {isWeekend && (
                  <div style={{ fontSize: 9, color: "#475569", marginTop: 1 }}>weekend</div>
                )}
              </div>
            );
          })}

          {/* ── Colonna etichette ore ────────────────────────────── */}
          <div style={{
            gridRow: 2, gridColumn: 1,
            position: "relative",
            background: "#0c1220",
            borderRight: "1px solid #1e293b",
            height: TOTAL_H,
          }}>
            {HOUR_LABELS.map((label, i) => (
              <div key={i} style={{
                position: "absolute",
                top: i * HOUR_HEIGHT - 8,
                right: 6,
                fontSize: 10,
                color: "#334155",
                fontFamily: "monospace",
                fontWeight: 500,
                whiteSpace: "nowrap",
              }}>
                {label}
              </div>
            ))}
          </div>

          {/* ── Colonne giornate ────────────────────────────────── */}
          {weekDays.map((day, colIdx) => {
            const dateStr = dateToStr(day);
            const dayWOs = wosByDate.get(dateStr) ?? [];
            const laneMap = computeLanes(dayWOs);
            const isToday = dateStr === todayStr;
            const isWeekend = day.getDay() === 0 || day.getDay() === 6;

            // Ora corrente (linea rossa)
            const now = new Date();
            const nowH = now.getHours() + now.getMinutes() / 60;
            const showNowLine = isToday && nowH >= DAY_START && nowH <= DAY_END;
            const nowTop = hoursToTopPx(nowH);

            return (
              <div
                key={colIdx}
                style={{
                  gridRow: 2,
                  gridColumn: colIdx + 2,
                  position: "relative",
                  height: TOTAL_H,
                  borderRight: colIdx < 6 ? "1px solid #1e293b" : "none",
                  background: isToday ? "#0f1a2a" : isWeekend ? "#0b1422" : "#0f172a",
                }}
              >
                {/* Linee orizzontali ore */}
                {HOUR_LABELS.map((_, i) => (
                  <div key={i} style={{
                    position: "absolute",
                    left: 0, right: 0,
                    top: i * HOUR_HEIGHT,
                    height: 1,
                    background: "#1e293b",
                    zIndex: 0,
                  }} />
                ))}
                {/* Linee mezzora */}
                {Array.from({ length: SLOTS_PER_DAY }, (_, i) =>
                  i % 2 !== 0 ? (
                    <div key={`h${i}`} style={{
                      position: "absolute",
                      left: 0, right: 0,
                      top: i * (HOUR_HEIGHT / 2),
                      height: 1,
                      background: "#141d2e",
                      zIndex: 0,
                    }} />
                  ) : null
                )}

                {/* Slot droppable 30-min */}
                {Array.from({ length: SLOTS_PER_DAY }, (_, si) => (
                  <DroppableSlot
                    key={si}
                    id={`slot||${dateStr}||${si}`}
                    top={si * (HOUR_HEIGHT / 2)}
                  />
                ))}

                {/* Blocchi WO */}
                {dayWOs.map(wo => {
                  const ticket = ticketMap.get(wo.wo_id);
                  const tecnico = tecnicoMap.get(wo.technician_id);
                  const startH = timeStrToHours(wo.planned_start_time);
                  const endH = timeStrToHours(wo.planned_end_time) ||
                    startH + (ticket?.durata_stimata_ore ?? wo.duration_hours ?? 1);
                  const top = hoursToTopPx(startH);
                  const height = hoursToHeightPx(endH - startH);
                  const laneInfo = laneMap.get(wo.wo_id) ?? { lane: 0, totalLanes: 1 };
                  const pct = 100 / laneInfo.totalLanes;

                  return (
                    <WOBlock
                      key={`${wo.wo_id}-${wo.planned_date}-${wo.planned_start_time}`}
                      wo={wo}
                      ticket={ticket}
                      tecnico={tecnico}
                      top={top}
                      height={height}
                      left={`${laneInfo.lane * pct + 0.5}%`}
                      width={`${pct - 1}%`}
                      onDoubleClick={() => setReassigning({ woId: wo.wo_id, tecnicoId: wo.technician_id })}
                    />
                  );
                })}

                {/* Linea ora corrente */}
                {showNowLine && (
                  <div style={{
                    position: "absolute",
                    left: 0, right: 0,
                    top: nowTop,
                    height: 2,
                    background: "#ef4444",
                    zIndex: 10,
                    pointerEvents: "none",
                    boxShadow: "0 0 6px #ef444488",
                  }}>
                    <div style={{
                      position: "absolute",
                      left: -4, top: -4,
                      width: 10, height: 10,
                      borderRadius: "50%",
                      background: "#ef4444",
                    }} />
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* Modale riassegnazione */}
      {reassigning && (
        <ReassignModal
          woId={reassigning.woId}
          tecnici={tecnici}
          currentTecnicoId={reassigning.tecnicoId}
          onSave={newTecnicoId => onReassignTecnico(reassigning.woId, newTecnicoId)}
          onClose={() => setReassigning(null)}
        />
      )}
    </>
  );
}
