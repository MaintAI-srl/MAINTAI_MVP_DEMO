"use client";

import { useEffect, useRef, useState } from "react";
import type { ControlCenterBDTicket, ControlCenterRouteTecnico, ImpiantoMarker, SitoOverview } from "../types";
import { STATUS_COLORS, STATUS_LABELS } from "../types";

// ── Tipi minimi dell'API Google Maps (il progetto non include @types/google.maps) ──
type GLatLng = { lat: number; lng: number };
type GLatLngBounds = { extend(p: GLatLng): void; isEmpty(): boolean };
type GMap = {
  panTo(c: GLatLng): void;
  setZoom(z: number): void;
  fitBounds(b: GLatLngBounds, padding?: number): void;
};
type GMarker = {
  setMap(m: GMap | null): void;
  addListener(ev: string, cb: () => void): void;
};
type GInfoWindow = {
  open(opts: { map: GMap; anchor: GMarker }): void;
  close(): void;
  setContent(html: string): void;
};
type GDirectionsRenderer = {
  setMap(m: GMap | null): void;
  setDirections(result: unknown): void;
};
type GDirectionsService = {
  route(request: Record<string, unknown>, callback: (result: unknown, status: string) => void): void;
};
type GMapsApi = {
  Map: new (el: HTMLElement, opts: Record<string, unknown>) => GMap;
  Marker: new (opts: Record<string, unknown>) => GMarker;
  InfoWindow: new (opts?: Record<string, unknown>) => GInfoWindow;
  LatLngBounds: new () => GLatLngBounds;
  Point: new (x: number, y: number) => unknown;
  Size: new (w: number, h: number) => unknown;
  DirectionsService: new () => GDirectionsService;
  DirectionsRenderer: new (opts?: Record<string, unknown>) => GDirectionsRenderer;
  SymbolPath: { CIRCLE: unknown };
  TravelMode: { DRIVING: string };
};

declare global {
  interface Window {
    google?: { maps: GMapsApi };
    __maintaiGmapsReady?: () => void;
  }
}

// ── Loader singleton dello script Google Maps JS API ───────────────────────────
let gmapsPromise: Promise<GMapsApi> | null = null;

function loadGoogleMaps(apiKey: string): Promise<GMapsApi> {
  if (typeof window === "undefined") {
    return Promise.reject(new Error("Google Maps disponibile solo lato client"));
  }
  if (window.google?.maps) return Promise.resolve(window.google.maps);
  if (gmapsPromise) return gmapsPromise;

  gmapsPromise = new Promise<GMapsApi>((resolve, reject) => {
    window.__maintaiGmapsReady = () => {
      if (window.google?.maps) resolve(window.google.maps);
      else reject(new Error("Google Maps non inizializzato"));
    };
    const script = document.createElement("script");
    script.src =
      "https://maps.googleapis.com/maps/api/js?key=" +
      encodeURIComponent(apiKey) +
      "&loading=async&language=it&region=IT&callback=__maintaiGmapsReady";
    script.async = true;
    script.onerror = () => {
      gmapsPromise = null;
      reject(new Error("Impossibile caricare lo script Google Maps (verifica API key e rete)"));
    };
    document.head.appendChild(script);
  });
  return gmapsPromise;
}

// ── Stile mappa dark industrial coerente col design system (#0a0f1e) ───────────
const DARK_MAP_STYLE = [
  { elementType: "geometry", stylers: [{ color: "#0f1626" }] },
  { elementType: "labels.text.fill", stylers: [{ color: "#7d94b5" }] },
  { elementType: "labels.text.stroke", stylers: [{ color: "#0a0f1e" }] },
  { featureType: "administrative", elementType: "geometry.stroke", stylers: [{ color: "#1f2937" }] },
  { featureType: "poi", stylers: [{ visibility: "off" }] },
  { featureType: "transit", stylers: [{ visibility: "off" }] },
  { featureType: "road", elementType: "geometry", stylers: [{ color: "#1a2336" }] },
  { featureType: "road", elementType: "geometry.stroke", stylers: [{ color: "#111827" }] },
  { featureType: "road", elementType: "labels.text.fill", stylers: [{ color: "#5b6b85" }] },
  { featureType: "road.highway", elementType: "geometry", stylers: [{ color: "#243049" }] },
  { featureType: "water", elementType: "geometry", stylers: [{ color: "#0a1322" }] },
  { featureType: "water", elementType: "labels.text.fill", stylers: [{ color: "#3d5a80" }] },
  { featureType: "landscape.man_made", elementType: "geometry", stylers: [{ color: "#121a2c" }] },
];

function esc(value: string | null | undefined): string {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function sitoInfoHtml(sito: SitoOverview): string {
  const color = STATUS_COLORS[sito.status];
  const label = STATUS_LABELS[sito.status];
  return `
    <div style="font-family:Inter,sans-serif;min-width:220px;color:#111827;padding:2px 4px">
      <div style="display:flex;align-items:center;gap:8px;margin-bottom:6px">
        <span style="width:10px;height:10px;border-radius:50%;background:${color};display:inline-block"></span>
        <strong style="font-size:14px">${esc(sito.nome)}</strong>
        <span style="font-size:10px;font-weight:700;color:${color};text-transform:uppercase">${label}</span>
      </div>
      ${sito.indirizzo ? `<div style="font-size:11px;color:#6b7280;margin-bottom:6px">${esc(sito.indirizzo)}</div>` : ""}
      <div style="font-size:12px;line-height:1.7">
        <div>🏭 ${sito.n_impianti} impianti · ${sito.n_asset} asset</div>
        <div>⚙️ ${sito.asset_stati.service} operativi · ${sito.asset_stati.stopped} fermi · <strong style="color:#ef4444">${sito.asset_stati.out_of_service} guasti</strong></div>
        <div>🎫 ${sito.ticket.aperti} WO aperti · ${sito.ticket.in_corso} in corso · ${sito.ticket.pianificati} pianificati</div>
        ${sito.ticket.bd_attivi > 0 ? `<div style="color:#ef4444;font-weight:700">⚠️ ${sito.ticket.bd_attivi} breakdown attivi</div>` : ""}
      </div>
      <a href="/asset" style="display:inline-block;margin-top:8px;font-size:12px;font-weight:700;color:#4f46e5">Apri Siti &amp; Asset →</a>
    </div>`;
}

function urgencyIconDataUrl(color: string): string {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="42" height="42" viewBox="0 0 42 42">
    <circle cx="21" cy="21" r="16" fill="${color}" opacity="0.18">
      <animate attributeName="r" values="10;19;10" dur="1.25s" repeatCount="indefinite"/>
      <animate attributeName="opacity" values="0.55;0.05;0.55" dur="1.25s" repeatCount="indefinite"/>
    </circle>
    <circle cx="21" cy="21" r="8" fill="${color}" stroke="#fff" stroke-width="3"/>
  </svg>`;
  return `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(svg)}`;
}

function urgencyInfoHtml(ticket: ControlCenterBDTicket): string {
  const isEmergency = ticket.priorita?.toLowerCase() === "emergenza";
  const color = isEmergency ? "#ef4444" : "#f97316";
  return `
    <div style="font-family:Inter,sans-serif;min-width:220px;color:#111827;padding:2px 4px">
      <div style="font-size:10px;font-weight:800;color:${color};text-transform:uppercase;letter-spacing:.08em;margin-bottom:4px">
        ${isEmergency ? "Emergenza" : "Breakdown"}
      </div>
      <strong style="font-size:14px">${esc(ticket.titolo || `Ticket #${ticket.ticket_id}`)}</strong>
      ${ticket.asset_nome ? `<div style="font-size:12px;color:#4b5563;margin-top:4px">${esc(ticket.asset_nome)}</div>` : ""}
      ${ticket.sito_nome || ticket.impianto_nome ? `<div style="font-size:11px;color:#6b7280;margin-top:2px">${esc(ticket.sito_nome || ticket.impianto_nome)}</div>` : ""}
      <div style="font-size:11px;color:${color};font-weight:800;margin-top:6px">Clicca la card sotto la mappa per calcolare i tecnici</div>
    </div>`;
}

interface GoogleControlMapProps {
  apiKey: string;
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

export default function GoogleControlMap({
  apiKey,
  siti,
  impianti,
  emergenze,
  selectedEmergency,
  routeTecnici,
  selectedSitoId,
  onSelectSito,
  onSelectEmergency,
}: GoogleControlMapProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapsRef = useRef<GMapsApi | null>(null);
  const mapRef = useRef<GMap | null>(null);
  const markersRef = useRef<Map<number, GMarker>>(new Map());
  const impMarkersRef = useRef<GMarker[]>([]);
  const urgencyMarkersRef = useRef<GMarker[]>([]);
  const routeRenderersRef = useRef<GDirectionsRenderer[]>([]);
  const infoRef = useRef<GInfoWindow | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [ready, setReady] = useState(false);

  // Inizializzazione mappa (una sola volta)
  useEffect(() => {
    let cancelled = false;
    loadGoogleMaps(apiKey)
      .then((maps) => {
        if (cancelled || !containerRef.current) return;
        mapsRef.current = maps;
        mapRef.current = new maps.Map(containerRef.current, {
          center: { lat: 42.5, lng: 12.5 }, // Italia
          zoom: 6,
          styles: DARK_MAP_STYLE,
          mapTypeControl: false,
          streetViewControl: false,
          fullscreenControl: true,
          backgroundColor: "#0a0f1e",
        });
        infoRef.current = new maps.InfoWindow();
        setReady(true);
      })
      .catch((err: unknown) => {
        if (!cancelled) setLoadError(err instanceof Error ? err.message : "Errore caricamento Google Maps");
      });
    return () => { cancelled = true; };
  }, [apiKey]);

  // Sincronizza marker con i dati
  useEffect(() => {
    const maps = mapsRef.current;
    const map = mapRef.current;
    if (!ready || !maps || !map) return;

    markersRef.current.forEach((m) => m.setMap(null));
    markersRef.current.clear();
    impMarkersRef.current.forEach((m) => m.setMap(null));
    impMarkersRef.current = [];
    urgencyMarkersRef.current.forEach((m) => m.setMap(null));
    urgencyMarkersRef.current = [];

    const bounds = new maps.LatLngBounds();
    let hasPoints = false;

    // Marker impianti (piccoli, cobalto) sotto i marker sito
    impianti.forEach((imp) => {
      const marker = new maps.Marker({
        map,
        position: { lat: imp.lat, lng: imp.lon },
        title: imp.nome,
        zIndex: 1,
        icon: {
          path: maps.SymbolPath.CIRCLE,
          scale: 5,
          fillColor: imp.asset_guasti > 0 ? "#ef4444" : "#5b8fff",
          fillOpacity: 0.85,
          strokeColor: "#0a0f1e",
          strokeWeight: 1.5,
        },
      });
      marker.addListener("click", () => {
        const info = infoRef.current;
        if (!info) return;
        info.setContent(
          `<div style="font-family:Inter,sans-serif;color:#111827;padding:2px 4px">
             <strong style="font-size:13px">${esc(imp.nome)}</strong>
             <div style="font-size:12px;margin-top:4px">${imp.n_asset} asset${imp.asset_guasti > 0 ? ` · <strong style="color:#ef4444">${imp.asset_guasti} guasti</strong>` : ""}</div>
           </div>`
        );
        info.open({ map, anchor: marker });
      });
      impMarkersRef.current.push(marker);
      bounds.extend({ lat: imp.lat, lng: imp.lon });
      hasPoints = true;
    });

    // Marker siti (grandi, colore stato)
    siti.forEach((sito) => {
      if (sito.lat === null || sito.lon === null) return;
      const marker = new maps.Marker({
        map,
        position: { lat: sito.lat, lng: sito.lon },
        title: sito.nome,
        zIndex: sito.status === "critico" ? 30 : sito.status === "attenzione" ? 20 : 10,
        icon: {
          path: maps.SymbolPath.CIRCLE,
          scale: sito.status === "critico" ? 12 : 10,
          fillColor: STATUS_COLORS[sito.status],
          fillOpacity: 0.95,
          strokeColor: "#ffffff",
          strokeWeight: 2.5,
        },
      });
      marker.addListener("click", () => {
        onSelectSito(sito.sito_id);
        const info = infoRef.current;
        if (info) {
          info.setContent(sitoInfoHtml(sito));
          info.open({ map, anchor: marker });
        }
      });
      markersRef.current.set(sito.sito_id, marker);
      bounds.extend({ lat: sito.lat, lng: sito.lon });
      hasPoints = true;
    });

    // Marker urgenze/BD lampeggianti
    emergenze.forEach((ticket) => {
      if (ticket.lat === null || ticket.lon === null) return;
      const isSelected = selectedEmergency?.ticket_id === ticket.ticket_id;
      const color = ticket.priorita?.toLowerCase() === "emergenza" ? "#ef4444" : "#f97316";
      const marker = new maps.Marker({
        map,
        position: { lat: ticket.lat, lng: ticket.lon },
        title: ticket.titolo,
        zIndex: isSelected ? 80 : 60,
        icon: {
          url: urgencyIconDataUrl(color),
          scaledSize: new maps.Size(isSelected ? 48 : 42, isSelected ? 48 : 42),
          anchor: new maps.Point(isSelected ? 24 : 21, isSelected ? 24 : 21),
        },
      });
      marker.addListener("click", () => {
        onSelectEmergency(ticket);
        const info = infoRef.current;
        if (info) {
          info.setContent(urgencyInfoHtml(ticket));
          info.open({ map, anchor: marker });
        }
      });
      urgencyMarkersRef.current.push(marker);
      bounds.extend({ lat: ticket.lat, lng: ticket.lon });
      hasPoints = true;
    });

    if (hasPoints && !selectedSitoId) {
      map.fitBounds(bounds, 60);
    }
    // selectedSitoId escluso volutamente: il fit serve solo al refresh dati
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, siti, impianti, emergenze, selectedEmergency, onSelectSito, onSelectEmergency]);

  // Pan + InfoWindow quando viene selezionato un sito dalla lista
  useEffect(() => {
    const map = mapRef.current;
    const info = infoRef.current;
    if (!ready || !map || selectedSitoId === null) return;
    const sito = siti.find((s) => s.sito_id === selectedSitoId);
    const marker = markersRef.current.get(selectedSitoId);
    if (!sito || sito.lat === null || sito.lon === null) return;
    map.panTo({ lat: sito.lat, lng: sito.lon });
    map.setZoom(12);
    if (info && marker) {
      info.setContent(sitoInfoHtml(sito));
      info.open({ map, anchor: marker });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, selectedSitoId]);

  // Rotte stradali top-3 verso l'urgenza selezionata
  useEffect(() => {
    const maps = mapsRef.current;
    const map = mapRef.current;
    if (!ready || !maps || !map) return;

    routeRenderersRef.current.forEach((renderer) => renderer.setMap(null));
    routeRenderersRef.current = [];

    if (!selectedEmergency || selectedEmergency.lat === null || selectedEmergency.lon === null) return;
    const service = new maps.DirectionsService();
    routeTecnici.slice(0, 3).forEach((tec, idx) => {
      if (tec.lat === null || tec.lon === null) return;
      const renderer = new maps.DirectionsRenderer({
        map,
        suppressMarkers: true,
        preserveViewport: true,
        polylineOptions: {
          strokeColor: ROUTE_COLORS[idx] ?? "#94a3b8",
          strokeOpacity: 0.95,
          strokeWeight: idx === 0 ? 5 : 4,
        },
      });
      routeRenderersRef.current.push(renderer);
      service.route(
        {
          origin: { lat: tec.lat, lng: tec.lon },
          destination: { lat: selectedEmergency.lat, lng: selectedEmergency.lon },
          travelMode: maps.TravelMode.DRIVING,
        },
        (result, status) => {
          if (status === "OK" && result) renderer.setDirections(result);
        }
      );
    });

    map.panTo({ lat: selectedEmergency.lat, lng: selectedEmergency.lon });
    map.setZoom(12);
  }, [ready, selectedEmergency, routeTecnici]);

  if (loadError) {
    return (
      <div style={{
        height: "100%", minHeight: 300, display: "flex", flexDirection: "column",
        alignItems: "center", justifyContent: "center", gap: 8,
        background: "var(--surface-2)", borderRadius: 10, padding: 24, textAlign: "center",
      }}>
        <div style={{ fontSize: 13, fontWeight: 700, color: "#f87171" }}>Google Maps non disponibile</div>
        <div style={{ fontSize: 12, color: "var(--text-muted)" }}>{loadError}</div>
      </div>
    );
  }

  return <div ref={containerRef} style={{ width: "100%", height: "100%", minHeight: 300, borderRadius: 10 }} />;
}
