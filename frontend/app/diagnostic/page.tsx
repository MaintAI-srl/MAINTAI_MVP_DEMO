"use client";

import { useState, useEffect, useRef, Suspense } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { apiPost, apiGet } from "@/app/lib/api";
import { notify } from "@/lib/toast";

type StepType = "question" | "check" | "conclusion";

interface Step {
  type: StepType;
  content: string;
  detail: string;
  instrument?: string | null;
  expected_value?: string | null;
  root_cause?: string;
  recommended_actions?: string[];
}

interface Message {
  from: "ai" | "user";
  step?: Step;
  text?: string;
  timestamp: Date;
}

interface TicketOption {
  id: number;
  titolo: string;
  asset_name: string;
  tipo: string;
  stato: string;
  priorita: string;
}

// ── Tipi FIE ──────────────────────────────────────────────────────────────────
interface FailureModeResult {
  rank: number;
  failure_mode_id: number;
  component: string;
  failure_mode: string;
  failure_cause: string | null;
  failure_effect: string | null;
  detection_method: string | null;
  recommended_action: string | null;
  severity: number;
  occurrence: number;
  detectability: number;
  rpn: number;
  rpn_class: "LOW" | "MEDIUM" | "HIGH";
  probability_score: number;
  mtbf_hours: number | null;
  ai_explanation: string;
}

interface FIEAnalysisResult {
  failure_modes_ranked: FailureModeResult[];
  most_probable_cause: string;
  recommended_actions: string[];
  priority: string;
  confidence_score: number;
  explanation: string;
  asset_type_used: string;
}

const ASSET_TYPES = [
  { value: "motore_elettrico", label: "Motore Elettrico" },
  { value: "pompa_centrifuga", label: "Pompa Centrifuga" },
  { value: "compressore", label: "Compressore" },
  { value: "quadro_elettrico", label: "Quadro Elettrico" },
  { value: "valvola_industriale", label: "Valvola Industriale" },
  { value: "nastro_trasportatore", label: "Nastro Trasportatore" },
  { value: "generico", label: "Generico / Altro" },
];

// ── Badge RPN ─────────────────────────────────────────────────────────────────
function RpnBadge({ cls, rpn }: { cls: string; rpn: number }) {
  const color = cls === "HIGH" ? "#ef4444" : cls === "MEDIUM" ? "#f59e0b" : "#22c55e";
  const bg = cls === "HIGH" ? "#ef444418" : cls === "MEDIUM" ? "#f59e0b18" : "#22c55e18";
  return (
    <span style={{ fontSize: 10, padding: "2px 7px", borderRadius: 3, fontWeight: 700, color, background: bg, border: `1px solid ${color}44`, fontFamily: "monospace" }}>
      RPN {rpn} · {cls}
    </span>
  );
}

// ── FIE Panel ─────────────────────────────────────────────────────────────────
function FIEPanel({ ticketId }: { ticketId: string }) {
  const [open, setOpen] = useState(false);
  const [symptoms, setSymptoms] = useState("");
  const [assetType, setAssetType] = useState("");
  const [analyzing, setAnalyzing] = useState(false);
  const [result, setResult] = useState<FIEAnalysisResult | null>(null);

  // Conferma
  const [selectedFmId, setSelectedFmId] = useState<number | "other">("other");
  const [realCause, setRealCause] = useState("");
  const [actionTaken, setActionTaken] = useState("");
  const [resolutionTime, setResolutionTime] = useState("");
  const [successFlag, setSuccessFlag] = useState(true);
  const [saving, setSaving] = useState(false);
  const [savedOk, setSavedOk] = useState(false);

  async function handleAnalyze() {
    if (!symptoms.trim()) {
      notify.warning("Inserisci i sintomi prima di avviare l'analisi.");
      return;
    }
    setAnalyzing(true);
    setResult(null);
    setSavedOk(false);
    try {
      const data = await apiPost<FIEAnalysisResult>(`/failure/tickets/${ticketId}/analyze`, {
        symptoms: symptoms.trim(),
        asset_type: assetType,
        description: "",
      });
      setResult(data);
      if (data.failure_modes_ranked.length > 0) {
        setSelectedFmId(data.failure_modes_ranked[0].failure_mode_id);
      }
    } catch {
      notify.error("Errore durante l'analisi FIE. Riprova.");
    } finally {
      setAnalyzing(false);
    }
  }

  async function handleSaveLearn() {
    if (!realCause.trim() || !actionTaken.trim()) {
      notify.warning("Compila causa reale e azione intrapresa prima di salvare.");
      return;
    }
    setSaving(true);
    try {
      await apiPost(`/failure/tickets/${ticketId}/confirm`, {
        failure_mode_id: selectedFmId === "other" ? 0 : selectedFmId,
        symptoms: symptoms.trim(),
        real_cause: realCause.trim(),
        action_taken: actionTaken.trim(),
        resolution_time_minutes: parseInt(resolutionTime || "0", 10),
        success: successFlag,
      });
      setSavedOk(true);
      setTimeout(() => setSavedOk(false), 3000);
      setRealCause("");
      setActionTaken("");
      setResolutionTime("");
    } catch {
      notify.error("Errore nel salvataggio del learning. Riprova.");
    } finally {
      setSaving(false);
    }
  }

  const panelStyle: React.CSSProperties = {
    width: "100%",
    maxWidth: 680,
    margin: "0 auto",
    border: "1px solid var(--border-default)",
    background: "var(--surface-0)",
    fontFamily: "'IBM Plex Mono', 'Courier New', monospace",
  };

  const headerStyle: React.CSSProperties = {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    padding: "10px 16px",
    borderBottom: open ? "1px solid #374151" : "none",
    cursor: "pointer",
    background: "var(--surface-2)",
    userSelect: "none",
  };

  return (
    <div style={panelStyle}>
      {/* Header collassabile */}
      <div style={headerStyle} onClick={() => setOpen(o => !o)}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <span style={{ fontSize: 11, letterSpacing: "0.15em", color: "#6366f1", fontWeight: 700 }}>FIE</span>
          <span style={{ fontSize: 11, letterSpacing: "0.12em", color: "var(--text-muted)" }}>FAILURE INTELLIGENCE ENGINE</span>
        </div>
        <span style={{ fontSize: 12, color: "#6b7280" }}>{open ? "▲" : "▼"}</span>
      </div>

      {open && (
        <div style={{ padding: "16px", display: "flex", flexDirection: "column", gap: 14 }}>
          {/* Form analisi */}
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            <label style={{ fontSize: 10, letterSpacing: "0.12em", color: "#6b7280" }}>SINTOMI OSSERVATI *</label>
            <textarea
              value={symptoms}
              onChange={e => setSymptoms(e.target.value)}
              placeholder="Descrivi i sintomi: rumore, vibrazione, temperatura, perdite, errori..."
              rows={3}
              style={{ background: "var(--surface-2)", border: "1px solid var(--border-default)", color: "var(--text-primary)", padding: "8px 12px", fontSize: 12, fontFamily: "inherit", resize: "vertical", outline: "none" }}
            />
          </div>

          <div style={{ display: "flex", gap: 12, alignItems: "flex-end" }}>
            <div style={{ flex: 1 }}>
              <label style={{ fontSize: 10, letterSpacing: "0.12em", color: "#6b7280", display: "block", marginBottom: 6 }}>TIPO ASSET</label>
              <select
                value={assetType}
                onChange={e => setAssetType(e.target.value)}
                style={{ width: "100%", background: "var(--surface-2)", border: "1px solid var(--border-default)", color: "var(--text-primary)", padding: "8px 12px", fontSize: 12, fontFamily: "inherit", outline: "none" }}
              >
                <option value="">— Auto-detect dall&apos;asset —</option>
                {ASSET_TYPES.map(at => (
                  <option key={at.value} value={at.value}>{at.label}</option>
                ))}
              </select>
            </div>
            <button
              onClick={handleAnalyze}
              disabled={analyzing || !symptoms.trim()}
              style={{ padding: "8px 20px", background: "transparent", border: "1px solid #6366f1", color: analyzing ? "#6b7280" : "#6366f1", fontSize: 11, letterSpacing: "0.12em", cursor: analyzing || !symptoms.trim() ? "not-allowed" : "pointer", fontFamily: "inherit", opacity: analyzing || !symptoms.trim() ? 0.5 : 1, whiteSpace: "nowrap" }}
            >
              {analyzing ? "ANALISI..." : "ANALIZZA"}
            </button>
          </div>

          {/* Spinner */}
          {analyzing && (
            <div style={{ display: "flex", alignItems: "center", gap: 10, color: "#6b7280", fontSize: 11 }}>
              <div style={{ width: 14, height: 14, border: "2px solid #374151", borderTop: "2px solid #6366f1", borderRadius: "50%", animation: "spin 1s linear infinite" }} />
              <span>Analisi AI in corso sulla knowledge base FMECA...</span>
            </div>
          )}

          {/* Risultati */}
          {result && !analyzing && (
            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              {/* Sintesi */}
              <div style={{ background: "var(--surface-2)", border: "1px solid var(--border-default)", padding: "10px 14px" }}>
                <div style={{ fontSize: 9, letterSpacing: "0.15em", color: "#6b7280", marginBottom: 6 }}>ANALISI AI — {result.asset_type_used.toUpperCase()}</div>
                <div style={{ fontSize: 12, color: "var(--text-primary)", lineHeight: 1.5, marginBottom: 6 }}>{result.most_probable_cause || result.explanation || "Nessuna causa identificata."}</div>
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                  <span style={{ fontSize: 10, color: "#6b7280" }}>Confidenza:</span>
                  <span style={{ fontSize: 10, color: result.confidence_score >= 0.7 ? "#22c55e" : result.confidence_score >= 0.4 ? "#f59e0b" : "#ef4444" }}>
                    {Math.round(result.confidence_score * 100)}%
                  </span>
                  <span style={{ fontSize: 10, color: "#6b7280", marginLeft: 8 }}>Priorità:</span>
                  <span style={{ fontSize: 10, color: result.priority === "HIGH" ? "#ef4444" : result.priority === "MEDIUM" ? "#f59e0b" : "#22c55e" }}>{result.priority}</span>
                </div>
              </div>

              {result.failure_modes_ranked.length === 0 ? (
                <div style={{ fontSize: 12, color: "#6b7280", textAlign: "center", padding: "12px 0" }}>
                  Nessun failure mode trovato per questo tipo asset. Aggiungi dati FMECA nella knowledge base.
                </div>
              ) : (
                <>
                  {/* Top 3 failure modes */}
                  <div style={{ fontSize: 9, letterSpacing: "0.15em", color: "#6b7280" }}>TOP 3 FAILURE MODES IDENTIFICATI</div>
                  {result.failure_modes_ranked.map((fm, i) => (
                    <div key={fm.failure_mode_id} style={{ border: "1px solid var(--border-default)", background: "var(--surface-2)", padding: "12px 14px", display: "flex", flexDirection: "column", gap: 6 }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 10, justifyContent: "space-between", flexWrap: "wrap" }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                          <span style={{ fontSize: 10, color: "#6366f1", fontWeight: 700 }}>#{i + 1}</span>
                          <span style={{ fontSize: 12, color: "var(--text-primary)", fontWeight: 600 }}>{fm.failure_mode}</span>
                        </div>
                        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                          <RpnBadge cls={fm.rpn_class} rpn={fm.rpn} />
                          <span style={{ fontSize: 10, color: "#22c55e" }}>{Math.round(fm.probability_score)}%</span>
                        </div>
                      </div>
                      <div style={{ fontSize: 11, color: "var(--text-muted)" }}>
                        <span style={{ color: "#6b7280" }}>Componente: </span>{fm.component}
                        {fm.mtbf_hours != null && fm.mtbf_hours > 0 && (
                          <span style={{ marginLeft: 12, color: "#6b7280" }}>MTBF: {fm.mtbf_hours.toLocaleString("it-IT")}h</span>
                        )}
                      </div>
                      {fm.failure_cause && (
                        <div style={{ fontSize: 11, color: "var(--text-muted)", borderLeft: "2px solid #374151", paddingLeft: 8 }}>
                          <span style={{ color: "#6b7280" }}>Causa: </span>{fm.failure_cause}
                        </div>
                      )}
                      {fm.ai_explanation && (
                        <div style={{ fontSize: 11, color: "#6366f1", fontStyle: "italic" }}>{fm.ai_explanation}</div>
                      )}
                      {fm.recommended_action && (
                        <div style={{ fontSize: 11, color: "#22c55e" }}>
                          <span style={{ color: "#6b7280" }}>Azione: </span>{fm.recommended_action}
                        </div>
                      )}
                    </div>
                  ))}

                  {/* Sezione conferma / learning */}
                  <div style={{ borderTop: "1px solid #1f2937", paddingTop: 14, display: "flex", flexDirection: "column", gap: 10 }}>
                    <div style={{ fontSize: 9, letterSpacing: "0.15em", color: "#6b7280" }}>CONFERMA E APPRENDIMENTO</div>

                    <div>
                      <label style={{ fontSize: 10, color: "#6b7280", display: "block", marginBottom: 6 }}>CAUSA CONFERMATA</label>
                      <select
                        value={selectedFmId === "other" ? "other" : String(selectedFmId)}
                        onChange={e => setSelectedFmId(e.target.value === "other" ? "other" : parseInt(e.target.value, 10))}
                        style={{ width: "100%", background: "var(--surface-0)", border: "1px solid var(--border-default)", color: "var(--text-primary)", padding: "8px 10px", fontSize: 11, fontFamily: "inherit", outline: "none" }}
                      >
                        {result.failure_modes_ranked.map(fm => (
                          <option key={fm.failure_mode_id} value={fm.failure_mode_id}>
                            #{fm.rank} — {fm.failure_mode} ({fm.component})
                          </option>
                        ))}
                        <option value="other">Altro (non in lista)</option>
                      </select>
                    </div>

                    <div>
                      <label style={{ fontSize: 10, color: "#6b7280", display: "block", marginBottom: 6 }}>CAUSA REALE *</label>
                      <textarea
                        value={realCause}
                        onChange={e => setRealCause(e.target.value)}
                        placeholder="Descrivi la causa effettiva riscontrata..."
                        rows={2}
                        style={{ width: "100%", background: "var(--surface-0)", border: "1px solid var(--border-default)", color: "var(--text-primary)", padding: "8px 10px", fontSize: 11, fontFamily: "inherit", resize: "vertical", outline: "none", boxSizing: "border-box" }}
                      />
                    </div>

                    <div>
                      <label style={{ fontSize: 10, color: "#6b7280", display: "block", marginBottom: 6 }}>AZIONE INTRAPRESA *</label>
                      <textarea
                        value={actionTaken}
                        onChange={e => setActionTaken(e.target.value)}
                        placeholder="Descrivi l'intervento eseguito..."
                        rows={2}
                        style={{ width: "100%", background: "var(--surface-0)", border: "1px solid var(--border-default)", color: "var(--text-primary)", padding: "8px 10px", fontSize: 11, fontFamily: "inherit", resize: "vertical", outline: "none", boxSizing: "border-box" }}
                      />
                    </div>

                    <div style={{ display: "flex", gap: 12, alignItems: "flex-end" }}>
                      <div style={{ flex: 1 }}>
                        <label style={{ fontSize: 10, color: "#6b7280", display: "block", marginBottom: 6 }}>TEMPO RISOLUZIONE (min)</label>
                        <input
                          type="number"
                          value={resolutionTime}
                          onChange={e => setResolutionTime(e.target.value)}
                          placeholder="0"
                          min={0}
                          style={{ width: "100%", background: "var(--surface-0)", border: "1px solid var(--border-default)", color: "var(--text-primary)", padding: "8px 10px", fontSize: 11, fontFamily: "inherit", outline: "none", boxSizing: "border-box" }}
                        />
                      </div>
                      <div style={{ display: "flex", alignItems: "center", gap: 8, paddingBottom: 2 }}>
                        <label style={{ fontSize: 10, color: "#6b7280" }}>RISOLTO:</label>
                        <button
                          onClick={() => setSuccessFlag(s => !s)}
                          style={{ padding: "6px 14px", background: "transparent", border: `1px solid ${successFlag ? "#22c55e" : "#ef4444"}`, color: successFlag ? "#22c55e" : "#ef4444", fontSize: 10, cursor: "pointer", fontFamily: "inherit", letterSpacing: "0.1em" }}
                        >
                          {successFlag ? "SI" : "NO"}
                        </button>
                      </div>
                    </div>

                    <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                      <button
                        onClick={handleSaveLearn}
                        disabled={saving || !realCause.trim() || !actionTaken.trim()}
                        style={{ padding: "8px 20px", background: "transparent", border: "1px solid #22c55e", color: saving ? "#6b7280" : "#22c55e", fontSize: 11, letterSpacing: "0.12em", cursor: saving || !realCause.trim() || !actionTaken.trim() ? "not-allowed" : "pointer", fontFamily: "inherit", opacity: saving || !realCause.trim() || !actionTaken.trim() ? 0.5 : 1 }}
                      >
                        {saving ? "SALVATAGGIO..." : "SALVA E APPRENDI"}
                      </button>
                      {savedOk && (
                        <span style={{ fontSize: 11, color: "#22c55e" }}>Learning aggiornato</span>
                      )}
                    </div>
                  </div>
                </>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── Tipo badge ────────────────────────────────────────────────────────────────
function TipoBadge({ tipo }: { tipo: string }) {
  const colors: Record<string, string> = { BD: "#ef4444", PM: "#22c55e", CM: "#f59e0b", ISP: "#3b82f6" };
  const c = colors[tipo] ?? "#94a3b8";
  return (
    <span style={{ fontSize: 10, padding: "1px 6px", borderRadius: 3, fontWeight: 700, background: `${c}18`, color: c, border: `1px solid ${c}44` }}>
      {tipo}
    </span>
  );
}

// ── Selettore ticket ──────────────────────────────────────────────────────────
function TicketSelector({ onSelect }: { onSelect: (t: TicketOption) => void }) {
  const [query, setQuery]       = useState("");
  const [tickets, setTickets]   = useState<TicketOption[]>([]);
  const [loading, setLoading]   = useState(true);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    apiGet<{ items?: TicketOption[] }>("/tickets?limit=200&stato=Aperto,Pianificato,In corso")
      .then(d => setTickets(d.items ?? []))
      .catch(() => {})
      .finally(() => setLoading(false));
    setTimeout(() => inputRef.current?.focus(), 80);
  }, []);

  const q = query.trim().toLowerCase();
  const filtered = q
    ? tickets.filter(t =>
        String(t.id).includes(q) ||
        t.titolo.toLowerCase().includes(q) ||
        (t.asset_name ?? "").toLowerCase().includes(q)
      )
    : tickets;

  return (
    <div style={styles.selectorWrap}>
      <div style={styles.selectorHeader}>
        <div style={styles.startIcon}>⬡</div>
        <p style={styles.startTitle}>SELEZIONA TICKET DA ANALIZZARE</p>
        <p style={styles.startSub}>Scegli il ticket su cui avviare la sessione diagnostica guidata AI.</p>
      </div>

      {/* Search bar */}
      <div style={{ position: "relative", maxWidth: 520, width: "100%", margin: "0 auto" }}>
        <span style={{ position: "absolute", left: 12, top: "50%", transform: "translateY(-50%)", color: "var(--text-muted)", fontSize: 14, pointerEvents: "none" }}>🔍</span>
        <input
          ref={inputRef}
          type="text"
          value={query}
          onChange={e => setQuery(e.target.value)}
          placeholder="Cerca per #ID, descrizione o asset..."
          style={{
            width: "100%", padding: "10px 12px 10px 36px", boxSizing: "border-box",
            background: "var(--bg-surface)", border: "1px solid var(--border-default)",
            color: "var(--text-primary)", fontSize: 13, outline: "none",
            fontFamily: "inherit", borderColor: query ? "rgba(99,102,241,0.5)" : undefined,
          }}
        />
        {query && (
          <button onClick={() => setQuery("")} style={{ position: "absolute", right: 10, top: "50%", transform: "translateY(-50%)", background: "none", border: "none", color: "var(--text-muted)", cursor: "pointer", fontSize: 16, padding: 0 }}>×</button>
        )}
      </div>

      {/* Risultati */}
      <div style={{ width: "100%", maxWidth: 520, margin: "0 auto", display: "flex", flexDirection: "column", gap: 0, border: "1px solid var(--border-default)", maxHeight: 380, overflowY: "auto" }}>
        {loading ? (
          <div style={{ padding: "24px", textAlign: "center", color: "var(--text-muted)", fontSize: 12 }}>Caricamento...</div>
        ) : filtered.length === 0 ? (
          <div style={{ padding: "24px", textAlign: "center", color: "var(--text-muted)", fontSize: 12 }}>
            {query ? "Nessun ticket trovato" : "Nessun ticket attivo"}
          </div>
        ) : filtered.map((t, i) => (
          <button
            key={t.id}
            onClick={() => onSelect(t)}
            style={{
              display: "flex", alignItems: "center", gap: 12,
              padding: "11px 14px", background: "var(--bg-surface)",
              border: "none", borderBottom: i < filtered.length - 1 ? "1px solid #1f2937" : "none",
              color: "var(--text-primary)", cursor: "pointer", textAlign: "left",
              transition: "background 0.12s", fontFamily: "inherit",
            }}
            onMouseEnter={e => (e.currentTarget.style.background = "rgba(99,102,241,0.08)")}
            onMouseLeave={e => (e.currentTarget.style.background = "var(--bg-surface)")}
          >
            {/* ID */}
            <span style={{ fontSize: 11, color: "var(--text-muted)", fontFamily: "monospace", flexShrink: 0, minWidth: 36 }}>#{t.id}</span>
            {/* Testo */}
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 13, fontWeight: 600, color: "var(--text-primary)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {t.titolo}
              </div>
              <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {t.asset_name ?? "—"}
              </div>
            </div>
            {/* Badge tipo + priorità */}
            <div style={{ display: "flex", gap: 5, flexShrink: 0 }}>
              <TipoBadge tipo={t.tipo} />
              <span style={{ fontSize: 10, padding: "1px 6px", borderRadius: 3, fontWeight: 700, color: t.priorita === "Alta" ? "#ef4444" : t.priorita === "Media" ? "#f59e0b" : "#22c55e", background: "var(--surface-3)", border: "1px solid var(--border-default)" }}>
                {t.priorita}
              </span>
            </div>
            <span style={{ fontSize: 14, color: "var(--text-muted)", flexShrink: 0 }}>›</span>
          </button>
        ))}
      </div>

      {!loading && filtered.length > 0 && (
        <p style={{ fontSize: 11, color: "var(--text-muted)", margin: 0, textAlign: "center" }}>
          {filtered.length} ticket{filtered.length !== 1 ? "s" : ""}
          {query ? ` trovati per "${query}"` : " attivi"}
        </p>
      )}
    </div>
  );
}

// ── Main diagnostic content ───────────────────────────────────────────────────
function DiagnosticContent() {
  const searchParams  = useSearchParams();
  const router        = useRouter();
  const initialId     = searchParams.get("id") ?? "";

  const [selectedTicket, setSelectedTicket] = useState<TicketOption | null>(null);
  const ticketId = selectedTicket ? String(selectedTicket.id) : initialId;

  const [messages, setMessages] = useState<Message[]>([]);
  const [sessionId, setSessionId] = useState<number | null>(null);
  const [status, setStatus]       = useState<"select" | "idle" | "loading" | "active" | "concluded">(
    initialId ? "idle" : "select"
  );
  const [reply, setReply]   = useState("");
  const [sending, setSending] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  function handleSelect(t: TicketOption) {
    setSelectedTicket(t);
    setStatus("idle");
    setMessages([]);
    setSessionId(null);
    setReply("");
    router.replace(`/diagnostic?id=${t.id}`, { scroll: false });
  }

  function resetToSelect() {
    setSelectedTicket(null);
    setStatus("select");
    setMessages([]);
    setSessionId(null);
    setReply("");
    router.replace("/diagnostic", { scroll: false });
  }

  async function startSession() {
    setStatus("loading");
    try {
      const data = await apiPost<{ session_id: string; step: Step }>(`/tickets/${ticketId}/diagnostic/start`, {});
      setSessionId(data.session_id);
      setMessages([{ from: "ai", step: data.step, timestamp: new Date() }]);
      setStatus("active");
    } catch {
      setStatus("idle");
    }
  }

  async function sendReply() {
    if (!reply.trim() || !sessionId || sending) return;
    const userText = reply.trim();
    setReply("");
    setSending(true);
    setMessages(prev => [...prev, { from: "user", text: userText, timestamp: new Date() }]);
    try {
      const data = await apiPost<{ step: Step; status?: string }>(`/tickets/${ticketId}/diagnostic/${sessionId}/reply`, { reply: userText });
      setMessages(prev => [...prev, { from: "ai", step: data.step, timestamp: new Date() }]);
      if (data.status === "concluded") setStatus("concluded");
    } catch {
      setMessages(prev => [...prev, { from: "ai", step: { type: "question", content: "Errore di connessione. Riprova.", detail: "" }, timestamp: new Date() }]);
    } finally {
      setSending(false);
    }
  }

  function handleKey(e: React.KeyboardEvent) {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendReply(); }
  }

  if (status === "select") {
    return (
      <div style={styles.root}>
        <div style={styles.gridBg} />
        <header style={styles.header}>
          <div style={styles.headerLeft}>
            <span style={styles.headerTitle}>ANALISI INGEGNERIA AI</span>
          </div>
          <div style={styles.statusDot}>
            <span style={{ ...styles.dot, background: "var(--text-muted)" }} />
            <span style={styles.statusLabel}>SELEZIONA TICKET</span>
          </div>
        </header>
        <main style={{ ...styles.main, alignItems: "center", justifyContent: "center" }}>
          <TicketSelector onSelect={handleSelect} />
        </main>
      </div>
    );
  }

  const ticketLabel = selectedTicket
    ? `#${selectedTicket.id} — ${selectedTicket.titolo}`
    : `#${ticketId}`;

  return (
    <div style={styles.root}>
      <div style={styles.gridBg} />
      <header style={styles.header}>
        <div style={styles.headerLeft}>
          {/* Bottone cambia ticket */}
          <button
            onClick={resetToSelect}
            style={{ background: "transparent", border: "1px solid var(--border-default)", color: "var(--text-muted)", padding: "3px 10px", fontSize: 10, letterSpacing: "0.1em", cursor: "pointer", fontFamily: "inherit" }}
            title="Scegli altro ticket"
          >
            ← CAMBIA
          </button>
          <span style={styles.badge} title={ticketLabel}>
            TICKET {ticketId ? `#${ticketId}` : "—"}
          </span>
          <span style={styles.headerTitle}>SESSIONE DIAGNOSTICA</span>
        </div>
        <div style={styles.statusDot}>
          <span style={{ ...styles.dot, background: status === "active" ? "var(--green)" : status === "concluded" ? "var(--amber)" : "var(--text-muted)" }} />
          <span style={styles.statusLabel}>
            {status === "idle" ? "INATTIVO" : status === "loading" ? "AVVIO..." : status === "active" ? "IN CORSO" : "CONCLUSA"}
          </span>
        </div>
      </header>
      <main style={styles.main}>
        {status === "idle" && (
          <div style={{ ...styles.startScreen, gap: 20 }}>
            <div style={styles.startIcon}>⬡</div>
            {selectedTicket && (
              <div style={{ background: "var(--bg-surface)", border: "1px solid var(--border-default)", padding: "12px 20px", textAlign: "center", maxWidth: 480 }}>
                <div style={{ fontSize: 10, letterSpacing: "0.15em", color: "var(--text-muted)", marginBottom: 6 }}>TICKET SELEZIONATO</div>
                <div style={{ fontSize: 14, color: "var(--text-primary)", fontWeight: 600, marginBottom: 4 }}>{selectedTicket.titolo}</div>
                <div style={{ fontSize: 12, color: "var(--text-muted)" }}>{selectedTicket.asset_name} · <TipoBadge tipo={selectedTicket.tipo} /></div>
              </div>
            )}

            {/* FIE — Failure Intelligence Engine */}
            {ticketId && <FIEPanel ticketId={ticketId} />}

            <p style={styles.startTitle}>ANALISI GUIDATA PRONTA</p>
            <p style={styles.startSub}>Il sistema porrà domande mirate per identificare la root cause del guasto. Rispondi in modo conciso e preciso.</p>
            <button style={styles.startBtn} onClick={startSession} disabled={!ticketId}>AVVIA SESSIONE</button>
          </div>
        )}
        {status === "loading" && (
          <div style={styles.startScreen}>
            <div style={styles.spinner} />
            <p style={styles.startSub}>Analisi ticket in corso...</p>
          </div>
        )}
        {(status === "active" || status === "concluded") && messages.map((msg, i) => (
          <div key={i} style={{ ...styles.msgRow, justifyContent: msg.from === "ai" ? "flex-start" : "flex-end" }}>
            {msg.from === "ai" && msg.step ? <AiMessage step={msg.step} timestamp={msg.timestamp} /> : <UserMessage text={msg.text!} timestamp={msg.timestamp} />}
          </div>
        ))}
        {sending && (
          <div style={{ ...styles.msgRow, justifyContent: "flex-start" }}>
            <div style={styles.aiBubbleWrap}>
              <div style={styles.aiAvatar}>AI</div>
              <div style={{ ...styles.aiBubble, borderColor: "var(--border-strong)", padding: "12px 16px" }}>
                <p style={{ ...styles.bubbleContent, color: "var(--text-secondary)", fontStyle: "italic" }}>Elaborazione in corso...</p>
              </div>
            </div>
          </div>
        )}
        <div ref={bottomRef} />
      </main>
      {status === "active" && (
        <footer style={styles.footer}>
          <div style={styles.inputWrap}>
            <textarea style={styles.textarea} value={reply} onChange={e => setReply(e.target.value)} onKeyDown={handleKey} placeholder="Descrivi ciò che hai osservato... (Invio per inviare)" rows={2} disabled={sending} />
            <button style={{ ...styles.sendBtn, opacity: sending || !reply.trim() ? 0.4 : 1 }} onClick={sendReply} disabled={sending || !reply.trim()}>{sending ? "..." : "→"}</button>
          </div>
        </footer>
      )}
      {status === "concluded" && (
        <footer style={styles.footer}>
          <div style={{ ...styles.concludedBar, display: "flex", alignItems: "center", justifyContent: "center", gap: 20 }}>
            <span>✓ SESSIONE CONCLUSA — ROOT CAUSE IDENTIFICATA</span>
            <button onClick={resetToSelect} style={{ background: "transparent", border: "1px solid #f59e0b55", color: "var(--amber)", padding: "4px 14px", fontSize: 10, letterSpacing: "0.1em", cursor: "pointer", fontFamily: "inherit" }}>
              NUOVA ANALISI →
            </button>
          </div>
        </footer>
      )}
    </div>
  );
}

export default function DiagnosticPage() {
  return (
    <Suspense fallback={<div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100vh", background: "var(--bg-base)", color: "var(--text-muted)" }}>Caricamento...</div>}>
      <DiagnosticContent />
    </Suspense>
  );
}

function AiMessage({ step, timestamp }: { step: Step; timestamp: Date }) {
  const isCheck = step.type === "check";
  const isConclusion = step.type === "conclusion";
  return (
    <div style={styles.aiBubbleWrap}>
      <div style={styles.aiAvatar}>AI</div>
      <div style={{ ...styles.aiBubble, borderColor: isConclusion ? "var(--amber)" : isCheck ? "var(--blue)" : "var(--border-strong)" }}>
        <div style={{ ...styles.typeTag, background: isConclusion ? "#f59e0b22" : isCheck ? "#3b82f622" : "#ffffff08", color: isConclusion ? "var(--amber)" : isCheck ? "#60a5fa" : "var(--text-secondary)", borderColor: isConclusion ? "#f59e0b44" : isCheck ? "#3b82f644" : "#ffffff11" }}>
          {isConclusion ? "◈ ROOT CAUSE" : isCheck ? "▣ VERIFICA SUL CAMPO" : "◇ DOMANDA"}
        </div>
        <p style={styles.bubbleContent}>{step.content}</p>
        {step.detail && <p style={styles.bubbleDetail}>{step.detail}</p>}
        {isConclusion && step.root_cause && (
          <div style={styles.rootCauseBox}>
            <p style={styles.rootCauseLabel}>ROOT CAUSE IDENTIFICATA</p>
            <p style={styles.rootCauseText}>{step.root_cause}</p>
          </div>
        )}
        {isConclusion && step.recommended_actions && step.recommended_actions.length > 0 && (
          <div style={styles.actionsBox}>
            <p style={styles.actionsLabel}>AZIONI RACCOMANDATE</p>
            {step.recommended_actions.map((a, i) => (
              <div key={i} style={styles.actionItem}><span style={styles.actionNum}>{i + 1}</span><span>{a}</span></div>
            ))}
          </div>
        )}
        <span style={styles.timestamp}>{timestamp.toLocaleTimeString("it-IT", { hour: "2-digit", minute: "2-digit" })}</span>
      </div>
    </div>
  );
}

function UserMessage({ text, timestamp }: { text: string; timestamp: Date }) {
  return (
    <div style={styles.userBubbleWrap}>
      <div style={styles.userBubble}>
        <p style={styles.userText}>{text}</p>
        <span style={styles.timestampUser}>{timestamp.toLocaleTimeString("it-IT", { hour: "2-digit", minute: "2-digit" })}</span>
      </div>
      <div style={styles.userAvatar}>TEC</div>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  root:          { minHeight: "100vh", background: "var(--bg-base)", color: "var(--text-primary)", fontFamily: "'IBM Plex Mono', 'Courier New', monospace", display: "flex", flexDirection: "column", position: "relative", overflow: "hidden" },
  gridBg:        { position: "fixed", inset: 0, backgroundImage: `linear-gradient(var(--border-subtle) 1px, transparent 1px), linear-gradient(90deg, var(--border-subtle) 1px, transparent 1px)`, backgroundSize: "40px 40px", pointerEvents: "none", zIndex: 0 },
  header:        { position: "relative", zIndex: 1, display: "flex", justifyContent: "space-between", alignItems: "center", padding: "16px 24px", borderBottom: "1px solid var(--border-strong)", background: "var(--bg-surface)" },
  headerLeft:    { display: "flex", alignItems: "center", gap: "12px" },
  badge:         { fontSize: "10px", letterSpacing: "0.15em", background: "var(--border)", border: "1px solid var(--border-default)", padding: "3px 8px", color: "var(--text-muted)" },
  headerTitle:   { fontSize: "12px", letterSpacing: "0.2em", color: "var(--text-secondary)", fontWeight: 600 },
  statusDot:     { display: "flex", alignItems: "center", gap: "8px" },
  dot:           { width: "8px", height: "8px", borderRadius: "50%", display: "inline-block" },
  statusLabel:   { fontSize: "10px", letterSpacing: "0.15em", color: "var(--text-muted)" },
  main:          { flex: 1, overflowY: "auto", padding: "32px 24px", display: "flex", flexDirection: "column", gap: "20px", position: "relative", zIndex: 1, maxWidth: "800px", width: "100%", margin: "0 auto" },
  selectorWrap:  { display: "flex", flexDirection: "column", alignItems: "center", gap: 20, width: "100%", maxWidth: 520 },
  selectorHeader:{ display: "flex", flexDirection: "column", alignItems: "center", gap: 8, textAlign: "center" },
  startScreen:   { display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: "16px", flex: 1, padding: "80px 24px", textAlign: "center" },
  startIcon:     { fontSize: "48px", color: "var(--border-strong)", lineHeight: 1 },
  startTitle:    { fontSize: "14px", letterSpacing: "0.2em", color: "var(--text-secondary)", margin: 0 },
  startSub:      { fontSize: "13px", color: "var(--text-disabled)", maxWidth: "400px", lineHeight: 1.6, margin: 0 },
  startBtn:      { marginTop: "8px", background: "transparent", border: "1px solid var(--border-default)", color: "var(--text-primary)", padding: "10px 28px", fontSize: "12px", letterSpacing: "0.2em", cursor: "pointer", transition: "all 0.2s", fontFamily: "inherit" },
  spinner:       { width: "32px", height: "32px", border: "2px solid var(--border-strong)", borderTop: "2px solid #6b7280", borderRadius: "50%", animation: "spin 1s linear infinite" },
  msgRow:        { display: "flex", alignItems: "flex-start" },
  aiBubbleWrap:  { display: "flex", gap: "12px", maxWidth: "85%", alignItems: "flex-start" },
  aiAvatar:      { width: "32px", height: "32px", background: "var(--border)", border: "1px solid var(--border-default)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: "9px", letterSpacing: "0.1em", color: "var(--text-muted)", flexShrink: 0, marginTop: "4px" },
  aiBubble:      { background: "var(--bg-surface)", border: "1px solid var(--border-default)", padding: "16px", display: "flex", flexDirection: "column", gap: "10px", borderLeft: "3px solid" },
  typeTag:       { fontSize: "9px", letterSpacing: "0.15em", padding: "3px 8px", border: "1px solid", alignSelf: "flex-start", fontWeight: 600 },
  bubbleContent: { fontSize: "14px", lineHeight: 1.6, margin: 0, color: "var(--text-primary)" },
  bubbleDetail:  { fontSize: "12px", lineHeight: 1.5, margin: 0, color: "var(--text-muted)", borderLeft: "2px solid var(--border-strong)", paddingLeft: "10px" },
  rootCauseBox:  { background: "#f59e0b0d", border: "1px solid #f59e0b33", padding: "12px", display: "flex", flexDirection: "column", gap: "6px" },
  rootCauseLabel:{ fontSize: "9px", letterSpacing: "0.2em", color: "var(--amber)", margin: 0 },
  rootCauseText: { fontSize: "13px", color: "#fcd34d", margin: 0, lineHeight: 1.5 },
  actionsBox:    { display: "flex", flexDirection: "column", gap: "6px" },
  actionsLabel:  { fontSize: "9px", letterSpacing: "0.2em", color: "var(--text-muted)", margin: 0 },
  actionItem:    { display: "flex", gap: "10px", fontSize: "12px", color: "var(--text-secondary)", lineHeight: 1.5 },
  actionNum:     { color: "var(--border-strong)", flexShrink: 0, fontWeight: 600 },
  timestamp:     { fontSize: "10px", color: "var(--border-strong)", alignSelf: "flex-end" },
  userBubbleWrap:{ display: "flex", gap: "12px", maxWidth: "70%", alignItems: "flex-start" },
  userBubble:    { background: "var(--border)", border: "1px solid var(--border-default)", padding: "12px 16px", display: "flex", flexDirection: "column", gap: "6px" },
  userText:      { fontSize: "14px", lineHeight: 1.5, margin: 0, color: "var(--text-primary)" },
  timestampUser: { fontSize: "10px", color: "var(--text-disabled)", alignSelf: "flex-end" },
  userAvatar:    { width: "32px", height: "32px", background: "var(--border)", border: "1px solid var(--border-default)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: "8px", letterSpacing: "0.1em", color: "var(--text-disabled)", flexShrink: 0, marginTop: "4px" },
  footer:        { position: "relative", zIndex: 1, borderTop: "1px solid var(--border-strong)", background: "var(--bg-surface)", padding: "16px 24px" },
  inputWrap:     { display: "flex", gap: "12px", maxWidth: "800px", margin: "0 auto", alignItems: "flex-end" },
  textarea:      { flex: 1, background: "var(--bg-base)", border: "1px solid var(--border-default)", color: "var(--text-primary)", padding: "10px 14px", fontSize: "13px", fontFamily: "'IBM Plex Mono', monospace", resize: "none", outline: "none", lineHeight: 1.5 },
  sendBtn:       { background: "var(--border)", border: "1px solid var(--border-default)", color: "var(--text-primary)", width: "44px", height: "44px", fontSize: "18px", cursor: "pointer", fontFamily: "inherit", flexShrink: 0, transition: "all 0.15s" },
  concludedBar:  { maxWidth: "800px", margin: "0 auto", textAlign: "center", fontSize: "11px", letterSpacing: "0.15em", color: "var(--amber)", padding: "8px 0" },
};
