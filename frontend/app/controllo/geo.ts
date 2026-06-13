import type { ControlCenterBDTicket, ControlCenterRouteTecnico } from "./types";

export type LatLon = { lat: number; lon: number };

type NominatimResult = {
  lat: string;
  lon: string;
};

const geocodeCache = new Map<string, Promise<LatLon | null>>();

function cleanPart(value: string | null | undefined) {
  const text = String(value ?? "").trim();
  return text.length > 0 ? text : null;
}

function uniqueParts(parts: Array<string | null>) {
  const seen = new Set<string>();
  return parts.filter((part): part is string => {
    if (!part) return false;
    const key = part.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function controlCenterTicketPlace(ticket: ControlCenterBDTicket) {
  return uniqueParts([
    cleanPart(ticket.indirizzo),
    cleanPart(ticket.sito_nome),
    cleanPart(ticket.impianto_nome),
    cleanPart(ticket.asset_nome),
  ]).join(", ");
}

export function controlCenterTechnicianPlace(tec: ControlCenterRouteTecnico) {
  return cleanPart(tec.indirizzo_corrente) ?? "";
}

export async function geocodePlace(query: string): Promise<LatLon | null> {
  const normalized = query.trim();
  if (!normalized) return null;
  const key = normalized.toLowerCase();
  const cached = geocodeCache.get(key);
  if (cached) return cached;

  const promise = fetch(
    `https://nominatim.openstreetmap.org/search?format=json&limit=1&accept-language=it&q=${encodeURIComponent(normalized)}`
  )
    .then(async (res) => {
      if (!res.ok) return null;
      const json = (await res.json()) as NominatimResult[];
      const first = json[0];
      if (!first) return null;
      const lat = Number(first.lat);
      const lon = Number(first.lon);
      if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
      return { lat, lon };
    })
    .catch(() => null);

  geocodeCache.set(key, promise);
  return promise;
}

export async function resolvePlaceLatLon(
  lat: number | null,
  lon: number | null,
  query: string
): Promise<LatLon | null> {
  if (lat !== null && lon !== null) return { lat, lon };
  return geocodePlace(query);
}
