"use client";

import { useState, useEffect, useCallback } from "react";
import { apiGet, apiPost, apiPut, apiDelete } from "../lib/api";
import { notify } from "@/lib/toast";

// ─── Tipi ───────────────────────────────────────────────────────────────────

interface Ricambio {
  id: number;
  codice: string;
  descrizione: string;
  categoria?: string | null;
  unita_misura?: string | null;
  giacenza: number;
  scorta_minima?: number | null;
  prezzo_unitario?: number | null;
  fornitore?: string | null;
  ubicazione?: string | null;
  note?: string | null;
  attivo: boolean;
  prenotato: number;
  disponibile: number;
  sotto_scorta: boolean;
}

interface Movimento {
  id: number;
  tipo: string;
  quantita: number;
  giacenza_dopo?: number | null;
  causale?: string | null;
  utente?: string | null;
  ticket_id?: number | null;
  created_at?: string;
}

// ─── Stili condivisi ─────────────────────────────────────────────────────────

const inputSt: React.CSSProperties = {
  width: "100%", padding: "9px 12px", background: "var(--surface-3)", border: "1px solid var(--border-default)",
  borderRadius: "6px", color: "var(--text-primary)", fontSize: "14px", boxSizing: "border-box",
};
const btnPri: React.CSSProperties = {
  background: "#1d4ed8", color: "#fff", border: "none", borderRadius: "8px",
  padding: "10px 20px", cursor: "pointer", fontSize: "14px", fontWeight: 600,
};
const btnSec: React.CSSProperties = {
  background: "transparent", color: "var(--text-primary)", border: "1px solid var(--border-default)",
  borderRadius: "8px", padding: "10px 20px", cursor: "pointer", fontSize: "14px",
};

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label style={{ display: "block", fontSize: "11px", color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.5px", marginBottom: "4px" }}>{label}</label>
      {children}
    </div>
  );
}

function num(v: string): number | null {
  const t = v.trim();
  if (t === "") return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

// ─── Modale creazione / modifica ricambio ─────────────────────────────────────

function ModalRicambio({
  ricambio,
  onClose,
  onSaved,
}: {
  ricambio: Ricambio | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const isEdit = !!ricambio;
  const [form, setForm] = useState({
    codice: ricambio?.codice ?? "",
    descrizione: ricambio?.descrizione ?? "",
    categoria: ricambio?.categoria ?? "",
    unita_misura: ricambio?.unita_misura ?? "pz",
    giacenza: ricambio ? String(ricambio.giacenza) : "0",
    scorta_minima: ricambio?.scorta_minima != null ? String(ricambio.scorta_minima) : "0",
    prezzo_unitario: ricambio?.prezzo_unitario != null ? String(ricambio.prezzo_unitario) : "",
    fornitore: ricambio?.fornitore ?? "",
    ubicazione: ricambio?.ubicazione ?? "",
    note: ricambio?.note ?? "",
  });
  const [saving, setSaving] = useState(false);
  const upd = (k: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
    setForm(p => ({ ...p, [k]: e.target.value }));

  const save = async () => {
    if (!form.codice.trim()) { notify.warning("Il codice è obbligatorio"); return; }
    if (!form.descrizione.trim()) { notify.warning("La descrizione è obbligatoria"); return; }
    setSaving(true);
    try {
      if (isEdit) {
        await apiPut(`/ricambi/${ricambio!.id}`, {
          codice: form.codice.trim(),
          descrizione: form.descrizione.trim(),
          categoria: form.categoria.trim() || null,
          unita_misura: form.unita_misura.trim() || "pz",
          scorta_minima: num(form.scorta_minima) ?? 0,
          prezzo_unitario: num(form.prezzo_unitario),
          fornitore: form.fornitore.trim() || null,
          ubicazione: form.ubicazione.trim() || null,
          note: form.note.trim() || null,
        });
        notify.success("Ricambio aggiornato");
      } else {
        await apiPost("/ricambi", {
          codice: form.codice.trim(),
          descrizione: form.descrizione.trim(),
          categoria: form.categoria.trim() || null,
          unita_misura: form.unita_misura.trim() || "pz",
          giacenza: num(form.giacenza) ?? 0,
          scorta_minima: num(form.scorta_minima) ?? 0,
          prezzo_unitario: num(form.prezzo_unitario),
          fornitore: form.fornitore.trim() || null,
          ubicazione: form.ubicazione.trim() || null,
          note: form.note.trim() || null,
        });
        notify.success("Ricambio creato");
      }
      onSaved();
      onClose();
    } catch (e) {
      notify.error(e instanceof Error ? e.message : "Errore nel salvataggio");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.6)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 9999, padding: "16px" }} onClick={onClose}>
      <div style={{ background: "var(--surface-1)", border: "1px solid var(--border-default)", borderRadius: "14px", padding: "24px", width: "100%", maxWidth: "560px", maxHeight: "90vh", overflowY: "auto" }} onClick={e => e.stopPropagation()}>
        <h2 style={{ margin: "0 0 18px", fontSize: "18px", fontWeight: 800, color: "var(--text-primary)" }}>
          {isEdit ? "Modifica ricambio" : "Nuovo ricambio"}
        </h2>
        <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px" }}>
            <Field label="Codice *"><input style={inputSt} value={form.codice} onChange={upd("codice")} placeholder="RIC-001" /></Field>
            <Field label="Categoria"><input style={inputSt} value={form.categoria} onChange={upd("categoria")} placeholder="Cuscinetti" /></Field>
          </div>
          <Field label="Descrizione *"><input style={inputSt} value={form.descrizione} onChange={upd("descrizione")} placeholder="Cuscinetto SKF 6205" /></Field>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "12px" }}>
            <Field label="U.M."><input style={inputSt} value={form.unita_misura} onChange={upd("unita_misura")} placeholder="pz" /></Field>
            {!isEdit && <Field label="Giacenza iniziale"><input style={inputSt} type="number" min="0" step="1" value={form.giacenza} onChange={upd("giacenza")} /></Field>}
            <Field label="Scorta minima"><input style={inputSt} type="number" min="0" step="1" value={form.scorta_minima} onChange={upd("scorta_minima")} /></Field>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px" }}>
            <Field label="Prezzo unitario (€)"><input style={inputSt} type="number" min="0" step="0.01" value={form.prezzo_unitario} onChange={upd("prezzo_unitario")} placeholder="12.50" /></Field>
            <Field label="Fornitore"><input style={inputSt} value={form.fornitore} onChange={upd("fornitore")} placeholder="RS Components" /></Field>
          </div>
          <Field label="Ubicazione"><input style={inputSt} value={form.ubicazione} onChange={upd("ubicazione")} placeholder="Scaffale A-12" /></Field>
          <Field label="Note"><textarea style={{ ...inputSt, resize: "vertical", minHeight: "56px" }} value={form.note} onChange={upd("note")} /></Field>
          {isEdit && <div style={{ fontSize: "12px", color: "var(--text-muted)" }}>La giacenza si modifica solo tramite i movimenti di magazzino (carico/scarico).</div>}
        </div>
        <div style={{ display: "flex", gap: "10px", justifyContent: "flex-end", marginTop: "20px" }}>
          <button style={btnSec} onClick={onClose}>Annulla</button>
          <button style={btnPri} onClick={save} disabled={saving}>{saving ? "Salvo..." : (isEdit ? "Salva modifiche" : "Crea ricambio")}</button>
        </div>
      </div>
    </div>
  );
}

// ─── Modale movimenti di magazzino ────────────────────────────────────────────

function ModalMovimenti({
  ricambio,
  onClose,
  onSaved,
}: {
  ricambio: Ricambio;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [tipo, setTipo] = useState<"carico" | "scarico" | "rettifica">("carico");
  const [quantita, setQuantita] = useState("1");
  const [causale, setCausale] = useState("");
  const [saving, setSaving] = useState(false);
  const [movimenti, setMovimenti] = useState<Movimento[]>([]);

  const loadMov = useCallback(async () => {
    try {
      const data = await apiGet<{ movimenti: Movimento[] }>(`/ricambi/${ricambio.id}/movimenti`);
      setMovimenti(data.movimenti);
    } catch { /* silenzioso */ }
  }, [ricambio.id]);

  useEffect(() => { loadMov(); }, [loadMov]);

  const save = async () => {
    const q = num(quantita);
    if (q === null || q < 0) { notify.warning("Quantità non valida"); return; }
    setSaving(true);
    try {
      await apiPost(`/ricambi/${ricambio.id}/movimento`, { tipo, quantita: q, causale: causale.trim() || null });
      notify.success("Movimento registrato");
      setQuantita("1"); setCausale("");
      await loadMov();
      onSaved();
    } catch (e) {
      notify.error(e instanceof Error ? e.message : "Errore nel movimento");
    } finally {
      setSaving(false);
    }
  };

  const tipoBadge = (t: string) => {
    const map: Record<string, { bg: string; c: string }> = {
      carico: { bg: "#052e16", c: "#22c55e" },
      scarico: { bg: "#431407", c: "#f97316" },
      rettifica: { bg: "#1e293b", c: "#94a3b8" },
    };
    const s = map[t] ?? map.rettifica;
    return <span style={{ background: s.bg, color: s.c, borderRadius: 6, padding: "2px 8px", fontSize: 11, fontWeight: 700 }}>{t}</span>;
  };

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.6)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 9999, padding: "16px" }} onClick={onClose}>
      <div style={{ background: "var(--surface-1)", border: "1px solid var(--border-default)", borderRadius: "14px", padding: "24px", width: "100%", maxWidth: "560px", maxHeight: "90vh", overflowY: "auto" }} onClick={e => e.stopPropagation()}>
        <h2 style={{ margin: "0 0 4px", fontSize: "18px", fontWeight: 800, color: "var(--text-primary)" }}>Movimenti · {ricambio.codice}</h2>
        <div style={{ fontSize: 13, color: "var(--text-muted)", marginBottom: 16 }}>
          Giacenza {ricambio.giacenza} · Prenotato {ricambio.prenotato} · Disponibile <strong style={{ color: ricambio.disponibile > 0 ? "#22c55e" : "#ef4444" }}>{ricambio.disponibile}</strong>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px" }}>
          <Field label="Tipo movimento">
            <select style={inputSt} value={tipo} onChange={e => setTipo(e.target.value as typeof tipo)}>
              <option value="carico">Carico (+)</option>
              <option value="scarico">Scarico (−)</option>
              <option value="rettifica">Rettifica inventario (=)</option>
            </select>
          </Field>
          <Field label={tipo === "rettifica" ? "Nuova giacenza" : "Quantità"}>
            <input style={inputSt} type="number" min="0" step="1" value={quantita} onChange={e => setQuantita(e.target.value)} />
          </Field>
        </div>
        <div style={{ marginTop: 12 }}>
          <Field label="Causale"><input style={inputSt} value={causale} onChange={e => setCausale(e.target.value)} placeholder="Es. rifornimento fornitore / uso su ticket" /></Field>
        </div>
        <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 14 }}>
          <button style={btnPri} onClick={save} disabled={saving}>{saving ? "Registro..." : "Registra movimento"}</button>
        </div>

        <div style={{ marginTop: 20, borderTop: "1px solid var(--border-default)", paddingTop: 14 }}>
          <div style={{ fontSize: 12, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 8 }}>Storico movimenti</div>
          {movimenti.length === 0 && <div style={{ fontSize: 13, color: "var(--text-muted)" }}>Nessun movimento registrato.</div>}
          {movimenti.map(m => (
            <div key={m.id} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, padding: "7px 0", borderBottom: "1px solid var(--border-subtle)", fontSize: 13 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                {tipoBadge(m.tipo)}
                <span style={{ color: "var(--text-primary)", fontWeight: 600 }}>{m.quantita}</span>
                <span style={{ color: "var(--text-muted)" }}>{m.causale ?? "—"}</span>
              </div>
              <div style={{ color: "var(--text-muted)", fontSize: 12 }}>→ {m.giacenza_dopo}</div>
            </div>
          ))}
        </div>

        <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 16 }}>
          <button style={btnSec} onClick={onClose}>Chiudi</button>
        </div>
      </div>
    </div>
  );
}

// ─── Pagina Magazzino ─────────────────────────────────────────────────────────

export default function MagazzinoPage() {
  const [ricambi, setRicambi] = useState<Ricambio[]>([]);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState("");
  const [onlySottoScorta, setOnlySottoScorta] = useState(false);
  const [modalRicambio, setModalRicambio] = useState<Ricambio | null | "new">(null);
  const [modalMovimenti, setModalMovimenti] = useState<Ricambio | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await apiGet<{ ricambi: Ricambio[] }>("/ricambi");
      setRicambi(data.ricambi);
    } catch {
      notify.error("Errore nel caricamento dei ricambi");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const del = async (r: Ricambio) => {
    if (!confirm(`Disattivare il ricambio "${r.codice}"? Lo storico viene conservato.`)) return;
    try {
      await apiDelete(`/ricambi/${r.id}`);
      notify.success("Ricambio disattivato");
      await load();
    } catch {
      notify.error("Errore nella disattivazione");
    }
  };

  const filtered = ricambi.filter(r => {
    if (onlySottoScorta && !r.sotto_scorta) return false;
    if (!q.trim()) return true;
    const s = q.toLowerCase();
    return r.codice.toLowerCase().includes(s) || r.descrizione.toLowerCase().includes(s) || (r.categoria ?? "").toLowerCase().includes(s);
  });

  const sottoScortaCount = ricambi.filter(r => r.sotto_scorta && r.attivo).length;
  const totValore = ricambi.reduce((acc, r) => acc + (r.prezzo_unitario ?? 0) * r.giacenza, 0);

  return (
    <div style={{ padding: "24px", maxWidth: "1200px", margin: "0 auto" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "20px", flexWrap: "wrap", gap: "12px" }}>
        <div>
          <h1 style={{ margin: 0, fontSize: "24px", fontWeight: 800, color: "var(--text-primary)" }}>Magazzino Ricambi</h1>
          <div style={{ fontSize: "14px", color: "#64748b", marginTop: "4px" }}>
            {ricambi.length} articoli · {sottoScortaCount} sotto scorta · valore stimato € {totValore.toLocaleString("it-IT", { maximumFractionDigits: 0 })}
          </div>
        </div>
        <button style={btnPri} onClick={() => setModalRicambio("new")}>+ Nuovo ricambio</button>
      </div>

      <div style={{ display: "flex", gap: 12, marginBottom: 16, flexWrap: "wrap", alignItems: "center" }}>
        <input style={{ ...inputSt, maxWidth: 320 }} value={q} onChange={e => setQ(e.target.value)} placeholder="Cerca per codice, descrizione o categoria…" />
        <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, color: "var(--text-soft)", cursor: "pointer" }}>
          <input type="checkbox" checked={onlySottoScorta} onChange={e => setOnlySottoScorta(e.target.checked)} />
          Solo sotto scorta
        </label>
      </div>

      {loading && <div style={{ textAlign: "center", padding: "60px", color: "var(--text-muted)" }}>Caricamento...</div>}

      {!loading && filtered.length === 0 && (
        <div style={{ textAlign: "center", padding: "60px", background: "var(--surface-2)", borderRadius: "12px", border: "1px solid var(--border-default)" }}>
          <div style={{ fontSize: "40px", marginBottom: "12px" }}>📦</div>
          <div style={{ fontSize: "18px", color: "var(--text-muted)", marginBottom: "8px" }}>Nessun ricambio</div>
          <button style={btnPri} onClick={() => setModalRicambio("new")}>Aggiungi il primo ricambio</button>
        </div>
      )}

      {!loading && filtered.length > 0 && (
        <div style={{ background: "var(--surface-2)", borderRadius: "12px", border: "1px solid var(--border-default)", overflow: "auto" }}>
          <div style={{ display: "grid", gridTemplateColumns: "1.2fr 2fr 1fr 0.8fr 0.8fr 0.8fr 1fr 96px", gap: "10px", padding: "12px 16px", borderBottom: "1px solid var(--border-default)", fontSize: "11px", color: "#64748b", textTransform: "uppercase", letterSpacing: "0.5px", minWidth: 900 }}>
            <div>Codice</div><div>Descrizione</div><div>Categoria</div>
            <div style={{ textAlign: "right" }}>Giacenza</div>
            <div style={{ textAlign: "right" }}>Prenotato</div>
            <div style={{ textAlign: "right" }}>Disponibile</div>
            <div>Ubicazione</div><div></div>
          </div>
          {filtered.map(r => (
            <div key={r.id} style={{ display: "grid", gridTemplateColumns: "1.2fr 2fr 1fr 0.8fr 0.8fr 0.8fr 1fr 96px", gap: "10px", padding: "12px 16px", borderBottom: "1px solid var(--border-default)", alignItems: "center", fontSize: "14px", minWidth: 900, opacity: r.attivo ? 1 : 0.5 }}>
              <div style={{ fontWeight: 700, color: "var(--text-primary)" }}>
                {r.codice}
                {r.sotto_scorta && <span title="Sotto scorta minima" style={{ marginLeft: 6, background: "#7f1d1d", color: "#fca5a5", borderRadius: 4, padding: "1px 6px", fontSize: 10, fontWeight: 800 }}>SCORTA</span>}
              </div>
              <div style={{ color: "#cbd5e1" }}>{r.descrizione}</div>
              <div style={{ color: "var(--text-muted)", fontSize: 13 }}>{r.categoria ?? "—"}</div>
              <div style={{ textAlign: "right", color: "#cbd5e1" }}>{r.giacenza} {r.unita_misura}</div>
              <div style={{ textAlign: "right", color: r.prenotato > 0 ? "#f59e0b" : "var(--text-muted)" }}>{r.prenotato}</div>
              <div style={{ textAlign: "right", fontWeight: 700, color: r.disponibile > 0 ? "#22c55e" : "#ef4444" }}>{r.disponibile}</div>
              <div style={{ color: "var(--text-muted)", fontSize: 13 }}>{r.ubicazione ?? "—"}</div>
              <div style={{ display: "flex", gap: 4, justifyContent: "flex-end" }}>
                <button onClick={() => setModalMovimenti(r)} title="Movimenti magazzino" style={{ background: "transparent", border: "none", cursor: "pointer", fontSize: 16, padding: "2px 4px" }}>📊</button>
                <button onClick={() => setModalRicambio(r)} title="Modifica" style={{ background: "transparent", border: "none", cursor: "pointer", fontSize: 15, padding: "2px 4px" }}>✏️</button>
                <button onClick={() => del(r)} title="Disattiva" style={{ background: "transparent", border: "none", cursor: "pointer", color: "#64748b", fontSize: 15, padding: "2px 4px" }}>🗑</button>
              </div>
            </div>
          ))}
        </div>
      )}

      {modalRicambio !== null && (
        <ModalRicambio
          ricambio={modalRicambio === "new" ? null : modalRicambio}
          onClose={() => setModalRicambio(null)}
          onSaved={load}
        />
      )}
      {modalMovimenti && (
        <ModalMovimenti
          ricambio={modalMovimenti}
          onClose={() => setModalMovimenti(null)}
          onSaved={() => { load(); }}
        />
      )}
    </div>
  );
}
