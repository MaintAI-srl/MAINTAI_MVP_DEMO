"use client";

import { useEffect, useState, useMemo } from "react";
import { apiGet } from "../lib/api";
import { notify } from "@/lib/toast";

type Evento = {
  tipo: "scadenza" | "ticket";
  id: number;
  data: string; // "YYYY-MM-DD"
  descrizione: string;
  asset_id: number | null;
  asset_nome: string | null;
  frequenza_giorni?: number;
  priorita: string;
  stato?: string;
  urgenza: "alta" | "media";
};

type CalendarioResp = { eventi: Evento[]; mesi: number };

const PRIO_COLOR: Record<string, string> = {
  alta: "#f87171",
  media: "#fbbf24",
  bassa: "#34d399",
};

const MESE_NOMI = ["Gennaio", "Febbraio", "Marzo", "Aprile", "Maggio", "Giugno",
  "Luglio", "Agosto", "Settembre", "Ottobre", "Novembre", "Dicembre"];

const GIORNO_NOMI_SHORT = ["Dom", "Lun", "Mar", "Mer", "Gio", "Ven", "Sab"];

function urgenzaStyle(u: string): React.CSSProperties {
  return u === "alta"
    ? { color: "#f87171", background: "rgba(248,113,113,0.1)", border: "1px solid rgba(248,113,113,0.3)" }
    : { color: "#fbbf24", background: "rgba(251,191,36,0.1)", border: "1px solid rgba(251,191,36,0.3)" };
}

function buildMonthGrid(year: number, month: number): (Date | null)[][] {
  const firstDay = new Date(year, month, 1);
  const lastDay = new Date(year, month + 1, 0);
  const startDow = firstDay.getDay(); // 0=Dom
  const weeks: (Date | null)[][] = [];
  let week: (Date | null)[] = Array(startDow).fill(null);

  for (let d = 1; d <= lastDay.getDate(); d++) {
    week.push(new Date(year, month, d));
    if (week.length === 7) { weeks.push(week); week = []; }
  }
  if (week.length > 0) { while (week.length < 7) week.push(null); weeks.push(week); }
  return weeks;
}

export default function ScadenzePage() {
  const [eventi, setEventi] = useState<Evento[]>([]);
  const [loading, setLoading] = useState(true);
  const [mesi, setMesi] = useState(3);
  const [filterTipo, setFilterTipo] = useState<"" | "scadenza" | "ticket">("");
  const [filterPriorita, setFilterPriorita] = useState("");
  const [selectedDay, setSelectedDay] = useState<string | null>(null);

  const today = new Date();

  useEffect(() => {
    load();
  }, [mesi]);

  async function load() {
    setLoading(true);
    try {
      const d = await apiGet<CalendarioResp>(`/scadenze/calendario?mesi=${mesi}`);
      setEventi(d.eventi);
    } catch {
      notify.error("Impossibile caricare il calendario scadenze.");
    } finally {
      setLoading(false);
    }
  }

  // Filtra gli eventi
  const eventiFiltrati = useMemo(() => {
    return eventi.filter(e => {
      if (filterTipo && e.tipo !== filterTipo) return false;
      if (filterPriorita && e.priorita?.toLowerCase() !== filterPriorita.toLowerCase()) return false;
      return true;
    });
  }, [eventi, filterTipo, filterPriorita]);

  // Raggruppa per data
  const byData = useMemo(() => {
    const map: Record<string, Evento[]> = {};
    for (const e of eventiFiltrati) {
      if (!map[e.data]) map[e.data] = [];
      map[e.data].push(e);
    }
    return map;
  }, [eventiFiltrati]);

  // Genera i mesi da visualizzare
  const months = useMemo(() => {
    const result: { year: number; month: number }[] = [];
    for (let i = 0; i < mesi; i++) {
      const d = new Date(today.getFullYear(), today.getMonth() + i, 1);
      result.push({ year: d.getFullYear(), month: d.getMonth() });
    }
    return result;
  }, [mesi]);

  // Calcola statistiche
  const stats = useMemo(() => {
    const scadenze = eventi.filter(e => e.tipo === "scadenza");
    const tickets = eventi.filter(e => e.tipo === "ticket");
    const alta = eventi.filter(e => e.urgenza === "alta");
    const entro7gg = eventi.filter(e => {
      const diff = (new Date(e.data).getTime() - today.getTime()) / 86400000;
      return diff >= -1 && diff <= 7;
    });
    return { scadenze: scadenze.length, tickets: tickets.length, alta: alta.length, entro7gg: entro7gg.length };
  }, [eventi]);

  const eventiGiornoSelezionato = selectedDay ? (byData[selectedDay] ?? []) : [];

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 0 }}>
      {/* HERO */}
      <div style={{
        position: "relative", overflow: "hidden",
        background: "linear-gradient(135deg, rgba(99,102,241,0.08) 0%, rgba(139,92,246,0.05) 50%, transparent 100%)",
        borderBottom: "1px solid rgba(99,102,241,0.12)",
        padding: "36px 32px 28px",
        marginBottom: 28,
      }}>
        <div style={{ position: "absolute", inset: 0, backgroundImage: "linear-gradient(rgba(99,102,241,0.04) 1px, transparent 1px), linear-gradient(90deg, rgba(99,102,241,0.04) 1px, transparent 1px)", backgroundSize: "32px 32px", pointerEvents: "none" }} />
        <div style={{ position: "absolute", top: -60, right: -60, width: 280, height: 280, borderRadius: "50%", background: "radial-gradient(circle, rgba(251,191,36,0.1) 0%, transparent 70%)", pointerEvents: "none" }} />

        <div style={{ position: "relative" }}>
          <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: "0.2em", textTransform: "uppercase", color: "#fbbf24", marginBottom: 8 }}>PM Calendar</div>
          <h1 style={{ margin: 0, fontSize: 32, fontWeight: 900, fontFamily: "'Barlow Condensed', sans-serif", background: "linear-gradient(135deg, #e2e8f0 0%, #fbbf24 100%)", WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent", lineHeight: 1.1, marginBottom: 6 }}>
            Calendario Scadenze
          </h1>
          <p style={{ margin: 0, color: "var(--text-muted)", fontSize: 13 }}>
            Piano preventivo — scadenze manutenzione e ticket PM pianificati.
          </p>
        </div>

        {/* KPI strip */}
        <div style={{ display: "flex", gap: 16, marginTop: 20, flexWrap: "wrap" }}>
          {[
            { label: "Scadenze attività", value: stats.scadenze, color: "#818cf8" },
            { label: "Ticket PM pianificati", value: stats.tickets, color: "#34d399" },
            { label: "Urgenza alta", value: stats.alta, color: "#f87171" },
            { label: "Entro 7 giorni", value: stats.entro7gg, color: "#fbbf24" },
          ].map(k => (
            <div key={k.label} style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.07)", borderRadius: 10, padding: "10px 18px", minWidth: 120 }}>
              <div style={{ fontSize: 9, textTransform: "uppercase", letterSpacing: ".12em", color: "var(--text-muted)", marginBottom: 4 }}>{k.label}</div>
              <div style={{ fontSize: 22, fontWeight: 800, color: k.color, lineHeight: 1 }}>{k.value}</div>
            </div>
          ))}
        </div>
      </div>

      <div style={{ padding: "0 32px 32px" }}>
        {/* Filtri + orizzonte */}
        <div style={{ display: "flex", gap: 12, marginBottom: 24, flexWrap: "wrap", alignItems: "center" }}>
          <select value={mesi} onChange={e => setMesi(Number(e.target.value))} className="select" style={{ minWidth: 140 }}>
            <option value={1}>1 mese</option>
            <option value={2}>2 mesi</option>
            <option value={3}>3 mesi</option>
            <option value={6}>6 mesi</option>
            <option value={12}>12 mesi</option>
          </select>

          <select value={filterTipo} onChange={e => setFilterTipo(e.target.value as "" | "scadenza" | "ticket")} className="select" style={{ minWidth: 150 }}>
            <option value="">Tutti i tipi</option>
            <option value="scadenza">Scadenze attività</option>
            <option value="ticket">Ticket PM</option>
          </select>

          <select value={filterPriorita} onChange={e => setFilterPriorita(e.target.value)} className="select" style={{ minWidth: 140 }}>
            <option value="">Tutte le priorità</option>
            <option value="Alta">Alta</option>
            <option value="Media">Media</option>
            <option value="Bassa">Bassa</option>
          </select>

          <button onClick={() => { setFilterTipo(""); setFilterPriorita(""); }} style={{ padding: "6px 14px", background: "transparent", border: "1px solid rgba(75,85,99,0.5)", color: "var(--text-secondary)", borderRadius: 6, cursor: "pointer", fontSize: 12 }}>
            Azzera filtri
          </button>

          <button onClick={load} style={{ marginLeft: "auto", padding: "6px 14px", background: "rgba(99,102,241,0.1)", border: "1px solid rgba(99,102,241,0.3)", color: "#818cf8", borderRadius: 6, cursor: "pointer", fontSize: 12, fontWeight: 600 }}>
            ↻ Aggiorna
          </button>
        </div>

        {loading ? (
          <div style={{ color: "var(--text-muted)", textAlign: "center", padding: 48, fontSize: 13 }}>Caricamento...</div>
        ) : (
          <div style={{ display: "grid", gridTemplateColumns: "1fr 340px", gap: 24, alignItems: "start" }}>
            {/* Colonna calendario */}
            <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
              {months.map(({ year, month }) => {
                const weeks = buildMonthGrid(year, month);
                return (
                  <div key={`${year}-${month}`} style={{ background: "var(--bg-card)", border: "1px solid rgba(255,255,255,0.07)", borderRadius: 14, overflow: "hidden" }}>
                    {/* Header mese */}
                    <div style={{ padding: "14px 20px", borderBottom: "1px solid rgba(255,255,255,0.06)", display: "flex", alignItems: "center", gap: 12 }}>
                      <span style={{ fontWeight: 800, fontSize: 15, color: "var(--text-primary)" }}>{MESE_NOMI[month]} {year}</span>
                      <span style={{ fontSize: 11, color: "var(--text-muted)", background: "rgba(255,255,255,0.05)", padding: "2px 8px", borderRadius: 10 }}>
                        {Object.entries(byData).filter(([d]) => {
                          const dt = new Date(d + "T00:00:00");
                          return dt.getFullYear() === year && dt.getMonth() === month;
                        }).reduce((acc, [, evs]) => acc + evs.length, 0)} eventi
                      </span>
                    </div>
                    {/* Griglia */}
                    <div style={{ padding: "12px 16px" }}>
                      {/* Header giorni */}
                      <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: 2, marginBottom: 4 }}>
                        {GIORNO_NOMI_SHORT.map(g => (
                          <div key={g} style={{ textAlign: "center", fontSize: 9, fontWeight: 700, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: ".1em", padding: "4px 0" }}>{g}</div>
                        ))}
                      </div>
                      {/* Settimane */}
                      {weeks.map((week, wi) => (
                        <div key={wi} style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: 2 }}>
                          {week.map((day, di) => {
                            if (!day) return <div key={di} />;
                            const iso = `${day.getFullYear()}-${String(day.getMonth() + 1).padStart(2, "0")}-${String(day.getDate()).padStart(2, "0")}`;
                            const dayEventi = byData[iso] ?? [];
                            const isToday = day.toDateString() === today.toDateString();
                            const isSelected = selectedDay === iso;
                            const hasAlta = dayEventi.some(e => e.urgenza === "alta");

                            return (
                              <div
                                key={di}
                                onClick={() => setSelectedDay(isSelected ? null : iso)}
                                style={{
                                  borderRadius: 8,
                                  padding: "6px 4px",
                                  minHeight: 52,
                                  cursor: dayEventi.length > 0 ? "pointer" : "default",
                                  background: isSelected ? "rgba(99,102,241,0.15)" : isToday ? "rgba(99,102,241,0.07)" : "transparent",
                                  border: isSelected ? "1px solid rgba(99,102,241,0.4)" : isToday ? "1px solid rgba(99,102,241,0.2)" : "1px solid transparent",
                                  transition: "background 0.1s",
                                }}
                              >
                                <div style={{
                                  fontSize: 11, fontWeight: isToday ? 800 : 500,
                                  color: isToday ? "#818cf8" : "var(--text-secondary)",
                                  textAlign: "center", marginBottom: 3,
                                }}>
                                  {day.getDate()}
                                </div>
                                {/* Dots eventi */}
                                {dayEventi.length > 0 && (
                                  <div style={{ display: "flex", flexWrap: "wrap", gap: 2, justifyContent: "center" }}>
                                    {dayEventi.slice(0, 3).map((e, i) => (
                                      <div key={i} style={{
                                        width: 6, height: 6, borderRadius: "50%",
                                        background: hasAlta && e.urgenza === "alta" ? "#f87171" : PRIO_COLOR[e.priorita?.toLowerCase()] ?? "#818cf8",
                                        flexShrink: 0,
                                      }} />
                                    ))}
                                    {dayEventi.length > 3 && (
                                      <div style={{ fontSize: 8, color: "var(--text-muted)", lineHeight: 1.5 }}>+{dayEventi.length - 3}</div>
                                    )}
                                  </div>
                                )}
                              </div>
                            );
                          })}
                        </div>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Colonna dettaglio / lista */}
            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              {/* Dettaglio giorno selezionato */}
              {selectedDay && (
                <div style={{ background: "var(--bg-card)", border: "1px solid rgba(99,102,241,0.25)", borderRadius: 14, overflow: "hidden", borderTop: "2px solid #6366f1" }}>
                  <div style={{ padding: "12px 16px", borderBottom: "1px solid rgba(255,255,255,0.06)", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                    <span style={{ fontWeight: 800, fontSize: 13, color: "var(--text-primary)" }}>
                      {new Date(selectedDay + "T12:00:00").toLocaleDateString("it-IT", { weekday: "long", day: "numeric", month: "long" })}
                    </span>
                    <button onClick={() => setSelectedDay(null)} style={{ background: "transparent", border: "none", color: "var(--text-muted)", cursor: "pointer", fontSize: 14 }}>✕</button>
                  </div>
                  <div style={{ padding: 12, display: "flex", flexDirection: "column", gap: 8, maxHeight: 320, overflowY: "auto" }}>
                    {eventiGiornoSelezionato.length === 0 ? (
                      <div style={{ color: "var(--text-muted)", fontSize: 12, textAlign: "center", padding: 16 }}>Nessun evento in questa data.</div>
                    ) : (
                      eventiGiornoSelezionato.map((e, i) => (
                        <div key={i} style={{ background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.05)", borderRadius: 8, padding: "10px 12px" }}>
                          <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 4 }}>
                            <span style={{ fontSize: 9, fontWeight: 700, padding: "2px 6px", borderRadius: 4, ...urgenzaStyle(e.urgenza) }}>
                              {e.tipo === "scadenza" ? "SCADENZA" : "TICKET PM"}
                            </span>
                            <span style={{ fontSize: 9, fontWeight: 700, padding: "2px 6px", borderRadius: 4, color: PRIO_COLOR[e.priorita?.toLowerCase()] ?? "var(--text-muted)", background: `${PRIO_COLOR[e.priorita?.toLowerCase()] ?? "#818cf8"}20` }}>
                              {e.priorita}
                            </span>
                          </div>
                          <div style={{ fontSize: 12, color: "var(--text-primary)", fontWeight: 600, lineHeight: 1.3, marginBottom: 3 }}>{e.descrizione}</div>
                          {e.asset_nome && <div style={{ fontSize: 11, color: "var(--text-muted)" }}>Asset: {e.asset_nome}</div>}
                          {e.frequenza_giorni && <div style={{ fontSize: 10, color: "var(--text-muted)" }}>Frequenza: ogni {e.frequenza_giorni}gg</div>}
                          {e.stato && <div style={{ fontSize: 10, color: "var(--text-muted)" }}>Stato: {e.stato}</div>}
                        </div>
                      ))
                    )}
                  </div>
                </div>
              )}

              {/* Lista prossimi eventi (sempre visibile) */}
              <div style={{ background: "var(--bg-card)", border: "1px solid rgba(255,255,255,0.07)", borderRadius: 14, overflow: "hidden" }}>
                <div style={{ padding: "12px 16px", borderBottom: "1px solid rgba(255,255,255,0.06)", fontWeight: 800, fontSize: 13, color: "var(--text-primary)" }}>
                  Prossimi eventi
                </div>
                <div style={{ maxHeight: 480, overflowY: "auto" }}>
                  {eventiFiltrati
                    .filter(e => new Date(e.data + "T00:00:00") >= new Date(today.getFullYear(), today.getMonth(), today.getDate()))
                    .sort((a, b) => a.data.localeCompare(b.data))
                    .slice(0, 30)
                    .map((e, i) => {
                      const diff = Math.round((new Date(e.data + "T12:00:00").getTime() - today.getTime()) / 86400000);
                      return (
                        <div
                          key={i}
                          onClick={() => setSelectedDay(e.data)}
                          style={{ padding: "10px 16px", borderBottom: "1px solid rgba(255,255,255,0.03)", cursor: "pointer", background: selectedDay === e.data ? "rgba(99,102,241,0.06)" : "transparent", transition: "background 0.1s" }}
                        >
                          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 3 }}>
                            <div style={{ width: 7, height: 7, borderRadius: "50%", background: e.urgenza === "alta" ? "#f87171" : "#fbbf24", flexShrink: 0 }} />
                            <span style={{ fontSize: 11, color: "var(--text-primary)", fontWeight: 600, flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{e.descrizione}</span>
                            <span style={{ fontSize: 10, color: diff <= 3 ? "#f87171" : diff <= 7 ? "#fbbf24" : "var(--text-muted)", fontWeight: 600, flexShrink: 0 }}>
                              {diff === 0 ? "oggi" : diff === 1 ? "domani" : `+${diff}gg`}
                            </span>
                          </div>
                          <div style={{ display: "flex", gap: 8, paddingLeft: 15 }}>
                            <span style={{ fontSize: 10, color: "var(--text-muted)" }}>{new Date(e.data + "T12:00:00").toLocaleDateString("it-IT", { day: "2-digit", month: "short" })}</span>
                            {e.asset_nome && <span style={{ fontSize: 10, color: "#818cf8" }}>{e.asset_nome}</span>}
                            <span style={{ fontSize: 9, color: "var(--text-muted)", background: "rgba(255,255,255,0.05)", padding: "1px 5px", borderRadius: 3 }}>
                              {e.tipo === "scadenza" ? "Scadenza" : "Ticket PM"}
                            </span>
                          </div>
                        </div>
                      );
                    })}
                  {eventiFiltrati.filter(e => new Date(e.data + "T00:00:00") >= new Date(today.getFullYear(), today.getMonth(), today.getDate())).length === 0 && (
                    <div style={{ color: "var(--text-muted)", textAlign: "center", padding: "32px 16px", fontSize: 12 }}>
                      Nessuna scadenza nel periodo selezionato.
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
