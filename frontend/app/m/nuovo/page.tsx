"use client";

/**
 * Nuovo ticket da campo — identificazione asset via voce, QR o ricerca
 * manuale, poi form rapido tipo/priorità/descrizione.
 * Porting del flusso "Ticket Vocale" della vecchia pagina /mobile.
 */

import { useState } from "react";
import { useRouter } from "next/navigation";
import { apiGet, apiPost } from "../../lib/api";
import { notify } from "@/lib/toast";
import VoiceRecorder from "../../components/VoiceRecorder";
import QrScanner from "../../components/QrScanner";
import {
  Mic, QrCode, ChevronLeft, ChevronRight, RefreshCw, Search, Package,
  CheckCircle2, Save, Home,
} from "lucide-react";
import {
  C, glass, circleBtn, IconBadge, tipoMeta, searchAssetsByQuery,
  type AssetResult,
} from "../shared";

export default function MobileNuovoTicketPage() {
  const router = useRouter();

  const [step, setStep] = useState<"listen" | "confirm_asset" | "form">("listen");
  const [inputMethod, setInputMethod] = useState<"voice" | "qr">("voice");
  const [showQrScan, setShowQrScan] = useState(false);
  const [voiceTranscript, setVoiceTranscript] = useState("");
  const [foundAssets, setFoundAssets] = useState<AssetResult[]>([]);
  const [selectedAsset, setSelectedAsset] = useState<AssetResult | null>(null);
  const [manualSearch, setManualSearch] = useState("");
  const [manualAssets, setManualAssets] = useState<AssetResult[]>([]);
  const [nuovoTipo, setNuovoTipo] = useState<"BD"|"PM"|"CM">("BD");
  const [nuovoPriorita, setNuovoPriorita] = useState<"Alta"|"Media"|"Bassa">("Alta");
  const [nuovoDesc, setNuovoDesc] = useState("");
  const [saving, setSaving] = useState(false);

  function reset() {
    setStep("listen"); setVoiceTranscript(""); setFoundAssets([]);
    setSelectedAsset(null); setManualSearch(""); setManualAssets([]);
    setNuovoDesc(""); setShowQrScan(false);
  }

  // Back step-aware: torna allo step precedente, non sempre alla home
  function handleBack() {
    if (showQrScan) { setShowQrScan(false); return; }
    if (step === "form") {
      setSelectedAsset(null);
      setStep(foundAssets.length > 0 ? "confirm_asset" : "listen");
      return;
    }
    if (step === "confirm_asset") { setStep("listen"); setFoundAssets([]); setVoiceTranscript(""); return; }
    router.push("/m");
  }

  async function handleVoiceTranscript(text: string) {
    setVoiceTranscript(text);
    // Cerca prima con il testo completo
    const assets = await searchAssetsByQuery(text);
    // Se non trova nulla, prova ogni parola significativa (>2 caratteri) separatamente
    if (assets.length === 0) {
      const words = text.toLowerCase().split(/\s+/).filter(w => w.length > 2);
      const seen = new Set<number>();
      for (const word of words) {
        const res = await searchAssetsByQuery(word);
        for (const a of res) {
          if (!seen.has(a.id)) { seen.add(a.id); assets.push(a); }
        }
        if (assets.length >= 10) break;
      }
    }
    if (assets.length > 0) {
      setFoundAssets(assets);
      setStep("confirm_asset");
    } else {
      notify.error("Nessun asset trovato. Riprova o cerca manualmente sotto.");
    }
  }

  async function handleManualSearch(q: string) {
    setManualSearch(q);
    if (q.length < 2) { setManualAssets([]); return; }
    const assets = await searchAssetsByQuery(q);
    setManualAssets(assets ?? []);
  }

  async function handleQrScan(value: string) {
    let assets: AssetResult[] = [];

    // 1. Prova a parsare come URL → cerca per token /check/{token} o /assets/{id}
    try {
      const url = new URL(value);
      const parts = url.pathname.split("/").filter(Boolean);
      // Pattern: /check/{token}
      if (parts[0] === "check" && parts[1]) {
        try {
          const data = await apiGet<{ asset_id?: number } | null>(`/check/public/${parts[1]}`);
          if (data?.asset_id) {
            const asset = await apiGet<AssetResult>(`/assets/${data.asset_id}`);
            if (asset) assets = [asset];
          }
        } catch { /* ignore */ }
      }
      // Pattern: /assets/{id}
      if (assets.length === 0) {
        const ai = parts.indexOf("assets");
        if (ai !== -1 && parts[ai + 1] && /^\d+$/.test(parts[ai + 1])) {
          try {
            const asset = await apiGet<AssetResult>(`/assets/${parts[ai + 1]}`);
            if (asset) assets = [asset];
          } catch { /* ignore */ }
        }
      }
      // Ultimo segmento come query
      if (assets.length === 0) {
        const last = parts[parts.length - 1];
        if (last) assets = await searchAssetsByQuery(last);
      }
    } catch {
      // Non è un URL — cerca direttamente
    }

    // 2. Ricerca testo completo
    if (assets.length === 0) {
      assets = await searchAssetsByQuery(value);
    }

    // 3. Prova come ID numerico
    if (assets.length === 0 && /^\d+$/.test(value.trim())) {
      try {
        const asset = await apiGet<AssetResult>(`/assets/${value.trim()}`);
        if (asset) assets = [asset];
      } catch { /* ignore */ }
    }

    if (assets.length > 0) {
      setFoundAssets(assets);
      setStep("confirm_asset");
    } else {
      notify.error("QR non riconosciuto — nessun asset trovato.", "QR");
    }
  }

  async function saveTicket() {
    if (!selectedAsset) return;
    setSaving(true);
    try {
      await apiPost("/tickets", {
        titolo: `Intervento su ${selectedAsset.name}`,
        asset_id: selectedAsset.id,
        tipo: nuovoTipo,
        priorita: nuovoPriorita,
        descrizione: nuovoDesc || null,
        durata_stimata_ore: 2,
        fascia_oraria: "diurna",
        stato: "Aperto",
      });
      notify.success("Ticket creato!");
      reset();
      router.push("/m/ticket");
    } catch (e) {
      notify.error(e instanceof Error ? e.message : "Errore salvataggio ticket");
    } finally { setSaving(false); }
  }

  return (
    <div className="m-page" style={{ height: "100%", overflow: "hidden" }}>

      {/* QR Scanner per identificazione asset */}
      {showQrScan && (
        <QrScanner
          title="Identifica Asset 📦"
          subtitle="Inquadra il QR code sull'asset da segnalare"
          onScan={async (val) => {
            setShowQrScan(false);
            await handleQrScan(val);
          }}
          onCancel={() => setShowQrScan(false)}
        />
      )}

      {/* Header vista */}
      <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "12px 16px 10px", flexShrink: 0 }}>
        <button className="m-press" aria-label="Indietro" onClick={handleBack} style={circleBtn}>
          <ChevronLeft size={22} strokeWidth={2.2} />
        </button>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{
            fontWeight: 800, fontSize: "clamp(18px, 5vw, 22px)", letterSpacing: "-0.02em",
            color: C.text, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", lineHeight: 1.15,
          }}>Nuovo Ticket</div>
          <div style={{ fontSize: 12, color: C.text3, fontWeight: 600, marginTop: 1 }}>Segnala un guasto in pochi secondi</div>
        </div>
        <button className="m-press" aria-label="Home" onClick={() => { reset(); router.push("/m"); }} style={circleBtn}>
          <Home size={19} strokeWidth={2.1} />
        </button>
      </div>

      <div className="m-scroll" style={{ flex: 1, minHeight: 0, padding: "6px 16px 16px", display: "flex", flexDirection: "column", gap: 16 }}>

        {/* STEP: listen */}
        {step === "listen" && (
          <div className="m-fade-up" style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 16, paddingTop: 4 }}>

            {/* Segmented control metodo input — stile iOS */}
            <div style={{
              display: "flex", gap: 0, background: "rgba(255,255,255,0.06)",
              borderRadius: 14, padding: 3, width: "100%", maxWidth: 520,
              border: `1px solid ${C.border}`,
            }}>
              {([
                { key: "voice" as const, label: "Voce / Testo", OptIcon: Mic },
                { key: "qr" as const,    label: "QR Code",      OptIcon: QrCode },
              ]).map(opt => {
                const active = inputMethod === opt.key;
                return (
                  <button
                    key={opt.key}
                    onClick={() => setInputMethod(opt.key)}
                    style={{
                      flex: 1, padding: "13px 8px", borderRadius: 11, border: "none", cursor: "pointer",
                      fontWeight: 700, fontSize: 15, transition: "background 0.25s, color 0.25s, box-shadow 0.25s",
                      background: active ? "rgba(255,255,255,0.13)" : "transparent",
                      color: active ? C.text : C.text3,
                      boxShadow: active ? "0 2px 10px rgba(0,0,0,0.35)" : "none",
                      display: "flex", alignItems: "center", justifyContent: "center", gap: 7,
                    }}
                  >
                    <opt.OptIcon size={16} strokeWidth={2.2} /> {opt.label}
                  </button>
                );
              })}
            </div>

            {/* ── Modalità VOCE / TESTO ── */}
            {inputMethod === "voice" && (
              <>
                <div style={{ textAlign: "center", color: C.text2, fontSize: 16, lineHeight: 1.5 }}>
                  Premi il microfono e pronuncia<br/>il nome dell&apos;asset da segnalare
                </div>
                <div style={{ width: "100%", maxWidth: 520 }}>
                  <VoiceRecorder onTranscript={handleVoiceTranscript} />
                </div>
                {voiceTranscript && (
                  <div className="m-scale-in" style={{
                    background: `${C.indigo}14`, border: `1px solid ${C.indigo}40`,
                    borderRadius: 14, padding: "12px 16px", width: "100%", maxWidth: 520,
                    color: "#B3B1FF", fontSize: 15,
                  }}>
                    <div style={{ fontSize: 11, color: C.text3, marginBottom: 4, fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase" }}>Trascritto</div>
                    {voiceTranscript}
                  </div>
                )}
                <div style={{ display: "flex", alignItems: "center", gap: 12, width: "100%", maxWidth: 520 }}>
                  <div style={{ flex: 1, height: 1, background: C.border }} />
                  <span style={{ color: C.text3, fontSize: 13, fontWeight: 600 }}>oppure cerca manualmente</span>
                  <div style={{ flex: 1, height: 1, background: C.border }} />
                </div>
                <div style={{ width: "100%", maxWidth: 520, position: "relative" }}>
                  <Search size={18} strokeWidth={2.2} style={{ position: "absolute", left: 15, top: "50%", transform: "translateY(-50%)", color: C.text3, pointerEvents: "none" }} />
                  <input
                    value={manualSearch}
                    onChange={e => handleManualSearch(e.target.value)}
                    placeholder="Cerca asset per nome..."
                    autoComplete="off"
                    style={{
                      width: "100%", boxSizing: "border-box",
                      background: "rgba(255,255,255,0.06)", border: `1px solid ${C.border}`,
                      borderRadius: 14, color: C.text, padding: "15px 16px 15px 44px",
                      fontSize: 16, outline: "none", WebkitAppearance: "none",
                    }}
                  />
                </div>
                {manualAssets.length > 0 && (
                  <div className="m-cols" style={{ width: "100%", maxWidth: 520 }}>
                    {manualAssets.map(a => (
                      <button key={a.id} className="m-press m-scale-in" onClick={() => { setSelectedAsset(a); setStep("form"); }}
                        style={{
                          ...glass, borderRadius: 16, padding: "14px 15px", color: C.text,
                          cursor: "pointer", textAlign: "left",
                          display: "flex", alignItems: "center", gap: 12,
                        }}>
                        <IconBadge Icon={Package} color={C.teal} size={40} iconSize={18} />
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontWeight: 700, fontSize: 15, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{a.name}</div>
                          {a.sito_nome && <div style={{ fontSize: 12, color: C.text3, marginTop: 2 }}>{a.sito_nome}{a.impianto_nome ? ` · ${a.impianto_nome}` : ""}</div>}
                        </div>
                        <ChevronRight size={17} color={C.text3 as string} />
                      </button>
                    ))}
                  </div>
                )}
              </>
            )}

            {/* ── Modalità QR CODE ── */}
            {inputMethod === "qr" && (
              <div className="m-fade-up" style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 18, width: "100%", maxWidth: 520, paddingTop: 4 }}>
                <div style={{ textAlign: "center", color: C.text2, fontSize: 16, lineHeight: 1.5 }}>
                  Scansiona il QR code sull&apos;asset<br/>per identificarlo automaticamente
                </div>
                <button
                  className="m-press"
                  onClick={() => setShowQrScan(true)}
                  style={{
                    width: "100%", padding: "30px 20px", borderRadius: 24,
                    border: `2px dashed ${C.green}55`,
                    background: `${C.green}0a`,
                    color: C.green, cursor: "pointer",
                    display: "flex", flexDirection: "column", alignItems: "center", gap: 14,
                  }}
                >
                  <div style={{
                    width: 88, height: 88, borderRadius: 28,
                    background: `${C.green}16`, border: `1px solid ${C.green}38`,
                    display: "flex", alignItems: "center", justifyContent: "center",
                  }}>
                    <QrCode size={46} strokeWidth={1.6} />
                  </div>
                  <div style={{ textAlign: "center" }}>
                    <div style={{ fontWeight: 800, fontSize: 18, letterSpacing: "0.02em", color: C.text }}>APRI SCANNER QR</div>
                    <div style={{ fontSize: 13, color: C.text3, marginTop: 4 }}>Richiede accesso alla fotocamera</div>
                  </div>
                </button>
                <div style={{ color: C.text3, fontSize: 13, textAlign: "center" }}>
                  Funziona con Chrome, Edge e Safari 17+
                </div>
              </div>
            )}
          </div>
        )}

        {/* STEP: confirm_asset */}
        {step === "confirm_asset" && foundAssets.length > 0 && (
          <div className="m-fade-up" style={{ display: "flex", flexDirection: "column", gap: 12, maxWidth: 640, width: "100%", margin: "0 auto" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <div style={{ flex: 1, height: 1, background: C.border }} />
              <span style={{ fontSize: 13, color: C.text3, whiteSpace: "nowrap", fontWeight: 600 }}>
                {foundAssets.length} asset trovati{voiceTranscript ? ` per “${voiceTranscript}”` : ""}
              </span>
              <div style={{ flex: 1, height: 1, background: C.border }} />
            </div>
            <div style={{ fontSize: 14, color: C.text2, textAlign: "center" }}>
              Tocca l&apos;asset corretto per procedere
            </div>
            <div className="m-cols">
              {foundAssets.map((a, idx) => (
                <button key={a.id} className="m-press m-scale-in" onClick={() => { setSelectedAsset(a); setStep("form"); }}
                  style={{
                    display: "flex", alignItems: "center", gap: 13, padding: "16px 14px",
                    background: idx === 0 ? `${C.green}0d` : C.card,
                    border: `1.5px solid ${idx === 0 ? `${C.green}48` : C.border}`,
                    borderRadius: 18, cursor: "pointer", textAlign: "left",
                    animationDelay: `${Math.min(idx * 0.05, 0.3)}s`,
                  }}>
                  <IconBadge Icon={idx === 0 ? CheckCircle2 : Package} color={idx === 0 ? C.green : (C.text3 as string)} size={44} iconSize={20} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontWeight: 800, fontSize: 16, color: idx === 0 ? "#9FEFB5" : C.text, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{a.name}</div>
                    <div style={{ fontSize: 12, color: C.text3, marginTop: 2 }}>
                      {[a.codice && `Cod. ${a.codice}`, a.sito_nome, a.impianto_nome].filter(Boolean).join(" · ")}
                    </div>
                  </div>
                  <ChevronRight size={19} color={(idx === 0 ? C.green : C.text3) as string} />
                </button>
              ))}
            </div>
            <button className="m-press" onClick={() => { setStep("listen"); setFoundAssets([]); setVoiceTranscript(""); }}
              style={{
                background: "none", border: `1px solid ${C.border}`, borderRadius: 14,
                color: C.text2, fontSize: 14, cursor: "pointer", padding: "13px", marginTop: 2, fontWeight: 600,
                display: "flex", alignItems: "center", justifyContent: "center", gap: 6,
              }}>
              <RefreshCw size={15} strokeWidth={2.2} /> Riprova ricerca
            </button>
          </div>
        )}

        {/* STEP: form */}
        {step === "form" && selectedAsset && (
          <div className="m-fade-up" style={{ display: "flex", flexDirection: "column", gap: 16, maxWidth: 640, width: "100%", margin: "0 auto" }}>
            <div style={{
              background: `${C.indigo}12`, border: `1px solid ${C.indigo}38`,
              borderRadius: 16, padding: "14px 16px",
              display: "flex", alignItems: "center", gap: 12,
            }}>
              <IconBadge Icon={Package} color={C.indigo} size={44} iconSize={20} />
              <div style={{ minWidth: 0 }}>
                <div style={{ fontSize: 11, color: C.text3, marginBottom: 2, fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase" }}>Asset selezionato</div>
                <div style={{ fontWeight: 800, fontSize: 17, color: C.text, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{selectedAsset.name}</div>
              </div>
            </div>

            <div>
              <div style={{ fontSize: 12, color: C.text2, marginBottom: 9, textTransform: "uppercase", letterSpacing: "0.08em", fontWeight: 700 }}>Tipo intervento</div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 9 }}>
                {(["BD","PM","CM"] as const).map(t => {
                  const meta = tipoMeta(t);
                  const active = nuovoTipo === t;
                  return (
                    <button key={t} className="m-press" onClick={() => setNuovoTipo(t)}
                      style={{
                        padding: "15px 6px", borderRadius: 16, fontWeight: 800, fontSize: 14, cursor: "pointer",
                        border: `1.5px solid ${active ? meta.color : C.border}`,
                        transition: "background 0.2s, border-color 0.2s, color 0.2s",
                        background: active ? `${meta.color}1c` : "rgba(255,255,255,0.04)",
                        color: active ? meta.color : C.text3,
                        display: "flex", flexDirection: "column", alignItems: "center", gap: 6,
                      }}>
                      <meta.Icon size={20} strokeWidth={2.1} />
                      {t}
                    </button>
                  );
                })}
              </div>
            </div>

            <div>
              <div style={{ fontSize: 12, color: C.text2, marginBottom: 9, textTransform: "uppercase", letterSpacing: "0.08em", fontWeight: 700 }}>Priorità</div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 9 }}>
                {(["Alta","Media","Bassa"] as const).map(p => {
                  const col = p === "Alta" ? C.red : p === "Media" ? C.orange : (C.text3 as string);
                  const active = nuovoPriorita === p;
                  return (
                    <button key={p} className="m-press" onClick={() => setNuovoPriorita(p)}
                      style={{
                        padding: "15px 6px", borderRadius: 16, fontWeight: 800, fontSize: 14, cursor: "pointer",
                        border: `1.5px solid ${active ? col : C.border}`,
                        transition: "background 0.2s, border-color 0.2s, color 0.2s",
                        background: active ? `${col}1c` : "rgba(255,255,255,0.04)",
                        color: active ? (p === "Bassa" ? C.text2 : col) : C.text3,
                      }}>{p}</button>
                  );
                })}
              </div>
            </div>

            <div>
              <div style={{ fontSize: 12, color: C.text2, marginBottom: 8, textTransform: "uppercase", letterSpacing: "0.08em", fontWeight: 700 }}>Descrizione (opzionale)</div>
              <textarea value={nuovoDesc} onChange={e => setNuovoDesc(e.target.value)} rows={3} placeholder="Note sull'intervento..."
                style={{
                  width: "100%", background: "rgba(255,255,255,0.06)", border: `1px solid ${C.border}`,
                  borderRadius: 14, color: C.text, padding: "14px 15px", fontSize: 16,
                  resize: "none", outline: "none", boxSizing: "border-box", WebkitAppearance: "none",
                }} />
            </div>

            <button className="m-press" onClick={saveTicket} disabled={saving}
              style={{
                padding: "18px", borderRadius: 18, border: "none",
                background: saving ? `${C.indigo}55` : `linear-gradient(135deg, ${C.indigo}, #4644C9)`,
                color: "#fff", fontWeight: 800, fontSize: 17,
                cursor: saving ? "not-allowed" : "pointer",
                boxShadow: `0 10px 30px ${C.indigo}48`,
                display: "flex", alignItems: "center", justifyContent: "center", gap: 8,
              }}>
              <Save size={19} strokeWidth={2.3} />
              {saving ? "Salvataggio..." : "SALVA TICKET"}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
