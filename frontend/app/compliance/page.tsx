"use client";

import { useState, useEffect, useCallback } from "react";
import { apiGet, apiPost, apiDelete } from "../lib/api";
import { notify } from "@/lib/toast";

// ─── Tipi ───────────────────────────────────────────────────────────────────

interface Attestato {
  id: number;
  tecnico_id: number;
  tecnico_nome: string;
  tipo_corso: string;
  ente_certificatore?: string;
  data_conseguimento?: string;
  data_scadenza?: string;
  giorni_mancanti?: number | null;
  note?: string;
}

interface TecnicoOption {
  id: number;
  nome: string;
  cognome?: string;
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function scadenzaColor(giorni?: number | null): { bg: string; color: string; label: string } {
  if (giorni === null || giorni === undefined) return { bg: "#1f2937", color: "#94a3b8", label: "Nessuna scadenza" };
  if (giorni < 0) return { bg: "#7f1d1d", color: "#fca5a5", label: `Scaduto ${Math.abs(giorni)}gg fa` };
  if (giorni <= 30) return { bg: "#7f1d1d", color: "#ef4444", label: `${giorni}gg` };
  if (giorni <= 60) return { bg: "#431407", color: "#f97316", label: `${giorni}gg` };
  if (giorni <= 90) return { bg: "#422006", color: "#eab308", label: `${giorni}gg` };
  return { bg: "#052e16", color: "#22c55e", label: `${giorni}gg` };
}

function formatDate(iso?: string): string {
  if (!iso) return "—";
  try { return new Date(iso).toLocaleDateString("it-IT", { day: "2-digit", month: "short", year: "numeric" }); }
  catch { return iso.split("T")[0]; }
}

// ─── Modale aggiunta attestato ───────────────────────────────────────────────

function ModalAggiungiAttestato({
  tecnici,
  onClose,
  onCreated,
}: {
  tecnici: TecnicoOption[];
  onClose: () => void;
  onCreated: () => void;
}) {
  const [form, setForm] = useState({
    tecnico_id: tecnici[0]?.id ?? 0,
    tipo_corso: "",
    ente_certificatore: "",
    data_conseguimento: "",
    data_scadenza: "",
    note: "",
  });
  const [saving, setSaving] = useState(false);

  const upd = (k: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
    setForm(p => ({ ...p, [k]: e.target.value }));

  const save = async () => {
    if (!form.tipo_corso.trim()) { notify.warning("Il tipo corso è obbligatorio"); return; }
    if (!form.tecnico_id) { notify.warning("Seleziona un tecnico"); return; }
    setSaving(true);
    try {
      await apiPost(`/tecnici/${form.tecnico_id}/attestati`, {
        tipo_corso: form.tipo_corso.trim(),
        ente_certificatore: form.ente_certificatore || undefined,
        data_conseguimento: form.data_conseguimento || undefined,
        data_scadenza: form.data_scadenza || undefined,
        note: form.note || undefined,
      });
      notify.success("Attestato aggiunto");
      onCreated();
      onClose();
    } catch (err: any) {
      notify.error(err?.detail ?? "Errore nel salvataggio");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.7)", zIndex: 9998, display: "flex", alignItems: "center", justifyContent: "center" }}
      onClick={onClose}>
      <div style={{ background: "#111827", border: "1px solid #374151", borderRadius: "12px", padding: "28px", width: "90%", maxWidth: "520px", maxHeight: "85vh", overflowY: "auto" }}
        onClick={e => e.stopPropagation()}>
        {/* Header */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "20px" }}>
          <h2 style={{ margin: 0, fontSize: "18px", fontWeight: 700 }}>Nuovo Attestato</h2>
          <button onClick={onClose} style={{ background: "transparent", border: "none", cursor: "pointer", fontSize: "20px", color: "#94a3b8" }}>×</button>
        </div>

        <div style={{ display: "grid", gap: "14px" }}>
          <Field label="Tecnico *">
            <select style={inputSt} value={form.tecnico_id} onChange={e => setForm(p => ({ ...p, tecnico_id: Number(e.target.value) }))}>
              {tecnici.map(t => (
                <option key={t.id} value={t.id}>{t.nome} {t.cognome ?? ""}</option>
              ))}
            </select>
          </Field>
          <Field label="Tipo Corso *">
            <input style={inputSt} value={form.tipo_corso} onChange={upd("tipo_corso")}
              placeholder="Es. Lavori Elettrici PES/PAV, LOTO, Primo Soccorso..." />
          </Field>
          <Field label="Ente Certificatore">
            <input style={inputSt} value={form.ente_certificatore} onChange={upd("ente_certificatore")}
              placeholder="Es. IMQ, BSI, Organismo aziendale" />
          </Field>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px" }}>
            <Field label="Data Conseguimento">
              <input style={inputSt} type="date" value={form.data_conseguimento} onChange={upd("data_conseguimento")} />
            </Field>
            <Field label="Data Scadenza">
              <input style={inputSt} type="date" value={form.data_scadenza} onChange={upd("data_scadenza")} />
            </Field>
          </div>
          <Field label="Note">
            <textarea style={{ ...inputSt, resize: "vertical", minHeight: "60px" }} value={form.note} onChange={upd("note")}
              placeholder="Note aggiuntive..." />
          </Field>
        </div>

        <div style={{ display: "flex", gap: "10px", justifyContent: "flex-end", marginTop: "20px" }}>
          <button style={btnSec} onClick={onClose}>Annulla</button>
          <button style={btnPri} onClick={save} disabled={saving}>{saving ? "Salvo..." : "Aggiungi Attestato"}</button>
        </div>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label style={{ display: "block", fontSize: "11px", color: "#94a3b8", textTransform: "uppercase", letterSpacing: "0.5px", marginBottom: "4px" }}>{label}</label>
      {children}
    </div>
  );
}

const inputSt: React.CSSProperties = {
  width: "100%", padding: "9px 12px", background: "#1f2937", border: "1px solid #374151",
  borderRadius: "6px", color: "#f1f5f9", fontSize: "14px", boxSizing: "border-box",
};
const btnPri: React.CSSProperties = {
  background: "#1d4ed8", color: "#fff", border: "none", borderRadius: "8px",
  padding: "10px 20px", cursor: "pointer", fontSize: "14px", fontWeight: 600,
};
const btnSec: React.CSSProperties = {
  background: "transparent", color: "#f1f5f9", border: "1px solid #374151",
  borderRadius: "8px", padding: "10px 20px", cursor: "pointer", fontSize: "14px",
};

// ─── Pagina Compliance ───────────────────────────────────────────────────────

export default function CompliancePage() {
  const [attestati, setAttestati] = useState<Attestato[]>([]);
  const [tecnici, setTecnici] = useState<TecnicoOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [deletingId, setDeletingId] = useState<number | null>(null);

  const loadAttestati = useCallback(async () => {
    setLoading(true);
    try {
      const data = await apiGet<Attestato[]>("/attestati/scadenze");
      setAttestati(data);
    } catch (err: any) {
      notify.error("Errore nel caricamento degli attestati");
    } finally {
      setLoading(false);
    }
  }, []);

  const loadTecnici = useCallback(async () => {
    try {
      const data = await apiGet<TecnicoOption[]>("/tecnici");
      setTecnici(data);
    } catch { }
  }, []);

  useEffect(() => {
    loadAttestati();
    loadTecnici();
  }, [loadAttestati, loadTecnici]);

  const deleteAttestato = async (att: Attestato) => {
    if (!confirm(`Eliminare l'attestato "${att.tipo_corso}" di ${att.tecnico_nome}?`)) return;
    setDeletingId(att.id);
    try {
      await apiDelete(`/tecnici/${att.tecnico_id}/attestati/${att.id}`);
      notify.success("Attestato eliminato");
      await loadAttestati();
    } catch {
      notify.error("Errore nell'eliminazione");
    } finally {
      setDeletingId(null);
    }
  };

  // Raggruppa per scadenza
  const scaduti = attestati.filter(a => a.giorni_mancanti !== null && a.giorni_mancanti !== undefined && a.giorni_mancanti < 0);
  const critici = attestati.filter(a => a.giorni_mancanti !== null && a.giorni_mancanti !== undefined && a.giorni_mancanti >= 0 && a.giorni_mancanti <= 30);
  const attenzioneBassa = attestati.filter(a => a.giorni_mancanti !== null && a.giorni_mancanti !== undefined && a.giorni_mancanti > 30 && a.giorni_mancanti <= 90);

  return (
    <div style={{ padding: "24px", maxWidth: "1000px", margin: "0 auto" }}>
      {/* Header */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "24px", flexWrap: "wrap", gap: "12px" }}>
        <div>
          <h1 style={{ margin: 0, fontSize: "24px", fontWeight: 800, color: "#f1f5f9" }}>Scadenzario Attestati</h1>
          <div style={{ fontSize: "14px", color: "#64748b", marginTop: "4px" }}>
            Attestati in scadenza nei prossimi 90 giorni · {attestati.length} totale
          </div>
        </div>
        <button style={btnPri} onClick={() => setShowModal(true)}>
          + Aggiungi Attestato
        </button>
      </div>

      {/* Summary cards */}
      {!loading && (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "12px", marginBottom: "24px" }}>
          <SummaryCard label="Scaduti" count={scaduti.length} color="#ef4444" />
          <SummaryCard label="Scadono in 30gg" count={critici.length} color="#f97316" />
          <SummaryCard label="Scadono in 31-90gg" count={attenzioneBassa.length} color="#eab308" />
        </div>
      )}

      {loading && (
        <div style={{ textAlign: "center", padding: "60px", color: "#94a3b8", fontSize: "16px" }}>
          Caricamento...
        </div>
      )}

      {!loading && attestati.length === 0 && (
        <div style={{ textAlign: "center", padding: "60px", background: "#111827", borderRadius: "12px", border: "1px solid #1f2937" }}>
          <div style={{ fontSize: "40px", marginBottom: "12px" }}>📋</div>
          <div style={{ fontSize: "18px", color: "#94a3b8", marginBottom: "8px" }}>Nessun attestato in scadenza</div>
          <div style={{ fontSize: "14px", color: "#64748b", marginBottom: "20px" }}>
            Gli attestati che scadono nei prossimi 90 giorni appariranno qui
          </div>
          <button style={btnPri} onClick={() => setShowModal(true)}>Aggiungi primo attestato</button>
        </div>
      )}

      {!loading && attestati.length > 0 && (
        <div style={{ background: "#111827", borderRadius: "12px", border: "1px solid #1f2937", overflow: "hidden" }}>
          {/* Intestazione tabella */}
          <div style={{ display: "grid", gridTemplateColumns: "2fr 2fr 2fr 1fr 1fr 80px", gap: "12px", padding: "12px 16px", background: "#0f172a", borderBottom: "1px solid #1f2937", fontSize: "11px", color: "#64748b", textTransform: "uppercase", letterSpacing: "0.5px" }}>
            <div>Tecnico</div>
            <div>Tipo Corso</div>
            <div>Ente</div>
            <div>Conseguimento</div>
            <div>Scadenza</div>
            <div>Giorni</div>
          </div>

          {attestati.map(a => {
            const sc = scadenzaColor(a.giorni_mancanti);
            return (
              <div key={a.id} style={{ display: "grid", gridTemplateColumns: "2fr 2fr 2fr 1fr 1fr 80px", gap: "12px", padding: "13px 16px", borderBottom: "1px solid #1f2937", alignItems: "center", fontSize: "14px" }}>
                <div style={{ fontWeight: 600, color: "#e2e8f0" }}>{a.tecnico_nome}</div>
                <div style={{ color: "#cbd5e1" }}>{a.tipo_corso}</div>
                <div style={{ color: "#94a3b8", fontSize: "13px" }}>{a.ente_certificatore ?? "—"}</div>
                <div style={{ color: "#94a3b8", fontSize: "13px" }}>{formatDate(a.data_conseguimento)}</div>
                <div style={{ color: "#cbd5e1", fontSize: "13px" }}>{formatDate(a.data_scadenza)}</div>
                <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                  <span style={{
                    background: sc.bg,
                    color: sc.color,
                    borderRadius: "999px",
                    padding: "3px 8px",
                    fontSize: "12px",
                    fontWeight: 700,
                    whiteSpace: "nowrap",
                  }}>
                    {sc.label}
                  </span>
                  <button
                    onClick={() => deleteAttestato(a)}
                    disabled={deletingId === a.id}
                    style={{ background: "transparent", border: "none", cursor: "pointer", color: "#64748b", fontSize: "16px", padding: "2px 4px", borderRadius: "4px" }}
                    title="Elimina attestato"
                  >
                    🗑
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {showModal && (
        <ModalAggiungiAttestato
          tecnici={tecnici}
          onClose={() => setShowModal(false)}
          onCreated={loadAttestati}
        />
      )}
    </div>
  );
}

function SummaryCard({ label, count, color }: { label: string; count: number; color: string }) {
  return (
    <div style={{ background: "#111827", border: `1px solid ${color}44`, borderRadius: "10px", padding: "16px", textAlign: "center" }}>
      <div style={{ fontSize: "28px", fontWeight: 800, color }}>{count}</div>
      <div style={{ fontSize: "13px", color: "#94a3b8", marginTop: "4px" }}>{label}</div>
    </div>
  );
}
