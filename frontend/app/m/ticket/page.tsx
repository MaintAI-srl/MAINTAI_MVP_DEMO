"use client";

/**
 * Lista ticket del tecnico — card grandi, filtri a chip per stato.
 * Tap sulla card → vista lavoro /m/ticket/[id].
 */

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { apiGet } from "../../lib/api";
import { notify } from "@/lib/toast";
import Skeleton from "../../components/Skeleton";
import { ChevronRight, Package, RefreshCw, Inbox } from "lucide-react";
import {
  C, glass, circleBtn, IconBadge, tipoMeta, prioritaColor, useTecnicoId,
  type Ticket,
} from "../shared";

const FILTRI = ["Tutti", "Aperto", "Pianificato", "In corso", "Chiuso"] as const;
type Filtro = (typeof FILTRI)[number];

function statoColor(stato: string): string {
  switch (stato) {
    case "Aperto":      return C.red;
    case "Pianificato": return C.blue;
    case "In corso":    return C.orange;
    case "Chiuso":      return C.green;
    default:            return C.text3;
  }
}

export default function MobileTicketListPage() {
  const router = useRouter();
  const tecnicoId = useTecnicoId();
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [filtro, setFiltro] = useState<Filtro>("Tutti");

  const loadTickets = useCallback(async () => {
    if (tecnicoId === null) return;
    if (tecnicoId === -1) { setLoading(false); return; }
    try {
      const d = await apiGet<{ items?: Ticket[] }>(`/tickets?tecnico_id=${tecnicoId}&limit=100`);
      setTickets(d.items ?? []);
    } catch {
      notify.error("Errore nel caricamento dei ticket.", "TICKET");
    }
    setLoading(false);
  }, [tecnicoId]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- fetch iniziale all'mount; il ramo senza profilo tecnico chiude solo lo skeleton
    loadTickets();
  }, [loadTickets]);

  const filtered = filtro === "Tutti" ? tickets : tickets.filter(t => t.stato === filtro);
  const countFor = (f: Filtro) => f === "Tutti" ? tickets.length : tickets.filter(t => t.stato === f).length;

  return (
    <div className="m-page" style={{ overflow: "hidden" }}>

      {/* Titolo + refresh */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "16px 16px 10px", flexShrink: 0 }}>
        <div style={{ fontWeight: 800, fontSize: "clamp(22px, 6vw, 26px)", color: C.text, letterSpacing: "-0.02em" }}>
          I miei ticket
        </div>
        <button
          className="m-press"
          aria-label="Aggiorna"
          onClick={async () => { setRefreshing(true); await loadTickets(); setRefreshing(false); }}
          disabled={refreshing}
          style={{ ...circleBtn, color: C.text2, cursor: refreshing ? "wait" : "pointer" }}
        >
          <RefreshCw size={19} strokeWidth={2.2} style={refreshing ? { animation: "spin 1s linear infinite" } : undefined} />
        </button>
      </div>

      {/* Chip filtri stato */}
      <div className="m-scroll" style={{
        display: "flex", gap: 8, padding: "0 16px 12px", flexShrink: 0,
        overflowX: "auto", overflowY: "hidden", flexWrap: "nowrap",
      }}>
        {FILTRI.map(f => {
          const active = filtro === f;
          const col = f === "Tutti" ? C.text2 : statoColor(f);
          return (
            <button
              key={f}
              className="m-press"
              onClick={() => setFiltro(f)}
              style={{
                flexShrink: 0, padding: "10px 15px", borderRadius: 99, cursor: "pointer",
                fontSize: 14, fontWeight: 700, whiteSpace: "nowrap",
                background: active ? `${col}1f` : "rgba(255,255,255,0.05)",
                border: `1.5px solid ${active ? `${col}60` : C.border}`,
                color: active ? col : C.text3,
                transition: "background 0.2s, border-color 0.2s, color 0.2s",
              }}
            >
              {f} · {countFor(f)}
            </button>
          );
        })}
      </div>

      {/* Lista */}
      <div className="m-scroll" style={{ flex: 1, minHeight: 0, padding: "0 16px 16px" }}>
        {loading && (
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            <Skeleton variant="card" />
            <Skeleton variant="card" />
            <Skeleton variant="card" />
          </div>
        )}

        {!loading && filtered.length === 0 && (
          <div className="m-fade-up" style={{ textAlign: "center", padding: "56px 20px" }}>
            <div style={{
              width: 68, height: 68, borderRadius: 24, margin: "0 auto 14px",
              background: "rgba(255,255,255,0.05)", border: `1px solid ${C.border}`,
              display: "flex", alignItems: "center", justifyContent: "center", color: C.text3,
            }}>
              <Inbox size={32} strokeWidth={1.8} />
            </div>
            <div style={{ color: C.text2, fontSize: 16, fontWeight: 600 }}>
              {filtro === "Tutti" ? "Nessun ticket assegnato" : `Nessun ticket «${filtro}»`}
            </div>
          </div>
        )}

        {!loading && filtered.length > 0 && (
          <div className="m-cols">
            {filtered.map((t, idx) => {
              const tInfo = tipoMeta(t.tipo);
              const sCol = statoColor(t.stato);
              const start = t.planned_start
                ? new Date(t.planned_start).toLocaleString("it-IT", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })
                : null;
              return (
                <button
                  key={t.id}
                  className="m-press m-fade-up"
                  onClick={() => router.push(`/m/ticket/${t.id}`)}
                  style={{
                    ...glass, width: "100%", padding: "15px 15px",
                    cursor: "pointer", textAlign: "left",
                    display: "flex", alignItems: "center", gap: 13,
                    animationDelay: `${Math.min(idx * 0.04, 0.3)}s`,
                  }}
                >
                  <IconBadge Icon={tInfo.Icon} color={tInfo.color} size={48} iconSize={22} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontWeight: 800, fontSize: 16, color: C.text, marginBottom: 4, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", letterSpacing: "-0.01em" }}>
                      {t.titolo}
                    </div>
                    <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                      <span style={{
                        fontSize: 12, padding: "3px 9px", borderRadius: 99, fontWeight: 800,
                        background: `${sCol}1c`, color: sCol, border: `1px solid ${sCol}40`,
                      }}>{t.stato}</span>
                      <span style={{
                        fontSize: 12, padding: "3px 9px", borderRadius: 99, fontWeight: 800,
                        background: `${tInfo.color}1c`, color: tInfo.color, border: `1px solid ${tInfo.color}40`,
                      }}>{t.tipo}</span>
                      <span style={{ fontSize: 13, color: prioritaColor(t.priorita), fontWeight: 800 }}>{t.priorita}</span>
                    </div>
                    <div style={{ fontSize: 13, color: C.text3, marginTop: 5, display: "flex", alignItems: "center", gap: 5, overflow: "hidden" }}>
                      <Package size={13} strokeWidth={2.2} style={{ flexShrink: 0 }} />
                      <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        {t.asset_name}{start ? ` · ${start}` : ""}
                      </span>
                    </div>
                  </div>
                  <ChevronRight size={19} color={C.text3 as string} style={{ flexShrink: 0 }} />
                </button>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
