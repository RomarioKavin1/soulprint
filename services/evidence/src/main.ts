/**
 * Evidence service entry. Env:
 *   NEAR_RPC_URL (or NEAR_RPC_URLS, comma-separated, tried in turn), EVIDENCE_ACCOUNT_ID, EVIDENCE_SECRET_KEY (ed25519:…, the A35 sender account),
 *   EVIDENCE_MASTER_KEY (64 hex chars), EVIDENCE_DATA_DIR, EVIDENCE_RECIPIENT (NEP-413), PORT,
 *   NEAR_NETWORK, SOULPRINT_COLLECTION, EVIDENCE_VERIFIER_SEED (64 hex), EVIDENCE_VERIFIER_KEY_ID.
 * With `--sandbox`, NEAR settings come from config/networks.json (`sandbox` entry).
 */
import { readFileSync } from "node:fs";
import { Account, FailoverRpcProvider, JsonRpcProvider } from "near-api-js";
import { hex } from "@soulprint/proof";
import { RpcChainReader } from "./chain.ts";
import { NearSender } from "./sender.ts";
import { buildApp } from "./server.ts";

const env = process.env;
let rpc = env.NEAR_RPC_URLS ?? env.NEAR_RPC_URL, accountId = env.EVIDENCE_ACCOUNT_ID, secret = env.EVIDENCE_SECRET_KEY;
let network = env.NEAR_NETWORK, collection = env.SOULPRINT_COLLECTION;
let sandboxGovernance: string | undefined;
if (process.argv.includes("--sandbox")) {
  const cfg = JSON.parse(readFileSync(new URL("../../../config/networks.json", import.meta.url), "utf8")).sandbox;
  rpc = cfg.rpc_url;
  accountId = cfg.accounts.relayer.account_id; // sandbox: reuse the service account
  secret = cfg.accounts.relayer.secret_key;
  network = cfg.network_id;
  collection = cfg.collection;
  sandboxGovernance = cfg.accounts.governance?.account_id;
}
if (!network || !collection) throw new Error("NEAR_NETWORK and SOULPRINT_COLLECTION are required");
// A7 verifier key: 32-byte ed25519 seed registered in the collection as key `EVIDENCE_VERIFIER_KEY_ID`.
const verifierSeed = env.EVIDENCE_VERIFIER_SEED ? hex.decode(env.EVIDENCE_VERIFIER_SEED) : null;
if (!verifierSeed || verifierSeed.length !== 32) throw new Error("EVIDENCE_VERIFIER_SEED must be 64 hex chars");
if (!rpc || !accountId || !secret) throw new Error("NEAR_RPC_URL, EVIDENCE_ACCOUNT_ID and EVIDENCE_SECRET_KEY are required");
const master = env.EVIDENCE_MASTER_KEY ? hex.decode(env.EVIDENCE_MASTER_KEY) : null;
if (!master || master.length !== 32) throw new Error("EVIDENCE_MASTER_KEY must be 64 hex chars");

const app = await buildApp({
  chain: new RpcChainReader(rpc),
  sender: (() => {
    const urls = rpc.split(",").map((u) => u.trim()).filter(Boolean);
    const one = (url: string) => new JsonRpcProvider({ url }, { retries: 3, backoff: 2, wait: 500 });
    const provider = urls.length > 1 ? new FailoverRpcProvider(urls.map(one)) : one(urls[0]!);
    return new NearSender(new Account(accountId, provider, secret as `ed25519:${string}`), provider);
  })(),
  dataDir: env.EVIDENCE_DATA_DIR ?? "./data",
  memoryDb: false,
  masterKey: master,
  recipient: env.EVIDENCE_RECIPIENT ?? "soulprint-evidence",
  now: Date.now,
  network,
  collection,
  verifier: { seed: verifierSeed, keyId: Number(env.EVIDENCE_VERIFIER_KEY_ID ?? 1) },
  // Reader notes per account per day: 5 by default; the local demo chain allows more (repeated E2E runs).
  maxNotesPerDay: Number(env.NOTES_PER_DAY ?? (process.argv.includes("--sandbox") ? 1000 : 5)),
  // Who may remove reader notes: NOTES_OPERATORS (comma-separated); on the local chain, the governance account.
  noteOperators: (env.NOTES_OPERATORS ?? sandboxGovernance ?? "").split(",").map((x) => x.trim()).filter(Boolean),
});
await app.listen({ port: Number(env.PORT ?? 8787), host: env.HOST ?? "127.0.0.1" });
