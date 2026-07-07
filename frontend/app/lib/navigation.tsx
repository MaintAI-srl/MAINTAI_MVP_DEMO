import type { LucideIcon } from "lucide-react";
import {
  Activity,
  BrainCircuit,
  Building,
  CalendarDays,
  Cpu,
  Gauge,
  LayoutDashboard,
  Mail,
  Radar,
  ScrollText,
  ShieldCheck,
  SlidersHorizontal,
  TrendingUp,
  UploadCloud,
  UserCheck,
  UserCog,
  Users,
  Wrench,
  Zap,
} from "lucide-react";
import type { ModuleId } from "./modules";

export type NavItem = {
  href: string;
  label: string;
  icon: LucideIcon;
  module?: ModuleId;
  adminOnly?: boolean;
  superadminOnly?: boolean;
};

export type NavGroup = {
  section: string;
  items: NavItem[];
};

export const NAV_GROUPS: NavGroup[] = [
  {
    section: "DASHBOARD",
    items: [
      { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard, module: "dashboard" },
      { href: "/controllo", label: "Centro di Controllo", icon: Radar, module: "control_center" },
    ],
  },
  {
    section: "OPERAZIONI",
    items: [
      { href: "/ticket", label: "Ticket", icon: Activity, module: "tickets" },
      { href: "/planning", label: "Pianificazione", icon: Zap, module: "planning" },
      { href: "/diagnostic", label: "Analisi Ingegneria AI", icon: BrainCircuit, module: "diagnostic_ai" },
    ],
  },
  {
    section: "RISORSE",
    items: [
      { href: "/asset", label: "Siti & Asset", icon: Cpu, module: "assets" },
      { href: "/tecnici", label: "Tecnici", icon: Users, module: "technicians" },
      { href: "/risorse/personale", label: "Personale", icon: UserCheck, module: "technicians" },
      { href: "/piani", label: "Piani di Manutenzione", icon: Wrench, module: "maintenance_plans" },
      { href: "/scadenze", label: "Scadenziario", icon: CalendarDays, module: "deadlines" },
      { href: "/condizioni", label: "Dati Misure Asset", icon: Gauge, module: "condition_maintenance" },
    ],
  },
  {
    section: "IMPOSTAZIONI",
    items: [
      { href: "/report/economico", label: "Report Economico", icon: TrendingUp, module: "economic_reports", adminOnly: true },
      { href: "/compliance", label: "Scadenzario Attestati", icon: ShieldCheck, module: "compliance", adminOnly: true },
      { href: "/admin/funzionalita", label: "Funzionalità", icon: SlidersHorizontal, superadminOnly: true },
      { href: "/admin/tenants", label: "Clienti", icon: Building, module: "tenant_admin", superadminOnly: true },
      { href: "/admin/bulk-import", label: "Import Massivo", icon: UploadCloud, module: "bulk_import", adminOnly: true },
      { href: "/admin/logs", label: "Log di Sistema", icon: ScrollText, module: "system_logs", adminOnly: true },
      { href: "/admin/email", label: "Email to Ticket", icon: Mail, module: "email_to_ticket", adminOnly: true },
      { href: "/profilo", label: "Mio Profilo", icon: UserCheck },
      { href: "/admin/utenti", label: "Gestione Utenti", icon: UserCog, module: "user_admin", adminOnly: true },
    ],
  },
];

export const PAGE_LABELS: Record<string, string> = {
  "/dashboard": "Dashboard",
  "/controllo": "Centro di Controllo",
  "/asset": "Siti & Asset",
  "/assets": "Asset",
  "/impianti": "Impianti",
  "/tecnici": "Tecnici",
  "/risorse/personale": "Personale",
  "/planning": "Pianificazione",
  "/ticket": "Ticket",
  "/diagnostic": "Analisi Ingegneria AI",
  "/piani": "Piani di Manutenzione",
  "/piani-manutenzione": "Piani di Manutenzione",
  "/scadenze": "Scadenziario",
  "/condizioni": "Dati Misure Asset",
  "/admin/tenants": "Clienti",
  "/admin/funzionalita": "Funzionalità",
  "/admin/bulk-import": "Import Massivo",
  "/admin/logs": "Log di Sistema",
  "/admin/email": "Email to Ticket",
  "/admin/utenti": "Gestione Utenti",
  "/profilo": "Mio Profilo",
  "/compliance": "Scadenzario Attestati",
  "/report/economico": "Report Economico",
  "/storico": "Storico Interventi",
};

type VisibleNavOptions = {
  role?: string | null;
  isModuleEnabled: (moduleId: ModuleId) => boolean;
};

export function getVisibleNavGroups({ role, isModuleEnabled }: VisibleNavOptions): NavGroup[] {
  const isTecnico = role === "tecnico";
  const isSuperadmin = role === "superadmin";

  return NAV_GROUPS.map((section) => ({
    ...section,
    items: section.items.filter((item) => {
      if (item.module && !isModuleEnabled(item.module)) return false;
      if (item.superadminOnly && !isSuperadmin) return false;
      if (item.adminOnly && role !== "responsabile" && !isSuperadmin) return false;
      if (!isTecnico) return true;
      const visibleForTecnico = ["/ticket", "/asset", "/profilo"];
      return visibleForTecnico.includes(item.href);
    }),
  })).filter((section) => section.items.length > 0);
}
