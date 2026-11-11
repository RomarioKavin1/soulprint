/** Where blocks come from: RPC (sandbox; reconstructs outcomes via tx status) or Neardata (testnet/mainnet). */
import type { Block, Receipt } from "./ingest.ts";

export interface BlockSource {
  /** Latest final block. */
  head(): Promise<{ height: number; timestampMs: number }>;
  /** The block at `height`, or null if that height has no block (skipped). */
  block(height: number): Promise<Block | null>;
}

const ok = (status: any) => status && typeof status === "object" && ("SuccessValue" in status || "SuccessReceiptId" in status);

export class RpcBlockSource implements BlockSource {
  constructor(private url: string) {}
  private async rpc(method: string, params: unknown) {
    const r = await fetch(this.url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: "ix", method, params }) });
    const j: any = await r.json();
    if (j.error) {
      const e = new Error(JSON.stringify(j.error));
      (e as any).rpc = j.error;
      throw e;
    }
    return j.result;
  }
  async head() {
    const b = await this.rpc("block", { finality: "final" });
    return { height: b.header.height, timestampMs: Math.floor(Number(b.header.timestamp_nanosec) / 1e6) };
  }
  async block(height: number): Promise<Block | null> {
    let b: any;
    try {
      b = await this.rpc("block", { block_id: height });
    } catch (e: any) {
      if (/UNKNOWN_BLOCK|DB Not Found/i.test(JSON.stringify(e.rpc ?? e.message))) return null;
      throw e;
    }
    const receipts: Receipt[] = [];
    for (const c of b.chunks) {
      if (c.height_included !== height) continue;
      let chunk: any;
      try {
        chunk = await this.rpc("chunk", { chunk_id: c.chunk_hash });
      } catch (e: any) {
        // Sandbox fast-forwarded heights have chunk headers without stored chunks: nothing ran there.
        if (/DB Not Found|UNKNOWN_CHUNK/i.test(JSON.stringify(e.rpc ?? e.message))) continue;
        throw e;
      }
      for (const tx of chunk.transactions) {
        const s = await this.rpc("tx", { tx_hash: tx.hash, sender_account_id: tx.signer_id, wait_until: "FINAL" });
        for (const o of s.receipts_outcome ?? []) receipts.push({ executor: o.outcome.executor_id, success: ok(o.outcome.status), logs: o.outcome.logs ?? [] });
      }
    }
    return { height, timestampMs: Math.floor(Number(b.header.timestamp_nanosec) / 1e6), receipts };
  }
}

/** https://{network}.neardata.xyz/v0/block/{height}: full blocks with receipt execution outcomes. */
export class NeardataBlockSource implements BlockSource {
  constructor(private base: string, private rpcUrl: string) {}
  async head() {
    return new RpcBlockSource(this.rpcUrl).head();
  }
  async block(height: number): Promise<Block | null> {
    const r = await fetch(`${this.base}/v0/block/${height}`);
    if (r.status === 404) return null;
    const j: any = await r.json();
    if (!j) return null;
    const receipts: Receipt[] = [];
    for (const shard of j.shards ?? [])
      for (const x of shard.receipt_execution_outcomes ?? []) {
        const o = x.execution_outcome?.outcome;
        if (o) receipts.push({ executor: o.executor_id, success: ok(o.status), logs: o.logs ?? [] });
      }
    return { height, timestampMs: Math.floor(Number(j.block.header.timestamp_nanosec) / 1e6), receipts };
  }
}
