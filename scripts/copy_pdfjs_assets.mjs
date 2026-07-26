/**
 * Copia gli asset runtime di pdf.js in `frontend/public/pdfjs/`.
 *
 * pdf.js ha bisogno di alcune risorse servite come file statici:
 *   - il worker (`pdf.worker.min.mjs`), caricato da `GlobalWorkerOptions.workerSrc`
 *   - le cmaps (PDF con font CJK / encoding non standard)
 *   - gli standard fonts (PDF che non incorporano i font base PostScript)
 *   - i moduli wasm (JBIG2 / JPEG2000: compressioni tipiche dei manuali scansionati)
 *   - i profili ICC (immagini con color space non RGB)
 *
 * Si copiano al build invece di importarli dal bundler: il path resta stabile
 * (`/pdfjs/...`), same-origin, e quindi compatibile con la CSP `worker-src 'self'`
 * definita in `frontend/next.config.ts`.
 *
 * Idempotente: rilanciarlo sovrascrive senza effetti collaterali.
 */
import { cpSync, existsSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(scriptDir, "..");
const frontendDir = join(repoRoot, "frontend");
const pdfjsDir = join(frontendDir, "node_modules", "pdfjs-dist");
const destDir = join(frontendDir, "public", "pdfjs");

if (!existsSync(pdfjsDir)) {
  console.error("[pdfjs] pdfjs-dist non trovato in node_modules — esegui `npm install` in frontend/.");
  process.exit(1);
}

const ENTRIES = [
  { from: join(pdfjsDir, "build", "pdf.worker.min.mjs"), to: join(destDir, "pdf.worker.min.mjs") },
  { from: join(pdfjsDir, "cmaps"), to: join(destDir, "cmaps") },
  { from: join(pdfjsDir, "standard_fonts"), to: join(destDir, "standard_fonts") },
  { from: join(pdfjsDir, "wasm"), to: join(destDir, "wasm") },
  { from: join(pdfjsDir, "iccs"), to: join(destDir, "iccs") },
];

mkdirSync(destDir, { recursive: true });

for (const { from, to } of ENTRIES) {
  if (!existsSync(from)) {
    console.warn(`[pdfjs] sorgente mancante, salto: ${from}`);
    continue;
  }
  cpSync(from, to, { recursive: true });
}

console.log(`[pdfjs] asset copiati in ${destDir}`);
