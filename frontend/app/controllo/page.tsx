"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import dynamic from "next/dynamic";
import { apiGet, apiPost } from "../lib/api";
import { notify } from "@/lib/toast";
import GoogleControlMap from "./components/GoogleControlMap";
import { controlCenterTechnicianPlace, controlCenterTicketPlace, resolvePlaceLatLon } from "./geo";
import type { ControlCenterBDTicket, ControlCenterData, ControlCenterRouteTecnico, SitoOverview } from "./types";
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

type TicketListItem = {
  id: number;
  titolo?: string | null;
  descrizione?: string | null;
  priorita?: string | null;
  stato?: string | null;
  tipo?: string | null;
  asset_id?: number | null;
  asset_name?: string | null;
  impianto_name?: string | null;
  sito_name?: string | null;
  tecnico_id?: number | null;
  created_at?: string | null;
};

type NearestTechniciansResponse = {
  tecnici_consigliati: ControlCenterRouteTecnico[];
  tutti_tecnici: ControlCenterRouteTecnico[];
};

type RoadRouteInfo = {
  tecnico_id: number;
  distanza_km: number;
  durata_min: number;
};

type OsrmRouteResponse = {
  routes?: Array<{
    distance?: number;
    duration?: number;
  }>;
};

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

function priorityColor(priority: string, tipo: string) {
  if (priority?.toLowerCase() === "emergenza") return "#ef4444";
  if (tipo?.toUpperCase() === "BD") return "#f97316";
  return "#f59e0b";
}

function formatTicketTime(value: string | null) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleString("it-IT", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
}

function formatRoadRoute(route?: RoadRouteInfo) {
  if (!route) return "Percorso stradale sulla mappa";
  return `${route.distanza_km.toFixed(1)} km strada - ${Math.max(1, Math.round(route.durata_min))} min`;
}

function ticketToBDTicket(ticket: TicketListItem): ControlCenterBDTicket | null {
  const tipo = (ticket.tipo || "").trim().toUpperCase();
  const priorita = (ticket.priorita || "").trim().toLowerCase();
  const stato = ticket.stato || "";
  const isActive = ["Aperto", "In corso", "Pianificato"].includes(stato);
  if (!isActive || (tipo !== "BD" && priorita !== "emergenza")) return null;
  return {
    ticket_id: ticket.id,
    titolo: ticket.titolo || `Ticket #${ticket.id}`,
    descrizione: ticket.descrizione || "",
    priorita: ticket.priorita || "",
    stato,
    tipo: ticket.tipo || "",
    asset_id: ticket.asset_id ?? null,
    asset_nome: ticket.asset_name || "",
    impianto_id: null,
    impianto_nome: ticket.impianto_name || "",
    sito_id: null,
    sito_nome: ticket.sito_name || "",
    indirizzo: "",
    tecnico_id: ticket.tecnico_id ?? null,
    lat: null,
    lon: null,
    posizione_fonte: null,
    created_at: ticket.created_at || null,
  };
}

export default function ControlCenterPage() {
  const [data, setData] = useState<ControlCenterData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedSitoId, setSelectedSitoId] = useState<number | null>(null);
  const [selectedBD, setSelectedBD] = useState<ControlCenterBDTicket | null>(null);
  const [nearestTecnici, setNearestTecnici] = useState<ControlCenterRouteTecnico[]>([]);
  const [nearestLoading, setNearestLoading] = useState(false);
  const [nearestError, setNearestError] = useState<string | null>(null);
  const [roadRoutes, setRoadRoutes] = useState<Record<number, RoadRouteInfo>>({});
  const [roadRoutesLoading, setRoadRoutesLoading] = useState(false);
  const [lastUpdate, setLastUpdate] = useState<Date | null>(null);

  const load = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    try {
      const d = await apiGet<ControlCenterData>("/control-center/overview");
      let nextData = d;
      if (!Array.isArray(d.bd_tickets) || d.bd_tickets.length === 0) {
        const tickets = await apiGet<{ items?: TicketListItem[] }>("/tickets?stato=Aperto,In corso,Pianificato&limit=500")
          .catch(() => ({ items: [] }));
        const fallbackBD = (tickets.items ?? [])
          .map(ticketToBDTicket)
          .filter((ticket): ticket is ControlCenterBDTicket => ticket !== null);
        if (fallbackBD.length > 0) {
          nextData = {
            ...d,
            bd_tickets: fallbackBD,
            summary: {
              ...d.summary,
              bd_attivi: d.summary.bd_attivi || fallbackBD.filter((t) => t.tipo?.trim().toUpperCase() === "BD").length,
              emergenze_attive: d.summary.emergenze_attive || fallbackBD.filter((t) => t.priorita?.trim().toLowerCase() === "emergenza").length,
            },
          };
        }
      }
      setData(nextData);
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
  const bdTickets = data?.bd_tickets ?? [];
  const hasEmergencyMapPoints = bdTickets.some((ticket) => ticket.lat !== null && ticket.lon !== null);

  const selectEmergency = useCallback((ticket: ControlCenterBDTicket) => {
    setSelectedBD(ticket);
    if (ticket.sito_id) setSelectedSitoId(ticket.sito_id);
  }, []);

  useEffect(() => {
    if (!selectedBD) {
      setNearestTecnici([]);
      setNearestError(null);
      setNearestLoading(false);
      setRoadRoutes({});
      setRoadRoutesLoading(false);
      return;
    }
    let cancelled = false;
    setNearestLoading(true);
    setNearestError(null);
    apiGet<NearestTechniciansResponse>(`/emergency/nearest-technicians/${selectedBD.ticket_id}`)
      .then((res) => {
        if (!cancelled) setNearestTecnici(res.tecnici_consigliati ?? []);
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setNearestTecnici([]);
          setNearestError(err instanceof Error ? err.message : "Errore calcolo tecnici vicini");
        }
      })
      .finally(() => {
        if (!cancelled) setNearestLoading(false);
      });
    return () => { cancelled = true; };
  }, [selectedBD]);

  useEffect(() => {
    const tecniciMappabili = nearestTecnici
      .slice(0, 3)
      .filter((tec) => (tec.lat !== null && tec.lon !== null) || Boolean(controlCenterTechnicianPlace(tec)));

    if (!selectedBD || (!controlCenterTicketPlace(selectedBD) && (selectedBD.lat === null || selectedBD.lon === null)) || tecniciMappabili.length === 0) {
      setRoadRoutes({});
      setRoadRoutesLoading(false);
      return;
    }

    let cancelled = false;
    setRoadRoutesLoading(true);
    const destinationPromise = resolvePlaceLatLon(
      selectedBD.lat,
      selectedBD.lon,
      controlCenterTicketPlace(selectedBD)
    );

    Promise.all(
      tecniciMappabili.map(async (tec) => {
        const destination = await destinationPromise;
        const origin = await resolvePlaceLatLon(
          tec.lat,
          tec.lon,
          controlCenterTechnicianPlace(tec)
        );
        if (!origin || !destination) return null;
        const response = await fetch(
          `https://router.project-osrm.org/route/v1/driving/${origin.lon},${origin.lat};${destination.lon},${destination.lat}?overview=false`
        );
        if (!response.ok) return null;
        const json = (await response.json()) as OsrmRouteResponse;
        const route = json.routes?.[0];
        if (route?.distance == null || route.duration == null) return null;
        return {
          tecnico_id: tec.tecnico_id,
          distanza_km: route.distance / 1000,
          durata_min: route.duration / 60,
        };
      })
    )
      .then((routes) => {
        if (cancelled) return;
        const next: Record<number, RoadRouteInfo> = {};
        routes.forEach((route) => {
          if (route) next[route.tecnico_id] = route;
        });
        setRoadRoutes(next);
      })
      .catch(() => {
        if (!cancelled) setRoadRoutes({});
      })
      .finally(() => {
        if (!cancelled) setRoadRoutesLoading(false);
      });

    return () => { cancelled = true; };
  }, [nearestTecnici, selectedBD]);

  const handleDispatch = useCallback(async (tecnicoId: number) => {
    if (!selectedBD) return;
    try {
      const res = await apiPost<{ tecnico_nome: string; stato: string }>(
        `/emergency/assign/${selectedBD.ticket_id}`,
        { tecnico_id: tecnicoId }
      );
      notify.success(
        `Ticket assegnato a ${res.tecnico_nome}. Il mobile lo avvisera con allarme sonoro e visivo.`,
        "DISPATCH"
      );
      await load(true);
      setSelectedBD((prev) => prev ? { ...prev, tecnico_id: tecnicoId, stato: res.stato } : prev);
    } catch (err: unknown) {
      notify.error(err instanceof Error ? err.message : "Errore assegnazione tecnico", "DISPATCH");
      throw err;
    }
  }, [load, selectedBD]);

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
            <KpiTile label="Emergenze" value={summary.emergenze_attive ?? 0} accent="#f97316" sub="Priorita massima" />
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
        <div style={{ display: "grid", gridTemplateColumns: "340px 1fr", gap: 18, alignItems: "stretch", padding: "0 32px", order: 2 }}>
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
              {sitiMappabili.length === 0 && data.impianti.length === 0 && !hasEmergencyMapPoints ? (
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
                  emergenze={bdTickets}
                  selectedEmergency={selectedBD}
                  routeTecnici={nearestTecnici}
                  selectedSitoId={selectedSitoId}
                  onSelectSito={setSelectedSitoId}
                  onSelectEmergency={selectEmergency}
                />
              ) : (
                <LeafletControlMap
                  siti={sitiMappabili}
                  impianti={data.impianti}
                  emergenze={bdTickets}
                  selectedEmergency={selectedBD}
                  routeTecnici={nearestTecnici}
                  selectedSitoId={selectedSitoId}
                  onSelectSito={setSelectedSitoId}
                  onSelectEmergency={selectEmergency}
                />
              )}
            </div>
          </div>
        </div>
      )}

      {data && (
        <div style={{ padding: "18px 32px 0", order: 3 }}>
          <div style={{
            background: "linear-gradient(180deg, rgba(239,68,68,0.08), var(--bg-card, var(--surface-2)))",
            border: "1px solid rgba(239,68,68,0.28)",
            borderRadius: 14,
            padding: 16,
          }}>
            <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 14, marginBottom: 12, flexWrap: "wrap" }}>
              <div>
                <h2 style={{ margin: 0, fontSize: 15, fontWeight: 900, color: "var(--text-primary)" }}>
                  BD / Emergenze operative
                </h2>
                <p style={{ margin: "4px 0 0", fontSize: 12, color: "var(--text-muted)" }}>
                  Le urgenze lampeggiano sulla mappa. Clicca una card per calcolare i 3 tecnici piu vicini e mostrare il percorso stradale.
                </p>
              </div>
              <span style={{
                fontSize: 11, color: "#ef4444", background: "rgba(239,68,68,0.12)",
                border: "1px solid rgba(239,68,68,0.35)", borderRadius: 999, padding: "4px 10px", fontWeight: 800,
              }}>
                {bdTickets.length} attivi
              </span>
            </div>

            {bdTickets.length === 0 ? (
              <div style={{ color: "var(--text-muted)", fontSize: 13, padding: "22px 8px", textAlign: "center" }}>
                Nessun breakdown o emergenza attiva.
              </div>
            ) : (
              <div style={{ display: "grid", gridTemplateColumns: selectedBD ? "minmax(280px, 420px) 1fr" : "1fr", gap: 16, alignItems: "start" }}>
                <div style={{
                  display: "grid",
                  gridTemplateColumns: selectedBD ? "1fr" : "repeat(auto-fill, minmax(260px, 1fr))",
                  gap: 10,
                  maxHeight: selectedBD ? 520 : "none",
                  overflowY: selectedBD ? "auto" : "visible",
                }}>
                  {bdTickets.map((ticket) => {
                    const active = selectedBD?.ticket_id === ticket.ticket_id;
                    const color = priorityColor(ticket.priorita, ticket.tipo);
                    return (
                      <button
                        key={ticket.ticket_id}
                        onClick={() => {
                          if (active) {
                            setSelectedBD(null);
                            setNearestTecnici([]);
                          } else {
                            selectEmergency(ticket);
                          }
                        }}
                        style={{
                          textAlign: "left",
                          cursor: "pointer",
                          background: active ? `${color}18` : "var(--surface-2)",
                          border: active ? `1px solid ${color}66` : "1px solid var(--border-default)",
                          borderLeft: `4px solid ${color}`,
                          borderRadius: 10,
                          padding: "12px 13px",
                          color: "var(--text-primary)",
                          transition: "all .15s",
                          minHeight: 116,
                        }}
                      >
                        <div style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "flex-start", marginBottom: 8 }}>
                          <div style={{ minWidth: 0 }}>
                            <div style={{ fontSize: 10, fontWeight: 900, letterSpacing: ".12em", textTransform: "uppercase", color }}>
                              {ticket.priorita?.toLowerCase() === "emergenza" ? "Emergenza" : ticket.tipo || "BD"}
                            </div>
                            <div style={{ fontSize: 14, fontWeight: 800, marginTop: 3, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                              {ticket.titolo || `Ticket #${ticket.ticket_id}`}
                            </div>
                          </div>
                          <span style={{
                            fontSize: 10, fontWeight: 800, color,
                            background: `${color}14`, border: `1px solid ${color}44`,
                            borderRadius: 999, padding: "2px 8px", whiteSpace: "nowrap",
                          }}>
                            {ticket.stato}
                          </span>
                        </div>
                        <div style={{ fontSize: 12, color: "var(--text-secondary)", lineHeight: 1.5 }}>
                          {ticket.asset_nome && <div>{ticket.asset_nome}</div>}
                          <div style={{ color: "var(--text-muted)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                            {ticket.sito_nome || ticket.impianto_nome || "Sito non definito"}
                          </div>
                          <div style={{ color: "var(--text-muted)" }}>
                            {ticket.tecnico_id ? "Tecnico gia assegnato" : "Da assegnare"}
                            {ticket.created_at ? ` - ${formatTicketTime(ticket.created_at)}` : ""}
                          </div>
                        </div>
                      </button>
                    );
                  })}
                </div>

                {selectedBD && (
                  <div style={{
                    background: "rgba(10,15,30,0.45)",
                    border: "1px solid var(--border-default)",
                    borderRadius: 12,
                    padding: 14,
                    minWidth: 0,
                  }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12, marginBottom: 10 }}>
                      <div style={{ minWidth: 0 }}>
                        <div style={{ fontSize: 10, fontWeight: 900, color: "#ef4444", letterSpacing: ".14em", textTransform: "uppercase" }}>
                          Dispatch tecnico
                        </div>
                        <div style={{ fontSize: 16, fontWeight: 900, color: "var(--text-primary)", marginTop: 3, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                          {selectedBD.titolo}
                        </div>
                        {selectedBD.indirizzo && (
                          <div style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 3 }}>{selectedBD.indirizzo}</div>
                        )}
                      </div>
                      {((selectedBD.lat !== null && selectedBD.lon !== null) || Boolean(controlCenterTicketPlace(selectedBD))) && (
                        <span
                          style={{
                            fontSize: 11, color: "#60a5fa", border: "1px solid rgba(96,165,250,.35)",
                            borderRadius: 8, padding: "5px 9px", whiteSpace: "nowrap",
                          }}
                        >
                          Luogo su mappa
                        </span>
                      )}
                    </div>
                    <div style={{ marginTop: 12 }}>
                      {nearestLoading && (
                        <div style={{ color: "var(--text-muted)", fontSize: 13, padding: "18px 0" }}>
                          Calcolo dei tecnici piu vicini...
                        </div>
                      )}
                      {nearestError && (
                        <div style={{
                          color: "#fbbf24",
                          background: "rgba(251,191,36,.08)",
                          border: "1px solid rgba(251,191,36,.3)",
                          borderRadius: 8,
                          padding: "10px 12px",
                          fontSize: 12,
                        }}>
                          {nearestError}
                        </div>
                      )}
                      {!nearestLoading && !nearestError && nearestTecnici.length === 0 && (
                        <div style={{ color: "var(--text-muted)", fontSize: 13, padding: "18px 0" }}>
                          Nessun tecnico disponibile con posizione calcolabile.
                        </div>
                      )}
                      <div style={{ display: "grid", gap: 9 }}>
                        {nearestTecnici.slice(0, 3).map((tec, idx) => {
                          const color = ["#22c55e", "#fbbf24", "#f97316"][idx] ?? "#94a3b8";
                          const hasRoadRoute =
                            ((tec.lat !== null && tec.lon !== null) || Boolean(controlCenterTechnicianPlace(tec))) &&
                            ((selectedBD.lat !== null && selectedBD.lon !== null) || Boolean(controlCenterTicketPlace(selectedBD)));
                          const roadRoute = roadRoutes[tec.tecnico_id];
                          return (
                            <div
                              key={tec.tecnico_id}
                              style={{
                                background: "var(--surface-2)",
                                border: "1px solid var(--border-default)",
                                borderLeft: `4px solid ${color}`,
                                borderRadius: 10,
                                padding: "11px 12px",
                              }}
                            >
                              <div style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "flex-start" }}>
                                <div style={{ minWidth: 0 }}>
                                  <div style={{ fontSize: 12, color, fontWeight: 900 }}>#{idx + 1} piu vicino</div>
                                  <div style={{ fontSize: 14, fontWeight: 800, color: "var(--text-primary)", marginTop: 2 }}>{tec.nome}</div>
                                  <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 2 }}>
                                    {hasRoadRoute
                                      ? (roadRoutesLoading && !roadRoute ? "Calcolo percorso MaintAI..." : roadRoute ? formatRoadRoute(roadRoute) : "Percorso interno non calcolabile")
                                      : "Luogo tecnico o urgenza mancante"}
                                  </div>
                                  {tec.indirizzo_corrente && (
                                    <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                                      {tec.indirizzo_corrente}
                                    </div>
                                  )}
                                </div>
                                <div style={{ display: "flex", gap: 7, flexWrap: "wrap", justifyContent: "flex-end" }}>
                                  {hasRoadRoute && (
                                    <span
                                      style={{
                                        fontSize: 11,
                                        color: "#60a5fa",
                                        border: "1px solid rgba(96,165,250,.35)",
                                        borderRadius: 8,
                                        padding: "6px 9px",
                                        fontWeight: 800,
                                        whiteSpace: "nowrap",
                                      }}
                                    >
                                      Percorso MaintAI
                                    </span>
                                  )}
                                  <button
                                    onClick={() => handleDispatch(tec.tecnico_id)}
                                    style={{
                                      fontSize: 11,
                                      color,
                                      background: `${color}18`,
                                      border: `1px solid ${color}55`,
                                      borderRadius: 8,
                                      padding: "6px 9px",
                                      cursor: "pointer",
                                      fontWeight: 900,
                                      whiteSpace: "nowrap",
                                    }}
                                  >
                                    Assegna
                                  </button>
                                </div>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
