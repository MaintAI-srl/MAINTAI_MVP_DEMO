"use client";

import { useState } from "react";
import { toast } from "sonner";
import { apiPost } from "../../lib/api";
import type { GeneratedPlan } from "../types";

interface StoricoPianiProps {
  piani: GeneratedPlan[];
  onRefresh: () => void;
}

function statusBadge(status: string) {
  if (status === "confirmed") {
    return (
      <span style={{
        background: "#065f4644", color: "#86efac",
        border: "1px solid #22c55e44",
        borderRadius: 3, padding: "1px 7px",
        fontSize: 10, fontWeight: 700,
      }}>CONFERMATO</span>
    );
  }
  if (status === "deauthorized") {
    return (
      <span style={{
        background: "#7f1d1d44", color: "#fca5a5",
        border: "1px solid #ef444444",
        borderRadius: 3, padding: "1px 7px",
        fontSize: 10, fontWeight: 700,
      }}>DEAUTORIZZATO</span>
    );
  }
  return (
    <span style={{
      background: "#1e3a5f44", color: "#60a5fa",
      border: "1px solid #3b82f644",
      borderRadius: 3, padding: "1px 7px",
      fontSize: 10, fontWeight: 700,
    }}>BOZZA</span>
  );
}

function efficienzaBadge(score: number | undefined) {
  if (score === undefined) return <span style={{ color: "#4b5563", fontSize: 12 }}>—</span>;
  const color = score >= 80 ? "#86efac" : score >= 60 ? "#fcd34d" : "#fca5a5";
  const bg = score >= 80 ? "#065f4633" : score >= 60 ? "#78350f33" : "#7f1d1d33";
  return (
    <span style={{
      background: bg, color, border: `1px solid ${color}33`,
      borderRadius: 3, padding: "1px 7px", fontSize: 11, fontWeight: 700,
    }}>{score}%</span>
  );
}

// ── Modale deautorizzazione ────────────────────────────────────────────────────
function ModaleDeautorizza({
  piano,
  onConfirm,
  onClose,
}: {
  piano: GeneratedPlan;
  onConfirm: (motivo: string) => void;
  onClose: () => void;
}) {
  const [motivo, setMotivo] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSubmit() {
    if (!motivo.trim()) { toast.error("Inserisci un motivo per la deautorizzazione"); return; }
    setLoading(true);
    try {
      await onConfirm(motivo.trim());
    } finally {
      setLoading(false);
    }
  }

  return (
    <div style={{
      position: "fixed", inset: 0,
      background: "rgba(0,0,0,0.75)",
      display: "flex", alignItems: "center", justifyContent: "center",
      zIndex: 2000,
    }} onClick={onClose}>
      <div
        style={{
          background: "#111827",
          border: "1px solid #7f1d1d",
          borderRadius: 12,
          padding: 24,
          width: 420,
          boxShadow: "0 24px 60px rgba(0,0,0,0.7)",
        }}
        onClick={e => e.stopPropagation()}
      >
        <div style={{ fontSize: 15, fontWeight: 700, color: "#fca5a5", marginBottom: 4 }}>
          Deautorizza Piano
        </div>
        <div style={{ fontSize: 12, color: "#9ca3af", marginBottom: 20 }}>
          {piano.plan_label ?? `Piano #${piano.id}`} — questa azione è irreversibile
        </div>

        <div>
          <label style={{ fontSize: 11, color: "#9ca3af", display: "block", marginBottom: 6 }}>
            Motivo deautorizzazione *
          </label>
          <textarea
            value={motivo}
            onChange={e => setMotivo(e.target.value)}
            rows={4}
            placeholder="Es. Piano superato da nuove priorità operative..."
            style={{
              width: "100%",
              background: "#1f2937",
              border: "1px solid #374151",
              color: "#f9fafb",
              borderRadius: 6,
              padding: "10px 12px",
              fontSize: 13,
              resize: "vertical",
              boxSizing: "border-box",
              fontFamily: "inherit",
            }}
          />
        </div>

        <div style={{ display: "flex", gap: 8, marginTop: 20 }}>
          <button onClick={onClose} style={{
            flex: 1, background: "#1f2937",
            border: "1px solid #374151", color: "#9ca3af",
            borderRadius: 6, padding: "9px 0",
            cursor: "pointer", fontSize: 13,
          }}>Annulla</button>
          <button
            onClick={handleSubmit}
            disabled={loading || !motivo.trim()}
            style={{
              flex: 1,
              background: loading || !motivo.trim() ? "#1f2937" : "#7f1d1d",
              border: "1px solid #ef444455",
              color: loading || !motivo.trim() ? "#6b7280" : "#fca5a5",
              borderRadius: 6,
              padding: "9px 0",
              cursor: loading || !motivo.trim() ? "not-allowed" : "pointer",
              fontSize: 13,
              fontWeight: 600,
            }}
          >
            {loading ? "Elaborazione..." : "Deautorizza"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Riga espandibile ───────────────────────────────────────────────────────────
function RigaPiano({
  piano,
  onDeautorizza,
}: {
  piano: GeneratedPlan;
  onDeautorizza: (p: GeneratedPlan) => void;
}) {
  const [espanso, setEspanso] = useState(false);
  const planned = piano.plan_json?.planned_workorders ?? [];
  const deferred = piano.plan_json?.deferred_workorders ?? [];

  return (
    <>
      <tr
        onClick={() => setEspanso(!espanso)}
        style={{
          cursor: "pointer",
          background: espanso ? "#1a2332" : "transparent",
          transition: "background 120ms",
        }}
        onMouseEnter={e => { if (!espanso) (e.currentTarget as HTMLElement).style.background = "#111827"; }}
        onMouseLeave={e => { if (!espanso) (e.currentTarget as HTMLElement).style.background = "transparent"; }}
      >
        <td style={tdStyle}>
          <span style={{ color: "#60a5fa", fontWeight: 700 }}>
            {piano.plan_label ?? `#${piano.id}`}
          </span>
        </td>
        <td style={tdStyle}>
          {piano.created_at
            ? new Date(piano.created_at).toLocaleDateString("it-IT", { day: "2-digit", month: "2-digit", year: "2-digit" })
            : "—"}
        </td>
        <td style={tdStyle}>
          <span style={{ color: "#9ca3af" }}>{piano.confirmed_by ?? "—"}</span>
        </td>
        <td style={{ ...tdStyle, textAlign: "center" }}>
          <span style={{ color: "#f9fafb", fontWeight: 700 }}>{piano.wo_count ?? 0}</span>
        </td>
        <td style={{ ...tdStyle, textAlign: "center" }}>
          {efficienzaBadge(piano.efficiency_score)}
        </td>
        <td style={{ ...tdStyle, textAlign: "center" }}>
          {statusBadge(piano.status)}
        </td>
        <td style={{ ...tdStyle, textAlign: "right" }}>
          <div style={{ display: "flex", gap: 6, justifyContent: "flex-end" }}>
            <span style={{ fontSize: 11, color: "#6b7280" }}>
              {espanso ? "▲" : "▼"}
            </span>
            {piano.status === "confirmed" && (
              <button
                onClick={e => { e.stopPropagation(); onDeautorizza(piano); }}
                style={{
                  background: "transparent",
                  border: "1px solid #ef444455",
                  color: "#ef4444",
                  borderRadius: 4,
                  padding: "2px 8px",
                  fontSize: 10,
                  cursor: "pointer",
                  fontWeight: 600,
                }}
              >
                Deautorizza
              </button>
            )}
          </div>
        </td>
      </tr>

      {/* Riga espansa */}
      {espanso && (
        <tr style={{ background: "#0d1420" }}>
          <td colSpan={7} style={{ padding: "12px 20px 16px" }}>
            <div style={{ display: "flex", gap: 24, flexWrap: "wrap" }}>
              {/* Colonna sinistra — pianificati */}
              <div style={{ flex: "1 1 220px" }}>
                <div style={{ fontSize: 11, fontWeight: 700, color: "#6b7280", letterSpacing: "0.08em", marginBottom: 8 }}>
                  PIANIFICATI ({planned.length})
                </div>
                {planned.slice(0, 10).map((wo: any) => (
                  <div key={wo.wo_id} style={{
                    fontSize: 11, color: "#9ca3af", marginBottom: 4,
                    display: "flex", gap: 8,
                  }}>
                    <span style={{ color: "#4b5563" }}>#{wo.wo_id}</span>
                    <span style={{ color: "#e2e8f0" }}>{wo.planned_date}</span>
                    <span style={{ color: "#60a5fa" }}>{wo.planned_start_time}–{wo.planned_end_time}</span>
                  </div>
                ))}
                {planned.length > 10 && (
                  <div style={{ fontSize: 11, color: "#4b5563" }}>...e altri {planned.length - 10}</div>
                )}
              </div>

              {/* Colonna centro — deferred */}
              <div style={{ flex: "1 1 220px" }}>
                <div style={{ fontSize: 11, fontWeight: 700, color: "#6b7280", letterSpacing: "0.08em", marginBottom: 8 }}>
                  NON PIANIFICATI ({deferred.length})
                </div>
                {deferred.slice(0, 6).map((d: any) => (
                  <div key={d.wo_id} style={{ fontSize: 11, color: "#9ca3af", marginBottom: 4 }}>
                    <span style={{ color: "#4b5563" }}>#{d.wo_id}</span>{" "}
                    <span style={{ fontStyle: "italic", color: "#6b7280" }}>{d.reason}</span>
                  </div>
                ))}
                {deferred.length > 6 && (
                  <div style={{ fontSize: 11, color: "#4b5563" }}>...e altri {deferred.length - 6}</div>
                )}
              </div>

              {/* Colonna destra — meta */}
              <div style={{ flex: "0 0 200px" }}>
                <div style={{ fontSize: 11, fontWeight: 700, color: "#6b7280", letterSpacing: "0.08em", marginBottom: 8 }}>
                  DETTAGLI
                </div>
                {piano.confirmed_at && (
                  <div style={{ fontSize: 11, color: "#9ca3af", marginBottom: 3 }}>
                    Confermato: <span style={{ color: "#f9fafb" }}>
                      {new Date(piano.confirmed_at).toLocaleString("it-IT", { dateStyle: "short", timeStyle: "short" })}
                    </span>
                  </div>
                )}
                {piano.deauthorized_at && (
                  <div style={{ fontSize: 11, color: "#9ca3af", marginBottom: 3 }}>
                    Deautorizzato: <span style={{ color: "#fca5a5" }}>
                      {new Date(piano.deauthorized_at).toLocaleString("it-IT", { dateStyle: "short", timeStyle: "short" })}
                    </span>
                  </div>
                )}
                {piano.deauthorized_by && (
                  <div style={{ fontSize: 11, color: "#9ca3af", marginBottom: 3 }}>
                    Da: <span style={{ color: "#fca5a5" }}>{piano.deauthorized_by}</span>
                  </div>
                )}
                {piano.deauthorization_reason && (
                  <div style={{
                    fontSize: 11, color: "#fca5a5", marginTop: 8,
                    background: "#7f1d1d22", border: "1px solid #ef444433",
                    borderRadius: 4, padding: "6px 8px", fontStyle: "italic",
                  }}>
                    {piano.deauthorization_reason}
                  </div>
                )}
              </div>
            </div>
          </td>
        </tr>
      )}
    </>
  );
}

const tdStyle: React.CSSProperties = {
  padding: "10px 14px",
  fontSize: 12,
  color: "#d1d5db",
  borderBottom: "1px solid #1f2937",
  whiteSpace: "nowrap",
};

const thStyle: React.CSSProperties = {
  padding: "8px 14px",
  fontSize: 10,
  fontWeight: 700,
  color: "#6b7280",
  letterSpacing: "0.08em",
  borderBottom: "2px solid #1f2937",
  textAlign: "left",
  whiteSpace: "nowrap",
};

// ── Componente principale ──────────────────────────────────────────────────────
export default function StoricoPiani({ piani, onRefresh }: StoricoPianiProps) {
  const [pianoDeauto, setPianoDeauto] = useState<GeneratedPlan | null>(null);

  async function handleDeautorizza(motivo: string) {
    if (!pianoDeauto) return;
    try {
      await apiPost(`/planning/deauthorize/${pianoDeauto.id}`, { reason: motivo });
      toast.success(`${pianoDeauto.plan_label ?? `Piano #${pianoDeauto.id}`} deautorizzato`);
      setPianoDeauto(null);
      onRefresh();
    } catch (e: any) {
      toast.error(e?.message ?? "Errore deautorizzazione");
      throw e;
    }
  }

  return (
    <div style={{
      background: "#111827",
      border: "1px solid #1f2937",
      borderRadius: 8,
      overflow: "hidden",
    }}>
      <div style={{
        padding: "14px 20px",
        borderBottom: "1px solid #1f2937",
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
      }}>
        <div>
          <div style={{ fontSize: 13, fontWeight: 700, color: "#f9fafb" }}>
            Storico Piani
          </div>
          <div style={{ fontSize: 11, color: "#6b7280", marginTop: 2 }}>
            Ultimi {piani.length} piani confermati o deautorizzati
          </div>
        </div>
        <button
          onClick={onRefresh}
          style={{
            background: "transparent",
            border: "1px solid #374151",
            color: "#9ca3af",
            borderRadius: 6,
            padding: "5px 10px",
            cursor: "pointer",
            fontSize: 11,
          }}
        >
          ↻ Aggiorna
        </button>
      </div>

      {piani.length === 0 ? (
        <div style={{ padding: "32px 20px", textAlign: "center", color: "#4b5563", fontSize: 13 }}>
          Nessun piano confermato ancora
        </div>
      ) : (
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr style={{ background: "#0d1420" }}>
                <th style={thStyle}>NUMERO</th>
                <th style={thStyle}>DATA</th>
                <th style={thStyle}>APPROVATO DA</th>
                <th style={{ ...thStyle, textAlign: "center" }}>N° TICKET</th>
                <th style={{ ...thStyle, textAlign: "center" }}>EFFICIENZA</th>
                <th style={{ ...thStyle, textAlign: "center" }}>STATO</th>
                <th style={{ ...thStyle, textAlign: "right" }}>AZIONI</th>
              </tr>
            </thead>
            <tbody>
              {piani.map(p => (
                <RigaPiano
                  key={p.id}
                  piano={p}
                  onDeautorizza={setPianoDeauto}
                />
              ))}
            </tbody>
          </table>
        </div>
      )}

      {pianoDeauto && (
        <ModaleDeautorizza
          piano={pianoDeauto}
          onConfirm={handleDeautorizza}
          onClose={() => setPianoDeauto(null)}
        />
      )}
    </div>
  );
}
