"use client";

import { useState } from "react";
import { apiPost } from "../../lib/api";
import { notify } from "@/lib/toast";
import type { GeneratedPlan, ReplanResult } from "../types";

interface ReplanModalProps {
  open: boolean;
  piano: GeneratedPlan | null;
  onClose: () => void;
  onSuccess: (result: ReplanResult) => void;
}

type Trigger = "new_breakdown" | "technician_absent" | "ticket_urgent";

interface TriggerOption {
  value: Trigger;
  label: string;
  description: string;
  icon: string;
  color: string;
}

const TRIGGER_OPTIONS: TriggerOption[] = [
  {
    value: "new_breakdown",
    label: "Nuovo guasto urgente",
    description: "Inserisce un BD con priorità massima e ricalcola il piano attorno ad esso.",
    icon: "🔴",
    color: "#ef4444",
  },
  {
    value: "technician_absent",
    label: "Tecnico assente",
    description: "Redistribuisce il carico del tecnico assente sugli altri disponibili.",
    icon: "👤",
    color: "#f59e0b",
  },
  {
    value: "ticket_urgent",
    label: "Ticket urgente",
    description: "Prioritizza un ticket specifico anticipandolo nel piano corrente.",
    icon: "⚡",
    color: "#3b82f6",
  },
];

export default function ReplanModal({ open, piano, onClose, onSuccess }: ReplanModalProps) {
  const [trigger, setTrigger] = useState<Trigger>("new_breakdown");
  const [loading, setLoading] = useState(false);

  if (!open || !piano) return null;

  async function handleReplan() {
    setLoading(true);
    try {
      const result = await apiPost<ReplanResult>("/planning/replanning", {
        trigger,
        affected_ticket_ids: [],
        locked_ticket_ids: [],
        horizon_days: 7,
      });

      const movedCount = result.moved_tickets?.length ?? 0;
      const disruption = result.disruption_cost ?? 0;
      notify.success(
        `Ricalcolo completato — ${movedCount} ticket spostati, disruption cost: ${disruption}`
      );
      onSuccess(result);
    } catch (e: unknown) {
      notify.error(e instanceof Error ? e.message : "Errore durante il ricalcolo del piano");
    } finally {
      setLoading(false);
    }
  }

  const selectedOption = TRIGGER_OPTIONS.find((o) => o.value === trigger)!;

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.75)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 9999,
        backdropFilter: "blur(4px)",
      }}
      onClick={onClose}
    >
      <div
        style={{
          background: "#111827",
          border: "1px solid #1f2937",
          borderRadius: 16,
          padding: 28,
          width: 460,
          maxWidth: "95vw",
          boxShadow: "0 32px 80px rgba(0,0,0,0.7)",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 20 }}>
          <div>
            <div style={{ fontSize: 17, fontWeight: 800, color: "#f9fafb", letterSpacing: "-0.02em" }}>
              ↻ Ricalcola Piano
            </div>
            <div style={{ fontSize: 12, color: "#6b7280", marginTop: 4 }}>
              Seleziona il motivo del ricalcolo
            </div>
          </div>
          <button
            onClick={onClose}
            style={{
              background: "transparent",
              border: "none",
              color: "#6b7280",
              cursor: "pointer",
              fontSize: 22,
              lineHeight: 1,
              padding: 0,
            }}
          >
            ×
          </button>
        </div>

        {/* Opzioni trigger */}
        <div style={{ display: "flex", flexDirection: "column", gap: 10, marginBottom: 20 }}>
          {TRIGGER_OPTIONS.map((opt) => {
            const selected = trigger === opt.value;
            return (
              <button
                key={opt.value}
                onClick={() => setTrigger(opt.value)}
                style={{
                  display: "flex",
                  alignItems: "flex-start",
                  gap: 12,
                  padding: "12px 14px",
                  borderRadius: 10,
                  border: `1px solid ${selected ? opt.color : "#374151"}`,
                  background: selected ? `${opt.color}12` : "#1a2332",
                  cursor: "pointer",
                  textAlign: "left",
                  transition: "border-color 0.15s, background 0.15s",
                }}
              >
                {/* Radio indicator */}
                <div style={{
                  width: 16,
                  height: 16,
                  borderRadius: "50%",
                  border: `2px solid ${selected ? opt.color : "#374151"}`,
                  background: selected ? opt.color : "transparent",
                  flexShrink: 0,
                  marginTop: 2,
                  transition: "all 0.15s",
                }} />
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 13, fontWeight: 700, color: selected ? "#f9fafb" : "#9ca3af", marginBottom: 3 }}>
                    {opt.icon} {opt.label}
                  </div>
                  <div style={{ fontSize: 11, color: "#6b7280", lineHeight: 1.5 }}>
                    {opt.description}
                  </div>
                </div>
              </button>
            );
          })}
        </div>

        {/* Nota informativa */}
        <div style={{
          background: "#1f2937",
          border: "1px solid #374151",
          borderRadius: 8,
          padding: "10px 14px",
          marginBottom: 22,
          fontSize: 11,
          color: "#9ca3af",
          lineHeight: 1.6,
        }}>
          I ticket pianificati manualmente e quelli in corso non verranno toccati dal ricalcolo.
          Il nuovo piano viene generato come bozza e richiede conferma esplicita.
        </div>

        {/* Azioni */}
        <div style={{ display: "flex", gap: 10 }}>
          <button
            onClick={onClose}
            style={{
              flex: 1,
              background: "#1f2937",
              border: "1px solid #374151",
              color: "#9ca3af",
              borderRadius: 8,
              padding: "10px 0",
              cursor: "pointer",
              fontSize: 13,
              fontFamily: "inherit",
            }}
          >
            Annulla
          </button>
          <button
            onClick={handleReplan}
            disabled={loading}
            style={{
              flex: 2,
              background: loading
                ? "#1f2937"
                : `linear-gradient(135deg, #1d4ed8, #7c3aed)`,
              border: "none",
              color: loading ? "#6b7280" : "#fff",
              borderRadius: 8,
              padding: "10px 0",
              cursor: loading ? "not-allowed" : "pointer",
              fontSize: 13,
              fontWeight: 700,
              fontFamily: "inherit",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              gap: 8,
              boxShadow: loading ? "none" : "0 0 14px rgba(99,102,241,0.4)",
              transition: "all 0.15s",
            }}
          >
            {loading ? (
              <>
                <span style={{
                  display: "inline-block",
                  width: 13,
                  height: 13,
                  border: "2px solid #ffffff44",
                  borderTop: "2px solid #9ca3af",
                  borderRadius: "50%",
                  animation: "spin 0.8s linear infinite",
                }} />
                Ricalcolo in corso...
              </>
            ) : (
              `↻ Esegui Ricalcolo — ${selectedOption.icon} ${selectedOption.label}`
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
