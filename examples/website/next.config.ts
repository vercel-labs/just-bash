import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  outputFileTracingIncludes: {
    "/api/agent": ["./app/api/agent/agent-data/**/*"],
  },
};

export default nextConfig;
