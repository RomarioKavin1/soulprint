import { readFileSync } from "node:fs";

/** The live sandbox config written by soulprint-sandbox (scripts/dev-sandbox.sh). */
export function live() {
  const path = process.env.SOULPRINT_CONFIG;
  if (!path || path.includes("fixtures")) return null;
  const c = JSON.parse(readFileSync(path, "utf8")).sandbox;
  const id = (role: string) => c.accounts[role].account_id as string;
  return { c, rpc: c.rpc_url as string, rpcs: (c.rpc_urls ?? [c.rpc_url]) as string[], collection: c.collection as string, artist: id("artist"), client: id("client"), buyer: id("buyer"), shop: id("shop"), arbitrator: id("arbitrator") };
}

/** A view through the same RPC failover the app uses (`rpc` kept for the call sites; all endpoints are tried). */
export async function view(_rpc: string, contract: string, method: string, args: object = {}) {
  return new ChainView(live()!.rpcs).view(contract, method, args as Record<string, unknown>);
}

import { KeySigner } from "../../lib/near.ts";
import { defaultOffer, offerToTerms, type TermsJson } from "../../lib/terms.ts";
import { createPiece } from "../../lib/piece.ts";
import { fundCall } from "../../lib/commission.ts";
import { ChainView } from "../../lib/near.ts";

export function as(role: string) {
  const L = live()!;
  const a = L.c.accounts[role];
  return new KeySigner(a.account_id, a.secret_key, L.rpcs);
}

/** A USDC commission from the demo artist to the demo client, created directly on chain. */
export async function newCommission(price = 25_000_000n, over: Partial<TermsJson> = {}, capturePublicKey = "ed25519:3tJ8GQ9dUuLhHMq4ApmDWaD4fwZ5QBm3QpBk1xqWcEaA") {
  const L = live()!;
  const o = { ...defaultOffer({ now: Date.now(), currency: { Ft: L.c.currency_token }, decimals: 6 }), price, arbitrator: L.arbitrator, fallbackArbitrator: L.c.accounts.fallback_arbitrator.account_id, client: L.client };
  const t = { ...offerToTerms(o), ...over };
  const chain = new ChainView(L.rpcs);
  const { pieceId } = await createPiece(chain, as("artist"), L.collection, { Commission: t }, capturePublicKey);
  return { pieceId, t };
}

export async function fund(pieceId: string, t: TermsJson) {
  const L = live()!;
  const c = fundCall({ piece_id: pieceId, currency: t.currency, price: t.price } as any, t, L.c.currency_token);
  return as("client").call(c.contract, c.method, c.args, { deposit: c.deposit, tgas: c.tgas });
}

export async function deliver(pieceId: string) {
  const h = Buffer.alloc(32, 0xf1).toString("base64");
  return as("artist").call(pieceId, "deliver", { final_file_hash: h, report_hash: h }, { deposit: 10n ** 22n, tgas: 100n });
}
