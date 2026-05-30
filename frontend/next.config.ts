import type { NextConfig } from "next";
import packageJson from "./package.json";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// DESKTOP_BUILD=true → static export per packaging Tauri
const isDesktop = process.env.DESKTOP_BUILD === "true";

function readDeployVersion() {
  try {
    const raw = readFileSync(join(process.cwd(), "app", "lib", "deploy-version.json"), "utf8");
    return JSON.parse(raw) as { version?: string; buildDate?: string };
  } catch {
    return {};
  }
}

const deployVersion = readDeployVersion();

// SEC-03 — Header di sicurezza (solo build web; il build statico Tauri non supporta headers()).
// La CSP è volutamente permissiva su script/style (Next richiede 'unsafe-inline'/'unsafe-eval'
// per l'hydration). connect-src include API backend e Supabase Storage.
const cspDirectives = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: https:",
  "font-src 'self' data:",
  "connect-src 'self' https://maintai-v3.onrender.com https://*.onrender.com https://*.supabase.co",
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
].join("; ");

const securityHeaders = [
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
  { key: "Content-Security-Policy", value: cspDirectives },
];

const nextConfig = {
  env: {
    NEXT_PUBLIC_BUILD_DATE: deployVersion.buildDate || new Date().toISOString().split("T")[0],
    NEXT_PUBLIC_VERSION: packageJson.version,
    NEXT_PUBLIC_DEPLOY_VERSION: deployVersion.version || packageJson.version,
    NEXT_PUBLIC_DEPLOY_BUILD_DATE: deployVersion.buildDate || new Date().toISOString(),
    NEXT_PUBLIC_DESKTOP: isDesktop ? "true" : "false",
  },
  eslint: {
    // SEC-04: ESLint lasciato NON bloccante nel build — restano ~116 errori lint preesistenti
    // in tutto il frontend, da ripulire in un task separato. Il gate TypeScript (sotto) è invece ATTIVO.
    ignoreDuringBuilds: true,
  },
  typescript: {
    // SEC-04: controlli TypeScript attivi nel build di produzione
    ignoreBuildErrors: false,
  },
} as NextConfig;

if (!isDesktop) {
  // SEC-03 — security header (solo build web; non supportati con output: export)
  nextConfig.headers = async () => [{ source: "/(.*)", headers: securityHeaders }];
}

if (isDesktop) {
  // Static export per packaging Tauri
  nextConfig.output = "export";
  nextConfig.trailingSlash = true;
  nextConfig.images = { unoptimized: true };
}

export default nextConfig;
