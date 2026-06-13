"use client";

import { useEffect } from "react";
import type { SchedulingSummary } from "../types";

function fmtH(minutes?: number): string {
  if (minutes == null) return "—";
  return `${(minutes / 60).toFixed(1)}h`;
}

function SaturationBar({ pct }: { pct: number }) {
  const clamped = Math.max(0, Math.min(100, pct));
  const color = clamped > 92 ? "#e05252" : clamped > 72 ? "#22c55e" : "#f2b84b";
  return (
    <div style={{ flex: 1, height: 8, borderRadius: 999, background: "rgba(83,97,116,0.22)", overflow: "hidden" }}>
      <div style={{ width: `${clamped}%`, height: "100%", borderRadius: 999, background: color }} />
    </div>
  );
}

export default function SchedulingSummaryModal({
  summary,
  onClose,
}: {
  summary: SchedulingSummary;
  onClose: () => void;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const kpiCards: Array<{ label: string; value: string; sub?: string }> = [
    { label: "Ticket analizzati", value: String(summary.total_tickets_analyzed) },
    { label: "Ticket schedulati", value: String(summary.tickets_scheduled) },
    { label: "Ticket esclusi", value: String(summary.tickets_excluded) },
    {
      label: "Saturazione giornaliera",
      value: `${(summary.daily_utilization_percent ?? 0).toFixed(0)}%`,
      sub: `${fmtH(summary.daily_scheduled_minutes)} / ${fmtH(summary.daily_capacity_minutes)} al giorno`,
    },
    {
      label: "Saturazione settimanale",
      value: `${(summary.weekly_utilization_percent ?? 0).toFixed(0)}%`,
      sub: `${fmtH(summary.weekly_scheduled_minutes)} / ${fmtH(summary.weekly_capacity_minutes)} a settimana`,
    },
    {
      label: "Saturazione periodo",
      value: `${(summary.utilization_percent ?? 0).toFixed(0)}%`,
      sub: `${fmtH(summary.scheduled_minutes)} / ${fmtH(summary.capacity_minutes)} totali`,
    },
  ];

  return (
    <div
      onClick={onClose}
      style={{
        position: "fixed", inset: 0, zIndex: 9998,
        background: "rgba(2,6,23,0.55)", backdropFilter: "blur(3px)",
        display: "flex", alignItems: "center", justifyContent: "center", padding: 20,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        style={{
          position: "relative", width: "min(640px, 96vw)", maxHeight: "90vh",
          background: "var(--surface-2)", color: "var(--text-primary)",
          border: "1px solid var(--border-strong)", borderRadius: 14,
          boxShadow: "0 28px 70px rgba(2,6,23,0.45)",
          display: "flex", flexDirection: "column", overflow: "hidden", zIndex: 9999,
        }}
      >
        <button
          onClick={onClose}
          aria-label="Chiudi"
          style={{
            position: "absolute", top: 14, right: 14, width: 28, height: 28,
            display: "flex", alignItems: "center", justifyContent: "center",
            background: "var(--surface-3)", border: "1px solid var(--border-default)",
            borderRadius: 8, color: "var(--text-muted)", cursor: "pointer", fontSize: 18, lineHeight: 1, zIndex: 2,
          }}
        >×</button>

        <div style={{ padding: "22px 28px", borderBottom: "1px solid var(--border-default)", background: "var(--surface-1)" }}>
          <div style={{ fontSize: 10, letterSpacing: "0.15em", color: "var(--cobalt)", fontWeight: 700, textTransform: "uppercase", marginBottom: 6 }}>
            Generazione piano completata
          </div>
          <div style={{ fontSize: 18, fontWeight: 800 }}>
            Riepilogo auto-scheduling
          </div>
        </div>

        <div style={{ flex: 1, padding: "20px 28px", overflowY: "auto", display: "flex", flexDirection: "column", gap: 20 }}>
          {/* KPI cards */}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 12 }}>
            {kpiCards.map((k) => (
              <div key={k.label} style={{
                background: "var(--surface-1)", border: "1px solid var(--border-default)",
                borderRadius: 10, padding: "12px 14px",
              }}>
                <div style={{ fontSize: 10, color: "var(--text-muted)", fontWeight: 700, letterSpacing: "0.04em", textTransform: "uppercase", marginBottom: 6 }}>
                  {k.label}
                </div>
                <div style={{ fontSize: 22, fontWeight: 900, color: "var(--text-primary)", lineHeight: 1 }}>{k.value}</div>
                {k.sub && <div style={{ fontSize: 10, color: "var(--text-muted)", marginTop: 4 }}>{k.sub}</div>}
              </div>
            ))}
          </div>

          {/* Per-tecnico */}
          {summary.technicians && summary.technicians.length > 0 && (
            <div>
              <div style={{ fontSize: 11, color: "var(--text-muted)", fontWeight: 700, letterSpacing: "0.06em", textTransform: "uppercase", marginBottom: 10 }}>
                Saturazione per tecnico
                {" · "}
                <span style={{ color: "#22c55e" }}>{summary.technicians_undersaturated ?? 0} sotto-saturi</span>
                {" / "}
                <span style={{ color: "#e05252" }}>{summary.technicians_saturated ?? 0} saturi</span>
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                {summary.technicians.map((t) => (
                  <div key={t.technician_id} style={{ display: "flex", alignItems: "center", gap: 12 }}>
                    <div style={{ width: 140, fontSize: 12, fontWeight: 700, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {t.name}
                    </div>
                    <SaturationBar pct={t.utilization_percent} />
                    <div style={{ width: 116, textAlign: "right", fontSize: 11, color: "var(--text-secondary)", whiteSpace: "nowrap" }}>
                      {fmtH(t.scheduled_minutes)} / {fmtH(t.capacity_minutes)}
                      <span style={{ color: t.saturo ? "#e05252" : "#22c55e", fontWeight: 800, marginLeft: 6 }}>
                        {t.utilization_percent.toFixed(0)}%
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        <div style={{ padding: "16px 28px", borderTop: "1px solid var(--border-default)", background: "var(--surface-2)", display: "flex", justifyContent: "flex-end" }}>
          <button
            onClick={onClose}
            style={{
              padding: "9px 22px", background: "linear-gradient(135deg, #6366f1 0%, #4f46e5 100%)",
              border: "none", color: "#fff", borderRadius: 8, cursor: "pointer", fontSize: 13, fontWeight: 800,
            }}
          >
            Chiudi
          </button>
        </div>
      </div>
    </div>
  );
}
