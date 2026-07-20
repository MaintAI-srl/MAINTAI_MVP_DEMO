"use client";

import { useState, useEffect } from "react";
import { Sheet, SheetContent, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { apiPost, apiGet } from "../lib/api";
import { notify } from "@/lib/toast";
import { ASSET_STATUS_OPTIONS } from "../lib/assetStatus";

type Asset = { id: number; name: string; nome: string; codice: string };

export default function GlobalQuickTicket() {
  const [open, setOpen] = useState(false);
  const [assets, setAssets] = useState<Asset[]>([]);
  const [loading, setLoading] = useState(false);

  // Form
  const [titolo, setTitolo] = useState("");
  const [assetId, setAssetId] = useState<string>("");
  const [priorita, setPriorita] = useState("Media");
  const [tipo, setTipo] = useState("BD");
  const [assetStato, setAssetStato] = useState("out of service");

  useEffect(() => {
    if (open && assets.length === 0) {
      apiGet<Asset[]>("/assets").then(d => {
        if (Array.isArray(d)) setAssets(d);
      }).catch(console.error);
    }
  }, [open, assets.length]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!titolo.trim()) { notify.error("Titolo obbligatorio"); return; }

    setLoading(true);
    try {
      await apiPost("/tickets", {
        titolo,
        asset_id: assetId ? Number(assetId) : undefined,
        priorita,
        tipo,
        asset_stato: assetStato || null,
        stato: "Aperto",
        durata_stimata_ore: 1, // default
        fascia_oraria: "diurna"
      });
      notify.success("Ticket creato con successo!");
      setOpen(false);
      // Pulisco il form
      setTitolo("");
      setAssetId("");
      setPriorita("Media");
      setTipo("BD");
      setAssetStato("out of service");
    } catch (err: unknown) {
      notify.error(err instanceof Error ? err.message : "Errore nella creazione");
    } finally {
      setLoading(false);
    }
  }

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      {/* Compatto (solo +): lo spazio in topbar è occupato dai nomi degli Agenti AI */}
      <SheetTrigger
        title="Quick Ticket — crea un nuovo ticket rapido"
        aria-label="Quick Ticket"
        style={{
          background: "linear-gradient(135deg, #3b82f6, #2563eb)",
          color: "white",
          fontWeight: 700,
          boxShadow: "0 0 15px rgba(59,130,246,0.5)",
          border: "1px solid #60a5fa",
          borderRadius: 6,
          padding: "4px 10px",
          fontSize: 13,
          cursor: "pointer",
          display: "inline-flex",
          alignItems: "center",
        }}
      >
        <span style={{ fontSize: 16 }}>+</span>
      </SheetTrigger>

      <SheetContent
        style={{
          background: "var(--surface-2)",
          borderColor: "var(--border-default)",
          color: "var(--text-primary)",
          width: "min(100vw, 400px)",
          display: "flex",
          flexDirection: "column",
          padding: 0
        }}
      >
        <div style={{ padding: "24px", borderBottom: "1px solid var(--border-default)", background: "var(--surface-1)" }}>
          <div style={{ fontSize: 10, letterSpacing: "0.15em", color: "#3b82f6", fontWeight: 700, textTransform: "uppercase", marginBottom: 6 }}>Fast Action</div>
          <SheetTitle style={{ color: "var(--text-primary)", fontSize: 22, fontWeight: 800 }}>Nuovo Ticket</SheetTitle>
        </div>

        <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", flex: 1, overflow: "hidden" }}>
          <div style={{ flex: 1, overflowY: "auto", padding: "24px", display: "flex", flexDirection: "column", gap: 20 }}>

            {/* Titolo */}
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              <label style={{ fontSize: 11, fontWeight: 700, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.05em" }}>Titolo *</label>
              <input
                type="text"
                value={titolo}
                onChange={e => setTitolo(e.target.value)}
                required
                autoFocus
                placeholder="Breve descrizione o sintomo fallimento"
                style={{
                  background: "var(--surface-3)",
                  color: "var(--text-primary)",
                  border: "1px solid var(--border-default)",
                  padding: "10px 14px",
                  borderRadius: 6,
                  outline: "none",
                  fontSize: 14
                }}
              />
            </div>

            {/* Asset */}
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              <label style={{ fontSize: 11, fontWeight: 700, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.05em" }}>Asset Principale</label>
              <select
                value={assetId}
                onChange={e => setAssetId(e.target.value)}
                style={{
                  background: "var(--surface-3)",
                  color: "var(--text-primary)",
                  border: "1px solid var(--border-default)",
                  padding: "10px 14px",
                  borderRadius: 6,
                  outline: "none",
                  fontSize: 14
                }}
              >
                <option value="">Seleziona asset id/codice</option>
                {assets.map(a => <option key={a.id} value={String(a.id)}>{a.codice ? `[${a.codice}] ` : ""}{a.name || a.nome}</option>)}
              </select>
            </div>

            {/* Modalità One-Click / Priorità / Tipo */}
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                <label style={{ fontSize: 11, fontWeight: 700, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.05em" }}>Tipo</label>
                <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
                  {["BD", "CM"].map(t => (
                    <button
                      key={t}
                      type="button"
                      onClick={() => {
                        setTipo(t);
                        setAssetStato(t === "BD" ? "out of service" : "stopped");
                      }}
                      style={{
                        flex: 1,
                        padding: "6px 0",
                        borderRadius: 4,
                        fontSize: 12,
                        fontWeight: 700,
                        border: tipo === t ? `1px solid ${t === "BD" ? "#ef4444" : "#f59e0b"}` : "1px solid var(--border-default)",
                        background: tipo === t ? `${t === "BD" ? "rgba(239,68,68,0.15)" : "rgba(245,158,11,0.15)"}` : "var(--surface-3)",
                        color: tipo === t ? (t === "BD" ? "#fca5a5" : "#fde68a") : "#94a3b8"
                      }}
                    >
                      {t}
                    </button>
                  ))}
                </div>
              </div>

              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                <label style={{ fontSize: 11, fontWeight: 700, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.05em" }}>Priorità</label>
                <select
                  value={priorita}
                  onChange={e => setPriorita(e.target.value)}
                  style={{
                    background: "var(--surface-3)",
                    color: "var(--text-primary)",
                    border: "1px solid var(--border-default)",
                    padding: "9px 12px",
                    borderRadius: 6,
                    outline: "none",
                    height: "100%",
                    fontSize: 13
                  }}
                >
                  <option value="Alta">Alta</option>
                  <option value="Media">Media</option>
                  <option value="Bassa">Bassa</option>
                </select>
              </div>
            </div>

            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              <label style={{ fontSize: 11, fontWeight: 700, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.05em" }}>Stato asset</label>
              <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
                {[
                  { value: "", label: "Mantieni", color: "var(--text-muted)" },
                  ...ASSET_STATUS_OPTIONS,
                ].map((s) => (
                  <button
                    key={s.value || "keep"}
                    type="button"
                    onClick={() => setAssetStato(s.value)}
                    style={{
                      flex: "1 1 76px",
                      padding: "6px 8px",
                      borderRadius: 5,
                      fontSize: 11,
                      fontWeight: 800,
                      border: assetStato === s.value ? `1px solid ${s.color}` : "1px solid var(--border-default)",
                      background: assetStato === s.value ? `${s.color}22` : "var(--surface-3)",
                      color: assetStato === s.value ? s.color : "#94a3b8",
                      cursor: "pointer",
                    }}
                  >
                    {s.label}
                  </button>
                ))}
              </div>
            </div>

            <div style={{ marginTop: "auto", fontSize: 12, color: "#64748b", lineHeight: 1.5 }}>
              Il ticket verrà salvato in stato <strong>Aperto</strong> e sarà visibile nella lista Ticket o pronto per l&apos;assegnazione nel Planner.
            </div>

          </div>

          <div style={{ padding: "20px 24px", borderTop: "1px solid var(--border-default)", background: "var(--surface-2)", display: "flex", justifyContent: "flex-end", gap: 12 }}>
            <Button type="button" variant="ghost" onClick={() => setOpen(false)} style={{ color: "var(--text-muted)" }}>Annulla</Button>
            <Button type="submit" disabled={loading} style={{ background: "linear-gradient(135deg, #3b82f6, #2563eb)", fontWeight: 700, padding: "0 24px" }}>
              {loading ? "Creazione..." : "Salva Ticket Ora"}
            </Button>
          </div>
        </form>

      </SheetContent>
    </Sheet>
  );
}
