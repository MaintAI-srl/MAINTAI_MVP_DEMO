"use client";

import { useEffect, useMemo, useState } from "react";
import type { CSSProperties, ReactNode } from "react";
import { Activity, AlertTriangle, Clock3, Gauge, RefreshCw, Search } from "lucide-react";
import { apiGet, apiPost } from "../lib/api";
import { notify } from "@/lib/toast";

type ConditionTask = {
  task_id: number;
  piano_id: number | null;
  nome: string;
  trigger_mode: "condition" | "calendar_or_condition";
  threshold_hours: number | null;
  due_at_hours: number | null;
  remaining_hours: number | null;
  is_due: boolean;
  priorita: string;
};

type AssetCondition = {
  asset_id: number;
  asset_nome: string;
  asset_codice: string | null;
  impianto_nome: string;
  sito_nome: string;
  current_hours: number | null;
  recorded_at: string | null;
  due_tasks: ConditionTask[];
  condition_tasks: ConditionTask[];
};

type ConditionsResponse = {
  items: AssetCondition[];
  total: number;
};

function fmtDate(iso: string | null) {
  if (!iso) return "-";
  return new Date(iso).toLocaleString("it-IT", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

function fmtHours(value: number | null | undefined) {
  if (value === null || value === undefined) return "-";
  return `${value.toLocaleString("it-IT", { maximumFractionDigits: 1 })} h`;
}

export default function CondizioniPage() {
  const [items, setItems] = useState<AssetCondition[]>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState("");
  const [editing, setEditing] = useState<Record<number, string>>({});
  const [savingId, setSavingId] = useState<number | null>(null);

  useEffect(() => {
    load();
  }, []);

  async function load() {
    setLoading(true);
    try {
      const res = await apiGet<ConditionsResponse>("/conditions/running-hours/assets");
      setItems(res.items || []);
    } catch (err: unknown) {
      notify.error(err instanceof Error ? err.message : "Errore caricamento condizioni asset.");
    } finally {
      setLoading(false);
    }
  }

  async function saveReading(assetId: number) {
    const raw = editing[assetId];
    const value = Number(raw);
    if (!Number.isFinite(value) || value < 0) {
      notify.error("Inserisci ore di funzionamento valide.");
      return;
    }

    setSavingId(assetId);
    try {
      await apiPost(`/conditions/running-hours/assets/${assetId}`, { value });
      notify.success("Lettura ore registrata.");
      setEditing(prev => ({ ...prev, [assetId]: "" }));
      await load();
    } catch (err: unknown) {
      notify.error(err instanceof Error ? err.message : "Errore salvataggio lettura.");
    } finally {
      setSavingId(null);
    }
  }

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return items;
    return items.filter(item =>
      [item.asset_nome, item.asset_codice, item.impianto_nome, item.sito_nome]
        .some(value => (value || "").toLowerCase().includes(q))
    );
  }, [items, query]);

  const stats = useMemo(() => {
    const monitored = items.filter(i => i.condition_tasks.length > 0).length;
    const due = items.filter(i => i.due_tasks.length > 0).length;
    const missing = items.filter(i => i.current_hours === null).length;
    return { total: items.length, monitored, due, missing };
  }, [items]);

  return (
    <div style={{ minHeight: "100%", background: "var(--surface-0)", padding: "28px 32px 38px", color: "var(--text-primary)" }}>
      <header style={{ display: "flex", justifyContent: "space-between", gap: 24, alignItems: "flex-start", marginBottom: 22 }}>
        <div>
          <div style={{ fontSize: 11, letterSpacing: "0.16em", textTransform: "uppercase", color: "#10d9b0", fontWeight: 800, marginBottom: 7 }}>
            Manutenzione su condizione
          </div>
          <h1 className="page-title" style={{ margin: 0, fontSize: 32, lineHeight: 1.05 }}>
            Dati Misure Asset
          </h1>
          <p className="page-subtitle" style={{ margin: "7px 0 0", maxWidth: 760 }}>
            Registra letture reali per singolo asset. I task configurati su condizione scattano solo sulle ore del proprio asset.
          </p>
        </div>
        <button type="button" onClick={load} disabled={loading} style={buttonStyle}>
          <RefreshCw size={15} /> Aggiorna
        </button>
      </header>

      <section style={{ display: "grid", gridTemplateColumns: "repeat(4, minmax(0, 1fr))", gap: 14, marginBottom: 18 }}>
        <Kpi label="Asset" value={stats.total} color="#5b8fff" icon={<Gauge size={18} />} />
        <Kpi label="Monitorati" value={stats.monitored} color="#10d9b0" icon={<Activity size={18} />} />
        <Kpi label="In soglia" value={stats.due} color="#f05252" icon={<AlertTriangle size={18} />} />
        <Kpi label="Senza lettura" value={stats.missing} color="#f6a233" icon={<Clock3 size={18} />} />
      </section>

      <section style={panelStyle}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "14px 16px", borderBottom: "1px solid rgba(91,143,255,0.10)" }}>
          <div style={{ fontSize: 13, fontWeight: 800, color: "var(--text-primary)" }}>
            Letture asset
          </div>
          <label style={{ position: "relative", minWidth: 320 }}>
            <Search size={15} style={{ position: "absolute", left: 10, top: "50%", transform: "translateY(-50%)", color: "var(--text-muted)" }} />
            <input
              value={query}
              onChange={e => setQuery(e.target.value)}
              placeholder="Cerca asset, sito, impianto..."
              style={searchStyle}
            />
          </label>
        </div>

        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", minWidth: 1080, borderCollapse: "separate", borderSpacing: 0 }}>
            <thead>
              <tr>
                {["Asset", "Sito / Impianto", "Ore attuali", "Ultima lettura", "Nuova lettura", "Task su condizione"].map(label => (
                  <th key={label} style={thStyle}>{label}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {loading && Array.from({ length: 6 }).map((_, index) => (
                <tr key={`loading-${index}`}>
                  {Array.from({ length: 6 }).map((__, cell) => (
                    <td key={cell} style={tdStyle}><div style={{ height: 12, width: "70%", borderRadius: 4, background: "rgba(91,143,255,0.08)" }} /></td>
                  ))}
                </tr>
              ))}

              {!loading && filtered.map(item => (
                <tr key={item.asset_id}>
                  <td style={tdStyle}>
                    <div style={{ fontWeight: 850, color: "var(--text-primary)" }}>{item.asset_nome}</div>
                    <div style={{ marginTop: 3, fontSize: 10, color: "var(--text-muted)", fontFamily: "var(--font-mono)" }}>{item.asset_codice || `#${item.asset_id}`}</div>
                  </td>
                  <td style={tdStyle}>
                    <div>{item.sito_nome || "-"}</div>
                    <div style={{ marginTop: 3, fontSize: 10, color: "var(--text-muted)" }}>{item.impianto_nome || "-"}</div>
                  </td>
                  <td style={{ ...tdStyle, color: item.current_hours === null ? "#f6a233" : "#43edd3", fontWeight: 850, fontFamily: "var(--font-mono)" }}>
                    {fmtHours(item.current_hours)}
                  </td>
                  <td style={tdStyle}>{fmtDate(item.recorded_at)}</td>
                  <td style={tdStyle}>
                    <div style={{ display: "flex", gap: 8 }}>
                      <input
                        type="number"
                        min={0}
                        step="0.1"
                        value={editing[item.asset_id] ?? ""}
                        onChange={e => setEditing(prev => ({ ...prev, [item.asset_id]: e.target.value }))}
                        placeholder="ore"
                        style={inputStyle}
                      />
                      <button
                        type="button"
                        onClick={() => saveReading(item.asset_id)}
                        disabled={savingId === item.asset_id}
                        style={{ ...smallButtonStyle, opacity: savingId === item.asset_id ? 0.6 : 1 }}
                      >
                        Salva
                      </button>
                    </div>
                  </td>
                  <td style={tdStyle}>
                    {item.condition_tasks.length === 0 ? (
                      <span style={{ color: "var(--text-muted)" }}>Nessun task configurato</span>
                    ) : (
                      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                        {item.condition_tasks.slice(0, 3).map(task => (
                          <div key={task.task_id} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
                            <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{task.nome}</span>
                            <span style={{
                              color: task.is_due ? "#f87171" : "#f6a233",
                              background: task.is_due ? "rgba(248,113,113,0.12)" : "rgba(246,162,51,0.10)",
                              border: `1px solid ${task.is_due ? "rgba(248,113,113,0.28)" : "rgba(246,162,51,0.24)"}`,
                              borderRadius: 5,
                              padding: "2px 7px",
                              fontSize: 10,
                              fontWeight: 850,
                              whiteSpace: "nowrap",
                            }}>
                              {task.is_due ? "DOVUTO" : `${fmtHours(task.remaining_hours)} residue`}
                            </span>
                          </div>
                        ))}
                      </div>
                    )}
                  </td>
                </tr>
              ))}

              {!loading && filtered.length === 0 && (
                <tr>
                  <td colSpan={6} style={{ padding: "44px 18px", textAlign: "center", color: "var(--text-muted)", borderTop: "1px solid rgba(91,143,255,0.08)" }}>
                    Nessun asset trovato.
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

function Kpi({ label, value, color, icon }: { label: string; value: number; color: string; icon: ReactNode }) {
  return (
    <div style={{ background: "linear-gradient(145deg, rgba(13,21,38,0.98), rgba(10,17,31,0.98))", border: "1px solid rgba(91,143,255,0.14)", borderLeft: `3px solid ${color}`, borderRadius: 8, padding: "14px 16px", minHeight: 86, display: "flex", flexDirection: "column", justifyContent: "space-between" }}>
      <div style={{ display: "flex", justifyContent: "space-between", color: "var(--text-muted)", fontSize: 10, fontWeight: 850, letterSpacing: "0.14em", textTransform: "uppercase" }}>
        {label}<span style={{ color }}>{icon}</span>
      </div>
      <div style={{ fontSize: 30, fontWeight: 850, color: "var(--text-primary)", lineHeight: 1 }}>{value}</div>
    </div>
  );
}

const buttonStyle: CSSProperties = { display: "inline-flex", alignItems: "center", gap: 8, height: 36, padding: "0 14px", borderRadius: 7, border: "1px solid rgba(16,217,176,0.32)", background: "rgba(16,217,176,0.10)", color: "#d1fae5", fontSize: 12, fontWeight: 800, cursor: "pointer" };
const panelStyle: CSSProperties = { background: "linear-gradient(145deg, rgba(13,21,38,0.98), rgba(8,14,26,0.98))", border: "1px solid rgba(91,143,255,0.14)", borderRadius: 8, overflow: "hidden", boxShadow: "0 0 0 1px rgba(91,143,255,0.04), 0 16px 38px rgba(0,0,0,0.32)" };
const searchStyle: CSSProperties = { width: "100%", height: 34, padding: "0 11px 0 34px", borderRadius: 7, border: "1px solid rgba(91,143,255,0.18)", background: "rgba(6,10,18,0.74)", color: "var(--text-primary)", outline: "none", fontSize: 12 };
const thStyle: CSSProperties = { height: 38, padding: "0 14px", textAlign: "left", fontSize: 10, color: "var(--text-muted)", letterSpacing: "0.13em", textTransform: "uppercase", fontWeight: 850, background: "rgba(6,10,18,0.72)", borderBottom: "1px solid rgba(91,143,255,0.12)", whiteSpace: "nowrap" };
const tdStyle: CSSProperties = { padding: "12px 14px", borderBottom: "1px solid rgba(91,143,255,0.075)", color: "var(--text-secondary)", fontSize: 12, verticalAlign: "middle" };
const inputStyle: CSSProperties = { width: 110, height: 32, borderRadius: 7, border: "1px solid rgba(91,143,255,0.18)", background: "rgba(6,10,18,0.74)", color: "var(--text-primary)", padding: "0 9px", outline: "none", fontSize: 12 };
const smallButtonStyle: CSSProperties = { height: 32, padding: "0 11px", borderRadius: 7, border: "1px solid rgba(16,217,176,0.30)", background: "rgba(16,217,176,0.10)", color: "#43edd3", fontSize: 11, fontWeight: 850, cursor: "pointer" };
