"use client";

import { useEffect, useState, useMemo } from "react";
import { apiGet } from "../lib/api";
import { notify } from "@/lib/toast";

interface CalendarEvent {
  tipo: "scadenza" | "ticket";
  id: number;
  data: string;
  descrizione: string;
  asset_id?: number;
  asset_nome?: string;
  priorita: string;
  stato?: string;
  urgenza: "alta" | "media";
}

const DAYS = ["Lun", "Mar", "Mer", "Gio", "Ven", "Sab", "Dom"];
const MONTHS = [
  "Gennaio", "Febbraio", "Marzo", "Aprile", "Maggio", "Giugno",
  "Luglio", "Agosto", "Settembre", "Ottobre", "Novembre", "Dicembre"
];

export default function ScadenzePage() {
  const [currentDate, setCurrentDate] = useState(new Date());
  const [eventi, setEventi] = useState<CalendarEvent[]>([]);
  const [loading, setLoading] = useState(true);

  const month = currentDate.getMonth();
  const year = currentDate.getFullYear();

  useEffect(() => {
    loadEventi();
  }, [month, year]);

  async function loadEventi() {
    setLoading(true);
    try {
      // Chiediamo 3 mesi per sicurezza (precedente, attuale, prossimo)
      const d = await apiGet<{ eventi: CalendarEvent[] }>("/scadenze/calendario?mesi=3");
      setEventi(d.eventi);
    } catch {
      notify.error("Errore nel caricamento del calendario.");
    } finally {
      setLoading(false);
    }
  }

  const calendarDays = useMemo(() => {
    const firstDayOfMonth = new Date(year, month, 1).getDay();
    // Convert current JS 0=Sun to 0=Mon
    const startDay = firstDayOfMonth === 0 ? 6 : firstDayOfMonth - 1;
    
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const prevMonthDays = new Date(year, month, 0).getDate();
    
    const days = [];
    
    // Previous month padding
    for (let i = startDay - 1; i >= 0; i--) {
      days.push({
        day: prevMonthDays - i,
        month: month - 1,
        year: year,
        isCurrentMonth: false,
        key: `prev-${prevMonthDays - i}`
      });
    }
    
    // Current month
    for (let i = 1; i <= daysInMonth; i++) {
        days.push({
          day: i,
          month: month,
          year: year,
          isCurrentMonth: true,
          key: `curr-${i}`
        });
    }
    
    // Next month padding
    const remaining = 42 - days.length; // 6 rows of 7
    for (let i = 1; i <= remaining; i++) {
      days.push({
        day: i,
        month: month + 1,
        year: year,
        isCurrentMonth: false,
        key: `next-${i}`
      });
    }
    
    return days;
  }, [month, year]);

  const changeMonth = (offset: number) => {
    const d = new Date(currentDate);
    d.setMonth(d.getMonth() + offset);
    setCurrentDate(d);
  };

  const getDayEvents = (d: number, m: number, y: number) => {
    const dateStr = new Date(y, m, d).toISOString().split("T")[0];
    return eventi.filter(e => e.data === dateStr);
  };

  const isToday = (d: number, m: number, y: number) => {
    const today = new Date();
    return d === today.getDate() && m === today.getMonth() && y === today.getFullYear();
  };

  return (
    <div style={{ padding: "32px", height: "100%", display: "flex", flexDirection: "column", gap: "24px", color: "var(--text-primary)" }}>
      
      {/* Header con Navigazione */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div>
          <h1 style={{ fontSize: "28px", fontWeight: 800, margin: 0, letterSpacing: "-0.5px" }}>
            {MONTHS[month]} <span style={{ color: "var(--text-secondary)", fontWeight: 400 }}>{year}</span>
          </h1>
          <div style={{ fontSize: "13px", color: "var(--text-muted)", marginTop: "4px" }}>Visualizzazione scadenze manutenzione preventiva</div>
        </div>
        
        <div style={{ display: "flex", gap: "8px", background: "var(--bg-elevated)", padding: "6px", borderRadius: "12px", border: "1px solid var(--border)" }}>
          <button onClick={() => changeMonth(-1)} style={{ padding: "8px 12px", background: "transparent", border: "none", cursor: "pointer", borderRadius: "8px", color: "var(--text-primary)" }}
            onMouseEnter={e => e.currentTarget.style.background = "rgba(255,255,255,0.05)"}
            onMouseLeave={e => e.currentTarget.style.background = "transparent"}>
            ❮
          </button>
          <button onClick={() => setCurrentDate(new Date())} style={{ padding: "8px 16px", background: "var(--bg-surface)", border: "1px solid var(--border)", cursor: "pointer", borderRadius: "8px", color: "var(--text-primary)", fontSize: "12px", fontWeight: 700 }}>
            Oggi
          </button>
          <button onClick={() => changeMonth(1)} style={{ padding: "8px 12px", background: "transparent", border: "none", cursor: "pointer", borderRadius: "8px", color: "var(--text-primary)" }}
            onMouseEnter={e => e.currentTarget.style.background = "rgba(255,255,255,0.05)"}
            onMouseLeave={e => e.currentTarget.style.background = "transparent"}>
            ❯
          </button>
        </div>
      </div>

      {/* Legenda */}
      <div style={{ display: "flex", gap: "20px", fontSize: "11px", color: "var(--text-secondary)", textTransform: "uppercase", letterSpacing: "1px", fontWeight: 700 }}>
        <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
          <span style={{ width: 8, height: 8, borderRadius: "50%", background: "var(--blue)" }} /> Prossima Scadenza PM
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
          <span style={{ width: 8, height: 8, borderRadius: "50%", background: "var(--amber)" }} /> Intervento Pianificato
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
          <span style={{ width: 8, height: 8, borderRadius: "50%", background: "var(--red)" }} /> Urgente / Alta Priorità
        </div>
      </div>

      {/* Calendario Grid */}
      <div style={{ flex: 1, display: "flex", flexDirection: "column", background: "var(--bg-surface)", border: "1px solid var(--border-strong)", borderRadius: "16px", overflow: "hidden", boxShadow: "0 10px 30px rgba(0,0,0,0.2)" }}>
        
        {/* Giorni Settimana */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", borderBottom: "1px solid var(--border-strong)", background: "rgba(255,255,255,0.02)" }}>
          {DAYS.map(d => (
            <div key={d} style={{ padding: "12px", textAlign: "center", fontSize: "12px", fontWeight: 800, color: "var(--text-muted)" }}>{d}</div>
          ))}
        </div>

        {/* Celle */}
        <div style={{ flex: 1, display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gridTemplateRows: "repeat(6, 1fr)" }}>
          {calendarDays.map(({ day, month: m, year: y, isCurrentMonth, key }) => {
            const dayEvents = getDayEvents(day, m, y);
            const tday = isToday(day, m, y);
            
            return (
              <div key={key} style={{ 
                borderRight: "1px solid var(--border)", 
                borderBottom: "1px solid var(--border)", 
                padding: "10px", 
                background: tday ? "rgba(59,130,246,0.03)" : "transparent",
                opacity: isCurrentMonth ? 1 : 0.4,
                display: "flex",
                flexDirection: "column",
                gap: "4px",
                overflow: "hidden"
              }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "4px" }}>
                  <span style={{ 
                    fontSize: "13px", 
                    fontWeight: tday ? 1000 : 700, 
                    color: tday ? "var(--blue)" : "inherit",
                    background: tday ? "rgba(59,130,246,0.15)" : "transparent",
                    width: 24, height: 24, borderRadius: "50%",
                    display: "flex", alignItems: "center", justifyContent: "center"
                  }}>{day}</span>
                </div>

                <div style={{ display: "flex", flexDirection: "column", gap: "2px", overflowY: "auto" }} className="no-scrollbar">
                  {dayEvents.map(ev => {
                    const isUrgent = ev.urgenza === "alta" || ev.priorita.toLowerCase() === "alta";
                    const color = isUrgent ? "var(--red)" : (ev.tipo === "scadenza" ? "var(--blue)" : "var(--amber)");
                    
                    return (
                      <div key={`${ev.tipo}-${ev.id}`} style={{
                        padding: "4px 8px",
                        fontSize: "10px",
                        fontWeight: 700,
                        borderRadius: "4px",
                        background: color + "15",
                        color: color,
                        borderLeft: `3px solid ${color}`,
                        whiteSpace: "nowrap",
                        textOverflow: "ellipsis",
                        overflow: "hidden",
                        cursor: "pointer",
                        transition: "transform 0.1s"
                      }}
                      onMouseEnter={e => e.currentTarget.style.transform = "translateX(2px)"}
                      onMouseLeave={e => e.currentTarget.style.transform = "translateX(0)"}
                      title={`${ev.asset_nome ? `[${ev.asset_nome}] ` : ''}${ev.descrizione}`}
                      >
                        {ev.tipo === "scadenza" ? "⏰" : "🔧"} {ev.descrizione}
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      <style jsx>{`
        .no-scrollbar::-webkit-scrollbar { display: none; }
        .no-scrollbar { -ms-overflow-style: none; scrollbar-width: none; }
      `}</style>
    </div>
  );
}
