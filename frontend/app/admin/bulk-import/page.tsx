"use client";

import { useRef, useState } from "react";
import { apiGet } from "../../lib/api";
import { notify } from "../../../lib/toast";

const API_BASE = process.env.NEXT_PUBLIC_API_BASE ?? "http://localhost:8000";

// ── Helpers API con token ────────────────────────────────────────────────────

function getToken(): string | null {
  try {
    return localStorage.getItem("token") ?? sessionStorage.getItem("token");
  } catch {
    return null;
  }
}

async function apiFetch<T>(path: string, options: RequestInit): Promise<T> {
  const token = getToken();
  const res = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(options.headers ?? {}),
    },
  });
  if (!res.ok) {
    let msg = `HTTP ${res.status}`;
    try {
      const err = await res.json();
      msg = err?.detail?.message ?? err?.detail ?? err?.message ?? msg;
    } catch { /* skip */ }
    throw new Error(msg);
  }
  return res.json();
}

// ── Tipi ─────────────────────────────────────────────────────────────────────

interface PreviewResult {
  valid: boolean;
  errors: string[];
  counts: { siti: number; impianti: number; asset: number };
  preview: {
    siti: Record<string, string>[];
    impianti: Record<string, string>[];
    asset: Record<string, string>[];
  };
}

interface ImportResult {
  success: boolean;
  message: string;
  stats: {
    siti_creati: number;
    siti_esistenti: number;
    impianti_creati: number;
    impianti_esistenti: number;
    asset_creati: number;
  };
}

interface Tenant {
  id: number;
  nome: string;
  slug: string;
  is_active: boolean;
}

// ── Componente step ──────────────────────────────────────────────────────────

function StepBadge({ n, label, active, done }: { n: number; label: string; active: boolean; done: boolean }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
      <div style={{
        width: 28, height: 28,
        borderRadius: "50%",
        background: done ? "#065f46" : active ? "#1d4ed8" : "#1f2937",
        border: `2px solid ${done ? "#059669" : active ? "#3b82f6" : "#374151"}`,
        display: "flex", alignItems: "center", justifyContent: "center",
        fontSize: 12, fontWeight: 700,
        color: done ? "#86efac" : active ? "#93c5fd" : "#4b5563",
        flexShrink: 0,
      }}>
        {done ? "✓" : n}
      </div>
      <span style={{
        fontSize: 12, fontWeight: active || done ? 600 : 400,
        color: active ? "#e2e8f0" : done ? "#86efac" : "#4b5563",
      }}>{label}</span>
    </div>
  );
}

function PreviewTable({ rows, title }: { rows: Record<string, string>[]; title: string }) {
  if (!rows.length) return null;
  const cols = Object.keys(rows[0]).filter(k => k !== "_row");
  return (
    <div style={{ marginBottom: 16 }}>
      <div style={{ fontSize: 11, fontWeight: 700, color: "#9ca3af", marginBottom: 6, textTransform: "uppercase" }}>
        {title} — prime {rows.length} righe
      </div>
      <div style={{ overflowX: "auto" }}>
        <table style={{ borderCollapse: "collapse", width: "100%", fontSize: 11 }}>
          <thead>
            <tr>
              {cols.map(c => (
                <th key={c} style={{
                  background: "#1e293b", color: "#9ca3af",
                  padding: "5px 10px", textAlign: "left",
                  border: "1px solid #1f2937", whiteSpace: "nowrap",
                  fontWeight: 700, fontSize: 10, textTransform: "uppercase",
                }}>{c}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, i) => (
              <tr key={i} style={{ background: i % 2 === 0 ? "#0f172a" : "#0a0f1e" }}>
                {cols.map(c => (
                  <td key={c} style={{
                    padding: "5px 10px",
                    border: "1px solid #111827",
                    color: row[c] ? "#e2e8f0" : "#374151",
                    whiteSpace: "nowrap",
                    maxWidth: 200, overflow: "hidden", textOverflow: "ellipsis",
                  }}>
                    {row[c] ?? "—"}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ── Pagina principale ────────────────────────────────────────────────────────

export default function BulkImportPage() {
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [tenants, setTenants] = useState<Tenant[]>([]);
  const [tenantId, setTenantId] = useState<number | null>(null);
  const [loadingTenants, setLoadingTenants] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [previewing, setPreviewing] = useState(false);
  const [preview, setPreview] = useState<PreviewResult | null>(null);
  const [importing, setImporting] = useState(false);
  const [result, setResult] = useState<ImportResult | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  // Carica tenants al mount
  async function loadTenants() {
    setLoadingTenants(true);
    try {
      const data = await apiFetch<Tenant[]>("/tenants", { method: "GET" });
      setTenants(data);
    } catch (e: unknown) {
      notify.error(e instanceof Error ? e.message : "Errore caricamento tenant");
    } finally {
      setLoadingTenants(false);
    }
  }

  // Step 1 → 2
  function goStep2() {
    loadTenants();
    setStep(2);
  }

  // Download template
  async function downloadTemplate() {
    const token = getToken();
    try {
      const res = await fetch(`${API_BASE}/admin/bulk-import/template`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      if (!res.ok) {
        let msg = `Errore ${res.status}`;
        try { const e = await res.json(); msg = e?.detail?.message ?? e?.detail ?? msg; } catch { /* skip */ }
        notify.error(`Errore download template: ${msg}`);
        return;
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "maintai_bulk_import_template.xlsx";
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      notify.success("Template scaricato");
    } catch (err) {
      notify.error(`Errore download template: ${err instanceof Error ? err.message : "rete non raggiungibile"}`);
    }
  }

  // Preview
  async function runPreview() {
    if (!file || !tenantId) return;
    setPreviewing(true);
    setPreview(null);
    try {
      const fd = new FormData();
      fd.append("file", file);
      fd.append("tenant_id", String(tenantId));
      const res = await apiFetch<PreviewResult>("/admin/bulk-import/preview", {
        method: "POST",
        body: fd,
      });
      setPreview(res);
      if (res.valid) {
        setStep(3);
      }
    } catch (e: unknown) {
      notify.error(e instanceof Error ? e.message : "Errore anteprima");
    } finally {
      setPreviewing(false);
    }
  }

  // Execute import
  async function runImport() {
    if (!file || !tenantId || !preview?.valid) return;
    setImporting(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      fd.append("tenant_id", String(tenantId));
      const res = await apiFetch<ImportResult>("/admin/bulk-import/execute", {
        method: "POST",
        body: fd,
      });
      setResult(res);
      notify.success(res.message);
    } catch (e: unknown) {
      notify.error(e instanceof Error ? e.message : "Errore import");
    } finally {
      setImporting(false);
    }
  }

  const selectedTenant = tenants.find(t => t.id === tenantId);

  return (
    <div style={{
      background: "#0a0f1e",
      minHeight: "100vh",
      padding: "32px 24px",
      color: "#f9fafb",
      fontFamily: "var(--font-body, system-ui)",
    }}>
      {/* ── Header ──────────────────────────────────────────────────────────── */}
      <div style={{ marginBottom: 32 }}>
        <div style={{ fontSize: 22, fontWeight: 800, color: "#f9fafb", letterSpacing: "-0.5px" }}>
          📥 Import Massivo — Siti / Impianti / Asset
        </div>
        <div style={{ fontSize: 13, color: "#6b7280", marginTop: 4 }}>
          Solo superadmin · Caricamento da file Excel con validazione preventiva
        </div>
      </div>

      {/* ── Stepper ─────────────────────────────────────────────────────────── */}
      <div style={{
        display: "flex", gap: 24, marginBottom: 32,
        background: "#111827", border: "1px solid #1f2937",
        borderRadius: 10, padding: "16px 24px",
        alignItems: "center", flexWrap: "wrap",
      }}>
        <StepBadge n={1} label="Template" active={step === 1} done={step > 1} />
        <div style={{ color: "#374151", fontSize: 18 }}>›</div>
        <StepBadge n={2} label="Carica & Seleziona Tenant" active={step === 2} done={step > 2} />
        <div style={{ color: "#374151", fontSize: 18 }}>›</div>
        <StepBadge n={3} label="Anteprima & Conferma" active={step === 3} done={!!result} />
      </div>

      {/* ══ STEP 1: Download template ════════════════════════════════════════ */}
      {step === 1 && (
        <div style={{ maxWidth: 640 }}>
          <div style={{
            background: "#111827", border: "1px solid #1f2937",
            borderRadius: 12, padding: 28,
          }}>
            <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 12 }}>
              1. Scarica il template Excel
            </div>
            <p style={{ fontSize: 13, color: "#9ca3af", lineHeight: 1.6, marginBottom: 20 }}>
              Il file contiene tre fogli: <strong style={{ color: "#e2e8f0" }}>SITI</strong>,{" "}
              <strong style={{ color: "#e2e8f0" }}>IMPIANTI</strong> e{" "}
              <strong style={{ color: "#e2e8f0" }}>ASSET</strong>.{" "}
              Le colonne con sfondo <span style={{ background: "#FFD700", color: "#000", padding: "0 4px", borderRadius: 2, fontWeight: 700 }}>giallo</span> sono obbligatorie.
              Le colonne grigie sono opzionali. La riga 6 è un esempio da modificare o eliminare.
            </p>

            <div style={{ display: "flex", flexDirection: "column", gap: 10, marginBottom: 24 }}>
              {[
                { label: "SITI", desc: "nome*  |  descrizione, ubicazione, città, paese, responsabile, contatti, note", color: "#1F78D1" },
                { label: "IMPIANTI", desc: "nome*, sito_nome*  |  tipologia, descrizione, lat/lon, note", color: "#28A745" },
                { label: "ASSET", desc: "nome*, area*, impianto_nome*  |  codice, marca, modello, matricola, criticità, vincoli meteo, …", color: "#E67E22" },
              ].map(({ label, desc, color }) => (
                <div key={label} style={{
                  display: "flex", gap: 12, alignItems: "flex-start",
                  background: "#0f172a", border: "1px solid #1e293b",
                  borderRadius: 8, padding: "10px 14px",
                }}>
                  <span style={{
                    background: color, color: "#fff", fontWeight: 700,
                    fontSize: 11, padding: "2px 8px", borderRadius: 4,
                    flexShrink: 0, minWidth: 80, textAlign: "center",
                  }}>{label}</span>
                  <span style={{ fontSize: 12, color: "#6b7280" }}>{desc}</span>
                </div>
              ))}
            </div>

            <div style={{ display: "flex", gap: 12 }}>
              <button
                onClick={downloadTemplate}
                style={{
                  background: "linear-gradient(135deg,#065f46,#047857)",
                  border: "1px solid #059669",
                  color: "#86efac", borderRadius: 8,
                  padding: "11px 22px", fontSize: 13, fontWeight: 700,
                  cursor: "pointer", display: "flex", alignItems: "center", gap: 8,
                }}
              >
                ⬇ Scarica Template Excel
              </button>
              <button
                onClick={goStep2}
                style={{
                  background: "#1d4ed8", border: "1px solid #2563eb",
                  color: "#fff", borderRadius: 8,
                  padding: "11px 22px", fontSize: 13, fontWeight: 700,
                  cursor: "pointer",
                }}
              >
                Ho già il file →
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ══ STEP 2: Selezione tenant + upload ════════════════════════════════ */}
      {step === 2 && (
        <div style={{ maxWidth: 680 }}>
          <div style={{
            background: "#111827", border: "1px solid #1f2937",
            borderRadius: 12, padding: 28,
          }}>
            <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 20 }}>
              2. Seleziona il tenant e carica il file
            </div>

            {/* Selezione tenant */}
            <div style={{ marginBottom: 20 }}>
              <label style={{ fontSize: 11, color: "#9ca3af", display: "block", marginBottom: 6, fontWeight: 600 }}>
                TENANT DESTINATARIO *
              </label>
              {loadingTenants ? (
                <div style={{ color: "#6b7280", fontSize: 13 }}>Caricamento tenant…</div>
              ) : (
                <select
                  value={tenantId ?? ""}
                  onChange={e => setTenantId(Number(e.target.value) || null)}
                  style={{
                    width: "100%", background: "#1f2937", border: "1px solid #374151",
                    color: "#f9fafb", borderRadius: 8, padding: "10px 12px",
                    fontSize: 13,
                  }}
                >
                  <option value="">— seleziona tenant —</option>
                  {tenants.map(t => (
                    <option key={t.id} value={t.id}>
                      {t.nome} ({t.slug}) {!t.is_active ? " [INATTIVO]" : ""}
                    </option>
                  ))}
                </select>
              )}
            </div>

            {/* Upload file */}
            <div style={{ marginBottom: 24 }}>
              <label style={{ fontSize: 11, color: "#9ca3af", display: "block", marginBottom: 6, fontWeight: 600 }}>
                FILE EXCEL (.xlsx) *
              </label>
              <div
                onClick={() => fileRef.current?.click()}
                style={{
                  border: `2px dashed ${file ? "#059669" : "#374151"}`,
                  borderRadius: 10,
                  padding: "28px 20px",
                  textAlign: "center",
                  cursor: "pointer",
                  background: file ? "#052e1644" : "#0f172a",
                  transition: "border-color 150ms",
                }}
              >
                <input
                  ref={fileRef}
                  type="file"
                  accept=".xlsx"
                  style={{ display: "none" }}
                  onChange={e => {
                    const f = e.target.files?.[0];
                    if (f) { setFile(f); setPreview(null); setResult(null); }
                  }}
                />
                {file ? (
                  <div>
                    <div style={{ fontSize: 24, marginBottom: 6 }}>📊</div>
                    <div style={{ fontSize: 13, fontWeight: 600, color: "#86efac" }}>{file.name}</div>
                    <div style={{ fontSize: 11, color: "#6b7280", marginTop: 4 }}>
                      {(file.size / 1024).toFixed(1)} KB · Clicca per sostituire
                    </div>
                  </div>
                ) : (
                  <div>
                    <div style={{ fontSize: 24, marginBottom: 6 }}>📂</div>
                    <div style={{ fontSize: 13, color: "#6b7280" }}>Clicca per selezionare il file .xlsx</div>
                    <div style={{ fontSize: 11, color: "#374151", marginTop: 4 }}>oppure trascina qui</div>
                  </div>
                )}
              </div>
            </div>

            <div style={{ display: "flex", gap: 12 }}>
              <button
                onClick={() => setStep(1)}
                style={{
                  background: "#1f2937", border: "1px solid #374151",
                  color: "#9ca3af", borderRadius: 8, padding: "10px 18px",
                  fontSize: 13, cursor: "pointer",
                }}
              >← Indietro</button>
              <button
                onClick={runPreview}
                disabled={!file || !tenantId || previewing}
                style={{
                  background: !file || !tenantId ? "#1f2937" : "linear-gradient(135deg,#1d4ed8,#7c3aed)",
                  border: "1px solid #374151",
                  color: !file || !tenantId ? "#4b5563" : "#fff",
                  borderRadius: 8, padding: "10px 20px",
                  fontSize: 13, fontWeight: 700,
                  cursor: !file || !tenantId ? "not-allowed" : "pointer",
                  boxShadow: file && tenantId ? "0 0 14px rgba(99,102,241,0.3)" : "none",
                }}
              >
                {previewing ? "Validazione…" : "Valida e Anteprima →"}
              </button>
            </div>

            {/* Errori validazione */}
            {preview && !preview.valid && (
              <div style={{
                marginTop: 20, background: "#7f1d1d22",
                border: "1px solid #ef444433", borderRadius: 8, padding: 16,
              }}>
                <div style={{ fontSize: 13, fontWeight: 700, color: "#fca5a5", marginBottom: 8 }}>
                  ✗ {preview.errors.length} errori trovati — correggere il file prima di procedere
                </div>
                <div style={{ maxHeight: 200, overflowY: "auto" }}>
                  {preview.errors.map((e, i) => (
                    <div key={i} style={{ fontSize: 12, color: "#fca5a5", marginBottom: 3 }}>• {e}</div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ══ STEP 3: Anteprima + conferma ══════════════════════════════════════ */}
      {step === 3 && preview && !result && (
        <div style={{ maxWidth: 900 }}>
          <div style={{
            background: "#111827", border: "1px solid #1f2937",
            borderRadius: 12, padding: 28,
          }}>
            <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 4 }}>
              3. Anteprima — Verifica prima di importare
            </div>
            <div style={{ fontSize: 12, color: "#6b7280", marginBottom: 20 }}>
              Tenant: <strong style={{ color: "#60a5fa" }}>{selectedTenant?.nome ?? tenantId}</strong>
            </div>

            {/* Contatori */}
            <div style={{ display: "flex", gap: 12, marginBottom: 24, flexWrap: "wrap" }}>
              {[
                { label: "Siti da creare", val: preview.counts.siti, color: "#1F78D1" },
                { label: "Impianti da creare", val: preview.counts.impianti, color: "#28A745" },
                { label: "Asset da creare", val: preview.counts.asset, color: "#E67E22" },
              ].map(({ label, val, color }) => (
                <div key={label} style={{
                  background: "#0f172a", border: `1px solid ${color}44`,
                  borderRadius: 8, padding: "12px 20px", textAlign: "center", minWidth: 130,
                }}>
                  <div style={{ fontSize: 28, fontWeight: 800, color }}>{val}</div>
                  <div style={{ fontSize: 11, color: "#6b7280", marginTop: 2 }}>{label}</div>
                </div>
              ))}
              <div style={{
                background: "#052e1644", border: "1px solid #05966944",
                borderRadius: 8, padding: "12px 20px", textAlign: "center", minWidth: 130,
              }}>
                <div style={{ fontSize: 28, fontWeight: 800, color: "#22c55e" }}>
                  {preview.counts.siti + preview.counts.impianti + preview.counts.asset}
                </div>
                <div style={{ fontSize: 11, color: "#6b7280", marginTop: 2 }}>Totale record</div>
              </div>
            </div>

            {/* Tabelle anteprima */}
            <PreviewTable rows={preview.preview.siti} title="SITI" />
            <PreviewTable rows={preview.preview.impianti} title="IMPIANTI" />
            <PreviewTable rows={preview.preview.asset} title="ASSET" />

            {preview.counts.siti + preview.counts.impianti + preview.counts.asset > 5 && (
              <div style={{ fontSize: 11, color: "#374151", marginBottom: 20, textAlign: "center" }}>
                Vengono mostrate le prime 5 righe per foglio — il file completo verrà importato alla conferma
              </div>
            )}

            {/* Avviso */}
            <div style={{
              background: "#1e3a0a33", border: "1px solid #365314",
              borderRadius: 8, padding: "10px 14px", marginBottom: 20, fontSize: 12, color: "#a3e635",
            }}>
              ℹ Siti e impianti con lo stesso nome già esistenti nel tenant NON verranno duplicati — verranno usati quelli esistenti.
              Gli asset vengono sempre creati nuovi.
            </div>

            <div style={{ display: "flex", gap: 12 }}>
              <button
                onClick={() => { setStep(2); setPreview(null); }}
                style={{
                  background: "#1f2937", border: "1px solid #374151",
                  color: "#9ca3af", borderRadius: 8, padding: "10px 18px",
                  fontSize: 13, cursor: "pointer",
                }}
              >← Modifica file</button>
              <button
                onClick={runImport}
                disabled={importing}
                style={{
                  background: importing ? "#1f2937" : "linear-gradient(135deg,#065f46,#047857)",
                  border: "1px solid #059669",
                  color: importing ? "#4b5563" : "#86efac",
                  borderRadius: 8, padding: "11px 24px",
                  fontSize: 13, fontWeight: 700,
                  cursor: importing ? "not-allowed" : "pointer",
                  boxShadow: importing ? "none" : "0 0 14px rgba(5,150,105,0.3)",
                }}
              >
                {importing ? "Import in corso…" : "✓ Conferma Import"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ══ Risultato import ══════════════════════════════════════════════════ */}
      {result && (
        <div style={{ maxWidth: 640 }}>
          <div style={{
            background: "#052e1644",
            border: "2px solid #059669",
            borderRadius: 12, padding: 32,
            textAlign: "center",
          }}>
            <div style={{ fontSize: 48, marginBottom: 12 }}>✅</div>
            <div style={{ fontSize: 17, fontWeight: 800, color: "#86efac", marginBottom: 8 }}>
              Import completato con successo
            </div>
            <div style={{ fontSize: 13, color: "#6ee7b7", marginBottom: 24 }}>{result.message}</div>

            <div style={{ display: "flex", gap: 12, justifyContent: "center", flexWrap: "wrap" }}>
              {[
                { label: "Siti creati", val: result.stats.siti_creati, color: "#1F78D1" },
                { label: "Siti esistenti", val: result.stats.siti_esistenti, color: "#374151" },
                { label: "Impianti creati", val: result.stats.impianti_creati, color: "#28A745" },
                { label: "Impianti esistenti", val: result.stats.impianti_esistenti, color: "#374151" },
                { label: "Asset creati", val: result.stats.asset_creati, color: "#E67E22" },
              ].map(({ label, val, color }) => (
                <div key={label} style={{
                  background: "#0f172a", borderRadius: 8, padding: "10px 16px", textAlign: "center",
                }}>
                  <div style={{ fontSize: 22, fontWeight: 800, color }}>{val}</div>
                  <div style={{ fontSize: 10, color: "#6b7280" }}>{label}</div>
                </div>
              ))}
            </div>

            <button
              onClick={() => { setStep(1); setFile(null); setPreview(null); setResult(null); setTenantId(null); }}
              style={{
                marginTop: 24,
                background: "#1f2937", border: "1px solid #374151",
                color: "#9ca3af", borderRadius: 8, padding: "10px 20px",
                fontSize: 13, cursor: "pointer",
              }}
            >
              Nuovo import
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
