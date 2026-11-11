import { readFileSync } from "node:fs";

/** The live sandbox config written by soulprint-sandbox (scripts/dev-sandbox.sh). */
export function live() {
  const path = process.env.SOULPRINT_CONFIG;
  if (!path || path.includes("fixtures")) return null;
  const c = JSON.parse(readFileSync(path, "utf8")).sandbox;
  const id = (role: string) => c.accounts[role].account_id as string;
  return { c, rpc: c.rpc_url as string, collection: c.collection as string, artist: id("artist"), client: id("client"), buyer: id("buyer"), shop: id("shop"), arbitrator: id("arbitrator") };
}

export async function view(rpc: string, contract: string, method: string, args: object = {}) {
  const r = await fetch(rpc, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "query", params: { request_type: "call_function", finality: "final", account_id: contract, method_name: method, args_base64: Buffer.from(JSON.stringify(args)).toString("base64") } }),
  });
  const j = await r.json();
  if (j.error || j.result?.error) throw new Error(JSON.stringify(j.error ?? j.result.error));
  return JSON.parse(Buffer.from(j.result.result).toString("utf8"));
}
