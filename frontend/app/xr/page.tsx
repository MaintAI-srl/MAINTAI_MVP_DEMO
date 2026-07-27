"use client";

/**
 * Prototipo XR — manuale PDF in realtà mista (Meta Quest 3, browser del visore).
 *
 * Flusso: inquadri il QR dell'asset → scegli il PDF → entri in `immersive-ar` e il
 * documento ti compare su un pannello alla tua sinistra, mentre continui a vedere
 * la macchina in passthrough.
 *
 * La scansione avviene prima di entrare in XR (e, se la fotocamera resta accessibile,
 * anche durante la sessione: vedi `lib/liveQrScanner.ts`). Il motivo è nelle note del
 * modulo: l'accesso raw alla camera dentro WebXR sul Quest arriva solo con Horizon OS v77.
 */

import { useCallback, useEffect, useRef, useState, type CSSProperties } from "react";
import { Boxes, Camera, FileText, Glasses, Loader2, RefreshCw, ScanLine, X } from "lucide-react";
import QrScanner from "../components/QrScanner";
import { apiGetBlob } from "../lib/api";
import { notify } from "@/lib/toast";
import { PdfRasterizer } from "./lib/pdfRaster";
import { LiveQrScanner } from "./lib/liveQrScanner";
import {
  detectXrCapabilities,
  XrPdfViewer,
  type XrCapabilities,
  type XrViewerStatus,
} from "./lib/xrPdfViewer";
import {
  fetchPdfDocuments,
  parseQrValue,
  resolveQrTarget,
  type AssetDocumento,
  type ResolvedAsset,
} from "./lib/qrTarget";

type Step = "start" | "documenti" | "pronto";

const PREVIEW_MAX_HEIGHT = 300;

/**
 * `beforeinstallprompt` non è nelle lib DOM standard di TypeScript: è
 * un'estensione Chromium, e il browser del Quest è Chromium.
 */
type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
};

export default function XrPrototipoPage() {
  const [caps, setCaps] = useState<XrCapabilities | null>(null);
  const [step, setStep] = useState<Step>("start");
  const [scanning, setScanning] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [errore, setErrore] = useState<string | null>(null);

  const [asset, setAsset] = useState<ResolvedAsset | null>(null);
  const [documenti, setDocumenti] = useState<AssetDocumento[]>([]);
  const [documentoAttivo, setDocumentoAttivo] = useState<AssetDocumento | null>(null);
  const [pagine, setPagine] = useState(0);

  const [xrStatus, setXrStatus] = useState<XrViewerStatus | null>(null);
  const [scansioneContinua, setScansioneContinua] = useState(true);
  const [occlusione, setOcclusione] = useState(true);
  const [scansioneXrErrore, setScansioneXrErrore] = useState<string | null>(null);
  const [installPrompt, setInstallPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [installata, setInstallata] = useState(false);

  const viewerRef = useRef<XrPdfViewer | null>(null);
  const rasterizerRef = useRef<PdfRasterizer | null>(null);
  const scannerRef = useRef<LiveQrScanner | null>(null);
  const previewRef = useRef<HTMLCanvasElement | null>(null);
  const previewSourceRef = useRef<HTMLCanvasElement | null>(null);

  // ── Capability detection ───────────────────────────────────────────────────
  useEffect(() => {
    let alive = true;
    void detectXrCapabilities().then((c) => {
      if (alive) setCaps(c);
    });
    return () => {
      alive = false;
    };
  }, []);

  // ── Installazione come app del visore ──────────────────────────────────────
  // Sul Quest la pagina si installa come web app a sé (manifest /xr-manifest):
  // parte a tutto schermo direttamente sul visore, senza barra del browser.
  useEffect(() => {
    const lanciataComeApp =
      window.matchMedia("(display-mode: fullscreen)").matches ||
      window.matchMedia("(display-mode: standalone)").matches;
    setInstallata(lanciataComeApp);

    const onPrompt = (event: Event) => {
      event.preventDefault();
      setInstallPrompt(event as BeforeInstallPromptEvent);
    };
    const onInstalled = () => {
      setInstallPrompt(null);
      setInstallata(true);
    };
    window.addEventListener("beforeinstallprompt", onPrompt);
    window.addEventListener("appinstalled", onInstalled);
    return () => {
      window.removeEventListener("beforeinstallprompt", onPrompt);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, []);

  const installaApp = useCallback(async () => {
    const prompt = installPrompt;
    if (!prompt) return;
    setInstallPrompt(null);
    try {
      await prompt.prompt();
      const scelta = await prompt.userChoice;
      if (scelta.outcome === "accepted") setInstallata(true);
    } catch {
      /* l'utente ha chiuso il dialogo di sistema: nessuna azione */
    }
  }, [installPrompt]);

  // ── Cleanup ────────────────────────────────────────────────────────────────
  useEffect(() => {
    return () => {
      scannerRef.current?.stop();
      void viewerRef.current?.stop();
      rasterizerRef.current?.destroy();
    };
  }, []);

  const disegnaAnteprima = useCallback(() => {
    const target = previewRef.current;
    const source = previewSourceRef.current;
    if (!target || !source) return;
    const scale = Math.min(PREVIEW_MAX_HEIGHT / source.height, 1);
    target.width = Math.max(1, Math.round(source.width * scale));
    target.height = Math.max(1, Math.round(source.height * scale));
    const ctx = target.getContext("2d");
    ctx?.drawImage(source, 0, 0, target.width, target.height);
  }, []);

  useEffect(() => {
    if (step === "pronto") disegnaAnteprima();
  }, [step, documentoAttivo, disegnaAnteprima]);

  // ── Risoluzione QR → asset → documenti ─────────────────────────────────────

  const caricaDocumento = useCallback(async (doc: AssetDocumento, assetId: number) => {
    const blob = await apiGetBlob(`/assets/${assetId}/documenti/${doc.id}/file`);
    const buffer = await blob.arrayBuffer();

    const precedente = rasterizerRef.current;
    const rasterizer = await PdfRasterizer.open(buffer);
    const primaPagina = await rasterizer.render(1);
    rasterizer.prefetchAround(1);

    precedente?.destroy();
    rasterizerRef.current = rasterizer;
    previewSourceRef.current = primaPagina;
    setDocumentoAttivo(doc);
    setPagine(rasterizer.pageCount);
    return rasterizer;
  }, []);

  // Riferimento sempre aggiornato all'asset corrente: serve dentro la scansione
  // continua in XR, che vive fuori dal ciclo di render di React.
  const assetRef = useRef<ResolvedAsset | null>(null);
  useEffect(() => {
    assetRef.current = asset;
  }, [asset]);

  const gestisciScansione = useCallback(
    async (valore: string) => {
      setScanning(false);
      setErrore(null);
      setBusy("Risoluzione QR in corso…");
      try {
        const target = parseQrValue(valore);
        if (!target) throw new Error("QR code vuoto o non riconosciuto.");

        const risolto = await resolveQrTarget(target);
        const docs = await fetchPdfDocuments(risolto.id);
        setAsset(risolto);
        setDocumenti(docs);

        if (docs.length === 0) {
          setStep("documenti");
          setErrore("Nessun PDF collegato a questo asset. Caricane uno da Siti & Asset → Documenti.");
          return;
        }
        if (docs.length === 1) {
          setBusy("Preparazione del documento…");
          await caricaDocumento(docs[0], risolto.id);
          setStep("pronto");
          return;
        }
        setStep("documenti");
      } catch (err) {
        setErrore(err instanceof Error ? err.message : "Errore nella lettura del QR.");
        setStep("start");
      } finally {
        setBusy(null);
      }
    },
    [caricaDocumento],
  );

  const scegliDocumento = useCallback(
    async (doc: AssetDocumento) => {
      if (!asset) return;
      setErrore(null);
      setBusy("Preparazione del documento…");
      try {
        await caricaDocumento(doc, asset.id);
        setStep("pronto");
      } catch (err) {
        setErrore(err instanceof Error ? err.message : "Impossibile aprire il PDF.");
      } finally {
        setBusy(null);
      }
    },
    [asset, caricaDocumento],
  );

  // ── Sessione XR ────────────────────────────────────────────────────────────

  const avviaScansioneContinua = useCallback(() => {
    if (!scansioneContinua || !LiveQrScanner.isSupported()) return;
    const scanner = new LiveQrScanner();
    scannerRef.current = scanner;
    void scanner
      .start({
        onDetect: (valore) => {
          void (async () => {
            const viewer = viewerRef.current;
            if (!viewer?.isRunning) return;
            try {
              const target = parseQrValue(valore);
              if (!target) return;
              const risolto = await resolveQrTarget(target);
              if (risolto.id === assetRef.current?.id) return;
              const docs = await fetchPdfDocuments(risolto.id);
              const doc = docs[0];
              if (!doc) return;
              setAsset(risolto);
              setDocumenti(docs);
              const rasterizer = await caricaDocumento(doc, risolto.id);
              viewer.setDocument(
                { label: `${risolto.nome} · ${doc.nome}`, source: rasterizer },
                `Nuovo QR: ${risolto.nome}`,
              );
            } catch {
              /* in XR non c'è UI per l'errore: si resta sul documento corrente */
            }
          })();
        },
      })
      .catch((err: unknown) => {
        // Fotocamera non accessibile durante la sessione: resta valida la scansione 2D.
        // L'esito va detto, altrimenti sembra che la lettura QR "non funzioni"
        // senza che sia chiaro che il visore non concede la fotocamera.
        scannerRef.current = null;
        const nome = err instanceof DOMException ? err.name : "";
        setScansioneXrErrore(
          nome === "NotFoundError" || nome === "OverconstrainedError"
            ? "Il visore non espone la fotocamera alle pagine web: durante la sessione XR non è possibile leggere QR. Scegli il manuale da questa pagina prima di entrare."
            : `Scansione QR in sessione non attiva${nome ? ` (${nome})` : ""}: scegli il manuale da questa pagina.`,
        );
      });
  }, [caricaDocumento, scansioneContinua]);

  /**
   * Entra in XR. Il documento è facoltativo: senza, si entra subito con un
   * pannello di attesa e il manuale arriva dopo (QR in sessione o scelta dalla
   * pagina). È il caso d'uso della web app installata sul visore, che deve
   * portare in realtà mista al primo tocco.
   *
   * La sessione non può partire da sola all'apertura: `requestSession` esige una
   * user activation, quindi resta un tocco sul pulsante.
   */
  const entraInXr = useCallback(() => {
    const rasterizer = rasterizerRef.current;
    const conDocumento = Boolean(rasterizer && asset && documentoAttivo);

    setErrore(null);
    const viewer = new XrPdfViewer({
      onStatus: setXrStatus,
      onError: (message) => setErrore(message),
      onEnd: () => {
        scannerRef.current?.stop();
        scannerRef.current = null;
        viewerRef.current = null;
      },
    });
    viewerRef.current = viewer;
    // Va deciso prima di start(): l'occlusione cambia il percorso di rendering.
    viewer.setOcclusion(occlusione);

    // Nessun await prima di requestSession: la user activation del click va preservata.
    viewer
      .start(
        conDocumento
          ? { label: `${asset!.nome} · ${documentoAttivo!.nome}`, source: rasterizer! }
          : null,
        1,
      )
      .then(() => avviaScansioneContinua())
      .catch((err: unknown) => {
        viewerRef.current = null;
        const message = err instanceof Error ? err.message : "Avvio sessione XR fallito.";
        setErrore(message);
        notify.error(message);
      });
  }, [asset, avviaScansioneContinua, documentoAttivo, occlusione]);

  const esciDaXr = useCallback(() => {
    void viewerRef.current?.stop();
  }, []);

  const ricomincia = useCallback(() => {
    setStep("start");
    setAsset(null);
    setDocumenti([]);
    setDocumentoAttivo(null);
    setErrore(null);
    rasterizerRef.current?.destroy();
    rasterizerRef.current = null;
    previewSourceRef.current = null;
  }, []);

  // ── UI ─────────────────────────────────────────────────────────────────────

  const inSessione = xrStatus?.running === true;
  const xrPronto = caps?.webxr && caps.immersiveAr;

  return (
    <div style={S.page}>
      {scanning && (
        <QrScanner
          onScan={(v) => void gestisciScansione(v)}
          onCancel={() => setScanning(false)}
          title="Scansiona QR asset"
          subtitle="Inquadra la targhetta QR sulla macchina"
        />
      )}

      <header style={S.header}>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <span style={S.iconBadge}>
            <Glasses size={22} />
          </span>
          <div>
            <h1 style={S.title}>Visore XR — Manuale sul campo</h1>
            <p style={S.subtitle}>
              Prototipo · Meta Quest 3 · WebXR <code style={S.code}>immersive-ar</code>
            </p>
          </div>
        </div>
        {step !== "start" && (
          <button onClick={ricomincia} style={S.ghostButton}>
            <RefreshCw size={15} /> Ricomincia
          </button>
        )}
      </header>

      <CapabilityPanel caps={caps} />

      {!installata && (
        <div style={S.installBox}>
          <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
            <Glasses size={16} />
            <strong style={{ fontSize: 13 }}>Installa come app del visore</strong>
          </div>
          <p style={{ margin: "6px 0 0", fontSize: 12, color: "var(--text-muted)", lineHeight: 1.5 }}>
            Installata, MaintAI XR compare nella libreria del Quest con la sua icona e parte a
            tutto schermo direttamente qui, senza la barra del browser.
            {!installPrompt && " Dal browser del visore: menu ⋮ → Installa (o Salva nella libreria)."}
          </p>
          {installPrompt && (
            <button onClick={() => void installaApp()} style={{ ...S.secondaryButton, marginTop: 10 }}>
              Installa MaintAI XR
            </button>
          )}
        </div>
      )}

      {errore && (
        <div style={S.errorBox}>
          <strong>⚠️ {errore}</strong>
        </div>
      )}

      {busy && (
        <div style={S.busyBox}>
          <Loader2 size={16} style={{ animation: "spin 1s linear infinite" }} /> {busy}
        </div>
      )}

      {scansioneXrErrore && (
        <div style={S.warnBox}>
          <Camera size={14} style={{ verticalAlign: "-2px" }} /> {scansioneXrErrore}
        </div>
      )}

      {/* ── Ingresso immediato in XR, senza passare dal QR ── */}
      {!inSessione && xrPronto && (
        <section style={S.enterCard}>
          <button onClick={entraInXr} style={S.primaryButton}>
            <Glasses size={18} /> Entra subito in XR
          </button>
          <p style={{ margin: "10px 0 0", fontSize: 12, color: "var(--text-muted)", lineHeight: 1.5 }}>
            Entri in realtà mista con un pannello vuoto e apri il manuale dopo, inquadrando il QR
            della macchina. Se preferisci sceglierlo prima, usa i passaggi qui sotto.
            {installata && " L'app non può entrare in XR da sola all'avvio: il browser richiede un tocco."}
          </p>
        </section>
      )}

      {/* ── Step 1: scansione ── */}
      {step === "start" && (
        <section style={S.card}>
          <h2 style={S.cardTitle}>1 · Identifica l&apos;asset</h2>
          <p style={S.paragraph}>
            Inquadra il QR code stampato sulla macchina. Sono accettate le etichette QR asset,
            i QR del check di primo livello e il codice asset digitato a mano.
          </p>
          <button onClick={() => setScanning(true)} style={S.primaryButton} disabled={!!busy}>
            <ScanLine size={18} /> Scansiona QR
          </button>
          <ManualInput onSubmit={(v) => void gestisciScansione(v)} disabled={!!busy} />
        </section>
      )}

      {/* ── Step 2: scelta documento ── */}
      {step === "documenti" && (
        <section style={S.card}>
          <h2 style={S.cardTitle}>2 · Scegli il documento</h2>
          <p style={S.paragraph}>
            <Boxes size={14} style={{ verticalAlign: "-2px" }} /> Asset:{" "}
            <strong>{asset?.nome}</strong>
            {asset?.codice ? ` (${asset.codice})` : ""}
          </p>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {documenti.map((doc) => (
              <button
                key={doc.id}
                onClick={() => void scegliDocumento(doc)}
                style={S.docButton}
                disabled={!!busy}
              >
                <FileText size={18} />
                <span style={{ flex: 1, textAlign: "left" }}>
                  <span style={{ display: "block", fontWeight: 700 }}>{doc.nome}</span>
                  <span style={S.docMeta}>
                    {doc.tipo} · {doc.filename}
                  </span>
                </span>
              </button>
            ))}
            {documenti.length === 0 && <p style={S.paragraph}>Nessun PDF disponibile per questo asset.</p>}
          </div>
        </section>
      )}

      {/* ── Step 3: pronto / in sessione ── */}
      {step === "pronto" && (
        <section style={S.card}>
          <h2 style={S.cardTitle}>3 · Entra in modalità XR</h2>
          <p style={S.paragraph}>
            <strong>{asset?.nome}</strong> · {documentoAttivo?.nome} · {pagine} pagine
          </p>

          <div style={S.previewWrap}>
            <canvas ref={previewRef} style={S.previewCanvas} />
            <div style={S.previewCaption}>Anteprima pagina 1 (già rasterizzata per la texture XR)</div>
          </div>

          <label style={S.checkboxRow}>
            <input
              type="checkbox"
              checked={scansioneContinua}
              onChange={(e) => setScansioneContinua(e.target.checked)}
              disabled={inSessione}
            />
            <span>
              <Camera size={14} style={{ verticalAlign: "-2px" }} /> Continua a leggere i QR durante la
              sessione XR (cambia manuale inquadrando un&apos;altra macchina)
            </span>
          </label>

          <label style={S.checkboxRow}>
            <input
              type="checkbox"
              checked={occlusione}
              onChange={(e) => setOcclusione(e.target.checked)}
              disabled={inSessione}
            />
            <span>
              <Glasses size={14} style={{ verticalAlign: "-2px" }} /> Il pannello passa dietro mani e
              oggetti reali (occlusione dalla depth map del visore).
              <span style={{ display: "block", color: "var(--text-muted)", fontSize: 12, marginTop: 3 }}>
                Disattivandola il testo è più nitido: senza occlusione il pannello può usare il
                compositore del visore (WebXR Layers), che campiona la texture alla risoluzione
                nativa del display. Con l&apos;occlusione il disegno passa dal nostro shader.
              </span>
            </span>
          </label>

          {!inSessione ? (
            <button onClick={entraInXr} style={S.primaryButton} disabled={!xrPronto}>
              <Glasses size={18} /> Entra in XR
            </button>
          ) : (
            <div style={S.sessionBox}>
              <div style={{ fontWeight: 800, marginBottom: 6 }}>Sessione XR attiva</div>
              <div style={S.sessionMeta}>
                Pagina {xrStatus?.page}/{xrStatus?.pageCount} · zoom{" "}
                {Math.round((xrStatus?.zoom ?? 1) * 100)}% · rendering{" "}
                <code style={S.code}>{xrStatus?.mode === "layers" ? "WebXR Layers" : "WebGL"}</code>
                {" · sovraimpressione "}
                <code style={S.code}>
                  {xrStatus?.anchor === "fisso" ? "fissa nella stanza" : "segue la testa"}
                </code>
                {" · occlusione "}
                <code style={S.code}>
                  {xrStatus?.occlusion
                    ? "attiva"
                    : xrStatus?.occlusionAvailable
                      ? "disattivata"
                      : "non disponibile"}
                </code>
              </div>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                <button
                  onClick={() => viewerRef.current?.toggleAnchor()}
                  style={S.secondaryButton}
                  title="Click dello stick nel visore"
                >
                  {xrStatus?.anchor === "fisso" ? "Aggancia alla testa" : "Fissa nella stanza"}
                </button>
                <button
                  onClick={() => viewerRef.current?.recenter()}
                  style={S.secondaryButton}
                  title="Tasto A/X nel visore"
                >
                  Riporta davanti
                </button>
                <button onClick={esciDaXr} style={S.dangerButton}>
                  <X size={16} /> Termina sessione
                </button>
              </div>
            </div>
          )}

          {!xrPronto && (
            <p style={S.hint}>
              Questo browser non espone una sessione <code style={S.code}>immersive-ar</code>. Apri
              la pagina dal browser del Meta Quest 3 (o da un browser con emulatore WebXR) per
              avviare il visore.
            </p>
          )}

          <ControlsLegend />
        </section>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Sotto-componenti
// ─────────────────────────────────────────────────────────────────────────────

function CapabilityPanel({ caps }: { caps: XrCapabilities | null }) {
  if (!caps) {
    return (
      <div style={S.capsRow}>
        <Loader2 size={14} style={{ animation: "spin 1s linear infinite" }} /> Rilevamento capacità del
        dispositivo…
      </div>
    );
  }
  const items: { label: string; ok: boolean; nota?: string }[] = [
    { label: "Contesto sicuro (HTTPS)", ok: caps.secureContext },
    { label: "WebXR", ok: caps.webxr },
    { label: "Sessione immersive-ar", ok: caps.immersiveAr },
    { label: "WebXR Layers", ok: caps.layers, nota: "testo nitido; senza layer si usa il fallback WebGL" },
    {
      label: `Decodifica QR (${caps.barcodeDetector ? "nativa" : "jsQR"})`,
      ok: true,
      nota: caps.barcodeDetector
        ? "BarcodeDetector nativo del browser"
        : "il browser non espone BarcodeDetector: si usa il decoder JavaScript jsQR",
    },
  ];
  return (
    <div style={S.capsRow}>
      {items.map((item) => (
        <span key={item.label} style={{ ...S.capChip, ...(item.ok ? S.capOk : S.capKo) }} title={item.nota}>
          {item.ok ? "●" : "○"} {item.label}
        </span>
      ))}
    </div>
  );
}

function ManualInput({ onSubmit, disabled }: { onSubmit: (v: string) => void; disabled: boolean }) {
  const [value, setValue] = useState("");
  return (
    <div style={{ marginTop: 14 }}>
      <div style={S.docMeta}>Oppure inserisci codice o ID asset:</div>
      <div style={{ display: "flex", gap: 8, marginTop: 6 }}>
        <input
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && value.trim()) onSubmit(value.trim());
          }}
          placeholder="Es. POMPA-001 oppure 42"
          style={S.input}
        />
        <button
          onClick={() => value.trim() && onSubmit(value.trim())}
          disabled={disabled || !value.trim()}
          style={S.secondaryButton}
        >
          Apri
        </button>
      </div>
    </div>
  );
}

function ControlsLegend() {
  const rows: [string, string][] = [
    ["Stick ← / →", "pagina precedente / successiva"],
    ["Stick ↑ / ↓", "ingrandisci / rimpicciolisci il pannello"],
    ["Grilletto", "pagina successiva"],
    ["Grip tenuto premuto", "punta il pannello e trascinalo dove vuoi"],
    ["Click dello stick", "aggancia alla testa / fissa nella stanza"],
    ["A / X", "riporta il pannello davanti a te"],
    ["B / Y", "zoom al 100%"],
  ];
  return (
    <div style={S.legend}>
      <div style={{ fontWeight: 800, marginBottom: 8 }}>Comandi controller nel visore</div>
      {rows.map(([key, desc]) => (
        <div key={key} style={S.legendRow}>
          <span style={S.legendKey}>{key}</span>
          <span>{desc}</span>
        </div>
      ))}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Stili (inline, coerenti con le altre pagine full-screen del progetto)
// ─────────────────────────────────────────────────────────────────────────────

const S: Record<string, CSSProperties> = {
  page: {
    minHeight: "100dvh",
    background: "var(--surface-0)",
    color: "var(--text-primary)",
    padding: "24px 20px 48px",
    maxWidth: 860,
    margin: "0 auto",
    display: "flex",
    flexDirection: "column",
    gap: 16,
  },
  header: { display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap" },
  iconBadge: {
    display: "grid",
    placeItems: "center",
    width: 44,
    height: 44,
    borderRadius: 12,
    background: "rgba(61,110,245,0.12)",
    color: "var(--text-accent)",
  },
  title: { fontSize: 22, fontWeight: 800, margin: 0, letterSpacing: "-0.01em" },
  subtitle: { fontSize: 13, color: "var(--text-muted)", margin: "2px 0 0" },
  code: {
    fontFamily: "ui-monospace, SFMono-Regular, monospace",
    fontSize: "0.92em",
    background: "var(--surface-3)",
    padding: "1px 5px",
    borderRadius: 5,
  },
  card: {
    background: "var(--surface-1)",
    border: "1px solid var(--border-default)",
    borderRadius: 14,
    padding: 20,
    display: "flex",
    flexDirection: "column",
    gap: 10,
  },
  cardTitle: { fontSize: 16, fontWeight: 800, margin: 0 },
  paragraph: { fontSize: 14, color: "var(--text-secondary)", margin: 0, lineHeight: 1.5 },
  hint: { fontSize: 13, color: "var(--text-muted)", margin: 0, lineHeight: 1.5 },
  primaryButton: {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    padding: "13px 20px",
    borderRadius: 12,
    border: "none",
    background: "#3d6ef5",
    color: "#fff",
    fontWeight: 800,
    fontSize: 15,
    cursor: "pointer",
  },
  secondaryButton: {
    padding: "10px 16px",
    borderRadius: 10,
    border: "1px solid var(--border-default)",
    background: "var(--surface-3)",
    color: "var(--text-primary)",
    fontWeight: 700,
    cursor: "pointer",
  },
  ghostButton: {
    display: "inline-flex",
    alignItems: "center",
    gap: 6,
    padding: "8px 14px",
    borderRadius: 10,
    border: "1px solid var(--border-default)",
    background: "transparent",
    color: "var(--text-secondary)",
    fontWeight: 700,
    fontSize: 13,
    cursor: "pointer",
  },
  dangerButton: {
    display: "inline-flex",
    alignItems: "center",
    gap: 6,
    marginTop: 10,
    padding: "10px 16px",
    borderRadius: 10,
    border: "1px solid rgba(239,68,68,0.35)",
    background: "rgba(239,68,68,0.10)",
    color: "#ef4444",
    fontWeight: 800,
    cursor: "pointer",
  },
  docButton: {
    display: "flex",
    alignItems: "center",
    gap: 12,
    padding: "12px 14px",
    borderRadius: 12,
    border: "1px solid var(--border-default)",
    background: "var(--surface-3)",
    color: "var(--text-primary)",
    cursor: "pointer",
    fontSize: 14,
  },
  docMeta: { fontSize: 12, color: "var(--text-muted)" },
  input: {
    flex: 1,
    padding: "10px 12px",
    borderRadius: 10,
    border: "1px solid var(--border-default)",
    background: "var(--surface-1)",
    color: "var(--text-primary)",
    fontSize: 14,
  },
  errorBox: {
    padding: "12px 14px",
    borderRadius: 12,
    border: "1px solid rgba(239,68,68,0.3)",
    background: "rgba(239,68,68,0.08)",
    color: "#b91c1c",
    fontSize: 13,
  },
  busyBox: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    padding: "10px 14px",
    borderRadius: 12,
    background: "var(--surface-3)",
    fontSize: 13,
    color: "var(--text-secondary)",
  },
  capsRow: { display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center", fontSize: 12 },
  capChip: { padding: "5px 10px", borderRadius: 99, fontWeight: 700, border: "1px solid transparent" },
  capOk: { background: "rgba(34,197,94,0.12)", color: "#15803d", borderColor: "rgba(34,197,94,0.30)" },
  capKo: { background: "rgba(148,163,184,0.14)", color: "var(--text-muted)", borderColor: "var(--border-default)" },
  previewWrap: {
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    gap: 6,
    padding: 12,
    borderRadius: 12,
    background: "var(--surface-3)",
  },
  previewCanvas: { maxWidth: "100%", borderRadius: 8, boxShadow: "0 6px 24px rgba(15,23,42,0.18)" },
  previewCaption: { fontSize: 11, color: "var(--text-muted)" },
  checkboxRow: { display: "flex", gap: 10, alignItems: "flex-start", fontSize: 13, color: "var(--text-secondary)", lineHeight: 1.45 },
  sessionBox: {
    padding: 14,
    borderRadius: 12,
    border: "1px solid rgba(34,197,94,0.35)",
    background: "rgba(34,197,94,0.08)",
    fontSize: 13,
  },
  sessionMeta: { color: "var(--text-secondary)", fontSize: 12, marginBottom: 10 },
  warnBox: {
    marginTop: 12,
    padding: "12px 14px",
    borderRadius: 12,
    border: "1px solid rgba(245,158,11,0.35)",
    background: "rgba(245,158,11,0.08)",
    color: "var(--text-secondary)",
    fontSize: 13,
    lineHeight: 1.5,
  },
  enterCard: {
    marginTop: 12,
    padding: 16,
    borderRadius: 12,
    border: "1px solid rgba(34,197,94,0.35)",
    background: "rgba(34,197,94,0.08)",
  },
  installBox: {
    marginTop: 12,
    padding: 14,
    borderRadius: 12,
    border: "1px solid rgba(56,189,248,0.30)",
    background: "rgba(56,189,248,0.07)",
    color: "var(--text-secondary)",
  },
  legend: {
    marginTop: 6,
    padding: 14,
    borderRadius: 12,
    background: "var(--surface-3)",
    fontSize: 13,
    color: "var(--text-secondary)",
  },
  legendRow: { display: "flex", gap: 12, padding: "3px 0" },
  legendKey: { minWidth: 120, fontWeight: 700, color: "var(--text-primary)" },
};
