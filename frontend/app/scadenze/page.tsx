"use client";

import { useEffect, useMemo, useState } from "react";
import type { CSSProperties } from "react";
import { AlertTriangle, CalendarClock, CheckCircle2, Clock3, RefreshCw, Search } from "lucide-react";
import { apiGet } from "../lib/api";
import { notify } from "@/lib/toast";

type ScadenzaRow = {
  id: number;
  sito: string;
  impianto: string;
  asset: string;
  asset_id: number | null;
  piano: string;
  piano_id: number | null;
  task: string;
  tipo: string;
  frequenza: string;
  frequenza_giorni: number | null;
  ultima: string;
  ultima_ticket_id: number | null;
  ultima_data: string | null;
  prossima: string;
  prossima_ticket_id: number | null;
  prossima_data: string | null;
  giorni_rimanenti: number | null;
  priorita: string;
  trigger_mode?: "calendar" | "condition" | "calendar_or_condition";
  trigger_kind?: "calendar" | "condition";
  current_running_hours?: number | null;
  condition_due_at_hours?: number | null;
  condition_remaining_hours?: number | null;
  condition_is_due?: boolean;
};

type ScadenziarioResponse = {
  items: ScadenzaRow[];
  total: number;
  generated_at: string;
};

type FilterMode = "tutte" | "scadute" | "sette" | "trenta" | "legge";

function formatDate(iso: string | null) {
  if (!iso) return "-";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "-";
  return d.toLocaleDateString("it-IT", { day: "2-digit", month: "2-digit", year: "numeric" });
}

function formatDays(days: number | null, row?: ScadenzaRow) {
  if (days === null) {
    if (row?.trigger_kind === "condition") {
      if (row.condition_remaining_hours === null || row.condition_remaining_hours === undefined) return "In attesa ore";
      if (row.condition_remaining_hours <= 0) return "Soglia raggiunta";
      return `${row.condition_remaining_hours.toLocaleString("it-IT", { maximumFractionDigits: 1 })} h`;
    }
    return "-";
  }
  if (days < 0) return `Scaduta da ${Math.abs(days)}g`;
  if (days === 0) return "Oggi";
  if (days === 1) return "1 giorno";
  return `${days} giorni`;
}

function statusForDays(days: number | null, row?: ScadenzaRow) {
  if (row?.trigger_kind === "condition") {
    if (row.condition_is_due) return { label: "Condizione", color: "#f05252", bg: "rgba(240,82,82,0.12)", border: "rgba(240,82,82,0.34)" };
    if (row.condition_remaining_hours === null || row.condition_remaining_hours === undefined) return { label: "Senza lettura", color: "#f6a233", bg: "rgba(246,162,51,0.12)", border: "rgba(246,162,51,0.34)" };
    return { label: "Ore residue", color: "#10d9b0", bg: "rgba(16,217,176,0.10)", border: "rgba(16,217,176,0.26)" };
  }
  if (days === null) return { label: "Da configurare", color: "var(--text-muted)", bg: "rgba(148,163,184,0.10)", border: "rgba(148,163,184,0.24)" };
  if (days < 0) return { label: "Scaduta", color: "#f05252", bg: "rgba(240,82,82,0.12)", border: "rgba(240,82,82,0.34)" };
  if (days <= 7) return { label: "Critica", color: "#f6a233", bg: "rgba(246,162,51,0.12)", border: "rgba(246,162,51,0.34)" };
  if (days <= 30) return { label: "Prossima", color: "#5b8fff", bg: "var(--cobalt-dim)", border: "rgba(91,143,255,0.30)" };
  return { label: "In piano", color: "#10d9b0", bg: "rgba(16,217,176,0.10)", border: "rgba(16,217,176,0.26)" };
}

function priorityStyle(priority: string) {
  const p = priority.toLowerCase();
  if (p === "alta") return { color: "#f87171", bg: "rgba(248,113,113,0.12)", border: "rgba(248,113,113,0.30)" };
  if (p === "bassa") return { color: "#22d3a0", bg: "rgba(34,211,160,0.10)", border: "rgba(34,211,160,0.24)" };
  return { color: "#f6a233", bg: "rgba(246,162,51,0.10)", border: "rgba(246,162,51,0.24)" };
}

function KpiTile({ label, value, detail, color, icon }: {
  label: string;
  value: number | string;
  detail: string;
  color: string;
  icon: React.ReactNode;
}) {
  return (
    <div style={{
      background: "linear-gradient(145deg, rgba(13,21,38,0.98), rgba(10,17,31,0.98))",
      border: "1px solid rgba(91,143,255,0.14)",
      borderLeft: `3px solid ${color}`,
      borderRadius: 8,
      padding: "14px 16px",
      minHeight: 92,
      boxShadow: "0 0 0 1px rgba(91,143,255,0.04), 0 10px 28px rgba(0,0,0,0.28)",
      display: "flex",
      flexDirection: "column",
      justifyContent: "space-between",
    }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12 }}>
        <span style={{ fontSize: 10, color: "var(--text-muted)", letterSpacing: "0.14em", fontWeight: 800, textTransform: "uppercase" }}>
          {label}
        </span>
        <span style={{ color, display: "inline-flex" }}>{icon}</span>
      </div>
      <div>
        <div style={{ fontSize: 30, lineHeight: 1, fontWeight: 850, color: "var(--text-primary)", letterSpacing: "-0.03em" }}>
          {value}
        </div>
        <div style={{ marginTop: 6, fontSize: 11, color: "var(--text-secondary)" }}>{detail}</div>
      </div>
    </div>
  );
}

export default function ScadenzePage() {
  const [rows, setRows] = useState<ScadenzaRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [generatedAt, setGeneratedAt] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<FilterMode>("tutte");

  useEffect(() => {
    loadScadenze();
  }, []);

  async function loadScadenze() {
    setLoading(true);
    try {
      const data = await apiGet<ScadenziarioResponse>("/scadenze/scadenziario");
      setRows(data.items || []);
      setGeneratedAt(data.generated_at || null);
    } catch (err: unknown) {
      notify.error(err instanceof Error ? err.message : "Errore nel caricamento dello scadenziario.");
      setRows([]);
    } finally {
      setLoading(false);
    }
  }

  const stats = useMemo(() => {
    const scadute = rows.filter(r => (r.giorni_rimanenti !== null && r.giorni_rimanenti < 0) || r.condition_is_due).length;
    const sette = rows.filter(r => r.giorni_rimanenti !== null && r.giorni_rimanenti >= 0 && r.giorni_rimanenti <= 7).length;
    const trenta = rows.filter(r => r.giorni_rimanenti !== null && r.giorni_rimanenti > 7 && r.giorni_rimanenti <= 30).length;
    const legge = rows.filter(r => r.tipo.toUpperCase().includes("LEGGE")).length;
    return { totale: rows.length, scadute, sette, trenta, legge };
  }, [rows]);

  const filteredRows = useMemo(() => {
    const q = query.trim().toLowerCase();
    return rows
      .filter(row => {
        if (filter === "scadute" && !((row.giorni_rimanenti !== null && row.giorni_rimanenti < 0) || row.condition_is_due)) return false;
        if (filter === "sette" && !(row.giorni_rimanenti !== null && row.giorni_rimanenti >= 0 && row.giorni_rimanenti <= 7)) return false;
        if (filter === "trenta" && !(row.giorni_rimanenti !== null && row.giorni_rimanenti > 7 && row.giorni_rimanenti <= 30)) return false;
        if (filter === "legge" && !row.tipo.toUpperCase().includes("LEGGE")) return false;
        if (!q) return true;
        return [row.sito, row.impianto, row.asset, row.piano, row.task, row.tipo, row.priorita]
          .some(value => (value || "").toLowerCase().includes(q));
      })
      .sort((a, b) => (a.giorni_rimanenti ?? 999999) - (b.giorni_rimanenti ?? 999999) || a.asset.localeCompare(b.asset));
  }, [rows, query, filter]);

  const filterItems: Array<{ id: FilterMode; label: string; count: number }> = [
    { id: "tutte", label: "Tutte", count: stats.totale },
    { id: "scadute", label: "Scadute", count: stats.scadute },
    { id: "sette", label: "0-7 giorni", count: stats.sette },
    { id: "trenta", label: "8-30 giorni", count: stats.trenta },
    { id: "legge", label: "Legge/PM", count: stats.legge },
  ];

  return (
    <div style={{ minHeight: "100%", background: "var(--surface-0)", padding: "28px 32px 38px", color: "var(--text-primary)" }}>
      <header style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 24, marginBottom: 22 }}>
        <div>
          <div style={{ fontSize: 11, letterSpacing: "0.16em", textTransform: "uppercase", color: "#5b8fff", fontWeight: 800, marginBottom: 7 }}>
            Manutenzione programmata
          </div>
          <h1 className="page-title" style={{ margin: 0, fontSize: 32, lineHeight: 1.05 }}>
            Scadenziario
          </h1>
          <p className="page-subtitle" style={{ margin: "7px 0 0", maxWidth: 760 }}>
            Asset con scadenze ricavate dai piani di manutenzione, con ultimo intervento, prossima occorrenza e giorni residui.
          </p>
        </div>

        <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 8 }}>
          <button
            type="button"
            onClick={loadScadenze}
            disabled={loading}
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 8,
              height: 36,
              padding: "0 14px",
              borderRadius: 7,
              border: "1px solid rgba(91,143,255,0.32)",
              background: loading ? "rgba(91,143,255,0.08)" : "linear-gradient(135deg, rgba(59,130,246,0.28), rgba(99,102,241,0.18))",
              color: "#dbeafe",
              fontSize: 12,
              fontWeight: 800,
              cursor: loading ? "not-allowed" : "pointer",
            }}
          >
            <RefreshCw size={15} />
            Aggiorna
          </button>
          <span style={{ fontSize: 11, color: "var(--text-muted)", fontFamily: "var(--font-mono)" }}>
            {generatedAt ? `sync ${formatDate(generatedAt)}` : "sync non disponibile"}
          </span>
        </div>
      </header>

      <section style={{ display: "grid", gridTemplateColumns: "repeat(4, minmax(0, 1fr))", gap: 14, marginBottom: 18 }}>
        <KpiTile label="Scadenze totali" value={stats.totale} detail="task attivi con prossima data" color="#5b8fff" icon={<CalendarClock size={18} />} />
        <KpiTile label="Scadute" value={stats.scadute} detail="richiedono ripianificazione" color="#f05252" icon={<AlertTriangle size={18} />} />
        <KpiTile label="Entro 7 giorni" value={stats.sette} detail="finestra critica operativa" color="#f6a233" icon={<Clock3 size={18} />} />
        <KpiTile label="Legge / PM" value={stats.legge} detail="adempimenti e preventive" color="#10d9b0" icon={<CheckCircle2 size={18} />} />
      </section>

      <section style={{
        background: "linear-gradient(145deg, rgba(13,21,38,0.98), rgba(8,14,26,0.98))",
        border: "1px solid rgba(91,143,255,0.14)",
        borderRadius: 8,
        boxShadow: "0 0 0 1px rgba(91,143,255,0.04), 0 16px 38px rgba(0,0,0,0.32)",
        overflow: "hidden",
      }}>
        <div style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          gap: 16,
          padding: "14px 16px",
          borderBottom: "1px solid var(--border-subtle)",
          background: "var(--surface-1)",
        }}>
          <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
            {filterItems.map(item => {
              const active = filter === item.id;
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => setFilter(item.id)}
                  style={{
                    height: 30,
                    padding: "0 11px",
                    borderRadius: 6,
                    border: active ? "1px solid rgba(91,143,255,0.42)" : "1px solid var(--cobalt-dim)",
                    background: active ? "rgba(91,143,255,0.14)" : "rgba(255,255,255,0.025)",
                    color: active ? "#dbeafe" : "var(--text-secondary)",
                    cursor: "pointer",
                    fontSize: 12,
                    fontWeight: 750,
                  }}
                >
                  {item.label} <span style={{ color: active ? "#8bb8ff" : "var(--text-muted)", marginLeft: 5 }}>{item.count}</span>
                </button>
              );
            })}
          </div>

          <label style={{ position: "relative", minWidth: 280 }}>
            <Search size={15} style={{ position: "absolute", left: 10, top: "50%", transform: "translateY(-50%)", color: "var(--text-muted)" }} />
            <input
              value={query}
              onChange={e => setQuery(e.target.value)}
              placeholder="Cerca sito, asset, piano..."
              style={{
                width: "100%",
                height: 34,
                padding: "0 11px 0 34px",
                borderRadius: 7,
                border: "1px solid rgba(91,143,255,0.18)",
                background: "rgba(6,10,18,0.74)",
                color: "var(--text-primary)",
                outline: "none",
                fontSize: 12,
              }}
            />
          </label>
        </div>

        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", minWidth: 1260, borderCollapse: "separate", borderSpacing: 0 }}>
            <thead>
              <tr>
                {["Sito", "Impianto", "Asset", "Piano", "Tipo", "Freq.", "Ultima", "Prossima", "Ore asset", "Giorni rimanenti"].map(label => (
                  <th key={label} style={thStyle}>{label}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {loading && Array.from({ length: 8 }).map((_, index) => (
                <tr key={`loading-${index}`}>
                  {Array.from({ length: 10 }).map((__, cell) => (
                    <td key={cell} style={tdStyle}>
                      <div style={{ height: 12, width: `${55 + ((index + cell) % 4) * 10}%`, borderRadius: 4, background: "rgba(91,143,255,0.08)" }} />
                    </td>
                  ))}
                </tr>
              ))}

              {!loading && filteredRows.map(row => {
                const status = statusForDays(row.giorni_rimanenti, row);
                const prio = priorityStyle(row.priorita || "Media");
                const conditionText = row.trigger_kind === "condition"
                  ? `Soglia ${row.condition_due_at_hours?.toLocaleString("it-IT", { maximumFractionDigits: 1 }) ?? "-"} h`
                  : row.task || "Task manutenzione";
                // Calcola celle ore asset
                const hasHours = row.current_running_hours !== null && row.current_running_hours !== undefined;
                const hasRemaining = row.condition_remaining_hours !== null && row.condition_remaining_hours !== undefined;
                const remainingOk = hasRemaining && (row.condition_remaining_hours! > 0);
                const remainingDue = hasRemaining && (row.condition_remaining_hours! <= 0);

                return (
                  <tr key={row.id} title={row.task} style={{ background: ((row.giorni_rimanenti !== null && row.giorni_rimanenti < 0) || row.condition_is_due) ? "rgba(240,82,82,0.035)" : "transparent" }}>
                    <td style={tdStyle}>{row.sito || "-"}</td>
                    <td style={tdStyle}>{row.impianto || "-"}</td>
                    <td style={{ ...tdStyle, fontWeight: 800, color: "var(--text-primary)" }}>{row.asset || "-"}</td>
                    <td style={tdStyle}>
                      <span style={{ fontFamily: "var(--font-mono)", fontSize: 11, color: "#8bb8ff" }}>{row.piano || "-"}</span>
                    </td>
                    <td style={tdStyle}>
                      <span style={{ ...badgeStyle, color: "#10d9b0", background: "rgba(16,217,176,0.10)", borderColor: "rgba(16,217,176,0.24)" }}>
                        {row.tipo || "PM"}
                      </span>
                    </td>
                    <td style={tdStyle}>{row.frequenza || (row.frequenza_giorni ? `${row.frequenza_giorni}G` : "-")}</td>
                    <td style={tdStyle}>
                      <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
                        <span>{row.ultima || "-"}</span>
                        {row.ultima_data && <span style={{ color: "var(--text-muted)", fontSize: 10 }}>{formatDate(row.ultima_data)}</span>}
                      </div>
                    </td>
                    <td style={tdStyle}>
                      <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
                        <span>{row.prossima || formatDate(row.prossima_data)}</span>
                        <span style={{ color: "var(--text-muted)", fontSize: 10 }}>{conditionText}</span>
                      </div>
                    </td>
                    {/* Colonna Ore asset */}
                    <td style={tdStyle}>
                      {hasHours ? (
                        <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
                          <span style={{ fontFamily: "var(--font-mono)", fontSize: 12, color: "#10d9b0", fontWeight: 700 }}>
                            {row.current_running_hours!.toLocaleString("it-IT", { maximumFractionDigits: 1 })} h
                          </span>
                          {hasRemaining && (
                            <span style={{
                              fontSize: 10, fontFamily: "var(--font-mono)",
                              color: remainingDue ? "#f05252" : remainingOk && row.condition_remaining_hours! <= 50 ? "#f6a233" : "var(--text-muted)",
                              fontWeight: 600,
                            }}>
                              {remainingDue
                                ? "▲ Soglia raggiunta"
                                : `−${row.condition_remaining_hours!.toLocaleString("it-IT", { maximumFractionDigits: 1 })} h al tagliando`}
                            </span>
                          )}
                        </div>
                      ) : (
                        <span style={{ color: "var(--text-disabled)", fontSize: 11 }}>—</span>
                      )}
                    </td>
                    <td style={tdStyle}>
                      <div style={{ display: "flex", alignItems: "center", gap: 8, justifyContent: "space-between" }}>
                        <span style={{ ...badgeStyle, color: status.color, background: status.bg, borderColor: status.border }}>
                          {status.label}
                        </span>
                        <span style={{ fontWeight: 850, color: status.color, fontFamily: "var(--font-mono)", whiteSpace: "nowrap" }}>
                          {formatDays(row.giorni_rimanenti, row)}
                        </span>
                        <span style={{ ...badgeStyle, color: prio.color, background: prio.bg, borderColor: prio.border }}>
                          {row.priorita || "Media"}
                        </span>
                      </div>
                    </td>
                  </tr>
                );
              })}

              {!loading && filteredRows.length === 0 && (
                <tr>
                  <td colSpan={10} style={{ padding: "44px 18px", textAlign: "center", color: "var(--text-muted)", borderTop: "1px solid rgba(91,143,255,0.08)" }}>
                    Nessuna scadenza corrisponde ai filtri selezionati.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

const thStyle: CSSProperties = {
  height: 38,
  padding: "0 14px",
  textAlign: "left",
  fontSize: 10,
  color: "var(--text-muted)",
  letterSpacing: "0.13em",
  textTransform: "uppercase",
  fontWeight: 850,
  background: "rgba(6,10,18,0.72)",
  borderBottom: "1px solid var(--cobalt-dim)",
  whiteSpace: "nowrap",
};

const tdStyle: CSSProperties = {
  minHeight: 50,
  padding: "11px 14px",
  borderBottom: "1px solid rgba(91,143,255,0.075)",
  color: "var(--text-secondary)",
  fontSize: 12,
  verticalAlign: "middle",
};

const badgeStyle: CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  minHeight: 22,
  padding: "2px 8px",
  borderRadius: 5,
  border: "1px solid",
  fontSize: 10,
  fontWeight: 850,
  letterSpacing: "0.05em",
  textTransform: "uppercase",
  whiteSpace: "nowrap",
};
