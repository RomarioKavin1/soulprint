import type { NextConfig } from "next";

const config: NextConfig = {
  transpilePackages: ["@soulprint/proof"],
  // no Next.js dev badge over the pages (demo recordings and screenshots)
  devIndicators: false,
  serverExternalPackages: ["near-api-js"],
  // The browser reaches the evidence service same-origin (no CORS); it sees `/pieces/...` paths,
  // which is what NEP-413 auth binds to.
  async rewrites() {
    return [
      { source: "/evidence/:path*", destination: `${process.env.EVIDENCE_URL ?? "http://127.0.0.1:8787"}/:path*` },
      { source: "/indexer/:path*", destination: `${process.env.INDEXER_URL ?? "http://127.0.0.1:8788"}/:path*` },
    ];
  },
  webpack: (c) => {
    // Workspace packages import siblings with explicit `.ts` extensions.
    c.resolve.extensionAlias = { ".js": [".ts", ".tsx", ".js"], ".ts": [".ts", ".tsx"] };
    // Design-review captures land in .impeccable/; rebuilding on them made the dev server read a
    // half-written manifest mid-request ("Unexpected end of JSON input").
    c.watchOptions = { ...c.watchOptions, ignored: ["**/node_modules/**", "**/.git/**", "**/.impeccable/**"] };
    return c;
  },
};
export default config;
