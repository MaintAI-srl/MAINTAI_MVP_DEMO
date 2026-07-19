"use client";

/**
 * Primitive UI e helper condivisi della sezione mobile /m.
 * Design nativo per schermi piccoli: viewport standard, touch target ≥44px,
 * testi base 16px. Palette iOS dark, coerente con la vecchia pagina /mobile.
 */

import { useEffect, useState } from "react";
import { apiGet } from "../lib/api";
import { notify } from "@/lib/toast";
import { useAuth } from "../lib/auth";
import {
  Wrench, ClipboardList, Settings, Search, Pause,
} from "lucide-react";

export type AssetResult = {
  id: number;
  name: string;
  impianto_nome?: string;
  sito_nome?: string;
  codice?: string;
};

export type Ticket = {
  id: number;
  titolo: string;
  asset_id?: number;
  asset_name: string;
  priorita: string;
  stato: string;
  tipo: string;
  execution_start?: string;
  planned_start?: string;
  planned_finish?: string;
  durata_stimata_ore?: number;
  descrizione?: string;
};

// ── Palette iOS dark ──────────────────────────────────────────────────────────
export const C = {
  card: "rgba(255,255,255,0.05)",
  cardSolid: "rgba(22,28,45,0.92)",
  border: "rgba(255,255,255,0.08)",
  blue: "#0A84FF",
  green: "#30D158",
  red: "#FF453A",
  orange: "#FF9F0A",
  yellow: "#FFD60A",
  purple: "#BF5AF2",
  teal: "#64D2FF",
  indigo: "#5E5CE6",
  text: "#F5F5F7",
  text2: "rgba(235,235,245,0.6)",
  text3: "rgba(235,235,245,0.38)",
} as const;

export const glass = {
  background: C.card,
  border: `1px solid ${C.border}`,
  borderRadius: 20,
} as const;

export const circleBtn = {
  width: 44, height: 44, borderRadius: "50%", flexShrink: 0,
  background: "rgba(255,255,255,0.06)", border: `1px solid ${C.border}`,
  color: C.text, cursor: "pointer",
  display: "flex", alignItems: "center", justifyContent: "center",
} as const;

export function prioritaColor(p: string): string {
  switch (p?.toLowerCase()) {
    case "emergenza": return C.red;
    case "alta":  return "#FF6961";
    case "media": return C.yellow;
    case "bassa": return C.green;
    default:      return C.text3;
  }
}

// ── Metadati tipo ticket (icona vettoriale + colore) ─────────────────────────
export function tipoMeta(t: string): { Icon: typeof Wrench; label: string; color: string } {
  switch (t?.toUpperCase()) {
    case "BD":  return { Icon: Wrench,        label: "Guasto",     color: C.red };
    case "PM":  return { Icon: ClipboardList, label: "Preventiva", color: C.green };
    case "CM":  return { Icon: Settings,      label: "Correttiva", color: C.orange };
    case "ISP": return { Icon: Search,        label: "Ispezione",  color: C.teal };
    case "MOD-STR": return { Icon: Settings,  label: "Mod. Straordinaria", color: "#8b5cf6" };
    default:    return { Icon: Wrench,        label: t,            color: C.text3 };
  }
}

export function isDispatchAlertTicket(ticket: Pick<Ticket, "tipo" | "priorita" | "stato">): boolean {
  return ticket.stato !== "Chiuso" && (
    ticket.priorita?.toLowerCase() === "emergenza" ||
    ticket.tipo?.toUpperCase() === "BD"
  );
}

// ── Allarme sonoro + vibrazione per emergenze ────────────────────────────────
export function playEmergencyAlarm() {
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const Ctx = (window.AudioContext || (window as any).webkitAudioContext) as typeof AudioContext;
    const ctx = new Ctx();
    const beep = (startTime: number, freq: number, duration: number) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.type = "square";
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0.55, startTime);
      gain.gain.exponentialRampToValueAtTime(0.001, startTime + duration);
      osc.start(startTime);
      osc.stop(startTime + duration + 0.05);
    };
    const t = ctx.currentTime;
    beep(t,        1047, 0.22); // Do5
    beep(t + 0.28, 784,  0.22); // Sol4
    beep(t + 0.56, 1047, 0.22);
    beep(t + 0.84, 784,  0.22);
    beep(t + 1.12, 1319, 0.45); // Mi5 — nota finale lunga
  } catch { /* AudioContext non supportato */ }
}

export function triggerEmergencyAlert(titolo: string) {
  playEmergencyAlarm();
  if (typeof navigator !== "undefined" && "vibrate" in navigator) {
    navigator.vibrate([500, 150, 500, 150, 800]);
  }
  notify.error(`🚨 EMERGENZA: ${titolo}`, "EMERGENZA");
}

// ── Icona in squircle tinta ───────────────────────────────────────────────────
export function IconBadge({ Icon, color, size = 48, iconSize = 22 }: {
  Icon: typeof Wrench; color: string; size?: number; iconSize?: number;
}) {
  return (
    <div style={{
      width: size, height: size, borderRadius: size * 0.32, flexShrink: 0,
      background: `${color}1f`, border: `1px solid ${color}38`,
      display: "flex", alignItems: "center", justifyContent: "center", color,
    }}>
      <Icon size={iconSize} strokeWidth={2} />
    </div>
  );
}

// ── Orologio corrente grande ──────────────────────────────────────────────────
export function LiveClock() {
  const [time, setTime] = useState("");
  const [dateStr, setDateStr] = useState("");
  useEffect(() => {
    const tick = () => {
      const now = new Date();
      setTime(now.toLocaleTimeString("it-IT", { hour: "2-digit", minute: "2-digit", second: "2-digit" }));
      setDateStr(now.toLocaleDateString("it-IT", { weekday: "short", day: "2-digit", month: "short" }).toUpperCase());
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, []);
  return (
    <div style={{ textAlign: "center" }}>
      <div style={{
        fontSize: "clamp(28px, 7vw, 42px)", fontWeight: 800, color: C.text,
        fontFamily: "var(--font-mono)", letterSpacing: "0.03em", lineHeight: 1,
        fontVariantNumeric: "tabular-nums",
      }}>
        {time}
      </div>
      <div style={{ fontSize: 12, color: C.text3, marginTop: 5, letterSpacing: "0.14em", fontWeight: 700 }}>
        {dateStr}
      </div>
    </div>
  );
}

// ── Contatore MTTR (con supporto pausa) ───────────────────────────────────────
export function MttrCounter({ start, paused, pausedAt }: { start?: string; paused: boolean; pausedAt: number }) {
  const [sec, setSec] = useState(0);
  useEffect(() => {
    if (!start) return;
    const startMs = new Date(start).getTime();
    if (paused) {
      // Mostra tempo congelato al momento della pausa
      // eslint-disable-next-line react-hooks/set-state-in-effect -- early-return condizionale per stato pausa; non triggera cascata
      setSec(Math.max(0, Math.floor((pausedAt - startMs) / 1000)));
      return;
    }
    const tick = () => setSec(Math.max(0, Math.floor((Date.now() - startMs) / 1000)));
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [start, paused, pausedAt]);

  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  const pad = (n: number) => String(n).padStart(2, "0");
  const color = paused ? C.text3 : sec < 3600 ? C.green : sec < 7200 ? C.yellow : C.red;

  return (
    <div style={{ textAlign: "center" }}>
      <div style={{
        fontSize: 11, fontWeight: 800, letterSpacing: "0.2em", color: C.text3,
        marginBottom: 6, textTransform: "uppercase",
        display: "flex", alignItems: "center", justifyContent: "center", gap: 5,
      }}>
        {paused ? <><Pause size={11} strokeWidth={2.5} /> IN PAUSA</> : "MTTR"}
      </div>
      <div style={{
        fontSize: "clamp(26px, 7vw, 40px)", fontWeight: 800, fontFamily: "var(--font-mono)",
        color, letterSpacing: "0.04em", lineHeight: 1,
        textShadow: paused ? "none" : `0 0 18px ${color}55`,
        transition: "color 0.5s",
        opacity: paused ? 0.6 : 1,
        fontVariantNumeric: "tabular-nums",
      }}>
        {pad(h)}:{pad(m)}:{pad(s)}
      </div>
    </div>
  );
}

// ── Hook: risolve l'ID tecnico collegato all'utente loggato ──────────────────
// Ritorna null finché non risolto, -1 se l'utente non ha un profilo tecnico.
export function useTecnicoId(): number | null {
  const { user } = useAuth();
  const [tecnicoId, setTecnicoId] = useState<number | null>(null);

  useEffect(() => {
    if (!user?.userid) return;
    let cancelled = false;
    apiGet<{ id: number }>(`/tecnici/me?utente_id=${user.userid}`)
      .then(d => { if (!cancelled) setTecnicoId(d.id); })
      .catch(() => { if (!cancelled) setTecnicoId(-1); });
    return () => { cancelled = true; };
  }, [user?.userid]);

  return tecnicoId;
}

// ── Ricerca asset (usata da ticket vocale e QR) ───────────────────────────────
export async function searchAssetsByQuery(q: string): Promise<AssetResult[]> {
  if (!q.trim()) return [];
  try {
    const res = await apiGet<{ items?: AssetResult[]; [key: string]: unknown }>(`/assets?query=${encodeURIComponent(q)}&limit=10`);
    const list = Array.isArray(res) ? res : (res.items ?? []);
    return list as AssetResult[];
  } catch { return []; }
}
