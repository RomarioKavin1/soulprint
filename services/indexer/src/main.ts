/**
 * Indexer entry. `--sandbox`: RPC block source and settings from config/networks.json.
 * Otherwise env: NEAR_RPC_URL, NEARDATA_URL, SOULPRINT_COLLECTION, START_BLOCK, MIN_INCOME_JSON,
 * BLOCK_SOURCE (txapi | neardata | rpc; default txapi — neardata's free tier serves 30 blocks a
 * minute, half of testnet's rate; rpc is for a local chain, e.g. the deploy dry run), TXAPI_URL
 * (default FastNear's tx API for NEAR_NETWORK: https://tx.test.fastnear.com or https://tx.main.fastnear.com).
 */
import { readFileSync } from "node:fs";
import { buildApi } from "./api.ts";
import { openDb } from "./db.ts";
import { follow } from "./poller.ts";
import { NeardataBlockSource, RpcBlockSource } from "./source.ts";
import { FastnearTxApi, followTxApi } from "./txapi.ts";

const env = process.env;
let rpc = env.NEAR_RPC_URL ?? "", collection = env.SOULPRINT_COLLECTION ?? "", start = Number(env.START_BLOCK ?? 0);
let minIncome: Record<string, bigint> = {};
let src;
let txApi: FastnearTxApi | null = null;
if (process.argv.includes("--sandbox")) {
  const c = JSON.parse(readFileSync(new URL("../../../config/networks.json", import.meta.url), "utf8")).sandbox;
  rpc = c.rpc_url;
  collection = c.collection;
  start = c.start_block;
  for (const cur of c.currencies ?? []) minIncome[cur.currency === "Near" ? "Near" : cur.currency.Ft] = BigInt(cur.min_income);
  src = new RpcBlockSource(rpc);
} else {
  minIncome = Object.fromEntries(Object.entries(JSON.parse(env.MIN_INCOME_JSON ?? "{}")).map(([k, v]) => [k, BigInt(v as string)]));
  const mode = env.BLOCK_SOURCE ?? "txapi";
  src = mode === "rpc" ? new RpcBlockSource(rpc) : mode === "neardata" ? new NeardataBlockSource(env.NEARDATA_URL ?? "https://testnet.neardata.xyz", rpc) : new RpcBlockSource(rpc);
  if (mode === "txapi")
    txApi = new FastnearTxApi(env.TXAPI_URL ?? (env.NEAR_NETWORK === "mainnet" ? "https://tx.main.fastnear.com" : "https://tx.test.fastnear.com"), (m) => console.error("[indexer]", m));
}
if (!rpc || !collection) throw new Error("NEAR_RPC_URL and SOULPRINT_COLLECTION are required");
const db = await openDb(env.INDEXER_DATA_DIR ?? undefined);
if (txApi) followTxApi(db, { collection, minIncome }, txApi, () => src.head(), (e) => console.error("[indexer]", e));
else follow(db, { collection, minIncome }, src, start, (e) => console.error("[indexer]", e));
const app = await buildApi({ db, head: () => src.head() });
await app.listen({ port: Number(env.PORT ?? 8788), host: env.HOST ?? "127.0.0.1" });
console.log(`indexer on :${env.PORT ?? 8788} from block ${start}`);
