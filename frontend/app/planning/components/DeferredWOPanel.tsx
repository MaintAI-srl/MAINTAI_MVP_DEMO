"use client";

import { useState, useMemo } from "react";
import type { DeferredWO, TicketData } from "../types";
import { REASON_CODE_LABELS, tipoStyle } from "../types";

interface DeferredWOPanelProps {
  deferredWOs: DeferredWO[];
  allTickets: TicketData[];
  deferredCounts?: Record<number, number>; // wo_id → numero di volte rimandato nei piani storici (#12)
}

const PRIO_ORDER: Record<string, number> = { Alta: 0, Media: 1, Bassa: 2 };

export default function DeferredWOPanel({ deferredWOs, allTickets, deferredCounts }: DeferredWOPanelProps) {
  const [filterCode, setFilterCode] = useState<string>("");

  const ticketMap = useMemo(() => {
    const m = new Map<number, TicketData>();
    allTickets.forEach((t) => m.set(t.id, t));
    return m;
  }, [allTickets]);

  // Codici presenti nei deferral correnti
  const availableCodes = useMemo(() => {
    const codes = new Set<string>();
    deferredWOs.forEach((d) => {
      if (d.reason_code) codes.add(d.reason_code);
    });
    return Array.from(codes).sort();
  }, [deferredWOs]);

  const filtered = useMemo(() => {
    let list = deferredWOs;
    if (filterCode) {
      list = list.filter((d) => d.reason_code === filterCode);
    }
    // Ordina per priorità ticket
    return [...list].sort((a, b) => {
      const ta = ticketMap.get(a.wo_id);
      const tb = ticketMap.get(b.wo_id);
      const pa = PRIO_ORDER[ta?.priorita ?? "Bassa"] ?? 2;
      const pb = PRIO_ORDER[tb?.priorita ?? "Bassa"] ?? 2;
      return pa - pb;
    });
  }, [deferredWOs, filterCode, ticketMap]);

  if (deferredWOs.length === 0) return null;

  return (
    <div
      style={{
        background: "var(--surface-2)",
        border: "1px solid var(--border-strong)",
        borderRadius: 10,
        overflow: "hidden",
        fontFamily: "'IBM Plex Mono', monospace",
      }}
    >
      {/* Header */}
      <div
        style={{
          background: "#7f1d1d22",
          borderBottom: "1px solid #ef444433",
          padding: "10px 14px",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 8,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ fontSize: 12, color: "#ef4444", fontWeight: 700 }}>
            WO non pianificati
          </span>
          <span
            style={{
              background: "#ef444422",
              color: "#fca5a5",
              border: "1px solid #ef4444",
              borderRadius: 10,
              padding: "1px 7px",
              fontSize: 11,
              fontWeight: 700,
            }}
          >
            {deferredWOs.length}
          </span>
        </div>

        {/* Filtro per reason_code */}
        {availableCodes.length > 1 && (
          <select
            value={filterCode}
            onChange={(e) => setFilterCode(e.target.value)}
            style={{
              background: "var(--surface-1)",
              border: "1px solid var(--border-default)",
              color: "var(--text-muted)",
              borderRadius: 4,
              padding: "2px 6px",
              fontSize: 11,
              cursor: "pointer",
            }}
          >
            <option value="">Tutti i motivi</option>
            {availableCodes.map((code) => (
              <option key={code} value={code}>
                {REASON_CODE_LABELS[code]?.label ?? code}
              </option>
            ))}
          </select>
        )}
      </div>

      {/* Lista */}
      <div style={{ maxHeight: 280, overflowY: "auto" }}>
        {filtered.map((d) => {
          const ticket = ticketMap.get(d.wo_id);
          const s = ticket ? tipoStyle(ticket.tipo) : { bg: "var(--border-strong)", text: "#9ca3af", border: "#374151" };
          const rcLabel = d.reason_code ? (REASON_CODE_LABELS[d.reason_code] ?? null) : null;
          const deferCount = deferredCounts?.[d.wo_id] ?? 0;

          return (
            <div
              key={d.wo_id}
              style={{
                borderBottom: "1px solid var(--border-strong)44",
                padding: "10px 14px",
                display: "flex",
                flexDirection: "column",
                gap: 5,
              }}
            >
              {/* Riga superiore: tipo + id + titolo + badge rimandato (#12) */}
              <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                {ticket && (
                  <span
                    style={{
                      background: s.bg,
                      color: s.text,
                      border: `1px solid ${s.border}`,
                      borderRadius: 3,
                      padding: "1px 6px",
                      fontSize: 10,
                      fontWeight: 700,
                      letterSpacing: 0.8,
                      flexShrink: 0,
                    }}
                  >
                    {ticket.tipo}
                  </span>
                )}
                <span style={{ fontSize: 12, color: "var(--text-muted)" }}>#{d.wo_id}</span>
                {ticket && (
                  <span style={{ fontSize: 12, color: "#e2e8f0", fontWeight: 500, flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {ticket.titolo}
                  </span>
                )}
                {/* Badge rimandato N volte (#12) */}
                {deferCount >= 3 && (
                  <span
                    style={{
                      background: "#ef444422",
                      color: "#fca5a5",
                      border: "1px solid #ef4444",
                      borderRadius: 10,
                      padding: "1px 7px",
                      fontSize: 10,
                      fontWeight: 700,
                      flexShrink: 0,
                    }}
                    title={`Rimandato ${deferCount} volte in piani precedenti`}
                  >
                    {deferCount}x rimandato
                  </span>
                )}
                {deferCount === 2 && (
                  <span
                    style={{
                      background: "#78350f22",
                      color: "#fcd34d",
                      border: "1px solid #f59e0b",
                      borderRadius: 10,
                      padding: "1px 7px",
                      fontSize: 10,
                      fontWeight: 700,
                      flexShrink: 0,
                    }}
                    title="Rimandato 2 volte in piani precedenti"
                  >
                    2x rimandato
                  </span>
                )}
              </div>

              {/* Riga inferiore: reason_code badge + motivo */}
              <div style={{ display: "flex", alignItems: "flex-start", gap: 6 }}>
                {rcLabel ? (
                  <span
                    style={{
                      background: `${rcLabel.color}22`,
                      color: rcLabel.color,
                      border: `1px solid ${rcLabel.color}55`,
                      borderRadius: 3,
                      padding: "1px 7px",
                      fontSize: 10,
                      fontWeight: 600,
                      flexShrink: 0,
                    }}
                  >
                    {rcLabel.label}
                  </span>
                ) : null}
                <span
                  style={{
                    fontSize: 11,
                    color: "#6b7280",
                    lineHeight: 1.5,
                    fontStyle: "italic",
                  }}
                >
                  {d.reason}
                </span>
              </div>

              {/* earliest_possible_date se disponibile */}
              {d.earliest_possible_date && (
                <div style={{ fontSize: 10, color: "#4b5563" }}>
                  Prima data possibile: {d.earliest_possible_date}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
