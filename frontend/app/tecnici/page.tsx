"use client";

import { useEffect, useMemo, useState } from "react";
import { apiGet, apiPost, apiPut } from "../lib/api";
import { notify } from "@/lib/toast";
import { useAuth } from "../lib/auth";
import StatusToggle from "../components/StatusToggle";
import styles from "./tecnici.module.css";
import AssenzeModal from "../components/AssenzeModal";

type Tecnico = {
  id: number;
  nome: string;
  cognome: string;
  skill: string;
  ore_giornaliere: number;
  stato: string;
  orario_inizio: string;
  orario_fine: string;
  limitazioni_orarie: string;
  telefono?: string | null;
  sede_indirizzo?: string | null;
  utente_id?: number | null;
  utente_username?: string | null;
};

type UtenteItem = {
  id: number;
  username: string;
  ruolo: string;
  is_active: boolean;
  tecnico_id?: number | null;
};

type OreStats = {
  tecnici_attivi: number;
  ore_giornaliere_totali: number;
  oggi: { ore: number; giorno: string };
  settimana: { ore: number; dal: string; al: string };
  mese: { ore: number; mese: string };
  anno: { ore: number; anno: number };
  per_tecnico: { nome: string; ore_giornaliere: number; stato: string }[];
};

const STATI_TECNICO = ["in servizio", "ferie", "malattia", "corso"];

const STATO_COLORS: Record<string, { color: string; bg: string; border: string }> = {
  "in servizio": { color: "#34d399", bg: "rgba(52,211,153,.1)",  border: "rgba(52,211,153,.3)"  },
  "ferie":       { color: "#38bdf8", bg: "rgba(56,189,248,.1)",  border: "rgba(56,189,248,.3)"  },
  "malattia":    { color: "#f87171", bg: "rgba(248,113,113,.1)", border: "rgba(248,113,113,.3)" },
  "corso":       { color: "#fbbf24", bg: "rgba(251,191,36,.1)",  border: "rgba(251,191,36,.3)"  },
};

function statoBadge(s: string) {
  const c = STATO_COLORS[s] ?? STATO_COLORS["in servizio"];
  return { color: c.color, background: c.bg, border: `1px solid ${c.border}`, padding: "2px 8px", borderRadius: 4, fontSize: 11, fontWeight: 600 as const };
}

function splitSkills(value: string) {
  return value.split(",").map(i => i.trim()).filter(Boolean);
}

function skillBadgeClass(stylesObj: Record<string, string>, skill: string) {
  const key = skill.toLowerCase();
  if (key.includes("cabina") || key.includes("mt")) return `${stylesObj.badge} ${stylesObj.badgeSky}`;
  if (key.includes("trasformatore")) return `${stylesObj.badge} ${stylesObj.badgeEmerald}`;
  if (key.includes("carriponte")) return `${stylesObj.badge} ${stylesObj.badgeViolet}`;
  if (key.includes("fotovoltaico")) return `${stylesObj.badge} ${stylesObj.badgeAmber}`;
  if (key.includes("verific")) return `${stylesObj.badge} ${stylesObj.badgeRose}`;
  return `${stylesObj.badge} ${stylesObj.badgeSlate}`;
}

const colFilterInput: React.CSSProperties = {
  marginTop: 3, width: "100%", background: "var(--border-subtle)",
  border: "1px solid rgba(59,130,246,0.15)", borderRadius: 3,
  color: "var(--text-secondary)", padding: "2px 5px", fontSize: 10, outline: "none", fontFamily: "inherit",
};

export default function TecniciPage() {
  const { user } = useAuth();
  const isAdmin = user?.ruolo === "responsabile" || user?.ruolo === "superadmin";

  const [tecnici, setTecnici] = useState<Tecnico[]>([]);
  const [stats, setStats] = useState<OreStats | null>(null);
  const [showAssenzeFor, setShowAssenzeFor] = useState<Tecnico | null>(null);
  const [utenti, setUtenti] = useState<UtenteItem[]>([]);

  // Form
  const [nome, setNome] = useState("");
  const [cognome, setCognome] = useState("");
  const [skill, setSkill] = useState("");
  const [ore, setOre] = useState(8);
  const [statoCampo, setStatoCampo] = useState("in servizio");
  const [orarioInizio, setOrarioInizio] = useState("08:00");
  const [orarioFine, setOrarioFine] = useState("17:00");
  const [limitazioniOrarie, setLimitazioniOrarie] = useState("");
  const [telefono, setTelefono] = useState("");
  const [sedeIndirizzo, setSedeIndirizzo] = useState("");
  const [utenteId, setUtenteId] = useState<number | null>(null);

  const [editId, setEditId] = useState<number | null>(null);
  const [search, setSearch] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [isUpdatingStatus, setIsUpdatingStatus] = useState<number | null>(null);

  const [sortCol, setSortCol] = useState("");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");
  const [colFilters, setColFilters] = useState<Record<string, string>>({});

  function handleSort(col: string) {
    if (sortCol === col) {
      if (sortDir === "asc") setSortDir("desc");
      else { setSortCol(""); setSortDir("asc"); }
    } else { setSortCol(col); setSortDir("asc"); }
  }

  function SortTh({ label, col }: { label: string; col: string }) {
    const active = sortCol === col;
    return (
      <th>
        <div onClick={() => handleSort(col)} style={{ cursor: "pointer", userSelect: "none", display: "flex", alignItems: "center", gap: 4, whiteSpace: "nowrap" }}>
          {label}
          <span style={{ fontSize: 9, opacity: active ? 1 : 0.25, color: active ? "#818cf8" : "inherit" }}>{active && sortDir === "desc" ? "↓" : "↑"}</span>
        </div>
        <input value={colFilters[col] ?? ""} onChange={e => setColFilters(p => ({ ...p, [col]: e.target.value }))} onClick={e => e.stopPropagation()} placeholder="…" style={colFilterInput} />
      </th>
    );
  }

  useEffect(() => {
    loadTecnici();
    loadStats();
    if (isAdmin) loadUtenti();
  }, [isAdmin]);

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    const refresh = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        loadTecnici();
        loadStats();
        if (isAdmin) loadUtenti();
      }, 150);
    };
    window.addEventListener("maintai:data-changed", refresh);
    window.addEventListener("focus", refresh);
    return () => {
      if (timer) clearTimeout(timer);
      window.removeEventListener("maintai:data-changed", refresh);
      window.removeEventListener("focus", refresh);
    };
  }, [isAdmin]);

  async function loadTecnici() {
    try {
      const d = await apiGet<Tecnico[]>("/tecnici");
      setTecnici(d);
    } catch {
      notify.error("Errore caricamento tecnici.");
    }
  }

  async function loadStats() {
    try {
      const d = await apiGet<OreStats>("/tecnici/statistiche");
      setStats(d);
    } catch {
      notify.error("Errore caricamento statistiche.");
    }
  }

  async function loadUtenti() {
    try {
      const d = await apiGet<UtenteItem[]>("/utenti");
      setUtenti(d);
    } catch {
      // Non bloccare il caricamento se utenti non disponibili
    }
  }

  function resetForm() {
    setNome(""); setCognome(""); setSkill(""); setOre(8);
    setStatoCampo("in servizio"); setOrarioInizio("08:00"); setOrarioFine("17:00");
    setLimitazioniOrarie(""); setTelefono(""); setSedeIndirizzo(""); setUtenteId(null);
  }

  function startEdit(t: Tecnico) {
    setEditId(t.id);
    setNome(t.nome); setCognome(t.cognome || ""); setSkill(t.skill); setOre(t.ore_giornaliere);
    setStatoCampo(t.stato || "in servizio"); setOrarioInizio(t.orario_inizio || "08:00");
    setOrarioFine(t.orario_fine || "17:00"); setLimitazioniOrarie(t.limitazioni_orarie || "");
    setTelefono(t.telefono || ""); setSedeIndirizzo(t.sede_indirizzo || "");
    setUtenteId(t.utente_id ?? null);
  }

  function cancelEdit() { setEditId(null); resetForm(); }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!nome.trim()) { notify.error("Il campo 'Nome' è obbligatorio."); return; }
    try {
      setIsSaving(true);
      const payload: Record<string, unknown> = {
        nome, cognome, skill, ore_giornaliere: ore,
        stato: statoCampo, orario_inizio: orarioInizio,
        orario_fine: orarioFine, limitazioni_orarie: limitazioniOrarie,
        telefono: telefono || null,
        sede_indirizzo: sedeIndirizzo || null,
        utente_id: utenteId,
      };
      const path = editId !== null ? `/tecnici/${editId}` : `/tecnici`;
      const saved = editId !== null 
        ? await apiPut<Tecnico>(path, payload)
        : await apiPost<Tecnico>(path, payload);

      await loadTecnici();
      await loadStats();
      if (editId !== null) cancelEdit(); else resetForm();
    } catch (err: any) {
      notify.error(err.message || "Errore nel salvataggio.");
    } finally { setIsSaving(false); }
  }

  async function handleQuickStatusChange(id: number, nuovoStato: string) {
    setIsUpdatingStatus(id);
    try {
      await apiPut(`/tecnici/${id}`, { stato: nuovoStato });
      setTecnici(prev => prev.map(t => t.id === id ? { ...t, stato: nuovoStato } : t));
      await loadStats();
    } catch {
      // ignore
    } finally {
      setIsUpdatingStatus(null);
    }
  }


  const filteredTecnici = useMemo(() => {
    let result = tecnici;
    const term = search.trim().toLowerCase();
    if (term) result = result.filter(t => [t.nome, t.cognome, t.skill, t.stato].join(" ").toLowerCase().includes(term));
    for (const [col, val] of Object.entries(colFilters)) {
      if (!val.trim()) continue;
      const tv = val.toLowerCase();
      result = result.filter(t => String((t as Record<string, unknown>)[col] ?? "").toLowerCase().includes(tv));
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
  }, [tecnici, search, sortCol, sortDir, colFilters]);

  const statCard: React.CSSProperties = {
    background: "var(--border-subtle)", border: "1px solid rgba(255,255,255,.07)",
    borderRadius: 12, padding: "14px 18px", flex: 1, minWidth: 120,
  };

  return (
    <div className={styles.page}>
      <section className={styles.hero}>
        <div className={styles.heroCopy}>
          <div className={styles.eyebrow}>Workforce</div>
          <h1 className={styles.title}>Tecnici</h1>
          <p className={styles.subtitle}>Skill, disponibilità, stato e ore uomo per l'allocazione automatica.</p>
        </div>
        <div className={styles.heroStats}>
          <div className={styles.heroStat}>
            <span className={styles.heroStatLabel}>Totale</span>
            <strong className={styles.heroStatValue}>{tecnici.length}</strong>
          </div>
          <div className={styles.heroStat}>
            <span className={styles.heroStatLabel}>In servizio</span>
            <strong className={styles.heroStatValue} style={{ color: "#34d399" }}>
              {tecnici.filter(t => t.stato === "in servizio").length}
            </strong>
          </div>
        </div>
      </section>

      {/* Statistiche ore uomo */}
      {stats && (
        <section className={styles.card} style={{ padding: "20px 24px" }}>
          <h2 className={styles.cardTitle} style={{ marginBottom: 16 }}>Ore uomo disponibili</h2>
          <p className={styles.cardSubtitle} style={{ marginBottom: 16 }}>Solo tecnici in servizio · Calendario lun-ven</p>
          <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
            <div style={statCard}>
              <div style={{ fontSize: 10, textTransform: "uppercase", letterSpacing: ".1em", color: "var(--text-muted)", marginBottom: 6 }}>Oggi</div>
              <div style={{ fontSize: 28, fontWeight: 800, color: "#818cf8", lineHeight: 1 }}>{stats.oggi.ore}h</div>
              <div style={{ fontSize: 10, color: "var(--text-soft)", marginTop: 4 }}>{stats.oggi.giorno}</div>
            </div>
            <div style={statCard}>
              <div style={{ fontSize: 10, textTransform: "uppercase", letterSpacing: ".1em", color: "var(--text-muted)", marginBottom: 6 }}>Settimana</div>
              <div style={{ fontSize: 28, fontWeight: 800, color: "#38bdf8", lineHeight: 1 }}>{stats.settimana.ore}h</div>
              <div style={{ fontSize: 10, color: "var(--text-soft)", marginTop: 4 }}>dal {stats.settimana.dal} al {stats.settimana.al}</div>
            </div>
            <div style={statCard}>
              <div style={{ fontSize: 10, textTransform: "uppercase", letterSpacing: ".1em", color: "var(--text-muted)", marginBottom: 6 }}>Mese</div>
              <div style={{ fontSize: 28, fontWeight: 800, color: "#34d399", lineHeight: 1 }}>{stats.mese.ore}h</div>
              <div style={{ fontSize: 10, color: "var(--text-soft)", marginTop: 4 }}>{stats.mese.mese}</div>
            </div>
            <div style={statCard}>
              <div style={{ fontSize: 10, textTransform: "uppercase", letterSpacing: ".1em", color: "var(--text-muted)", marginBottom: 6 }}>Anno</div>
              <div style={{ fontSize: 28, fontWeight: 800, color: "#fbbf24", lineHeight: 1 }}>{stats.anno.ore.toLocaleString()}h</div>
              <div style={{ fontSize: 10, color: "var(--text-soft)", marginTop: 4 }}>{stats.anno.anno}</div>
            </div>
          </div>
          {stats.per_tecnico.length > 0 && (
            <div style={{ marginTop: 16, display: "flex", gap: 8, flexWrap: "wrap" }}>
              {stats.per_tecnico.map(t => (
                <div key={t.nome} style={{ background: "rgba(99,102,241,.08)", border: "1px solid rgba(99,102,241,.15)", borderRadius: 8, padding: "6px 12px", fontSize: 12 }}>
                  <span style={{ color: "var(--text-primary)", fontWeight: 700 }}>{t.nome}</span>
                  <span style={{ color: "var(--text-muted)", marginLeft: 6 }}>{t.ore_giornaliere?.toFixed(1)}h/gg</span>
                </div>
              ))}
            </div>
          )}
        </section>
      )}


      <div className={styles.grid}>
        {/* Form */}
        <section className={styles.card}>
          <div className={styles.cardHead}>
            <h2 className={styles.cardTitle}>{editId !== null ? `Modifica tecnico #${editId}` : "Nuovo tecnico"}</h2>
            <p className={styles.cardSubtitle}>Inserisci anagrafica, skill e disponibilità.</p>
          </div>
          <form onSubmit={handleSubmit} className={styles.form}>
            <div className={styles.field}>
              <label className={styles.label}>Nome *</label>
              <input className={styles.input} value={nome} onChange={e => setNome(e.target.value)} placeholder="Es. Felix" />
            </div>
            <div className={styles.field}>
              <label className={styles.label}>Cognome</label>
              <input className={styles.input} value={cognome} onChange={e => setCognome(e.target.value)} placeholder="Es. Rossi" />
            </div>
            <div className={styles.field}>
              <label className={styles.label}>Skill</label>
              <input className={styles.input} value={skill} onChange={e => setSkill(e.target.value)} placeholder="Es. cabina_mt,trasformatore" />
            </div>
            <div className={styles.field}>
              <label className={styles.label}>Ore/giorno</label>
              <input className={styles.input} type="number" min={1} max={24} value={ore} onChange={e => setOre(Number(e.target.value))} />
            </div>
            <div className={styles.field}>
              <label className={styles.label}>Stato *</label>
              <select className={styles.input} value={statoCampo} onChange={e => setStatoCampo(e.target.value)}>
                {STATI_TECNICO.map(s => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>
            <div className={styles.field}>
              <label className={styles.label}>Orario inizio</label>
              <input className={styles.input} type="time" value={orarioInizio} onChange={e => setOrarioInizio(e.target.value)} />
            </div>
            <div className={styles.field}>
              <label className={styles.label}>Orario fine</label>
              <input className={styles.input} type="time" value={orarioFine} onChange={e => setOrarioFine(e.target.value)} />
            </div>
            <div className={`${styles.field} ${styles.span2}`} style={{ display: "flex", flexDirection: "column" }}>
              <label className={styles.label}>Limitazioni orarie</label>
              <input className={styles.input} value={limitazioniOrarie} onChange={e => setLimitazioniOrarie(e.target.value)} placeholder="Es. no turno notturno, solo mattina" />
            </div>
            <div className={styles.field}>
              <label className={styles.label}>Telefono</label>
              <input className={styles.input} value={telefono} onChange={e => setTelefono(e.target.value)} placeholder="Es. +39 333 1234567" />
            </div>
            <div className={styles.field}>
              <label className={styles.label}>Sede / Indirizzo</label>
              <input className={styles.input} value={sedeIndirizzo} onChange={e => setSedeIndirizzo(e.target.value)} placeholder="Es. Via Roma 1, Milano" title="Usato dalla mappa emergenze per localizzare il tecnico" />
            </div>
            {isAdmin && (
              <div className={`${styles.field} ${styles.span2}`} style={{ display: "flex", flexDirection: "column" }}>
                <label className={styles.label}>Collega account utente</label>
                <select
                  className={styles.input}
                  value={utenteId ?? ""}
                  onChange={e => setUtenteId(e.target.value ? Number(e.target.value) : null)}
                >
                  <option value="">— Nessuno (scollega) —</option>
                  {utenti
                    .filter(u => u.ruolo === "tecnico" && u.is_active && (u.tecnico_id == null || u.tecnico_id === editId))
                    .map(u => (
                      <option key={u.id} value={u.id}>{u.username}</option>
                    ))
                  }
                </select>
                <span style={{ fontSize: 10, color: "var(--text-muted)", marginTop: 3 }}>
                  Solo utenti con ruolo "tecnico" non ancora associati ad altro tecnico
                </span>
              </div>
            )}
            <div className={styles.actions}>
              <button className={styles.button} type="submit" disabled={isSaving}>{isSaving ? "Salvataggio..." : editId !== null ? "Salva modifiche" : "Salva tecnico"}</button>
              {editId !== null && (
                <button type="button" onClick={cancelEdit} style={{ marginLeft: 8, padding: "8px 16px", background: "transparent", border: "1px solid rgba(75,85,99,.5)", color: "var(--text-secondary)", borderRadius: 6, cursor: "pointer", fontSize: 13 }}>Annulla</button>
              )}
            </div>
          </form>
        </section>

        {/* Tabella */}
        <section className={styles.card}>
          <div className={`${styles.cardHead} ${styles.cardHeadRow}`}>
            <div>
              <h2 className={styles.cardTitle}>Registro tecnici</h2>
              <p className={styles.cardSubtitle}>Elenco competenze, disponibilità e stato operativo.</p>
            </div>
            <div className={styles.searchWrap}>
              <input className={styles.input} value={search} onChange={e => setSearch(e.target.value)} placeholder="Cerca per nome o skill..." />
            </div>
          </div>
          <div className={styles.tableWrap}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <SortTh label="ID" col="id" />
                  <SortTh label="Nome" col="nome" />
                  <SortTh label="Cognome" col="cognome" />
                  <SortTh label="Skill" col="skill" />
                  <SortTh label="Ore/gg" col="ore_giornaliere" />
                  <SortTh label="Orario" col="orario_inizio" />
                  <SortTh label="Stato" col="stato" />
                  {isAdmin && <th style={{ fontSize: 10, color: "var(--text-muted)" }}>Account</th>}
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {filteredTecnici.length === 0 ? (
                  <tr><td colSpan={isAdmin ? 9 : 8}><div className={styles.empty}>Nessun tecnico trovato</div></td></tr>
                ) : (
                  filteredTecnici.map(t => (
                    <tr key={t.id} style={editId === t.id ? { background: "rgba(99,102,241,0.07)" } : undefined}>
                      <td className={styles.id}>#{t.id}</td>
                      <td className={styles.name}>{t.nome}</td>
                      <td>{t.cognome || "—"}</td>
                      <td>
                        <div className={styles.skillList}>
                          {splitSkills(t.skill).length > 0
                            ? splitSkills(t.skill).map(s => <span key={s} className={skillBadgeClass(styles, s)}>{s}</span>)
                            : <span className={`${styles.badge} ${styles.badgeSlate}`}>—</span>}
                        </div>
                      </td>
                      <td><span className={styles.hoursPill}>{t.ore_giornaliere?.toFixed(1)}h</span></td>
                      <td style={{ fontSize: 12, color: "var(--text-soft)" }}>{t.orario_inizio}–{t.orario_fine}</td>
                      <td>
                        {(() => {
                          const s = (t.stato || "in servizio").toLowerCase();
                          const c = STATO_COLORS[s] ?? STATO_COLORS["in servizio"];
                          const labels: Record<string, string> = {
                            "in servizio": "In Servizio", "ferie": "Ferie",
                            "malattia": "Malattia", "corso": "Corso",
                          };
                          return (
                            <span style={{
                              fontSize: 11, padding: "3px 10px", borderRadius: 6, fontWeight: 700,
                              color: c.color, background: c.bg, border: `1px solid ${c.border}`,
                              whiteSpace: "nowrap",
                            }}>
                              {labels[s] ?? t.stato}
                            </span>
                          );
                        })()}
                      </td>
                      {isAdmin && (
                        <td>
                          {t.utente_username ? (
                            <span style={{ fontSize: 11, padding: "2px 8px", background: "rgba(99,102,241,.12)", border: "1px solid rgba(99,102,241,.3)", borderRadius: 4, color: "#818cf8", fontWeight: 600 }}>
                              {t.utente_username}
                            </span>
                          ) : (
                            <span style={{ fontSize: 11, color: "var(--text-muted)" }}>—</span>
                          )}
                        </td>
                      )}
                      <td style={{ display: "flex", gap: "8px" }}>
                        <button onClick={() => editId === t.id ? cancelEdit() : startEdit(t)} style={{ fontSize: 11, padding: "3px 10px", border: "1px solid rgba(99,102,241,.4)", color: editId === t.id ? "var(--text-secondary)" : "#818cf8", background: "transparent", cursor: "pointer", borderRadius: 4 }}>
                          {editId === t.id ? "Annulla" : "Modifica"}
                        </button>
                        <button onClick={() => setShowAssenzeFor(t)} style={{ fontSize: 11, padding: "3px 10px", border: "1px solid rgba(245,158,11,.4)", color: "#f59e0b", background: "transparent", cursor: "pointer", borderRadius: 4 }}>
                          Assenze
                        </button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </section>
      </div>

      {showAssenzeFor && (
        <AssenzeModal
          tecnico={showAssenzeFor}
          onClose={() => setShowAssenzeFor(null)}
          onUpdate={() => { loadTecnici(); loadStats(); }}
        />
      )}
    </div>
  );
}
