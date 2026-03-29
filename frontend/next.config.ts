import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  env: {
    // Iniettata automaticamente ad ogni build/dev — non modificare manualmente
    NEXT_PUBLIC_BUILD_DATE: new Date().toISOString().split("T")[0],
  },
};

export default nextConfig;
