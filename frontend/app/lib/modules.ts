export const MODULE_DEFINITIONS = [
  { id: "dashboard", defaultEnabled: true },
  { id: "assets", defaultEnabled: true },
  { id: "technicians", defaultEnabled: true },
  { id: "tickets", defaultEnabled: true },
  { id: "planning", defaultEnabled: true },
  { id: "diagnostic_ai", defaultEnabled: true },
  { id: "maintenance_plans", defaultEnabled: true },
  { id: "manuals", defaultEnabled: true },
  { id: "deadlines", defaultEnabled: true },
  { id: "condition_maintenance", defaultEnabled: true },
  { id: "email_to_ticket", defaultEnabled: true },
  { id: "system_logs", defaultEnabled: true },
  { id: "bulk_import", defaultEnabled: true },
  { id: "tenant_admin", defaultEnabled: true },
  { id: "user_admin", defaultEnabled: true },
  { id: "compliance", defaultEnabled: true },
  { id: "economic_reports", defaultEnabled: true },
  { id: "emergency", defaultEnabled: true },
  { id: "control_center", defaultEnabled: true },
  { id: "mobile_app", defaultEnabled: true },
  { id: "weather", defaultEnabled: true },
  { id: "desktop_updates", defaultEnabled: true },
  { id: "guide_ai", defaultEnabled: false },
] as const;

export type ModuleId = (typeof MODULE_DEFINITIONS)[number]["id"];

export type ModuleStatus = {
  id: string;
  name: string;
  description: string;
  category: string;
  default_enabled: boolean;
  requires: string[];
  enabled: boolean;
};

export type ModulesResponse = {
  enabled?: string[];
  disabled?: string[];
  modules?: ModuleStatus[];
};

const MODULE_IDS = new Set<string>(MODULE_DEFINITIONS.map((module) => module.id));

export const DEFAULT_ENABLED_MODULES: ModuleId[] = MODULE_DEFINITIONS
  .filter((module) => module.defaultEnabled)
  .map((module) => module.id);

export function normalizeModuleId(value: string): string {
  return value.trim().toLowerCase().replaceAll("-", "_");
}

export function isKnownModuleId(value: string): value is ModuleId {
  return MODULE_IDS.has(normalizeModuleId(value));
}

export function normalizeEnabledModules(values: string[] | undefined): ModuleId[] {
  if (!values?.length) return DEFAULT_ENABLED_MODULES;

  const normalized = values
    .map(normalizeModuleId)
    .filter(isKnownModuleId);

  return normalized.length ? Array.from(new Set(normalized)) : DEFAULT_ENABLED_MODULES;
}

const PATH_MODULES_BASE = [
  { prefix: "/admin/bulk-import", moduleId: "bulk_import" },
  { prefix: "/admin/email", moduleId: "email_to_ticket" },
  { prefix: "/admin/logs", moduleId: "system_logs" },
  { prefix: "/admin/tenants", moduleId: "tenant_admin" },
  { prefix: "/admin/utenti", moduleId: "user_admin" },
  { prefix: "/asset", moduleId: "assets" },
  { prefix: "/assets", moduleId: "assets" },
  { prefix: "/impianti", moduleId: "assets" },
  { prefix: "/storico", moduleId: "assets" },
  { prefix: "/print/asset-qr", moduleId: "assets" },
  { prefix: "/tecnici", moduleId: "technicians" },
  { prefix: "/ticket", moduleId: "tickets" },
  { prefix: "/planning", moduleId: "planning" },
  { prefix: "/diagnostic", moduleId: "diagnostic_ai" },
  { prefix: "/manuali", moduleId: "manuals" },
  { prefix: "/piani-manutenzione", moduleId: "maintenance_plans" },
  { prefix: "/piani", moduleId: "maintenance_plans" },
  { prefix: "/scadenze", moduleId: "deadlines" },
  { prefix: "/condizioni", moduleId: "condition_maintenance" },
  { prefix: "/controllo", moduleId: "control_center" },
  { prefix: "/compliance", moduleId: "compliance" },
  { prefix: "/report/economico", moduleId: "economic_reports" },
  { prefix: "/mobile", moduleId: "mobile_app" },
] satisfies { prefix: string; moduleId: ModuleId }[];

const PATH_MODULES = [...PATH_MODULES_BASE].sort((a, b) => b.prefix.length - a.prefix.length);

export function moduleForPath(pathname: string): ModuleId | null {
  const cleanPath = pathname.split("?")[0] || "/";
  const match = PATH_MODULES.find(({ prefix }) => {
    return cleanPath === prefix || cleanPath.startsWith(`${prefix}/`);
  });
  return match?.moduleId ?? null;
}
