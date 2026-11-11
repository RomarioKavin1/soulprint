/**
 * Indexer entry. `--sandbox`: RPC block source and settings from config/networks.json.
 * Otherwise env: NEAR_RPC_URL, NEARDATA_URL, SOULPRINT_COLLECTION, START_BLOCK, MIN_INCOME_JSON.
 */
import { readFileSync } from "node:fs";
import { buildApi } from "./api.ts";
import { openDb } from "./db.ts";
import { follow } from "./poller.ts";
import { NeardataBlockSource, RpcBlockSource } from "./source.ts";

const env = process.env;
let rpc = env.NEAR_RPC_URL ?? "", collection = env.SOULPRINT_COLLECTION ?? "", start = Number(env.START_BLOCK ?? 0);
let minIncome: Record<string, bigint> = {};
let src;
if (process.argv.includes("--sandbox")) {
  const c = JSON.parse(readFileSync(new URL("../../../config/networks.json", import.meta.url), "utf8")).sandbox;
  rpc = c.rpc_url;
  collection = c.collection;
  start = c.start_block;
  for (const cur of c.currencies ?? []) minIncome[cur.currency === "Near" ? "Near" : cur.currency.Ft] = BigInt(cur.min_income);
  src = new RpcBlockSource(rpc);
} else {
  minIncome = Object.fromEntries(Object.entries(JSON.parse(env.MIN_INCOME_JSON ?? "{}")).map(([k, v]) => [k, BigInt(v as string)]));
  src = new NeardataBlockSource(env.NEARDATA_URL ?? "https://testnet.neardata.xyz", rpc);
}
if (!rpc || !collection) throw new Error("NEAR_RPC_URL and SOULPRINT_COLLECTION are required");
const db = await openDb(env.INDEXER_DATA_DIR ?? undefined);
follow(db, { collection, minIncome }, src, start, (e) => console.error("[indexer]", e));
const app = await buildApi({ db, head: () => src.head() });
await app.listen({ port: Number(env.PORT ?? 8788), host: env.HOST ?? "127.0.0.1" });
console.log(`indexer on :${env.PORT ?? 8788} from block ${start}`);
