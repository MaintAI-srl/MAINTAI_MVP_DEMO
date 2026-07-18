/**
 * Post-build: forza il meta viewport "app-like" nell'HTML prerenderizzato.
 *
 * Perché serve: Next.js inietta SEMPRE `width=device-width, initial-scale=1`
 * (il default `initialScale: 1` non è disattivabile via `export const viewport`).
 * Con `initial-scale=1` i telefoni con larghezza ideale ampia (~860px)
 * annullano qualsiasi `width=430` → UI minuscola. Alcuni browser mobili
 * ignorano inoltre le modifiche al meta via JS dopo il load, quindi la
 * correzione DEVE essere già nell'HTML servito al primo parse.
 *
 * Questo script riscrive, in tutti gli .html prerenderizzati sotto
 * `.next/server/app`, il contenuto di ogni <meta name="viewport"> in
 * `width=430, viewport-fit=cover` (SENZA initial-scale). `/login` e `/mobile`
 * (entry point del tecnico) sono statici → il primo meta parsato è corretto e
 * la viewport impostata al load persiste per l'intera sessione SPA.
 * I browser desktop ignorano del tutto il meta viewport → desktop invariato;
 * `ViewportController` rilassa a runtime landscape/tablet dove serve.
 *
 * Idempotente e non bloccante: se la cartella non esiste (es. build desktop
 * `output: export`) o non trova match, esce senza errori.
 */
import { readFileSync, writeFileSync, existsSync, readdirSync, statSync } from "node:fs";
import { resolve, join } from "node:path";

const TARGET_CONTENT = "width=430, viewport-fit=cover";
// Sostituisce SOLO i tag <meta name="viewport"> letterali (non il payload RSC,
// che codifica gli elementi come props e non come HTML letterale).
const VIEWPORT_META_RE = /<meta\s+name="viewport"\s+content="[^"]*"\s*\/?>/gi;

const frontendRoot = process.cwd(); // lo script gira con cwd = frontend
const appDir = resolve(frontendRoot, ".next", "server", "app");

function walkHtml(dir, out) {
  let entries;
  try {
    entries = readdirSync(dir);
  } catch {
    return;
  }
  for (const name of entries) {
    const full = join(dir, name);
    let st;
    try {
      st = statSync(full);
    } catch {
      continue;
    }
    if (st.isDirectory()) walkHtml(full, out);
    else if (name.endsWith(".html")) out.push(full);
  }
}

if (!existsSync(appDir)) {
  console.log(`[patch-viewport] ${appDir} non trovato — skip (build non-web?).`);
  process.exit(0);
}

const files = [];
walkHtml(appDir, files);

let patchedFiles = 0;
let patchedTags = 0;
for (const file of files) {
  let html;
  try {
    html = readFileSync(file, "utf8");
  } catch {
    continue;
  }
  if (!VIEWPORT_META_RE.test(html)) continue;
  VIEWPORT_META_RE.lastIndex = 0;
  let count = 0;
  const next = html.replace(VIEWPORT_META_RE, () => {
    count += 1;
    return `<meta name="viewport" content="${TARGET_CONTENT}"/>`;
  });
  if (next !== html) {
    writeFileSync(file, next, "utf8");
    patchedFiles += 1;
    patchedTags += count;
  }
}

console.log(
  `[patch-viewport] ${patchedTags} meta viewport riscritti in ${patchedFiles}/${files.length} file HTML → "${TARGET_CONTENT}".`
);
