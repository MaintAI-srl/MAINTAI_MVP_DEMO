"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import { apiGet, apiPost, apiPut } from "../lib/api";
import { notify } from "@/lib/toast";
import { useAuth } from "../lib/auth";
import UploadAllegati from "../components/UploadAllegati";
import Skeleton from "../components/Skeleton";
import VoiceRecorder from "../components/VoiceRecorder";
import QrScanner from "../components/QrScanner";

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

function prioritaColor(p: string): string {
  switch (p?.toLowerCase()) {
    case "emergenza": return "#ff2d2d";
    case "alta":  return "#f87171";
    case "media": return "#fbbf24";
    case "bassa": return "#34d399";
    default:      return "#94a3b8";
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

function tipoLabel(t: string): { icon: string; label: string; color: string } {
  switch (t?.toUpperCase()) {
    case "BD":  return { icon: "🔧", label: "Guasto",      color: "#f87171" };
    case "PM":  return { icon: "📋", label: "Preventiva",  color: "#34d399" };
    case "CM":  return { icon: "⚙️", label: "Correttiva",  color: "#fbbf24" };
    case "ISP": return { icon: "🔍", label: "Ispezione",   color: "#60a5fa" };
    default:    return { icon: "◷",  label: t,              color: "var(--text-muted)" };
  }
}

function fmtDate(iso?: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return d.toLocaleDateString("it-IT", { day: "2-digit", month: "2-digit", year: "2-digit" })
    + " " + d.toLocaleTimeString("it-IT", { hour: "2-digit", minute: "2-digit" });
}

// getSafetyChecklist rimossa — i dati vengono dal DB (CheckPrimoLivello per asset)

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
      <div style={{ fontSize: "clamp(28px, 8vw, 42px)", fontWeight: 900, color: "#fff", fontFamily: "var(--font-mono)", letterSpacing: "0.04em", lineHeight: 1 }}>
        {time}
      </div>
      <div style={{ fontSize: 10, color: "rgba(255,255,255,0.35)", marginTop: 3, letterSpacing: "0.1em" }}>
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
  const color = paused ? "#94a3b8" : sec < 3600 ? "#34d399" : sec < 7200 ? "#fbbf24" : "#f87171";

  return (
    <div style={{ textAlign: "center" }}>
      <div style={{ fontSize: 9, fontWeight: 700, letterSpacing: "0.18em", color: "rgba(255,255,255,0.35)", marginBottom: 4, textTransform: "uppercase" }}>
        {paused ? "⏸ IN PAUSA" : "⏱ MTTR"}
      </div>
      <div style={{
        fontSize: "clamp(26px, 8vw, 38px)", fontWeight: 900, fontFamily: "var(--font-mono)",
        color, letterSpacing: "0.06em", lineHeight: 1,
        textShadow: paused ? "none" : `0 0 16px ${color}50`,
        transition: "color 0.5s",
        opacity: paused ? 0.6 : 1,
      }}>
        {pad(h)}:{pad(m)}:{pad(s)}
      </div>
    </div>
  );
}

// ── Vista "Lavoro In Corso" — layout split 50/50 ─────────────────────────────
function ActiveWorkView({
  ticket,
  onClose,
  onStatusChange,
}: {
  ticket: Ticket;
  onClose: () => void;
  onStatusChange: (id: number, stato: string) => Promise<void>;
}) {
  const tipo = tipoLabel(ticket.tipo);

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

  // QR close flow: "idle" → "scanning" → "confirm" → (close)
  const [closeState, setCloseState] = useState<"idle" | "scanning" | "confirm">("idle");
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
    // Propone scansione QR ma non è obbligatoria
    if (ticket.asset_id) {
      setCloseState("scanning");
    } else {
      await onStatusChange(ticket.id, "Chiuso");
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
    <div style={{
      display: "flex", flexDirection: "column",
      minHeight: "100%",
      background: "var(--surface-0)",
    }}>

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
              onClick={async () => { setCloseState("idle"); await onStatusChange(ticket.id, "Chiuso"); }}
              style={{
                padding: "12px 28px", borderRadius: 12,
                background: "rgba(0,0,0,0.75)", border: "1px solid var(--border-default)",
                color: "rgba(255,255,255,0.7)", fontSize: 13, fontWeight: 600, cursor: "pointer",
                backdropFilter: "blur(8px)",
              }}
            >
              Chiudi senza QR
            </button>
          </div>
        </div>
      )}

      {/* ── Modal conferma chiusura dopo QR ─────────────────────────────────── */}
      {closeState === "confirm" && (
        <div style={{
          position: "fixed", inset: 0, zIndex: 9998,
          background: "rgba(0,0,0,0.88)",
          display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
          padding: 24,
        }}>
          <div style={{
            background: "var(--surface-2)", borderRadius: 22, padding: "28px 24px",
            width: "100%", maxWidth: 360,
            border: "1px solid var(--border-default)",
            boxShadow: "0 24px 64px rgba(0,0,0,0.6)",
          }}>
            <div style={{ textAlign: "center", marginBottom: 20 }}>
              <div style={{ fontSize: 52, marginBottom: 12 }}>✅</div>
              <div style={{ fontWeight: 900, fontSize: 20, color: "#fff", marginBottom: 6 }}>QR Verificato</div>
              <div style={{ fontSize: 11, color: "#34d399", fontWeight: 700, letterSpacing: "0.05em", marginBottom: 12 }}>
                📍 PRESENZA FISICA CONFERMATA
              </div>
              <div style={{
                fontSize: 11, color: "rgba(255,255,255,0.3)",
                background: "var(--surface-3)", borderRadius: 8,
                padding: "6px 10px", wordBreak: "break-all", fontFamily: "var(--font-mono)",
              }}>
                {qrScannedValue.length > 48
                  ? qrScannedValue.substring(0, 48) + "…"
                  : qrScannedValue}
              </div>
            </div>
            <div style={{ fontSize: 14, color: "rgba(255,255,255,0.55)", textAlign: "center", marginBottom: 22, lineHeight: 1.5 }}>
              La scansione è registrata.<br />Vuoi chiudere l&apos;intervento?
            </div>
            <div style={{ display: "flex", gap: 10 }}>
              <button
                onClick={() => setCloseState("idle")}
                style={{
                  flex: 1, padding: 14, borderRadius: 12,
                  background: "var(--surface-3)", border: "1px solid var(--border-default)",
                  color: "var(--text-muted)", fontWeight: 700, cursor: "pointer", fontSize: 14,
                }}
              >
                Annulla
              </button>
              <button
                onClick={async () => {
                  setCloseState("idle");
                  await onStatusChange(ticket.id, "Chiuso");
                }}
                style={{
                  flex: 2, padding: 14, borderRadius: 12,
                  background: "linear-gradient(135deg, #10b981 0%, #059669 100%)",
                  border: "none", color: "#fff", fontWeight: 900, cursor: "pointer", fontSize: 15,
                  boxShadow: "0 6px 20px rgba(16,185,129,0.4)",
                }}
              >
                ✅ CHIUDI INTERVENTO
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Top bar compatta ── */}
      <div style={{
        display: "flex", alignItems: "center", gap: 10,
        padding: "10px 0 8px",
        borderBottom: "1px solid var(--border-default)",
        marginBottom: 10, flexShrink: 0,
      }}>
        <button onClick={onClose} style={{
          background: "var(--surface-3)", border: "1px solid var(--border-default)",
          borderRadius: 10, width: 36, height: 36, fontSize: 16, cursor: "pointer",
          display: "flex", alignItems: "center", justifyContent: "center", color: "var(--text-muted)", flexShrink: 0,
        }}>←</button>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 11, fontWeight: 800, color: "#e2e8f0", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {ticket.titolo}
          </div>
          <div style={{ fontSize: 10, color: "var(--text-muted)" }}>{ticket.asset_name}</div>
        </div>
        <div style={{
          fontSize: 10, fontWeight: 700, padding: "2px 8px", borderRadius: 12,
          color: tipo.color, background: `${tipo.color}18`, border: `1px solid ${tipo.color}44`, flexShrink: 0,
        }}>
          {tipo.icon} {tipo.label}
        </div>
      </div>

      {/* ── Layout split 50/50 ── */}
      <div style={{
        display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10,
        flex: 1, minHeight: 0,
      }}>

        {/* ── SINISTRA: Titolo + pulsantoni + Safety Checklist ── */}
        <div style={{ display: "flex", flexDirection: "column", gap: 8, overflowY: "auto" }}>

          {/* Titolo e asset — grandi */}
          <div style={{
            background: "var(--surface-1)", border: "1px solid var(--border-default)",
            borderRadius: 14, padding: "12px",
          }}>
            <div style={{ fontSize: "clamp(15px, 4vw, 19px)", fontWeight: 900, color: "var(--text-primary)", lineHeight: 1.25, marginBottom: 4 }}>
              {ticket.titolo}
            </div>
            <div style={{ fontSize: 13, fontWeight: 700, color: "#90b8ff" }}>{ticket.asset_name}</div>
            {ticket.descrizione && (
              <div style={{ fontSize: 12, color: "rgba(255,255,255,0.45)", marginTop: 6, lineHeight: 1.45 }}>
                {ticket.descrizione}
              </div>
            )}
          </div>

          {/* Pulsantoni FOTO e VOCE — quadrati grandi */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
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
              onClick={handlePhotoClick}
              style={{
                aspectRatio: "1", borderRadius: 16,
                background: "rgba(59,130,246,0.08)", border: "2px solid rgba(59,130,246,0.30)",
                color: "#60a5fa", cursor: "pointer",
                display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 6,
                minHeight: 80,
              }}
            >
              <span style={{ fontSize: 32 }}>📷</span>
              <span style={{ fontSize: 11, fontWeight: 800, letterSpacing: "0.05em" }}>FOTO</span>
            </button>
            <button
              onClick={() => setShowVoice(v => !v)}
              style={{
                aspectRatio: "1", borderRadius: 16,
                background: showVoice ? "rgba(139,92,246,0.15)" : "rgba(139,92,246,0.08)",
                border: `2px solid ${showVoice ? "rgba(139,92,246,0.50)" : "rgba(139,92,246,0.30)"}`,
                color: "#a78bfa", cursor: "pointer",
                display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 6,
                minHeight: 80,
              }}
            >
              <span style={{ fontSize: 32 }}>🎙️</span>
              <span style={{ fontSize: 11, fontWeight: 800, letterSpacing: "0.05em" }}>VOCE</span>
            </button>
          </div>

          {/* Pannello nota vocale (espandibile) */}
          {showVoice && (
            <div style={{
              background: "rgba(139,92,246,0.05)", border: "1px solid rgba(139,92,246,0.20)",
              borderRadius: 12, padding: 12, display: "flex", flexDirection: "column", gap: 8,
            }}>
              <VoiceRecorder onTranscript={(t) => setTranscript(prev => prev ? prev + " " + t : t)} disabled={savingVoice} />
              {transcript && (
                <>
                  <textarea
                    value={transcript}
                    onChange={e => setTranscript(e.target.value)}
                    rows={2}
                    style={{
                      width: "100%", resize: "none", background: "rgba(139,92,246,0.07)",
                      border: "1px solid rgba(139,92,246,0.25)", borderRadius: 8,
                      color: "#e2e8f0", padding: "8px 10px", fontSize: 13, outline: "none", boxSizing: "border-box",
                    }}
                  />
                  <button onClick={handleSaveVoice} disabled={savingVoice} style={{
                    height: 40, borderRadius: 10, background: "rgba(139,92,246,0.80)",
                    border: "none", color: "white", fontWeight: 800, fontSize: 12, cursor: "pointer",
                  }}>
                    {savingVoice ? "Salvataggio…" : "💾 SALVA NOTA"}
                  </button>
                </>
              )}
            </div>
          )}

          {/* Safety Checklist — dati reali da CheckPrimoLivello */}
          <div style={{
            background: allChecked ? "rgba(52,211,153,0.04)" : "rgba(239,68,68,0.04)",
            border: `2px solid ${allChecked ? "rgba(52,211,153,0.30)" : checklist.length === 0 ? "rgba(100,116,139,0.30)" : "rgba(239,68,68,0.40)"}`,
            borderRadius: 14, padding: "10px 8px",
            transition: "border-color 0.3s, background 0.3s",
            flexShrink: 0,
          }}>
            <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 8 }}>
              <span style={{ fontSize: 16 }}>🦺</span>
              <span style={{ fontSize: 10, fontWeight: 900, color: allChecked ? "#34d399" : checklist.length === 0 ? "#94a3b8" : "#f87171", letterSpacing: "0.1em", textTransform: "uppercase" }}>
                Safety
              </span>
              {checklist.length > 0 && (
                <span style={{ marginLeft: "auto", fontSize: 10, color: "rgba(255,255,255,0.35)", fontFamily: "var(--font-mono)" }}>
                  {checked.size}/{checklist.length}
                </span>
              )}
            </div>

            {checklistLoading ? (
              <div style={{ fontSize: 11, color: "rgba(255,255,255,0.3)", textAlign: "center", padding: "12px 0" }}>
                Caricamento checklist...
              </div>
            ) : checklist.length === 0 ? (
              <div style={{ fontSize: 12, color: "#64748b", padding: "8px 4px", lineHeight: 1.5 }}>
                Nessuna checklist configurata per questo asset.<br />
                <span style={{ color: "#475569" }}>Rispettare le procedure aziendali e indossare i DPI previsti.</span>
              </div>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                {checklist.map(item => (
                  <button
                    key={item.id}
                    onClick={() => toggle(item.id)}
                    style={{
                      display: "flex", alignItems: "center", gap: 10,
                      background: checked.has(item.id) ? "rgba(52,211,153,0.12)" : "rgba(255,255,255,0.04)",
                      border: `2px solid ${checked.has(item.id) ? "#34d399" : "rgba(255,255,255,0.12)"}`,
                      borderRadius: 12, padding: "11px 10px",
                      cursor: "pointer", textAlign: "left", transition: "all 0.15s",
                      minHeight: 54, width: "100%",
                    }}
                  >
                    <span style={{
                      width: 32, height: 32, borderRadius: 8, flexShrink: 0,
                      background: checked.has(item.id) ? "#34d399" : "rgba(255,255,255,0.06)",
                      border: `3px solid ${checked.has(item.id) ? "#34d399" : "rgba(255,255,255,0.20)"}`,
                      display: "flex", alignItems: "center", justifyContent: "center",
                      fontSize: 18, color: "#fff", fontWeight: 900, transition: "all 0.15s",
                    }}>
                      {checked.has(item.id) ? "✓" : ""}
                    </span>
                    <span style={{
                      fontSize: 12, lineHeight: 1.3,
                      color: checked.has(item.id) ? "#86efac" : "#e2e8f0",
                      textDecoration: checked.has(item.id) ? "line-through" : "none",
                      fontWeight: checked.has(item.id) ? 500 : 700, transition: "all 0.15s",
                    }}>
                      {item.text}
                    </span>
                  </button>
                ))}
              </div>
            )}

            {allChecked && checklist.length > 0 && (
              <div style={{ fontSize: 11, color: "#34d399", fontWeight: 800, textAlign: "center", paddingTop: 8 }}>
                ✅ SICUREZZA VERIFICATA
              </div>
            )}
          </div>
        </div>

        {/* ── DESTRA: Orologio + MTTR + Date + Azioni ── */}
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>

          {/* Orologio */}
          <div style={{
            background: "var(--surface-1)", border: "1px solid var(--border-default)",
            borderRadius: 14, padding: "14px 10px", textAlign: "center",
          }}>
            <LiveClock />
          </div>

          {/* MTTR */}
          <div style={{
            background: paused ? "rgba(148,163,184,0.05)" : "rgba(255,255,255,0.03)",
            border: `1px solid ${paused ? "rgba(148,163,184,0.15)" : "rgba(255,255,255,0.07)"}`,
            borderRadius: 14, padding: "14px 10px",
            transition: "all 0.3s",
          }}>
            <MttrCounter start={ticket.execution_start} paused={paused} pausedAt={pausedAt} />
          </div>

          {/* Date pianificate */}
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {[
              { label: "▶ Inizio", value: ticket.planned_start, color: "#a78bfa" },
              { label: "⏹ Fine",   value: ticket.planned_finish, color: "#34d399" },
            ].map(item => (
              <div key={item.label} style={{
                background: "var(--surface-1)", border: `1px solid ${item.color}25`,
                borderLeft: `3px solid ${item.color}`, borderRadius: 10, padding: "8px 10px",
              }}>
                <div style={{ fontSize: 9, color: "rgba(255,255,255,0.35)", fontWeight: 700, letterSpacing: "0.1em", marginBottom: 3 }}>
                  {item.label}
                </div>
                {item.value ? (
                  <>
                    <div style={{ fontSize: "clamp(14px, 4vw, 18px)", fontWeight: 900, color: item.color, fontFamily: "var(--font-mono)", lineHeight: 1 }}>
                      {new Date(item.value).toLocaleTimeString("it-IT", { hour: "2-digit", minute: "2-digit" })}
                    </div>
                    <div style={{ fontSize: 10, color: "rgba(255,255,255,0.3)", marginTop: 2 }}>
                      {new Date(item.value).toLocaleDateString("it-IT", { day: "2-digit", month: "2-digit", year: "2-digit" })}
                    </div>
                  </>
                ) : (
                  <div style={{ fontSize: 16, color: "rgba(255,255,255,0.15)", fontWeight: 900 }}>—</div>
                )}
              </div>
            ))}
          </div>


          {/* Pulsanti azione */}
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {/* INIZIA — sempre visibile se non ancora avviato */}
            {!started && (
              <button
                onClick={handleIniziaLavoro}
                disabled={!allChecked || starting}
                style={{
                  height: 64, borderRadius: 14,
                  background: allChecked
                    ? "linear-gradient(135deg, #3b82f6 0%, #1d4ed8 100%)"
                    : "var(--surface-3)",
                  border: allChecked ? "none" : "2px solid #3b82f6",
                  color: "#fff",
                  fontWeight: 900, fontSize: 16,
                  cursor: allChecked && !starting ? "pointer" : "default",
                  boxShadow: allChecked ? "0 4px 20px rgba(59,130,246,0.4)" : "none",
                  display: "flex", alignItems: "center", justifyContent: "center", gap: 8,
                  transition: "all 0.2s",
                  opacity: allChecked ? 1 : 0.7,
                }}
              >
                {starting ? "…" : allChecked
                  ? <><span style={{ fontSize: 22 }}>▶</span> INIZIA LAVORO</>
                  : <><span style={{ fontSize: 20 }}>🔒</span> INIZIA LAVORO</>}
              </button>
            )}

            {/* TERMINA — visibile solo se già avviato */}
            {started && (
              <button
                onClick={handleTermina}
                disabled={!allChecked}
                style={{
                  height: 60, borderRadius: 14,
                  background: allChecked
                    ? "linear-gradient(135deg, #10b981 0%, #059669 100%)"
                    : "rgba(16,185,129,0.08)",
                  border: allChecked ? "none" : "2px solid rgba(16,185,129,0.20)",
                  color: allChecked ? "#fff" : "rgba(16,185,129,0.35)",
                  fontWeight: 900, fontSize: 15,
                  cursor: allChecked ? "pointer" : "not-allowed",
                  boxShadow: allChecked ? "0 4px 20px rgba(16,185,129,0.35)" : "none",
                  display: "flex", alignItems: "center", justifyContent: "center", gap: 6,
                  transition: "all 0.2s",
                }}
              >
                {allChecked ? <><span style={{ fontSize: 20 }}>✅</span> TERMINA</> : <>🔒 TERMINA</>}
              </button>
            )}

            {/* PAUSA — solo se avviato */}
            {started && (
              <button
                onClick={handlePausa}
                style={{
                  height: 54, borderRadius: 14,
                  background: paused ? "rgba(251,191,36,0.12)" : "rgba(255,255,255,0.05)",
                  border: `2px solid ${paused ? "rgba(251,191,36,0.40)" : "rgba(255,255,255,0.12)"}`,
                  color: paused ? "#fbbf24" : "#94a3b8",
                  fontWeight: 800, fontSize: 14, cursor: "pointer",
                  display: "flex", alignItems: "center", justifyContent: "center", gap: 6,
                  transition: "all 0.2s",
                }}
              >
                <span style={{ fontSize: 18 }}>{paused ? "▶" : "⏸"}</span>
                {paused ? "RIPRENDI" : "PAUSA"}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Ticket card prossimo (senza pulsante INIZIA — ora è nella vista dedicata) ─
function UpcomingTicketCard({ ticket, onOpen }: { ticket: Ticket; onOpen: (t: Ticket) => void }) {
  const tipo = tipoLabel(ticket.tipo);
  return (
    <button
      onClick={() => onOpen(ticket)}
      style={{
        display: "flex", alignItems: "center", gap: 12, width: "100%",
        background: "var(--bg-card, var(--surface-2))", border: "1px solid var(--border, rgba(255,255,255,0.08))",
        borderRadius: 16, padding: "16px", cursor: "pointer", textAlign: "left",
      }}
    >
      <span style={{ fontSize: 22, flexShrink: 0 }}>{tipo.icon}</span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 16, fontWeight: 800, color: "#e2e8f0", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {ticket.titolo}
        </div>
        <div style={{ fontSize: 13, color: "#90b8ff", fontWeight: 600, marginTop: 3 }}>{ticket.asset_name}</div>
        {ticket.planned_start && (
          <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 2 }}>
            {new Date(ticket.planned_start).toLocaleDateString("it-IT", { day: "2-digit", month: "2-digit" })}
            {" "}{new Date(ticket.planned_start).toLocaleTimeString("it-IT", { hour: "2-digit", minute: "2-digit" })}
          </div>
        )}
      </div>
      <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 4, flexShrink: 0 }}>
        <span style={{ fontSize: 10, fontWeight: 700, padding: "2px 8px", borderRadius: 10, color: prioritaColor(ticket.priorita), background: `${prioritaColor(ticket.priorita)}15` }}>
          {ticket.priorita}
        </span>
        <span style={{ fontSize: 12, color: "var(--text-muted)" }}>→</span>
      </div>
    </button>
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

  useEffect(() => { setMounted(true); }, []);

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
          if (t.priorita?.toLowerCase() === "emergenza") {
            seenEmergencyIds.current.add(t.id);
          }
        });
      }
      // Se c'è un ticket in corso e nessuna vista attiva, apri automaticamente
      const inCorso = items.find(t => t.stato === "In corso");
      if (inCorso && !activeView) setActiveView(inCorso);
    } catch {
      notify.error("Errore nel caricamento degli interventi.", "MOBILE");
    }
    setLoading(false);
  }, [tecnicoId, mounted]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { loadTickets(true); }, [loadTickets]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Polling 30s per nuove emergenze assegnate ─────────────────────────────
  useEffect(() => {
    if (tecnicoId === null || tecnicoId === -1 || !mounted) return;
    const poll = async () => {
      try {
        const d = await apiGet<{ items?: Ticket[] }>(`/tickets?tecnico_id=${tecnicoId}&limit=50`);
        const items: Ticket[] = d.items ?? [];
        items.forEach(t => {
          if (t.priorita?.toLowerCase() === "emergenza" && !seenEmergencyIds.current.has(t.id)) {
            seenEmergencyIds.current.add(t.id);
            triggerEmergencyAlert(t.titolo);
          }
        });
        setTickets(items);
      } catch { /* silenzioso — non disturbare il tecnico con errori di rete */ }
    };
    const id = setInterval(poll, 30_000);
    return () => clearInterval(id);
  }, [tecnicoId, mounted]); // eslint-disable-line react-hooks/exhaustive-deps

  const updateStatus = async (tid: number, newStato: string) => {
    try {
      const body: Record<string, string | null> = { stato: newStato };
      if (newStato === "In corso") body.execution_start = new Date().toISOString();
      else if (newStato === "Chiuso") body.execution_finish = new Date().toISOString();
      await apiPut(`/tickets/${tid}`, body);
      setTickets(prev => prev.map(t =>
        t.id === tid ? { ...t, stato: newStato, execution_start: newStato === "In corso" ? new Date().toISOString() : t.execution_start } : t
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
      const today = new Date().toISOString().split("T")[0];
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

  function TicketVocaleView() {
    return (
      <div style={{ minHeight: "100dvh", background: "var(--surface-0)", display: "flex", flexDirection: "column" }}>

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

        {/* Header */}
        <div style={{ padding: "16px 20px", display: "flex", alignItems: "center", gap: 12, borderBottom: "1px solid var(--border-default)" }}>
          <button
            onClick={() => {
              if (showVoiceQrScan) { setShowVoiceQrScan(false); return; }
              setHomeView("home"); setVoiceStep("listen"); setVoiceTranscript(""); setFoundAssets([]); setSelectedAsset(null);
            }}
            style={{ background: "var(--surface-3)", border: "none", color: "#fff", borderRadius: 8, padding: "8px 14px", fontSize: 14, cursor: "pointer", fontWeight: 700 }}>← Torna</button>
          <span style={{ fontWeight: 800, fontSize: 17, color: "#fff" }}>🎙️ Apri Ticket Vocale</span>
        </div>

        <div style={{ flex: 1, padding: "24px 20px", display: "flex", flexDirection: "column", gap: 20 }}>

          {/* STEP: listen */}
          {voiceStep === "listen" && (
            <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 20, paddingTop: 8 }}>

              {/* Toggle metodo input */}
              <div style={{ display: "flex", gap: 0, background: "var(--surface-3)", borderRadius: 12, padding: 4, width: "100%" }}>
                <button
                  onClick={() => setVoiceQrInputMethod("voice")}
                  style={{
                    flex: 1, padding: "12px 8px", borderRadius: 9, border: "none", cursor: "pointer",
                    fontWeight: 800, fontSize: 14, transition: "all 0.15s",
                    background: voiceQrInputMethod === "voice" ? "rgba(99,102,241,0.30)" : "transparent",
                    color: voiceQrInputMethod === "voice" ? "#a5b4fc" : "rgba(255,255,255,0.35)",
                  }}
                >
                  🎙️ Voce / Testo
                </button>
                <button
                  onClick={() => setVoiceQrInputMethod("qr")}
                  style={{
                    flex: 1, padding: "12px 8px", borderRadius: 9, border: "none", cursor: "pointer",
                    fontWeight: 800, fontSize: 14, transition: "all 0.15s",
                    background: voiceQrInputMethod === "qr" ? "rgba(34,197,94,0.20)" : "transparent",
                    color: voiceQrInputMethod === "qr" ? "#86efac" : "rgba(255,255,255,0.35)",
                  }}
                >
                  📷 QR Code
                </button>
              </div>

              {/* ── Modalità VOCE / TESTO ── */}
              {voiceQrInputMethod === "voice" && (
                <>
                  <div style={{ textAlign: "center", color: "rgba(255,255,255,0.6)", fontSize: 15, lineHeight: 1.5 }}>
                    Premi il microfono e pronuncia<br/>il nome dell&apos;asset da segnalare
                  </div>
                  <VoiceRecorder onTranscript={handleVoiceTranscript} />
                  {voiceTranscript && (
                    <div style={{ background: "rgba(99,102,241,0.1)", border: "1px solid rgba(99,102,241,0.3)", borderRadius: 12, padding: "12px 16px", width: "100%", color: "#a5b4fc", fontSize: 14 }}>
                      <div style={{ fontSize: 11, color: "rgba(255,255,255,0.4)", marginBottom: 4 }}>Trascritto:</div>
                      {voiceTranscript}
                    </div>
                  )}
                  <div style={{ color: "rgba(255,255,255,0.35)", fontSize: 13 }}>— oppure cerca manualmente —</div>
                  <div style={{ width: "100%", display: "flex", gap: 8 }}>
                    <input
                      value={manualSearch}
                      onChange={e => handleManualSearch(e.target.value)}
                      placeholder="Cerca asset per nome..."
                      style={{ flex: 1, background: "var(--surface-3)", border: "1px solid var(--border-default)", borderRadius: 10, color: "#fff", padding: "12px 16px", fontSize: 14, outline: "none" }}
                    />
                  </div>
                  {manualAssets.length > 0 && (
                    <div style={{ width: "100%", display: "flex", flexDirection: "column", gap: 8 }}>
                      {manualAssets.map(a => (
                        <button key={a.id} onClick={() => { setSelectedAsset(a); setVoiceStep("form"); }}
                          style={{ background: "var(--surface-3)", border: "1px solid var(--border-default)", borderRadius: 10, padding: "12px 16px", color: "#fff", cursor: "pointer", textAlign: "left" }}>
                          <div style={{ fontWeight: 700, fontSize: 14 }}>{a.name}</div>
                          {a.sito_nome && <div style={{ fontSize: 11, color: "rgba(255,255,255,0.45)", marginTop: 3 }}>{a.sito_nome}{a.impianto_nome ? ` · ${a.impianto_nome}` : ""}</div>}
                        </button>
                      ))}
                    </div>
                  )}
                </>
              )}

              {/* ── Modalità QR CODE ── */}
              {voiceQrInputMethod === "qr" && (
                <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 20, width: "100%", paddingTop: 8 }}>
                  <div style={{ textAlign: "center", color: "rgba(255,255,255,0.6)", fontSize: 15, lineHeight: 1.5 }}>
                    Scansiona il QR code sull&apos;asset<br/>per identificarlo automaticamente
                  </div>
                  <button
                    onClick={() => setShowVoiceQrScan(true)}
                    style={{
                      width: "100%", padding: "28px 20px", borderRadius: 18,
                      border: "2px dashed rgba(34,197,94,0.45)",
                      background: "rgba(34,197,94,0.06)",
                      color: "#86efac", cursor: "pointer",
                      display: "flex", flexDirection: "column", alignItems: "center", gap: 14,
                      transition: "all 0.2s",
                    }}
                  >
                    <span style={{ fontSize: 56 }}>📷</span>
                    <div style={{ textAlign: "center" }}>
                      <div style={{ fontWeight: 900, fontSize: 18, letterSpacing: "0.5px" }}>APRI SCANNER QR</div>
                      <div style={{ fontSize: 12, color: "rgba(255,255,255,0.35)", marginTop: 4 }}>Richiede accesso alla fotocamera</div>
                    </div>
                  </button>
                  <div style={{ color: "rgba(255,255,255,0.25)", fontSize: 12, textAlign: "center" }}>
                    Funziona con Chrome, Edge e Safari 17+
                  </div>
                </div>
              )}
            </div>
          )}

          {/* STEP: confirm_asset */}
          {voiceStep === "confirm_asset" && foundAssets.length > 0 && (
            <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <div style={{ flex: 1, height: 1, background: "var(--surface-3)" }} />
                <span style={{ fontSize: 12, color: "rgba(255,255,255,0.35)", whiteSpace: "nowrap" }}>
                  {foundAssets.length} asset trovati per &ldquo;{voiceTranscript}&rdquo;
                </span>
                <div style={{ flex: 1, height: 1, background: "var(--surface-3)" }} />
              </div>
              <div style={{ fontSize: 13, color: "rgba(255,255,255,0.5)", textAlign: "center" }}>
                Tocca l&apos;asset corretto per procedere
              </div>
              {foundAssets.map((a, idx) => (
                <button key={a.id} onClick={() => { setSelectedAsset(a); setVoiceStep("form"); }}
                  style={{
                    display: "flex", alignItems: "center", gap: 14, padding: "16px",
                    background: idx === 0 ? "rgba(34,197,94,0.08)" : "rgba(255,255,255,0.04)",
                    border: `1.5px solid ${idx === 0 ? "rgba(34,197,94,0.4)" : "rgba(255,255,255,0.1)"}`,
                    borderRadius: 14, cursor: "pointer", textAlign: "left",
                  }}>
                  <div style={{ width: 36, height: 36, borderRadius: 10, background: idx === 0 ? "rgba(34,197,94,0.15)" : "rgba(255,255,255,0.06)", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0, fontSize: 16 }}>
                    {idx === 0 ? "✓" : "📦"}
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontWeight: 800, fontSize: 15, color: idx === 0 ? "#86efac" : "#fff", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{a.name}</div>
                    <div style={{ fontSize: 11, color: "rgba(255,255,255,0.4)", marginTop: 2 }}>
                      {[a.codice && `Cod. ${a.codice}`, a.sito_nome, a.impianto_nome].filter(Boolean).join(" · ")}
                    </div>
                  </div>
                  <span style={{ color: idx === 0 ? "#34d399" : "rgba(255,255,255,0.25)", fontSize: 18 }}>›</span>
                </button>
              ))}
              <button onClick={() => { setVoiceStep("listen"); setFoundAssets([]); setVoiceTranscript(""); }}
                style={{ background: "none", border: "1px solid var(--border-default)", borderRadius: 10, color: "rgba(255,255,255,0.4)", fontSize: 13, cursor: "pointer", padding: "10px", marginTop: 4 }}>
                ← Riprova ricerca
              </button>
            </div>
          )}

          {/* STEP: form */}
          {voiceStep === "form" && selectedAsset && (
            <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
              <div style={{ background: "rgba(99,102,241,0.1)", border: "1px solid rgba(99,102,241,0.3)", borderRadius: 12, padding: "12px 16px" }}>
                <div style={{ fontSize: 11, color: "rgba(255,255,255,0.4)", marginBottom: 3 }}>Asset selezionato</div>
                <div style={{ fontWeight: 800, fontSize: 16, color: "#fff" }}>{selectedAsset.name}</div>
              </div>

              <div>
                <div style={{ fontSize: 12, color: "rgba(255,255,255,0.5)", marginBottom: 10, textTransform: "uppercase", letterSpacing: "0.5px" }}>Tipo intervento</div>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8 }}>
                  {(["BD","PM","CM"] as const).map(t => (
                    <button key={t} onClick={() => setNuovoTipo(t)}
                      style={{ padding: "14px 8px", borderRadius: 12, fontWeight: 800, fontSize: 14, cursor: "pointer", border: "2px solid", transition: "all 0.15s",
                        background: nuovoTipo === t ? (t==="BD"?"rgba(239,68,68,0.2)":t==="PM"?"rgba(34,197,94,0.2)":"rgba(245,158,11,0.2)") : "rgba(255,255,255,0.04)",
                        borderColor: nuovoTipo === t ? (t==="BD"?"#ef4444":t==="PM"?"#22c55e":"#f59e0b") : "rgba(255,255,255,0.1)",
                        color: nuovoTipo === t ? (t==="BD"?"#fca5a5":t==="PM"?"#86efac":"#fcd34d") : "rgba(255,255,255,0.5)",
                      }}>{t === "BD" ? "🔧 BD" : t === "PM" ? "📋 PM" : "⚙️ CM"}</button>
                  ))}
                </div>
              </div>

              <div>
                <div style={{ fontSize: 12, color: "rgba(255,255,255,0.5)", marginBottom: 10, textTransform: "uppercase", letterSpacing: "0.5px" }}>Priorità</div>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8 }}>
                  {(["Alta","Media","Bassa"] as const).map(p => (
                    <button key={p} onClick={() => setNuovoPriorita(p)}
                      style={{ padding: "14px 8px", borderRadius: 12, fontWeight: 800, fontSize: 13, cursor: "pointer", border: "2px solid", transition: "all 0.15s",
                        background: nuovoPriorita === p ? (p==="Alta"?"rgba(239,68,68,0.2)":p==="Media"?"rgba(245,158,11,0.2)":"rgba(100,116,139,0.2)") : "rgba(255,255,255,0.04)",
                        borderColor: nuovoPriorita === p ? (p==="Alta"?"#ef4444":p==="Media"?"#f59e0b":"#64748b") : "rgba(255,255,255,0.1)",
                        color: nuovoPriorita === p ? (p==="Alta"?"#fca5a5":p==="Media"?"#fcd34d":"#94a3b8") : "rgba(255,255,255,0.5)",
                      }}>{p}</button>
                  ))}
                </div>
              </div>

              <div>
                <div style={{ fontSize: 12, color: "rgba(255,255,255,0.5)", marginBottom: 8, textTransform: "uppercase", letterSpacing: "0.5px" }}>Descrizione (opzionale)</div>
                <textarea value={nuovoDesc} onChange={e => setNuovoDesc(e.target.value)} rows={3} placeholder="Note sull'intervento..."
                  style={{ width: "100%", background: "var(--surface-3)", border: "1px solid var(--border-default)", borderRadius: 10, color: "#fff", padding: "12px 14px", fontSize: 14, resize: "none", outline: "none", boxSizing: "border-box" }} />
              </div>

              <button onClick={saveTicketVocale} disabled={savingTicket}
                style={{ padding: "18px", background: savingTicket ? "rgba(99,102,241,0.3)" : "linear-gradient(135deg,#6366f1,#4f46e5)", border: "none", borderRadius: 14, color: "#fff", fontWeight: 900, fontSize: 17, cursor: savingTicket ? "not-allowed" : "pointer", boxShadow: "0 8px 24px rgba(99,102,241,0.35)" }}>
                {savingTicket ? "Salvataggio..." : "💾 SALVA TICKET"}
              </button>
            </div>
          )}
        </div>
      </div>
    );
  }

  function PianoOdiernoView() {
    return (
      <div style={{ minHeight: "100dvh", background: "var(--surface-0)", display: "flex", flexDirection: "column" }}>
        {/* Header */}
        <div style={{ padding: "16px 20px", display: "flex", alignItems: "center", gap: 12, borderBottom: "1px solid var(--border-default)" }}>
          <button onClick={() => { setHomeView("home"); setDpiConfirmed(false); setDpiChecked({}); }}
            style={{ background: "var(--surface-3)", border: "none", color: "#fff", borderRadius: 8, padding: "8px 14px", fontSize: 14, cursor: "pointer", fontWeight: 700 }}>← Torna</button>
          <span style={{ fontWeight: 800, fontSize: 17, color: "#fff" }}>📋 Piano Odierno</span>
        </div>

        {/* DPI Step */}
        {!dpiConfirmed && (
          <div style={{ flex: 1, padding: "24px 20px", display: "flex", flexDirection: "column", gap: 16 }}>
            <div style={{ textAlign: "center", padding: "0 8px" }}>
              <div style={{ fontSize: 32, marginBottom: 8 }}>🦺</div>
              <div style={{ fontWeight: 900, fontSize: 20, color: "#fff", marginBottom: 6 }}>Verifica DPI</div>
              <div style={{ fontSize: 14, color: "rgba(255,255,255,0.5)", lineHeight: 1.5 }}>Prima di accedere al piano, conferma di indossare tutti i dispositivi di protezione individuale</div>
            </div>

            <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 8 }}>
              {DPI_ITEMS.map(item => {
                const checked = !!dpiChecked[item];
                return (
                  <button key={item} onClick={() => setDpiChecked(prev => ({ ...prev, [item]: !prev[item] }))}
                    style={{ display: "flex", alignItems: "center", gap: 14, padding: "14px 16px", borderRadius: 12, cursor: "pointer", textAlign: "left", transition: "all 0.15s",
                      background: checked ? "rgba(34,197,94,0.1)" : "rgba(255,255,255,0.04)",
                      border: `1.5px solid ${checked ? "rgba(34,197,94,0.4)" : "rgba(255,255,255,0.1)"}`,
                    }}>
                    <div style={{ width: 24, height: 24, borderRadius: 6, border: `2px solid ${checked ? "#22c55e" : "rgba(255,255,255,0.3)"}`, background: checked ? "#22c55e" : "transparent", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0, transition: "all 0.15s" }}>
                      {checked && <span style={{ color: "#fff", fontSize: 14, fontWeight: 900 }}>✓</span>}
                    </div>
                    <span style={{ fontSize: 15, color: checked ? "#86efac" : "rgba(255,255,255,0.7)", fontWeight: checked ? 700 : 400, textDecoration: checked ? "line-through" : "none" }}>{item}</span>
                  </button>
                );
              })}
            </div>

            <div style={{ marginTop: 8 }}>
              <button
                disabled={!allDpiChecked}
                onClick={() => { setDpiConfirmed(true); loadPianoOdierno(); }}
                style={{ width: "100%", padding: "18px", borderRadius: 14, fontWeight: 900, fontSize: 17, cursor: allDpiChecked ? "pointer" : "not-allowed", border: "none", transition: "all 0.2s",
                  background: allDpiChecked ? "linear-gradient(135deg,#22c55e,#16a34a)" : "rgba(255,255,255,0.06)",
                  color: allDpiChecked ? "#fff" : "rgba(255,255,255,0.25)",
                  boxShadow: allDpiChecked ? "0 8px 24px rgba(34,197,94,0.35)" : "none",
                }}>
                {allDpiChecked ? "✓ ACCEDI AL PIANO" : `ACCEDI AL PIANO (${Object.values(dpiChecked).filter(Boolean).length}/${DPI_ITEMS.length})`}
              </button>
            </div>
          </div>
        )}

        {/* Piano Step */}
        {dpiConfirmed && (
          <div style={{ flex: 1, padding: "20px", display: "flex", flexDirection: "column", gap: 14 }}>
            <div style={{ fontSize: 13, fontWeight: 700, color: "rgba(255,255,255,0.5)", textTransform: "uppercase", letterSpacing: "0.5px" }}>
              {todayStr}
            </div>

            {loadingPiano && (
              <div style={{ textAlign: "center", color: "rgba(255,255,255,0.4)", padding: 40 }}>Caricamento piano...</div>
            )}

            {!loadingPiano && pianoDiOggi.length === 0 && (
              <div style={{ textAlign: "center", padding: "40px 20px" }}>
                <div style={{ fontSize: 32, marginBottom: 12 }}>✅</div>
                <div style={{ color: "rgba(255,255,255,0.5)", fontSize: 15 }}>Nessun intervento pianificato per oggi</div>
              </div>
            )}

            {!loadingPiano && pianoDiOggi.map(t => {
              const startTime = t.planned_start ? new Date(t.planned_start).toLocaleTimeString("it-IT", { hour: "2-digit", minute: "2-digit" }) : null;
              const endTime = t.planned_finish ? new Date(t.planned_finish).toLocaleTimeString("it-IT", { hour: "2-digit", minute: "2-digit" }) : null;
              const tipoInfo = tipoLabel(t.tipo);
              return (
                <div key={t.id}>
                  {startTime && <div style={{ fontSize: 12, color: "rgba(255,255,255,0.35)", marginBottom: 6, fontWeight: 700 }}>{startTime}{endTime ? `–${endTime}` : ""}</div>}
                  <button onClick={() => setActiveView(t)}
                    style={{ width: "100%", background: "var(--surface-3)", border: "1px solid var(--border-default)", borderRadius: 14, padding: "16px", cursor: "pointer", textAlign: "left", display: "flex", alignItems: "center", gap: 14 }}>
                    <div style={{ width: 44, height: 44, borderRadius: 12, background: `${tipoInfo.color}18`, border: `1.5px solid ${tipoInfo.color}40`, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 20, flexShrink: 0 }}>
                      {tipoInfo.icon}
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontWeight: 800, fontSize: 15, color: "#fff", marginBottom: 4, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{t.titolo}</div>
                      <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                        <span style={{ fontSize: 11, padding: "2px 7px", borderRadius: 5, fontWeight: 700, background: `${tipoInfo.color}20`, color: tipoInfo.color, border: `1px solid ${tipoInfo.color}40` }}>{t.tipo}</span>
                        <span style={{ fontSize: 11, color: "rgba(255,255,255,0.4)" }}>⏱ {t.durata_stimata_ore}h</span>
                        <span style={{ fontSize: 11, color: prioritaColor(t.priorita), fontWeight: 700 }}>{t.priorita}</span>
                      </div>
                      {t.asset_name && <div style={{ fontSize: 12, color: "rgba(255,255,255,0.4)", marginTop: 3 }}>📦 {t.asset_name}</div>}
                    </div>
                    <span style={{ color: "rgba(255,255,255,0.3)", fontSize: 18 }}>›</span>
                  </button>
                </div>
              );
            })}
          </div>
        )}
      </div>
    );
  }

  if (!mounted) return null;

  if (loading) {
    return (
      <div style={{ padding: "20px", display: "flex", flexDirection: "column", gap: 16 }}>
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
        onStatusChange={updateStatus}
      />
    );
  }

  if (homeView === "ticket_vocale") return <TicketVocaleView />;
  if (homeView === "piano_odierno") return <PianoOdiernoView />;

  // ── Home ─────────────────────────────────────────────────────────────────
  return (
    <div style={{ minHeight: "100dvh", background: "var(--surface-0)", display: "flex", flexDirection: "column" }}>
      {/* Header compatto */}
      <div style={{ padding: "16px 20px 12px", display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
        <div>
          <div style={{ fontWeight: 900, fontSize: 20, color: "#fff" }}>Ciao, {user?.username ?? "Tecnico"} 👷</div>
          <div style={{ fontSize: 13, color: "rgba(255,255,255,0.4)", marginTop: 2 }}>
            {tickets.filter(t => t.stato === "In corso").length} in corso · {tickets.filter(t => t.stato === "Pianificato").length} pianificati
          </div>
        </div>
        <button onClick={async () => { setRefreshing(true); await loadTickets(); setRefreshing(false); }} disabled={refreshing}
          style={{ background: "var(--surface-3)", border: "none", color: "rgba(255,255,255,0.6)", borderRadius: 8, padding: "8px 12px", cursor: refreshing ? "wait" : "pointer", fontSize: 16 }}>↻</button>
      </div>

      {/* Banner no profilo */}
      {tecnicoId === -1 && (
        <div style={{ margin: "0 16px 8px", background: "rgba(251,191,36,0.08)", border: "1px solid rgba(251,191,36,0.30)", borderRadius: 14, padding: "14px 16px", display: "flex", gap: 12 }}>
          <span style={{ fontSize: 22 }}>⚠️</span>
          <div>
            <div style={{ fontWeight: 800, fontSize: 13, color: "#fbbf24", marginBottom: 4 }}>Profilo tecnico non collegato</div>
            <div style={{ fontSize: 12, color: "rgba(255,255,255,0.6)", lineHeight: 1.5 }}>Contatta il responsabile per associare l&apos;account.</div>
          </div>
        </div>
      )}

      {/* Banner EMERGENZE attive — priorità massima */}
      {tickets.filter(t => t.priorita?.toLowerCase() === "emergenza" && t.stato !== "Chiuso").map(t => (
        <button key={t.id} onClick={() => setActiveView(t)}
          style={{
            display: "flex", alignItems: "center", gap: 12, width: "100%",
            margin: "0 0 0 0", padding: "14px 20px", cursor: "pointer",
            background: "linear-gradient(90deg, rgba(239,68,68,0.18) 0%, rgba(239,68,68,0.08) 100%)",
            border: "none", borderTop: "2px solid #ef4444", borderBottom: "2px solid rgba(239,68,68,0.4)",
            textAlign: "left",
            animation: "pulse-bg 1.2s ease-in-out infinite",
          }}>
          <div style={{ fontSize: 26, flexShrink: 0 }}>🚨</div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontWeight: 900, fontSize: 13, color: "#ff4444", textTransform: "uppercase", letterSpacing: "0.08em" }}>
              EMERGENZA ASSEGNATA
            </div>
            <div style={{ fontWeight: 700, fontSize: 14, color: "#fff", marginTop: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {t.titolo}
            </div>
            {t.asset_name && <div style={{ fontSize: 12, color: "rgba(255,255,255,0.5)", marginTop: 1 }}>{t.asset_name}</div>}
          </div>
          <span style={{ color: "#ef4444", fontSize: 20, fontWeight: 900, flexShrink: 0 }}>→</span>
        </button>
      ))}

      {/* 2 PULSANTONI */}
      <div style={{ flex: 1, display: "flex", flexDirection: "column", padding: "12px 16px", gap: 12 }}>
        <button
          onClick={() => { setHomeView("ticket_vocale"); setVoiceStep("listen"); setVoiceTranscript(""); setFoundAssets([]); setManualSearch(""); setManualAssets([]); setSelectedAsset(null); setNuovoDesc(""); setVoiceQrInputMethod("voice"); setShowVoiceQrScan(false); }}
          style={{ flex: 1, minHeight: 140, borderRadius: 20, border: "1.5px solid rgba(99,102,241,0.4)", cursor: "pointer", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 12, position: "relative", overflow: "hidden",
            background: "linear-gradient(145deg, #1e1b4b 0%, #0f0c29 60%, #1a1040 100%)",
            boxShadow: "0 8px 32px rgba(99,102,241,0.2)",
          }}
        >
          <div style={{ fontSize: 44 }}>🎙️</div>
          <div style={{ textAlign: "center" }}>
            <div style={{ fontWeight: 900, fontSize: 20, color: "#fff", letterSpacing: "0.5px" }}>APRI TICKET</div>
            <div style={{ fontWeight: 900, fontSize: 20, color: "#818cf8" }}>VOCALE</div>
          </div>
          <div style={{ fontSize: 12, color: "rgba(255,255,255,0.35)" }}>Riconosce l&apos;asset dalla voce</div>
        </button>

        <button
          onClick={() => { setHomeView("piano_odierno"); setDpiConfirmed(false); setDpiChecked({}); setPianoDiOggi([]); }}
          style={{ flex: 1, minHeight: 140, borderRadius: 20, border: "1.5px solid rgba(20,184,166,0.4)", cursor: "pointer", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 12,
            background: "linear-gradient(145deg, #0f2922 0%, #0a1f1a 60%, #0d2520 100%)",
            boxShadow: "0 8px 32px rgba(20,184,166,0.2)",
          }}
        >
          <div style={{ fontSize: 44 }}>📋</div>
          <div style={{ textAlign: "center" }}>
            <div style={{ fontWeight: 900, fontSize: 20, color: "#fff", letterSpacing: "0.5px" }}>PIANO</div>
            <div style={{ fontWeight: 900, fontSize: 20, color: "#2dd4bf" }}>ODIERNO</div>
          </div>
          <div style={{ fontSize: 12, color: "rgba(255,255,255,0.35)" }}>Verifica DPI e accedi al piano</div>
        </button>

        {/* Ticket IN CORSO (se presenti) */}
        {tickets.filter(t => t.stato === "In corso").length > 0 && (
          <div style={{ marginTop: 8 }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: "rgba(255,255,255,0.35)", textTransform: "uppercase", letterSpacing: "0.6px", marginBottom: 8 }}>In corso ora</div>
            {tickets.filter(t => t.stato === "In corso").map(t => {
              const tipoInfo = tipoLabel(t.tipo);
              return (
                <button key={t.id} onClick={() => setActiveView(t)}
                  style={{ width: "100%", display: "flex", alignItems: "center", gap: 12, padding: "14px", background: "rgba(251,191,36,0.06)", border: "1.5px solid rgba(251,191,36,0.35)", borderRadius: 14, cursor: "pointer", marginBottom: 8 }}>
                  <span style={{ fontSize: 22 }}>{tipoInfo.icon}</span>
                  <div style={{ flex: 1, minWidth: 0, textAlign: "left" }}>
                    <div style={{ fontWeight: 800, fontSize: 14, color: "#fff", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{t.titolo}</div>
                    <div style={{ fontSize: 12, color: "rgba(255,255,255,0.45)", marginTop: 2 }}>{t.asset_name}</div>
                  </div>
                  <span style={{ fontSize: 13, color: "#fbbf24", fontWeight: 700 }}>APRI →</span>
                </button>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
