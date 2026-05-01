"use client";

import { useEffect, useMemo, useState } from "react";
import type { CSSProperties } from "react";
import { apiGet } from "../lib/api";
import { notify } from "@/lib/toast";

type ScadenzaRow = {
  id: number;
  sito: string;
  impianto: string;
  asset: string;
  asset_id: number | null;
  piano: string;
  piano_id: number | null;
  task: string;
  tipo: string;
  frequenza: string;
  frequenza_giorni: number | null;
  ultima: string;
  ultima_ticket_id: number | null;
  ultima_data: string | null;
  prossima: string;
  prossima_ticket_id: number | null;
  prossima_data: string;
  giorni_rimanenti: number;
  priorita: string;
};

type ScadenziarioResponse = {
  items: ScadenzaRow[];
  total: number;
  generated_at: string;
};

const EMPTY_ROWS = 18;

function daysStyle(days: number): CSSProperties {
  if (days < 0) return { color: "#b91c1c", fontWeight: 800, background: "#fee2e2" };
  if (days <= 7) return { color: "#92400e", fontWeight: 800, background: "#fef3c7" };
  return { color: "#111827", fontWeight: 700 };
}

function formatDays(days: number) {
  if (days < 0) return `scaduta da ${Math.abs(days)} giorni`;
  if (days === 0) return "scade oggi";
  if (days === 1) return "1 giorno";
  return `${days} giorni`;
}

function formatDateTime(iso: string | null) {
  if (!iso) return "";
  return new Date(iso).toLocaleDateString("it-IT", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
}

export default function ScadenzePage() {
  const [rows, setRows] = useState<ScadenzaRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [generatedAt, setGeneratedAt] = useState<string | null>(null);

  useEffect(() => {
    loadScadenze();
  }, []);

  async function loadScadenze() {
    setLoading(true);
    try {
      const data = await apiGet<ScadenziarioResponse>("/scadenze/scadenziario");
      setRows(data.items || []);
      setGeneratedAt(data.generated_at || null);
    } catch (err: unknown) {
      notify.error(err instanceof Error ? err.message : "Errore nel caricamento dello scadenziario.");
      setRows([]);
    } finally {
      setLoading(false);
    }
  }

  const blankRows = useMemo(
    () => Array.from({ length: Math.max(EMPTY_ROWS - rows.length, 6) }),
    [rows.length],
  );

  return (
    <div style={{
      minHeight: "100%",
      padding: "28px 30px 42px",
      color: "#000",
      backgroundColor: "#f8fafc",
      backgroundImage: "linear-gradient(#d9d9d9 1px, transparent 1px), linear-gradient(90deg, #d9d9d9 1px, transparent 1px)",
      backgroundSize: "38px 28px, 152px 28px",
      overflowX: "auto",
    }}>
      <div style={{ minWidth: 1500, display: "grid", gridTemplateColumns: "230px 1fr", columnGap: 18 }}>
        <div />

        <header style={{ padding: "6px 0 28px 4px" }}>
          <h1 style={{ margin: 0, fontSize: 26, lineHeight: 1.2, fontWeight: 800, color: "#000" }}>
            Calendario scadenze
          </h1>
          <div style={{ marginTop: 32, fontSize: 20, color: "#000" }}>
            (solo lista Asset con scadenza)
          </div>
        </header>

        <aside style={{ paddingTop: 40, fontSize: 34, fontWeight: 800, color: "#000", whiteSpace: "nowrap" }}>
          Scadenziario ----&gt;
        </aside>

        <main>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8, color: "#111827", fontSize: 12 }}>
            <span>{loading ? "Caricamento scadenze reali..." : `${rows.length} asset/task con scadenza`}</span>
            <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
              {generatedAt && <span>Aggiornato: {formatDateTime(generatedAt)}</span>}
              <button
                type="button"
                onClick={loadScadenze}
                disabled={loading}
                style={{
                  padding: "5px 12px",
                  border: "1px solid #111",
                  background: loading ? "#e5e7eb" : "#fff",
                  color: "#000",
                  cursor: loading ? "not-allowed" : "pointer",
                  fontWeight: 700,
                  fontSize: 12,
                }}
              >
                Aggiorna
              </button>
            </div>
          </div>

          <table style={{
            width: "100%",
            borderCollapse: "collapse",
            tableLayout: "fixed",
            background: "rgba(255,255,255,0.58)",
            border: "1px solid #000",
          }}>
            <colgroup>
              <col style={{ width: 130 }} />
              <col style={{ width: 165 }} />
              <col style={{ width: 165 }} />
              <col style={{ width: 135 }} />
              <col style={{ width: 165 }} />
              <col style={{ width: 140 }} />
              <col style={{ width: 160 }} />
              <col style={{ width: 195 }} />
              <col style={{ width: 375 }} />
            </colgroup>
            <thead>
              <tr>
                {["SITO", "IMPIANTO", "ASSET", "Piano", "TIPO", "frequenza", "Ultima", "Prossima", "giorni rimanenti"].map((label) => (
                  <th key={label} style={{
                    border: "1px solid #000",
                    padding: "3px 8px",
                    height: 30,
                    fontSize: 18,
                    lineHeight: 1.1,
                    textAlign: "center",
                    verticalAlign: "middle",
                    fontWeight: 800,
                    background: "rgba(255,255,255,0.68)",
                  }}>
                    {label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id} title={row.task}>
                  <td style={cellStyle}>{row.sito || "-"}</td>
                  <td style={cellStyle}>{row.impianto || "-"}</td>
                  <td style={cellStyle}>{row.asset || "-"}</td>
                  <td style={cellStyle}>{row.piano || "-"}</td>
                  <td style={cellStyle}>{row.tipo || "PM"}</td>
                  <td style={cellStyle}>{row.frequenza || (row.frequenza_giorni ? `${row.frequenza_giorni}G` : "-")}</td>
                  <td style={cellStyle}>{row.ultima || "-"}</td>
                  <td style={cellStyle}>{row.prossima || formatDateTime(row.prossima_data)}</td>
                  <td style={{ ...cellStyle, ...daysStyle(row.giorni_rimanenti) }}>
                    {formatDays(row.giorni_rimanenti)}
                  </td>
                </tr>
              ))}

              {!loading && rows.length === 0 && (
                <tr>
                  <td colSpan={9} style={{
                    border: "1px solid #000",
                    height: 52,
                    textAlign: "center",
                    fontSize: 15,
                    color: "#374151",
                    background: "rgba(255,255,255,0.72)",
                  }}>
                    Nessuna scadenza trovata nei piani di manutenzione.
                  </td>
                </tr>
              )}

              {blankRows.map((_, index) => (
                <tr key={`blank-${index}`} aria-hidden="true">
                  {Array.from({ length: 9 }).map((__, cellIndex) => (
                    <td key={cellIndex} style={blankCellStyle} />
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </main>
      </div>
    </div>
  );
}

const cellStyle: CSSProperties = {
  border: "1px solid #000",
  height: 50,
  padding: "4px 10px",
  fontSize: 20,
  lineHeight: 1.15,
  textAlign: "center",
  verticalAlign: "middle",
  color: "#000",
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
};

const blankCellStyle: CSSProperties = {
  border: "1px solid #000",
  height: 28,
  padding: 0,
  background: "rgba(255,255,255,0.25)",
};
