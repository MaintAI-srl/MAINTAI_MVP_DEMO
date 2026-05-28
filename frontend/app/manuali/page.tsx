"use client";

import { useEffect, useState, useMemo } from "react";
import styles from "./manuali.module.css";
import { apiGet, apiPatch, apiUpload } from "../lib/api";
import { notify } from "@/lib/toast";
import { useApiQuery, invalidateQueries } from "@/lib/useApiQuery";
import Skeleton from "../components/Skeleton";

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

function statoStyle(s: string): React.CSSProperties {
  if (s === "attivo")   return { color: "#34d399", background: "rgba(52,211,153,0.1)",  border: "1px solid rgba(52,211,153,0.3)"  };
  if (s === "pausa")    return { color: "#fbbf24", background: "rgba(251,191,36,0.1)",  border: "1px solid rgba(251,191,36,0.3)"  };
  return                       { color: "#f87171", background: "rgba(248,113,113,0.1)", border: "1px solid rgba(248,113,113,0.3)" };
}

const CATEGORIE = ["cabina_mt", "trasformatore", "carriponte", "fotovoltaico", "pompe", "compressori", "altro"];

const inputSt: React.CSSProperties = {
  background: "var(--border-subtle)", border: "1px solid rgba(148,163,184,0.15)",
  borderRadius: 8, color: "var(--text-primary)", padding: "9px 13px", fontSize: 13,
  width: "100%", outline: "none", fontFamily: "inherit",
};

const labelSt: React.CSSProperties = {
  fontSize: 10, fontWeight: 700, color: "var(--text-muted)",
  textTransform: "uppercase", letterSpacing: ".12em", display: "block", marginBottom: 5,
};

export default function ManualiPage() {
  const [assets, setAssets] = useState<Asset[]>([]);
  // #21 useApiQuery: caching automatico + refetch on focus per la lista manuali
  const { data: manualiRemote, loading: loadingList, refetch: reloadManuali } = useApiQuery<Manuale[]>("/manuali");
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

  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const [assetMode, setAssetMode] = useState<"existing" | "new">("existing");
  const [selectedAssetId, setSelectedAssetId] = useState<number | "">("");
  const [newAssetName, setNewAssetName] = useState("");
  const [newAssetCategoria, setNewAssetCategoria] = useState("altro");
  const [newAssetArea, setNewAssetArea] = useState("");
  const [uploadResult, setUploadResult] = useState<UploadResult | null>(null);
  const [loadingUpload, setLoadingUpload] = useState(false);
  const [loadingPiano, setLoadingPiano] = useState(false);

  // Sincronizza i dati remoti nel local state (mantiene compatibilità con aggiornamenti ottimistici)
  useEffect(() => {
    if (manualiRemote) setManuali(manualiRemote);
  }, [manualiRemote]);

  useEffect(() => {
    apiGet<Asset[]>("/assets")
      .then((data) => {
        setAssets(data);
        if (data.length > 0) setSelectedAssetId(data[0].id);
      })
      .catch(() => notify.error("Errore caricamento asset."));
    // Il caricamento manuali è gestito da useApiQuery (mount automatico)
  }, []);

  async function handleUpload(e: React.FormEvent) {
    e.preventDefault();
    if (!uploadFile) { notify.error("Seleziona un file PDF."); return; }
    if (assetMode === "new" && !newAssetName.trim()) { notify.error("Inserisci il nome del nuovo asset."); return; }
    setLoadingUpload(true);
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
      // Invalida cache manuali → useApiQuery refetch automatico
      invalidateQueries("/manuali");
      const [ar] = await Promise.all([apiGet<Asset[]>("/assets"), reloadManuali()]);
      setAssets(ar);
      if (assetMode === "new" && data.asset_id) {
        setSelectedAssetId(data.asset_id);
        setAssetMode("existing");
        setNewAssetName("");
      }
    } catch (err) {
      notify.error(err instanceof Error ? err.message : "Errore durante l'upload.");
    } finally {
      setLoadingUpload(false);
    }
  }

  async function handlePatchStato(manualeId: number, nuovoStato: string) {
    try {
      await apiPatch(`/manuali/${manualeId}`, { stato: nuovoStato });
      setManuali(prev => prev.map(m => m.id === manualeId ? { ...m, stato: nuovoStato } : m));
    } catch {
      notify.error("Errore aggiornamento stato manuale.");
    }
  }

  async function handleViewPiano(manualeId: number) {
    if (selectedManuale?.id_manuale === manualeId) { setSelectedManuale(null); return; }
    setLoadingPiano(true);
    try {
      const data = await apiGet<PianoManuale>(`/manuali/${manualeId}/piano`);
      setSelectedManuale(data);
    } catch {
      notify.error("Impossibile caricare il piano manutenzione.");
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

  const attivi = manuali.filter(m => m.stato === "attivo").length;
  const totaleTasks = manuali.reduce((s, m) => s + m.task_count, 0);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 0 }}>
      {/* ── HERO ── */}
      <div style={{
        position: "relative", overflow: "hidden",
        background: "linear-gradient(135deg, rgba(16,185,129,0.07) 0%, rgba(99,102,241,0.05) 50%, transparent 100%)",
        borderBottom: "1px solid rgba(16,185,129,0.1)",
        padding: "36px 32px 28px",
        marginBottom: 28,
      }}>
        <div style={{ position: "absolute", inset: 0, backgroundImage: "linear-gradient(rgba(16,185,129,0.04) 1px, transparent 1px), linear-gradient(90deg, rgba(16,185,129,0.04) 1px, transparent 1px)", backgroundSize: "32px 32px", pointerEvents: "none" }} />
        <div style={{ position: "absolute", top: -60, right: -60, width: 280, height: 280, borderRadius: "50%", background: "radial-gradient(circle, rgba(16,185,129,0.1) 0%, transparent 70%)", pointerEvents: "none" }} />
        <div style={{ position: "absolute", bottom: -40, left: 200, width: 200, height: 200, borderRadius: "50%", background: "radial-gradient(circle, rgba(99,102,241,0.07) 0%, transparent 70%)", pointerEvents: "none" }} />

        <div style={{ position: "relative" }}>
          <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: "0.2em", textTransform: "uppercase", color: "#10b981", marginBottom: 8 }}>AI Knowledge Base</div>
          <h1 style={{ margin: 0, fontSize: 32, fontWeight: 900, fontFamily: "'Barlow Condensed', sans-serif", background: "linear-gradient(135deg, #e2e8f0 0%, #34d399 100%)", WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent", lineHeight: 1.1, marginBottom: 6 }}>
            Manuali Tecnici
          </h1>
          <p style={{ margin: 0, color: "var(--text-muted)", fontSize: 13 }}>
            Carica un PDF — l&apos;AI estrae le attività di manutenzione e genera il piano nel DB.
          </p>
        </div>

        <div style={{ display: "flex", gap: 16, marginTop: 20, flexWrap: "wrap" }}>
          {[
            { label: "Manuali caricati", value: manuali.length, color: "#818cf8" },
            { label: "Attivi", value: attivi, color: "#34d399" },
            { label: "Attività totali", value: totaleTasks, color: "#fbbf24" },
          ].map(k => (
            <div key={k.label} style={{ background: "var(--border-subtle)", border: "1px solid var(--border-default)", borderRadius: 10, padding: "10px 18px", minWidth: 110 }}>
              <div style={{ fontSize: 9, textTransform: "uppercase", letterSpacing: ".12em", color: "var(--text-muted)", marginBottom: 4 }}>{k.label}</div>
              <div style={{ fontSize: 22, fontWeight: 800, color: k.color, lineHeight: 1 }}>{k.value}</div>
            </div>
          ))}
        </div>
      </div>

      <div style={{ padding: "0 32px 32px", display: "flex", flexDirection: "column", gap: 20 }}>
        {/* ── Upload ── */}
        <div style={{ background: "var(--bg-card)", border: "1px solid rgba(16,185,129,0.2)", borderRadius: 14, padding: "22px 24px", borderTop: "2px solid #10b981" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 18 }}>
            <div style={{ width: 32, height: 32, borderRadius: 8, background: "rgba(16,185,129,0.12)", border: "1px solid rgba(16,185,129,0.25)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 15 }}>📄</div>
            <div>
              <h2 style={{ margin: 0, fontSize: 14, fontWeight: 800 }}>Carica manuale PDF</h2>
              <p style={{ margin: 0, fontSize: 11, color: "var(--text-muted)" }}>L&apos;AI analizza il contenuto ed estrae automaticamente le attività di manutenzione</p>
            </div>
          </div>
          <form onSubmit={handleUpload}>
            <div style={{ marginBottom: 16 }}>
              <label style={labelSt}>Asset di riferimento</label>
              <div style={{ display: "flex", gap: 8, marginBottom: 10 }}>
                {(["existing", "new"] as const).map(mode => (
                  <button key={mode} type="button" onClick={() => setAssetMode(mode)} style={{
                    padding: "5px 14px", borderRadius: 6, border: "1px solid", fontSize: 12, cursor: "pointer",
                    background: assetMode === mode ? "rgba(99,102,241,0.15)" : "transparent",
                    color: assetMode === mode ? "#818cf8" : "var(--text-muted)",
                    borderColor: assetMode === mode ? "rgba(99,102,241,0.4)" : "rgba(75,85,99,0.3)",
                    fontWeight: assetMode === mode ? 700 : 400,
                  }}>
                    {mode === "existing" ? "Asset esistente" : "Crea nuovo asset"}
                  </button>
                ))}
              </div>

              {assetMode === "existing" ? (
                <select style={inputSt} value={selectedAssetId} onChange={(e) => setSelectedAssetId(e.target.value === "" ? "" : Number(e.target.value))}>
                  <option value="">-- Nessun asset (rilevazione automatica AI) --</option>
                  {assets.map((a) => <option key={a.id} value={a.id}>{a.name} ({a.categoria})</option>)}
                </select>
              ) : (
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr auto", gap: 12, marginTop: 0 }}>
                  <div style={{ gridColumn: "1/3" }}>
                    <label style={labelSt}>Nome asset *</label>
                    <input style={inputSt} value={newAssetName} onChange={(e) => setNewAssetName(e.target.value)} placeholder="Es. Pompa centrifuga P02" />
                  </div>
                  <div>
                    <label style={labelSt}>Categoria</label>
                    <select style={inputSt} value={newAssetCategoria} onChange={(e) => setNewAssetCategoria(e.target.value)}>
                      {CATEGORIE.map((c) => <option key={c} value={c}>{c}</option>)}
                    </select>
                  </div>
                  <div style={{ gridColumn: "1/-1" }}>
                    <label style={labelSt}>Area</label>
                    <input style={inputSt} value={newAssetArea} onChange={(e) => setNewAssetArea(e.target.value)} placeholder="Es. Reparto 3" />
                  </div>
                </div>
              )}
            </div>

            <div style={{ marginBottom: 16 }}>
              <label style={labelSt}>File PDF</label>
              <input style={inputSt} type="file" accept=".pdf" onChange={(e) => setUploadFile(e.target.files?.[0] ?? null)} />
            </div>

            <button
              type="submit"
              disabled={loadingUpload || !uploadFile}
              style={{ background: loadingUpload ? "rgba(16,185,129,0.3)" : "linear-gradient(135deg,#10b981,#059669)", color: "#fff", border: "none", borderRadius: 8, padding: "10px 24px", fontWeight: 700, fontSize: 13, cursor: loadingUpload || !uploadFile ? "not-allowed" : "pointer", opacity: !uploadFile ? 0.5 : 1 }}
            >
              {loadingUpload ? "⏳ Analisi AI in corso..." : "Carica e analizza"}
            </button>
            {loadingUpload && (
              <p style={{ marginTop: 10, color: "var(--text-muted)", fontSize: 12 }}>
                L&apos;AI sta leggendo il manuale ed estraendo le attività di manutenzione...
              </p>
            )}
          </form>
        </div>

        {/* ── Risultato upload ── */}
        {uploadResult && (
          <div style={{ background: "var(--bg-card)", border: "1px solid rgba(34,197,94,0.3)", borderRadius: 14, padding: "22px 24px", borderLeft: "3px solid #22c55e" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 16 }}>
              <div>
                <h3 style={{ margin: "0 0 4px", color: "var(--text-primary)", fontWeight: 800 }}>{uploadResult.filename}</h3>
                <span style={{ fontSize: 12, color: "var(--text-secondary)" }}>
                  {uploadResult.pages} pagine · asset: {uploadResult.asset_name || "non rilevato"}
                  {uploadResult.asset_id ? ` (ID #${uploadResult.asset_id})` : ""}
                </span>
              </div>
              <div style={{ textAlign: "right" }}>
                <div style={{ fontSize: 28, fontWeight: 900, color: "#22c55e", lineHeight: 1 }}>{uploadResult.task_count}</div>
                <div style={{ fontSize: 10, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: ".1em" }}>attività</div>
              </div>
            </div>
            {uploadResult.warning && <p style={{ fontSize: 12, color: "#fbbf24", marginBottom: 12, background: "rgba(251,191,36,0.08)", padding: "8px 12px", borderRadius: 6 }}>{uploadResult.warning}</p>}
            {uploadResult.tasks.length > 0 && (
              <div className={styles.tableWrap ?? "table-wrap"} style={{ overflowX: "auto" }}>
                <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
                  <thead>
                    <tr style={{ borderBottom: "1px solid var(--border)" }}>
                      {["Attività", "Frequenza (gg)", "Durata (h)", "Priorità"].map(h => (
                        <th key={h} style={{ padding: "8px 12px", textAlign: "left", fontSize: 10, fontWeight: 700, letterSpacing: ".1em", textTransform: "uppercase", color: "var(--text-muted)" }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {uploadResult.tasks.map((t, i) => (
                      <tr key={i} style={{ borderBottom: "1px solid var(--border-subtle)" }}>
                        <td style={{ padding: "9px 12px" }}>{t.attivita}</td>
                        <td style={{ padding: "9px 12px", color: "var(--text-muted)" }}>{t.frequenza_giorni ?? "—"}</td>
                        <td style={{ padding: "9px 12px", color: "var(--text-muted)" }}>{t.durata_ore?.toFixed(1) ?? "—"}</td>
                        <td style={{ padding: "9px 12px" }}><span style={{ ...prioritaStyle(t.priorita), fontSize: 11, padding: "2px 8px", borderRadius: 4, fontWeight: 600 }}>{t.priorita}</span></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}

        {/* ── Lista manuali ── */}
        <div style={{ background: "var(--bg-card)", border: "1px solid var(--border-default)", borderRadius: 14, padding: "22px 24px" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 18 }}>
            <h2 style={{ margin: 0, fontSize: 14, fontWeight: 800, color: "var(--text-primary)" }}>Manuali caricati</h2>
            <span style={{ fontSize: 11, background: "rgba(99,102,241,0.12)", color: "#818cf8", border: "1px solid rgba(99,102,241,0.25)", borderRadius: 20, padding: "2px 10px", fontWeight: 700 }}>{manuali.length}</span>
            {/* search col filter */}
            <div style={{ marginLeft: "auto", display: "flex", gap: 8 }}>
              {["nome"].map(col => (
                <input key={col} value={colFilters[col] ?? ""} onChange={e => setColFilters(p => ({ ...p, [col]: e.target.value }))} placeholder="Cerca nome..." style={{ background: "var(--border-subtle)", border: "1px solid rgba(148,163,184,0.12)", borderRadius: 7, color: "var(--text-primary)", padding: "6px 12px", fontSize: 12, outline: "none", width: 180 }} />
              ))}
            </div>
          </div>

          {loadingList ? (
            <div style={{ marginTop: 8 }}>
              <Skeleton variant="table" rows={4} cols={5} />
            </div>
          ) : manuali.length === 0 ? (
            <div style={{ color: "var(--text-muted)", textAlign: "center", padding: "32px 0", fontSize: 13 }}>Nessun manuale caricato.</div>
          ) : (
            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
                <thead>
                  <tr style={{ borderBottom: "1px solid var(--border)" }}>
                    {[
                      { label: "ID", col: "id" },
                      { label: "Nome file", col: "nome" },
                      { label: "Pagine", col: "pagine" },
                      { label: "Attività", col: "task_count" },
                      { label: "Ver.", col: "version" },
                      { label: "Stato", col: null },
                      { label: "Piano", col: null },
                    ].map(({ label, col }) => (
                      <th key={label} style={{ padding: "8px 12px", textAlign: "left", fontSize: 10, fontWeight: 700, letterSpacing: ".1em", textTransform: "uppercase", color: "var(--text-muted)", cursor: col ? "pointer" : "default", userSelect: "none", whiteSpace: "nowrap" }}
                        onClick={() => col && handleSort(col)}>
                        {label}{col && sortCol === col ? (sortDir === "asc" ? " ↑" : " ↓") : ""}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {sortedManuali.map((m) => (
                    <tr key={m.id} style={{ borderBottom: "1px solid var(--border-subtle)", transition: "background 0.1s" }}
                      onMouseEnter={e => (e.currentTarget.style.background = "var(--border-subtle)")}
                      onMouseLeave={e => (e.currentTarget.style.background = "transparent")}
                    >
                      <td style={{ padding: "10px 12px", color: "var(--text-muted)", fontFamily: "monospace", fontSize: 12 }}>#{m.id}</td>
                      <td style={{ padding: "10px 12px", fontWeight: 600, maxWidth: 260, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{m.nome}</td>
                      <td style={{ padding: "10px 12px", color: "var(--text-muted)" }}>{m.pagine}</td>
                      <td style={{ padding: "10px 12px" }}>
                        <span style={{ color: m.task_count > 0 ? "#34d399" : "var(--text-muted)", fontWeight: 700 }}>{m.task_count}</span>
                      </td>
                      <td style={{ padding: "10px 12px", color: "var(--text-muted)", fontSize: 11 }}>v{m.version}</td>
                      <td style={{ padding: "10px 12px" }}>
                        <select
                          value={m.stato}
                          onChange={e => handlePatchStato(m.id, e.target.value)}
                          style={{ ...statoStyle(m.stato), fontSize: 11, padding: "2px 8px", borderRadius: 4, fontWeight: 600, cursor: "pointer", appearance: "none", outline: "none" }}
                        >
                          <option value="attivo">attivo</option>
                          <option value="pausa">pausa</option>
                          <option value="obsoleto">obsoleto</option>
                        </select>
                      </td>
                      <td style={{ padding: "10px 12px" }}>
                        {m.task_count > 0 ? (
                          <button onClick={() => handleViewPiano(m.id)} style={{ fontSize: 11, padding: "4px 12px", border: "1px solid rgba(99,102,241,0.35)", color: "#818cf8", background: selectedManuale?.id_manuale === m.id ? "rgba(99,102,241,0.15)" : "rgba(99,102,241,0.06)", cursor: "pointer", borderRadius: 6, fontWeight: 600 }}>
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

        {/* ── Dettaglio piano ── */}
        {loadingPiano && <div style={{ color: "var(--text-muted)", padding: "16px", textAlign: "center", fontSize: 13 }}>Caricamento piano...</div>}
        {selectedManuale && !loadingPiano && (
          <div style={{ background: "var(--bg-card)", border: "1px solid rgba(99,102,241,0.2)", borderRadius: 14, padding: "22px 24px", borderTop: "2px solid #6366f1" }}>
            <div style={{ marginBottom: 18 }}>
              <h2 style={{ margin: "0 0 4px", fontSize: 15, fontWeight: 800 }}>Piano — {selectedManuale.filename}</h2>
              <p style={{ margin: 0, color: "var(--text-muted)", fontSize: 12 }}>
                {selectedManuale.attivita.length} attività di manutenzione estratte dal manuale
              </p>
            </div>
            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
                <thead>
                  <tr style={{ borderBottom: "1px solid var(--border)" }}>
                    {["#", "Descrizione attività", "Frequenza (gg)", "Durata (h)", "Priorità", "Asset"].map(h => (
                      <th key={h} style={{ padding: "8px 12px", textAlign: "left", fontSize: 10, fontWeight: 700, letterSpacing: ".1em", textTransform: "uppercase", color: "var(--text-muted)" }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {selectedManuale.attivita.map((a, i) => (
                    <tr key={a.id} style={{ borderBottom: "1px solid var(--border-subtle)" }}>
                      <td style={{ padding: "9px 12px", color: "var(--text-muted)", fontSize: 11 }}>{i + 1}</td>
                      <td style={{ padding: "9px 12px" }}>{a.descrizione}</td>
                      <td style={{ padding: "9px 12px", color: "var(--text-muted)" }}>{a.frequenza_giorni ?? "—"}</td>
                      <td style={{ padding: "9px 12px", color: "var(--text-muted)" }}>{a.durata_ore?.toFixed(1) ?? "—"}</td>
                      <td style={{ padding: "9px 12px" }}><span style={{ ...prioritaStyle(a.priorita), fontSize: 11, padding: "2px 8px", borderRadius: 4, fontWeight: 600 }}>{a.priorita}</span></td>
                      <td style={{ padding: "9px 12px", color: a.asset_id ? "#818cf8" : "var(--text-disabled)", fontSize: 12 }}>{a.asset_id ? `#${a.asset_id}` : "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
