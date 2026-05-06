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

const nextConfig: NextConfig = {
  env: {
    NEXT_PUBLIC_BUILD_DATE: deployVersion.buildDate || new Date().toISOString().split("T")[0],
    NEXT_PUBLIC_VERSION: packageJson.version,
    NEXT_PUBLIC_DEPLOY_VERSION: deployVersion.version || packageJson.version,
    NEXT_PUBLIC_DEPLOY_BUILD_DATE: deployVersion.buildDate || new Date().toISOString(),
    NEXT_PUBLIC_DESKTOP: isDesktop ? "true" : "false",
  },
  eslint: {
    // Warning: This allows production builds to successfully complete even if
    // your project has ESLint errors.
    ignoreDuringBuilds: true,
  },
  typescript: {
    // !! WARN !!
    // Dangerously allow production builds to successfully complete even if
    // your project has type errors.
    // !! WARN !!
    ignoreBuildErrors: true,
  },
  ...(isDesktop && {
    output: "export",
    trailingSlash: true,
    images: { unoptimized: true },
  }),
};

export default nextConfig;
