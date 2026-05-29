"use client";

/**
 * M1.1 — Ticket Rapido da Campo
 * Modal accessibile da shortcut globale N e floating button +
 * Soli 3 campi: Asset (obbligatorio), Descrizione, Tipo (BD/PM/CM)
 */

import { useState, useEffect, useRef, useCallback } from "react";
import { apiPost, apiGet } from "../lib/api";
import { notify } from "@/lib/toast";
import Link from "next/link";

type Asset = { id: number; name: string; nome: string; codice?: string };

interface QuickTicketResponse {
  id: number;
  titolo: string;
  stato: string;
  tipo: string;
  asset_name?: string;
}

export default function QuickTicketModal() {
  const [open, setOpen] = useState(false);
  const [assets, setAssets] = useState<Asset[]>([]);
  const [assetsLoaded, setAssetsLoaded] = useState(false);
  const [loading, setLoading] = useState(false);
  const [lastCreated, setLastCreated] = useState<QuickTicketResponse | null>(null);

  // Form
  const [assetId, setAssetId] = useState<string>("");
  const [descrizione, setDescrizione] = useState("");
  const [tipo, setTipo] = useState<"BD" | "PM" | "CM">("BD");
  const [assetSearch, setAssetSearch] = useState("");

  const descRef = useRef<HTMLTextAreaElement>(null);

  // Carica asset quando il modal si apre
  useEffect(() => {
    if (open && !assetsLoaded) {
      apiGet<Asset[]>("/assets")
        .then(d => { if (Array.isArray(d)) setAssets(d); setAssetsLoaded(true); })
        .catch(() => {});
    }
    if (open && descRef.current) {
      setTimeout(() => descRef.current?.focus(), 80);
    }
  }, [open, assetsLoaded]);

  // Shortcut globale N (solo se non si sta digitando in un input)
  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    const tag = (e.target as HTMLElement)?.tagName?.toLowerCase();
    if (tag === "input" || tag === "textarea" || tag === "select") return;
    if ((e.target as HTMLElement)?.isContentEditable) return;
    if (e.key === "n" || e.key === "N") {
      e.preventDefault();
      setOpen(o => !o);
    }
    if (e.key === "Escape" && open) {
      setOpen(false);
    }
  }, [open]);

  useEffect(() => {
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [handleKeyDown]);

  function reset() {
    setAssetId("");
    setDescrizione("");
    setTipo("BD");
    setAssetSearch("");
    setLastCreated(null);
  }

  function handleClose() {
    setOpen(false);
    reset();
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!assetId) { notify.error("Seleziona un asset."); return; }
    if (!descrizione.trim()) { notify.error("Inserisci una descrizione."); return; }

    setLoading(true);
    try {
      const ticket = await apiPost<QuickTicketResponse>("/tickets/quick", {
        asset_id: Number(assetId),
        descrizione: descrizione.trim(),
        tipo,
      });
      setLastCreated(ticket);
      notify.success(`Ticket #${ticket.id} creato`);
      reset();
      setLastCreated(ticket);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Errore nella creazione";
      notify.error(msg);
    } finally {
      setLoading(false);
    }
  }

  const tipoColors: Record<string, string> = { BD: "#ef4444", PM: "#22c55e", CM: "#f59e0b" };

  const filteredAssets = assets.filter(a => {
    if (!assetSearch.trim()) return true;
    const s = assetSearch.toLowerCase();
    return (a.nome || a.name || "").toLowerCase().includes(s) ||
           (a.codice || "").toLowerCase().includes(s);
  });

  // FAB rimosso — usa shortcut N o il pulsante QUICK TICKET nella topbar
  if (!open) return null;

  return (
    <>
      {/* Overlay */}
      <div
        onClick={handleClose}
        style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.7)", zIndex: 9998 }}
      />

      {/* Modal */}
      <div style={{
        position: "fixed",
        bottom: 90,
        right: 28,
        width: "min(420px, calc(100vw - 32px))",
        background: "var(--surface-2)",
        border: "1px solid var(--border-default)",
        borderRadius: 14,
        boxShadow: "0 24px 64px rgba(0,0,0,0.6), 0 0 0 1px rgba(59,130,246,0.15)",
        zIndex: 9999,
        overflow: "hidden",
      }}>
        {/* Header */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "16px 20px 12px", borderBottom: "1px solid var(--border-default)", background: "var(--surface-1)" }}>
          <div>
            <div style={{ fontSize: 9.5, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.15em", color: "#3b82f6", marginBottom: 2 }}>Ticket Rapido</div>
            <div style={{ fontSize: 17, fontWeight: 800, color: "var(--text-primary)" }}>Nuovo Intervento</div>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span style={{ fontSize: 9.5, background: "var(--surface-3)", color: "#64748b", border: "1px solid var(--border-default)", borderRadius: 4, padding: "2px 6px", fontFamily: "monospace" }}>N</span>
            <button onClick={handleClose} style={{ background: "transparent", border: "none", cursor: "pointer", color: "var(--text-muted)", fontSize: 20, lineHeight: 1, padding: "2px 6px" }}>×</button>
          </div>
        </div>

        {/* Successo */}
        {lastCreated && (
          <div style={{ padding: "14px 20px", background: "rgba(34,197,94,0.08)", borderBottom: "1px solid rgba(34,197,94,0.2)" }}>
            <div style={{ color: "#22c55e", fontSize: 13, fontWeight: 600 }}>
              Ticket #{lastCreated.id} creato
              {" "}
              <Link href="/ticket" onClick={handleClose} style={{ color: "#60a5fa", fontSize: 12 }}>Vai ai ticket →</Link>
            </div>
          </div>
        )}

        <form onSubmit={handleSubmit} style={{ padding: "16px 20px", display: "flex", flexDirection: "column", gap: 14 }}>

          {/* Tipo */}
          <div>
            <div style={{ fontSize: 10.5, fontWeight: 700, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.1em", marginBottom: 6 }}>Tipo intervento</div>
            <div style={{ display: "flex", gap: 6 }}>
              {(["BD", "PM", "CM"] as const).map(t => (
                <button
                  key={t} type="button" onClick={() => setTipo(t)}
                  style={{
                    flex: 1, padding: "8px 0", borderRadius: 6, fontSize: 13, fontWeight: 800,
                    border: tipo === t ? `1.5px solid ${tipoColors[t]}` : "1.5px solid var(--border-default)",
                    background: tipo === t ? tipoColors[t] + "22" : "var(--surface-3)",
                    color: tipo === t ? tipoColors[t] : "#64748b",
                    cursor: "pointer", transition: "all 0.12s",
                  }}
                >
                  {t}
                </button>
              ))}
            </div>
            <div style={{ fontSize: 10, color: "#64748b", marginTop: 4 }}>
              {tipo === "BD" ? "Guasto — ferma la macchina" : tipo === "PM" ? "Preventiva — programmata" : "Correttiva — non urgente"}
            </div>
          </div>

          {/* Asset */}
          <div>
            <div style={{ fontSize: 10.5, fontWeight: 700, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.1em", marginBottom: 6 }}>Asset *</div>
            <input
              type="text"
              value={assetSearch}
              onChange={e => setAssetSearch(e.target.value)}
              placeholder="Cerca per nome o codice..."
              style={{ width: "100%", background: "var(--surface-3)", color: "var(--text-primary)", border: "1px solid var(--border-default)", borderRadius: "6px 6px 0 0", padding: "8px 12px", fontSize: 13, outline: "none", boxSizing: "border-box" }}
            />
            <select
              value={assetId}
              onChange={e => setAssetId(e.target.value)}
              required
              size={Math.min(filteredAssets.length + 1, 5)}
              style={{ width: "100%", background: "var(--surface-3)", color: "var(--text-primary)", border: "1px solid var(--border-default)", borderTop: "none", borderRadius: "0 0 6px 6px", padding: "4px 0", fontSize: 13, outline: "none", boxSizing: "border-box" }}
            >
              <option value="">— Seleziona asset —</option>
              {filteredAssets.map(a => (
                <option key={a.id} value={String(a.id)}>
                  {a.codice ? `[${a.codice}] ` : ""}{a.nome || a.name}
                </option>
              ))}
            </select>
          </div>

          {/* Descrizione */}
          <div>
            <div style={{ fontSize: 10.5, fontWeight: 700, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.1em", marginBottom: 6 }}>Descrizione *</div>
            <textarea
              ref={descRef}
              value={descrizione}
              onChange={e => setDescrizione(e.target.value)}
              required
              rows={3}
              placeholder="Es: Pompa P-01 — perdita olio dal premistoppa, vibrazione anomala..."
              style={{ width: "100%", background: "var(--surface-3)", color: "var(--text-primary)", border: "1px solid var(--border-default)", borderRadius: 6, padding: "8px 12px", fontSize: 13, outline: "none", resize: "none", boxSizing: "border-box", fontFamily: "inherit" }}
            />
          </div>

          {/* Actions */}
          <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 4 }}>
            <button type="button" onClick={handleClose} style={{ background: "transparent", color: "var(--text-muted)", border: "1px solid var(--border-default)", borderRadius: 6, padding: "8px 16px", cursor: "pointer", fontSize: 13 }}>
              Annulla
            </button>
            <button
              type="submit"
              disabled={loading || !assetId || !descrizione.trim()}
              style={{
                background: loading ? "var(--surface-3)" : "linear-gradient(135deg, #3b82f6, #2563eb)",
                color: "#fff", border: "none", borderRadius: 6,
                padding: "8px 20px", cursor: loading ? "not-allowed" : "pointer",
                fontSize: 13, fontWeight: 700,
                opacity: (!assetId || !descrizione.trim()) ? 0.5 : 1,
              }}
            >
              {loading ? "Creazione..." : "Apri Ticket"}
            </button>
          </div>
        </form>
      </div>
    </>
  );
}
