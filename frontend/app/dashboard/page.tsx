"use client";

import { CSSProperties, useEffect, useMemo, useState } from "react";
import { apiGet } from "../lib/api";
import { notify } from "@/lib/toast";
import { useAuth } from "../lib/auth";
import StatusToggle from "../components/StatusToggle";
import Skeleton, { SkeletonStats } from "../components/Skeleton";
import {
  DndContext,
  DragEndEvent,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import {
  SortableContext,
  arrayMove,
  sortableKeyboardCoordinates,
  useSortable,
  rectSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import {
  PieChart, Pie, Cell, Tooltip, Legend, ResponsiveContainer,
  BarChart, Bar, XAxis, YAxis, CartesianGrid, AreaChart, Area, LineChart, Line,
} from "recharts";

type ChartItem = { name: string; value: number };
type DashboardData = {
  assets: number;
  asset_stati: Record<string, number>;
  tecnici: number;
  tecnici_disponibili: number;
  ticket_aperti: number;
  ticket_pianificati: number;
  ticket_in_corso: number;
  ticket_chiusi: number;
  areas: string[];
};
const EMPTY_DASHBOARD: DashboardData = {
  assets: 0,
  asset_stati: {},
  tecnici: 0,
  tecnici_disponibili: 0,
  ticket_aperti: 0,
  ticket_pianificati: 0,
  ticket_in_corso: 0,
  ticket_chiusi: 0,
  areas: [],
};
type DashboardCharts = {
  ticket_by_priority: ChartItem[];
  ticket_by_status: ChartItem[];
  ticket_by_fascia: ChartItem[];
  ticket_by_tipo: ChartItem[];
  asset_by_stato: ChartItem[];
};
type TrendData = { labels: string[]; values: number[]; total: number };
type KpiAssetItem = {
  asset_id: number; asset_sito?: string; asset_nome: string; asset_codice: string; asset_area: string;
  stato: string; mtbf_giorni: number; oee_pct: number;
  n_guasti: number; downtime_ore_30gg: number;
  stato_changed_at?: string | null;
  downtime_seconds?: number | null;
};
type KpiAsset = { assets: KpiAssetItem[]; aggregati: { avg_mtbf_giorni: number; avg_oee_pct: number } };
type KpiOptionId =
  | "asset_totali"
  | "asset_servizio"
  | "asset_fermi"
  | "asset_guasti"
  | "tecnici_attivi"
  | "ticket_aperti"
  | "ticket_in_corso"
  | "ticket_chiusi"
  | "ticket_pianificati"
  | "mtbf_medio"
  | "oee_medio";
type ChartDataId =
  | "ticket_by_priority"
  | "ticket_by_status"
  | "ticket_by_fascia"
  | "ticket_by_tipo"
  | "asset_by_stato"
  | "mtbf_by_asset"
  | "oee_by_asset"
  | "downtime_by_asset"
  | "guasti_by_asset";
type ChartDisplayType = "pie" | "bar" | "area" | "line";
type DashboardWidget =
  | { id: string; type: "kpi"; kpi: KpiOptionId }
  | { id: string; type: "chart"; chartData: ChartDataId; chartType: ChartDisplayType }
  | { id: string; type: "asset_table" };
type AssetColumnFilters = {
  sito: string;
  codice: string;
  asset: string;
  area: string;
  stato: string;
};
type KpiOption = {
  id: KpiOptionId;
  label: string;
  value: number | string;
  accent: string;
  sub?: string;
  icon: React.ReactNode;
};
type ChartOption = {
  id: ChartDataId;
  title: string;
  subtitle: string;
  data: ChartItem[];
  accent: string;
};

const DASHBOARD_WIDGETS_STORAGE_KEY = "maintai.dashboard.widgets.v3";
const DEFAULT_DASHBOARD_WIDGETS: DashboardWidget[] = [
  { id: "widget-asset", type: "kpi", kpi: "asset_totali" },
  { id: "widget-tech", type: "kpi", kpi: "tecnici_attivi" },
  { id: "widget-open", type: "kpi", kpi: "ticket_aperti" },
  { id: "widget-in-progress", type: "kpi", kpi: "ticket_in_corso" },
  { id: "widget-closed", type: "kpi", kpi: "ticket_chiusi" },
  { id: "widget-planned", type: "kpi", kpi: "ticket_pianificati" },
  { id: "widget-guasti", type: "kpi", kpi: "asset_guasti" },
  { id: "widget-priority-chart", type: "chart", chartData: "ticket_by_priority", chartType: "pie" },
  { id: "widget-mtbf", type: "kpi", kpi: "mtbf_medio" },
  { id: "widget-oee", type: "kpi", kpi: "oee_medio" },
  { id: "widget-asset-chart", type: "chart", chartData: "asset_by_stato", chartType: "bar" },
  { id: "widget-oee-chart", type: "chart", chartData: "oee_by_asset", chartType: "area" },
  { id: "widget-asset-detail", type: "asset_table" },
];

function normalizeDashboardWidgets(saved: unknown): DashboardWidget[] {
  if (!Array.isArray(saved)) return DEFAULT_DASHBOARD_WIDGETS;
  const valid = saved.filter((item): item is DashboardWidget =>
    !!item?.id && (
      item.type === "asset_table" ||
      (item.type === "kpi" && !!item.kpi) ||
      (item.type === "chart" && !!item.chartData && !!item.chartType)
    )
  );
  const ids = new Set(valid.map((item) => item.id));
  const missingDefaults = DEFAULT_DASHBOARD_WIDGETS.filter((item) => !ids.has(item.id));
  return [...valid, ...missingDefaults];
}

// ── Icons ───────────────────────────────────────────────────────────────────
function IconBox({ size = 20, color = "currentColor" }: { size?: number; color?: string }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round"><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/><polyline points="3.27 6.96 12 12.01 20.73 6.96"/><line x1="12" y1="22.08" x2="12" y2="12"/></svg>;
}
function IconUsers({ size = 20, color = "currentColor" }: { size?: number; color?: string }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>;
}
function IconTicket({ size = 20, color = "currentColor" }: { size?: number; color?: string }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round"><path d="M2 9a3 3 0 0 1 0 6v2a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-2a3 3 0 0 1 0-6V7a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2Z"/><path d="M13 5v2"/><path d="M13 17v2"/><path d="M13 11v2"/></svg>;
}
function IconCalendar({ size = 20, color = "currentColor" }: { size?: number; color?: string }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>;
}
function IconActivity({ size = 20, color = "currentColor" }: { size?: number; color?: string }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/></svg>;
}
function IconAlert({ size = 20, color = "currentColor" }: { size?: number; color?: string }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>;
}
function IconCheck({ size = 20, color = "currentColor" }: { size?: number; color?: string }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>;
}
function IconPlay({ size = 20, color = "currentColor" }: { size?: number; color?: string }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round"><polygon points="5 3 19 12 5 21 5 3"/></svg>;
}
function IconPercent({ size = 20, color = "currentColor" }: { size?: number; color?: string }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round"><line x1="19" y1="5" x2="5" y2="19"/><circle cx="6.5" cy="6.5" r="2.5"/><circle cx="17.5" cy="17.5" r="2.5"/></svg>;
}

// ── Helpers ──────────────────────────────────────────────────────────────────
function formatDowntime(secondsFromBackend: number | null | undefined, statoChangedAt: string | null | undefined): string {
  if (!statoChangedAt) return "—";
  const ts = new Date(statoChangedAt).getTime();
  if (isNaN(ts)) return "—";
  const totalSec = Math.floor((Date.now() - ts) / 1000);
  if (totalSec < 0) return "—";
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  return `${h}h ${String(m).padStart(2,'0')}m ${String(s).padStart(2,'0')}s`;
}

function DowntimeTicker({ statoChangedAt, secondsFromBackend }: { statoChangedAt?: string | null, secondsFromBackend?: number | null }) {
  const [, setTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setTick(t => t + 1), 1000);
    return () => clearInterval(id);
  }, []);
  return (
    <span style={{ fontFamily: "var(--font-mono)", fontSize: 12, color: "#f87171", fontWeight: 700, background: "rgba(248,113,113,0.1)", padding: "4px 10px", borderRadius: 6, border: "1px solid rgba(248,113,113,0.25)" }}>
      🔴 {formatDowntime(secondsFromBackend, statoChangedAt)}
    </span>
  );
}

const PRIORITY_COLORS = ["#f05252", "#f6a233", "#22d3a0", "#7d94b5"];
const STATO_ASSET_COLORS: Record<string, string> = { service: "#10d9b0", stopped: "#f6a233", "out of service": "#f05252" };
const chartTooltipStyle = { background: "var(--surface-2)", border: "1px solid rgba(91,143,255,0.2)", color: "var(--text-primary)", fontSize: 12, borderRadius: 10, boxShadow: "0 8px 32px rgba(0,0,0,0.5)" };

// ── Circular Ring Progress ───────────────────────────────────────────────────
function RingProgress({ value, max, color, size = 100, label, sublabel }: { value: number; max: number; color: string; size?: number; label: string; sublabel: string }) {
  const r = 38;
  const circ = 2 * Math.PI * r;
  const pct = Math.min(value / max, 1);
  const dash = pct * circ;
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 20 }}>
      <div style={{ position: "relative", width: size, height: size, flexShrink: 0 }}>
        <svg width={size} height={size} viewBox="0 0 100 100">
          <circle cx="50" cy="50" r={r} fill="none" stroke="var(--border-subtle)" strokeWidth="9" />
          <circle cx="50" cy="50" r={r} fill="none" stroke={color} strokeWidth="9"
            strokeDasharray={`${dash} ${circ}`} strokeLinecap="round"
            transform="rotate(-90 50 50)"
            style={{ filter: `drop-shadow(0 0 6px ${color})` }}
          />
        </svg>
        <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", flexDirection: "column" }}>
          <span style={{ fontFamily: "var(--font-display)", fontSize: 18, fontWeight: 800, color, lineHeight: 1 }}>{value}</span>
          <span style={{ fontSize: 9, color: "var(--text-muted)", fontWeight: 600, letterSpacing: "0.08em" }}>/ {max}</span>
        </div>
      </div>
      <div>
        <div style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.12em", color: "var(--text-muted)", marginBottom: 4 }}>{sublabel}</div>
        <div style={{ fontFamily: "var(--font-display)", fontSize: 32, fontWeight: 800, color, lineHeight: 1 }}>{label}</div>
      </div>
    </div>
  );
}

// ── KPI Card — Redesigned
function KpiCard({ label, value, accent, sub, icon }: { label: string; value: number | string; accent: string; sub?: string; icon: React.ReactNode }) {
  return (
    <div style={{
      background: "var(--grad-card)",
      border: `1px solid var(--cobalt-dim)`,
      borderLeft: `3px solid ${accent}`,
      borderRadius: "var(--radius-lg)",
      padding: "18px 20px 16px",
      display: "flex", flexDirection: "column", gap: 10,
      position: "relative", overflow: "hidden",
      height: "100%",
      boxShadow: "var(--shadow-card)",
      transition: "transform 0.2s ease, box-shadow 0.25s ease, border-color 0.2s ease",
      cursor: "default",
    }}
      onMouseEnter={e => {
        const el = e.currentTarget as HTMLDivElement;
        el.style.transform = "translateY(-3px)";
        el.style.boxShadow = `0 0 0 1px ${accent}33, 0 12px 36px rgba(0,0,0,0.55), 0 4px 16px ${accent}15`;
        el.style.borderColor = `${accent}55`;
      }}
      onMouseLeave={e => {
        const el = e.currentTarget as HTMLDivElement;
        el.style.transform = "translateY(0)";
        el.style.boxShadow = "var(--shadow-card)";
        el.style.borderColor = `var(--cobalt-dim)`;
      }}
    >
      {/* Ambient glow */}
      <div style={{ position: "absolute", top: -20, right: -20, width: 100, height: 100, background: accent, opacity: 0.06, filter: "blur(28px)", borderRadius: "50%", pointerEvents: "none" }} />

      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", zIndex: 1 }}>
        <div style={{ fontSize: 9.5, fontWeight: 700, letterSpacing: "0.18em", textTransform: "uppercase", color: "var(--text-muted)" }}>{label}</div>
        <div style={{ padding: "6px", background: `${accent}14`, borderRadius: 8, border: `1px solid ${accent}22`, color: accent }}>{icon}</div>
      </div>
      <div style={{ fontFamily: "var(--font-display)", fontSize: 38, fontWeight: 800, color: "var(--text-primary)", lineHeight: 1, zIndex: 1, letterSpacing: "-2px", animation: "countUp 400ms cubic-bezier(0.22,1,0.36,1) both" }}>{value}</div>
      {sub && <div style={{ fontSize: 11, color: "var(--text-muted)", zIndex: 1, fontWeight: 400, borderTop: "1px solid var(--border-subtle)", paddingTop: 8, marginTop: -2 }}>{sub}</div>}
    </div>
  );
}

function WidgetControls({
  attributes,
  listeners,
  children,
}: {
  attributes: any;
  listeners?: any;
  children: React.ReactNode;
}) {
  return (
    <div style={{ position: "absolute", top: 10, right: 10, zIndex: 4, display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", justifyContent: "flex-end" }}>
      <button
        type="button"
        aria-label="Sposta riquadro"
        title="Sposta riquadro"
        {...attributes}
        {...listeners}
        style={{
          width: 31,
          height: 31,
          borderRadius: 9,
          border: "1px solid var(--border-default)",
          background: "var(--surface-2)",
          color: "var(--text-secondary)",
          cursor: "grab",
          fontWeight: 900,
          lineHeight: 1,
        }}
      >
        ::
      </button>
      {children}
    </div>
  );
}

function MiniSelect({
  label,
  value,
  options,
  onChange,
  width = 150,
}: {
  label: string;
  value: string;
  options: { value: string; label: string }[];
  onChange: (value: string) => void;
  width?: number;
}) {
  return (
    <select
      aria-label={label}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      onPointerDown={(e) => e.stopPropagation()}
      style={{
        height: 31,
        maxWidth: width,
        borderRadius: 9,
        border: "1px solid var(--border-default)",
        background: "var(--surface-2)",
        color: "var(--text-primary)",
        fontSize: 11,
        fontWeight: 700,
        padding: "0 8px",
        outline: "none",
      }}
    >
      {options.map((item) => (
        <option key={item.value} value={item.value}>{item.label}</option>
      ))}
    </select>
  );
}

function SortableDashboardTile({
  widget,
  editing,
  expanded = false,
  children,
}: {
  widget: DashboardWidget;
  editing: boolean;
  expanded?: boolean;
  children: (drag: { attributes: any; listeners?: any }) => React.ReactNode;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: widget.id });
  const style: CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.72 : 1,
    zIndex: isDragging ? 5 : 1,
    animation: editing && !isDragging ? "dashboardTileWiggle 1.8s ease-in-out infinite" : undefined,
    gridRow: widget.type === "asset_table" && expanded ? "span 7" : undefined,
  };

  return (
    <div
      ref={setNodeRef}
      className={
        widget.type === "chart"
          ? "dashboard-widget-tile dashboard-widget-tile-chart"
          : widget.type === "asset_table"
            ? "dashboard-widget-tile dashboard-widget-tile-asset"
            : "dashboard-widget-tile dashboard-widget-tile-kpi"
      }
      style={style}
    >
      {children({ attributes, listeners })}
    </div>
  );
}

// ── Chart Card — Redesigned
function ChartCard({ title, subtitle, accent = "#5b8fff", children }: { title: string; subtitle?: string; accent?: string; children: React.ReactNode }) {
  return (
    <div style={{
      background: "var(--grad-card)",
      border: "1px solid var(--border-default)",
      borderRadius: "var(--radius-lg)",
      overflow: "hidden",
      boxShadow: "var(--shadow-card)",
      transition: "border-color 200ms, box-shadow 200ms",
      height: "100%",
      display: "flex",
      flexDirection: "column",
    }}
      onMouseEnter={e => { (e.currentTarget as HTMLDivElement).style.borderColor = `${accent}30`; }}
      onMouseLeave={e => { (e.currentTarget as HTMLDivElement).style.borderColor = "var(--border-default)"; }}
    >
      <div style={{ position: "absolute" }} />
      <div style={{ padding: "16px 20px 12px", borderBottom: "1px solid var(--border-subtle)", background: `linear-gradient(90deg, rgba(91,143,255,0.03), transparent)`, position: "relative" }}>
        <div style={{ position: "absolute", top: 0, left: 0, right: 0, height: 2, background: `linear-gradient(90deg, ${accent}90, transparent)`, opacity: 0.7 }} />
        <div style={{ fontSize: 13.5, fontWeight: 700, color: "var(--text-primary)", letterSpacing: "-0.01em", marginTop: 2 }}>{title}</div>
        {subtitle && <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 2 }}>{subtitle}</div>}
      </div>
      <div style={{ padding: "16px 12px 12px", flex: 1, minHeight: 0 }}>
        {children}
      </div>
    </div>
  );
}

function DashboardChartContent({ data, chartType, accent }: { data: ChartItem[]; chartType: ChartDisplayType; accent: string }) {
  if (!data.length) {
    return <div style={{ color: "var(--text-muted)", textAlign: "center", padding: 48, fontSize: 13 }}>Nessun dato disponibile.</div>;
  }

  if (chartType === "pie") {
    return (
      <ResponsiveContainer width="100%" height={240}>
        <PieChart>
          <Pie data={data} dataKey="value" nameKey="name" innerRadius={62} outerRadius={90} paddingAngle={3} strokeWidth={0}>
            {data.map((entry, i) => (
              <Cell key={entry.name} fill={PRIORITY_COLORS[i % PRIORITY_COLORS.length]} stroke={PRIORITY_COLORS[i % PRIORITY_COLORS.length]} strokeWidth={1} />
            ))}
          </Pie>
          <Tooltip contentStyle={chartTooltipStyle} />
          <Legend iconType="circle" iconSize={7} formatter={(v) => <span style={{ color: "var(--text-secondary)", fontSize: 11 }}>{v}</span>} />
        </PieChart>
      </ResponsiveContainer>
    );
  }

  if (chartType === "area") {
    return (
      <ResponsiveContainer width="100%" height={240}>
        <AreaChart data={data} margin={{ left: 0, right: 10, top: 12, bottom: 0 }}>
          <defs>
            <linearGradient id={`dashboardArea-${accent.replace("#", "")}`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor={accent} stopOpacity={0.32} />
              <stop offset="95%" stopColor={accent} stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid strokeDasharray="3 3" stroke="rgba(91,143,255,0.05)" vertical={false} />
          <XAxis dataKey="name" tick={{ fill: "var(--text-muted)", fontSize: 10 }} axisLine={false} tickLine={false} />
          <YAxis tick={{ fill: "var(--text-muted)", fontSize: 10 }} axisLine={false} tickLine={false} width={34} />
          <Tooltip contentStyle={chartTooltipStyle} />
          <Area type="monotone" dataKey="value" stroke={accent} strokeWidth={2} fill={`url(#dashboardArea-${accent.replace("#", "")})`} dot={{ r: 3 }} />
        </AreaChart>
      </ResponsiveContainer>
    );
  }

  if (chartType === "line") {
    return (
      <ResponsiveContainer width="100%" height={240}>
        <LineChart data={data} margin={{ left: 0, right: 10, top: 12, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="rgba(91,143,255,0.05)" vertical={false} />
          <XAxis dataKey="name" tick={{ fill: "var(--text-muted)", fontSize: 10 }} axisLine={false} tickLine={false} />
          <YAxis tick={{ fill: "var(--text-muted)", fontSize: 10 }} axisLine={false} tickLine={false} width={34} />
          <Tooltip contentStyle={chartTooltipStyle} />
          <Line type="monotone" dataKey="value" stroke={accent} strokeWidth={2.4} dot={{ r: 3, fill: accent }} activeDot={{ r: 5 }} />
        </LineChart>
      </ResponsiveContainer>
    );
  }

  return (
    <ResponsiveContainer width="100%" height={240}>
      <BarChart data={data} margin={{ left: 0, right: 10, top: 12, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="rgba(91,143,255,0.05)" vertical={false} />
        <XAxis dataKey="name" tick={{ fill: "var(--text-muted)", fontSize: 10 }} axisLine={false} tickLine={false} />
        <YAxis tick={{ fill: "var(--text-muted)", fontSize: 10 }} axisLine={false} tickLine={false} width={34} />
        <Tooltip contentStyle={chartTooltipStyle} cursor={{ fill: "rgba(91,143,255,0.04)" }} />
        <Bar dataKey="value" fill={accent} radius={[7, 7, 0, 0]} maxBarSize={42} />
      </BarChart>
    </ResponsiveContainer>
  );
}

// ── OEE Mini Bar
function OeeBar({ value }: { value: number }) {
  const color = value >= 85 ? "#10d9b0" : value >= 65 ? "#f6a233" : "#f05252";
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
      <div style={{ flex: 1, height: 5, background: "var(--surface-3)", borderRadius: 3, overflow: "hidden", minWidth: 60 }}>
        <div style={{ width: `${value}%`, height: "100%", background: `linear-gradient(90deg, ${color}70, ${color})`, borderRadius: 3, transition: "width 0.7s cubic-bezier(0.22,1,0.36,1)", boxShadow: `0 0 6px ${color}50` }} />
      </div>
      <span style={{ fontSize: 12, fontWeight: 700, color, minWidth: 36, textAlign: "right", fontFamily: "var(--font-mono)" }}>{value}%</span>
    </div>
  );
}

// ── Status Dot ───────────────────────────────────────────────────────────────
function StatoDot({ stato }: { stato: string }) {
  const color = STATO_ASSET_COLORS[stato] ?? "#94a3b8";
  const label: Record<string, string> = { service: "Servizio", stopped: "Fermo", "out of service": "Guasto" };
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
      <span style={{ width: 7, height: 7, borderRadius: "50%", background: color, boxShadow: `0 0 6px ${color}`, display: "inline-block", flexShrink: 0 }} />
      <span style={{ fontSize: 12, fontWeight: 600, color }}>{label[stato] ?? stato}</span>
    </div>
  );
}

function AssetDetailWidget({
  assets,
  total,
  page,
  pages,
  open,
  filters,
  onToggle,
  onFilterChange,
  onPageChange,
}: {
  assets: KpiAssetItem[];
  total: number;
  page: number;
  pages: number;
  open: boolean;
  filters: AssetColumnFilters;
  onToggle: () => void;
  onFilterChange: (key: keyof AssetColumnFilters, value: string) => void;
  onPageChange: (page: number) => void;
}) {
  const filteredAssets = assets.filter((a) => {
    const values = {
      sito: a.asset_sito || "",
      codice: a.asset_codice || "",
      asset: a.asset_nome || "",
      area: a.asset_area || "",
      stato: a.stato || "",
    };
    return (Object.keys(filters) as (keyof AssetColumnFilters)[]).every((key) => {
      const needle = filters[key].trim().toLowerCase();
      return !needle || values[key].toLowerCase().includes(needle);
    });
  });
  const columns: { key: keyof AssetColumnFilters; label: string; width?: number }[] = [
    { key: "sito", label: "Sito", width: 140 },
    { key: "codice", label: "Codice", width: 110 },
    { key: "asset", label: "Asset", width: 180 },
    { key: "area", label: "Area", width: 130 },
    { key: "stato", label: "Stato", width: 120 },
  ];

  return (
    <div style={{ height: "100%", background: "var(--grad-card)", border: "1px solid var(--border-default)", borderRadius: "var(--radius-lg)", overflow: "hidden", boxShadow: "var(--shadow-card)" }}>
      <button
        type="button"
        onClick={onToggle}
        onPointerDown={(e) => e.stopPropagation()}
        style={{
          width: "100%",
          minHeight: 68,
          padding: "14px 18px",
          border: 0,
          borderBottom: open ? "1px solid var(--border-subtle)" : "none",
          background: "rgba(91,143,255,0.025)",
          color: "var(--text-primary)",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 14,
          cursor: "pointer",
          textAlign: "left",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 0 }}>
          <div style={{ padding: 7, background: "var(--border-subtle)", borderRadius: 8, border: "1px solid rgba(91,143,255,0.18)", color: "var(--cobalt)" }}>
            <IconActivity size={14} />
          </div>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: 13.5, fontWeight: 800, color: "var(--text-primary)" }}>Dettaglio KPI per Asset</div>
            <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 1 }}>{filteredAssets.length} visibili · {total} totali · MTBF · OEE · Downtime</div>
          </div>
        </div>
        <span style={{ color: "var(--cobalt-bright)", fontSize: 12, fontWeight: 800 }}>{open ? "Comprimi" : "Apri dettaglio"}</span>
      </button>

      {open && (
        <>
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
              <thead>
                <tr style={{ background: "rgba(91,143,255,0.03)" }}>
                  {columns.map((col) => (
                    <th key={col.key} style={{ padding: "9px 10px", textAlign: "left", borderBottom: "1px solid var(--border-subtle)", minWidth: col.width }}>
                      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                        <span style={{ fontSize: 9, fontWeight: 800, letterSpacing: ".12em", textTransform: "uppercase", color: "var(--text-muted)" }}>{col.label}</span>
                        <input
                          value={filters[col.key]}
                          onChange={(e) => onFilterChange(col.key, e.target.value)}
                          placeholder="Filtra"
                          style={{ height: 24, borderRadius: 7, border: "1px solid var(--border-default)", background: "var(--surface-2)", color: "var(--text-primary)", fontSize: 11, padding: "0 7px", outline: "none" }}
                        />
                      </div>
                    </th>
                  ))}
                  {["MTBF", "OEE", "Guasti", "Downtime", "In corso"].map((h) => (
                    <th key={h} style={{ padding: "9px 10px", textAlign: "left", fontSize: 9, fontWeight: 800, letterSpacing: ".12em", textTransform: "uppercase", color: "var(--text-muted)", borderBottom: "1px solid var(--border-subtle)", whiteSpace: "nowrap" }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filteredAssets.map((a) => (
                  <tr key={a.asset_id} style={{ borderBottom: "1px solid var(--border-subtle)" }}>
                    <td style={{ padding: "10px", color: "var(--text-secondary)", fontWeight: 700 }}>{a.asset_sito || "-"}</td>
                    <td style={{ padding: "10px", fontFamily: "var(--font-mono)", color: "var(--cobalt-bright)", fontWeight: 700 }}>{a.asset_codice || "-"}</td>
                    <td style={{ padding: "10px", fontWeight: 700, color: "var(--text-primary)", whiteSpace: "nowrap" }}>{a.asset_nome}</td>
                    <td style={{ padding: "10px", color: "var(--text-muted)" }}>{a.asset_area || "-"}</td>
                    <td style={{ padding: "10px" }}><StatoDot stato={a.stato} /></td>
                    <td style={{ padding: "10px", color: "var(--violet)", fontWeight: 900 }}>{a.mtbf_giorni}gg</td>
                    <td style={{ padding: "10px", minWidth: 120 }}><OeeBar value={a.oee_pct} /></td>
                    <td style={{ padding: "10px", color: a.n_guasti > 5 ? "var(--red)" : "var(--text-muted)", fontWeight: 800 }}>{a.n_guasti}</td>
                    <td style={{ padding: "10px", color: "var(--text-muted)" }}>{a.downtime_ore_30gg}h</td>
                    <td style={{ padding: "10px" }}>{a.stato === "out of service" && a.stato_changed_at ? <DowntimeTicker statoChangedAt={a.stato_changed_at} secondsFromBackend={a.downtime_seconds} /> : <span style={{ color: "var(--text-disabled)" }}>-</span>}</td>
                  </tr>
                ))}
                {!filteredAssets.length && (
                  <tr><td colSpan={10} style={{ padding: 28, textAlign: "center", color: "var(--text-muted)" }}>Nessun asset trovato.</td></tr>
                )}
              </tbody>
            </table>
          </div>
          {pages > 1 && (
            <div style={{ padding: "10px 14px", borderTop: "1px solid var(--border-subtle)", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <div style={{ fontSize: 12, color: "var(--text-muted)" }}>Pagina {page} / {pages}</div>
              <div style={{ display: "flex", gap: 8 }}>
                <button className="btn btn-secondary" style={{ padding: "5px 12px", fontSize: 12 }} disabled={page === 1} onClick={() => onPageChange(page - 1)}>Prec.</button>
                <button className="btn btn-secondary" style={{ padding: "5px 12px", fontSize: 12 }} disabled={page === pages} onClick={() => onPageChange(page + 1)}>Succ.</button>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}

// ── Main ─────────────────────────────────────────────────────────────────────
export default function DashboardPage() {
  const { user } = useAuth();
  const [loading, setLoading] = useState(true);
  const [dashboard, setDashboard] = useState<DashboardData>(EMPTY_DASHBOARD);
  const [charts, setCharts] = useState<DashboardCharts | null>(null);
  const [trend, setTrend] = useState<TrendData | null>(null);
  const [kpiAsset, setKpiAsset] = useState<(KpiAsset & { total: number; page: number; pages: number }) | null>(null);
  const [lastUpdate, setLastUpdate] = useState<Date | null>(null);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [selectedArea, setSelectedArea] = useState("");
  const [selectedStato, setSelectedStato] = useState("");
  const [areas, setAreas] = useState<string[]>([]);
  const [dashboardWidgets, setDashboardWidgets] = useState<DashboardWidget[]>(DEFAULT_DASHBOARD_WIDGETS);
  const [isCustomizing, setIsCustomizing] = useState(false);
  const [assetDetailOpen, setAssetDetailOpen] = useState(true);
  const [assetColumnFilters, setAssetColumnFilters] = useState<AssetColumnFilters>({ sito: "", codice: "", asset: "", area: "", stato: "" });
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );

  async function loadKPIs() {
    try {
      const q = new URLSearchParams({ page: String(page), limit: "10", ...(search && { search }), ...(selectedArea && { area: selectedArea }), ...(selectedStato && { stato: selectedStato }) });
      setKpiAsset(await apiGet<any>(`/dashboard/kpi-asset?${q.toString()}`));
    } catch {}
  }

  useEffect(() => {
    async function loadInitial() {
      try {
        const [dashboardData, chartsData, trendData, kpiData] = await Promise.all([
          apiGet<DashboardData>("/dashboard"),
          apiGet<DashboardCharts>("/dashboard/charts"),
          apiGet<TrendData>("/dashboard/trends").catch(() => null),
          apiGet<any>("/dashboard/kpi-asset?page=1&limit=10"),
        ]);
        if (dashboardData) { setDashboard(dashboardData); if (dashboardData.areas) setAreas(dashboardData.areas); }
        if (chartsData) setCharts(chartsData);
        if (trendData) setTrend(trendData);
        if (kpiData) setKpiAsset(kpiData);
        setLastUpdate(new Date());
      } catch { notify.error("Errore di connessione al backend."); }
      finally { setLoading(false); }
    }
    loadInitial();
  }, []);

  useEffect(() => { loadKPIs(); }, [page, search, selectedArea, selectedStato]);

  useEffect(() => {
    try {
      const saved = window.localStorage.getItem(DASHBOARD_WIDGETS_STORAGE_KEY);
      if (!saved) return;
      const parsed = JSON.parse(saved);
      setDashboardWidgets(normalizeDashboardWidgets(parsed));
    } catch {}
  }, []);

  useEffect(() => {
    try {
      window.localStorage.setItem(DASHBOARD_WIDGETS_STORAGE_KEY, JSON.stringify(dashboardWidgets));
    } catch {}
  }, [dashboardWidgets]);

  const trendChartData = trend ? trend.labels.map((l, i) => ({ name: l, value: trend.values[i] })) : [];
  const kpiOptions = useMemo<KpiOption[]>(() => {
    const assetService = dashboard?.asset_stati?.service ?? 0;
    const assetStopped = dashboard?.asset_stati?.stopped ?? 0;
    const assetOut = dashboard?.asset_stati?.["out of service"] ?? 0;
    return [
      {
        id: "asset_totali",
        label: "Asset totali",
        value: dashboard?.assets ?? "—",
        accent: "#5b8fff",
        icon: <IconBox size={15} />,
        sub: `${assetService} servizio · ${assetStopped} fermi · ${assetOut} guasti`,
      },
      {
        id: "asset_servizio",
        label: "Asset in servizio",
        value: assetService,
        accent: "#10d9b0",
        icon: <IconBox size={15} />,
        sub: "Asset disponibili alla produzione",
      },
      {
        id: "asset_fermi",
        label: "Asset fermi",
        value: assetStopped,
        accent: "#f6a233",
        icon: <IconActivity size={15} />,
        sub: "Fermi programmati o temporanei",
      },
      {
        id: "asset_guasti",
        label: "Asset guasti",
        value: assetOut,
        accent: "#f05252",
        icon: <IconAlert size={15} />,
        sub: "Criticità operative aperte",
      },
      {
        id: "tecnici_attivi",
        label: "Tecnici attivi",
        value: dashboard ? `${dashboard.tecnici_disponibili}/${dashboard.tecnici}` : "—",
        accent: "#10d9b0",
        icon: <IconUsers size={15} />,
        sub: "Disponibili oggi",
      },
      {
        id: "ticket_aperti",
        label: "Ticket aperti",
        value: dashboard?.ticket_aperti ?? "—",
        accent: "#f6a233",
        icon: <IconTicket size={15} />,
        sub: "Backlog da prendere in carico",
      },
      {
        id: "ticket_in_corso",
        label: "Ticket in corso",
        value: dashboard?.ticket_in_corso ?? "—",
        accent: "#3b82f6",
        icon: <IconPlay size={15} />,
        sub: "Lavorazioni attualmente aperte",
      },
      {
        id: "ticket_chiusi",
        label: "Ticket chiusi",
        value: dashboard?.ticket_chiusi ?? "—",
        accent: "#10d9b0",
        icon: <IconCheck size={15} />,
        sub: "Interventi completati",
      },
      {
        id: "ticket_pianificati",
        label: "Ticket pianificati",
        value: dashboard?.ticket_pianificati ?? "—",
        accent: "#9b78ff",
        icon: <IconCalendar size={15} />,
        sub: "Schedulati dal planner",
      },
      {
        id: "mtbf_medio",
        label: "MTBF medio",
        value: kpiAsset ? `${kpiAsset.aggregati.avg_mtbf_giorni}gg` : "—",
        accent: "#9b78ff",
        icon: <IconActivity size={15} />,
        sub: "Mean Time Between Failures",
      },
      {
        id: "oee_medio",
        label: "OEE medio",
        value: kpiAsset ? `${kpiAsset.aggregati.avg_oee_pct}%` : "—",
        accent: "#10d9b0",
        icon: <IconPercent size={15} />,
        sub: "Overall Equipment Effectiveness · 30gg",
      },
    ];
  }, [dashboard, kpiAsset]);
  const kpiOptionsById = useMemo(() => new Map(kpiOptions.map((item) => [item.id, item])), [kpiOptions]);
  const chartOptions = useMemo<ChartOption[]>(() => {
    const assetRows = kpiAsset?.assets ?? [];
    return [
      {
        id: "ticket_by_priority",
        title: "Ticket per priorità",
        subtitle: "Distribuzione per livello di urgenza",
        data: charts?.ticket_by_priority ?? [],
        accent: "#f05252",
      },
      {
        id: "ticket_by_status",
        title: "Ticket per stato",
        subtitle: "Avanzamento operativo dei ticket",
        data: charts?.ticket_by_status ?? [],
        accent: "#5b8fff",
      },
      {
        id: "ticket_by_fascia",
        title: "Ticket per fascia",
        subtitle: "Carico di lavoro per finestra temporale",
        data: charts?.ticket_by_fascia ?? [],
        accent: "#f6a233",
      },
      {
        id: "ticket_by_tipo",
        title: "Ticket per tipo",
        subtitle: "Breakdown, preventive e correttive",
        data: charts?.ticket_by_tipo ?? [],
        accent: "#9b78ff",
      },
      {
        id: "asset_by_stato",
        title: "Asset per stato",
        subtitle: "Snapshot del parco macchine",
        data: charts?.asset_by_stato ?? [],
        accent: "#10d9b0",
      },
      {
        id: "mtbf_by_asset",
        title: "MTBF per asset",
        subtitle: "Mean Time Between Failures",
        data: assetRows.map((a) => ({ name: a.asset_codice || a.asset_nome, value: a.mtbf_giorni })),
        accent: "#9b78ff",
      },
      {
        id: "oee_by_asset",
        title: "OEE per asset",
        subtitle: "Overall Equipment Effectiveness · 30gg",
        data: assetRows.map((a) => ({ name: a.asset_codice || a.asset_nome, value: a.oee_pct })),
        accent: "#10d9b0",
      },
      {
        id: "downtime_by_asset",
        title: "Downtime per asset",
        subtitle: "Ore di fermo negli ultimi 30 giorni",
        data: assetRows.map((a) => ({ name: a.asset_codice || a.asset_nome, value: a.downtime_ore_30gg })),
        accent: "#f6a233",
      },
      {
        id: "guasti_by_asset",
        title: "Guasti per asset",
        subtitle: "Numero guasti registrati",
        data: assetRows.map((a) => ({ name: a.asset_codice || a.asset_nome, value: a.n_guasti })),
        accent: "#f05252",
      },
    ];
  }, [charts, kpiAsset]);
  const chartOptionsById = useMemo(() => new Map(chartOptions.map((item) => [item.id, item])), [chartOptions]);
  const chartTypeOptions: { value: ChartDisplayType; label: string }[] = [
    { value: "pie", label: "Torta" },
    { value: "bar", label: "Barre" },
    { value: "area", label: "Area" },
    { value: "line", label: "Linea" },
  ];

  const handleDashboardDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    setDashboardWidgets((items) => {
      const oldIndex = items.findIndex((item) => item.id === active.id);
      const newIndex = items.findIndex((item) => item.id === over.id);
      if (oldIndex < 0 || newIndex < 0) return items;
      return arrayMove(items, oldIndex, newIndex);
    });
  };

  const changeWidgetKpi = (id: string, kpi: KpiOptionId) => {
    setDashboardWidgets((items) => items.map((item) => item.id === id && item.type === "kpi" ? { ...item, kpi } : item));
  };

  const changeWidgetChartData = (id: string, chartData: ChartDataId) => {
    setDashboardWidgets((items) => items.map((item) => item.id === id && item.type === "chart" ? { ...item, chartData } : item));
  };

  const changeWidgetChartType = (id: string, chartType: ChartDisplayType) => {
    setDashboardWidgets((items) => items.map((item) => item.id === id && item.type === "chart" ? { ...item, chartType } : item));
  };

  const resetDashboardWidgets = () => {
    setDashboardWidgets(DEFAULT_DASHBOARD_WIDGETS);
  };

  return (
    <div className="anim-fade-in-up" style={{ display: "flex", flexDirection: "column", gap: 20, paddingBottom: 48 }}>

      {/* ── Hero Header — New Identity ────────────────────────────────────── */}
      <div style={{
        position: "relative", borderRadius: "var(--radius-xl)", overflow: "hidden",
        background: "linear-gradient(130deg, rgba(13,21,38,0.97) 0%, rgba(17,29,52,0.95) 50%, rgba(11,17,32,0.97) 100%)",
        border: "1px solid var(--border-default)",
        padding: "18px 24px",
        display: "flex", alignItems: "center",
        boxShadow: "var(--shadow-card), inset 0 1px 0 rgba(91,143,255,0.07)",
        flexShrink: 0,
        minHeight: 70,
      }}>
        {/* Cobalt mesh grid */}
        <div style={{ position: "absolute", inset: 0, backgroundImage: "linear-gradient(rgba(91,143,255,0.03) 1px, transparent 1px), linear-gradient(90deg, rgba(91,143,255,0.03) 1px, transparent 1px)", backgroundSize: "32px 32px", pointerEvents: "none" }} />
        {/* Ambient blobs */}
        <div style={{ position: "absolute", top: -30, right: 100, width: 180, height: 180, background: "radial-gradient(circle, var(--border-subtle) 0%, transparent 70%)", pointerEvents: "none" }} />
        <div style={{ position: "absolute", top: -20, right: -20, width: 120, height: 120, background: "radial-gradient(circle, rgba(155,120,255,0.07) 0%, transparent 70%)", pointerEvents: "none" }} />
        {/* Top gradient line */}
        <div style={{ position: "absolute", top: 0, left: 0, right: 0, height: 2, background: "linear-gradient(90deg, var(--cobalt), var(--violet), var(--cyan))", opacity: 0.65 }} />

        <div style={{ position: "relative", display: "flex", justifyContent: "space-between", alignItems: "center", width: "100%" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
            <span style={{ fontSize: 9, fontWeight: 800, textTransform: "uppercase", letterSpacing: "0.25em", color: "var(--cobalt)", background: "var(--cobalt-dim)", border: "1px solid rgba(91,143,255,0.25)", padding: "3px 10px", borderRadius: "var(--radius-full)", flexShrink: 0 }}>
              Overview
            </span>
            <h1 style={{ margin: 0, fontSize: 19, fontWeight: 800, fontFamily: "var(--font-display)", color: "var(--text-primary)", lineHeight: 1, letterSpacing: "-0.03em" }}>
              Ciao,{" "}
              <span style={{ background: "linear-gradient(135deg, #7aa8ff, #9b78ff)", WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent" }}>
                {user?.username ? user.username.charAt(0).toUpperCase() + user.username.slice(1) : "Operatore"}
              </span>
            </h1>
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "9px 16px", borderRadius: "var(--radius-full)", background: "rgba(16,217,176,0.10)", border: "1px solid rgba(16,217,176,0.26)", fontSize: 15, color: "var(--cyan)", fontWeight: 800, letterSpacing: "0.01em" }}>
              <span style={{ width: 9, height: 9, borderRadius: "50%", background: "var(--cyan)", display: "inline-block", animation: "statusPulse 2.5s infinite", boxShadow: "0 0 9px rgba(16,217,176,0.65)" }} />
              {lastUpdate ? `Live · ${lastUpdate.toLocaleTimeString("it-IT")}` : "Connessione..."}
            </div>
            {false && trendChartData.length > 0 && (
              <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                <span style={{ fontSize: 9, color: "var(--text-muted)", letterSpacing: "0.10em", textTransform: "uppercase" }}>30gg</span>
                <ResponsiveContainer width={90} height={30}>
                  <AreaChart data={trendChartData}>
                    <defs>
                      <linearGradient id="trendGrad" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#5b8fff" stopOpacity={0.35} />
                        <stop offset="95%" stopColor="#5b8fff" stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <Area type="monotone" dataKey="value" stroke="#5b8fff" strokeWidth={2} fill="url(#trendGrad)" dot={false} />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Stat strip — New style */}
      {dashboard && (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(5, 1fr)", gap: 2, background: "var(--border-subtle)", borderRadius: "var(--radius-lg)", overflow: "hidden", border: "1px solid var(--border-default)" }}>
          {[
            { label: "Asset Totali",   value: dashboard.assets,                               color: "var(--cobalt)" },
            { label: "In Servizio",    value: dashboard.asset_stati?.service ?? 0,             color: "var(--cyan)" },
            { label: "Fuori Servizio", value: dashboard.asset_stati?.["out of service"] ?? 0, color: "var(--red)" },
            { label: "Ticket Aperti",  value: dashboard.ticket_aperti,                        color: "var(--amber)" },
            { label: "In Corso",       value: dashboard.ticket_in_corso,                      color: "var(--violet)" },
          ].map((s, i) => (
            <div key={i} style={{ padding: "12px 16px", background: "var(--surface-2)", textAlign: "center", transition: "background 150ms" }}
              onMouseEnter={e => (e.currentTarget.style.background = "var(--surface-3)")}
              onMouseLeave={e => (e.currentTarget.style.background = "var(--surface-2)")}
            >
              <div style={{ fontFamily: "var(--font-display)", fontSize: 26, fontWeight: 800, color: s.color, lineHeight: 1, letterSpacing: "-1px" }}>{s.value}</div>
              <div style={{ fontSize: 9, color: "var(--text-muted)", fontWeight: 600, letterSpacing: "0.10em", textTransform: "uppercase", marginTop: 5 }}>{s.label}</div>
            </div>
          ))}
        </div>
      )}

      {loading ? (
        <SkeletonStats count={6} />
      ) : dashboard ? (
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
            <div>
              <div style={{ fontSize: 13.5, fontWeight: 800, color: "var(--text-primary)", letterSpacing: "-0.01em" }}>Dashboard personalizzata</div>
              <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 3 }}>Trascina i riquadri e scegli il KPI da mostrare in ogni posizione.</div>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              {isCustomizing && (
                <button type="button" className="btn btn-secondary" style={{ padding: "7px 12px", fontSize: 12 }} onClick={resetDashboardWidgets}>
                  Ripristina
                </button>
              )}
              <button type="button" className={isCustomizing ? "btn btn-primary" : "btn btn-secondary"} style={{ padding: "7px 14px", fontSize: 12 }} onClick={() => setIsCustomizing((value) => !value)}>
                {isCustomizing ? "Fine" : "Personalizza"}
              </button>
            </div>
          </div>

          <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDashboardDragEnd}>
            <SortableContext items={dashboardWidgets.map((item) => item.id)} strategy={rectSortingStrategy}>
              <div className="dashboard-widget-grid">
                {dashboardWidgets.map((widget) => {
                  if (widget.type === "kpi") {
                    const option = kpiOptionsById.get(widget.kpi) ?? kpiOptions[0];
                    return (
                      <SortableDashboardTile key={widget.id} widget={widget} editing={isCustomizing} expanded={assetDetailOpen}>
                        {({ attributes, listeners }) => (
      <div style={{ position: "relative", height: "100%" }}>
                            {isCustomizing && (
                              <WidgetControls attributes={attributes} listeners={listeners}>
                                <MiniSelect
                                  label="Tipo KPI"
                                  value={widget.kpi}
                                  options={kpiOptions.map((item) => ({ value: item.id, label: item.label }))}
                                  onChange={(value) => changeWidgetKpi(widget.id, value as KpiOptionId)}
                                />
                              </WidgetControls>
                            )}
                            <KpiCard label={option.label} value={option.value} accent={option.accent} sub={option.sub} icon={option.icon} />
                          </div>
                        )}
                      </SortableDashboardTile>
                    );
                  }
                  if (widget.type === "asset_table") {
                    return (
                      <SortableDashboardTile key={widget.id} widget={widget} editing={isCustomizing} expanded={assetDetailOpen}>
                        {({ attributes, listeners }) => (
                          <div style={{ position: "relative", height: "100%" }}>
                            {isCustomizing && (
                              <WidgetControls attributes={attributes} listeners={listeners}>
                                <span style={{ height: 31, display: "inline-flex", alignItems: "center", padding: "0 10px", borderRadius: 9, background: "var(--surface-2)", border: "1px solid var(--border-default)", color: "var(--text-secondary)", fontSize: 11, fontWeight: 800 }}>
                                  Dettaglio asset
                                </span>
                              </WidgetControls>
                            )}
                            <AssetDetailWidget
                              assets={kpiAsset?.assets ?? []}
                              total={kpiAsset?.total ?? 0}
                              page={page}
                              pages={kpiAsset?.pages ?? 0}
                              open={assetDetailOpen}
                              filters={assetColumnFilters}
                              onToggle={() => setAssetDetailOpen((value) => !value)}
                              onFilterChange={(key, value) => setAssetColumnFilters((current) => ({ ...current, [key]: value }))}
                              onPageChange={setPage}
                            />
                          </div>
                        )}
                      </SortableDashboardTile>
                    );
                  }
                  const chart = chartOptionsById.get(widget.chartData) ?? chartOptions[0];
                  return (
                    <SortableDashboardTile key={widget.id} widget={widget} editing={isCustomizing}>
                      {({ attributes, listeners }) => (
                        <div style={{ position: "relative", height: "100%" }}>
                          {isCustomizing && (
                            <WidgetControls attributes={attributes} listeners={listeners}>
                              <MiniSelect
                                label="Dati grafico"
                                value={widget.chartData}
                                options={chartOptions.map((item) => ({ value: item.id, label: item.title }))}
                                onChange={(value) => changeWidgetChartData(widget.id, value as ChartDataId)}
                                width={170}
                              />
                              <MiniSelect
                                label="Tipologia grafico"
                                value={widget.chartType}
                                options={chartTypeOptions}
                                onChange={(value) => changeWidgetChartType(widget.id, value as ChartDisplayType)}
                                width={104}
                              />
                            </WidgetControls>
                          )}
                          <ChartCard title={chart.title} subtitle={chart.subtitle} accent={chart.accent}>
                            <DashboardChartContent data={chart.data} chartType={widget.chartType} accent={chart.accent} />
                          </ChartCard>
                        </div>
                      )}
                    </SortableDashboardTile>
                  );
                })}
              </div>
            </SortableContext>
          </DndContext>
        </div>
      ) : null}

      {/* ── KPI Cards */}
      {false && dashboard && (
        <div style={{ display: "none", gridTemplateColumns: "repeat(4, 1fr)", gap: 14 }}>
          <KpiCard label="Asset totali"     value={dashboard.assets}                            accent="#5b8fff" icon={<IconBox size={15} />}      sub={`${dashboard.asset_stati?.service ?? 0} servizio · ${dashboard.asset_stati?.stopped ?? 0} fermi · ${dashboard.asset_stati?.["out of service"] ?? 0} guasti`} />
          <KpiCard label="Tecnici attivi"   value={`${dashboard.tecnici_disponibili}/${dashboard.tecnici}`} accent="#10d9b0" icon={<IconUsers size={15} />}    sub="Disponibili oggi" />
          <KpiCard label="Ticket aperti"    value={dashboard.ticket_aperti}                     accent="#f6a233" icon={<IconTicket size={15} />}   sub={`${dashboard.ticket_in_corso} in lavorazione · ${dashboard.ticket_chiusi} chiusi`} />
          <KpiCard label="Ticket pianificati" value={dashboard.ticket_pianificati}              accent="#9b78ff" icon={<IconCalendar size={15} />} sub="Schedulati dal planner" />
        </div>
      )}

      {/* ── MTBF + OEE Ring Cards */}
      {kpiAsset && (
        <div style={{ display: "none", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
          <div style={{
            background: "var(--grad-card)",
            border: "1px solid rgba(155,120,255,0.18)",
            borderRadius: "var(--radius-lg)", padding: "24px 28px",
            boxShadow: "var(--shadow-card), 0 0 24px rgba(155,120,255,0.05)",
            position: "relative", overflow: "hidden",
          }}>
            <div style={{ position: "absolute", top: 0, left: 0, right: 0, height: 2, background: "linear-gradient(90deg, var(--violet), transparent)" }} />
            <div style={{ position: "absolute", top: -40, right: -40, width: 160, height: 160, background: "rgba(155,120,255,0.07)", borderRadius: "50%", filter: "blur(28px)", pointerEvents: "none" }} />
            <div style={{ fontSize: 9.5, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.18em", color: "var(--violet)", marginBottom: 18 }}>Mean Time Between Failures</div>
            <RingProgress value={kpiAsset.aggregati.avg_mtbf_giorni} max={90} color="#9b78ff" size={110} label={`${kpiAsset.aggregati.avg_mtbf_giorni}gg`} sublabel="MTBF Medio" />
          </div>
          <div style={{
            background: "var(--grad-card)",
            border: "1px solid rgba(16,217,176,0.18)",
            borderRadius: "var(--radius-lg)", padding: "24px 28px",
            boxShadow: "var(--shadow-card), 0 0 24px rgba(16,217,176,0.05)",
            position: "relative", overflow: "hidden",
          }}>
            <div style={{ position: "absolute", top: 0, left: 0, right: 0, height: 2, background: "linear-gradient(90deg, var(--cyan), transparent)" }} />
            <div style={{ position: "absolute", top: -40, right: -40, width: 160, height: 160, background: "rgba(16,217,176,0.06)", borderRadius: "50%", filter: "blur(28px)", pointerEvents: "none" }} />
            <div style={{ fontSize: 9.5, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.18em", color: "var(--cyan)", marginBottom: 18 }}>Overall Equipment Effectiveness · 30gg</div>
            <RingProgress value={kpiAsset.aggregati.avg_oee_pct} max={100} color="#10d9b0" size={110} label={`${kpiAsset.aggregati.avg_oee_pct}%`} sublabel="OEE Medio" />
          </div>
        </div>
      )}

      {/* ── Charts Row 1 */}
      {charts && (
        <div style={{ display: "none", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
          <ChartCard title="Ticket per Priorità" subtitle="Distribuzione per livello di urgenza" accent="#f05252">
            <ResponsiveContainer width="100%" height={220}>
              <PieChart>
                <defs>
                  {PRIORITY_COLORS.map((c, i) => (
                    <radialGradient key={i} id={`pg${i}`} cx="50%" cy="50%" r="50%">
                      <stop offset="0%" stopColor={c} stopOpacity={1} />
                      <stop offset="100%" stopColor={c} stopOpacity={0.7} />
                    </radialGradient>
                  ))}
                </defs>
                <Pie data={charts.ticket_by_priority} dataKey="value" nameKey="name" innerRadius={62} outerRadius={88} paddingAngle={3} strokeWidth={0}>
                  {charts.ticket_by_priority.map((entry, i) => (
                    <Cell key={entry.name} fill={`url(#pg${i})`} stroke={PRIORITY_COLORS[i]} strokeWidth={1} />
                  ))}
                </Pie>
                <Tooltip contentStyle={chartTooltipStyle} />
                <Legend iconType="circle" iconSize={7} formatter={(v) => <span style={{ color: "var(--text-secondary)", fontSize: 11 }}>{v}</span>} />
              </PieChart>
            </ResponsiveContainer>
          </ChartCard>

          <ChartCard title="Asset per Stato Operativo" subtitle="Snapshot del parco macchine" accent="#10d9b0">
            {charts.asset_by_stato?.length ? (
              <ResponsiveContainer width="100%" height={220}>
                <PieChart>
                  <Pie data={charts.asset_by_stato} dataKey="value" nameKey="name" innerRadius={62} outerRadius={88} paddingAngle={3} strokeWidth={0}>
                    {charts.asset_by_stato.map((entry) => (
                      <Cell key={entry.name} fill={STATO_ASSET_COLORS[entry.name] ?? "#7d94b5"} stroke={STATO_ASSET_COLORS[entry.name] ?? "#7d94b5"} strokeWidth={1} />
                    ))}
                  </Pie>
                  <Tooltip contentStyle={chartTooltipStyle} />
                  <Legend iconType="circle" iconSize={7} formatter={(v) => <span style={{ color: "var(--text-secondary)", fontSize: 11 }}>{v}</span>} />
                </PieChart>
              </ResponsiveContainer>
            ) : (
              <div style={{ color: "var(--text-muted)", textAlign: "center", padding: 48, fontSize: 13 }}>Nessun dato asset.</div>
            )}
          </ChartCard>
        </div>
      )}

      {/* ── Charts Row 2 */}
      {kpiAsset && kpiAsset.assets.length > 0 && (
        <div style={{ display: "none", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
          <ChartCard title="MTBF per Asset" subtitle="Mean Time Between Failures — pagina corrente" accent="#9b78ff">
            <ResponsiveContainer width="100%" height={220}>
              <BarChart layout="vertical" data={kpiAsset.assets.map(a => ({ name: a.asset_codice || a.asset_nome, value: a.mtbf_giorni }))} margin={{ left: 0 }}>
                <defs>
                  <linearGradient id="mtbfGrad" x1="0" y1="0" x2="1" y2="0">
                    <stop offset="0%" stopColor="#9b78ff" stopOpacity={0.5} />
                    <stop offset="100%" stopColor="#9b78ff" stopOpacity={0.9} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(91,143,255,0.04)" horizontal={false} />
                <XAxis type="number" tick={{ fill: "var(--text-muted)", fontSize: 11 }} axisLine={false} tickLine={false} />
                <YAxis type="category" dataKey="name" tick={{ fill: "var(--text-secondary)", fontSize: 11, fontWeight: 600 }} width={80} axisLine={false} tickLine={false} />
                <Tooltip contentStyle={chartTooltipStyle} formatter={(v) => [`${v} gg`, "MTBF"]} cursor={{ fill: "rgba(91,143,255,0.04)" }} />
                <Bar dataKey="value" fill="url(#mtbfGrad)" radius={[0, 6, 6, 0]} maxBarSize={18} />
              </BarChart>
            </ResponsiveContainer>
          </ChartCard>

          <ChartCard title="OEE per Asset" subtitle="Overall Equipment Effectiveness — 30gg" accent="#10d9b0">
            <ResponsiveContainer width="100%" height={220}>
              <BarChart layout="vertical" data={kpiAsset.assets.map(a => ({ name: a.asset_codice || a.asset_nome, value: a.oee_pct }))} margin={{ left: 0 }}>
                <defs>
                  <linearGradient id="oeeGrad" x1="0" y1="0" x2="1" y2="0">
                    <stop offset="0%" stopColor="#10d9b0" stopOpacity={0.5} />
                    <stop offset="100%" stopColor="#10d9b0" stopOpacity={0.9} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(91,143,255,0.04)" horizontal={false} />
                <XAxis type="number" tick={{ fill: "var(--text-muted)", fontSize: 11 }} domain={[0, 100]} axisLine={false} tickLine={false} />
                <YAxis type="category" dataKey="name" tick={{ fill: "var(--text-secondary)", fontSize: 11, fontWeight: 600 }} width={80} axisLine={false} tickLine={false} />
                <Tooltip contentStyle={chartTooltipStyle} formatter={(v) => [`${v}%`, "OEE"]} cursor={{ fill: "rgba(91,143,255,0.04)" }} />
                <Bar dataKey="value" fill="url(#oeeGrad)" radius={[0, 6, 6, 0]} maxBarSize={18} />
              </BarChart>
            </ResponsiveContainer>
          </ChartCard>
        </div>
      )}

      {/* ── Asset KPI Table */}
      <div style={{
        display: "none",
        background: "var(--grad-card)",
        border: "1px solid var(--border-default)",
        borderRadius: "var(--radius-lg)", overflow: "hidden",
        boxShadow: "var(--shadow-card)",
      }}>
        {/* Table header */}
        <div style={{ padding: "16px 20px", borderBottom: "1px solid var(--border-subtle)", display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 12, background: "rgba(91,143,255,0.02)" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <div style={{ padding: 7, background: "var(--border-subtle)", borderRadius: 8, border: "1px solid rgba(91,143,255,0.18)", color: "var(--cobalt)" }}>
              <IconActivity size={14} />
            </div>
            <div>
              <div style={{ fontSize: 13.5, fontWeight: 700, color: "var(--text-primary)", letterSpacing: "-0.01em" }}>Dettaglio KPI per Asset</div>
              <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 1 }}>MTBF · OEE · Downtime · Guasti</div>
            </div>
          </div>
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
            <input
              type="text" className="input"
              placeholder="Cerca asset o codice..."
              style={{ width: 200, fontSize: 12, height: 34 }}
              value={search}
              onChange={(e) => { setSearch(e.target.value); setPage(1); }}
            />
            <StatusToggle size="sm" currentValue={selectedArea} onChange={(v) => { setSelectedArea(v); setPage(1); }}
              options={[{ value: "", label: "Tutte le aree", color: "var(--cobalt)" }, ...areas.map(a => ({ value: a, label: a, color: "var(--violet)" }))]} />
            <StatusToggle size="sm" currentValue={selectedStato} onChange={(v) => { setSelectedStato(v); setPage(1); }}
              options={[
                { value: "", label: "Tutti",    color: "var(--cobalt)" },
                { value: "service",        label: "Servizio", color: "var(--cyan)" },
                { value: "stopped",        label: "Fermo",    color: "var(--amber)" },
                { value: "out of service", label: "Guasto",   color: "var(--red)" },
              ]} />
          </div>
        </div>

        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
            <thead>
              <tr style={{ background: "rgba(91,143,255,0.03)" }}>
                {["Codice", "Asset", "Area", "Stato", "MTBF (gg)", "OEE", "Guasti", "Downtime", "In Corso"].map(h => (
                  <th key={h} style={{ padding: "10px 14px", textAlign: "left", fontSize: 9.5, fontWeight: 700, letterSpacing: ".14em", textTransform: "uppercase", color: "var(--text-muted)", borderBottom: "1px solid var(--border-subtle)", whiteSpace: "nowrap" }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {kpiAsset?.assets.map((a, idx) => (
                <tr key={a.asset_id}
                  style={{ borderBottom: "1px solid var(--border-subtle)", transition: "background 120ms" }}
                  onMouseEnter={e => (e.currentTarget.style.background = "rgba(91,143,255,0.04)")}
                  onMouseLeave={e => (e.currentTarget.style.background = "transparent")}
                >
                  <td style={{ padding: "12px 14px", fontFamily: "var(--font-mono)", fontSize: 12, color: "var(--cobalt-bright)", fontWeight: 600 }}>{a.asset_codice || "—"}</td>
                  <td style={{ padding: "12px 14px", fontWeight: 600, color: "var(--text-primary)", whiteSpace: "nowrap" }}>{a.asset_nome}</td>
                  <td style={{ padding: "12px 14px", color: "var(--text-muted)", fontSize: 12 }}>{a.asset_area || "—"}</td>
                  <td style={{ padding: "12px 14px" }}><StatoDot stato={a.stato} /></td>
                  <td style={{ padding: "12px 14px" }}>
                    <span style={{ fontFamily: "var(--font-display)", fontSize: 17, fontWeight: 800, color: "var(--violet)" }}>{a.mtbf_giorni}</span>
                    <span style={{ fontSize: 10, color: "var(--text-muted)", marginLeft: 3 }}>gg</span>
                  </td>
                  <td style={{ padding: "12px 14px", minWidth: 130 }}><OeeBar value={a.oee_pct} /></td>
                  <td style={{ padding: "12px 14px", color: a.n_guasti > 5 ? "var(--red)" : "var(--text-muted)", fontWeight: 700 }}>{a.n_guasti}</td>
                  <td style={{ padding: "12px 14px", color: "var(--text-muted)", fontSize: 12 }}>{a.downtime_ore_30gg}h</td>
                  <td style={{ padding: "12px 14px" }}>
                    {a.stato === "out of service" && a.stato_changed_at
                      ? <DowntimeTicker statoChangedAt={a.stato_changed_at} secondsFromBackend={a.downtime_seconds} />
                      : <span style={{ color: "var(--text-disabled)", fontSize: 12 }}>—</span>}
                  </td>
                </tr>
              ))}
              {(!kpiAsset || kpiAsset.assets.length === 0) && (
                <tr><td colSpan={9} style={{ padding: 48, textAlign: "center", color: "var(--text-muted)" }}>Nessun asset trovato.</td></tr>
              )}
            </tbody>
          </table>
        </div>

        {kpiAsset && kpiAsset.pages > 1 && (
          <div style={{ padding: "14px 20px", borderTop: "1px solid var(--border-subtle)", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <div style={{ fontSize: 12, color: "var(--text-muted)" }}>
              {kpiAsset.assets.length} di <span style={{ color: "var(--text-secondary)", fontWeight: 700 }}>{kpiAsset.total}</span> asset
            </div>
            <div style={{ display: "flex", gap: 8 }}>
              <button className="btn btn-secondary" style={{ padding: "5px 14px", fontSize: 12 }} disabled={page === 1} onClick={() => setPage(p => p - 1)}>← Prec.</button>
              <span style={{ display: "flex", alignItems: "center", fontSize: 12, color: "var(--text-secondary)", padding: "0 8px" }}>
                {page} / {kpiAsset.pages}
              </span>
              <button className="btn btn-secondary" style={{ padding: "5px 14px", fontSize: 12 }} disabled={page === kpiAsset.pages} onClick={() => setPage(p => p + 1)}>Succ. →</button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
