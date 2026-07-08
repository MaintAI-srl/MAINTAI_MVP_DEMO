"use client";

import { useState } from "react";
import SignaturePad from "./SignaturePad";
import { apiPost } from "../lib/api";
import { consegnaRapportino } from "../lib/rapportino";
import { notify } from "@/lib/toast";

type Props = {
  ticketId: number;
  /** print = apre e stampa (desktop); download = condivide/scarica (mobile). */
  mode: "print" | "download";
  onClose: () => void;
  onDone?: () => void | Promise<void>;
  /** Nome pre-compilato del firmatario (es. nome cliente). */
  defaultName?: string;
  /** Se presente, mostra un pulsante per proseguire senza firmare (es. chiusura intervento mobile). */
  onSkip?: () => void | Promise<void>;
  skipLabel?: string;
};

/**
 * Modale di firma di accettazione + generazione del rapportino PDF.
 * Riusata da desktop (stampa) e mobile (condivisione/download).
 *
 * Flusso: il cliente scrive il proprio nome e firma → la firma viene caricata
 * sul ticket (POST /tickets/{id}/firma con nome) → si genera e consegna il PDF.
 */
export default function FirmaRapportinoModal({ ticketId, mode, onClose, onDone, defaultName, onSkip, skipLabel }: Props) {
  const [nome, setNome] = useState(defaultName ?? "");
  const [busy, setBusy] = useState(false);

  async function handleSave(base64: string) {
    if (busy) return;
    setBusy(true);
    try {
      await apiPost(`/tickets/${ticketId}/firma`, { image: base64, nome: nome.trim() });
      notify.success("Firma acquisita ✓");
      // Genera e consegna il PDF (stampa o download/condivisione)
      try {
        await consegnaRapportino(ticketId, mode);
      } catch (err) {
        notify.error(err instanceof Error ? err.message : "Errore generazione PDF");
      }
      await onDone?.();
      onClose();
    } catch (err) {
      notify.error(err instanceof Error ? err.message : "Errore salvataggio firma");
      setBusy(false);
    }
  }

  async function handleSkip() {
    if (busy || !onSkip) return;
    setBusy(true);
    try {
      await onSkip();
      onClose();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      style={{
        position: "fixed", inset: 0, zIndex: 10000,
        background: "rgba(0,0,0,0.72)", backdropFilter: "blur(6px)",
        display: "flex", alignItems: "center", justifyContent: "center", padding: 16,
      }}
      onClick={(e) => { if (e.target === e.currentTarget && !busy) onClose(); }}
    >
      <div style={{ width: "100%", maxWidth: 460, display: "flex", flexDirection: "column", gap: 14 }}>
        {/* Nome firmatario */}
        <div style={{ background: "var(--surface-2)", borderRadius: 16, border: "1px solid var(--border-default)", padding: 16 }}>
          <label style={{ fontSize: 12, color: "var(--text-muted)", fontWeight: 700, letterSpacing: "0.06em", textTransform: "uppercase", display: "block", marginBottom: 8 }}>
            Nome del cliente / firmatario
          </label>
          <input
            autoFocus
            value={nome}
            onChange={(e) => setNome(e.target.value)}
            placeholder="Es. Mario Bianchi"
            style={{
              width: "100%", padding: "10px 12px", boxSizing: "border-box",
              background: "var(--bg-base)", border: "1px solid var(--border-strong)",
              borderRadius: 8, color: "var(--text-primary)", fontSize: 14, outline: "none",
            }}
          />
        </div>

        {/* Pad di firma su sfondo chiaro (leggibile nel PDF) */}
        <SignaturePad
          title="✍️ Firma di accettazione del cliente"
          inkColor="#111827"
          light
          onSave={handleSave}
          onCancel={onClose}
        />

        {onSkip && (
          <button
            onClick={handleSkip}
            disabled={busy}
            style={{
              padding: "12px 0", width: "100%", borderRadius: 12,
              background: "transparent", border: "1px solid var(--border-default)",
              color: "var(--text-muted)", fontSize: 13, fontWeight: 700,
              cursor: busy ? "not-allowed" : "pointer",
            }}
          >
            {skipLabel ?? "Prosegui senza firma"}
          </button>
        )}

        {busy && (
          <div style={{ textAlign: "center", color: "var(--text-muted)", fontSize: 13 }}>
            Operazione in corso…
          </div>
        )}
      </div>
    </div>
  );
}
