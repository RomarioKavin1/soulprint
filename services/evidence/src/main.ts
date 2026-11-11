/**
 * Evidence service entry. Env:
 *   NEAR_RPC_URL, EVIDENCE_ACCOUNT_ID, EVIDENCE_SECRET_KEY (ed25519:…, the A35 sender account),
 *   EVIDENCE_MASTER_KEY (64 hex chars), EVIDENCE_DATA_DIR, EVIDENCE_RECIPIENT (NEP-413), PORT.
 * With `--sandbox`, NEAR settings come from config/networks.json (`sandbox` entry).
 */
import { readFileSync } from "node:fs";
import { Account } from "near-api-js";
import { hex } from "@soulprint/proof";
import { RpcChainReader } from "./chain.ts";
import { NearSender } from "./sender.ts";
import { buildApp } from "./server.ts";

const env = process.env;
let rpc = env.NEAR_RPC_URL, accountId = env.EVIDENCE_ACCOUNT_ID, secret = env.EVIDENCE_SECRET_KEY;
if (process.argv.includes("--sandbox")) {
  const cfg = JSON.parse(readFileSync(new URL("../../../config/networks.json", import.meta.url), "utf8")).sandbox;
  rpc = cfg.rpc_url;
  accountId = cfg.accounts.relayer.account_id; // sandbox: reuse the service account
  secret = cfg.accounts.relayer.secret_key;
}
if (!rpc || !accountId || !secret) throw new Error("NEAR_RPC_URL, EVIDENCE_ACCOUNT_ID and EVIDENCE_SECRET_KEY are required");
const master = env.EVIDENCE_MASTER_KEY ? hex.decode(env.EVIDENCE_MASTER_KEY) : null;
if (!master || master.length !== 32) throw new Error("EVIDENCE_MASTER_KEY must be 64 hex chars");

const app = await buildApp({
  chain: new RpcChainReader(rpc),
  sender: new NearSender(new Account(accountId, rpc, secret as `ed25519:${string}`)),
  dataDir: env.EVIDENCE_DATA_DIR ?? "./data",
  memoryDb: false,
  masterKey: master,
  recipient: env.EVIDENCE_RECIPIENT ?? "soulprint-evidence",
  now: Date.now,
});
await app.listen({ port: Number(env.PORT ?? 8787), host: env.HOST ?? "127.0.0.1" });
