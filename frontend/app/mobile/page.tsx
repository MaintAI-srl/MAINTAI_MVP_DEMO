"use client";

import { useEffect, useState, useCallback } from "react";
import { apiGet, apiPost, apiPut } from "../lib/api";
import { notify } from "@/lib/toast";
import { useAuth } from "../lib/auth";
import Link from "next/link";
import UploadAllegati from "../components/UploadAllegati";
import SignaturePad from "../components/SignaturePad";
import Skeleton from "../components/Skeleton";

type Ticket = {
  id: number;
  titolo: string;
  asset_name: string;
  priorita: string;
  stato: string;
  tipo: string;
  execution_start?: string;
  planned_start?: string;
  durata_stimata_ore?: number;
};

// ── Stili priorità ───────────────────────────────────────────────────────────
function prioritaColor(p: string): string {
  switch (p?.toLowerCase()) {
    case "alta": return "#f87171";
    case "media": return "#fbbf24";
    case "bassa": return "#34d399";
    default: return "#94a3b8";
  }
}

function tipoIcon(t: string): string {
  switch (t?.toUpperCase()) {
    case "BD": return "🔧";
    case "PM": return "📋";
    case "CM": return "⚙️";
    case "ISP": return "🔍";
    default: return "◷";
  }
}

export default function MobileHomePage() {
  const { user } = useAuth();
  const [mounted, setMounted] = useState(false);
  const [tecnicoId, setTecnicoId] = useState<number | null>(null);
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [loading, setLoading] = useState(true);
  const [signingTicketId, setSigningTicketId] = useState<number | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    async function loadProfile() {
      if (!user?.userid || !mounted) return;
      try {
        const d = await apiGet<any>(`/tecnici/me?utente_id=${user.userid}`);
        setTecnicoId(d.id);
      } catch (err) {
        console.error(err);
        notify.error("Impossibile caricare il profilo tecnico.", "MOBILE");
        setLoading(false);
      }
    }
    loadProfile();
  }, [user, mounted]);

  const loadTickets = useCallback(async () => {
    if (!tecnicoId || !mounted) return;
    try {
      const d = await apiGet<any>(`/tickets?tecnico_id=${tecnicoId}&limit=50`);
      setTickets(d.items);
    } catch (err) {
      console.error(err);
      notify.error("Errore nel caricamento degli interventi.", "MOBILE");
    }
    setLoading(false);
  }, [tecnicoId, mounted]);

  useEffect(() => {
    loadTickets();
  }, [loadTickets]);

  // Pull-to-refresh manuale
  const handleRefresh = async () => {
    setRefreshing(true);
    await loadTickets();
    setRefreshing(false);
  };

  const updateStatus = async (tid: number, newStato: string) => {
    try {
      const body: Record<string, string | null> = { stato: newStato };
      // Quando inizia: registra execution_start
      if (newStato === "In corso") {
        body.execution_start = new Date().toISOString();
      }
      await apiPut(`/tickets/${tid}`, body);
      setTickets(prev => prev.map(t => t.id === tid ? { ...t, stato: newStato } : t));
      notify.success(
        newStato === "In corso" ? "Intervento avviato" :
        newStato === "Chiuso" ? "Intervento completato" :
        `Stato aggiornato: ${newStato}`,
        "TICKET"
      );
    } catch (err) {
      console.error(err);
      notify.error("Errore aggiornamento stato.", "TICKET");
    }
  };

  if (!mounted) return null;

  if (loading) {
    return (
      <div style={{ padding: "20px", display: "flex", flexDirection: "column", gap: 16 }}>
        <Skeleton variant="block" width="60%" height={28} />
        <Skeleton variant="block" width="100%" height={14} />
        <div style={{ marginTop: 12 }}>
          <Skeleton variant="card" />
        </div>
        <Skeleton variant="card" />
        <Skeleton variant="card" />
      </div>
    );
  }

  const activeTickets = tickets.filter(t => t.stato === "In corso");
  const upcomingTickets = tickets.filter(t => t.stato === "Pianificato" || t.stato === "Aperto");

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      {/* Header Mobile */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
        <div>
          <h1 className="page-title" style={{ fontSize: 24, marginBottom: 4 }}>Ciao, {user?.username}</h1>
          <p className="page-subtitle" style={{ margin: 0 }}>
            {activeTickets.length} in corso · {upcomingTickets.length} pianificati
          </p>
        </div>
        <button
          onClick={handleRefresh}
          disabled={refreshing}
          style={{
            background: "var(--bg-elevated)",
            border: "1px solid var(--border-strong)",
            borderRadius: 8,
            width: 44,
            height: 44,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            cursor: refreshing ? "wait" : "pointer",
            fontSize: 18,
            transition: "transform 0.3s",
            transform: refreshing ? "rotate(360deg)" : "none",
            color: "var(--text-secondary)",
          }}
          title="Aggiorna"
        >
          🔄
        </button>
      </div>

      {/* Quick Stats */}
      <div style={{
        display: "grid",
        gridTemplateColumns: "1fr 1fr 1fr",
        gap: 10,
      }}>
        {[
          { label: "In corso", count: activeTickets.length, color: "#fbbf24" },
          { label: "Pianificati", count: upcomingTickets.filter(t => t.stato === "Pianificato").length, color: "#a78bfa" },
          { label: "Aperti", count: upcomingTickets.filter(t => t.stato === "Aperto").length, color: "#60a5fa" },
        ].map(s => (
          <div key={s.label} style={{
            background: "var(--bg-elevated)",
            border: `1px solid ${s.color}33`,
            borderRadius: "var(--radius)",
            padding: "12px 14px",
            textAlign: "center",
          }}>
            <div style={{ fontSize: 24, fontWeight: 800, color: s.color }}>{s.count}</div>
            <div style={{ fontSize: 10, color: "var(--text-muted)", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.5px" }}>{s.label}</div>
          </div>
        ))}
      </div>

      {/* Sezione Attivi */}
      {activeTickets.length > 0 && (
        <section>
          <div className="sidebar-section-label" style={{ marginBottom: 10, color: "var(--amber)" }}>● IN CORSO ORA</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            {activeTickets.map(t => (
              <div key={t.id} style={{
                background: "var(--bg-elevated)",
                border: "1px solid var(--amber)",
                borderRadius: "var(--radius-lg)",
                padding: 16,
                // Touch-friendly: min height for comfortable tapping
              }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
                  <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                    <span style={{ fontSize: 16 }}>{tipoIcon(t.tipo)}</span>
                    <span style={{
                      fontSize: 10, fontWeight: 800, padding: "2px 8px",
                      borderRadius: 20,
                      color: prioritaColor(t.priorita),
                      background: `${prioritaColor(t.priorita)}18`,
                      border: `1px solid ${prioritaColor(t.priorita)}44`,
                    }}>{t.priorita}</span>
                  </div>
                  <span style={{ fontSize: 11, color: "var(--text-muted)", fontFamily: "var(--font-mono)" }}>#{t.id}</span>
                </div>
                <div style={{ fontSize: 18, fontWeight: 700, color: "var(--text-primary)", marginBottom: 4 }}>{t.titolo}</div>
                <div style={{ fontSize: 13, color: "var(--text-secondary)", marginBottom: 4 }}>
                  Asset: <strong>{t.asset_name}</strong>
                </div>
                {t.durata_stimata_ore && (
                  <div style={{ fontSize: 11, color: "var(--text-muted)", marginBottom: 12 }}>
                    ⏱ Durata stimata: {t.durata_stimata_ore}h
                  </div>
                )}
                <div style={{ display: "flex", gap: 10 }}>
                   <button
                     onClick={() => setSigningTicketId(t.id)}
                     className="btn-primary"
                     style={{
                       flex: 1, height: 48, background: "var(--green)",
                       fontSize: 14, fontWeight: 700,
                       // Touch targets: min 48px per WCAG
                     }}
                   >
                     ✓ CHIUDI
                   </button>
                   <button
                     onClick={() => updateStatus(t.id, "Pianificato")}
                     className="btn-secondary"
                     style={{ flex: 1, height: 48, fontSize: 14, fontWeight: 700 }}
                   >
                     ⏸ PAUSA
                   </button>
                </div>
                <div style={{ padding: "12px 0 0 0", borderTop: "1px solid rgba(251,191,36,0.15)", marginTop: 12 }}>
                   <UploadAllegati ticketId={t.id} />
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Prossimi Interventi */}
      <section>
        <div className="sidebar-section-label" style={{ marginBottom: 10 }}>PROSSIMI INTERVENTI</div>
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {upcomingTickets.length === 0 && (
            <div style={{
              color: "var(--text-disabled)", padding: 32, textAlign: "center",
              background: "var(--bg-card)", borderRadius: "var(--radius-lg)",
              border: "1px solid var(--border)",
            }}>
              <div style={{ fontSize: 28, marginBottom: 8 }}>📋</div>
              Nessun intervento pianificato.
            </div>
          )}
          {upcomingTickets.map(t => (
            <div key={t.id} style={{
              border: "1px solid var(--border)",
              borderRadius: "var(--radius)",
              overflow: "hidden",
            }}>
              <div style={{
                background: "var(--bg-card)",
                padding: "14px 16px",
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                gap: 12,
              }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: "flex", gap: 6, alignItems: "center", marginBottom: 2 }}>
                    <span style={{ fontSize: 14 }}>{tipoIcon(t.tipo)}</span>
                    <span style={{ fontSize: 10, fontWeight: 700, color: "var(--blue-bright)" }}>{t.asset_name}</span>
                    {t.planned_start && (
                      <span style={{ fontSize: 9, color: "var(--text-muted)", marginLeft: "auto" }}>
                        {new Date(t.planned_start).toLocaleDateString("it-IT", { day: "2-digit", month: "2-digit" })}
                      </span>
                    )}
                  </div>
                  <div style={{
                    fontSize: 14, fontWeight: 700, color: "var(--text-primary)",
                    overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                  }}>
                    {t.titolo}
                  </div>
                </div>
                <button
                  onClick={() => updateStatus(t.id, "In corso")}
                  className="btn-secondary"
                  style={{
                    minWidth: 80, height: 44, fontSize: 12, fontWeight: 700,
                    flexShrink: 0,
                    // Touch target >= 44px
                  }}
                >
                  ▶ INIZIA
                </button>
              </div>
              <div style={{ padding: "0 16px 12px 16px", background: "var(--bg-card)", borderTop: "none" }}>
                 <UploadAllegati ticketId={t.id} />
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* Quick Links */}
      <section style={{ marginTop: 10, display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
        <Link href="/manuali" className="btn-secondary" style={{
          height: 64, flexDirection: "column", gap: 4,
          // Touch-friendly height
        }}>
          <span style={{ fontSize: 22 }}>◧</span>
          <span style={{ fontSize: 12 }}>MANUALI</span>
        </Link>
        <Link href="/assets" className="btn-secondary" style={{
          height: 64, flexDirection: "column", gap: 4,
        }}>
          <span style={{ fontSize: 22 }}>◈</span>
          <span style={{ fontSize: 12 }}>ASSET</span>
        </Link>
      </section>

      {/* Offline indicator */}
      <OfflineIndicator />

      {/* Signature Modal Overlay */}
      {signingTicketId && (
        <div style={{ position: "fixed", inset: 0, zIndex: 5000, background: "rgba(0,0,0,0.85)", display: "flex", alignItems: "center", padding: 20 }}>
          <div style={{ width: "100%" }}>
            <SignaturePad
              onCancel={() => setSigningTicketId(null)}
              onSave={async (base64) => {
                try {
                  await apiPost(`/tickets/${signingTicketId}/firma`, { image: base64 });
                  await updateStatus(signingTicketId, "Chiuso");
                  setSigningTicketId(null);
                } catch (err) {
                  console.error(err);
                  notify.error("Errore nel salvataggio della firma.", "MOBILE");
                }
              }}
            />
          </div>
        </div>
      )}
    </div>
  );
}

// ── Indicatore stato connessione ─────────────────────────────────────────────
function OfflineIndicator() {
  const [isOnline, setIsOnline] = useState(true);

  useEffect(() => {
    const onOnline = () => setIsOnline(true);
    const onOffline = () => setIsOnline(false);
    setIsOnline(navigator.onLine);
    window.addEventListener("online", onOnline);
    window.addEventListener("offline", onOffline);
    return () => {
      window.removeEventListener("online", onOnline);
      window.removeEventListener("offline", onOffline);
    };
  }, []);

  if (isOnline) return null;

  return (
    <div style={{
      position: "fixed",
      bottom: 0,
      left: 0,
      right: 0,
      padding: "10px 16px",
      background: "#7c2d12",
      color: "#fef3c7",
      fontSize: 12,
      fontWeight: 700,
      textAlign: "center",
      zIndex: 9000,
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      gap: 8,
    }}>
      <span>📡</span>
      Modalità offline — i dati potrebbero non essere aggiornati
    </div>
  );
}
