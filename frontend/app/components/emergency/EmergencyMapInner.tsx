"use client";

import { useEffect, useRef } from "react";
import { MapContainer, TileLayer, Marker, Popup, Polyline, useMap } from "react-leaflet";
import L from "leaflet";

// Fix icone marker Leaflet con webpack/Next.js
// eslint-disable-next-line @typescript-eslint/no-explicit-any
delete (L.Icon.Default.prototype as any)._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png",
  iconUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png",
  shadowUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png",
});

// Marker rosso pulsante per l'emergenza
const emergenzaIcon = L.divIcon({
  className: "",
  html: `<div style="
    width: 24px; height: 24px;
    background: #ef4444;
    border: 3px solid #fff;
    border-radius: 50%;
    box-shadow: 0 0 0 3px rgba(239,68,68,0.4), 0 2px 8px rgba(0,0,0,0.4);
    animation: pulse-red 1.5s infinite;
  "></div>
  <style>
    @keyframes pulse-red {
      0%, 100% { box-shadow: 0 0 0 3px rgba(239,68,68,0.4), 0 2px 8px rgba(0,0,0,0.4); }
      50% { box-shadow: 0 0 0 8px rgba(239,68,68,0.1), 0 2px 8px rgba(0,0,0,0.4); }
    }
  </style>`,
  iconSize: [24, 24],
  iconAnchor: [12, 12],
  popupAnchor: [0, -14],
});

function tecnicoIcon(index: number, active: boolean) {
  const colors = ["#22c55e", "#fbbf24", "#f97316", "#94a3b8", "#a78bfa"];
  const color = colors[Math.min(index, colors.length - 1)];
  const size = active ? 28 : 20;
  const border = active ? "3px solid #fff" : "2px solid rgba(255,255,255,0.5)";
  return L.divIcon({
    className: "",
    html: `<div style="
      width: ${size}px; height: ${size}px;
      background: ${color};
      border: ${border};
      border-radius: 50%;
      box-shadow: 0 2px 8px rgba(0,0,0,0.4);
      display: flex; align-items: center; justify-content: center;
      font-size: ${active ? 13 : 10}px; font-weight: 700; color: #fff;
      transition: all 0.2s;
    ">${index + 1}</div>`,
    iconSize: [size, size],
    iconAnchor: [size / 2, size / 2],
    popupAnchor: [0, -size / 2 - 2],
  });
}

export interface TecnicoMapData {
  tecnico_id: number;
  nome: string;
  telefono?: string;
  distanza_km: number | null;
  posizione_fonte: "in_lavorazione" | "in_piano" | "sede";
  indirizzo_corrente?: string;
  lat: number | null;
  lon: number | null;
}

export interface EmergenzaMapData {
  ticket_id: number;
  ticket_titolo?: string;
  asset_nome?: string;
  sito: string;
  indirizzo: string;
  lat: number | null;
  lon: number | null;
}

interface MapFitBoundsProps {
  points: [number, number][];
}

function MapFitBounds({ points }: MapFitBoundsProps) {
  const map = useMap();
  useEffect(() => {
    if (points.length === 0) return;
    if (points.length === 1) {
      map.setView(points[0], 13);
      return;
    }
    const bounds = L.latLngBounds(points);
    map.fitBounds(bounds, { padding: [40, 40] });
  }, [map, points]);
  return null;
}

interface EmergencyMapInnerProps {
  emergenza: EmergenzaMapData;
  tecnici: TecnicoMapData[];
  activeTecnicoId?: number | null;
  onTecnicoClick?: (id: number) => void;
}

const POLYLINE_COLORS = ["#22c55e", "#fbbf24", "#f97316"];

export default function EmergencyMapInner({
  emergenza,
  tecnici,
  activeTecnicoId,
  onTecnicoClick,
}: EmergencyMapInnerProps) {
  // Raccoglie tutti i punti validi per il fit dei bounds
  const points: [number, number][] = [];
  if (emergenza.lat !== null && emergenza.lon !== null) {
    points.push([emergenza.lat, emergenza.lon]);
  }
  tecnici.forEach((t) => {
    if (t.lat !== null && t.lon !== null) points.push([t.lat, t.lon]);
  });

  const defaultCenter: [number, number] = points.length > 0 ? points[0] : [41.9028, 12.4964]; // Roma

  return (
    <MapContainer
      center={defaultCenter}
      zoom={12}
      style={{ width: "100%", height: "100%", borderRadius: "10px", minHeight: "300px" }}
      scrollWheelZoom={true}
    >
      <TileLayer
        url="https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png"
        attribution="&copy; <a href='https://www.openstreetmap.org/copyright'>OpenStreetMap</a> contributors &copy; <a href='https://carto.com/attributions'>CARTO</a>"
        subdomains="abcd"
        maxZoom={19}
      />

      <MapFitBounds points={points} />

      {/* Marker emergenza */}
      {emergenza.lat !== null && emergenza.lon !== null && (
        <Marker position={[emergenza.lat, emergenza.lon]} icon={emergenzaIcon}>
          <Popup>
            <div style={{ minWidth: "160px" }}>
              <div style={{ fontWeight: 700, color: "#ef4444", marginBottom: "4px" }}>EMERGENZA</div>
              <div style={{ fontSize: "13px", fontWeight: 600 }}>{emergenza.sito}</div>
              {emergenza.asset_nome && <div style={{ fontSize: "11px", color: "#6b7280" }}>{emergenza.asset_nome}</div>}
              {emergenza.indirizzo && <div style={{ fontSize: "11px", color: "#6b7280", marginTop: "2px" }}>{emergenza.indirizzo}</div>}
            </div>
          </Popup>
        </Marker>
      )}

      {/* Marker tecnici + polyline verso emergenza (solo top-3) */}
      {tecnici.map((tec, idx) => {
        if (tec.lat === null || tec.lon === null) return null;
        const active = tec.tecnico_id === activeTecnicoId;
        const isTop3 = idx < 3;
        const polyColor = POLYLINE_COLORS[idx] ?? "#94a3b8";

        return (
          <div key={tec.tecnico_id}>
            {/* Polyline tratteggiata verso emergenza (solo top-3 con coords note) */}
            {isTop3 && emergenza.lat !== null && emergenza.lon !== null && (
              <Polyline
                positions={[
                  [tec.lat, tec.lon],
                  [emergenza.lat, emergenza.lon],
                ]}
                pathOptions={{
                  color: polyColor,
                  weight: 2,
                  dashArray: "6, 6",
                  opacity: 0.7,
                }}
              />
            )}
            <Marker
              position={[tec.lat, tec.lon]}
              icon={tecnicoIcon(idx, active)}
              eventHandlers={{
                click: () => onTecnicoClick && onTecnicoClick(tec.tecnico_id),
              }}
            >
              <Popup>
                <div style={{ minWidth: "140px" }}>
                  <div style={{ fontWeight: 700, marginBottom: "2px" }}>{tec.nome}</div>
                  {tec.distanza_km !== null && (
                    <div style={{ fontSize: "12px", color: "#2563eb", fontWeight: 600 }}>
                      {tec.distanza_km} km
                    </div>
                  )}
                  {tec.telefono && (
                    <div style={{ fontSize: "11px", color: "#6b7280", marginTop: "2px" }}>
                      Tel: {tec.telefono}
                    </div>
                  )}
                  {tec.indirizzo_corrente && (
                    <div style={{ fontSize: "11px", color: "#6b7280", marginTop: "2px" }}>
                      {tec.indirizzo_corrente}
                    </div>
                  )}
                </div>
              </Popup>
            </Marker>
          </div>
        );
      })}
    </MapContainer>
  );
}
