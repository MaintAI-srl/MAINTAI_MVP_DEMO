"use client";

import { useState, useEffect, useRef, Suspense } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { apiPost, apiGet } from "@/app/lib/api";

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
    apiGet<any>("/tickets?limit=200&stato=Aperto,Pianificato,In corso")
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
            background: "var(--bg-surface)", border: "1px solid #374151",
            color: "var(--text-primary)", fontSize: 13, outline: "none",
            fontFamily: "inherit", borderColor: query ? "rgba(99,102,241,0.5)" : undefined,
          }}
        />
        {query && (
          <button onClick={() => setQuery("")} style={{ position: "absolute", right: 10, top: "50%", transform: "translateY(-50%)", background: "none", border: "none", color: "var(--text-muted)", cursor: "pointer", fontSize: 16, padding: 0 }}>×</button>
        )}
      </div>

      {/* Risultati */}
      <div style={{ width: "100%", maxWidth: 520, margin: "0 auto", display: "flex", flexDirection: "column", gap: 0, border: "1px solid #374151", maxHeight: 380, overflowY: "auto" }}>
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
              <span style={{ fontSize: 10, padding: "1px 6px", borderRadius: 3, fontWeight: 700, color: t.priorita === "Alta" ? "#ef4444" : t.priorita === "Media" ? "#f59e0b" : "#22c55e", background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)" }}>
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
      const data = await apiPost<any>(`/tickets/${ticketId}/diagnostic/start`, {});
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
      const data = await apiPost<any>(`/tickets/${ticketId}/diagnostic/${sessionId}/reply`, { reply: userText });
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
            style={{ background: "transparent", border: "1px solid #374151", color: "var(--text-muted)", padding: "3px 10px", fontSize: 10, letterSpacing: "0.1em", cursor: "pointer", fontFamily: "inherit" }}
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
          <div style={styles.startScreen}>
            <div style={styles.startIcon}>⬡</div>
            {selectedTicket && (
              <div style={{ background: "var(--bg-surface)", border: "1px solid #374151", padding: "12px 20px", textAlign: "center", maxWidth: 480 }}>
                <div style={{ fontSize: 10, letterSpacing: "0.15em", color: "var(--text-muted)", marginBottom: 6 }}>TICKET SELEZIONATO</div>
                <div style={{ fontSize: 14, color: "var(--text-primary)", fontWeight: 600, marginBottom: 4 }}>{selectedTicket.titolo}</div>
                <div style={{ fontSize: 12, color: "var(--text-muted)" }}>{selectedTicket.asset_name} · <TipoBadge tipo={selectedTicket.tipo} /></div>
              </div>
            )}
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
  badge:         { fontSize: "10px", letterSpacing: "0.15em", background: "var(--border)", border: "1px solid #374151", padding: "3px 8px", color: "var(--text-muted)" },
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
  startBtn:      { marginTop: "8px", background: "transparent", border: "1px solid #374151", color: "var(--text-primary)", padding: "10px 28px", fontSize: "12px", letterSpacing: "0.2em", cursor: "pointer", transition: "all 0.2s", fontFamily: "inherit" },
  spinner:       { width: "32px", height: "32px", border: "2px solid var(--border-strong)", borderTop: "2px solid #6b7280", borderRadius: "50%", animation: "spin 1s linear infinite" },
  msgRow:        { display: "flex", alignItems: "flex-start" },
  aiBubbleWrap:  { display: "flex", gap: "12px", maxWidth: "85%", alignItems: "flex-start" },
  aiAvatar:      { width: "32px", height: "32px", background: "var(--border)", border: "1px solid #374151", display: "flex", alignItems: "center", justifyContent: "center", fontSize: "9px", letterSpacing: "0.1em", color: "var(--text-muted)", flexShrink: 0, marginTop: "4px" },
  aiBubble:      { background: "var(--bg-surface)", border: "1px solid #374151", padding: "16px", display: "flex", flexDirection: "column", gap: "10px", borderLeft: "3px solid" },
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
  userBubble:    { background: "var(--border)", border: "1px solid #374151", padding: "12px 16px", display: "flex", flexDirection: "column", gap: "6px" },
  userText:      { fontSize: "14px", lineHeight: 1.5, margin: 0, color: "var(--text-primary)" },
  timestampUser: { fontSize: "10px", color: "var(--text-disabled)", alignSelf: "flex-end" },
  userAvatar:    { width: "32px", height: "32px", background: "var(--border)", border: "1px solid #374151", display: "flex", alignItems: "center", justifyContent: "center", fontSize: "8px", letterSpacing: "0.1em", color: "var(--text-disabled)", flexShrink: 0, marginTop: "4px" },
  footer:        { position: "relative", zIndex: 1, borderTop: "1px solid var(--border-strong)", background: "var(--bg-surface)", padding: "16px 24px" },
  inputWrap:     { display: "flex", gap: "12px", maxWidth: "800px", margin: "0 auto", alignItems: "flex-end" },
  textarea:      { flex: 1, background: "var(--bg-base)", border: "1px solid #374151", color: "var(--text-primary)", padding: "10px 14px", fontSize: "13px", fontFamily: "'IBM Plex Mono', monospace", resize: "none", outline: "none", lineHeight: 1.5 },
  sendBtn:       { background: "var(--border)", border: "1px solid #374151", color: "var(--text-primary)", width: "44px", height: "44px", fontSize: "18px", cursor: "pointer", fontFamily: "inherit", flexShrink: 0, transition: "all 0.15s" },
  concludedBar:  { maxWidth: "800px", margin: "0 auto", textAlign: "center", fontSize: "11px", letterSpacing: "0.15em", color: "var(--amber)", padding: "8px 0" },
};
