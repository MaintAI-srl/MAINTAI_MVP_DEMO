"use client";

import type { EfficiencyMotivation } from "../types";

interface Props {
  motivations: EfficiencyMotivation[];
  score: number;
}

export default function PannelloMotivazioni({ motivations, score }: Props) {
  // Visibile automaticamente se punteggio < 90%
  if (score >= 90 || motivations.length === 0) return null;

  const headerColor = score >= 70 ? "#f59e0b" : "#ef4444";
  const headerBg = score >= 70 ? "#78350f22" : "#7f1d1d22";

  return (
    <div style={{
      background: "var(--surface-2)",
      border: `1px solid ${headerColor}55`,
      borderRadius: 10,
      overflow: "hidden",
    }}>
      {/* Header */}
      <div style={{
        background: headerBg,
        borderBottom: `1px solid ${headerColor}44`,
        padding: "10px 16px",
        display: "flex",
        alignItems: "center",
        gap: 8,
      }}>
        <span style={{ fontSize: 16 }}>⚠</span>
        <span style={{ fontSize: 13, fontWeight: 700, color: headerColor }}>
          Perché il piano non è ottimale
        </span>
      </div>

      {/* Lista motivazioni */}
      <div style={{ padding: "12px 16px", display: "flex", flexDirection: "column", gap: 12 }}>
        {motivations.map((m, i) => {
          const colore = m.valore >= m.target * 0.8 ? "#f59e0b" : "#ef4444";
          return (
            <div key={i} style={{
              borderLeft: `3px solid ${colore}`,
              paddingLeft: 12,
            }}>
              {/* Componente + valore */}
              <div style={{
                display: "flex",
                alignItems: "baseline",
                gap: 6,
                marginBottom: 4,
              }}>
                <span style={{ fontSize: 12, fontWeight: 700, color: colore }}>
                  ⚠ {m.componente}
                </span>
                <span style={{ fontSize: 11, color: "#9ca3af" }}>
                  {m.valore.toFixed(0)}% (target {m.target}%)
                </span>
              </div>

              {/* Spiegazione */}
              <p style={{ fontSize: 12, color: "#d1d5db", margin: "0 0 4px" }}>
                → {m.spiegazione}
              </p>

              {/* Suggerimento */}
              <p style={{
                fontSize: 11,
                color: "#6b7280",
                margin: 0,
                fontStyle: "italic",
              }}>
                Suggerimento: {m.suggerimento}
              </p>
            </div>
          );
        })}
      </div>
    </div>
  );
}
