"use client";

import { useState } from "react";
import { useDroppable } from "@dnd-kit/core";
import type { PlannedWO, TicketData, TecnicoData } from "../types";
import { tipoStyle, timeToCol } from "../types";

interface Props {
  wos: PlannedWO[];
  tecnici: TecnicoData[];
  ticketMap: Map<number, TicketData>;
  selectedDate: string;           // "YYYY-MM-DD"
  onDateChange: (d: string) => void;
  onTicketDrop?: (ticketId: number, tecnicoId: number) => void;  // DnD manuale
}

// Overlay droppable per riga tecnico — non interferisce con il CSS grid
function DroppableTecnicoRow({
  tecnicoId,
  top,
  height,
  left,
}: {
  tecnicoId: number;
  top: number;
  height: number;
  left: number;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: `tecnico-${tecnicoId}` });
  return (
    <div
      ref={setNodeRef}
      style={{
        position: "absolute",
        top,
        left,
        right: 0,
        height,
        zIndex: 1,
        background: isOver ? "rgba(59,130,246,0.12)" : "transparent",
        outline: isOver ? "2px dashed #3b82f6" : "none",
        outlineOffset: -2,
        borderRadius: 4,
        transition: "background 100ms",
        pointerEvents: "auto",
      }}
    />
  );
}

// 18 slot da 08:00 a 17:00 in incrementi di 30 minuti
const TIME_SLOTS = Array.from({ length: 18 }, (_, i) => {
  const totalMin = i * 30;
  const h = 8 + Math.floor(totalMin / 60);
  const m = totalMin % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
});

// Formato data "YYYY-MM-DD" → "Lun 07 Apr"
function formatDay(dateStr: string): string {
  const d = new Date(dateStr + "T00:00:00");
  const gg = ["Dom","Lun","Mar","Mer","Gio","Ven","Sab"][d.getDay()];
  const mm = ["Gen","Feb","Mar","Apr","Mag","Giu","Lug","Ago","Set","Ott","Nov","Dic"][d.getMonth()];
  return `${gg} ${String(d.getDate()).padStart(2,"0")} ${mm}`;
}

function prevDay(dateStr: string): string {
  const d = new Date(dateStr + "T00:00:00");
  d.setDate(d.getDate() - 1);
  return d.toISOString().slice(0, 10);
}
function nextDay(dateStr: string): string {
  const d = new Date(dateStr + "T00:00:00");
  d.setDate(d.getDate() + 1);
  return d.toISOString().slice(0, 10);
}

export default function GanttGiornaliero({ wos, tecnici, ticketMap, selectedDate, onDateChange, onTicketDrop }: Props) {
  const [tooltip, setTooltip] = useState<{ wo: PlannedWO; x: number; y: number } | null>(null);

  // Filtra WOs per il giorno selezionato
  const dayWOs = wos.filter(wo => wo.planned_date === selectedDate);

  // Tecnici che hanno WOs oggi; aggiungi almeno quelli assegnati
  const activeTecnicoIds = [...new Set(dayWOs.map(w => w.technician_id))];
  const displayTecnici = tecnici.filter(t => activeTecnicoIds.includes(t.id));

  // Linea ora corrente
  const now = new Date();
  const todayStr = now.toISOString().slice(0, 10);
  const isToday = selectedDate === todayStr;
  const nowMinutesFrom8 = (now.getHours() - 8) * 60 + now.getMinutes();
  const nowFrac = Math.max(0, Math.min(nowMinutesFrom8 / 540, 1)); // 540 min = 9 ore

  const LABEL_W = 160; // px, larghezza colonna tecnico
  const ROW_H = 52;
  const HEADER_H = 48;
  const nRows = Math.max(displayTecnici.length, 1);
  const totalH = HEADER_H + nRows * ROW_H;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      {/* Navigazione data */}
      <div style={{
        display: "flex",
        alignItems: "center",
        gap: 12,
        justifyContent: "center",
      }}>
        <button
          onClick={() => onDateChange(prevDay(selectedDate))}
          style={{
            background: "var(--border-strong)",
            border: "1px solid var(--border-default)",
            color: "var(--text-muted)",
            borderRadius: 6,
            padding: "6px 12px",
            cursor: "pointer",
            fontSize: 14,
          }}
        >
          ‹
        </button>
        <span style={{ fontSize: 15, fontWeight: 700, color: "#f9fafb", minWidth: 140, textAlign: "center" }}>
          {formatDay(selectedDate)}
        </span>
        <button
          onClick={() => onDateChange(nextDay(selectedDate))}
          style={{
            background: "var(--border-strong)",
            border: "1px solid var(--border-default)",
            color: "var(--text-muted)",
            borderRadius: 6,
            padding: "6px 12px",
            cursor: "pointer",
            fontSize: 14,
          }}
        >
          ›
        </button>
        {!isToday && (
          <button
            onClick={() => onDateChange(todayStr)}
            style={{
              background: "transparent",
              border: "1px solid #3b82f655",
              color: "#3b82f6",
              borderRadius: 6,
              padding: "6px 10px",
              cursor: "pointer",
              fontSize: 11,
            }}
          >
            Oggi
          </button>
        )}
      </div>

      {/* Gantt container */}
      <div style={{ overflowX: "auto", borderRadius: 8, border: "1px solid var(--border-strong)" }}>
        <div style={{
          position: "relative",
          background: "#0f172a",
          minWidth: 900,
          height: totalH,
        }}>
          {/* CSS Grid interno */}
          <div style={{
            display: "grid",
            gridTemplateColumns: `${LABEL_W}px repeat(18, minmax(40px, 1fr))`,
            gridTemplateRows: `${HEADER_H}px repeat(${nRows}, ${ROW_H}px)`,
            height: totalH,
          }}>
            {/* ── Cella intestazione label ── */}
            <div style={{
              gridRow: 1,
              gridColumn: 1,
              background: "#1e293b",
              borderRight: "1px solid #334155",
              borderBottom: "1px solid #334155",
              display: "flex",
              alignItems: "center",
              paddingLeft: 12,
            }}>
              <span style={{ fontSize: 10, color: "#64748b", fontFamily: "var(--font-mono, monospace)", fontWeight: 600 }}>
                TECNICO
              </span>
            </div>

            {/* ── Intestazioni ore ── */}
            {TIME_SLOTS.map((slot, i) => (
              <div key={slot} style={{
                gridRow: 1,
                gridColumn: i + 2,
                background: "#1e293b",
                borderRight: i % 2 === 1 ? "1px solid #334155" : "1px solid #263044",
                borderBottom: "1px solid #334155",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                fontSize: 10,
                color: "#64748b",
                fontFamily: "var(--font-mono, monospace)",
              }}>
                {i % 2 === 0 ? slot : ""}
              </div>
            ))}

            {/* ── Righe tecnici ── */}
            {displayTecnici.length === 0 ? (
              <div style={{
                gridRow: 2,
                gridColumn: "1 / 20",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                color: "#4b5563",
                fontSize: 13,
              }}>
                Nessun intervento pianificato per questo giorno
              </div>
            ) : (
              displayTecnici.map((tc, rowIdx) => {
                const rowNum = rowIdx + 2;
                const rowWOs = dayWOs.filter(w => w.technician_id === tc.id);

                return (
                  <div key={tc.id} style={{ display: "contents" }}>
                    {/* Label tecnico */}
                    <div style={{
                      gridRow: rowNum,
                      gridColumn: 1,
                      background: "var(--surface-2)",
                      borderRight: "1px solid #334155",
                      borderBottom: "1px solid var(--border-strong)",
                      display: "flex",
                      alignItems: "center",
                      paddingLeft: 12,
                      gap: 8,
                    }}>
                      <div style={{
                        width: 28,
                        height: 28,
                        borderRadius: "50%",
                        background: "#1d4ed8",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        fontSize: 11,
                        fontWeight: 700,
                        color: "#fff",
                        flexShrink: 0,
                      }}>
                        {(tc.nome?.[0] ?? "?").toUpperCase()}
                      </div>
                      <div style={{ overflow: "hidden" }}>
                        <div style={{
                          fontSize: 12,
                          fontWeight: 600,
                          color: "#e2e8f0",
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                          whiteSpace: "nowrap",
                        }}>
                          {tc.nome} {tc.cognome ?? ""}
                        </div>
                        <div style={{ fontSize: 10, color: "#64748b" }}>
                          {rowWOs.length} interventi
                        </div>
                      </div>
                    </div>

                    {/* Celle sfondo griglia */}
                    {TIME_SLOTS.map((_, si) => (
                      <div key={si} style={{
                        gridRow: rowNum,
                        gridColumn: si + 2,
                        borderRight: si % 2 === 1 ? "1px solid #1e293b" : "1px solid #161f2e",
                        borderBottom: "1px solid var(--border-strong)",
                        background: si % 2 === 0 ? "#0f172a" : "var(--surface-2)",
                      }} />
                    ))}

                    {/* Blocchi WO */}
                    {rowWOs.map((wo) => {
                      const ticket = ticketMap.get(wo.wo_id);
                      const tipo = ticket?.tipo ?? "CM";
                      const stile = tipoStyle(tipo, wo.is_continuation);
                      const startCol = timeToCol(wo.planned_start_time);
                      const endCol = timeToCol(wo.planned_end_time);
                      const spanCols = Math.max(endCol - startCol, 1);

                      return (
                        <div
                          key={`${wo.wo_id}-${wo.planned_date}-${wo.planned_start_time}`}
                          style={{
                            gridRow: rowNum,
                            gridColumn: `${startCol} / ${Math.min(endCol, 20)}`,
                            background: stile.bg,
                            borderRadius: 6,
                            margin: "6px 2px",
                            padding: "3px 6px",
                            fontSize: 11,
                            fontWeight: 600,
                            color: stile.text,
                            overflow: "hidden",
                            cursor: "pointer",
                            zIndex: 2,
                            border: `1px ${stile.borderStyle ?? "solid"} ${stile.border}`,
                            boxShadow: `inset 0 1px 0 var(--border-default)`,
                            transition: "filter 150ms, transform 150ms",
                            display: "flex",
                            flexDirection: "column",
                            justifyContent: "center",
                          }}
                          onMouseEnter={(e) => {
                            (e.currentTarget as HTMLElement).style.filter = "brightness(1.2)";
                            (e.currentTarget as HTMLElement).style.transform = "scale(1.02)";
                            setTooltip({ wo, x: e.clientX, y: e.clientY });
                          }}
                          onMouseLeave={(e) => {
                            (e.currentTarget as HTMLElement).style.filter = "";
                            (e.currentTarget as HTMLElement).style.transform = "";
                            setTooltip(null);
                          }}
                        >
                          <div style={{
                            overflow: "hidden",
                            textOverflow: "ellipsis",
                            whiteSpace: "nowrap",
                            lineHeight: 1.3,
                          }}>
                            #{wo.wo_id} {ticket?.titolo ?? "—"}
                          </div>
                          {spanCols >= 4 && (
                            <div style={{
                              fontSize: 10,
                              opacity: 0.75,
                              overflow: "hidden",
                              textOverflow: "ellipsis",
                              whiteSpace: "nowrap",
                            }}>
                              {ticket?.asset_name ?? "—"}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                );
              })
            )}
          </div>

          {/* Overlay droppable per DnD manuale — visibili solo se onTicketDrop è fornito */}
          {onTicketDrop && displayTecnici.map((tc, rowIdx) => (
            <DroppableTecnicoRow
              key={`drop-${tc.id}`}
              tecnicoId={tc.id}
              top={HEADER_H + rowIdx * ROW_H}
              height={ROW_H}
              left={LABEL_W}
            />
          ))}

          {/* Linea ora corrente */}
          {isToday && nowMinutesFrom8 >= 0 && nowMinutesFrom8 <= 540 && (
            <div style={{
              position: "absolute",
              top: HEADER_H,
              bottom: 0,
              left: `calc(${LABEL_W}px + ${nowFrac * 100}% - ${nowFrac * LABEL_W}px)`,
              width: 2,
              background: "#3b82f6",
              zIndex: 10,
              pointerEvents: "none",
              animation: "pulse 2s infinite",
              boxShadow: "0 0 6px #3b82f6",
            }} />
          )}
        </div>
      </div>

      {/* Tooltip flottante */}
      {tooltip && (() => {
        const ticket = ticketMap.get(tooltip.wo.wo_id);
        const tipo = ticket?.tipo ?? "CM";
        const stile = tipoStyle(tipo, tooltip.wo.is_continuation);
        return (
          <div style={{
            position: "fixed",
            left: tooltip.x + 16,
            top: tooltip.y - 10,
            background: "#1e293b",
            border: `1px solid #3b82f6`,
            borderRadius: 8,
            padding: "12px 16px",
            zIndex: 9999,
            minWidth: 240,
            maxWidth: 320,
            boxShadow: "0 20px 40px rgba(0,0,0,0.6)",
            pointerEvents: "none",
          }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
              <span style={{
                background: stile.bg,
                color: stile.text,
                fontSize: 10,
                fontWeight: 700,
                padding: "2px 6px",
                borderRadius: 4,
                border: `1px solid ${stile.border}`,
              }}>
                {tipo}
              </span>
              <span style={{ fontSize: 13, fontWeight: 700, color: "#f9fafb" }}>
                #{tooltip.wo.wo_id}
              </span>
            </div>
            <div style={{ fontSize: 12, color: "#e2e8f0", marginBottom: 4 }}>
              {ticket?.titolo ?? "—"}
            </div>
            <div style={{ fontSize: 11, color: "var(--text-muted)", marginBottom: 2 }}>
              Asset: {ticket?.asset_name ?? "—"}
            </div>
            <div style={{ fontSize: 11, color: "var(--text-muted)", marginBottom: 2 }}>
              Orario: {tooltip.wo.planned_start_time} → {tooltip.wo.planned_end_time}
            </div>
            <div style={{ fontSize: 11, color: "var(--text-muted)", marginBottom: 6 }}>
              Durata: {tooltip.wo.duration_hours?.toFixed(1)}h
            </div>
            {tooltip.wo.motivation && (
              <div style={{
                fontSize: 11,
                color: "#6b7280",
                fontStyle: "italic",
                borderTop: "1px solid #374151",
                paddingTop: 8,
              }}>
                {tooltip.wo.motivation}
              </div>
            )}
            {tooltip.wo.warnings?.length > 0 && (
              <div style={{ marginTop: 6 }}>
                {tooltip.wo.warnings.map((w, i) => (
                  <div key={i} style={{ fontSize: 10, color: "#f59e0b" }}>⚠ {w}</div>
                ))}
              </div>
            )}
          </div>
        );
      })()}

      <style>{`
        @keyframes pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.5; }
        }
      `}</style>
    </div>
  );
}
