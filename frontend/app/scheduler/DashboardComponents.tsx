import React, { useState } from "react";
import { UnifiedTicket } from "./unified_types";
import { formatHour, toIso, addDays, woTypeColor, woTypeBg } from "./unified_helpers";

function TicketRow({ ticket }: { ticket: UnifiedTicket }) {
  return (
    <div style={{
      display: "flex", gap: "10px", alignItems: "center", padding: "6px 8px",
      borderBottom: "1px solid rgba(148,163,184,0.1)", fontSize: "12px", background: "var(--bg-card)"
    }}>
      <div style={{ width: "40px", fontWeight: "bold", color: "var(--text-secondary)" }}>#{ticket.id}</div>
      <div style={{
        padding: "2px 6px", borderRadius: "4px", fontSize: "10px", fontWeight: "bold",
        color: woTypeColor(ticket.type), background: woTypeBg(ticket.type), minWidth: "30px", textAlign: "center"
      }}>
        {ticket.type || "—"}
      </div>
      <div style={{ flex: 1, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", color: "var(--text-primary)" }}>
        {ticket.title}
      </div>
      <div style={{ width: "120px", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", color: "var(--text-secondary)" }}>
        {ticket.asset}
      </div>
      <div style={{ width: "80px", color: "#3b82f6", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
        {ticket.technicianName}
      </div>
      <div style={{ width: "80px", color: "var(--text-muted)", fontFamily: "monospace", textAlign: "right" }}>
        {formatHour(ticket.startHour)} - {formatHour(ticket.endHour)}
      </div>
      {ticket.warnings && ticket.warnings.length > 0 && (
         <div style={{ width: "16px", color: "#f59e0b", textAlign: "center" }} title={ticket.warnings.join("\n")}>⚠️</div>
      )}
    </div>
  );
}

export function BlockList({
  title,
  tickets,
  pageSize = 5
}: {
  title: string;
  tickets: UnifiedTicket[];
  pageSize?: number;
}) {
  const [page, setPage] = useState(0);
  const totalPages = Math.ceil(tickets.length / pageSize);
  if (page >= totalPages && page > 0) setPage(totalPages - 1);

  const visible = tickets.slice(page * pageSize, (page + 1) * pageSize);

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", border: "1px solid rgba(148,163,184,0.3)", background: "var(--bg-card)" }}>
      <div style={{ padding: "8px 12px", borderBottom: "1px solid rgba(148,163,184,0.3)", fontSize: "12px", fontWeight: "bold", textTransform: "uppercase", background: "rgba(148,163,184,0.05)" }}>
        {title}
      </div>
      <div style={{ flex: 1, minHeight: "150px", overflowY: "auto", display: "flex", flexDirection: "column" }}>
        {visible.map(t => <TicketRow key={t.id} ticket={t} />)}
        {tickets.length === 0 && <div style={{ padding: "20px", textAlign: "center", color: "var(--text-muted)", fontSize: "12px", fontStyle: "italic" }}>Nessun elemento</div>}
      </div>
      <div style={{ padding: "8px 12px", borderTop: "1px solid rgba(148,163,184,0.3)", display: "flex", justifyContent: "flex-end", gap: "10px", alignItems: "center", background: "rgba(148,163,184,0.02)" }}>
        <span style={{ fontSize: "10px", color: "var(--text-muted)" }}>
          {tickets.length > 0 ? `${page * pageSize + 1}-${Math.min((page + 1) * pageSize, tickets.length)} di ${tickets.length}` : "0 di 0"}
        </span>
        <button disabled={page === 0} onClick={() => setPage(p => p - 1)} style={{ cursor: page === 0 ? "default" : "pointer", border: "none", background: "transparent", color: page === 0 ? "var(--text-muted)" : "var(--text-primary)", fontSize: "12px" }}>prev</button>
        <button disabled={page >= totalPages - 1} onClick={() => setPage(p => p + 1)} style={{ cursor: page >= totalPages - 1 ? "default" : "pointer", border: "none", background: "transparent", color: page >= totalPages - 1 ? "var(--text-muted)" : "var(--text-primary)", fontSize: "12px" }}>next</button>
      </div>
    </div>
  );
}

export function GanttBlock({
  tickets,
  dateStr,
  onDateChange,
}: {
  tickets: UnifiedTicket[];
  dateStr: string;
  onDateChange: (delta: number) => void;
}) {
  const GANTT_START = 8;
  const GANTT_SLOTS = 18; // 8:00 to 17:00 -> 9 hours -> 18 slots of 30min
  const SLOT_DURATION = 0.5;

  // Filtriamo solo quelli del giorno
  const daily = tickets.filter(t => t.date === dateStr && t.technicianName && t.technicianName !== "—");
  const techs = Array.from(new Set(daily.map(t => t.technicianName))).sort();

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", border: "1px solid rgba(148,163,184,0.3)", background: "var(--bg-card)" }}>
      <div style={{ display: "flex", justifyContent: "space-between", padding: "8px 12px", borderBottom: "1px solid rgba(148,163,184,0.3)", background: "rgba(148,163,184,0.05)", alignItems: "center" }}>
        <div style={{ fontSize: "12px", fontWeight: "bold", textTransform: "uppercase" }}>Gantt - {new Date(dateStr).toLocaleDateString("it-IT", { weekday: 'short', day: '2-digit', month: 'short' })}</div>
        <div style={{ display: "flex", gap: "10px" }}>
           <button onClick={() => onDateChange(-1)} style={{ cursor: "pointer", border: "none", background: "transparent", color: "var(--text-primary)", fontSize: "12px" }}>prev</button>
           <button onClick={() => onDateChange(1)} style={{ cursor: "pointer", border: "none", background: "transparent", color: "var(--text-primary)", fontSize: "12px" }}>next</button>
        </div>
      </div>
      <div style={{ flex: 1, overflowX: "auto", overflowY: "auto", minHeight: "150px" }}>
        <div style={{ display: "grid", gridTemplateColumns: `120px repeat(${GANTT_SLOTS}, minmax(40px, 1fr))`, minWidth: "800px" }}>
           {techs.map((tech, i) => {
              const techTix = daily.filter(t => t.technicianName === tech);
              return (
                 <React.Fragment key={tech}>
                    <div style={{ padding: "8px", fontSize: "11px", fontWeight: "bold", borderBottom: "1px solid rgba(148,163,184,0.2)", borderRight: "1px solid rgba(148,163,184,0.2)", position: "sticky", left: 0, background: "var(--bg-card)", zIndex: 10 }}>
                       {tech}
                    </div>
                    <div style={{ gridColumn: `2 / span ${GANTT_SLOTS}`, position: "relative", borderBottom: "1px solid rgba(148,163,184,0.2)", background: "rgba(148,163,184,0.02)" }}>
                       {/* griglia orari */}
                       {Array.from({length: GANTT_SLOTS}).map((_, idx) => (
                           <div key={idx} style={{ position: "absolute", left: `${(idx / GANTT_SLOTS) * 100}%`, width: `${(1 / GANTT_SLOTS) * 100}%`, top: 0, bottom: 0, borderRight: "1px solid rgba(148,163,184,0.05)" }} />
                       ))}
                       {techTix.map(t => {
                          const s = Math.max(t.startHour || 8, GANTT_START);
                          const e = Math.min(t.endHour || 10, GANTT_START + (GANTT_SLOTS * SLOT_DURATION));
                          if (s >= e) return null;
                          const leftPct = ((s - GANTT_START) / (GANTT_SLOTS * SLOT_DURATION)) * 100;
                          const widthPct = ((e - s) / (GANTT_SLOTS * SLOT_DURATION)) * 100;
                          return (
                             <div key={t.id} title={`${t.title} [${formatHour(t.startHour)}-${formatHour(t.endHour)}]`} style={{
                                position: "absolute", left: `${leftPct}%`, width: `${widthPct}%`, top: "4px", bottom: "4px",
                                background: t.isContinuation ? "transparent" : woTypeColor(t.type),
                                border: t.isContinuation ? `2px dashed ${woTypeColor(t.type)}` : `1px solid ${woTypeColor(t.type)}`,
                                opacity: 0.8, borderRadius: "2px", zIndex: 5, overflow: "hidden", fontSize: "9px", color: "#fff", padding: "0 4px", whiteSpace: "nowrap", display: "flex", alignItems: "center"
                             }}>
                                {t.title}
                             </div>
                          );
                       })}
                    </div>
                 </React.Fragment>
              );
           })}
           {techs.length === 0 && (
             <div style={{ gridColumn: `1 / -1`, padding: "20px", textAlign: "center", color: "var(--text-muted)", fontSize: "12px", fontStyle: "italic" }}>Nessun tecnico con ticket pianificati.</div>
           )}
        </div>
      </div>
    </div>
  );
}
