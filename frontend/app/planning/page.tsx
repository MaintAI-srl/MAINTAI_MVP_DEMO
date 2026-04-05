"use client";

import { useEffect, useState, useMemo } from "react";
import { apiGet, apiPost } from "../lib/api";
import { notify } from "@/lib/toast";

// ── Types ─────────────────────────────────────────────────────────────────────

type PlannedWO = {
  wo_id: number;
  technician_id: number;
  planned_date: string;
  time_slot: string;
  motivation: string;
  warnings: string[];
};

type DeferredWO = {
  wo_id: number;
  reason: string;
};

type FermoAsset = {
  asset_id: number;
  triggered_by_wo_id: number;
};

type AIPlan = {
  id: number;
  created_at: string;
  status: string;
  horizon_days: number;
  confirmed_at: string | null;
  plan_json: {
    planned_workorders: PlannedWO[];
    deferred_workorders: DeferredWO[];
    fermo_assets: FermoAsset[];
    global_warnings: string[];
  };
};

type TicketInfo = {
  id: number;
  titolo: string;
  tipo: string;
  priorita: string;
  asset_id: number | null;
  asset_name?: string;
};

type TecnicoInfo = {
  id: number;
  nome: string;
  cognome: string | null;
  competenze: string;
};

type AssetInfo = {
  id: number;
  nome: string;
  area: string;
};

// ── Helpers ───────────────────────────────────────────────────────────────────

function tipoWOStyle(tipo: string): React.CSSProperties {
  const t = (tipo || "").toUpperCase();
  if (t.includes("BD") || t.includes("GUASTO") || t.includes("BREAKDOWN"))
    return { color: "#f87171", background: "rgba(248,113,113,0.12)", border: "1px solid rgba(248,113,113,0.35)", borderRadius: 6, padding: "2px 8px", fontSize: 10, fontWeight: 700, letterSpacing: "0.08em" };
  if (t.includes("PM") || t.includes("PREVENTIV"))
    return { color: "#34d399", background: "rgba(52,211,153,0.12)", border: "1px solid rgba(52,211,153,0.35)", borderRadius: 6, padding: "2px 8px", fontSize: 10, fontWeight: 700, letterSpacing: "0.08em" };
  return { color: "#fbbf24", background: "rgba(251,191,36,0.12)", border: "1px solid rgba(251,191,36,0.35)", borderRadius: 6, padding: "2px 8px", fontSize: 10, fontWeight: 700, letterSpacing: "0.08em" };
}

function tipoLabel(tipo: string): string {
  const t = (tipo || "").toUpperCase();
  if (t.includes("BD") || t.includes("GUASTO") || t.includes("BREAKDOWN")) return "BD";
  if (t.includes("PM") || t.includes("PREVENTIV")) return "PM";
  return "CM";
}

function formatDate(d: string): string {
  if (!d) return "—";
  const dt = new Date(d + "T00:00:00");
  return dt.toLocaleDateString("it-IT", { weekday: "short", day: "2-digit", month: "short" });
}

function formatDateTime(d: string | null): string {
  if (!d) return "—";
  return new Date(d).toLocaleString("it-IT", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

// ── Icons ─────────────────────────────────────────────────────────────────────

function IconBrain({ size = 20, color = "currentColor" }: { size?: number; color?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
      <path d="M9.5 2A2.5 2.5 0 0 1 12 4.5v15a2.5 2.5 0 0 1-4.96-.44 2.5 2.5 0 0 1-2.96-3.08 3 3 0 0 1-.34-5.58 2.5 2.5 0 0 1 1.32-4.24 2.5 2.5 0 0 1 1.44-3.16Z"/>
      <path d="M14.5 2A2.5 2.5 0 0 0 12 4.5v15a2.5 2.5 0 0 0 4.96-.44 2.5 2.5 0 0 0 2.96-3.08 3 3 0 0 0 .34-5.58 2.5 2.5 0 0 0-1.32-4.24 2.5 2.5 0 0 0-1.44-3.16Z"/>
    </svg>
  );
}

function IconCalendar({ size = 20, color = "currentColor" }: { size?: number; color?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="4" width="18" height="18" rx="2" ry="2"/>
      <line x1="16" y1="2" x2="16" y2="6"/>
      <line x1="8" y1="2" x2="8" y2="6"/>
      <line x1="3" y1="10" x2="21" y2="10"/>
    </svg>
  );
}

function IconWarning({ size = 16, color = "#fbbf24" }: { size?: number; color?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z"/>
      <path d="M12 9v4"/>
      <path d="M12 17h.01"/>
    </svg>
  );
}

function IconCheck({ size = 16, color = "#34d399" }: { size?: number; color?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round">
      <polyline points="20 6 9 17 4 12"/>
    </svg>
  );
}

function IconUser({ size = 16, color = "currentColor" }: { size?: number; color?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
      <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/>
      <circle cx="12" cy="7" r="4"/>
    </svg>
  );
}

// ── Spinner ───────────────────────────────────────────────────────────────────

function Spinner() {
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 24, padding: "64px 0" }}>
      <div style={{
        width: 64, height: 64, borderRadius: "50%",
        border: "3px solid rgba(59,130,246,0.2)",
        borderTop: "3px solid #3b82f6",
        animation: "spin 0.8s linear infinite",
      }} />
      <div style={{ textAlign: "center" }}>
        <div style={{ fontSize: 18, fontWeight: 700, color: "var(--text-primary)", marginBottom: 6 }}>
          MARCO sta elaborando il piano...
        </div>
        <div style={{
          fontSize: 13, color: "var(--text-secondary)",
          animation: "pulse 2s ease-in-out infinite",
        }}>
          Analisi ticket, bilanciamento backlog, verifica meteo e assegnazione tecnici in corso
        </div>
      </div>
      <style>{`
        @keyframes spin { to { transform: rotate(360deg); } }
        @keyframes pulse { 0%,100%{opacity:1} 50%{opacity:0.5} }
      `}</style>
    </div>
  );
}

// ── KPI Card ──────────────────────────────────────────────────────────────────

function KpiCard({ label, value, sub, color }: { label: string; value: string | number; sub?: string; color: string }) {
  return (
    <div style={{
      background: "var(--bg-card)", border: `1px solid ${color}33`,
      borderRadius: 12, padding: "20px 24px",
      display: "flex", flexDirection: "column", gap: 6,
      boxShadow: `0 0 24px ${color}11`,
    }}>
      <div style={{ fontSize: 10, fontWeight: 700, color, textTransform: "uppercase", letterSpacing: "0.12em" }}>{label}</div>
      <div style={{ fontSize: 32, fontWeight: 800, color: "var(--text-primary)", lineHeight: 1 }}>{value}</div>
      {sub && <div style={{ fontSize: 11, color: "var(--text-secondary)" }}>{sub}</div>}
    </div>
  );
}

// ── WO Card ───────────────────────────────────────────────────────────────────

function WOCard({
  wo, ticket, tecnico, asset,
}: {
  wo: PlannedWO;
  ticket?: TicketInfo;
  tecnico?: TecnicoInfo;
  asset?: AssetInfo;
}) {
  const tipo = ticket?.tipo || "CM";
  return (
    <div style={{
      background: "rgba(255,255,255,0.03)", border: "1px solid rgba(148,163,184,0.1)",
      borderRadius: 10, padding: "14px 18px", display: "flex", flexDirection: "column", gap: 10,
    }}>
      {/* Header */}
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, flex: 1, minWidth: 0 }}>
          <span style={tipoWOStyle(tipo)}>{tipoLabel(tipo)}</span>
          <span style={{ fontWeight: 700, fontSize: 14, color: "var(--text-primary)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            #{wo.wo_id} — {ticket?.titolo || "Work Order"}
          </span>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8, flexShrink: 0 }}>
          <span style={{ fontSize: 12, color: "#60a5fa", fontWeight: 600, background: "rgba(96,165,250,0.1)", border: "1px solid rgba(96,165,250,0.25)", borderRadius: 6, padding: "2px 8px" }}>
            {formatDate(wo.planned_date)}
          </span>
          <span style={{ fontSize: 12, color: "var(--text-secondary)", fontFamily: "var(--font-mono)" }}>
            {wo.time_slot}
          </span>
        </div>
      </div>

      {/* Info row */}
      <div style={{ display: "flex", flexWrap: "wrap", gap: 16, fontSize: 12 }}>
        {asset && (
          <span style={{ color: "var(--text-secondary)" }}>
            Asset: <span style={{ color: "var(--text-primary)", fontWeight: 600 }}>{asset.nome}</span>
            {asset.area && <span style={{ color: "var(--text-muted)" }}> ({asset.area})</span>}
          </span>
        )}
        {tecnico && (
          <span style={{ color: "var(--text-secondary)", display: "flex", alignItems: "center", gap: 4 }}>
            <IconUser size={13} color="#60a5fa" />
            <span style={{ color: "#60a5fa", fontWeight: 600 }}>{tecnico.nome} {tecnico.cognome || ""}</span>
          </span>
        )}
      </div>

      {/* Motivation */}
      {wo.motivation && (
        <div style={{
          fontSize: 12, color: "var(--text-secondary)",
          background: "rgba(255,255,255,0.02)", borderRadius: 6,
          padding: "8px 12px", borderLeft: "2px solid rgba(148,163,184,0.3)",
          fontStyle: "italic",
        }}>
          {wo.motivation}
        </div>
      )}

      {/* Warnings */}
      {wo.warnings && wo.warnings.length > 0 && (
        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          {wo.warnings.map((w, i) => (
            <div key={i} style={{ display: "flex", alignItems: "flex-start", gap: 6, fontSize: 11, color: "#fbbf24" }}>
              <IconWarning size={13} />
              {w}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────

export default function PlanningPage() {
  const [plan, setPlan] = useState<AIPlan | null>(null);
  const [loading, setLoading] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [loadingCurrent, setLoadingCurrent] = useState(true);
  const [tickets, setTickets] = useState<TicketInfo[]>([]);
  const [tecnici, setTecnici] = useState<TecnicoInfo[]>([]);
  const [assets, setAssets] = useState<AssetInfo[]>([]);
  const [days, setDays] = useState(7);
  const [activeTab, setActiveTab] = useState<"pianificati" | "rimandati" | "fermo">("pianificati");

  // Lookup maps
  const ticketMap = useMemo(() => Object.fromEntries(tickets.map(t => [t.id, t])), [tickets]);
  const tecnicoMap = useMemo(() => Object.fromEntries(tecnici.map(t => [t.id, t])), [tecnici]);
  const assetMap = useMemo(() => Object.fromEntries(assets.map(a => [a.id, a])), [assets]);

  // Load lookups + current draft plan on mount
  useEffect(() => {
    async function loadData() {
      try {
        const [ticketsData, tecniciData, assetsData] = await Promise.allSettled([
          apiGet<any>("/tickets?limit=500"),
          apiGet<TecnicoInfo[]>("/tecnici"),
          apiGet<any>("/assets?limit=500"),
        ]);
        if (ticketsData.status === "fulfilled") {
          const d = ticketsData.value;
          setTickets(Array.isArray(d) ? d : (d?.items || []));
        }
        if (tecniciData.status === "fulfilled") {
          setTecnici(Array.isArray(tecniciData.value) ? tecniciData.value : []);
        }
        if (assetsData.status === "fulfilled") {
          const d = assetsData.value;
          setAssets(Array.isArray(d) ? d : (d?.items || []));
        }
      } catch (err) {
        // Ignora errori di caricamento lookup
      }

      // Carica piano corrente in draft
      try {
        const current = await apiGet<AIPlan | null>("/planning/current");
        if (current) setPlan(current);
      } catch {
        // Nessun piano draft esistente
      } finally {
        setLoadingCurrent(false);
      }
    }
    loadData();
  }, []);

  // Group planned WOs by technician
  const plannedByTecnico = useMemo(() => {
    if (!plan?.plan_json?.planned_workorders) return {};
    const grouped: Record<number, PlannedWO[]> = {};
    for (const wo of plan.plan_json.planned_workorders) {
      if (!grouped[wo.technician_id]) grouped[wo.technician_id] = [];
      grouped[wo.technician_id].push(wo);
    }
    // Sort each group by date
    for (const tecId in grouped) {
      grouped[parseInt(tecId)].sort((a, b) => a.planned_date.localeCompare(b.planned_date));
    }
    return grouped;
  }, [plan]);

  const handleGenerate = async () => {
    setLoading(true);
    try {
      const result = await apiPost<AIPlan>("/planning/generate", { days });
      setPlan(result);
      setActiveTab("pianificati");
      notify.success("Piano AI generato con successo!");
    } catch (err: any) {
      notify.error(err?.message || "Errore nella generazione del piano");
    } finally {
      setLoading(false);
    }
  };

  const handleConfirm = async () => {
    if (!plan) return;
    setConfirming(true);
    try {
      const result = await apiPost<AIPlan>(`/planning/confirm/${plan.id}`, {});
      setPlan(result);
      notify.success("Piano confermato! Ticket aggiornati e asset messi in Fermo.");
    } catch (err: any) {
      notify.error(err?.message || "Errore nella conferma del piano");
    } finally {
      setConfirming(false);
    }
  };

  const planData = plan?.plan_json;
  const nPlanned = planData?.planned_workorders?.length ?? 0;
  const nDeferred = planData?.deferred_workorders?.length ?? 0;
  const nFermo = planData?.fermo_assets?.length ?? 0;
  const nWarnings = planData?.global_warnings?.length ?? 0;
  const isDraft = plan?.status === "draft";
  const isConfirmed = plan?.status === "confirmed";

  const tabStyle = (tab: string): React.CSSProperties => ({
    padding: "8px 20px", borderRadius: 8, fontSize: 12, fontWeight: 700,
    cursor: "pointer", border: "none", outline: "none",
    background: activeTab === tab ? "rgba(59,130,246,0.18)" : "transparent",
    color: activeTab === tab ? "#60a5fa" : "var(--text-secondary)",
    borderBottom: activeTab === tab ? "2px solid #3b82f6" : "2px solid transparent",
    transition: "all 0.15s",
  });

  return (
    <div style={{ padding: "0 0 40px" }}>
      {/* ── Hero ── */}
      <div style={{
        position: "relative", overflow: "hidden",
        background: "linear-gradient(135deg, rgba(16,24,40,0.95) 0%, rgba(10,18,35,0.98) 100%)",
        borderBottom: "1px solid rgba(148,163,184,0.1)",
        padding: "36px 32px 28px",
        marginBottom: 32,
      }}>
        {/* Mesh grid bg */}
        <div style={{
          position: "absolute", inset: 0, opacity: 0.04,
          backgroundImage: "linear-gradient(rgba(59,130,246,0.8) 1px, transparent 1px), linear-gradient(90deg, rgba(59,130,246,0.8) 1px, transparent 1px)",
          backgroundSize: "40px 40px",
        }} />
        {/* Glow */}
        <div style={{
          position: "absolute", top: -80, right: 80, width: 320, height: 320,
          borderRadius: "50%", background: "radial-gradient(circle, rgba(16,185,129,0.12) 0%, transparent 70%)",
          pointerEvents: "none",
        }} />

        <div style={{ position: "relative", zIndex: 1, display: "flex", alignItems: "flex-start", justifyContent: "space-between", flexWrap: "wrap", gap: 20 }}>
          <div>
            <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 8 }}>
              <div style={{ width: 40, height: 40, borderRadius: 10, background: "linear-gradient(135deg,#10b981,#3b82f6)", display: "flex", alignItems: "center", justifyContent: "center" }}>
                <IconBrain size={22} color="#fff" />
              </div>
              <div>
                <h1 style={{
                  margin: 0, fontSize: "clamp(22px, 4vw, 30px)", fontWeight: 900,
                  background: "linear-gradient(90deg, #10b981, #3b82f6, #8b5cf6)",
                  WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent",
                  letterSpacing: "-0.02em",
                }}>
                  Pianificazione AI
                </h1>
              </div>
            </div>
            <p style={{ margin: 0, fontSize: 13, color: "var(--text-secondary)", maxWidth: 520 }}>
              MARCO — Planner Senior RCM/TPM. Genera piani manutenzione ottimizzati con bilanciamento backlog, vincoli meteo e assegnazione intelligente dei tecnici.
            </p>
          </div>

          {/* Generate controls */}
          <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <span style={{ fontSize: 11, color: "var(--text-muted)", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.1em" }}>Orizzonte</span>
              <select
                value={days}
                onChange={e => setDays(Number(e.target.value))}
                disabled={loading}
                style={{
                  background: "rgba(255,255,255,0.06)", border: "1px solid rgba(148,163,184,0.2)",
                  borderRadius: 8, color: "var(--text-primary)", padding: "8px 12px",
                  fontSize: 13, outline: "none", cursor: "pointer",
                }}
              >
                <option value={3}>3 giorni</option>
                <option value={7}>7 giorni</option>
                <option value={14}>14 giorni</option>
              </select>
            </div>
            <button
              onClick={handleGenerate}
              disabled={loading}
              style={{
                background: loading ? "rgba(16,185,129,0.3)" : "linear-gradient(135deg, #10b981, #059669)",
                border: "none", borderRadius: 10, color: "#fff",
                padding: "10px 24px", fontSize: 13, fontWeight: 700,
                cursor: loading ? "not-allowed" : "pointer",
                display: "flex", alignItems: "center", gap: 8,
                boxShadow: loading ? "none" : "0 4px 20px rgba(16,185,129,0.3)",
                transition: "all 0.2s",
              }}
            >
              <IconBrain size={16} color="#fff" />
              {loading ? "Elaborazione..." : plan ? "Rigenera Piano" : "Genera Piano"}
            </button>
          </div>
        </div>
      </div>

      <div style={{ padding: "0 32px" }}>
        {/* Loading state */}
        {(loading || loadingCurrent) && <Spinner />}

        {/* Empty state */}
        {!loading && !loadingCurrent && !plan && (
          <div style={{
            display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
            padding: "80px 20px", gap: 16, textAlign: "center",
          }}>
            <div style={{ width: 72, height: 72, borderRadius: 20, background: "rgba(59,130,246,0.1)", display: "flex", alignItems: "center", justifyContent: "center", border: "1px solid rgba(59,130,246,0.2)" }}>
              <IconBrain size={36} color="#3b82f6" />
            </div>
            <div style={{ fontSize: 18, fontWeight: 700, color: "var(--text-primary)" }}>Nessun piano generato</div>
            <div style={{ fontSize: 13, color: "var(--text-secondary)", maxWidth: 400 }}>
              Clicca "Genera Piano" per avviare MARCO e creare un piano manutenzione ottimizzato per i prossimi {days} giorni.
            </div>
          </div>
        )}

        {/* Plan content */}
        {!loading && !loadingCurrent && plan && (
          <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>

            {/* Status banner */}
            <div style={{
              display: "flex", alignItems: "center", justifyContent: "space-between",
              flexWrap: "wrap", gap: 16,
              background: isConfirmed ? "rgba(52,211,153,0.08)" : "rgba(59,130,246,0.08)",
              border: `1px solid ${isConfirmed ? "rgba(52,211,153,0.25)" : "rgba(59,130,246,0.25)"}`,
              borderRadius: 12, padding: "16px 24px",
            }}>
              <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                  {isConfirmed
                    ? <IconCheck size={18} color="#34d399" />
                    : <IconCalendar size={18} color="#3b82f6" />
                  }
                  <span style={{ fontWeight: 700, fontSize: 14, color: isConfirmed ? "#34d399" : "#60a5fa" }}>
                    {isConfirmed ? "Piano Confermato" : "Bozza Piano"}
                  </span>
                </div>
                <span style={{ fontSize: 12, color: "var(--text-muted)" }}>
                  Generato il {formatDateTime(plan.created_at)}
                  {isConfirmed && plan.confirmed_at && ` — Confermato il ${formatDateTime(plan.confirmed_at)}`}
                </span>
                <span style={{ fontSize: 11, color: "var(--text-muted)", background: "rgba(255,255,255,0.05)", border: "1px solid rgba(148,163,184,0.15)", borderRadius: 5, padding: "2px 8px" }}>
                  Orizzonte: {plan.horizon_days} giorni
                </span>
              </div>
              {isDraft && (
                <button
                  onClick={handleConfirm}
                  disabled={confirming}
                  style={{
                    background: confirming ? "rgba(52,211,153,0.3)" : "linear-gradient(135deg, #10b981, #059669)",
                    border: "none", borderRadius: 8, color: "#fff",
                    padding: "8px 20px", fontSize: 12, fontWeight: 700,
                    cursor: confirming ? "not-allowed" : "pointer",
                    display: "flex", alignItems: "center", gap: 6,
                    boxShadow: confirming ? "none" : "0 2px 12px rgba(16,185,129,0.25)",
                  }}
                >
                  <IconCheck size={14} color="#fff" />
                  {confirming ? "Conferma in corso..." : "Conferma Piano"}
                </button>
              )}
            </div>

            {/* KPI Strip */}
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: 16 }}>
              <KpiCard label="WO Pianificati" value={nPlanned} sub="pronti per esecuzione" color="#3b82f6" />
              <KpiCard label="WO Rimandati" value={nDeferred} sub="da rivalutare" color="#f87171" />
              <KpiCard label="Asset in Fermo" value={nFermo} sub="alla conferma" color="#fbbf24" />
              <KpiCard label="Warning Globali" value={nWarnings} sub="richiede attenzione" color="#8b5cf6" />
            </div>

            {/* Tabs */}
            <div style={{ display: "flex", gap: 4, borderBottom: "1px solid rgba(148,163,184,0.1)", paddingBottom: 0 }}>
              <button style={tabStyle("pianificati")} onClick={() => setActiveTab("pianificati")}>
                WO Pianificati ({nPlanned})
              </button>
              <button style={tabStyle("rimandati")} onClick={() => setActiveTab("rimandati")}>
                Rimandati ({nDeferred})
              </button>
              {nFermo > 0 && (
                <button style={tabStyle("fermo")} onClick={() => setActiveTab("fermo")}>
                  Asset in Fermo ({nFermo})
                </button>
              )}
            </div>

            {/* Tab: Pianificati — grouped by technician */}
            {activeTab === "pianificati" && (
              <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
                {Object.keys(plannedByTecnico).length === 0 ? (
                  <div style={{ textAlign: "center", padding: "40px 20px", color: "var(--text-secondary)", fontSize: 14 }}>
                    Nessun work order pianificato nel piano corrente.
                  </div>
                ) : (
                  Object.entries(plannedByTecnico).map(([tecId, wos]) => {
                    const tecnico = tecnicoMap[parseInt(tecId)];
                    const totalOre = wos.reduce((acc, wo) => {
                      const ticket = ticketMap[wo.wo_id];
                      return acc; // La durata non è nel piano, solo informativa
                    }, 0);
                    return (
                      <div key={tecId} style={{
                        background: "var(--bg-card)", border: "1px solid rgba(148,163,184,0.1)",
                        borderRadius: 14, overflow: "hidden",
                      }}>
                        {/* Technician header */}
                        <div style={{
                          display: "flex", alignItems: "center", gap: 12,
                          padding: "16px 20px", borderBottom: "1px solid rgba(148,163,184,0.08)",
                          background: "rgba(59,130,246,0.06)",
                        }}>
                          <div style={{
                            width: 36, height: 36, borderRadius: "50%",
                            background: "linear-gradient(135deg,#3b82f6,#8b5cf6)",
                            display: "flex", alignItems: "center", justifyContent: "center",
                            flexShrink: 0,
                          }}>
                            <IconUser size={18} color="#fff" />
                          </div>
                          <div>
                            <div style={{ fontWeight: 700, fontSize: 15, color: "var(--text-primary)" }}>
                              {tecnico ? `${tecnico.nome} ${tecnico.cognome || ""}`.trim() : `Tecnico #${tecId}`}
                            </div>
                            {tecnico?.competenze && (
                              <div style={{ fontSize: 11, color: "var(--text-muted)" }}>{tecnico.competenze}</div>
                            )}
                          </div>
                          <div style={{ marginLeft: "auto", display: "flex", gap: 10, alignItems: "center" }}>
                            <span style={{
                              fontSize: 11, fontWeight: 700, color: "#3b82f6",
                              background: "rgba(59,130,246,0.1)", border: "1px solid rgba(59,130,246,0.25)",
                              borderRadius: 6, padding: "3px 10px",
                            }}>
                              {wos.length} WO assegnati
                            </span>
                          </div>
                        </div>

                        {/* WO list */}
                        <div style={{ display: "flex", flexDirection: "column", gap: 8, padding: "16px" }}>
                          {wos.map(wo => (
                            <WOCard
                              key={wo.wo_id}
                              wo={wo}
                              ticket={ticketMap[wo.wo_id]}
                              tecnico={tecnicoMap[wo.technician_id]}
                              asset={ticketMap[wo.wo_id]?.asset_id ? assetMap[ticketMap[wo.wo_id].asset_id!] : undefined}
                            />
                          ))}
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
            )}

            {/* Tab: Rimandati */}
            {activeTab === "rimandati" && (
              <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                {!planData?.deferred_workorders?.length ? (
                  <div style={{ textAlign: "center", padding: "40px 20px", color: "var(--text-secondary)", fontSize: 14 }}>
                    Nessun work order rimandato.
                  </div>
                ) : (
                  planData.deferred_workorders.map(dwo => {
                    const ticket = ticketMap[dwo.wo_id];
                    return (
                      <div key={dwo.wo_id} style={{
                        background: "var(--bg-card)", border: "1px solid rgba(248,113,113,0.15)",
                        borderRadius: 10, padding: "14px 18px",
                        display: "flex", alignItems: "flex-start", gap: 14,
                      }}>
                        <div style={{ marginTop: 2 }}>
                          <IconWarning size={18} color="#f87171" />
                        </div>
                        <div style={{ flex: 1 }}>
                          <div style={{ fontWeight: 700, fontSize: 14, color: "var(--text-primary)", marginBottom: 4 }}>
                            #{dwo.wo_id} — {ticket?.titolo || "Work Order"}
                          </div>
                          {ticket && (
                            <div style={{ fontSize: 11, color: "var(--text-muted)", marginBottom: 6 }}>
                              Tipo: {ticket.tipo} | Priorità: {ticket.priorita}
                            </div>
                          )}
                          <div style={{ fontSize: 12, color: "#f87171" }}>
                            {dwo.reason}
                          </div>
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
            )}

            {/* Tab: Fermo */}
            {activeTab === "fermo" && (
              <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                {!planData?.fermo_assets?.length ? (
                  <div style={{ textAlign: "center", padding: "40px 20px", color: "var(--text-secondary)", fontSize: 14 }}>
                    Nessun asset andrà in Fermo.
                  </div>
                ) : (
                  planData.fermo_assets.map(fa => {
                    const asset = assetMap[fa.asset_id];
                    const triggerTicket = ticketMap[fa.triggered_by_wo_id];
                    return (
                      <div key={fa.asset_id} style={{
                        background: "var(--bg-card)", border: "1px solid rgba(251,191,36,0.2)",
                        borderRadius: 10, padding: "16px 20px",
                        display: "flex", alignItems: "flex-start", gap: 14,
                      }}>
                        <div style={{
                          width: 40, height: 40, borderRadius: 10, flexShrink: 0,
                          background: "rgba(251,191,36,0.15)", border: "1px solid rgba(251,191,36,0.3)",
                          display: "flex", alignItems: "center", justifyContent: "center",
                        }}>
                          <svg width={20} height={20} viewBox="0 0 24 24" fill="none" stroke="#fbbf24" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
                            <rect x="2" y="7" width="20" height="14" rx="2"/>
                            <path d="M16 7V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v2"/>
                            <line x1="12" y1="12" x2="12" y2="16"/>
                            <line x1="12" y1="16" x2="12.01" y2="16"/>
                          </svg>
                        </div>
                        <div style={{ flex: 1 }}>
                          <div style={{ fontWeight: 700, fontSize: 14, color: "#fbbf24", marginBottom: 4 }}>
                            Asset #{fa.asset_id} — {asset?.nome || "Asset"}
                          </div>
                          {asset?.area && (
                            <div style={{ fontSize: 11, color: "var(--text-muted)", marginBottom: 6 }}>Area: {asset.area}</div>
                          )}
                          <div style={{ fontSize: 12, color: "var(--text-secondary)" }}>
                            Passerà in stato <strong style={{ color: "#fbbf24" }}>FERMO</strong> alla conferma del piano,
                            attivato dal WO #{fa.triggered_by_wo_id}
                            {triggerTicket && <span> — {triggerTicket.titolo}</span>}.
                          </div>
                          {!isConfirmed && (
                            <div style={{ marginTop: 6, fontSize: 11, color: "#fbbf24", opacity: 0.8 }}>
                              Stato attuale attivo. Confermando il piano, questo asset entrerà in FERMO.
                            </div>
                          )}
                          {isConfirmed && (
                            <div style={{ marginTop: 6, fontSize: 11, color: "#34d399" }}>
                              Asset impostato in FERMO alla conferma del piano.
                            </div>
                          )}
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
            )}

            {/* Global Warnings */}
            {planData?.global_warnings && planData.global_warnings.length > 0 && (
              <div style={{
                background: "rgba(251,191,36,0.06)", border: "1px solid rgba(251,191,36,0.2)",
                borderRadius: 12, padding: "16px 20px",
              }}>
                <div style={{ fontSize: 11, fontWeight: 700, color: "#fbbf24", textTransform: "uppercase", letterSpacing: "0.1em", marginBottom: 10, display: "flex", alignItems: "center", gap: 6 }}>
                  <IconWarning size={14} />
                  Warning Globali del Piano
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                  {planData.global_warnings.map((w, i) => (
                    <div key={i} style={{ fontSize: 12, color: "var(--text-secondary)", display: "flex", alignItems: "flex-start", gap: 8 }}>
                      <span style={{ color: "#fbbf24", marginTop: 1 }}>•</span>
                      {w}
                    </div>
                  ))}
                </div>
              </div>
            )}

          </div>
        )}
      </div>
    </div>
  );
}
