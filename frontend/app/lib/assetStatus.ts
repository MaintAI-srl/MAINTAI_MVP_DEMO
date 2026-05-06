export type AssetStatusValue = "service" | "stopped" | "out of service";

export const ASSET_STATUS_OPTIONS: Array<{ value: AssetStatusValue; label: string; color: string }> = [
  { value: "service", label: "OPERATIVO", color: "#38d978" },
  { value: "stopped", label: "FERMO PROG.", color: "#f2b84b" },
  { value: "out of service", label: "GUASTO", color: "#e05252" },
];

export const ASSET_STATUS_LABELS: Record<AssetStatusValue, string> = {
  service: "OPERATIVO",
  stopped: "FERMO PROG.",
  "out of service": "GUASTO",
};

export const ASSET_STATUS_COLORS: Record<AssetStatusValue, { color: string; bg: string; border: string }> = {
  service: { color: "#38d978", bg: "rgba(56,217,120,.12)", border: "rgba(56,217,120,.34)" },
  stopped: { color: "#f2b84b", bg: "rgba(242,184,75,.13)", border: "rgba(242,184,75,.36)" },
  "out of service": { color: "#e05252", bg: "rgba(224,82,82,.13)", border: "rgba(224,82,82,.36)" },
};

export function normalizeAssetStatus(value?: string | null): AssetStatusValue {
  const normalized = (value || "service").trim().toLowerCase();
  if (normalized === "guasto" || normalized === "oos" || normalized === "fuori servizio" || normalized === "out_of_service") return "out of service";
  if (normalized === "fermo" || normalized === "fermo prog" || normalized === "fermo prog." || normalized === "fermo programmato" || normalized === "fermo_prog") return "stopped";
  if (normalized === "operativo" || normalized === "in servizio" || normalized === "in_servizio") return "service";
  if (normalized === "stopped" || normalized === "out of service" || normalized === "service") return normalized;
  return "service";
}

export function assetStatusLabel(value?: string | null): string {
  return ASSET_STATUS_LABELS[normalizeAssetStatus(value)];
}

export function assetStatusStyle(value?: string | null) {
  const colors = ASSET_STATUS_COLORS[normalizeAssetStatus(value)];
  return {
    color: colors.color,
    background: colors.bg,
    border: `1px solid ${colors.border}`,
    padding: "2px 8px",
    borderRadius: 4,
    fontSize: 11,
    fontWeight: 800 as const,
    letterSpacing: "0.04em",
    textTransform: "uppercase" as const,
  };
}
