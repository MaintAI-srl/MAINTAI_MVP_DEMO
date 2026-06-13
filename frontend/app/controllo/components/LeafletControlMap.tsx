"use client";

import React, { useEffect, useState } from "react";
import { MapContainer, TileLayer, Marker, Polyline, Popup, useMap } from "react-leaflet";
import L from "leaflet";
import Link from "next/link";
import { controlCenterTechnicianPlace, controlCenterTicketPlace, geocodePlace, resolvePlaceLatLon, type LatLon } from "../geo";
import type { ControlCenterBDTicket, ControlCenterRouteTecnico, ImpiantoMarker, SitoOverview } from "../types";
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

function urgencyIcon(isEmergency: boolean, active: boolean) {
  const color = isEmergency ? "#ef4444" : "#f97316";
  const size = active ? 32 : 28;
  return L.divIcon({
    className: "",
    html: `<div style="
      width:${size}px;height:${size}px;position:relative;display:flex;align-items:center;justify-content:center;
    ">
      <span style="
        position:absolute;width:${size}px;height:${size}px;border-radius:50%;background:${color};
        opacity:.28;animation:mControlPulse 1.25s ease-out infinite;
      "></span>
      <span style="
        width:${Math.round(size * 0.48)}px;height:${Math.round(size * 0.48)}px;border-radius:50%;
        background:${color};border:3px solid #fff;box-shadow:0 2px 10px rgba(0,0,0,.45);z-index:1;
      "></span>
      <style>
        @keyframes mControlPulse {
          0% { transform:scale(.55); opacity:.55; }
          70% { transform:scale(1.25); opacity:.08; }
          100% { transform:scale(.55); opacity:.55; }
        }
      </style>
    </div>`,
    iconSize: [size, size],
    iconAnchor: [size / 2, size / 2],
    popupAnchor: [0, -size / 2],
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
  emergenze: ControlCenterBDTicket[];
  selectedEmergency: ControlCenterBDTicket | null;
  routeTecnici: ControlCenterRouteTecnico[];
  selectedSitoId: number | null;
  onSelectSito: (id: number | null) => void;
  onSelectEmergency: (ticket: ControlCenterBDTicket) => void;
}

const ROUTE_COLORS = ["#22c55e", "#fbbf24", "#f97316"];

type RoadRoute = { tecnicoId: number; color: string; points: [number, number][] };

export default function LeafletControlMap({
  siti,
  impianti,
  emergenze,
  selectedEmergency,
  routeTecnici,
  selectedSitoId,
  onSelectSito,
  onSelectEmergency,
}: LeafletControlMapProps) {
  const [roadRoutes, setRoadRoutes] = useState<RoadRoute[]>([]);
  const [resolvedEmergenze, setResolvedEmergenze] = useState<Record<number, LatLon>>({});
  const points: [number, number][] = [];
  siti.forEach((s) => { if (s.lat !== null && s.lon !== null) points.push([s.lat, s.lon]); });
  impianti.forEach((i) => points.push([i.lat, i.lon]));
  emergenze.forEach((e) => {
    const point = resolvedEmergenze[e.ticket_id];
    if (point) points.push([point.lat, point.lon]);
  });

  const selectedSito = siti.find((s) => s.sito_id === selectedSitoId);
  const selectedEmergencyPoint = selectedEmergency ? resolvedEmergenze[selectedEmergency.ticket_id] : null;
  const selectedPoint: [number, number] | null =
    selectedEmergencyPoint
      ? [selectedEmergencyPoint.lat, selectedEmergencyPoint.lon]
      : selectedSito && selectedSito.lat !== null && selectedSito.lon !== null
        ? [selectedSito.lat, selectedSito.lon]
        : null;

  const defaultCenter: [number, number] = points.length > 0 ? points[0] : [42.5, 12.5]; // Italia

  useEffect(() => {
    let cancelled = false;
    Promise.all(
      emergenze.map(async (ticket) => {
        if (ticket.lat !== null && ticket.lon !== null) {
          return [ticket.ticket_id, { lat: ticket.lat, lon: ticket.lon }] as const;
        }
        const place = controlCenterTicketPlace(ticket);
        if (!place) return null;
        const point = await geocodePlace(place);
        return point ? ([ticket.ticket_id, point] as const) : null;
      })
    ).then((items) => {
      if (cancelled) return;
      const next: Record<number, LatLon> = {};
      items.forEach((item) => {
        if (item) next[item[0]] = item[1];
      });
      setResolvedEmergenze(next);
    });
    return () => { cancelled = true; };
  }, [emergenze]);

  useEffect(() => {
    let cancelled = false;
    async function loadRoutes() {
      if (!selectedEmergency) {
        setRoadRoutes([]);
        return;
      }
      const destination = await resolvePlaceLatLon(
        selectedEmergency.lat,
        selectedEmergency.lon,
        controlCenterTicketPlace(selectedEmergency)
      );
      if (!destination) {
        setRoadRoutes([]);
        return;
      }
      const routes = await Promise.all(
        routeTecnici.slice(0, 3).map(async (tec, idx) => {
          const origin = await resolvePlaceLatLon(tec.lat, tec.lon, controlCenterTechnicianPlace(tec));
          if (!origin) return null;
          const url =
            `https://router.project-osrm.org/route/v1/driving/${origin.lon},${origin.lat};${destination.lon},${destination.lat}` +
            "?overview=full&geometries=geojson";
          try {
            const res = await fetch(url);
            if (!res.ok) return null;
            const json = await res.json() as { routes?: { geometry?: { coordinates?: [number, number][] } }[] };
            const coords = json.routes?.[0]?.geometry?.coordinates;
            if (!coords?.length) return null;
            return {
              tecnicoId: tec.tecnico_id,
              color: ROUTE_COLORS[idx] ?? "#94a3b8",
              points: coords.map(([lon, lat]) => [lat, lon] as [number, number]),
            };
          } catch {
            return null;
          }
        })
      );
      if (!cancelled) setRoadRoutes(routes.filter((route): route is RoadRoute => route !== null));
    }
    loadRoutes();
    return () => { cancelled = true; };
  }, [routeTecnici, selectedEmergency]);

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

      {roadRoutes.map((route, idx) => (
        <Polyline
          key={`route-${route.tecnicoId}`}
          positions={route.points}
          pathOptions={{ color: route.color, weight: idx === 0 ? 5 : 4, opacity: 0.92 }}
        />
      ))}

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

      {emergenze.map((ticket) => {
        const point = resolvedEmergenze[ticket.ticket_id];
        if (!point) return null;
        const isEmergency = ticket.priorita?.toLowerCase() === "emergenza";
        const active = selectedEmergency?.ticket_id === ticket.ticket_id;
        return (
          <Marker
            key={`urg-${ticket.ticket_id}`}
            position={[point.lat, point.lon]}
            icon={urgencyIcon(isEmergency, active)}
            eventHandlers={{ click: () => onSelectEmergency(ticket) }}
          >
            <Popup>
              <div style={{ minWidth: 180 }}>
                <div style={{ fontSize: 11, color: isEmergency ? "#ef4444" : "#f97316", fontWeight: 800, textTransform: "uppercase" }}>
                  {isEmergency ? "Emergenza" : "Breakdown"}
                </div>
                <div style={{ fontWeight: 700, fontSize: 13, marginTop: 3 }}>{ticket.titolo}</div>
                {ticket.asset_nome && <div style={{ fontSize: 11, color: "#6b7280", marginTop: 2 }}>{ticket.asset_nome}</div>}
                {(ticket.sito_nome || ticket.impianto_nome) && (
                  <div style={{ fontSize: 11, color: "#6b7280", marginTop: 2 }}>{ticket.sito_nome || ticket.impianto_nome}</div>
                )}
              </div>
            </Popup>
          </Marker>
        );
      })}
    </MapContainer>
  );
}
