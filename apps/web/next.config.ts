import type { NextConfig } from "next";

const config: NextConfig = {
  transpilePackages: ["@soulprint/proof"],
  serverExternalPackages: ["near-api-js"],
  // The browser reaches the evidence service same-origin (no CORS); it sees `/pieces/...` paths,
  // which is what NEP-413 auth binds to.
  async rewrites() {
    return [{ source: "/evidence/:path*", destination: `${process.env.EVIDENCE_URL ?? "http://127.0.0.1:8787"}/:path*` }];
  },
  webpack: (c) => {
    // Workspace packages import siblings with explicit `.ts` extensions.
    c.resolve.extensionAlias = { ".js": [".ts", ".tsx", ".js"], ".ts": [".ts", ".tsx"] };
    return c;
  },
};
export default config;
