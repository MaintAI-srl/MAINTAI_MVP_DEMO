"use client";

import { useState, useEffect, useCallback } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { apiGet } from "../../lib/api";
import { notify } from "@/lib/toast";

// ─── Tipi ───────────────────────────────────────────────────────────────────

interface AssetInfo {
  id: number;
  nome: string;
  codice?: string;
  criticita?: string;
  impianto_nome?: string;
  sito_nome?: string;
}

interface Ticket {
  id: number;
  titolo: string;
  tipo: string;
  stato: string;
  priorita: string;
  descrizione?: string;
  created_at?: string;
  updated_at?: string;
  execution_start?: string;
  execution_finish?: string;
  durata_stimata_ore?: number;
  tecnico_id?: number;
  tecnico_nome?: string;
  closed_by?: string;
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function tipoColor(tipo: string): string {
  if (tipo === "BD") return "#ef4444";
  if (tipo === "PM") return "#22c55e";
  return "#f59e0b";
}
function tipoLabel(tipo: string): string {
  if (tipo === "BD") return "Guasto";
  if (tipo === "PM") return "Preventiva";
  return "Correttiva";
}
function prioritaColor(p: string): string {
  if (p === "Alta") return "#ef4444";
  if (p === "Media") return "#f97316";
  return "#22c55e";
}
function formatDate(iso?: string): string {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleDateString("it-IT", { day: "2-digit", month: "short", year: "numeric" });
  } catch {
    return iso.split("T")[0];
  }
}
function formatDuration(ticket: Ticket): string {
  if (ticket.execution_start && ticket.execution_finish) {
    const ore = (new Date(ticket.execution_finish).getTime() - new Date(ticket.execution_start).getTime()) / 3600000;
    return `${ore.toFixed(1)}h`;
  }
  if (ticket.durata_stimata_ore) return `~${ticket.durata_stimata_ore}h`;
  return "—";
}

// ─── Componenti ─────────────────────────────────────────────────────────────

function TicketCard({ ticket }: { ticket: Ticket }) {
  const [expanded, setExpanded] = useState(false);
  const color = tipoColor(ticket.tipo);

  return (
    <div
      style={{
        background: "var(--surface-2)",
        borderRadius: "12px",
        border: `1px solid ${color}33`,
        borderLeft: `4px solid ${color}`,
        padding: "16px",
        marginBottom: "12px",
        cursor: "pointer",
        WebkitTapHighlightColor: "transparent",
      }}
      onClick={() => setExpanded(!expanded)}
    >
      {/* Header */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: "12px" }}>
        <div style={{ flex: 1 }}>
          <div style={{ display: "flex", gap: "8px", marginBottom: "6px", flexWrap: "wrap" }}>
            <span style={{
              background: color + "22",
              color,
              border: `1px solid ${color}55`,
              borderRadius: "999px",
              padding: "2px 10px",
              fontSize: "12px",
              fontWeight: 700,
            }}>
              {tipoLabel(ticket.tipo)}
            </span>
            <span style={{
              background: "#1f2937",
              color: prioritaColor(ticket.priorita),
              borderRadius: "999px",
              padding: "2px 10px",
              fontSize: "11px",
              border: `1px solid ${prioritaColor(ticket.priorita)}44`,
            }}>
              {ticket.priorita}
            </span>
          </div>
          <div style={{ fontSize: "16px", fontWeight: 600, color: "var(--text-primary)", lineHeight: 1.3 }}>
            {ticket.titolo}
          </div>
          <div style={{ fontSize: "13px", color: "var(--text-muted)", marginTop: "4px" }}>
            #{ticket.id} · {formatDate(ticket.created_at)}
          </div>
        </div>
        <div style={{ fontSize: "14px", color: "#64748b", flexShrink: 0 }}>{expanded ? "▲" : "▼"}</div>
      </div>

      {/* Dettaglio espanso */}
      {expanded && (
        <div style={{ marginTop: "12px", paddingTop: "12px", borderTop: "1px solid #1f2937" }}>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "8px", marginBottom: "8px" }}>
            <Kv label="Durata" value={formatDuration(ticket)} />
            {ticket.tecnico_nome && <Kv label="Tecnico" value={ticket.tecnico_nome} />}
            {ticket.execution_start && <Kv label="Inizio" value={formatDate(ticket.execution_start)} />}
            {ticket.execution_finish && <Kv label="Fine" value={formatDate(ticket.execution_finish)} />}
            {ticket.closed_by && <Kv label="Chiuso da" value={ticket.closed_by} />}
          </div>
          {ticket.descrizione && (
            <div style={{ background: "var(--surface-0)", borderRadius: "8px", padding: "10px 12px", fontSize: "13px", color: "var(--text-muted)", lineHeight: 1.5 }}>
              {ticket.descrizione}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function Kv({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div style={{ fontSize: "10px", color: "#64748b", textTransform: "uppercase", letterSpacing: "0.5px" }}>{label}</div>
      <div style={{ fontSize: "13px", color: "#cbd5e1", fontWeight: 500 }}>{value}</div>
    </div>
  );
}

// ─── Pagina principale ───────────────────────────────────────────────────────

export default function StoricoAssetPage() {
  const params = useParams();
  const router = useRouter();
  const assetId = params.asset_id as string;

  const [asset, setAsset] = useState<AssetInfo | null>(null);
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filtroTipo, setFiltroTipo] = useState<string>("tutti");

  const loadData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [assetData, ticketsData] = await Promise.all([
        apiGet<AssetInfo>(`/assets/${assetId}`),
        apiGet<{ items: Ticket[]; total: number }>(`/tickets?asset_id=${assetId}&stato=Chiuso&limit=50`),
      ]);
      setAsset(assetData);
      setTickets(ticketsData.items ?? []);
    } catch (err: any) {
      if (err?.status === 401) {
        router.push("/login");
        return;
      }
      setError("Impossibile caricare lo storico. Verifica la connessione.");
      notify.error("Errore nel caricamento dello storico");
    } finally {
      setLoading(false);
    }
  }, [assetId, router]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const ticketsFiltrati = filtroTipo === "tutti"
    ? tickets
    : tickets.filter(t => t.tipo === filtroTipo);

  const nuovoTicketUrl = `/ticket?asset_id=${assetId}`;

  if (loading) {
    return (
      <div style={{ minHeight: "100vh", background: "var(--surface-0)", display: "flex", alignItems: "center", justifyContent: "center" }}>
        <div style={{ color: "var(--text-muted)", fontSize: "16px" }}>Caricamento storico...</div>
      </div>
    );
  }

  if (error) {
    return (
      <div style={{ minHeight: "100vh", background: "var(--surface-0)", display: "flex", alignItems: "center", justifyContent: "center", padding: "24px" }}>
        <div style={{ textAlign: "center" }}>
          <div style={{ fontSize: "32px", marginBottom: "12px" }}>⚠️</div>
          <div style={{ color: "#ef4444", fontSize: "16px", marginBottom: "16px" }}>{error}</div>
          <button
            onClick={loadData}
            style={{ background: "#1e40af", color: "#fff", border: "none", borderRadius: "10px", padding: "12px 24px", fontSize: "16px", cursor: "pointer", minHeight: "48px" }}
          >
            Riprova
          </button>
        </div>
      </div>
    );
  }

  return (
    <div style={{ minHeight: "100vh", background: "var(--surface-0)", color: "var(--text-primary)" }}>
      {/* Header */}
      <div style={{ background: "var(--surface-2)", borderBottom: "1px solid var(--border-default)", padding: "16px", position: "sticky", top: 0, zIndex: 100 }}>
        <div style={{ display: "flex", alignItems: "center", gap: "12px", marginBottom: "8px" }}>
          <button
            onClick={() => router.back()}
            style={{ background: "#1f2937", border: "none", borderRadius: "8px", padding: "8px 12px", color: "var(--text-muted)", cursor: "pointer", fontSize: "16px", minHeight: "44px", minWidth: "44px" }}
            aria-label="Torna indietro"
          >
            ←
          </button>
          <div>
            <div style={{ fontSize: "11px", color: "#64748b", textTransform: "uppercase", letterSpacing: "0.5px" }}>
              {asset?.sito_nome && `${asset.sito_nome} › `}
              {asset?.impianto_nome && `${asset.impianto_nome} › `}
              Storico
            </div>
            <h1 style={{ margin: 0, fontSize: "20px", fontWeight: 700, color: "var(--text-primary)" }}>
              🔧 {asset?.nome ?? `Asset #${assetId}`}
            </h1>
          </div>
        </div>
        {/* Azioni rapide */}
        <div style={{ display: "flex", gap: "8px" }}>
          <Link
            href={nuovoTicketUrl}
            style={{
              flex: 1,
              background: "#1e3a5f",
              color: "#60a5fa",
              border: "1px solid #1e40af",
              borderRadius: "10px",
              padding: "12px 16px",
              fontSize: "15px",
              fontWeight: 700,
              textAlign: "center",
              textDecoration: "none",
              display: "block",
              minHeight: "48px",
              lineHeight: "24px",
            }}
          >
            + Nuovo ticket
          </Link>
          <button
            onClick={loadData}
            style={{ background: "#1f2937", border: "1px solid var(--border-default)", borderRadius: "10px", padding: "12px 14px", color: "var(--text-muted)", cursor: "pointer", fontSize: "18px", minHeight: "48px", minWidth: "48px" }}
            title="Aggiorna"
          >
            ↻
          </button>
        </div>
      </div>

      {/* Filtri tipo */}
      <div style={{ display: "flex", gap: "8px", padding: "12px 16px", overflowX: "auto" }}>
        {[
          { id: "tutti", label: "Tutti" },
          { id: "BD", label: "Guasti" },
          { id: "PM", label: "Preventivi" },
          { id: "CM", label: "Correttivi" },
        ].map(f => (
          <button
            key={f.id}
            onClick={() => setFiltroTipo(f.id)}
            style={{
              background: filtroTipo === f.id ? "var(--cobalt-dim)" : "var(--surface-2)",
              color: filtroTipo === f.id ? "var(--cobalt)" : "var(--text-muted)",
              border: `1px solid ${filtroTipo === f.id ? "var(--cobalt-border)" : "var(--border-default)"}`,
              borderRadius: "999px",
              padding: "8px 16px",
              fontSize: "13px",
              fontWeight: filtroTipo === f.id ? 700 : 400,
              cursor: "pointer",
              whiteSpace: "nowrap",
              minHeight: "36px",
            }}
          >
            {f.label}
            {f.id !== "tutti" && (
              <span style={{ marginLeft: "6px", opacity: 0.7 }}>
                ({tickets.filter(t => t.tipo === f.id).length})
              </span>
            )}
          </button>
        ))}
      </div>

      {/* Contenuto */}
      <div style={{ padding: "0 16px 24px" }}>
        {ticketsFiltrati.length === 0 ? (
          <div style={{ textAlign: "center", padding: "48px 16px" }}>
            <div style={{ fontSize: "40px", marginBottom: "12px" }}>📋</div>
            <div style={{ fontSize: "18px", color: "var(--text-muted)", marginBottom: "8px" }}>
              {tickets.length === 0
                ? "Nessun intervento registrato"
                : "Nessun intervento per questo filtro"}
            </div>
            {tickets.length === 0 && (
              <div style={{ fontSize: "14px", color: "#64748b" }}>
                Gli interventi chiusi appariranno qui
              </div>
            )}
          </div>
        ) : (
          <>
            <div style={{ fontSize: "12px", color: "#64748b", marginBottom: "12px", textTransform: "uppercase", letterSpacing: "0.5px" }}>
              {ticketsFiltrati.length} intervento{ticketsFiltrati.length !== 1 ? "i" : ""} · Ordine cronologico decrescente
            </div>
            {[...ticketsFiltrati]
              .sort((a, b) => new Date(b.created_at ?? 0).getTime() - new Date(a.created_at ?? 0).getTime())
              .map(t => <TicketCard key={t.id} ticket={t} />)
            }
          </>
        )}
      </div>
    </div>
  );
}
