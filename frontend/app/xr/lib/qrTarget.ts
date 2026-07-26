"use client";

/**
 * Interpretazione del contenuto di un QR code MaintAI e risoluzione ad asset.
 *
 * In campo circolano tre tipi di etichetta:
 *   1. QR asset generato da `backend/services/qr_service.py` → `<app>/asset?id=<n>`
 *   2. QR pubblico del check di primo livello                → `<app>/check/<token>`
 *   3. etichette stampate col solo codice asset (o inserimento manuale)
 *
 * Il viewer XR deve accettarle tutte: il tecnico inquadra quello che trova sulla macchina.
 */

import { apiGet } from "../../lib/api";

export type QrTarget =
  | { kind: "asset"; assetId: number }
  | { kind: "checkToken"; token: string }
  | { kind: "codice"; codice: string };

export type ResolvedAsset = {
  id: number;
  nome: string;
  codice?: string | null;
};

type AssetDto = {
  id: number;
  nome?: string | null;
  codice?: string | null;
};

export type AssetDocumento = {
  id: number;
  nome: string;
  tipo: string;
  filename: string;
  content_type?: string | null;
};

/** Estrae un target dal contenuto grezzo del QR (o dall'input manuale). */
export function parseQrValue(raw: string): QrTarget | null {
  const value = raw.trim();
  if (!value) return null;

  if (/^\d+$/.test(value)) {
    return { kind: "asset", assetId: Number(value) };
  }

  if (/^https?:\/\//i.test(value)) {
    let url: URL;
    try {
      url = new URL(value);
    } catch {
      return { kind: "codice", codice: value };
    }

    const id = url.searchParams.get("id");
    if (id && /^\d+$/.test(id)) return { kind: "asset", assetId: Number(id) };

    const segments = url.pathname.split("/").filter(Boolean);
    const checkIndex = segments.indexOf("check");
    if (checkIndex >= 0 && segments[checkIndex + 1]) {
      return { kind: "checkToken", token: segments[checkIndex + 1] };
    }

    const assetIndex = segments.findIndex((s) => s === "asset" || s === "assets");
    const candidate = assetIndex >= 0 ? segments[assetIndex + 1] : undefined;
    if (candidate && /^\d+$/.test(candidate)) return { kind: "asset", assetId: Number(candidate) };

    const last = segments[segments.length - 1];
    return last ? { kind: "codice", codice: last } : null;
  }

  return { kind: "codice", codice: value };
}

/** Risolve un target QR nell'asset corrispondente. */
export async function resolveQrTarget(target: QrTarget): Promise<ResolvedAsset> {
  if (target.kind === "asset") {
    const asset = await apiGet<AssetDto>(`/assets/${target.assetId}`);
    return { id: asset.id, nome: asset.nome ?? `Asset #${asset.id}`, codice: asset.codice };
  }

  if (target.kind === "checkToken") {
    const check = await apiGet<{ asset_id: number; asset_nome?: string }>(
      `/check/public/${encodeURIComponent(target.token)}`,
    );
    return { id: check.asset_id, nome: check.asset_nome ?? `Asset #${check.asset_id}` };
  }

  const codice = target.codice;
  const results = await apiGet<AssetDto[]>(`/assets?query=${encodeURIComponent(codice)}&limit=50`);
  const list = Array.isArray(results) ? results : [];
  const exact = list.find((a) => (a.codice ?? "").toLowerCase() === codice.toLowerCase());
  const asset = exact ?? list[0];
  if (!asset) throw new Error(`Nessun asset trovato per "${codice}".`);
  return { id: asset.id, nome: asset.nome ?? `Asset #${asset.id}`, codice: asset.codice };
}

/** Documenti PDF dell'asset: sono gli unici visualizzabili sul pannello XR. */
export async function fetchPdfDocuments(assetId: number): Promise<AssetDocumento[]> {
  const docs = await apiGet<AssetDocumento[]>(`/assets/${assetId}/documenti`);
  return (Array.isArray(docs) ? docs : []).filter(
    (d) =>
      (d.content_type ?? "").toLowerCase().includes("pdf") ||
      (d.filename ?? "").toLowerCase().endsWith(".pdf"),
  );
}
