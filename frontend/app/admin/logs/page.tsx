"use client";
import { useState, useEffect } from "react";
import { apiGet } from "../../lib/api";
import StatusToggle from "../../components/StatusToggle";

export default function AdminLogsPage() {
  const [logs, setLogs] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [lines, setLines] = useState(100);
  const [view, setView] = useState<"db" | "file">("db");
  const [level, setLevel] = useState("");
  const [module, setModule] = useState("");
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);

  const fetchLogs = async () => {
    setLoading(true);
    setError("");
    try {
      if (view === "file") {
        const data: any = await apiGet(`/logs?lines=${lines}`);
        if (data && typeof data === 'object' && Array.isArray(data.logs)) {
          setLogs(data.logs);
        } else {
          setLogs([]);
        }
      } else {
        const q = new URLSearchParams({
          page: String(page),
          limit: "50",
          ...(level && { level }),
          ...(module && { module }),
        });
        const data: any = await apiGet(`/logs/system-logs?${q.toString()}`);
        if (data && Array.isArray(data.logs)) {
          setLogs(data.logs.map((l: any) => 
            `[${new Date(l.timestamp).toLocaleString()}] ${l.level} [${l.module}] ${l.message} ${l.extra_info ? '| ' + l.extra_info : ''}`
          ));
          setTotal(data.total);
        }
      }
    } catch (err: any) {
      setError(err.message || "Errore durante il caricamento dei log");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchLogs();
  }, [view, lines, level, module, page]);

  const getLogLevelColor = (line: string) => {
    if (line.includes("ERROR")) return "#ef4444";
    if (line.includes("WARNING")) return "#f59e0b";
    if (line.includes("DEBUG")) return "#10b981";
    return "inherit";
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "calc(100vh - 120px)", padding: "20px" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "20px" }}>
        <div>
          <h1 style={{ fontSize: "20px", fontWeight: 700 }}>LOG DI SISTEMA</h1>
          <p style={{ fontSize: "14px", color: "var(--text-muted)" }}>Monitoraggio in tempo reale delle operazioni backend</p>
        </div>
        <StatusToggle 
          size="sm"
          currentValue={view}
          onChange={(v: any) => setView(v)}
          options={[
            { value: "db", label: "DB Logs", color: "var(--blue)" },
            { value: "file", label: "System File", color: "var(--text-muted)" },
          ]}
        />
        <div style={{ display: "flex", gap: "12px", alignItems: "center" }}>
           {view === "file" ? (
             <select 
              className="input" 
              style={{ width: "150px" }}
              value={lines}
              onChange={(e) => setLines(Number(e.target.value))}
             >
               <option value={50}>Ultime 50 righe</option>
               <option value={100}>Ultime 100 righe</option>
               <option value={500}>Ultime 500 righe</option>
               <option value={1000}>Ultime 1000 righe</option>
             </select>
           ) : (
             <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
                <span style={{ fontSize: 11, fontWeight: 700, color: "var(--text-muted)" }}>LIVELLO:</span>
                <StatusToggle 
                  size="sm"
                  currentValue={level}
                  onChange={(v) => { setLevel(v); setPage(1); }}
                  options={[
                    { value: "", label: "TUTTI", color: "var(--text-muted)" },
                    { value: "INFO", label: "INFO", color: "var(--green)" },
                    { value: "WARNING", label: "WARN", color: "var(--amber)" },
                    { value: "ERROR", label: "ERR", color: "var(--red)" },
                  ]}
                />
                <span style={{ fontSize: 11, fontWeight: 700, color: "var(--text-muted)", marginLeft: 8 }}>MODULO:</span>
                <StatusToggle 
                  size="sm"
                  currentValue={module}
                  onChange={(v) => { setModule(v); setPage(1); }}
                  options={[
                    { value: "", label: "TUTTI", color: "var(--text-muted)" },
                    { value: "EMAIL_POLLER", label: "EMAIL", color: "#818cf8" },
                    { value: "AUTH", label: "AUTH", color: "#a78bfa" },
                  ]}
                />
             </div>
           )}
           <button className="btn btn-secondary" onClick={fetchLogs} disabled={loading} style={{ borderRadius: 10 }}>
             {loading ? "..." : "REFRESH"}
           </button>
        </div>

      </div>

      <div style={{ 
        flex: 1, 
        background: "#0a0a0a", 
        border: "1px solid var(--border-strong)", 
        borderRadius: "12px", 
        padding: "20px",
        overflowY: "auto",
        fontFamily: "'IBM Plex Mono', monospace",
        fontSize: "12px",
        lineHeight: "1.6",
        color: "#e5e7eb",
        boxShadow: "inset 0 2px 10px rgba(0,0,0,0.5)"
      }}>
        {loading && logs.length === 0 ? (
          <div style={{ color: "var(--text-muted)", textAlign: "center", marginTop: "40px" }}>Caricamento in corso...</div>
        ) : error ? (
          <div style={{ color: "var(--red)", textAlign: "center", marginTop: "40px" }}>{error}</div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column" }}>
            {logs.map((log, i) => (
              <div 
                key={i} 
                style={{ 
                  whiteSpace: "pre-wrap", 
                  color: getLogLevelColor(log),
                  padding: "2px 0",
                  borderBottom: "1px solid rgba(255,255,255,0.03)"
                }}
              >
                <span style={{ opacity: 0.3, marginRight: "10px" }}>{(i+1).toString().padStart(4, '0')}</span>
                {log}
              </div>
            ))}
            {logs.length === 0 && <div style={{ color: "var(--text-muted)", textAlign: "center" }}>Nessun log registrato.</div>}
          </div>
        )}
      </div>
      
      <div style={{ marginTop: "12px", fontSize: "11px", color: "var(--text-muted)", textAlign: "right" }}>
        Visualizzate {logs.length} righe. Formato ISO-8601 UTC.
      </div>
    </div>
  );
}
