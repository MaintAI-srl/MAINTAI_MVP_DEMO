"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import { apiGet, apiPut } from "../lib/api";
import { notify } from "@/lib/toast";
import { useAuth } from "../lib/auth";
import UploadAllegati from "../components/UploadAllegati";
import SignaturePad from "../components/SignaturePad";
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
  durata_stimata_ore?: number;
  descrizione?: string;
};

// ── Colori priorità ─────────────────────────────────────────────────────────
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

// ── Elapsed timer (mostra tempo da execution_start) ─────────────────────────
function ElapsedTimer({ start }: { start?: string }) {
  const [sec, setSec] = useState(0);
  useEffect(() => {
    if (!start) return;
    const startMs = new Date(start).getTime();
    const tick = () => setSec(Math.floor((Date.now() - startMs) / 1000));
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [start]);
  if (!start) return null;
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  const fmt = h > 0
    ? `${h}h ${String(m).padStart(2, "0")}m`
    : `${m}m ${String(s).padStart(2, "0")}s`;
  return (
    <div style={{
      display: "inline-flex", alignItems: "center", gap: 5,
      fontSize: 12, color: "#fbbf24", fontWeight: 700,
      fontFamily: "var(--font-mono)",
      background: "rgba(251,191,36,0.10)", border: "1px solid rgba(251,191,36,0.25)",
      borderRadius: 8, padding: "3px 10px",
    }}>
      ⏱ {fmt}
    </div>
  );
}

// ── Pannello note vocali per un ticket ──────────────────────────────────────
function VoiceNotePanel({ ticketId, onSaved }: { ticketId: number; onSaved: () => void }) {
  const [transcript, setTranscript] = useState("");
  const [saving, setSaving] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const handleTranscript = (text: string) => {
    setTranscript(prev => prev ? prev + " " + text : text);
    setTimeout(() => textareaRef.current?.focus(), 100);
  };

  const handleSave = async () => {
    if (!transcript.trim()) return;
    setSaving(true);
    try {
      await apiPut(`/tickets/${ticketId}`, { note_vocali: transcript.trim() });
      notify.success("Nota vocale salvata nel ticket ✓", "VOICE");
      setTranscript("");
      onSaved();
    } catch {
      notify.error("Errore nel salvataggio della nota", "VOICE");
    }
    setSaving(false);
  };

  return (
    <div style={{
      background: "rgba(91,143,255,0.05)", borderRadius: 14,
      border: "1px solid rgba(91,143,255,0.15)", padding: 14,
      display: "flex", flexDirection: "column", gap: 10,
    }}>
      <div style={{ fontSize: 11, fontWeight: 800, color: "#90b8ff", letterSpacing: "0.12em", textTransform: "uppercase" }}>
        🎙️ Nota vocale
      </div>
      <VoiceRecorder onTranscript={handleTranscript} disabled={saving} />
      {transcript && (
        <>
          <textarea
            ref={textareaRef}
            value={transcript}
            onChange={e => setTranscript(e.target.value)}
            rows={3}
            style={{
              width: "100%", resize: "vertical",
              background: "rgba(91,143,255,0.07)", border: "1px solid rgba(91,143,255,0.20)",
              borderRadius: 10, color: "var(--text-primary)", padding: "10px 12px",
              fontSize: 14, fontFamily: "var(--font-body)", outline: "none",
            }}
            placeholder="Modifica il testo se necessario..."
          />
          <button
            onClick={handleSave}
            disabled={saving}
            style={{
              height: 44, borderRadius: 12, background: "rgba(91,143,255,0.85)",
              border: "none", color: "white", fontWeight: 800, fontSize: 13,
              cursor: saving ? "wait" : "pointer",
            }}
          >
            {saving ? "Salvataggio…" : "💾 SALVA NEL TICKET"}
          </button>
        </>
      )}
    </div>
  );
}

// ── Ticket card attivo (In corso) ────────────────────────────────────────────
function ActiveTicketCard({
  ticket,
  onStatusChange,
  onSign,
}: {
  ticket: Ticket;
  onStatusChange: (id: number, stato: string) => Promise<void>;
  onSign: (id: number) => void;
}) {
  const [expanded, setExpanded] = useState(true);
  const [showVoice, setShowVoice] = useState(false);
  const tipo = tipoLabel(ticket.tipo);

  return (
    <div style={{
      background: "linear-gradient(135deg, rgba(251,191,36,0.07) 0%, rgba(10,15,30,0.5) 100%)",
      border: "2px solid #fbbf24",
      borderRadius: 20, overflow: "hidden",
    }}>
      {/* Header — sempre visibile, tap per espandere */}
      <div
        onClick={() => setExpanded(e => !e)}
        style={{
          padding: "14px 16px", display: "flex", alignItems: "center",
          gap: 12, cursor: "pointer", userSelect: "none",
        }}
      >
        <span style={{ fontSize: 22 }}>{tipo.icon}</span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{
            fontSize: 16, fontWeight: 800, color: "var(--text-primary)",
            overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
          }}>
            {ticket.titolo}
          </div>
          <div style={{ fontSize: 12, color: "var(--text-secondary)", marginTop: 2 }}>
            {ticket.asset_name}
          </div>
        </div>
        <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 4, flexShrink: 0 }}>
          <ElapsedTimer start={ticket.execution_start} />
          <span style={{ fontSize: 16, color: "#fbbf24" }}>{expanded ? "▲" : "▼"}</span>
        </div>
      </div>

      {/* Body espandibile */}
      {expanded && (
        <div style={{ padding: "0 16px 16px", display: "flex", flexDirection: "column", gap: 12 }}>

          {/* Info pills */}
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
            <span style={{
              fontSize: 11, fontWeight: 700, padding: "3px 10px", borderRadius: 20,
              color: prioritaColor(ticket.priorita),
              background: `${prioritaColor(ticket.priorita)}18`,
              border: `1px solid ${prioritaColor(ticket.priorita)}44`,
            }}>
              {ticket.priorita}
            </span>
            <span style={{
              fontSize: 11, fontWeight: 700, padding: "3px 10px", borderRadius: 20,
              color: tipo.color, background: `${tipo.color}18`, border: `1px solid ${tipo.color}44`,
            }}>
              {tipo.label}
            </span>
            {ticket.durata_stimata_ore && (
              <span style={{ fontSize: 11, color: "var(--text-muted)", padding: "3px 10px", borderRadius: 20, background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)" }}>
                ⏳ {ticket.durata_stimata_ore}h stimate
              </span>
            )}
            <span style={{ fontSize: 11, color: "var(--text-muted)", fontFamily: "var(--font-mono)", padding: "3px 10px", background: "rgba(255,255,255,0.04)", borderRadius: 20, border: "1px solid rgba(255,255,255,0.08)" }}>
              #{ticket.id}
            </span>
          </div>

          {/* Azioni principali — ONE CLICK */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
            <button
              onClick={() => onSign(ticket.id)}
              style={{
                height: 56, borderRadius: 14, background: "linear-gradient(135deg, #10b981 0%, #059669 100%)",
                border: "none", color: "white", fontWeight: 900, fontSize: 15,
                cursor: "pointer", boxShadow: "0 4px 20px rgba(16,185,129,0.35)",
                display: "flex", alignItems: "center", justifyContent: "center", gap: 8,
              }}
            >
              <span style={{ fontSize: 20 }}>✅</span> CHIUDI
            </button>
            <button
              onClick={() => onStatusChange(ticket.id, "Pianificato")}
              style={{
                height: 56, borderRadius: 14, background: "rgba(255,255,255,0.06)",
                border: "1px solid rgba(255,255,255,0.15)", color: "var(--text-secondary)",
                fontWeight: 800, fontSize: 14, cursor: "pointer",
                display: "flex", alignItems: "center", justifyContent: "center", gap: 8,
              }}
            >
              <span style={{ fontSize: 18 }}>⏸</span> PAUSA
            </button>
          </div>

          {/* Nota Vocale toggle */}
          <button
            onClick={() => setShowVoice(v => !v)}
            style={{
              height: 44, borderRadius: 12,
              background: showVoice ? "rgba(91,143,255,0.12)" : "rgba(255,255,255,0.03)",
              border: showVoice ? "1px solid rgba(91,143,255,0.3)" : "1px solid rgba(255,255,255,0.08)",
              color: showVoice ? "#90b8ff" : "var(--text-muted)",
              fontWeight: 700, fontSize: 13, cursor: "pointer",
              display: "flex", alignItems: "center", justifyContent: "center", gap: 8,
              transition: "all 0.2s",
            }}
          >
            🎙️ {showVoice ? "Chiudi nota vocale" : "Aggiungi nota vocale"}
          </button>

          {showVoice && (
            <VoiceNotePanel ticketId={ticket.id} onSaved={() => setShowVoice(false)} />
          )}

          {/* Allegati */}
          <div style={{ borderTop: "1px solid rgba(251,191,36,0.12)", paddingTop: 12 }}>
            <UploadAllegati ticketId={ticket.id} />
          </div>
        </div>
      )}
    </div>
  );
}

// ── Ticket card prossimo (Pianificato / Aperto) ──────────────────────────────
function UpcomingTicketCard({
  ticket,
  onStart,
}: {
  ticket: Ticket;
  onStart: (id: number) => Promise<void>;
}) {
  const [starting, setStarting] = useState(false);
  const tipo = tipoLabel(ticket.tipo);

  const handleStart = async () => {
    setStarting(true);
    await onStart(ticket.id);
    setStarting(false);
  };

  return (
    <div style={{
      background: "var(--bg-card, #111827)",
      border: "1px solid var(--border, rgba(255,255,255,0.08))",
      borderRadius: 16, overflow: "hidden",
    }}>
      <div style={{
        padding: "14px 16px", display: "flex", alignItems: "center",
        gap: 12,
      }}>
        <span style={{ fontSize: 20, flexShrink: 0 }}>{tipo.icon}</span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{
            fontSize: 14, fontWeight: 700, color: "var(--text-primary)",
            overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
          }}>
            {ticket.titolo}
          </div>
          <div style={{ display: "flex", gap: 6, alignItems: "center", marginTop: 3 }}>
            <span style={{ fontSize: 11, color: "#90b8ff", fontWeight: 600 }}>{ticket.asset_name}</span>
            {ticket.planned_start && (
              <span style={{ fontSize: 10, color: "var(--text-muted)" }}>
                · {new Date(ticket.planned_start).toLocaleDateString("it-IT", { day: "2-digit", month: "2-digit" })}
              </span>
            )}
            <span style={{
              fontSize: 10, fontWeight: 700, padding: "1px 7px", borderRadius: 999,
              color: prioritaColor(ticket.priorita),
              background: `${prioritaColor(ticket.priorita)}15`,
            }}>
              {ticket.priorita}
            </span>
          </div>
        </div>

        {/* ONE CLICK — INIZIA */}
        <button
          onClick={handleStart}
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

// ── Main mobile page ─────────────────────────────────────────────────────────
export default function MobileHomePage() {
  const { user } = useAuth();
  const [mounted, setMounted] = useState(false);
  const [tecnicoId, setTecnicoId] = useState<number | null>(null);
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [loading, setLoading] = useState(true);
  const [signingTicketId, setSigningTicketId] = useState<number | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  useEffect(() => { setMounted(true); }, []);

  useEffect(() => {
    if (!user?.userid || !mounted) return;
    apiGet<any>(`/tecnici/me?utente_id=${user.userid}`)
      .then(d => setTecnicoId(d.id))
      .catch(() => {
        // Profilo tecnico non collegato — mostriamo comunque la pagina
        // con un banner di avviso, e carichiamo i ticket senza filtro tecnico
        setTecnicoId(-1); // sentinella: utente loggato ma senza profilo tecnico
        setLoading(false);
      });
  }, [user, mounted]);

  const loadTickets = useCallback(async () => {
    if (tecnicoId === null || !mounted) return;
    if (tecnicoId === -1) { setLoading(false); return; }
    try {
      const d = await apiGet<any>(`/tickets?tecnico_id=${tecnicoId}&limit=50`);
      setTickets(d.items ?? []);
    } catch {
      notify.error("Errore nel caricamento degli interventi.", "MOBILE");
    }
    setLoading(false);
  }, [tecnicoId, mounted]);

  useEffect(() => { loadTickets(); }, [loadTickets]);


  const handleRefresh = async () => {
    setRefreshing(true);
    await loadTickets();
    setRefreshing(false);
  };

  const updateStatus = async (tid: number, newStato: string) => {
    try {
      const body: Record<string, string | null> = { stato: newStato };
      if (newStato === "In corso") {
        body.execution_start = new Date().toISOString();
      } else if (newStato === "Chiuso") {
        body.execution_finish = new Date().toISOString();
      }
      await apiPut(`/tickets/${tid}`, body);
      setTickets(prev => prev.map(t =>
        t.id === tid
          ? { ...t, stato: newStato, execution_start: newStato === "In corso" ? new Date().toISOString() : t.execution_start }
          : t
      ));
      notify.success(
        newStato === "In corso"  ? "✅ Intervento avviato" :
        newStato === "Chiuso"    ? "✅ Intervento completato!" :
        `Stato: ${newStato}`,
        "TICKET"
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
        <Skeleton variant="card" />
      </div>
    );
  }

  const activeTickets   = tickets.filter(t => t.stato === "In corso");
  const upcomingTickets = tickets.filter(t => t.stato === "Pianificato" || t.stato === "Aperto");
  const totalTickets    = activeTickets.length + upcomingTickets.length;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20, paddingBottom: 24 }}>

      {/* ── Header ───────────────────────────────────────────── */}
      <div style={{
        display: "flex", justifyContent: "space-between", alignItems: "center",
        padding: "4px 0",
      }}>
        <div>
          <h1 style={{ fontSize: 26, fontWeight: 900, color: "var(--text-primary)", margin: 0, letterSpacing: "-0.03em" }}>
            Ciao, <span style={{ color: "#90b8ff" }}>{user?.username}</span> 👷
          </h1>
          <p style={{ margin: "4px 0 0", fontSize: 13, color: "var(--text-secondary)" }}>
            {totalTickets === 0
              ? "Nessun intervento assegnato"
              : `${activeTickets.length} attivi · ${upcomingTickets.length} pianificati`}
          </p>
        </div>
        <button
          onClick={handleRefresh}
          disabled={refreshing}
          style={{
            background: "rgba(91,143,255,0.08)", border: "1px solid rgba(91,143,255,0.20)",
            borderRadius: 12, width: 46, height: 46,
            display: "flex", alignItems: "center", justifyContent: "center",
            cursor: refreshing ? "wait" : "pointer", fontSize: 20,
            transition: "transform 0.4s", transform: refreshing ? "rotate(360deg)" : "none",
          }}
          title="Aggiorna"
        >🔄</button>
      </div>

      {/* ── NoProfilo banner ─────────────────────────────── */}
      {tecnicoId === -1 && (
        <div style={{
          background: "rgba(251,191,36,0.08)", border: "1px solid rgba(251,191,36,0.30)",
          borderRadius: 14, padding: "14px 16px", display: "flex", gap: 12, alignItems: "flex-start",
        }}>
          <span style={{ fontSize: 22, flexShrink: 0 }}>⚠️</span>
          <div>
            <div style={{ fontWeight: 800, fontSize: 13, color: "#fbbf24", marginBottom: 4 }}>
              Profilo tecnico non collegato
            </div>
            <div style={{ fontSize: 12, color: "var(--text-secondary)", lineHeight: 1.5 }}>
              Il tuo account non è ancora associato a un profilo tecnico. Contatta il responsabile per collegare l'account. I ticket non saranno visibili finché non viene effettuata l'associazione.
            </div>
          </div>
        </div>
      )}

      {/* ── Stats strip ──────────────────────────────────────── */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8 }}>
        {[
          { label: "In corso",     count: activeTickets.length, color: "#fbbf24" },
          { label: "Pianificati",  count: upcomingTickets.filter(t => t.stato === "Pianificato").length, color: "#a78bfa" },
          { label: "Aperti",       count: upcomingTickets.filter(t => t.stato === "Aperto").length, color: "#60a5fa" },
        ].map(s => (
          <div key={s.label} style={{
            background: "var(--bg-elevated, #1f2937)",
            border: `1px solid ${s.color}30`,
            borderTop: `3px solid ${s.color}`,
            borderRadius: 14, padding: "12px 10px", textAlign: "center",
          }}>
            <div style={{ fontSize: 28, fontWeight: 900, color: s.color, lineHeight: 1 }}>{s.count}</div>
            <div style={{ fontSize: 9, color: "var(--text-muted)", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.08em", marginTop: 4 }}>{s.label}</div>
          </div>
        ))}
      </div>

      {/* ── Sezione: In corso ────────────────────────────────── */}
      {activeTickets.length > 0 && (
        <section style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <div style={{ fontSize: 10, fontWeight: 800, textTransform: "uppercase", letterSpacing: "0.15em", color: "#fbbf24", display: "flex", alignItems: "center", gap: 6 }}>
            <span style={{ width: 7, height: 7, borderRadius: "50%", background: "#fbbf24", display: "inline-block", boxShadow: "0 0 8px #fbbf2480" }} />
            In corso ora
          </div>
          {activeTickets.map(t => (
            <ActiveTicketCard
              key={t.id}
              ticket={t}
              onStatusChange={updateStatus}
              onSign={id => setSigningTicketId(id)}
            />
          ))}
        </section>
      )}

      {/* ── Sezione: Prossimi interventi ─────────────────────── */}
      <section style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        <div style={{ fontSize: 10, fontWeight: 800, textTransform: "uppercase", letterSpacing: "0.15em", color: "var(--text-muted)", display: "flex", alignItems: "center", gap: 6 }}>
          <span style={{ width: 7, height: 7, borderRadius: "50%", background: "#60a5fa", display: "inline-block" }} />
          Prossimi interventi
        </div>

        {upcomingTickets.length === 0 ? (
          <div style={{
            padding: 32, textAlign: "center", background: "var(--bg-card, #111827)",
            borderRadius: 16, border: "1px dashed var(--border, rgba(255,255,255,0.08))",
            color: "var(--text-disabled)",
          }}>
            <div style={{ fontSize: 32, marginBottom: 8 }}>📋</div>
            Nessun intervento pianificato
          </div>
        ) : (
          upcomingTickets.map(t => (
            <UpcomingTicketCard
              key={t.id}
              ticket={t}
              onStart={async (id) => {
                await updateStatus(id, "In corso");
                await loadTickets();
              }}
            />
          ))
        )}
      </section>

      {/* ── Offline indicator ────────────────────────────────── */}
      <OfflineIndicator />

      {/* ── Firma modale ─────────────────────────────────────── */}
      {signingTicketId && (
        <div style={{
          position: "fixed", inset: 0, zIndex: 5000,
          background: "rgba(0,0,0,0.90)", display: "flex", alignItems: "center", padding: 20,
        }}>
          <div style={{ width: "100%" }}>
            <SignaturePad
              onCancel={() => setSigningTicketId(null)}
              onSave={async (base64) => {
                try {
                  const { apiPost } = await import("../lib/api");
                  await apiPost(`/tickets/${signingTicketId}/firma`, { image: base64 });
                  await updateStatus(signingTicketId, "Chiuso");
                  setSigningTicketId(null);
                  await loadTickets();
                } catch {
                  notify.error("Errore nel salvataggio della firma.", "MOBILE");
                }
              }}
            />
          </div>
        </div>
      )}
    </div>
  );
}

// ── Indicatore offline ───────────────────────────────────────────────────────
function OfflineIndicator() {
  const [isOnline, setIsOnline] = useState(true);
  useEffect(() => {
    setIsOnline(navigator.onLine);
    const onOnline = () => setIsOnline(true);
    const onOffline = () => setIsOnline(false);
    window.addEventListener("online", onOnline);
    window.addEventListener("offline", onOffline);
    return () => {
      window.removeEventListener("online", onOnline);
      window.removeEventListener("offline", onOffline);
    };
  }, []);
  if (isOnline) return null;
  return (
    <div style={{
      position: "fixed", bottom: 0, left: 0, right: 0,
      padding: "10px 16px", background: "#7c2d12", color: "#fef3c7",
      fontSize: 12, fontWeight: 700, textAlign: "center", zIndex: 9000,
      display: "flex", alignItems: "center", justifyContent: "center", gap: 8,
    }}>
      <span>📡</span> Modalità offline — dati non aggiornati
    </div>
  );
}
