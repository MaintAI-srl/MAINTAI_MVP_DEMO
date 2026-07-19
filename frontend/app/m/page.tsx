"use client";

/**
 * Home dell'app mobile /m — saluto, emergenze attive, interventi in corso
 * e accessi rapidi. La navigazione principale è nella bottom tab bar.
 */

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { apiGet } from "../lib/api";
import { notify } from "@/lib/toast";
import { useAuth } from "../lib/auth";
import Skeleton from "../components/Skeleton";
import {
  Mic, ClipboardList, ChevronRight, RefreshCw, AlertTriangle, Package, Stethoscope,
} from "lucide-react";
import {
  C, glass, circleBtn, IconBadge, tipoMeta, isDispatchAlertTicket, useTecnicoId,
  type Ticket,
} from "./shared";

export default function MobileHomePage() {
  const { user } = useAuth();
  const router = useRouter();
  const tecnicoId = useTecnicoId();
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const loadTickets = useCallback(async () => {
    if (tecnicoId === null) return;
    if (tecnicoId === -1) { setLoading(false); return; }
    try {
      const d = await apiGet<{ items?: Ticket[] }>(`/tickets?tecnico_id=${tecnicoId}&limit=50`);
      setTickets(d.items ?? []);
    } catch {
      notify.error("Errore nel caricamento degli interventi.", "MOBILE");
    }
    setLoading(false);
  }, [tecnicoId]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- fetch iniziale all'mount; il ramo senza profilo tecnico chiude solo lo skeleton
    loadTickets();
  }, [loadTickets]);

  // Ricarica quando l'app torna in primo piano (PWA / cambio tab)
  useEffect(() => {
    const onVisible = () => { if (document.visibilityState === "visible") loadTickets(); };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [loadTickets]);

  if (loading) {
    return (
      <div className="m-page" style={{ padding: "20px 16px", display: "flex", flexDirection: "column", gap: 16 }}>
        <Skeleton variant="block" width="60%" height={28} />
        <Skeleton variant="block" width="100%" height={14} />
        <div style={{ marginTop: 12 }}><Skeleton variant="card" /></div>
        <Skeleton variant="card" />
      </div>
    );
  }

  const emergenze = tickets.filter(isDispatchAlertTicket);
  const inCorsoList = tickets.filter(t => t.stato === "In corso");
  const pianificati = tickets.filter(t => t.stato === "Pianificato").length;

  return (
    <div className="m-page m-scroll" style={{ padding: "0 16px 16px" }}>

      {/* Header saluto */}
      <div className="m-fade-up" style={{ padding: "16px 0 12px", display: "flex", justifyContent: "space-between", alignItems: "center", flexShrink: 0 }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontWeight: 800, fontSize: "clamp(22px, 6vw, 28px)", color: C.text, letterSpacing: "-0.025em", lineHeight: 1.15 }}>
            Ciao, {user?.username ?? "Tecnico"}
          </div>
          <div style={{ fontSize: 14, color: C.text3, marginTop: 4, fontWeight: 600, display: "flex", alignItems: "center", gap: 12 }}>
            <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <span style={{ width: 8, height: 8, borderRadius: "50%", background: inCorsoList.length > 0 ? C.orange : (C.text3 as string), display: "inline-block" }} />
              {inCorsoList.length} in corso
            </span>
            <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <span style={{ width: 8, height: 8, borderRadius: "50%", background: C.blue, display: "inline-block" }} />
              {pianificati} pianificati
            </span>
          </div>
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

      {/* Banner no profilo */}
      {tecnicoId === -1 && (
        <div className="m-fade-up" style={{
          marginBottom: 12, background: `${C.yellow}0d`, border: `1px solid ${C.yellow}38`,
          borderRadius: 18, padding: "14px 16px", display: "flex", gap: 12, alignItems: "center", flexShrink: 0,
        }}>
          <IconBadge Icon={AlertTriangle} color={C.yellow} size={44} iconSize={21} />
          <div>
            <div style={{ fontWeight: 800, fontSize: 15, color: C.yellow, marginBottom: 2 }}>Profilo tecnico non collegato</div>
            <div style={{ fontSize: 13, color: C.text2, lineHeight: 1.45 }}>Contatta il responsabile per associare l&apos;account.</div>
          </div>
        </div>
      )}

      {/* Banner EMERGENZE attive — priorità massima */}
      {emergenze.map(t => (
        <button key={t.id} className="m-press m-fade-up" onClick={() => router.push(`/m/ticket/${t.id}`)}
          style={{
            display: "flex", alignItems: "center", gap: 13, width: "100%",
            marginBottom: 10, padding: "14px 15px", cursor: "pointer",
            background: `linear-gradient(110deg, ${C.red}1f 0%, ${C.red}0a 100%)`,
            border: `1.5px solid ${C.red}55`, borderRadius: 20,
            textAlign: "left", flexShrink: 0,
          }}>
          <div style={{
            width: 48, height: 48, borderRadius: 16, flexShrink: 0,
            background: `${C.red}22`, border: `1px solid ${C.red}50`,
            display: "flex", alignItems: "center", justifyContent: "center", color: C.red,
            animation: "mEmergencyRing 1.6s ease-out infinite",
          }}>
            <AlertTriangle size={23} strokeWidth={2.2} />
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontWeight: 800, fontSize: 12, color: C.red, textTransform: "uppercase", letterSpacing: "0.1em", animation: "mBreath 1.4s ease-in-out infinite" }}>
              BD / emergenza assegnata
            </div>
            <div style={{ fontWeight: 700, fontSize: 16, color: C.text, marginTop: 2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {t.titolo}
            </div>
            {t.asset_name && <div style={{ fontSize: 13, color: C.text2, marginTop: 1 }}>{t.asset_name}</div>}
          </div>
          <ChevronRight size={20} color={C.red} style={{ flexShrink: 0 }} />
        </button>
      ))}

      {/* Ticket IN CORSO */}
      {inCorsoList.length > 0 && (
        <div className="m-fade-up" style={{ marginBottom: 12, flexShrink: 0 }}>
          <div style={{ fontSize: 12, fontWeight: 800, color: C.text3, textTransform: "uppercase", letterSpacing: "0.12em", marginBottom: 8 }}>
            In corso ora
          </div>
          {inCorsoList.map(t => {
            const tInfo = tipoMeta(t.tipo);
            return (
              <button key={t.id} className="m-press" onClick={() => router.push(`/m/ticket/${t.id}`)}
                style={{
                  width: "100%", display: "flex", alignItems: "center", gap: 12, padding: "14px 15px",
                  background: `${C.orange}0c`, border: `1.5px solid ${C.orange}42`,
                  borderRadius: 18, cursor: "pointer", marginBottom: 8, textAlign: "left",
                }}>
                <IconBadge Icon={tInfo.Icon} color={C.orange} size={44} iconSize={20} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: 800, fontSize: 16, color: C.text, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{t.titolo}</div>
                  <div style={{ fontSize: 13, color: C.text2, marginTop: 2 }}>{t.asset_name}</div>
                </div>
                <span style={{ fontSize: 13, color: C.orange, fontWeight: 800, flexShrink: 0, display: "flex", alignItems: "center", gap: 4 }}>
                  APRI <ChevronRight size={15} strokeWidth={2.5} />
                </span>
              </button>
            );
          })}
        </div>
      )}

      {/* Accessi rapidi */}
      <div className="m-tiles" style={{ paddingTop: 2 }}>
        <Link
          href="/m/nuovo"
          className="m-press m-fade-up m-d1"
          style={{
            minHeight: "clamp(170px, 24vh, 230px)", borderRadius: 26, border: `1px solid ${C.indigo}45`,
            display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 14,
            position: "relative", overflow: "hidden", padding: "22px 16px", textDecoration: "none",
            background: `radial-gradient(140% 120% at 20% 0%, ${C.indigo}33 0%, transparent 50%), linear-gradient(150deg, #181640 0%, #0E0C2A 70%)`,
            boxShadow: `0 14px 44px ${C.indigo}28`,
          }}
        >
          <div style={{
            width: "clamp(72px, 18vw, 88px)", height: "clamp(72px, 18vw, 88px)", borderRadius: "28%",
            background: `${C.indigo}28`, border: `1px solid ${C.indigo}50`,
            display: "flex", alignItems: "center", justifyContent: "center", color: "#A5A1FF",
            boxShadow: `0 0 30px ${C.indigo}40`,
          }}>
            <Mic size={40} strokeWidth={1.8} />
          </div>
          <div style={{ textAlign: "center" }}>
            <div style={{ fontWeight: 800, fontSize: "clamp(21px, 5.6vw, 26px)", color: C.text, letterSpacing: "-0.02em", lineHeight: 1.2 }}>
              Apri Ticket <span style={{ color: "#A5A1FF" }}>Vocale</span>
            </div>
            <div style={{ fontSize: "clamp(13px, 3.4vw, 15px)", color: C.text3, marginTop: 6, fontWeight: 500, lineHeight: 1.35 }}>Riconosce l&apos;asset dalla voce o dal QR</div>
          </div>
        </Link>

        <Link
          href="/m/piano"
          className="m-press m-fade-up m-d2"
          style={{
            minHeight: "clamp(170px, 24vh, 230px)", borderRadius: 26, border: `1px solid ${C.teal}40`,
            display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 14,
            position: "relative", overflow: "hidden", padding: "22px 16px", textDecoration: "none",
            background: `radial-gradient(140% 120% at 80% 0%, ${C.teal}26 0%, transparent 50%), linear-gradient(150deg, #0C2B2E 0%, #081C20 70%)`,
            boxShadow: `0 14px 44px ${C.teal}1f`,
          }}
        >
          <div style={{
            width: "clamp(72px, 18vw, 88px)", height: "clamp(72px, 18vw, 88px)", borderRadius: "28%",
            background: `${C.teal}1f`, border: `1px solid ${C.teal}48`,
            display: "flex", alignItems: "center", justifyContent: "center", color: C.teal,
            boxShadow: `0 0 30px ${C.teal}33`,
          }}>
            <ClipboardList size={40} strokeWidth={1.8} />
          </div>
          <div style={{ textAlign: "center" }}>
            <div style={{ fontWeight: 800, fontSize: "clamp(21px, 5.6vw, 26px)", color: C.text, letterSpacing: "-0.02em", lineHeight: 1.2 }}>
              Piano <span style={{ color: C.teal }}>Odierno</span>
            </div>
            <div style={{ fontSize: "clamp(13px, 3.4vw, 15px)", color: C.text3, marginTop: 6, fontWeight: 500, lineHeight: 1.35 }}>Verifica DPI e accedi al piano</div>
          </div>
        </Link>
      </div>

      {/* Scorciatoia diagnostica */}
      <Link
        href="/m/diagnosi"
        className="m-press m-fade-up m-d3"
        style={{
          ...glass, marginTop: 12, padding: "15px 16px", textDecoration: "none",
          display: "flex", alignItems: "center", gap: 13, flexShrink: 0,
        }}
      >
        <IconBadge Icon={Stethoscope} color={C.purple} size={44} iconSize={21} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontWeight: 800, fontSize: 16, color: C.text }}>Diagnosi guasti AI</div>
          <div style={{ fontSize: 13, color: C.text3, marginTop: 2 }}>Analisi guidata del guasto sul campo</div>
        </div>
        <ChevronRight size={19} color={C.text3 as string} />
      </Link>

      {/* Scorciatoia lista ticket */}
      <Link
        href="/m/ticket"
        className="m-press m-fade-up m-d4"
        style={{
          ...glass, marginTop: 10, padding: "15px 16px", textDecoration: "none",
          display: "flex", alignItems: "center", gap: 13, flexShrink: 0,
        }}
      >
        <IconBadge Icon={Package} color={C.blue} size={44} iconSize={21} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontWeight: 800, fontSize: 16, color: C.text }}>I miei ticket</div>
          <div style={{ fontSize: 13, color: C.text3, marginTop: 2 }}>{tickets.length} interventi assegnati</div>
        </div>
        <ChevronRight size={19} color={C.text3 as string} />
      </Link>
    </div>
  );
}
