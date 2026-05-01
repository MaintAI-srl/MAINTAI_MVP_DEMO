"use client";

import type { PlannedWO, TicketData, TecnicoData } from "../types";
import { tipoStyle } from "../types";

interface WODetailDrawerProps {
  wo: PlannedWO | null;
  ticket: TicketData | null;
  tecnico: TecnicoData | null;
  onClose: () => void;
}

const PRIO_COLORS: Record<string, string> = {
  Alta: "#ef4444",
  Media: "#f59e0b",
  Bassa: "#22c55e",
};

const RISK_COLORS: Record<string, { bg: string; text: string; border: string }> = {
  LOW:    { bg: "#14532d22", text: "#86efac", border: "#22c55e" },
  MEDIUM: { bg: "#78350f22", text: "#fcd34d", border: "#f59e0b" },
  HIGH:   { bg: "#7f1d1d22", text: "#fca5a5", border: "#ef4444" },
};

const RISK_LABELS: Record<string, string> = {
  LOW:    "Basso",
  MEDIUM: "Medio",
  HIGH:   "Alto",
};

const COMPLEXITY_COLORS: Record<string, { bg: string; text: string }> = {
  SIMPLE:   { bg: "#1e3a5f", text: "#93c5fd" },
  STANDARD: { bg: "var(--border-strong)", text: "#d1d5db" },
  COMPLEX:  { bg: "#4c1d9533", text: "#c4b5fd" },
};

const COMPLEXITY_LABELS: Record<string, string> = {
  SIMPLE:   "Semplice",
  STANDARD: "Standard",
  COMPLEX:  "Complessa",
};

export default function WODetailDrawer({ wo, ticket, tecnico, onClose }: WODetailDrawerProps) {
  if (!wo || !ticket) return null;

  const s = tipoStyle(ticket.tipo, wo.is_continuation);
  const conf = wo.confidence_score ?? null;
  const risk = wo.risk_level ?? null;
  const complexity = wo.complexity ?? null;

  const confPct = conf !== null ? Math.round(conf * 100) : null;
  const confColor =
    conf === null ? "#6b7280"
    : conf >= 0.85 ? "#22c55e"
    : conf >= 0.65 ? "#f59e0b"
    : "#ef4444";

  const tecnicoNome = tecnico
    ? `${tecnico.nome}${tecnico.cognome ? " " + tecnico.cognome : ""}`
    : `Tecnico #${wo.technician_id}`;
  const tecnicoSkill = tecnico?.competenze || tecnico?.skill || "";

  return (
    <>
      {/* Overlay */}
      <div
        onClick={onClose}
        style={{
          position: "fixed",
          inset: 0,
          background: "rgba(0,0,0,0.45)",
          zIndex: 9998,
        }}
      />

      {/* Drawer */}
      <div
        style={{
          position: "fixed",
          top: 0,
          right: 0,
          bottom: 0,
          width: 320,
          background: "var(--surface-1)",
          borderLeft: "1px solid var(--border-strong)",
          zIndex: 9999,
          display: "flex",
          flexDirection: "column",
          overflowY: "auto",
          fontFamily: "'IBM Plex Mono', monospace",
        }}
      >
        {/* Header */}
        <div
          style={{
            background: "var(--surface-2)",
            borderBottom: "1px solid var(--border-strong)",
            padding: "16px",
            display: "flex",
            alignItems: "flex-start",
            justifyContent: "space-between",
            gap: 8,
            flexShrink: 0,
          }}
        >
          <div style={{ flex: 1, minWidth: 0 }}>
            {/* Badges tipo + priorità */}
            <div style={{ display: "flex", gap: 6, marginBottom: 8, flexWrap: "wrap" }}>
              <span
                style={{
                  background: s.bg,
                  color: s.text,
                  border: `1px solid ${s.border}`,
                  borderRadius: 4,
                  padding: "2px 8px",
                  fontSize: 11,
                  fontWeight: 700,
                  letterSpacing: 1,
                }}
              >
                {wo.is_continuation ? "CONT" : ticket.tipo}
              </span>
              <span
                style={{
                  background: `${PRIO_COLORS[ticket.priorita] ?? "#6b7280"}22`,
                  color: PRIO_COLORS[ticket.priorita] ?? "#6b7280",
                  border: `1px solid ${PRIO_COLORS[ticket.priorita] ?? "#6b7280"}`,
                  borderRadius: 4,
                  padding: "2px 8px",
                  fontSize: 11,
                  fontWeight: 600,
                }}
              >
                {ticket.priorita}
              </span>
            </div>
            <div style={{ fontSize: 13, fontWeight: 600, color: "#e2e8f0", lineHeight: 1.4 }}>
              #{ticket.id} — {ticket.titolo}
            </div>
            {ticket.asset_name && (
              <div style={{ fontSize: 11, color: "#6b7280", marginTop: 3 }}>{ticket.asset_name}</div>
            )}
          </div>
          <button
            onClick={onClose}
            style={{
              background: "none",
              border: "none",
              color: "#6b7280",
              fontSize: 18,
              cursor: "pointer",
              padding: "0 4px",
              lineHeight: 1,
              flexShrink: 0,
            }}
            aria-label="Chiudi"
          >
            ×
          </button>
        </div>

        {/* Corpo */}
        <div style={{ flex: 1, padding: "16px", display: "flex", flexDirection: "column", gap: 16 }}>

          {/* Slot pianificato */}
          <Section title="Slot pianificato">
            <Row label="Data" value={wo.planned_date} />
            <Row label="Orario" value={`${wo.planned_start_time} → ${wo.planned_end_time}`} />
            <Row label="Durata" value={`${wo.duration_hours}h`} />
            {wo.is_continuation && (
              <div style={{ fontSize: 11, color: "#a855f7", marginTop: 4 }}>
                Continuazione di WO #{wo.parent_wo_id}
              </div>
            )}
          </Section>

          {/* Tecnico */}
          <Section title="Tecnico assegnato">
            <div style={{ fontSize: 13, color: "#e2e8f0", fontWeight: 600 }}>{tecnicoNome}</div>
            {tecnicoSkill && (
              <div style={{ fontSize: 11, color: "#6b7280", marginTop: 4 }}>
                Competenze: {tecnicoSkill}
              </div>
            )}
          </Section>

          {/* Confidence */}
          {confPct !== null && (
            <Section title="Confidence">
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                {/* Barra */}
                <div
                  style={{
                    flex: 1,
                    height: 8,
                    background: "var(--border-strong)",
                    borderRadius: 4,
                    overflow: "hidden",
                  }}
                >
                  <div
                    style={{
                      width: `${confPct}%`,
                      height: "100%",
                      background: confColor,
                      borderRadius: 4,
                      transition: "width 0.3s ease",
                    }}
                  />
                </div>
                <span style={{ fontSize: 13, fontWeight: 700, color: confColor, minWidth: 36 }}>
                  {confPct}%
                </span>
              </div>
            </Section>
          )}

          {/* Risk Level */}
          {risk && RISK_COLORS[risk] && (
            <Section title="Livello di rischio">
              <span
                style={{
                  background: RISK_COLORS[risk]!.bg,
                  color: RISK_COLORS[risk]!.text,
                  border: `1px solid ${RISK_COLORS[risk]!.border}`,
                  borderRadius: 4,
                  padding: "3px 10px",
                  fontSize: 12,
                  fontWeight: 700,
                }}
              >
                {RISK_LABELS[risk] ?? risk}
              </span>
            </Section>
          )}

          {/* Complexity */}
          {complexity && COMPLEXITY_COLORS[complexity] && (
            <Section title="Complessità">
              <span
                style={{
                  background: COMPLEXITY_COLORS[complexity]!.bg,
                  color: COMPLEXITY_COLORS[complexity]!.text,
                  borderRadius: 4,
                  padding: "3px 10px",
                  fontSize: 12,
                  fontWeight: 600,
                }}
              >
                {COMPLEXITY_LABELS[complexity] ?? complexity}
              </span>
            </Section>
          )}

          {/* Motivazione */}
          {wo.motivation && (
            <Section title="Motivazione">
              <div
                style={{
                  fontSize: 12,
                  color: "#9ca3af",
                  lineHeight: 1.6,
                  fontStyle: "italic",
                  whiteSpace: "pre-wrap",
                }}
              >
                {wo.motivation}
              </div>
            </Section>
          )}

          {/* Warnings */}
          {wo.warnings && wo.warnings.length > 0 && (
            <Section title="Avvisi">
              {wo.warnings.map((w, i) => (
                <div
                  key={i}
                  style={{
                    fontSize: 12,
                    color: "#fcd34d",
                    background: "#78350f22",
                    border: "1px solid #f59e0b44",
                    borderRadius: 4,
                    padding: "6px 10px",
                    marginBottom: 4,
                  }}
                >
                  {w}
                </div>
              ))}
            </Section>
          )}
        </div>
      </div>
    </>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <div
        style={{
          fontSize: 10,
          fontWeight: 700,
          color: "#4b5563",
          letterSpacing: 1.5,
          textTransform: "uppercase",
          marginBottom: 8,
        }}
      >
        {title}
      </div>
      <div
        style={{
          background: "var(--surface-2)",
          border: "1px solid var(--border-strong)",
          borderRadius: 6,
          padding: "10px 12px",
        }}
      >
        {children}
      </div>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4, fontSize: 12 }}>
      <span style={{ color: "#6b7280" }}>{label}</span>
      <span style={{ color: "#e2e8f0", fontWeight: 500 }}>{value}</span>
    </div>
  );
}
