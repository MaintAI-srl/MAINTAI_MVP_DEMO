"use client";

import { useState } from "react";
import { apiGet } from "../../lib/api";
import { notify } from "../../../lib/toast";

// ── Tipi risposta API ────────────────────────────────────────────────────────

interface TicketAnalysis {
  ticket_id: number;
  titolo: string;
  tipo: string;
  rolling_type: string;
  priorita: string;
  priority_class: string;
  planning_status: "READY" | "NOT_READY";
  bottlenecks: string[];
  freeze_zone: string | null;
  pm_protected: boolean;
  pm_protection_reason: string;
  insertion_score: number;
  disruption_cost: number;
  net_value: number;
  can_enter: Record<string, boolean>;
  notes: string[];
}

interface RollingKPI {
  ore_disponibili_stimate: number;
  ore_pianificate: number;
  saturazione_pct: number;
  backlog_ready: number;
  backlog_not_ready: number;
  pm_protette: number;
  ticket_frozen: number;
  ticket_protected: number;
  ticket_flexible: number;
  ticket_dynamic: number;
  ticket_unscheduled: number;
  compliance_prevista_pct: number;
  pct_breakdown: number;
  pct_pm: number;
  pct_cm: number;
  note: string[];
}

interface RollingAnalysisResponse {
  analyses: TicketAnalysis[];
  ready_count: number;
  not_ready_count: number;
  frozen_count: number;
  protected_count: number;
  flexible_count: number;
  dynamic_count: number;
  unscheduled_count: number;
  pm_protected_count: number;
  kpi: RollingKPI;
  warnings: string[];
}

// ── Helpers ─────────────────────────────────────────────────────────────────

const ZONE_LABEL: Record<string, string> = {
  FROZEN_24:    "❄ Frozen 0-24h",
  PROTECTED_48: "🛡 Protected 24-48h",
  FLEXIBLE_72:  "↕ Flexible 48-72h",
  DYNAMIC_168:  "⚡ Dynamic 72-168h",
};

const ZONE_COLOR: Record<string, string> = {
  FROZEN_24:    "#ef4444",
  PROTECTED_48: "#f59e0b",
  FLEXIBLE_72:  "#3b82f6",
  DYNAMIC_168:  "#22c55e",
  null:         "#6b7280",
};

const TIPO_COLOR: Record<string, string> = {
  BD: "#ef4444",
  PM: "#22c55e",
  CM: "#f59e0b",
};

const P_COLOR: Record<string, string> = {
  P1: "#ef4444",
  P2: "#f97316",
  P3: "#eab308",
  P4: "#3b82f6",
  P5: "#6b7280",
};

const BOTTLENECK_IT: Record<string, string> = {
  SKILL_MISSING:       "Skill mancante",
  DURATION_UNRELIABLE: "Durata non credibile",
  MATERIAL_MISSING:    "Materiali mancanti",
  PERMIT_MISSING:      "Permessi mancanti",
  ACCESS_MISSING:      "Accesso non disponibile",
  JOB_PLAN_MISSING:    "Job plan mancante",
};

function KpiCard({ label, value, sub, color }: { label: string; value: string | number; sub?: string; color?: string }) {
  return (
    <div style={{
      background: "#111827",
      border: "1px solid #1f2937",
      borderRadius: 8,
      padding: "12px 16px",
      minWidth: 120,
    }}>
      <div style={{ fontSize: 11, color: "#6b7280", marginBottom: 4 }}>{label}</div>
      <div style={{ fontSize: 20, fontWeight: 800, color: color ?? "#f9fafb" }}>{value}</div>
      {sub && <div style={{ fontSize: 10, color: "#4b5563", marginTop: 2 }}>{sub}</div>}
    </div>
  );
}

// ── Pannello principale ──────────────────────────────────────────────────────

export default function RollingAnalysisPanel() {
  const [data, setData] = useState<RollingAnalysisResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [expanded, setExpanded] = useState<number | null>(null);
  const [filterZone, setFilterZone] = useState<string>("all");
  const [filterStatus, setFilterStatus] = useState<string>("all");

  async function fetchAnalysis() {
    setLoading(true);
    try {
      const res = await apiGet<RollingAnalysisResponse>("/planning/rolling-analysis");
      setData(res);
    } catch (e: unknown) {
      notify.error(e instanceof Error ? e.message : "Errore analisi rolling");
    } finally {
      setLoading(false);
    }
  }

  const filtered = (data?.analyses ?? []).filter(a => {
    if (filterZone !== "all" && (filterZone === "unscheduled" ? a.freeze_zone !== null : a.freeze_zone !== filterZone)) return false;
    if (filterStatus !== "all" && a.planning_status !== filterStatus) return false;
    return true;
  });

  return (
    <div style={{ padding: "0 0 32px 0" }}>

      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <div style={{
        display: "flex", alignItems: "center", justifyContent: "space-between",
        marginBottom: 20, flexWrap: "wrap", gap: 12,
      }}>
        <div>
          <div style={{ fontSize: 16, fontWeight: 800, color: "#f9fafb" }}>
            ◈ Rolling 7-Day Analysis
          </div>
          <div style={{ fontSize: 11, color: "#6b7280", marginTop: 2 }}>
            Readiness Gate · Freeze Zones · Insertion Score · PM Protection
          </div>
        </div>
        <button
          onClick={fetchAnalysis}
          disabled={loading}
          style={{
            background: loading ? "#1f2937" : "linear-gradient(135deg,#1d4ed8,#7c3aed)",
            border: "none",
            color: loading ? "#6b7280" : "#fff",
            borderRadius: 8,
            padding: "9px 18px",
            fontSize: 13,
            fontWeight: 700,
            cursor: loading ? "not-allowed" : "pointer",
            boxShadow: loading ? "none" : "0 0 16px rgba(99,102,241,0.3)",
          }}
        >
          {loading ? "Analisi in corso..." : "⚡ Avvia Analisi"}
        </button>
      </div>

      {!data && !loading && (
        <div style={{
          background: "#0f172a",
          border: "1px dashed #1f2937",
          borderRadius: 10,
          padding: 40,
          textAlign: "center",
          color: "#374151",
          fontSize: 13,
        }}>
          Clicca "Avvia Analisi" per valutare readiness, freeze zones e priorità di tutti i ticket
        </div>
      )}

      {data && (
        <>
          {/* ── Warnings ──────────────────────────────────────────────────── */}
          {data.warnings.length > 0 && (
            <div style={{ marginBottom: 20 }}>
              {data.warnings.map((w, i) => (
                <div key={i} style={{
                  background: "#7f1d1d22",
                  border: "1px solid #ef444433",
                  borderRadius: 6,
                  padding: "8px 12px",
                  fontSize: 12,
                  color: "#fca5a5",
                  marginBottom: 6,
                  display: "flex",
                  alignItems: "flex-start",
                  gap: 8,
                }}>
                  <span>⚠</span><span>{w}</span>
                </div>
              ))}
            </div>
          )}

          {/* ── KPI Cards ─────────────────────────────────────────────────── */}
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginBottom: 20 }}>
            <KpiCard label="Backlog READY" value={data.ready_count} color="#22c55e" />
            <KpiCard label="NOT READY" value={data.not_ready_count} color="#ef4444" />
            <KpiCard label="PM Protette" value={data.pm_protected_count} color="#f59e0b" />
            <KpiCard
              label="Saturazione"
              value={`${data.kpi.saturazione_pct ?? 0}%`}
              sub="ticket Pianificati"
              color={data.kpi.saturazione_pct >= 70 ? "#22c55e" : "#f59e0b"}
            />
            <KpiCard
              label="Compliance P1"
              value={`${data.kpi.compliance_prevista_pct ?? 100}%`}
              sub="prevista"
              color={data.kpi.compliance_prevista_pct >= 90 ? "#22c55e" : "#ef4444"}
            />
            <KpiCard label="❄ Frozen" value={data.frozen_count} color="#ef4444" />
            <KpiCard label="🛡 Protected" value={data.protected_count} color="#f59e0b" />
            <KpiCard label="↕ Flexible" value={data.flexible_count} color="#3b82f6" />
            <KpiCard label="⚡ Dynamic" value={data.dynamic_count} color="#22c55e" />
            <KpiCard label="Non sched." value={data.unscheduled_count} color="#6b7280" />
          </div>

          {/* ── Filtri ─────────────────────────────────────────────────────── */}
          <div style={{ display: "flex", gap: 8, marginBottom: 14, flexWrap: "wrap" }}>
            {/* Filtro zona */}
            {[
              { key: "all", label: "Tutte le zone" },
              { key: "FROZEN_24", label: "❄ Frozen" },
              { key: "PROTECTED_48", label: "🛡 Protected" },
              { key: "FLEXIBLE_72", label: "↕ Flexible" },
              { key: "DYNAMIC_168", label: "⚡ Dynamic" },
              { key: "unscheduled", label: "Non sched." },
            ].map(({ key, label }) => (
              <button
                key={key}
                onClick={() => setFilterZone(key)}
                style={{
                  background: filterZone === key ? "#1d4ed8" : "#1f2937",
                  border: "1px solid #374151",
                  color: filterZone === key ? "#fff" : "#9ca3af",
                  borderRadius: 6,
                  padding: "5px 10px",
                  fontSize: 11,
                  cursor: "pointer",
                  fontWeight: filterZone === key ? 700 : 400,
                }}
              >{label}</button>
            ))}
            {/* Filtro status */}
            <div style={{ marginLeft: 8, display: "flex", gap: 6 }}>
              {[
                { key: "all", label: "Tutti" },
                { key: "READY", label: "✓ READY" },
                { key: "NOT_READY", label: "✗ NOT READY" },
              ].map(({ key, label }) => (
                <button
                  key={key}
                  onClick={() => setFilterStatus(key)}
                  style={{
                    background: filterStatus === key ? (key === "NOT_READY" ? "#7f1d1d" : key === "READY" ? "#14532d" : "#1d4ed8") : "#1f2937",
                    border: "1px solid #374151",
                    color: filterStatus === key ? "#fff" : "#9ca3af",
                    borderRadius: 6,
                    padding: "5px 10px",
                    fontSize: 11,
                    cursor: "pointer",
                    fontWeight: filterStatus === key ? 700 : 400,
                  }}
                >{label}</button>
              ))}
            </div>
          </div>

          {/* ── Tabella ticket ─────────────────────────────────────────────── */}
          <div style={{
            background: "#0f172a",
            border: "1px solid #1f2937",
            borderRadius: 10,
            overflow: "hidden",
          }}>
            {/* Header colonne */}
            <div style={{
              display: "grid",
              gridTemplateColumns: "48px 60px 60px 1fr 100px 80px 80px 80px 80px",
              background: "#1e293b",
              borderBottom: "1px solid #1f2937",
              padding: "8px 12px",
              fontSize: 10,
              fontWeight: 700,
              color: "#4b5563",
              letterSpacing: "0.06em",
              textTransform: "uppercase",
            }}>
              <div>ID</div>
              <div>Tipo</div>
              <div>P.Class</div>
              <div>Titolo</div>
              <div>Status</div>
              <div>Zona</div>
              <div>Ins.</div>
              <div>Dis.</div>
              <div>Net</div>
            </div>

            {filtered.length === 0 && (
              <div style={{ padding: 32, textAlign: "center", color: "#374151", fontSize: 13 }}>
                Nessun ticket per i filtri selezionati
              </div>
            )}

            {filtered.map((a, idx) => {
              const isOpen = expanded === a.ticket_id;
              const zoneColor = ZONE_COLOR[a.freeze_zone ?? "null"] ?? "#6b7280";
              return (
                <div key={a.ticket_id}>
                  <div
                    onClick={() => setExpanded(isOpen ? null : a.ticket_id)}
                    style={{
                      display: "grid",
                      gridTemplateColumns: "48px 60px 60px 1fr 100px 80px 80px 80px 80px",
                      padding: "9px 12px",
                      fontSize: 12,
                      borderBottom: "1px solid #111827",
                      cursor: "pointer",
                      background: isOpen ? "#0c1628" : idx % 2 === 0 ? "#0f172a" : "#0a0f1e",
                      transition: "background 80ms",
                      alignItems: "center",
                    }}
                  >
                    <div style={{ color: "#4b5563", fontFamily: "monospace" }}>#{a.ticket_id}</div>
                    <div style={{ color: TIPO_COLOR[a.tipo] ?? "#9ca3af", fontWeight: 700 }}>{a.tipo}</div>
                    <div style={{ color: P_COLOR[a.priority_class] ?? "#9ca3af", fontWeight: 700 }}>{a.priority_class}</div>
                    <div style={{
                      color: "#e2e8f0",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                      paddingRight: 8,
                    }}>
                      {a.pm_protected && <span style={{ color: "#f59e0b", marginRight: 4 }}>🛡</span>}
                      {a.titolo}
                    </div>
                    <div>
                      <span style={{
                        background: a.planning_status === "READY" ? "#14532d" : "#7f1d1d",
                        color: a.planning_status === "READY" ? "#86efac" : "#fca5a5",
                        padding: "2px 7px",
                        borderRadius: 4,
                        fontSize: 10,
                        fontWeight: 700,
                      }}>{a.planning_status}</span>
                    </div>
                    <div style={{
                      color: zoneColor,
                      fontSize: 10,
                      fontWeight: 600,
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                    }}>
                      {a.freeze_zone
                        ? a.freeze_zone.replace("_24","").replace("_48","").replace("_72","").replace("_168","")
                        : "—"}
                    </div>
                    <div style={{ color: "#3b82f6", fontFamily: "monospace" }}>{a.insertion_score}</div>
                    <div style={{ color: "#ef4444", fontFamily: "monospace" }}>{a.disruption_cost}</div>
                    <div style={{
                      fontFamily: "monospace",
                      fontWeight: 700,
                      color: a.net_value > 0 ? "#22c55e" : a.net_value < -10 ? "#ef4444" : "#f59e0b",
                    }}>
                      {a.net_value > 0 ? "+" : ""}{a.net_value}
                    </div>
                  </div>

                  {/* ── Riga dettaglio espandibile ──────────────────── */}
                  {isOpen && (
                    <div style={{
                      background: "#080d19",
                      borderBottom: "1px solid #111827",
                      padding: "12px 16px 16px",
                      display: "grid",
                      gridTemplateColumns: "1fr 1fr 1fr",
                      gap: 16,
                      fontSize: 12,
                    }}>
                      {/* Bottleneck */}
                      <div>
                        <div style={{ fontSize: 10, color: "#4b5563", fontWeight: 700, marginBottom: 6, textTransform: "uppercase" }}>
                          Bottleneck
                        </div>
                        {a.bottlenecks.length === 0
                          ? <span style={{ color: "#22c55e" }}>✓ Nessun bottleneck rilevato</span>
                          : a.bottlenecks.map(b => (
                            <div key={b} style={{ color: "#fca5a5", marginBottom: 3 }}>
                              ✗ {BOTTLENECK_IT[b] ?? b}
                            </div>
                          ))
                        }
                      </div>

                      {/* PM Protection */}
                      <div>
                        <div style={{ fontSize: 10, color: "#4b5563", fontWeight: 700, marginBottom: 6, textTransform: "uppercase" }}>
                          PM Protection
                        </div>
                        {a.pm_protected
                          ? <span style={{ color: "#fbbf24" }}>🛡 {a.pm_protection_reason}</span>
                          : <span style={{ color: "#374151" }}>—</span>
                        }
                        {a.freeze_zone && (
                          <div style={{ marginTop: 8, color: "#4b5563", fontSize: 11 }}>
                            Zona corrente: <span style={{ color: zoneColor, fontWeight: 700 }}>
                              {ZONE_LABEL[a.freeze_zone] ?? a.freeze_zone}
                            </span>
                          </div>
                        )}
                      </div>

                      {/* Can-enter + Note */}
                      <div>
                        <div style={{ fontSize: 10, color: "#4b5563", fontWeight: 700, marginBottom: 6, textTransform: "uppercase" }}>
                          Può entrare
                        </div>
                        {Object.entries(a.can_enter).map(([zone, ok]) => (
                          <div key={zone} style={{
                            color: ok ? "#86efac" : "#374151",
                            fontSize: 11,
                            marginBottom: 2,
                          }}>
                            {ok ? "✓" : "✗"} {ZONE_LABEL[zone] ?? zone}
                          </div>
                        ))}
                        {a.notes.length > 0 && (
                          <div style={{ marginTop: 8 }}>
                            {a.notes.map((n, ni) => (
                              <div key={ni} style={{ color: "#f59e0b", fontSize: 10, marginBottom: 2 }}>
                                ⚡ {n}
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          {/* ── Note proxy ─────────────────────────────────────────────────── */}
          {data.kpi.note && data.kpi.note.length > 0 && (
            <div style={{ marginTop: 16, padding: "10px 14px", background: "#0c1220", border: "1px solid #1e293b", borderRadius: 8 }}>
              <div style={{ fontSize: 10, color: "#374151", fontWeight: 700, marginBottom: 4, textTransform: "uppercase" }}>Note proxy — campi non disponibili nel DB attuale</div>
              {data.kpi.note.map((n, i) => (
                <div key={i} style={{ fontSize: 10, color: "#374151", marginBottom: 2 }}>• {n}</div>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}
