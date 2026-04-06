"use client";

import { useEffect, useState } from "react";
import { apiGet } from "../lib/api";
import { notify } from "@/lib/toast";
import { useAuth } from "../lib/auth";
import StatusToggle from "../components/StatusToggle";
import {
  PieChart, Pie, Cell, Tooltip, Legend, ResponsiveContainer,
  BarChart, Bar, XAxis, YAxis, CartesianGrid, AreaChart, Area,
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
type DashboardCharts = {
  ticket_by_priority: ChartItem[];
  ticket_by_status: ChartItem[];
  ticket_by_fascia: ChartItem[];
  ticket_by_tipo: ChartItem[];
  asset_by_stato: ChartItem[];
};
type TrendData = { labels: string[]; values: number[]; total: number };
type KpiAssetItem = {
  asset_id: number; asset_nome: string; asset_codice: string; asset_area: string;
  stato: string; mtbf_giorni: number; oee_pct: number;
  n_guasti: number; downtime_ore_30gg: number;
  stato_changed_at?: string | null;
  downtime_seconds?: number | null;
};
type KpiAsset = { assets: KpiAssetItem[]; aggregati: { avg_mtbf_giorni: number; avg_oee_pct: number } };

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

const PRIORITY_COLORS = ["#f87171", "#fbbf24", "#34d399", "#94a3b8"];
const STATO_ASSET_COLORS: Record<string, string> = { service: "#34d399", stopped: "#fbbf24", "out of service": "#f87171" };
const chartTooltipStyle = { background: "#0f172a", border: "1px solid rgba(148,163,184,0.2)", color: "#f8fafc", fontSize: 12, borderRadius: 8 };

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
          <circle cx="50" cy="50" r={r} fill="none" stroke="rgba(255,255,255,0.06)" strokeWidth="9" />
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

// ── KPI Card ─────────────────────────────────────────────────────────────────
function KpiCard({ label, value, accent, sub, icon }: { label: string; value: number | string; accent: string; sub?: string; icon: React.ReactNode }) {
  return (
    <div style={{
      background: "linear-gradient(135deg, var(--bg-card) 0%, rgba(15,23,42,0.8) 100%)",
      border: `1px solid ${accent}30`,
      borderRadius: 16,
      padding: "22px 24px",
      display: "flex", flexDirection: "column", gap: 16,
      position: "relative", overflow: "hidden",
      boxShadow: `0 0 0 1px ${accent}10, 0 8px 32px rgba(0,0,0,0.25), inset 0 1px 0 rgba(255,255,255,0.04)`,
      transition: "transform 0.2s, box-shadow 0.2s",
    }}
      onMouseEnter={e => { (e.currentTarget as HTMLDivElement).style.transform = "translateY(-2px)"; (e.currentTarget as HTMLDivElement).style.boxShadow = `0 0 0 1px ${accent}30, 0 16px 40px rgba(0,0,0,0.3), inset 0 1px 0 rgba(255,255,255,0.06)`; }}
      onMouseLeave={e => { (e.currentTarget as HTMLDivElement).style.transform = "translateY(0)"; (e.currentTarget as HTMLDivElement).style.boxShadow = `0 0 0 1px ${accent}10, 0 8px 32px rgba(0,0,0,0.25), inset 0 1px 0 rgba(255,255,255,0.04)`; }}
    >
      {/* Glow blob */}
      <div style={{ position: "absolute", top: -30, right: -30, width: 120, height: 120, background: accent, opacity: 0.12, filter: "blur(35px)", borderRadius: "50%", pointerEvents: "none" }} />
      {/* Top accent line */}
      <div style={{ position: "absolute", top: 0, left: 0, right: 0, height: 2, background: `linear-gradient(90deg, transparent, ${accent}, transparent)` }} />

      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", zIndex: 1 }}>
        <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: "0.15em", textTransform: "uppercase", color: "var(--text-muted)" }}>{label}</div>
        <div style={{ padding: "6px", background: `${accent}18`, borderRadius: 8, border: `1px solid ${accent}25`, color: accent }}>{icon}</div>
      </div>
      <div style={{ fontFamily: "var(--font-display)", fontSize: 48, fontWeight: 800, color: "var(--text-primary)", lineHeight: 1, zIndex: 1, letterSpacing: "-0.02em" }}>{value}</div>
      {sub && <div style={{ fontSize: 12, color: "var(--text-muted)", zIndex: 1, fontWeight: 500, borderTop: "1px solid rgba(255,255,255,0.05)", paddingTop: 12, marginTop: -4 }}>{sub}</div>}
    </div>
  );
}

// ── Chart Card ───────────────────────────────────────────────────────────────
function ChartCard({ title, subtitle, accent = "#3b82f6", children }: { title: string; subtitle?: string; accent?: string; children: React.ReactNode }) {
  return (
    <div style={{
      background: "linear-gradient(135deg, var(--bg-card) 0%, rgba(15,23,42,0.9) 100%)",
      border: "1px solid rgba(148,163,184,0.1)",
      borderRadius: 16,
      padding: "24px",
      boxShadow: "0 4px 24px rgba(0,0,0,0.15), inset 0 1px 0 rgba(255,255,255,0.04)",
      position: "relative", overflow: "hidden",
    }}>
      <div style={{ position: "absolute", top: 0, left: 0, right: 0, height: 2, background: `linear-gradient(90deg, transparent, ${accent}60, transparent)` }} />
      <div style={{ marginBottom: 20 }}>
        <div style={{ fontSize: 14, fontWeight: 700, color: "var(--text-primary)", letterSpacing: "0.02em" }}>{title}</div>
        {subtitle && <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 3 }}>{subtitle}</div>}
      </div>
      {children}
    </div>
  );
}

// ── OEE Mini Bar ─────────────────────────────────────────────────────────────
function OeeBar({ value }: { value: number }) {
  const color = value >= 85 ? "#34d399" : value >= 65 ? "#fbbf24" : "#f87171";
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
      <div style={{ flex: 1, height: 6, background: "rgba(255,255,255,0.06)", borderRadius: 3, overflow: "hidden", minWidth: 60 }}>
        <div style={{ width: `${value}%`, height: "100%", background: `linear-gradient(90deg, ${color}80, ${color})`, borderRadius: 3, transition: "width 0.6s ease", boxShadow: `0 0 6px ${color}60` }} />
      </div>
      <span style={{ fontSize: 12, fontWeight: 700, color, minWidth: 36, textAlign: "right" }}>{value}%</span>
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

// ── Main ─────────────────────────────────────────────────────────────────────
export default function DashboardPage() {
  const { user } = useAuth();
  const [dashboard, setDashboard] = useState<DashboardData | null>(null);
  const [charts, setCharts] = useState<DashboardCharts | null>(null);
  const [trend, setTrend] = useState<TrendData | null>(null);
  const [kpiAsset, setKpiAsset] = useState<(KpiAsset & { total: number; page: number; pages: number }) | null>(null);
  const [lastUpdate, setLastUpdate] = useState<Date | null>(null);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [selectedArea, setSelectedArea] = useState("");
  const [selectedStato, setSelectedStato] = useState("");
  const [areas, setAreas] = useState<string[]>([]);

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
    }
    loadInitial();
  }, []);

  useEffect(() => { loadKPIs(); }, [page, search, selectedArea, selectedStato]);

  const trendChartData = trend ? trend.labels.map((l, i) => ({ name: l, value: trend.values[i] })) : [];

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 28, paddingBottom: 48 }}>

      {/* ── Hero Header ─────────────────────────────────────────────────────── */}
      <div style={{
        position: "relative", borderRadius: 20, overflow: "hidden",
        background: "linear-gradient(135deg, #0f172a 0%, #1e1b4b 50%, #0f172a 100%)",
        border: "1px solid rgba(99,102,241,0.2)",
        padding: "32px 36px",
        boxShadow: "0 20px 60px rgba(0,0,0,0.4), inset 0 1px 0 rgba(255,255,255,0.05)",
      }}>
        {/* Grid mesh */}
        <div style={{ position: "absolute", inset: 0, backgroundImage: "linear-gradient(rgba(99,102,241,0.04) 1px, transparent 1px), linear-gradient(90deg, rgba(99,102,241,0.04) 1px, transparent 1px)", backgroundSize: "40px 40px", pointerEvents: "none" }} />
        {/* Glow blobs */}
        <div style={{ position: "absolute", top: -60, right: 80, width: 300, height: 300, background: "radial-gradient(circle, rgba(99,102,241,0.15) 0%, transparent 70%)", pointerEvents: "none" }} />
        <div style={{ position: "absolute", bottom: -40, left: 40, width: 200, height: 200, background: "radial-gradient(circle, rgba(16,185,129,0.1) 0%, transparent 70%)", pointerEvents: "none" }} />

        <div style={{ position: "relative", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
              <span style={{ fontSize: 10, fontWeight: 800, textTransform: "uppercase", letterSpacing: "0.25em", color: "#818cf8", background: "rgba(99,102,241,0.15)", border: "1px solid rgba(99,102,241,0.3)", padding: "3px 10px", borderRadius: 20 }}>
                Overview
              </span>
            </div>
            <h1 style={{ margin: 0, fontSize: 36, fontWeight: 800, fontFamily: "var(--font-display)", color: "#f8fafc", lineHeight: 1.1, letterSpacing: "-0.02em" }}>
              Ciao,{" "}
              <span style={{ background: "linear-gradient(135deg, #818cf8, #38bdf8)", WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent" }}>
                {user?.username ? user.username.charAt(0).toUpperCase() + user.username.slice(1) : "Operatore"}
              </span>
            </h1>
            <p style={{ margin: "10px 0 0", fontSize: 14, color: "rgba(148,163,184,0.85)", fontWeight: 400 }}>
              KPI manutentivi · MTBF · OEE · Stato asset in tempo reale
            </p>
          </div>

          <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 12 }}>
            {/* Live badge */}
            <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 16px", borderRadius: 30, background: "rgba(16,185,129,0.1)", border: "1px solid rgba(16,185,129,0.25)", fontSize: 12, color: "#34d399", fontWeight: 600 }}>
              <span style={{ width: 7, height: 7, borderRadius: "50%", background: "#34d399", display: "inline-block", boxShadow: "0 0 0 3px rgba(52,211,153,0.3)", animation: "pulse 2s infinite" }} />
              {lastUpdate ? `Live · ${lastUpdate.toLocaleTimeString("it-IT")}` : "Connessione..."}
            </div>
            {/* Trend mini */}
            {trendChartData.length > 0 && (
              <div>
                <div style={{ fontSize: 10, color: "rgba(148,163,184,0.5)", textAlign: "right", marginBottom: 4, letterSpacing: "0.08em", textTransform: "uppercase" }}>Trend 30gg</div>
                <ResponsiveContainer width={160} height={40}>
                  <AreaChart data={trendChartData}>
                    <defs>
                      <linearGradient id="trendGrad" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#818cf8" stopOpacity={0.4} />
                        <stop offset="95%" stopColor="#818cf8" stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <Area type="monotone" dataKey="value" stroke="#818cf8" strokeWidth={2} fill="url(#trendGrad)" dot={false} />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            )}
          </div>
        </div>

        {/* Stat strip */}
        {dashboard && (
          <div style={{ position: "relative", display: "grid", gridTemplateColumns: "repeat(5, 1fr)", gap: 1, marginTop: 28, background: "rgba(255,255,255,0.04)", borderRadius: 12, overflow: "hidden", border: "1px solid rgba(255,255,255,0.06)" }}>
            {[
              { label: "Asset Totali", value: dashboard.assets, color: "#38bdf8" },
              { label: "In Servizio", value: dashboard.asset_stati?.service ?? 0, color: "#34d399" },
              { label: "Fuori Servizio", value: dashboard.asset_stati?.["out of service"] ?? 0, color: "#f87171" },
              { label: "Ticket Aperti", value: dashboard.ticket_aperti, color: "#fbbf24" },
              { label: "In Corso", value: dashboard.ticket_in_corso, color: "#a78bfa" },
            ].map((s, i) => (
              <div key={i} style={{ padding: "14px 20px", background: i % 2 === 0 ? "rgba(255,255,255,0.02)" : "transparent", textAlign: "center" }}>
                <div style={{ fontFamily: "var(--font-display)", fontSize: 28, fontWeight: 800, color: s.color, lineHeight: 1 }}>{s.value}</div>
                <div style={{ fontSize: 10, color: "rgba(148,163,184,0.6)", fontWeight: 600, letterSpacing: "0.08em", textTransform: "uppercase", marginTop: 4 }}>{s.label}</div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* ── KPI Cards ───────────────────────────────────────────────────────── */}
      {dashboard && (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 16 }}>
          <KpiCard label="Asset totali" value={dashboard.assets} accent="#38bdf8" icon={<IconBox size={16} />} sub={`${dashboard.asset_stati?.service ?? 0} in servizio · ${dashboard.asset_stati?.stopped ?? 0} fermi · ${dashboard.asset_stati?.["out of service"] ?? 0} guasti`} />
          <KpiCard label="Tecnici attivi" value={`${dashboard.tecnici_disponibili}/${dashboard.tecnici}`} accent="#34d399" icon={<IconUsers size={16} />} sub="Disponibili oggi" />
          <KpiCard label="Ticket aperti" value={dashboard.ticket_aperti} accent="#fbbf24" icon={<IconTicket size={16} />} sub={`${dashboard.ticket_in_corso} in lavorazione · ${dashboard.ticket_chiusi} chiusi`} />
          <KpiCard label="Ticket pianificati" value={dashboard.ticket_pianificati} accent="#a78bfa" icon={<IconCalendar size={16} />} sub="Schedulati dal planner AI" />
        </div>
      )}

      {/* ── MTBF + OEE Ring Cards ────────────────────────────────────────────── */}
      {kpiAsset && (
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
          <div style={{
            background: "linear-gradient(135deg, rgba(129,140,248,0.06) 0%, var(--bg-card) 100%)",
            border: "1px solid rgba(129,140,248,0.2)",
            borderRadius: 16, padding: "28px 32px",
            boxShadow: "0 4px 24px rgba(0,0,0,0.15), inset 0 1px 0 rgba(255,255,255,0.04)",
            position: "relative", overflow: "hidden",
          }}>
            <div style={{ position: "absolute", top: 0, left: 0, right: 0, height: 2, background: "linear-gradient(90deg, transparent, #818cf8, transparent)" }} />
            <div style={{ position: "absolute", top: -40, right: -40, width: 160, height: 160, background: "rgba(129,140,248,0.08)", borderRadius: "50%", filter: "blur(30px)", pointerEvents: "none" }} />
            <div style={{ fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.15em", color: "#818cf8", marginBottom: 20 }}>Mean Time Between Failures</div>
            <RingProgress value={kpiAsset.aggregati.avg_mtbf_giorni} max={90} color="#818cf8" size={110} label={`${kpiAsset.aggregati.avg_mtbf_giorni}gg`} sublabel="MTBF Medio" />
          </div>
          <div style={{
            background: "linear-gradient(135deg, rgba(52,211,153,0.06) 0%, var(--bg-card) 100%)",
            border: "1px solid rgba(52,211,153,0.2)",
            borderRadius: 16, padding: "28px 32px",
            boxShadow: "0 4px 24px rgba(0,0,0,0.15), inset 0 1px 0 rgba(255,255,255,0.04)",
            position: "relative", overflow: "hidden",
          }}>
            <div style={{ position: "absolute", top: 0, left: 0, right: 0, height: 2, background: "linear-gradient(90deg, transparent, #34d399, transparent)" }} />
            <div style={{ position: "absolute", top: -40, right: -40, width: 160, height: 160, background: "rgba(52,211,153,0.08)", borderRadius: "50%", filter: "blur(30px)", pointerEvents: "none" }} />
            <div style={{ fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.15em", color: "#34d399", marginBottom: 20 }}>Overall Equipment Effectiveness · 30gg</div>
            <RingProgress value={kpiAsset.aggregati.avg_oee_pct} max={100} color="#34d399" size={110} label={`${kpiAsset.aggregati.avg_oee_pct}%`} sublabel="OEE Medio" />
          </div>
        </div>
      )}

      {/* ── Charts Row 1 ────────────────────────────────────────────────────── */}
      {charts && (
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
          <ChartCard title="Ticket per Priorità" subtitle="Distribuzione per livello di urgenza" accent="#f87171">
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
                <Pie data={charts.ticket_by_priority} dataKey="value" nameKey="name" innerRadius={60} outerRadius={88} paddingAngle={3} strokeWidth={0}>
                  {charts.ticket_by_priority.map((entry, i) => (
                    <Cell key={entry.name} fill={`url(#pg${i})`} stroke={PRIORITY_COLORS[i]} strokeWidth={1} />
                  ))}
                </Pie>
                <Tooltip contentStyle={chartTooltipStyle} />
                <Legend iconType="circle" iconSize={8} formatter={(v) => <span style={{ color: "var(--text-secondary)", fontSize: 12 }}>{v}</span>} />
              </PieChart>
            </ResponsiveContainer>
          </ChartCard>

          <ChartCard title="Asset per Stato Operativo" subtitle="Snapshot dello stato attuale del parco macchine" accent="#34d399">
            {charts.asset_by_stato?.length ? (
              <ResponsiveContainer width="100%" height={220}>
                <PieChart>
                  <Pie data={charts.asset_by_stato} dataKey="value" nameKey="name" innerRadius={60} outerRadius={88} paddingAngle={3} strokeWidth={0}>
                    {charts.asset_by_stato.map((entry) => (
                      <Cell key={entry.name} fill={STATO_ASSET_COLORS[entry.name] ?? "#94a3b8"} stroke={STATO_ASSET_COLORS[entry.name] ?? "#94a3b8"} strokeWidth={1} />
                    ))}
                  </Pie>
                  <Tooltip contentStyle={chartTooltipStyle} />
                  <Legend iconType="circle" iconSize={8} formatter={(v) => <span style={{ color: "var(--text-secondary)", fontSize: 12 }}>{v}</span>} />
                </PieChart>
              </ResponsiveContainer>
            ) : (
              <div style={{ color: "var(--text-muted)", textAlign: "center", padding: 48, fontSize: 13 }}>Nessun dato asset.</div>
            )}
          </ChartCard>
        </div>
      )}

      {/* ── Charts Row 2 ────────────────────────────────────────────────────── */}
      {kpiAsset && kpiAsset.assets.length > 0 && (
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
          <ChartCard title="MTBF per Asset" subtitle="Mean Time Between Failures — pagina corrente" accent="#818cf8">
            <ResponsiveContainer width="100%" height={220}>
              <BarChart layout="vertical" data={kpiAsset.assets.map(a => ({ name: a.asset_codice || a.asset_nome, value: a.mtbf_giorni }))} margin={{ left: 0 }}>
                <defs>
                  <linearGradient id="mtbfGrad" x1="0" y1="0" x2="1" y2="0">
                    <stop offset="0%" stopColor="#818cf8" stopOpacity={0.5} />
                    <stop offset="100%" stopColor="#818cf8" stopOpacity={0.9} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.04)" horizontal={false} />
                <XAxis type="number" tick={{ fill: "#64748b", fontSize: 11 }} axisLine={false} tickLine={false} />
                <YAxis type="category" dataKey="name" tick={{ fill: "#94a3b8", fontSize: 11, fontWeight: 600 }} width={80} axisLine={false} tickLine={false} />
                <Tooltip contentStyle={chartTooltipStyle} formatter={(v) => [`${v} gg`, "MTBF"]} cursor={{ fill: "rgba(255,255,255,0.03)" }} />
                <Bar dataKey="value" fill="url(#mtbfGrad)" radius={[0, 6, 6, 0]} maxBarSize={20} />
              </BarChart>
            </ResponsiveContainer>
          </ChartCard>

          <ChartCard title="OEE per Asset" subtitle="Overall Equipment Effectiveness — 30gg" accent="#34d399">
            <ResponsiveContainer width="100%" height={220}>
              <BarChart layout="vertical" data={kpiAsset.assets.map(a => ({ name: a.asset_codice || a.asset_nome, value: a.oee_pct }))} margin={{ left: 0 }}>
                <defs>
                  <linearGradient id="oeeGrad" x1="0" y1="0" x2="1" y2="0">
                    <stop offset="0%" stopColor="#34d399" stopOpacity={0.5} />
                    <stop offset="100%" stopColor="#34d399" stopOpacity={0.9} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.04)" horizontal={false} />
                <XAxis type="number" tick={{ fill: "#64748b", fontSize: 11 }} domain={[0, 100]} axisLine={false} tickLine={false} />
                <YAxis type="category" dataKey="name" tick={{ fill: "#94a3b8", fontSize: 11, fontWeight: 600 }} width={80} axisLine={false} tickLine={false} />
                <Tooltip contentStyle={chartTooltipStyle} formatter={(v) => [`${v}%`, "OEE"]} cursor={{ fill: "rgba(255,255,255,0.03)" }} />
                <Bar dataKey="value" fill="url(#oeeGrad)" radius={[0, 6, 6, 0]} maxBarSize={20} />
              </BarChart>
            </ResponsiveContainer>
          </ChartCard>
        </div>
      )}

      {/* ── Asset KPI Table ──────────────────────────────────────────────────── */}
      <div style={{
        background: "linear-gradient(135deg, var(--bg-card) 0%, rgba(15,23,42,0.95) 100%)",
        border: "1px solid rgba(148,163,184,0.1)",
        borderRadius: 16, overflow: "hidden",
        boxShadow: "0 4px 24px rgba(0,0,0,0.15)",
      }}>
        {/* Table header */}
        <div style={{ padding: "20px 24px", borderBottom: "1px solid rgba(255,255,255,0.05)", display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 16 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <div style={{ padding: 7, background: "rgba(56,189,248,0.1)", borderRadius: 8, border: "1px solid rgba(56,189,248,0.2)", color: "#38bdf8" }}>
              <IconActivity size={15} />
            </div>
            <div>
              <div style={{ fontSize: 14, fontWeight: 700, color: "var(--text-primary)" }}>Dettaglio KPI per Asset</div>
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
              options={[{ value: "", label: "Tutte le aree", color: "var(--blue)" }, ...areas.map(a => ({ value: a, label: a, color: "#818cf8" }))]} />
            <StatusToggle size="sm" currentValue={selectedStato} onChange={(v) => { setSelectedStato(v); setPage(1); }}
              options={[
                { value: "", label: "Tutti", color: "var(--blue)" },
                { value: "service", label: "Servizio", color: "#34d399" },
                { value: "stopped", label: "Fermo", color: "#fbbf24" },
                { value: "out of service", label: "Guasto", color: "#f87171" },
              ]} />
          </div>
        </div>

        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
            <thead>
              <tr style={{ background: "rgba(255,255,255,0.02)" }}>
                {["Codice", "Asset", "Area", "Stato", "MTBF (gg)", "OEE", "Guasti", "Downtime", "In Corso"].map(h => (
                  <th key={h} style={{ padding: "11px 16px", textAlign: "left", fontSize: 10, fontWeight: 700, letterSpacing: ".12em", textTransform: "uppercase", color: "#64748b", borderBottom: "1px solid rgba(255,255,255,0.06)", whiteSpace: "nowrap" }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {kpiAsset?.assets.map((a, idx) => (
                <tr key={a.asset_id}
                  style={{ borderBottom: "1px solid rgba(255,255,255,0.04)", transition: "background 0.15s", background: idx % 2 === 0 ? "rgba(255,255,255,0.01)" : "transparent" }}
                  onMouseEnter={e => (e.currentTarget.style.background = "rgba(99,102,241,0.05)")}
                  onMouseLeave={e => (e.currentTarget.style.background = idx % 2 === 0 ? "rgba(255,255,255,0.01)" : "transparent")}
                >
                  <td style={{ padding: "13px 16px", fontFamily: "var(--font-mono)", fontSize: 12, color: "#60a5fa", fontWeight: 600 }}>{a.asset_codice || "—"}</td>
                  <td style={{ padding: "13px 16px", fontWeight: 700, color: "var(--text-primary)", whiteSpace: "nowrap" }}>{a.asset_nome}</td>
                  <td style={{ padding: "13px 16px", color: "#64748b", fontSize: 12 }}>{a.asset_area || "—"}</td>
                  <td style={{ padding: "13px 16px" }}><StatoDot stato={a.stato} /></td>
                  <td style={{ padding: "13px 16px" }}>
                    <span style={{ fontFamily: "var(--font-display)", fontSize: 16, fontWeight: 800, color: "#818cf8" }}>{a.mtbf_giorni}</span>
                    <span style={{ fontSize: 10, color: "#64748b", marginLeft: 3 }}>gg</span>
                  </td>
                  <td style={{ padding: "13px 16px", minWidth: 130 }}><OeeBar value={a.oee_pct} /></td>
                  <td style={{ padding: "13px 16px", color: a.n_guasti > 5 ? "#f87171" : "#94a3b8", fontWeight: 700 }}>{a.n_guasti}</td>
                  <td style={{ padding: "13px 16px", color: "#94a3b8", fontSize: 12 }}>{a.downtime_ore_30gg}h</td>
                  <td style={{ padding: "13px 16px" }}>
                    {a.stato === "out of service" && a.stato_changed_at
                      ? <DowntimeTicker statoChangedAt={a.stato_changed_at} secondsFromBackend={a.downtime_seconds} />
                      : <span style={{ color: "#334155", fontSize: 12 }}>—</span>}
                  </td>
                </tr>
              ))}
              {(!kpiAsset || kpiAsset.assets.length === 0) && (
                <tr><td colSpan={9} style={{ padding: 48, textAlign: "center", color: "#334155" }}>Nessun asset trovato.</td></tr>
              )}
            </tbody>
          </table>
        </div>

        {kpiAsset && kpiAsset.pages > 1 && (
          <div style={{ padding: "16px 24px", borderTop: "1px solid rgba(255,255,255,0.05)", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <div style={{ fontSize: 12, color: "#475569" }}>
              {kpiAsset.assets.length} di <span style={{ color: "#94a3b8", fontWeight: 700 }}>{kpiAsset.total}</span> asset
            </div>
            <div style={{ display: "flex", gap: 8 }}>
              <button className="btn btn-secondary" style={{ padding: "5px 14px", fontSize: 12 }} disabled={page === 1} onClick={() => setPage(p => p - 1)}>← Prec.</button>
              <span style={{ display: "flex", alignItems: "center", fontSize: 12, color: "#94a3b8", padding: "0 8px" }}>
                {page} / {kpiAsset.pages}
              </span>
              <button className="btn btn-secondary" style={{ padding: "5px 14px", fontSize: 12 }} disabled={page === kpiAsset.pages} onClick={() => setPage(p => p + 1)}>Succ. →</button>
            </div>
          </div>
        )}
      </div>

      <style>{`
        @keyframes pulse {
          0%, 100% { box-shadow: 0 0 0 3px rgba(52,211,153,0.3); }
          50% { box-shadow: 0 0 0 6px rgba(52,211,153,0.1); }
        }
      `}</style>
    </div>
  );
}
