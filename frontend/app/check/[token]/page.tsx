"use client";

import { useState, useEffect } from "react";
import { useParams } from "next/navigation";

const API_BASE = process.env.NEXT_PUBLIC_API_BASE ?? "https://maintai-v3.onrender.com";

// ─── Tipi ───────────────────────────────────────────────────────────────────

interface VoceCheck {
  label: string;
  descrizione?: string;
}

interface CheckData {
  id: number;
  asset_id: number;
  asset_nome: string;
  voci: VoceCheck[];
  public_token: string;
}

// ─── Pagina pubblica — NO sidebar, NO auth ──────────────────────────────────

export default function CheckPubblicoPage() {
  const params = useParams();
  const token = params.token as string;

  const [data, setData] = useState<CheckData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [checkati, setCheckati] = useState<Set<number>>(new Set());
  const [showSegnala, setShowSegnala] = useState(false);
  const [descrizioneAnomalia, setDescrizioneAnomalia] = useState("");
  const [operatoreNome, setOperatoreNome] = useState("");
  const [invioOk, setInvioOk] = useState(false);
  const [invioLoading, setInvioLoading] = useState(false);
  const [ticketCreato, setTicketCreato] = useState<number | null>(null);
  const [invioError, setInvioError] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    fetch(`${API_BASE}/check/public/${token}`)
      .then(r => {
        if (!r.ok) throw new Error("Checklist non trovata");
        return r.json();
      })
      .then(setData)
      .catch(err => setError(err.message))
      .finally(() => setLoading(false));
  }, [token]);

  const toggleCheck = (idx: number) => {
    setCheckati(prev => {
      const next = new Set(prev);
      next.has(idx) ? next.delete(idx) : next.add(idx);
      return next;
    });
  };

  if (loading) {
    return (
      <div style={pageStyle}>
        <div style={{ color: "var(--text-muted)", fontSize: "18px", textAlign: "center" }}>
          Caricamento checklist...
        </div>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div style={pageStyle}>
        <div style={{ textAlign: "center" }}>
          <div style={{ fontSize: "48px", marginBottom: "16px" }}>⚠️</div>
          <div style={{ fontSize: "18px", color: "#f87171", marginBottom: "8px" }}>Checklist non trovata</div>
          <div style={{ fontSize: "14px", color: "var(--text-muted)" }}>
            Il codice QR potrebbe essere scaduto o non valido.
            <br />Contatta il responsabile manutenzione.
          </div>
        </div>
      </div>
    );
  }

  const tuttiCheckati = data.voci.length > 0 && checkati.size === data.voci.length;

  return (
    <div style={pageStyle}>
      {/* Header */}
      <div style={{
        background: "var(--surface-2)",
        borderBottom: "1px solid var(--border-default)",
        padding: "20px 16px",
        textAlign: "center",
        position: "sticky",
        top: 0,
        zIndex: 10,
      }}>
        <div style={{ fontSize: "12px", color: "#64748b", textTransform: "uppercase", letterSpacing: "1px", marginBottom: "4px" }}>
          Checklist Operatore
        </div>
        <div style={{ fontSize: "22px", fontWeight: 800, color: "var(--text-primary)" }}>
          🔧 {data.asset_nome}
        </div>
        {tuttiCheckati && (
          <div style={{ marginTop: "8px", fontSize: "14px", color: "#22c55e", fontWeight: 700 }}>
            ✓ Tutti i controlli completati
          </div>
        )}
      </div>

      {/* Lista voci */}
      <div style={{ padding: "16px" }}>
        {data.voci.length === 0 ? (
          <div style={{ textAlign: "center", padding: "40px", color: "var(--text-muted)", fontSize: "16px" }}>
            Nessun punto di controllo configurato.
            <br />Contatta il responsabile manutenzione.
          </div>
        ) : (
          <>
            <div style={{ fontSize: "13px", color: "#64748b", marginBottom: "12px", textTransform: "uppercase", letterSpacing: "0.5px" }}>
              {data.voci.length} punto{data.voci.length !== 1 ? "i" : ""} di controllo
            </div>
            {data.voci.map((voce, idx) => (
              <button
                key={idx}
                onClick={() => toggleCheck(idx)}
                style={{
                  width: "100%",
                  background: checkati.has(idx) ? "var(--green-dim)" : "var(--surface-2)",
                  border: `2px solid ${checkati.has(idx) ? "#16a34a" : "var(--border-default)"}`,
                  borderRadius: "12px",
                  padding: "16px",
                  marginBottom: "10px",
                  display: "flex",
                  alignItems: "flex-start",
                  gap: "16px",
                  cursor: "pointer",
                  textAlign: "left",
                  WebkitTapHighlightColor: "transparent",
                  minHeight: "64px",
                }}
              >
                {/* Checkbox visuale */}
                <div style={{
                  width: "28px",
                  height: "28px",
                  borderRadius: "50%",
                  background: checkati.has(idx) ? "#16a34a" : "var(--surface-3)",
                  border: `2px solid ${checkati.has(idx) ? "#22c55e" : "#4b5563"}`,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  flexShrink: 0,
                  fontSize: "16px",
                  color: "#fff",
                  marginTop: "1px",
                }}>
                  {checkati.has(idx) ? "✓" : ""}
                </div>
                {/* Testo */}
                <div style={{ flex: 1 }}>
                  <div style={{
                    fontSize: "18px",
                    fontWeight: 600,
                    color: checkati.has(idx) ? "#86efac" : "#f1f5f9",
                    lineHeight: 1.3,
                    textDecoration: checkati.has(idx) ? "line-through" : "none",
                    opacity: checkati.has(idx) ? 0.8 : 1,
                  }}>
                    {voce.label}
                  </div>
                  {voce.descrizione && (
                    <div style={{ fontSize: "14px", color: "var(--text-muted)", marginTop: "4px", lineHeight: 1.4 }}>
                      {voce.descrizione}
                    </div>
                  )}
                </div>
              </button>
            ))}
          </>
        )}

        {/* Pulsante segnala anomalia */}
        {!invioOk && (
          <div style={{ marginTop: "24px" }}>
            {!showSegnala ? (
              <button
                onClick={() => setShowSegnala(true)}
                style={{
                  width: "100%",
                  background: "#7f1d1d",
                  color: "#fca5a5",
                  border: "2px solid #ef4444",
                  borderRadius: "12px",
                  padding: "18px",
                  fontSize: "18px",
                  fontWeight: 700,
                  cursor: "pointer",
                  minHeight: "60px",
                  WebkitTapHighlightColor: "transparent",
                }}
              >
                🔴 Segnala anomalia
              </button>
            ) : (
              <div style={{ background: "var(--surface-3)", borderRadius: "12px", padding: "20px", border: "2px solid #ef4444" }}>
                <div style={{ fontSize: "16px", fontWeight: 700, color: "#f87171", marginBottom: "12px" }}>
                  Descrivi l&apos;anomalia riscontrata
                </div>
                {/* Campo nome operatore */}
                <input
                  type="text"
                  value={operatoreNome}
                  onChange={e => setOperatoreNome(e.target.value)}
                  placeholder="Il tuo nome (facoltativo)"
                  style={{
                    width: "100%",
                    background: "var(--surface-2)",
                    border: "1px solid #4b5563",
                    borderRadius: "8px",
                    color: "var(--text-primary)",
                    padding: "12px",
                    fontSize: "16px",
                    fontFamily: "inherit",
                    boxSizing: "border-box",
                    marginBottom: "10px",
                  }}
                />
                <textarea
                  value={descrizioneAnomalia}
                  onChange={e => setDescrizioneAnomalia(e.target.value)}
                  placeholder="Es. Rumore anomalo, perdita d'olio, temperatura elevata..."
                  style={{
                    width: "100%",
                    background: "var(--surface-2)",
                    border: "1px solid #4b5563",
                    borderRadius: "8px",
                    color: "var(--text-primary)",
                    padding: "12px",
                    fontSize: "16px",
                    minHeight: "100px",
                    resize: "vertical",
                    fontFamily: "inherit",
                    boxSizing: "border-box",
                    marginBottom: "12px",
                  }}
                />
                {invioError && (
                  <div style={{ color: "#f87171", fontSize: "13px", marginBottom: "10px" }}>
                    ⚠️ {invioError}
                  </div>
                )}
                <div style={{ display: "flex", gap: "10px" }}>
                  <button
                    onClick={() => { setShowSegnala(false); setInvioError(null); }}
                    disabled={invioLoading}
                    style={{ flex: 1, background: "var(--surface-2)", color: "var(--text-muted)", border: "1px solid var(--border-default)", borderRadius: "8px", padding: "14px", fontSize: "15px", cursor: "pointer", minHeight: "50px" }}
                  >
                    Annulla
                  </button>
                  <button
                    onClick={async () => {
                      if (!descrizioneAnomalia.trim()) return;
                      setInvioLoading(true);
                      setInvioError(null);
                      try {
                        const res = await fetch(`${API_BASE}/check/public/${token}/segnala`, {
                          method: "POST",
                          headers: { "Content-Type": "application/json" },
                          body: JSON.stringify({
                            descrizione: descrizioneAnomalia.trim(),
                            operatore: operatoreNome.trim() || undefined,
                          }),
                        });
                        if (!res.ok) {
                          const err = await res.json().catch(() => ({}));
                          throw new Error(err.detail ?? "Errore invio segnalazione");
                        }
                        const data = await res.json();
                        setTicketCreato(data.ticket_id ?? null);
                        setInvioOk(true);
                      } catch (e: unknown) {
                        const msg = e instanceof Error ? e.message : "Errore di rete";
                        setInvioError(msg);
                      } finally {
                        setInvioLoading(false);
                      }
                    }}
                    disabled={!descrizioneAnomalia.trim() || invioLoading}
                    style={{
                      flex: 2,
                      background: descrizioneAnomalia.trim() && !invioLoading ? "#dc2626" : "#374151",
                      color: "#fff",
                      border: "none",
                      borderRadius: "8px",
                      padding: "14px",
                      fontSize: "15px",
                      fontWeight: 700,
                      cursor: descrizioneAnomalia.trim() && !invioLoading ? "pointer" : "not-allowed",
                      minHeight: "50px",
                    }}
                  >
                    {invioLoading ? "Invio in corso..." : "Invia segnalazione"}
                  </button>
                </div>
              </div>
            )}
          </div>
        )}

        {/* Conferma invio */}
        {invioOk && (
          <div style={{ background: "var(--green-dim)", border: "2px solid #16a34a", borderRadius: "12px", padding: "20px", marginTop: "24px", textAlign: "center" }}>
            <div style={{ fontSize: "36px", marginBottom: "8px" }}>✅</div>
            <div style={{ fontSize: "18px", fontWeight: 700, color: "#22c55e", marginBottom: "8px" }}>
              Segnalazione ricevuta
            </div>
            <div style={{ fontSize: "14px", color: "#86efac", lineHeight: 1.5 }}>
              {ticketCreato
                ? <>Ticket <strong style={{ color: "#4ade80" }}>#{ticketCreato}</strong> aperto — il responsabile è stato avvisato.</>
                : "Il responsabile manutenzione è stato avvisato."
              }
              {descrizioneAnomalia && (
                <div style={{ marginTop: "8px", fontStyle: "italic", opacity: 0.8 }}>
                  &ldquo;{descrizioneAnomalia}&rdquo;
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Footer */}
      <div style={{ padding: "16px", textAlign: "center", borderTop: "1px solid #1f2937", marginTop: "16px" }}>
        <div style={{ fontSize: "11px", color: "#4b5563" }}>Powered by MaintAI · Asset #{data.asset_id}</div>
      </div>
    </div>
  );
}

const pageStyle: React.CSSProperties = {
  minHeight: "100vh",
  background: "var(--surface-0)",
  color: "var(--text-primary)",
  maxWidth: "480px",
  margin: "0 auto",
  display: "flex",
  flexDirection: "column",
  justifyContent: "flex-start",
};
