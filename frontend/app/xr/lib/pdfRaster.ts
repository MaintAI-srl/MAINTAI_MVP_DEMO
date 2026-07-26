"use client";

/**
 * Rasterizzazione PDF → canvas, pensata per il visore XR.
 *
 * In XR il PDF non può essere un <iframe>: il compositore lavora su texture, quindi
 * ogni pagina va renderizzata su un canvas e caricata come texture GPU. Qui si
 * incapsula pdf.js (import dinamico, solo lato client) con una cache LRU delle
 * pagine già rasterizzate: rientrare su una pagina appena vista deve essere istantaneo,
 * perché in XR una latenza di rendering si nota molto più che a schermo.
 */

import type { PDFDocumentLoadingTask, PDFDocumentProxy } from "pdfjs-dist";

/** Altezza in pixel della texture di pagina. Compromesso leggibilità / memoria GPU. */
export const PAGE_TEXTURE_HEIGHT = 2400;

/** Numero massimo di pagine tenute in cache (≈ 20 MB l'una alla risoluzione sopra). */
const CACHE_SIZE = 4;

/** Percorso degli asset pdf.js copiati in public/ da `scripts/copy_pdfjs_assets.mjs`. */
const PDFJS_ASSETS = "/pdfjs";

type PdfjsModule = typeof import("pdfjs-dist");

let pdfjsPromise: Promise<PdfjsModule> | null = null;

async function loadPdfjs(): Promise<PdfjsModule> {
  if (!pdfjsPromise) {
    pdfjsPromise = import("pdfjs-dist").then((pdfjs) => {
      pdfjs.GlobalWorkerOptions.workerSrc = `${PDFJS_ASSETS}/pdf.worker.min.mjs`;
      return pdfjs;
    });
  }
  return pdfjsPromise;
}

/**
 * Sorgente di pagine consumata dal viewer XR.
 * `peek` è sincrona di proposito: il frame loop XR non può await-are.
 */
export interface PdfPageSource {
  readonly pageCount: number;
  /** Pagina già rasterizzata, oppure null se va ancora prodotta. */
  peek(page: number): HTMLCanvasElement | null;
  /** Rasterizza la pagina (o la restituisce dalla cache). */
  render(page: number): Promise<HTMLCanvasElement>;
}

export class PdfRasterizer implements PdfPageSource {
  private readonly task: PDFDocumentLoadingTask;
  private readonly doc: PDFDocumentProxy;
  private readonly cache = new Map<number, HTMLCanvasElement>();
  private readonly inFlight = new Map<number, Promise<HTMLCanvasElement>>();
  private destroyed = false;

  readonly pageCount: number;
  /** Rapporto larghezza/altezza della prima pagina — determina la forma del pannello XR. */
  readonly aspectRatio: number;

  private constructor(task: PDFDocumentLoadingTask, doc: PDFDocumentProxy, aspectRatio: number) {
    this.task = task;
    this.doc = doc;
    this.pageCount = doc.numPages;
    this.aspectRatio = aspectRatio;
  }

  static async open(data: ArrayBuffer): Promise<PdfRasterizer> {
    const pdfjs = await loadPdfjs();
    const task = pdfjs.getDocument({
      data: new Uint8Array(data),
      cMapUrl: `${PDFJS_ASSETS}/cmaps/`,
      cMapPacked: true,
      standardFontDataUrl: `${PDFJS_ASSETS}/standard_fonts/`,
      // JBIG2 / JPEG2000: compressioni frequenti nei manuali scansionati.
      wasmUrl: `${PDFJS_ASSETS}/wasm/`,
      iccUrl: `${PDFJS_ASSETS}/iccs/`,
    });
    const doc = await task.promise;

    const first = await doc.getPage(1);
    const viewport = first.getViewport({ scale: 1 });
    const aspectRatio = viewport.width / viewport.height;
    return new PdfRasterizer(task, doc, aspectRatio);
  }

  peek(page: number): HTMLCanvasElement | null {
    return this.cache.get(page) ?? null;
  }

  render(page: number): Promise<HTMLCanvasElement> {
    const cached = this.cache.get(page);
    if (cached) return Promise.resolve(cached);

    const pending = this.inFlight.get(page);
    if (pending) return pending;

    const task = this.rasterize(page)
      .then((canvas) => {
        this.put(page, canvas);
        return canvas;
      })
      .finally(() => {
        this.inFlight.delete(page);
      });

    this.inFlight.set(page, task);
    return task;
  }

  private async rasterize(pageNumber: number): Promise<HTMLCanvasElement> {
    const page = await this.doc.getPage(pageNumber);
    const base = page.getViewport({ scale: 1 });
    const scale = PAGE_TEXTURE_HEIGHT / base.height;
    const viewport = page.getViewport({ scale });

    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(viewport.width));
    canvas.height = Math.max(1, Math.round(viewport.height));

    const ctx = canvas.getContext("2d", { alpha: false });
    if (!ctx) throw new Error("Canvas 2D non disponibile per la rasterizzazione PDF.");
    // Sfondo bianco esplicito: i PDF non disegnano il proprio fondo pagina e in
    // passthrough un fondo trasparente renderebbe il testo illeggibile.
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    await page.render({ canvas, canvasContext: ctx, viewport }).promise;
    page.cleanup();
    return canvas;
  }

  private put(page: number, canvas: HTMLCanvasElement) {
    if (this.destroyed) return;
    this.cache.set(page, canvas);
    while (this.cache.size > CACHE_SIZE) {
      const oldest = this.cache.keys().next();
      if (oldest.done) break;
      this.cache.delete(oldest.value);
    }
  }

  /** Prefetch silenzioso della pagina successiva/precedente. */
  prefetchAround(page: number) {
    for (const n of [page + 1, page - 1]) {
      if (n >= 1 && n <= this.pageCount && !this.cache.has(n)) {
        void this.render(n).catch(() => { /* prefetch best-effort */ });
      }
    }
  }

  destroy() {
    this.destroyed = true;
    this.cache.clear();
    this.inFlight.clear();
    // `destroy()` sta sul loading task: chiude anche il worker, altrimenti ogni
    // documento aperto ne lascerebbe uno vivo (il visore ne apre uno per QR).
    void this.task.destroy();
  }
}
