"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { apiGet } from "../lib/api";

type Scadenza = {
  id: number;
  asset_id: number;
  asset_nome: string;
  descrizione: string;
  scadenza: string;
  urgenza: "alta" | "media";
};

type TicketAssegnato = {
  id: number;
  titolo: string;
  stato: string;
  priorita: string;
  planned_start: string | null;
};

type TabType = "scadenze" | "tickets";

export default function NotificationPanel() {
  const [isOpen, setIsOpen] = useState(false);
  const [tab, setTab] = useState<TabType>("scadenze");
  const [scadenze, setScadenze] = useState<Scadenza[]>([]);
  const [ticketsAssegnati, setTicketsAssegnati] = useState<TicketAssegnato[]>([]);
  const [loadingScadenze, setLoadingScadenze] = useState(false);
  const [loadingTickets, setLoadingTickets] = useState(false);
  const router = useRouter();

  const totale = scadenze.length + ticketsAssegnati.length;

  async function loadScadenze() {
    setLoadingScadenze(true);
    try {
      const d = await apiGet<Scadenza[]>("/scadenze/imminenti?days=15");
      setScadenze(d);
    } catch {
      // non-critical — silenzioso
    } finally {
      setLoadingScadenze(false);
    }
  }

  async function loadTicketsAssegnati() {
    setLoadingTickets(true);
    try {
      // Carica i ticket in stato "In corso" o "Pianificato" assegnati all'utente corrente
      const d = await apiGet<{ items: TicketAssegnato[] }>("/tickets?stato=In corso&limit=20");
      const d2 = await apiGet<{ items: TicketAssegnato[] }>("/tickets?stato=Pianificato&limit=20");
      const combined = [...(d.items ?? []), ...(d2.items ?? [])];
      // Deduplication
      const seen = new Set<number>();
      setTicketsAssegnati(combined.filter(t => { if (seen.has(t.id)) return false; seen.add(t.id); return true; }));
    } catch {
      // non-critical
    } finally {
      setLoadingTickets(false);
    }
  }

  useEffect(() => {
    // Ritardo iniziale di 4s per non bloccare il primo paint (desktop cold start)
    const startup = setTimeout(() => {
      loadScadenze();
      loadTicketsAssegnati();
    }, 4000);
    const timer = setInterval(() => {
      loadScadenze();
      loadTicketsAssegnati();
    }, 60000);
    return () => { clearTimeout(startup); clearInterval(timer); };
  }, []);

  const PRIO_COLOR: Record<string, string> = { alta: "#f87171", media: "#fbbf24", bassa: "#34d399" };

  return (
    <div style={{ position: "relative" }}>
      {/* Campanellina */}
      <button
        onClick={() => setIsOpen(v => !v)}
        style={{
          background: "transparent", border: "none", cursor: "pointer",
          position: "relative", color: totale > 0 ? "var(--amber)" : "var(--text-muted)",
          display: "flex", alignItems: "center", justifyContent: "center", width: 40, height: 40,
        }}
      >
        <span style={{ fontSize: 22 }}>🔔</span>
        {totale > 0 && (
          <span style={{
            position: "absolute", top: 8, right: 8, background: "#f87171",
            color: "#fff", fontSize: 9, fontWeight: 800, padding: "2px 5px",
            borderRadius: "50%", border: "2px solid #0d1829", minWidth: 14, textAlign: "center",
          }}>
            {totale > 99 ? "99+" : totale}
          </span>
        )}
      </button>

      {isOpen && (
        <>
          <div style={{ position: "fixed", inset: 0, zIndex: 999 }} onClick={() => setIsOpen(false)} />
          <div style={{
            position: "absolute", top: 48, right: 0, width: 340,
            background: "#0f172a", border: "1px solid rgba(59,130,246,0.3)",
            borderRadius: 16, boxShadow: "0 20px 50px rgba(0,0,0,0.6)", zIndex: 1000,
            overflow: "hidden",
          }}>
            {/* Header */}
            <div style={{ padding: "14px 18px 0", borderBottom: "1px solid var(--border-subtle)" }}>
              <div style={{ fontWeight: 800, fontSize: 12, color: "#fff", marginBottom: 10, letterSpacing: "0.08em" }}>NOTIFICHE</div>
              {/* Tabs */}
              <div style={{ display: "flex", gap: 0 }}>
                {([["scadenze", "Scadenze PM", scadenze.length], ["tickets", "Attività", ticketsAssegnati.length]] as [TabType, string, number][]).map(([t, label, count]) => (
                  <button
                    key={t}
                    onClick={() => setTab(t)}
                    style={{
                      background: "transparent", border: "none",
                      borderBottom: tab === t ? "2px solid #818cf8" : "2px solid transparent",
                      color: tab === t ? "#818cf8" : "#64748b",
                      fontSize: 11, fontWeight: 700, padding: "6px 14px 8px",
                      cursor: "pointer", display: "flex", alignItems: "center", gap: 5,
                    }}
                  >
                    {label}
                    {count > 0 && (
                      <span style={{ background: tab === t ? "rgba(129,140,248,0.2)" : "rgba(100,116,139,0.2)", color: tab === t ? "#818cf8" : "#64748b", fontSize: 9, fontWeight: 800, padding: "1px 5px", borderRadius: 8 }}>{count}</span>
                    )}
                  </button>
                ))}
              </div>
            </div>

            {/* Contenuto tab */}
            <div style={{ maxHeight: 380, overflowY: "auto" }}>
              {tab === "scadenze" && (
                <>
                  {loadingScadenze ? (
                    <div style={{ padding: 30, textAlign: "center", color: "#64748b", fontSize: 12 }}>Caricamento...</div>
                  ) : scadenze.length === 0 ? (
                    <div style={{ padding: 36, textAlign: "center", color: "#64748b", fontSize: 12 }}>
                      Nessuna scadenza imminente nei prossimi 15 giorni.
                    </div>
                  ) : (
                    scadenze.map(s => (
                      <div key={s.id} style={{ padding: "12px 18px", borderBottom: "1px solid var(--border-subtle)", background: s.urgenza === "alta" ? "rgba(248,113,113,0.04)" : "transparent" }}>
                        <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 3 }}>
                          <span style={{ fontSize: 10, fontWeight: 800, color: s.urgenza === "alta" ? "#f87171" : "#818cf8", textTransform: "uppercase", letterSpacing: ".07em" }}>
                            {s.asset_nome}
                          </span>
                          <span style={{ fontSize: 10, color: "var(--text-muted)" }}>
                            {new Date(s.scadenza).toLocaleDateString("it-IT", { day: "2-digit", month: "short" })}
                          </span>
                        </div>
                        <div style={{ fontSize: 12, color: "#cbd5e1", lineHeight: 1.4 }}>{s.descrizione}</div>
                        {s.urgenza === "alta" && (
                          <div style={{ fontSize: 10, color: "#f87171", fontWeight: 700, marginTop: 3 }}>URGENTE</div>
                        )}
                      </div>
                    ))
                  )}
                </>
              )}

              {tab === "tickets" && (
                <>
                  {loadingTickets ? (
                    <div style={{ padding: 30, textAlign: "center", color: "#64748b", fontSize: 12 }}>Caricamento...</div>
                  ) : ticketsAssegnati.length === 0 ? (
                    <div style={{ padding: 36, textAlign: "center", color: "#64748b", fontSize: 12 }}>
                      Nessun ticket attivo al momento.
                    </div>
                  ) : (
                    ticketsAssegnati.map(t => (
                      <div key={t.id} style={{ padding: "12px 18px", borderBottom: "1px solid var(--border-subtle)" }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 3 }}>
                          <span style={{ fontSize: 9, fontWeight: 700, padding: "2px 5px", borderRadius: 3, color: PRIO_COLOR[t.priorita?.toLowerCase()] ?? "#94a3b8", background: `${PRIO_COLOR[t.priorita?.toLowerCase()] ?? "#94a3b8"}20` }}>
                            {t.priorita}
                          </span>
                          <span style={{ fontSize: 9, color: "#64748b", background: "var(--border-subtle)", padding: "2px 5px", borderRadius: 3 }}>{t.stato}</span>
                        </div>
                        <div style={{ fontSize: 12, color: "#cbd5e1", lineHeight: 1.3, marginBottom: 2 }}>{t.titolo}</div>
                        {t.planned_start && (
                          <div style={{ fontSize: 10, color: "#64748b" }}>
                            Pianificato: {new Date(t.planned_start).toLocaleDateString("it-IT", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })}
                          </div>
                        )}
                      </div>
                    ))
                  )}
                </>
              )}
            </div>

            {/* Footer */}
            <div style={{ padding: "10px 18px", background: "var(--border-subtle)", borderTop: "1px solid var(--border-subtle)", display: "flex", justifyContent: "space-between" }}>
              <button
                onClick={() => { setIsOpen(false); router.push("/scadenze"); }}
                style={{ background: "transparent", border: "none", color: "#818cf8", fontSize: 11, fontWeight: 700, cursor: "pointer" }}
              >
                Calendario scadenze →
              </button>
              <button
                onClick={() => { setIsOpen(false); router.push("/ticket"); }}
                style={{ background: "transparent", border: "none", color: "#64748b", fontSize: 11, fontWeight: 600, cursor: "pointer" }}
              >
                Tutti i ticket →
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
