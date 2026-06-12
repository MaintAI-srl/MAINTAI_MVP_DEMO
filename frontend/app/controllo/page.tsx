"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import dynamic from "next/dynamic";
import { apiGet } from "../lib/api";
import { notify } from "@/lib/toast";
import GoogleControlMap from "./components/GoogleControlMap";
import type { ControlCenterData, SitoOverview } from "./types";
import { STATUS_COLORS, STATUS_LABELS } from "./types";

const GMAPS_KEY = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY || "";

// Fallback OpenStreetMap (Leaflet è solo client-side)
const LeafletControlMap = dynamic(() => import("./components/LeafletControlMap"), {
  ssr: false,
  loading: () => (
    <div style={{
      height: "100%", minHeight: 300, display: "flex", alignItems: "center", justifyContent: "center",
      background: "var(--surface-2)", borderRadius: 10, color: "var(--text-muted)", fontSize: 13,
    }}>
      Caricamento mappa...
    </div>
  ),
});

const REFRESH_MS = 60_000;

const STATUS_ORDER: Record<SitoOverview["status"], number> = { critico: 0, attenzione: 1, ok: 2 };

function KpiTile({ label, value, accent, sub }: { label: string; value: number | string; accent: string; sub?: string }) {
  return (
    <div style={{
      background: "var(--grad-card, var(--bg-card))",
      border: "1px solid var(--border-default)",
      borderLeft: `3px solid ${accent}`,
      borderRadius: 12,
      padding: "14px 18px",
      minWidth: 150,
      flex: "1 1 150px",
    }}>
      <div style={{ fontSize: 9.5, fontWeight: 700, letterSpacing: "0.15em", textTransform: "uppercase", color: "var(--text-muted)", marginBottom: 6 }}>{label}</div>
      <div style={{ fontFamily: "var(--font-display)", fontSize: 28, fontWeight: 800, color: accent, lineHeight: 1 }}>{value}</div>
      {sub && <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 6 }}>{sub}</div>}
    </div>
  );
}

function StatusBadge({ status }: { status: SitoOverview["status"] }) {
  const color = STATUS_COLORS[status];
  return (
    <span style={{
      fontSize: 9.5, fontWeight: 800, textTransform: "uppercase", letterSpacing: ".08em",
      color, background: `${color}18`, border: `1px solid ${color}44`,
      borderRadius: 999, padding: "2px 9px", whiteSpace: "nowrap",
    }}>
      {STATUS_LABELS[status]}
    </span>
  );
}

export default function ControlCenterPage() {
  const [data, setData] = useState<ControlCenterData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedSitoId, setSelectedSitoId] = useState<number | null>(null);
  const [lastUpdate, setLastUpdate] = useState<Date | null>(null);

  const load = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    try {
      const d = await apiGet<ControlCenterData>("/control-center/overview");
      setData(d);
      setError(null);
      setLastUpdate(new Date());
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Errore caricamento Centro di Controllo";
      setError(msg);
      if (!silent) notify.error(msg);
    } finally {
      if (!silent) setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
    const interval = setInterval(() => load(true), REFRESH_MS);
    const onFocus = () => load(true);
    window.addEventListener("focus", onFocus);
    return () => {
      clearInterval(interval);
      window.removeEventListener("focus", onFocus);
    };
  }, [load]);

  const sitiOrdinati = useMemo(() => {
    if (!data) return [];
    return [...data.siti].sort(
      (a, b) => STATUS_ORDER[a.status] - STATUS_ORDER[b.status] || a.nome.localeCompare(b.nome)
    );
  }, [data]);

  const sitiMappabili = useMemo(
    () => (data ? data.siti.filter((s) => s.lat !== null && s.lon !== null) : []),
    [data]
  );

  const summary = data?.summary;

  return (
    <div style={{ display: "flex", flexDirection: "column", paddingBottom: 40 }}>
      {/* ── HERO ── */}
      <div style={{
        position: "relative", overflow: "hidden",
        background: "linear-gradient(135deg, rgba(91,143,255,0.08) 0%, rgba(139,92,246,0.05) 50%, transparent 100%)",
        borderBottom: "1px solid rgba(91,143,255,0.12)",
        padding: "32px 32px 24px",
        marginBottom: 24,
      }}>
        <div style={{ position: "absolute", inset: 0, backgroundImage: "linear-gradient(rgba(91,143,255,0.04) 1px, transparent 1px), linear-gradient(90deg, rgba(91,143,255,0.04) 1px, transparent 1px)", backgroundSize: "32px 32px", pointerEvents: "none" }} />
        <div style={{ position: "relative", display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 16, flexWrap: "wrap" }}>
          <div>
            <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: "0.2em", textTransform: "uppercase", color: "#5b8fff", marginBottom: 8 }}>Supervisione</div>
            <h1 style={{ margin: 0, fontSize: 30, fontWeight: 900, fontFamily: "var(--font-display)", background: "linear-gradient(135deg, #e2e8f0 0%, #5b8fff 100%)", WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent", lineHeight: 1.1 }}>
              Centro di Controllo
            </h1>
            <p style={{ margin: "8px 0 0", color: "var(--text-muted)", fontSize: 13 }}>
              Vista geografica in tempo reale dei siti: stato asset, work order attivi e criticità.
            </p>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            {lastUpdate && (
              <span style={{ fontSize: 11, color: "var(--text-muted)" }}>
                Aggiornato {lastUpdate.toLocaleTimeString("it-IT")}
              </span>
            )}
            <button
              onClick={() => load()}
              title="Aggiorna dati"
              style={{
                width: 34, height: 34, borderRadius: 9, cursor: "pointer",
                border: "1px solid var(--border-default)", background: "var(--surface-2)",
                color: "var(--text-secondary)", fontSize: 15, fontWeight: 700,
              }}
            >
              ↻
            </button>
          </div>
        </div>

        {/* KPI strip */}
        {summary && (
          <div style={{ position: "relative", display: "flex", gap: 12, marginTop: 20, flexWrap: "wrap" }}>
            <KpiTile label="Siti monitorati" value={summary.n_siti} accent="#5b8fff" sub={`${summary.siti_critici} in stato critico`} />
            <KpiTile label="Asset totali" value={summary.assets} accent="#10d9b0" sub={`${summary.asset_stati.service} operativi · ${summary.asset_stati.stopped} fermi`} />
            <KpiTile label="Asset guasti" value={summary.asset_stati.out_of_service} accent="#ef4444" sub="Fuori servizio adesso" />
            <KpiTile label="WO attivi" value={summary.ticket_aperti + summary.ticket_in_corso} accent="#f59e0b" sub={`${summary.ticket_pianificati} pianificati`} />
            <KpiTile label="Breakdown attivi" value={summary.bd_attivi} accent="#ef4444" sub="BD aperti o in corso" />
            <KpiTile label="Tecnici disponibili" value={`${summary.tecnici_disponibili}/${summary.tecnici}`} accent="#10d9b0" sub="In servizio oggi" />
          </div>
        )}
      </div>

      {error && (
        <div style={{ color: "#fbbf24", background: "rgba(251,191,36,.08)", border: "1px solid rgba(251,191,36,.3)", padding: "12px 16px", borderRadius: 8, fontSize: 13, margin: "0 32px 20px" }}>
          ⚠️ {error}
        </div>
      )}

      {loading && !data && (
        <div style={{ color: "var(--text-muted)", textAlign: "center", padding: "60px 0", fontSize: 13 }}>
          Caricamento Centro di Controllo...
        </div>
      )}

      {data && (
        <div style={{ display: "grid", gridTemplateColumns: "340px 1fr", gap: 18, alignItems: "stretch", padding: "0 32px" }}>
          {/* ── Lista siti ── */}
          <div style={{
            background: "var(--bg-card, var(--surface-2))", border: "1px solid var(--border-default)",
            borderRadius: 14, padding: "16px 14px", maxHeight: 640, overflowY: "auto",
          }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12, padding: "0 4px" }}>
              <h2 style={{ margin: 0, fontSize: 13, fontWeight: 800, color: "var(--text-primary)" }}>Siti</h2>
              <span style={{ fontSize: 11, background: "rgba(91,143,255,0.12)", color: "#5b8fff", border: "1px solid rgba(91,143,255,0.25)", borderRadius: 20, padding: "2px 10px", fontWeight: 700 }}>
                {data.siti.length}
              </span>
            </div>

            {data.siti.length === 0 && (
              <div style={{ color: "var(--text-muted)", textAlign: "center", padding: "32px 8px", fontSize: 13 }}>
                Nessun sito registrato. Crea i siti da <strong>Siti &amp; Asset</strong> per popolare la mappa.
              </div>
            )}

            {sitiOrdinati.map((sito) => {
              const active = sito.sito_id === selectedSitoId;
              const color = STATUS_COLORS[sito.status];
              const senzaPosizione = sito.lat === null || sito.lon === null;
              return (
                <div
                  key={sito.sito_id}
                  onClick={() => setSelectedSitoId(active ? null : sito.sito_id)}
                  style={{
                    background: active ? `${color}10` : "var(--surface-2)",
                    border: active ? `1px solid ${color}55` : "1px solid var(--border-default)",
                    borderLeft: `3px solid ${color}`,
                    borderRadius: 10, padding: "11px 12px", marginBottom: 8, cursor: "pointer",
                    transition: "all 0.15s",
                  }}
                >
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, marginBottom: 4 }}>
                    <div style={{ fontWeight: 700, fontSize: 13, color: "var(--text-primary)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{sito.nome}</div>
                    <StatusBadge status={sito.status} />
                  </div>
                  <div style={{ fontSize: 11, color: "var(--text-muted)", marginBottom: 6 }}>
                    {sito.citta || sito.indirizzo || "Posizione non specificata"}
                    {senzaPosizione && <span style={{ color: "#fbbf24" }}> · 📍 non localizzato</span>}
                  </div>
                  <div style={{ display: "flex", gap: 10, fontSize: 11, color: "var(--text-secondary)", flexWrap: "wrap" }}>
                    <span>🏭 {sito.n_asset} asset</span>
                    {sito.asset_stati.out_of_service > 0 && <span style={{ color: "#ef4444", fontWeight: 700 }}>⚙ {sito.asset_stati.out_of_service} guasti</span>}
                    {(sito.ticket.aperti + sito.ticket.in_corso) > 0 && <span style={{ color: "#f59e0b", fontWeight: 700 }}>🎫 {sito.ticket.aperti + sito.ticket.in_corso} WO attivi</span>}
                    {sito.ticket.bd_attivi > 0 && <span style={{ color: "#ef4444", fontWeight: 700 }}>⚠ {sito.ticket.bd_attivi} BD</span>}
                  </div>
                </div>
              );
            })}
          </div>

          {/* ── Mappa ── */}
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
              <div style={{ display: "flex", gap: 14, fontSize: 11, color: "var(--text-muted)", alignItems: "center", flexWrap: "wrap" }}>
                {(["ok", "attenzione", "critico"] as const).map((s) => (
                  <span key={s} style={{ display: "inline-flex", alignItems: "center", gap: 5 }}>
                    <span style={{ width: 9, height: 9, borderRadius: "50%", background: STATUS_COLORS[s], display: "inline-block" }} />
                    {STATUS_LABELS[s]}
                  </span>
                ))}
                <span style={{ display: "inline-flex", alignItems: "center", gap: 5 }}>
                  <span style={{ width: 7, height: 7, borderRadius: "50%", background: "#5b8fff", display: "inline-block" }} />
                  Impianto
                </span>
              </div>
              {!GMAPS_KEY && (
                <span style={{ fontSize: 11, color: "#fbbf24", background: "rgba(251,191,36,.08)", border: "1px solid rgba(251,191,36,.3)", borderRadius: 8, padding: "3px 10px" }}>
                  Mappa OpenStreetMap — imposta NEXT_PUBLIC_GOOGLE_MAPS_API_KEY per Google Maps
                </span>
              )}
            </div>

            <div style={{ height: 600, borderRadius: 12, overflow: "hidden", border: "1px solid var(--border-default)", background: "var(--surface-2)" }}>
              {sitiMappabili.length === 0 && data.impianti.length === 0 ? (
                <div style={{ height: "100%", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 8, padding: 24, textAlign: "center" }}>
                  <div style={{ fontSize: 28 }}>🗺️</div>
                  <div style={{ fontSize: 13, fontWeight: 700, color: "var(--text-primary)" }}>Nessuna posizione disponibile</div>
                  <div style={{ fontSize: 12, color: "var(--text-muted)", maxWidth: 380 }}>
                    Aggiungi le coordinate agli impianti oppure compila ubicazione e città dei siti:
                    il Centro di Controllo li geolocalizza automaticamente.
                  </div>
                </div>
              ) : GMAPS_KEY ? (
                <GoogleControlMap
                  apiKey={GMAPS_KEY}
                  siti={sitiMappabili}
                  impianti={data.impianti}
                  selectedSitoId={selectedSitoId}
                  onSelectSito={setSelectedSitoId}
                />
              ) : (
                <LeafletControlMap
                  siti={sitiMappabili}
                  impianti={data.impianti}
                  selectedSitoId={selectedSitoId}
                  onSelectSito={setSelectedSitoId}
                />
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
