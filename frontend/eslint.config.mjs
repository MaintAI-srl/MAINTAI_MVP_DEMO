import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    ".pytest_cache/**",
    "src-tauri/target/**",
    "src-tauri/gen/**",
    "src-tauri/icons/**",
    "next-env.d.ts",
    // Runtime di pdf.js copiato in public/ da scripts/copy_pdfjs_assets.mjs
    // (gitignorato, codice di terze parti minificato). Senza questo ignore
    // `npm run lint` fallisce su chi ha già lanciato dev o build: in CI passa
    // solo perché il lint gira prima del build, quando la cartella non esiste.
    "public/pdfjs/**",
  ]),
]);

export default eslintConfig;
