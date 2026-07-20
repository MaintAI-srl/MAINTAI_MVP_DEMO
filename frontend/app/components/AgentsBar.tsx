"use client";

import { useCallback, useEffect, useState } from "react";
import type { CSSProperties, ReactNode } from "react";
import { apiGet, apiPost } from "../lib/api";
import { notify } from "@/lib/toast";
import { Bot, Loader2, X } from "lucide-react";

type AgentInfo = {
  id: string;
  nome: string;
  nome_breve: string;
  descrizione: string;
  colore: string;
  enabled: boolean;
};

type ParetoItem = { label: string; value: number; pct: number; cum_pct: number; vital: boolean };
type Pareto = { titolo: string; unita: string; totale: number; items: ParetoItem[] };

type AgentRunResult = {
  run_id: number;
  agent_id: string;
  nome: string;
  output_md: string;
  pareto: Pareto | null;
  model: string;
  prompt_tokens: number;
  completion_tokens: number;
  cost_eur: number;
  created_at: string | null;
};

type AgentRunRow = {
  id: number;
  agent_id: string;
  model: string | null;
  status: string;
  cost_eur: number | null;
  output_md: string | null;
  created_by: string | null;
  created_at: string | null;
};

type UsageSummary = { totale_eur: number; mese_eur: number; oggi_eur: number; runs: number };

function formatEur(value: number): string {
  return value.toLocaleString("it-IT", {
    minimumFractionDigits: 2,
    maximumFractionDigits: value < 1 ? 4 : 2,
  });
}

/* ── Renderer Markdown leggero e sicuro (niente HTML iniettato) ───────────── */

function renderInline(text: string, keyPrefix: string): ReactNode[] {
  // **bold** e `code`
  const parts = text.split(/(\*\*[^*]+\*\*|`[^`]+`)/g).filter(Boolean);
  return parts.map((part, i) => {
    if (part.startsWith("**") && part.endsWith("**")) {
      return <strong key={`${keyPrefix}-${i}`} style={{ color: "var(--text-primary)" }}>{part.slice(2, -2)}</strong>;
    }
    if (part.startsWith("`") && part.endsWith("`")) {
      return (
        <code key={`${keyPrefix}-${i}`} style={{ background: "var(--surface-3)", padding: "1px 5px", borderRadius: 4, fontSize: "0.9em" }}>
          {part.slice(1, -1)}
        </code>
      );
    }
    return <span key={`${keyPrefix}-${i}`}>{part}</span>;
  });
}

function MarkdownLite({ text }: { text: string }) {
  const blocks: ReactNode[] = [];
  const lines = text.split("\n");
  let list: { ordered: boolean; items: string[] } | null = null;
  let table: string[][] | null = null;

  const flushList = (key: string) => {
    if (!list) return;
    const items = list.items.map((item, i) => (
      <li key={`${key}-li-${i}`} style={{ marginBottom: 4, lineHeight: 1.55 }}>{renderInline(item, `${key}-li-${i}`)}</li>
    ));
    blocks.push(
      list.ordered
        ? <ol key={`${key}-ol`} style={{ margin: "6px 0 12px", paddingLeft: 22 }}>{items}</ol>
        : <ul key={`${key}-ul`} style={{ margin: "6px 0 12px", paddingLeft: 22 }}>{items}</ul>
    );
    list = null;
  };

  const flushTable = (key: string) => {
    if (!table || table.length === 0) { table = null; return; }
    const [head, ...body] = table;
    blocks.push(
      <div key={`${key}-tw`} style={{ overflowX: "auto", margin: "8px 0 14px" }}>
        <table style={{ borderCollapse: "collapse", fontSize: 12.5, minWidth: 320 }}>
          <thead>
            <tr>
              {head.map((cell, i) => (
                <th key={i} style={{ textAlign: "left", padding: "6px 10px", borderBottom: "1px solid var(--border-strong)", color: "var(--text-muted)", fontSize: 11, textTransform: "uppercase", letterSpacing: "0.05em" }}>
                  {renderInline(cell, `${key}-th-${i}`)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {body.map((row, r) => (
              <tr key={r}>
                {row.map((cell, c) => (
                  <td key={c} style={{ padding: "5px 10px", borderBottom: "1px solid var(--border-default)" }}>
                    {renderInline(cell, `${key}-td-${r}-${c}`)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
    table = null;
  };

  lines.forEach((rawLine, index) => {
    const line = rawLine.trimEnd();
    const key = `md-${index}`;

    // Righe tabella | a | b |
    if (/^\|.*\|\s*$/.test(line)) {
      flushList(key);
      const cells = line.slice(1, -1).split("|").map((c) => c.trim());
      // Separatore |---|---| → ignora
      if (cells.every((c) => /^:?-{2,}:?$/.test(c))) return;
      const currentTable = table ?? [];
      currentTable.push(cells);
      table = currentTable;
      return;
    }
    flushTable(key);

    const heading = line.match(/^(#{1,4})\s+(.*)$/);
    if (heading) {
      flushList(key);
      const level = heading[1].length;
      const sizes: Record<number, number> = { 1: 18, 2: 16, 3: 14, 4: 13 };
      blocks.push(
        <div key={key} style={{ fontSize: sizes[level] ?? 13, fontWeight: 800, color: "var(--text-primary)", margin: `${level <= 2 ? 18 : 14}px 0 6px` }}>
          {renderInline(heading[2], key)}
        </div>
      );
      return;
    }

    const bullet = line.match(/^\s*[-*]\s+(.*)$/);
    if (bullet) {
      let current = list;
      if (!current || current.ordered) { flushList(key); current = { ordered: false, items: [] }; }
      current.items.push(bullet[1]);
      list = current;
      return;
    }
    const numbered = line.match(/^\s*\d+[.)]\s+(.*)$/);
    if (numbered) {
      let current = list;
      if (!current || !current.ordered) { flushList(key); current = { ordered: true, items: [] }; }
      current.items.push(numbered[1]);
      list = current;
      return;
    }
    flushList(key);

    if (/^-{3,}$/.test(line)) {
      blocks.push(<hr key={key} style={{ border: 0, borderTop: "1px solid var(--border-default)", margin: "12px 0" }} />);
      return;
    }
    if (line.trim() === "") return;
    blocks.push(
      <p key={key} style={{ margin: "0 0 10px", lineHeight: 1.6 }}>{renderInline(line, key)}</p>
    );
  });
  flushList("md-end");
  flushTable("md-end");

  return <div style={{ fontSize: 13.5, color: "var(--text-primary)" }}>{blocks}</div>;
}

function ParetoTable({ pareto }: { pareto: Pareto }) {
  return (
    <div style={{ margin: "14px 0", border: "1px solid var(--border-default)", borderRadius: 8, overflow: "hidden" }}>
      <div style={{ padding: "10px 14px", background: "var(--surface-1)", borderBottom: "1px solid var(--border-default)", fontSize: 12, fontWeight: 800, textTransform: "uppercase", letterSpacing: "0.06em", color: "var(--text-muted)" }}>
        Pareto — {pareto.titolo} · totale {formatEur(pareto.totale)} {pareto.unita}
      </div>
      <div style={{ overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12.5 }}>
          <thead>
            <tr style={{ color: "var(--text-muted)", fontSize: 11 }}>
              <th style={paretoTh}>#</th>
              <th style={{ ...paretoTh, textAlign: "left" }}>Voce</th>
              <th style={paretoTh}>Valore</th>
              <th style={paretoTh}>%</th>
              <th style={paretoTh}>% cum.</th>
            </tr>
          </thead>
          <tbody>
            {pareto.items.map((item, i) => (
              <tr key={i} style={{ background: item.vital ? "rgba(239,68,68,0.07)" : "transparent" }}>
                <td style={paretoTd}>{i + 1}</td>
                <td style={{ ...paretoTd, textAlign: "left", fontWeight: item.vital ? 700 : 400 }}>
                  {item.label}{item.vital && <span style={{ marginLeft: 6, fontSize: 9.5, fontWeight: 800, color: "#ef4444", letterSpacing: "0.06em" }}>VITAL 20%</span>}
                </td>
                <td style={paretoTd}>{formatEur(item.value)}</td>
                <td style={paretoTd}>{item.pct}%</td>
                <td style={paretoTd}>
                  <span style={{ display: "inline-block", minWidth: 44 }}>{item.cum_pct}%</span>
                  <span style={{ display: "inline-block", width: 60, height: 5, background: "var(--surface-3)", borderRadius: 3, marginLeft: 6, verticalAlign: "middle" }}>
                    <span style={{ display: "block", width: `${Math.min(item.cum_pct, 100)}%`, height: "100%", background: item.vital ? "#ef4444" : "#64748b", borderRadius: 3 }} />
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

const paretoTh: CSSProperties = { padding: "7px 10px", textAlign: "right", borderBottom: "1px solid var(--border-strong)", textTransform: "uppercase", letterSpacing: "0.05em" };
const paretoTd: CSSProperties = { padding: "6px 10px", textAlign: "right", borderBottom: "1px solid var(--border-default)" };

/* ── Barra agenti in topbar ──────────────────────────────────────────────── */

export default function AgentsBar() {
  const [agents, setAgents] = useState<AgentInfo[]>([]);
  const [usage, setUsage] = useState<UsageSummary | null>(null);
  const [openAgent, setOpenAgent] = useState<AgentInfo | null>(null);
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<AgentRunResult | null>(null);
  const [lastRun, setLastRun] = useState<AgentRunRow | null>(null);

  const loadUsage = useCallback(() => {
    apiGet<UsageSummary>("/agents/usage").then(setUsage).catch(() => {});
  }, []);

  useEffect(() => {
    apiGet<{ agents: AgentInfo[] }>("/agents")
      .then((data) => setAgents((data.agents ?? []).filter((a) => a.enabled)))
      .catch(() => {});
    loadUsage();
    const id = setInterval(loadUsage, 120_000);
    return () => clearInterval(id);
  }, [loadUsage]);

  function open(agent: AgentInfo) {
    setOpenAgent(agent);
    setResult(null);
    setLastRun(null);
    apiGet<{ runs: AgentRunRow[] }>(`/agents/runs?agent_id=${agent.id}`)
      .then((data) => {
        const ok = (data.runs ?? []).find((r) => r.status === "ok" && r.output_md);
        if (ok) setLastRun(ok);
      })
      .catch(() => {});
  }

  async function run() {
    if (!openAgent || running) return;
    setRunning(true);
    setResult(null);
    try {
      const res = await apiPost<AgentRunResult>(`/agents/${openAgent.id}/run`, {});
      setResult(res);
      setLastRun(null);
      loadUsage();
      notify.success(`${openAgent.nome} — report generato (€ ${formatEur(res.cost_eur)})`);
    } catch (err: unknown) {
      notify.error(err instanceof Error ? err.message : "Errore esecuzione agente");
    } finally {
      setRunning(false);
    }
  }

  if (agents.length === 0 && !usage) return null;

  return (
    <>
      <div className="topbar-agents">
        {agents.map((agent) => (
          <button
            key={agent.id}
            type="button"
            className="agent-chip"
            onClick={() => open(agent)}
            title={`${agent.nome} — ${agent.descrizione}`}
            style={{ "--agent-color": agent.colore } as CSSProperties}
          >
            <Bot size={12} strokeWidth={2} style={{ color: agent.colore }} />
            <span>{agent.nome_breve}</span>
          </button>
        ))}
        {usage && (
          <span
            className="topbar-ai-cost"
            title={`Consumo AI — oggi: € ${formatEur(usage.oggi_eur)} · mese: € ${formatEur(usage.mese_eur)} · totale: € ${formatEur(usage.totale_eur)} (${usage.runs} run)`}
          >
            AI € {formatEur(usage.mese_eur)}
          </span>
        )}
      </div>

      {openAgent && (
        <div
          style={{ position: "fixed", inset: 0, zIndex: 9998, background: "rgba(2,6,23,0.65)", backdropFilter: "blur(3px)", display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}
          onClick={() => !running && setOpenAgent(null)}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-label={openAgent.nome}
            onClick={(e) => e.stopPropagation()}
            style={{
              zIndex: 9999,
              width: "min(100%, 780px)",
              maxHeight: "86vh",
              display: "flex",
              flexDirection: "column",
              background: "var(--surface-2)",
              border: "1px solid var(--border-strong)",
              borderRadius: 12,
              overflow: "hidden",
              boxShadow: "0 24px 70px rgba(0,0,0,0.5)",
            }}
          >
            {/* Header */}
            <div style={{ display: "flex", alignItems: "flex-start", gap: 12, padding: "18px 22px", borderBottom: "1px solid var(--border-default)", background: "var(--surface-1)" }}>
              <div style={{ width: 38, height: 38, borderRadius: 10, display: "flex", alignItems: "center", justifyContent: "center", background: `${openAgent.colore}1f`, border: `1px solid ${openAgent.colore}55`, flexShrink: 0 }}>
                <Bot size={19} strokeWidth={2} style={{ color: openAgent.colore }} />
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 10, letterSpacing: "0.14em", fontWeight: 800, textTransform: "uppercase", color: openAgent.colore }}>Agente AI · trigger manuale</div>
                <div style={{ fontSize: 18, fontWeight: 800, color: "var(--text-primary)", lineHeight: 1.25 }}>{openAgent.nome}</div>
                <div style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 3 }}>{openAgent.descrizione}</div>
              </div>
              <button
                type="button"
                onClick={() => setOpenAgent(null)}
                disabled={running}
                aria-label="Chiudi"
                style={{ width: 30, height: 30, borderRadius: 8, border: "1px solid var(--border-default)", background: "var(--surface-3)", color: "var(--text-muted)", cursor: running ? "not-allowed" : "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}
              >
                <X size={15} />
              </button>
            </div>

            {/* Body */}
            <div style={{ flex: 1, overflowY: "auto", padding: "18px 22px" }}>
              {running ? (
                <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 14, padding: "48px 0", color: "var(--text-muted)" }}>
                  <Loader2 size={30} className="animate-spin" style={{ color: openAgent.colore }} />
                  <div style={{ fontSize: 13, fontWeight: 600 }}>L&apos;agente sta analizzando i dati dell&apos;impianto…</div>
                  <div style={{ fontSize: 11.5 }}>Analisi di Pareto, logiche lean e report esperto: può richiedere fino a 2 minuti.</div>
                </div>
              ) : result ? (
                <>
                  {result.pareto && <ParetoTable pareto={result.pareto} />}
                  <MarkdownLite text={result.output_md} />
                </>
              ) : lastRun?.output_md ? (
                <>
                  <div style={{ fontSize: 11, color: "var(--text-muted)", marginBottom: 10, padding: "6px 10px", background: "var(--surface-1)", border: "1px solid var(--border-default)", borderRadius: 6 }}>
                    Ultimo report del {lastRun.created_at ? new Date(lastRun.created_at).toLocaleString("it-IT") : "n/d"}
                    {lastRun.created_by ? ` — eseguito da ${lastRun.created_by}` : ""}. Premi &quot;Esegui agente&quot; per un&apos;analisi aggiornata.
                  </div>
                  <MarkdownLite text={lastRun.output_md} />
                </>
              ) : (
                <div style={{ padding: "36px 12px", textAlign: "center", color: "var(--text-muted)", fontSize: 13, lineHeight: 1.7 }}>
                  Nessun report precedente per questo agente.<br />
                  Premi <strong style={{ color: "var(--text-primary)" }}>Esegui agente</strong> per lanciare l&apos;analisi sui dati attuali.
                </div>
              )}
            </div>

            {/* Footer */}
            <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "14px 22px", borderTop: "1px solid var(--border-default)", background: "var(--surface-1)" }}>
              {result && (
                <span style={{ fontSize: 11, color: "var(--text-muted)" }}>
                  {result.model} · {result.prompt_tokens + result.completion_tokens} token · <strong style={{ color: "var(--text-primary)" }}>€ {formatEur(result.cost_eur)}</strong>
                </span>
              )}
              <div style={{ marginLeft: "auto", display: "flex", gap: 10 }}>
                <button
                  type="button"
                  onClick={() => setOpenAgent(null)}
                  disabled={running}
                  style={{ padding: "9px 16px", borderRadius: 8, border: "1px solid var(--border-default)", background: "var(--surface-3)", color: "var(--text-muted)", fontSize: 13, fontWeight: 600, cursor: running ? "not-allowed" : "pointer" }}
                >
                  Chiudi
                </button>
                <button
                  type="button"
                  onClick={run}
                  disabled={running}
                  style={{
                    padding: "9px 18px",
                    borderRadius: 8,
                    border: `1px solid ${openAgent.colore}`,
                    background: `linear-gradient(135deg, ${openAgent.colore}, ${openAgent.colore}cc)`,
                    color: "#fff",
                    fontSize: 13,
                    fontWeight: 800,
                    cursor: running ? "not-allowed" : "pointer",
                    opacity: running ? 0.6 : 1,
                    display: "inline-flex",
                    alignItems: "center",
                    gap: 7,
                  }}
                >
                  {running ? <Loader2 size={14} className="animate-spin" /> : <Bot size={14} strokeWidth={2.2} />}
                  {running ? "In esecuzione…" : "Esegui agente"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
