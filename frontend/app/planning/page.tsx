"use client";

import { useEffect, useState, useMemo } from "react";
import { apiGet, apiPost } from "../lib/api";
import { notify } from "@/lib/toast";

// ── Types ─────────────────────────────────────────────────────────────────────

type PlannedWO = {
  wo_id: number;
  technician_id: number;
  planned_date: string;        // "YYYY-MM-DD"
  time_slot: string;           // "HH:MM-HH:MM" (dall'AI)
  planned_start_time?: string; // "HH:MM" (dallo splitting)
  planned_end_time?: string;   // "HH:MM"
  duration_hours?: number;
  motivation: string;
  warnings: string[];
  is_continuation?: boolean;
  parent_wo_id?: number;
  wo_type?: string;            // "BD"|"PM"|"CM"
  title?: string;
  asset_name?: string;
};

type DeferredWO = { wo_id: number; reason: string };
type FermoAsset = { asset_id: number; triggered_by_wo_id: number };

type AIPlan = {
  id: number;
  created_at: string;
  status: string;
  horizon_days: number;
  confirmed_at: string | null;
  plan_json: {
    planned_workorders: PlannedWO[];
    deferred_workorders: DeferredWO[];
    fermo_assets: FermoAsset[];
    global_warnings: string[];
    efficiency_score?: number;
    efficiency_breakdown?: Record<string, number>;
  };
};

type TicketInfo = {
  id: number;
  titolo: string;
  tipo: string;
  priorita: string;
  asset_id: number | null;
};

type TecnicoInfo = { id: number; nome: string; cognome?: string | null; competenze?: string };
type AssetInfo   = { id: number; nome: string; area?: string };

type ViewTab = "giornaliero" | "settimanale" | "mensile";

// ── Helpers ───────────────────────────────────────────────────────────────────

function getWeekDates(): Date[] {
  const today = new Date();
  const day = today.getDay();
  const diff = today.getDate() - day + (day === 0 ? -6 : 1);
  const monday = new Date(today);
  monday.setDate(diff);
  monday.setHours(0, 0, 0, 0);
  return Array.from({ length: 5 }, (_, i) => {
    const d = new Date(monday);
    d.setDate(monday.getDate() + i);
    return d;
  });
}

function toYMD(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function woTypeColor(type?: string): string {
  if (!type) return "#6366f1";
  const t = type.toUpperCase();
  if (t.includes("BD") || t.includes("GUASTO") || t.includes("BREAKDOWN")) return "#ef4444";
  if (t.includes("CM")) return "#f59e0b";
  return "#22c55e"; // PM default
}

function woTypeBg(type?: string): string {
  if (!type) return "rgba(99,102,241,0.15)";
  const t = type.toUpperCase();
  if (t.includes("BD") || t.includes("GUASTO") || t.includes("BREAKDOWN")) return "rgba(239,68,68,0.15)";
  if (t.includes("CM")) return "rgba(245,158,11,0.15)";
  return "rgba(34,197,94,0.15)";
}

function woTypeLabel(type?: string, fallback?: string): string {
  const t = (type || fallback || "").toUpperCase();
  if (t.includes("BD") || t.includes("GUASTO") || t.includes("BREAKDOWN")) return "BD";
  if (t.includes("CM")) return "CM";
  if (t.includes("PM") || t.includes("PREVENTIV")) return "PM";
  return "CM";
}

function formatDate(d: string): string {
  if (!d) return "—";
  const dt = new Date(d + "T00:00:00");
  return dt.toLocaleDateString("it-IT", { weekday: "short", day: "2-digit", month: "short" });
}

function formatDateTime(d: string | null): string {
  if (!d) return "—";
  return new Date(d).toLocaleString("it-IT", {
    day: "2-digit", month: "2-digit", year: "numeric",
    hour: "2-digit", minute: "2-digit",
  });
}

function parseStartHour(wo: PlannedWO): number {
  if (wo.planned_start_time) {
    const [hh, mm] = wo.planned_start_time.split(":").map(Number);
    return hh + mm / 60;
  }
  if (wo.time_slot && wo.time_slot.includes("-")) {
    const start = wo.time_slot.split("-")[0].trim();
    const [hh, mm] = start.split(":").map(Number);
    return hh + (mm || 0) / 60;
  }
  return 8;
}

function parseEndHour(wo: PlannedWO): number {
  if (wo.planned_end_time) {
    const [hh, mm] = wo.planned_end_time.split(":").map(Number);
    return hh + mm / 60;
  }
  if (wo.planned_start_time && wo.duration_hours) {
    return parseStartHour(wo) + wo.duration_hours;
  }
  if (wo.time_slot && wo.time_slot.includes("-")) {
    const end = wo.time_slot.split("-")[1].trim();
    const [hh, mm] = end.split(":").map(Number);
    return hh + (mm || 0) / 60;
  }
  return parseStartHour(wo) + 2;
}

// ── Icons ─────────────────────────────────────────────────────────────────────

function IconBrain({ size = 20, color = "currentColor" }: { size?: number; color?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
      <path d="M9.5 2A2.5 2.5 0 0 1 12 4.5v15a2.5 2.5 0 0 1-4.96-.44 2.5 2.5 0 0 1-2.96-3.08 3 3 0 0 1-.34-5.58 2.5 2.5 0 0 1 1.32-4.24 2.5 2.5 0 0 1 1.44-3.16Z"/>
      <path d="M14.5 2A2.5 2.5 0 0 0 12 4.5v15a2.5 2.5 0 0 0 4.96-.44 2.5 2.5 0 0 0 2.96-3.08 3 3 0 0 0 .34-5.58 2.5 2.5 0 0 0-1.32-4.24 2.5 2.5 0 0 0-1.44-3.16Z"/>
    </svg>
  );
}

function IconCalendar({ size = 20, color = "currentColor" }: { size?: number; color?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="4" width="18" height="18" rx="2" ry="2"/>
      <line x1="16" y1="2" x2="16" y2="6"/>
      <line x1="8" y1="2" x2="8" y2="6"/>
      <line x1="3" y1="10" x2="21" y2="10"/>
    </svg>
  );
}

function IconWarning({ size = 16, color = "#fbbf24" }: { size?: number; color?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z"/>
      <path d="M12 9v4"/>
      <path d="M12 17h.01"/>
    </svg>
  );
}

function IconCheck({ size = 16, color = "#34d399" }: { size?: number; color?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round">
      <polyline points="20 6 9 17 4 12"/>
    </svg>
  );
}

function IconUser({ size = 16, color = "currentColor" }: { size?: number; color?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
      <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/>
      <circle cx="12" cy="7" r="4"/>
    </svg>
  );
}

function IconChevron({ size = 16, direction = "down", color = "currentColor" }: { size?: number; direction?: "up" | "down"; color?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"
      style={{ transform: direction === "up" ? "rotate(180deg)" : undefined }}>
      <polyline points="6 9 12 15 18 9"/>
    </svg>
  );
}

// ── Spinner ───────────────────────────────────────────────────────────────────

function Spinner() {
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 24, padding: "64px 0" }}>
      <div style={{
        width: 64, height: 64, borderRadius: "50%",
        border: "3px solid rgba(59,130,246,0.2)",
        borderTop: "3px solid #3b82f6",
        animation: "spin 0.8s linear infinite",
      }} />
      <div style={{ textAlign: "center" }}>
        <div style={{ fontSize: 18, fontWeight: 700, color: "var(--text-primary)", marginBottom: 6 }}>
          MARCO sta elaborando il piano...
        </div>
        <div style={{ fontSize: 13, color: "var(--text-secondary)", animation: "pulse 2s ease-in-out infinite" }}>
          Analisi ticket, bilanciamento backlog, verifica meteo e assegnazione tecnici in corso
        </div>
      </div>
      <style>{`
        @keyframes spin { to { transform: rotate(360deg); } }
        @keyframes pulse { 0%,100%{opacity:1} 50%{opacity:0.5} }
      `}</style>
    </div>
  );
}

// ── KPI Card ──────────────────────────────────────────────────────────────────

function KpiCard({ label, value, sub, color }: { label: string; value: string | number; sub?: string; color: string }) {
  return (
    <div style={{
      background: "var(--bg-card)", border: `1px solid ${color}33`,
      borderRadius: 12, padding: "20px 24px",
      display: "flex", flexDirection: "column", gap: 6,
      boxShadow: `0 0 24px ${color}11`,
    }}>
      <div style={{ fontSize: 10, fontWeight: 700, color, textTransform: "uppercase", letterSpacing: "0.12em" }}>{label}</div>
      <div style={{ fontSize: 32, fontWeight: 800, color: "var(--text-primary)", lineHeight: 1 }}>{value}</div>
      {sub && <div style={{ fontSize: 11, color: "var(--text-secondary)" }}>{sub}</div>}
    </div>
  );
}

// ── Efficiency Badge ──────────────────────────────────────────────────────────

function EfficiencyBadge({
  score, breakdown, showBreakdown, onToggle,
}: {
  score: number;
  breakdown?: Record<string, number>;
  showBreakdown: boolean;
  onToggle: () => void;
}) {
  const color = score >= 85 ? "#22c55e" : score >= 65 ? "#f59e0b" : "#ef4444";
  const label = score >= 85 ? "Ottimo" : score >= 65 ? "Buono" : "Da migliorare";

  const breakdownLabels: Record<string, string> = {
    copertura_backlog: "Copertura backlog",
    utilizzo_tecnici: "Utilizzo tecnici",
    bilanciamento_70_30: "Bilanciamento 70/30",
    match_skill: "Match skill",
    ottimizzazione_meteo: "Ottim. meteo",
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10, alignItems: "flex-end" }}>
      <button
        onClick={onToggle}
        style={{
          display: "flex", alignItems: "center", gap: 10,
          background: `rgba(${color === "#22c55e" ? "34,197,94" : color === "#f59e0b" ? "245,158,11" : "239,68,68"},0.12)`,
          border: `1px solid ${color}55`,
          borderRadius: 12, padding: "10px 18px",
          cursor: "pointer", outline: "none",
        }}
      >
        <div style={{ textAlign: "left" }}>
          <div style={{ fontSize: 10, fontWeight: 700, color, textTransform: "uppercase", letterSpacing: "0.1em" }}>
            Efficienza Piano
          </div>
          <div style={{ fontSize: 26, fontWeight: 900, color, lineHeight: 1.1 }}>
            {score}
            <span style={{ fontSize: 13, fontWeight: 600, marginLeft: 2 }}>/ 100</span>
          </div>
          <div style={{ fontSize: 11, color }}>{label}</div>
        </div>
        <IconChevron size={16} direction={showBreakdown ? "up" : "down"} color={color} />
      </button>

      {showBreakdown && breakdown && (
        <div style={{
          background: "var(--bg-card)", border: "1px solid rgba(148,163,184,0.15)",
          borderRadius: 12, padding: "16px 20px", minWidth: 260,
          display: "flex", flexDirection: "column", gap: 10,
        }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.1em", marginBottom: 4 }}>
            Breakdown Efficienza
          </div>
          {Object.entries(breakdown).map(([key, val]) => (
            <div key={key} style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12 }}>
                <span style={{ color: "var(--text-secondary)" }}>{breakdownLabels[key] || key}</span>
                <span style={{ fontWeight: 700, color: val >= 70 ? "#22c55e" : val >= 50 ? "#f59e0b" : "#ef4444" }}>
                  {val}%
                </span>
              </div>
              <div style={{ height: 6, background: "rgba(148,163,184,0.12)", borderRadius: 3, overflow: "hidden" }}>
                <div style={{
                  height: "100%", width: `${val}%`,
                  background: val >= 70 ? "#22c55e" : val >= 50 ? "#f59e0b" : "#ef4444",
                  borderRadius: 3, transition: "width 0.5s ease",
                }} />
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Gantt Giornaliero ─────────────────────────────────────────────────────────

const GANTT_SLOTS = 18; // 08:00 → 17:00, 30min each → 18 slots
const GANTT_START = 8;  // ora inizio

function GanttView({
  wos, tecnici, ticketMap, assetMap, selectedDay,
}: {
  wos: PlannedWO[];
  tecnici: TecnicoInfo[];
  ticketMap: Record<number, TicketInfo>;
  assetMap: Record<number, AssetInfo>;
  selectedDay: string;
}) {
  const dayWos = wos.filter(wo => wo.planned_date === selectedDay);

  const techIds = Array.from(new Set(dayWos.map(w => w.technician_id)));
  if (techIds.length === 0) {
    return (
      <div style={{ textAlign: "center", padding: "40px 20px", color: "var(--text-secondary)", fontSize: 14 }}>
        Nessun WO pianificato per il {formatDate(selectedDay)}.
      </div>
    );
  }

  // Slot labels: "08:00", "08:30", ..., "16:30"
  const slotLabels = Array.from({ length: GANTT_SLOTS }, (_, i) => {
    const totalMins = GANTT_START * 60 + i * 30;
    const hh = Math.floor(totalMins / 60);
    const mm = totalMins % 60;
    return `${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}`;
  });

  return (
    <div style={{ overflowX: "auto" }}>
      <div style={{
        display: "grid",
        gridTemplateColumns: `160px repeat(${GANTT_SLOTS}, minmax(48px, 1fr))`,
        minWidth: 160 + GANTT_SLOTS * 48,
        gap: 0,
      }}>
        {/* Header */}
        <div style={{ background: "rgba(148,163,184,0.06)", borderBottom: "1px solid rgba(148,163,184,0.12)", padding: "8px 12px", fontSize: 11, fontWeight: 700, color: "var(--text-muted)" }}>
          Tecnico
        </div>
        {slotLabels.map((s) => (
          <div key={s} style={{
            background: "rgba(148,163,184,0.06)", borderBottom: "1px solid rgba(148,163,184,0.12)",
            borderLeft: "1px solid rgba(148,163,184,0.06)",
            padding: "8px 4px", fontSize: 10, color: "var(--text-muted)",
            textAlign: "center", fontFamily: "var(--font-mono)",
          }}>
            {s}
          </div>
        ))}

        {/* Rows per technician */}
        {techIds.map((techId) => {
          const tecnico = tecnici.find(t => t.id === techId);
          const techWos = dayWos.filter(w => w.technician_id === techId);

          return (
            <div key={techId} style={{ display: "contents" }}>
              {/* Name cell */}
              <div style={{
                borderBottom: "1px solid rgba(148,163,184,0.08)",
                padding: "8px 12px",
                display: "flex", alignItems: "center", gap: 6,
                background: "rgba(59,130,246,0.03)",
              }}>
                <div style={{
                  width: 28, height: 28, borderRadius: "50%",
                  background: "linear-gradient(135deg,#3b82f6,#8b5cf6)",
                  display: "flex", alignItems: "center", justifyContent: "center",
                  flexShrink: 0,
                }}>
                  <IconUser size={13} color="#fff" />
                </div>
                <div>
                  <div style={{ fontSize: 12, fontWeight: 700, color: "var(--text-primary)", lineHeight: 1.2 }}>
                    {tecnico ? `${tecnico.nome}${tecnico.cognome ? " " + tecnico.cognome : ""}` : `T#${techId}`}
                  </div>
                </div>
              </div>

              {/* Timeline row: GANTT_SLOTS cells with overlaid WO blocks */}
              <div style={{
                gridColumn: `2 / ${GANTT_SLOTS + 2}`,
                position: "relative",
                borderBottom: "1px solid rgba(148,163,184,0.08)",
                height: 52,
                display: "grid",
                gridTemplateColumns: `repeat(${GANTT_SLOTS}, 1fr)`,
              }}>
                {/* Grid lines */}
                {slotLabels.map((s) => (
                  <div key={s} style={{ borderLeft: "1px solid rgba(148,163,184,0.06)", height: "100%" }} />
                ))}

                {/* WO blocks */}
                {techWos.map((wo) => {
                  const startH = parseStartHour(wo);
                  const endH = parseEndHour(wo);
                  const duration = endH - startH;

                  const colStart = Math.max(1, Math.round((startH - GANTT_START) * 2) + 1);
                  const colSpan  = Math.max(1, Math.round(duration * 2));
                  const colEnd   = Math.min(colStart + colSpan, GANTT_SLOTS + 1);

                  const tipo = wo.wo_type || ticketMap[wo.wo_id]?.tipo;
                  const isCont = wo.is_continuation;
                  const color = isCont ? "#8b5cf6" : woTypeColor(tipo);
                  const bg    = isCont ? "rgba(139,92,246,0.18)" : woTypeBg(tipo);
                  const assetName = assetMap[ticketMap[wo.wo_id]?.asset_id ?? 0]?.nome
                    || wo.asset_name || `WO#${wo.wo_id}`;
                  const startStr = wo.planned_start_time || wo.time_slot?.split("-")[0] || "?";
                  const endStr   = wo.planned_end_time   || wo.time_slot?.split("-")[1] || "?";

                  return (
                    <div
                      key={wo.wo_id}
                      title={`WO#${wo.wo_id} | ${assetName} | ${startStr}–${endStr} | ${duration.toFixed(1)}h${isCont ? " (continuazione)" : ""}`}
                      style={{
                        position: "absolute",
                        top: 6, bottom: 6,
                        left: `${((colStart - 1) / GANTT_SLOTS) * 100}%`,
                        width: `${((colEnd - colStart) / GANTT_SLOTS) * 100}%`,
                        background: bg,
                        border: `1.5px ${isCont ? "dashed" : "solid"} ${color}`,
                        borderRadius: 6,
                        display: "flex", alignItems: "center",
                        padding: "0 6px", overflow: "hidden",
                        cursor: "default",
                        zIndex: 1,
                      }}
                    >
                      <div style={{ display: "flex", alignItems: "center", gap: 4, overflow: "hidden", minWidth: 0 }}>
                        <span style={{ fontSize: 9, fontWeight: 800, color, letterSpacing: "0.05em", flexShrink: 0 }}>
                          {woTypeLabel(tipo)}
                        </span>
                        <span style={{ fontSize: 9, color: "var(--text-secondary)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                          {assetName.length > 12 ? assetName.slice(0, 12) + "…" : assetName}
                        </span>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── Kanban Settimanale ────────────────────────────────────────────────────────

function WeeklyKanban({
  wos, tecnici, ticketMap, assetMap,
}: {
  wos: PlannedWO[];
  tecnici: TecnicoInfo[];
  ticketMap: Record<number, TicketInfo>;
  assetMap: Record<number, AssetInfo>;
}) {
  const weekDates = useMemo(() => getWeekDates(), []);
  const todayStr = toYMD(new Date());
  const dayNames = ["Lun", "Mar", "Mer", "Gio", "Ven"];

  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(5, 1fr)", gap: 12 }}>
      {weekDates.map((d, idx) => {
        const ymd = toYMD(d);
        const isToday = ymd === todayStr;
        const dayWos = wos.filter(w => w.planned_date === ymd);
        const nBD = dayWos.filter(w => woTypeLabel(w.wo_type || ticketMap[w.wo_id]?.tipo) === "BD").length;
        const nPM = dayWos.filter(w => woTypeLabel(w.wo_type || ticketMap[w.wo_id]?.tipo) === "PM").length;
        const nCM = dayWos.filter(w => woTypeLabel(w.wo_type || ticketMap[w.wo_id]?.tipo) === "CM").length;

        return (
          <div key={ymd} style={{
            background: "var(--bg-card)",
            border: `1px solid ${isToday ? "rgba(59,130,246,0.5)" : "rgba(148,163,184,0.1)"}`,
            borderRadius: 12, overflow: "hidden",
            boxShadow: isToday ? "0 0 20px rgba(59,130,246,0.1)" : undefined,
          }}>
            {/* Day header */}
            <div style={{
              padding: "10px 14px",
              background: isToday ? "rgba(59,130,246,0.12)" : "rgba(148,163,184,0.04)",
              borderBottom: "1px solid rgba(148,163,184,0.08)",
            }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: isToday ? "#60a5fa" : "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.08em" }}>
                {dayNames[idx]}
              </div>
              <div style={{ fontSize: 16, fontWeight: 800, color: isToday ? "#60a5fa" : "var(--text-primary)" }}>
                {d.getDate()} {d.toLocaleDateString("it-IT", { month: "short" })}
              </div>
            </div>

            {/* WO cards */}
            <div style={{ padding: "10px", display: "flex", flexDirection: "column", gap: 6, minHeight: 80 }}>
              {dayWos.length === 0 ? (
                <div style={{ textAlign: "center", padding: "16px 0", fontSize: 11, color: "var(--text-muted)", opacity: 0.5 }}>
                  Nessun WO
                </div>
              ) : (
                dayWos.map(wo => {
                  const ticket = ticketMap[wo.wo_id];
                  const tecnico = tecnici.find(t => t.id === wo.technician_id);
                  const asset = assetMap[ticket?.asset_id ?? 0];
                  const tipo = wo.wo_type || ticket?.tipo;
                  const isCont = wo.is_continuation;
                  const color = isCont ? "#8b5cf6" : woTypeColor(tipo);
                  const startStr = wo.planned_start_time || wo.time_slot?.split("-")[0] || "";
                  const endStr   = wo.planned_end_time   || wo.time_slot?.split("-")[1] || "";
                  const assetName = (asset?.nome || wo.asset_name || `WO#${wo.wo_id}`).slice(0, 20);

                  return (
                    <div key={wo.wo_id} style={{
                      background: "rgba(255,255,255,0.03)",
                      border: `${isCont ? "2px dashed" : "1px solid"} ${color}44`,
                      borderRadius: 8, padding: "8px 10px",
                      display: "flex", flexDirection: "column", gap: 4,
                    }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                        <span style={{
                          fontSize: 9, fontWeight: 800, color,
                          background: woTypeBg(tipo), border: `1px solid ${color}44`,
                          borderRadius: 4, padding: "1px 5px", flexShrink: 0,
                        }}>
                          {woTypeLabel(tipo)}
                        </span>
                        <span style={{ fontSize: 11, fontWeight: 700, color: "var(--text-primary)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                          #{wo.wo_id}
                        </span>
                      </div>
                      <div style={{ fontSize: 10, color: "var(--text-secondary)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        {assetName}
                      </div>
                      <div style={{ display: "flex", alignItems: "center", gap: 6, justifyContent: "space-between" }}>
                        <span style={{ fontSize: 10, color: "#60a5fa", display: "flex", alignItems: "center", gap: 3 }}>
                          <IconUser size={9} color="#60a5fa" />
                          {tecnico ? tecnico.nome.split(" ")[0] : `T#${wo.technician_id}`}
                        </span>
                        {startStr && (
                          <span style={{ fontSize: 9, color: "var(--text-muted)", fontFamily: "var(--font-mono)" }}>
                            {startStr}{endStr ? `–${endStr}` : ""}
                          </span>
                        )}
                      </div>
                    </div>
                  );
                })
              )}
            </div>

            {/* Footer counters */}
            {dayWos.length > 0 && (
              <div style={{
                padding: "8px 14px",
                borderTop: "1px solid rgba(148,163,184,0.06)",
                display: "flex", gap: 8, fontSize: 10, fontWeight: 700,
              }}>
                {nBD > 0 && <span style={{ color: "#ef4444" }}>{nBD} BD</span>}
                {nPM > 0 && <span style={{ color: "#22c55e" }}>{nPM} PM</span>}
                {nCM > 0 && <span style={{ color: "#f59e0b" }}>{nCM} CM</span>}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

// ── Calendario Mensile ────────────────────────────────────────────────────────

function MonthlyCalendar({
  wos, ticketMap,
}: {
  wos: PlannedWO[];
  ticketMap: Record<number, TicketInfo>;
}) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const todayStr = toYMD(today);

  const [selectedDay, setSelectedDay] = useState<string | null>(null);

  // Compute month grid
  const year = today.getFullYear();
  const month = today.getMonth();
  const firstDay = new Date(year, month, 1);
  const lastDay = new Date(year, month + 1, 0);

  // Find first Monday of grid
  const startDow = firstDay.getDay(); // 0=Sun
  const offset = startDow === 0 ? 6 : startDow - 1;
  const gridStart = new Date(firstDay);
  gridStart.setDate(firstDay.getDate() - offset);

  // Total rows needed
  const totalDays = Math.ceil((offset + lastDay.getDate()) / 7) * 7;
  const gridDays: Date[] = Array.from({ length: totalDays }, (_, i) => {
    const d = new Date(gridStart);
    d.setDate(gridStart.getDate() + i);
    return d;
  });

  const dayLabels = ["Lun", "Mar", "Mer", "Gio", "Ven", "Sab", "Dom"];

  const wosByDay = useMemo(() => {
    const map: Record<string, PlannedWO[]> = {};
    for (const wo of wos) {
      if (!map[wo.planned_date]) map[wo.planned_date] = [];
      map[wo.planned_date].push(wo);
    }
    return map;
  }, [wos]);

  const selectedDayWos = selectedDay ? (wosByDay[selectedDay] || []) : [];

  return (
    <div style={{ display: "flex", gap: 20, alignItems: "flex-start" }}>
      {/* Calendar grid */}
      <div style={{ flex: 1, minWidth: 0 }}>
        {/* Day name headers */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: 4, marginBottom: 4 }}>
          {dayLabels.map(d => (
            <div key={d} style={{ textAlign: "center", fontSize: 11, fontWeight: 700, color: "var(--text-muted)", padding: "6px 0", textTransform: "uppercase", letterSpacing: "0.08em" }}>
              {d}
            </div>
          ))}
        </div>

        {/* Day cells */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: 4 }}>
          {gridDays.map((d) => {
            const ymd = toYMD(d);
            const isCurrentMonth = d.getMonth() === month;
            const isToday = ymd === todayStr;
            const isPast = d < today;
            const isSelected = selectedDay === ymd;
            const dayWos = wosByDay[ymd] || [];
            const dots3 = dayWos.slice(0, 3);
            const extra = dayWos.length - 3;

            return (
              <div
                key={ymd}
                onClick={() => dayWos.length > 0 ? setSelectedDay(isSelected ? null : ymd) : undefined}
                style={{
                  background: isSelected ? "rgba(59,130,246,0.15)" : "var(--bg-card)",
                  border: `1px solid ${isToday ? "rgba(59,130,246,0.5)" : isSelected ? "rgba(59,130,246,0.4)" : "rgba(148,163,184,0.1)"}`,
                  borderRadius: 8, padding: "8px 6px",
                  minHeight: 72, cursor: dayWos.length > 0 ? "pointer" : "default",
                  opacity: !isCurrentMonth || isPast ? 0.4 : 1,
                  display: "flex", flexDirection: "column", gap: 4,
                  transition: "all 0.15s",
                }}
              >
                <div style={{ fontSize: 12, fontWeight: isToday ? 800 : 600, color: isToday ? "#60a5fa" : "var(--text-primary)", textAlign: "right" }}>
                  {d.getDate()}
                </div>
                {dots3.length > 0 && (
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 3, marginTop: 2 }}>
                    {dots3.map(wo => (
                      <div key={wo.wo_id} style={{
                        width: 8, height: 8, borderRadius: "50%",
                        background: wo.is_continuation ? "#8b5cf6" : woTypeColor(wo.wo_type || ticketMap[wo.wo_id]?.tipo),
                        flexShrink: 0,
                      }} />
                    ))}
                    {extra > 0 && (
                      <span style={{ fontSize: 9, color: "var(--text-muted)", lineHeight: "8px" }}>+{extra}</span>
                    )}
                  </div>
                )}
                {dayWos.length > 0 && (
                  <div style={{ fontSize: 9, color: "var(--text-muted)", textAlign: "right" }}>
                    {dayWos.length} WO
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* Side panel */}
      {selectedDay && selectedDayWos.length > 0 && (
        <div style={{
          width: 280, flexShrink: 0,
          background: "var(--bg-card)", border: "1px solid rgba(148,163,184,0.12)",
          borderRadius: 12, padding: "16px",
          display: "flex", flexDirection: "column", gap: 10,
        }}>
          <div style={{ fontWeight: 700, fontSize: 14, color: "var(--text-primary)", borderBottom: "1px solid rgba(148,163,184,0.08)", paddingBottom: 10 }}>
            {formatDate(selectedDay)} — {selectedDayWos.length} WO
          </div>
          {selectedDayWos.map(wo => {
            const ticket = ticketMap[wo.wo_id];
            const tipo = wo.wo_type || ticket?.tipo;
            const color = wo.is_continuation ? "#8b5cf6" : woTypeColor(tipo);
            const startStr = wo.planned_start_time || wo.time_slot?.split("-")[0] || "";
            const endStr   = wo.planned_end_time   || wo.time_slot?.split("-")[1] || "";
            return (
              <div key={wo.wo_id} style={{
                background: "rgba(255,255,255,0.03)", border: `1px solid ${color}33`,
                borderRadius: 8, padding: "10px 12px",
                display: "flex", flexDirection: "column", gap: 4,
              }}>
                <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                  <span style={{
                    fontSize: 9, fontWeight: 800, color,
                    background: woTypeBg(tipo), borderRadius: 4,
                    padding: "1px 5px", border: `1px solid ${color}44`,
                  }}>
                    {woTypeLabel(tipo)}
                  </span>
                  <span style={{ fontSize: 12, fontWeight: 700, color: "var(--text-primary)" }}>
                    #{wo.wo_id}
                  </span>
                  {wo.is_continuation && (
                    <span style={{ fontSize: 9, color: "#8b5cf6", fontWeight: 700 }}>CONT.</span>
                  )}
                </div>
                {ticket?.titolo && (
                  <div style={{ fontSize: 11, color: "var(--text-secondary)" }}>{ticket.titolo}</div>
                )}
                {startStr && (
                  <div style={{ fontSize: 10, color: "var(--text-muted)", fontFamily: "var(--font-mono)" }}>
                    {startStr}{endStr ? ` – ${endStr}` : ""}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ── WO Table ──────────────────────────────────────────────────────────────────

function WOTable({
  wos, tecnici, ticketMap, assetMap,
}: {
  wos: PlannedWO[];
  tecnici: TecnicoInfo[];
  ticketMap: Record<number, TicketInfo>;
  assetMap: Record<number, AssetInfo>;
}) {
  if (wos.length === 0) {
    return (
      <div style={{ textAlign: "center", padding: "32px 0", color: "var(--text-secondary)", fontSize: 13 }}>
        Nessun WO per questo periodo.
      </div>
    );
  }

  return (
    <div style={{ overflowX: "auto" }}>
      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
        <thead>
          <tr style={{ borderBottom: "1px solid rgba(148,163,184,0.15)" }}>
            {["ID", "Asset", "Tipo", "Tecnico", "Data", "Inizio", "Fine", "Warning"].map(h => (
              <th key={h} style={{ padding: "8px 12px", textAlign: "left", fontWeight: 700, fontSize: 10, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.08em" }}>
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {wos.map(wo => {
            const ticket = ticketMap[wo.wo_id];
            const tecnico = tecnici.find(t => t.id === wo.technician_id);
            const asset = assetMap[ticket?.asset_id ?? 0];
            const tipo = wo.wo_type || ticket?.tipo;
            const color = wo.is_continuation ? "#8b5cf6" : woTypeColor(tipo);
            const startStr = wo.planned_start_time || wo.time_slot?.split("-")[0] || "—";
            const endStr   = wo.planned_end_time   || wo.time_slot?.split("-")[1] || "—";
            const assetName = (asset?.nome || wo.asset_name || `—`).slice(0, 24);

            return (
              <tr key={`${wo.wo_id}-${wo.planned_date}`} style={{ borderBottom: "1px solid rgba(148,163,184,0.06)" }}>
                <td style={{ padding: "10px 12px", color: "var(--text-primary)", fontWeight: 700 }}>
                  #{wo.wo_id}
                  {wo.is_continuation && <span style={{ fontSize: 9, color: "#8b5cf6", marginLeft: 4 }}>CONT</span>}
                </td>
                <td style={{ padding: "10px 12px", color: "var(--text-secondary)" }}>{assetName}</td>
                <td style={{ padding: "10px 12px" }}>
                  <span style={{
                    fontSize: 10, fontWeight: 800, color,
                    background: woTypeBg(tipo), border: `1px solid ${color}44`,
                    borderRadius: 4, padding: "2px 6px",
                  }}>
                    {woTypeLabel(tipo)}
                  </span>
                </td>
                <td style={{ padding: "10px 12px", color: "#60a5fa" }}>
                  {tecnico ? `${tecnico.nome}${tecnico.cognome ? " " + tecnico.cognome : ""}` : `#${wo.technician_id}`}
                </td>
                <td style={{ padding: "10px 12px", color: "var(--text-secondary)" }}>{formatDate(wo.planned_date)}</td>
                <td style={{ padding: "10px 12px", color: "var(--text-muted)", fontFamily: "var(--font-mono)" }}>{startStr}</td>
                <td style={{ padding: "10px 12px", color: "var(--text-muted)", fontFamily: "var(--font-mono)" }}>{endStr}</td>
                <td style={{ padding: "10px 12px" }}>
                  {wo.warnings && wo.warnings.length > 0 ? (
                    <span style={{ color: "#fbbf24", fontSize: 11 }}>
                      <IconWarning size={12} /> {wo.warnings.length}
                    </span>
                  ) : (
                    <span style={{ color: "#22c55e", fontSize: 11 }}>
                      <IconCheck size={12} />
                    </span>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────

export default function PlanningPage() {
  const [plan, setPlan] = useState<AIPlan | null>(null);
  const [loading, setLoading] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [loadingCurrent, setLoadingCurrent] = useState(true);
  const [tecnici, setTecnici] = useState<TecnicoInfo[]>([]);
  const [assets, setAssets] = useState<AssetInfo[]>([]);
  const [tickets, setTickets] = useState<TicketInfo[]>([]);
  const [days, setDays] = useState(7);
  const [viewTab, setViewTab] = useState<ViewTab>("giornaliero");
  const [showBreakdown, setShowBreakdown] = useState(false);
  const [activeListTab, setActiveListTab] = useState<"pianificati" | "rimandati" | "fermo">("pianificati");

  // Selected day for Gantt (default: today or first plan date)
  const [selectedGanttDay, setSelectedGanttDay] = useState<string>(() => toYMD(new Date()));

  // Lookup maps
  const tecnicoMap = useMemo(() => Object.fromEntries(tecnici.map(t => [t.id, t])), [tecnici]);
  const assetMap   = useMemo(() => Object.fromEntries(assets.map(a => [a.id, a])), [assets]);
  const ticketMap  = useMemo(() => Object.fromEntries(tickets.map(t => [t.id, t])), [tickets]);

  const planData = plan?.plan_json;
  const plannedWOs: PlannedWO[] = planData?.planned_workorders ?? [];
  const deferredWOs: DeferredWO[] = planData?.deferred_workorders ?? [];
  const fermoAssets: FermoAsset[] = planData?.fermo_assets ?? [];
  const globalWarnings: string[] = planData?.global_warnings ?? [];
  const efficiencyScore: number | undefined = planData?.efficiency_score;
  const efficiencyBreakdown: Record<string, number> | undefined = planData?.efficiency_breakdown;

  const nPlanned  = plannedWOs.length;
  const nDeferred = deferredWOs.length;
  const nFermo    = fermoAssets.length;
  const isDraft   = plan?.status === "draft";
  const isConfirmed = plan?.status === "confirmed";

  // Available gantt days from the plan
  const planDates = useMemo(() => {
    const dates = Array.from(new Set(plannedWOs.map(w => w.planned_date))).sort();
    return dates;
  }, [plannedWOs]);

  // When plan changes, set gantt to first available date
  useEffect(() => {
    if (planDates.length > 0) {
      const todayStr = toYMD(new Date());
      const todayInPlan = planDates.find(d => d === todayStr);
      setSelectedGanttDay(todayInPlan ?? planDates[0]);
    }
  }, [planDates]);

  // Load data on mount
  useEffect(() => {
    async function loadData() {
      try {
        const [tecniciData, assetsData, ticketsData] = await Promise.allSettled([
          apiGet<TecnicoInfo[]>("/tecnici"),
          apiGet<AssetInfo[] | { items: AssetInfo[] }>("/assets?limit=500"),
          apiGet<TicketInfo[] | { items: TicketInfo[] }>("/tickets?limit=500"),
        ]);
        if (tecniciData.status === "fulfilled") {
          const d = tecniciData.value;
          setTecnici(Array.isArray(d) ? d : []);
        }
        if (assetsData.status === "fulfilled") {
          const d = assetsData.value;
          setAssets(Array.isArray(d) ? d : (d as { items: AssetInfo[] }).items ?? []);
        }
        if (ticketsData.status === "fulfilled") {
          const d = ticketsData.value;
          setTickets(Array.isArray(d) ? d : (d as { items: TicketInfo[] }).items ?? []);
        }
      } catch {
        // Ignora errori lookup
      }

      try {
        const current = await apiGet<AIPlan | null>("/planning/current");
        if (current) setPlan(current);
      } catch {
        // Nessun piano draft
      } finally {
        setLoadingCurrent(false);
      }
    }
    loadData();
  }, []);

  const handleGenerate = async () => {
    setLoading(true);
    try {
      const result = await apiPost<AIPlan>("/planning/generate", { days });
      setPlan(result);
      setActiveListTab("pianificati");
      notify.success("Piano AI generato con successo!");
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Errore nella generazione del piano";
      notify.error(message);
    } finally {
      setLoading(false);
    }
  };

  const handleConfirm = async () => {
    if (!plan) return;
    setConfirming(true);
    try {
      const result = await apiPost<AIPlan>(`/planning/confirm/${plan.id}`, {});
      setPlan(result);
      notify.success("Piano confermato! Ticket aggiornati e asset messi in Fermo.");
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Errore nella conferma del piano";
      notify.error(message);
    } finally {
      setConfirming(false);
    }
  };

  const viewTabStyle = (tab: ViewTab): React.CSSProperties => ({
    padding: "8px 20px", borderRadius: 8, fontSize: 12, fontWeight: 700,
    cursor: "pointer", border: "none", outline: "none",
    background: viewTab === tab ? "rgba(59,130,246,0.18)" : "transparent",
    color: viewTab === tab ? "#60a5fa" : "var(--text-secondary)",
    borderBottom: viewTab === tab ? "2px solid #3b82f6" : "2px solid transparent",
    transition: "all 0.15s",
  });

  const listTabStyle = (tab: string): React.CSSProperties => ({
    padding: "8px 20px", borderRadius: 8, fontSize: 12, fontWeight: 700,
    cursor: "pointer", border: "none", outline: "none",
    background: activeListTab === tab ? "rgba(148,163,184,0.1)" : "transparent",
    color: activeListTab === tab ? "var(--text-primary)" : "var(--text-secondary)",
    borderBottom: activeListTab === tab ? "2px solid rgba(148,163,184,0.4)" : "2px solid transparent",
    transition: "all 0.15s",
  });

  return (
    <div style={{ padding: "0 0 40px" }}>
      {/* ── Hero ── */}
      <div style={{
        position: "relative", overflow: "hidden",
        background: "linear-gradient(135deg, rgba(16,24,40,0.95) 0%, rgba(10,18,35,0.98) 100%)",
        borderBottom: "1px solid rgba(148,163,184,0.1)",
        padding: "36px 32px 28px",
        marginBottom: 32,
      }}>
        {/* Mesh grid */}
        <div style={{
          position: "absolute", inset: 0, opacity: 0.04,
          backgroundImage: "linear-gradient(rgba(59,130,246,0.8) 1px, transparent 1px), linear-gradient(90deg, rgba(59,130,246,0.8) 1px, transparent 1px)",
          backgroundSize: "40px 40px",
          pointerEvents: "none",
        }} />
        {/* Glow */}
        <div style={{
          position: "absolute", top: -80, right: 80, width: 320, height: 320,
          borderRadius: "50%", background: "radial-gradient(circle, rgba(16,185,129,0.12) 0%, transparent 70%)",
          pointerEvents: "none",
        }} />

        <div style={{ position: "relative", zIndex: 1, display: "flex", alignItems: "flex-start", justifyContent: "space-between", flexWrap: "wrap", gap: 20 }}>
          {/* Left: title + description */}
          <div style={{ flex: 1, minWidth: 280 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 8 }}>
              <div style={{ width: 40, height: 40, borderRadius: 10, background: "linear-gradient(135deg,#10b981,#3b82f6)", display: "flex", alignItems: "center", justifyContent: "center" }}>
                <IconBrain size={22} color="#fff" />
              </div>
              <h1 style={{
                margin: 0, fontSize: "clamp(22px, 4vw, 30px)", fontWeight: 900,
                background: "linear-gradient(90deg, #10b981, #3b82f6, #8b5cf6)",
                WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent",
                letterSpacing: "-0.02em",
              }}>
                Pianificazione AI — MARCO
              </h1>
            </div>
            <p style={{ margin: 0, fontSize: 13, color: "var(--text-secondary)", maxWidth: 520 }}>
              Planner Senior RCM/TPM. Genera piani ottimizzati con bilanciamento backlog, vincoli meteo, splitting automatico e assegnazione intelligente.
            </p>
          </div>

          {/* Right: efficiency + controls */}
          <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 14 }}>
            {efficiencyScore !== undefined && (
              <EfficiencyBadge
                score={efficiencyScore}
                breakdown={efficiencyBreakdown}
                showBreakdown={showBreakdown}
                onToggle={() => setShowBreakdown(v => !v)}
              />
            )}

            <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap", justifyContent: "flex-end" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <span style={{ fontSize: 11, color: "var(--text-muted)", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.1em" }}>Orizzonte</span>
                <select
                  value={days}
                  onChange={e => setDays(Number(e.target.value))}
                  disabled={loading}
                  style={{
                    background: "rgba(255,255,255,0.06)", border: "1px solid rgba(148,163,184,0.2)",
                    borderRadius: 8, color: "var(--text-primary)", padding: "8px 12px",
                    fontSize: 13, outline: "none", cursor: "pointer",
                  }}
                >
                  <option value={3}>3 giorni</option>
                  <option value={7}>7 giorni</option>
                  <option value={14}>14 giorni</option>
                </select>
              </div>
              <button
                onClick={handleGenerate}
                disabled={loading}
                style={{
                  background: loading ? "rgba(16,185,129,0.3)" : "linear-gradient(135deg, #10b981, #059669)",
                  border: "none", borderRadius: 10, color: "#fff",
                  padding: "10px 24px", fontSize: 13, fontWeight: 700,
                  cursor: loading ? "not-allowed" : "pointer",
                  display: "flex", alignItems: "center", gap: 8,
                  boxShadow: loading ? "none" : "0 4px 20px rgba(16,185,129,0.3)",
                  transition: "all 0.2s",
                }}
              >
                <IconBrain size={16} color="#fff" />
                {loading ? "Elaborazione..." : plan ? "Rigenera Piano" : "Genera Piano"}
              </button>
              {isDraft && (
                <button
                  onClick={handleConfirm}
                  disabled={confirming}
                  style={{
                    background: confirming ? "rgba(52,211,153,0.3)" : "linear-gradient(135deg, #10b981, #059669)",
                    border: "none", borderRadius: 10, color: "#fff",
                    padding: "10px 24px", fontSize: 13, fontWeight: 700,
                    cursor: confirming ? "not-allowed" : "pointer",
                    display: "flex", alignItems: "center", gap: 8,
                    boxShadow: confirming ? "none" : "0 4px 20px rgba(16,185,129,0.25)",
                    transition: "all 0.2s",
                  }}
                >
                  <IconCheck size={16} color="#fff" />
                  {confirming ? "Conferma in corso..." : "Conferma Piano"}
                </button>
              )}
            </div>
          </div>
        </div>
      </div>

      <div style={{ padding: "0 32px" }}>
        {/* Loading */}
        {(loading || loadingCurrent) && <Spinner />}

        {/* Empty state */}
        {!loading && !loadingCurrent && !plan && (
          <div style={{
            display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
            padding: "80px 20px", gap: 16, textAlign: "center",
          }}>
            <div style={{ width: 72, height: 72, borderRadius: 20, background: "rgba(59,130,246,0.1)", display: "flex", alignItems: "center", justifyContent: "center", border: "1px solid rgba(59,130,246,0.2)" }}>
              <IconBrain size={36} color="#3b82f6" />
            </div>
            <div style={{ fontSize: 18, fontWeight: 700, color: "var(--text-primary)" }}>Nessun piano generato</div>
            <div style={{ fontSize: 13, color: "var(--text-secondary)", maxWidth: 400 }}>
              Clicca "Genera Piano" per avviare MARCO e creare un piano manutenzione ottimizzato per i prossimi {days} giorni.
            </div>
          </div>
        )}

        {/* Plan content */}
        {!loading && !loadingCurrent && plan && (
          <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>

            {/* Status banner */}
            <div style={{
              display: "flex", alignItems: "center", justifyContent: "space-between",
              flexWrap: "wrap", gap: 16,
              background: isConfirmed ? "rgba(52,211,153,0.08)" : "rgba(59,130,246,0.08)",
              border: `1px solid ${isConfirmed ? "rgba(52,211,153,0.25)" : "rgba(59,130,246,0.25)"}`,
              borderRadius: 12, padding: "16px 24px",
            }}>
              <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                  {isConfirmed ? <IconCheck size={18} color="#34d399" /> : <IconCalendar size={18} color="#3b82f6" />}
                  <span style={{ fontWeight: 700, fontSize: 14, color: isConfirmed ? "#34d399" : "#60a5fa" }}>
                    {isConfirmed ? "Piano Confermato" : "Bozza Piano"}
                  </span>
                </div>
                <span style={{ fontSize: 12, color: "var(--text-muted)" }}>
                  Generato il {formatDateTime(plan.created_at)}
                  {isConfirmed && plan.confirmed_at && ` — Confermato il ${formatDateTime(plan.confirmed_at)}`}
                </span>
                <span style={{ fontSize: 11, color: "var(--text-muted)", background: "rgba(255,255,255,0.05)", border: "1px solid rgba(148,163,184,0.15)", borderRadius: 5, padding: "2px 8px" }}>
                  Orizzonte: {plan.horizon_days} giorni
                </span>
              </div>
            </div>

            {/* KPI Strip */}
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: 16 }}>
              <KpiCard label="WO Pianificati" value={nPlanned} sub="pronti per esecuzione" color="#3b82f6" />
              <KpiCard label="WO Rimandati" value={nDeferred} sub="da rivalutare" color="#f87171" />
              <KpiCard label="Asset in Fermo" value={nFermo} sub="alla conferma" color="#fbbf24" />
              <KpiCard label="Warning Globali" value={globalWarnings.length} sub="richiede attenzione" color="#8b5cf6" />
            </div>

            {/* View tabs: Giornaliero / Settimanale / Mensile */}
            <div style={{ display: "flex", gap: 4, borderBottom: "1px solid rgba(148,163,184,0.1)" }}>
              <button style={viewTabStyle("giornaliero")} onClick={() => setViewTab("giornaliero")}>
                Giornaliero
              </button>
              <button style={viewTabStyle("settimanale")} onClick={() => setViewTab("settimanale")}>
                Settimanale
              </button>
              <button style={viewTabStyle("mensile")} onClick={() => setViewTab("mensile")}>
                Mensile
              </button>
            </div>

            {/* ── GANTT GIORNALIERO ── */}
            {viewTab === "giornaliero" && (
              <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
                {/* Day selector */}
                {planDates.length > 0 && (
                  <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
                    <span style={{ fontSize: 11, fontWeight: 700, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.1em", marginRight: 4 }}>
                      Giorno:
                    </span>
                    {planDates.map(d => (
                      <button
                        key={d}
                        onClick={() => setSelectedGanttDay(d)}
                        style={{
                          padding: "6px 14px", borderRadius: 8, fontSize: 12, fontWeight: 600,
                          cursor: "pointer", border: "none", outline: "none",
                          background: selectedGanttDay === d ? "rgba(59,130,246,0.2)" : "rgba(148,163,184,0.08)",
                          color: selectedGanttDay === d ? "#60a5fa" : "var(--text-secondary)",
                          borderBottom: selectedGanttDay === d ? "2px solid #3b82f6" : "2px solid transparent",
                          transition: "all 0.15s",
                        }}
                      >
                        {formatDate(d)}
                      </button>
                    ))}
                  </div>
                )}

                <div style={{
                  background: "var(--bg-card)", border: "1px solid rgba(148,163,184,0.1)",
                  borderRadius: 14, overflow: "hidden", padding: "16px",
                }}>
                  {/* Legend */}
                  <div style={{ display: "flex", gap: 14, marginBottom: 14, flexWrap: "wrap" }}>
                    {[
                      { label: "BD", color: "#ef4444" },
                      { label: "PM", color: "#22c55e" },
                      { label: "CM", color: "#f59e0b" },
                      { label: "Continuazione", color: "#8b5cf6" },
                    ].map(l => (
                      <div key={l.label} style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 11, color: "var(--text-secondary)" }}>
                        <div style={{ width: 12, height: 12, borderRadius: 3, background: l.color + "33", border: `1.5px solid ${l.color}` }} />
                        {l.label}
                      </div>
                    ))}
                  </div>
                  <GanttView
                    wos={plannedWOs}
                    tecnici={tecnici}
                    ticketMap={ticketMap}
                    assetMap={assetMap}
                    selectedDay={selectedGanttDay}
                  />
                </div>
              </div>
            )}

            {/* ── KANBAN SETTIMANALE ── */}
            {viewTab === "settimanale" && (
              <WeeklyKanban
                wos={plannedWOs}
                tecnici={tecnici}
                ticketMap={ticketMap}
                assetMap={assetMap}
              />
            )}

            {/* ── CALENDARIO MENSILE ── */}
            {viewTab === "mensile" && (
              <div style={{
                background: "var(--bg-card)", border: "1px solid rgba(148,163,184,0.1)",
                borderRadius: 14, padding: "20px",
              }}>
                <MonthlyCalendar
                  wos={plannedWOs}
                  ticketMap={ticketMap}
                />
              </div>
            )}

            {/* Global Warnings */}
            {globalWarnings.length > 0 && (
              <div style={{
                background: "rgba(251,191,36,0.06)", border: "1px solid rgba(251,191,36,0.2)",
                borderRadius: 12, padding: "16px 20px",
              }}>
                <div style={{ fontSize: 11, fontWeight: 700, color: "#fbbf24", textTransform: "uppercase", letterSpacing: "0.1em", marginBottom: 10, display: "flex", alignItems: "center", gap: 6 }}>
                  <IconWarning size={14} />
                  Warning Globali del Piano
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                  {globalWarnings.map((w, i) => (
                    <div key={i} style={{ fontSize: 12, color: "var(--text-secondary)", display: "flex", alignItems: "flex-start", gap: 8 }}>
                      <span style={{ color: "#fbbf24", marginTop: 1 }}>•</span>
                      {w}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* ── LISTA WO ── */}
            <div style={{
              background: "var(--bg-card)", border: "1px solid rgba(148,163,184,0.1)",
              borderRadius: 14, overflow: "hidden",
            }}>
              <div style={{ padding: "16px 20px", borderBottom: "1px solid rgba(148,163,184,0.08)" }}>
                <div style={{ fontSize: 13, fontWeight: 700, color: "var(--text-primary)", marginBottom: 12 }}>
                  Dettaglio Work Orders
                </div>
                <div style={{ display: "flex", gap: 4, borderBottom: "1px solid rgba(148,163,184,0.08)", paddingBottom: 0 }}>
                  <button style={listTabStyle("pianificati")} onClick={() => setActiveListTab("pianificati")}>
                    Pianificati ({nPlanned})
                  </button>
                  <button style={listTabStyle("rimandati")} onClick={() => setActiveListTab("rimandati")}>
                    Rimandati ({nDeferred})
                  </button>
                  {nFermo > 0 && (
                    <button style={listTabStyle("fermo")} onClick={() => setActiveListTab("fermo")}>
                      Asset Fermo ({nFermo})
                    </button>
                  )}
                </div>
              </div>

              <div style={{ padding: "16px 20px" }}>
                {/* Pianificati: tabella */}
                {activeListTab === "pianificati" && (
                  <WOTable wos={plannedWOs} tecnici={tecnici} ticketMap={ticketMap} assetMap={assetMap} />
                )}

                {/* Rimandati */}
                {activeListTab === "rimandati" && (
                  <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                    {deferredWOs.length === 0 ? (
                      <div style={{ textAlign: "center", padding: "32px 0", color: "var(--text-secondary)", fontSize: 13 }}>
                        Nessun work order rimandato.
                      </div>
                    ) : (
                      deferredWOs.map(dwo => {
                        const ticket = ticketMap[dwo.wo_id];
                        return (
                          <div key={dwo.wo_id} style={{
                            background: "rgba(248,113,113,0.04)", border: "1px solid rgba(248,113,113,0.15)",
                            borderRadius: 10, padding: "14px 18px",
                            display: "flex", alignItems: "flex-start", gap: 14,
                          }}>
                            <div style={{ marginTop: 2 }}>
                              <IconWarning size={18} color="#f87171" />
                            </div>
                            <div style={{ flex: 1 }}>
                              <div style={{ fontWeight: 700, fontSize: 14, color: "var(--text-primary)", marginBottom: 4 }}>
                                #{dwo.wo_id} — {ticket?.titolo || "Work Order"}
                              </div>
                              {ticket && (
                                <div style={{ fontSize: 11, color: "var(--text-muted)", marginBottom: 6 }}>
                                  Tipo: {ticket.tipo} | Priorità: {ticket.priorita}
                                </div>
                              )}
                              <div style={{ fontSize: 12, color: "#f87171" }}>{dwo.reason}</div>
                            </div>
                          </div>
                        );
                      })
                    )}
                  </div>
                )}

                {/* Fermo */}
                {activeListTab === "fermo" && (
                  <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                    {fermoAssets.length === 0 ? (
                      <div style={{ textAlign: "center", padding: "32px 0", color: "var(--text-secondary)", fontSize: 13 }}>
                        Nessun asset andrà in Fermo.
                      </div>
                    ) : (
                      fermoAssets.map(fa => {
                        const asset = assetMap[fa.asset_id];
                        const triggerTicket = ticketMap[fa.triggered_by_wo_id];
                        return (
                          <div key={fa.asset_id} style={{
                            background: "rgba(251,191,36,0.04)", border: "1px solid rgba(251,191,36,0.2)",
                            borderRadius: 10, padding: "16px 20px",
                            display: "flex", alignItems: "flex-start", gap: 14,
                          }}>
                            <div style={{
                              width: 40, height: 40, borderRadius: 10, flexShrink: 0,
                              background: "rgba(251,191,36,0.15)", border: "1px solid rgba(251,191,36,0.3)",
                              display: "flex", alignItems: "center", justifyContent: "center",
                            }}>
                              <svg width={20} height={20} viewBox="0 0 24 24" fill="none" stroke="#fbbf24" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
                                <rect x="2" y="7" width="20" height="14" rx="2"/>
                                <path d="M16 7V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v2"/>
                                <line x1="12" y1="12" x2="12" y2="16"/>
                                <line x1="12" y1="16" x2="12.01" y2="16"/>
                              </svg>
                            </div>
                            <div style={{ flex: 1 }}>
                              <div style={{ fontWeight: 700, fontSize: 14, color: "#fbbf24", marginBottom: 4 }}>
                                Asset #{fa.asset_id} — {asset?.nome || "Asset"}
                              </div>
                              {asset?.area && (
                                <div style={{ fontSize: 11, color: "var(--text-muted)", marginBottom: 6 }}>Area: {asset.area}</div>
                              )}
                              <div style={{ fontSize: 12, color: "var(--text-secondary)" }}>
                                Passerà in stato <strong style={{ color: "#fbbf24" }}>FERMO</strong> alla conferma del piano,
                                attivato dal WO #{fa.triggered_by_wo_id}
                                {triggerTicket && <span> — {triggerTicket.titolo}</span>}.
                              </div>
                              {!isConfirmed && (
                                <div style={{ marginTop: 6, fontSize: 11, color: "#fbbf24", opacity: 0.8 }}>
                                  Stato attuale attivo. Confermando il piano, questo asset entrerà in FERMO.
                                </div>
                              )}
                              {isConfirmed && (
                                <div style={{ marginTop: 6, fontSize: 11, color: "#34d399" }}>
                                  Asset impostato in FERMO alla conferma del piano.
                                </div>
                              )}
                            </div>
                          </div>
                        );
                      })
                    )}
                  </div>
                )}
              </div>
            </div>

          </div>
        )}
      </div>
    </div>
  );
}
