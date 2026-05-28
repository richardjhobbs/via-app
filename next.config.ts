import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // No `output: 'standalone'` — Vercel deploys serverless functions directly
  // and `standalone` bundles middleware with Node-specific globals
  // (__dirname, require) that the Edge runtime rejects, which is what
  // caused MIDDLEWARE_INVOCATION_FAILED on the first deploy.
  turbopack: {},
  serverExternalPackages: ['agentmail', 'ethers'],
};

export default nextConfig;
