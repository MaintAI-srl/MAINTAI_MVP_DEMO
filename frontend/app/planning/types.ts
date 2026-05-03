// Tipi condivisi tra i componenti del modulo Planning

export interface TicketData {
  id: number;
  titolo: string;
  asset_id: number;
  asset_name: string | null;
  tipo: string;           // "CM" | "PM" | "BD"
  priorita: string;
  stato: string;
  durata_stimata_ore: number;
  fascia_oraria: string;
  descrizione: string | null;
  tecnico_id: number | null;
  planned_start: string | null;
  planned_finish: string | null;
}

export interface TecnicoData {
  id: number;
  nome: string;
  cognome: string | null;
  competenze?: string; // alias per compatibilità (backend usa "skill")
  skill?: string;      // campo reale restituito dal backend
  ore_giornaliere: number;
  orario_inizio: string;
  orario_fine: string;
  stato: string;
}

export interface PlannedWO {
  wo_id: number;           // = ticket.id (nessun record nuovo)
  technician_id: number;
  planned_date: string;    // "YYYY-MM-DD"
  time_slot: string;       // "HH:MM-HH:MM"
  planned_start_time: string;
  planned_end_time: string;
  duration_hours: number;
  motivation: string;
  warnings: string[];
  is_continuation: boolean;
  parent_wo_id: number | null;
  // v3: explainability
  confidence_score?: number;
  risk_level?: "LOW" | "MEDIUM" | "HIGH";
  complexity?: "SIMPLE" | "STANDARD" | "COMPLEX";
}

export interface DeferredWO {
  wo_id: number;
  reason: string;
  // v3: reason code strutturato
  reason_code?: string;
  reason_detail?: string;
  earliest_possible_date?: string | null;
}

export const REASON_CODE_LABELS: Record<string, { label: string; color: string }> = {
  NO_SKILL:              { label: "Skill mancante",        color: "#ef4444" },
  NO_AVAILABILITY:       { label: "Non disponibile",       color: "#6b7280" },
  TIME_WINDOW_CONFLICT:  { label: "Finestra temporale",    color: "#f59e0b" },
  CAPACITY_EXCEEDED:     { label: "Capacità esaurita",     color: "#f97316" },
  LIMITATION_MISMATCH:   { label: "Limitazione operativa", color: "#a855f7" },
  MULTI_TECH_NOT_FOUND:  { label: "Multi-tecnico",         color: "#ec4899" },
};

export interface EfficiencyBreakdown {
  copertura_backlog: number;
  utilizzo_tecnici: number;
  bilanciamento_70_30: number;
  match_skill: number;
  ottimizzazione_meteo: number;
}

export interface EfficiencyMotivation {
  componente: string;
  valore: number;
  target: number;
  spiegazione: string;
  suggerimento: string;
}

export interface PlanMetadata {
  engine_version: string;
  generated_by: string;
  generation_time_ms: number;
  confidence_avg: number | null;
  // Metadati ore effettive vs teoriche (#13)
  ore_disponibili_teoriche?: number | null;
  ore_disponibili_effettive?: number | null;
  ore_assegnate?: number | null;
}

export interface PlanJson {
  planned_workorders: PlannedWO[];
  deferred_workorders: DeferredWO[];
  fermo_assets: Array<{ asset_id: number; triggered_by_wo_id: number }>;
  global_warnings: string[];
  efficiency_score?: number;
  efficiency_breakdown?: EfficiencyBreakdown;
  efficiency_motivations?: EfficiencyMotivation[];
  plan_metadata?: PlanMetadata;
}

export interface GeneratedPlan {
  id: number;
  created_at: string;
  status: string;
  horizon_days: number;
  plan_json: PlanJson;
  plan_number: number | null;
  plan_label: string | null;
  confirmed_at: string | null;
  confirmed_by: string | null;
  /** Ultima data pianificata tra i workorder del piano. Derivata al confirm. */
  scadenza: string | null;
  deauthorized_at: string | null;
  deauthorized_by: string | null;
  deauthorization_reason: string | null;
  wo_count: number;
  efficiency_score: number | undefined;
  tenant_id: number | null;
  /** Percentuale ticket Chiusi su totale pianificati nel piano. Calcolata dinamicamente. */
  completion_pct: number | null;
}

export interface ReplanResult {
  replanning_plan_id: number;
  trigger: string;
  affected_tickets: number[];
  moved_tickets: number[];
  disruption_cost: number;
  plan_json: PlanJson;
}

// Colori per tipo ticket
export const TIPO_COLORS: Record<string, { bg: string; text: string; border: string; borderStyle?: string }> = {
  BD: { bg: "linear-gradient(135deg,#7f1d1d,#991b1b)", text: "#fca5a5", border: "#ef4444" },
  PM: { bg: "linear-gradient(135deg,#14532d,#166534)", text: "#86efac", border: "#22c55e" },
  CM: { bg: "linear-gradient(135deg,#78350f,#92400e)", text: "#fcd34d", border: "#f59e0b" },
  CONT: { bg: "#4c1d95", text: "#c4b5fd", border: "#a855f7", borderStyle: "dashed" },
};

export function tipoStyle(tipo: string, isCont = false) {
  if (isCont) return TIPO_COLORS.CONT;
  return TIPO_COLORS[tipo?.toUpperCase()] ?? TIPO_COLORS.CM;
}

// Converte "HH:MM" in numero colonna CSS Grid (col 1 = label, col 2 = 08:00)
export function timeToCol(time: string | undefined): number {
  if (!time) return 2;
  const parts = time.split(":");
  const h = parseInt(parts[0] ?? "8", 10);
  const m = parseInt(parts[1] ?? "0", 10);
  const slots = Math.round(((h - 8) * 60 + m) / 30);
  return Math.max(0, Math.min(slots, 18)) + 2;
}

// Nomi brevi giorni settimana
export const GIORNI_SETTIMANA = ["Dom", "Lun", "Mar", "Mer", "Gio", "Ven", "Sab"];
export const MESI = [
  "Gennaio","Febbraio","Marzo","Aprile","Maggio","Giugno",
  "Luglio","Agosto","Settembre","Ottobre","Novembre","Dicembre",
];
