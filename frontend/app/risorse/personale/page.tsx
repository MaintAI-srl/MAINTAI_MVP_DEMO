"use client";

/**
 * Risorse > Personale — gestione grafica disponibilità e assenze (change request 2026-07-05).
 *
 * Griglia settimanale tecnici × giorni con stati colorati, marcatura rapida assenze
 * (click su cella → modal), modifica/eliminazione assenze esistenti e warning sui
 * conflitti con i ticket già pianificati. Usa le API assenze esistenti
 * (/tecnici/{id}/assenze, /tecnici/assenze/*) — nessun sistema parallelo.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { apiGet, apiPost, apiPut, apiDelete } from "../../lib/api";
import { notify } from "@/lib/toast";

type TecnicoRow = {
  id: number;
  nome: string;
  cognome?: string | null;
  stato?: string | null;
  ore_giornaliere?: number | null;
};

type Assenza = {
  id: number;
  tecnico_id: number;
  tipo_assenza: string;
  note?: string | null;
  data_inizio: string;
  data_fine: string;
};

type TicketLite = {
  id: number;
  titolo: string;
  stato: string;
  tecnico_id?: number | null;
  planned_start?: string | null;
  planned_finish?: string | null;
  durata_stimata_ore: number;
};

type Conflitto = {
  id: number;
  titolo: string;
  stato: string;
  planned_start?: string | null;
  planned_finish?: string | null;
};

const TIPI_ASSENZA = ["Ferie", "Malattia", "Permesso", "Formazione", "Trasferta", "Altro"] as const;

function assenzaColor(tipo: string): string {
  switch ((tipo || "").toLowerCase()) {
    case "ferie": return "#3b82f6";
    case "malattia": return "#ef4444";
    case "permesso": return "#f59e0b";
    case "formazione":
    case "corso": return "#8b5cf6";
    case "trasferta": return "#06b6d4";
    default: return "#64748b";
  }
}

const GIORNI = ["Lun", "Mar", "Mer", "Gio", "Ven", "Sab", "Dom"];

const _pad = (n: number) => String(n).padStart(2, "0");
const toKey = (d: Date) => `${d.getFullYear()}-${_pad(d.getMonth() + 1)}-${_pad(d.getDate())}`;

function mondayOf(d: Date): Date {
  const out = new Date(d);
  out.setHours(0, 0, 0, 0);
  const dow = (out.getDay() + 6) % 7; // 0 = lunedì
  out.setDate(out.getDate() - dow);
  return out;
}

function addDays(d: Date, n: number): Date {
  const out = new Date(d);
  out.setDate(out.getDate() + n);
  return out;
}

/** L'assenza copre il giorno `day`? (confronto su date locali) */
function copreGiorno(a: Assenza, day: Date): boolean {
  const start = new Date(a.data_inizio);
  const end = new Date(a.data_fine);
  const dayStart = new Date(day); dayStart.setHours(0, 0, 0, 0);
  const dayEnd = new Date(day); dayEnd.setHours(23, 59, 59, 999);
  return start <= dayEnd && end >= dayStart;
}

export default function PersonalePage() {
  const [tecnici, setTecnici] = useState<TecnicoRow[]>([]);
  const [assenze, setAssenze] = useState<Assenza[]>([]);
  const [tickets, setTickets] = useState<TicketLite[]>([]);
  const [loading, setLoading] = useState(true);
  const [weekStart, setWeekStart] = useState<Date>(() => mondayOf(new Date()));

  // Modal rapido assenza
  const [modal, setModal] = useState<null | {
    assenzaId?: number;           // presente = modifica
    tecnicoId: number;
    tipo: string;
    dataInizio: string;           // yyyy-mm-dd
    dataFine: string;             // yyyy-mm-dd
    note: string;
  }>(null);
  const [conflitti, setConflitti] = useState<Conflitto[]>([]);
  const [saving, setSaving] = useState(false);

  const giorni = useMemo(() => Array.from({ length: 7 }, (_, i) => addDays(weekStart, i)), [weekStart]);

  const load = useCallback(async () => {
    setLoading(true);
    const from = new Date(weekStart); from.setHours(0, 0, 0, 0);
    const to = addDays(weekStart, 6); to.setHours(23, 59, 59, 0);
    try {
      const [tecs, abs, tks] = await Promise.all([
        apiGet<TecnicoRow[]>("/tecnici"),
        apiGet<Assenza[]>(`/tecnici/assenze/overview?date_from=${from.toISOString()}&date_to=${to.toISOString()}`),
        apiGet<{ items: TicketLite[] }>("/tickets?page=1&limit=500&stato=Pianificato,In corso"),
      ]);
      setTecnici(Array.isArray(tecs) ? tecs : []);
      setAssenze(Array.isArray(abs) ? abs : []);
      setTickets(tks?.items ?? []);
    } catch {
      notify.error("Errore caricamento dati personale.");
    } finally {
      setLoading(false);
    }
  }, [weekStart]);

  useEffect(() => { load(); }, [load]);

  // Ticket pianificati per tecnico+giorno (per stato "Occupato" e capacità residua)
  const ticketsByCell = useMemo(() => {
    const map = new Map<string, TicketLite[]>();
    for (const t of tickets) {
      if (!t.tecnico_id || !t.planned_start) continue;
      const key = `${t.tecnico_id}|${toKey(new Date(t.planned_start))}`;
      const list = map.get(key) ?? [];
      list.push(t);
      map.set(key, list);
    }
    return map;
  }, [tickets]);

  const assenzeByTecnico = useMemo(() => {
    const map = new Map<number, Assenza[]>();
    for (const a of assenze) {
      const list = map.get(a.tecnico_id) ?? [];
      list.push(a);
      map.set(a.tecnico_id, list);
    }
    return map;
  }, [assenze]);

  // KPI di oggi
  const oggi = new Date();
  const assentiOggi = tecnici.filter(t => (assenzeByTecnico.get(t.id) ?? []).some(a => copreGiorno(a, oggi))).length;

  // ── Modal helpers ──────────────────────────────────────────────────────────
  const openCreate = (tecnicoId: number, day: Date) => {
    setConflitti([]);
    setModal({ tecnicoId, tipo: "Ferie", dataInizio: toKey(day), dataFine: toKey(day), note: "" });
  };

  const openEdit = (a: Assenza) => {
    setConflitti([]);
    setModal({
      assenzaId: a.id,
      tecnicoId: a.tecnico_id,
      tipo: a.tipo_assenza || "Ferie",
      dataInizio: toKey(new Date(a.data_inizio)),
      dataFine: toKey(new Date(a.data_fine)),
      note: a.note ?? "",
    });
  };

  // Conflitti ticket/assenza: ricontrolla quando cambiano tecnico o date del modal
  useEffect(() => {
    if (!modal) return;
    const inizio = `${modal.dataInizio}T00:00:00`;
    const fine = `${modal.dataFine}T23:59:59`;
    if (modal.dataFine < modal.dataInizio) { setConflitti([]); return; }
    apiGet<{ count: number; tickets: Conflitto[] }>(
      `/tecnici/${modal.tecnicoId}/conflitti?data_inizio=${inizio}&data_fine=${fine}`
    )
      .then(d => setConflitti(d?.tickets ?? []))
      .catch(() => setConflitti([]));
  }, [modal?.tecnicoId, modal?.dataInizio, modal?.dataFine]); // eslint-disable-line react-hooks/exhaustive-deps

  async function salvaAssenza() {
    if (!modal) return;
    if (modal.dataFine < modal.dataInizio) { notify.error("La data fine deve essere successiva alla data inizio."); return; }
    setSaving(true);
    try {
      const payload = {
        data_inizio: `${modal.dataInizio}T00:00:00`,
        data_fine: `${modal.dataFine}T23:59:59`,
        tipo_assenza: modal.tipo,
        note: modal.note.trim() || null,
      };
      if (modal.assenzaId) {
        await apiPut(`/tecnici/assenze/${modal.assenzaId}`, payload);
        notify.success("Assenza aggiornata.");
      } else {
        await apiPost(`/tecnici/${modal.tecnicoId}/assenze`, payload);
        notify.success("Assenza registrata.");
      }
      setModal(null);
      await load();
      window.dispatchEvent(new Event("maintai:data-changed"));
    } catch (err) {
      notify.error(err instanceof Error ? err.message : "Errore nel salvataggio assenza.");
    } finally {
      setSaving(false);
    }
  }

  async function eliminaAssenza() {
    if (!modal?.assenzaId) return;
    setSaving(true);
    try {
      await apiDelete(`/tecnici/assenze/${modal.assenzaId}`);
      notify.success("Assenza eliminata.");
      setModal(null);
      await load();
      window.dispatchEvent(new Event("maintai:data-changed"));
    } catch {
      notify.error("Errore nell'eliminazione assenza.");
    } finally {
      setSaving(false);
    }
  }

  const tecnicoModal = modal ? tecnici.find(t => t.id === modal.tecnicoId) : null;

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <div style={{ padding: "4px 2px" }}>
      {/* Header + KPI */}
      <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 12, marginBottom: 16 }}>
        <div>
          <h1 style={{ fontSize: 20, fontWeight: 800, color: "var(--text-primary)", margin: 0 }}>Personale</h1>
          <div style={{ fontSize: 12, color: "var(--text-muted)" }}>Disponibilità e assenze — clicca una cella per marcare un&apos;assenza</div>
        </div>
        <div style={{ marginLeft: "auto", display: "flex", gap: 10 }}>
          {[
            { label: "Tecnici", value: tecnici.length, color: "var(--text-accent)" },
            { label: "Assenti oggi", value: assentiOggi, color: "#f87171" },
            { label: "Disponibili oggi", value: Math.max(0, tecnici.length - assentiOggi), color: "#34d399" },
          ].map(k => (
            <div key={k.label} style={{ background: "var(--surface-1)", border: "1px solid var(--border-default)", borderRadius: 10, padding: "8px 16px", textAlign: "center" }}>
              <div style={{ fontSize: 20, fontWeight: 800, color: k.color }}>{k.value}</div>
              <div style={{ fontSize: 9.5, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.1em", color: "var(--text-muted)" }}>{k.label}</div>
            </div>
          ))}
        </div>
      </div>

      {/* Navigazione settimana */}
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
        <button onClick={() => setWeekStart(w => addDays(w, -7))} style={navBtn}>‹ Settimana prec.</button>
        <button onClick={() => setWeekStart(mondayOf(new Date()))} style={navBtn}>Oggi</button>
        <button onClick={() => setWeekStart(w => addDays(w, 7))} style={navBtn}>Settimana succ. ›</button>
        <span style={{ marginLeft: 8, fontSize: 13, fontWeight: 700, color: "var(--text-primary)" }}>
          {weekStart.toLocaleDateString("it-IT", { day: "2-digit", month: "long" })} — {addDays(weekStart, 6).toLocaleDateString("it-IT", { day: "2-digit", month: "long", year: "numeric" })}
        </span>
        <button onClick={load} title="Ricarica" style={{ ...navBtn, marginLeft: "auto" }}>↻</button>
      </div>

      {/* Griglia settimanale */}
      <div style={{ background: "var(--surface-1)", border: "1px solid var(--border-default)", borderRadius: 12, overflow: "auto" }}>
        <div style={{ display: "grid", gridTemplateColumns: "180px repeat(7, minmax(110px, 1fr))", minWidth: 960 }}>
          {/* Header riga */}
          <div style={{ ...headCell, textAlign: "left", paddingLeft: 14 }}>Tecnico</div>
          {giorni.map((g, i) => {
            const isToday = toKey(g) === toKey(new Date());
            return (
              <div key={i} style={{ ...headCell, background: isToday ? "rgba(99,102,241,0.12)" : undefined }}>
                {GIORNI[i]} {g.toLocaleDateString("it-IT", { day: "2-digit", month: "2-digit" })}
              </div>
            );
          })}

          {loading && tecnici.length === 0 && (
            <div style={{ gridColumn: "1 / -1", padding: 32, textAlign: "center", color: "var(--text-muted)", fontSize: 13 }}>Caricamento…</div>
          )}
          {!loading && tecnici.length === 0 && (
            <div style={{ gridColumn: "1 / -1", padding: 32, textAlign: "center", color: "var(--text-muted)", fontSize: 13 }}>Nessun tecnico presente.</div>
          )}

          {tecnici.map(t => {
            const tAssenze = assenzeByTecnico.get(t.id) ?? [];
            return (
              <div key={t.id} style={{ display: "contents" }}>
                <div style={{ padding: "10px 14px", borderTop: "1px solid var(--border-subtle)", fontSize: 13, fontWeight: 700, color: "var(--text-primary)", display: "flex", flexDirection: "column", justifyContent: "center" }}>
                  {t.nome} {t.cognome ?? ""}
                  <span style={{ fontSize: 10, fontWeight: 500, color: "var(--text-muted)" }}>{t.ore_giornaliere ?? 8}h/giorno</span>
                </div>
                {giorni.map((g, i) => {
                  const assCell = tAssenze.filter(a => copreGiorno(a, g));
                  const cellTickets = ticketsByCell.get(`${t.id}|${toKey(g)}`) ?? [];
                  const isWeekend = i >= 5;
                  const oreTicket = cellTickets.reduce((s, tk) => s + (tk.durata_stimata_ore || 0), 0);
                  const capienza = t.ore_giornaliere ?? 8;
                  const residuo = Math.max(0, capienza - oreTicket);

                  let content: React.ReactNode;
                  if (assCell.length > 0) {
                    const a = assCell[0];
                    const color = assenzaColor(a.tipo_assenza);
                    content = (
                      <button
                        onClick={(e) => { e.stopPropagation(); openEdit(a); }}
                        title={`${a.tipo_assenza}${a.note ? ` — ${a.note}` : ""} (clicca per modificare)`}
                        style={{
                          width: "100%", border: `1px solid ${color}55`, background: `${color}22`, color,
                          borderRadius: 6, fontSize: 10.5, fontWeight: 800, padding: "5px 4px", cursor: "pointer",
                          display: "flex", alignItems: "center", justifyContent: "center", gap: 4,
                        }}
                      >
                        {a.tipo_assenza}
                        {cellTickets.length > 0 && <span title={`${cellTickets.length} ticket pianificati in conflitto`} style={{ fontSize: 11 }}>⚠</span>}
                      </button>
                    );
                  } else if (cellTickets.length > 0) {
                    content = (
                      <div title={cellTickets.map(tk => `#${tk.id} ${tk.titolo}`).join("\n")} style={{ fontSize: 10.5, fontWeight: 700, color: "#818cf8", textAlign: "center" }}>
                        Occupato ({cellTickets.length})
                        <div style={{ fontSize: 9.5, fontWeight: 500, color: "var(--text-muted)" }}>{residuo.toFixed(1)}h residue</div>
                      </div>
                    );
                  } else if (isWeekend) {
                    content = <span style={{ fontSize: 11, color: "var(--text-soft)" }}>—</span>;
                  } else {
                    content = <span style={{ fontSize: 10.5, fontWeight: 600, color: "#34d399" }}>Disponibile</span>;
                  }

                  return (
                    <div
                      key={i}
                      onClick={() => openCreate(t.id, g)}
                      title="Clicca per aggiungere un'assenza"
                      style={{
                        borderTop: "1px solid var(--border-subtle)",
                        borderLeft: "1px solid var(--border-subtle)",
                        padding: 6, minHeight: 52, cursor: "pointer",
                        display: "flex", alignItems: "center", justifyContent: "center",
                        background: isWeekend ? "rgba(100,116,139,0.06)" : undefined,
                      }}
                    >
                      {content}
                    </div>
                  );
                })}
              </div>
            );
          })}
        </div>
      </div>

      {/* Legenda */}
      <div style={{ display: "flex", flexWrap: "wrap", gap: 10, marginTop: 12, alignItems: "center" }}>
        <span style={{ fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.1em", color: "var(--text-muted)" }}>Legenda:</span>
        <LegendChip label="Disponibile" color="#34d399" />
        <LegendChip label="Occupato (ticket)" color="#818cf8" />
        {TIPI_ASSENZA.map(t => <LegendChip key={t} label={t} color={assenzaColor(t)} />)}
      </div>

      {/* ── Modal rapido assenza ── */}
      {modal && (
        <>
          <div onClick={() => setModal(null)} style={{ position: "fixed", inset: 0, background: "rgba(2,6,23,0.65)", zIndex: 9998 }} />
          <div style={{
            position: "fixed", top: "50%", left: "50%", transform: "translate(-50%,-50%)", zIndex: 9999,
            width: "min(480px, calc(100vw - 32px))", background: "var(--surface-1)",
            border: "1px solid var(--border-default)", borderRadius: 14, boxShadow: "0 24px 60px rgba(0,0,0,0.45)",
          }}>
            <div style={{ display: "flex", alignItems: "center", padding: "16px 20px", borderBottom: "1px solid var(--border-subtle)" }}>
              <div style={{ fontSize: 15, fontWeight: 800, color: "var(--text-primary)" }}>
                {modal.assenzaId ? "Modifica assenza" : "Nuova assenza"}
                <span style={{ fontWeight: 500, color: "var(--text-muted)" }}> — {tecnicoModal ? `${tecnicoModal.nome} ${tecnicoModal.cognome ?? ""}` : `Tecnico #${modal.tecnicoId}`}</span>
              </div>
              <button onClick={() => setModal(null)} style={{ marginLeft: "auto", background: "transparent", border: "none", color: "var(--text-muted)", fontSize: 20, cursor: "pointer", lineHeight: 1 }}>×</button>
            </div>

            <div style={{ padding: 20, display: "grid", gap: 14 }}>
              <div>
                <label style={modalLabel}>Tecnico</label>
                <select className="select" value={modal.tecnicoId} onChange={e => setModal(m => m && { ...m, tecnicoId: Number(e.target.value) })}>
                  {tecnici.map(t => <option key={t.id} value={t.id}>{t.nome} {t.cognome ?? ""}</option>)}
                </select>
              </div>
              <div>
                <label style={modalLabel}>Tipo assenza</label>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                  {TIPI_ASSENZA.map(t => {
                    const color = assenzaColor(t);
                    const active = modal.tipo === t;
                    return (
                      <button key={t} type="button" onClick={() => setModal(m => m && { ...m, tipo: t })}
                        style={{
                          fontSize: 11, fontWeight: 700, padding: "5px 12px", borderRadius: 6, cursor: "pointer",
                          border: `1px solid ${active ? color : "var(--border-default)"}`,
                          background: active ? `${color}22` : "transparent",
                          color: active ? color : "var(--text-secondary)",
                        }}>
                        {t}
                      </button>
                    );
                  })}
                </div>
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                <div>
                  <label style={modalLabel}>Data inizio</label>
                  <input className="input" type="date" value={modal.dataInizio} onChange={e => setModal(m => m && { ...m, dataInizio: e.target.value })} />
                </div>
                <div>
                  <label style={modalLabel}>Data fine</label>
                  <input className="input" type="date" value={modal.dataFine} onChange={e => setModal(m => m && { ...m, dataFine: e.target.value })} />
                </div>
              </div>
              <div>
                <label style={modalLabel}>Note (opzionale)</label>
                <textarea className="input" rows={2} value={modal.note} onChange={e => setModal(m => m && { ...m, note: e.target.value })} placeholder="Es. mezza giornata, dettagli…" />
              </div>

              {/* Conflitti con ticket pianificati */}
              {conflitti.length > 0 && (
                <div style={{ border: "1px solid rgba(239,68,68,0.4)", background: "rgba(239,68,68,0.08)", borderRadius: 10, padding: "10px 14px" }}>
                  <div style={{ fontSize: 12, fontWeight: 800, color: "#f87171", marginBottom: 6 }}>
                    ⚠ Attenzione: il tecnico è assegnato a {conflitti.length} ticket nel periodo selezionato.
                  </div>
                  <ul style={{ margin: 0, paddingLeft: 16, maxHeight: 90, overflow: "auto" }}>
                    {conflitti.map(c => (
                      <li key={c.id} style={{ fontSize: 11.5, color: "var(--text-soft)" }}>
                        #{c.id} — {c.titolo} ({c.planned_start ? new Date(c.planned_start).toLocaleDateString("it-IT") : "?"})
                      </li>
                    ))}
                  </ul>
                  <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 6 }}>
                    Confermando l&apos;assenza, i ticket restano pianificati e andranno riassegnati dalla pagina Ticket o dal planner.
                  </div>
                </div>
              )}
            </div>

            <div style={{ display: "flex", gap: 10, padding: "14px 20px", borderTop: "1px solid var(--border-subtle)" }}>
              {modal.assenzaId && (
                <button onClick={eliminaAssenza} disabled={saving}
                  style={{ fontSize: 12, fontWeight: 700, padding: "8px 14px", borderRadius: 8, cursor: "pointer", border: "1px solid rgba(239,68,68,0.4)", background: "transparent", color: "#f87171" }}>
                  Elimina
                </button>
              )}
              <button onClick={() => setModal(null)} disabled={saving}
                style={{ marginLeft: "auto", fontSize: 12, fontWeight: 700, padding: "8px 16px", borderRadius: 8, cursor: "pointer", border: "1px solid var(--border-default)", background: "transparent", color: "var(--text-secondary)" }}>
                Annulla
              </button>
              <button onClick={salvaAssenza} disabled={saving}
                style={{ fontSize: 12, fontWeight: 800, padding: "8px 18px", borderRadius: 8, cursor: saving ? "not-allowed" : "pointer", border: "none", background: "var(--grad-primary, linear-gradient(135deg,#6366f1,#8b5cf6))", color: "#fff" }}>
                {saving ? "Salvataggio…" : conflitti.length > 0 ? "Conferma assenza" : "Salva assenza"}
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

function LegendChip({ label, color }: { label: string; color: string }) {
  return (
    <span style={{ fontSize: 10.5, fontWeight: 700, color, background: `${color}18`, border: `1px solid ${color}44`, borderRadius: 6, padding: "2px 9px" }}>
      {label}
    </span>
  );
}

const navBtn: React.CSSProperties = {
  fontSize: 12, fontWeight: 700, padding: "6px 12px", borderRadius: 8, cursor: "pointer",
  border: "1px solid var(--border-default)", background: "var(--surface-1)", color: "var(--text-secondary)",
};

const headCell: React.CSSProperties = {
  padding: "10px 8px", fontSize: 10.5, fontWeight: 800, textTransform: "uppercase",
  letterSpacing: "0.08em", color: "var(--text-muted)", textAlign: "center",
  borderBottom: "1px solid var(--border-default)",
};

const modalLabel: React.CSSProperties = {
  display: "block", fontSize: 10.5, fontWeight: 700, textTransform: "uppercase",
  letterSpacing: "0.08em", color: "var(--text-muted)", marginBottom: 6,
};
