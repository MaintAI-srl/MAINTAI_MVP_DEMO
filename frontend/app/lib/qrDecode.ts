"use client";

/**
 * Decodifica QR con due percorsi, scelti a runtime.
 *
 *  1. **BarcodeDetector** (Shape Detection API) — nativo, accelerato, quando c'è.
 *  2. **jsQR** — decoder JavaScript puro, usato quando il browser non espone
 *     `BarcodeDetector`.
 *
 * Il fallback non è teorico: il **browser del Meta Quest non implementa
 * BarcodeDetector**, quindi sul visore la scansione non funzionava affatto e
 * restava solo l'inserimento manuale del codice asset.
 *
 * jsQR lavora su `ImageData`, quindi il frame video passa da un canvas
 * intermedio ridimensionato: a piena risoluzione la decodifica costa troppo per
 * girare a ogni frame, e oltre ~800 px sul lato lungo non guadagna nulla in
 * capacità di lettura.
 */

import jsQR from "jsqr";

/** Lato lungo del frame passato a jsQR. Compromesso fra costo e portata. */
const JSQR_MAX_SIDE = 800;

export type QrDecodeSource = "barcode-detector" | "jsqr";

export type QrDecoder = {
  /** Percorso effettivamente in uso, per diagnostica in UI. */
  readonly source: QrDecodeSource;
  /** Restituisce il contenuto del primo QR trovato, o null. */
  detect(video: HTMLVideoElement): Promise<string | null>;
};

interface BarcodeDetectorResult {
  rawValue: string;
  format: string;
}

interface BarcodeDetectorInstance {
  detect(image: HTMLVideoElement): Promise<BarcodeDetectorResult[]>;
}

declare global {
  interface Window {
    BarcodeDetector?: new (opts?: { formats?: string[] }) => BarcodeDetectorInstance;
  }
}

function hasBarcodeDetector(): boolean {
  return typeof window !== "undefined" && typeof window.BarcodeDetector === "function";
}

/**
 * La decodifica è sempre disponibile: senza API nativa si usa jsQR. Resta
 * necessaria la fotocamera (`getUserMedia`), che è una condizione a parte.
 */
export function qrDecodingAvailable(): boolean {
  return typeof window !== "undefined";
}

/** Percorso che verrà usato, senza istanziare nulla (per i chip di capacità). */
export function qrDecodeSource(): QrDecodeSource {
  return hasBarcodeDetector() ? "barcode-detector" : "jsqr";
}

class JsQrDecoder implements QrDecoder {
  readonly source: QrDecodeSource = "jsqr";

  private canvas: HTMLCanvasElement | null = null;
  private ctx: CanvasRenderingContext2D | null = null;

  async detect(video: HTMLVideoElement): Promise<string | null> {
    const vw = video.videoWidth;
    const vh = video.videoHeight;
    if (!vw || !vh) return null;

    const scale = Math.min(1, JSQR_MAX_SIDE / Math.max(vw, vh));
    const width = Math.max(1, Math.round(vw * scale));
    const height = Math.max(1, Math.round(vh * scale));

    if (!this.canvas || this.canvas.width !== width || this.canvas.height !== height) {
      const canvas = this.canvas ?? document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      // `willReadFrequently`: si legge il pixel buffer a ogni scansione, senza
      // questo flag i browser tengono il canvas su GPU e ogni getImageData costa
      // un readback.
      this.ctx = canvas.getContext("2d", { willReadFrequently: true });
      this.canvas = canvas;
    }

    const ctx = this.ctx;
    if (!ctx) return null;

    ctx.drawImage(video, 0, 0, width, height);
    const image = ctx.getImageData(0, 0, width, height);
    const result = jsQR(image.data, width, height, { inversionAttempts: "attemptBoth" });
    return result?.data?.trim() || null;
  }
}

class NativeQrDecoder implements QrDecoder {
  readonly source: QrDecodeSource = "barcode-detector";

  constructor(private readonly detector: BarcodeDetectorInstance) {}

  async detect(video: HTMLVideoElement): Promise<string | null> {
    const codes = await this.detector.detect(video);
    return codes[0]?.rawValue?.trim() || null;
  }
}

/**
 * Crea il decoder migliore disponibile. Se `BarcodeDetector` esiste ma il
 * costruttore fallisce (formato non supportato) si ripiega su jsQR.
 */
export function createQrDecoder(): QrDecoder {
  if (hasBarcodeDetector()) {
    try {
      return new NativeQrDecoder(new window.BarcodeDetector!({ formats: ["qr_code"] }));
    } catch {
      /* formato non supportato da questa implementazione: si usa jsQR */
    }
  }
  return new JsQrDecoder();
}
