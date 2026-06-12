"use client";

import React, { useEffect } from "react";
import { MapContainer, TileLayer, Marker, Popup, useMap } from "react-leaflet";
import L from "leaflet";
import Link from "next/link";
import type { ImpiantoMarker, SitoOverview } from "../types";
import { STATUS_COLORS, STATUS_LABELS } from "../types";

// Fallback OpenStreetMap del Centro di Controllo: usato quando
// NEXT_PUBLIC_GOOGLE_MAPS_API_KEY non è configurata. Stessi dati e colori
// della mappa Google (verde/ambra/rosso per stato sito).

function sitoIcon(status: SitoOverview["status"], active: boolean) {
  const color = STATUS_COLORS[status];
  const size = active ? 28 : status === "critico" ? 24 : 20;
  return L.divIcon({
    className: "",
    html: `<div style="
      width: ${size}px; height: ${size}px;
      background: ${color};
      border: ${active ? 3 : 2}px solid #fff;
      border-radius: 50%;
      box-shadow: 0 0 0 3px ${color}44, 0 2px 8px rgba(0,0,0,0.4);
    "></div>`,
    iconSize: [size, size],
    iconAnchor: [size / 2, size / 2],
    popupAnchor: [0, -size / 2 - 2],
  });
}

function impiantoIcon(hasGuasti: boolean) {
  const color = hasGuasti ? "#ef4444" : "#5b8fff";
  return L.divIcon({
    className: "",
    html: `<div style="
      width: 10px; height: 10px;
      background: ${color};
      border: 1.5px solid #0a0f1e;
      border-radius: 50%;
      box-shadow: 0 1px 4px rgba(0,0,0,0.4);
    "></div>`,
    iconSize: [10, 10],
    iconAnchor: [5, 5],
    popupAnchor: [0, -7],
  });
}

function MapViewController({ points, selected }: { points: [number, number][]; selected: [number, number] | null }) {
  const map = useMap();
  useEffect(() => {
    if (selected) {
      map.flyTo(selected, 12, { duration: 0.6 });
      return;
    }
    if (points.length === 0) return;
    if (points.length === 1) {
      map.setView(points[0], 11);
      return;
    }
    map.fitBounds(L.latLngBounds(points), { padding: [50, 50] });
  }, [map, points, selected]);
  return null;
}

interface LeafletControlMapProps {
  siti: SitoOverview[];
  impianti: ImpiantoMarker[];
  selectedSitoId: number | null;
  onSelectSito: (id: number | null) => void;
}

export default function LeafletControlMap({ siti, impianti, selectedSitoId, onSelectSito }: LeafletControlMapProps) {
  const points: [number, number][] = [];
  siti.forEach((s) => { if (s.lat !== null && s.lon !== null) points.push([s.lat, s.lon]); });
  impianti.forEach((i) => points.push([i.lat, i.lon]));

  const selectedSito = siti.find((s) => s.sito_id === selectedSitoId);
  const selectedPoint: [number, number] | null =
    selectedSito && selectedSito.lat !== null && selectedSito.lon !== null
      ? [selectedSito.lat, selectedSito.lon]
      : null;

  const defaultCenter: [number, number] = points.length > 0 ? points[0] : [42.5, 12.5]; // Italia

  return (
    <MapContainer
      center={defaultCenter}
      zoom={6}
      style={{ width: "100%", height: "100%", borderRadius: 10, minHeight: 300 }}
      scrollWheelZoom={true}
    >
      <TileLayer
        url="https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png"
        attribution="&copy; <a href='https://www.openstreetmap.org/copyright'>OpenStreetMap</a> contributors &copy; <a href='https://carto.com/attributions'>CARTO</a>"
        subdomains="abcd"
        maxZoom={19}
      />

      <MapViewController points={points} selected={selectedPoint} />

      {impianti.map((imp) => (
        <Marker key={`imp-${imp.impianto_id}`} position={[imp.lat, imp.lon]} icon={impiantoIcon(imp.asset_guasti > 0)}>
          <Popup>
            <div style={{ minWidth: 140 }}>
              <div style={{ fontWeight: 700, fontSize: 13 }}>{imp.nome}</div>
              <div style={{ fontSize: 12, marginTop: 2 }}>
                {imp.n_asset} asset
                {imp.asset_guasti > 0 && <strong style={{ color: "#ef4444" }}> · {imp.asset_guasti} guasti</strong>}
              </div>
            </div>
          </Popup>
        </Marker>
      ))}

      {siti.map((sito) => {
        if (sito.lat === null || sito.lon === null) return null;
        return (
          <Marker
            key={`sito-${sito.sito_id}`}
            position={[sito.lat, sito.lon]}
            icon={sitoIcon(sito.status, sito.sito_id === selectedSitoId)}
            eventHandlers={{ click: () => onSelectSito(sito.sito_id) }}
          >
            <Popup>
              <div style={{ minWidth: 210 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
                  <span style={{ width: 10, height: 10, borderRadius: "50%", background: STATUS_COLORS[sito.status], display: "inline-block" }} />
                  <strong style={{ fontSize: 14 }}>{sito.nome}</strong>
                  <span style={{ fontSize: 10, fontWeight: 700, color: STATUS_COLORS[sito.status], textTransform: "uppercase" }}>
                    {STATUS_LABELS[sito.status]}
                  </span>
                </div>
                {sito.indirizzo && <div style={{ fontSize: 11, color: "#6b7280", marginBottom: 6 }}>{sito.indirizzo}</div>}
                <div style={{ fontSize: 12, lineHeight: 1.7 }}>
                  <div>🏭 {sito.n_impianti} impianti · {sito.n_asset} asset</div>
                  <div>⚙️ {sito.asset_stati.service} operativi · {sito.asset_stati.stopped} fermi · <strong style={{ color: "#ef4444" }}>{sito.asset_stati.out_of_service} guasti</strong></div>
                  <div>🎫 {sito.ticket.aperti} WO aperti · {sito.ticket.in_corso} in corso · {sito.ticket.pianificati} pianificati</div>
                  {sito.ticket.bd_attivi > 0 && (
                    <div style={{ color: "#ef4444", fontWeight: 700 }}>⚠️ {sito.ticket.bd_attivi} breakdown attivi</div>
                  )}
                </div>
                <Link href="/asset" style={{ display: "inline-block", marginTop: 8, fontSize: 12, fontWeight: 700, color: "#4f46e5" }}>
                  Apri Siti &amp; Asset →
                </Link>
              </div>
            </Popup>
          </Marker>
        );
      })}
    </MapContainer>
  );
}
