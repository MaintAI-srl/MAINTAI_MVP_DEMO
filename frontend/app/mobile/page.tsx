"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import { apiGet, apiPost, apiPut } from "../lib/api";
import { localDatetimeApiStr, localDateStr } from "../lib/datetime";
import { notify } from "@/lib/toast";
import { useAuth } from "../lib/auth";
import Skeleton from "../components/Skeleton";
import VoiceRecorder from "../components/VoiceRecorder";
import QrScanner from "../components/QrScanner";
import FirmaRapportinoModal from "../components/FirmaRapportinoModal";
import {
  Mic, QrCode, ClipboardList, Home, ChevronLeft, ChevronRight,
  Camera, Check, Play, Pause, RefreshCw, AlertTriangle, Wrench,
  ShieldCheck, Search, Package, Settings, CheckCircle2, MapPin,
  Save, HardHat, Footprints, Hand, Glasses, Shirt, Cable, CalendarCheck,
} from "lucide-react";

type AssetResult = { id: number; name: string; impianto_nome?: string; sito_nome?: string; codice?: string };

type Ticket = {
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
const C = {
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
  text3: "rgba(235,235,245,0.3)",
} as const;

const glass = {
  background: C.card,
  border: `1px solid ${C.border}`,
  borderRadius: 20,
} as const;

function prioritaColor(p: string): string {
  switch (p?.toLowerCase()) {
    case "emergenza": return C.red;
    case "alta":  return "#FF6961";
    case "media": return C.yellow;
    case "bassa": return C.green;
    default:      return C.text3;
  }
}

// ── Allarme sonoro + vibrazione per emergenze ────────────────────────────────
function playEmergencyAlarm() {
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

function triggerEmergencyAlert(titolo: string) {
  playEmergencyAlarm();
  if (typeof navigator !== "undefined" && "vibrate" in navigator) {
    navigator.vibrate([500, 150, 500, 150, 800]);
  }
  notify.error(`🚨 EMERGENZA: ${titolo}`, "EMERGENZA");
}

// ── Metadati tipo ticket (icona vettoriale + colore) ─────────────────────────
function tipoMeta(t: string): { Icon: typeof Wrench; label: string; color: string } {
  switch (t?.toUpperCase()) {
    case "BD":  return { Icon: Wrench,        label: "Guasto",     color: C.red };
    case "PM":  return { Icon: ClipboardList, label: "Preventiva", color: C.green };
    case "CM":  return { Icon: Settings,      label: "Correttiva", color: C.orange };
    case "ISP": return { Icon: Search,        label: "Ispezione",  color: C.teal };
    case "MOD-STR": return { Icon: Settings,  label: "Mod. Straordinaria", color: "#8b5cf6" };
    default:    return { Icon: Wrench,        label: t,            color: C.text3 };
  }
}

function isDispatchAlertTicket(ticket: Pick<Ticket, "tipo" | "priorita" | "stato">): boolean {
  return ticket.stato !== "Chiuso" && (
    ticket.priorita?.toLowerCase() === "emergenza" ||
    ticket.tipo?.toUpperCase() === "BD"
  );
}

// ── Icona in squircle tinta ───────────────────────────────────────────────────
function IconBadge({ Icon, color, size = 44, iconSize = 20 }: { Icon: typeof Wrench; color: string; size?: number; iconSize?: number }) {
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

// ── Pulsante circolare in vetro (back / home / refresh) ──────────────────────
const circleBtn = {
  width: 40, height: 40, borderRadius: "50%", flexShrink: 0,
  background: "rgba(255,255,255,0.06)", border: `1px solid ${C.border}`,
  color: C.text, cursor: "pointer",
  display: "flex", alignItems: "center", justifyContent: "center",
} as const;

// ── Header viste interne: titolo, back step-aware, home sempre visibile ──────
function MobileHeader({ title, subtitle, onBack, onHome }: { title: string; subtitle?: string; onBack?: () => void; onHome?: () => void }) {
  return (
    <div style={{
      display: "flex", alignItems: "center", gap: 10,
      padding: "12px 16px 10px", flexShrink: 0,
    }}>
      {onBack && (
        <button className="m-press" aria-label="Indietro" onClick={onBack} style={circleBtn}>
          <ChevronLeft size={20} strokeWidth={2.2} />
        </button>
      )}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{
          fontWeight: 800, fontSize: "clamp(17px, 2.4vw, 21px)", letterSpacing: "-0.02em",
          color: C.text, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", lineHeight: 1.15,
        }}>{title}</div>
        {subtitle && <div style={{ fontSize: 11, color: C.text3, fontWeight: 600, marginTop: 1 }}>{subtitle}</div>}
      </div>
      {onHome && (
        <button className="m-press" aria-label="Home" onClick={onHome} style={circleBtn}>
          <Home size={18} strokeWidth={2.1} />
        </button>
      )}
    </div>
  );
}

// ── Orologio corrente grande ──────────────────────────────────────────────────
function LiveClock() {
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
        fontSize: "clamp(26px, 5.5vw, 40px)", fontWeight: 800, color: C.text,
        fontFamily: "var(--font-mono)", letterSpacing: "0.03em", lineHeight: 1,
        fontVariantNumeric: "tabular-nums",
      }}>
        {time}
      </div>
      <div style={{ fontSize: 10, color: C.text3, marginTop: 4, letterSpacing: "0.14em", fontWeight: 700 }}>
        {dateStr}
      </div>
    </div>
  );
}

// ── Contatore MTTR (con supporto pausa) ───────────────────────────────────────
function MttrCounter({ start, paused, pausedAt }: { start?: string; paused: boolean; pausedAt: number }) {
  const [sec, setSec] = useState(0);
  useEffect(() => {
    if (!start) return;
    const startMs = new Date(start).getTime();
    if (paused) {
      // Mostra tempo congelato al momento della pausa
      // TODO(sec-04): revisione umana - init sincrona del contatore al valore congelato
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
        fontSize: 9, fontWeight: 800, letterSpacing: "0.2em", color: C.text3,
        marginBottom: 5, textTransform: "uppercase",
        display: "flex", alignItems: "center", justifyContent: "center", gap: 5,
      }}>
        {paused ? <><Pause size={10} strokeWidth={2.5} /> IN PAUSA</> : "MTTR"}
      </div>
      <div style={{
        fontSize: "clamp(24px, 5.5vw, 38px)", fontWeight: 800, fontFamily: "var(--font-mono)",
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

// ── Vista "Lavoro In Corso" — layout split adattivo, no scroll pagina ────────
function ActiveWorkView({
  ticket,
  onClose,
  onHome,
  onStatusChange,
}: {
  ticket: Ticket;
  onClose: () => void;
  onHome: () => void;
  onStatusChange: (id: number, stato: string) => Promise<void>;
}) {
  const tipo = tipoMeta(ticket.tipo);

  // Checklist reale dal DB (CheckPrimoLivello dell'asset)
  const [checklist, setChecklist] = useState<{ id: number; text: string }[]>([]);
  const [checklistLoading, setChecklistLoading] = useState(true);

  useEffect(() => {
    if (!ticket.asset_id) {
      // TODO(sec-04): revisione umana - setLoading(false) per early exit prima di fetch asincrono
      // eslint-disable-next-line react-hooks/set-state-in-effect -- early-return guard sincrono; nessun fetch né cascata
      setChecklistLoading(false); return;
    }
    apiGet<{ voci?: { label: string; descrizione?: string }[] } | null>(
      `/assets/${ticket.asset_id}/check`
    )
      .then(data => {
        const voci = data?.voci ?? [];
        setChecklist(voci.map((v, i) => ({
          id: i + 1,
          text: v.descrizione ? `${v.label} — ${v.descrizione}` : v.label,
        })));
      })
      .catch(() => setChecklist([]))
      .finally(() => setChecklistLoading(false));
  }, [ticket.asset_id]);

  const [checked, setChecked] = useState<Set<number>>(new Set());
  const [paused, setPaused] = useState(false);
  const [pausedAt, setPausedAt] = useState(0);
  const [started, setStarted] = useState(ticket.stato === "In corso");
  const [starting, setStarting] = useState(false);
  const [showVoice, setShowVoice] = useState(false);
  const [transcript, setTranscript] = useState("");
  const [savingVoice, setSavingVoice] = useState(false);
  const photoInputRef = useRef<HTMLInputElement>(null);

  // QR close flow: "idle" → "scanning" → "confirm" → "firma" → (close)
  const [closeState, setCloseState] = useState<"idle" | "scanning" | "confirm" | "firma">("idle");
  const [qrScannedValue, setQrScannedValue] = useState("");
  // allChecked: vero se tutte le voci sono flaggate O se non ci sono voci da verificare
  const allChecked = checklist.length === 0 || checked.size === checklist.length;

  function toggle(id: number) {
    setChecked(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  async function handleIniziaLavoro() {
    if (!allChecked) {
      notify.warning("Completa la Safety Checklist prima di avviare.", "SAFETY");
      return;
    }
    setStarting(true);
    await onStatusChange(ticket.id, "In corso");
    setStarted(true);
    setStarting(false);
  }

  async function handleTermina() {
    if (!allChecked) {
      notify.warning("Completa la Safety Checklist prima di terminare.", "SAFETY");
      return;
    }
    // Propone scansione QR ma non è obbligatoria; poi passa alla firma cliente
    if (ticket.asset_id) {
      setCloseState("scanning");
    } else {
      setCloseState("firma");
    }
  }

  function handlePausa() {
    if (!paused) { setPausedAt(Date.now()); setPaused(true); }
    else setPaused(false);
  }

  async function handleSaveVoice() {
    if (!transcript.trim()) return;
    setSavingVoice(true);
    try {
      await apiPut(`/tickets/${ticket.id}`, { note_vocali: transcript.trim() });
      notify.success("Nota vocale salvata ✓");
      setTranscript("");
      setShowVoice(false);
    } catch { notify.error("Errore salvataggio nota"); }
    setSavingVoice(false);
  }

  function handlePhotoClick() {
    photoInputRef.current?.click();
  }

  return (
    <div className="m-page" style={{ height: "100%", overflow: "hidden", padding: "0 14px calc(12px + env(safe-area-inset-bottom, 0px))" }}>

      {/* ── QR Scanner per chiusura ─────────────────────────────────────────── */}
      {closeState === "scanning" && (
        <div style={{ position: "fixed", inset: 0, zIndex: 9999, display: "flex", flexDirection: "column" }}>
          <QrScanner
            title="Verifica Presenza 📍"
            subtitle="Scansiona il QR code sull'asset per chiudere"
            onScan={(val) => { setQrScannedValue(val); setCloseState("confirm"); }}
            onCancel={() => setCloseState("idle")}
          />
          {/* Pulsante skip QR — chiusura diretta senza scansione */}
          <div style={{
            position: "absolute", bottom: 32, left: 0, right: 0,
            display: "flex", justifyContent: "center", zIndex: 10001,
          }}>
            <button
              className="m-press"
              onClick={() => setCloseState("firma")}
              style={{
                padding: "13px 28px", borderRadius: 14,
                background: "rgba(0,0,0,0.75)", border: `1px solid ${C.border}`,
                color: C.text2, fontSize: 13, fontWeight: 700, cursor: "pointer",
                backdropFilter: "blur(12px)",
              }}
            >
              Salta QR
            </button>
          </div>
        </div>
      )}

      {/* ── Modal conferma chiusura dopo QR ─────────────────────────────────── */}
      {closeState === "confirm" && (
        <div style={{
          position: "fixed", inset: 0, zIndex: 9998,
          background: "rgba(0,0,0,0.78)",
          backdropFilter: "blur(8px)", WebkitBackdropFilter: "blur(8px)",
          display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
          padding: 24,
        }}>
          <div className="m-scale-in" style={{
            background: C.cardSolid, border: `1px solid ${C.border}`,
            borderRadius: 26, padding: "28px 24px",
            width: "100%", maxWidth: 380,
            boxShadow: "0 32px 80px rgba(0,0,0,0.6)",
          }}>
            <div style={{ textAlign: "center", marginBottom: 20 }}>
              <div style={{
                width: 72, height: 72, borderRadius: 24, margin: "0 auto 14px",
                background: `${C.green}1c`, border: `1px solid ${C.green}40`,
                display: "flex", alignItems: "center", justifyContent: "center", color: C.green,
              }}>
                <CheckCircle2 size={38} strokeWidth={1.8} />
              </div>
              <div style={{ fontWeight: 800, fontSize: 21, color: C.text, marginBottom: 6, letterSpacing: "-0.02em" }}>QR Verificato</div>
              <div style={{
                fontSize: 11, color: C.green, fontWeight: 800, letterSpacing: "0.06em", marginBottom: 12,
                display: "flex", alignItems: "center", justifyContent: "center", gap: 5,
              }}>
                <MapPin size={12} strokeWidth={2.4} /> PRESENZA FISICA CONFERMATA
              </div>
              <div style={{
                fontSize: 11, color: C.text3,
                background: "rgba(255,255,255,0.05)", borderRadius: 10,
                padding: "7px 10px", wordBreak: "break-all", fontFamily: "var(--font-mono)",
              }}>
                {qrScannedValue.length > 48
                  ? qrScannedValue.substring(0, 48) + "…"
                  : qrScannedValue}
              </div>
            </div>
            <div style={{ fontSize: 14, color: C.text2, textAlign: "center", marginBottom: 22, lineHeight: 1.5 }}>
              La scansione è registrata.<br />Vuoi chiudere l&apos;intervento?
            </div>
            <div style={{ display: "flex", gap: 10 }}>
              <button
                className="m-press"
                onClick={() => setCloseState("idle")}
                style={{
                  flex: 1, padding: 15, borderRadius: 14,
                  background: "rgba(255,255,255,0.07)", border: `1px solid ${C.border}`,
                  color: C.text2, fontWeight: 700, cursor: "pointer", fontSize: 14,
                }}
              >
                Annulla
              </button>
              <button
                className="m-press"
                onClick={() => setCloseState("firma")}
                style={{
                  flex: 2, padding: 15, borderRadius: 14,
                  background: `linear-gradient(135deg, ${C.green} 0%, #209A41 100%)`,
                  border: "none", color: "#fff", fontWeight: 800, cursor: "pointer", fontSize: 15,
                  boxShadow: `0 8px 24px ${C.green}45`,
                  display: "flex", alignItems: "center", justifyContent: "center", gap: 7,
                }}
              >
                <Check size={18} strokeWidth={3} /> FIRMA CLIENTE
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Firma cliente + rapportino PDF ─────────────────────────────────── */}
      {closeState === "firma" && (
        <FirmaRapportinoModal
          ticketId={ticket.id}
          mode="download"
          onClose={() => setCloseState("idle")}
          onDone={async () => { await onStatusChange(ticket.id, "Chiuso"); }}
          onSkip={async () => { await onStatusChange(ticket.id, "Chiuso"); }}
          skipLabel="Chiudi senza firma"
        />
      )}

      {/* ── Top bar compatta ── */}
      <div style={{
        display: "flex", alignItems: "center", gap: 10,
        padding: "10px 0 8px",
        flexShrink: 0,
      }}>
        <button className="m-press" aria-label="Indietro" onClick={onClose} style={circleBtn}>
          <ChevronLeft size={20} strokeWidth={2.2} />
        </button>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 13, fontWeight: 800, letterSpacing: "-0.01em", color: C.text, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {ticket.titolo}
          </div>
          <div style={{ fontSize: 10, color: C.text3, fontWeight: 600 }}>{ticket.asset_name}</div>
        </div>
        <div style={{
          fontSize: 10, fontWeight: 800, padding: "4px 10px", borderRadius: 99, flexShrink: 0,
          color: tipo.color, background: `${tipo.color}1a`, border: `1px solid ${tipo.color}40`,
          display: "flex", alignItems: "center", gap: 5,
        }}>
          <tipo.Icon size={11} strokeWidth={2.4} /> {tipo.label}
        </div>
        <button className="m-press" aria-label="Home" onClick={onHome} style={circleBtn}>
          <Home size={18} strokeWidth={2.1} />
        </button>
      </div>

      {/* ── Layout split ── */}
      <div style={{
        display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12,
        flex: 1, minHeight: 0,
      }}>

        {/* ── SINISTRA: Titolo + azioni media + Safety Checklist ── */}
        <div className="m-scroll m-fade-up" style={{ display: "flex", flexDirection: "column", gap: 10, minHeight: 0 }}>

          {/* Titolo e asset */}
          <div style={{ ...glass, padding: 14, flexShrink: 0 }}>
            <div style={{ fontSize: "clamp(15px, 2.2vw, 20px)", fontWeight: 800, color: C.text, lineHeight: 1.25, marginBottom: 4, letterSpacing: "-0.02em" }}>
              {ticket.titolo}
            </div>
            <div style={{ fontSize: 13, fontWeight: 700, color: C.teal }}>{ticket.asset_name}</div>
            {ticket.descrizione && (
              <div style={{ fontSize: 12, color: C.text2, marginTop: 6, lineHeight: 1.45 }}>
                {ticket.descrizione}
              </div>
            )}
          </div>

          {/* Pulsanti FOTO e VOCE */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, flexShrink: 0 }}>
            {/* Input foto nascosto */}
            <input
              ref={photoInputRef}
              type="file"
              accept="image/*"
              capture="environment"
              style={{ display: "none" }}
              onChange={async (e) => {
                const file = e.target.files?.[0];
                if (!file) return;
                notify.info("Foto allegata ✓");
                e.target.value = "";
              }}
            />
            <button
              className="m-press"
              onClick={handlePhotoClick}
              style={{
                borderRadius: 18, minHeight: 76, padding: "14px 8px",
                background: `${C.blue}12`, border: `1.5px solid ${C.blue}38`,
                color: C.blue, cursor: "pointer",
                display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 7,
              }}
            >
              <Camera size={26} strokeWidth={1.9} />
              <span style={{ fontSize: 11, fontWeight: 800, letterSpacing: "0.08em" }}>FOTO</span>
            </button>
            <button
              className="m-press"
              onClick={() => setShowVoice(v => !v)}
              style={{
                borderRadius: 18, minHeight: 76, padding: "14px 8px",
                background: showVoice ? `${C.purple}22` : `${C.purple}12`,
                border: `1.5px solid ${showVoice ? `${C.purple}60` : `${C.purple}38`}`,
                color: C.purple, cursor: "pointer",
                display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 7,
                transition: "background 0.2s, border-color 0.2s",
              }}
            >
              <Mic size={26} strokeWidth={1.9} />
              <span style={{ fontSize: 11, fontWeight: 800, letterSpacing: "0.08em" }}>VOCE</span>
            </button>
          </div>

          {/* Pannello nota vocale (espandibile) */}
          {showVoice && (
            <div className="m-scale-in" style={{
              background: `${C.purple}0d`, border: `1px solid ${C.purple}30`,
              borderRadius: 16, padding: 12, display: "flex", flexDirection: "column", gap: 8, flexShrink: 0,
            }}>
              <VoiceRecorder onTranscript={(t) => setTranscript(prev => prev ? prev + " " + t : t)} disabled={savingVoice} />
              {transcript && (
                <>
                  <textarea
                    value={transcript}
                    onChange={e => setTranscript(e.target.value)}
                    rows={2}
                    style={{
                      width: "100%", resize: "none", background: `${C.purple}10`,
                      border: `1px solid ${C.purple}35`, borderRadius: 12,
                      color: C.text, padding: "10px 12px", fontSize: 16, outline: "none", boxSizing: "border-box",
                      WebkitAppearance: "none",
                    }}
                  />
                  <button className="m-press" onClick={handleSaveVoice} disabled={savingVoice} style={{
                    height: 44, borderRadius: 12, background: C.purple,
                    border: "none", color: "#fff", fontWeight: 800, fontSize: 12, cursor: "pointer",
                    display: "flex", alignItems: "center", justifyContent: "center", gap: 6,
                  }}>
                    <Save size={14} strokeWidth={2.4} />
                    {savingVoice ? "Salvataggio…" : "SALVA NOTA"}
                  </button>
                </>
              )}
            </div>
          )}

          {/* Safety Checklist — dati reali da CheckPrimoLivello */}
          <div style={{
            background: allChecked ? `${C.green}08` : `${C.red}08`,
            border: `1.5px solid ${allChecked ? `${C.green}38` : checklist.length === 0 ? C.border : `${C.red}45`}`,
            borderRadius: 18, padding: "12px 10px",
            transition: "border-color 0.3s, background 0.3s",
            flexShrink: 0,
          }}>
            <div style={{ display: "flex", alignItems: "center", gap: 7, marginBottom: 9 }}>
              <ShieldCheck size={16} strokeWidth={2.2} color={allChecked ? C.green : checklist.length === 0 ? (C.text3 as string) : C.red} />
              <span style={{
                fontSize: 10, fontWeight: 800, letterSpacing: "0.12em", textTransform: "uppercase",
                color: allChecked ? C.green : checklist.length === 0 ? C.text3 : C.red,
              }}>
                Safety
              </span>
              {checklist.length > 0 && (
                <span style={{ marginLeft: "auto", fontSize: 10, color: C.text3, fontFamily: "var(--font-mono)", fontWeight: 700 }}>
                  {checked.size}/{checklist.length}
                </span>
              )}
            </div>

            {checklistLoading ? (
              <div style={{ fontSize: 11, color: C.text3, textAlign: "center", padding: "12px 0" }}>
                Caricamento checklist...
              </div>
            ) : checklist.length === 0 ? (
              <div style={{ fontSize: 12, color: C.text2, padding: "6px 4px", lineHeight: 1.5 }}>
                Nessuna checklist configurata per questo asset.<br />
                <span style={{ color: C.text3 }}>Rispettare le procedure aziendali e indossare i DPI previsti.</span>
              </div>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
                {checklist.map(item => {
                  const isOn = checked.has(item.id);
                  return (
                    <button
                      key={item.id}
                      className="m-press"
                      onClick={() => toggle(item.id)}
                      style={{
                        display: "flex", alignItems: "center", gap: 11,
                        background: isOn ? `${C.green}14` : "rgba(255,255,255,0.04)",
                        border: `1.5px solid ${isOn ? `${C.green}70` : "rgba(255,255,255,0.10)"}`,
                        borderRadius: 14, padding: "12px 11px",
                        cursor: "pointer", textAlign: "left",
                        transition: "background 0.2s, border-color 0.2s",
                        minHeight: 52, width: "100%",
                      }}
                    >
                      <span style={{
                        width: 28, height: 28, borderRadius: "50%", flexShrink: 0,
                        background: isOn ? C.green : "rgba(255,255,255,0.06)",
                        border: `2px solid ${isOn ? C.green : "rgba(255,255,255,0.22)"}`,
                        display: "flex", alignItems: "center", justifyContent: "center",
                        color: "#fff", transition: "background 0.2s, border-color 0.2s",
                      }}>
                        {isOn && <Check size={15} strokeWidth={3.2} />}
                      </span>
                      <span style={{
                        fontSize: 12, lineHeight: 1.35,
                        color: isOn ? `${C.green}dd` : C.text,
                        textDecoration: isOn ? "line-through" : "none",
                        fontWeight: isOn ? 500 : 700, transition: "color 0.2s",
                      }}>
                        {item.text}
                      </span>
                    </button>
                  );
                })}
              </div>
            )}

            {allChecked && checklist.length > 0 && (
              <div style={{
                fontSize: 11, color: C.green, fontWeight: 800, textAlign: "center", paddingTop: 9,
                display: "flex", alignItems: "center", justifyContent: "center", gap: 5,
              }}>
                <CheckCircle2 size={13} strokeWidth={2.5} /> SICUREZZA VERIFICATA
              </div>
            )}
          </div>
        </div>

        {/* ── DESTRA: Orologio + MTTR + Date + Azioni ── */}
        <div className="m-scroll m-fade-up m-d1" style={{ display: "flex", flexDirection: "column", gap: 10, minHeight: 0 }}>

          {/* Orologio */}
          <div style={{ ...glass, padding: "14px 10px", flexShrink: 0 }}>
            <LiveClock />
          </div>

          {/* MTTR */}
          <div style={{
            ...glass,
            background: paused ? "rgba(235,235,245,0.04)" : C.card,
            padding: "14px 10px", flexShrink: 0,
            transition: "background 0.3s",
          }}>
            <MttrCounter start={ticket.execution_start} paused={paused} pausedAt={pausedAt} />
          </div>

          {/* Date pianificate */}
          <div style={{ display: "flex", flexDirection: "column", gap: 7, flexShrink: 0 }}>
            {[
              { label: "INIZIO", value: ticket.planned_start, color: C.purple, ItemIcon: Play },
              { label: "FINE",   value: ticket.planned_finish, color: C.green, ItemIcon: CalendarCheck },
            ].map(item => (
              <div key={item.label} style={{
                background: C.card, border: `1px solid ${item.color}28`,
                borderLeft: `3px solid ${item.color}`, borderRadius: 14, padding: "9px 11px",
              }}>
                <div style={{
                  fontSize: 9, color: C.text3, fontWeight: 800, letterSpacing: "0.14em", marginBottom: 3,
                  display: "flex", alignItems: "center", gap: 5,
                }}>
                  <item.ItemIcon size={10} strokeWidth={2.5} color={item.color} /> {item.label}
                </div>
                {item.value ? (
                  <>
                    <div style={{ fontSize: "clamp(14px, 2.6vw, 19px)", fontWeight: 800, color: item.color, fontFamily: "var(--font-mono)", lineHeight: 1, fontVariantNumeric: "tabular-nums" }}>
                      {new Date(item.value).toLocaleTimeString("it-IT", { hour: "2-digit", minute: "2-digit" })}
                    </div>
                    <div style={{ fontSize: 10, color: C.text3, marginTop: 2 }}>
                      {new Date(item.value).toLocaleDateString("it-IT", { day: "2-digit", month: "2-digit", year: "2-digit" })}
                    </div>
                  </>
                ) : (
                  <div style={{ fontSize: 16, color: "rgba(255,255,255,0.12)", fontWeight: 800 }}>—</div>
                )}
              </div>
            ))}
          </div>

          {/* Pulsanti azione */}
          <div style={{ display: "flex", flexDirection: "column", gap: 9, flexShrink: 0, marginTop: "auto" }}>
            {/* INIZIA — sempre visibile se non ancora avviato */}
            {!started && (
              <button
                className="m-press"
                onClick={handleIniziaLavoro}
                disabled={!allChecked || starting}
                style={{
                  height: 62, borderRadius: 18,
                  background: allChecked
                    ? `linear-gradient(135deg, ${C.blue} 0%, #0064D2 100%)`
                    : "rgba(255,255,255,0.05)",
                  border: allChecked ? "none" : `1.5px solid ${C.blue}50`,
                  color: allChecked ? "#fff" : `${C.blue}90`,
                  fontWeight: 800, fontSize: 16, letterSpacing: "0.02em",
                  cursor: allChecked && !starting ? "pointer" : "default",
                  boxShadow: allChecked ? `0 8px 28px ${C.blue}50` : "none",
                  display: "flex", alignItems: "center", justifyContent: "center", gap: 9,
                  transition: "background 0.25s, box-shadow 0.25s",
                  opacity: allChecked ? 1 : 0.8,
                }}
              >
                {starting
                  ? "…"
                  : <><Play size={20} strokeWidth={2.4} fill={allChecked ? "#fff" : "none"} /> INIZIA LAVORO</>}
              </button>
            )}

            {/* TERMINA — visibile solo se già avviato */}
            {started && (
              <button
                className="m-press"
                onClick={handleTermina}
                disabled={!allChecked}
                style={{
                  height: 58, borderRadius: 18,
                  background: allChecked
                    ? `linear-gradient(135deg, ${C.green} 0%, #209A41 100%)`
                    : `${C.green}10`,
                  border: allChecked ? "none" : `1.5px solid ${C.green}28`,
                  color: allChecked ? "#fff" : `${C.green}55`,
                  fontWeight: 800, fontSize: 15,
                  cursor: allChecked ? "pointer" : "not-allowed",
                  boxShadow: allChecked ? `0 8px 28px ${C.green}45` : "none",
                  display: "flex", alignItems: "center", justifyContent: "center", gap: 8,
                  transition: "background 0.25s, box-shadow 0.25s",
                }}
              >
                <CheckCircle2 size={19} strokeWidth={2.3} /> TERMINA
              </button>
            )}

            {/* PAUSA — solo se avviato */}
            {started && (
              <button
                className="m-press"
                onClick={handlePausa}
                style={{
                  height: 52, borderRadius: 18,
                  background: paused ? `${C.yellow}16` : "rgba(255,255,255,0.05)",
                  border: `1.5px solid ${paused ? `${C.yellow}50` : "rgba(255,255,255,0.12)"}`,
                  color: paused ? C.yellow : C.text2,
                  fontWeight: 800, fontSize: 14, cursor: "pointer",
                  display: "flex", alignItems: "center", justifyContent: "center", gap: 7,
                  transition: "background 0.25s, border-color 0.25s, color 0.25s",
                }}
              >
                {paused ? <Play size={17} strokeWidth={2.4} /> : <Pause size={17} strokeWidth={2.4} />}
                {paused ? "RIPRENDI" : "PAUSA"}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Main mobile page ──────────────────────────────────────────────────────────
export default function MobileHomePage() {
  const { user } = useAuth();
  const [mounted, setMounted] = useState(false);
  const [tecnicoId, setTecnicoId] = useState<number | null>(null);
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [activeView, setActiveView] = useState<Ticket | null>(null);
  const [homeView, setHomeView] = useState<"home" | "ticket_vocale" | "piano_odierno">("home");
  // Ticket Vocale
  const [voiceStep, setVoiceStep] = useState<"listen" | "confirm_asset" | "form">("listen");
  const [voiceTranscript, setVoiceTranscript] = useState("");
  const [foundAssets, setFoundAssets] = useState<AssetResult[]>([]);
  const [selectedAsset, setSelectedAsset] = useState<AssetResult | null>(null);
  const [manualSearch, setManualSearch] = useState("");
  const [manualAssets, setManualAssets] = useState<AssetResult[]>([]);
  const [nuovoTipo, setNuovoTipo] = useState<"BD"|"PM"|"CM">("BD");
  const [nuovoPriorita, setNuovoPriorita] = useState<"Alta"|"Media"|"Bassa">("Alta");
  const [nuovoDesc, setNuovoDesc] = useState("");
  const [savingTicket, setSavingTicket] = useState(false);
  // Ticket Vocale — metodo di input
  const [voiceQrInputMethod, setVoiceQrInputMethod] = useState<"voice" | "qr">("voice");
  const [showVoiceQrScan, setShowVoiceQrScan] = useState(false);
  // Piano Odierno
  const [dpiChecked, setDpiChecked] = useState<Record<string, boolean>>({});
  const [dpiConfirmed, setDpiConfirmed] = useState(false);
  const [pianoDiOggi, setPianoDiOggi] = useState<Ticket[]>([]);
  const [loadingPiano, setLoadingPiano] = useState(false);

  // Traccia ID emergenze già viste — evita falsi allarmi al primo caricamento
  const seenEmergencyIds = useRef<Set<number>>(new Set());
  const activeViewRef = useRef<Ticket | null>(null);

  useEffect(() => { setMounted(true); }, []);
  useEffect(() => { activeViewRef.current = activeView; }, [activeView]);

  useEffect(() => {
    if (!user?.userid || !mounted) return;
    apiGet<{ id: number }>(`/tecnici/me?utente_id=${user.userid}`)
      .then(d => setTecnicoId(d.id))
      .catch(() => { setTecnicoId(-1); setLoading(false); });
  }, [user, mounted]);

  const loadTickets = useCallback(async (isInitialLoad = false) => {
    if (tecnicoId === null || !mounted) return;
    if (tecnicoId === -1) { setLoading(false); return; }
    try {
      const d = await apiGet<{ items?: Ticket[] }>(`/tickets?tecnico_id=${tecnicoId}&limit=50`);
      const items: Ticket[] = d.items ?? [];
      setTickets(items);
      // Primo caricamento: segna tutte le emergenze come già viste (nessun allarme)
      if (isInitialLoad) {
        items.forEach(t => {
          if (isDispatchAlertTicket(t)) {
            seenEmergencyIds.current.add(t.id);
          }
        });
      }
      // Se c'è un ticket in corso e nessuna vista attiva, apri automaticamente
      const inCorso = items.find(t => t.stato === "In corso");
      if (inCorso && !activeViewRef.current) setActiveView(inCorso);
    } catch {
      notify.error("Errore nel caricamento degli interventi.", "MOBILE");
    }
    setLoading(false);
  }, [tecnicoId, mounted]);

  useEffect(() => { loadTickets(true); }, [loadTickets]);

  // ── Polling 30s per nuove emergenze assegnate ─────────────────────────────
  useEffect(() => {
    if (tecnicoId === null || tecnicoId === -1 || !mounted) return;
    const poll = async () => {
      try {
        const d = await apiGet<{ items?: Ticket[] }>(`/tickets?tecnico_id=${tecnicoId}&limit=50`);
        const items: Ticket[] = d.items ?? [];
        items.forEach(t => {
          if (isDispatchAlertTicket(t) && !seenEmergencyIds.current.has(t.id)) {
            seenEmergencyIds.current.add(t.id);
            triggerEmergencyAlert(t.titolo);
          }
        });
        setTickets(items);
      } catch { /* silenzioso — non disturbare il tecnico con errori di rete */ }
    };
    const id = setInterval(poll, 30_000);
    return () => clearInterval(id);
  }, [tecnicoId, mounted]);

  const updateStatus = async (tid: number, newStato: string) => {
    try {
      const body: Record<string, string | null> = { stato: newStato };
      if (newStato === "In corso") body.execution_start = localDatetimeApiStr();
      else if (newStato === "Chiuso") body.execution_finish = localDatetimeApiStr();
      await apiPut(`/tickets/${tid}`, body);
      setTickets(prev => prev.map(t =>
        t.id === tid ? { ...t, stato: newStato, execution_start: newStato === "In corso" ? localDatetimeApiStr() : t.execution_start } : t
      ));
      // Se stiamo chiudendo o mettendo in pausa, torna alla lista
      if (newStato === "Chiuso" || newStato === "Pianificato") {
        setActiveView(null);
        await loadTickets();
      }
      notify.success(
        newStato === "In corso" ? "✅ Intervento avviato" :
        newStato === "Chiuso"   ? "✅ Intervento completato!" : `Stato: ${newStato}`, "TICKET"
      );
    } catch {
      notify.error("Errore aggiornamento stato.", "TICKET");
    }
  };

  const DPI_ITEMS = [
    "Casco di protezione",
    "Scarpe antinfortunistiche",
    "Guanti da lavoro",
    "Occhiali di protezione",
    "Gilet ad alta visibilità",
    "Imbracatura (se lavori in quota)",
  ];
  const DPI_ICONS = [HardHat, Footprints, Hand, Glasses, Shirt, Cable];

  async function searchAssetsByQuery(q: string): Promise<AssetResult[]> {
    if (!q.trim()) return [];
    try {
      const res = await apiGet<{ items?: AssetResult[]; [key: string]: unknown }>(`/assets?query=${encodeURIComponent(q)}&limit=10`);
      const list = Array.isArray(res) ? res : (res.items ?? []);
      return list as AssetResult[];
    } catch { return []; }
  }

  async function handleVoiceTranscript(text: string) {
    setVoiceTranscript(text);
    // Cerca prima con il testo completo
    const assets = await searchAssetsByQuery(text);
    // Se non trova nulla, prova ogni parola significativa (>2 caratteri) separatamente
    if (assets.length === 0) {
      const words = text.toLowerCase().split(/\s+/).filter(w => w.length > 2);
      const seen = new Set<number>();
      for (const word of words) {
        const res = await searchAssetsByQuery(word);
        for (const a of res) {
          if (!seen.has(a.id)) { seen.add(a.id); assets.push(a); }
        }
        if (assets.length >= 10) break;
      }
    }
    if (assets.length > 0) {
      setFoundAssets(assets);
      setVoiceStep("confirm_asset");
    } else {
      notify.error("Nessun asset trovato. Riprova o cerca manualmente sotto.");
    }
  }

  async function handleManualSearch(q: string) {
    setManualSearch(q);
    if (q.length < 2) { setManualAssets([]); return; }
    const assets = await searchAssetsByQuery(q);
    setManualAssets(assets ?? []);
  }

  async function handleQrScanForTicket(value: string) {
    let assets: AssetResult[] = [];

    // 1. Prova a parsare come URL → cerca per token /check/{token} o /assets/{id}
    try {
      const url = new URL(value);
      const parts = url.pathname.split("/").filter(Boolean);
      // Pattern: /check/{token}
      if (parts[0] === "check" && parts[1]) {
        try {
          const data = await apiGet<{ asset_id?: number } | null>(`/check/public/${parts[1]}`);
          if (data?.asset_id) {
            const asset = await apiGet<AssetResult>(`/assets/${data.asset_id}`);
            if (asset) assets = [asset];
          }
        } catch { /* ignore */ }
      }
      // Pattern: /assets/{id}
      if (assets.length === 0) {
        const ai = parts.indexOf("assets");
        if (ai !== -1 && parts[ai + 1] && /^\d+$/.test(parts[ai + 1])) {
          try {
            const asset = await apiGet<AssetResult>(`/assets/${parts[ai + 1]}`);
            if (asset) assets = [asset];
          } catch { /* ignore */ }
        }
      }
      // Ultimo segmento come query
      if (assets.length === 0) {
        const last = parts[parts.length - 1];
        if (last) assets = await searchAssetsByQuery(last);
      }
    } catch {
      // Non è un URL — cerca direttamente
    }

    // 2. Ricerca testo completo
    if (assets.length === 0) {
      assets = await searchAssetsByQuery(value);
    }

    // 3. Prova come ID numerico
    if (assets.length === 0 && /^\d+$/.test(value.trim())) {
      try {
        const asset = await apiGet<AssetResult>(`/assets/${value.trim()}`);
        if (asset) assets = [asset];
      } catch { /* ignore */ }
    }

    if (assets.length > 0) {
      setFoundAssets(assets);
      setVoiceStep("confirm_asset");
    } else {
      notify.error("QR non riconosciuto — nessun asset trovato.", "QR");
    }
  }

  async function saveTicketVocale() {
    if (!selectedAsset) return;
    setSavingTicket(true);
    try {
      await apiPost("/tickets", {
        titolo: `Intervento su ${selectedAsset.name}`,
        asset_id: selectedAsset.id,
        tipo: nuovoTipo,
        priorita: nuovoPriorita,
        descrizione: nuovoDesc || null,
        durata_stimata_ore: 2,
        fascia_oraria: "diurna",
        stato: "Aperto",
      });
      notify.success("Ticket creato!");
      setHomeView("home");
      setVoiceStep("listen");
      setVoiceTranscript("");
      setFoundAssets([]);
      setSelectedAsset(null);
      setNuovoDesc("");
      loadTickets();
    } catch (e) {
      notify.error(e instanceof Error ? e.message : "Errore salvataggio ticket");
    } finally { setSavingTicket(false); }
  }

  async function loadPianoOdierno() {
    if (!tecnicoId) return;
    setLoadingPiano(true);
    try {
      const today = localDateStr();
      const res = await apiGet<{ items: Ticket[] }>(`/tickets?tecnico_id=${tecnicoId}&stato=Pianificato,In corso&limit=100`);
      const items = res.items ?? [];
      const todayItems = items.filter(t => {
        if (!t.planned_start) return false;
        return t.planned_start.startsWith(today);
      });
      todayItems.sort((a, b) => (a.planned_start ?? "").localeCompare(b.planned_start ?? ""));
      setPianoDiOggi(todayItems);
    } catch { notify.error("Errore caricamento piano"); }
    finally { setLoadingPiano(false); }
  }

  const todayStr = new Date().toLocaleDateString("it-IT", { weekday: "long", day: "numeric", month: "short" });
  const allDpiChecked = DPI_ITEMS.every(item => dpiChecked[item]);

  // Reset completo e ritorno alla home
  function goHomeFromVocale() {
    setHomeView("home"); setVoiceStep("listen"); setVoiceTranscript(""); setFoundAssets([]);
    setSelectedAsset(null); setManualSearch(""); setManualAssets([]); setNuovoDesc(""); setShowVoiceQrScan(false);
  }

  // Back step-aware: torna allo step precedente, non sempre alla home
  function backFromVocale() {
    if (showVoiceQrScan) { setShowVoiceQrScan(false); return; }
    if (voiceStep === "form") {
      setSelectedAsset(null);
      setVoiceStep(foundAssets.length > 0 ? "confirm_asset" : "listen");
      return;
    }
    if (voiceStep === "confirm_asset") { setVoiceStep("listen"); setFoundAssets([]); setVoiceTranscript(""); return; }
    goHomeFromVocale();
  }

  function goHomeFromPiano() {
    setHomeView("home"); setDpiConfirmed(false); setDpiChecked({});
  }

  // NB: queste viste sono funzioni di render (chiamate come funzioni, non come
  // componenti JSX): definirle come componenti annidati causava il remount del
  // sottoalbero a ogni render del parent → gli input perdevano il focus dopo
  // ogni carattere e la registrazione vocale veniva interrotta.
  function renderTicketVocale() {
    return (
      <div className="m-page" style={{ height: "100%", overflow: "hidden" }}>

        {/* QR Scanner per identificazione asset */}
        {showVoiceQrScan && (
          <QrScanner
            title="Identifica Asset 📦"
            subtitle="Inquadra il QR code sull'asset da segnalare"
            onScan={async (val) => {
              setShowVoiceQrScan(false);
              await handleQrScanForTicket(val);
            }}
            onCancel={() => setShowVoiceQrScan(false)}
          />
        )}

        <MobileHeader
          title="Ticket Vocale"
          subtitle="Segnala un guasto in pochi secondi"
          onBack={backFromVocale}
          onHome={goHomeFromVocale}
        />

        <div className="m-scroll" style={{ flex: 1, minHeight: 0, padding: "6px 16px calc(16px + env(safe-area-inset-bottom, 0px))", display: "flex", flexDirection: "column", gap: 16 }}>

          {/* STEP: listen */}
          {voiceStep === "listen" && (
            <div className="m-fade-up" style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 16, paddingTop: 4 }}>

              {/* Segmented control metodo input — stile iOS */}
              <div style={{
                display: "flex", gap: 0, background: "rgba(255,255,255,0.06)",
                borderRadius: 14, padding: 3, width: "100%", maxWidth: 520,
                border: `1px solid ${C.border}`,
              }}>
                {([
                  { key: "voice" as const, label: "Voce / Testo", OptIcon: Mic },
                  { key: "qr" as const,    label: "QR Code",      OptIcon: QrCode },
                ]).map(opt => {
                  const active = voiceQrInputMethod === opt.key;
                  return (
                    <button
                      key={opt.key}
                      onClick={() => setVoiceQrInputMethod(opt.key)}
                      style={{
                        flex: 1, padding: "12px 8px", borderRadius: 11, border: "none", cursor: "pointer",
                        fontWeight: 700, fontSize: 14, transition: "background 0.25s, color 0.25s, box-shadow 0.25s",
                        background: active ? "rgba(255,255,255,0.13)" : "transparent",
                        color: active ? C.text : C.text3,
                        boxShadow: active ? "0 2px 10px rgba(0,0,0,0.35)" : "none",
                        display: "flex", alignItems: "center", justifyContent: "center", gap: 7,
                      }}
                    >
                      <opt.OptIcon size={15} strokeWidth={2.2} /> {opt.label}
                    </button>
                  );
                })}
              </div>

              {/* ── Modalità VOCE / TESTO ── */}
              {voiceQrInputMethod === "voice" && (
                <>
                  <div style={{ textAlign: "center", color: C.text2, fontSize: 15, lineHeight: 1.5 }}>
                    Premi il microfono e pronuncia<br/>il nome dell&apos;asset da segnalare
                  </div>
                  <div style={{ width: "100%", maxWidth: 520 }}>
                    <VoiceRecorder onTranscript={handleVoiceTranscript} />
                  </div>
                  {voiceTranscript && (
                    <div className="m-scale-in" style={{
                      background: `${C.indigo}14`, border: `1px solid ${C.indigo}40`,
                      borderRadius: 14, padding: "12px 16px", width: "100%", maxWidth: 520,
                      color: "#B3B1FF", fontSize: 14,
                    }}>
                      <div style={{ fontSize: 10, color: C.text3, marginBottom: 4, fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase" }}>Trascritto</div>
                      {voiceTranscript}
                    </div>
                  )}
                  <div style={{ display: "flex", alignItems: "center", gap: 12, width: "100%", maxWidth: 520 }}>
                    <div style={{ flex: 1, height: 1, background: C.border }} />
                    <span style={{ color: C.text3, fontSize: 12, fontWeight: 600 }}>oppure cerca manualmente</span>
                    <div style={{ flex: 1, height: 1, background: C.border }} />
                  </div>
                  <div style={{ width: "100%", maxWidth: 520, position: "relative" }}>
                    <Search size={17} strokeWidth={2.2} style={{ position: "absolute", left: 15, top: "50%", transform: "translateY(-50%)", color: C.text3, pointerEvents: "none" }} />
                    <input
                      value={manualSearch}
                      onChange={e => handleManualSearch(e.target.value)}
                      placeholder="Cerca asset per nome..."
                      autoComplete="off"
                      style={{
                        width: "100%", boxSizing: "border-box",
                        background: "rgba(255,255,255,0.06)", border: `1px solid ${C.border}`,
                        borderRadius: 14, color: C.text, padding: "14px 16px 14px 42px",
                        fontSize: 16, outline: "none", WebkitAppearance: "none",
                      }}
                    />
                  </div>
                  {manualAssets.length > 0 && (
                    <div className="m-cols" style={{ width: "100%", maxWidth: 520 }}>
                      {manualAssets.map(a => (
                        <button key={a.id} className="m-press m-scale-in" onClick={() => { setSelectedAsset(a); setVoiceStep("form"); }}
                          style={{
                            ...glass, borderRadius: 16, padding: "13px 15px", color: C.text,
                            cursor: "pointer", textAlign: "left",
                            display: "flex", alignItems: "center", gap: 12,
                          }}>
                          <IconBadge Icon={Package} color={C.teal} size={36} iconSize={16} />
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={{ fontWeight: 700, fontSize: 14, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{a.name}</div>
                            {a.sito_nome && <div style={{ fontSize: 11, color: C.text3, marginTop: 2 }}>{a.sito_nome}{a.impianto_nome ? ` · ${a.impianto_nome}` : ""}</div>}
                          </div>
                          <ChevronRight size={16} color={C.text3 as string} />
                        </button>
                      ))}
                    </div>
                  )}
                </>
              )}

              {/* ── Modalità QR CODE ── */}
              {voiceQrInputMethod === "qr" && (
                <div className="m-fade-up" style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 18, width: "100%", maxWidth: 520, paddingTop: 4 }}>
                  <div style={{ textAlign: "center", color: C.text2, fontSize: 15, lineHeight: 1.5 }}>
                    Scansiona il QR code sull&apos;asset<br/>per identificarlo automaticamente
                  </div>
                  <button
                    className="m-press"
                    onClick={() => setShowVoiceQrScan(true)}
                    style={{
                      width: "100%", padding: "30px 20px", borderRadius: 24,
                      border: `2px dashed ${C.green}55`,
                      background: `${C.green}0a`,
                      color: C.green, cursor: "pointer",
                      display: "flex", flexDirection: "column", alignItems: "center", gap: 14,
                    }}
                  >
                    <div style={{
                      width: 84, height: 84, borderRadius: 28,
                      background: `${C.green}16`, border: `1px solid ${C.green}38`,
                      display: "flex", alignItems: "center", justifyContent: "center",
                    }}>
                      <QrCode size={44} strokeWidth={1.6} />
                    </div>
                    <div style={{ textAlign: "center" }}>
                      <div style={{ fontWeight: 800, fontSize: 17, letterSpacing: "0.02em", color: C.text }}>APRI SCANNER QR</div>
                      <div style={{ fontSize: 12, color: C.text3, marginTop: 4 }}>Richiede accesso alla fotocamera</div>
                    </div>
                  </button>
                  <div style={{ color: C.text3, fontSize: 12, textAlign: "center" }}>
                    Funziona con Chrome, Edge e Safari 17+
                  </div>
                </div>
              )}
            </div>
          )}

          {/* STEP: confirm_asset */}
          {voiceStep === "confirm_asset" && foundAssets.length > 0 && (
            <div className="m-fade-up" style={{ display: "flex", flexDirection: "column", gap: 12, maxWidth: 640, width: "100%", margin: "0 auto" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <div style={{ flex: 1, height: 1, background: C.border }} />
                <span style={{ fontSize: 12, color: C.text3, whiteSpace: "nowrap", fontWeight: 600 }}>
                  {foundAssets.length} asset trovati{voiceTranscript ? ` per “${voiceTranscript}”` : ""}
                </span>
                <div style={{ flex: 1, height: 1, background: C.border }} />
              </div>
              <div style={{ fontSize: 13, color: C.text2, textAlign: "center" }}>
                Tocca l&apos;asset corretto per procedere
              </div>
              <div className="m-cols">
                {foundAssets.map((a, idx) => (
                  <button key={a.id} className="m-press m-scale-in" onClick={() => { setSelectedAsset(a); setVoiceStep("form"); }}
                    style={{
                      display: "flex", alignItems: "center", gap: 13, padding: "15px 14px",
                      background: idx === 0 ? `${C.green}0d` : C.card,
                      border: `1.5px solid ${idx === 0 ? `${C.green}48` : C.border}`,
                      borderRadius: 18, cursor: "pointer", textAlign: "left",
                      animationDelay: `${Math.min(idx * 0.05, 0.3)}s`,
                    }}>
                    <IconBadge Icon={idx === 0 ? CheckCircle2 : Package} color={idx === 0 ? C.green : (C.text3 as string)} size={40} iconSize={18} />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontWeight: 800, fontSize: 15, color: idx === 0 ? "#9FEFB5" : C.text, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{a.name}</div>
                      <div style={{ fontSize: 11, color: C.text3, marginTop: 2 }}>
                        {[a.codice && `Cod. ${a.codice}`, a.sito_nome, a.impianto_nome].filter(Boolean).join(" · ")}
                      </div>
                    </div>
                    <ChevronRight size={18} color={(idx === 0 ? C.green : C.text3) as string} />
                  </button>
                ))}
              </div>
              <button className="m-press" onClick={() => { setVoiceStep("listen"); setFoundAssets([]); setVoiceTranscript(""); }}
                style={{
                  background: "none", border: `1px solid ${C.border}`, borderRadius: 14,
                  color: C.text2, fontSize: 13, cursor: "pointer", padding: "12px", marginTop: 2, fontWeight: 600,
                  display: "flex", alignItems: "center", justifyContent: "center", gap: 6,
                }}>
                <RefreshCw size={14} strokeWidth={2.2} /> Riprova ricerca
              </button>
            </div>
          )}

          {/* STEP: form */}
          {voiceStep === "form" && selectedAsset && (
            <div className="m-fade-up" style={{ display: "flex", flexDirection: "column", gap: 16, maxWidth: 640, width: "100%", margin: "0 auto" }}>
              <div style={{
                background: `${C.indigo}12`, border: `1px solid ${C.indigo}38`,
                borderRadius: 16, padding: "13px 16px",
                display: "flex", alignItems: "center", gap: 12,
              }}>
                <IconBadge Icon={Package} color={C.indigo} size={40} iconSize={18} />
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontSize: 10, color: C.text3, marginBottom: 2, fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase" }}>Asset selezionato</div>
                  <div style={{ fontWeight: 800, fontSize: 16, color: C.text, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{selectedAsset.name}</div>
                </div>
              </div>

              <div>
                <div style={{ fontSize: 11, color: C.text2, marginBottom: 9, textTransform: "uppercase", letterSpacing: "0.08em", fontWeight: 700 }}>Tipo intervento</div>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 9 }}>
                  {(["BD","PM","CM"] as const).map(t => {
                    const meta = tipoMeta(t);
                    const active = nuovoTipo === t;
                    return (
                      <button key={t} className="m-press" onClick={() => setNuovoTipo(t)}
                        style={{
                          padding: "14px 6px", borderRadius: 16, fontWeight: 800, fontSize: 13, cursor: "pointer",
                          border: `1.5px solid ${active ? meta.color : C.border}`,
                          transition: "background 0.2s, border-color 0.2s, color 0.2s",
                          background: active ? `${meta.color}1c` : "rgba(255,255,255,0.04)",
                          color: active ? meta.color : C.text3,
                          display: "flex", flexDirection: "column", alignItems: "center", gap: 6,
                        }}>
                        <meta.Icon size={18} strokeWidth={2.1} />
                        {t}
                      </button>
                    );
                  })}
                </div>
              </div>

              <div>
                <div style={{ fontSize: 11, color: C.text2, marginBottom: 9, textTransform: "uppercase", letterSpacing: "0.08em", fontWeight: 700 }}>Priorità</div>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 9 }}>
                  {(["Alta","Media","Bassa"] as const).map(p => {
                    const col = p === "Alta" ? C.red : p === "Media" ? C.orange : (C.text3 as string);
                    const active = nuovoPriorita === p;
                    return (
                      <button key={p} className="m-press" onClick={() => setNuovoPriorita(p)}
                        style={{
                          padding: "14px 6px", borderRadius: 16, fontWeight: 800, fontSize: 13, cursor: "pointer",
                          border: `1.5px solid ${active ? col : C.border}`,
                          transition: "background 0.2s, border-color 0.2s, color 0.2s",
                          background: active ? `${col}1c` : "rgba(255,255,255,0.04)",
                          color: active ? (p === "Bassa" ? C.text2 : col) : C.text3,
                        }}>{p}</button>
                    );
                  })}
                </div>
              </div>

              <div>
                <div style={{ fontSize: 11, color: C.text2, marginBottom: 8, textTransform: "uppercase", letterSpacing: "0.08em", fontWeight: 700 }}>Descrizione (opzionale)</div>
                <textarea value={nuovoDesc} onChange={e => setNuovoDesc(e.target.value)} rows={3} placeholder="Note sull'intervento..."
                  style={{
                    width: "100%", background: "rgba(255,255,255,0.06)", border: `1px solid ${C.border}`,
                    borderRadius: 14, color: C.text, padding: "13px 15px", fontSize: 16,
                    resize: "none", outline: "none", boxSizing: "border-box", WebkitAppearance: "none",
                  }} />
              </div>

              <button className="m-press" onClick={saveTicketVocale} disabled={savingTicket}
                style={{
                  padding: "17px", borderRadius: 18, border: "none",
                  background: savingTicket ? `${C.indigo}55` : `linear-gradient(135deg, ${C.indigo}, #4644C9)`,
                  color: "#fff", fontWeight: 800, fontSize: 16,
                  cursor: savingTicket ? "not-allowed" : "pointer",
                  boxShadow: `0 10px 30px ${C.indigo}48`,
                  display: "flex", alignItems: "center", justifyContent: "center", gap: 8,
                }}>
                <Save size={18} strokeWidth={2.3} />
                {savingTicket ? "Salvataggio..." : "SALVA TICKET"}
              </button>
            </div>
          )}
        </div>
      </div>
    );
  }

  function renderPianoOdierno() {
    return (
      <div className="m-page" style={{ height: "100%", overflow: "hidden" }}>
        <MobileHeader
          title="Piano Odierno"
          subtitle={todayStr.charAt(0).toUpperCase() + todayStr.slice(1)}
          onBack={dpiConfirmed ? () => { setDpiConfirmed(false); setDpiChecked({}); } : goHomeFromPiano}
          onHome={goHomeFromPiano}
        />

        {/* DPI Step */}
        {!dpiConfirmed && (
          <div style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column", padding: "0 16px calc(14px + env(safe-area-inset-bottom, 0px))" }}>
            <div className="m-fade-up" style={{ textAlign: "center", padding: "4px 8px 14px", flexShrink: 0 }}>
              <div style={{
                width: 60, height: 60, borderRadius: 20, margin: "0 auto 10px",
                background: `${C.orange}18`, border: `1px solid ${C.orange}40`,
                display: "flex", alignItems: "center", justifyContent: "center", color: C.orange,
              }}>
                <HardHat size={30} strokeWidth={1.9} />
              </div>
              <div style={{ fontWeight: 800, fontSize: "clamp(19px, 2.6vw, 24px)", color: C.text, marginBottom: 5, letterSpacing: "-0.02em" }}>Verifica DPI</div>
              <div style={{ fontSize: 13, color: C.text2, lineHeight: 1.5, maxWidth: 480, margin: "0 auto" }}>
                Conferma di indossare tutti i dispositivi di protezione individuale
              </div>
            </div>

            <div className="m-scroll m-cols m-fade-up m-d1" style={{ flex: 1, minHeight: 0, paddingBottom: 10 }}>
              {DPI_ITEMS.map((item, idx) => {
                const isOn = !!dpiChecked[item];
                const ItemIcon = DPI_ICONS[idx] ?? ShieldCheck;
                return (
                  <button key={item} className="m-press" onClick={() => setDpiChecked(prev => ({ ...prev, [item]: !prev[item] }))}
                    style={{
                      display: "flex", alignItems: "center", gap: 13, padding: "13px 15px", borderRadius: 18,
                      cursor: "pointer", textAlign: "left", minHeight: 62,
                      transition: "background 0.2s, border-color 0.2s",
                      background: isOn ? `${C.green}10` : C.card,
                      border: `1.5px solid ${isOn ? `${C.green}50` : C.border}`,
                    }}>
                    <IconBadge Icon={ItemIcon} color={isOn ? C.green : (C.text3 as string)} size={40} iconSize={19} />
                    <span style={{
                      flex: 1, fontSize: 14, lineHeight: 1.3,
                      color: isOn ? `${C.green}dd` : C.text,
                      fontWeight: isOn ? 600 : 700,
                      textDecoration: isOn ? "line-through" : "none",
                      transition: "color 0.2s",
                    }}>{item}</span>
                    <span style={{
                      width: 26, height: 26, borderRadius: "50%", flexShrink: 0,
                      background: isOn ? C.green : "transparent",
                      border: `2px solid ${isOn ? C.green : "rgba(255,255,255,0.25)"}`,
                      display: "flex", alignItems: "center", justifyContent: "center",
                      color: "#fff", transition: "background 0.2s, border-color 0.2s",
                    }}>
                      {isOn && <Check size={14} strokeWidth={3.2} />}
                    </span>
                  </button>
                );
              })}
            </div>

            <div className="m-fade-up m-d2" style={{ flexShrink: 0, paddingTop: 6 }}>
              <button
                className="m-press"
                disabled={!allDpiChecked}
                onClick={() => { setDpiConfirmed(true); loadPianoOdierno(); }}
                style={{
                  width: "100%", padding: "17px", borderRadius: 18, fontWeight: 800, fontSize: 16,
                  cursor: allDpiChecked ? "pointer" : "not-allowed", border: "none",
                  transition: "background 0.3s, box-shadow 0.3s, color 0.3s",
                  background: allDpiChecked ? `linear-gradient(135deg, ${C.green}, #209A41)` : "rgba(255,255,255,0.06)",
                  color: allDpiChecked ? "#fff" : C.text3,
                  boxShadow: allDpiChecked ? `0 10px 30px ${C.green}45` : "none",
                  display: "flex", alignItems: "center", justifyContent: "center", gap: 8,
                }}>
                {allDpiChecked
                  ? <><CheckCircle2 size={19} strokeWidth={2.3} /> ACCEDI AL PIANO</>
                  : `ACCEDI AL PIANO (${Object.values(dpiChecked).filter(Boolean).length}/${DPI_ITEMS.length})`}
              </button>
            </div>
          </div>
        )}

        {/* Piano Step */}
        {dpiConfirmed && (
          <div className="m-scroll" style={{ flex: 1, minHeight: 0, padding: "4px 16px calc(16px + env(safe-area-inset-bottom, 0px))", display: "flex", flexDirection: "column", gap: 12 }}>

            {loadingPiano && (
              <div style={{ textAlign: "center", color: C.text3, padding: 40, fontSize: 14 }}>Caricamento piano...</div>
            )}

            {!loadingPiano && pianoDiOggi.length === 0 && (
              <div className="m-fade-up" style={{ textAlign: "center", padding: "48px 20px" }}>
                <div style={{
                  width: 68, height: 68, borderRadius: 24, margin: "0 auto 14px",
                  background: `${C.green}14`, border: `1px solid ${C.green}38`,
                  display: "flex", alignItems: "center", justifyContent: "center", color: C.green,
                }}>
                  <CalendarCheck size={32} strokeWidth={1.8} />
                </div>
                <div style={{ color: C.text2, fontSize: 15, fontWeight: 600 }}>Nessun intervento pianificato per oggi</div>
              </div>
            )}

            {!loadingPiano && pianoDiOggi.length > 0 && (
              <div className="m-cols">
                {pianoDiOggi.map((t, idx) => {
                  const startTime = t.planned_start ? new Date(t.planned_start).toLocaleTimeString("it-IT", { hour: "2-digit", minute: "2-digit" }) : null;
                  const endTime = t.planned_finish ? new Date(t.planned_finish).toLocaleTimeString("it-IT", { hour: "2-digit", minute: "2-digit" }) : null;
                  const tInfo = tipoMeta(t.tipo);
                  return (
                    <button key={t.id} className="m-press m-fade-up" onClick={() => setActiveView(t)}
                      style={{
                        ...glass, width: "100%", borderRadius: 20, padding: "14px 15px",
                        cursor: "pointer", textAlign: "left",
                        display: "flex", alignItems: "center", gap: 13,
                        animationDelay: `${Math.min(idx * 0.06, 0.4)}s`,
                      }}>
                      <IconBadge Icon={tInfo.Icon} color={tInfo.color} size={46} iconSize={21} />
                      <div style={{ flex: 1, minWidth: 0 }}>
                        {startTime && (
                          <div style={{ fontSize: 11, color: C.teal, fontWeight: 800, fontFamily: "var(--font-mono)", marginBottom: 3, fontVariantNumeric: "tabular-nums" }}>
                            {startTime}{endTime ? ` – ${endTime}` : ""}
                          </div>
                        )}
                        <div style={{ fontWeight: 800, fontSize: 15, color: C.text, marginBottom: 4, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", letterSpacing: "-0.01em" }}>{t.titolo}</div>
                        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                          <span style={{
                            fontSize: 10, padding: "2px 8px", borderRadius: 99, fontWeight: 800,
                            background: `${tInfo.color}1c`, color: tInfo.color, border: `1px solid ${tInfo.color}40`,
                          }}>{t.tipo}</span>
                          <span style={{ fontSize: 11, color: C.text3, fontWeight: 600 }}>{t.durata_stimata_ore}h</span>
                          <span style={{ fontSize: 11, color: prioritaColor(t.priorita), fontWeight: 800 }}>{t.priorita}</span>
                        </div>
                        {t.asset_name && (
                          <div style={{ fontSize: 11, color: C.text3, marginTop: 4, display: "flex", alignItems: "center", gap: 4 }}>
                            <Package size={11} strokeWidth={2.2} /> {t.asset_name}
                          </div>
                        )}
                      </div>
                      <ChevronRight size={18} color={C.text3 as string} style={{ flexShrink: 0 }} />
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        )}
      </div>
    );
  }

  if (!mounted) return null;

  if (loading) {
    return (
      <div className="m-page" style={{ padding: "20px 16px", display: "flex", flexDirection: "column", gap: 16 }}>
        <Skeleton variant="block" width="60%" height={28} />
        <Skeleton variant="block" width="100%" height={14} />
        <div style={{ marginTop: 12 }}><Skeleton variant="card" /></div>
        <Skeleton variant="card" />
      </div>
    );
  }

  // ── Vista "Lavoro In Corso" ───────────────────────────────────────────────
  if (activeView) {
    // Sincronizza dati freschi
    const fresh = tickets.find(t => t.id === activeView.id) ?? activeView;
    return (
      <ActiveWorkView
        ticket={fresh}
        onClose={() => setActiveView(null)}
        onHome={() => { setActiveView(null); setHomeView("home"); setDpiConfirmed(false); setDpiChecked({}); }}
        onStatusChange={updateStatus}
      />
    );
  }

  if (homeView === "ticket_vocale") return renderTicketVocale();
  if (homeView === "piano_odierno") return renderPianoOdierno();

  // ── Home ─────────────────────────────────────────────────────────────────
  const emergenze = tickets.filter(isDispatchAlertTicket);
  const inCorsoList = tickets.filter(t => t.stato === "In corso");

  return (
    <div className="m-page" style={{ height: "100%", overflow: "hidden", padding: "0 16px calc(14px + env(safe-area-inset-bottom, 0px))" }}>

      {/* Header saluto */}
      <div className="m-fade-up" style={{ padding: "14px 0 10px", display: "flex", justifyContent: "space-between", alignItems: "center", flexShrink: 0 }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontWeight: 800, fontSize: "clamp(20px, 3vw, 26px)", color: C.text, letterSpacing: "-0.025em", lineHeight: 1.15 }}>
            Ciao, {user?.username ?? "Tecnico"}
          </div>
          <div style={{ fontSize: 12, color: C.text3, marginTop: 3, fontWeight: 600, display: "flex", alignItems: "center", gap: 10 }}>
            <span style={{ display: "flex", alignItems: "center", gap: 5 }}>
              <span style={{ width: 7, height: 7, borderRadius: "50%", background: inCorsoList.length > 0 ? C.orange : (C.text3 as string), display: "inline-block" }} />
              {inCorsoList.length} in corso
            </span>
            <span style={{ display: "flex", alignItems: "center", gap: 5 }}>
              <span style={{ width: 7, height: 7, borderRadius: "50%", background: C.blue, display: "inline-block" }} />
              {tickets.filter(t => t.stato === "Pianificato").length} pianificati
            </span>
          </div>
        </div>
        <button
          className="m-press"
          aria-label="Aggiorna"
          onClick={async () => { setRefreshing(true); await loadTickets(); setRefreshing(false); }}
          disabled={refreshing}
          style={{ ...circleBtn, color: C.text2, cursor: refreshing ? "wait" : "pointer" }}
        >
          <RefreshCw size={17} strokeWidth={2.2} style={refreshing ? { animation: "spin 1s linear infinite" } : undefined} />
        </button>
      </div>

      {/* Banner no profilo */}
      {tecnicoId === -1 && (
        <div className="m-fade-up" style={{
          marginBottom: 10, background: `${C.yellow}0d`, border: `1px solid ${C.yellow}38`,
          borderRadius: 18, padding: "13px 15px", display: "flex", gap: 12, alignItems: "center", flexShrink: 0,
        }}>
          <IconBadge Icon={AlertTriangle} color={C.yellow} size={40} iconSize={19} />
          <div>
            <div style={{ fontWeight: 800, fontSize: 13, color: C.yellow, marginBottom: 2 }}>Profilo tecnico non collegato</div>
            <div style={{ fontSize: 12, color: C.text2, lineHeight: 1.45 }}>Contatta il responsabile per associare l&apos;account.</div>
          </div>
        </div>
      )}

      {/* Banner EMERGENZE attive — priorità massima */}
      {emergenze.map(t => (
        <button key={t.id} className="m-press m-fade-up" onClick={() => setActiveView(t)}
          style={{
            display: "flex", alignItems: "center", gap: 13, width: "100%",
            marginBottom: 10, padding: "13px 15px", cursor: "pointer",
            background: `linear-gradient(110deg, ${C.red}1f 0%, ${C.red}0a 100%)`,
            border: `1.5px solid ${C.red}55`, borderRadius: 20,
            textAlign: "left", flexShrink: 0,
          }}>
          <div style={{
            width: 46, height: 46, borderRadius: 16, flexShrink: 0,
            background: `${C.red}22`, border: `1px solid ${C.red}50`,
            display: "flex", alignItems: "center", justifyContent: "center", color: C.red,
            animation: "mEmergencyRing 1.6s ease-out infinite",
          }}>
            <AlertTriangle size={22} strokeWidth={2.2} />
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontWeight: 800, fontSize: 11, color: C.red, textTransform: "uppercase", letterSpacing: "0.1em", animation: "mBreath 1.4s ease-in-out infinite" }}>
              BD / emergenza assegnata
            </div>
            <div style={{ fontWeight: 700, fontSize: 14, color: C.text, marginTop: 2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {t.titolo}
            </div>
            {t.asset_name && <div style={{ fontSize: 12, color: C.text2, marginTop: 1 }}>{t.asset_name}</div>}
          </div>
          <ChevronRight size={20} color={C.red} style={{ flexShrink: 0 }} />
        </button>
      ))}

      {/* 2 TILE PRINCIPALI — griglia adattiva phone/tablet */}
      <div className="m-tiles" style={{ paddingTop: 2 }}>
        <button
          className="m-press m-fade-up m-d1"
          onClick={() => { setHomeView("ticket_vocale"); setVoiceStep("listen"); setVoiceTranscript(""); setFoundAssets([]); setManualSearch(""); setManualAssets([]); setSelectedAsset(null); setNuovoDesc(""); setVoiceQrInputMethod("voice"); setShowVoiceQrScan(false); }}
          style={{
            minHeight: 130, borderRadius: 26, border: `1px solid ${C.indigo}45`, cursor: "pointer",
            display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 12,
            position: "relative", overflow: "hidden", padding: 18,
            background: `radial-gradient(140% 120% at 20% 0%, ${C.indigo}33 0%, transparent 50%), linear-gradient(150deg, #181640 0%, #0E0C2A 70%)`,
            boxShadow: `0 14px 44px ${C.indigo}28`,
          }}
        >
          <div style={{
            width: "clamp(58px, 8vw, 74px)", height: "clamp(58px, 8vw, 74px)", borderRadius: "28%",
            background: `${C.indigo}28`, border: `1px solid ${C.indigo}50`,
            display: "flex", alignItems: "center", justifyContent: "center", color: "#A5A1FF",
            boxShadow: `0 0 30px ${C.indigo}40`,
          }}>
            <Mic size={32} strokeWidth={1.8} />
          </div>
          <div style={{ textAlign: "center" }}>
            <div style={{ fontWeight: 800, fontSize: "clamp(18px, 2.4vw, 23px)", color: C.text, letterSpacing: "-0.02em", lineHeight: 1.2 }}>
              Apri Ticket <span style={{ color: "#A5A1FF" }}>Vocale</span>
            </div>
            <div style={{ fontSize: 12, color: C.text3, marginTop: 4, fontWeight: 500 }}>Riconosce l&apos;asset dalla voce o dal QR</div>
          </div>
        </button>

        <button
          className="m-press m-fade-up m-d2"
          onClick={() => { setHomeView("piano_odierno"); setDpiConfirmed(false); setDpiChecked({}); setPianoDiOggi([]); }}
          style={{
            minHeight: 130, borderRadius: 26, border: `1px solid ${C.teal}40`, cursor: "pointer",
            display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 12,
            position: "relative", overflow: "hidden", padding: 18,
            background: `radial-gradient(140% 120% at 80% 0%, ${C.teal}26 0%, transparent 50%), linear-gradient(150deg, #0C2B2E 0%, #081C20 70%)`,
            boxShadow: `0 14px 44px ${C.teal}1f`,
          }}
        >
          <div style={{
            width: "clamp(58px, 8vw, 74px)", height: "clamp(58px, 8vw, 74px)", borderRadius: "28%",
            background: `${C.teal}1f`, border: `1px solid ${C.teal}48`,
            display: "flex", alignItems: "center", justifyContent: "center", color: C.teal,
            boxShadow: `0 0 30px ${C.teal}33`,
          }}>
            <ClipboardList size={32} strokeWidth={1.8} />
          </div>
          <div style={{ textAlign: "center" }}>
            <div style={{ fontWeight: 800, fontSize: "clamp(18px, 2.4vw, 23px)", color: C.text, letterSpacing: "-0.02em", lineHeight: 1.2 }}>
              Piano <span style={{ color: C.teal }}>Odierno</span>
            </div>
            <div style={{ fontSize: 12, color: C.text3, marginTop: 4, fontWeight: 500 }}>Verifica DPI e accedi al piano</div>
          </div>
        </button>
      </div>

      {/* Ticket IN CORSO (se presenti) */}
      {inCorsoList.length > 0 && (
        <div className="m-fade-up m-d3" style={{ marginTop: 12, flexShrink: 0, maxHeight: "30%", display: "flex", flexDirection: "column", minHeight: 0 }}>
          <div style={{ fontSize: 10, fontWeight: 800, color: C.text3, textTransform: "uppercase", letterSpacing: "0.12em", marginBottom: 7, flexShrink: 0 }}>
            In corso ora
          </div>
          <div className="m-scroll" style={{ minHeight: 0 }}>
            {inCorsoList.map(t => {
              const tInfo = tipoMeta(t.tipo);
              return (
                <button key={t.id} className="m-press" onClick={() => setActiveView(t)}
                  style={{
                    width: "100%", display: "flex", alignItems: "center", gap: 12, padding: "12px 14px",
                    background: `${C.orange}0c`, border: `1.5px solid ${C.orange}42`,
                    borderRadius: 18, cursor: "pointer", marginBottom: 8, textAlign: "left",
                  }}>
                  <IconBadge Icon={tInfo.Icon} color={C.orange} size={40} iconSize={18} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontWeight: 800, fontSize: 14, color: C.text, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{t.titolo}</div>
                    <div style={{ fontSize: 12, color: C.text2, marginTop: 2 }}>{t.asset_name}</div>
                  </div>
                  <span style={{ fontSize: 12, color: C.orange, fontWeight: 800, flexShrink: 0, display: "flex", alignItems: "center", gap: 4 }}>
                    APRI <ChevronRight size={14} strokeWidth={2.5} />
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
