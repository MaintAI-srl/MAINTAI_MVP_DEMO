/**
 * Elenca le stringhe passate a `t()`/`tr()`/`tn()` che non hanno una voce nel
 * dizionario inglese: in inglese resterebbero in italiano.
 *
 * Uso (dalla cartella frontend):
 *   node scripts/i18n_missing_keys.mjs
 *
 * Un elenco vuoto significa copertura completa. Le voci identiche nelle due
 * lingue (sigle, unità, nomi propri) vanno tenute FUORI dal dizionario: sono
 * "mancanti" per costruzione e il fallback le rende correttamente.
 */
import ts from "typescript";
import fs from "node:fs";
import path from "node:path";

const APP = path.resolve(process.argv[2] ?? "app");
const DICT = path.join(APP, "lib/i18n/dictionary.ts");
const TRANSLATORS = new Set(["t", "tr", "tn", "translate"]);

const files = [];
(function walk(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) { if (!["node_modules", ".next"].includes(e.name)) walk(p); }
    else if (/\.tsx?$/.test(e.name)) files.push(p);
  }
})(APP);

const keys = new Set();
for (const file of files) {
  if (file.startsWith(path.join(APP, "lib/i18n"))) continue;
  const src = ts.createSourceFile(file, fs.readFileSync(file, "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  (function visit(node) {
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && TRANSLATORS.has(node.expression.text)) {
      const arg = node.arguments[0];
      if (arg && (ts.isStringLiteral(arg) || ts.isNoSubstitutionTemplateLiteral(arg))) keys.add(arg.text);
    }
    ts.forEachChild(node, visit);
  })(src);
}

const dict = fs.readFileSync(DICT, "utf8");
const translated = new Set([...dict.matchAll(/^ {2}("(?:[^"\\]|\\.)*"):/gm)].map((m) => JSON.parse(m[1])));
const missing = [...keys].filter((k) => !translated.has(k)).sort((a, b) => a.localeCompare(b, "it"));

console.log(`chiavi=${keys.size} tradotte=${translated.size} senza traduzione=${missing.length}`);
for (const k of missing) console.log("  " + JSON.stringify(k));
