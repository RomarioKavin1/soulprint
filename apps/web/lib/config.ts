/**
 * Network config, single source: soulprint/config/networks.json (Plan 3 Global Constraints).
 * Server-only reader; `PublicConfig` is what the browser receives. Sandbox entries carry demo
 * account keys (E2E and local demo only); testnet/mainnet entries never do.
 */
import "server-only";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { publicDemoAccounts } from "./demo.ts";

export type NetworkId = "sandbox" | "testnet" | "mainnet";

export interface DemoAccount { role: string; accountId: string; secretKey: string }

export interface PublicConfig {
  network: NetworkId;
  rpcUrl: string;
  /** All RPC endpoints (failover / load spreading); `rpc_urls` in the config, else `[rpc_url]`. */
  rpcUrls: string[];
  collection: string;
  currencyToken: string;
  currencyDecimals: number;
  evidenceUrl: string;
  evidenceRecipient: string;
  /** Sandbox only: people you can sign in as. */
  demoAccounts: DemoAccount[];
  /** Sandbox only: hex seed of the demo capture key the contracts were set up with. */
  captureTestKey: string | null;
}

export function configPath(): string {
  return process.env.SOULPRINT_CONFIG ?? join(process.cwd(), "..", "..", "config", "networks.json");
}

/** Null when the selected network has no entry yet (e.g. the sandbox is not running). */
export function loadConfig(): PublicConfig | null {
  const network = (process.env.SOULPRINT_NETWORK ?? "sandbox") as NetworkId;
  let all: any;
  try {
    all = JSON.parse(readFileSync(configPath(), "utf8"));
  } catch {
    return null;
  }
  const c = all?.[network];
  if (!c) return null;
  const demoAccounts: DemoAccount[] =
    network === "sandbox"
      ? publicDemoAccounts(Object.entries(c.accounts ?? {}).map(([role, a]: [string, any]) => ({ role, accountId: a.account_id, secretKey: a.secret_key })))
      : [];
  return {
    network,
    rpcUrl: c.rpc_url,
    rpcUrls: Array.isArray(c.rpc_urls) && c.rpc_urls.length ? c.rpc_urls : [c.rpc_url],
    collection: c.collection,
    currencyToken: c.currency_token,
    currencyDecimals: c.currency_decimals ?? 6,
    evidenceUrl: process.env.EVIDENCE_URL ?? c.evidence_url ?? "http://127.0.0.1:8787",
    evidenceRecipient: process.env.EVIDENCE_RECIPIENT ?? c.evidence_recipient ?? "soulprint-evidence",
    demoAccounts,
    captureTestKey: network === "sandbox" ? (c.capture_test_key ?? null) : null,
  };
}
