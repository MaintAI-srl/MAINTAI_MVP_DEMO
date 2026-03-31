"use client";

import { useEffect, useState, useMemo } from "react";
import styles from "./manuali.module.css";
import { apiGet, apiPatch, apiUpload } from "../lib/api";

type Asset = { id: number; name: string; categoria: string };

type Manuale = {
  id: number;
  nome: string;
  pagine: number;
  metodo: string;
  task_count: number;
  version: number;
  stato: string;
};

type Attivita = {
  id: number;
  descrizione: string;
  frequenza_giorni: number | null;
  durata_ore: number | null;
  priorita: string;
  asset_id: number | null;
};

type PianoManuale = {
  id_manuale: number;
  filename: string;
  pagine: number;
  attivita: Attivita[];
};

type UploadResult = {
  id_manuale: number;
  filename: string;
  pages: number;
  asset_name: string;
  asset_id: number | null;
  task_count: number;
  tasks: { attivita: string; frequenza_giorni: number | null; durata_ore: number | null; priorita: string }[];
  warning?: string;
};

function prioritaStyle(p: string): React.CSSProperties {
  switch (p?.toLowerCase()) {
    case "alta":  return { color: "#f87171", background: "rgba(248,113,113,0.1)", border: "1px solid rgba(248,113,113,0.3)" };
    case "media": return { color: "#fbbf24", background: "rgba(251,191,36,0.1)",  border: "1px solid rgba(251,191,36,0.3)" };
    case "bassa": return { color: "#34d399", background: "rgba(52,211,153,0.1)",  border: "1px solid rgba(52,211,153,0.3)" };
    default:      return { color: "var(--text-secondary)", background: "rgba(156,163,175,0.1)", border: "1px solid rgba(156,163,175,0.3)" };
  }
}

const CATEGORIE = ["cabina_mt", "trasformatore", "carriponte", "fotovoltaico", "pompe", "compressori", "altro"];

const colFilterInput: React.CSSProperties = { marginTop: 3, width: "100%", background: "rgba(255,255,255,0.04)", border: "1px solid rgba(59,130,246,0.15)", borderRadius: 3, color: "var(--text-secondary)", padding: "2px 5px", fontSize: 10, outline: "none", fontFamily: "inherit" };

export default function ManualiPage() {
  const [assets, setAssets] = useState<Asset[]>([]);
  const [manuali, setManuali] = useState<Manuale[]>([]);
  const [selectedManuale, setSelectedManuale] = useState<PianoManuale | null>(null);
  const [sortCol, setSortCol] = useState("");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");
  const [colFilters, setColFilters] = useState<Record<string, string>>({});

  function handleSort(col: string) {
    if (sortCol === col) {
      if (sortDir === "asc") setSortDir("desc");
      else { setSortCol(""); setSortDir("asc"); }
    } else { setSortCol(col); setSortDir("asc"); }
  }
  function handleColFilter(col: string, val: string) {
    setColFilters(prev => ({ ...prev, [col]: val }));
  }

  function SortTh({ label, col }: { label: string; col: string }) {
    const active = sortCol === col;
    return (
      <th>
        <div onClick={() => handleSort(col)} style={{ cursor: "pointer", userSelect: "none", display: "flex", alignItems: "center", gap: 4, whiteSpace: "nowrap" }}>
          {label}
          <span style={{ fontSize: 9, opacity: active ? 1 : 0.25, color: active ? "#818cf8" : "inherit" }}>{active && sortDir === "desc" ? "↓" : "↑"}</span>
        </div>
        <input value={colFilters[col] ?? ""} onChange={e => handleColFilter(col, e.target.value)} onClick={e => e.stopPropagation()} placeholder="…" style={colFilterInput} />
      </th>
    );
  }

  // Upload state
  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const [assetMode, setAssetMode] = useState<"existing" | "new">("existing");
  const [selectedAssetId, setSelectedAssetId] = useState<number | "">("");
  const [newAssetName, setNewAssetName] = useState("");
  const [newAssetCategoria, setNewAssetCategoria] = useState("altro");
  const [newAssetArea, setNewAssetArea] = useState("");

  const [uploadResult, setUploadResult] = useState<UploadResult | null>(null);
  const [loadingList, setLoadingList] = useState(true);
  const [loadingUpload, setLoadingUpload] = useState(false);
  const [loadingPiano, setLoadingPiano] = useState(false);
  const [error, setError] = useState("");

  async function loadManuali() {
    setLoadingList(true);
    try {
      const data = await apiGet<Manuale[]>("/manuali");
      setManuali(data);
    } catch {
      setError("Impossibile caricare l'elenco manuali.");
    } finally {
      setLoadingList(false);
    }
  }

  useEffect(() => {
    apiGet<Asset[]>("/assets")
      .then((data) => {
        setAssets(data);
        if (data.length > 0) setSelectedAssetId(data[0].id);
      })
      .catch(() => {});
    loadManuali();
  }, []);

  async function handleUpload(e: React.FormEvent) {
    e.preventDefault();
    if (!uploadFile) { setError("Seleziona un file PDF."); return; }
    if (assetMode === "new" && !newAssetName.trim()) {
      setError("Inserisci il nome del nuovo asset.");
      return;
    }

    setLoadingUpload(true);
    setError("");
    setUploadResult(null);

    const formData = new FormData();
    formData.append("file", uploadFile);

    if (assetMode === "existing" && selectedAssetId !== "") {
      formData.append("asset_id", String(selectedAssetId));
    } else if (assetMode === "new") {
      formData.append("new_asset_name", newAssetName.trim());
      formData.append("new_asset_categoria", newAssetCategoria);
      formData.append("new_asset_area", newAssetArea.trim());
    }

    try {
      const data = await apiUpload<UploadResult>("/manuali/upload", formData);
      setUploadResult(data);
      setUploadFile(null);
      // Ricarica assets (potrebbe essere stato creato uno nuovo) e manuali
      const [ar] = await Promise.all([
        apiGet<Asset[]>("/assets"),
        loadManuali(),
      ]);
      setAssets(ar);
      if (assetMode === "new" && data.asset_id) {
        setSelectedAssetId(data.asset_id);
        setAssetMode("existing");
        setNewAssetName("");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Errore durante l'upload.");
    } finally {
      setLoadingUpload(false);
    }
  }

  async function handlePatchStato(manualeId: number, nuovoStato: string) {
    try {
      await apiPatch(`/manuali/${manualeId}`, { stato: nuovoStato });
      setManuali(prev => prev.map(m => m.id === manualeId ? { ...m, stato: nuovoStato } : m));
    } catch {
      setError("Errore aggiornamento stato manuale.");
    }
  }

  async function handleViewPiano(manualeId: number) {
    if (selectedManuale?.id_manuale === manualeId) { setSelectedManuale(null); return; }
    setLoadingPiano(true);
    try {
      const data = await apiGet<PianoManuale>(`/manuali/${manualeId}/piano`);
      setSelectedManuale(data);
    } catch {
      setError("Impossibile caricare il piano manutenzione.");
    } finally {
      setLoadingPiano(false);
    }
  }

  const sortedManuali = useMemo(() => {
    let result = manuali;
    for (const [col, val] of Object.entries(colFilters)) {
      if (!val.trim()) continue;
      const t = val.toLowerCase();
      result = result.filter(m => String((m as Record<string, unknown>)[col] ?? "").toLowerCase().includes(t));
    }
    if (sortCol) {
      result = [...result].sort((a, b) => {
        const av = String((a as Record<string, unknown>)[sortCol] ?? "");
        const bv = String((b as Record<string, unknown>)[sortCol] ?? "");
        const cmp = av.localeCompare(bv, "it", { numeric: true });
        return sortDir === "asc" ? cmp : -cmp;
      });
    }
    return result;
  }, [manuali, sortCol, sortDir, colFilters]);

  return (
    <div style={{ padding: "24px 32px", maxWidth: 1100, margin: "0 auto" }}>
      <div style={{ marginBottom: 32 }}>
        <h1 className="page-title">Manuali Tecnici</h1>
        <p className="page-subtitle">
          Carica un PDF — l&apos;AI estrae le attività di manutenzione e genera il piano nel DB.
        </p>
      </div>

      {error && (
        <div style={{ color: "#fecaca", background: "rgba(127,29,29,0.35)", border: "1px solid rgba(248,113,113,0.35)", padding: "12px 16px", borderRadius: 10, marginBottom: 20 }}>
          {error}
        </div>
      )}

      {/* Upload */}
      <div className="dark-card card-body" style={{ marginBottom: 24 }}>
        <h2 style={{ margin: "0 0 20px" }}>Carica manuale PDF</h2>
        <form onSubmit={handleUpload}>
          {/* Selezione asset */}
          <div style={{ marginBottom: 16 }}>
            <label className="label">Asset di riferimento</label>
            <div style={{ display: "flex", gap: 8, marginBottom: 10 }}>
              <button
                type="button"
                onClick={() => setAssetMode("existing")}
                style={{ padding: "5px 14px", borderRadius: 6, border: "1px solid", fontSize: 12, cursor: "pointer", background: assetMode === "existing" ? "rgba(99,102,241,0.2)" : "transparent", color: assetMode === "existing" ? "#818cf8" : "var(--text-muted)", borderColor: assetMode === "existing" ? "rgba(99,102,241,0.5)" : "rgba(75,85,99,0.4)" }}
              >
                Asset esistente
              </button>
              <button
                type="button"
                onClick={() => setAssetMode("new")}
                style={{ padding: "5px 14px", borderRadius: 6, border: "1px solid", fontSize: 12, cursor: "pointer", background: assetMode === "new" ? "rgba(99,102,241,0.2)" : "transparent", color: assetMode === "new" ? "#818cf8" : "var(--text-muted)", borderColor: assetMode === "new" ? "rgba(99,102,241,0.5)" : "rgba(75,85,99,0.4)" }}
              >
                Crea nuovo asset
              </button>
            </div>

            {assetMode === "existing" ? (
              <select
                className="select"
                value={selectedAssetId}
                onChange={(e) => setSelectedAssetId(e.target.value === "" ? "" : Number(e.target.value))}
              >
                <option value="">-- Nessun asset (rilevazione automatica AI) --</option>
                {assets.map((a) => (
                  <option key={a.id} value={a.id}>{a.name} ({a.categoria})</option>
                ))}
              </select>
            ) : (
              <div className="form-grid-3" style={{ marginTop: 0 }}>
                <div className="span-2">
                  <label className="label">Nome asset *</label>
                  <input className="input" value={newAssetName} onChange={(e) => setNewAssetName(e.target.value)} placeholder="Es. Pompa centrifuga P02" />
                </div>
                <div>
                  <label className="label">Categoria</label>
                  <select className="select" value={newAssetCategoria} onChange={(e) => setNewAssetCategoria(e.target.value)}>
                    {CATEGORIE.map((c) => <option key={c} value={c}>{c}</option>)}
                  </select>
                </div>
                <div className="span-3">
                  <label className="label">Area</label>
                  <input className="input" value={newAssetArea} onChange={(e) => setNewAssetArea(e.target.value)} placeholder="Es. Reparto 3" />
                </div>
              </div>
            )}
          </div>

          {/* File */}
          <div style={{ marginBottom: 16 }}>
            <label className="label">File PDF</label>
            <input className="input" type="file" accept=".pdf" onChange={(e) => setUploadFile(e.target.files?.[0] ?? null)} />
          </div>

          <button className="btn-primary" type="submit" disabled={loadingUpload || !uploadFile}>
            {loadingUpload ? "Analisi AI in corso..." : "Carica e analizza"}
          </button>
        </form>

        {loadingUpload && (
          <p style={{ marginTop: 12, color: "var(--text-secondary)", fontSize: 13 }}>
            L&apos;AI sta leggendo il manuale ed estraendo le attività di manutenzione...
          </p>
        )}
      </div>

      {/* Risultato upload */}
      {uploadResult && (
        <div className="dark-card card-body" style={{ marginBottom: 24, borderLeft: "3px solid #22c55e" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 16 }}>
            <div>
              <h3 style={{ margin: "0 0 4px", color: "var(--text-primary)" }}>{uploadResult.filename}</h3>
              <span style={{ fontSize: 13, color: "var(--text-secondary)" }}>
                {uploadResult.pages} pagine · asset:{" "}
                {uploadResult.asset_name || "non rilevato"}
                {uploadResult.asset_id ? ` (ID #${uploadResult.asset_id})` : ""}
              </span>
            </div>
            <span style={{ fontSize: 22, fontWeight: 700, color: "var(--green)" }}>
              {uploadResult.task_count} attività
            </span>
          </div>
          {uploadResult.warning && (
            <p style={{ fontSize: 12, color: "#fbbf24", marginBottom: 12 }}>{uploadResult.warning}</p>
          )}
          {uploadResult.tasks.length > 0 && (
            <div className="table-wrap">
              <table className="table">
                <thead><tr><th>Attività</th><th>Frequenza (gg)</th><th>Durata (h)</th><th>Priorità</th></tr></thead>
                <tbody>
                  {uploadResult.tasks.map((t, i) => (
                    <tr key={i}>
                      <td>{t.attivita}</td>
                      <td>{t.frequenza_giorni ?? "—"}</td>
                      <td>{t.durata_ore?.toFixed(1) ?? "—"}</td>
                      <td><span style={{ ...prioritaStyle(t.priorita), fontSize: 11, padding: "2px 8px", borderRadius: 4, fontWeight: 600 }}>{t.priorita}</span></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* Lista manuali */}
      <div className="dark-card card-body" style={{ marginBottom: 24 }}>
        <h2 style={{ margin: "0 0 16px" }}>
          Manuali caricati
          <span style={{ fontSize: 13, fontWeight: 400, color: "var(--text-secondary)", marginLeft: 10 }}>{manuali.length} file</span>
        </h2>
        {loadingList ? (
          <p style={{ color: "var(--text-secondary)" }}>Caricamento...</p>
        ) : manuali.length === 0 ? (
          <p style={{ color: "var(--text-muted)" }}>Nessun manuale caricato.</p>
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead><tr><SortTh label="ID" col="id" /><SortTh label="Nome file" col="nome" /><SortTh label="Pagine" col="pagine" /><SortTh label="Attività" col="task_count" /><SortTh label="Ver." col="version" /><SortTh label="Stato" col="stato" /><th>Piano</th></tr></thead>
              <tbody>
                {sortedManuali.map((m) => (
                  <tr key={m.id}>
                    <td style={{ color: "var(--text-muted)" }}>#{m.id}</td>
                    <td style={{ fontWeight: 500 }}>{m.nome}</td>
                    <td>{m.pagine}</td>
                    <td><span style={{ color: m.task_count > 0 ? "var(--green)" : "var(--text-muted)", fontWeight: 600 }}>{m.task_count}</span></td>
                    <td style={{ color: "var(--text-secondary)", fontSize: 12 }}>v{m.version}</td>
                    <td>
                      <select
                        value={m.stato}
                        onChange={e => handlePatchStato(m.id, e.target.value)}
                        style={{
                          fontSize: 11, padding: "2px 8px", borderRadius: 4, fontWeight: 600, cursor: "pointer",
                          appearance: "none", outline: "none",
                          ...(m.stato === "attivo"
                            ? { color: "#34d399", background: "rgba(52,211,153,0.1)", border: "1px solid rgba(52,211,153,0.3)" }
                            : m.stato === "pausa"
                            ? { color: "#fbbf24", background: "rgba(251,191,36,0.1)", border: "1px solid rgba(251,191,36,0.3)" }
                            : { color: "#f87171", background: "rgba(248,113,113,0.1)", border: "1px solid rgba(248,113,113,0.3)" })
                        }}
                      >
                        <option value="attivo">attivo</option>
                        <option value="pausa">pausa</option>
                        <option value="obsoleto">obsoleto</option>
                      </select>
                    </td>
                    <td>
                      {m.task_count > 0 ? (
                        <button onClick={() => handleViewPiano(m.id)} style={{ fontSize: 11, padding: "3px 10px", border: "1px solid rgba(99,102,241,0.4)", color: "#818cf8", background: "transparent", cursor: "pointer", borderRadius: 4 }}>
                          {selectedManuale?.id_manuale === m.id ? "Chiudi" : "Vedi piano →"}
                        </button>
                      ) : (
                        <span style={{ color: "var(--text-disabled)", fontSize: 12 }}>—</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Dettaglio piano */}
      {loadingPiano && <p style={{ color: "var(--text-secondary)", padding: "16px 0" }}>Caricamento piano...</p>}
      {selectedManuale && !loadingPiano && (
        <div className="dark-card card-body">
          <h2 style={{ margin: "0 0 4px" }}>Piano — {selectedManuale.filename}</h2>
          <p style={{ color: "var(--text-secondary)", fontSize: 13, marginBottom: 20 }}>
            {selectedManuale.attivita.length} attività di manutenzione estratte dal manuale
          </p>
          <div className="table-wrap">
            <table className="table">
              <thead><tr><th>#</th><th>Descrizione attività</th><th>Frequenza (gg)</th><th>Durata (h)</th><th>Priorità</th><th>Asset</th></tr></thead>
              <tbody>
                {selectedManuale.attivita.map((a, i) => (
                  <tr key={a.id}>
                    <td style={{ color: "var(--text-muted)" }}>{i + 1}</td>
                    <td>{a.descrizione}</td>
                    <td>{a.frequenza_giorni ?? "—"}</td>
                    <td>{a.durata_ore?.toFixed(1) ?? "—"}</td>
                    <td><span style={{ ...prioritaStyle(a.priorita), fontSize: 11, padding: "2px 8px", borderRadius: 4, fontWeight: 600 }}>{a.priorita}</span></td>
                    <td style={{ color: a.asset_id ? "#818cf8" : "var(--text-disabled)" }}>{a.asset_id ? `#${a.asset_id}` : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
