"use client";

import { useEffect, useState, useMemo } from "react";
import { API_BASE } from "../lib/api";

type Asset = { id: number; name: string; categoria: string };

type Attivita = {
  id: number;
  descrizione: string;
  frequenza_giorni: number | null;
  durata_ore: number | null;
  priorita: string;
  asset_id: number | null;
  asset_name: string;
  manuale_id: number | null;
  origine: string;
  ticket_id: number | null;
};

function prioritaStyle(p: string): React.CSSProperties {
  switch (p?.toLowerCase()) {
    case "alta":  return { color: "#f87171", background: "rgba(248,113,113,0.1)", border: "1px solid rgba(248,113,113,0.3)" };
    case "media": return { color: "#fbbf24", background: "rgba(251,191,36,0.1)",  border: "1px solid rgba(251,191,36,0.3)" };
    case "bassa": return { color: "#34d399", background: "rgba(52,211,153,0.1)",  border: "1px solid rgba(52,211,153,0.3)" };
    default:      return { color: "var(--text-secondary)", background: "rgba(156,163,175,0.1)", border: "1px solid rgba(156,163,175,0.3)" };
  }
}

const PRIORITA_OPTIONS = ["Alta", "Media", "Bassa"];
const PAGE_LIMIT = 25;

type PagedPiani = { items: Attivita[]; total: number; page: number; pages: number };

function Pagination({ page, pages, onPage }: { page: number; pages: number; onPage: (p: number) => void }) {
  if (pages <= 1) return null;
  const btnStyle: React.CSSProperties = { padding: "4px 10px", background: "transparent", border: "1px solid rgba(75,85,99,0.5)", color: "var(--text-secondary)", borderRadius: 6, cursor: "pointer", fontSize: 13 };
  return (
    <div style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 16, justifyContent: "center" }}>
      <button onClick={() => onPage(page - 1)} disabled={page <= 1} style={btnStyle}>‹</button>
      {Array.from({ length: pages }, (_, i) => i + 1).filter(p => Math.abs(p - page) <= 2 || p === 1 || p === pages).map((p, idx, arr) => {
        const prev = arr[idx - 1];
        return [
          prev && p - prev > 1 ? <span key={`e${p}`} style={{ color: "var(--text-muted)" }}>…</span> : null,
          <button key={p} onClick={() => onPage(p)} style={{ ...btnStyle, ...(p === page ? { background: "rgba(99,102,241,0.3)", color: "#818cf8", borderColor: "rgba(99,102,241,0.5)" } : {}) }}>{p}</button>
        ];
      })}
      <button onClick={() => onPage(page + 1)} disabled={page >= pages} style={btnStyle}>›</button>
      <span style={{ color: "var(--text-muted)", fontSize: 12 }}>pag. {page}/{pages}</span>
    </div>
  );
}

const colFilterInput: React.CSSProperties = { marginTop: 3, width: "100%", background: "rgba(255,255,255,0.04)", border: "1px solid rgba(59,130,246,0.15)", borderRadius: 3, color: "var(--text-secondary)", padding: "2px 5px", fontSize: 10, outline: "none", fontFamily: "inherit" };

function SortTh({ label, col, sortCol, sortDir, colFilters, onSort, onFilter }: { label: string; col: string; sortCol: string | null; sortDir: "asc" | "desc"; colFilters: Record<string, string>; onSort: (c: string) => void; onFilter: (c: string, v: string) => void }) {
  const active = sortCol === col;
  return (
    <th>
      <div onClick={() => onSort(col)} style={{ cursor: "pointer", userSelect: "none", display: "flex", alignItems: "center", gap: 4, whiteSpace: "nowrap" }}>
        {label}
        <span style={{ fontSize: 9, opacity: active ? 1 : 0.25, color: active ? "#818cf8" : "inherit" }}>{active && sortDir === "desc" ? "↓" : "↑"}</span>
      </div>
      <input value={colFilters[col] ?? ""} onChange={e => onFilter(col, e.target.value)} onClick={e => e.stopPropagation()} placeholder="…" style={colFilterInput} />
    </th>
  );
}

export default function PianiPage() {
  const [result, setResult] = useState<PagedPiani | null>(null);
  const [assets, setAssets] = useState<Asset[]>([]);
  const [filterAsset, setFilterAsset] = useState<string>("");
  const [filterPriorita, setFilterPriorita] = useState<string>("");
  const [currentPage, setCurrentPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [generaMsg, setGeneraMsg] = useState("");

  // Sorting + col filters
  const [sortCol, setSortCol] = useState<string | null>(null);
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");
  const [colFilters, setColFilters] = useState<Record<string, string>>({});
  function handleColFilter(col: string, val: string) { setColFilters(prev => ({ ...prev, [col]: val })); }

  // Detail panel
  const [detailActivity, setDetailActivity] = useState<Attivita | null>(null);

  const attivita = result?.items ?? [];

  // inline edit state
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editDescrizione, setEditDescrizione] = useState("");
  const [editFrequenza, setEditFrequenza] = useState("");
  const [editDurata, setEditDurata] = useState("");
  const [editPriorita, setEditPriorita] = useState("");
  const [editAssetId, setEditAssetId] = useState<string>("");
  const [saving, setSaving] = useState(false);
  const [generatingId, setGeneratingId] = useState<number | null>(null);

  useEffect(() => {
    fetch(`${API_BASE}/assets`)
      .then((r) => r.json())
      .then(setAssets)
      .catch(() => {});
  }, []);

  useEffect(() => { setCurrentPage(1); }, [filterAsset, filterPriorita]);
  useEffect(() => { loadPiani(currentPage); }, [filterAsset, filterPriorita, currentPage]);

  async function loadPiani(p: number) {
    setLoading(true);
    setError("");
    try {
      const params = new URLSearchParams({ page: String(p), limit: String(PAGE_LIMIT) });
      if (filterAsset) params.set("asset_id", filterAsset);
      if (filterPriorita) params.set("priorita", filterPriorita);
      const res = await fetch(`${API_BASE}/piani?${params}`);
      if (!res.ok) throw new Error();
      setResult(await res.json());
    } catch {
      setError("Impossibile caricare il piano manutenzione.");
    } finally {
      setLoading(false);
    }
  }

  function startEdit(a: Attivita) {
    setEditingId(a.id);
    setEditDescrizione(a.descrizione);
    setEditFrequenza(a.frequenza_giorni != null ? String(a.frequenza_giorni) : "");
    setEditDurata(a.durata_ore != null ? String(a.durata_ore) : "");
    setEditPriorita(a.priorita);
    setEditAssetId(a.asset_id != null ? String(a.asset_id) : "");
  }

  function cancelEdit() {
    setEditingId(null);
  }

  async function saveEdit(id: number) {
    setSaving(true);
    try {
      const body: Record<string, unknown> = {
        descrizione: editDescrizione,
        priorita: editPriorita,
      };
      if (editFrequenza !== "") body.frequenza_giorni = Number(editFrequenza);
      if (editDurata !== "") body.durata_ore = Number(editDurata);
      if (editAssetId !== "") body.asset_id = Number(editAssetId);

      const res = await fetch(`${API_BASE}/piani/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error();
      const updated: Attivita = await res.json();
      setResult((prev) => prev ? { ...prev, items: prev.items.map(a => a.id === id ? updated : a) } : prev);
      setEditingId(null);
    } catch {
      setError("Errore durante il salvataggio.");
    } finally {
      setSaving(false);
    }
  }

  async function generaTicket(ids: number[]) {
    if (ids.length === 0) return;
    setGeneraMsg("");
    if (ids.length === 1) setGeneratingId(ids[0]);
    try {
      const res = await fetch(`${API_BASE}/piani/genera-ticket`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ attivita_ids: ids }),
      });
      if (!res.ok) throw new Error();
      const genResult = await res.json();
      setGeneraMsg(`${genResult.created} ticket creati, ${genResult.skipped} già presenti.`);
      await loadPiani(currentPage);
    } catch {
      setError("Errore durante la generazione ticket.");
    } finally {
      setGeneratingId(null);
    }
  }

  function handleSort(col: string) {
    if (sortCol === col) {
      if (sortDir === "asc") setSortDir("desc");
      else { setSortCol(null); setSortDir("asc"); }
    } else { setSortCol(col); setSortDir("asc"); }
  }

  const sortedAttivita = useMemo(() => {
    let result = attivita;
    for (const [col, val] of Object.entries(colFilters)) {
      if (!val.trim()) continue;
      const t = val.toLowerCase();
      result = result.filter(a => String((a as Record<string, unknown>)[col] ?? "").toLowerCase().includes(t));
    }
    if (!sortCol) return result;
    return [...result].sort((a, b) => {
      const av = (a as Record<string, unknown>)[sortCol] ?? "";
      const bv = (b as Record<string, unknown>)[sortCol] ?? "";
      const cmp = String(av).localeCompare(String(bv), "it", { numeric: true });
      return sortDir === "asc" ? cmp : -cmp;
    });
  }, [attivita, sortCol, sortDir]);

  const noTicketIds = attivita.filter((a) => !a.ticket_id).map((a) => a.id);

  return (
    <div style={{ padding: "24px 32px", maxWidth: 1300, margin: "0 auto" }}>
      <div style={{ marginBottom: 32, display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
        <div>
          <h1 className="page-title">Piano di Manutenzione</h1>
          <p className="page-subtitle">
            Tutte le attività estratte dai manuali. Filtra, modifica in linea e genera ticket.
          </p>
        </div>
        <div style={{ display: "flex", gap: 12 }}>
          <button 
            onClick={() => window.location.href = `${API_BASE}/piani/export`} 
            style={{ padding: "8px 16px", borderRadius: 8, background: "rgba(34,197,94,0.1)", border: "1px solid rgba(34,197,94,0.4)", color: "#22c55e", fontWeight: 600, cursor: "pointer", display: "flex", gap: 8, alignItems: "center" }}
          >
            <span>📊</span> Esporta CSV
          </button>
          <button 
            onClick={() => window.print()} 
            style={{ padding: "8px 16px", borderRadius: 8, background: "rgba(220,38,38,0.1)", border: "1px solid rgba(220,38,38,0.4)", color: "#ef4444", fontWeight: 600, cursor: "pointer", display: "flex", gap: 8, alignItems: "center" }}
          >
            <span>📄</span> Salva PDF
          </button>
        </div>
      </div>

      {error && (
        <div style={{ color: "#fecaca", background: "rgba(127,29,29,0.35)", border: "1px solid rgba(248,113,113,0.35)", padding: "12px 16px", borderRadius: 10, marginBottom: 20 }}>
          {error}
        </div>
      )}

      {generaMsg && (
        <div style={{ color: "#86efac", background: "rgba(22,163,74,0.15)", border: "1px solid rgba(34,197,94,0.3)", padding: "12px 16px", borderRadius: 10, marginBottom: 20, fontSize: 13 }}>
          {generaMsg}
        </div>
      )}

      {/* Filters */}
      <div style={{ display: "flex", gap: 12, marginBottom: 20, flexWrap: "wrap", alignItems: "center" }}>
        <select
          className="select"
          style={{ minWidth: 200 }}
          value={filterAsset}
          onChange={(e) => setFilterAsset(e.target.value)}
        >
          <option value="">Tutti gli asset</option>
          {assets.map((a) => (
            <option key={a.id} value={a.id}>{a.name}</option>
          ))}
        </select>

        <select
          className="select"
          style={{ minWidth: 150 }}
          value={filterPriorita}
          onChange={(e) => setFilterPriorita(e.target.value)}
        >
          <option value="">Tutte le priorità</option>
          {PRIORITA_OPTIONS.map((p) => (
            <option key={p} value={p}>{p}</option>
          ))}
        </select>

        <button
          onClick={() => { setFilterAsset(""); setFilterPriorita(""); }}
          style={{ padding: "6px 14px", background: "transparent", border: "1px solid rgba(75,85,99,0.5)", color: "var(--text-secondary)", borderRadius: 6, cursor: "pointer", fontSize: 12 }}
        >
          Azzera filtri
        </button>

        <button
          onClick={() => generaTicket(noTicketIds)}
          disabled={noTicketIds.length === 0}
          style={{ padding: "6px 16px", background: noTicketIds.length > 0 ? "rgba(99,102,241,0.2)" : "transparent", border: "1px solid rgba(99,102,241,0.4)", color: noTicketIds.length > 0 ? "#818cf8" : "var(--text-disabled)", borderRadius: 6, cursor: noTicketIds.length > 0 ? "pointer" : "default", fontSize: 12, fontWeight: 600 }}
        >
          Genera tutti i ticket ({noTicketIds.length})
        </button>

        <span style={{ marginLeft: "auto", color: "var(--text-muted)", fontSize: 13 }}>
          {result?.total ?? 0} attività totali
        </span>
      </div>

      {/* Table */}
      <div className="dark-card card-body">
        {loading ? (
          <p style={{ color: "var(--text-secondary)" }}>Caricamento...</p>
        ) : attivita.length === 0 ? (
          <p style={{ color: "var(--text-muted)" }}>Nessuna attività trovata. Carica un manuale PDF per generare il piano.</p>
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>#</th>
                  <SortTh label="Descrizione" col="descrizione" sortCol={sortCol} sortDir={sortDir} colFilters={colFilters} onSort={handleSort} onFilter={handleColFilter} />
                  <SortTh label="Asset" col="asset_name" sortCol={sortCol} sortDir={sortDir} colFilters={colFilters} onSort={handleSort} onFilter={handleColFilter} />
                  <SortTh label="Freq (gg)" col="frequenza_giorni" sortCol={sortCol} sortDir={sortDir} colFilters={colFilters} onSort={handleSort} onFilter={handleColFilter} />
                  <SortTh label="Durata (h)" col="durata_ore" sortCol={sortCol} sortDir={sortDir} colFilters={colFilters} onSort={handleSort} onFilter={handleColFilter} />
                  <SortTh label="Priorità" col="priorita" sortCol={sortCol} sortDir={sortDir} colFilters={colFilters} onSort={handleSort} onFilter={handleColFilter} />
                  <th>Ticket</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {sortedAttivita.map((a) =>
                  editingId === a.id ? (
                    <tr key={a.id} style={{ background: "rgba(99,102,241,0.07)" }}>
                      <td style={{ color: "var(--text-muted)" }}>{a.id}</td>
                      <td>
                        <input
                          className="input"
                          style={{ minWidth: 220, fontSize: 12, padding: "4px 8px" }}
                          value={editDescrizione}
                          onChange={(e) => setEditDescrizione(e.target.value)}
                        />
                      </td>
                      <td>
                        <select
                          className="select"
                          style={{ fontSize: 12, padding: "4px 8px" }}
                          value={editAssetId}
                          onChange={(e) => setEditAssetId(e.target.value)}
                        >
                          <option value="">— nessuno —</option>
                          {assets.map((as) => (
                            <option key={as.id} value={as.id}>{as.name}</option>
                          ))}
                        </select>
                      </td>
                      <td>
                        <input
                          className="input"
                          type="number"
                          style={{ width: 70, fontSize: 12, padding: "4px 8px" }}
                          value={editFrequenza}
                          onChange={(e) => setEditFrequenza(e.target.value)}
                          placeholder="gg"
                        />
                      </td>
                      <td>
                        <input
                          className="input"
                          type="number"
                          style={{ width: 70, fontSize: 12, padding: "4px 8px" }}
                          value={editDurata}
                          onChange={(e) => setEditDurata(e.target.value)}
                          placeholder="h"
                          step="0.5"
                        />
                      </td>
                      <td>
                        <select
                          className="select"
                          style={{ fontSize: 12, padding: "4px 8px" }}
                          value={editPriorita}
                          onChange={(e) => setEditPriorita(e.target.value)}
                        >
                          {PRIORITA_OPTIONS.map((p) => (
                            <option key={p} value={p}>{p}</option>
                          ))}
                        </select>
                      </td>
                      <td style={{ color: "var(--text-muted)", fontSize: 11 }}>
                        {a.ticket_id ? `#${a.ticket_id}` : "—"}
                      </td>
                      <td style={{ whiteSpace: "nowrap" }}>
                        <button
                          onClick={() => saveEdit(a.id)}
                          disabled={saving}
                          style={{ fontSize: 11, padding: "3px 10px", border: "1px solid rgba(34,197,94,0.4)", color: "var(--green)", background: "transparent", cursor: "pointer", borderRadius: 4, marginRight: 4 }}
                        >
                          {saving ? "..." : "Salva"}
                        </button>
                        <button
                          onClick={cancelEdit}
                          style={{ fontSize: 11, padding: "3px 10px", border: "1px solid rgba(75,85,99,0.4)", color: "var(--text-secondary)", background: "transparent", cursor: "pointer", borderRadius: 4 }}
                        >
                          Annulla
                        </button>
                      </td>
                    </tr>
                  ) : (
                    <tr key={a.id}>
                      <td style={{ color: "var(--text-muted)" }}>{a.id}</td>
                      <td onClick={() => setDetailActivity(a)} style={{ cursor: "pointer", color: "var(--text-primary)" }}>{a.descrizione}</td>
                      <td style={{ color: a.asset_id ? "#818cf8" : "var(--text-disabled)" }}>
                        {a.asset_name || (a.asset_id ? `#${a.asset_id}` : "—")}
                      </td>
                      <td>{a.frequenza_giorni ?? "—"}</td>
                      <td>{a.durata_ore?.toFixed(1) ?? "—"}</td>
                      <td>
                        <span style={{ ...prioritaStyle(a.priorita), fontSize: 11, padding: "2px 8px", borderRadius: 4, fontWeight: 600 }}>
                          {a.priorita}
                        </span>
                      </td>
                      <td>
                        {a.ticket_id ? (
                          <span style={{ color: "var(--green)", fontSize: 12 }}>#{a.ticket_id}</span>
                        ) : (
                          <button
                            onClick={() => generaTicket([a.id])}
                            disabled={generatingId === a.id}
                            style={{ fontSize: 11, padding: "3px 10px", border: "1px solid rgba(251,191,36,0.4)", color: "#fbbf24", background: "transparent", cursor: "pointer", borderRadius: 4 }}
                          >
                            {generatingId === a.id ? "..." : "+ Ticket"}
                          </button>
                        )}
                      </td>
                      <td>
                        <button
                          onClick={() => startEdit(a)}
                          style={{ fontSize: 11, padding: "3px 10px", border: "1px solid rgba(99,102,241,0.4)", color: "#818cf8", background: "transparent", cursor: "pointer", borderRadius: 4 }}
                        >
                          Modifica
                        </button>
                      </td>
                    </tr>
                  )
                )}
              </tbody>
            </table>
          </div>
        )}
        <Pagination page={currentPage} pages={result?.pages ?? 1} onPage={p => setCurrentPage(p)} />
      </div>

      {/* Detail panel */}
      {detailActivity && (
        <div style={{
          position: "fixed", right: 0, top: 0, bottom: 0, width: 380,
          background: "var(--bg-surface)", borderLeft: "1px solid rgba(59,130,246,0.2)",
          zIndex: 200, display: "flex", flexDirection: "column", overflowY: "auto",
          padding: 24
        }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}>
            <h3 style={{ margin: 0, fontSize: 14, fontWeight: 700 }}>Dettaglio attività</h3>
            <button onClick={() => setDetailActivity(null)} style={{ background: "transparent", border: "none", color: "var(--text-muted)", fontSize: 18, cursor: "pointer" }}>✕</button>
          </div>
          <div style={{ fontSize: 13, color: "var(--text-primary)", marginBottom: 16 }}>{detailActivity.descrizione}</div>
          {/* Details */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 20 }}>
            <div>
              <div style={{ fontSize: 10, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.1em" }}>Frequenza</div>
              <div style={{ fontSize: 14, color: "var(--text-primary)" }}>{detailActivity.frequenza_giorni ? `ogni ${detailActivity.frequenza_giorni}gg` : "—"}</div>
            </div>
            <div>
              <div style={{ fontSize: 10, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.1em" }}>Durata</div>
              <div style={{ fontSize: 14, color: "var(--text-primary)" }}>{detailActivity.durata_ore ? `${detailActivity.durata_ore.toFixed(1)}h` : "—"}</div>
            </div>
          </div>
          {/* Ticket status */}
          <div style={{ marginBottom: 20 }}>
            <div style={{ fontSize: 11, color: "var(--text-muted)", marginBottom: 8, textTransform: "uppercase", letterSpacing: "0.1em" }}>Ticket</div>
            {detailActivity.ticket_id ? (
              <span style={{ color: "var(--green)", fontSize: 13 }}>#{detailActivity.ticket_id} — generato</span>
            ) : (
              <button onClick={() => { generaTicket([detailActivity.id]); setDetailActivity(null); }}
                style={{ fontSize: 11, padding: "6px 14px", border: "1px solid rgba(251,191,36,0.4)", color: "#fbbf24", background: "transparent", cursor: "pointer", borderRadius: 4 }}>
                + Genera Ticket
              </button>
            )}
          </div>
          {/* Prossime scadenze */}
          {detailActivity.frequenza_giorni && (
            <div>
              <div style={{ fontSize: 11, color: "var(--text-muted)", marginBottom: 8, textTransform: "uppercase", letterSpacing: "0.1em" }}>Prossime scadenze (12 mesi)</div>
              {Array.from({ length: Math.min(12, Math.floor(365 / detailActivity.frequenza_giorni)) }, (_, i) => {
                const d = new Date();
                d.setDate(d.getDate() + (i + 1) * detailActivity.frequenza_giorni!);
                return (
                  <div key={i} style={{ fontSize: 12, color: "var(--text-secondary)", padding: "4px 0", borderBottom: "1px solid rgba(59,130,246,0.08)" }}>
                    {d.toLocaleDateString("it-IT", { day: "2-digit", month: "short", year: "numeric" })}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
