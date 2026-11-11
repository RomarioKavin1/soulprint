import type { NextConfig } from "next";

const config: NextConfig = {
  transpilePackages: ["@soulprint/proof"],
  serverExternalPackages: ["near-api-js"],
  webpack: (c) => {
    // Workspace packages import siblings with explicit `.ts` extensions.
    c.resolve.extensionAlias = { ".js": [".ts", ".tsx", ".js"], ".ts": [".ts", ".tsx"] };
    return c;
  },
};
export default config;
