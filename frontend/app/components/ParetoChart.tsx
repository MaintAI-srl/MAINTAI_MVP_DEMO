"use client";

import type { CSSProperties } from "react";
import {
  Bar,
  Cell,
  ComposedChart,
  Line,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

export type ParetoItem = { label: string; value: number; pct: number; cum_pct: number; vital: boolean };
export type Pareto = {
  titolo: string;
  unita: string;
  totale: number;
  items: ParetoItem[];
  n_voci: number;
  vital_count: number;
  concentrated: boolean;
  others: { count: number; value: number; pct: number } | null;
};

const RED = "#ef4444";      // vital few (solo con concentrazione 80/20 reale)
const NEUTRAL = "#64748b";  // voci non dominanti — volutamente recessivo
const COBALT = "#5b8fff";   // curva cumulata

function formatNum(value: number): string {
  return value.toLocaleString("it-IT", { maximumFractionDigits: 2 });
}

type TooltipPayload = { payload?: { rank: number; label: string; value: number; pct: number; cum_pct: number } };

function ParetoTooltip({ active, payload, unita }: { active?: boolean; payload?: TooltipPayload[]; unita: string }) {
  const row = active && payload && payload.length > 0 ? payload[0].payload : undefined;
  if (!row) return null;
  return (
    <div style={{
      background: "var(--surface-1)", border: "1px solid var(--border-strong)",
      borderRadius: 8, padding: "8px 12px", fontSize: 12, color: "var(--text-primary)",
      boxShadow: "0 8px 24px rgba(0,0,0,0.35)", maxWidth: 260,
    }}>
      <div style={{ fontWeight: 700, marginBottom: 4 }}>#{row.rank} — {row.label}</div>
      <div style={{ color: "var(--text-muted)" }}>
        {formatNum(row.value)} {unita} · {row.pct}% del totale
      </div>
      <div style={{ color: "var(--text-muted)" }}>Cumulata: {row.cum_pct}%</div>
    </div>
  );
}

/** Grafico di Pareto classico su un solo asse 0–100%: barre = % del totale
 *  per voce, linea = % cumulata, soglia tratteggiata all'80%. */
export default function ParetoChart({ pareto }: { pareto: Pareto }) {
  const data = pareto.items.map((item, i) => ({
    rank: i + 1,
    label: item.label,
    value: item.value,
    pct: item.pct,
    cum_pct: item.cum_pct,
    vital: item.vital,
    isOthers: false,
  }));
  // Coda aggregata anche nel grafico: senza questa barra la cumulata si
  // fermerebbe sotto il 100% mentre la tabella arriva a 100%.
  if (pareto.others) {
    data.push({
      rank: data.length + 1,
      label: `Altre ${pareto.others.count} voci`,
      value: pareto.others.value,
      pct: pareto.others.pct,
      cum_pct: 100,
      vital: false,
      isOthers: true,
    });
  }

  return (
    <div style={{ margin: "14px 0", border: "1px solid var(--border-default)", borderRadius: 8, overflow: "hidden" }}>
      <div style={{ padding: "10px 14px", background: "var(--surface-1)", borderBottom: "1px solid var(--border-default)" }}>
        <div style={{ fontSize: 12, fontWeight: 800, textTransform: "uppercase", letterSpacing: "0.06em", color: "var(--text-muted)" }}>
          Pareto — {pareto.titolo}
        </div>
        <div style={{ fontSize: 11.5, color: "var(--text-muted)", marginTop: 3 }}>
          Totale {formatNum(pareto.totale)} {pareto.unita} su {pareto.n_voci} voci
        </div>
      </div>

      {/* Esito 80/20 in chiaro: il grafico non deve mentire su distribuzioni piatte */}
      <div style={{
        margin: "12px 14px 0", padding: "8px 12px", borderRadius: 6, fontSize: 12, lineHeight: 1.5,
        border: `1px solid ${pareto.concentrated ? "rgba(239,68,68,0.4)" : "var(--border-default)"}`,
        background: pareto.concentrated ? "rgba(239,68,68,0.07)" : "var(--surface-1)",
        color: "var(--text-primary)",
      }}>
        {pareto.concentrated ? (
          <><strong style={{ color: RED }}>Concentrazione 80/20 rilevata:</strong>{" "}
          {pareto.vital_count} voci su {pareto.n_voci} generano l&apos;80% del totale — concentra le azioni su queste (in rosso).</>
        ) : (
          <><strong>Nessuna concentrazione 80/20:</strong>{" "}
          servono {pareto.vital_count} voci su {pareto.n_voci} per arrivare all&apos;80% — distribuzione uniforme,
          nessun asset domina. Ragiona per famiglie o cause trasversali, non sui singoli asset in testa.</>
        )}
      </div>

      <div style={{ padding: "10px 8px 0", height: 240 }}>
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={data} margin={{ top: 8, right: 14, bottom: 0, left: -18 }}>
            <XAxis
              dataKey="rank"
              tickLine={false}
              axisLine={{ stroke: "var(--border-default)" }}
              tick={{ fontSize: 10, fill: "var(--text-muted)" }}
            />
            <YAxis
              domain={[0, 100]}
              ticks={[0, 20, 40, 60, 80, 100]}
              tickLine={false}
              axisLine={false}
              tick={{ fontSize: 10, fill: "var(--text-muted)" }}
              unit="%"
            />
            <Tooltip content={<ParetoTooltip unita={pareto.unita} />} cursor={{ fill: "rgba(148,163,184,0.08)" }} />
            <ReferenceLine y={80} stroke="var(--text-muted)" strokeDasharray="4 4" strokeOpacity={0.5} />
            <Bar dataKey="pct" radius={[4, 4, 0, 0]} maxBarSize={26}>
              {data.map((row) => (
                <Cell key={row.rank} fill={pareto.concentrated && row.vital ? RED : NEUTRAL} />
              ))}
            </Bar>
            <Line
              type="monotone"
              dataKey="cum_pct"
              stroke={COBALT}
              strokeWidth={2}
              dot={{ r: 2.5, fill: COBALT, strokeWidth: 0 }}
              activeDot={{ r: 4 }}
            />
          </ComposedChart>
        </ResponsiveContainer>
      </div>

      {/* Legenda */}
      <div style={{ display: "flex", gap: 16, flexWrap: "wrap", padding: "6px 14px 10px", fontSize: 11, color: "var(--text-muted)" }}>
        {pareto.concentrated && (
          <span style={{ display: "inline-flex", alignItems: "center", gap: 5 }}>
            <span style={{ width: 10, height: 10, borderRadius: 3, background: RED }} /> Vital few (→ 80%)
          </span>
        )}
        <span style={{ display: "inline-flex", alignItems: "center", gap: 5 }}>
          <span style={{ width: 10, height: 10, borderRadius: 3, background: NEUTRAL }} /> % del totale per voce
        </span>
        <span style={{ display: "inline-flex", alignItems: "center", gap: 5 }}>
          <span style={{ width: 14, height: 2, background: COBALT, borderRadius: 1 }} /> Cumulata
        </span>
        <span>┄ soglia 80%</span>
      </div>

      {/* Tabella compatta: mappa rank → nome asset e valori esatti */}
      <div style={{ overflowX: "auto", borderTop: "1px solid var(--border-default)" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
          <thead>
            <tr style={{ color: "var(--text-muted)", fontSize: 10.5 }}>
              <th style={{ ...th, width: 34 }}>#</th>
              <th style={{ ...th, textAlign: "left" }}>Voce</th>
              <th style={th}>{pareto.unita}</th>
              <th style={th}>%</th>
              <th style={th}>% cum.</th>
            </tr>
          </thead>
          <tbody>
            {data.map((row) => {
              const highlight = pareto.concentrated && row.vital;
              const muted = row.isOthers ? { color: "var(--text-muted)" } : {};
              return (
                <tr key={row.rank} style={{ background: highlight ? "rgba(239,68,68,0.06)" : "transparent" }}>
                  <td style={{ ...td, color: "var(--text-muted)", borderLeft: highlight ? `2px solid ${RED}` : "2px solid transparent" }}>
                    {row.isOthers ? "—" : row.rank}
                  </td>
                  <td style={{ ...td, textAlign: "left", fontWeight: highlight ? 700 : 400, ...muted }}>{row.label}</td>
                  <td style={{ ...td, ...muted }}>{formatNum(row.value)}</td>
                  <td style={{ ...td, ...muted }}>{row.pct}%</td>
                  <td style={{ ...td, ...muted }}>{row.cum_pct}%</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

const th: CSSProperties = {
  padding: "6px 10px",
  textAlign: "right",
  borderBottom: "1px solid var(--border-strong)",
  textTransform: "uppercase",
  letterSpacing: "0.05em",
};

const td: CSSProperties = {
  padding: "5px 10px",
  textAlign: "right",
  borderBottom: "1px solid var(--border-default)",
  color: "var(--text-primary)",
};
