/**
 * Relayer entry (NEP-366). `--sandbox`: settings and the relayer account from config/networks.json.
 * Otherwise env: NEAR_RPC_URL, RELAYER_ACCOUNT_ID, RELAYER_SECRET_KEY, SOULPRINT_COLLECTION, CURRENCY_TOKEN.
 */
import { mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { Account, actions } from "near-api-js";
import { DailyCap } from "./allowlist.ts";
import { buildRelayer, type RelayerChain } from "./server.ts";

const env = process.env;
let rpc = env.NEAR_RPC_URL, id = env.RELAYER_ACCOUNT_ID, secret = env.RELAYER_SECRET_KEY, collection = env.SOULPRINT_COLLECTION, token = env.CURRENCY_TOKEN;
if (process.argv.includes("--sandbox")) {
  const c = JSON.parse(readFileSync(new URL("../../../config/networks.json", import.meta.url), "utf8")).sandbox;
  rpc = c.rpc_url;
  id = c.accounts.relayer.account_id;
  secret = c.accounts.relayer.secret_key;
  collection = c.collection;
  token = c.currency_token;
}
if (!rpc || !id || !secret || !collection || !token) throw new Error("relayer settings missing");
const relayer = new Account(id, rpc, secret as `ed25519:${string}`);

async function query(params: Record<string, unknown>): Promise<any> {
  const r = await fetch(rpc!, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: "relayer", method: "query", params: { finality: "final", ...params } }),
  });
  const j: any = await r.json();
  return j.error || j.result?.error ? null : j.result;
}
async function view(account: string, method: string, args: object = {}): Promise<any> {
  const r = await query({ request_type: "call_function", account_id: account, method_name: method, args_base64: Buffer.from(JSON.stringify(args)).toString("base64") });
  return r ? JSON.parse(Buffer.from(r.result).toString()) : null;
}
const chain: RelayerChain = {
  async hasKey(account, publicKey) {
    return !!(await query({ request_type: "view_access_key", account_id: account, public_key: publicKey }));
  },
  async parties(piece) {
    const info = await view(piece, "piece_info");
    if (!info) return null;
    const terms = await view(piece, "terms");
    const proof = await view(piece, "proof_page", { from: 0, limit: 0 });
    return [info.artist, info.owner, terms?.client, terms?.arbitrator, terms?.fallback_arbitrator, ...(proof?.invites ?? [])].filter(Boolean);
  },
};
const dataDir = env.RELAYER_DATA_DIR ?? "./data";
mkdirSync(dataDir, { recursive: true });
const app = await buildRelayer({
  policy: { collection, currencyToken: token },
  chain,
  cap: new DailyCap(50, join(dataDir, "sender-caps.json")),
  // Relayer-wide attached deposits per UTC day, µNEAR (default 1 NEAR).
  budget: new DailyCap(Number(env.RELAYER_DAILY_BUDGET_UNEAR ?? 1_000_000), join(dataDir, "budget.json")),
  now: Date.now,
  async submit(sd) {
    const r: any = await relayer.signAndSendTransaction({
      receiverId: sd.delegateAction.senderId,
      actions: [actions.signedDelegate({ delegateAction: sd.delegateAction, signature: sd.signature })],
      waitUntil: "FINAL",
    });
    // Report the inner call's outcome, not just that a transaction was sent (Plan 3 review I3).
    const failed = [r?.transaction_outcome, ...(r?.receipts_outcome ?? [])].map((o: any) => o?.outcome?.status?.Failure).find(Boolean);
    return { txHash: String(r?.transaction?.hash ?? r?.transaction_outcome?.id ?? ""), ok: !failed, ...(failed ? { failure: JSON.stringify(failed).slice(0, 300) } : {}) };
  },
});
await app.listen({ port: Number(env.PORT ?? 8789), host: env.HOST ?? "127.0.0.1" });
console.log(`relayer on :${env.PORT ?? 8789}`);
