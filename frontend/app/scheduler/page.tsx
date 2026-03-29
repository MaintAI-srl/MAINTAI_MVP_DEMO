"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { API_BASE } from "../lib/api";
import styles from "./scheduler.module.css";

// ── Types ──────────────────────────────────────────────────────────────────

interface SchedulerItem {
  id: number;
  titolo: string;
  asset_name: string;
  asset_id: number | null;
  tipo: string;
  priorita: string;
  fascia: string;
  durata_ore: number;
  tecnico: string;
  tecnico_id: number | null;
  date: string | null;
  start_hour: number | null;
  end_hour: number | null;
  planned_start: string | null;
  planned_finish: string | null;
  locked: boolean;
}

interface TecnicoOption {
  id: number;
  nome: string;
  skill: string;
  ore_giornaliere: number;
}

interface OreGiorno {
  date: string;
  ore_residue: number;
}

interface OreSettimana {
  tecnico: string;
  ore_per_giorno: OreGiorno[];
}

interface OreResidue {
  tecnico: string;
  ore_residue: number;
}

interface SchedulerData {
  items: SchedulerItem[];
  non_allocati: SchedulerItem[];
  ore_residue: OreResidue[];
  ore_settimana: OreSettimana[];
  start_date: string;
  forecast?: Record<string, {
    is_sunny: boolean;
    is_rainy: boolean;
    wind_max: number;
    rain_sum: number;
  }>;
  assets_metadata?: Record<number, {
    weather_sunny_required: boolean;
    weather_max_wind_kmh?: number;
    weather_max_rain_mm?: number;
  }>;
}


// ── Style constants ────────────────────────────────────────────────────────

const navBtn: React.CSSProperties = {
  background: "transparent",
  border: "1px solid rgba(148,163,184,.3)",
  color: "var(--text-muted)",
  borderRadius: 10,
  padding: "6px 12px",
  cursor: "pointer",
  fontSize: "1rem",
  lineHeight: 1,
};

const thStyle: React.CSSProperties = {
  background: "rgba(15,23,42,.95)",
  color: "var(--text-muted)",
  textTransform: "uppercase",
  fontSize: ".72rem",
  letterSpacing: ".1em",
  padding: "10px 12px",
  fontWeight: 700,
  borderBottom: "1px solid rgba(255,255,255,.07)",
  whiteSpace: "nowrap",
};

const tdStyle: React.CSSProperties = {
  minWidth: 130,
  padding: "10px 12px",
  borderBottom: "1px solid rgba(255,255,255,.06)",
  verticalAlign: "top",
};

// ── Helpers ────────────────────────────────────────────────────────────────

function toIso(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function addDays(d: Date, n: number): Date {
  const r = new Date(d);
  r.setDate(r.getDate() + n);
  return r;
}

function formatDate(iso: string): string {
  return new Date(iso + "T00:00:00").toLocaleDateString("it-IT", {
    weekday: "short",
    day: "2-digit",
    month: "short",
  });
}

function formatHour(value?: number | null): string {
  if (value == null) return "-";
  const h = Math.floor(value);
  const m = Math.round((value - h) * 60);
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

function priorityBadgeClass(v: string): string {
  switch (v?.toLowerCase()) {
    case "alta":
    case "critica":
      return styles.badgeRose;
    case "media":
      return styles.badgeAmber;
    case "bassa":
      return styles.badgeEmerald;
    default:
      return styles.badgeSlate;
  }
}

function fasciaBadgeClass(v: string): string {
  switch (v?.toLowerCase()) {
    case "mattina":
      return styles.badgeSky;
    case "pomeriggio":
      return styles.badgeAmber;
    case "sera":
    case "notte":
      return styles.badgeViolet;
    default:
      return styles.badgeSlate;
  }
}

function ganttBlockClass(item: SchedulerItem): string {
  switch (item.priorita?.toLowerCase()) {
    case "alta":
    case "critica":
      return styles.ganttBlockRose;
    case "media":
      return styles.ganttBlockAmber;
    case "bassa":
      return styles.ganttBlockSky;
    default:
      return styles.ganttBlockViolet;
  }
}

// ── GanttTechRow sub-component ─────────────────────────────────────────────

function GanttTechRow({ 
  tecnico, 
  items, 
  forecast, 
  assetsMeta 
}: { 
  tecnico: string; 
  items: SchedulerItem[];
  forecast?: SchedulerData["forecast"];
  assetsMeta?: SchedulerData["assets_metadata"];
}) {
  const assetNames = [...new Set(items.map((i) => i.asset_name).filter(Boolean))].join(", ");
  return (
    <div className={styles.ganttRow}>
      <div className={styles.ganttRowMeta}>
        <div className={styles.ganttRowTech}>{tecnico}</div>
        <div className={styles.ganttRowAsset}>{assetNames || "—"}</div>
      </div>
      <div className={styles.ganttTrack}>
        {items.map((item) => {
          let hasWeatherWarning = false;
          let warningReason = "";
          
          if (item.date && item.asset_id && assetsMeta?.[item.asset_id] && forecast?.[item.date]) {
            const meta = assetsMeta[item.asset_id];
            const fc = forecast[item.date];
            if (item.priorita?.toLowerCase() !== "alta") {
              if (meta.weather_sunny_required && !fc.is_sunny) { hasWeatherWarning = true; warningReason = "Richiede Sole"; }
              if (meta.weather_max_wind_kmh && fc.wind_max > meta.weather_max_wind_kmh) { hasWeatherWarning = true; warningReason = `Vento > ${meta.weather_max_wind_kmh}km/h`; }
              if (meta.weather_max_rain_mm && fc.rain_sum > meta.weather_max_rain_mm) { hasWeatherWarning = true; warningReason = `Pioggia > ${meta.weather_max_rain_mm}mm`; }
            }
          }

          return item.start_hour != null && item.end_hour != null ? (
            <div
              key={item.id}
              className={`${styles.ganttBlock} ${ganttBlockClass(item)}`}
              style={{
                left: `${(item.start_hour / 24) * 100}%`,
                width: `${((item.end_hour - item.start_hour) / 24) * 100}%`,
                outline: item.locked ? "1px solid rgba(129,140,248,.7)" : undefined,
                display: "flex",
                alignItems: "center",
                overflow: "hidden"
              }}
              title={`${formatHour(item.start_hour)} – ${formatHour(item.end_hour)} · ${item.titolo}${item.locked ? " [bloccato]" : ""}${warningReason ? ` · ATTENZIONE: ${warningReason}` : ""}`}
            >
              {hasWeatherWarning && (
                <span style={{ fontSize: 10, marginRight: 4, filter: "drop-shadow(0 0 2px rgba(0,0,0,0.5))" }} title={warningReason}>⚠️</span>
              )}
              <span className={styles.ganttBlockTime}>{formatHour(item.start_hour)}</span>
              <span className={styles.ganttBlockTitle}>{item.titolo}</span>
            </div>
          ) : null;
        })}
      </div>
    </div>
  );
}


// ── Main component ─────────────────────────────────────────────────────────

export default function SchedulerPage() {
  const [data, setData] = useState<SchedulerData | null>(null);
  const [loading, setLoading] = useState(false);
  const [ricalcolaMsg, setRicalcolaMsg] = useState("");
  const [view, setView] = useState<"day" | "week">("day");
  const [selectedDay, setSelectedDay] = useState<string>(toIso(new Date()));
  const [tecniciList, setTecniciList] = useState<TecnicoOption[]>([]);

  // Inline edit state
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editTecnicoId, setEditTecnicoId] = useState<number | null>(null);
  const [editDurata, setEditDurata] = useState<number>(1);
  const [editFascia, setEditFascia] = useState<string>("diurna");
  const [editDate, setEditDate] = useState<string>("");
  const [editTime, setEditTime] = useState<string>("");
  const [saving, setSaving] = useState(false);

  const [listPage, setListPage] = useState(1);
  const [listFilter, setListFilter] = useState<"all" | "PM" | "CM" | "alta">("all");
  const ITEMS_PER_PAGE = 10;

  // ── Derived state ──────────────────────────────────────────────────────

  const weekStart = useMemo<Date>(() => {
    const d = new Date(selectedDay + "T00:00:00");
    const day = d.getDay();
    const offset = day === 0 ? -6 : -(day - 1);
    return addDays(d, offset);
  }, [selectedDay]);

  const weekDays = useMemo<string[]>(() => {
    return Array.from({ length: 7 }, (_, i) => toIso(addDays(weekStart, i)));
  }, [weekStart]);

  const scheduleBase = useMemo<string>(() => {
    return view === "day" ? selectedDay : toIso(weekStart);
  }, [view, selectedDay, weekStart]);

  const dayItems = useMemo<SchedulerItem[]>(() => {
    if (!data) return [];
    return data.items.filter((item) => item.date === selectedDay);
  }, [data, selectedDay]);

  const dayItemsByTech = useMemo<[string, SchedulerItem[]][]>(() => {
    const map = new Map<string, SchedulerItem[]>();
    for (const item of dayItems) {
      const key = item.tecnico ?? "—";
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(item);
    }
    return Array.from(map.entries());
  }, [dayItems]);

  const tecnici = useMemo<string[]>(() => {
    if (!data) return [];
    const set = new Set(data.items.map((i) => i.tecnico));
    return Array.from(set).sort();
  }, [data]);

  const weekMatrix = useMemo<Record<string, Record<string, SchedulerItem[]>>>(() => {
    if (!data) return {};
    const matrix: Record<string, Record<string, SchedulerItem[]>> = {};
    for (const item of data.items) {
      if (!item.date) continue;
      if (!matrix[item.tecnico]) matrix[item.tecnico] = {};
      if (!matrix[item.tecnico][item.date]) matrix[item.tecnico][item.date] = [];
      matrix[item.tecnico][item.date].push(item);
    }
    return matrix;
  }, [data]);

  const oreSettimanaUsate = useMemo<Record<string, number>>(() => {
    if (!data) return {};
    // Somma le durate effettivamente allocate per tecnico nella settimana corrente
    const result: Record<string, number> = {};
    for (const item of data.items) {
      if (!item.date || !weekDays.includes(item.date)) continue;
      result[item.tecnico] = (result[item.tecnico] ?? 0) + item.durata_ore;
    }
    return result;
  }, [data, weekDays]);

  // ── Effects ────────────────────────────────────────────────────────────

  useEffect(() => {
    loadPlan(scheduleBase);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scheduleBase]);

  useEffect(() => {
    fetch(`${API_BASE}/tecnici`)
      .then((r) => r.json())
      .then((d) => setTecniciList(d))
      .catch(() => {});
  }, []);

  // ── Actions ────────────────────────────────────────────────────────────

  const loadPlan = useCallback(async (startDate: string) => {
    setLoading(true);
    try {
      const res = await fetch(`${API_BASE}/scheduler/gantt?start_date=${startDate}`);
      if (res.ok) {
        const json = (await res.json()) as SchedulerData;
        setData(json);
      }
    } finally {
      setLoading(false);
    }
  }, []);

  async function handleRicalcola() {
    setLoading(true);
    setRicalcolaMsg("");
    try {
      const res = await fetch(`${API_BASE}/scheduler/ricalcola`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ start_date: scheduleBase }),
      });
      if (res.ok) {
        const json = (await res.json()) as SchedulerData;
        const msg = `Piano ricalcolato: ${json.items.length} allocate, ${json.non_allocati.length} non allocate.`;
        setRicalcolaMsg(msg);
        // Ricarica dal DB per avere il campo locked aggiornato correttamente
        await loadPlan(scheduleBase);
      }
    } finally {
      setLoading(false);
    }
  }

  function openEdit(item: SchedulerItem) {
    setEditingId(item.id);
    setEditTecnicoId(item.tecnico_id ?? null);
    setEditDurata(item.durata_ore);
    setEditFascia(item.fascia);
    setEditDate(item.planned_start ? item.planned_start.substring(0, 10) : "");
    setEditTime(item.planned_start ? item.planned_start.substring(11, 16) : "");
  }

  async function unlockItem(id: number) {
    try {
      await fetch(`${API_BASE}/tickets/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ planned_start: null, planned_finish: null }),
      });
      await loadPlan(scheduleBase);
    } catch { /* ignore */ }
  }

  function cancelEdit() {
    setEditingId(null);
  }

  async function saveEdit() {
    if (editingId == null) return;
    
    // --- WEATHER VALIDATION (Visual Only) ---
    // Rimozione confirm() come richiesto. Il monitoraggio rimane visibile via icone ⚠️ nel Gantt.
    // --------------------------


    setSaving(true);
    try {
      let planned_start = null;
      let planned_finish = null;
      if (editDate && editTime) {
        const pStart = new Date(`${editDate}T${editTime}:00`);
        planned_start = pStart.getTime() ? pStart.toISOString() : null;
        if (planned_start) {
            const pFinish = new Date(pStart.getTime() + editDurata * 3600000);
            planned_finish = pFinish.toISOString();
        }
      }


      const body: Record<string, unknown> = {
        fascia_oraria: editFascia,
        durata_stimata_ore: editDurata,
        tecnico_id: editTecnicoId,
        // Se l'utente ha inserito una data/ora, blocchiamo il ticket, altrimenti si sblocca e l'AI decide.
        planned_start,
        planned_finish,
      };
      const res = await fetch(`${API_BASE}/tickets/${editingId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (res.ok) {
        setEditingId(null);
        await loadPlan(scheduleBase);
      }
    } finally {
      setSaving(false);
    }
  }

  // ── Computed display values ────────────────────────────────────────────

  const totalOreResidue = data
    ? data.ore_residue.reduce((acc, r) => acc + r.ore_residue, 0)
    : 0;

  const filteredItems = useMemo(() => {
    if (!data) return [];
    let res = data.items;
    if (listFilter === "alta") res = res.filter(i => i.priorita?.toLowerCase() === "alta" || i.priorita?.toLowerCase() === "critica");
    if (listFilter === "PM") res = res.filter(i => i.tipo === "PM");
    if (listFilter === "CM") res = res.filter(i => i.tipo === "CM");
    return res;
  }, [data, listFilter]);

  const pagedItems = useMemo(() => {
    const start = (listPage - 1) * ITEMS_PER_PAGE;
    return filteredItems.slice(start, start + ITEMS_PER_PAGE);
  }, [filteredItems, listPage]);

  const totalPages = Math.ceil(filteredItems.length / ITEMS_PER_PAGE) || 1;

  // ── Render ─────────────────────────────────────────────────────────────

  return (
    <div className={styles.page}>
      {/* ── Sticky header bar ──────────────────────────────────────────── */}
      <div className={styles.stickyBar}>
        {/* Title + KPI chips */}
        <div className={styles.stickyLeft}>
          <div>
            <span className={styles.stickyEyebrow}>Planning Engine</span>
            <span className={styles.stickyTitle}>Scheduler</span>
          </div>
          <div className={styles.kpiRow}>
            <span className={styles.kpiChip}>
              <span className={styles.kpiLabel}>Allocate</span>
              <strong className={styles.kpiValue}>{data ? data.items.length : "—"}</strong>
            </span>
            <span className={styles.kpiChip}>
              <span className={styles.kpiLabel}>Non alloc.</span>
              <strong className={`${styles.kpiValue} ${data && data.non_allocati.length > 0 ? styles.kpiValueWarn : ""}`}>
                {data ? data.non_allocati.length : "—"}
              </strong>
            </span>
            <span className={styles.kpiChip}>
              <span className={styles.kpiLabel}>Ore residue</span>
              <strong className={styles.kpiValue}>{data ? totalOreResidue.toFixed(1) : "—"}h</strong>
            </span>
          </div>
        </div>

        {/* Controls */}
        <div className={styles.stickyControls}>
          {/* Ricalcola */}
          <button
            onClick={handleRicalcola}
            disabled={loading}
            style={{
              background: loading
                ? "rgba(99,102,241,.4)"
                : "linear-gradient(135deg, #6366f1 0%, #4f46e5 100%)",
              color: "#fff",
              border: "none",
              borderRadius: 10,
              padding: "7px 16px",
              fontWeight: 700,
              fontSize: ".88rem",
              cursor: loading ? "not-allowed" : "pointer",
              opacity: loading ? 0.7 : 1,
              whiteSpace: "nowrap",
            }}
          >
            {loading ? "Ricalcolo in corso..." : "Ricalcola"}
          </button>

          {/* Day / Week toggle */}
          <div style={{ display: "flex", gap: 4 }}>
            {(["day", "week"] as const).map((v) => (
              <button
                key={v}
                onClick={() => setView(v)}
                style={{
                  ...navBtn,
                  background:
                    view === v
                      ? "linear-gradient(135deg, #6366f1 0%, #4f46e5 100%)"
                      : "transparent",
                  color: view === v ? "#fff" : "var(--text-muted)",
                  border:
                    view === v
                      ? "1px solid #6366f1"
                      : "1px solid rgba(148,163,184,.3)",
                  padding: "5px 13px",
                  fontWeight: 700,
                  fontSize: ".85rem",
                }}
              >
                {v === "day" ? "Giorno" : "Settimana"}
              </button>
            ))}
          </div>

          {/* Date navigation */}
          {view === "day" ? (
            <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
              <button
                style={navBtn}
                onClick={() =>
                  setSelectedDay(toIso(addDays(new Date(selectedDay + "T00:00:00"), -1)))
                }
              >
                ‹
              </button>
              <input
                type="date"
                value={selectedDay}
                onChange={(e) => setSelectedDay(e.target.value)}
                style={{
                  background: "rgba(255,255,255,.06)",
                  border: "1px solid rgba(148,163,184,.25)",
                  borderRadius: 8,
                  color: "#f8fbff",
                  padding: "5px 8px",
                  fontSize: ".85rem",
                }}
              />
              <button
                style={navBtn}
                onClick={() =>
                  setSelectedDay(toIso(addDays(new Date(selectedDay + "T00:00:00"), 1)))
                }
              >
                ›
              </button>
              <span style={{ color: "var(--text-muted)", fontSize: ".85rem", whiteSpace: "nowrap" }}>
                {formatDate(selectedDay)}
              </span>
            </div>
          ) : (
            <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
              <button
                style={navBtn}
                onClick={() =>
                  setSelectedDay(toIso(addDays(new Date(selectedDay + "T00:00:00"), -7)))
                }
              >
                ‹
              </button>
              <span style={{ color: "#f8fbff", fontSize: ".85rem", fontWeight: 700, whiteSpace: "nowrap" }}>
                {formatDate(toIso(weekStart))} – {formatDate(toIso(addDays(weekStart, 6)))}
              </span>
              <button
                style={navBtn}
                onClick={() =>
                  setSelectedDay(toIso(addDays(new Date(selectedDay + "T00:00:00"), 7)))
                }
              >
                ›
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Ricalcola message */}
      {ricalcolaMsg && (
        <div
          style={{
            background: "rgba(16,185,129,.12)",
            border: "1px solid rgba(16,185,129,.28)",
            borderRadius: 14,
            padding: "10px 16px",
            color: "#6ee7b7",
            fontWeight: 700,
            fontSize: ".9rem",
          }}
        >
          {ricalcolaMsg}
        </div>
      )}

      {/* Content */}
      {!data ? (
        <div className={styles.loadingCard}>
          {loading ? "Caricamento piano in corso…" : "Nessun dato disponibile."}
        </div>
      ) : (
        <>
          {/* Gantt — day view */}
          {view === "day" && (
            <div className={styles.card}>
              <div className={styles.cardHead}>
                <h2 className={styles.cardTitle}>
                  Gantt — {formatDate(selectedDay)}
                </h2>
                <p className={styles.cardSubtitle}>
                  {dayItems.length} attività in questo giorno
                </p>
              </div>
              <div className={styles.ganttWrap}>
                <div className={styles.ganttHeader}>
                  <div className={styles.ganttHeaderLabel}>Tecnico / Asset</div>
                  <div className={styles.ganttHours}>
                    {Array.from({ length: 12 }, (_, i) => (
                      <div key={i} className={styles.ganttHour}>
                        {String(i * 2).padStart(2, "0")}
                      </div>
                    ))}
                  </div>
                </div>
                <div className={styles.ganttBody}>
                  {dayItemsByTech.length === 0 ? (
                    <div className={styles.empty}>
                      Nessuna attività pianificata per questo giorno.
                    </div>
                  ) : (
                    dayItemsByTech.map(([tecnico, items]) => (
                      <GanttTechRow 
                        key={tecnico} 
                        tecnico={tecnico} 
                        items={items} 
                        forecast={data.forecast}
                        assetsMeta={data.assets_metadata}
                      />
                    ))

                  )}
                </div>
              </div>
            </div>
          )}

          {/* Week view table */}
          {view === "week" && (
            <div className={styles.card}>
              <div className={styles.cardHead}>
                <h2 className={styles.cardTitle}>Vista settimana</h2>
                <p className={styles.cardSubtitle}>
                  {formatDate(toIso(weekStart))} –{" "}
                  {formatDate(toIso(addDays(weekStart, 6)))}
                </p>
              </div>
              <div style={{ overflowX: "auto" }}>
                <table
                  style={{
                    width: "100%",
                    borderCollapse: "collapse",
                    fontSize: ".9rem",
                  }}
                >
                  <thead>
                    <tr>
                      <th style={thStyle}>Tecnico</th>
                      {weekDays.map((d) => (
                        <th key={d} style={thStyle}>
                          {formatDate(d)}
                        </th>
                      ))}
                      <th style={thStyle}>Ore sett.</th>
                    </tr>
                  </thead>
                  <tbody>
                    {tecnici.map((tech) => {
                      const oreUsate = oreSettimanaUsate[tech] ?? 0;
                      const oreColor = oreUsate <= 35 ? "#6ee7b7" : "#fb7185";
                      return (
                        <tr key={tech}>
                          <td
                            style={{
                              ...tdStyle,
                              fontWeight: 700,
                              color: "#f8fbff",
                              minWidth: 160,
                            }}
                          >
                            {tech}
                          </td>
                          {weekDays.map((d) => {
                            const dayTasks = weekMatrix[tech]?.[d] ?? [];
                            return (
                              <td key={d} style={tdStyle}>
                                <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                                  {dayTasks.length === 0 ? (
                                    <span style={{ color: "rgba(148,163,184,.4)" }}>—</span>
                                  ) : (
                                    dayTasks.map((item) => {
                                      let pillBg = "rgba(99,102,241,.22)";
                                      let pillColor = "#c7d2fe";
                                      const p = item.priorita?.toLowerCase();
                                      if (p === "alta" || p === "critica") {
                                        pillBg = "rgba(244,63,94,.2)";
                                        pillColor = "#fda4af";
                                      } else if (p === "media") {
                                        pillBg = "rgba(245,158,11,.2)";
                                        pillColor = "#fde68a";
                                      } else if (p === "bassa") {
                                        pillBg = "rgba(16,185,129,.2)";
                                        pillColor = "#6ee7b7";
                                      }
                                      return (
                                        <span
                                          key={item.id}
                                          style={{
                                            background: pillBg,
                                            color: pillColor,
                                            borderRadius: 8,
                                            padding: "3px 8px",
                                            fontSize: ".78rem",
                                            fontWeight: 700,
                                            whiteSpace: "nowrap",
                                            overflow: "hidden",
                                            textOverflow: "ellipsis",
                                            maxWidth: 180,
                                            display: "block",
                                          }}
                                          title={item.titolo}
                                        >
                                          {item.titolo}
                                        </span>
                                      );
                                    })
                                  )}
                                </div>
                              </td>
                            );
                          })}
                          <td
                            style={{
                              ...tdStyle,
                              fontWeight: 700,
                              color: oreColor,
                              textAlign: "center",
                            }}
                          >
                            {oreUsate.toFixed(1)}h
                          </td>
                        </tr>
                      );
                    })}
                    {tecnici.length === 0 && (
                      <tr>
                        <td
                          colSpan={weekDays.length + 2}
                          style={{
                            ...tdStyle,
                            textAlign: "center",
                            color: "rgba(148,163,184,.6)",
                          }}
                        >
                          Nessun tecnico con attività questa settimana.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Non allocati */}
          <div className={styles.card}>
            <div className={styles.cardHead}>
              <h2 className={styles.cardTitle}>Non allocate</h2>
              <p className={styles.cardSubtitle}>
                {data.non_allocati.length} attività non pianificabili
              </p>
            </div>
            {data.non_allocati.length === 0 ? (
              <div className={styles.empty}>
                Tutte le attività sono state allocate.
              </div>
            ) : (
              <div className={styles.unallocatedGrid}>
                {data.non_allocati.map((item) => (
                  <div key={item.id} className={styles.unallocatedCard}>
                    <div className={styles.taskTop}>
                      <div>
                        <div className={styles.taskTitle}>{item.titolo}</div>
                        <div className={styles.taskMeta}>{item.asset_name}</div>
                      </div>
                      <span
                        className={`${styles.badge} ${priorityBadgeClass(item.priorita)}`}
                      >
                        {item.priorita}
                      </span>
                    </div>
                    <div
                      className={`${styles.taskBadges} ${styles.taskBadgesSpaced}`}
                    >
                      <span
                        className={`${styles.badge} ${fasciaBadgeClass(item.fascia)}`}
                      >
                        {item.fascia}
                      </span>
                      <span className={styles.hoursPill}>{item.durata_ore?.toFixed(1)}h</span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
          {/* Top grid */}
          <div className={styles.topGrid}>
            {/* Piano attività */}
            <div className={styles.card}>
              <div className={styles.cardHead} style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end" }}>
                <div>
                  <h2 className={styles.cardTitle}>Piano attività</h2>
                  <p className={styles.cardSubtitle}>
                    {data.items.length} attività pianificate —{" "}
                    {data.items.filter(i => !i.locked).length} modificabili,{" "}
                    {data.items.filter(i => i.locked).length} bloccate
                  </p>
                </div>
                <div style={{ display: "flex", gap: 6 }}>
                  {(["all", "PM", "CM", "alta"] as const).map(f => (
                    <button
                      key={f}
                      onClick={() => { setListFilter(f); setListPage(1); }}
                      style={{
                        background: listFilter === f ? "rgba(99,102,241,0.2)" : "transparent",
                        border: listFilter === f ? "1px solid rgba(99,102,241,0.5)" : "1px solid rgba(148,163,184,0.3)",
                        color: listFilter === f ? "#818cf8" : "var(--text-muted)",
                        borderRadius: 6, padding: "4px 10px", fontSize: ".8rem", cursor: "pointer", fontWeight: 600
                      }}
                    >
                      {f === "all" ? "Tutti" : f === "alta" ? "Alta Priorità" : f}
                    </button>
                  ))}
                </div>
              </div>
              {pagedItems.length === 0 ? (
                <div className={styles.empty}>Nessuna attività pianificata per questi filtri.</div>
              ) : (
                <div className={styles.list}>
                  {pagedItems.map((item) =>
                    editingId === item.id ? (
                      /* ── Inline edit form ── */
                      <div key={item.id} className={styles.taskCard} style={{ border: "1px solid rgba(99,102,241,.4)" }}>
                        <div className={styles.taskTitle} style={{ marginBottom: 12 }}>{item.titolo}</div>
                        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginBottom: 10 }}>
                          <label style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: ".82rem", color: "var(--text-muted)" }}>
                            Tecnico
                            <select
                              value={editTecnicoId ?? ""}
                              onChange={(e) => setEditTecnicoId(e.target.value ? Number(e.target.value) : null)}
                              style={{ background: "rgba(255,255,255,.06)", border: "1px solid rgba(148,163,184,.2)", borderRadius: 6, color: "#f8fbff", padding: "5px 8px", fontSize: ".85rem" }}
                            >
                              <option value="">— auto —</option>
                              {tecniciList.map((t) => (
                                <option key={t.id} value={t.id}>{t.nome}</option>
                              ))}
                            </select>
                          </label>
                          <label style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: ".82rem", color: "var(--text-muted)" }}>
                            Fascia
                            <select
                              value={editFascia}
                              onChange={(e) => setEditFascia(e.target.value)}
                              style={{ background: "rgba(255,255,255,.06)", border: "1px solid rgba(148,163,184,.2)", borderRadius: 6, color: "#f8fbff", padding: "5px 8px", fontSize: ".85rem" }}
                            >
                              <option value="diurna">diurna</option>
                              <option value="notturna">notturna</option>
                            </select>
                          </label>
                          <label style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: ".82rem", color: "var(--text-muted)" }}>
                            Durata (ore)
                            <input
                              type="number"
                              min={0.5}
                              step={0.5}
                              value={editDurata}
                              onChange={(e) => setEditDurata(Number(e.target.value))}
                              style={{ background: "rgba(255,255,255,.06)", border: "1px solid rgba(148,163,184,.2)", borderRadius: 6, color: "#f8fbff", padding: "5px 8px", fontSize: ".85rem" }}
                            />
                          </label>
                          <label style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: ".82rem", color: "#6ee7b7" }}>
                            Data Pianificata
                            <input
                              type="date"
                              value={editDate}
                              onChange={(e) => setEditDate(e.target.value)}
                              style={{ background: "rgba(16,185,129,.1)", border: "1px solid rgba(16,185,129,.3)", borderRadius: 6, color: "#6ee7b7", padding: "5px 8px", fontSize: ".85rem" }}
                            />
                          </label>
                          <label style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: ".82rem", color: "#6ee7b7" }}>
                            Ora Inizio
                            <input
                              type="time"
                              value={editTime}
                              onChange={(e) => setEditTime(e.target.value)}
                              style={{ background: "rgba(16,185,129,.1)", border: "1px solid rgba(16,185,129,.3)", borderRadius: 6, color: "#6ee7b7", padding: "5px 8px", fontSize: ".85rem" }}
                            />
                          </label>
                        </div>
                        <div style={{ display: "flex", gap: 8 }}>
                          <button
                            onClick={saveEdit}
                            disabled={saving}
                            style={{ flex: 1, background: "linear-gradient(135deg,#6366f1,#4f46e5)", color: "#fff", border: "none", borderRadius: 8, padding: "7px 0", fontWeight: 700, fontSize: ".85rem", cursor: "pointer" }}
                          >
                            {saving ? "…" : "Salva"}
                          </button>
                          <button
                            onClick={cancelEdit}
                            style={{ flex: 1, background: "transparent", color: "var(--text-muted)", border: "1px solid rgba(148,163,184,.2)", borderRadius: 8, padding: "7px 0", fontWeight: 700, fontSize: ".85rem", cursor: "pointer" }}
                          >
                            Annulla
                          </button>
                        </div>
                      </div>
                    ) : (
                      /* ── Normal task card ── */
                      <div
                        key={item.id}
                        className={`${styles.taskCard}${item.locked ? ` ${styles.taskCardLocked}` : ""}`}
                        onClick={() => !item.locked && openEdit(item)}
                        style={{
                          cursor: item.locked ? "default" : "pointer",
                        }}
                      >
                        <div className={styles.taskTop}>
                          <div>
                            <div className={styles.taskTitle}>{item.titolo}</div>
                            <div className={styles.taskMeta}>
                              {item.asset_name} · {item.tecnico}
                              {item.date && (
                                <> · <span style={{ color: "#6ee7b7" }}>{formatDate(item.date)}</span></>
                              )}
                            </div>
                          </div>
                          <div className={styles.taskBadges}>
                            {item.locked ? (
                              <button
                                onClick={(e) => { e.stopPropagation(); unlockItem(item.id); }}
                                title="Vuoi far pianificare all'AI? Clicca per sbloccare"
                                style={{ fontSize: ".72rem", color: "#fca5a5", background: "rgba(248,113,113,.15)", border: "1px solid rgba(248,113,113,.3)", borderRadius: 4, padding: "2px 7px", fontWeight: 700, cursor: "pointer", display: "flex", alignItems: "center", gap: 4 }}
                              >
                                📌 Manuale (sblocca)
                              </button>
                            ) : null}
                            <span className={`${styles.badge} ${priorityBadgeClass(item.priorita)}`}>
                              {item.priorita}
                            </span>
                          </div>
                        </div>
                        <div className={`${styles.taskBadges} ${styles.taskBadgesSpaced}`}>
                          <span className={`${styles.badge} ${fasciaBadgeClass(item.fascia)}`}>
                            {item.fascia}
                          </span>
                          <span className={styles.hoursPill}>{item.durata_ore?.toFixed(1)}h</span>
                          {item.start_hour != null && (
                            <span className={styles.timePill}>
                              {formatHour(item.start_hour)} – {formatHour(item.end_hour)}
                            </span>
                          )}
                        </div>
                      </div>
                    )
                  )}
                </div>
              )}
              {totalPages > 1 && (
                <div style={{ display: "flex", gap: 6, alignItems: "center", justifyContent: "center", marginTop: 16 }}>
                  <button style={navBtn} disabled={listPage <= 1} onClick={() => setListPage(p => p - 1)}>‹</button>
                  <span style={{ fontSize: ".85rem", color: "var(--text-secondary)" }}>Pag. {listPage} / {totalPages}</span>
                  <button style={navBtn} disabled={listPage >= totalPages} onClick={() => setListPage(p => p + 1)}>›</button>
                </div>
              )}
            </div>

            {/* Ore residue */}
            <div className={styles.card}>
              <div className={styles.cardHead}>
                <h2 className={styles.cardTitle}>Ore residue</h2>
                <p className={styles.cardSubtitle}>
                  Capacità disponibile per tecnico
                </p>
              </div>
              {data.ore_residue.length === 0 ? (
                <div className={styles.empty}>Nessun dato disponibile.</div>
              ) : (
                <div className={styles.residualList}>
                  {data.ore_residue.map((r) => (
                    <div key={r.tecnico} className={styles.residualRow}>
                      <div className={styles.residualTop}>
                        <span className={styles.residualName}>{r.tecnico}</span>
                        <span className={styles.residualValue}>
                          {r.ore_residue.toFixed(1)}h
                        </span>
                      </div>
                      <div className={styles.progressTrack}>
                        <div
                          className={styles.progressFill}
                          style={{
                            width: `${Math.min(100, (r.ore_residue / 8) * 100)}%`,
                          }}
                        />
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

        </>
      )}
    </div>
  );
}
