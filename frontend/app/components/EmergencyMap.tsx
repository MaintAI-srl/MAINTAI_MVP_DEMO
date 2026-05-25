"use client";

import { useEffect, useState } from "react";
import dynamic from "next/dynamic";
import { API_BASE } from "../lib/api";
import { notify } from "@/lib/toast";
import type { TecnicoMapData, EmergenzaMapData } from "./emergency/EmergencyMapInner";

// Import dinamico SSR-safe del componente mappa (usa Leaflet, solo client)
const EmergencyMapInner = dynamic(
  () => import("./emergency/EmergencyMapInner"),
  {
    ssr: false,
    loading: () => (
      <div style={{
        height: "100%",
        minHeight: "300px",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: "#111827",
        borderRadius: "10px",
        color: "#6b7280",
        fontSize: "13px",
      }}>
        Caricamento mappa...
      </div>
    ),
  }
);

interface EmergencyResponse {
  emergenza: EmergenzaMapData;
  tecnici_consigliati: TecnicoMapData[];
  tutti_tecnici: TecnicoMapData[];
}

interface EmergencyMapProps {
  ticketId: number;
  onAssign?: (tecnicoId: number) => void;
}

function fonteBadge(fonte: string) {
  switch (fonte) {
    case "in_lavorazione":
      return { label: "In lavorazione", color: "#ef4444", bg: "rgba(239,68,68,0.12)" };
    case "in_piano":
      return { label: "In piano oggi", color: "#fbbf24", bg: "rgba(251,191,36,0.12)" };
    default:
      return { label: "Sede", color: "#22c55e", bg: "rgba(34,197,94,0.12)" };
  }
}

const TOP3_COLORS = ["#22c55e", "#fbbf24", "#f97316"];

export default function EmergencyMap({ ticketId, onAssign }: EmergencyMapProps) {
  const [data, setData] = useState<EmergencyResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeTecnicoId, setActiveTecnicoId] = useState<number | null>(null);

  useEffect(() => {
    if (!ticketId) return;
    setLoading(true);
    setError(null);

    const token = typeof window !== "undefined" ? localStorage.getItem("maintai_jwt") : null;
    const headers: Record<string, string> = {};
    if (token) headers["Authorization"] = `Bearer ${token}`;

    fetch(`${API_BASE}/emergency/nearest-technicians/${ticketId}`, {
      credentials: "include",
      headers,
    })
      .then(async (r) => {
        if (!r.ok) {
          const err = await r.json().catch(() => ({}));
          throw new Error(err?.detail ?? `Errore ${r.status}`);
        }
        return r.json() as Promise<EmergencyResponse>;
      })
      .then((d) => setData(d))
      .catch((err: unknown) => {
        const msg = err instanceof Error ? err.message : "Errore caricamento mappa";
        setError(msg);
      })
      .finally(() => setLoading(false));
  }, [ticketId]);

  if (loading) {
    return (
      <div style={{
        background: "#111827",
        border: "1px solid rgba(239,68,68,0.3)",
        borderRadius: "12px",
        padding: "24px",
        textAlign: "center",
        color: "#6b7280",
        fontSize: "13px",
      }}>
        Localizzazione tecnici in corso...
        <div style={{ fontSize: "11px", marginTop: "4px", opacity: 0.6 }}>
          Il sistema sta geocodificando le posizioni via OpenStreetMap
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div style={{
        background: "#1c0a0a",
        border: "1px solid rgba(239,68,68,0.4)",
        borderRadius: "12px",
        padding: "20px",
        color: "#f87171",
        fontSize: "13px",
      }}>
        <div style={{ fontWeight: 700, marginBottom: "4px" }}>Impossibile caricare la mappa</div>
        <div style={{ opacity: 0.8 }}>{error}</div>
      </div>
    );
  }

  if (!data) return null;

  const { emergenza, tecnici_consigliati, tutti_tecnici } = data;
  const hasCoordsEmergenza = emergenza.lat !== null && emergenza.lon !== null;

  return (
    <div style={{ marginTop: "16px" }}>
      {/* Header emergenza */}
      <div style={{
        background: "rgba(239,68,68,0.08)",
        border: "1px solid rgba(239,68,68,0.35)",
        borderRadius: "10px",
        padding: "12px 16px",
        marginBottom: "16px",
        display: "flex",
        alignItems: "center",
        gap: "12px",
      }}>
        <div style={{ width: "12px", height: "12px", background: "#ef4444", borderRadius: "50%", flexShrink: 0, boxShadow: "0 0 8px rgba(239,68,68,0.6)" }} />
        <div>
          <div style={{ fontWeight: 700, fontSize: "13px", color: "#f87171" }}>EMERGENZA — {emergenza.sito || "Sito non specificato"}</div>
          {emergenza.asset_nome && (
            <div style={{ fontSize: "11px", color: "#94a3b8", marginTop: "2px" }}>
              Asset: {emergenza.asset_nome}
            </div>
          )}
          {emergenza.indirizzo && (
            <div style={{ fontSize: "11px", color: "#6b7280", marginTop: "1px" }}>{emergenza.indirizzo}</div>
          )}
          {!hasCoordsEmergenza && (
            <div style={{ fontSize: "11px", color: "#fbbf24", marginTop: "4px" }}>
              Geocoding non disponibile — configura l&apos;indirizzo del sito per la visualizzazione sulla mappa
            </div>
          )}
        </div>
      </div>

      {/* Layout griglia: lista sinistra + mappa destra */}
      <div style={{
        display: "grid",
        gridTemplateColumns: "320px 1fr",
        gap: "16px",
        alignItems: "start",
      }}>
        {/* Colonna sinistra: tecnici consigliati */}
        <div>
          <div style={{ fontSize: "11px", fontWeight: 700, color: "#6b7280", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: "10px" }}>
            Tecnici pi&ugrave; vicini
          </div>

          {tecnici_consigliati.length === 0 && (
            <div style={{ color: "#6b7280", fontSize: "13px", padding: "16px 0" }}>
              Nessun tecnico disponibile trovato.
            </div>
          )}

          {tecnici_consigliati.map((tec, idx) => {
            const badge = fonteBadge(tec.posizione_fonte);
            const rankColor = TOP3_COLORS[idx] ?? "#94a3b8";
            const isActive = tec.tecnico_id === activeTecnicoId;

            return (
              <div
                key={tec.tecnico_id}
                onClick={() => setActiveTecnicoId(isActive ? null : tec.tecnico_id)}
                style={{
                  background: isActive ? "rgba(34,197,94,0.08)" : "#111827",
                  border: isActive ? `1px solid ${rankColor}55` : "1px solid #1f2937",
                  borderLeft: `3px solid ${rankColor}`,
                  borderRadius: "8px",
                  padding: "12px 14px",
                  marginBottom: "8px",
                  cursor: "pointer",
                  transition: "all 0.15s",
                }}
              >
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "6px" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                    <div style={{ width: "22px", height: "22px", background: rankColor, borderRadius: "50%", display: "flex", alignItems: "center", justifyContent: "center", fontSize: "11px", fontWeight: 700, color: "#fff", flexShrink: 0 }}>
                      {idx + 1}
                    </div>
                    <div style={{ fontWeight: 600, fontSize: "13px" }}>{tec.nome}</div>
                  </div>
                  {tec.distanza_km !== null && (
                    <div style={{ fontSize: "12px", fontWeight: 700, color: rankColor }}>
                      {tec.distanza_km} km
                    </div>
                  )}
                  {tec.distanza_km === null && (
                    <div style={{ fontSize: "11px", color: "#4b5563" }}>dist. N/D</div>
                  )}
                </div>

                <div style={{ display: "flex", gap: "6px", flexWrap: "wrap", alignItems: "center" }}>
                  <span style={{
                    fontSize: "10px", fontWeight: 700, padding: "2px 7px",
                    background: badge.bg, color: badge.color,
                    border: `1px solid ${badge.color}44`,
                    borderRadius: "999px",
                  }}>
                    {badge.label}
                  </span>
                  {tec.telefono && (
                    <a
                      href={`tel:${tec.telefono}`}
                      onClick={(e) => e.stopPropagation()}
                      style={{ fontSize: "11px", color: "#60a5fa", textDecoration: "none" }}
                    >
                      {tec.telefono}
                    </a>
                  )}
                </div>

                {tec.indirizzo_corrente && (
                  <div style={{ fontSize: "10px", color: "#4b5563", marginTop: "4px" }}>
                    {tec.indirizzo_corrente}
                  </div>
                )}

                {onAssign && (
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      onAssign(tec.tecnico_id);
                      notify.success(`${tec.nome} assegnato al ticket`);
                    }}
                    style={{
                      marginTop: "8px",
                      width: "100%",
                      padding: "6px 0",
                      background: `${rankColor}22`,
                      border: `1px solid ${rankColor}55`,
                      color: rankColor,
                      borderRadius: "6px",
                      cursor: "pointer",
                      fontSize: "11px",
                      fontWeight: 700,
                    }}
                  >
                    Assegna questo tecnico
                  </button>
                )}
              </div>
            );
          })}

          {/* Altri tecnici (collapsible) */}
          {tutti_tecnici.length > 3 && (
            <details style={{ marginTop: "8px" }}>
              <summary style={{ cursor: "pointer", fontSize: "12px", color: "#6b7280", padding: "6px 0" }}>
                Altri {tutti_tecnici.length - 3} tecnici disponibili
              </summary>
              <div style={{ marginTop: "8px" }}>
                {tutti_tecnici.slice(3).map((tec) => {
                  const badge = fonteBadge(tec.posizione_fonte);
                  return (
                    <div
                      key={tec.tecnico_id}
                      onClick={() => setActiveTecnicoId(tec.tecnico_id === activeTecnicoId ? null : tec.tecnico_id)}
                      style={{
                        background: "#111827",
                        border: "1px solid #1f2937",
                        borderRadius: "6px",
                        padding: "10px 12px",
                        marginBottom: "6px",
                        cursor: "pointer",
                        display: "flex",
                        justifyContent: "space-between",
                        alignItems: "center",
                      }}
                    >
                      <div>
                        <div style={{ fontSize: "12px", fontWeight: 600 }}>{tec.nome}</div>
                        <span style={{
                          fontSize: "10px", fontWeight: 700, padding: "1px 6px",
                          background: badge.bg, color: badge.color,
                          borderRadius: "999px",
                        }}>
                          {badge.label}
                        </span>
                      </div>
                      {tec.distanza_km !== null && (
                        <div style={{ fontSize: "12px", color: "#94a3b8" }}>{tec.distanza_km} km</div>
                      )}
                    </div>
                  );
                })}
              </div>
            </details>
          )}
        </div>

        {/* Colonna destra: mappa */}
        <div style={{ height: "420px", borderRadius: "10px", overflow: "hidden", border: "1px solid #1f2937" }}>
          <EmergencyMapInner
            emergenza={emergenza}
            tecnici={tutti_tecnici}
            activeTecnicoId={activeTecnicoId}
            onTecnicoClick={(id) => setActiveTecnicoId(id === activeTecnicoId ? null : id)}
          />
        </div>
      </div>
    </div>
  );
}
