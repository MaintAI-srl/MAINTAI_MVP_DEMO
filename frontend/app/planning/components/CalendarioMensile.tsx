"use client";

import { useState } from "react";
import type { PlannedWO, TicketData } from "../types";
import { tipoStyle, MESI } from "../types";
import { localDateStr } from "../../lib/datetime";

interface Props {
  wos: PlannedWO[];
  ticketMap: Map<number, TicketData>;
  mese: Date;           // primo giorno del mese da visualizzare
  onMeseChange: (m: Date) => void;
  onDayClick: (date: string) => void;
}

// Costruisce la griglia del mese (array di settimane)
function buildCalendarGrid(mese: Date): (string | null)[][] {
  const year = mese.getFullYear();
  const month = mese.getMonth();
  const firstDay = new Date(year, month, 1).getDay(); // 0=Dom
  const daysInMonth = new Date(year, month + 1, 0).getDate();

  // Offset per Lun=0 (europeo)
  const offset = (firstDay + 6) % 7;
  const cells: (string | null)[] = Array(offset).fill(null);

  for (let d = 1; d <= daysInMonth; d++) {
    const dd = new Date(year, month, d);
    cells.push(localDateStr(dd));
  }

  // Riempi fino al multiplo di 7
  while (cells.length % 7 !== 0) cells.push(null);

  const weeks: (string | null)[][] = [];
  for (let i = 0; i < cells.length; i += 7) {
    weeks.push(cells.slice(i, i + 7));
  }
  return weeks;
}

const GIORNI_HEADER = ["Lun", "Mar", "Mer", "Gio", "Ven", "Sab", "Dom"];

// Colori dot per tipo
const DOT_COLOR: Record<string, string> = {
  BD: "#ef4444",
  PM: "#22c55e",
  CM: "#f59e0b",
};

export default function CalendarioMensile({ wos, ticketMap, mese, onMeseChange, onDayClick }: Props) {
  const [panelDay, setPanelDay] = useState<string | null>(null);
  const today = localDateStr();

  // Mappa data → WOs
  const wosByDay: Record<string, PlannedWO[]> = {};
  wos.forEach(wo => {
    if (!wosByDay[wo.planned_date]) wosByDay[wo.planned_date] = [];
    wosByDay[wo.planned_date].push(wo);
  });

  const weeks = buildCalendarGrid(mese);
  const meseLabel = `${MESI[mese.getMonth()]} ${mese.getFullYear()}`;

  function prevMese() {
    const m = new Date(mese.getFullYear(), mese.getMonth() - 1, 1);
    onMeseChange(m);
  }
  function nextMese() {
    const m = new Date(mese.getFullYear(), mese.getMonth() + 1, 1);
    onMeseChange(m);
  }

  const panelWOs = panelDay ? (wosByDay[panelDay] ?? []) : [];

  return (
    <div style={{ display: "flex", gap: 16 }}>
      {/* Calendario */}
      <div style={{ flex: 1 }}>
        {/* Navigazione mese */}
        <div style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          marginBottom: 12,
        }}>
          <button onClick={prevMese} style={{
            background: "var(--border-strong)", border: "1px solid var(--border-default)", color: "var(--text-muted)",
            borderRadius: 6, padding: "6px 12px", cursor: "pointer", fontSize: 14,
          }}>‹</button>
          <span style={{ fontSize: 15, fontWeight: 700, color: "#f9fafb" }}>{meseLabel}</span>
          <button onClick={nextMese} style={{
            background: "var(--border-strong)", border: "1px solid var(--border-default)", color: "var(--text-muted)",
            borderRadius: 6, padding: "6px 12px", cursor: "pointer", fontSize: 14,
          }}>›</button>
        </div>

        {/* Intestazione giorni */}
        <div style={{
          display: "grid",
          gridTemplateColumns: "repeat(7, 1fr)",
          gap: 4,
          marginBottom: 4,
        }}>
          {GIORNI_HEADER.map(g => (
            <div key={g} style={{
              textAlign: "center",
              fontSize: 11,
              color: "#6b7280",
              fontWeight: 600,
              padding: "4px 0",
            }}>{g}</div>
          ))}
        </div>

        {/* Celle giorni */}
        {weeks.map((week, wi) => (
          <div key={wi} style={{
            display: "grid",
            gridTemplateColumns: "repeat(7, 1fr)",
            gap: 4,
            marginBottom: 4,
          }}>
            {week.map((dayStr, di) => {
              if (!dayStr) {
                return <div key={di} style={{ opacity: 0.3, minHeight: 70, background: "var(--surface-2)", borderRadius: 4 }} />;
              }
              const dayWOs = wosByDay[dayStr] ?? [];
              const isToday = dayStr === today;
              const isSelected = panelDay === dayStr;
              const currentMonth = dayStr.slice(0, 7) === localDateStr(mese).slice(0, 7);

              return (
                <div
                  key={dayStr}
                  onClick={() => {
                    setPanelDay(isSelected ? null : dayStr);
                    onDayClick(dayStr);
                  }}
                  style={{
                    background: isToday ? "var(--surface-hover)" : "var(--surface-2)",
                    border: isToday
                      ? "2px solid #3b82f6"
                      : isSelected
                        ? "2px solid #6366f1"
                        : "1px solid var(--border-strong)",
                    borderRadius: 4,
                    padding: "6px 6px 4px",
                    cursor: "pointer",
                    opacity: currentMonth ? 1 : 0.3,
                    minHeight: 70,
                    transition: "background 150ms",
                    display: "flex",
                    flexDirection: "column",
                  }}
                  onMouseEnter={e => {
                    if (!isToday && !isSelected)
                      (e.currentTarget as HTMLElement).style.background = "var(--border-strong)";
                  }}
                  onMouseLeave={e => {
                    (e.currentTarget as HTMLElement).style.background = isToday ? "var(--surface-hover)" : "var(--surface-2)";
                  }}
                >
                  {/* Numero giorno */}
                  <div style={{
                    fontSize: 12,
                    fontWeight: isToday ? 700 : 500,
                    color: isToday ? "#60a5fa" : "#9ca3af",
                    marginBottom: 4,
                  }}>
                    {parseInt(dayStr.slice(8), 10)}
                  </div>

                  {/* Pallini WO */}
                  {dayWOs.length > 0 && (
                    <div style={{
                      display: "flex",
                      flexWrap: "wrap",
                      gap: 2,
                      marginBottom: 2,
                    }}>
                      {dayWOs.slice(0, 6).map((wo, i) => {
                        const tipo = ticketMap.get(wo.wo_id)?.tipo ?? "CM";
                        return (
                          <div key={i} style={{
                            width: 8,
                            height: 8,
                            borderRadius: "50%",
                            background: DOT_COLOR[tipo] ?? "#6b7280",
                            flexShrink: 0,
                          }} />
                        );
                      })}
                      {dayWOs.length > 6 && (
                        <span style={{ fontSize: 9, color: "#6b7280", alignSelf: "center" }}>
                          +{dayWOs.length - 6}
                        </span>
                      )}
                    </div>
                  )}

                  {/* Contatore */}
                  {dayWOs.length > 0 && (
                    <div style={{ fontSize: 10, color: "#6b7280", marginTop: "auto" }}>
                      {dayWOs.length} interventi
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        ))}
      </div>

      {/* Pannello laterale giorno selezionato */}
      {panelDay && (
        <div style={{
          width: 280,
          flexShrink: 0,
          background: "var(--surface-2)",
          border: "1px solid var(--border-strong)",
          borderRadius: 8,
          overflow: "hidden",
        }}>
          <div style={{
            background: "var(--surface-3)",
            borderBottom: "1px solid var(--border-strong)",
            padding: "10px 14px",
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
          }}>
            <span style={{ fontSize: 13, fontWeight: 700, color: "#f9fafb" }}>
              {panelDay}
            </span>
            <button
              onClick={() => setPanelDay(null)}
              style={{
                background: "none",
                border: "none",
                color: "var(--text-muted)",
                cursor: "pointer",
                fontSize: 16,
                lineHeight: 1,
                padding: 0,
              }}
            >×</button>
          </div>
          <div style={{ padding: "10px", display: "flex", flexDirection: "column", gap: 8, overflowY: "auto", maxHeight: 500 }}>
            {panelWOs.length === 0 ? (
              <div style={{ color: "#4b5563", fontSize: 12, padding: "20px", textAlign: "center" }}>
                Nessun intervento
              </div>
            ) : (
              panelWOs.map((wo, i) => {
                const ticket = ticketMap.get(wo.wo_id);
                const tipo = ticket?.tipo ?? "CM";
                const stile = tipoStyle(tipo, wo.is_continuation);
                return (
                  <div key={i} style={{
                    background: "var(--surface-3)",
                    borderLeft: `3px solid ${stile.border}`,
                    borderRadius: 5,
                    padding: "8px 10px",
                  }}>
                    <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
                      <span style={{
                        fontSize: 10,
                        background: stile.bg,
                        color: stile.text,
                        padding: "1px 5px",
                        borderRadius: 3,
                        border: `1px solid ${stile.border}`,
                        fontWeight: 700,
                      }}>{wo.is_continuation ? "CONT" : tipo}</span>
                      <span style={{ fontSize: 10, color: "#6b7280" }}>#{wo.wo_id}</span>
                    </div>
                    <div style={{ fontSize: 12, fontWeight: 600, color: "#e2e8f0", marginBottom: 2 }}>
                      {ticket?.titolo ?? "—"}
                    </div>
                    <div style={{ fontSize: 11, color: "var(--text-muted)", marginBottom: 2 }}>
                      {ticket?.asset_name ?? "—"}
                    </div>
                    <div style={{ fontSize: 10, color: "#6b7280" }}>
                      {wo.planned_start_time} → {wo.planned_end_time} ({wo.duration_hours?.toFixed(1)}h)
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>
      )}
    </div>
  );
}
