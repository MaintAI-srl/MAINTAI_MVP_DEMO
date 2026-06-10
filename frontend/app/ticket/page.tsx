"use client";

import { useEffect, useState } from "react";
import dynamic from "next/dynamic";
import { API_BASE, apiGet, apiPost, apiPut, apiPatch } from "../lib/api";
import { localDatetimeStr, localDatetimeApiStr, datetimeLocalToApi } from "../lib/datetime";
import { notify } from "@/lib/toast";
import { SkeletonTable } from "../components/Skeleton";
import { Button } from "@/components/ui/button";
import UploadAllegati from "../components/UploadAllegati";
import StatusToggle from "../components/StatusToggle";
import { DataTable, dateRangeFilterFn, type ColumnDef } from "@/components/ui/data-table";
import KanbanBoard, { type KanbanTicket } from "../components/KanbanBoard";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { ASSET_STATUS_OPTIONS } from "../lib/assetStatus";
import { useAuth } from "../lib/auth";

// Lazy load mappa emergenze (Leaflet, solo client-side)
const EmergencyMap = dynamic(() => import("../components/EmergencyMap"), { ssr: false });

type Ticket = {
  id: number;
  titolo: string;
  asset_id: number;
  asset_name: string | null;
  sito_name?: string | null;
  impianto_name?: string | null;
  priorita: string;
  tipo: string;
  stato: string;
  asset_stato?: string | null;
  durata_stimata_ore: number;
  fascia_oraria: string;
  descrizione?: string | null;
  planned_start?: string | null;
  planned_finish?: string | null;
  execution_start?: string | null;
  execution_finish?: string | null;
  parent_id?: number | null;
  diagnosi_eseguita?: boolean;
  is_manual_plan?: boolean;
  created_at?: string | null;
  tecnico_id?: number | null;
  tecnico_name?: string | null;
  // M2.1
  costo_fermo_stimato?: number | null;
  // M2.2
  ricambio_note?: string | null;
  in_attesa_ricambio?: boolean;
};

type Asset = { id: number; name: string };
type PagedResult = { items: Ticket[]; total: number; page: number; pages: number };

const STATI = ["Aperto", "Pianificato", "In corso", "Chiuso", "Eliminato"];
const STATI_ATTIVI = ["Aperto", "Pianificato", "In corso"];
const STATI_ARCHIVIO = ["Chiuso", "Eliminato"];
const ASSET_STATE_OPTIONS = [
  { value: "", label: "Mantieni", color: "var(--text-muted)" },
  ...ASSET_STATUS_OPTIONS,
];

function statoStyle(s: string): React.CSSProperties {
  switch (s?.toLowerCase()) {
    case "aperto":      return { color: "#93c5fd", background: "rgba(59,130,246,0.10)",  border: "1px solid rgba(59,130,246,0.20)" };
    case "pianificato": return { color: "#c4b5fd", background: "rgba(139,92,246,0.10)", border: "1px solid rgba(139,92,246,0.22)" };
    case "in corso":    return { color: "#67e8f9", background: "rgba(6,182,212,0.10)",   border: "1px solid rgba(6,182,212,0.22)" };
    case "chiuso":      return { color: "#86efac", background: "rgba(34,197,94,0.10)",   border: "1px solid rgba(34,197,94,0.22)" };
    case "eliminato":   return { color: "var(--text-muted)", background: "rgba(100,116,139,0.10)", border: "1px solid rgba(100,116,139,0.20)" };
    default:            return { color: "var(--text-secondary)", background: "rgba(156,163,175,0.1)", border: "1px solid rgba(156,163,175,0.3)" };
  }
}

function getPrioritaStyle(p: string): React.CSSProperties {
  switch (p?.toLowerCase()) {
    case "emergenza": return { color: "#fff", background: "rgba(239,68,68,0.90)", border: "1px solid #ef4444" };
    case "alta":  return { color: "#fca5a5", background: "rgba(239,68,68,0.10)",  border: "1px solid rgba(239,68,68,0.22)" };
    case "media": return { color: "#fcd34d", background: "rgba(245,158,11,0.10)", border: "1px solid rgba(245,158,11,0.22)" };
    case "bassa": return { color: "var(--text-muted)", background: "rgba(100,116,139,0.10)", border: "1px solid rgba(100,116,139,0.20)" };
    default:      return { color: "var(--text-secondary)", background: "rgba(156,163,175,0.1)", border: "1px solid rgba(156,163,175,0.3)" };
  }
}

function getTipoStyle(t: string): React.CSSProperties {
  switch (t?.toUpperCase()) {
    case "BD":  return { background: "rgba(239,68,68,0.12)",   color: "#fca5a5", border: "1px solid rgba(239,68,68,0.25)" };
    case "PM":  return { background: "rgba(34,197,94,0.10)",   color: "#86efac", border: "1px solid rgba(34,197,94,0.22)" };
    case "CM":  return { background: "rgba(245,158,11,0.12)",  color: "#fcd34d", border: "1px solid rgba(245,158,11,0.25)" };
    default:    return { background: "var(--border-subtle)", color: "var(--text-secondary)", border: "1px solid var(--border-default)" };
  }
}

const _pad = (n: number) => String(n).padStart(2, "0");

/** Converte ISO string UTC → valore in ora LOCALE compatibile con datetime-local input */
function toDatetimeLocal(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "";
  // Usa getters locali (non UTC) per mostrare l'ora corretta nel fuso dell'utente
  return `${d.getFullYear()}-${_pad(d.getMonth() + 1)}-${_pad(d.getDate())}T${_pad(d.getHours())}:${_pad(d.getMinutes())}`;
}

/** Ora corrente come stringa datetime-local (ora locale) */
function nowDatetimeLocal(): string {
  const d = new Date();
  return `${d.getFullYear()}-${_pad(d.getMonth() + 1)}-${_pad(d.getDate())}T${_pad(d.getHours())}:${_pad(d.getMinutes())}`;
}

/**
 * Aggiunge `hours` ore a una stringa datetime-local "YYYY-MM-DDTHH:mm"
 * e restituisce una nuova stringa datetime-local in ora locale.
 * Non usa .toISOString() per evitare conversioni UTC errate.
 */
function addHoursToDatetimeLocal(dtLocal: string, hours: number): string {
  if (!dtLocal) return "";
  // new Date("YYYY-MM-DDTHH:mm") senza timezone viene trattato come LOCAL time
  const d = new Date(dtLocal);
  if (isNaN(d.getTime())) return "";
  const end = new Date(d.getTime() + Math.round(hours * 3600000));
  return `${end.getFullYear()}-${_pad(end.getMonth() + 1)}-${_pad(end.getDate())}T${_pad(end.getHours())}:${_pad(end.getMinutes())}`;
}

const dtInput: React.CSSProperties = { background: "var(--border-subtle)", border: "1px solid rgba(148,163,184,0.2)", borderRadius: 7, color: "var(--text-primary)", padding: "7px 11px", fontSize: 12, width: "100%", outline: "none", colorScheme: "light dark" };
const modalLabel: React.CSSProperties = { fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: ".1em", color: "var(--text-muted)", display: "block", marginBottom: 5 };

// ── Modal: richiesta data pianificazione + tecnico obbligatorio ──────────────
function PianificaQuickModal({ onConfirm, onCancel }: { onConfirm: (date: string, tecnicoId: number) => void; onCancel: () => void }) {
  const getISO = (days: number, hours: number) => {
    const d = new Date();
    d.setDate(d.getDate() + days);
    d.setHours(hours, 0, 0, 0);
    // Ora locale (non UTC): il valore alimenta un input datetime-local
    return localDatetimeStr(d);
  };
  const [date, setDate] = useState(getISO(0, 8));
  const [tecnicoId, setTecnicoId] = useState<number | null>(null);
  const [tecnici, setTecnici] = useState<{ id: number; nome: string; cognome: string; specializzazione?: string }[]>([]);

  useEffect(() => {
    apiGet<{ items?: { id: number; nome: string; cognome: string; specializzazione?: string }[] }>("/tecnici?limit=200")
      .then(d => setTecnici(d.items ?? (Array.isArray(d) ? (d as unknown as { id: number; nome: string; cognome: string; specializzazione?: string }[]) : [])))
      .catch(() => {});
  }, []);

  const presets = [
    { label: "Oggi 08:00", d: 0, h: 8 },
    { label: "Oggi 14:00", d: 0, h: 14 },
    { label: "Domani 08:00", d: 1, h: 8 },
    { label: "Lunedì prox", d: (8 - new Date().getDay()) % 7 || 7, h: 8 },
  ];

  const canConfirm = !!date && !!tecnicoId;

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.82)", zIndex: 9999, display: "flex", alignItems: "center", justifyContent: "center", backdropFilter: "blur(8px)" }}>
      <div style={{ background: "var(--surface-2)", border: "1px solid rgba(167,139,250,0.4)", borderRadius: 20, padding: "32px 28px", width: 440, boxShadow: "0 40px 100px rgba(0,0,0,0.8)" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 6, justifyContent: "center" }}>
          <span style={{ fontSize: 22 }}>📅</span>
          <div style={{ fontWeight: 900, fontSize: 18, color: "#a78bfa" }}>Pianifica intervento</div>
        </div>
        <div style={{ fontSize: 12, color: "var(--text-muted)", marginBottom: 22, textAlign: "center" }}>Imposta data e assegna il tecnico responsabile</div>

        {/* Presets */}
        <div style={{ fontSize: 11, fontWeight: 700, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.6px", marginBottom: 8 }}>Accesso rapido</div>
        <div style={{ display: "flex", gap: 6, marginBottom: 18, flexWrap: "wrap" }}>
          {presets.map(p => (
            <button key={p.label} onClick={() => setDate(getISO(p.d, p.h))}
              style={{ fontSize: 10, padding: "6px 12px", background: "var(--border-subtle)", color: "var(--text-soft)", border: "1px solid var(--border-default)", borderRadius: 7, cursor: "pointer", fontWeight: 600 }}>
              {p.label}
            </button>
          ))}
        </div>

        {/* Data */}
        <div style={{ fontSize: 11, fontWeight: 700, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.6px", marginBottom: 8 }}>Data e ora</div>
        <input type="datetime-local" value={date} onChange={e => setDate(e.target.value)}
          style={{ width: "100%", background: "var(--surface-3)", border: "1px solid rgba(167,139,250,0.25)", borderRadius: 10, color: "var(--text-primary)", padding: "11px 14px", fontSize: 14, outline: "none", colorScheme: "light dark", boxSizing: "border-box", marginBottom: 20 }} />

        {/* Tecnico — OBBLIGATORIO */}
        <div style={{ fontSize: 11, fontWeight: 700, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.6px", marginBottom: 8 }}>
          Assegna tecnico <span style={{ color: "#f87171" }}>*</span>
        </div>
        <select value={tecnicoId ?? ""} onChange={e => setTecnicoId(e.target.value ? Number(e.target.value) : null)}
          style={{
            width: "100%", background: "var(--surface-3)", borderRadius: 10,
            border: tecnicoId ? "1.5px solid rgba(167,139,250,0.5)" : "1.5px solid rgba(248,113,113,0.4)",
            color: tecnicoId ? "var(--text-primary)" : "var(--text-muted)",
            padding: "11px 14px", fontSize: 14, outline: "none", cursor: "pointer", boxSizing: "border-box",
          }}>
          <option value="">— Seleziona tecnico —</option>
          {tecnici.map(t => (
            <option key={t.id} value={t.id}>{t.nome} {t.cognome}{t.specializzazione ? ` · ${t.specializzazione}` : ""}</option>
          ))}
        </select>
        {!tecnicoId && (
          <div style={{ fontSize: 11, color: "#f87171", marginTop: 5 }}>⚠ Il tecnico è obbligatorio per pianificare</div>
        )}

        <div style={{ display: "flex", gap: 10, marginTop: 22 }}>
          <button onClick={onCancel} style={{ flex: 1, padding: "12px", background: "transparent", border: "1px solid var(--border-default)", color: "var(--text-muted)", borderRadius: 10, cursor: "pointer", fontSize: 13 }}>Annulla</button>
          <button disabled={!canConfirm} onClick={() => canConfirm && onConfirm(date, tecnicoId!)}
            style={{ flex: 2, padding: "12px", background: canConfirm ? "linear-gradient(135deg,#a78bfa,#7c3aed)" : "rgba(167,139,250,0.1)", color: canConfirm ? "#fff" : "rgba(167,139,250,0.4)", border: "none", borderRadius: 10, cursor: canConfirm ? "pointer" : "not-allowed", fontWeight: 800, fontSize: 14, transition: "all 0.2s" }}>
            ✓ Conferma pianificazione
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Modal: conferma eliminazione con motivo obbligatorio ─────────────────────
function EliminaConfirmModal({ onConfirm, onCancel }: { onConfirm: (reason: string) => void; onCancel: () => void }) {
  const [reason, setReason] = useState("");
  const valid = reason.trim().length >= 5;
  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.7)", zIndex: 9999, display: "flex", alignItems: "center", justifyContent: "center", backdropFilter: "blur(4px)" }}>
      <div style={{ background: "var(--surface-2)", border: "1px solid rgba(248,113,113,0.4)", borderRadius: 16, padding: "28px", width: 420, boxShadow: "0 24px 64px rgba(0,0,0,0.6)" }}>
        <div style={{ width: 44, height: 44, borderRadius: 12, background: "rgba(248,113,113,0.12)", border: "1px solid rgba(248,113,113,0.3)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 20, marginBottom: 16 }}>🗑️</div>
        <div style={{ fontWeight: 800, fontSize: 17, marginBottom: 6 }}>Elimina ticket</div>
        <div style={{ fontSize: 13, color: "var(--text-muted)", marginBottom: 18, lineHeight: 1.5 }}>Inserisci il motivo dell&apos;eliminazione. Il dato viene salvato nel log di sistema per tracciabilità.</div>
        <textarea value={reason} onChange={e => setReason(e.target.value)}
          placeholder="Es. Ticket duplicato, lavoro annullato, fuori contratto..."
          rows={3} autoFocus
          style={{ width: "100%", background: "var(--border-subtle)", border: "1px solid rgba(248,113,113,0.2)", borderRadius: 8, color: "var(--text-primary)", padding: "10px 13px", fontSize: 13, resize: "none", outline: "none", boxSizing: "border-box", fontFamily: "inherit" }} />
        {!valid && reason.length > 0 && (
          <div style={{ fontSize: 11, color: "#f87171", marginTop: 6 }}>Inserisci almeno 5 caratteri.</div>
        )}
        <div style={{ display: "flex", gap: 10, marginTop: 20, justifyContent: "flex-end" }}>
          <button onClick={onCancel} style={{ padding: "8px 18px", background: "transparent", border: "1px solid var(--border-default)", color: "var(--text-muted)", borderRadius: 8, cursor: "pointer", fontSize: 13 }}>Annulla</button>
          <button disabled={!valid} onClick={() => valid && onConfirm(reason.trim())}
            style={{ padding: "8px 22px", background: valid ? "linear-gradient(135deg,#ef4444,#dc2626)" : "var(--border-subtle)", color: valid ? "#fff" : "var(--text-disabled)", border: "none", borderRadius: 8, cursor: valid ? "pointer" : "not-allowed", fontWeight: 700, fontSize: 13 }}>
            Conferma Eliminazione
          </button>
        </div>
      </div>
    </div>
  );
}

// ── ButtonPicker: sostituisce i <select> per valori a scelta limitata ────────
// Ogni opzione è un pulsante colorato; quello attivo è evidenziato con bordo e sfondo.

function ButtonPicker({
  options,
  value,
  onChange,
}: {
  options: { value: string; label: string; color: string }[];
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <div style={{ display: "flex", gap: 4, flexWrap: "wrap", marginTop: 4 }}>
      {options.map(opt => {
        const active = opt.value === value;
        return (
          <button
            key={opt.value}
            type="button"
            onClick={() => onChange(opt.value)}
            style={{
              padding: "5px 13px",
              fontSize: 12,
              fontWeight: 700,
              borderRadius: 6,
              cursor: "pointer",
              border: active
                ? `1px solid ${opt.color}88`
                : "1px solid rgba(255,255,255,0.08)",
              background: active
                ? `${opt.color}22`
                : "var(--border-subtle)",
              color: active ? opt.color : "var(--text-muted)",
              transition: "all 0.15s",
              letterSpacing: "0.3px",
            }}
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}

// ── Modale dettaglio ticket ───────────────────────────────────────────────

type DetailModalProps = {
  ticket: Ticket;
  onClose: () => void;
  onSaved: () => void;
};

function DetailModal({ ticket, onClose, onSaved }: DetailModalProps) {
  const [stato, setStato] = useState(ticket.stato);
  const [assetStato, setAssetStato] = useState(ticket.asset_stato ?? "");
  const [plannedStart, setPlannedStart] = useState(toDatetimeLocal(ticket.planned_start));
  const [plannedFinish, setPlannedFinish] = useState(toDatetimeLocal(ticket.planned_finish));
  const [durataOre, setDurataOre] = useState(ticket.durata_stimata_ore || 1);

  // Tecnico assegnato — obbligatorio quando stato = Pianificato
  const [tecnicoId, setTecnicoId] = useState<number | null>(ticket.tecnico_id ?? null);
  const [tecnicoList, setTecnicoList] = useState<{ id: number; nome: string; cognome: string; specializzazione?: string }[]>([]);
  useEffect(() => {
    apiGet<{ items?: { id: number; nome: string; cognome: string; specializzazione?: string }[] }>("/tecnici?limit=200")
      .then(d => setTecnicoList(d.items ?? (Array.isArray(d) ? (d as unknown as { id: number; nome: string; cognome: string; specializzazione?: string }[]) : [])))
      .catch(() => {});
  }, []);

  // M2.2 — Ricambi
  const [ricambioNote, setRicambioNote] = useState(ticket.ricambio_note ?? "");
  const [inAttesaRicambio, setInAttesaRicambio] = useState(ticket.in_attesa_ricambio ?? false);
  const [ricambiOpen, setRicambiOpen] = useState(!!(ticket.in_attesa_ricambio || ticket.ricambio_note));
  const [savingRicambio, setSavingRicambio] = useState(false);

  // Auto-calcolo fine pianificata — usa helper locale per evitare bug timezone
  useEffect(() => {
    if (plannedStart && durataOre) {
      const hours = parseFloat(durataOre.toString());
      if (!isNaN(hours) && hours > 0) {
        setPlannedFinish(addHoursToDatetimeLocal(plannedStart, hours));
      }
    }
  }, [plannedStart, durataOre]);

  const [executionStart, setExecutionStart] = useState(toDatetimeLocal(ticket.execution_start));
  const [executionFinish, setExecutionFinish] = useState(toDatetimeLocal(ticket.execution_finish));
  const [saving, setSaving] = useState(false);
  const [showAssetDialog, setShowAssetDialog] = useState(false);
  const [showEliminaDialog, setShowEliminaDialog] = useState(false);
  const [eliminaNote, setEliminaNote] = useState("");

  // Automazione: Cambio Stato
  function handleStatoChange(s: string) {
    setStato(s);
    // Se torna ad Aperto, pulisci pianificazione
    if (s === "Aperto") {
      setPlannedStart("");
      setPlannedFinish("");
    }
    // Se passa a In Corso, imposta inizio se vuoto
    if (s === "In corso") {
      if (!executionStart) setExecutionStart(nowDatetimeLocal());
      setAssetStato("stopped");
    }
    // Se passa a Chiuso, imposta fine se vuoto
    if (s === "Chiuso") {
      if (!executionFinish) setExecutionFinish(nowDatetimeLocal());
      setAssetStato("service");
    }
  }

  // Automazione: Cambio Data Pianificazione
  function handlePlannedChange(start: string) {
    setPlannedStart(start);
    if (start) {
      if (stato === "Aperto") setStato("Pianificato");
      // Auto-calcola fine basata su durata corrente (ora locale, no UTC drift)
      setPlannedFinish(addHoursToDatetimeLocal(start, durataOre));
    }
  }

  // Quando la durata cambia, ricalcola planned_finish se c'è un inizio
  function handleDurataChange(v: number) {
    setDurataOre(v);
    if (plannedStart) {
      setPlannedFinish(addHoursToDatetimeLocal(plannedStart, v));
    }
  }

  // Funzioni di Pianificazione Rapida
  function quickPlan(hoursFromNow: number = 0, hourOfDay?: number) {
    const d = new Date();
    if (hourOfDay !== undefined) {
      d.setHours(hourOfDay, 0, 0, 0);
      if (hoursFromNow > 0) d.setDate(d.getDate() + 1);
    } else {
      d.setMinutes(d.getMinutes() + 15); // Un po' di margine
    }
    // Usa ora locale (non UTC) per l'input datetime-local
    handlePlannedChange(`${d.getFullYear()}-${_pad(d.getMonth() + 1)}-${_pad(d.getDate())}T${_pad(d.getHours())}:${_pad(d.getMinutes())}`);
  }

  async function doSave(assetStatoOverride?: string, elimNoteOverride?: string) {
    setSaving(true);
    try {
      const body: Record<string, unknown> = { stato, durata_stimata_ore: durataOre };
      const as = assetStatoOverride !== undefined ? assetStatoOverride : assetStato;
      if (as) body.asset_stato = as;
      if (elimNoteOverride) body.eliminazione_note = elimNoteOverride;

      if (stato === "Pianificato") { body.is_manual_plan = true; body.tecnico_id = tecnicoId; }
      if (stato === "Aperto") { body.is_manual_plan = false; body.tecnico_id = null; }

      // Invia datetime naive in ora locale (convenzione backend) — niente toISOString/UTC
      body.planned_start = datetimeLocalToApi(plannedStart);
      body.planned_finish = datetimeLocalToApi(plannedFinish);
      body.execution_start = datetimeLocalToApi(executionStart);
      body.execution_finish = datetimeLocalToApi(executionFinish);

      await apiPut(`/tickets/${ticket.id}`, body);
      onSaved();
      onClose();
    } catch {
      notify.error("Errore nel salvataggio.");
    } finally { setSaving(false); }
  }

  async function saveRicambio() {
    setSavingRicambio(true);
    try {
      await apiPost(`/tickets/${ticket.id}/ricambio-usato`, {
        ricambio_note: ricambioNote.trim() || null,
        in_attesa_ricambio: inAttesaRicambio,
      });
      notify.success("Ricambio aggiornato.");
      onSaved();
    } catch {
      notify.error("Errore nel salvataggio ricambio.");
    } finally {
      setSavingRicambio(false);
    }
  }

  function handleSave() {
    // Pianificato richiede data + tecnico obbligatoriamente
    if (stato === "Pianificato" && !plannedStart) {
      notify.error("Inserisci la data di inizio pianificazione per portare il ticket in 'Pianificato'.");
      return;
    }
    if (stato === "Pianificato" && !tecnicoId) {
      notify.error("Assegna un tecnico per portare il ticket in 'Pianificato'.");
      return;
    }
    // Validazione date: fine non può precedere inizio
    if (plannedStart && plannedFinish && new Date(plannedFinish) < new Date(plannedStart)) {
      notify.error("La data di fine pianificazione non può precedere quella di inizio.");
      return;
    }
    if (executionStart && executionFinish && new Date(executionFinish) < new Date(executionStart)) {
      notify.error("La data di fine esecuzione non può precedere quella di inizio.");
      return;
    }
    if (stato === "Eliminato") { setShowEliminaDialog(true); return; }
    if (stato === "Chiuso") setShowAssetDialog(true);
    else doSave();
  }

  return (
    <div style={{ position: "relative", width: "100%", color: "var(--text-primary)", display: "flex", flexDirection: "column" }}>
      <div style={{ padding: "0" }}>
        <div style={{ marginBottom: 32 }}>
          <label style={{ ...modalLabel, fontSize: 11, marginBottom: 12 }}>Stato Corrente</label>
          <StatusToggle 
            size="lg"
            currentValue={stato}
            onChange={(s) => handleStatoChange(s)}
            options={[
              { value: "Aperto", label: "Aperto", color: "#60a5fa" },
              { value: "Pianificato", label: "Pianificato", color: "#a78bfa" },
              { value: "In corso", label: "In corso", color: "#fbbf24" },
              { value: "Chiuso", label: "Chiuso", color: "#34d399" },
              { value: "Eliminato", label: "Eliminato", color: "#f87171" },
            ]}
          />
        </div>

        {/* Sezione Pianificazione */}
        <div style={{ marginBottom: 32, padding: 20, background: "var(--border-subtle)", borderRadius: 12, border: "1px solid var(--border-subtle)" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
             <label style={{ ...modalLabel, margin: 0 }}>Pianificazione Intervento</label>
             <div style={{ display: "flex", gap: 6 }}>
                <button onClick={() => quickPlan(0, 8)} style={{ fontSize: 10, padding: "4px 8px", background: "rgba(59,130,246,0.1)", color: "#60a5fa", border: "1px solid rgba(59,130,246,0.2)", borderRadius: 6, cursor: "pointer", fontWeight: 600 }}>OGGI 08:00</button>
                <button onClick={() => quickPlan(1, 8)} style={{ fontSize: 10, padding: "4px 8px", background: "var(--border-subtle)", color: "var(--text-soft)", border: "1px solid var(--border-default)", borderRadius: 6, cursor: "pointer", fontWeight: 600 }}>DOMANI</button>
             </div>
          </div>

          {/* Durata prevista */}
          <div style={{ marginBottom: 16 }}>
            <label style={{ fontSize: 10, color: "var(--text-muted)", marginBottom: 8, display: "block" }}>Durata Prevista</label>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <input type="number" min={0.1} step={0.5} value={durataOre}
                onChange={e => handleDurataChange(parseFloat(e.target.value) || 1)}
                style={{ ...dtInput, width: 80 }} />
              <span style={{ fontSize: 12, color: "var(--text-muted)", flexShrink: 0 }}>ore</span>
              {[1, 2, 4, 8].map(h => (
                <button key={h} onClick={() => handleDurataChange(h)}
                  style={{ fontSize: 11, padding: "3px 9px", background: durataOre === h ? "rgba(167,139,250,0.15)" : "var(--border-subtle)", color: durataOre === h ? "#a78bfa" : "var(--text-muted)", border: `1px solid ${durataOre === h ? "rgba(167,139,250,0.35)" : "rgba(255,255,255,0.07)"}`, borderRadius: 6, cursor: "pointer", fontWeight: 600 }}>
                  {h}h
                </button>
              ))}
            </div>
            {/* M2.1 — Badge costo fermo stimato */}
            {ticket.costo_fermo_stimato != null && ticket.costo_fermo_stimato > 0 && (
              <div style={{ marginTop: 8, display: "inline-flex", alignItems: "center", gap: 6, padding: "5px 12px", borderRadius: 8, background: "rgba(245,158,11,0.10)", border: "1px solid rgba(245,158,11,0.30)", color: "#fbbf24", fontSize: 12, fontWeight: 700 }}>
                <span>⚠</span>
                Fermo stimato: €{ticket.costo_fermo_stimato.toLocaleString("it-IT", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
              </div>
            )}
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
            <div>
              <label style={{ fontSize: 10, color: "var(--text-muted)", marginBottom: 6, display: "block" }}>
                Inizio Pianificato {stato === "Pianificato" && !plannedStart && <span style={{ color: "#f87171" }}>*</span>}
              </label>
              <input type="datetime-local" style={{ ...dtInput, borderColor: stato === "Pianificato" && !plannedStart ? "rgba(248,113,113,0.5)" : undefined }} value={plannedStart} onChange={e => handlePlannedChange(e.target.value)} />
            </div>
            <div>
              <label style={{ fontSize: 10, color: "var(--text-muted)", marginBottom: 6, display: "block" }}>Fine Pianificata</label>
              <input type="datetime-local" style={dtInput} value={plannedFinish} onChange={e => setPlannedFinish(e.target.value)} />
            </div>
          </div>
          {stato === "Pianificato" && !plannedStart && (
            <div style={{ fontSize: 11, color: "#f87171", marginTop: 8 }}>La data di inizio è obbligatoria per lo stato Pianificato.</div>
          )}

          {/* Tecnico assegnato — obbligatorio per Pianificato */}
          <div style={{ marginTop: 16 }}>
            <label style={{ fontSize: 10, color: "var(--text-muted)", marginBottom: 6, display: "flex", alignItems: "center", gap: 4 }}>
              Tecnico assegnato
              {stato === "Pianificato" && <span style={{ color: "#f87171", fontWeight: 800 }}>*</span>}
            </label>
            <select
              value={tecnicoId ?? ""}
              onChange={e => setTecnicoId(e.target.value ? Number(e.target.value) : null)}
              style={{
                ...dtInput,
                borderColor: stato === "Pianificato" && !tecnicoId ? "rgba(248,113,113,0.5)" : undefined,
                color: tecnicoId ? "var(--text-primary)" : "var(--text-muted)",
              }}
            >
              <option value="">— Nessun tecnico assegnato —</option>
              {tecnicoList.map(t => (
                <option key={t.id} value={t.id}>
                  {t.nome} {t.cognome}{t.specializzazione ? ` · ${t.specializzazione}` : ""}
                </option>
              ))}
            </select>
            {stato === "Pianificato" && !tecnicoId && (
              <div style={{ fontSize: 11, color: "#f87171", marginTop: 4 }}>⚠ Tecnico obbligatorio per pianificare</div>
            )}
          </div>
        </div>

        <div style={{ marginBottom: 32 }}>
          <label style={{ ...modalLabel, fontSize: 11, marginBottom: 10 }}>Stato asset</label>
          <ButtonPicker
            options={ASSET_STATE_OPTIONS}
            value={assetStato}
            onChange={setAssetStato}
          />
        </div>

        {/* Sezione Esecuzione Dinamica */}
        <div style={{ marginBottom: 32 }}>
          <label style={{ ...modalLabel, marginBottom: 16 }}>Dati di Esecuzione Personale</label>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
            <div style={{ position: "relative" }}>
              <label style={{ fontSize: 10, color: "var(--text-muted)", marginBottom: 6, display: "block" }}>Inizio Reale</label>
              <input type="datetime-local" style={{ ...dtInput, border: executionStart ? "1px solid rgba(251,191,36,0.4)" : dtInput.border }} value={executionStart} onChange={e => {setExecutionStart(e.target.value); if(e.target.value && stato !== "In corso") setStato("In corso");}} />
              {!executionStart && (
                <button onClick={() => { setExecutionStart(nowDatetimeLocal()); setStato("In corso"); }}
                  style={{ position: "absolute", right: 10, top: 28, fontSize: 9, padding: "2px 6px", background: "#fbbf24", color: "#000", border: "none", borderRadius: 4, cursor: "pointer", fontWeight: 800 }}>
                  INIZIA ORA
                </button>
              )}
            </div>
            <div style={{ position: "relative" }}>
              <label style={{ fontSize: 10, color: "var(--text-muted)", marginBottom: 6, display: "block" }}>Fine Reale</label>
              <input type="datetime-local" style={{ ...dtInput, border: executionFinish ? "1px solid rgba(52,211,153,0.4)" : dtInput.border }} value={executionFinish} onChange={e => {setExecutionFinish(e.target.value); if(e.target.value && stato !== "Chiuso") setStato("Chiuso");}} />
              {!executionFinish && (
                <button onClick={() => { setExecutionFinish(nowDatetimeLocal()); setStato("Chiuso"); }}
                  style={{ position: "absolute", right: 10, top: 28, fontSize: 9, padding: "2px 6px", background: "#34d399", color: "#000", border: "none", borderRadius: 4, cursor: "pointer", fontWeight: 800 }}>
                  CHIUDI ORA
                </button>
              )}
            </div>
          </div>
        </div>

        {/* Descrizione & Allegati */}
        {ticket.descrizione && (
          <div style={{ marginBottom: 24 }}>
             <label style={modalLabel}>Descrizione / Note</label>
             <div style={{ fontSize: 13, color: "var(--text-soft)", lineHeight: 1.6, padding: "12px 16px", background: "var(--border-subtle)", borderRadius: 8, border: "1px solid var(--border-subtle)" }}>
                {ticket.descrizione}
             </div>
             {ticket.is_manual_plan && ticket.stato === "Pianificato" && (
               <div style={{ fontSize: 9, color: "#eab308", marginTop: 4, fontWeight: 700 }}>MANUALE</div>
             )}
          </div>
        )}

        {/* Allegati */}
        <div style={{ marginBottom: 10 }}>
          <label style={{ ...modalLabel, marginBottom: 12 }}>Dati e Foto Intervento</label>
          <div style={{ padding: "8px", background: "var(--border-subtle)", borderRadius: 12, border: "1px dashed var(--border-default)" }}>
            <UploadAllegati ticketId={ticket.id} />
          </div>
        </div>

        {/* M2.2 — Sezione Ricambi collassabile */}
        <div style={{ marginTop: 16 }}>
          <button
            type="button"
            onClick={() => setRicambiOpen(o => !o)}
            style={{
              width: "100%", display: "flex", alignItems: "center", justifyContent: "space-between",
              padding: "10px 16px", borderRadius: ricambiOpen ? "8px 8px 0 0" : 8,
              background: inAttesaRicambio ? "rgba(239,68,68,0.08)" : "var(--border-subtle)",
              border: inAttesaRicambio ? "1px solid rgba(239,68,68,0.35)" : "1px solid var(--border-default)",
              color: inAttesaRicambio ? "#fca5a5" : "var(--text-soft)",
              cursor: "pointer", fontWeight: 700, fontSize: 12, textAlign: "left",
            }}
          >
            <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <span>🔧</span>
              Ricambi
              {inAttesaRicambio && (
                <span style={{ fontSize: 10, padding: "2px 8px", borderRadius: 4, background: "rgba(239,68,68,0.18)", color: "#f87171", border: "1px solid rgba(239,68,68,0.4)", fontWeight: 800 }}>IN ATTESA</span>
              )}
            </span>
            <span style={{ fontSize: 10, color: "var(--text-muted)" }}>{ricambiOpen ? "▲" : "▼"}</span>
          </button>
          {ricambiOpen && (
            <div style={{ padding: "16px", background: "var(--border-subtle)", border: "1px solid var(--border-default)", borderTop: "none", borderRadius: "0 0 8px 8px", display: "flex", flexDirection: "column", gap: 14 }}>
              {/* Toggle in attesa ricambio */}
              <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                <button
                  type="button"
                  role="switch"
                  aria-checked={inAttesaRicambio}
                  onClick={() => setInAttesaRicambio(v => !v)}
                  style={{
                    width: 40, height: 22, borderRadius: 11, border: "none", cursor: "pointer", flexShrink: 0,
                    background: inAttesaRicambio ? "#ef4444" : "#334155",
                    position: "relative", transition: "background 0.2s",
                  }}
                >
                  <span style={{
                    position: "absolute", top: 2, left: inAttesaRicambio ? 20 : 2,
                    width: 18, height: 18, borderRadius: "50%", background: "#fff",
                    transition: "left 0.2s",
                  }} />
                </button>
                <div>
                  <div style={{ fontSize: 13, fontWeight: 600, color: inAttesaRicambio ? "#fca5a5" : "var(--text-soft)" }}>In attesa ricambio</div>
                  <div style={{ fontSize: 11, color: "var(--text-muted)" }}>Il ticket è bloccato in attesa di un ricambio</div>
                </div>
              </div>
              {/* Note ricambio */}
              <div>
                <label style={{ ...modalLabel, marginBottom: 6 }}>Note ricambio</label>
                <textarea
                  value={ricambioNote}
                  onChange={e => setRicambioNote(e.target.value)}
                  rows={3}
                  placeholder="Es. Guarnizione flangia DN50 — codice fornitore X123..."
                  style={{ width: "100%", background: "var(--surface-2)", border: "1px solid rgba(148,163,184,0.2)", borderRadius: 7, color: "var(--text-primary)", padding: "8px 12px", fontSize: 13, outline: "none", resize: "none", boxSizing: "border-box", fontFamily: "inherit" }}
                />
              </div>
              {/* Pulsante salva ricambi */}
              <div style={{ display: "flex", justifyContent: "flex-end" }}>
                <button
                  type="button"
                  onClick={saveRicambio}
                  disabled={savingRicambio}
                  style={{ padding: "7px 20px", borderRadius: 7, background: savingRicambio ? "var(--border-subtle)" : "linear-gradient(135deg,#f59e0b,#d97706)", border: "none", color: "#000", fontWeight: 700, fontSize: 12, cursor: savingRicambio ? "not-allowed" : "pointer" }}
                >
                  {savingRicambio ? "Salvataggio…" : "Salva Ricambi"}
                </button>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Footer sticky-style */}
      <div style={{ padding: "20px 28px", background: "var(--border-subtle)", borderTop: "1px solid var(--border-subtle)", display: "flex", justifyContent: "flex-end", gap: 12 }}>
        <Button
          variant="outline"
          onClick={() => setShowEliminaDialog(true)}
          style={{ borderColor: "rgba(248,113,113,0.4)", color: "#f87171", marginRight: "auto" }}
        >
          🗑 Elimina
        </Button>
        <Button variant="outline" onClick={onClose} style={{ borderColor: "var(--border-default)", color: "var(--text-muted)" }}>Annulla</Button>
        <Button onClick={handleSave} disabled={saving}
          style={{ background: "linear-gradient(135deg,#3b82f6,#2563eb)", minWidth: 120, fontWeight: 700, boxShadow: "0 4px 12px rgba(59,130,246,0.3)" }}>
          {saving ? "Salvataggio…" : "Salva Modifiche"}
        </Button>
      </div>

      {/* Sub-modal: motivo eliminazione */}
      {showEliminaDialog && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="elimina-ticket-title"
          style={{ position: "fixed", inset: 0, zIndex: 10000, display: "flex", alignItems: "center", justifyContent: "center", background: "rgba(0,0,0,0.72)", backdropFilter: "blur(4px)" }}
          onClick={(e) => { if (e.target === e.currentTarget) { setShowEliminaDialog(false); setEliminaNote(""); } }}
        >
          <div style={{ width: "min(420px, calc(100vw - 32px))", background: "var(--surface-2)", border: "1px solid rgba(248,113,113,0.3)", borderRadius: 16, padding: 24, boxShadow: "0 24px 64px rgba(0,0,0,0.55)" }}>
            <div style={{ fontSize: 10, textTransform: "uppercase", letterSpacing: ".14em", color: "#f87171", fontWeight: 700 }}>Eliminazione ticket #{ticket.id}</div>
            <h3 id="elimina-ticket-title" style={{ fontSize: 18, fontWeight: 800, margin: "8px 0 0" }}>Motivo eliminazione</h3>
            <p style={{ margin: "8px 0 16px", fontSize: 13, color: "var(--text-soft)", lineHeight: 1.5 }}>
              Il motivo è obbligatorio e verrà salvato nel log di sistema per tracciabilità.
            </p>
          <textarea value={eliminaNote} onChange={e => setEliminaNote(e.target.value)}
            placeholder="Es. Ticket duplicato, lavoro annullato, fuori contratto..." rows={3} autoFocus
            style={{ width: "100%", background: "var(--border-subtle)", border: "1px solid rgba(248,113,113,0.2)", borderRadius: 8, color: "var(--text-primary)", padding: "10px 13px", fontSize: 13, resize: "none", outline: "none", boxSizing: "border-box", fontFamily: "inherit" }} />
          {eliminaNote.trim().length > 0 && eliminaNote.trim().length < 5 && (
            <div style={{ fontSize: 11, color: "#f87171", marginTop: 6 }}>Inserisci almeno 5 caratteri.</div>
          )}
          <div style={{ display: "flex", gap: 10, marginTop: 16, justifyContent: "flex-end" }}>
            <Button variant="ghost" onClick={() => { setShowEliminaDialog(false); setEliminaNote(""); }} style={{ color: "var(--text-muted)" }}>Annulla</Button>
            <Button
              disabled={eliminaNote.trim().length < 5}
              onClick={() => { if (eliminaNote.trim().length >= 5) { setShowEliminaDialog(false); doSave(undefined, eliminaNote.trim()); } }}
              style={{ background: eliminaNote.trim().length >= 5 ? "linear-gradient(135deg,#ef4444,#dc2626)" : "var(--border-subtle)", color: eliminaNote.trim().length >= 5 ? "#fff" : "var(--text-disabled)", fontWeight: 700 }}>
              Conferma Eliminazione
            </Button>
          </div>
          </div>
        </div>
      )}

      {/* Sub-modal: stato asset alla chiusura */}
      {showAssetDialog && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="asset-ticket-title"
          style={{ position: "fixed", inset: 0, zIndex: 10000, display: "flex", alignItems: "center", justifyContent: "center", background: "rgba(0,0,0,0.72)", backdropFilter: "blur(4px)" }}
          onClick={(e) => { if (e.target === e.currentTarget) setShowAssetDialog(false); }}
        >
          <div style={{ width: "min(420px, calc(100vw - 32px))", background: "var(--surface-2)", border: "1px solid rgba(59,130,246,0.3)", borderRadius: 16, padding: 24, boxShadow: "0 24px 64px rgba(0,0,0,0.55)" }}>
            <div style={{ fontSize: 10, textTransform: "uppercase", letterSpacing: ".14em", color: "#3b82f6", fontWeight: 700 }}>Chiusura ticket #{ticket.id}</div>
            <h3 id="asset-ticket-title" style={{ fontSize: 18, fontWeight: 800, margin: "8px 0 0" }}>
              Verifica Stato Asset
            </h3>
            <p style={{ margin: "8px 0 16px", fontSize: 13, color: "var(--text-soft)", lineHeight: 1.5 }}>
              Il ticket è concluso. In che stato si trova l&apos;asset <strong style={{ color: "var(--text-primary)" }}>{ticket.asset_name ?? `#${ticket.asset_id}`}</strong>?
            </p>
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            <button onClick={() => { setShowAssetDialog(false); doSave("service"); }}
              style={{ display: "flex", alignItems: "center", gap: 14, padding: "14px 18px", background: "rgba(52,211,153,0.06)", border: "1px solid rgba(52,211,153,0.25)", borderRadius: 12, cursor: "pointer", textAlign: "left" }}>
              <span style={{ fontSize: 22 }}>✅</span>
              <div>
                <div style={{ fontWeight: 700, fontSize: 14, color: "#34d399" }}>OPERATIVO</div>
                <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 2 }}>L&apos;asset è pronto e funzionante.</div>
              </div>
            </button>
            <button onClick={() => { setShowAssetDialog(false); doSave("stopped"); }}
              style={{ display: "flex", alignItems: "center", gap: 14, padding: "14px 18px", background: "rgba(251,191,36,0.06)", border: "1px solid rgba(251,191,36,0.25)", borderRadius: 12, cursor: "pointer", textAlign: "left" }}>
              <span style={{ fontSize: 22 }}>⏸️</span>
              <div>
                <div style={{ fontWeight: 700, fontSize: 14, color: "#fbbf24" }}>FERMO PROG.</div>
                <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 2 }}>Asset in attesa di ulteriori verifiche.</div>
              </div>
            </button>
            <button onClick={() => { setShowAssetDialog(false); doSave("out of service"); }}
              style={{ display: "flex", alignItems: "center", gap: 14, padding: "14px 18px", background: "rgba(248,113,113,0.06)", border: "1px solid rgba(248,113,113,0.25)", borderRadius: 12, cursor: "pointer", textAlign: "left" }}>
              <span style={{ fontSize: 22 }}>🔴</span>
              <div>
                <div style={{ fontWeight: 700, fontSize: 14, color: "#f87171" }}>GUASTO</div>
                <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 2 }}>L&apos;asset richiede ulteriori interventi.</div>
              </div>
            </button>
          </div>
          <Button variant="ghost" className="w-full mt-2" onClick={() => { setShowAssetDialog(false); doSave(""); }} style={{ color: "var(--text-muted)", fontSize: 12 }}>
            Mantieni stato attuale
          </Button>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Pagina principale ─────────────────────────────────────────────────────

export default function TicketPage() {
  const { isModuleEnabled } = useAuth();
  const [result, setResult] = useState<PagedResult | null>(null);
  const [archivio, setArchivio] = useState<PagedResult | null>(null);
  const [kanbanTickets, setKanbanTickets] = useState<KanbanTicket[]>([]);
  const [assets, setAssets] = useState<Asset[]>([]);
  const [tab, setTab] = useState<"attivi" | "archivio">("attivi");
  const [page, setPage] = useState(1);
  const [pageArch, setPageArch] = useState(1);
  const LIMIT = 10;

  // Full-load per filtri colonna (quando un filtro è attivo carichiamo tutti i ticket
  // e lasciamo che DataTable impagini lato client)
  const [allTicketsForFilter, setAllTicketsForFilter] = useState<Ticket[] | null>(null);
  const [loadingAllFilter, setLoadingAllFilter] = useState(false);

  async function handleFiltersChange(filters: import("@tanstack/react-table").ColumnFiltersState) {
    const hasActive = filters.some(f => {
      if (!f.value && f.value !== 0) return false;
      if (typeof f.value === "string") return f.value.length > 0;
      if (typeof f.value === "object" && f.value !== null) {
        const fv = f.value as Record<string, unknown>;
        return !!fv.preset && fv.preset !== "";
      }
      return false;
    });

    if (hasActive) {
      if (allTicketsForFilter === null && !loadingAllFilter) {
        setLoadingAllFilter(true);
        try {
          const d = await apiGet<PagedResult>(`/tickets?page=1&limit=2000&stato=${STATI_ATTIVI.join(",")}`);
          setAllTicketsForFilter(d.items ?? []);
        } catch {
          notify.error("Errore caricamento ticket per filtro.");
        } finally {
          setLoadingAllFilter(false);
        }
      }
    } else {
      setAllTicketsForFilter(null);
    }
  }


  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [ctxMenu, setCtxMenu] = useState<{ x: number; y: number; ticketId: number; statoCorrente: string } | null>(null);
  const [detailTicket, setDetailTicket] = useState<Ticket | null>(null);
  const [showEmergencyMap, setShowEmergencyMap] = useState(false);
  const [pianificaModal, setPianificaModal] = useState<{ onConfirm: (date: string, tecnicoId: number) => void } | null>(null);
  const [eliminaModal, setEliminaModal] = useState<{ onConfirm: (reason: string) => void } | null>(null);

  // Traccia ticket già aperti per badge "NEW"
  const [seenTicketIds, setSeenTicketIds] = useState<Set<number>>(new Set());
  useEffect(() => {
    try {
      const saved = localStorage.getItem("maintai_seen_tickets");
      if (saved) setSeenTicketIds(new Set(JSON.parse(saved) as number[]));
    } catch {}
  }, []);
  function markSeen(id: number) {
    setSeenTicketIds(prev => {
      if (prev.has(id)) return prev;
      const next = new Set(prev);
      next.add(id);
      try { localStorage.setItem("maintai_seen_tickets", JSON.stringify([...next])); } catch {}
      return next;
    });
  }

  // New ticket form
  const [titolo, setTitolo] = useState("");
  const [assetId, setAssetId] = useState<number>(0);
  const [priorita, setPriorita] = useState("Media");
  const [tipo, setTipo] = useState("CM");
  const [assetStato, setAssetStato] = useState("");
  const [stato, setStato] = useState("Aperto");
  const [durataOre, setDurataOre] = useState(2);
  const [fascia, setFascia] = useState("diurna");
  const [plannedStart, setPlannedStart] = useState("");
  const [plannedFinish, setPlannedFinish] = useState("");
  const [updatingId, setUpdatingId] = useState<number | null>(null);
  const [showNuovoTicket, setShowNuovoTicket] = useState(false);
  const [tableOpen, setTableOpen] = useState(true);

  useEffect(() => {
    apiGet<Asset[]>("/assets")
      .then(d => { if (Array.isArray(d)) { setAssets(d); if (d.length > 0) setAssetId(d[0].id); } })
      .catch(() => {});
  }, []);

  useEffect(() => { loadAttivi(page); }, [page]);
  useEffect(() => { if (tab === "archivio") loadArchivio(pageArch); }, [tab, pageArch]);
  useEffect(() => { loadKanban(); }, []);

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    const refresh = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        loadAttivi(page);
        if (tab === "archivio") loadArchivio(pageArch);
        loadKanban();
      }, 150);
    };
    window.addEventListener("maintai:data-changed", refresh);
    window.addEventListener("focus", refresh);
    return () => {
      if (timer) clearTimeout(timer);
      window.removeEventListener("maintai:data-changed", refresh);
      window.removeEventListener("focus", refresh);
    };
  }, [page, pageArch, tab]);

  useEffect(() => {
    function handler() { setCtxMenu(null); }
    document.addEventListener("click", handler);
    return () => document.removeEventListener("click", handler);
  }, []);

  async function loadAttivi(p: number) {
    try {
      const d = await apiGet<PagedResult>(`/tickets?page=${p}&limit=${LIMIT}&stato=${STATI_ATTIVI.join(",")}`);
      setResult(d);
    } catch { notify.error("Errore caricamento ticket."); }
  }

  async function loadArchivio(p: number) {
    try {
      const d = await apiGet<PagedResult>(`/tickets?page=${p}&limit=${LIMIT}&stato=${STATI_ARCHIVIO.join(",")}`);
      setArchivio(d);
    } catch {
      notify.error("Errore caricamento archivio ticket.");
    }
  }

  async function loadKanban() {
    try {
      const d = await apiGet<PagedResult>(`/tickets?page=1&limit=200&stato=${STATI_ATTIVI.join(",")}`);
      setKanbanTickets(d.items);
    } catch { notify.error("Errore caricamento kanban."); }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!titolo.trim()) { notify.error("Il titolo del ticket è obbligatorio."); return; }
    if (!assetId || assetId === 0) { notify.error("Seleziona un asset valido."); return; }
    if (durataOre <= 0) { notify.error("La durata deve essere maggiore di zero."); return; }
    try {
      const autoAssetStato = assetStato || (tipo === "BD" ? "out of service" : stato === "In corso" ? "stopped" : "");
      await apiPost("/tickets", {
        titolo, asset_id: Number(assetId), priorita, stato, tipo, asset_stato: autoAssetStato || null,
        durata_stimata_ore: Number(durataOre), fascia_oraria: fascia,
        planned_start: plannedStart || null,
        planned_finish: plannedFinish || null,
      });
      setTitolo(""); setPriorita("Media"); setTipo("CM"); setAssetStato(""); setStato("Aperto"); setDurataOre(2); setFascia("diurna");
      setPlannedStart(""); setPlannedFinish("");
      loadAttivi(1); setPage(1);
    } catch { notify.error("Errore nel salvataggio ticket."); }
  }

  function statusUpdateError(err: unknown, fallback = "Errore aggiornamento stato.") {
    notify.error(err instanceof Error ? err.message : fallback);
  }

  async function handleStatoChange(ticketId: number, nuovoStato: string) {
    if (nuovoStato === "Pianificato") {
      const t = tickets.find(t => t.id === ticketId) || archivioItems.find(t => t.id === ticketId);
      const durataOre = t?.durata_stimata_ore || 1;
      setPianificaModal({
        onConfirm: async (plannedDate: string, tecnicoId: number) => {
          setPianificaModal(null);
          setUpdatingId(ticketId);
          try {
            const start = datetimeLocalToApi(plannedDate);
            const end = localDatetimeApiStr(new Date(new Date(plannedDate).getTime() + durataOre * 3600000));
            await apiPut(`/tickets/${ticketId}`, { stato: "Pianificato", planned_start: start, planned_finish: end, tecnico_id: tecnicoId, is_manual_plan: true });
            await Promise.all([loadAttivi(page), tab === "archivio" ? loadArchivio(pageArch) : Promise.resolve()]);
          } catch (err) { statusUpdateError(err); }
          finally { setUpdatingId(null); }
        }
      });
      return;
    }
    if (nuovoStato === "Eliminato") {
      setEliminaModal({
        onConfirm: async (reason: string) => {
          setEliminaModal(null);
          setUpdatingId(ticketId);
          try {
            await apiPut(`/tickets/${ticketId}`, { stato: "Eliminato", eliminazione_note: reason });
            await Promise.all([loadAttivi(page), tab === "archivio" ? loadArchivio(pageArch) : Promise.resolve()]);
          } catch (err) { statusUpdateError(err); }
          finally { setUpdatingId(null); }
        }
      });
      return;
    }
    setUpdatingId(ticketId);
    try {
      const body: Record<string, string | null | boolean> = { stato: nuovoStato };
      if (nuovoStato === "Aperto") { body.planned_start = null; body.planned_finish = null; body.is_manual_plan = false; }
      if (nuovoStato === "In corso") {
        body.asset_stato = "stopped";
        body.execution_start = localDatetimeApiStr();
      }
      if (nuovoStato === "Chiuso") {
        body.asset_stato = "service";
        body.execution_finish = localDatetimeApiStr();
      }
      await apiPut(`/tickets/${ticketId}`, body);
      await Promise.all([loadAttivi(page), tab === "archivio" ? loadArchivio(pageArch) : Promise.resolve()]);
    } catch (err) { statusUpdateError(err); }
    finally { setUpdatingId(null); }
  }

  async function bulkUpdateStatus(nuovoStato: string) {
    if (selectedIds.size === 0) return;
    if (nuovoStato === "Pianificato") {
      setPianificaModal({
        onConfirm: async (plannedDate: string, tecnicoId: number) => {
          setPianificaModal(null);
          try {
            const start = datetimeLocalToApi(plannedDate);
            await apiPatch("/tickets/bulk-status", { ids: Array.from(selectedIds), stato: "Pianificato", planned_start: start, tecnico_id: tecnicoId, is_manual_plan: true });
            setSelectedIds(new Set());
            await Promise.all([loadAttivi(page), tab === "archivio" ? loadArchivio(pageArch) : Promise.resolve()]);
          } catch (err) { statusUpdateError(err, "Errore aggiornamento bulk."); }
        }
      });
      return;
    }
    if (nuovoStato === "Eliminato") {
      setEliminaModal({
        onConfirm: async (reason: string) => {
          setEliminaModal(null);
          try {
            await apiPatch("/tickets/bulk-status", { ids: Array.from(selectedIds), stato: "Eliminato", eliminazione_note: reason });
            setSelectedIds(new Set());
            await Promise.all([loadAttivi(page), tab === "archivio" ? loadArchivio(pageArch) : Promise.resolve()]);
            notify.success(`${selectedIds.size} ticket eliminati.`);
          } catch (err) { statusUpdateError(err, "Errore aggiornamento bulk."); }
        }
      });
      return;
    }
    try {
      await apiPatch("/tickets/bulk-status", {
        ids: Array.from(selectedIds),
        stato: nuovoStato,
        asset_stato: nuovoStato === "In corso" ? "stopped" : nuovoStato === "Chiuso" ? "service" : undefined,
        execution_start: nuovoStato === "In corso" ? localDatetimeApiStr() : undefined,
        execution_finish: nuovoStato === "Chiuso" ? localDatetimeApiStr() : undefined,
      });
      setSelectedIds(new Set());
      await Promise.all([loadAttivi(page), tab === "archivio" ? loadArchivio(pageArch) : Promise.resolve()]);
    } catch (err) { statusUpdateError(err, "Errore aggiornamento bulk."); }
  }

  function toggleSelect(id: number) {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  function toggleSelectAll(items: Ticket[]) {
    const allSelected = items.every(t => selectedIds.has(t.id));
    if (allSelected) {
      setSelectedIds(prev => { const next = new Set(prev); items.forEach(t => next.delete(t.id)); return next; });
    } else {
      setSelectedIds(prev => { const next = new Set(prev); items.forEach(t => next.add(t.id)); return next; });
    }
  }

  function handleSaved() {
    loadAttivi(page);
    if (tab === "archivio") loadArchivio(pageArch);
    loadKanban();
  }

  const tickets = result?.items ?? [];
  const archivioItems = archivio?.items ?? [];

  const ticketColumns: ColumnDef<Ticket>[] = [
    {
      id: "select",
      header: () => (
        <input
          type="checkbox"
          checked={tickets.length > 0 && tickets.every(t => selectedIds.has(t.id))}
          onChange={() => toggleSelectAll(tickets)}
          style={{ cursor: "pointer", accentColor: "#818cf8" }}
        />
      ),
      cell: ({ row }) => (
        <div onClick={e => e.stopPropagation()}>
          <input
            type="checkbox"
            checked={selectedIds.has(row.original.id)}
            onChange={() => toggleSelect(row.original.id)}
            style={{ cursor: "pointer", accentColor: "#818cf8" }}
          />
        </div>
      ),
      enableSorting: false,
    },
    { accessorKey: "id", header: "ID" },
    {
      accessorKey: "sito_name",
      header: "Sito",
      cell: ({ getValue }) => {
        const v = getValue<string>();
        return v ? (
          <span style={{
            fontSize: 11, padding: "3px 9px", borderRadius: 6, fontWeight: 700,
            background: "rgba(99,102,241,0.12)", color: "#818cf8",
            border: "1px solid rgba(99,102,241,0.25)", whiteSpace: "nowrap",
          }}>{v}</span>
        ) : <span style={{ color: "var(--text-disabled)" }}>—</span>;
      },
      meta: { filterVariant: "text" },
    },
    {
      accessorKey: "created_at",
      header: "Creato il",
      cell: ({ getValue, row }) => {
        const v = getValue<string>();
        if (!v) return <span style={{ color: "var(--text-disabled)" }}>—</span>;
        const isNew = !seenTicketIds.has(row.original.id);
        return (
          <div style={{ display: "flex", alignItems: "center", gap: 6, position: "relative" }}>
            <span style={{ fontSize: 12, color: "var(--text-muted)", whiteSpace: "nowrap" }}>
              {new Date(v).toLocaleDateString("it-IT", { day: "2-digit", month: "short", year: "numeric" })}
            </span>
            {isNew && (
              <span style={{
                fontSize: 9, fontWeight: 900, padding: "1px 5px", borderRadius: 10,
                background: "#fbbf24", color: "#000",
                border: "1.5px solid #000",
                lineHeight: 1.4,
                letterSpacing: "0.04em",
                boxShadow: "0 0 0 1.5px #fbbf24, 0 1px 4px rgba(0,0,0,0.4)",
                animation: "pulse-bg 2s ease-in-out infinite",
                flexShrink: 0,
              }}>
                NEW
              </span>
            )}
          </div>
        );
      },
      filterFn: dateRangeFilterFn,
      meta: { filterVariant: "date" },
    },
    { accessorKey: "titolo", header: "Titolo", meta: { filterVariant: "text" } },
    {
      accessorKey: "asset_name",
      header: "Asset",
      cell: ({ getValue }) => getValue<string>() ?? "—",
      meta: { filterVariant: "text" },
    },
    {
      accessorKey: "tipo",
      header: "Tipo",
      meta: { filterVariant: "select", options: ["BD", "PM", "CM", "ISP"] },
      cell: ({ row }) => {
        const t = row.original;
        return (
          <div style={{ display: "flex", flexWrap: "wrap", gap: 4, alignItems: "center" }}>
            <span style={{ ...getTipoStyle(t.tipo), fontSize: 10, padding: "2px 7px", borderRadius: 4, fontWeight: 700, letterSpacing: "0.04em" }}>{t.tipo}</span>
            {t.diagnosi_eseguita && <span style={{ fontSize: 10, padding: "1px 6px", borderRadius: 4, background: "rgba(99,102,241,0.15)", color: "#818cf8", border: "1px solid rgba(99,102,241,0.3)", fontWeight: 700 }}>AI</span>}
            {t.parent_id && <span style={{ fontSize: 10, padding: "1px 6px", borderRadius: 4, background: "rgba(16,185,129,0.12)", color: "#6ee7b7", border: "1px solid rgba(16,185,129,0.3)", fontWeight: 700 }}>↳#{t.parent_id}</span>}
            {t.in_attesa_ricambio && <span style={{ fontSize: 10, padding: "1px 6px", borderRadius: 4, background: "rgba(239,68,68,0.15)", color: "#f87171", border: "1px solid rgba(239,68,68,0.35)", fontWeight: 800 }}>RICAMBIO</span>}
          </div>
        );
      },
    },
    {
      accessorKey: "priorita",
      header: "Priorità",
      meta: { filterVariant: "select", options: ["Emergenza", "Alta", "Media", "Bassa"] },
      cell: ({ getValue }) => {
        const p = getValue<string>();
        return <span style={{ ...getPrioritaStyle(p), fontSize: 10, padding: "2px 8px", borderRadius: 4, fontWeight: 700 }}>{p}</span>;
      },
    },
    {
      accessorKey: "stato",
      header: "Stato",
      enableSorting: false,
      cell: ({ row }) => {
        const t = row.original;
        return (
          <span style={{ ...statoStyle(t.stato), fontSize: 11, padding: "3px 10px", borderRadius: 6, fontWeight: 700, whiteSpace: "nowrap" }}>
            {t.stato}
          </span>
        );
      },
      meta: { filterVariant: "select", options: ["Aperto", "Pianificato", "In corso"] },
    },
    { accessorKey: "fascia_oraria", header: "Fascia" },
    {
      accessorKey: "planned_start",
      header: "Pian. Inizio",
      cell: ({ getValue }) => {
        const v = getValue<string | null>();
        if (!v) return <span style={{ fontSize: 11, color: "var(--text-soft)" }}>—</span>;
        const d = new Date(v);
        return (
          <span style={{ fontSize: 11, color: "#a78bfa" }}>
            {d.toLocaleDateString("it-IT", { day: "2-digit", month: "2-digit" })}{" "}
            <span style={{ color: "var(--text-soft)" }}>{d.toLocaleTimeString("it-IT", { hour: "2-digit", minute: "2-digit" })}</span>
          </span>
        );
      },
      filterFn: dateRangeFilterFn,
      meta: { filterVariant: "date" },
    },
    {
      accessorKey: "planned_finish",
      header: "Pian. Fine",
      cell: ({ getValue }) => {
        const v = getValue<string | null>();
        if (!v) return <span style={{ fontSize: 11, color: "var(--text-soft)" }}>—</span>;
        const d = new Date(v);
        return (
          <span style={{ fontSize: 11, color: "#a78bfa" }}>
            {d.toLocaleDateString("it-IT", { day: "2-digit", month: "2-digit" })}{" "}
            <span style={{ color: "var(--text-soft)" }}>{d.toLocaleTimeString("it-IT", { hour: "2-digit", minute: "2-digit" })}</span>
          </span>
        );
      },
      filterFn: dateRangeFilterFn,
      meta: { filterVariant: "date" },
    },
    {
      id: "durata",
      header: "Durata",
      cell: ({ row }) => {
        const t = row.original;
        if (t.planned_start && t.planned_finish) {
          const mins = Math.round((new Date(t.planned_finish).getTime() - new Date(t.planned_start).getTime()) / 60000);
          if (mins > 0) {
            const h = Math.floor(mins / 60);
            const m = mins % 60;
            const label = h > 0 ? `${h}h${m > 0 ? ` ${m}m` : ""}` : `${m}m`;
            return <span style={{ fontSize: 11, color: "#fbbf24" }}>{label}</span>;
          }
        }
        return <span style={{ fontSize: 11, color: "var(--text-soft)" }}>{t.durata_stimata_ore ? `${t.durata_stimata_ore}h*` : "—"}</span>;
      },
    },
    {
      accessorKey: "execution_finish",
      header: "Eseguito",
      cell: ({ getValue }) => {
        const v = getValue<string | null>();
        return <span style={{ fontSize: 11, color: v ? "#34d399" : "var(--text-soft)" }}>{v ? new Date(v).toLocaleDateString("it-IT") : "—"}</span>;
      },
    },
    {
      id: "azioni",
      header: "Azioni",
      enableSorting: false,
      cell: ({ row }) => {
        const t = row.original;
        return (
          <div onClick={e => e.stopPropagation()} style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
            {(t.stato === "Aperto" || t.stato === "Pianificato") && (
              <button
                onClick={() => handleStatoChange(t.id, "In corso")}
                style={{ background: "rgba(6,182,212,0.1)", border: "1px solid rgba(6,182,212,0.3)", color: "#06b6d4", borderRadius: 4, padding: "3px 8px", fontSize: 10, fontWeight: 700, cursor: "pointer", letterSpacing: "0.05em", whiteSpace: "nowrap" }}
              >▶ INIZIA</button>
            )}
            {t.stato === "In corso" && (
              <button
                onClick={() => handleStatoChange(t.id, "Chiuso")}
                style={{ background: "rgba(16,185,129,0.1)", border: "1px solid rgba(16,185,129,0.3)", color: "#10b981", borderRadius: 4, padding: "3px 8px", fontSize: 10, fontWeight: 700, cursor: "pointer", letterSpacing: "0.05em", whiteSpace: "nowrap" }}
              >✓ COMPLETA</button>
            )}
            {isModuleEnabled("diagnostic_ai") && (
              <a href={`/diagnostic?id=${t.id}`} style={{ fontSize: 11, padding: "4px 10px", border: "1px solid rgba(99,102,241,0.4)", color: "#818cf8", textDecoration: "none", borderRadius: 4, display: "inline-block" }}>
                DIAGNOSTICA →
              </a>
            )}
            {t.stato !== "Eliminato" && (
              <button
                onClick={() => handleStatoChange(t.id, "Eliminato")}
                style={{ background: "rgba(248,113,113,0.08)", border: "1px solid rgba(248,113,113,0.3)", color: "#f87171", borderRadius: 4, padding: "3px 8px", fontSize: 10, fontWeight: 700, cursor: "pointer", whiteSpace: "nowrap" }}
                title="Elimina ticket"
              >🗑 ELIMINA</button>
            )}
          </div>
        );
      },
    },
  ];

  // Colonne per la tabella archivio — stato come badge statico colorato
  const archivioColumns: ColumnDef<Ticket>[] = ticketColumns.map(col => {
    if ((col as { accessorKey?: string }).accessorKey === "stato") {
      return {
        accessorKey: "stato",
        header: "Stato",
        enableSorting: false,
        cell: ({ getValue }: { getValue: () => unknown }) => {
          const s = getValue() as string;
          const isEliminato = s === "Eliminato";
          return (
            <span style={{
              fontSize: 10, padding: "2px 8px", borderRadius: 4, fontWeight: 700,
              letterSpacing: "0.05em", textTransform: "uppercase" as const,
              background: isEliminato ? "rgba(248,113,113,0.15)" : "rgba(52,211,153,0.12)",
              color: isEliminato ? "#f87171" : "#34d399",
              border: `1px solid ${isEliminato ? "rgba(248,113,113,0.35)" : "rgba(52,211,153,0.3)"}`,
            }}>
              {s}
            </span>
          );
        },
      } as ColumnDef<Ticket>;
    }
    return col;
  });

  return (
    <div style={{ background: "var(--surface-0)", minHeight: "100%" }}>
      <div className="mb-8" style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div>
          <h1 className="page-title" style={{ marginBottom: 4 }}>Ticket</h1>
          <p className="page-subtitle" style={{ margin: 0 }}>Ticket operativi che alimentano il planner automatico.</p>
        </div>
        <div style={{ display: "flex", gap: 10 }}>
          <button
            type="button"
            onClick={async () => {
              try {
                const r = await apiPost<{ updated: number; total: number }>("/sync-tickets-hierarchy", {});
                notify.success(`Siti sincronizzati: ${r.updated} ticket aggiornati su ${r.total}`);
                loadAttivi(page);
              } catch { notify.error("Errore sincronizzazione siti"); }
            }}
            style={{ padding: "9px 16px", borderRadius: 8, background: "rgba(99,102,241,0.12)", border: "1px solid rgba(99,102,241,0.3)", color: "#818cf8", fontWeight: 700, cursor: "pointer", display: "flex", gap: 8, alignItems: "center", fontSize: 13 }}
          >
            <span>🔗</span> Sincronizza Siti
          </button>
          <button
            type="button"
            onClick={() => {
              window.open(`${API_BASE}/export/tickets`, "_blank", "noopener,noreferrer");
            }}
            style={{ padding: "9px 20px", borderRadius: 8, background: "linear-gradient(135deg, #1d4ed8, #6366f1)", border: "none", color: "#fff", fontWeight: 700, cursor: "pointer", display: "flex", gap: 8, alignItems: "center", fontSize: 13, boxShadow: "0 4px 12px rgba(99,102,241,0.3)" }}
          >
            <span>📊</span> Esporta Excel
          </button>
        </div>
      </div>


      {/* Tab "Nuovo Ticket" */}
      <div style={{ marginBottom: 24 }}>
        <button
          type="button"
          onClick={() => setShowNuovoTicket(v => !v)}
          style={{
            display: "inline-flex", alignItems: "center", gap: 8,
            padding: "9px 20px", borderRadius: showNuovoTicket ? "8px 8px 0 0" : 8,
            background: showNuovoTicket ? "var(--grad-primary)" : "var(--cobalt-dim)",
            border: showNuovoTicket ? "1px solid rgba(139,92,246,0.6)" : "1px solid rgba(99,102,241,0.35)",
            borderBottom: showNuovoTicket ? "none" : undefined,
            color: showNuovoTicket ? "#fff" : "var(--text-accent)",
            fontWeight: 700, fontSize: 13, cursor: "pointer",
            boxShadow: showNuovoTicket ? "0 4px 16px rgba(99,102,241,0.35)" : "none",
            transition: "all 0.2s",
            position: "relative", zIndex: 1,
          }}
        >
          <span style={{ fontSize: 16, lineHeight: 1 }}>{showNuovoTicket ? "×" : "+"}</span>
          Nuovo Ticket
          {!showNuovoTicket && <span style={{ fontSize: 10, opacity: 0.7, marginLeft: 2 }}>▼</span>}
        </button>

        <div
          style={{
            overflow: "hidden",
            maxHeight: showNuovoTicket ? 1000 : 0,
            opacity: showNuovoTicket ? 1 : 0,
            transition: "max-height 0.3s ease, opacity 0.2s ease",
            background: "var(--surface-1)",
            border: showNuovoTicket ? "1px solid rgba(139,92,246,0.4)" : "none",
            borderRadius: "0 8px 8px 8px",
            padding: showNuovoTicket ? "20px 24px" : "0 24px",
          }}
        >
        <form onSubmit={handleSubmit} className="form-grid-3">
          <div className="span-3">
            <label className="label">Titolo</label>
            <input required className="input" value={titolo} onChange={e => setTitolo(e.target.value)} />
          </div>
          <div>
            <select required className="select" value={assetId} onChange={e => setAssetId(Number(e.target.value))}>
              <option value={0}>Seleziona un asset...</option> 
              {assets.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
            </select>
          </div>
          <div>
            <label className="label">Tipo</label>
            <ButtonPicker
              options={[
                { value: "PM",  label: "PM",  color: "#22c55e" },
                { value: "CM",  label: "CM",  color: "#f59e0b" },
                { value: "BD",  label: "BD",  color: "#ef4444" },
                { value: "ISP", label: "ISP", color: "#3b82f6" },
              ]}
              value={tipo}
              onChange={(v) => {
                setTipo(v);
                if (!assetStato) setAssetStato(v === "BD" ? "out of service" : "service");
              }}
            />
          </div>
          <div>
            <label className="label">Priorità</label>
            <ButtonPicker
              options={[
                { value: "Emergenza", label: "EMERG.", color: "#ef4444" },
                { value: "Alta",      label: "Alta",   color: "#fca5a5" },
                { value: "Media",     label: "Media",  color: "#f59e0b" },
                { value: "Bassa",     label: "Bassa",  color: "#22c55e" },
              ]}
              value={priorita}
              onChange={setPriorita}
            />
          </div>
          <div>
            <label className="label">Nuovo stato asset</label>
            <ButtonPicker
              options={ASSET_STATE_OPTIONS}
              value={assetStato}
              onChange={setAssetStato}
            />
          </div>
          <div>
            <label className="label">Stato Ticket</label>
            <StatusToggle
              size="sm"
              currentValue={stato}
              onChange={(s) => setStato(s)}
              options={[
                { value: "Aperto",     label: "Aperto",  color: "#60a5fa" },
                { value: "Pianificato",label: "Pia.",    color: "#a78bfa" },
                { value: "In corso",   label: "In corso",color: "#fbbf24" },
                { value: "Chiuso",     label: "Chiuso",  color: "#34d399" },
                { value: "Eliminato",  label: "Elim.",   color: "#f87171" },
              ]}
            />
          </div>
          <div>
            <label className="label">Durata ore</label>
            <input required min="0.1" step="0.1" className="input" type="number" value={durataOre} onChange={e => setDurataOre(Number(e.target.value))} />
          </div>
          <div>
            <label className="label">Fascia</label>
            <ButtonPicker
              options={[
                { value: "diurna",   label: "Diurna",   color: "#fbbf24" },
                { value: "notturna", label: "Notturna", color: "#818cf8" },
              ]}
              value={fascia}
              onChange={setFascia}
            />
          </div>
          <div>
            <label className="label">Inizio pianificato</label>
            <input className="input" type="datetime-local" value={plannedStart} onChange={e => setPlannedStart(e.target.value)} />
          </div>
          <div>
            <label className="label">Fine pianificata</label>
            <input className="input" type="datetime-local" value={plannedFinish} onChange={e => setPlannedFinish(e.target.value)} />
          </div>
          <div className="span-3">
            <button className="btn-primary" type="submit">Salva ticket</button>
          </div>
        </form>
        </div>
      </div>

      {/* Bulk action bar */}
      {selectedIds.size > 0 && (
        <div style={{ display: "flex", gap: 8, alignItems: "center", padding: "8px 12px", background: "rgba(99,102,241,0.1)", border: "1px solid rgba(99,102,241,0.3)", borderRadius: 8, marginBottom: 12 }}>
          <span style={{ color: "#818cf8", fontSize: 12 }}>{selectedIds.size} selezionati</span>
          {["Pianificato", "In corso", "Chiuso", "Eliminato"].map(s => {
            const sStyle = statoStyle(s);
            return (
              <button key={s} onClick={() => bulkUpdateStatus(s)}
                style={{
                  fontSize: 11, padding: "4px 10px",
                  border: `1px solid ${sStyle.color}55`,
                  color: sStyle.color,
                  background: sStyle.background,
                  cursor: "pointer", borderRadius: 4,
                  fontWeight: 700,
                }}>
                {s}
              </button>
            );
          })}
          <button onClick={() => setSelectedIds(new Set())} style={{ marginLeft: "auto", fontSize: 11, color: "var(--text-muted)", background: "transparent", border: "none", cursor: "pointer" }}>Deseleziona</button>
        </div>
      )}

      {/* Tabs */}
      <div className="pill-tabs">
        {(["attivi", "archivio"] as const).map(t => (
          <button key={t} onClick={() => setTab(t)} className={tab === t ? "active" : ""}>
            {t === "attivi" ? `Attivi (${result?.total ?? 0})` : `Archivio (${archivio?.total ?? 0})`}
          </button>
        ))}
      </div>

      {tab === "attivi" && result === null && (
        <SkeletonTable rows={5} cols={6} />
      )}

      {tab === "attivi" && result !== null && (
        <>
          <button
            onClick={() => setTableOpen(o => !o)}
            style={{
              display: "flex", alignItems: "center", gap: 8, padding: "10px 16px",
              background: "var(--surface-1)", border: "1px solid var(--border-default)",
              borderRadius: 10, cursor: "pointer", color: "var(--text-primary)",
              fontSize: 13, fontWeight: 700, width: "100%", marginBottom: 8,
              transition: "background 0.15s",
            }}
          >
            <span style={{ color: "var(--cobalt-bright)", fontSize: 16 }}>{tableOpen ? "▲" : "▼"}</span>
            {tableOpen ? "Nascondi lista" : "Mostra lista"}
            <span style={{ marginLeft: "auto", fontSize: 12, color: "var(--text-muted)", fontWeight: 500 }}>
              {result?.total ?? 0} ticket
            </span>
          </button>

          {tableOpen && (
            <>
              {loadingAllFilter && (
                <div style={{ fontSize: 12, color: "#818cf8", padding: "8px 4px", display: "flex", alignItems: "center", gap: 8 }}>
                  <span style={{ display: "inline-block", width: 12, height: 12, border: "2px solid #818cf8", borderTopColor: "transparent", borderRadius: "50%", animation: "spin 0.7s linear infinite" }} />
                  Caricamento completo per filtro…
                </div>
              )}
              <DataTable
                data={allTicketsForFilter ?? tickets}
                columns={ticketColumns}
                enableColumnFilters
                onFiltersChange={handleFiltersChange}
                manualPagination={allTicketsForFilter === null}
                pageCount={allTicketsForFilter === null ? (result?.pages ?? 1) : undefined}
                pageIndex={allTicketsForFilter === null ? page - 1 : undefined}
                onPageChange={allTicketsForFilter === null ? (p) => setPage(p + 1) : undefined}
                emptyMessage={loadingAllFilter ? "Caricamento…" : "Nessun ticket attivo"}
                onRowClick={(t) => { markSeen(t.id); setDetailTicket(t); }}
                getRowProps={(t) => ({
                  onContextMenu: (e) => { e.preventDefault(); setCtxMenu({ x: e.clientX, y: e.clientY, ticketId: t.id, statoCorrente: t.stato }); },
                  style: { background: selectedIds.has(t.id) ? "rgba(99,102,241,0.08)" : undefined },
                })}
              />
            </>
          )}
        </>
      )}

      {tab === "archivio" && (
        <>
          <div style={{ color: "rgba(148,163,184,0.7)", fontSize: 12, marginBottom: 12 }}>
            Ticket chiusi ed eliminati — visibili all&apos;AI per analisi storiche.
          </div>
          <DataTable
            data={archivioItems}
            columns={archivioColumns}
            manualPagination
            pageCount={archivio?.pages ?? 1}
            pageIndex={pageArch - 1}
            onPageChange={(p) => setPageArch(p + 1)}
            emptyMessage="Nessun ticket archiviato"
            onRowClick={(t) => { markSeen(t.id); setDetailTicket(t); }}
            getRowProps={(t) => ({
              onContextMenu: (e) => { e.preventDefault(); setCtxMenu({ x: e.clientX, y: e.clientY, ticketId: t.id, statoCorrente: t.stato }); },
              style: { background: selectedIds.has(t.id) ? "rgba(99,102,241,0.08)" : undefined },
            })}
          />
        </>
      )}

      {/* Kanban — sempre visibile */}
      <div style={{ marginTop: 24 }}>
        <div style={{ fontSize: 13, fontWeight: 800, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.6px", marginBottom: 12 }}>
          Board Kanban
        </div>
        <KanbanBoard tickets={kanbanTickets} onRefresh={loadKanban} />
      </div>

      {/* Context menu */}
      {ctxMenu && (
        <div
          style={{ position: "fixed", top: ctxMenu.y, left: ctxMenu.x, background: "var(--bg-elevated)", border: "1px solid rgba(59,130,246,0.3)", borderRadius: 8, zIndex: 1000, minWidth: 160, boxShadow: "0 8px 24px rgba(0,0,0,0.4)" }}
          onMouseLeave={() => setCtxMenu(null)}
        >
          {selectedIds.has(ctxMenu.ticketId) && selectedIds.size > 1 && (
            <div style={{ padding: "6px 16px", fontSize: 11, color: "#818cf8", borderBottom: "1px solid rgba(99,102,241,0.2)" }}>
              {selectedIds.size} selezionati
            </div>
          )}
          {STATI.map(s => {
            const sStyle = statoStyle(s);
            const isActive = ctxMenu.statoCorrente === s;
            return (
              <button key={s} onClick={() => {
                if (selectedIds.has(ctxMenu.ticketId) && selectedIds.size > 1) {
                  bulkUpdateStatus(s);
                } else {
                  handleStatoChange(ctxMenu.ticketId, s);
                }
                setCtxMenu(null);
              }}
                style={{
                  display: "block", width: "100%",
                  padding: "7px 16px 7px 12px",
                  background: isActive ? sStyle.background : "transparent",
                  border: "none",
                  borderLeft: `3px solid ${isActive ? sStyle.color : "transparent"}`,
                  color: isActive ? sStyle.color : "var(--text-secondary)",
                  fontSize: 12, cursor: "pointer", textAlign: "left",
                  fontWeight: isActive ? 700 : 500,
                  transition: "background 0.12s",
                }}>
                {s}
              </button>
            );
          })}
        </div>
      )}

      {/* Detail modal */}
      <Sheet open={!!detailTicket} onOpenChange={(o) => { if (!o) setDetailTicket(null); }}>
        <SheetContent side="right" style={{ width: "min(100vw, 580px)", maxWidth: "100vw", overflowX: "hidden", background: "var(--surface-1)", borderLeft: "1px solid var(--border-default)", overflowY: "auto", padding: "24px" }}>
          {detailTicket && (
            <>
              <SheetHeader style={{ marginBottom: 24, padding: 0, gap: 12 }}>
                <div style={{ paddingRight: 36 }}>
                  <div style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: ".1em", color: "#3b82f6", marginBottom: 4 }}>
                    Dettaglio Ticket #{detailTicket.id}
                  </div>
                  <SheetTitle style={{ fontSize: 22, fontWeight: 800, color: "#e2e8f0", margin: 0, lineHeight: 1.2 }}>
                    {detailTicket.titolo}
                  </SheetTitle>
                </div>
                <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                  <span style={{ ...getPrioritaStyle(detailTicket.priorita), fontSize: 10, padding: "2px 8px", borderRadius: 4, fontWeight: 700, textTransform: "uppercase" }}>{detailTicket.priorita}</span>
                  {detailTicket.priorita === "Emergenza" && isModuleEnabled("emergency") && (
                    <button
                      onClick={() => setShowEmergencyMap(true)}
                      style={{
                        display: "flex", alignItems: "center", gap: 6,
                        padding: "4px 12px", borderRadius: 8, border: "1px solid #ef4444",
                        background: "rgba(239,68,68,0.12)", color: "#f87171",
                        fontWeight: 800, fontSize: 12, cursor: "pointer",
                        animation: "pulse-border 1.5s infinite",
                      }}
                    >
                      🗺️ Mappa Tecnici
                    </button>
                  )}
                  {detailTicket.sito_name && (
                    <span style={{ fontSize: 12, color: "#a6f6ff", fontWeight: 800, padding: "2px 8px", borderRadius: 6, background: "rgba(31,232,255,0.10)", border: "1px solid rgba(31,232,255,0.22)" }}>
                      Sito: {detailTicket.sito_name}
                    </span>
                  )}
                  <span style={{ fontSize: 13, color: "var(--text-soft)", fontWeight: 500 }}>{detailTicket.asset_name ?? "Asset non specificato"}</span>
                  <span style={{ color: "var(--border-default)" }}>|</span>
                  <span style={{ fontSize: 13, color: "var(--text-muted)" }}>{detailTicket.tipo} · {detailTicket.durata_stimata_ore?.toFixed(1)}h</span>
                  {detailTicket.is_manual_plan && detailTicket.stato === "Pianificato" && (
                    <>
                      <span style={{ color: "var(--border-default)" }}>|</span>
                      <span style={{ fontSize: 10, padding: "2px 6px", background: "rgba(234,179,8,0.2)", border: "1px solid rgba(234,179,8,0.4)", borderRadius: 4, color: "#eab308", fontWeight: 700, textTransform: "uppercase" }}>PIANIFICATO MANUALMENTE</span>
                    </>
                  )}
                </div>
              </SheetHeader>
              
              <DetailModal
                ticket={detailTicket}
                onClose={() => setDetailTicket(null)}
                onSaved={handleSaved}
              />

              {/* Mappa emergenze spostata in Dialog dedicato — vedi sotto */}
            </>
          )}
        </SheetContent>
      </Sheet>

      {/* Dialog mappa emergenze — si apre cliccando "🗺️ Mappa Tecnici" nell'header */}
      {showEmergencyMap && detailTicket && (
        <div style={{
          position: "fixed", inset: 0, zIndex: 9999,
          background: "rgba(0,0,0,0.75)",
          display: "flex", alignItems: "center", justifyContent: "center",
          padding: "16px",
        }}
          onClick={(e) => { if (e.target === e.currentTarget) setShowEmergencyMap(false); }}
        >
          <div style={{
            background: "var(--surface-0)", border: "1px solid rgba(239,68,68,0.3)",
            borderRadius: 16, width: "100%", maxWidth: 1100,
            maxHeight: "90vh", overflow: "hidden",
            display: "flex", flexDirection: "column",
            boxShadow: "0 24px 80px rgba(0,0,0,0.6)",
          }}>
            {/* Header dialog */}
            <div style={{
              display: "flex", alignItems: "center", justifyContent: "space-between",
              padding: "16px 24px", borderBottom: "1px solid rgba(239,68,68,0.2)",
              flexShrink: 0,
            }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <div style={{ width: 10, height: 10, background: "#ef4444", borderRadius: "50%", boxShadow: "0 0 8px rgba(239,68,68,0.7)" }} />
                <span style={{ fontWeight: 800, fontSize: 16, color: "#f87171", textTransform: "uppercase", letterSpacing: "0.05em" }}>
                  Mappa Tecnici — {detailTicket.titolo}
                </span>
              </div>
              <button
                onClick={() => setShowEmergencyMap(false)}
                style={{ background: "var(--surface-3)", border: "1px solid var(--border-default)", color: "var(--text-muted)", borderRadius: 8, width: 32, height: 32, cursor: "pointer", fontSize: 16, display: "flex", alignItems: "center", justifyContent: "center" }}
              >
                ×
              </button>
            </div>
            {/* Body scrollabile */}
            <div style={{ flex: 1, overflowY: "auto", padding: "20px 24px" }}>
              <EmergencyMap
                ticketId={detailTicket.id}
                onAssign={async (tecnicoId) => {
                  try {
                    await apiPut(`/tickets/${detailTicket.id}`, { tecnico_id: tecnicoId });
                    notify.success("Tecnico assegnato al ticket");
                    setShowEmergencyMap(false);
                    handleSaved();
                  } catch {
                    notify.error("Errore nell'assegnazione del tecnico");
                  }
                }}
              />
            </div>
          </div>
        </div>
      )}

      {/* Modal pianificazione rapida (cambi stato → Pianificato) */}
      {pianificaModal && (
        <PianificaQuickModal
          onConfirm={pianificaModal.onConfirm}
          onCancel={() => setPianificaModal(null)}
        />
      )}

      {/* Modal conferma eliminazione */}
      {eliminaModal && (
        <EliminaConfirmModal
          onConfirm={eliminaModal.onConfirm}
          onCancel={() => setEliminaModal(null)}
        />
      )}
    </div>
  );
}
