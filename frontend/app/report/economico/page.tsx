"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
} from "recharts";
import { useAuth } from "@/app/lib/auth";
import { notify } from "@/app/lib/toast";

const API_BASE = process.env.NEXT_PUBLIC_API_BASE ?? "https://maintai-v3.onrender.com";

// ─── Tipi ─────────────────────────────────────────────────────────────────────

interface TrendMese {
  mese: string;
  label: string;
  evitato: number;
  subito: number;
}

interface TopAsset {
  asset_id: number;
  nome: string;
  costo_subito: number;
  ticket_bd: number;
  costo_orario_fermo: number;
}

interface ReportData {
  periodo_mesi: number;
  da: string;
  a: string;
  costo_fermo_evitato: number;
  costo_fermo_subito: number;
  totale: number;
  ratio_prevenzione: number;
  ticket_pm_cm_chiusi: number;
  ticket_bd_chiusi: number;
  trend_mensile: TrendMese[];
  top_asset: TopAsset[];
  warning_asset_senza_costo: number;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmt(n: number) {
  return new Intl.NumberFormat("it-IT", {
    style: "currency", currency: "EUR", maximumFractionDigits: 0,
  }).format(n);
}

function CustomTooltip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null;
  return (
    <div style={{
      background: "#1f2937", border: "1px solid #374151", borderRadius: "8px",
      padding: "10px 14px", fontSize: "13px",
    }}>
      <p style={{ color: "#94a3b8", marginBottom: "6px", fontWeight: 600 }}>{label}</p>
      {payload.map((p: any) => (
        <p key={p.name} style={{ color: p.color, margin: "2px 0" }}>
          {p.name}: <strong>{fmt(p.value)}</strong>
        </p>
      ))}
    </div>
  );
}

// ─── Pagina ───────────────────────────────────────────────────────────────────

export default function ReportEconomicoPage() {
  const { user, token } = useAuth();
  const router = useRouter();

  const [data, setData] = useState<ReportData | null>(null);
  const [loading, setLoading] = useState(true);
  const [mesi, setMesi] = useState(12);
  const [exporting, setExporting] = useState(false);

  // Auth guard — solo responsabile / superadmin
  useEffect(() => {
    if (user && user.ruolo !== "responsabile" && user.ruolo !== "superadmin") {
      router.replace("/dashboard");
    }
  }, [user, router]);

  useEffect(() => {
    if (!token) return;
    setLoading(true);
    fetch(`${API_BASE}/report/economico?mesi=${mesi}`, {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then(r => {
        if (!r.ok) throw new Error("Errore caricamento report");
        return r.json();
      })
      .then(setData)
      .catch(err => notify.error(err.message))
      .finally(() => setLoading(false));
  }, [token, mesi]);

  const handleExportExcel = async () => {
    if (!token) return;
    setExporting(true);
    try {
      const res = await fetch(`${API_BASE}/report/economico/export`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error("Errore export Excel");
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `maintai_report_economico_${new Date().toISOString().slice(0, 10)}.xlsx`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err: any) {
      notify.error(err.message);
    } finally {
      setExporting(false);
    }
  };

  if (loading) {
    return (
      <div style={pageWrap}>
        <div style={{ color: "#94a3b8", textAlign: "center", paddingTop: "60px" }}>
          Caricamento report...
        </div>
      </div>
    );
  }

  if (!data) return null;

  const ratioColor = data.ratio_prevenzione >= 70 ? "#22c55e"
    : data.ratio_prevenzione >= 40 ? "#f59e0b"
    : "#ef4444";

  return (
    <div style={pageWrap}>
      {/* ── Header ── */}
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", flexWrap: "wrap", gap: "12px", marginBottom: "28px" }}>
        <div>
          <h1 style={{ fontSize: "22px", fontWeight: 800, color: "#f1f5f9", margin: 0 }}>
            📊 Report Economico Manutenzione
          </h1>
          <p style={{ color: "#64748b", fontSize: "13px", margin: "4px 0 0" }}>
            Periodo: {data.da} → {data.a} ({data.periodo_mesi} mesi)
          </p>
        </div>

        <div style={{ display: "flex", gap: "10px", alignItems: "center", flexWrap: "wrap" }}>
          {/* Selettore periodo */}
          <select
            value={mesi}
            onChange={e => setMesi(Number(e.target.value))}
            style={{
              background: "#1f2937", color: "#f1f5f9", border: "1px solid #374151",
              borderRadius: "8px", padding: "8px 12px", fontSize: "13px", cursor: "pointer",
            }}
          >
            <option value={3}>Ultimi 3 mesi</option>
            <option value={6}>Ultimi 6 mesi</option>
            <option value={12}>Ultimi 12 mesi</option>
            <option value={24}>Ultimi 24 mesi</option>
          </select>

          {/* Export Excel */}
          <button
            onClick={handleExportExcel}
            disabled={exporting}
            style={{
              background: "#166534", color: "#bbf7d0", border: "1px solid #16a34a",
              borderRadius: "8px", padding: "8px 16px", fontSize: "13px",
              fontWeight: 600, cursor: "pointer",
            }}
          >
            {exporting ? "Esportando..." : "📥 Esporta Excel"}
          </button>

          {/* Stampa PDF */}
          <button
            onClick={() => window.print()}
            style={{
              background: "#1e3a5f", color: "#93c5fd", border: "1px solid #3b82f6",
              borderRadius: "8px", padding: "8px 16px", fontSize: "13px",
              fontWeight: 600, cursor: "pointer",
            }}
          >
            🖨️ Stampa PDF
          </button>
        </div>
      </div>

      {/* ── Warning asset senza costo ── */}
      {data.warning_asset_senza_costo > 0 && (
        <div style={{
          background: "#422006", border: "1px solid #d97706", borderRadius: "10px",
          padding: "12px 16px", marginBottom: "20px", fontSize: "13px", color: "#fde68a",
        }}>
          ⚠️ <strong>{data.warning_asset_senza_costo} ticket</strong> su asset privi di
          &quot;Costo orario fermo&quot; — non conteggiati. Imposta il valore nella pagina asset.
        </div>
      )}

      {/* ── KPI cards ── */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: "16px", marginBottom: "28px" }}>
        <KpiCard
          label="Costo Fermo Evitato"
          sublabel="PM + CM chiusi × €/ora fermo"
          value={fmt(data.costo_fermo_evitato)}
          icon="🛡️"
          color="#22c55e"
          bg="#052e16"
          border="#16a34a"
          sub={`${data.ticket_pm_cm_chiusi} ticket PM/CM`}
        />
        <KpiCard
          label="Costo Fermo Subito"
          sublabel="BD chiusi × €/ora fermo"
          value={fmt(data.costo_fermo_subito)}
          icon="🔥"
          color="#ef4444"
          bg="#3a0a0a"
          border="#dc2626"
          sub={`${data.ticket_bd_chiusi} ticket BD`}
        />
        <KpiCard
          label="Ratio Prevenzione"
          sublabel="Evitato ÷ Totale"
          value={`${data.ratio_prevenzione}%`}
          icon="📈"
          color={ratioColor}
          bg="#0f1929"
          border={ratioColor}
          sub={`Totale: ${fmt(data.totale)}`}
        />
      </div>

      {/* ── Trend mensile ── */}
      <div style={sectionCard}>
        <div style={sectionTitle}>📅 Trend mensile — Costo Evitato vs Subito</div>
        <div style={{ height: "280px" }}>
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={data.trend_mensile} margin={{ top: 4, right: 16, bottom: 4, left: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#1f2937" />
              <XAxis
                dataKey="label"
                tick={{ fill: "#64748b", fontSize: 11 }}
                interval="preserveStartEnd"
              />
              <YAxis
                tick={{ fill: "#64748b", fontSize: 11 }}
                tickFormatter={v => v >= 1000 ? `${(v / 1000).toFixed(0)}k` : String(v)}
              />
              <Tooltip content={<CustomTooltip />} />
              <Legend
                wrapperStyle={{ fontSize: "12px", color: "#94a3b8" }}
                formatter={(v) => v === "evitato" ? "Evitato" : "Subito"}
              />
              <Bar dataKey="evitato" name="evitato" fill="#22c55e" radius={[3, 3, 0, 0]} />
              <Bar dataKey="subito"  name="subito"  fill="#ef4444" radius={[3, 3, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* ── Top asset ── */}
      {data.top_asset.length > 0 && (
        <div style={{ ...sectionCard, marginTop: "20px" }}>
          <div style={sectionTitle}>🏭 Top asset per costo fermo subito</div>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "13px" }}>
            <thead>
              <tr style={{ borderBottom: "1px solid #374151" }}>
                {["Asset", "Costo subito", "Ticket BD", "€/ora fermo"].map(h => (
                  <th key={h} style={{ padding: "8px 12px", textAlign: "left", color: "#94a3b8", fontWeight: 600 }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {data.top_asset.map((a, i) => (
                <tr key={a.asset_id} style={{
                  borderBottom: "1px solid #1f2937",
                  background: i % 2 === 0 ? "transparent" : "#111827",
                }}>
                  <td style={{ padding: "10px 12px", color: "#f1f5f9", fontWeight: 500 }}>{a.nome}</td>
                  <td style={{ padding: "10px 12px", color: "#ef4444", fontWeight: 700 }}>{fmt(a.costo_subito)}</td>
                  <td style={{ padding: "10px 12px", color: "#94a3b8" }}>{a.ticket_bd}</td>
                  <td style={{ padding: "10px 12px", color: "#64748b" }}>
                    {a.costo_orario_fermo > 0 ? `${a.costo_orario_fermo.toFixed(0)} €/h` : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* ── Nota metodologica ── */}
      <div style={{
        marginTop: "24px", padding: "14px 16px",
        background: "#111827", borderRadius: "10px",
        border: "1px solid #1f2937", fontSize: "12px", color: "#4b5563",
        lineHeight: 1.7,
      }}>
        <strong style={{ color: "#6b7280" }}>Metodologia di calcolo</strong><br />
        <em>Costo evitato</em>: somma di (durata stimata × costo orario fermo) per tutti i ticket
        PM e CM chiusi nel periodo. Rappresenta il costo del fermo <em>prevenuto</em> grazie alla manutenzione programmata.<br />
        <em>Costo subito</em>: stessa formula per i ticket BD chiusi. Rappresenta il costo del fermo
        <em> realmente verificatosi</em>. Sono esclusi gli asset privi di &quot;costo orario fermo&quot;.
      </div>

      {/* ── CSS stampa ── */}
      <style>{`
        @media print {
          body { background: white !important; color: black !important; }
          .no-print { display: none !important; }
        }
      `}</style>
    </div>
  );
}

// ─── Componente KPI card ───────────────────────────────────────────────────────

function KpiCard({
  label, sublabel, value, icon, color, bg, border, sub,
}: {
  label: string; sublabel: string; value: string;
  icon: string; color: string; bg: string; border: string; sub: string;
}) {
  return (
    <div style={{
      background: bg, border: `1px solid ${border}`,
      borderRadius: "12px", padding: "20px",
    }}>
      <div style={{ display: "flex", alignItems: "center", gap: "10px", marginBottom: "8px" }}>
        <span style={{ fontSize: "22px" }}>{icon}</span>
        <div>
          <div style={{ fontSize: "12px", color: "#94a3b8", textTransform: "uppercase", letterSpacing: "0.5px" }}>{label}</div>
          <div style={{ fontSize: "11px", color: "#4b5563" }}>{sublabel}</div>
        </div>
      </div>
      <div style={{ fontSize: "28px", fontWeight: 800, color, lineHeight: 1 }}>{value}</div>
      <div style={{ fontSize: "12px", color: "#64748b", marginTop: "6px" }}>{sub}</div>
    </div>
  );
}

// ─── Stili globali ────────────────────────────────────────────────────────────

const pageWrap: React.CSSProperties = {
  padding: "28px 24px",
  maxWidth: "1100px",
  margin: "0 auto",
};

const sectionCard: React.CSSProperties = {
  background: "#111827",
  border: "1px solid #1f2937",
  borderRadius: "12px",
  padding: "20px",
};

const sectionTitle: React.CSSProperties = {
  fontSize: "14px",
  fontWeight: 700,
  color: "#94a3b8",
  textTransform: "uppercase",
  letterSpacing: "0.5px",
  marginBottom: "16px",
};
