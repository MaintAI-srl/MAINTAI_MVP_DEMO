"use client";

/**
 * Visore PDF in realtà mista (WebXR `immersive-ar`), pensato per Meta Quest 3.
 *
 * Obiettivo: il tecnico entra in XR con il passthrough attivo, ha le mani libere
 * sulla macchina e si vede il manuale su un pannello **alla sua sinistra**, leggibile.
 *
 * Due percorsi di rendering, scelti a runtime:
 *
 *  1. **WebXR Layers** (preferito, disponibile sul browser Quest): il PDF diventa un
 *     `XRQuadLayer`. Il compositore campiona la texture alla risoluzione nativa del
 *     display, senza passare dal render target dell'app: è l'unico modo per avere
 *     testo davvero leggibile in un visore. Non serve nemmeno uno shader.
 *  2. **Fallback WebGL** (browser senza il modulo `layers`): quad texturizzato
 *     disegnato a mano nel projection layer. Più sfocato, ma funziona ovunque.
 *
 * Il contenuto della texture è un canvas 2D composto qui: pagina PDF rasterizzata +
 * barra HUD con numero di pagina e comandi.
 */

import type { PdfPageSource } from "./pdfRaster";

// ─────────────────────────────────────────────────────────────────────────────
// Costanti di posizionamento
// ─────────────────────────────────────────────────────────────────────────────

/** Distanza del pannello dagli occhi, in metri. */
const PANEL_DISTANCE_M = 1.05;
/**
 * Rotazione rispetto alla direzione dello sguardo, in gradi.
 *
 * Era 38° a sinistra: sul visore il pannello finiva ai margini del campo visivo
 * (o fuori) e non c'era modo di riportarlo davanti. Ora parte **centrato** e si
 * sposta dove serve con il grip del controller.
 */
const PANEL_YAW_DEG = 0;
/** Distanza minima/massima a cui si può trascinare il pannello, in metri. */
const GRAB_DISTANCE_MIN_M = 0.45;
const GRAB_DISTANCE_MAX_M = 3.0;
/**
 * Margine in metri sulla profondità reale prima di nascondere un frammento.
 * La depth map del visore è a bassa risoluzione e rumorosa sui bordi: senza
 * margine il pannello "sfarfalla" sul contorno della mano.
 */
const OCCLUSION_BIAS_M = 0.05;
/**
 * Ancoraggio del pannello (e di tutta la sovraimpressione, HUD compreso: sono la
 * stessa texture).
 *
 *  - `"testa"` (default): il pannello è agganciato al **viewer space**, quindi si
 *    muove con la testa e resta sempre nello stesso punto del campo visivo, come
 *    un HUD. Non serve aggiornare nulla per frame: è il compositore a bloccarlo
 *    sulla posa della testa, quindi zero latenza e zero jitter anche a 72/90 Hz.
 *  - `"fisso"`: il pannello resta dove è stato piazzato nella stanza (world-locked)
 *    e il tecnico ci gira intorno. È il comportamento della prima versione.
 */
export type XrAnchorMode = "testa" | "fisso";

const DEFAULT_ANCHOR: XrAnchorMode = "testa";
/** Altezza del pannello a zoom 1, in metri (≈ un monitor 27" a un metro). */
const PANEL_HEIGHT_M = 1.15;
/** Il pannello sta leggermente sopra l'orizzonte oculare: si legge senza piegare il collo. */
const PANEL_VERTICAL_OFFSET_M = 0.02;

/**
 * Fattore applicato a `XRQuadLayer.width/height`.
 *
 * La spec descrive width/height come dimensioni in metri, ma diverse implementazioni
 * (incluso il compositore OpenXR sotto il browser Quest) le trattano come **semi**-estensioni.
 * 0.5 è il valore prudente: se sono semi-estensioni il pannello esce esattamente alto
 * `PANEL_HEIGHT_M`, altrimenti esce a metà ed è comunque leggibile e ingrandibile con lo
 * stick. Da ritarare a 1.0 se sul dispositivo il pannello risulta piccolo.
 */
const QUAD_EXTENT_FACTOR = 0.5;

const ZOOM_MIN = 0.55;
const ZOOM_MAX = 2.6;
const ZOOM_STEP = 0.12;

/** Soglia di attivazione dello stick analogico (edge-triggered, niente ripetizione). */
const STICK_THRESHOLD = 0.65;
const STICK_RELEASE = 0.35;

/** Altezza della barra HUD in frazione dell'altezza texture. */
const HUD_HEIGHT_RATIO = 0.052;

// ─────────────────────────────────────────────────────────────────────────────
// Capability detection
// ─────────────────────────────────────────────────────────────────────────────

export type XrCapabilities = {
  secureContext: boolean;
  webxr: boolean;
  immersiveAr: boolean;
  layers: boolean;
  barcodeDetector: boolean;
};

export async function detectXrCapabilities(): Promise<XrCapabilities> {
  const nav = typeof navigator !== "undefined" ? navigator : undefined;
  const xr = nav?.xr;
  const caps: XrCapabilities = {
    secureContext: typeof window !== "undefined" && window.isSecureContext,
    webxr: !!xr,
    immersiveAr: false,
    layers: typeof window !== "undefined" && "XRWebGLBinding" in window,
    barcodeDetector: typeof window !== "undefined" && "BarcodeDetector" in window,
  };
  if (xr) {
    try {
      caps.immersiveAr = await xr.isSessionSupported("immersive-ar");
    } catch {
      caps.immersiveAr = false;
    }
  }
  return caps;
}

// ─────────────────────────────────────────────────────────────────────────────
// Utility matematiche (column-major, convenzione WebGL)
// ─────────────────────────────────────────────────────────────────────────────

type Vec3 = { x: number; y: number; z: number };
type Quat = { x: number; y: number; z: number; w: number };

function yawFromQuaternion(q: DOMPointReadOnly): number {
  return Math.atan2(2 * (q.w * q.y + q.x * q.z), 1 - 2 * (q.y * q.y + q.x * q.x));
}

function quaternionFromYaw(yaw: number): Quat {
  return { x: 0, y: Math.sin(yaw / 2), z: 0, w: Math.cos(yaw / 2) };
}

/**
 * Offset del pannello **nello spazio della testa**: usato tale e quale come
 * transform del quad layer quando l'ancoraggio è `"testa"` (lo spazio di
 * riferimento è già solidale alla testa, quindi l'offset è costante).
 */
const HEAD_YAW_RAD = (PANEL_YAW_DEG * Math.PI) / 180;
const HEAD_OFFSET_POS: Vec3 = {
  x: -Math.sin(HEAD_YAW_RAD) * PANEL_DISTANCE_M,
  y: PANEL_VERTICAL_OFFSET_M,
  z: -Math.cos(HEAD_YAW_RAD) * PANEL_DISTANCE_M,
};
const HEAD_OFFSET_QUAT: Quat = quaternionFromYaw(HEAD_YAW_RAD);

function mat4Multiply(out: Float32Array, a: Float32Array | number[], b: Float32Array | number[]) {
  for (let c = 0; c < 4; c++) {
    for (let r = 0; r < 4; r++) {
      out[c * 4 + r] =
        a[r] * b[c * 4] +
        a[4 + r] * b[c * 4 + 1] +
        a[8 + r] * b[c * 4 + 2] +
        a[12 + r] * b[c * 4 + 3];
    }
  }
}

/** Ruota un vettore per un quaternione (q · v · q⁻¹, forma espansa). */
function rotateByQuat(v: Vec3, q: Quat): Vec3 {
  const ix = q.w * v.x + q.y * v.z - q.z * v.y;
  const iy = q.w * v.y + q.z * v.x - q.x * v.z;
  const iz = q.w * v.z + q.x * v.y - q.y * v.x;
  const iw = -q.x * v.x - q.y * v.y - q.z * v.z;
  return {
    x: ix * q.w + iw * -q.x + iy * -q.z - iz * -q.y,
    y: iy * q.w + iw * -q.y + iz * -q.x - ix * -q.z,
    z: iz * q.w + iw * -q.z + ix * -q.y - iy * -q.x,
  };
}

/** Applica una mat4 (column-major) a un punto. */
function transformPoint(m: Float32Array | number[], p: Vec3): Vec3 {
  return {
    x: m[0] * p.x + m[4] * p.y + m[8] * p.z + m[12],
    y: m[1] * p.x + m[5] * p.y + m[9] * p.z + m[13],
    z: m[2] * p.x + m[6] * p.y + m[10] * p.z + m[14],
  };
}

/** Applica la sola parte rotazionale di una mat4 a una direzione. */
function transformDirection(m: Float32Array | number[], d: Vec3): Vec3 {
  return {
    x: m[0] * d.x + m[4] * d.y + m[8] * d.z,
    y: m[1] * d.x + m[5] * d.y + m[9] * d.z,
    z: m[2] * d.x + m[6] * d.y + m[10] * d.z,
  };
}

/**
 * Yaw che orienta un pannello posto in `panel` verso `target`.
 *
 * Un pannello con `quaternionFromYaw(ψ)` guarda l'osservatore quando si trova
 * nella direzione ψ rispetto a lui, cioè in `(-sin ψ, -cos ψ)`: invertendo,
 * ψ = atan2(target.x − panel.x, target.z − panel.z).
 */
function yawFacing(panel: Vec3, target: Vec3): number {
  return Math.atan2(target.x - panel.x, target.z - panel.z);
}

function composeModelMatrix(out: Float32Array, pos: Vec3, q: Quat, scaleX: number, scaleY: number) {
  const x2 = q.x + q.x, y2 = q.y + q.y, z2 = q.z + q.z;
  const xx = q.x * x2, xy = q.x * y2, xz = q.x * z2;
  const yy = q.y * y2, yz = q.y * z2, zz = q.z * z2;
  const wx = q.w * x2, wy = q.w * y2, wz = q.w * z2;

  out[0] = (1 - (yy + zz)) * scaleX;
  out[1] = (xy + wz) * scaleX;
  out[2] = (xz - wy) * scaleX;
  out[3] = 0;
  out[4] = (xy - wz) * scaleY;
  out[5] = (1 - (xx + zz)) * scaleY;
  out[6] = (yz + wx) * scaleY;
  out[7] = 0;
  out[8] = xz + wy;
  out[9] = yz - wx;
  out[10] = 1 - (xx + yy);
  out[11] = 0;
  out[12] = pos.x;
  out[13] = pos.y;
  out[14] = pos.z;
  out[15] = 1;
}

// ─────────────────────────────────────────────────────────────────────────────
// Viewer
// ─────────────────────────────────────────────────────────────────────────────

export type XrDocument = {
  /** Etichetta mostrata nell'HUD (nome documento + asset). */
  label: string;
  source: PdfPageSource;
};

export type XrViewerStatus = {
  running: boolean;
  mode: "layers" | "webgl" | null;
  page: number;
  pageCount: number;
  label: string;
  zoom: number;
  /** Ancoraggio corrente della sovraimpressione. */
  anchor: XrAnchorMode;
  /** Occlusione attiva: il pannello passa dietro mani e oggetti reali. */
  occlusion: boolean;
  /** Il visore espone la depth map (senza, l'occlusione non è ottenibile). */
  occlusionAvailable: boolean;
  /** Messaggio transitorio mostrato anche nell'HUD (es. "QR riconosciuto"). */
  notice?: string;
};

export type XrViewerCallbacks = {
  onStatus: (status: XrViewerStatus) => void;
  onError: (message: string) => void;
  onEnd: () => void;
};

const VERTEX_SRC = `
attribute vec2 aPos;
uniform mat4 uMvp;
uniform mat4 uModelView;
varying vec2 vUv;
varying vec4 vClip;
varying vec3 vViewPos;
void main() {
  vUv = vec2(aPos.x * 0.5 + 0.5, 0.5 - aPos.y * 0.5);
  vViewPos = (uModelView * vec4(aPos, 0.0, 1.0)).xyz;
  vClip = uMvp * vec4(aPos, 0.0, 1.0);
  gl_Position = vClip;
}`;

/**
 * Fragment shader con occlusione opzionale dalla depth map del visore.
 *
 * `uOcclusion` = 0 disegna il pannello sopra tutto (comportamento di prima).
 * Con 1, la profondità del frammento viene confrontata con la distanza reale
 * misurata dal visore in quel punto: se dietro, il frammento sparisce, così il
 * pannello passa **dietro** mani e oggetti invece di coprirli.
 *
 * Il formato della depth map cambia per dispositivo, quindi la variante viene
 * scelta a compile-time con un #define (vedi buildFragmentSource):
 *  - `luminance-alpha`: intero a 16 bit spezzato su due canali da 8 bit;
 *  - `float32`: metri già pronti nel canale rosso.
 */
function buildFragmentSource(format: XRDepthDataFormat | null): string {
  const decode =
    format === "float32"
      ? "return texture2D(uDepthTex, uv).r * uRawValueToMeters;"
      : `vec2 packed = texture2D(uDepthTex, uv).ra;
  return (packed.x * 255.0 + packed.y * 255.0 * 256.0) * uRawValueToMeters;`;

  return `
precision mediump float;
uniform sampler2D uTex;
uniform sampler2D uDepthTex;
uniform mat4 uDepthUvFromView;
uniform float uRawValueToMeters;
uniform float uOcclusion;
uniform float uDepthBias;
varying vec2 vUv;
varying vec4 vClip;
varying vec3 vViewPos;

float realDepthMeters(vec2 uv) {
  ${decode}
}

void main() {
  if (uOcclusion > 0.5) {
    // Coordinate normalizzate della vista → spazio della depth map.
    vec2 viewUv = (vClip.xy / vClip.w) * 0.5 + 0.5;
    vec2 depthUv = (uDepthUvFromView * vec4(viewUv, 0.0, 1.0)).xy;
    if (depthUv.x >= 0.0 && depthUv.x <= 1.0 && depthUv.y >= 0.0 && depthUv.y <= 1.0) {
      float real = realDepthMeters(depthUv);
      // real == 0 dove il visore non ha una misura: lì non si occlude nulla.
      if (real > 0.0 && -vViewPos.z > real + uDepthBias) discard;
    }
  }
  gl_FragColor = texture2D(uTex, vUv);
}`;
}

export class XrPdfViewer {
  private readonly callbacks: XrViewerCallbacks;

  private session: XRSession | null = null;
  private glCanvas: HTMLCanvasElement | null = null;
  private gl: WebGLRenderingContext | WebGL2RenderingContext | null = null;
  private refSpace: XRReferenceSpace | null = null;
  /** Spazio solidale alla testa: ancoraggio della sovraimpressione in modalità "testa". */
  private viewerSpace: XRReferenceSpace | null = null;

  // Percorso "layers"
  private binding: XRWebGLBinding | null = null;
  private quad: XRQuadLayer | null = null;

  // Percorso WebGL (obbligatorio quando serve l'occlusione: un quad layer è
  // composto dal runtime e non può essere occluso dalla depth map)
  private program: WebGLProgram | null = null;
  private vbo: WebGLBuffer | null = null;
  private texture: WebGLTexture | null = null;
  private uMvp: WebGLUniformLocation | null = null;
  private uModelView: WebGLUniformLocation | null = null;
  private uDepthTex: WebGLUniformLocation | null = null;
  private uDepthUvFromView: WebGLUniformLocation | null = null;
  private uRawValueToMeters: WebGLUniformLocation | null = null;
  private uOcclusionFlag: WebGLUniformLocation | null = null;
  private uDepthBias: WebGLUniformLocation | null = null;
  private readonly modelMatrix = new Float32Array(16);
  private readonly localMatrix = new Float32Array(16);
  private readonly modelViewMatrix = new Float32Array(16);
  private readonly mvpMatrix = new Float32Array(16);
  private readonly viewProjMatrix = new Float32Array(16);

  // Occlusione (WebXR Depth Sensing)
  private occlusionWanted = true;
  private depthSupported = false;
  private depthFormat: XRDepthDataFormat | null = null;
  private depthBinding: XRWebGLBinding | null = null;

  // Contenuto
  private doc: XrDocument | null = null;
  private page = 1;
  private zoom = 1;
  private composeCanvas: HTMLCanvasElement | null = null;
  private composeCtx: CanvasRenderingContext2D | null = null;
  private pageCanvas: HTMLCanvasElement | null = null;
  private textureAspect = 0.707;
  private contentDirty = true;
  private textureDirty = true;
  private notice: string | null = null;
  private noticeUntil = 0;

  // Posizionamento.
  // panelPos/panelQuat sono espressi **nello spazio di ancoraggio**: lo spazio
  // della testa in modalità "testa", il mondo in modalità "fisso". worldPos/
  // worldQuat sono la trasformazione risolta nel mondo, ricalcolata a ogni frame:
  // serve al rendering e al puntamento del controller.
  private anchor: XrAnchorMode = DEFAULT_ANCHOR;
  private placed = false;
  private panelPos: Vec3 = { ...HEAD_OFFSET_POS };
  private panelQuat: Quat = { ...HEAD_OFFSET_QUAT };
  private worldPos: Vec3 = { x: 0, y: 1.5, z: -1 };
  private worldQuat: Quat = { x: 0, y: 0, z: 0, w: 1 };

  // Trascinamento con il controller
  private grab: { source: XRInputSource; distance: number } | null = null;

  // Input
  private readonly stickLatch = new Map<string, { x: boolean; y: boolean }>();
  private readonly buttonLatch = new Map<string, boolean[]>();

  constructor(callbacks: XrViewerCallbacks) {
    this.callbacks = callbacks;
  }

  get isRunning(): boolean {
    return this.session !== null;
  }

  /**
   * Avvia la sessione immersiva.
   *
   * ATTENZIONE: va chiamata **direttamente** dal gesto utente (click), senza `await`
   * intermedi, altrimenti si perde la user activation richiesta da `requestSession`.
   * Per questo il documento va passato già pronto (prima pagina rasterizzata).
   *
   * `doc` può essere `null`: si entra in XR subito, con un pannello di attesa, e
   * il manuale arriva dopo (QR inquadrato in sessione o scelto dalla UI 2D).
   */
  async start(doc: XrDocument | null, initialPage = 1): Promise<void> {
    if (this.session) return;
    const xr = navigator.xr;
    if (!xr) throw new Error("WebXR non disponibile su questo browser.");

    const glCanvas = document.createElement("canvas");
    const gl =
      (glCanvas.getContext("webgl2", { xrCompatible: true, alpha: true, antialias: false }) as WebGL2RenderingContext | null) ??
      (glCanvas.getContext("webgl", { xrCompatible: true, alpha: true, antialias: false }) as WebGLRenderingContext | null);
    if (!gl) throw new Error("WebGL non disponibile: impossibile avviare la modalità XR.");

    // `depth-sensing` serve a far passare il pannello dietro mani e oggetti
    // reali. È opzionale, ma la sua dictionary va comunque passata: la spec
    // impone TypeError se manca.
    //
    // Si chiede solo quando l'occlusione è stata richiesta: se un runtime
    // rifiutasse la sessione per via di questa feature, togliendo la spunta
    // "occlusione" si rientra in XR senza. Un retry qui non sarebbe affidabile —
    // dopo un await la user activation richiesta da requestSession è persa.
    const optionalFeatures = ["local-floor", "hand-tracking", "dom-overlay"];
    if (this.occlusionWanted) {
      optionalFeatures.push("depth-sensing");
    } else {
      // `layers` si chiede **solo** senza occlusione. Con la feature attiva il
      // render state va popolato con i layer del binding, e impostare invece un
      // `baseLayer` (necessario per disegnare col nostro shader) fa fallire la
      // sessione sul browser del Quest. Le due strade sono alternative: o quad
      // layer composto dal runtime, o projection layer con occlusione.
      optionalFeatures.push("layers");
    }

    const init: XRSessionInit = { optionalFeatures };
    if (this.occlusionWanted) {
      init.depthSensing = {
        usagePreference: ["gpu-optimized"],
        dataFormatPreference: ["luminance-alpha", "float32"],
      };
    }

    const session = await xr.requestSession("immersive-ar", init);

    this.session = session;
    this.glCanvas = glCanvas;
    this.gl = gl;
    this.doc = doc;
    this.page = doc ? Math.min(Math.max(1, initialPage), doc.source.pageCount) : 1;
    this.placed = false;
    this.contentDirty = true;
    this.textureDirty = true;

    session.addEventListener("end", this.handleSessionEnd);
    session.addEventListener("select", this.handleSelect);
    session.addEventListener("squeezestart", this.handleSqueezeStart);
    session.addEventListener("squeezeend", this.handleSqueezeEnd);

    // Depth sensing: disponibile solo se il runtime ha davvero concesso la feature.
    this.depthSupported =
      session.enabledFeatures?.includes("depth-sensing") === true &&
      session.depthUsage === "gpu-optimized";
    this.depthFormat = this.depthSupported ? session.depthDataFormat ?? null : null;

    try {
      await gl.makeXRCompatible();

      this.refSpace =
        (await session.requestReferenceSpace("local-floor").catch(() => null)) ??
        (await session.requestReferenceSpace("local"));
      // "viewer" è garantito dalla spec in ogni sessione: è lo spazio della testa.
      this.viewerSpace = await session.requestReferenceSpace("viewer").catch(() => null);
      if (!this.viewerSpace && this.anchor === "testa") {
        // Senza viewer space il quad non può essere agganciato alla testa dal
        // compositore; il fallback WebGL sa comunque seguirla per frame.
        this.setNotice("Ancoraggio alla testa non disponibile: pannello fisso");
        this.anchor = "fisso";
      }

      this.pageCanvas = doc ? doc.source.peek(this.page) : null;
      this.prepareComposeCanvas();
      this.compose();
      this.setupRendering(session, gl);

      session.requestAnimationFrame(this.onFrame);
      this.emitStatus();
      if (doc) void this.ensurePage(this.page);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Errore di avvio della sessione XR.";
      await this.stop();
      throw new Error(message);
    }
  }

  async stop(): Promise<void> {
    const session = this.session;
    if (!session) return;
    try {
      await session.end();
    } catch {
      // La sessione può essere già stata chiusa dal sistema (menu del visore).
      this.handleSessionEnd();
    }
  }

  /** Sostituisce il documento mostrato senza uscire dalla sessione (es. nuovo QR). */
  setDocument(doc: XrDocument, notice?: string) {
    this.doc = doc;
    this.page = 1;
    this.pageCanvas = doc.source.peek(1);
    this.contentDirty = true;
    if (notice) this.setNotice(notice);
    void this.ensurePage(1);
    this.emitStatus();
  }

  setPage(page: number) {
    const doc = this.doc;
    if (!doc) return;
    const next = Math.min(Math.max(1, page), doc.source.pageCount);
    if (next === this.page) return;
    this.page = next;
    this.pageCanvas = doc.source.peek(next);
    this.contentDirty = true;
    void this.ensurePage(next);
    this.emitStatus();
  }

  setZoom(zoom: number) {
    const next = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, zoom));
    if (Math.abs(next - this.zoom) < 1e-4) return;
    this.zoom = next;
    this.applyPanelSize();
    this.contentDirty = true;
    this.emitStatus();
  }

  /** Riporta il pannello davanti allo sguardo, alla distanza di default. */
  recenter() {
    this.panelPos = { ...HEAD_OFFSET_POS };
    this.panelQuat = { ...HEAD_OFFSET_QUAT };
    this.placed = false; // in modalità "fisso" viene ripiazzato al frame seguente
    if (this.quad && this.anchor === "testa") {
      this.quad.transform = new XRRigidTransform(this.panelPos, this.panelQuat);
    }
  }

  get occlusionEnabled(): boolean {
    return this.occlusionWanted && this.depthSupported;
  }

  get occlusionAvailable(): boolean {
    return this.depthSupported;
  }

  /**
   * Attiva/disattiva l'occlusione con il mondo reale.
   *
   * Cambia il percorso di rendering (quad layer ↔ projection layer), quindi ha
   * effetto dalla sessione successiva: rifare il setup a sessione viva
   * significherebbe ricreare binding, program e render state a caldo, con il
   * rischio di perdere il frame loop.
   */
  setOcclusion(enabled: boolean) {
    if (enabled === this.occlusionWanted) return;
    this.occlusionWanted = enabled;
    if (this.session) {
      this.setNotice(
        enabled
          ? "Occlusione attiva al prossimo avvio della sessione"
          : "Occlusione disattivata al prossimo avvio della sessione",
      );
    }
    this.emitStatus();
  }

  get anchorMode(): XrAnchorMode {
    return this.anchor;
  }

  /**
   * Cambia ancoraggio della sovraimpressione: `"testa"` la fa muovere con la
   * testa (HUD), `"fisso"` la lascia ferma nella stanza.
   */
  setAnchor(mode: XrAnchorMode) {
    if (mode === this.anchor) return;
    if (mode === "testa" && !this.viewerSpace && this.quad) {
      // Percorso layers senza viewer space: non è agganciabile alla testa.
      this.setNotice("Ancoraggio alla testa non disponibile su questo visore");
      return;
    }
    this.anchor = mode;
    // Le coordinate del pannello sono relative allo spazio di ancoraggio: dopo
    // il cambio non sono più valide. Si riparte dalla posizione di default —
    // davanti allo sguardo — che è l'esito prevedibile per chi preme il tasto.
    this.panelPos = { ...HEAD_OFFSET_POS };
    this.panelQuat = { ...HEAD_OFFSET_QUAT };
    this.placed = false;
    this.grab = null;

    const session = this.session;
    const canvas = this.composeCanvas;
    if (this.binding && session && canvas) {
      this.buildQuadLayer(session, canvas);
    } else {
      // Fallback WebGL: nessun layer da ricostruire, cambia solo il calcolo della
      // matrice per frame. Tornando a "fisso" il pannello si ripiazza davanti.
      this.placed = false;
    }

    this.setNotice(mode === "testa" ? "Pannello agganciato alla testa" : "Pannello fissato nella stanza");
    this.emitStatus();
  }

  toggleAnchor() {
    this.setAnchor(this.anchor === "testa" ? "fisso" : "testa");
  }

  private setNotice(text: string) {
    this.notice = text;
    this.noticeUntil = performance.now() + 4000;
    this.contentDirty = true;
  }

  // ── Rendering setup ────────────────────────────────────────────────────────

  private setupRendering(session: XRSession, gl: WebGLRenderingContext | WebGL2RenderingContext) {
    const canvas = this.composeCanvas;
    if (!canvas) throw new Error("Canvas di composizione non inizializzato.");

    const layersEnabled =
      typeof XRWebGLBinding !== "undefined" &&
      (session.enabledFeatures ? session.enabledFeatures.includes("layers") : true);

    // Compromesso non aggirabile: un XRQuadLayer lo compone il runtime alla
    // risoluzione nativa del display (testo nitido) ma non conosce la depth map,
    // quindi resta sempre sopra al mondo reale. L'occlusione richiede di
    // disegnare il pannello nel projection layer con il nostro shader.
    const useOcclusion = this.occlusionWanted && this.depthSupported;

    if (layersEnabled && !useOcclusion) {
      try {
        const binding = new XRWebGLBinding(session, gl);
        this.binding = binding;
        this.buildQuadLayer(session, canvas);
        return;
      } catch {
        // Nessun supporto reale ai layer: si prosegue col percorso WebGL.
        this.binding = null;
        this.quad = null;
      }
    }

    session.updateRenderState({ baseLayer: new XRWebGLLayer(session, gl) });
    this.setupFallbackProgram(gl);
    if (useOcclusion) {
      try {
        this.depthBinding = new XRWebGLBinding(session, gl);
      } catch {
        this.depthBinding = null;
      }
    }
  }

  /**
   * Crea (o ricrea) il quad layer nello spazio corrispondente all'ancoraggio.
   *
   * Lo `space` di un layer si fissa alla creazione: cambiare ancoraggio significa
   * ricostruire il layer. Succede solo alla pressione di un tasto, quindi il costo
   * è irrilevante e in cambio si evita di inseguire la testa per frame da JS.
   */
  private buildQuadLayer(session: XRSession, canvas: HTMLCanvasElement) {
    const binding = this.binding;
    if (!binding) return;

    const space = this.anchor === "testa" ? this.viewerSpace : this.refSpace;
    if (!space) return;

    const quad = binding.createQuadLayer({
      space,
      viewPixelWidth: canvas.width,
      viewPixelHeight: canvas.height,
      layout: "mono",
      textureType: "texture",
      isStatic: false,
    });
    // Estensione Meta: chiede al compositore il filtraggio ottimizzato per testo
    // (super-sampling). Non è supportata ovunque, quindi resta best-effort.
    try {
      quad.quality = "text-optimized";
    } catch {
      /* proprietà non supportata: si resta sulla qualità di default */
    }

    this.quad = quad;
    if (this.anchor === "testa") {
      // Offset nello spazio della testa (quello corrente, non il default: il
      // pannello può essere già stato spostato). Da qui ci pensa il compositore
      // a tenerlo incollato allo sguardo.
      quad.transform = new XRRigidTransform(this.panelPos, this.panelQuat);
    } else {
      this.placed = false; // verrà piazzato al primo frame con una posa valida
    }
    this.applyPanelSize();
    this.textureDirty = true;
    session.updateRenderState({ layers: [quad] });
  }

  private setupFallbackProgram(gl: WebGLRenderingContext | WebGL2RenderingContext) {
    const compile = (type: number, src: string): WebGLShader => {
      const shader = gl.createShader(type);
      if (!shader) throw new Error("Creazione shader fallita.");
      gl.shaderSource(shader, src);
      gl.compileShader(shader);
      if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
        const log = gl.getShaderInfoLog(shader) ?? "";
        gl.deleteShader(shader);
        throw new Error(`Compilazione shader fallita: ${log}`);
      }
      return shader;
    };

    const program = gl.createProgram();
    if (!program) throw new Error("Creazione program WebGL fallita.");
    const vs = compile(gl.VERTEX_SHADER, VERTEX_SRC);
    const fs = compile(gl.FRAGMENT_SHADER, buildFragmentSource(this.depthFormat));
    gl.attachShader(program, vs);
    gl.attachShader(program, fs);
    gl.bindAttribLocation(program, 0, "aPos");
    gl.linkProgram(program);
    gl.deleteShader(vs);
    gl.deleteShader(fs);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      throw new Error(`Link program WebGL fallito: ${gl.getProgramInfoLog(program) ?? ""}`);
    }

    const vbo = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);

    const texture = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.bindTexture(gl.TEXTURE_2D, null);

    this.program = program;
    this.vbo = vbo;
    this.texture = texture;
    this.uMvp = gl.getUniformLocation(program, "uMvp");
    this.uModelView = gl.getUniformLocation(program, "uModelView");
    this.uDepthTex = gl.getUniformLocation(program, "uDepthTex");
    this.uDepthUvFromView = gl.getUniformLocation(program, "uDepthUvFromView");
    this.uRawValueToMeters = gl.getUniformLocation(program, "uRawValueToMeters");
    this.uOcclusionFlag = gl.getUniformLocation(program, "uOcclusion");
    this.uDepthBias = gl.getUniformLocation(program, "uDepthBias");
  }

  /** Dimensiona il canvas di composizione sull'aspect della pagina PDF. */
  private prepareComposeCanvas() {
    const src = this.pageCanvas;
    const aspect = src ? src.width / src.height : this.textureAspect;
    this.textureAspect = aspect;

    const gl = this.gl;
    const maxTex = gl ? (gl.getParameter(gl.MAX_TEXTURE_SIZE) as number) : 4096;
    const height = Math.min(src?.height ?? 2048, maxTex);
    const width = Math.min(Math.round(height * aspect), maxTex);

    const canvas = document.createElement("canvas");
    canvas.width = Math.max(2, width);
    canvas.height = Math.max(2, height);
    const ctx = canvas.getContext("2d", { alpha: false });
    if (!ctx) throw new Error("Canvas 2D non disponibile per la composizione XR.");
    this.composeCanvas = canvas;
    this.composeCtx = ctx;
  }

  private applyPanelSize() {
    const quad = this.quad;
    if (!quad) return;
    const height = PANEL_HEIGHT_M * this.zoom;
    quad.height = height * QUAD_EXTENT_FACTOR;
    quad.width = height * this.textureAspect * QUAD_EXTENT_FACTOR;
  }

  // ── Composizione della texture ─────────────────────────────────────────────

  private compose() {
    const canvas = this.composeCanvas;
    const ctx = this.composeCtx;
    if (!canvas || !ctx) return;

    ctx.fillStyle = "#0f172a";
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    const src = this.pageCanvas;
    if (src) {
      // "contain": la pagina non viene mai deformata, anche se il PDF ha pagine
      // di formato diverso (frequente nei manuali con tavole in orizzontale).
      const scale = Math.min(canvas.width / src.width, canvas.height / src.height);
      const w = src.width * scale;
      const h = src.height * scale;
      ctx.drawImage(src, (canvas.width - w) / 2, (canvas.height - h) / 2, w, h);
    } else {
      ctx.fillStyle = "#e2e8f0";
      ctx.font = `600 ${Math.round(canvas.height * 0.032)}px system-ui, sans-serif`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      // Senza documento la sessione è stata avviata "a vuoto": si entra subito in
      // XR e il manuale arriva dopo.
      const attesa = this.doc ? "Caricamento pagina…" : "Nessun manuale aperto";
      ctx.fillText(attesa, canvas.width / 2, canvas.height / 2 - canvas.height * 0.03);
      if (!this.doc) {
        ctx.font = `500 ${Math.round(canvas.height * 0.022)}px system-ui, sans-serif`;
        ctx.fillStyle = "rgba(226, 232, 240, 0.72)";
        ctx.fillText(
          "Inquadra il QR della macchina, oppure scegli il documento dalla pagina",
          canvas.width / 2,
          canvas.height / 2 + canvas.height * 0.03,
        );
      }
      ctx.textAlign = "left";
    }

    this.drawHud(ctx, canvas);
    this.contentDirty = false;
    this.textureDirty = true;
  }

  private drawHud(ctx: CanvasRenderingContext2D, canvas: HTMLCanvasElement) {
    const barH = Math.round(canvas.height * HUD_HEIGHT_RATIO);
    const y = canvas.height - barH;
    const pad = Math.round(barH * 0.45);
    const font = Math.round(barH * 0.44);

    ctx.fillStyle = "rgba(10, 15, 30, 0.86)";
    ctx.fillRect(0, y, canvas.width, barH);
    ctx.fillStyle = "#22c55e";
    ctx.fillRect(0, y, Math.round(barH * 0.12), barH);

    ctx.textBaseline = "middle";
    ctx.font = `700 ${font}px system-ui, sans-serif`;
    ctx.fillStyle = "#f8fafc";
    const label = this.doc?.label ?? "Documento";
    ctx.fillText(`${label}  ·  pag. ${this.page}/${this.doc?.source.pageCount ?? 1}`, pad + barH * 0.12, y + barH / 2);

    ctx.font = `500 ${Math.round(font * 0.86)}px system-ui, sans-serif`;
    ctx.fillStyle = "rgba(226, 232, 240, 0.72)";
    ctx.textAlign = "right";
    const hint =
      this.notice && performance.now() < this.noticeUntil
        ? this.notice
        : `Stick ←/→ pagina · ↑/↓ zoom · grip sposta · A/X davanti a te · click stick ${this.anchor === "testa" ? "fissa nella stanza" : "aggancia alla testa"}`;
    ctx.fillText(hint, canvas.width - pad, y + barH / 2);
    ctx.textAlign = "left";
  }

  private async ensurePage(page: number) {
    const doc = this.doc;
    if (!doc) return;
    try {
      const canvas = await doc.source.render(page);
      if (this.doc !== doc || this.page !== page) return;
      this.pageCanvas = canvas;
      this.contentDirty = true;
    } catch (err) {
      this.callbacks.onError(
        err instanceof Error ? err.message : `Impossibile rasterizzare la pagina ${page}.`,
      );
    }
  }

  // ── Frame loop ─────────────────────────────────────────────────────────────

  private onFrame = (_time: DOMHighResTimeStamp, frame: XRFrame) => {
    const session = this.session;
    const gl = this.gl;
    const refSpace = this.refSpace;
    if (!session || !gl || !refSpace) return;

    session.requestAnimationFrame(this.onFrame);

    const pose = frame.getViewerPose(refSpace);
    // In modalità "testa" col percorso layers non c'è niente da piazzare: il quad
    // vive nel viewer space e segue la testa lato compositore.
    if (pose && this.anchor === "fisso" && !this.placed) {
      this.placePanel(pose);
      this.placed = true;
    }

    if (pose) {
      this.updateGrab(frame, pose);
      this.resolveWorldTransform(pose);
    }

    this.pollInput(session);

    if (this.notice && performance.now() >= this.noticeUntil) {
      this.notice = null;
      this.contentDirty = true;
    }
    if (this.contentDirty) this.compose();

    if (this.quad && this.binding) {
      if (this.textureDirty || this.quad.needsRedraw) this.uploadToQuadLayer(frame);
    } else if (pose) {
      this.renderFallback(session, gl, pose);
    }
  };

  /**
   * Trasformazione del pannello nel mondo, ricalcolata a ogni frame.
   *
   * In modalità "testa" il pannello è definito nello spazio della testa, quindi
   * la posizione nel mondo cambia a ogni movimento: serve comunque risolverla,
   * sia per il rendering senza layer sia per capire dove punta il controller.
   */
  private resolveWorldTransform(pose: XRViewerPose) {
    if (this.anchor !== "testa") {
      this.worldPos = this.panelPos;
      this.worldQuat = this.panelQuat;
      return;
    }
    const head = pose.transform;
    this.worldPos = transformPoint(head.matrix, this.panelPos);
    // Il pannello resta verticale: basta comporre gli yaw invece di moltiplicare
    // i quaternioni, e si evita che inclinando la testa il testo vada storto.
    const panelYaw = yawFromQuaternion(this.panelQuat as unknown as DOMPointReadOnly);
    this.worldQuat = quaternionFromYaw(yawFromQuaternion(head.orientation) + panelYaw);
  }

  // ── Trascinamento con il controller ────────────────────────────────────────

  /** Interseca il raggio del controller con il pannello; null se non lo colpisce. */
  private rayHitDistance(origin: Vec3, direction: Vec3): number | null {
    const normal = rotateByQuat({ x: 0, y: 0, z: 1 }, this.worldQuat);
    const denom = normal.x * direction.x + normal.y * direction.y + normal.z * direction.z;
    if (Math.abs(denom) < 1e-5) return null; // raggio parallelo al pannello

    const toPanel = {
      x: this.worldPos.x - origin.x,
      y: this.worldPos.y - origin.y,
      z: this.worldPos.z - origin.z,
    };
    const t = (normal.x * toPanel.x + normal.y * toPanel.y + normal.z * toPanel.z) / denom;
    if (t <= 0) return null; // pannello dietro al controller

    const hit = {
      x: origin.x + direction.x * t,
      y: origin.y + direction.y * t,
      z: origin.z + direction.z * t,
    };
    const local = rotateByQuat(
      { x: hit.x - this.worldPos.x, y: hit.y - this.worldPos.y, z: hit.z - this.worldPos.z },
      { x: -this.worldQuat.x, y: -this.worldQuat.y, z: -this.worldQuat.z, w: this.worldQuat.w },
    );

    const height = PANEL_HEIGHT_M * this.zoom;
    const halfH = height / 2;
    const halfW = (height * this.textureAspect) / 2;
    if (Math.abs(local.x) > halfW || Math.abs(local.y) > halfH) return null;
    return t;
  }

  /** Aggiorna la posizione del pannello mentre è trascinato dal controller. */
  private updateGrab(frame: XRFrame, pose: XRViewerPose) {
    const grab = this.grab;
    const refSpace = this.refSpace;
    if (!grab || !refSpace) return;

    const rayPose = frame.getPose(grab.source.targetRaySpace, refSpace);
    if (!rayPose) return;

    const origin = rayPose.transform.position;
    // Il raggio del target ray space punta lungo -Z.
    const direction = transformDirection(rayPose.transform.matrix, { x: 0, y: 0, z: -1 });

    const world = {
      x: origin.x + direction.x * grab.distance,
      y: origin.y + direction.y * grab.distance,
      z: origin.z + direction.z * grab.distance,
    };
    // Il pannello guarda sempre chi lo sta spostando: trascinandolo di lato
    // resterebbe altrimenti di taglio e illeggibile.
    const headPos = pose.transform.position;
    const worldQuat = quaternionFromYaw(
      yawFacing(world, { x: headPos.x, y: headPos.y, z: headPos.z }),
    );

    this.setWorldTransform(world, worldQuat, pose);
  }

  /** Scrive una trasformazione mondo riportandola nello spazio di ancoraggio. */
  private setWorldTransform(world: Vec3, worldQuat: Quat, pose: XRViewerPose) {
    this.worldPos = world;
    this.worldQuat = worldQuat;

    if (this.anchor === "testa") {
      this.panelPos = transformPoint(pose.transform.inverse.matrix, world);
      this.panelQuat = quaternionFromYaw(
        yawFromQuaternion(worldQuat as unknown as DOMPointReadOnly) -
          yawFromQuaternion(pose.transform.orientation),
      );
      if (this.quad) this.quad.transform = new XRRigidTransform(this.panelPos, this.panelQuat);
    } else {
      this.panelPos = world;
      this.panelQuat = worldQuat;
      this.placed = true;
      if (this.quad) this.quad.transform = new XRRigidTransform(this.panelPos, this.panelQuat);
    }
  }

  private handleSqueezeStart = (event: XRInputSourceEvent) => {
    if (this.grab) return;
    const refSpace = this.refSpace;
    const frame = event.frame;
    if (!refSpace || !frame) return;

    const rayPose = frame.getPose(event.inputSource.targetRaySpace, refSpace);
    if (!rayPose) return;

    const origin = rayPose.transform.position;
    const direction = transformDirection(rayPose.transform.matrix, { x: 0, y: 0, z: -1 });
    const distance = this.rayHitDistance({ x: origin.x, y: origin.y, z: origin.z }, direction);
    if (distance === null) {
      this.setNotice("Punta il pannello e tieni premuto il grip per spostarlo");
      return;
    }

    this.grab = {
      source: event.inputSource,
      distance: Math.min(GRAB_DISTANCE_MAX_M, Math.max(GRAB_DISTANCE_MIN_M, distance)),
    };
    this.setNotice("Pannello agganciato: muovi il controller");
  };

  private handleSqueezeEnd = (event: XRInputSourceEvent) => {
    if (this.grab?.source !== event.inputSource) return;
    this.grab = null;
    this.setNotice("Pannello posizionato");
  };

  private placePanel(pose: XRViewerPose) {
    const p = pose.transform.position;
    const yaw = yawFromQuaternion(pose.transform.orientation);
    const panelYaw = yaw + (PANEL_YAW_DEG * Math.PI) / 180;

    this.panelPos = {
      x: p.x - Math.sin(panelYaw) * PANEL_DISTANCE_M,
      y: p.y + PANEL_VERTICAL_OFFSET_M,
      z: p.z - Math.cos(panelYaw) * PANEL_DISTANCE_M,
    };
    this.panelQuat = quaternionFromYaw(panelYaw);

    if (this.quad) {
      this.quad.transform = new XRRigidTransform(this.panelPos, this.panelQuat);
      this.applyPanelSize();
    }
  }

  private uploadToQuadLayer(frame: XRFrame) {
    const gl = this.gl;
    const binding = this.binding;
    const quad = this.quad;
    const canvas = this.composeCanvas;
    if (!gl || !binding || !quad || !canvas) return;

    const sub = binding.getSubImage(quad, frame);
    gl.bindTexture(gl.TEXTURE_2D, sub.colorTexture);
    // Le texture dei layer seguono la convenzione GL (origine in basso a sinistra),
    // il canvas 2D quella opposta: senza flip il PDF apparirebbe capovolto.
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, gl.RGBA, gl.UNSIGNED_BYTE, canvas);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    gl.bindTexture(gl.TEXTURE_2D, null);
    this.textureDirty = false;
  }

  // Nota: la depth map GPU si chiede al binding con la sola vista
  // (`XRWebGLBinding.getDepthInformation(view)`); l'XRFrame serve solo al
  // percorso CPU, qui non usato.
  private renderFallback(
    session: XRSession,
    gl: WebGLRenderingContext | WebGL2RenderingContext,
    pose: XRViewerPose,
  ) {
    const baseLayer = session.renderState.baseLayer;
    const canvas = this.composeCanvas;
    if (!baseLayer || !canvas || !this.program) return;

    if (this.textureDirty && this.texture) {
      gl.bindTexture(gl.TEXTURE_2D, this.texture);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, canvas);
      gl.bindTexture(gl.TEXTURE_2D, null);
      this.textureDirty = false;
    }

    const height = PANEL_HEIGHT_M * this.zoom;
    const halfW = (height * this.textureAspect) / 2;
    const halfH = height / 2;
    // worldPos/worldQuat sono già risolti per questo frame (anche in modalità
    // "testa", dove derivano dalla posa della testa).
    composeModelMatrix(this.modelMatrix, this.worldPos, this.worldQuat, halfW, halfH);

    gl.bindFramebuffer(gl.FRAMEBUFFER, baseLayer.framebuffer);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    gl.disable(gl.CULL_FACE);
    gl.disable(gl.DEPTH_TEST);
    gl.useProgram(this.program);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.vbo);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.texture);
    gl.uniform1i(this.uDepthTex, 1);
    gl.uniform1f(this.uDepthBias, OCCLUSION_BIAS_M);

    const wantsOcclusion = this.occlusionWanted && this.depthBinding !== null;

    for (const view of pose.views) {
      const viewport = baseLayer.getViewport(view);
      if (!viewport) continue;
      gl.viewport(viewport.x, viewport.y, viewport.width, viewport.height);

      mat4Multiply(this.viewProjMatrix, view.projectionMatrix, view.transform.inverse.matrix);
      mat4Multiply(this.mvpMatrix, this.viewProjMatrix, this.modelMatrix);
      mat4Multiply(this.modelViewMatrix, view.transform.inverse.matrix, this.modelMatrix);
      gl.uniformMatrix4fv(this.uMvp, false, this.mvpMatrix);
      gl.uniformMatrix4fv(this.uModelView, false, this.modelViewMatrix);

      // La depth map è per vista (una per occhio) e va richiesta a ogni frame.
      let depth: XRWebGLDepthInformation | null = null;
      if (wantsOcclusion) {
        try {
          depth = this.depthBinding!.getDepthInformation(view) ?? null;
        } catch {
          depth = null;
        }
      }

      if (depth) {
        gl.activeTexture(gl.TEXTURE1);
        gl.bindTexture(gl.TEXTURE_2D, depth.texture);
        gl.uniformMatrix4fv(this.uDepthUvFromView, false, depth.normDepthBufferFromNormView.matrix);
        gl.uniform1f(this.uRawValueToMeters, depth.rawValueToMeters);
        gl.uniform1f(this.uOcclusionFlag, 1);
        gl.activeTexture(gl.TEXTURE0);
      } else {
        gl.uniform1f(this.uOcclusionFlag, 0);
        // Il sampler resta dichiarato anche senza occlusione: va comunque
        // legato a una texture completa, altrimenti alcuni driver segnalano
        // l'unità incompleta a ogni draw.
        gl.activeTexture(gl.TEXTURE1);
        gl.bindTexture(gl.TEXTURE_2D, this.texture);
        gl.activeTexture(gl.TEXTURE0);
      }

      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    }

    gl.bindTexture(gl.TEXTURE_2D, null);
  }

  // ── Input controller ───────────────────────────────────────────────────────

  private pollInput(session: XRSession) {
    for (const src of session.inputSources) {
      const gp = src.gamepad;
      if (!gp) continue;
      const key = `${src.handedness}-${src.targetRayMode}`;

      // Stick: assi 2/3 sul profilo xr-standard, 0/1 sui gamepad più semplici.
      const ax = gp.axes.length > 2 ? gp.axes[2] : gp.axes[0];
      const ay = gp.axes.length > 3 ? gp.axes[3] : gp.axes[1];
      const latch = this.stickLatch.get(key) ?? { x: false, y: false };

      if (Math.abs(ax ?? 0) > STICK_THRESHOLD) {
        if (!latch.x) {
          latch.x = true;
          this.setPage(this.page + ((ax ?? 0) > 0 ? 1 : -1));
        }
      } else if (Math.abs(ax ?? 0) < STICK_RELEASE) {
        latch.x = false;
      }

      if (Math.abs(ay ?? 0) > STICK_THRESHOLD) {
        if (!latch.y) {
          latch.y = true;
          // Stick in avanti = valore negativo sul profilo xr-standard.
          this.setZoom(this.zoom + ((ay ?? 0) < 0 ? ZOOM_STEP : -ZOOM_STEP));
        }
      } else if (Math.abs(ay ?? 0) < STICK_RELEASE) {
        latch.y = false;
      }
      this.stickLatch.set(key, latch);

      const prev = this.buttonLatch.get(key) ?? [];
      gp.buttons.forEach((button, index) => {
        const wasPressed = prev[index] ?? false;
        if (button.pressed && !wasPressed) this.onButtonDown(index);
        prev[index] = button.pressed;
      });
      this.buttonLatch.set(key, prev);
    }
  }

  private onButtonDown(index: number) {
    switch (index) {
      // L'indice 1 (grip) non pagina più: tenuto premuto trascina il pannello,
      // gestito dagli eventi squeezestart/squeezeend. La pagina precedente resta
      // sullo stick ←.
      case 3: // click dello stick
        this.toggleAnchor();
        break;
      case 4: // A / X
        this.recenter();
        this.setNotice("Pannello riportato davanti a te");
        break;
      case 5: // B / Y
        this.setZoom(1);
        break;
      default:
        break;
    }
  }

  private handleSelect = () => {
    this.setPage(this.page + 1);
  };

  // ── Teardown ───────────────────────────────────────────────────────────────

  private handleSessionEnd = () => {
    const session = this.session;
    if (session) {
      session.removeEventListener("end", this.handleSessionEnd);
      session.removeEventListener("select", this.handleSelect);
      session.removeEventListener("squeezestart", this.handleSqueezeStart);
      session.removeEventListener("squeezeend", this.handleSqueezeEnd);
    }
    const gl = this.gl;
    if (gl) {
      if (this.program) gl.deleteProgram(this.program);
      if (this.vbo) gl.deleteBuffer(this.vbo);
      if (this.texture) gl.deleteTexture(this.texture);
    }
    this.session = null;
    this.gl = null;
    this.glCanvas = null;
    this.binding = null;
    this.quad = null;
    this.program = null;
    this.vbo = null;
    this.texture = null;
    this.refSpace = null;
    this.viewerSpace = null;
    this.depthBinding = null;
    this.depthSupported = false;
    this.depthFormat = null;
    this.grab = null;
    this.stickLatch.clear();
    this.buttonLatch.clear();
    this.emitStatus();
    this.callbacks.onEnd();
  };

  private emitStatus() {
    this.callbacks.onStatus({
      running: this.session !== null,
      mode: this.session === null ? null : this.quad ? "layers" : "webgl",
      page: this.page,
      pageCount: this.doc?.source.pageCount ?? 0,
      label: this.doc?.label ?? "",
      zoom: this.zoom,
      anchor: this.anchor,
      occlusion: this.occlusionEnabled,
      occlusionAvailable: this.depthSupported,
      notice: this.notice ?? undefined,
    });
  }
}
