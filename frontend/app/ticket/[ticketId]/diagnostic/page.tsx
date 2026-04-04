"use client";

import { use, useState, useEffect, useRef } from "react";
import { apiPost } from "../../../lib/api";

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

export default function DiagnosticPage({
  params,
}: {
  params: Promise<{ ticketId: string }>;
}) {
  const { ticketId } = use(params);
  const [messages, setMessages] = useState<Message[]>([]);
  const [sessionId, setSessionId] = useState<number | null>(null);
  const [status, setStatus] = useState<"idle" | "loading" | "active" | "concluded">("idle");
  const [reply, setReply] = useState("");
  const [sending, setSending] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  async function startSession() {
    setStatus("loading");
    try {
      const data = await apiPost<any>(`/tickets/${ticketId}/diagnostic/start`, {});
      setSessionId(data.session_id);
      setMessages([
        {
          from: "ai",
          step: data.step,
          timestamp: new Date(),
        },
      ]);
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

    setMessages((prev) => [
      ...prev,
      { from: "user", text: userText, timestamp: new Date() },
    ]);

    try {
      const data = await apiPost<any>(`/tickets/${ticketId}/diagnostic/${sessionId}/reply`, { reply: userText });
      setMessages((prev) => [
        ...prev,
        { from: "ai", step: data.step, timestamp: new Date() },
      ]);
      if (data.status === "concluded") setStatus("concluded");
    } catch {
      setMessages((prev) => [
        ...prev,
        {
          from: "ai",
          step: {
            type: "question",
            content: "Errore di connessione. Riprova.",
            detail: "",
          },
          timestamp: new Date(),
        },
      ]);
    } finally {
      setSending(false);
    }
  }

  function handleKey(e: React.KeyboardEvent) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendReply();
    }
  }

  return (
    <div style={styles.root}>
      {/* Grid overlay background */}
      <div style={styles.gridBg} />

      {/* Header */}
      <header style={styles.header}>
        <div style={styles.headerLeft}>
          <span style={styles.badge}>TICKET #{ticketId}</span>
          <span style={styles.headerTitle}>SESSIONE DIAGNOSTICA</span>
        </div>
        <div style={styles.statusDot}>
          <span
            style={{
              ...styles.dot,
              background:
                status === "active"
                  ? "var(--green)"
                  : status === "concluded"
                  ? "var(--amber)"
                  : "var(--text-muted)",
            }}
          />
          <span style={styles.statusLabel}>
            {status === "idle"
              ? "INATTIVO"
              : status === "loading"
              ? "AVVIO..."
              : status === "active"
              ? "IN CORSO"
              : "CONCLUSA"}
          </span>
        </div>
      </header>

      {/* Chat area */}
      <main style={styles.main}>
        {status === "idle" && (
          <div style={styles.startScreen}>
            <div style={styles.startIcon}>⬡</div>
            <p style={styles.startTitle}>ANALISI GUIDATA PRONTA</p>
            <p style={styles.startSub}>
              Il sistema porrà domande mirate per identificare la root cause del
              guasto. Rispondi in modo conciso e preciso.
            </p>
            <button style={styles.startBtn} onClick={startSession}>
              AVVIA SESSIONE
            </button>
          </div>
        )}

        {status === "loading" && (
          <div style={styles.startScreen}>
            <div style={styles.spinner} />
            <p style={styles.startSub}>Analisi ticket in corso...</p>
          </div>
        )}

        {(status === "active" || status === "concluded") &&
          messages.map((msg, i) => (
            <div
              key={i}
              style={{
                ...styles.msgRow,
                justifyContent: msg.from === "ai" ? "flex-start" : "flex-end",
              }}
            >
              {msg.from === "ai" && msg.step ? (
                <AiMessage step={msg.step} timestamp={msg.timestamp} />
              ) : (
                <UserMessage text={msg.text!} timestamp={msg.timestamp} />
              )}
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

      {/* Input */}
      {status === "active" && (
        <footer style={styles.footer}>
          <div style={styles.inputWrap}>
            <textarea
              style={styles.textarea}
              value={reply}
              onChange={(e) => setReply(e.target.value)}
              onKeyDown={handleKey}
              placeholder="Descrivi ciò che hai osservato... (Invio per inviare)"
              rows={2}
              disabled={sending}
            />
            <button
              style={{
                ...styles.sendBtn,
                opacity: sending || !reply.trim() ? 0.4 : 1,
              }}
              onClick={sendReply}
              disabled={sending || !reply.trim()}
            >
              {sending ? "..." : "→"}
            </button>
          </div>
        </footer>
      )}

      {status === "concluded" && (
        <footer style={styles.footer}>
          <div style={styles.concludedBar}>
            ✓ SESSIONE CONCLUSA — ROOT CAUSE IDENTIFICATA
          </div>
        </footer>
      )}
    </div>
  );
}

function AiMessage({ step, timestamp }: { step: Step; timestamp: Date }) {
  const isCheck = step.type === "check";
  const isConclusion = step.type === "conclusion";

  return (
    <div style={styles.aiBubbleWrap}>
      <div style={styles.aiAvatar}>AI</div>
      <div
        style={{
          ...styles.aiBubble,
          borderColor: isConclusion
            ? "var(--amber)"
            : isCheck
            ? "var(--blue)"
            : "var(--border-strong)",
        }}
      >
        {/* Type tag */}
        <div
          style={{
            ...styles.typeTag,
            background: isConclusion
              ? "#f59e0b22"
              : isCheck
              ? "#3b82f622"
              : "#ffffff08",
            color: isConclusion ? "var(--amber)" : isCheck ? "#60a5fa" : "var(--text-secondary)",
            borderColor: isConclusion
              ? "#f59e0b44"
              : isCheck
              ? "#3b82f644"
              : "#ffffff11",
          }}
        >
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

        {isConclusion &&
          step.recommended_actions &&
          step.recommended_actions.length > 0 && (
            <div style={styles.actionsBox}>
              <p style={styles.actionsLabel}>AZIONI RACCOMANDATE</p>
              {step.recommended_actions.map((a, i) => (
                <div key={i} style={styles.actionItem}>
                  <span style={styles.actionNum}>{i + 1}</span>
                  <span>{a}</span>
                </div>
              ))}
            </div>
          )}

        <span style={styles.timestamp}>
          {timestamp.toLocaleTimeString("it-IT", {
            hour: "2-digit",
            minute: "2-digit",
          })}
        </span>
      </div>
    </div>
  );
}

function UserMessage({ text, timestamp }: { text: string; timestamp: Date }) {
  return (
    <div style={styles.userBubbleWrap}>
      <div style={styles.userBubble}>
        <p style={styles.userText}>{text}</p>
        <span style={styles.timestampUser}>
          {timestamp.toLocaleTimeString("it-IT", {
            hour: "2-digit",
            minute: "2-digit",
          })}
        </span>
      </div>
      <div style={styles.userAvatar}>TEC</div>
    </div>
  );
}

// ─── Styles ──────────────────────────────────────────────────────────────────

const styles: Record<string, React.CSSProperties> = {
  root: {
    minHeight: "100vh",
    background: "var(--bg-base)",
    color: "var(--text-primary)",
    fontFamily: "'IBM Plex Mono', 'Courier New', monospace",
    display: "flex",
    flexDirection: "column",
    position: "relative",
    overflow: "hidden",
  },
  gridBg: {
    position: "fixed",
    inset: 0,
    backgroundImage: `
      linear-gradient(rgba(255,255,255,0.02) 1px, transparent 1px),
      linear-gradient(90deg, rgba(255,255,255,0.02) 1px, transparent 1px)
    `,
    backgroundSize: "40px 40px",
    pointerEvents: "none",
    zIndex: 0,
  },
  header: {
    position: "relative",
    zIndex: 1,
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    padding: "16px 24px",
    borderBottom: "1px solid #1f2937",
    background: "var(--bg-surface)",
  },
  headerLeft: {
    display: "flex",
    alignItems: "center",
    gap: "12px",
  },
  badge: {
    fontSize: "10px",
    letterSpacing: "0.15em",
    background: "var(--border)",
    border: "1px solid #374151",
    padding: "3px 8px",
    color: "var(--text-muted)",
  },
  headerTitle: {
    fontSize: "12px",
    letterSpacing: "0.2em",
    color: "var(--text-secondary)",
    fontWeight: 600,
  },
  statusDot: {
    display: "flex",
    alignItems: "center",
    gap: "8px",
  },
  dot: {
    width: "8px",
    height: "8px",
    borderRadius: "50%",
    display: "inline-block",
  },
  statusLabel: {
    fontSize: "10px",
    letterSpacing: "0.15em",
    color: "var(--text-muted)",
  },
  main: {
    flex: 1,
    overflowY: "auto",
    padding: "32px 24px",
    display: "flex",
    flexDirection: "column",
    gap: "20px",
    position: "relative",
    zIndex: 1,
    maxWidth: "800px",
    width: "100%",
    margin: "0 auto",
  },
  startScreen: {
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
    gap: "16px",
    flex: 1,
    padding: "80px 24px",
    textAlign: "center",
  },
  startIcon: {
    fontSize: "48px",
    color: "var(--border-strong)",
    lineHeight: 1,
  },
  startTitle: {
    fontSize: "14px",
    letterSpacing: "0.2em",
    color: "var(--text-secondary)",
    margin: 0,
  },
  startSub: {
    fontSize: "13px",
    color: "var(--text-disabled)",
    maxWidth: "400px",
    lineHeight: 1.6,
    margin: 0,
  },
  startBtn: {
    marginTop: "8px",
    background: "transparent",
    border: "1px solid #374151",
    color: "var(--text-primary)",
    padding: "10px 28px",
    fontSize: "12px",
    letterSpacing: "0.2em",
    cursor: "pointer",
    transition: "all 0.2s",
    fontFamily: "inherit",
  },
  spinner: {
    width: "32px",
    height: "32px",
    border: "2px solid #1f2937",
    borderTop: "2px solid #6b7280",
    borderRadius: "50%",
    animation: "spin 1s linear infinite",
  },
  msgRow: {
    display: "flex",
    alignItems: "flex-start",
  },
  aiBubbleWrap: {
    display: "flex",
    gap: "12px",
    maxWidth: "85%",
    alignItems: "flex-start",
  },
  aiAvatar: {
    width: "32px",
    height: "32px",
    background: "var(--border)",
    border: "1px solid #374151",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    fontSize: "9px",
    letterSpacing: "0.1em",
    color: "var(--text-muted)",
    flexShrink: 0,
    marginTop: "4px",
  },
  aiBubble: {
    background: "var(--bg-surface)",
    border: "1px solid #374151",
    padding: "16px",
    display: "flex",
    flexDirection: "column",
    gap: "10px",
    borderLeft: "3px solid",
  },
  typeTag: {
    fontSize: "9px",
    letterSpacing: "0.15em",
    padding: "3px 8px",
    border: "1px solid",
    alignSelf: "flex-start",
    fontWeight: 600,
  },
  bubbleContent: {
    fontSize: "14px",
    lineHeight: 1.6,
    margin: 0,
    color: "var(--text-primary)",
  },
  bubbleDetail: {
    fontSize: "12px",
    lineHeight: 1.5,
    margin: 0,
    color: "var(--text-muted)",
    borderLeft: "2px solid #1f2937",
    paddingLeft: "10px",
  },
  rootCauseBox: {
    background: "#f59e0b0d",
    border: "1px solid #f59e0b33",
    padding: "12px",
    display: "flex",
    flexDirection: "column",
    gap: "6px",
  },
  rootCauseLabel: {
    fontSize: "9px",
    letterSpacing: "0.2em",
    color: "var(--amber)",
    margin: 0,
  },
  rootCauseText: {
    fontSize: "13px",
    color: "#fcd34d",
    margin: 0,
    lineHeight: 1.5,
  },
  actionsBox: {
    display: "flex",
    flexDirection: "column",
    gap: "6px",
  },
  actionsLabel: {
    fontSize: "9px",
    letterSpacing: "0.2em",
    color: "var(--text-muted)",
    margin: 0,
  },
  actionItem: {
    display: "flex",
    gap: "10px",
    fontSize: "12px",
    color: "var(--text-secondary)",
    lineHeight: 1.5,
  },
  actionNum: {
    color: "var(--border-strong)",
    flexShrink: 0,
    fontWeight: 600,
  },
  timestamp: {
    fontSize: "10px",
    color: "var(--border-strong)",
    alignSelf: "flex-end",
  },
  userBubbleWrap: {
    display: "flex",
    gap: "12px",
    maxWidth: "70%",
    alignItems: "flex-start",
  },
  userBubble: {
    background: "var(--border)",
    border: "1px solid #374151",
    padding: "12px 16px",
    display: "flex",
    flexDirection: "column",
    gap: "6px",
  },
  userText: {
    fontSize: "14px",
    lineHeight: 1.5,
    margin: 0,
    color: "var(--text-primary)",
  },
  timestampUser: {
    fontSize: "10px",
    color: "var(--text-disabled)",
    alignSelf: "flex-end",
  },
  userAvatar: {
    width: "32px",
    height: "32px",
    background: "var(--border)",
    border: "1px solid #374151",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    fontSize: "8px",
    letterSpacing: "0.1em",
    color: "var(--text-disabled)",
    flexShrink: 0,
    marginTop: "4px",
  },
  footer: {
    position: "relative",
    zIndex: 1,
    borderTop: "1px solid #1f2937",
    background: "var(--bg-surface)",
    padding: "16px 24px",
  },
  inputWrap: {
    display: "flex",
    gap: "12px",
    maxWidth: "800px",
    margin: "0 auto",
    alignItems: "flex-end",
  },
  textarea: {
    flex: 1,
    background: "var(--bg-base)",
    border: "1px solid #374151",
    color: "var(--text-primary)",
    padding: "10px 14px",
    fontSize: "13px",
    fontFamily: "'IBM Plex Mono', monospace",
    resize: "none",
    outline: "none",
    lineHeight: 1.5,
  },
  sendBtn: {
    background: "var(--border)",
    border: "1px solid #374151",
    color: "var(--text-primary)",
    width: "44px",
    height: "44px",
    fontSize: "18px",
    cursor: "pointer",
    fontFamily: "inherit",
    flexShrink: 0,
    transition: "all 0.15s",
  },
  concludedBar: {
    maxWidth: "800px",
    margin: "0 auto",
    textAlign: "center",
    fontSize: "11px",
    letterSpacing: "0.15em",
    color: "var(--amber)",
    padding: "8px 0",
  },
};
