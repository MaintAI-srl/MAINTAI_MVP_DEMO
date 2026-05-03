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
  useEffect(() => {
    const tick = () => setTime(new Date().toLocaleTimeString("it-IT", { hour: "2-digit", minute: "2-digit", second: "2-digit" }));
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, []);
  return (
    <div style={{ textAlign: "center" }}>
      <div style={{ fontSize: "clamp(36px, 12vw, 56px)", fontWeight: 900, color: "#fff", fontFamily: "var(--font-mono)", letterSpacing: "0.05em", lineHeight: 1 }}>
        {time}
      </div>
      <div style={{ fontSize: 11, color: "rgba(255,255,255,0.4)", marginTop: 4, letterSpacing: "0.12em" }}>
        {new Date().toLocaleDateString("it-IT", { weekday: "long", day: "2-digit", month: "long" }).toUpperCase()}
      </div>
    </div>
  );
}

// ── Contatore MTTR ────────────────────────────────────────────────────────────
function MttrCounter({ start }: { start?: string }) {
  const [sec, setSec] = useState(0);
  useEffect(() => {
    if (!start) return;
    const startMs = new Date(start).getTime();
    const tick = () => setSec(Math.floor((Date.now() - startMs) / 1000));
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [start]);

  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  const pad = (n: number) => String(n).padStart(2, "0");

  // Colore che cambia con il tempo (verde→giallo→rosso)
  const color = sec < 3600 ? "#34d399" : sec < 7200 ? "#fbbf24" : "#f87171";

  return (
    <div style={{ textAlign: "center" }}>
      <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: "0.2em", color: "rgba(255,255,255,0.4)", marginBottom: 6, textTransform: "uppercase" }}>
        MTTR — Tempo Intervento
      </div>
      <div style={{
        fontSize: "clamp(28px, 10vw, 44px)", fontWeight: 900, fontFamily: "var(--font-mono)",
        color, letterSpacing: "0.08em", lineHeight: 1,
        textShadow: `0 0 20px ${color}60`,
        transition: "color 1s",
      }}>
        {pad(h)}:{pad(m)}:{pad(s)}
      </div>
      {sec > 0 && (
        <div style={{ fontSize: 11, color: "rgba(255,255,255,0.35)", marginTop: 4 }}>
          {h > 0 ? `${h}h ${m}m in corso` : `${m}m ${s}s in corso`}
        </div>
      )}
    </div>
  );
}

// ── Vista "Lavoro In Corso" — pagina dedicata ─────────────────────────────────
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
  const [showVoice, setShowVoice] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [transcript, setTranscript] = useState("");
  const [savingVoice, setSavingVoice] = useState(false);
  const allChecked = checked.size === checklist.length;

  function toggle(id: number) {
    setChecked(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  async function handleSaveVoice() {
    if (!transcript.trim()) return;
    setSavingVoice(true);
    try {
      await apiPut(`/tickets/${ticket.id}`, { note_vocali: transcript.trim() });
      notify.success("Nota vocale salvata ✓");
      setTranscript("");
    } catch {
      notify.error("Errore salvataggio nota");
    }
    setSavingVoice(false);
  }

  return (
    <div style={{
      display: "flex", flexDirection: "column", gap: 0,
      minHeight: "100%",
      background: "linear-gradient(180deg, #0a0f1e 0%, #060d1a 100%)",
    }}>

      {/* ── Top bar ── */}
      <div style={{
        display: "flex", alignItems: "center", gap: 12,
        padding: "12px 0 8px",
        borderBottom: "1px solid rgba(255,255,255,0.06)",
        marginBottom: 16,
      }}>
        <button onClick={onClose} style={{
          background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.10)",
          borderRadius: 10, width: 38, height: 38, fontSize: 18, cursor: "pointer",
          display: "flex", alignItems: "center", justifyContent: "center", color: "#94a3b8",
          flexShrink: 0,
        }}>←</button>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 10, fontWeight: 700, color: "#fbbf24", letterSpacing: "0.15em", textTransform: "uppercase" }}>
            🟡 IN CORSO
          </div>
          <div style={{ fontSize: 14, fontWeight: 800, color: "#e2e8f0", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {ticket.titolo}
          </div>
        </div>
        <div style={{
          fontSize: 10, fontWeight: 700, padding: "3px 10px", borderRadius: 20,
          color: tipo.color, background: `${tipo.color}18`, border: `1px solid ${tipo.color}44`,
          flexShrink: 0,
        }}>
          {tipo.icon} {tipo.label}
        </div>
      </div>

      {/* ── Orologio + MTTR ── */}
      <div style={{
        background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.07)",
        borderRadius: 20, padding: "20px 16px", marginBottom: 16,
        display: "flex", flexDirection: "column", gap: 16,
      }}>
        <LiveClock />
        <div style={{ height: 1, background: "rgba(255,255,255,0.06)" }} />
        <MttrCounter start={ticket.execution_start} />
      </div>

      {/* ── Date pianificazione ── */}
      <div style={{
        display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 16,
      }}>
        {[
          { label: "Inizio Pianificato", value: ticket.planned_start, color: "#a78bfa", icon: "▶" },
          { label: "Fine Pianificata",   value: ticket.planned_finish, color: "#34d399", icon: "⏹" },
        ].map(item => (
          <div key={item.label} style={{
            background: "rgba(255,255,255,0.03)", border: `1px solid ${item.color}30`,
            borderTop: `3px solid ${item.color}`, borderRadius: 14, padding: "12px 10px",
            textAlign: "center",
          }}>
            <div style={{ fontSize: 9, color: "rgba(255,255,255,0.35)", fontWeight: 700, letterSpacing: "0.12em", textTransform: "uppercase", marginBottom: 6 }}>
              {item.icon} {item.label}
            </div>
            {item.value ? (
              <>
                <div style={{ fontSize: "clamp(16px, 5vw, 20px)", fontWeight: 900, color: item.color, fontFamily: "var(--font-mono)", lineHeight: 1 }}>
                  {new Date(item.value).toLocaleTimeString("it-IT", { hour: "2-digit", minute: "2-digit" })}
                </div>
                <div style={{ fontSize: 11, color: "rgba(255,255,255,0.35)", marginTop: 3 }}>
                  {new Date(item.value).toLocaleDateString("it-IT", { day: "2-digit", month: "2-digit", year: "2-digit" })}
                </div>
              </>
            ) : (
              <div style={{ fontSize: 20, color: "rgba(255,255,255,0.2)", fontWeight: 900 }}>—</div>
            )}
          </div>
        ))}
      </div>

      {/* ── Asset info ── */}
      <div style={{
        background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.07)",
        borderRadius: 14, padding: "12px 14px", marginBottom: 16,
        display: "flex", alignItems: "center", gap: 10,
      }}>
        <span style={{ fontSize: 22 }}>🏭</span>
        <div>
          <div style={{ fontSize: 13, fontWeight: 700, color: "#e2e8f0" }}>{ticket.asset_name}</div>
          {ticket.durata_stimata_ore && (
            <div style={{ fontSize: 11, color: "rgba(255,255,255,0.35)", marginTop: 2 }}>
              Durata stimata: {ticket.durata_stimata_ore}h
            </div>
          )}
        </div>
        <span style={{
          marginLeft: "auto", fontSize: 10, fontWeight: 700, padding: "2px 8px", borderRadius: 20,
          color: prioritaColor(ticket.priorita), background: `${prioritaColor(ticket.priorita)}15`,
          border: `1px solid ${prioritaColor(ticket.priorita)}30`,
        }}>
          {ticket.priorita}
        </span>
      </div>

      {/* ── Safety Checklist ── */}
      <div style={{
        background: "rgba(239,68,68,0.04)", border: `1px solid rgba(239,68,68,${allChecked ? "0.15" : "0.35"})`,
        borderRadius: 16, padding: "14px", marginBottom: 16,
        transition: "border-color 0.3s",
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
          <span style={{ fontSize: 16 }}>🦺</span>
          <span style={{ fontSize: 11, fontWeight: 800, color: allChecked ? "#34d399" : "#f87171", letterSpacing: "0.12em", textTransform: "uppercase" }}>
            Safety Checklist
          </span>
          <span style={{ marginLeft: "auto", fontSize: 11, color: "rgba(255,255,255,0.35)", fontFamily: "var(--font-mono)" }}>
            {checked.size}/{checklist.length}
          </span>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {checklist.map(item => (
            <button
              key={item.id}
              onClick={() => toggle(item.id)}
              style={{
                display: "flex", alignItems: "center", gap: 12,
                background: checked.has(item.id) ? "rgba(52,211,153,0.08)" : "rgba(255,255,255,0.03)",
                border: `1px solid ${checked.has(item.id) ? "rgba(52,211,153,0.25)" : "rgba(255,255,255,0.08)"}`,
                borderRadius: 10, padding: "10px 12px",
                cursor: "pointer", textAlign: "left", transition: "all 0.15s",
              }}
            >
              <span style={{
                width: 22, height: 22, borderRadius: 6, flexShrink: 0,
                background: checked.has(item.id) ? "#34d399" : "rgba(255,255,255,0.08)",
                border: `2px solid ${checked.has(item.id) ? "#34d399" : "rgba(255,255,255,0.15)"}`,
                display: "flex", alignItems: "center", justifyContent: "center",
                fontSize: 13, color: "#fff", fontWeight: 900,
                transition: "all 0.15s",
              }}>
                {checked.has(item.id) ? "✓" : ""}
              </span>
              <span style={{
                fontSize: 13, color: checked.has(item.id) ? "#86efac" : "#cbd5e1",
                textDecoration: checked.has(item.id) ? "line-through" : "none",
                fontWeight: checked.has(item.id) ? 500 : 600,
                transition: "all 0.15s",
              }}>
                {item.text}
              </span>
            </button>
          ))}
        </div>
        {allChecked && (
          <div style={{ marginTop: 10, fontSize: 12, color: "#34d399", fontWeight: 700, textAlign: "center" }}>
            ✅ Tutte le verifiche completate — puoi procedere in sicurezza
          </div>
        )}
      </div>

      {/* ── Nota vocale ── */}
      <div style={{ marginBottom: 16 }}>
        <button
          onClick={() => setShowVoice(v => !v)}
          style={{
            width: "100%", height: 44, borderRadius: 12,
            background: showVoice ? "rgba(91,143,255,0.15)" : "rgba(255,255,255,0.04)",
            border: `1px solid ${showVoice ? "rgba(91,143,255,0.35)" : "rgba(255,255,255,0.08)"}`,
            color: showVoice ? "#90b8ff" : "#94a3b8",
            fontWeight: 700, fontSize: 13, cursor: "pointer",
            display: "flex", alignItems: "center", justifyContent: "center", gap: 8,
          }}
        >
          🎙️ {showVoice ? "Chiudi nota vocale" : "Aggiungi nota vocale"}
        </button>
        {showVoice && (
          <div style={{
            marginTop: 8, background: "rgba(91,143,255,0.05)", border: "1px solid rgba(91,143,255,0.15)",
            borderRadius: 14, padding: 14, display: "flex", flexDirection: "column", gap: 10,
          }}>
            <VoiceRecorder onTranscript={(t) => setTranscript(prev => prev ? prev + " " + t : t)} disabled={savingVoice} />
            {transcript && (
              <>
                <textarea
                  ref={textareaRef}
                  value={transcript}
                  onChange={e => setTranscript(e.target.value)}
                  rows={3}
                  style={{
                    width: "100%", resize: "vertical", background: "rgba(91,143,255,0.07)",
                    border: "1px solid rgba(91,143,255,0.20)", borderRadius: 10,
                    color: "var(--text-primary)", padding: "10px 12px", fontSize: 14, outline: "none",
                    boxSizing: "border-box",
                  }}
                />
                <button onClick={handleSaveVoice} disabled={savingVoice} style={{
                  height: 44, borderRadius: 12, background: "rgba(91,143,255,0.85)",
                  border: "none", color: "white", fontWeight: 800, fontSize: 13, cursor: "pointer",
                }}>
                  {savingVoice ? "Salvataggio…" : "💾 SALVA NEL TICKET"}
                </button>
              </>
            )}
          </div>
        )}
      </div>

      {/* ── Allegati ── */}
      <div style={{ marginBottom: 16 }}>
        <UploadAllegati ticketId={ticket.id} />
      </div>

      {/* ── Azioni ── */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, paddingBottom: 8 }}>
        <button
          onClick={() => onStatusChange(ticket.id, "Chiuso")}
          style={{
            height: 64, borderRadius: 16,
            background: "linear-gradient(135deg, #10b981 0%, #059669 100%)",
            border: "none", color: "white", fontWeight: 900, fontSize: 16,
            cursor: "pointer", boxShadow: "0 6px 24px rgba(16,185,129,0.4)",
            display: "flex", alignItems: "center", justifyContent: "center", gap: 8,
          }}
        >
          <span style={{ fontSize: 22 }}>✅</span> CHIUDI
        </button>
        <button
          onClick={() => onStatusChange(ticket.id, "Pianificato")}
          style={{
            height: 64, borderRadius: 16,
            background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.12)",
            color: "#94a3b8", fontWeight: 800, fontSize: 15, cursor: "pointer",
            display: "flex", alignItems: "center", justifyContent: "center", gap: 8,
          }}
        >
          <span style={{ fontSize: 20 }}>⏸</span> PAUSA
        </button>
      </div>
    </div>
  );
}

// ── Ticket card prossimo ──────────────────────────────────────────────────────
function UpcomingTicketCard({ ticket, onStart }: { ticket: Ticket; onStart: (id: number) => Promise<void> }) {
  const [starting, setStarting] = useState(false);
  const tipo = tipoLabel(ticket.tipo);
  return (
    <div style={{ background: "var(--bg-card, var(--surface-2))", border: "1px solid var(--border, rgba(255,255,255,0.08))", borderRadius: 16, overflow: "hidden" }}>
      <div style={{ padding: "14px 16px", display: "flex", alignItems: "center", gap: 12 }}>
        <span style={{ fontSize: 20, flexShrink: 0 }}>{tipo.icon}</span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 14, fontWeight: 700, color: "var(--text-primary)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{ticket.titolo}</div>
          <div style={{ display: "flex", gap: 6, alignItems: "center", marginTop: 3 }}>
            <span style={{ fontSize: 11, color: "#90b8ff", fontWeight: 600 }}>{ticket.asset_name}</span>
            {ticket.planned_start && (
              <span style={{ fontSize: 10, color: "var(--text-muted)" }}>
                · {new Date(ticket.planned_start).toLocaleDateString("it-IT", { day: "2-digit", month: "2-digit" })}
                {" "}{new Date(ticket.planned_start).toLocaleTimeString("it-IT", { hour: "2-digit", minute: "2-digit" })}
              </span>
            )}
            <span style={{ fontSize: 10, fontWeight: 700, padding: "1px 7px", borderRadius: 999, color: prioritaColor(ticket.priorita), background: `${prioritaColor(ticket.priorita)}15` }}>
              {ticket.priorita}
            </span>
          </div>
        </div>
        <button
          onClick={async () => { setStarting(true); await onStart(ticket.id); setStarting(false); }}
          disabled={starting}
          style={{
            minWidth: 88, height: 48, borderRadius: 12, flexShrink: 0,
            background: "linear-gradient(135deg, #3b82f6 0%, #1d4ed8 100%)",
            border: "none", color: "white", fontWeight: 800, fontSize: 13,
            cursor: starting ? "wait" : "pointer",
            boxShadow: "0 4px 16px rgba(59,130,246,0.30)",
            display: "flex", alignItems: "center", justifyContent: "center", gap: 6,
          }}
        >
          {starting ? "…" : <><span>▶</span> INIZIA</>}
        </button>
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
            onStart={async (id) => {
              await updateStatus(id, "In corso");
              const updated = { ...t, stato: "In corso", execution_start: new Date().toISOString() };
              setActiveView(updated);
            }}
          />
        ))}
      </section>
    </div>
  );
}
