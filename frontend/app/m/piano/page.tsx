"use client";

/**
 * Piano odierno del tecnico — verifica DPI obbligatoria, poi lista degli
 * interventi pianificati per oggi ordinati per orario.
 * Porting del flusso "Piano Odierno" della vecchia pagina /mobile.
 */

import { useState } from "react";
import { useRouter } from "next/navigation";
import { apiGet } from "../../lib/api";
import { localDateStr } from "../../lib/datetime";
import { notify } from "@/lib/toast";
import {
  ChevronLeft, ChevronRight, Check, CheckCircle2, Package, CalendarCheck,
  HardHat, Footprints, Hand, Glasses, Shirt, Cable, ShieldCheck, Home,
} from "lucide-react";
import {
  C, glass, circleBtn, IconBadge, tipoMeta, prioritaColor, useTecnicoId,
  type Ticket,
} from "../shared";

const DPI_ITEMS = [
  "Casco di protezione",
  "Scarpe antinfortunistiche",
  "Guanti da lavoro",
  "Occhiali di protezione",
  "Gilet ad alta visibilità",
  "Imbracatura (se lavori in quota)",
];
const DPI_ICONS = [HardHat, Footprints, Hand, Glasses, Shirt, Cable];

export default function MobilePianoPage() {
  const router = useRouter();
  const tecnicoId = useTecnicoId();

  const [dpiChecked, setDpiChecked] = useState<Record<string, boolean>>({});
  const [dpiConfirmed, setDpiConfirmed] = useState(false);
  const [piano, setPiano] = useState<Ticket[]>([]);
  const [loadingPiano, setLoadingPiano] = useState(false);

  const todayStr = new Date().toLocaleDateString("it-IT", { weekday: "long", day: "numeric", month: "short" });
  const allDpiChecked = DPI_ITEMS.every(item => dpiChecked[item]);

  async function loadPiano() {
    if (!tecnicoId || tecnicoId === -1) return;
    setLoadingPiano(true);
    try {
      const today = localDateStr();
      const res = await apiGet<{ items: Ticket[] }>(`/tickets?tecnico_id=${tecnicoId}&stato=Pianificato,In corso&limit=100`);
      const items = res.items ?? [];
      const todayItems = items.filter(t => t.planned_start?.startsWith(today));
      todayItems.sort((a, b) => (a.planned_start ?? "").localeCompare(b.planned_start ?? ""));
      setPiano(todayItems);
    } catch { notify.error("Errore caricamento piano"); }
    finally { setLoadingPiano(false); }
  }

  return (
    <div className="m-page" style={{ height: "100%", overflow: "hidden" }}>

      {/* Header vista */}
      <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "12px 16px 10px", flexShrink: 0 }}>
        <button
          className="m-press"
          aria-label="Indietro"
          onClick={() => {
            if (dpiConfirmed) { setDpiConfirmed(false); setDpiChecked({}); }
            else router.push("/m");
          }}
          style={circleBtn}
        >
          <ChevronLeft size={22} strokeWidth={2.2} />
        </button>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{
            fontWeight: 800, fontSize: "clamp(18px, 5vw, 22px)", letterSpacing: "-0.02em",
            color: C.text, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", lineHeight: 1.15,
          }}>Piano Odierno</div>
          <div style={{ fontSize: 12, color: C.text3, fontWeight: 600, marginTop: 1 }}>
            {todayStr.charAt(0).toUpperCase() + todayStr.slice(1)}
          </div>
        </div>
        <button className="m-press" aria-label="Home" onClick={() => router.push("/m")} style={circleBtn}>
          <Home size={19} strokeWidth={2.1} />
        </button>
      </div>

      {/* DPI Step */}
      {!dpiConfirmed && (
        <div style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column", padding: "0 16px 14px" }}>
          <div className="m-fade-up" style={{ textAlign: "center", padding: "4px 8px 14px", flexShrink: 0 }}>
            <div style={{
              width: 64, height: 64, borderRadius: 20, margin: "0 auto 10px",
              background: `${C.orange}18`, border: `1px solid ${C.orange}40`,
              display: "flex", alignItems: "center", justifyContent: "center", color: C.orange,
            }}>
              <HardHat size={32} strokeWidth={1.9} />
            </div>
            <div style={{ fontWeight: 800, fontSize: "clamp(20px, 5.6vw, 25px)", color: C.text, marginBottom: 5, letterSpacing: "-0.02em" }}>Verifica DPI</div>
            <div style={{ fontSize: 14, color: C.text2, lineHeight: 1.5, maxWidth: 480, margin: "0 auto" }}>
              Conferma di indossare tutti i dispositivi di protezione individuale
            </div>
          </div>

          <div className="m-scroll m-cols m-fade-up m-d1" style={{ flex: 1, minHeight: 0, paddingBottom: 10 }}>
            {DPI_ITEMS.map((item, idx) => {
              const isOn = !!dpiChecked[item];
              const ItemIcon = DPI_ICONS[idx] ?? ShieldCheck;
              return (
                <button key={item} className="m-press" onClick={() => setDpiChecked(prev => ({ ...prev, [item]: !prev[item] }))}
                  style={{
                    display: "flex", alignItems: "center", gap: 13, padding: "14px 15px", borderRadius: 18,
                    cursor: "pointer", textAlign: "left", minHeight: 64,
                    transition: "background 0.2s, border-color 0.2s",
                    background: isOn ? `${C.green}10` : C.card,
                    border: `1.5px solid ${isOn ? `${C.green}50` : C.border}`,
                  }}>
                  <IconBadge Icon={ItemIcon} color={isOn ? C.green : (C.text3 as string)} size={44} iconSize={21} />
                  <span style={{
                    flex: 1, fontSize: 15, lineHeight: 1.3,
                    color: isOn ? `${C.green}dd` : C.text,
                    fontWeight: isOn ? 600 : 700,
                    textDecoration: isOn ? "line-through" : "none",
                    transition: "color 0.2s",
                  }}>{item}</span>
                  <span style={{
                    width: 28, height: 28, borderRadius: "50%", flexShrink: 0,
                    background: isOn ? C.green : "transparent",
                    border: `2px solid ${isOn ? C.green : "rgba(255,255,255,0.25)"}`,
                    display: "flex", alignItems: "center", justifyContent: "center",
                    color: "#fff", transition: "background 0.2s, border-color 0.2s",
                  }}>
                    {isOn && <Check size={15} strokeWidth={3.2} />}
                  </span>
                </button>
              );
            })}
          </div>

          <div className="m-fade-up m-d2" style={{ flexShrink: 0, paddingTop: 6 }}>
            <button
              className="m-press"
              disabled={!allDpiChecked}
              onClick={() => { setDpiConfirmed(true); loadPiano(); }}
              style={{
                width: "100%", padding: "18px", borderRadius: 18, fontWeight: 800, fontSize: 17,
                cursor: allDpiChecked ? "pointer" : "not-allowed", border: "none",
                transition: "background 0.3s, box-shadow 0.3s, color 0.3s",
                background: allDpiChecked ? `linear-gradient(135deg, ${C.green}, #209A41)` : "rgba(255,255,255,0.06)",
                color: allDpiChecked ? "#fff" : C.text3,
                boxShadow: allDpiChecked ? `0 10px 30px ${C.green}45` : "none",
                display: "flex", alignItems: "center", justifyContent: "center", gap: 8,
              }}>
              {allDpiChecked
                ? <><CheckCircle2 size={20} strokeWidth={2.3} /> ACCEDI AL PIANO</>
                : `ACCEDI AL PIANO (${Object.values(dpiChecked).filter(Boolean).length}/${DPI_ITEMS.length})`}
            </button>
          </div>
        </div>
      )}

      {/* Piano Step */}
      {dpiConfirmed && (
        <div className="m-scroll" style={{ flex: 1, minHeight: 0, padding: "4px 16px 16px", display: "flex", flexDirection: "column", gap: 12 }}>

          {loadingPiano && (
            <div style={{ textAlign: "center", color: C.text3, padding: 40, fontSize: 15 }}>Caricamento piano...</div>
          )}

          {!loadingPiano && piano.length === 0 && (
            <div className="m-fade-up" style={{ textAlign: "center", padding: "48px 20px" }}>
              <div style={{
                width: 68, height: 68, borderRadius: 24, margin: "0 auto 14px",
                background: `${C.green}14`, border: `1px solid ${C.green}38`,
                display: "flex", alignItems: "center", justifyContent: "center", color: C.green,
              }}>
                <CalendarCheck size={32} strokeWidth={1.8} />
              </div>
              <div style={{ color: C.text2, fontSize: 16, fontWeight: 600 }}>Nessun intervento pianificato per oggi</div>
            </div>
          )}

          {!loadingPiano && piano.length > 0 && (
            <div className="m-cols">
              {piano.map((t, idx) => {
                const startTime = t.planned_start ? new Date(t.planned_start).toLocaleTimeString("it-IT", { hour: "2-digit", minute: "2-digit" }) : null;
                const endTime = t.planned_finish ? new Date(t.planned_finish).toLocaleTimeString("it-IT", { hour: "2-digit", minute: "2-digit" }) : null;
                const tInfo = tipoMeta(t.tipo);
                return (
                  <button key={t.id} className="m-press m-fade-up" onClick={() => router.push(`/m/ticket/${t.id}`)}
                    style={{
                      ...glass, width: "100%", borderRadius: 20, padding: "15px 15px",
                      cursor: "pointer", textAlign: "left",
                      display: "flex", alignItems: "center", gap: 13,
                      animationDelay: `${Math.min(idx * 0.06, 0.4)}s`,
                    }}>
                    <IconBadge Icon={tInfo.Icon} color={tInfo.color} size={48} iconSize={22} />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      {startTime && (
                        <div style={{ fontSize: 13, color: C.teal, fontWeight: 800, fontFamily: "var(--font-mono)", marginBottom: 3, fontVariantNumeric: "tabular-nums" }}>
                          {startTime}{endTime ? ` – ${endTime}` : ""}
                        </div>
                      )}
                      <div style={{ fontWeight: 800, fontSize: 16, color: C.text, marginBottom: 4, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", letterSpacing: "-0.01em" }}>{t.titolo}</div>
                      <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                        <span style={{
                          fontSize: 12, padding: "2px 9px", borderRadius: 99, fontWeight: 800,
                          background: `${tInfo.color}1c`, color: tInfo.color, border: `1px solid ${tInfo.color}40`,
                        }}>{t.tipo}</span>
                        <span style={{ fontSize: 13, color: C.text3, fontWeight: 600 }}>{t.durata_stimata_ore}h</span>
                        <span style={{ fontSize: 13, color: prioritaColor(t.priorita), fontWeight: 800 }}>{t.priorita}</span>
                      </div>
                      {t.asset_name && (
                        <div style={{ fontSize: 13, color: C.text3, marginTop: 4, display: "flex", alignItems: "center", gap: 4 }}>
                          <Package size={12} strokeWidth={2.2} /> {t.asset_name}
                        </div>
                      )}
                    </div>
                    <ChevronRight size={19} color={C.text3 as string} style={{ flexShrink: 0 }} />
                  </button>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
