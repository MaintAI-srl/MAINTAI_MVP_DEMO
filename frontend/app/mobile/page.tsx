"use client";

import { useEffect, useState } from "react";
import { API_BASE } from "../lib/api";
import { useAuth } from "../lib/auth";
import Link from "next/link";
import UploadAllegati from "../components/UploadAllegati";
import SignaturePad from "../components/SignaturePad";

type Ticket = {
  id: number;
  titolo: string;
  asset_name: string;
  priorita: string;
  stato: string;
  tipo: string;
  execution_start?: string;
};

export default function MobileHomePage() {
  const { user } = useAuth();
  const [mounted, setMounted] = useState(false);
  const [tecnicoId, setTecnicoId] = useState<number | null>(null);
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [signingTicketId, setSigningTicketId] = useState<number | null>(null);

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    async function loadProfile() {
      if (!user?.userid || !mounted) return;
      try {
        const res = await fetch(`${API_BASE}/tecnici/me?utente_id=${user.userid}`);
        if (res.ok) {
          const data = await res.json();
          setTecnicoId(data.id);
        } else {
          setError("Impossibile caricare il profilo tecnico.");
          setLoading(false);
        }
      } catch (err) { 
        console.error(err);
        setError("Errore di connessione al server.");
        setLoading(false);
      }
    }
    loadProfile();
  }, [user, mounted]);

  useEffect(() => {
    async function loadTickets() {
      if (!tecnicoId || !mounted) return;
      try {
        const res = await fetch(`${API_BASE}/tickets?tecnico_id=${tecnicoId}&limit=50`);
        if (res.ok) {
          const data = await res.json();
          setTickets(data.items);
          setError(null);
        } else {
          setError("Errore nel caricamento degli interventi.");
        }
      } catch (err) { 
        console.error(err);
        setError("Errore di rete.");
      }
      setLoading(false);
    }
    loadTickets();
  }, [tecnicoId, mounted]);

  const updateStatus = async (tid: number, newStato: string) => {
    try {
      const res = await fetch(`${API_BASE}/tickets/${tid}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ stato: newStato }),
      });
      if (res.ok) {
        setTickets(prev => prev.map(t => t.id === tid ? { ...t, stato: newStato } : t));
      }
    } catch (err) { console.error(err); }
  };

  if (!mounted) return null; // Previene errori di idratazione (Hydration Mismatch)

  if (loading) return <div style={{ padding: 40, textAlign: "center", color: "var(--text-muted)" }}>⎯⎯  Caricamento interventi...</div>;

  if (error) return <div style={{ padding: 40, textAlign: "center", color: "var(--red)" }}>⚠️ {error}</div>;

  const activeTickets = tickets.filter(t => t.stato === "In corso");
  const upcomingTickets = tickets.filter(t => t.stato === "Pianificato" || t.stato === "Aperto");

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      {/* Header Mobile */}
      <div>
        <h1 className="page-title" style={{ fontSize: 24, marginBottom: 4 }}>Ciao, {user?.username}</h1>
        <p className="page-subtitle">Hai {activeTickets.length} interventi in corso e {upcomingTickets.length} pianificati.</p>
      </div>

      {/* Sezione Attivi */}
      {activeTickets.length > 0 && (
        <section>
          <div className="sidebar-section-label" style={{ marginBottom: 10, color: "var(--amber)" }}>● IN CORSO ORA</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            {activeTickets.map(t => (
              <div key={t.id} style={{ background: "var(--bg-elevated)", border: "1px solid var(--amber)", borderRadius: "var(--radius-lg)", padding: 16 }}>
                <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 8 }}>
                  <span className="badge badge-amber">{t.priorita}</span>
                  <span style={{ fontSize: 11, color: "var(--text-muted)", fontFamily: "var(--font-mono)" }}>#{t.id}</span>
                </div>
                <div style={{ fontSize: 18, fontWeight: 700, color: "var(--text-primary)", marginBottom: 4 }}>{t.titolo}</div>
                <div style={{ fontSize: 13, color: "var(--text-secondary)", marginBottom: 16 }}>Asset: <strong>{t.asset_name}</strong></div>
                <div style={{ display: "flex", gap: 10 }}>
                   <button 
                     onClick={() => setSigningTicketId(t.id)}
                     className="btn-primary" 
                     style={{ flex: 1, height: 44, background: "var(--green)" }}
                   >
                     ✓ CHIUDI
                   </button>
                   <button 
                     onClick={() => updateStatus(t.id, "Pianificato")}
                     className="btn-secondary" 
                     style={{ flex: 1, height: 44 }}
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

      {/* Prossimi Intervalli */}
      <section>
        <div className="sidebar-section-label" style={{ marginBottom: 10 }}>PROSSIMI INTERVENTI</div>
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {upcomingTickets.length === 0 && <div style={{ color: "var(--text-disabled)", padding: 20, textAlign: "center" }}>Nessun intervento pianificato.</div>}
          {upcomingTickets.map(t => (
            <div key={t.id} style={{ border: "1px solid var(--border)", borderRadius: "var(--radius)", overflow: "hidden" }}>
              <div style={{ background: "var(--bg-card)", padding: "12px 16px", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 10, fontWeight: 700, color: "var(--blue-bright)", marginBottom: 2 }}>{t.asset_name}</div>
                  <div style={{ fontSize: 14, fontWeight: 700, color: "var(--text-primary)" }}>{t.titolo}</div>
                </div>
                <button 
                  onClick={() => updateStatus(t.id, "In corso")}
                  className="btn-secondary" 
                  style={{ width: 80, height: 36, fontSize: 11 }}
                >
                  INIZIA
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
        <Link href="/manuali" className="btn-secondary" style={{ height: 60, flexDirection: "column", gap: 4 }}>
          <span style={{ fontSize: 20 }}>◧</span>
          <span>MANUALI</span>
        </Link>
        <Link href="/assets" className="btn-secondary" style={{ height: 60, flexDirection: "column", gap: 4 }}>
          <span style={{ fontSize: 20 }}>◈</span>
          <span>ASSET</span>
        </Link>
      </section>
      {/* Signature Modal Overlay */}
      {signingTicketId && (
        <div style={{ position: "fixed", inset: 0, zIndex: 5000, background: "rgba(0,0,0,0.85)", display: "flex", alignItems: "center", padding: 20 }}>
          <div style={{ width: "100%" }}>
            <SignaturePad 
              onCancel={() => setSigningTicketId(null)}
              onSave={async (base64) => {
                const res = await fetch(`${API_BASE}/tickets/${signingTicketId}/firma`, {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({ image: base64 })
                });
                if (res.ok) {
                  await updateStatus(signingTicketId, "Chiuso");
                  setSigningTicketId(null);
                }
              }}
            />
          </div>
        </div>
      )}
    </div>
  );
}
