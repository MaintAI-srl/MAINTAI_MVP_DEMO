"use client";

import { useState, useEffect, useCallback } from "react";
import { apiGet, apiPost, apiPut, apiDelete } from "../lib/api";
import StatusToggle from "../components/StatusToggle";

// ─── Types ───────────────────────────────────────────────────────────────────

interface AssetNode {
  id: number; nome: string; codice?: string; stato: string;
  criticita: string; area?: string; marca?: string; modello?: string;
}
interface ImpiantoNode {
  id: number; nome: string; tipologia?: string; note?: string;
  sito_id?: number; sito_nome?: string; descrizione?: string;
  assets: AssetNode[]; n_asset: number; ticket_aperti: number;
}
interface SitoNode {
  id: number; nome: string; descrizione?: string; ubicazione?: string;
  citta?: string; paese?: string; responsabile?: string;
  telefono_responsabile?: string; email_responsabile?: string; note?: string;
  impianti: ImpiantoNode[]; n_impianti: number; n_asset_totali: number;
  ticket_aperti: number; asset_critici: number;
}
interface AssetDetail {
  id: number; nome: string; codice?: string; area?: string; stato: string;
  criticita: string; descrizione?: string; impianto_id?: number;
  impianto_nome?: string; sito_id?: number; sito_nome?: string;
  marca?: string; modello?: string; matricola?: string; numero_serie?: string;
  fornitore?: string; anno_installazione?: number; anno_produzione?: number;
  data_acquisto?: string; data_scadenza_garanzia?: string;
  vincoli_operativi?: string; vincoli_manutenzione?: string; note_tecniche?: string;
  posizione_fisica?: string; piani_manutenzione?: PianoItem[]; tickets?: TicketItem[];
}
interface PianoItem { id: number; descrizione: string; frequenza_giorni: number; durata_ore: number; priorita: string; prossima_scadenza?: string; }
interface TicketItem { id: number; titolo: string; stato: string; priorita: string; tipo: string; created_at?: string; }
type SelectionType = "sito" | "impianto" | "asset" | null;

// ─── Chips & helpers ──────────────────────────────────────────────────────────

function CriticitaChip({ valore }: { valore: string }) {
  const map: Record<string, string> = { bassa: "var(--green)", media: "var(--amber)", alta: "#f97316", critica: "var(--red)" };
  const color = map[valore] || "var(--text-secondary)";
  return (
    <span style={{ background: color + "22", color, border: `1px solid ${color}55`, borderRadius: "999px", padding: "2px 10px", fontSize: "11px", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.5px" }}>
      {valore}
    </span>
  );
}
function StatoChip({ stato }: { stato: string }) {
  const map: Record<string, string> = { service: "var(--green)", "out of service": "var(--red)", stopped: "var(--amber)" };
  const color = map[stato] || "var(--text-secondary)";
  return (
    <span style={{ background: color + "22", color, border: `1px solid ${color}55`, borderRadius: "999px", padding: "2px 10px", fontSize: "11px", fontWeight: 600 }}>
      {stato}
    </span>
  );
}
function DetailRow({ label, value }: { label: string; value?: string | number | null }) {
  if (!value && value !== 0) return null;
  return (
    <div style={{ display: "flex", gap: "8px", padding: "6px 0", borderBottom: "1px solid var(--border)" }}>
      <span style={{ color: "var(--text-secondary)", fontSize: "12px", minWidth: "180px", flexShrink: 0 }}>{label}</span>
      <span style={{ fontSize: "13px", fontWeight: 500 }}>{value}</span>
    </div>
  );
}
function StatBox({ label, value, color }: { label: string; value: number | string; color?: string }) {
  return (
    <div style={{ background: "var(--bg-elevated)", border: "1px solid var(--border)", borderRadius: "8px", padding: "12px 16px", textAlign: "center", minWidth: "90px" }}>
      <div style={{ fontSize: "22px", fontWeight: 700, color: color || "var(--blue)" }}>{value}</div>
      <div style={{ fontSize: "11px", color: "var(--text-secondary)", marginTop: "2px" }}>{label}</div>
    </div>
  );
}

// ─── Modal primitives ─────────────────────────────────────────────────────────

function ModalOverlay({ onClose, children }: { onClose: () => void; children: React.ReactNode }) {
  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.65)", zIndex: 1000, display: "flex", alignItems: "center", justifyContent: "center" }} onClick={onClose}>
      <div style={{ background: "var(--bg-surface)", border: "1px solid var(--border-strong)", borderRadius: "12px", padding: "28px", minWidth: "480px", maxWidth: "600px", width: "90%", maxHeight: "85vh", overflowY: "auto" }} onClick={e => e.stopPropagation()}>
        {children}
      </div>
    </div>
  );
}
function ModalTitle({ children, onClose }: { children: React.ReactNode; onClose: () => void }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "20px" }}>
      <h2 style={{ margin: 0, fontSize: "18px", fontWeight: 700 }}>{children}</h2>
      <button onClick={onClose} style={{ background: "transparent", border: "none", cursor: "pointer", fontSize: "18px", color: "var(--text-secondary)" }}>×</button>
    </div>
  );
}
function FormField({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: "14px" }}>
      <label style={{ display: "block", fontSize: "12px", color: "var(--text-secondary)", marginBottom: "4px", textTransform: "uppercase", letterSpacing: "0.5px" }}>{label}</label>
      {children}
    </div>
  );
}
const inputStyle: React.CSSProperties = { width: "100%", padding: "8px 12px", background: "var(--bg-elevated)", border: "1px solid var(--border-strong)", borderRadius: "6px", color: "var(--text-primary)", fontSize: "13px", boxSizing: "border-box" };
const btnPrimary: React.CSSProperties = { background: "var(--blue)", color: "#fff", border: "none", borderRadius: "6px", padding: "9px 18px", cursor: "pointer", fontSize: "13px", fontWeight: 600 };
const btnSecondary: React.CSSProperties = { background: "transparent", color: "var(--text-primary)", border: "1px solid var(--border-strong)", borderRadius: "6px", padding: "9px 18px", cursor: "pointer", fontSize: "13px" };
const btnDanger: React.CSSProperties = { background: "var(--red-dim)", color: "var(--red)", border: "1px solid var(--red)", borderRadius: "6px", padding: "9px 18px", cursor: "pointer", fontSize: "13px", fontWeight: 600 };

// ─── Modal Conferma Eliminazione ──────────────────────────────────────────────

function ModalConferma({ titolo, messaggio, onClose, onConferma }: {
  titolo: string; messaggio: string; onClose: () => void; onConferma: () => void;
}) {
  const [deleting, setDeleting] = useState(false);
  const conferma = async () => { setDeleting(true); await onConferma(); };
  return (
    <ModalOverlay onClose={onClose}>
      <ModalTitle onClose={onClose}>{titolo}</ModalTitle>
      <div style={{ color: "var(--text-secondary)", fontSize: "14px", marginBottom: "24px", lineHeight: 1.6 }}>{messaggio}</div>
      <div style={{ display: "flex", gap: "10px", justifyContent: "flex-end" }}>
        <button style={btnSecondary} onClick={onClose}>Annulla</button>
        <button style={btnDanger} onClick={conferma} disabled={deleting}>{deleting ? "Eliminando..." : "Elimina"}</button>
      </div>
    </ModalOverlay>
  );
}

// ─── Modal Nuovo Sito ─────────────────────────────────────────────────────────

function ModalNuovoSito({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const [form, setForm] = useState({ nome: "", descrizione: "", ubicazione: "", citta: "", paese: "Italia", responsabile: "", telefono_responsabile: "", email_responsabile: "", note: "" });
  const [saving, setSaving] = useState(false);
  const save = async () => { if (!form.nome.trim()) return; setSaving(true); try { await apiPost("/siti", form); onCreated(); onClose(); } catch { } finally { setSaving(false); } };
  const upd = (k: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setForm(p => ({ ...p, [k]: e.target.value }));
  return (
    <ModalOverlay onClose={onClose}>
      <ModalTitle onClose={onClose}>Nuovo Sito</ModalTitle>
      <FormField label="Nome *"><input style={inputStyle} value={form.nome} onChange={upd("nome")} placeholder="Es. Stabilimento Nord" /></FormField>
      <FormField label="Descrizione"><textarea style={{ ...inputStyle, resize: "vertical", minHeight: "60px" }} value={form.descrizione} onChange={upd("descrizione")} /></FormField>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px" }}>
        <FormField label="Ubicazione"><input style={inputStyle} value={form.ubicazione} onChange={upd("ubicazione")} /></FormField>
        <FormField label="Citta'"><input style={inputStyle} value={form.citta} onChange={upd("citta")} /></FormField>
        <FormField label="Paese"><input style={inputStyle} value={form.paese} onChange={upd("paese")} /></FormField>
        <FormField label="Responsabile"><input style={inputStyle} value={form.responsabile} onChange={upd("responsabile")} /></FormField>
        <FormField label="Telefono"><input style={inputStyle} value={form.telefono_responsabile} onChange={upd("telefono_responsabile")} /></FormField>
        <FormField label="Email"><input style={inputStyle} value={form.email_responsabile} onChange={upd("email_responsabile")} /></FormField>
      </div>
      <FormField label="Note"><textarea style={{ ...inputStyle, resize: "vertical", minHeight: "60px" }} value={form.note} onChange={upd("note")} /></FormField>
      <div style={{ display: "flex", gap: "10px", justifyContent: "flex-end", marginTop: "8px" }}>
        <button style={btnSecondary} onClick={onClose}>Annulla</button>
        <button style={btnPrimary} onClick={save} disabled={saving}>{saving ? "Salvo..." : "Crea Sito"}</button>
      </div>
    </ModalOverlay>
  );
}

// ─── Modal Modifica Sito ──────────────────────────────────────────────────────

function ModalModificaSito({ sito, onClose, onSaved }: { sito: SitoNode; onClose: () => void; onSaved: () => void }) {
  const [form, setForm] = useState({ nome: sito.nome || "", descrizione: sito.descrizione || "", ubicazione: sito.ubicazione || "", citta: sito.citta || "", paese: sito.paese || "Italia", responsabile: sito.responsabile || "", telefono_responsabile: sito.telefono_responsabile || "", email_responsabile: sito.email_responsabile || "", note: sito.note || "" });
  const [saving, setSaving] = useState(false);
  const save = async () => { setSaving(true); try { await apiPut(`/siti/${sito.id}`, form); onSaved(); onClose(); } catch { } finally { setSaving(false); } };
  const upd = (k: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setForm(p => ({ ...p, [k]: e.target.value }));
  return (
    <ModalOverlay onClose={onClose}>
      <ModalTitle onClose={onClose}>Modifica Sito — {sito.nome}</ModalTitle>
      <FormField label="Nome *"><input style={inputStyle} value={form.nome} onChange={upd("nome")} /></FormField>
      <FormField label="Descrizione"><textarea style={{ ...inputStyle, resize: "vertical", minHeight: "60px" }} value={form.descrizione} onChange={upd("descrizione")} /></FormField>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px" }}>
        <FormField label="Ubicazione"><input style={inputStyle} value={form.ubicazione} onChange={upd("ubicazione")} /></FormField>
        <FormField label="Citta'"><input style={inputStyle} value={form.citta} onChange={upd("citta")} /></FormField>
        <FormField label="Paese"><input style={inputStyle} value={form.paese} onChange={upd("paese")} /></FormField>
        <FormField label="Responsabile"><input style={inputStyle} value={form.responsabile} onChange={upd("responsabile")} /></FormField>
        <FormField label="Telefono"><input style={inputStyle} value={form.telefono_responsabile} onChange={upd("telefono_responsabile")} /></FormField>
        <FormField label="Email"><input style={inputStyle} value={form.email_responsabile} onChange={upd("email_responsabile")} /></FormField>
      </div>
      <FormField label="Note"><textarea style={{ ...inputStyle, resize: "vertical", minHeight: "60px" }} value={form.note} onChange={upd("note")} /></FormField>
      <div style={{ display: "flex", gap: "10px", justifyContent: "flex-end", marginTop: "8px" }}>
        <button style={btnSecondary} onClick={onClose}>Annulla</button>
        <button style={btnPrimary} onClick={save} disabled={saving}>{saving ? "Salvo..." : "Salva"}</button>
      </div>
    </ModalOverlay>
  );
}

// ─── Modal Nuovo Impianto ─────────────────────────────────────────────────────

function ModalNuovoImpianto({ sitoId, sitoNome, onClose, onCreated }: { sitoId: number; sitoNome: string; onClose: () => void; onCreated: () => void }) {
  const [form, setForm] = useState({ nome: "", tipologia: "", descrizione: "", note: "" });
  const [saving, setSaving] = useState(false);
  const save = async () => { if (!form.nome.trim()) return; setSaving(true); try { await apiPost("/impianti", { ...form, sito_id: sitoId }); onCreated(); onClose(); } catch { } finally { setSaving(false); } };
  const upd = (k: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setForm(p => ({ ...p, [k]: e.target.value }));
  return (
    <ModalOverlay onClose={onClose}>
      <ModalTitle onClose={onClose}>Nuovo Impianto — {sitoNome}</ModalTitle>
      <FormField label="Nome *"><input style={inputStyle} value={form.nome} onChange={upd("nome")} placeholder="Es. Cabina MT 01" /></FormField>
      <FormField label="Tipologia"><input style={inputStyle} value={form.tipologia} onChange={upd("tipologia")} placeholder="Es. Cabina MT, Pompe, HVAC" /></FormField>
      <FormField label="Descrizione"><textarea style={{ ...inputStyle, resize: "vertical", minHeight: "60px" }} value={form.descrizione} onChange={upd("descrizione")} /></FormField>
      <FormField label="Note"><textarea style={{ ...inputStyle, resize: "vertical", minHeight: "60px" }} value={form.note} onChange={upd("note")} /></FormField>
      <div style={{ display: "flex", gap: "10px", justifyContent: "flex-end", marginTop: "8px" }}>
        <button style={btnSecondary} onClick={onClose}>Annulla</button>
        <button style={btnPrimary} onClick={save} disabled={saving}>{saving ? "Salvo..." : "Crea Impianto"}</button>
      </div>
    </ModalOverlay>
  );
}

// ─── Modal Modifica Impianto ──────────────────────────────────────────────────

function ModalModificaImpianto({ impianto, onClose, onSaved }: { impianto: ImpiantoNode; onClose: () => void; onSaved: () => void }) {
  const [form, setForm] = useState({ nome: impianto.nome || "", tipologia: impianto.tipologia || "", descrizione: impianto.descrizione || "", note: impianto.note || "" });
  const [saving, setSaving] = useState(false);
  const save = async () => { setSaving(true); try { await apiPut(`/impianti/${impianto.id}`, form); onSaved(); onClose(); } catch { } finally { setSaving(false); } };
  const upd = (k: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setForm(p => ({ ...p, [k]: e.target.value }));
  return (
    <ModalOverlay onClose={onClose}>
      <ModalTitle onClose={onClose}>Modifica Impianto — {impianto.nome}</ModalTitle>
      <FormField label="Nome *"><input style={inputStyle} value={form.nome} onChange={upd("nome")} /></FormField>
      <FormField label="Tipologia"><input style={inputStyle} value={form.tipologia} onChange={upd("tipologia")} /></FormField>
      <FormField label="Descrizione"><textarea style={{ ...inputStyle, resize: "vertical", minHeight: "60px" }} value={form.descrizione} onChange={upd("descrizione")} /></FormField>
      <FormField label="Note"><textarea style={{ ...inputStyle, resize: "vertical", minHeight: "60px" }} value={form.note} onChange={upd("note")} /></FormField>
      <div style={{ display: "flex", gap: "10px", justifyContent: "flex-end", marginTop: "8px" }}>
        <button style={btnSecondary} onClick={onClose}>Annulla</button>
        <button style={btnPrimary} onClick={save} disabled={saving}>{saving ? "Salvo..." : "Salva"}</button>
      </div>
    </ModalOverlay>
  );
}

// ─── Modal Genera Asset Multipli ──────────────────────────────────────────────

function ModalGeneraAssetMultipli({ impiantoId, impiantoNome, onClose, onCreated }: { impiantoId: number; impiantoNome: string; onClose: () => void; onCreated: () => void }) {
  const [step, setStep] = useState(1);
  const [prefisso, setPrefisso] = useState("");
  const [quantita, setQuantita] = useState(3);
  const [area, setArea] = useState("Generale");
  const [criticita, setCriticita] = useState("media");
  const [marca, setMarca] = useState("");
  const [modello, setModello] = useState("");
  const [saving, setSaving] = useState(false);

  const preview = Array.from({ length: Math.max(0, Math.min(quantita, 99)) }, (_, i) => `${prefisso} ${String(i + 1).padStart(2, "0")}`);

  const genera = async () => {
    setSaving(true);
    try {
      await apiPost("/assets/genera-multipli", { impianto_id: impiantoId, prefisso_nome: prefisso, quantita, area, criticita, marca: marca || undefined, modello: modello || undefined });
      onCreated(); onClose();
    } catch { } finally { setSaving(false); }
  };

  return (
    <ModalOverlay onClose={onClose}>
      <ModalTitle onClose={onClose}>Genera Asset Multipli — {impiantoNome}</ModalTitle>
      {step === 1 && (
        <>
          <FormField label="Prefisso nome asset">
            <input style={inputStyle} value={prefisso} onChange={e => setPrefisso(e.target.value)} placeholder="Es. Pompa, Motore, Valvola" />
          </FormField>
          <FormField label="Quanti asset creare? (1-99)">
            <input style={inputStyle} type="number" min={1} max={99} value={quantita} onChange={e => setQuantita(Math.min(99, Math.max(1, Number(e.target.value))))} />
          </FormField>
          {prefisso && quantita > 0 && (
            <div style={{ background: "var(--bg-elevated)", borderRadius: "8px", padding: "12px 16px", marginBottom: "16px", border: "1px solid var(--border)" }}>
              <div style={{ fontSize: "11px", color: "var(--text-secondary)", marginBottom: "8px", textTransform: "uppercase" }}>Anteprima nomi</div>
              {preview.slice(0, 6).map(n => <div key={n} style={{ fontSize: "13px", padding: "2px 0", color: "var(--blue)" }}>→ {n}</div>)}
              {preview.length > 6 && <div style={{ fontSize: "12px", color: "var(--text-secondary)" }}>... e altri {preview.length - 6}</div>}
            </div>
          )}
          <div style={{ display: "flex", gap: "10px", justifyContent: "flex-end" }}>
            <button style={btnSecondary} onClick={onClose}>Annulla</button>
            <button style={btnPrimary} onClick={() => setStep(2)} disabled={!prefisso.trim()}>Avanti →</button>
          </div>
        </>
      )}
      {step === 2 && (
        <>
          <div style={{ background: "var(--blue-glow)", border: "1px solid var(--blue-border)", borderRadius: "8px", padding: "12px", marginBottom: "16px", fontSize: "12px", color: "var(--text-secondary)" }}>
            Questi dati verranno applicati a tutti i {quantita} asset generati. Potrai modificarli singolarmente dopo.
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px" }}>
            <FormField label="Area"><input style={inputStyle} value={area} onChange={e => setArea(e.target.value)} /></FormField>
            <FormField label="Criticita'">
              <select style={inputStyle} value={criticita} onChange={e => setCriticita(e.target.value)}>
                <option value="bassa">Bassa</option>
                <option value="media">Media</option>
                <option value="alta">Alta</option>
                <option value="critica">Critica</option>
              </select>
            </FormField>
            <FormField label="Marca (opz.)"><input style={inputStyle} value={marca} onChange={e => setMarca(e.target.value)} /></FormField>
            <FormField label="Modello (opz.)"><input style={inputStyle} value={modello} onChange={e => setModello(e.target.value)} /></FormField>
          </div>
          <div style={{ display: "flex", gap: "10px", justifyContent: "flex-end", marginTop: "8px" }}>
            <button style={btnSecondary} onClick={() => setStep(1)}>← Indietro</button>
            <button style={btnPrimary} onClick={genera} disabled={saving}>{saving ? "Generando..." : `Genera ${quantita} asset`}</button>
          </div>
        </>
      )}
    </ModalOverlay>
  );
}

// ─── Modal Nuovo Asset ────────────────────────────────────────────────────────

function ModalNuovoAsset({ impiantoId, impiantoNome, onClose, onCreated }: { impiantoId: number; impiantoNome: string; onClose: () => void; onCreated: () => void }) {
  const [form, setForm] = useState({ nome: "", area: "Generale", codice: "", descrizione: "", marca: "", modello: "", matricola: "", numero_serie: "", criticita: "media", posizione_fisica: "", impianto_id: impiantoId });
  const [saving, setSaving] = useState(false);
  const save = async () => { if (!form.nome.trim()) return; setSaving(true); try { await apiPost("/assets", form); onCreated(); onClose(); } catch { } finally { setSaving(false); } };
  const upd = (k: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => setForm(p => ({ ...p, [k]: e.target.value }));
  return (
    <ModalOverlay onClose={onClose}>
      <ModalTitle onClose={onClose}>Nuovo Asset — {impiantoNome}</ModalTitle>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px" }}>
        <FormField label="Nome *"><input style={inputStyle} value={form.nome} onChange={upd("nome")} placeholder="Es. Pompa centrifuga" /></FormField>
        <FormField label="Area"><input style={inputStyle} value={form.area} onChange={upd("area")} /></FormField>
        <FormField label="Marca"><input style={inputStyle} value={form.marca} onChange={upd("marca")} /></FormField>
        <FormField label="Modello"><input style={inputStyle} value={form.modello} onChange={upd("modello")} /></FormField>
        <FormField label="Matricola"><input style={inputStyle} value={form.matricola} onChange={upd("matricola")} /></FormField>
        <FormField label="N. Serie"><input style={inputStyle} value={form.numero_serie} onChange={upd("numero_serie")} /></FormField>
        <FormField label="Criticita'">
          <select style={inputStyle} value={form.criticita} onChange={upd("criticita")}>
            <option value="bassa">Bassa</option><option value="media">Media</option>
            <option value="alta">Alta</option><option value="critica">Critica</option>
          </select>
        </FormField>
        <FormField label="Posizione fisica"><input style={inputStyle} value={form.posizione_fisica} onChange={upd("posizione_fisica")} /></FormField>
      </div>
      <FormField label="Descrizione"><textarea style={{ ...inputStyle, resize: "vertical", minHeight: "60px" }} value={form.descrizione} onChange={upd("descrizione")} /></FormField>
      <div style={{ display: "flex", gap: "10px", justifyContent: "flex-end", marginTop: "8px" }}>
        <button style={btnSecondary} onClick={onClose}>Annulla</button>
        <button style={btnPrimary} onClick={save} disabled={saving}>{saving ? "Salvo..." : "Crea Asset"}</button>
      </div>
    </ModalOverlay>
  );
}

// ─── Panel Sito ───────────────────────────────────────────────────────────────

function PanelSito({ sito, onModifica, onElimina, onAddImpianto, onSelectImpianto }: {
  sito: SitoNode; onModifica: () => void; onElimina: () => void;
  onAddImpianto: () => void; onSelectImpianto: (imp: ImpiantoNode) => void;
}) {
  return (
    <div style={{ padding: "24px", height: "100%", overflowY: "auto" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "20px" }}>
        <div>
          <div style={{ fontSize: "11px", color: "var(--text-secondary)", textTransform: "uppercase", letterSpacing: "1px" }}>Sito</div>
          <h2 style={{ margin: "4px 0 0", fontSize: "22px", fontWeight: 700 }}>{sito.nome}</h2>
          {sito.citta && <div style={{ fontSize: "13px", color: "var(--text-secondary)" }}>{sito.ubicazione ? `${sito.ubicazione}, ` : ""}{sito.citta}, {sito.paese}</div>}
        </div>
        <div style={{ display: "flex", gap: "8px" }}>
          <button style={btnPrimary} onClick={onModifica}>Modifica</button>
          <button style={btnDanger} onClick={onElimina}>Elimina</button>
        </div>
      </div>
      <div style={{ display: "flex", gap: "12px", flexWrap: "wrap", marginBottom: "24px" }}>
        <StatBox label="Impianti" value={sito.n_impianti} />
        <StatBox label="Asset totali" value={sito.n_asset_totali} />
        <StatBox label="Ticket aperti" value={sito.ticket_aperti} color={sito.ticket_aperti > 0 ? "var(--amber)" : "var(--green)"} />
        <StatBox label="Asset critici" value={sito.asset_critici} color={sito.asset_critici > 0 ? "var(--red)" : "var(--green)"} />
      </div>
      {(sito.responsabile || sito.email_responsabile) && (
        <div style={{ background: "var(--bg-elevated)", borderRadius: "8px", padding: "14px 16px", marginBottom: "20px", border: "1px solid var(--border)" }}>
          <div style={{ fontSize: "11px", color: "var(--text-secondary)", marginBottom: "8px", textTransform: "uppercase" }}>Responsabile</div>
          {sito.responsabile && <div style={{ fontSize: "14px", fontWeight: 600 }}>{sito.responsabile}</div>}
          {sito.telefono_responsabile && <div style={{ fontSize: "12px", color: "var(--text-secondary)" }}>{sito.telefono_responsabile}</div>}
          {sito.email_responsabile && <div style={{ fontSize: "12px", color: "var(--blue)" }}>{sito.email_responsabile}</div>}
        </div>
      )}
      {sito.descrizione && <div style={{ color: "var(--text-secondary)", fontSize: "13px", marginBottom: "20px" }}>{sito.descrizione}</div>}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "12px" }}>
        <div style={{ fontSize: "13px", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.5px" }}>Impianti ({sito.n_impianti})</div>
        <button style={{ ...btnPrimary, fontSize: "12px", padding: "5px 10px" }} onClick={onAddImpianto}>+ Impianto</button>
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
        {sito.impianti.map(imp => (
          <div key={imp.id} onClick={() => onSelectImpianto(imp)}
            style={{ background: "var(--bg-elevated)", border: "1px solid var(--border)", borderRadius: "8px", padding: "12px 16px", cursor: "pointer", display: "flex", justifyContent: "space-between", alignItems: "center", transition: "border-color 0.15s" }}
            onMouseEnter={e => (e.currentTarget.style.borderColor = "var(--blue)")}
            onMouseLeave={e => (e.currentTarget.style.borderColor = "var(--border)")}
          >
            <div>
              <div style={{ fontWeight: 600, fontSize: "14px" }}>⚙ {imp.nome}</div>
              {imp.tipologia && <div style={{ fontSize: "11px", color: "var(--text-secondary)" }}>{imp.tipologia}</div>}
            </div>
            <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
              <span style={{ fontSize: "12px", color: "var(--text-secondary)" }}>{imp.n_asset} asset</span>
              {imp.ticket_aperti > 0 && <span style={{ background: "var(--amber-dim)", color: "var(--amber)", borderRadius: "999px", padding: "2px 8px", fontSize: "11px" }}>{imp.ticket_aperti} ticket</span>}
            </div>
          </div>
        ))}
        {sito.impianti.length === 0 && <div style={{ color: "var(--text-secondary)", fontSize: "13px", padding: "20px", textAlign: "center" }}>Nessun impianto. Clicca "+ Impianto" per aggiungerne uno.</div>}
      </div>
      {sito.note && <div style={{ marginTop: "20px", padding: "12px", background: "var(--bg-elevated)", borderRadius: "8px", fontSize: "13px", color: "var(--text-secondary)" }}><strong>Note:</strong> {sito.note}</div>}
    </div>
  );
}

// ─── Panel Impianto ───────────────────────────────────────────────────────────

function PanelImpianto({ impianto, onModifica, onElimina, onAddAsset, onGeneraAsset, onSelectSito }: {
  impianto: ImpiantoNode; onModifica: () => void; onElimina: () => void;
  onAddAsset: () => void; onGeneraAsset: () => void; onSelectSito: () => void;
}) {
  return (
    <div style={{ padding: "24px", height: "100%", overflowY: "auto" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "20px" }}>
        <div>
          <div style={{ fontSize: "11px", color: "var(--text-secondary)", marginBottom: "4px" }}>
            <span style={{ cursor: "pointer", color: "var(--blue)" }} onClick={onSelectSito}>{impianto.sito_nome}</span>
            <span style={{ margin: "0 6px" }}>›</span><span>Impianto</span>
          </div>
          <h2 style={{ margin: "0 0 4px", fontSize: "22px", fontWeight: 700 }}>⚙ {impianto.nome}</h2>
          {impianto.tipologia && <div style={{ fontSize: "13px", color: "var(--text-secondary)" }}>{impianto.tipologia}</div>}
        </div>
        <div style={{ display: "flex", gap: "8px" }}>
          <button style={btnPrimary} onClick={onModifica}>Modifica</button>
          <button style={btnDanger} onClick={onElimina}>Elimina</button>
        </div>
      </div>
      <div style={{ display: "flex", gap: "12px", flexWrap: "wrap", marginBottom: "24px" }}>
        <StatBox label="Asset" value={impianto.n_asset} />
        <StatBox label="Ticket aperti" value={impianto.ticket_aperti} color={impianto.ticket_aperti > 0 ? "var(--amber)" : "var(--green)"} />
      </div>
      {impianto.descrizione && <div style={{ color: "var(--text-secondary)", fontSize: "13px", marginBottom: "20px" }}>{impianto.descrizione}</div>}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "12px" }}>
        <div style={{ fontSize: "13px", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.5px" }}>Asset ({impianto.n_asset})</div>
        <div style={{ display: "flex", gap: "8px" }}>
          <button style={{ ...btnSecondary, fontSize: "12px", padding: "5px 10px" }} onClick={onGeneraAsset}>⚡ Genera multipli</button>
          <button style={{ ...btnPrimary, fontSize: "12px", padding: "5px 10px" }} onClick={onAddAsset}>+ Asset</button>
        </div>
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
        {impianto.assets.map(a => (
          <div key={a.id} style={{ background: "var(--bg-elevated)", border: "1px solid var(--border)", borderRadius: "8px", padding: "12px 16px", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <div>
              <div style={{ fontWeight: 600, fontSize: "13px" }}>🔧 {a.nome}</div>
              {a.codice && <div style={{ fontSize: "11px", color: "var(--text-secondary)" }}>{a.codice}</div>}
            </div>
            <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
              <CriticitaChip valore={a.criticita} />
              <StatoChip stato={a.stato} />
            </div>
          </div>
        ))}
        {impianto.assets.length === 0 && <div style={{ color: "var(--text-secondary)", fontSize: "13px", padding: "20px", textAlign: "center" }}>Nessun asset. Clicca "+ Asset" per aggiungerne uno.</div>}
      </div>
      {impianto.note && <div style={{ marginTop: "20px", padding: "12px", background: "var(--bg-elevated)", borderRadius: "8px", fontSize: "13px", color: "var(--text-secondary)" }}><strong>Note:</strong> {impianto.note}</div>}
    </div>
  );
}

// ─── Panel Asset ──────────────────────────────────────────────────────────────

function PanelAsset({ assetId, onSelectImpianto, onSelectSito, onElimina }: {
  assetId: number; onSelectImpianto: () => void; onSelectSito: () => void; onElimina: () => void;
}) {
  const [detail, setDetail] = useState<AssetDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<"anagrafica" | "vincoli" | "piani" | "documenti" | "ticket">("anagrafica");
  const [editing, setEditing] = useState(false);
  const [editForm, setEditForm] = useState<Partial<AssetDetail>>({});
  const [saving, setSaving] = useState(false);
  const [updatingStatus, setUpdatingStatus] = useState(false);


  const load = useCallback(async () => {
    setLoading(true);
    try { const data = await apiGet<AssetDetail>(`/assets/${assetId}/dettaglio-completo`); setDetail(data); setEditForm(data); } catch { } finally { setLoading(false); }
  }, [assetId]);
  useEffect(() => { load(); }, [load]);

  const saveEdit = async () => {
    if (!detail) return; setSaving(true);
    try { await apiPut(`/assets/${detail.id}`, editForm); await load(); setEditing(false); } catch { } finally { setSaving(false); }
  };

  const quickStatusChange = async (newStatus: string) => {
    if (!detail) return;
    setUpdatingStatus(true);
    try {
      await apiPut(`/assets/${detail.id}`, { stato: newStatus });
      setDetail(prev => prev ? { ...prev, stato: newStatus } : null);
    } catch {
      // Potresti mostrare un toast o loggare l'errore
    } finally {
      setUpdatingStatus(false);
    }
  };


  if (loading) return <div style={{ padding: "40px", textAlign: "center", color: "var(--text-secondary)" }}>Caricamento...</div>;
  if (!detail) return <div style={{ padding: "40px", textAlign: "center", color: "var(--text-secondary)" }}>Asset non trovato</div>;

  const tabs = [{ id: "anagrafica", label: "Anagrafica" }, { id: "vincoli", label: "Vincoli & Note" }, { id: "piani", label: "Piani Manut." }, { id: "documenti", label: "Documenti" }, { id: "ticket", label: "Ticket" }] as const;
  const upd = (k: keyof AssetDetail) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => setEditForm(p => ({ ...p, [k]: e.target.value }));

  return (
    <div style={{ padding: "24px", height: "100%", overflowY: "auto" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "16px" }}>
        <div>
          <div style={{ fontSize: "11px", color: "var(--text-secondary)", marginBottom: "4px" }}>
            {detail.sito_nome && <><span style={{ cursor: "pointer", color: "var(--blue)" }} onClick={onSelectSito}>{detail.sito_nome}</span><span style={{ margin: "0 6px" }}>›</span></>}
            {detail.impianto_nome && <><span style={{ cursor: "pointer", color: "var(--blue)" }} onClick={onSelectImpianto}>{detail.impianto_nome}</span><span style={{ margin: "0 6px" }}>›</span></>}
            <span>Asset</span>
          </div>
          <h2 style={{ margin: "0 0 6px", fontSize: "20px", fontWeight: 700 }}>🔧 {detail.nome}</h2>
          <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
            <CriticitaChip valore={detail.criticita} />
            <StatusToggle 
              size="sm"
              currentValue={detail.stato}
              onChange={quickStatusChange}
              disabled={updatingStatus}
              options={[
                { value: "service", label: "Servizio", color: "var(--green)" },
                { value: "stopped", label: "Fermo", color: "var(--amber)" },
                { value: "out of service", label: "Guasto", color: "var(--red)" },
              ]}
            />
            {detail.codice && <span style={{ fontSize: "11px", color: "var(--text-secondary)", padding: "2px 8px", background: "var(--bg-elevated)", borderRadius: "4px", border: "1px solid var(--border)" }}>{detail.codice}</span>}
          </div>
        </div>
        {!editing
          ? <div style={{ display: "flex", gap: "8px" }}>
              <button style={btnPrimary} onClick={() => setEditing(true)}>Modifica</button>
              <button style={btnDanger} onClick={onElimina}>Elimina</button>
            </div>
          : <div style={{ display: "flex", gap: "8px" }}>
              <button style={btnSecondary} onClick={() => setEditing(false)}>Annulla</button>
              <button style={btnPrimary} onClick={saveEdit} disabled={saving}>{saving ? "Salvo..." : "Salva"}</button>
            </div>
        }
      </div>

      <div style={{ display: "flex", gap: "2px", borderBottom: "1px solid var(--border)", marginBottom: "20px" }}>
        {tabs.map(t => (
          <button key={t.id} onClick={() => setTab(t.id)} style={{ background: "transparent", border: "none", cursor: "pointer", padding: "8px 12px", fontSize: "12px", fontWeight: tab === t.id ? 700 : 400, color: tab === t.id ? "var(--blue)" : "var(--text-secondary)", borderBottom: tab === t.id ? "2px solid var(--blue)" : "2px solid transparent", marginBottom: "-1px" }}>
            {t.label}
          </button>
        ))}
      </div>

      {tab === "anagrafica" && (
        editing ? (
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px" }}>
            <FormField label="Nome"><input style={inputStyle} value={editForm.nome || ""} onChange={upd("nome")} /></FormField>
            <FormField label="Area"><input style={inputStyle} value={editForm.area || ""} onChange={upd("area")} /></FormField>
            <FormField label="Marca"><input style={inputStyle} value={editForm.marca || ""} onChange={upd("marca")} /></FormField>
            <FormField label="Modello"><input style={inputStyle} value={editForm.modello || ""} onChange={upd("modello")} /></FormField>
            <FormField label="Matricola"><input style={inputStyle} value={editForm.matricola || ""} onChange={upd("matricola")} /></FormField>
            <FormField label="N. Serie"><input style={inputStyle} value={editForm.numero_serie || ""} onChange={upd("numero_serie")} /></FormField>
            <FormField label="Anno installazione"><input style={inputStyle} type="number" value={editForm.anno_installazione || ""} onChange={upd("anno_installazione")} /></FormField>
            <FormField label="Anno produzione"><input style={inputStyle} type="number" value={editForm.anno_produzione || ""} onChange={upd("anno_produzione")} /></FormField>
            <FormField label="Fornitore"><input style={inputStyle} value={editForm.fornitore || ""} onChange={upd("fornitore")} /></FormField>
            <FormField label="Data acquisto"><input style={inputStyle} type="date" value={editForm.data_acquisto || ""} onChange={upd("data_acquisto")} /></FormField>
            <FormField label="Scadenza garanzia"><input style={inputStyle} type="date" value={editForm.data_scadenza_garanzia || ""} onChange={upd("data_scadenza_garanzia")} /></FormField>
            <FormField label="Posizione fisica"><input style={inputStyle} value={editForm.posizione_fisica || ""} onChange={upd("posizione_fisica")} /></FormField>
            <FormField label="Criticita'">
              <select style={inputStyle} value={editForm.criticita || "media"} onChange={upd("criticita")}>
                <option value="bassa">Bassa</option><option value="media">Media</option>
                <option value="alta">Alta</option><option value="critica">Critica</option>
              </select>
            </FormField>
            <FormField label="Stato">
              <select style={inputStyle} value={editForm.stato || "service"} onChange={upd("stato")}>
                <option value="service">In servizio</option>
                <option value="out of service">Fuori servizio</option>
                <option value="stopped">Fermo</option>
              </select>
            </FormField>
          </div>
        ) : (
          <>
            <DetailRow label="Impianto" value={detail.impianto_nome} />
            <DetailRow label="Sito" value={detail.sito_nome} />
            <DetailRow label="Area" value={detail.area} />
            <DetailRow label="Marca" value={detail.marca} />
            <DetailRow label="Modello" value={detail.modello} />
            <DetailRow label="Matricola" value={detail.matricola} />
            <DetailRow label="Numero di serie" value={detail.numero_serie} />
            <DetailRow label="Anno installazione" value={detail.anno_installazione} />
            <DetailRow label="Anno produzione" value={detail.anno_produzione} />
            <DetailRow label="Fornitore" value={detail.fornitore} />
            <DetailRow label="Data acquisto" value={detail.data_acquisto} />
            <DetailRow label="Scadenza garanzia" value={detail.data_scadenza_garanzia} />
            <DetailRow label="Posizione fisica" value={detail.posizione_fisica} />
            {detail.descrizione && <DetailRow label="Descrizione" value={detail.descrizione} />}
          </>
        )
      )}

      {tab === "vincoli" && (
        <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
          {(["vincoli_operativi", "vincoli_manutenzione", "note_tecniche"] as const).map((field) => {
            const labels: Record<string, string> = { vincoli_operativi: "Vincoli operativi", vincoli_manutenzione: "Vincoli manutenzione", note_tecniche: "Note tecniche" };
            return (
              <div key={field}>
                <div style={{ fontSize: "12px", color: "var(--text-secondary)", marginBottom: "6px", textTransform: "uppercase" }}>{labels[field]}</div>
                {editing
                  ? <textarea style={{ ...inputStyle, resize: "vertical", minHeight: "100px" }} value={(editForm[field] as string) || ""} onChange={upd(field)} />
                  : <div style={{ background: "var(--bg-elevated)", borderRadius: "6px", padding: "12px", fontSize: "13px", minHeight: "60px" }}>{detail[field] || <span style={{ color: "var(--text-secondary)" }}>—</span>}</div>
                }
              </div>
            );
          })}
        </div>
      )}

      {tab === "piani" && (
        <div>
          <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: "12px" }}>
            <button style={{ ...btnPrimary, fontSize: "12px", padding: "5px 10px" }}>+ Aggiungi Piano</button>
          </div>
          {detail.piani_manutenzione?.length ? detail.piani_manutenzione.map(p => (
            <div key={p.id} style={{ background: "var(--bg-elevated)", border: "1px solid var(--border)", borderRadius: "8px", padding: "14px", marginBottom: "10px" }}>
              <div style={{ fontWeight: 600, fontSize: "14px", marginBottom: "4px" }}>{p.descrizione}</div>
              <div style={{ display: "flex", gap: "16px", fontSize: "12px", color: "var(--text-secondary)" }}>
                <span>Ogni {p.frequenza_giorni}gg</span><span>{p.durata_ore}h</span>
                <span>Priorita': {p.priorita}</span>
                {p.prossima_scadenza && <span>Scad: {p.prossima_scadenza.split("T")[0]}</span>}
              </div>
            </div>
          )) : <div style={{ textAlign: "center", padding: "40px", color: "var(--text-secondary)" }}>Nessun piano associato</div>}
        </div>
      )}

      {tab === "documenti" && (
        <div style={{ textAlign: "center", padding: "40px", color: "var(--text-secondary)" }}>
          <div style={{ fontSize: "32px", marginBottom: "8px" }}>📄</div>
          <div>Nessun documento caricato</div>
          <div style={{ fontSize: "12px", marginTop: "4px" }}>Manuale · Schema elettrico · Datasheet · Certificato · Altro</div>
          <button style={{ ...btnPrimary, marginTop: "16px", fontSize: "12px" }}>+ Carica documento</button>
        </div>
      )}

      {tab === "ticket" && (
        <div>
          <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: "12px" }}>
            <button style={{ ...btnPrimary, fontSize: "12px", padding: "5px 10px" }}>+ Apri Ticket</button>
          </div>
          {detail.tickets?.length ? detail.tickets.map(t => (
            <div key={t.id} style={{ background: "var(--bg-elevated)", border: "1px solid var(--border)", borderRadius: "8px", padding: "12px", marginBottom: "8px", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <div>
                <div style={{ fontWeight: 600, fontSize: "13px" }}>{t.titolo}</div>
                <div style={{ fontSize: "11px", color: "var(--text-secondary)" }}>#{t.id} · {t.tipo} · {t.created_at?.split("T")[0]}</div>
              </div>
              <div style={{ display: "flex", gap: "8px" }}>
                <span style={{ fontSize: "11px", background: "var(--bg-surface)", border: "1px solid var(--border)", borderRadius: "4px", padding: "2px 8px" }}>{t.stato}</span>
                <span style={{ fontSize: "11px", background: "var(--bg-surface)", border: "1px solid var(--border)", borderRadius: "4px", padding: "2px 8px" }}>{t.priorita}</span>
              </div>
            </div>
          )) : <div style={{ textAlign: "center", padding: "40px", color: "var(--text-secondary)" }}>Nessun ticket</div>}
        </div>
      )}
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function AssetPage() {
  const [siti, setSiti] = useState<SitoNode[]>([]);
  const [loading, setLoading] = useState(true);
  const [treeSearch, setTreeSearch] = useState("");
  const [expandedSiti, setExpandedSiti] = useState<Set<number>>(new Set());
  const [expandedImpianti, setExpandedImpianti] = useState<Set<number>>(new Set());

  const [selType, setSelType] = useState<SelectionType>(null);
  const [selSito, setSelSito] = useState<SitoNode | null>(null);
  const [selImpianto, setSelImpianto] = useState<ImpiantoNode | null>(null);
  const [selAssetId, setSelAssetId] = useState<number | null>(null);

  // CRUD modals
  const [modalNuovoSito, setModalNuovoSito] = useState(false);
  const [modalModSito, setModalModSito] = useState<SitoNode | null>(null);
  const [modalDelSito, setModalDelSito] = useState<SitoNode | null>(null);
  const [modalNuovoImpianto, setModalNuovoImpianto] = useState<{ sitoId: number; sitoNome: string } | null>(null);
  const [modalModImpianto, setModalModImpianto] = useState<ImpiantoNode | null>(null);
  const [modalDelImpianto, setModalDelImpianto] = useState<ImpiantoNode | null>(null);
  const [modalNuovoAsset, setModalNuovoAsset] = useState<{ impiantoId: number; impiantoNome: string } | null>(null);
  const [modalGeneraAsset, setModalGeneraAsset] = useState<{ impiantoId: number; impiantoNome: string } | null>(null);
  const [modalDelAsset, setModalDelAsset] = useState<number | null>(null);

  const loadTree = useCallback(async () => {
    setLoading(true);
    try { const data = await apiGet<SitoNode[]>("/siti/tree"); setSiti(data); } catch { } finally { setLoading(false); }
  }, []);
  useEffect(() => { loadTree(); }, [loadTree]);

  const toggleSito = (id: number) => setExpandedSiti(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const toggleImpianto = (id: number) => setExpandedImpianti(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });

  const clickSito = (sito: SitoNode) => { toggleSito(sito.id); setSelType("sito"); setSelSito(sito); setSelImpianto(null); setSelAssetId(null); };
  const clickImpianto = (imp: ImpiantoNode, e: React.MouseEvent) => { e.stopPropagation(); toggleImpianto(imp.id); setSelType("impianto"); setSelImpianto(imp); setSelAssetId(null); };
  const clickAsset = (id: number, e: React.MouseEvent) => { e.stopPropagation(); setSelType("asset"); setSelAssetId(id); };

  const deleteSito = async () => {
    if (!modalDelSito) return;
    await apiDelete(`/siti/${modalDelSito.id}`);
    setModalDelSito(null); setSelType(null); setSelSito(null); await loadTree();
  };
  const deleteImpianto = async () => {
    if (!modalDelImpianto) return;
    await apiDelete(`/impianti/${modalDelImpianto.id}`);
    setModalDelImpianto(null); setSelType(null); setSelImpianto(null); await loadTree();
  };
  const deleteAsset = async () => {
    if (!modalDelAsset) return;
    await apiDelete(`/assets/${modalDelAsset}`);
    setModalDelAsset(null); setSelType(null); setSelAssetId(null); await loadTree();
  };

  const refresh = async () => { await loadTree(); };

  return (
    <div style={{ display: "flex", height: "calc(100vh - 56px)", overflow: "hidden" }}>

      {/* ── Albero sinistro ── */}
      <div style={{ width: "320px", minWidth: "260px", flexShrink: 0, background: "var(--bg-surface)", borderRight: "1px solid var(--border-strong)", display: "flex", flexDirection: "column", overflowY: "auto" }}>
        <div style={{ padding: "14px 16px", borderBottom: "1px solid var(--border)", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div style={{ fontSize: "13px", fontWeight: 700, textTransform: "uppercase", letterSpacing: "1px" }}>Siti & Asset</div>
          <button style={{ ...btnPrimary, fontSize: "11px", padding: "4px 10px" }} onClick={() => setModalNuovoSito(true)}>+ Sito</button>
        </div>
        {/* Barra di ricerca albero */}
        <div style={{ padding: "8px 12px", borderBottom: "1px solid var(--border)" }}>
          <input
            value={treeSearch}
            onChange={e => setTreeSearch(e.target.value)}
            placeholder="Cerca sito, impianto, asset..."
            style={{ width: "100%", background: "var(--bg-elevated)", border: "1px solid var(--border-strong)", borderRadius: "6px", color: "var(--text-primary)", padding: "6px 10px", fontSize: "12px", outline: "none", fontFamily: "inherit", boxSizing: "border-box" }}
          />
        </div>

        {loading && <div style={{ padding: "20px", textAlign: "center", color: "var(--text-secondary)", fontSize: "13px" }}>Caricamento...</div>}
        {!loading && siti.length === 0 && <div style={{ padding: "20px", textAlign: "center", color: "var(--text-secondary)", fontSize: "13px" }}>Nessun sito. Clicca "+ Sito".</div>}

        <div style={{ padding: "8px 0" }}>
          {(() => {
            const term = treeSearch.trim().toLowerCase();
            const sitiToShow = !term ? siti : siti.filter(s =>
              s.nome.toLowerCase().includes(term) ||
              s.impianti.some(i => i.nome.toLowerCase().includes(term) || i.assets.some(a => a.nome.toLowerCase().includes(term)))
            );
            // Se c'è una ricerca, espandi tutto automaticamente
            const effectiveExpandedSiti = term ? new Set(sitiToShow.map(s => s.id)) : expandedSiti;
            const effectiveExpandedImpianti = term ? new Set(sitiToShow.flatMap(s => s.impianti.map(i => i.id))) : expandedImpianti;
            return sitiToShow.map(sito => {
              const sitoParsed = !term ? sito : {
                ...sito,
                impianti: sito.impianti.filter(i => i.nome.toLowerCase().includes(term) || sito.nome.toLowerCase().includes(term) || i.assets.some(a => a.nome.toLowerCase().includes(term))).map(i => ({
                  ...i,
                  assets: sito.nome.toLowerCase().includes(term) || i.nome.toLowerCase().includes(term) ? i.assets : i.assets.filter(a => a.nome.toLowerCase().includes(term))
                }))
              };
          return (
            <div key={sitoParsed.id}>
              {/* Sito */}
              <div onClick={() => clickSito(sito)} style={{ display: "flex", alignItems: "center", gap: "6px", padding: "8px 12px", cursor: "pointer", background: selType === "sito" && selSito?.id === sito.id ? "var(--blue-glow)" : "transparent", borderLeft: selType === "sito" && selSito?.id === sito.id ? "3px solid var(--blue)" : "3px solid transparent", userSelect: "none" }}>
                <span style={{ fontSize: "11px", color: "var(--text-secondary)", width: "12px", flexShrink: 0 }}>{effectiveExpandedSiti.has(sito.id) ? "▼" : "▶"}</span>
                <span style={{ fontSize: "13px" }}>📍</span>
                <span style={{ fontSize: "13px", fontWeight: 600, flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{sito.nome}</span>
                <span title="Aggiungi impianto" onClick={e => { e.stopPropagation(); setModalNuovoImpianto({ sitoId: sito.id, sitoNome: sito.nome }); }} style={{ fontSize: "14px", color: "var(--blue)", cursor: "pointer", padding: "0 2px", opacity: 0.8 }}>+</span>
              </div>

              {/* Impianti */}
              {effectiveExpandedSiti.has(sito.id) && sitoParsed.impianti.map(imp => (
                <div key={imp.id}>
                  <div onClick={e => clickImpianto(imp, e)} style={{ display: "flex", alignItems: "center", gap: "6px", padding: "6px 12px 6px 28px", cursor: "pointer", background: selType === "impianto" && selImpianto?.id === imp.id ? "var(--blue-glow)" : "transparent", borderLeft: selType === "impianto" && selImpianto?.id === imp.id ? "3px solid var(--blue)" : "3px solid transparent", userSelect: "none" }}>
                    <span style={{ fontSize: "11px", color: "var(--text-secondary)", width: "12px", flexShrink: 0 }}>{effectiveExpandedImpianti.has(imp.id) ? "▼" : "▶"}</span>
                    <span style={{ fontSize: "12px" }}>⚙</span>
                    <span style={{ fontSize: "12px", flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{imp.nome}</span>
                    <span title="Genera asset multipli" onClick={e => { e.stopPropagation(); setModalGeneraAsset({ impiantoId: imp.id, impiantoNome: imp.nome }); }} style={{ fontSize: "11px", color: "var(--amber)", cursor: "pointer", padding: "0 3px" }}>⚡</span>
                    <span title="Aggiungi asset" onClick={e => { e.stopPropagation(); setModalNuovoAsset({ impiantoId: imp.id, impiantoNome: imp.nome }); }} style={{ fontSize: "14px", color: "var(--blue)", cursor: "pointer", padding: "0 2px", opacity: 0.8 }}>+</span>
                  </div>

                  {/* Asset */}
                  {effectiveExpandedImpianti.has(imp.id) && imp.assets.map(a => (
                    <div key={a.id} onClick={e => clickAsset(a.id, e)} style={{ display: "flex", alignItems: "center", gap: "6px", padding: "5px 12px 5px 48px", cursor: "pointer", background: selType === "asset" && selAssetId === a.id ? "var(--blue-glow)" : "transparent", borderLeft: selType === "asset" && selAssetId === a.id ? "3px solid var(--blue)" : "3px solid transparent", userSelect: "none" }}>
                      <span style={{ fontSize: "12px" }}>🔧</span>
                      <span style={{ fontSize: "12px", flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{a.nome}</span>
                      {(a.criticita === "critica" || a.criticita === "alta") && (
                        <span style={{ fontSize: "9px", padding: "1px 5px", borderRadius: "999px", background: a.criticita === "critica" ? "var(--red-dim)" : "rgba(249,115,22,0.2)", color: a.criticita === "critica" ? "var(--red)" : "#f97316" }}>{a.criticita}</span>
                      )}
                    </div>
                  ))}
                </div>
              ))}
            </div>
          ); }); })()}
        </div>
      </div>

      {/* ── Pannello destro ── */}
      <div style={{ flex: 1, background: "var(--bg-elevated)", overflowY: "auto" }}>
        {!selType && (
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", height: "100%", color: "var(--text-secondary)" }}>
            <div style={{ fontSize: "48px", marginBottom: "16px" }}>🏭</div>
            <div style={{ fontSize: "16px", fontWeight: 600 }}>Seleziona un elemento dall&apos;albero</div>
            <div style={{ fontSize: "13px", marginTop: "8px" }}>Clicca su un sito, impianto o asset per vederne i dettagli</div>
          </div>
        )}

        {selType === "sito" && selSito && (
          <PanelSito
            sito={selSito}
            onModifica={() => setModalModSito(selSito)}
            onElimina={() => setModalDelSito(selSito)}
            onAddImpianto={() => setModalNuovoImpianto({ sitoId: selSito.id, sitoNome: selSito.nome })}
            onSelectImpianto={imp => { setSelType("impianto"); setSelImpianto(imp); }}
          />
        )}

        {selType === "impianto" && selImpianto && (
          <PanelImpianto
            impianto={selImpianto}
            onModifica={() => setModalModImpianto(selImpianto)}
            onElimina={() => setModalDelImpianto(selImpianto)}
            onAddAsset={() => setModalNuovoAsset({ impiantoId: selImpianto.id, impiantoNome: selImpianto.nome })}
            onGeneraAsset={() => setModalGeneraAsset({ impiantoId: selImpianto.id, impiantoNome: selImpianto.nome })}
            onSelectSito={() => { const s = siti.find(s => s.id === selImpianto.sito_id); if (s) { setSelType("sito"); setSelSito(s); } }}
          />
        )}

        {selType === "asset" && selAssetId && (
          <PanelAsset
            assetId={selAssetId}
            onSelectImpianto={() => { if (selImpianto) setSelType("impianto"); }}
            onSelectSito={() => { if (selSito) setSelType("sito"); }}
            onElimina={() => setModalDelAsset(selAssetId)}
          />
        )}
      </div>

      {/* ── Modals ── */}
      {modalNuovoSito && <ModalNuovoSito onClose={() => setModalNuovoSito(false)} onCreated={refresh} />}
      {modalModSito && <ModalModificaSito sito={modalModSito} onClose={() => setModalModSito(null)} onSaved={async () => { await loadTree(); setModalModSito(null); }} />}
      {modalDelSito && (
        <ModalConferma
          titolo="Elimina Sito"
          messaggio={`Sei sicuro di voler eliminare irrevocabilmente "${modalDelSito.nome}"? L'operazione eliminerà a cascata TUTTI i dati ad esso collegati (Impianti, Asset, Piani, Ticket, Documenti, Analisi).`}
          onClose={() => setModalDelSito(null)}
          onConferma={deleteSito}
        />
      )}

      {modalNuovoImpianto && <ModalNuovoImpianto sitoId={modalNuovoImpianto.sitoId} sitoNome={modalNuovoImpianto.sitoNome} onClose={() => setModalNuovoImpianto(null)} onCreated={refresh} />}
      {modalModImpianto && <ModalModificaImpianto impianto={modalModImpianto} onClose={() => setModalModImpianto(null)} onSaved={async () => { await loadTree(); setModalModImpianto(null); }} />}
      {modalDelImpianto && (
        <ModalConferma
          titolo="Elimina Impianto"
          messaggio={`Sei sicuro di voler eliminare irrevocabilmente "${modalDelImpianto.nome}"? L'operazione eliminerà a cascata TUTTI i dati ad esso collegati (Asset, Piani, Ticket, Documenti, Analisi).`}
          onClose={() => setModalDelImpianto(null)}
          onConferma={deleteImpianto}
        />
      )}

      {modalNuovoAsset && <ModalNuovoAsset impiantoId={modalNuovoAsset.impiantoId} impiantoNome={modalNuovoAsset.impiantoNome} onClose={() => setModalNuovoAsset(null)} onCreated={refresh} />}
      {modalGeneraAsset && <ModalGeneraAssetMultipli impiantoId={modalGeneraAsset.impiantoId} impiantoNome={modalGeneraAsset.impiantoNome} onClose={() => setModalGeneraAsset(null)} onCreated={refresh} />}
      {modalDelAsset !== null && (
        <ModalConferma
          titolo="Elimina Asset"
          messaggio="Sei sicuro di voler eliminare irrevocabilmente questo asset? L'operazione eliminerà a cascata TUTTI i dati ad esso collegati (Piani, Ticket, Documenti, Analisi)."
          onClose={() => setModalDelAsset(null)}
          onConferma={deleteAsset}
        />
      )}
    </div>
  );
}
