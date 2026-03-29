"use client";

import { useEffect, useState } from "react";
import { API_BASE } from "../lib/api";

type AnalyticsData = {
  asset_id: number;
  mtbf_days: number;
  mttr_hours: number;
  stats: {
    total: number;
    breakdowns: number;
    preventive: number;
    corrective: number;
    inspections: number;
  };
  failure_trend: { mese: string; guasti: number }[];
  availability_score: number;
};

type Props = {
  asset: { id: number; nome: string; codice: string };
  onClose: () => void;
};

export default function AssetAnalyticsModal({ asset, onClose }: Props) {
  const [data, setData] = useState<AnalyticsData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch(`${API_BASE}/assets/${asset.id}/analytics`)
      .then(r => r.json())
      .then(setData)
      .finally(() => setLoading(false));
  }, [asset.id]);

  if (loading) return null;

  const maxGuasti = data ? Math.max(...data.failure_trend.map(t => t.guasti), 1) : 1;

  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 3000, display: "flex", alignItems: "center", justifyContent: "center", background: "rgba(0,0,0,0.7)", backdropFilter: "blur(8px)" }} onClick={onClose}>
      <div style={{ background: "#0f172a", border: "1px solid rgba(99,102,241,0.3)", borderRadius: 24, padding: 32, width: "min(680px, 95vw)", maxHeight: "90vh", overflowY: "auto" }} onClick={e => e.stopPropagation()}>
        
        {/* Header */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 32 }}>
          <div>
            <h2 style={{ margin: 0, fontSize: 24, fontWeight: 800, color: "#fff" }}>Analytics Asset</h2>
            <div style={{ color: "#818cf8", fontSize: 13, fontWeight: 600, marginTop: 4 }}>{asset.nome} <span style={{ opacity: 0.5 }}>— {asset.codice}</span></div>
          </div>
          <button onClick={onClose} style={{ background: "rgba(255,255,255,0.05)", border: "none", color: "#94a3b8", width: 36, height: 36, borderRadius: "50%", cursor: "pointer", fontSize: 20 }}>×</button>
        </div>

        {data && (
          <>
            {/* KPI Grid */}
            <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 16, marginBottom: 32 }}>
              <div style={{ background: "rgba(99,102,241,0.05)", border: "1px solid rgba(99,102,241,0.15)", borderRadius: 16, padding: 20, textAlign: "center" }}>
                <div style={{ fontSize: 11, color: "#94a3b8", textTransform: "uppercase", letterSpacing: "0.1em", marginBottom: 8 }}>MTBF (Reliability)</div>
                <div style={{ fontSize: 28, fontWeight: 800, color: "#818cf8" }}>{data.mtbf_days}<span style={{ fontSize: 14, marginLeft: 4 }}>gg</span></div>
                <div style={{ fontSize: 10, color: "rgba(129,140,248,0.6)", marginTop: 4 }}>Tempo medio tra guasti</div>
              </div>
              <div style={{ background: "rgba(248,113,113,0.05)", border: "1px solid rgba(248,113,113,0.15)", borderRadius: 16, padding: 20, textAlign: "center" }}>
                <div style={{ fontSize: 11, color: "#94a3b8", textTransform: "uppercase", letterSpacing: "0.1em", marginBottom: 8 }}>MTTR (Serviceability)</div>
                <div style={{ fontSize: 28, fontWeight: 800, color: "#f87171" }}>{data.mttr_hours}<span style={{ fontSize: 14, marginLeft: 4 }}>h</span></div>
                <div style={{ fontSize: 10, color: "rgba(248,113,113,0.6)", marginTop: 4 }}>Tempo medio di ripristino</div>
              </div>
              <div style={{ background: "rgba(52,211,153,0.05)", border: "1px solid rgba(52,211,153,0.15)", borderRadius: 16, padding: 20, textAlign: "center" }}>
                <div style={{ fontSize: 11, color: "#94a3b8", textTransform: "uppercase", letterSpacing: "0.1em", marginBottom: 8 }}>Availability</div>
                <div style={{ fontSize: 28, fontWeight: 800, color: "#34d399" }}>{data.availability_score}<span style={{ fontSize: 14, marginLeft: 2 }}>%</span></div>
                <div style={{ fontSize: 10, color: "rgba(52,211,153,0.6)", marginTop: 4 }}>Disponibilità operativa stimata</div>
              </div>
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "1.5fr 1fr", gap: 32 }}>
              {/* Failure Trend SVG Chart */}
              <div>
                <h3 style={{ fontSize: 14, color: "#fff", marginBottom: 20, display: "flex", alignItems: "center", gap: 8 }}>
                  <span style={{ color: "#818cf8" }}>📈</span> Trend Guasti (Breakdowns)
                </h3>
                <div style={{ height: 160, display: "flex", alignItems: "flex-end", gap: 12, paddingBottom: 24, borderBottom: "1px solid rgba(255,255,255,0.05)" }}>
                  {data.failure_trend.map((t, idx) => (
                    <div key={idx} style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", gap: 8 }}>
                      <div 
                        style={{ 
                          width: "100%", 
                          height: `${(t.guasti / maxGuasti) * 100}%`, 
                          minHeight: t.guasti > 0 ? 4 : 0,
                          background: t.guasti > 0 ? "linear-gradient(to top, #4f46e5, #818cf8)" : "rgba(255,255,255,0.05)", 
                          borderRadius: "4px 4px 0 0",
                          transition: "height 0.6s ease"
                        }} 
                      />
                      <span style={{ fontSize: 10, color: "#64748b" }}>{t.mese}</span>
                    </div>
                  ))}
                </div>
              </div>

              {/* Statistics Breakdown */}
              <div>
                <h3 style={{ fontSize: 14, color: "#fff", marginBottom: 20 }}>📊 Mix Interventi</h3>
                <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                  {[
                    { label: "Preventive (PM)", count: data.stats.preventive, color: "#34d399" },
                    { label: "Predictive/ISP", count: data.stats.inspections, color: "#818cf8" },
                    { label: "Breakdown (BD)", count: data.stats.breakdowns, color: "#f87171" },
                    { label: "Corrective (CM)", count: data.stats.corrective, color: "#fbbf24" },
                  ].map(item => (
                    <div key={item.label}>
                      <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11, marginBottom: 4 }}>
                        <span style={{ color: "#94a3b8" }}>{item.label}</span>
                        <span style={{ color: "#fff", fontWeight: 700 }}>{item.count}</span>
                      </div>
                      <div style={{ height: 4, background: "rgba(255,255,255,0.05)", borderRadius: 2, overflow: "hidden" }}>
                        <div style={{ height: "100%", width: `${(item.count / data.stats.total) * 100}%`, background: item.color }} />
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            <div style={{ marginTop: 32, padding: "16px 20px", background: "rgba(251,191,36,0.05)", border: "1px solid rgba(251,191,36,0.15)", borderRadius: 12, display: "flex", gap: 16, alignItems: "center" }}>
              <span style={{ fontSize: 24 }}>💡</span>
              <div style={{ fontSize: 12, color: "#fbbf24", lineHeight: 1.5 }}>
                {data.mtbf_days < 15 ? 
                  "Attenzione: L'affidabilità di questo asset è sotto la soglia critica. Considera una revisione generale." : 
                  "L'asset sta performando secondo i parametri nominali. Continua il piano di manutenzione preventiva."}
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
