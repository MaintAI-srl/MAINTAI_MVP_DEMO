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
  ]),
]);

export default eslintConfig;
