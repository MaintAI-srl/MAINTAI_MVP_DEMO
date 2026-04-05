"use client";

import { useEffect, useMemo, useState } from "react";
import { apiGet, apiPost, apiPut } from "../lib/api";
import { notify } from "@/lib/toast";
import styles from "./assets.module.css";
import AssetAnalyticsModal from "../components/AssetAnalyticsModal";
import { DataTable, type ColumnDef } from "@/components/ui/data-table";

type Impianto = { id: number; nome: string };
type Asset = {
  id: number;
  name: string;
  nome: string;
  area: string;
  vincolo_orario?: string;
  note?: string;
  codice?: string;
  descrizione?: string;
  anno?: number;
  impianto_id?: number;
  impianto_nome?: string;
  limitazioni?: string;
  stato?: string;
  weather_sunny_required?: boolean;
  weather_max_wind_kmh?: number;
  weather_max_rain_mm?: number;
};

const STATI_ASSET = ["service", "out of service", "stopped"];

const STATO_COLORS: Record<string, { color: string; bg: string; border: string }> = {
  "service":         { color: "#34d399", bg: "rgba(52,211,153,.1)",  border: "rgba(52,211,153,.3)"  },
  "out of service":  { color: "#f87171", bg: "rgba(248,113,113,.1)", border: "rgba(248,113,113,.3)" },
  "stopped":         { color: "#fbbf24", bg: "rgba(251,191,36,.1)",  border: "rgba(251,191,36,.3)"  },
};

function statoStyle(s: string) {
  const c = STATO_COLORS[s] ?? STATO_COLORS["service"];
  return { color: c.color, background: c.bg, border: `1px solid ${c.border}`, padding: "2px 8px", borderRadius: 4, fontSize: 11, fontWeight: 600 };
}


export default function AssetsPage() {
  const [assets, setAssets] = useState<Asset[]>([]);
  const [impianti, setImpianti] = useState<Impianto[]>([]);

  // Form state
  const [nome, setNome] = useState("");
  const [codice, setCodice] = useState("");
  const [codicePreview, setCodicePreview] = useState("");
  const [descrizione, setDescrizione] = useState("");
  const [anno, setAnno] = useState<string>("");
  const [area, setArea] = useState("");
  const [impiantoId, setImpiantoId] = useState<string>("");
  const [limitazioni, setLimitazioni] = useState("");
  const [vincoloOrario, setVincoloOrario] = useState("");
  const [note, setNote] = useState("");
  const [stato, setStato] = useState("service");
  
  // Weather state
  const [weatherSunnyRequired, setWeatherSunnyRequired] = useState(false);
  const [weatherMaxWindKmh, setWeatherMaxWindKmh] = useState<string>("");
  const [weatherMaxRainMm, setWeatherMaxRainMm] = useState<string>("");

  const [search, setSearch] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [selectedAnalyticsAsset, setSelectedAnalyticsAsset] = useState<any>(null);

  useEffect(() => {
    loadAssets();
    apiGet<Impianto[]>("/impianti")
      .then(d => { if (Array.isArray(d)) setImpianti(d); })
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (codice.trim() || !descrizione.trim()) { setCodicePreview(""); return; }
    const timer = setTimeout(async () => {
      try {
        const d = await apiGet<{codice: string}>(`/assets/codice-preview?descrizione=${encodeURIComponent(descrizione)}`);
        if (d) setCodicePreview(d.codice);
      } catch { /* ignore */ }
    }, 400);
    return () => clearTimeout(timer);
  }, [descrizione, codice]);

  async function loadAssets() {
    try {
      const d = await apiGet<Asset[]>("/assets");
      setAssets(d);
    } catch {}
  }

  function resetForm() {
    setNome(""); setCodice(""); setCodicePreview(""); setDescrizione(""); setAnno("");
    setArea(""); setImpiantoId(""); setLimitazioni("");
    setVincoloOrario(""); setNote(""); setStato("service");
    setWeatherSunnyRequired(false); setWeatherMaxWindKmh(""); setWeatherMaxRainMm("");
  }

  function startEdit(asset: Asset) {
    setEditingId(asset.id);
    setNome(asset.nome || asset.name);
    setCodice(asset.codice || "");
    setDescrizione(asset.descrizione || "");
    setAnno(asset.anno ? String(asset.anno) : "");
    setArea(asset.area);
    setImpiantoId(asset.impianto_id ? String(asset.impianto_id) : "");
    setLimitazioni(asset.limitazioni || "");
    setVincoloOrario(asset.vincolo_orario || "");
    setNote(asset.note || "");
    setStato(asset.stato || "service");
    setWeatherSunnyRequired(asset.weather_sunny_required || false);
    setWeatherMaxWindKmh(asset.weather_max_wind_kmh ? String(asset.weather_max_wind_kmh) : "");
    setWeatherMaxRainMm(asset.weather_max_rain_mm ? String(asset.weather_max_rain_mm) : "");
    setCodicePreview("");
  }

  function cancelEdit() {
    setEditingId(null);
    resetForm();
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();

    if (!nome.trim()) { notify.error("Il campo 'Nome asset' è obbligatorio."); return; }
    if (!area.trim()) { notify.error("Il campo 'Area' è obbligatorio."); return; }
    if (!impiantoId) { notify.error("Devi selezionare un impianto."); return; }

    try {
      setIsSaving(true);
      const payload = {
        nome,
        name: nome,
        codice: codice.trim() || undefined,
        descrizione,
        anno: anno ? Number(anno) : undefined,
        area,
        impianto_id: impiantoId ? Number(impiantoId) : undefined,
        limitazioni,
        vincolo_orario: vincoloOrario,
        note,
        stato,
        weather_sunny_required: weatherSunnyRequired,
        weather_max_wind_kmh: weatherMaxWindKmh ? Number(weatherMaxWindKmh) : undefined,
        weather_max_rain_mm: weatherMaxRainMm ? Number(weatherMaxRainMm) : undefined,
      };

      const path = editingId !== null ? `/assets/${editingId}` : `/assets`;
      const saved = editingId !== null 
        ? await apiPut<Asset>(path, payload)
        : await apiPost<Asset>(path, payload);

      if (editingId !== null) {
        setAssets(prev => prev.map(a => a.id === editingId ? saved : a));
        cancelEdit();
      } else {
        setAssets(prev => [...prev, saved]);
        resetForm();
      }
    } catch (err: any) {
      notify.error(err.message || "Errore nel salvataggio.");
    } finally { setIsSaving(false); }
  }

  const filteredAssets = useMemo(() => {
    const term = search.trim().toLowerCase();
    if (!term) return assets;
    return assets.filter(a =>
      [a.name, a.codice ?? "", a.area, a.impianto_nome ?? ""].join(" ").toLowerCase().includes(term)
    );
  }, [assets, search]);

  const columns = useMemo<ColumnDef<Asset>[]>(() => [
    {
      accessorKey: "codice",
      header: "Codice",
      cell: ({ getValue }) => (
        <span style={{ fontFamily: "monospace", color: "#818cf8" }}>{getValue<string>() || "—"}</span>
      ),
    },
    {
      accessorKey: "name",
      header: "Nome",
    },
    {
      accessorKey: "impianto_nome",
      header: "Impianto",
    },
    {
      id: "meteo",
      header: "Meteo",
      enableSorting: false,
      cell: ({ row }) => {
        const a = row.original;
        return (
          <div style={{ display: "flex", gap: 4 }}>
            {a.weather_sunny_required && (
              <span title="Richiede Sole" style={{ fontSize: 10, background: "rgba(251,191,36,0.2)", color: "#fbbf24", padding: "1px 4px", borderRadius: 4 }}>☀️</span>
            )}
            {a.weather_max_wind_kmh && (
              <span title={`Vento max ${a.weather_max_wind_kmh} km/h`} style={{ fontSize: 10, background: "rgba(59,130,246,0.2)", color: "#60a5fa", padding: "1px 4px", borderRadius: 4 }}>💨 {a.weather_max_wind_kmh}</span>
            )}
          </div>
        );
      },
    },
    {
      accessorKey: "stato",
      header: "Stato",
      cell: ({ getValue }) => (
        <span style={statoStyle(getValue<string>() || "service")}>{getValue<string>()}</span>
      ),
    },
    {
      id: "azioni",
      header: "",
      enableSorting: false,
      cell: ({ row }) => {
        const asset = row.original;
        return (
          <div style={{ display: "flex", gap: 6 }}>
            <button
              onClick={() => startEdit(asset)}
              style={{ fontSize: 11, background: "none", color: "#818cf8", border: "1px solid #818cf8", padding: "2px 8px", borderRadius: 4, cursor: "pointer" }}
            >
              Modifica
            </button>
            <button
              onClick={() => setSelectedAnalyticsAsset(asset)}
              style={{ fontSize: 11, background: "#818cf8", color: "#fff", border: "none", padding: "2px 8px", borderRadius: 4, cursor: "pointer", fontWeight: 600 }}
            >
              📊 Stats
            </button>
          </div>
        );
      },
    },
  ], []);

  return (
    <div className={styles.page}>
      <section className={styles.hero}>
        <div className={styles.heroCopy}>
          <div className={styles.eyebrow}>Registry</div>
          <h1 className={styles.title}>Asset (Weather Aware)</h1>
          <p className={styles.subtitle}>Anagrafica asset con vincoli ambientali automatici per la pianificazione.</p>
        </div>
      </section>


      <div className={styles.grid}>
        <section className={styles.card}>
          <div className={styles.cardHead}>
            <h2 className={styles.cardTitle}>{editingId !== null ? `Modifica asset #${editingId}` : "Nuovo asset"}</h2>
          </div>

          <form onSubmit={handleSubmit} className={styles.form}>
            <div className={styles.field}>
              <label className={styles.label}>Nome asset *</label>
              <input required className={styles.input} value={nome} onChange={e => setNome(e.target.value)} placeholder="Pompa P-01" />
            </div>

            <div className={styles.field}>
              <label className={styles.label}>Codice</label>
              <input className={styles.input} value={codice} onChange={e => setCodice(e.target.value)} placeholder="ID manuale" />
            </div>

            <div className={`${styles.field} ${styles.span2}`}>
              <label className={styles.label}>Descrizione</label>
              <textarea className={`${styles.input} ${styles.textarea}`} value={descrizione} onChange={e => setDescrizione(e.target.value)} />
            </div>

            <div className={styles.field}>
              <label className={styles.label}>Impianto *</label>
              <select required className={styles.input} value={impiantoId} onChange={e => setImpiantoId(e.target.value)}>
                <option value="">Seleziona...</option>
                {impianti.map(imp => <option key={imp.id} value={String(imp.id)}>{imp.nome}</option>)}
              </select>
            </div>

            <div className={styles.field}>
              <label className={styles.label}>Area *</label>
              <input required className={styles.input} value={area} onChange={e => setArea(e.target.value)} />
            </div>

            {/* Weather Constraints */}
            <div className={`${styles.field} ${styles.span2}`} style={{ background: "rgba(59,130,246,0.05)", padding: 12, borderRadius: 8, border: "1px solid rgba(59,130,246,0.1)" }}>
              <label className={styles.label} style={{ color: "#818cf8", marginBottom: 12, display: "block" }}>Vincoli Meteo (Auto-Scheduling)</label>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12, alignItems: "center" }}>
                <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12, cursor: "pointer" }}>
                  <input type="checkbox" checked={weatherSunnyRequired} onChange={e => setWeatherSunnyRequired(e.target.checked)} />
                  Richiede Sole
                </label>
                <div>
                  <label style={{ fontSize: 10, color: "var(--text-muted)", display: "block" }}>Vento Max (km/h)</label>
                  <input type="number" className={styles.input} value={weatherMaxWindKmh} onChange={e => setWeatherMaxWindKmh(e.target.value)} placeholder="es. 30" />
                </div>
                <div>
                  <label style={{ fontSize: 10, color: "var(--text-muted)", display: "block" }}>Pioggia Max (mm/h)</label>
                  <input type="number" className={styles.input} value={weatherMaxRainMm} onChange={e => setWeatherMaxRainMm(e.target.value)} placeholder="es. 2" />
                </div>
              </div>
            </div>

            <div className={`${styles.field} ${styles.span2}`}>
              <label className={styles.label}>Stato operativo</label>
              <select className={styles.input} value={stato} onChange={e => setStato(e.target.value)}>
                {STATI_ASSET.map(s => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>

            <div className={`${styles.field} ${styles.span2}`}>
              <label className={styles.label}>Limitazioni (testo)</label>
              <input className={styles.input} value={limitazioni} onChange={e => setLimitazioni(e.target.value)} />
            </div>

            <div className={`${styles.actions} ${styles.span2}`}>
              <button className={styles.button} type="submit" disabled={isSaving}>
                {isSaving ? "Salvataggio..." : "Salva Asset"}
              </button>
              {editingId !== null && <button type="button" onClick={cancelEdit} className={styles.button} style={{ background: "rgba(75,85,99,0.2)", marginLeft: 8 }}>Annulla</button>}
            </div>
          </form>
        </section>

        <section className={styles.card}>
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 12 }}>
            <input
              className={styles.input}
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Cerca per nome, codice, impianto..."
              style={{ flex: 1 }}
            />
            <span style={{ fontSize: 12, color: "var(--text-secondary)", whiteSpace: "nowrap" }}>
              {filteredAssets.length} asset
            </span>
          </div>
          <DataTable
            data={filteredAssets}
            columns={columns}
            pageSize={10}
            emptyMessage="Nessun asset trovato"
          />
        </section>
      </div>

      {selectedAnalyticsAsset && (
        <AssetAnalyticsModal 
          asset={selectedAnalyticsAsset} 
          onClose={() => setSelectedAnalyticsAsset(null)} 
        />
      )}
    </div>
  );
}
