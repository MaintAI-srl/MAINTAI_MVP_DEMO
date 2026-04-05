export function toIso(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export function addDays(d: Date, n: number): Date {
  const r = new Date(d);
  r.setDate(r.getDate() + n);
  return r;
}

export function formatHour(value?: number | null): string {
  if (value == null) return "-";
  const h = Math.floor(value);
  const m = Math.round((value - h) * 60);
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

export function woTypeBg(type?: string): string {
  if (!type) return "rgba(99,102,241,0.1)";
  const t = type.toUpperCase();
  if (t.includes("BD")) return "rgba(239,68,68,0.15)";
  if (t.includes("CM")) return "rgba(249,115,22,0.15)";
  if (t.includes("PM")) return "rgba(34,197,94,0.15)";
  return "rgba(99,102,241,0.1)";
}

export function woTypeColor(type?: string): string {
  if (!type) return "#6366f1";
  const t = type.toUpperCase();
  if (t.includes("BD")) return "#ef4444";
  if (t.includes("CM")) return "#f97316";
  if (t.includes("PM")) return "#22c55e";
  return "#6366f1";
}

export function parseStartHour(startTime?: string, timeSlot?: string): number {
  if (startTime) {
    const [hh, mm] = startTime.split(":").map(Number);
    return hh + mm / 60;
  }
  if (timeSlot && timeSlot.includes("-")) {
    const start = timeSlot.split("-")[0].trim();
    const [hh, mm] = start.split(":").map(Number);
    return hh + (mm || 0) / 60;
  }
  return 8;
}

export function parseEndHour(end?: string, start?: string, duration?: number, timeSlot?: string): number {
  if (end) {
    const [hh, mm] = end.split(":").map(Number);
    return hh + mm / 60;
  }
  const startH = parseStartHour(start, timeSlot);
  if (duration) return startH + duration;
  if (timeSlot && timeSlot.includes("-")) {
    const endS = timeSlot.split("-")[1].trim();
    const [hh, mm] = endS.split(":").map(Number);
    return hh + (mm || 0) / 60;
  }
  return startH + 2;
}
