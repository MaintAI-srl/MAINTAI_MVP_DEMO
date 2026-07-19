"use client";

/**
 * Vista lavoro su singolo ticket — safety checklist reale dall'asset,
 * contatore MTTR, foto/nota vocale, chiusura con verifica QR e firma cliente.
 * Porting della ActiveWorkView della vecchia pagina /mobile come route dedicata.
 */

import { useEffect, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { apiGet, apiPut, apiUpload } from "../../../lib/api";
import { localDatetimeApiStr } from "../../../lib/datetime";
import { notify } from "@/lib/toast";
import Skeleton from "../../../components/Skeleton";
import VoiceRecorder from "../../../components/VoiceRecorder";
import QrScanner from "../../../components/QrScanner";
import FirmaRapportinoModal from "../../../components/FirmaRapportinoModal";
import {
  Mic, ChevronLeft, Camera, Check, Play, Pause,
  ShieldCheck, CheckCircle2, MapPin, Save, CalendarCheck, Home,
} from "lucide-react";
import {
  C, glass, circleBtn, tipoMeta, LiveClock, MttrCounter,
  type Ticket,
} from "../../shared";

export default function MobileTicketWorkPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const ticketId = Number(params.id);

  const [ticket, setTicket] = useState<Ticket | null>(null);
  const [loadError, setLoadError] = useState(false);

  useEffect(() => {
    if (!Number.isFinite(ticketId)) { setLoadError(true); return; }
    apiGet<Ticket>(`/tickets/${ticketId}`)
      .then(setTicket)
      .catch(() => setLoadError(true));
  }, [ticketId]);

  // Checklist reale dal DB (CheckPrimoLivello dell'asset)
  const [checklist, setChecklist] = useState<{ id: number; text: string }[]>([]);
  const [checklistLoading, setChecklistLoading] = useState(true);

  useEffect(() => {
    if (!ticket) return;
    if (!ticket.asset_id) { setChecklistLoading(false); return; }
    apiGet<{ voci?: { label: string; descrizione?: string }[] } | null>(
      `/assets/${ticket.asset_id}/check`
    )
      .then(data => {
        const voci = data?.voci ?? [];
        setChecklist(voci.map((v, i) => ({
          id: i + 1,
          text: v.descrizione ? `${v.label} — ${v.descrizione}` : v.label,
        })));
      })
      .catch(() => setChecklist([]))
      .finally(() => setChecklistLoading(false));
  }, [ticket]);

  const [checked, setChecked] = useState<Set<number>>(new Set());
  const [paused, setPaused] = useState(false);
  const [pausedAt, setPausedAt] = useState(0);
  const [started, setStarted] = useState(false);
  const [starting, setStarting] = useState(false);
  const [showVoice, setShowVoice] = useState(false);
  const [transcript, setTranscript] = useState("");
  const [savingVoice, setSavingVoice] = useState(false);
  const [uploadingPhoto, setUploadingPhoto] = useState(false);
  const photoInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (ticket?.stato === "In corso") setStarted(true);
  }, [ticket?.stato]);

  // QR close flow: "idle" → "scanning" → "confirm" → "firma" → (close)
  const [closeState, setCloseState] = useState<"idle" | "scanning" | "confirm" | "firma">("idle");
  const [qrScannedValue, setQrScannedValue] = useState("");
  // allChecked: vero se tutte le voci sono flaggate O se non ci sono voci da verificare
  const allChecked = checklist.length === 0 || checked.size === checklist.length;

  async function updateStatus(newStato: string) {
    if (!ticket) return;
    try {
      const body: Record<string, string | null> = { stato: newStato };
      if (newStato === "In corso") body.execution_start = localDatetimeApiStr();
      else if (newStato === "Chiuso") body.execution_finish = localDatetimeApiStr();
      await apiPut(`/tickets/${ticket.id}`, body);
      setTicket(prev => prev ? {
        ...prev, stato: newStato,
        execution_start: newStato === "In corso" ? localDatetimeApiStr() : prev.execution_start,
      } : prev);
      notify.success(
        newStato === "In corso" ? "✅ Intervento avviato" :
        newStato === "Chiuso"   ? "✅ Intervento completato!" : `Stato: ${newStato}`, "TICKET"
      );
      if (newStato === "Chiuso") router.push("/m/ticket");
    } catch {
      notify.error("Errore aggiornamento stato.", "TICKET");
    }
  }

  function toggle(id: number) {
    setChecked(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  async function handleIniziaLavoro() {
    if (!allChecked) {
      notify.warning("Completa la Safety Checklist prima di avviare.", "SAFETY");
      return;
    }
    setStarting(true);
    await updateStatus("In corso");
    setStarted(true);
    setStarting(false);
  }

  async function handleTermina() {
    if (!allChecked) {
      notify.warning("Completa la Safety Checklist prima di terminare.", "SAFETY");
      return;
    }
    // Propone scansione QR ma non è obbligatoria; poi passa alla firma cliente
    if (ticket?.asset_id) {
      setCloseState("scanning");
    } else {
      setCloseState("firma");
    }
  }

  function handlePausa() {
    if (!paused) { setPausedAt(Date.now()); setPaused(true); }
    else setPaused(false);
  }

  async function handleSaveVoice() {
    if (!transcript.trim() || !ticket) return;
    setSavingVoice(true);
    try {
      await apiPut(`/tickets/${ticket.id}`, { note_vocali: transcript.trim() });
      notify.success("Nota vocale salvata ✓");
      setTranscript("");
      setShowVoice(false);
    } catch { notify.error("Errore salvataggio nota"); }
    setSavingVoice(false);
  }

  if (loadError) {
    return (
      <div className="m-page" style={{ padding: "40px 20px", textAlign: "center" }}>
        <div style={{ color: C.text2, fontSize: 16, fontWeight: 600, marginBottom: 18 }}>Ticket non trovato.</div>
        <button className="m-press" onClick={() => router.push("/m/ticket")} style={{
          padding: "13px 24px", borderRadius: 14, background: "rgba(255,255,255,0.07)",
          border: `1px solid ${C.border}`, color: C.text, fontWeight: 700, fontSize: 15, cursor: "pointer",
        }}>Torna ai ticket</button>
      </div>
    );
  }

  if (!ticket) {
    return (
      <div className="m-page" style={{ padding: "20px 16px", display: "flex", flexDirection: "column", gap: 14 }}>
        <Skeleton variant="block" width="70%" height={26} />
        <Skeleton variant="card" />
        <Skeleton variant="card" />
      </div>
    );
  }

  const tipo = tipoMeta(ticket.tipo);

  return (
    <div className="m-page" style={{ height: "100%", overflow: "hidden", padding: "0 14px 12px" }}>

      {/* ── QR Scanner per chiusura ─────────────────────────────────────────── */}
      {closeState === "scanning" && (
        <div style={{ position: "fixed", inset: 0, zIndex: 9999, display: "flex", flexDirection: "column" }}>
          <QrScanner
            title="Verifica Presenza 📍"
            subtitle="Scansiona il QR code sull'asset per chiudere"
            onScan={(val) => { setQrScannedValue(val); setCloseState("confirm"); }}
            onCancel={() => setCloseState("idle")}
          />
          {/* Pulsante skip QR — chiusura diretta senza scansione */}
          <div style={{
            position: "absolute", bottom: 32, left: 0, right: 0,
            display: "flex", justifyContent: "center", zIndex: 10001,
          }}>
            <button
              className="m-press"
              onClick={() => setCloseState("firma")}
              style={{
                padding: "13px 28px", borderRadius: 14,
                background: "rgba(0,0,0,0.75)", border: `1px solid ${C.border}`,
                color: C.text2, fontSize: 14, fontWeight: 700, cursor: "pointer",
                backdropFilter: "blur(12px)",
              }}
            >
              Salta QR
            </button>
          </div>
        </div>
      )}

      {/* ── Modal conferma chiusura dopo QR ─────────────────────────────────── */}
      {closeState === "confirm" && (
        <div style={{
          position: "fixed", inset: 0, zIndex: 9998,
          background: "rgba(0,0,0,0.78)",
          backdropFilter: "blur(8px)", WebkitBackdropFilter: "blur(8px)",
          display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
          padding: 24,
        }}>
          <div className="m-scale-in" style={{
            background: C.cardSolid, border: `1px solid ${C.border}`,
            borderRadius: 26, padding: "28px 24px",
            width: "100%", maxWidth: 380,
            boxShadow: "0 32px 80px rgba(0,0,0,0.6)",
          }}>
            <div style={{ textAlign: "center", marginBottom: 20 }}>
              <div style={{
                width: 72, height: 72, borderRadius: 24, margin: "0 auto 14px",
                background: `${C.green}1c`, border: `1px solid ${C.green}40`,
                display: "flex", alignItems: "center", justifyContent: "center", color: C.green,
              }}>
                <CheckCircle2 size={38} strokeWidth={1.8} />
              </div>
              <div style={{ fontWeight: 800, fontSize: 21, color: C.text, marginBottom: 6, letterSpacing: "-0.02em" }}>QR Verificato</div>
              <div style={{
                fontSize: 12, color: C.green, fontWeight: 800, letterSpacing: "0.06em", marginBottom: 12,
                display: "flex", alignItems: "center", justifyContent: "center", gap: 5,
              }}>
                <MapPin size={13} strokeWidth={2.4} /> PRESENZA FISICA CONFERMATA
              </div>
              <div style={{
                fontSize: 12, color: C.text3,
                background: "rgba(255,255,255,0.05)", borderRadius: 10,
                padding: "7px 10px", wordBreak: "break-all", fontFamily: "var(--font-mono)",
              }}>
                {qrScannedValue.length > 48
                  ? qrScannedValue.substring(0, 48) + "…"
                  : qrScannedValue}
              </div>
            </div>
            <div style={{ fontSize: 15, color: C.text2, textAlign: "center", marginBottom: 22, lineHeight: 1.5 }}>
              La scansione è registrata.<br />Vuoi chiudere l&apos;intervento?
            </div>
            <div style={{ display: "flex", gap: 10 }}>
              <button
                className="m-press"
                onClick={() => setCloseState("idle")}
                style={{
                  flex: 1, padding: 15, borderRadius: 14,
                  background: "rgba(255,255,255,0.07)", border: `1px solid ${C.border}`,
                  color: C.text2, fontWeight: 700, cursor: "pointer", fontSize: 15,
                }}
              >
                Annulla
              </button>
              <button
                className="m-press"
                onClick={() => setCloseState("firma")}
                style={{
                  flex: 2, padding: 15, borderRadius: 14,
                  background: `linear-gradient(135deg, ${C.green} 0%, #209A41 100%)`,
                  border: "none", color: "#fff", fontWeight: 800, cursor: "pointer", fontSize: 16,
                  boxShadow: `0 8px 24px ${C.green}45`,
                  display: "flex", alignItems: "center", justifyContent: "center", gap: 7,
                }}
              >
                <Check size={18} strokeWidth={3} /> FIRMA CLIENTE
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Firma cliente + rapportino PDF ─────────────────────────────────── */}
      {closeState === "firma" && (
        <FirmaRapportinoModal
          ticketId={ticket.id}
          mode="download"
          onClose={() => setCloseState("idle")}
          onDone={async () => { await updateStatus("Chiuso"); }}
          onSkip={async () => { await updateStatus("Chiuso"); }}
          skipLabel="Chiudi senza firma"
        />
      )}

      {/* ── Top bar compatta ── */}
      <div style={{
        display: "flex", alignItems: "center", gap: 10,
        padding: "10px 0 8px",
        flexShrink: 0,
      }}>
        <button className="m-press" aria-label="Indietro" onClick={() => router.push("/m/ticket")} style={circleBtn}>
          <ChevronLeft size={22} strokeWidth={2.2} />
        </button>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 15, fontWeight: 800, letterSpacing: "-0.01em", color: C.text, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {ticket.titolo}
          </div>
          <div style={{ fontSize: 12, color: C.text3, fontWeight: 600 }}>{ticket.asset_name}</div>
        </div>
        <div style={{
          fontSize: 12, fontWeight: 800, padding: "5px 11px", borderRadius: 99, flexShrink: 0,
          color: tipo.color, background: `${tipo.color}1a`, border: `1px solid ${tipo.color}40`,
          display: "flex", alignItems: "center", gap: 5,
        }}>
          <tipo.Icon size={12} strokeWidth={2.4} /> {tipo.label}
        </div>
        <button className="m-press" aria-label="Home" onClick={() => router.push("/m")} style={circleBtn}>
          <Home size={19} strokeWidth={2.1} />
        </button>
      </div>

      {/* ── Layout split: 1 colonna su phone portrait, 2 da tablet/landscape ── */}
      <div className="m-split">

        {/* ── SINISTRA: Titolo + azioni media + Safety Checklist ── */}
        <div className="m-scroll m-fade-up" style={{ display: "flex", flexDirection: "column", gap: 10, minHeight: 0 }}>

          {/* Titolo e asset */}
          <div style={{ ...glass, padding: 15, flexShrink: 0 }}>
            <div style={{ fontSize: "clamp(16px, 4.4vw, 21px)", fontWeight: 800, color: C.text, lineHeight: 1.25, marginBottom: 4, letterSpacing: "-0.02em" }}>
              {ticket.titolo}
            </div>
            <div style={{ fontSize: 14, fontWeight: 700, color: C.teal }}>{ticket.asset_name}</div>
            {ticket.descrizione && (
              <div style={{ fontSize: 14, color: C.text2, marginTop: 6, lineHeight: 1.45 }}>
                {ticket.descrizione}
              </div>
            )}
          </div>

          {/* Pulsanti FOTO e VOCE */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, flexShrink: 0 }}>
            {/* Input foto nascosto */}
            <input
              ref={photoInputRef}
              type="file"
              accept="image/*"
              capture="environment"
              style={{ display: "none" }}
              onChange={async (e) => {
                const file = e.target.files?.[0];
                if (!file) return;
                setUploadingPhoto(true);
                try {
                  const formData = new FormData();
                  formData.append("file", file);
                  await apiUpload(`/tickets/${ticket.id}/allegati`, formData);
                  notify.success("Foto allegata al ticket ✓");
                } catch (err) {
                  notify.error(err instanceof Error ? err.message : "Errore caricamento foto");
                } finally {
                  setUploadingPhoto(false);
                  e.target.value = "";
                }
              }}
            />
            <button
              className="m-press"
              onClick={() => photoInputRef.current?.click()}
              disabled={uploadingPhoto}
              style={{
                borderRadius: 18, minHeight: 80, padding: "14px 8px",
                background: `${C.blue}12`, border: `1.5px solid ${C.blue}38`,
                color: C.blue, cursor: uploadingPhoto ? "wait" : "pointer",
                opacity: uploadingPhoto ? 0.6 : 1,
                display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 7,
              }}
            >
              <Camera size={28} strokeWidth={1.9} />
              <span style={{ fontSize: 12, fontWeight: 800, letterSpacing: "0.08em" }}>{uploadingPhoto ? "CARICO…" : "FOTO"}</span>
            </button>
            <button
              className="m-press"
              onClick={() => setShowVoice(v => !v)}
              style={{
                borderRadius: 18, minHeight: 80, padding: "14px 8px",
                background: showVoice ? `${C.purple}22` : `${C.purple}12`,
                border: `1.5px solid ${showVoice ? `${C.purple}60` : `${C.purple}38`}`,
                color: C.purple, cursor: "pointer",
                display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 7,
                transition: "background 0.2s, border-color 0.2s",
              }}
            >
              <Mic size={28} strokeWidth={1.9} />
              <span style={{ fontSize: 12, fontWeight: 800, letterSpacing: "0.08em" }}>VOCE</span>
            </button>
          </div>

          {/* Pannello nota vocale (espandibile) */}
          {showVoice && (
            <div className="m-scale-in" style={{
              background: `${C.purple}0d`, border: `1px solid ${C.purple}30`,
              borderRadius: 16, padding: 12, display: "flex", flexDirection: "column", gap: 8, flexShrink: 0,
            }}>
              <VoiceRecorder onTranscript={(t) => setTranscript(prev => prev ? prev + " " + t : t)} disabled={savingVoice} />
              {transcript && (
                <>
                  <textarea
                    value={transcript}
                    onChange={e => setTranscript(e.target.value)}
                    rows={2}
                    style={{
                      width: "100%", resize: "none", background: `${C.purple}10`,
                      border: `1px solid ${C.purple}35`, borderRadius: 12,
                      color: C.text, padding: "10px 12px", fontSize: 16, outline: "none", boxSizing: "border-box",
                      WebkitAppearance: "none",
                    }}
                  />
                  <button className="m-press" onClick={handleSaveVoice} disabled={savingVoice} style={{
                    height: 48, borderRadius: 12, background: C.purple,
                    border: "none", color: "#fff", fontWeight: 800, fontSize: 13, cursor: "pointer",
                    display: "flex", alignItems: "center", justifyContent: "center", gap: 6,
                  }}>
                    <Save size={15} strokeWidth={2.4} />
                    {savingVoice ? "Salvataggio…" : "SALVA NOTA"}
                  </button>
                </>
              )}
            </div>
          )}

          {/* Safety Checklist — dati reali da CheckPrimoLivello */}
          <div style={{
            background: allChecked ? `${C.green}08` : `${C.red}08`,
            border: `1.5px solid ${allChecked ? `${C.green}38` : checklist.length === 0 ? C.border : `${C.red}45`}`,
            borderRadius: 18, padding: "12px 10px",
            transition: "border-color 0.3s, background 0.3s",
            flexShrink: 0,
          }}>
            <div style={{ display: "flex", alignItems: "center", gap: 7, marginBottom: 9 }}>
              <ShieldCheck size={17} strokeWidth={2.2} color={allChecked ? C.green : checklist.length === 0 ? (C.text3 as string) : C.red} />
              <span style={{
                fontSize: 12, fontWeight: 800, letterSpacing: "0.12em", textTransform: "uppercase",
                color: allChecked ? C.green : checklist.length === 0 ? C.text3 : C.red,
              }}>
                Safety
              </span>
              {checklist.length > 0 && (
                <span style={{ marginLeft: "auto", fontSize: 12, color: C.text3, fontFamily: "var(--font-mono)", fontWeight: 700 }}>
                  {checked.size}/{checklist.length}
                </span>
              )}
            </div>

            {checklistLoading ? (
              <div style={{ fontSize: 13, color: C.text3, textAlign: "center", padding: "12px 0" }}>
                Caricamento checklist...
              </div>
            ) : checklist.length === 0 ? (
              <div style={{ fontSize: 14, color: C.text2, padding: "6px 4px", lineHeight: 1.5 }}>
                Nessuna checklist configurata per questo asset.<br />
                <span style={{ color: C.text3 }}>Rispettare le procedure aziendali e indossare i DPI previsti.</span>
              </div>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
                {checklist.map(item => {
                  const isOn = checked.has(item.id);
                  return (
                    <button
                      key={item.id}
                      className="m-press"
                      onClick={() => toggle(item.id)}
                      style={{
                        display: "flex", alignItems: "center", gap: 11,
                        background: isOn ? `${C.green}14` : "rgba(255,255,255,0.04)",
                        border: `1.5px solid ${isOn ? `${C.green}70` : "rgba(255,255,255,0.10)"}`,
                        borderRadius: 14, padding: "13px 12px",
                        cursor: "pointer", textAlign: "left",
                        transition: "background 0.2s, border-color 0.2s",
                        minHeight: 56, width: "100%",
                      }}
                    >
                      <span style={{
                        width: 30, height: 30, borderRadius: "50%", flexShrink: 0,
                        background: isOn ? C.green : "rgba(255,255,255,0.06)",
                        border: `2px solid ${isOn ? C.green : "rgba(255,255,255,0.22)"}`,
                        display: "flex", alignItems: "center", justifyContent: "center",
                        color: "#fff", transition: "background 0.2s, border-color 0.2s",
                      }}>
                        {isOn && <Check size={16} strokeWidth={3.2} />}
                      </span>
                      <span style={{
                        fontSize: 14, lineHeight: 1.35,
                        color: isOn ? `${C.green}dd` : C.text,
                        textDecoration: isOn ? "line-through" : "none",
                        fontWeight: isOn ? 500 : 700, transition: "color 0.2s",
                      }}>
                        {item.text}
                      </span>
                    </button>
                  );
                })}
              </div>
            )}

            {allChecked && checklist.length > 0 && (
              <div style={{
                fontSize: 12, color: C.green, fontWeight: 800, textAlign: "center", paddingTop: 9,
                display: "flex", alignItems: "center", justifyContent: "center", gap: 5,
              }}>
                <CheckCircle2 size={14} strokeWidth={2.5} /> SICUREZZA VERIFICATA
              </div>
            )}
          </div>
        </div>

        {/* ── DESTRA: Orologio + MTTR + Date + Azioni ── */}
        <div className="m-scroll m-fade-up m-d1" style={{ display: "flex", flexDirection: "column", gap: 10, minHeight: 0 }}>

          {/* Orologio */}
          <div style={{ ...glass, padding: "14px 10px", flexShrink: 0 }}>
            <LiveClock />
          </div>

          {/* MTTR */}
          <div style={{
            ...glass,
            background: paused ? "rgba(235,235,245,0.04)" : C.card,
            padding: "14px 10px", flexShrink: 0,
            transition: "background 0.3s",
          }}>
            <MttrCounter start={ticket.execution_start} paused={paused} pausedAt={pausedAt} />
          </div>

          {/* Date pianificate */}
          <div style={{ display: "flex", flexDirection: "column", gap: 7, flexShrink: 0 }}>
            {[
              { label: "INIZIO", value: ticket.planned_start, color: C.purple, ItemIcon: Play },
              { label: "FINE",   value: ticket.planned_finish, color: C.green, ItemIcon: CalendarCheck },
            ].map(item => (
              <div key={item.label} style={{
                background: C.card, border: `1px solid ${item.color}28`,
                borderLeft: `3px solid ${item.color}`, borderRadius: 14, padding: "10px 12px",
              }}>
                <div style={{
                  fontSize: 11, color: C.text3, fontWeight: 800, letterSpacing: "0.14em", marginBottom: 3,
                  display: "flex", alignItems: "center", gap: 5,
                }}>
                  <item.ItemIcon size={11} strokeWidth={2.5} color={item.color} /> {item.label}
                </div>
                {item.value ? (
                  <>
                    <div style={{ fontSize: "clamp(15px, 4vw, 20px)", fontWeight: 800, color: item.color, fontFamily: "var(--font-mono)", lineHeight: 1, fontVariantNumeric: "tabular-nums" }}>
                      {new Date(item.value).toLocaleTimeString("it-IT", { hour: "2-digit", minute: "2-digit" })}
                    </div>
                    <div style={{ fontSize: 12, color: C.text3, marginTop: 2 }}>
                      {new Date(item.value).toLocaleDateString("it-IT", { day: "2-digit", month: "2-digit", year: "2-digit" })}
                    </div>
                  </>
                ) : (
                  <div style={{ fontSize: 17, color: "rgba(255,255,255,0.12)", fontWeight: 800 }}>—</div>
                )}
              </div>
            ))}
          </div>

          {/* Pulsanti azione */}
          <div style={{ display: "flex", flexDirection: "column", gap: 9, flexShrink: 0, marginTop: "auto" }}>
            {/* INIZIA — sempre visibile se non ancora avviato */}
            {!started && (
              <button
                className="m-press"
                onClick={handleIniziaLavoro}
                disabled={!allChecked || starting}
                style={{
                  height: 64, borderRadius: 18,
                  background: allChecked
                    ? `linear-gradient(135deg, ${C.blue} 0%, #0064D2 100%)`
                    : "rgba(255,255,255,0.05)",
                  border: allChecked ? "none" : `1.5px solid ${C.blue}50`,
                  color: allChecked ? "#fff" : `${C.blue}90`,
                  fontWeight: 800, fontSize: 17, letterSpacing: "0.02em",
                  cursor: allChecked && !starting ? "pointer" : "default",
                  boxShadow: allChecked ? `0 8px 28px ${C.blue}50` : "none",
                  display: "flex", alignItems: "center", justifyContent: "center", gap: 9,
                  transition: "background 0.25s, box-shadow 0.25s",
                  opacity: allChecked ? 1 : 0.8,
                }}
              >
                {starting
                  ? "…"
                  : <><Play size={21} strokeWidth={2.4} fill={allChecked ? "#fff" : "none"} /> INIZIA LAVORO</>}
              </button>
            )}

            {/* TERMINA — visibile solo se già avviato */}
            {started && (
              <button
                className="m-press"
                onClick={handleTermina}
                disabled={!allChecked}
                style={{
                  height: 60, borderRadius: 18,
                  background: allChecked
                    ? `linear-gradient(135deg, ${C.green} 0%, #209A41 100%)`
                    : `${C.green}10`,
                  border: allChecked ? "none" : `1.5px solid ${C.green}28`,
                  color: allChecked ? "#fff" : `${C.green}55`,
                  fontWeight: 800, fontSize: 16,
                  cursor: allChecked ? "pointer" : "not-allowed",
                  boxShadow: allChecked ? `0 8px 28px ${C.green}45` : "none",
                  display: "flex", alignItems: "center", justifyContent: "center", gap: 8,
                  transition: "background 0.25s, box-shadow 0.25s",
                }}
              >
                <CheckCircle2 size={20} strokeWidth={2.3} /> TERMINA
              </button>
            )}

            {/* PAUSA — solo se avviato */}
            {started && (
              <button
                className="m-press"
                onClick={handlePausa}
                style={{
                  height: 54, borderRadius: 18,
                  background: paused ? `${C.yellow}16` : "rgba(255,255,255,0.05)",
                  border: `1.5px solid ${paused ? `${C.yellow}50` : "rgba(255,255,255,0.12)"}`,
                  color: paused ? C.yellow : C.text2,
                  fontWeight: 800, fontSize: 15, cursor: "pointer",
                  display: "flex", alignItems: "center", justifyContent: "center", gap: 7,
                  transition: "background 0.25s, border-color 0.25s, color 0.25s",
                }}
              >
                {paused ? <Play size={18} strokeWidth={2.4} /> : <Pause size={18} strokeWidth={2.4} />}
                {paused ? "RIPRENDI" : "PAUSA"}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
