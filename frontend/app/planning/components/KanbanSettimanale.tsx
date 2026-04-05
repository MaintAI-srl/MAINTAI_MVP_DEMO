"use client";

import type { PlannedWO, TicketData, TecnicoData } from "../types";
import { tipoStyle } from "../types";

interface Props {
  wos: PlannedWO[];
  ticketMap: Map<number, TicketData>;
  tecnicoMap: Map<number, TecnicoData>;
}

// Genera le date Lun-Ven della settimana del piano (da date presenti nei WO)
function buildWeekDays(wos: PlannedWO[]): string[] {
  if (wos.length === 0) {
    // Settimana corrente (Lun-Ven)
    const today = new Date();
    const dow = today.getDay(); // 0=Dom
    const lun = new Date(today);
    lun.setDate(today.getDate() - ((dow + 6) % 7));
    return Array.from({ length: 5 }, (_, i) => {
      const d = new Date(lun);
      d.setDate(lun.getDate() + i);
      return d.toISOString().slice(0, 10);
    });
  }
  const dates = [...new Set(wos.map(w => w.planned_date))].sort();
  // Prendi la settimana (Lun-Ven) del primo giorno
  const first = new Date(dates[0] + "T00:00:00");
  const dow = first.getDay();
  const lun = new Date(first);
  lun.setDate(first.getDate() - ((dow + 6) % 7));
  return Array.from({ length: 5 }, (_, i) => {
    const d = new Date(lun);
    d.setDate(lun.getDate() + i);
    return d.toISOString().slice(0, 10);
  });
}

function formatColHeader(dateStr: string): { giorno: string; data: string } {
  const d = new Date(dateStr + "T00:00:00");
  const gg = ["Dom","Lun","Mar","Mer","Gio","Ven","Sab"][d.getDay()];
  const mm = ["Gen","Feb","Mar","Apr","Mag","Giu","Lug","Ago","Set","Ott","Nov","Dic"][d.getMonth()];
  return { giorno: gg, data: `${d.getDate()} ${mm}` };
}

function contaPerTipo(cards: PlannedWO[], tipo: string): number {
  return cards.filter(w => {
    const t = w.wo_id; // wo_id refers to ticket id, tipo from ticketMap
    return true; // conta tutti, il tipo è nel ticketMap
  }).length;
}

export default function KanbanSettimanale({ wos, ticketMap, tecnicoMap }: Props) {
  const today = new Date().toISOString().slice(0, 10);
  const weekDays = buildWeekDays(wos);

  // Raggruppa WOs per giorno (esclude continuazioni per evitare duplicati visivi)
  const wosByDay: Record<string, PlannedWO[]> = {};
  weekDays.forEach(d => { wosByDay[d] = []; });
  wos.forEach(wo => {
    if (wosByDay[wo.planned_date] !== undefined) {
      wosByDay[wo.planned_date].push(wo);
    }
  });

  return (
    <div style={{ overflowX: "auto" }}>
      <div style={{
        display: "grid",
        gridTemplateColumns: "repeat(5, minmax(180px, 1fr))",
        gap: 10,
        minWidth: 900,
      }}>
        {weekDays.map(dayStr => {
          const dayWOs = wosByDay[dayStr] ?? [];
          const isToday = dayStr === today;
          const { giorno, data } = formatColHeader(dayStr);

          // Conteggio per tipo
          const nBD = dayWOs.filter(w => (ticketMap.get(w.wo_id)?.tipo ?? "CM") === "BD").length;
          const nPM = dayWOs.filter(w => (ticketMap.get(w.wo_id)?.tipo ?? "CM") === "PM").length;
          const nCM = dayWOs.filter(w => (ticketMap.get(w.wo_id)?.tipo ?? "CM") === "CM").length;
          const oreTotal = dayWOs.reduce((s, w) => s + (w.duration_hours ?? 0), 0);

          return (
            <div key={dayStr} style={{
              background: "#111827",
              border: "1px solid #1f2937",
              borderRadius: 8,
              overflow: "hidden",
              display: "flex",
              flexDirection: "column",
            }}>
              {/* Header colonna */}
              <div style={{
                background: isToday
                  ? "linear-gradient(135deg, #1e3a5f, #1e293b)"
                  : "#1e293b",
                borderTop: isToday ? "2px solid #3b82f6" : "2px solid transparent",
                padding: "10px 12px",
                borderBottom: "1px solid #1f2937",
              }}>
                <div style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "flex-start",
                }}>
                  <div>
                    <div style={{
                      fontSize: 14,
                      fontWeight: 700,
                      color: isToday ? "#60a5fa" : "#f9fafb",
                    }}>
                      {giorno}
                    </div>
                    <div style={{ fontSize: 11, color: "#9ca3af" }}>{data}</div>
                  </div>
                  <div style={{
                    fontSize: 11,
                    color: "#6b7280",
                    textAlign: "right",
                  }}>
                    <div>{dayWOs.length} WO</div>
                    <div>{oreTotal.toFixed(1)}h</div>
                  </div>
                </div>
              </div>

              {/* Cards WO */}
              <div style={{
                flex: 1,
                padding: "8px",
                display: "flex",
                flexDirection: "column",
                gap: 6,
                minHeight: 120,
              }}>
                {dayWOs.length === 0 ? (
                  <div style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    height: 80,
                    color: "#374151",
                    fontSize: 12,
                  }}>
                    Nessun intervento
                  </div>
                ) : (
                  dayWOs.map(wo => {
                    const ticket = ticketMap.get(wo.wo_id);
                    const tipo = ticket?.tipo ?? "CM";
                    const stile = tipoStyle(tipo, wo.is_continuation);
                    const tecnico = tecnicoMap.get(wo.technician_id);
                    const tecNome = tecnico ? `${tecnico.nome} ${tecnico.cognome ?? ""}`.trim() : "—";

                    return (
                      <div
                        key={`${wo.wo_id}-${wo.planned_start_time}`}
                        style={{
                          background: "#1a2332",
                          border: `1px ${wo.is_continuation ? "dashed" : "solid"} #2a3748`,
                          borderLeft: `3px ${wo.is_continuation ? "dashed" : "solid"} ${stile.border}`,
                          borderRadius: 6,
                          padding: "10px 10px",
                          cursor: "pointer",
                          transition: "background 200ms, transform 200ms, box-shadow 200ms",
                        }}
                        onMouseEnter={e => {
                          (e.currentTarget as HTMLElement).style.background = "#1f2d42";
                          (e.currentTarget as HTMLElement).style.transform = "translateY(-2px)";
                          (e.currentTarget as HTMLElement).style.boxShadow = "0 4px 12px rgba(0,0,0,0.4)";
                        }}
                        onMouseLeave={e => {
                          (e.currentTarget as HTMLElement).style.background = "#1a2332";
                          (e.currentTarget as HTMLElement).style.transform = "";
                          (e.currentTarget as HTMLElement).style.boxShadow = "";
                        }}
                      >
                        {/* Header card */}
                        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 5 }}>
                          <span style={{
                            fontSize: 10,
                            fontWeight: 700,
                            background: stile.bg,
                            color: stile.text,
                            padding: "1px 6px",
                            borderRadius: 3,
                            border: `1px ${wo.is_continuation ? "dashed" : "solid"} ${stile.border}`,
                          }}>
                            {wo.is_continuation ? "CONT" : tipo}
                          </span>
                          <span style={{ fontSize: 10, color: "#6b7280" }}>
                            #{wo.wo_id}
                          </span>
                        </div>

                        {/* Titolo */}
                        <div style={{
                          fontSize: 12,
                          fontWeight: 600,
                          color: "#e2e8f0",
                          marginBottom: 4,
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                          whiteSpace: "nowrap",
                        }}>
                          {ticket?.titolo ?? "—"}
                        </div>

                        {/* Asset */}
                        <div style={{ fontSize: 11, color: "#9ca3af", marginBottom: 3, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                          {ticket?.asset_name ?? "—"}
                        </div>

                        {/* Tecnico + orario */}
                        <div style={{ display: "flex", justifyContent: "space-between", fontSize: 10, color: "#6b7280", marginTop: 4 }}>
                          <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: "60%" }}>
                            👤 {tecNome}
                          </span>
                          <span>
                            {wo.planned_start_time}–{wo.planned_end_time}
                          </span>
                        </div>

                        {/* Warnings */}
                        {wo.warnings?.length > 0 && (
                          <div style={{ marginTop: 5 }}>
                            {wo.warnings.slice(0, 1).map((w, i) => (
                              <div key={i} style={{ fontSize: 10, color: "#f59e0b" }}>⚠ {w}</div>
                            ))}
                          </div>
                        )}
                      </div>
                    );
                  })
                )}
              </div>

              {/* Footer contatori tipo */}
              {dayWOs.length > 0 && (
                <div style={{
                  borderTop: "1px solid #1f2937",
                  padding: "6px 10px",
                  display: "flex",
                  gap: 6,
                  background: "#0f172a",
                }}>
                  {nBD > 0 && (
                    <span style={{
                      fontSize: 10,
                      background: "#7f1d1d44",
                      color: "#fca5a5",
                      border: "1px solid #ef444455",
                      borderRadius: 3,
                      padding: "1px 5px",
                    }}>BD {nBD}</span>
                  )}
                  {nPM > 0 && (
                    <span style={{
                      fontSize: 10,
                      background: "#14532d44",
                      color: "#86efac",
                      border: "1px solid #22c55e55",
                      borderRadius: 3,
                      padding: "1px 5px",
                    }}>PM {nPM}</span>
                  )}
                  {nCM > 0 && (
                    <span style={{
                      fontSize: 10,
                      background: "#78350f44",
                      color: "#fcd34d",
                      border: "1px solid #f59e0b55",
                      borderRadius: 3,
                      padding: "1px 5px",
                    }}>CM {nCM}</span>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
