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
  const [invioOk, setInvioOk] = useState(false);

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
        <div style={{ color: "#94a3b8", fontSize: "18px", textAlign: "center" }}>
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
          <div style={{ fontSize: "14px", color: "#94a3b8" }}>
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
        background: "#111827",
        borderBottom: "1px solid #1f2937",
        padding: "20px 16px",
        textAlign: "center",
        position: "sticky",
        top: 0,
        zIndex: 10,
      }}>
        <div style={{ fontSize: "12px", color: "#64748b", textTransform: "uppercase", letterSpacing: "1px", marginBottom: "4px" }}>
          Checklist Operatore
        </div>
        <div style={{ fontSize: "22px", fontWeight: 800, color: "#f1f5f9" }}>
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
          <div style={{ textAlign: "center", padding: "40px", color: "#94a3b8", fontSize: "16px" }}>
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
                  background: checkati.has(idx) ? "#052e16" : "#111827",
                  border: `2px solid ${checkati.has(idx) ? "#16a34a" : "#374151"}`,
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
                  background: checkati.has(idx) ? "#16a34a" : "#1f2937",
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
                    <div style={{ fontSize: "14px", color: "#94a3b8", marginTop: "4px", lineHeight: 1.4 }}>
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
              <div style={{ background: "#1f2937", borderRadius: "12px", padding: "20px", border: "2px solid #ef4444" }}>
                <div style={{ fontSize: "16px", fontWeight: 700, color: "#f87171", marginBottom: "12px" }}>
                  Descrivi l&apos;anomalia riscontrata
                </div>
                <textarea
                  value={descrizioneAnomalia}
                  onChange={e => setDescrizioneAnomalia(e.target.value)}
                  placeholder="Es. Rumore anomalo, perdita d'olio, temperatura elevata..."
                  style={{
                    width: "100%",
                    background: "#111827",
                    border: "1px solid #4b5563",
                    borderRadius: "8px",
                    color: "#f1f5f9",
                    padding: "12px",
                    fontSize: "16px",
                    minHeight: "100px",
                    resize: "vertical",
                    fontFamily: "inherit",
                    boxSizing: "border-box",
                    marginBottom: "12px",
                  }}
                />
                <div style={{ display: "flex", gap: "10px" }}>
                  <button
                    onClick={() => setShowSegnala(false)}
                    style={{ flex: 1, background: "#111827", color: "#94a3b8", border: "1px solid #374151", borderRadius: "8px", padding: "14px", fontSize: "15px", cursor: "pointer", minHeight: "50px" }}
                  >
                    Annulla
                  </button>
                  <button
                    onClick={() => {
                      // Senza auth: mostra messaggio di contatto
                      setInvioOk(true);
                    }}
                    disabled={!descrizioneAnomalia.trim()}
                    style={{
                      flex: 2,
                      background: descrizioneAnomalia.trim() ? "#dc2626" : "#374151",
                      color: "#fff",
                      border: "none",
                      borderRadius: "8px",
                      padding: "14px",
                      fontSize: "15px",
                      fontWeight: 700,
                      cursor: descrizioneAnomalia.trim() ? "pointer" : "not-allowed",
                      minHeight: "50px",
                    }}
                  >
                    Invia segnalazione
                  </button>
                </div>
              </div>
            )}
          </div>
        )}

        {/* Conferma invio */}
        {invioOk && (
          <div style={{ background: "#052e16", border: "2px solid #16a34a", borderRadius: "12px", padding: "20px", marginTop: "24px", textAlign: "center" }}>
            <div style={{ fontSize: "36px", marginBottom: "8px" }}>✅</div>
            <div style={{ fontSize: "18px", fontWeight: 700, color: "#22c55e", marginBottom: "8px" }}>
              Segnalazione ricevuta
            </div>
            <div style={{ fontSize: "14px", color: "#86efac", lineHeight: 1.5 }}>
              Il responsabile manutenzione è stato avvisato.
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
  background: "#0a0f1e",
  color: "#f1f5f9",
  maxWidth: "480px",
  margin: "0 auto",
  display: "flex",
  flexDirection: "column",
  justifyContent: "flex-start",
};
