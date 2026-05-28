"use client";

import type { EfficiencyBreakdown } from "../types";

interface Props {
  score: number;
  breakdown: EfficiencyBreakdown | null;
}

// Configurazione componenti efficienza
const COMPONENTI: { key: keyof EfficiencyBreakdown; label: string; target: number }[] = [
  { key: "copertura_backlog",   label: "Copertura backlog",    target: 85 },
  { key: "utilizzo_tecnici",    label: "Utilizzo tecnici",     target: 70 },
  { key: "bilanciamento_70_30", label: "Bilanciamento PM/CM",  target: 80 },
  { key: "match_skill",         label: "Match competenze",     target: 90 },
  { key: "ottimizzazione_meteo",label: "Ottimizzazione meteo", target: 90 },
];

function coloreValore(valore: number, target: number): string {
  if (valore >= target) return "#22c55e";
  if (valore >= target * 0.8) return "#f59e0b";
  return "#ef4444";
}

export default function BadgeEfficienza({ score, breakdown }: Props) {
  // Colore e label in base al punteggio globale
  const bg =
    score >= 90 ? "#22c55e" :
    score >= 70 ? "#f59e0b" :
    "#ef4444";

  const label =
    score >= 90 ? "Piano Ottimale ✓" :
    score >= 70 ? "Piano Accettabile" :
    "Piano da Rivedere ⚠";

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      {/* Badge principale */}
      <div style={{
        display: "flex",
        alignItems: "center",
        gap: 16,
        background: "var(--surface-2)",
        border: `1px solid ${bg}`,
        borderRadius: 10,
        padding: "14px 20px",
        boxShadow: `0 0 20px ${bg}33`,
      }}>
        {/* Cerchio punteggio */}
        <div style={{
          width: 72,
          height: 72,
          borderRadius: "50%",
          background: `conic-gradient(${bg} ${score * 3.6}deg, var(--border-strong) 0deg)`,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          flexShrink: 0,
        }}>
          <div style={{
            width: 58,
            height: 58,
            borderRadius: "50%",
            background: "var(--surface-2)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            flexDirection: "column",
          }}>
            <span style={{ fontSize: 18, fontWeight: 800, color: bg, lineHeight: 1 }}>
              {score.toFixed(0)}
            </span>
            <span style={{ fontSize: 10, color: "var(--text-muted)" }}>/ 100</span>
          </div>
        </div>

        {/* Label */}
        <div>
          <div style={{ fontSize: 18, fontWeight: 700, color: bg }}>{label}</div>
          <div style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 2 }}>
            Efficienza piano corrente
          </div>
        </div>
      </div>

      {/* Breakdown componenti */}
      {breakdown && (
        <div style={{
          background: "var(--surface-2)",
          border: "1px solid var(--border-strong)",
          borderRadius: 8,
          padding: "12px 16px",
          display: "flex",
          flexDirection: "column",
          gap: 8,
        }}>
          {COMPONENTI.map(({ key, label: lbl, target }) => {
            const valore = breakdown[key] ?? 0;
            const c = coloreValore(valore, target);
            const pct = Math.min(valore, 100);
            return (
              <div key={key}>
                <div style={{
                  display: "flex",
                  justifyContent: "space-between",
                  fontSize: 11,
                  marginBottom: 3,
                }}>
                  <span style={{ color: "var(--text-muted)" }}>{lbl}</span>
                  <span style={{ color: c, fontWeight: 600 }}>{valore.toFixed(0)}%</span>
                </div>
                <div style={{
                  height: 4,
                  background: "var(--border-strong)",
                  borderRadius: 2,
                  overflow: "hidden",
                }}>
                  <div style={{
                    height: "100%",
                    width: `${pct}%`,
                    background: c,
                    borderRadius: 2,
                    transition: "width 0.8s ease",
                  }} />
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
