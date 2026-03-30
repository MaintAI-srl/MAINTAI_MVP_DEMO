import type { NextConfig } from "next";
import packageJson from "./package.json";

const nextConfig: NextConfig = {
  env: {
    NEXT_PUBLIC_BUILD_DATE: new Date().toISOString().split("T")[0],
    NEXT_PUBLIC_VERSION: packageJson.version,
  },
};

export default nextConfig;
