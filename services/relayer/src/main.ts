/**
 * Relayer entry (NEP-366). `--sandbox`: settings and the relayer account from config/networks.json.
 * Otherwise env: NEAR_RPC_URL, RELAYER_ACCOUNT_ID, RELAYER_SECRET_KEY, SOULPRINT_COLLECTION, CURRENCY_TOKEN.
 */
import { readFileSync } from "node:fs";
import { Account, actions } from "near-api-js";
import { DailyCap } from "./allowlist.ts";
import { buildRelayer } from "./server.ts";

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
const app = await buildRelayer({
  policy: { collection, currencyToken: token },
  cap: new DailyCap(50),
  now: Date.now,
  async submit(sd) {
    const r: any = await relayer.signAndSendTransaction({
      receiverId: sd.delegateAction.senderId,
      actions: [actions.signedDelegate({ delegateAction: sd.delegateAction, signature: sd.signature })],
      waitUntil: "FINAL",
    });
    return { txHash: String(r?.transaction?.hash ?? r?.transaction_outcome?.id ?? "") };
  },
});
await app.listen({ port: Number(env.PORT ?? 8789), host: env.HOST ?? "127.0.0.1" });
console.log(`relayer on :${env.PORT ?? 8789}`);
