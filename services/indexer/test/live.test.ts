/** Against a running sandbox + indexer (make demo): event-derived balances equal each piece's accounting. */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const path = process.env.SOULPRINT_CONFIG;
const c = path ? JSON.parse(readFileSync(path, "utf8")).sandbox : null;
const IX = process.env.INDEXER_URL ?? "http://127.0.0.1:8788";

async function view(contract: string, method: string, args: object = {}) {
  const r = await fetch(c.rpc_url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "query", params: { request_type: "call_function", finality: "final", account_id: contract, method_name: method, args_base64: Buffer.from(JSON.stringify(args)).toString("base64") } }) });
  const j: any = await r.json();
  return JSON.parse(Buffer.from(j.result.result).toString());
}

describe.skipIf(!c)("indexer vs chain (live)", () => {
  it("history_reconstructs_balances_from_events for every piece on the sandbox", async () => {
    for (let i = 0; i < 120; i++) {
      if (!(await (await fetch(`${IX}/lag`)).json()).updating && (await (await fetch(`${IX}/lag`)).json()).behindBlocks < 3) break;
      await new Promise((r) => setTimeout(r, 1000));
    }
    const total = Number(await view(c.collection, "nft_total_supply"));
    expect(total).toBeGreaterThan(0);
    for (let t = 1; t <= total; t++) {
      const id = `p${t}.${c.collection}`;
      const acc = await view(id, "accounting");
      const info = await view(id, "piece_info");
      const h = await (await fetch(`${IX}/pieces/${id}/history`)).json();
      const b = h.balances;
      const nonzero = (o: Record<string, string>) => Object.fromEntries(Object.entries(o).filter(([, v]) => BigInt(v) !== 0n));
      const chainCredits = nonzero(Object.fromEntries(acc.credits.map((x: any) => [x.account, x.available])));
      expect({ id, funded: b.funded, escrow: b.escrow, released: b.released, refunded: b.refunded, pool: b.holderPool, credits: nonzero(b.credits), owner: b.owner, status: b.status })
        .toEqual({ id, funded: acc.funded, escrow: acc.escrow, released: acc.released, refunded: acc.refunded, pool: acc.holder_pool, credits: chainCredits, owner: info.owner, status: info.status });
    }
  }, 180_000);
});
