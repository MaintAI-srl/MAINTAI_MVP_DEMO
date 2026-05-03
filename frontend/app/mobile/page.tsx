"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import { apiGet, apiPut } from "../lib/api";
import { notify } from "@/lib/toast";
import { useAuth } from "../lib/auth";
import UploadAllegati from "../components/UploadAllegati";
import Skeleton from "../components/Skeleton";
import VoiceRecorder from "../components/VoiceRecorder";

type Ticket = {
  id: number;
  titolo: string;
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
    case "alta":  return "#f87171";
    case "media": return "#fbbf24";
    case "bassa": return "#34d399";
    default:      return "#94a3b8";
  }
}

function tipoLabel(t: string): { icon: string; label: string; color: string } {
  switch (t?.toUpperCase()) {
    case "BD":  return { icon: "🔧", label: "Guasto",      color: "#f87171" };
    case "PM":  return { icon: "📋", label: "Preventiva",  color: "#34d399" };
    case "CM":  return { icon: "⚙️", label: "Correttiva",  color: "#fbbf24" };
    case "ISP": return { icon: "🔍", label: "Ispezione",   color: "#60a5fa" };
    default:    return { icon: "◷",  label: t,              color: "#94a3b8" };
  }
}

function fmtDate(iso?: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return d.toLocaleDateString("it-IT", { day: "2-digit", month: "2-digit", year: "2-digit" })
    + " " + d.toLocaleTimeString("it-IT", { hour: "2-digit", minute: "2-digit" });
}

// ── Safety checklist mock per tipo asset ──────────────────────────────────────
function getSafetyChecklist(assetName: string, tipo: string): { id: number; text: string }[] {
  const name = (assetName || "").toLowerCase();
  if (name.includes("pompa") || name.includes("pump")) {
    return [
      { id: 1, text: "Verifica che la pompa sia in stato FERMO" },
      { id: 2, text: "Chiudi valvola aspirazione e mandata" },
      { id: 3, text: "Applica blocco/targhetta (LOTO) sul quadro" },
      { id: 4, text: "Sfoga la pressione residua nel corpo pompa" },
      { id: 5, text: "Indossa DPI: guanti, occhiali, scarpe antinfortunistiche" },
    ];
  }
  if (name.includes("motore") || name.includes("motor")) {
    return [
      { id: 1, text: "Seziona l'alimentazione elettrica al quadro" },
      { id: 2, text: "Applica blocco/targhetta (LOTO) sull'interruttore" },
      { id: 3, text: "Verifica assenza tensione con il tester" },
      { id: 4, text: "Attendi raffreddamento carcassa (min. 10 min)" },
      { id: 5, text: "Indossa DPI: guanti isolanti, occhiali" },
    ];
  }
  if (name.includes("quadro") || name.includes("panel") || name.includes("mcc")) {
    return [
      { id: 1, text: "Seziona l'alimentazione principale" },
      { id: 2, text: "Applica LOTO sul sezionatore" },
      { id: 3, text: "Verifica assenza tensione su tutti i morsetti" },
      { id: 4, text: "Indossa guanti isolanti classe adeguata" },
      { id: 5, text: "Tieni a portata di mano l'estintore CO₂" },
    ];
  }
  if (name.includes("compressor")) {
    return [
      { id: 1, text: "Ferma il compressore e attendi sfogo pressione" },
      { id: 2, text: "Seziona alimentazione elettrica (LOTO)" },
      { id: 3, text: "Chiudi valvola di intercettazione aria" },
      { id: 4, text: "Sfoga il serbatoio tramite valvola di scarico" },
      { id: 5, text: "Indossa DPI: occhiali, guanti, protezioni uditive" },
    ];
  }
  if (name.includes("nastro") || name.includes("conveyor")) {
    return [
      { id: 1, text: "Ferma il nastro e applica LOTO sul motoriduttore" },
      { id: 2, text: "Verifica assenza di materiale sul nastro" },
      { id: 3, text: "Blocca meccanicamente il nastro (cunei)" },
      { id: 4, text: "Indossa DPI: guanti, occhiali, scarpe antinfortunistiche" },
      { id: 5, text: "Segnala area di lavoro con nastro/barriere" },
    ];
  }
  // Generica per tipo intervento
  if (tipo === "BD") {
    return [
      { id: 1, text: "Metti in sicurezza l'area intorno all'asset" },
      { id: 2, text: "Verifica assenza di rischi immediati (fumo, perdite, calore)" },
      { id: 3, text: "Seziona l'alimentazione se presente rischio elettrico" },
      { id: 4, text: "Indossa DPI appropriati per il tipo di guasto" },
      { id: 5, text: "Informa il responsabile prima di intervenire" },
    ];
  }
  return [
    { id: 1, text: "Leggi il permesso di lavoro prima di iniziare" },
    { id: 2, text: "Verifica che l'area sia sgombra da personale non autorizzato" },
    { id: 3, text: "Indossa i DPI previsti dalla procedura" },
    { id: 4, text: "Applica LOTO se l'intervento lo richiede" },
    { id: 5, text: "Segnala eventuali anomalie al responsabile" },
  ];
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
  const checklist = getSafetyChecklist(ticket.asset_name, ticket.tipo);
  const [checked, setChecked] = useState<Set<number>>(new Set());
  const [paused, setPaused] = useState(false);
  const [pausedAt, setPausedAt] = useState(0);
  const [started, setStarted] = useState(ticket.stato === "In corso");
  const [starting, setStarting] = useState(false);
  const [showVoice, setShowVoice] = useState(false);
  const [transcript, setTranscript] = useState("");
  const [savingVoice, setSavingVoice] = useState(false);
  const photoInputRef = useRef<HTMLInputElement>(null);
  const allChecked = checked.size === checklist.length;

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
    await onStatusChange(ticket.id, "Chiuso");
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
      background: "#060d1a",
    }}>

      {/* ── Top bar compatta ── */}
      <div style={{
        display: "flex", alignItems: "center", gap: 10,
        padding: "10px 0 8px",
        borderBottom: "1px solid rgba(255,255,255,0.06)",
        marginBottom: 10, flexShrink: 0,
      }}>
        <button onClick={onClose} style={{
          background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.10)",
          borderRadius: 10, width: 36, height: 36, fontSize: 16, cursor: "pointer",
          display: "flex", alignItems: "center", justifyContent: "center", color: "#94a3b8", flexShrink: 0,
        }}>←</button>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 11, fontWeight: 800, color: "#e2e8f0", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {ticket.titolo}
          </div>
          <div style={{ fontSize: 10, color: "#94a3b8" }}>{ticket.asset_name}</div>
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
            background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.07)",
            borderRadius: 14, padding: "12px",
          }}>
            <div style={{ fontSize: "clamp(15px, 4vw, 19px)", fontWeight: 900, color: "#f1f5f9", lineHeight: 1.25, marginBottom: 4 }}>
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

          {/* Safety Checklist */}
          <div style={{
            background: allChecked ? "rgba(52,211,153,0.04)" : "rgba(239,68,68,0.04)",
            border: `2px solid ${allChecked ? "rgba(52,211,153,0.30)" : "rgba(239,68,68,0.40)"}`,
            borderRadius: 14, padding: "10px 8px",
            transition: "border-color 0.3s, background 0.3s",
            flexShrink: 0,
          }}>
            <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 8 }}>
              <span style={{ fontSize: 16 }}>🦺</span>
              <span style={{ fontSize: 10, fontWeight: 900, color: allChecked ? "#34d399" : "#f87171", letterSpacing: "0.1em", textTransform: "uppercase" }}>
                Safety
              </span>
              <span style={{ marginLeft: "auto", fontSize: 10, color: "rgba(255,255,255,0.35)", fontFamily: "var(--font-mono)" }}>
                {checked.size}/{checklist.length}
              </span>
            </div>
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
            {allChecked && (
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
            background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.07)",
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
                background: "rgba(255,255,255,0.03)", border: `1px solid ${item.color}25`,
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
            {/* INIZIA — visibile solo se non ancora avviato */}
            {!started && (
              <button
                onClick={handleIniziaLavoro}
                disabled={!allChecked || starting}
                style={{
                  height: 60, borderRadius: 14,
                  background: allChecked
                    ? "linear-gradient(135deg, #3b82f6 0%, #1d4ed8 100%)"
                    : "rgba(59,130,246,0.08)",
                  border: allChecked ? "none" : "2px solid rgba(59,130,246,0.20)",
                  color: allChecked ? "#fff" : "rgba(59,130,246,0.35)",
                  fontWeight: 900, fontSize: 15,
                  cursor: allChecked && !starting ? "pointer" : "not-allowed",
                  boxShadow: allChecked ? "0 4px 20px rgba(59,130,246,0.35)" : "none",
                  display: "flex", alignItems: "center", justifyContent: "center", gap: 6,
                  transition: "all 0.2s",
                }}
              >
                {starting ? "…" : allChecked ? <><span style={{ fontSize: 20 }}>▶</span> INIZIA</> : <>🔒 INIZIA</>}
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

  useEffect(() => { setMounted(true); }, []);

  useEffect(() => {
    if (!user?.userid || !mounted) return;
    apiGet<any>(`/tecnici/me?utente_id=${user.userid}`)
      .then(d => setTecnicoId(d.id))
      .catch(() => { setTecnicoId(-1); setLoading(false); });
  }, [user, mounted]);

  const loadTickets = useCallback(async () => {
    if (tecnicoId === null || !mounted) return;
    if (tecnicoId === -1) { setLoading(false); return; }
    try {
      const d = await apiGet<any>(`/tickets?tecnico_id=${tecnicoId}&limit=50`);
      const items: Ticket[] = d.items ?? [];
      setTickets(items);
      // Se c'è un ticket in corso e nessuna vista attiva, apri automaticamente
      const inCorso = items.find(t => t.stato === "In corso");
      if (inCorso && !activeView) setActiveView(inCorso);
    } catch {
      notify.error("Errore nel caricamento degli interventi.", "MOBILE");
    }
    setLoading(false);
  }, [tecnicoId, mounted]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { loadTickets(); }, [loadTickets]);

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

  const activeTickets   = tickets.filter(t => t.stato === "In corso");
  const upcomingTickets = tickets.filter(t => t.stato === "Pianificato" || t.stato === "Aperto");

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

  // ── Vista lista ───────────────────────────────────────────────────────────
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16, paddingBottom: 8 }}>

      {/* Header */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "4px 0" }}>
        <div>
          <h1 style={{ fontSize: "clamp(20px, 6vw, 26px)", fontWeight: 900, color: "var(--text-primary)", margin: 0, letterSpacing: "-0.03em" }}>
            Ciao, <span style={{ color: "#90b8ff" }}>{user?.username}</span> 👷
          </h1>
          <p style={{ margin: "4px 0 0", fontSize: 13, color: "var(--text-secondary)" }}>
            {activeTickets.length + upcomingTickets.length === 0
              ? "Nessun intervento assegnato"
              : `${activeTickets.length} attivi · ${upcomingTickets.length} pianificati`}
          </p>
        </div>
        <button onClick={async () => { setRefreshing(true); await loadTickets(); setRefreshing(false); }}
          disabled={refreshing}
          style={{
            background: "rgba(91,143,255,0.08)", border: "1px solid rgba(91,143,255,0.20)",
            borderRadius: 12, width: 46, height: 46,
            display: "flex", alignItems: "center", justifyContent: "center",
            cursor: refreshing ? "wait" : "pointer", fontSize: 20,
          }}
        >🔄</button>
      </div>

      {/* Banner no profilo */}
      {tecnicoId === -1 && (
        <div style={{ background: "rgba(251,191,36,0.08)", border: "1px solid rgba(251,191,36,0.30)", borderRadius: 14, padding: "14px 16px", display: "flex", gap: 12 }}>
          <span style={{ fontSize: 22 }}>⚠️</span>
          <div>
            <div style={{ fontWeight: 800, fontSize: 13, color: "#fbbf24", marginBottom: 4 }}>Profilo tecnico non collegato</div>
            <div style={{ fontSize: 12, color: "var(--text-secondary)", lineHeight: 1.5 }}>Contatta il responsabile per associare l'account.</div>
          </div>
        </div>
      )}

      {/* Stats */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8 }}>
        {[
          { label: "In corso",    count: activeTickets.length, color: "#fbbf24" },
          { label: "Pianificati", count: upcomingTickets.filter(t => t.stato === "Pianificato").length, color: "#a78bfa" },
          { label: "Aperti",      count: upcomingTickets.filter(t => t.stato === "Aperto").length, color: "#60a5fa" },
        ].map(s => (
          <div key={s.label} style={{ background: "var(--bg-elevated, var(--border-strong))", border: `1px solid ${s.color}30`, borderTop: `3px solid ${s.color}`, borderRadius: 14, padding: "12px 10px", textAlign: "center" }}>
            <div style={{ fontSize: "clamp(22px, 7vw, 30px)", fontWeight: 900, color: s.color, lineHeight: 1 }}>{s.count}</div>
            <div style={{ fontSize: "clamp(9px, 2.5vw, 11px)", color: "var(--text-muted)", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.06em", marginTop: 4 }}>{s.label}</div>
          </div>
        ))}
      </div>

      {/* In corso — card cliccabile per aprire vista dedicata */}
      {activeTickets.length > 0 && (
        <section style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <div style={{ fontSize: 10, fontWeight: 800, textTransform: "uppercase", letterSpacing: "0.15em", color: "#fbbf24", display: "flex", alignItems: "center", gap: 6 }}>
            <span style={{ width: 7, height: 7, borderRadius: "50%", background: "#fbbf24", display: "inline-block", boxShadow: "0 0 8px #fbbf2480" }} />
            In corso ora
          </div>
          {activeTickets.map(t => (
            <button key={t.id} onClick={() => setActiveView(t)} style={{
              display: "flex", alignItems: "center", gap: 14, width: "100%",
              background: "linear-gradient(135deg, rgba(251,191,36,0.08) 0%, rgba(10,15,30,0.6) 100%)",
              border: "2px solid #fbbf24", borderRadius: 20, padding: "16px",
              cursor: "pointer", textAlign: "left",
            }}>
              <span style={{ fontSize: 24 }}>{tipoLabel(t.tipo).icon}</span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 15, fontWeight: 800, color: "#e2e8f0", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{t.titolo}</div>
                <div style={{ fontSize: 12, color: "#94a3b8", marginTop: 2 }}>{t.asset_name}</div>
              </div>
              <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 4, flexShrink: 0 }}>
                <span style={{ fontSize: 11, color: "#fbbf24", fontWeight: 700, fontFamily: "var(--font-mono)" }}>APRI →</span>
                <span style={{ fontSize: 10, color: "#fbbf24", opacity: 0.6 }}>tocca per dettagli</span>
              </div>
            </button>
          ))}
        </section>
      )}

      {/* Prossimi interventi */}
      <section style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        <div style={{ fontSize: 10, fontWeight: 800, textTransform: "uppercase", letterSpacing: "0.15em", color: "var(--text-muted)", display: "flex", alignItems: "center", gap: 6 }}>
          <span style={{ width: 7, height: 7, borderRadius: "50%", background: "#60a5fa", display: "inline-block" }} />
          Prossimi interventi
        </div>
        {upcomingTickets.length === 0 ? (
          <div style={{ padding: 32, textAlign: "center", background: "var(--bg-card, var(--surface-2))", borderRadius: 16, border: "1px dashed var(--border, rgba(255,255,255,0.08))", color: "var(--text-disabled)" }}>
            <div style={{ fontSize: 32, marginBottom: 8 }}>📋</div>
            Nessun intervento pianificato
          </div>
        ) : upcomingTickets.map(t => (
          <UpcomingTicketCard
            key={t.id}
            ticket={t}
            onOpen={(ticket) => setActiveView(ticket)}
          />
        ))}
      </section>
    </div>
  );
}
