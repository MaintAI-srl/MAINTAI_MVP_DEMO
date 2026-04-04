"use client";

import { useEffect, useState, useMemo } from "react";
import { apiGet } from "../lib/api";
import { useAuth } from "../lib/auth";
import StatusToggle from "../components/StatusToggle";
import {
  Chart as ChartJS, ArcElement, Tooltip, Legend,
  CategoryScale, LinearScale, PointElement, LineElement, BarElement, Filler,
} from "chart.js";
import { Doughnut, Line, Bar } from "react-chartjs-2";

ChartJS.register(ArcElement, Tooltip, Legend, CategoryScale, LinearScale, PointElement, LineElement, BarElement, Filler);

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

function DowntimeTicker({ statoChangedAt, secondsFromBackend }: { statoChangedAt?: string | null, secondsFromBackend?: number | null }) {
  const [, setTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setTick(t => t + 1), 1000);
    return () => clearInterval(id);
  }, []);

  return (
    <span style={{ fontFamily: "var(--font-mono)", fontSize: 12, color: "var(--red)", fontWeight: 700, background: "var(--red-dim)", padding: "4px 10px", borderRadius: 6 }}>
      🔴 {formatDowntime(secondsFromBackend, statoChangedAt)}
    </span>
  );
}

function formatDowntime(secondsFromBackend: number | null | undefined, statoChangedAt: string | null | undefined): string {
  if (!statoChangedAt) return "—";
  const start = new Date(statoChangedAt);
  const totalSec = Math.floor((Date.now() - start.getTime()) / 1000);
  if (totalSec < 0) return "—";
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  return `${h}h ${String(m).padStart(2,'0')}m ${String(s).padStart(2,'0')}s`;
}

const PRIORITY_COLORS = ["#f87171", "#fbbf24", "#34d399", "var(--text-secondary)"];
const STATUS_COLORS = ["#60a5fa", "#a78bfa", "#fbbf24", "#34d399", "#f87171"];
const STATO_ASSET_COLORS: Record<string, string> = { service: "#34d399", stopped: "#fbbf24", "out of service": "#f87171" };

const tooltipOptions = {
  backgroundColor: "var(--bg-elevated)", titleColor: "var(--text-primary)",
  bodyColor: "var(--text-secondary)", borderColor: "var(--border-bright)", borderWidth: 1,
  padding: 12, boxPadding: 6,
};

const doughnutOptions = {
  responsive: true, maintainAspectRatio: false, cutout: "70%",
  plugins: { legend: { position: "bottom" as const, labels: { color: "var(--text-secondary)", font: { size: 12, family: "var(--font-body)" }, padding: 16, boxWidth: 12 } }, tooltip: tooltipOptions },
};

function KpiCard({ label, value, accent, sub }: { label: string; value: number | string; accent: string; sub?: string }) {
  return (
    <div style={{ 
      background: "var(--bg-card)", border: "1px solid var(--border)", borderRadius: "var(--radius-lg)", 
      padding: "24px", display: "flex", flexDirection: "column", gap: 12, 
      position: "relative", overflow: "hidden", boxShadow: "0 8px 30px rgba(0,0,0,0.12)" 
    }}>
      <div style={{ position: "absolute", top: 0, left: 0, width: "100%", height: 3, background: accent }} />
      <div style={{ position: "absolute", top: "-50px", right: "-50px", width: 140, height: 140, background: accent, opacity: 0.15, filter: "blur(40px)", borderRadius: "50%", pointerEvents: "none" }} />
      <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: "0.15em", textTransform: "uppercase", color: "var(--text-muted)", zIndex: 1 }}>{label}</div>
      <div style={{ fontFamily: "var(--font-display)", fontSize: 46, fontWeight: 800, color: "var(--text-primary)", lineHeight: 1, zIndex: 1, textShadow: "0 2px 10px rgba(0,0,0,0.2)" }}>{value}</div>
      {sub && <div style={{ fontSize: 13, color: "var(--text-secondary)", zIndex: 1, fontWeight: 500 }}>{sub}</div>}
    </div>
  );
}

function ChartCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{ background: "var(--bg-card)", border: "1px solid var(--border)", borderRadius: "var(--radius-lg)", padding: "24px", boxShadow: "0 4px 20px rgba(0,0,0,0.06)" }}>
      <div style={{ fontSize: 15, fontWeight: 700, letterSpacing: "0.04em", color: "var(--text-primary)", marginBottom: 24 }}>{title}</div>
      {children}
    </div>
  );
}

export default function DashboardPage() {
  const { user } = useAuth();
  const [dashboard, setDashboard] = useState<DashboardData | null>(null);
  const [charts, setCharts] = useState<DashboardCharts | null>(null);
  const [trend, setTrend] = useState<TrendData | null>(null);
  const [kpiAsset, setKpiAsset] = useState<(KpiAsset & { total: number; page: number; pages: number }) | null>(null);
  const [error, setError] = useState("");
  const [lastUpdate, setLastUpdate] = useState<Date | null>(null);

  // Filtri e Paginazione
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [selectedArea, setSelectedArea] = useState("");
  const [selectedStato, setSelectedStato] = useState("");
  const [areas, setAreas] = useState<string[]>([]);

  // Helper per risolvere i colori delle variabili CSS a runtime per Chart.js
  const getThemeColor = (varName: string, fallback: string) => {
    if (typeof window === 'undefined') return fallback;
    const val = getComputedStyle(document.documentElement).getPropertyValue(varName).trim();
    return val || fallback;
  };

  const textPrimary = getThemeColor('--text-primary', '#f8fafc');
  const textMuted = getThemeColor('--text-muted', '#94a3b8');
  const textSecondary = getThemeColor('--text-secondary', '#cbd5e1');
  const chartGrid = getThemeColor('--chart-grid', 'rgba(255,255,255,0.06)');

  const lineOptions = {
    responsive: true, maintainAspectRatio: false,
    plugins: { legend: { display: false }, tooltip: tooltipOptions },
    scales: {
      x: { grid: { color: chartGrid }, ticks: { color: textMuted, font: { size: 11 } } },
      y: { grid: { color: chartGrid }, ticks: { color: textMuted, font: { size: 11 } }, beginAtZero: true },
    },
  };

  const barOptions = {
    responsive: true, maintainAspectRatio: false, indexAxis: "y" as const,
    plugins: { legend: { display: false }, tooltip: tooltipOptions },
    scales: {
      x: { grid: { color: chartGrid }, ticks: { color: textMuted, font: { size: 11 } }, beginAtZero: true },
      y: { grid: { display: false }, ticks: { color: textSecondary, font: { size: 12, weight: "bold" as const } } },
    },
  };


  async function loadKPIs() {
    try {
      const q = new URLSearchParams({
        page: String(page),
        limit: "10",
        ...(search && { search }),
        ...(selectedArea && { area: selectedArea }),
        ...(selectedStato && { stato: selectedStato }),
      });
      const data = await apiGet<any>(`/dashboard/kpi-asset?${q.toString()}`);
      setKpiAsset(data);
    } catch (err) {
      console.error("Asset KPI Load Error:", err);
    }
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
        if (dashboardData) {
          setDashboard(dashboardData);
          if (dashboardData.areas) setAreas(dashboardData.areas);
        }
        if (chartsData) setCharts(chartsData);
        if (trendData) setTrend(trendData);
        if (kpiData) setKpiAsset(kpiData);
        setLastUpdate(new Date());
        setError("");
      } catch (err: any) {
        console.error("Dashboard Load Error:", err);
        setError("Errore di connessione al backend.");
      }
    }
    loadInitial();
  }, []);

  useEffect(() => {
    loadKPIs();
  }, [page, search, selectedArea, selectedStato]);

  const priorityData = useMemo(() => charts ? {
    labels: charts.ticket_by_priority.map(i => i.name),
    datasets: [{ data: charts.ticket_by_priority.map(i => i.value), backgroundColor: PRIORITY_COLORS, borderWidth: 0, hoverOffset: 4 }],
  } : null, [charts]);

  const statusData = useMemo(() => charts ? {
    labels: charts.ticket_by_status.map(i => i.name),
    datasets: [{ data: charts.ticket_by_status.map(i => i.value), backgroundColor: STATUS_COLORS, borderWidth: 0, hoverOffset: 4 }],
  } : null, [charts]);

  const assetStatoData = useMemo(() => charts?.asset_by_stato?.length ? {
    labels: charts.asset_by_stato.map(i => i.name),
    datasets: [{ data: charts.asset_by_stato.map(i => i.value), backgroundColor: charts.asset_by_stato.map(i => STATO_ASSET_COLORS[i.name] || "var(--text-secondary)"), borderWidth: 0, hoverOffset: 4 }],
  } : null, [charts]);

  const tipoData = useMemo(() => charts ? {
    labels: charts.ticket_by_tipo.map(i => i.name),
    datasets: [{ label: "Ticket", data: charts.ticket_by_tipo.map(i => i.value), backgroundColor: "rgba(59,130,246,0.6)", borderColor: "var(--blue)", borderWidth: 1, borderRadius: 4 }],
  } : null, [charts]);

  const trendChartData = useMemo(() => trend ? {
    labels: trend.labels,
    datasets: [{ label: "Ticket attivi", data: trend.values, fill: true, backgroundColor: "rgba(59,130,246,0.12)", borderColor: "var(--blue)", borderWidth: 2, pointBackgroundColor: "var(--blue)", pointRadius: 3, tension: 0.4 }],
  } : null, [trend]);

  const mtbfData = useMemo(() => kpiAsset?.assets?.length ? {
    labels: kpiAsset.assets.map(a => a.asset_codice || a.asset_nome),
    datasets: [{ label: "MTBF (giorni)", data: kpiAsset.assets.map(a => a.mtbf_giorni), backgroundColor: "rgba(129,140,248,.6)", borderColor: "#818cf8", borderWidth: 1, borderRadius: 4 }],
  } : null, [kpiAsset]);

  const oeeData = useMemo(() => kpiAsset?.assets?.length ? {
    labels: kpiAsset.assets.map(a => a.asset_codice || a.asset_nome),
    datasets: [{ label: "OEE (%)", data: kpiAsset.assets.map(a => a.oee_pct), backgroundColor: "rgba(52,211,153,.6)", borderColor: "#34d399", borderWidth: 1, borderRadius: 4 }],
  } : null, [kpiAsset]);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 24, paddingBottom: 40 }}>
      {/* Header */}
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between" }}>
        <div>
          <div style={{ fontSize: 11, fontWeight: 800, textTransform: "uppercase", letterSpacing: "0.2em", color: "var(--blue-bright)", marginBottom: 8 }}>Overview</div>
          <h1 className="page-title" style={{ fontSize: 34, marginBottom: 8, color: "var(--text-primary)" }}>
            Benvenuto, {user?.username ? user.username.charAt(0).toUpperCase() + user.username.slice(1) : 'Operatore'}
          </h1>
          <p className="page-subtitle" style={{ color: "var(--text-secondary)", fontSize: 15 }}>KPI manutentivi, MTBF, OEE e stato degli asset in tempo reale.</p>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 16px", borderRadius: 30, background: "var(--green-dim)", border: "1px solid rgba(16,185,129,0.3)", fontSize: 13, color: "var(--green)", fontWeight: 600, boxShadow: "0 4px 12px rgba(16,185,129,0.1)" }}>
          <span style={{ width: 8, height: 8, borderRadius: "50%", background: "var(--green)", display: "inline-block", boxShadow: "0 0 10px var(--green)" }} />
          {lastUpdate ? `Aggiornato ${lastUpdate.toLocaleTimeString("it-IT")}` : "Caricamento..."}
        </div>
      </div>

      {error && <div style={{ color: "#fecaca", background: "rgba(127,29,29,0.35)", border: "1px solid rgba(248,113,113,0.35)", padding: "12px 16px", borderRadius: 10 }}>{error}</div>}

      {/* KPI Cards */}
      {dashboard && (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 16 }}>
          <KpiCard label="Asset totali" value={dashboard.assets} accent="#38bdf8" sub={`S:${dashboard.asset_stati?.service ?? 0} / St:${dashboard.asset_stati?.stopped ?? 0} / OoS:${dashboard.asset_stati?.["out of service"] ?? 0}`} />
          <KpiCard label="Tecnici attivi" value={`${dashboard.tecnici_disponibili}/${dashboard.tecnici}`} accent="var(--green)" sub="In servizio" />
          <KpiCard label="Ticket aperti" value={dashboard.ticket_aperti} accent="var(--amber)" sub={`+${dashboard.ticket_in_corso} in corso`} />
          <KpiCard label="Ticket pianificati" value={dashboard.ticket_pianificati} accent="#8b5cf6" sub={`${dashboard.ticket_chiusi} chiusi totali`} />
        </div>
      )}

      {/* KPI MTBF / OEE aggregati */}
      {kpiAsset && (
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
          <KpiCard label="MTBF medio (filtro)" value={`${kpiAsset.aggregati.avg_mtbf_giorni}gg`} accent="#818cf8" sub="Mean Time Between Failures" />
          <KpiCard label="OEE medio (filtro)" value={`${kpiAsset.aggregati.avg_oee_pct}%`} accent="#34d399" sub="Overall Equipment Effectiveness (30gg)" />
        </div>
      )}

      {/* Grafici riga 1: priorità + stato */}
      {charts && (
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
          <ChartCard title="Ticket per Priorità">
            {priorityData && <div style={{ height: 200, display: "flex", alignItems: "center", justifyContent: "center" }}><Doughnut data={priorityData} options={{ ...doughnutOptions, plugins: { ...doughnutOptions.plugins, legend: { ...doughnutOptions.plugins.legend, labels: { ...doughnutOptions.plugins.legend.labels, color: textSecondary } } } }} /></div>}
          </ChartCard>
          <ChartCard title="Asset per Stato operativo">
            {assetStatoData
              ? <div style={{ height: 200, display: "flex", alignItems: "center", justifyContent: "center" }}><Doughnut data={assetStatoData} options={{ ...doughnutOptions, plugins: { ...doughnutOptions.plugins, legend: { ...doughnutOptions.plugins.legend, labels: { ...doughnutOptions.plugins.legend.labels, color: textSecondary } } } }} /></div>
              : <div style={{ color: "var(--text-muted)", textAlign: "center", padding: 40 }}>Nessun dato asset.</div>}
          </ChartCard>
        </div>
      )}

      {/* Grafici riga 2: MTBF + OEE per asset (Pagina Corrente) */}
      {kpiAsset && kpiAsset.assets.length > 0 && (
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
          <ChartCard title="MTBF per Asset (Pagina)">
            {mtbfData && <div style={{ height: 200 }}><Bar data={mtbfData} options={{ ...barOptions, scales: { ...barOptions.scales, x: { ...barOptions.scales.x, max: Math.max(...kpiAsset.assets.map(a => a.mtbf_giorni), 1) * 1.2 } } }} /></div>}
          </ChartCard>
          <ChartCard title="OEE per Asset (Pagina)">
            {oeeData && <div style={{ height: 200 }}><Bar data={oeeData} options={{ ...barOptions, scales: { ...barOptions.scales, x: { ...barOptions.scales.x, max: 100 } } }} /></div>}
          </ChartCard>
        </div>
      )}

      {/* Tabella KPI per asset con Filtri e Paginazione */}
      <div style={{ background: "var(--bg-card)", border: "1px solid var(--border)", borderRadius: "var(--radius-lg)", padding: "24px", boxShadow: "0 4px 20px rgba(0,0,0,0.06)" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20, flexWrap: "wrap", gap: 16 }}>
          <div style={{ fontSize: 15, fontWeight: 700, color: "var(--text-primary)" }}>Dettaglio KPI per Asset</div>
          
          {/* Barra Filtri */}
          <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
            <input 
              type="text" 
              className="input"
              placeholder="Cerca asset/codice..."
              style={{ width: 200, fontSize: 13 }}
              value={search}
              onChange={(e) => { setSearch(e.target.value); setPage(1); }}
            />
          <div style={{ display: "flex", gap: "10px", flexWrap: "wrap", alignItems: "center" }}>
            <span style={{ fontSize: 11, fontWeight: 700, color: "var(--text-muted)", textTransform: "uppercase" }}>Famiglia:</span>
            <StatusToggle 
              size="sm"
              currentValue={selectedArea}
              onChange={(v) => { setSelectedArea(v); setPage(1); }}
              options={[
                { value: "", label: "Tutte", color: "var(--blue)" },
                ...areas.map(a => ({ value: a, label: a, color: "#818cf8" }))
              ]}
            />

            <span style={{ fontSize: 11, fontWeight: 700, color: "var(--text-muted)", textTransform: "uppercase", marginLeft: 10 }}>Stato:</span>
            <StatusToggle 
              size="sm"
              currentValue={selectedStato}
              onChange={(v) => { setSelectedStato(v); setPage(1); }}
              options={[
                { value: "", label: "Tutti", color: "var(--blue)" },
                { value: "service", label: "Servizio", color: "#34d399" },
                { value: "stopped", label: "Fermo", color: "#fbbf24" },
                { value: "out of service", label: "Guasto", color: "#f87171" },
              ]}
            />
          </div>
          </div>
        </div>

        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
            <thead>
              <tr style={{ borderBottom: "1px solid var(--table-border)" }}>
                {["Codice", "Asset", "Famiglia", "Stato", "MTBF (gg)", "OEE (%)", "Guasti (tot)", "Downtime (h)", "⏱ In Corso"].map(h => (
                  <th key={h} style={{ padding: "12px 16px", textAlign: "left", fontSize: 11, fontWeight: 700, letterSpacing: ".1em", textTransform: "uppercase", color: "var(--text-muted)" }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {kpiAsset && kpiAsset.assets.map(a => (
                <tr key={a.asset_id} style={{ borderBottom: "1px solid var(--table-border)", transition: "background 0.2s" }} className="hover-row">
                  <td style={{ padding: "14px 16px", fontFamily: "var(--font-mono)", color: "var(--blue)" }}>{a.asset_codice || "—"}</td>
                  <td style={{ padding: "14px 16px", fontWeight: 700, color: "var(--text-primary)" }}>{a.asset_nome}</td>
                  <td style={{ padding: "14px 16px", color: "var(--text-secondary)" }}>{a.asset_area || "—"}</td>
                  <td style={{ padding: "14px 16px" }}>
                    <span style={{ color: STATO_ASSET_COLORS[a.stato] || "var(--text-secondary)", background: "var(--bg-overlay)", padding: "4px 10px", borderRadius: 6, fontSize: 11, fontWeight: 600 }}>{a.stato}</span>
                  </td>
                  <td style={{ padding: "14px 16px", color: "var(--purple)", fontWeight: 800 }}>{a.mtbf_giorni}</td>
                  <td style={{ padding: "14px 16px", color: a.oee_pct >= 85 ? "var(--green)" : a.oee_pct >= 65 ? "var(--amber)" : "var(--red)", fontWeight: 800 }}>{a.oee_pct}%</td>
                  <td style={{ padding: "14px 16px", color: "var(--text-muted)", fontWeight: 500 }}>{a.n_guasti}</td>
                  <td style={{ padding: "14px 16px", color: "var(--text-muted)", fontWeight: 500 }}>{a.downtime_ore_30gg}h</td>
                  <td style={{ padding: "14px 16px" }}>
                    {a.stato === "out of service" && a.stato_changed_at ? (
                      <DowntimeTicker statoChangedAt={a.stato_changed_at} secondsFromBackend={a.downtime_seconds} />
                    ) : (
                      <span style={{ color: "var(--text-disabled)", fontSize: 12 }}>—</span>
                    )}
                  </td>
                </tr>
              ))}
              {(!kpiAsset || kpiAsset.assets.length === 0) && (
                <tr>
                   <td colSpan={9} style={{ padding: "40px", textAlign: "center", color: "var(--text-muted)" }}>Nessun asset trovato con i filtri selezionati.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {/* Paginazione */}
        {kpiAsset && kpiAsset.pages > 1 && (
          <div style={{ marginTop: 24, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <div style={{ fontSize: 13, color: "var(--text-muted)" }}>
              Mostrando {kpiAsset.assets.length} di {kpiAsset.total} asset
            </div>
            <div style={{ display: "flex", gap: 8 }}>
              <button 
                className="btn btn-secondary" 
                style={{ padding: "6px 14px", fontSize: 13 }}
                disabled={page === 1}
                onClick={() => setPage(p => p - 1)}
              >
                Precedente
              </button>
              <div style={{ display: "flex", alignItems: "center", gap: 10, fontSize: 13, fontWeight: 600, color: "var(--text-primary)", padding: "0 10px" }}>
                Pagina {page} di {kpiAsset.pages}
              </div>
              <button 
                className="btn btn-secondary" 
                style={{ padding: "6px 14px", fontSize: 13 }}
                disabled={page === kpiAsset.pages}
                onClick={() => setPage(p => p + 1)}
              >
                Successiva
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
