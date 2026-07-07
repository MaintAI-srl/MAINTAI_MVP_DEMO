"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { API_BASE, apiGet, apiUpload, getTauriToken, isTauri } from "../../lib/api";
import { notify } from "@/lib/toast";

type Tenant = {
  id: number;
  nome: string;
  slug: string;
  is_active: boolean;
};

type TemplateInfo = {
  id: string;
  label: string;
  description: string;
  filename: string;
};

type PreviewResult = {
  valid: boolean;
  errors: string[];
  counts: Record<string, number>;
  preview: Record<string, Record<string, string>[]>;
};

type ImportResult = {
  success: boolean;
  message: string;
  stats: Record<string, number>;
};

const FALLBACK_TEMPLATES: TemplateInfo[] = [
  { id: "gerarchia", label: "Siti + Impianti + Asset", description: "Template completo con tre fogli collegati.", filename: "maintai_bulk_import_template.xlsx" },
  { id: "siti", label: "Siti", description: "Anagrafica siti produttivi.", filename: "maintai_template_siti.xlsx" },
  { id: "impianti", label: "Impianti", description: "Impianti collegati a siti esistenti.", filename: "maintai_template_impianti.xlsx" },
  { id: "asset", label: "Asset", description: "Asset collegati a impianti esistenti.", filename: "maintai_template_asset.xlsx" },
  { id: "tecnici", label: "Tecnici", description: "Anagrafica tecnici e disponibilita.", filename: "maintai_template_tecnici.xlsx" },
  { id: "piani_manutenzione", label: "Piani di manutenzione", description: "Piani e task ricorrenti collegati ad asset.", filename: "maintai_template_piani_manutenzione.xlsx" },
  { id: "corsi_attestati", label: "Corsi e attestati", description: "Attestati e scadenze formazione tecnici.", filename: "maintai_template_corsi_attestati.xlsx" },
];

export default function BulkImportPage() {
  const [templates, setTemplates] = useState<TemplateInfo[]>(FALLBACK_TEMPLATES);
  const [selectedType, setSelectedType] = useState("gerarchia");
  const [tenants, setTenants] = useState<Tenant[]>([]);
  const [tenantId, setTenantId] = useState<number | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<PreviewResult | null>(null);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [previewing, setPreviewing] = useState(false);
  const [importing, setImporting] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const selectedTemplate = useMemo(
    () => templates.find((template) => template.id === selectedType) ?? templates[0],
    [selectedType, templates],
  );

  useEffect(() => {
    async function load() {
      setLoading(true);
      try {
        const [templateData, tenantData] = await Promise.all([
          apiGet<{ templates: TemplateInfo[] }>("/admin/bulk-import/templates").catch(() => ({ templates: FALLBACK_TEMPLATES })),
          apiGet<Tenant[]>("/tenants"),
        ]);
        setTemplates(templateData.templates?.length ? templateData.templates : FALLBACK_TEMPLATES);
        setTenants(tenantData);
        setTenantId((current) => current ?? tenantData[0]?.id ?? null);
      } catch (error) {
        notify.error(error instanceof Error ? error.message : "Errore caricamento import massivo");
      } finally {
        setLoading(false);
      }
    }
    load();
  }, []);

  function resetFileState() {
    setFile(null);
    setPreview(null);
    setResult(null);
    if (fileRef.current) fileRef.current.value = "";
  }

  async function downloadTemplate(template: TemplateInfo) {
    const headers: HeadersInit = {};
    if (isTauri()) {
      const token = getTauriToken();
      if (token) headers.Authorization = `Bearer ${token}`;
    }
    try {
      const res = await fetch(`${API_BASE}/admin/bulk-import/template/${template.id}`, {
        method: "GET",
        credentials: "include",
        headers,
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = template.filename;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
      notify.success("Template scaricato");
    } catch (error) {
      notify.error(error instanceof Error ? error.message : "Download template non riuscito");
    }
  }

  async function runPreview() {
    if (!file || !tenantId) return;
    setPreviewing(true);
    setPreview(null);
    setResult(null);
    try {
      const fd = new FormData();
      fd.append("file", file);
      fd.append("tenant_id", String(tenantId));
      fd.append("import_type", selectedType);
      const data = await apiUpload<PreviewResult>("/admin/bulk-import/preview", fd);
      setPreview(data);
      if (data.valid) notify.success("File valido. Controlla l'anteprima e conferma l'import.");
      else notify.warning("File da correggere prima dell'import");
    } catch (error) {
      notify.error(error instanceof Error ? error.message : "Errore anteprima");
    } finally {
      setPreviewing(false);
    }
  }

  async function runImport() {
    if (!file || !tenantId || !preview?.valid) return;
    setImporting(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      fd.append("tenant_id", String(tenantId));
      fd.append("import_type", selectedType);
      const data = await apiUpload<ImportResult>("/admin/bulk-import/execute", fd);
      setResult(data);
      notify.success(data.message);
    } catch (error) {
      notify.error(error instanceof Error ? error.message : "Errore import");
    } finally {
      setImporting(false);
    }
  }

  return (
    <main style={{ minHeight: "100vh", background: "var(--surface-1)", color: "var(--text-primary)", padding: "32px 24px" }}>
      <header style={{ marginBottom: 24 }}>
        <div style={{ fontSize: 22, fontWeight: 800 }}>Import Massivo</div>
        <p style={{ margin: "6px 0 0", maxWidth: 820, color: "var(--text-muted)", fontSize: 13, lineHeight: 1.5 }}>
          Scarica il template Excel per la tipologia dati, compilalo e caricalo con validazione preventiva.
        </p>
      </header>

      <section style={{ display: "grid", gridTemplateColumns: "minmax(280px, 390px) minmax(0, 1fr)", gap: 18, alignItems: "start" }}>
        <aside style={panelStyle}>
          <div style={sectionTitle}>Template disponibili</div>
          <div style={{ display: "grid", gap: 10 }}>
            {templates.map((template) => {
              const active = selectedType === template.id;
              return (
                <button
                  key={template.id}
                  onClick={() => {
                    setSelectedType(template.id);
                    resetFileState();
                  }}
                  style={{
                    textAlign: "left",
                    border: `1px solid ${active ? "rgba(96,165,250,.6)" : "var(--border-default)"}`,
                    background: active ? "rgba(30,64,175,.28)" : "var(--surface-2)",
                    color: "var(--text-primary)",
                    borderRadius: 8,
                    padding: 12,
                    cursor: "pointer",
                  }}
                >
                  <strong style={{ display: "block", fontSize: 14 }}>{template.label}</strong>
                  <span style={{ display: "block", marginTop: 4, fontSize: 12, color: "var(--text-muted)", lineHeight: 1.35 }}>
                    {template.description}
                  </span>
                </button>
              );
            })}
          </div>
        </aside>

        <section style={panelStyle}>
          <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap", marginBottom: 20 }}>
            <div>
              <div style={sectionTitle}>{selectedTemplate?.label}</div>
              <div style={{ fontSize: 12, color: "var(--text-muted)" }}>{selectedTemplate?.description}</div>
            </div>
            <button onClick={() => selectedTemplate && downloadTemplate(selectedTemplate)} style={primaryButton}>
              Scarica template Excel
            </button>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))", gap: 14, marginBottom: 18 }}>
            <label>
              <span style={labelStyle}>Tenant destinatario</span>
              <select
                value={tenantId ?? ""}
                disabled={loading}
                onChange={(event) => setTenantId(Number(event.target.value) || null)}
                style={inputStyle}
              >
                <option value="">Seleziona tenant</option>
                {tenants.map((tenant) => (
                  <option key={tenant.id} value={tenant.id}>
                    {tenant.nome} ({tenant.slug}){tenant.is_active ? "" : " - inattivo"}
                  </option>
                ))}
              </select>
            </label>

            <label>
              <span style={labelStyle}>File Excel compilato</span>
              <input
                ref={fileRef}
                type="file"
                accept=".xlsx"
                onChange={(event) => {
                  const nextFile = event.target.files?.[0] ?? null;
                  setFile(nextFile);
                  setPreview(null);
                  setResult(null);
                }}
                style={inputStyle}
              />
            </label>
          </div>

          {file && (
            <div style={{ marginBottom: 18, padding: 12, border: "1px solid var(--border-default)", borderRadius: 8, background: "var(--surface-2)" }}>
              <strong style={{ fontSize: 13 }}>{file.name}</strong>
              <span style={{ marginLeft: 8, fontSize: 12, color: "var(--text-muted)" }}>{(file.size / 1024).toFixed(1)} KB</span>
            </div>
          )}

          <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginBottom: 20 }}>
            <button
              onClick={runPreview}
              disabled={!file || !tenantId || previewing}
              style={{ ...secondaryButton, opacity: !file || !tenantId || previewing ? 0.55 : 1 }}
            >
              {previewing ? "Validazione..." : "Valida e mostra anteprima"}
            </button>
            <button
              onClick={runImport}
              disabled={!preview?.valid || importing}
              style={{ ...primaryButton, opacity: !preview?.valid || importing ? 0.55 : 1 }}
            >
              {importing ? "Import in corso..." : "Conferma import"}
            </button>
            {(file || preview || result) && (
              <button onClick={resetFileState} style={secondaryButton}>Nuovo file</button>
            )}
          </div>

          {preview && <PreviewPanel preview={preview} />}
          {result && <ResultPanel result={result} />}
        </section>
      </section>
    </main>
  );
}

function PreviewPanel({ preview }: { preview: PreviewResult }) {
  const total = Object.values(preview.counts).reduce((sum, count) => sum + count, 0);
  return (
    <div style={{ display: "grid", gap: 16 }}>
      <div style={{
        border: `1px solid ${preview.valid ? "rgba(34,197,94,.45)" : "rgba(239,68,68,.45)"}`,
        background: preview.valid ? "rgba(5,46,22,.28)" : "rgba(127,29,29,.22)",
        borderRadius: 8,
        padding: 14,
      }}>
        <strong>{preview.valid ? "File valido" : "File non valido"}</strong>
        <span style={{ marginLeft: 8, color: "var(--text-muted)", fontSize: 12 }}>{total} righe dati rilevate</span>
        {!preview.valid && (
          <div style={{ marginTop: 10, display: "grid", gap: 4 }}>
            {preview.errors.map((error, index) => (
              <div key={`${error}-${index}`} style={{ fontSize: 12, color: "#fecaca" }}>{error}</div>
            ))}
          </div>
        )}
      </div>

      {Object.entries(preview.preview).map(([sheet, rows]) => (
        <PreviewTable key={sheet} title={sheet} rows={rows} />
      ))}
    </div>
  );
}

function PreviewTable({ title, rows }: { title: string; rows: Record<string, string>[] }) {
  if (!rows.length) return null;
  const columns = Object.keys(rows[0]);
  return (
    <div>
      <div style={{ fontSize: 11, fontWeight: 800, color: "#93c5fd", textTransform: "uppercase", marginBottom: 8 }}>
        Anteprima {title}
      </div>
      <div style={{ overflowX: "auto", border: "1px solid var(--border-default)", borderRadius: 8 }}>
        <table style={{ borderCollapse: "collapse", width: "100%", minWidth: 620, fontSize: 12 }}>
          <thead>
            <tr>
              {columns.map((column) => (
                <th key={column} style={thStyle}>{column}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, index) => (
              <tr key={index}>
                {columns.map((column) => (
                  <td key={column} style={tdStyle}>{row[column] ?? ""}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function ResultPanel({ result }: { result: ImportResult }) {
  return (
    <div style={{ marginTop: 16, border: "1px solid rgba(34,197,94,.45)", background: "rgba(5,46,22,.28)", borderRadius: 8, padding: 16 }}>
      <strong style={{ color: "#86efac" }}>Import completato</strong>
      <div style={{ marginTop: 5, color: "var(--text-muted)", fontSize: 13 }}>{result.message}</div>
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginTop: 14 }}>
        {Object.entries(result.stats).map(([key, value]) => (
          <span key={key} style={statPill}>
            <strong>{value}</strong> {key.replaceAll("_", " ")}
          </span>
        ))}
      </div>
    </div>
  );
}

const panelStyle = {
  background: "var(--surface-2)",
  border: "1px solid var(--border-strong)",
  borderRadius: 8,
  padding: 18,
} as const;

const sectionTitle = {
  fontSize: 15,
  fontWeight: 800,
  marginBottom: 10,
} as const;

const labelStyle = {
  display: "block",
  fontSize: 11,
  fontWeight: 800,
  color: "var(--text-muted)",
  textTransform: "uppercase",
  letterSpacing: ".06em",
  marginBottom: 6,
} as const;

const inputStyle = {
  width: "100%",
  background: "var(--surface-1)",
  border: "1px solid var(--border-default)",
  color: "var(--text-primary)",
  borderRadius: 8,
  padding: "10px 12px",
  fontSize: 13,
} as const;

const primaryButton = {
  background: "linear-gradient(135deg,#047857,#059669)",
  color: "#ecfdf5",
  border: "1px solid #10b981",
  borderRadius: 8,
  padding: "10px 16px",
  fontSize: 13,
  fontWeight: 800,
  cursor: "pointer",
} as const;

const secondaryButton = {
  background: "var(--surface-2)",
  color: "var(--text-primary)",
  border: "1px solid var(--border-default)",
  borderRadius: 8,
  padding: "10px 14px",
  fontSize: 13,
  cursor: "pointer",
} as const;

const thStyle = {
  textAlign: "left",
  background: "var(--surface-3)",
  color: "var(--text-muted)",
  borderBottom: "1px solid var(--border-default)",
  padding: "9px 10px",
  whiteSpace: "nowrap",
} as const;

const tdStyle = {
  borderBottom: "1px solid var(--border-default)",
  padding: "8px 10px",
  color: "var(--text-primary)",
  whiteSpace: "nowrap",
  maxWidth: 220,
  overflow: "hidden",
  textOverflow: "ellipsis",
} as const;

const statPill = {
  display: "inline-flex",
  gap: 6,
  alignItems: "center",
  border: "1px solid rgba(34,197,94,.25)",
  background: "rgba(6,95,70,.22)",
  color: "#bbf7d0",
  borderRadius: 999,
  padding: "6px 10px",
  fontSize: 12,
} as const;
