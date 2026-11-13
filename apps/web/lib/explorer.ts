/**
 * Public block explorer links, so every account, token and block on a page can be checked outside
 * Manmade. The local test chain has no explorer: links render as plain text there.
 */
export type Explorer = { base: string; name: string } | null;

export function explorerFor(network: string, override?: string | null): Explorer {
  if (override) return { base: override.replace(/\/$/, ""), name: "the explorer" };
  if (network === "testnet") return { base: "https://testnet.nearblocks.io", name: "NearBlocks" };
  if (network === "mainnet") return { base: "https://nearblocks.io", name: "NearBlocks" };
  return null;
}

export const accountUrl = (e: Explorer, id: string) => (e ? `${e.base}/address/${encodeURIComponent(id)}` : null);
export const tokenUrl = (e: Explorer, collection: string, tokenId: string) => (e ? `${e.base}/nft-tokens/${encodeURIComponent(collection)}/tokens/${encodeURIComponent(tokenId)}` : null);
export const blockUrl = (e: Explorer, height: number) => (e ? `${e.base}/blocks/${height}` : null);
