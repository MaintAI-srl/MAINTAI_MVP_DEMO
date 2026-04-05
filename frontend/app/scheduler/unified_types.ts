export interface UnifiedTicket {
  id: number;
  title: string;
  asset: string;
  type: string;
  priority: string;
  technicianId: number | null;
  technicianName: string;
  date: string | null;
  startHour: number | null;
  endHour: number | null;
  durationHours: number;
  isAI: boolean;
  warnings?: string[];
  isContinuation?: boolean;
}

export interface BacklogStats {
  pm_percent: number;
  cm_percent: number;
  bd_percent: number;
}

export interface PlanEfficiency {
  score: number;
  breakdown: Record<string, number>;
}
