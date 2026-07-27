"use client";

/**
 * Scanner QR continuo, attivo anche **durante** la sessione immersiva.
 *
 * Perché non basta lo scanner della UI 2D: dentro `immersive-ar` il browser non
 * consegna più i `requestAnimationFrame` della finestra (li gestisce la sessione XR)
 * e non c'è DOM visibile. Qui si tiene vivo lo stream della fotocamera e si campiona
 * con un `setInterval`, così il tecnico può inquadrare una nuova targhetta senza
 * togliersi il visore e il pannello cambia manuale da solo.
 *
 * Nota sul Quest 3: fino a Horizon OS v76 il browser espone le camere solo via
 * `getUserMedia` (l'accesso raw dentro WebXR — modulo `camera-access` — arriva con
 * v77). Se lo stream non è disponibile la classe fallisce in modo pulito e la UI
 * ripiega sulla scansione fatta prima di entrare in XR.
 *
 * La decodifica passa da `createQrDecoder()`: il browser del Quest non espone
 * `BarcodeDetector`, quindi senza il fallback jsQR qui non veniva letto nulla.
 */

import { createQrDecoder, type QrDecoder } from "../../lib/qrDecode";

const SCAN_INTERVAL_MS = 600;

export type LiveQrScannerEvents = {
  onDetect: (rawValue: string) => void;
  onError?: (message: string) => void;
};

export class LiveQrScanner {
  private stream: MediaStream | null = null;
  private video: HTMLVideoElement | null = null;
  private timer: number | null = null;
  private busy = false;
  private lastValue = "";
  private lastAt = 0;

  private decoder: QrDecoder | null = null;

  /** Serve solo la fotocamera: la decodifica c'è sempre (nativa o jsQR). */
  static isSupported(): boolean {
    return typeof window !== "undefined" && !!navigator.mediaDevices?.getUserMedia;
  }

  get isRunning(): boolean {
    return this.timer !== null;
  }

  async start(events: LiveQrScannerEvents): Promise<void> {
    if (this.timer !== null) return;
    if (!LiveQrScanner.isSupported()) {
      throw new Error("Fotocamera non disponibile: scansione QR continua non attivabile.");
    }

    const decoder = createQrDecoder();
    this.decoder = decoder;
    const stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: { ideal: "environment" }, width: { ideal: 1280 }, height: { ideal: 720 } },
    });

    const video = document.createElement("video");
    video.playsInline = true;
    video.muted = true;
    video.srcObject = stream;
    await video.play().catch(() => { /* alcuni browser rifiutano play() senza layout */ });

    this.stream = stream;
    this.video = video;

    this.timer = window.setInterval(async () => {
      if (this.busy || video.readyState < 2) return;
      this.busy = true;
      try {
        const value = await decoder.detect(video);
        if (value) {
          const now = Date.now();
          // Antirimbalzo: lo stesso QR resta inquadrato per secondi.
          if (value !== this.lastValue || now - this.lastAt > 8000) {
            this.lastValue = value;
            this.lastAt = now;
            events.onDetect(value);
          }
        }
      } catch (err) {
        events.onError?.(err instanceof Error ? err.message : "Errore di decodifica QR.");
      } finally {
        this.busy = false;
      }
    }, SCAN_INTERVAL_MS);
  }

  stop() {
    if (this.timer !== null) {
      window.clearInterval(this.timer);
      this.timer = null;
    }
    this.stream?.getTracks().forEach((track) => track.stop());
    this.stream = null;
    if (this.video) {
      this.video.srcObject = null;
      this.video = null;
    }
    this.decoder = null;
    this.busy = false;
  }
}
