import { createServer, type Server } from "node:http";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ChainView } from "../lib/near.ts";

/** One endpoint that always rate-limits, one that answers (the testnet E2E failure, made local). */
let limited: Server, good: Server;
let hits = { limited: 0, good: 0 };
const listen = (s: Server) => new Promise<string>((r) => s.listen(0, "127.0.0.1", () => r(`http://127.0.0.1:${(s.address() as any).port}`)));
let urls: string[] = [];

beforeAll(async () => {
  limited = createServer((_q, res) => {
    hits.limited++;
    res.writeHead(429, { "content-type": "application/json" }).end(JSON.stringify({ jsonrpc: "2.0", id: 1, error: { code: -429, message: "Rate limits exceeded" } }));
  });
  good = createServer((q, res) => {
    hits.good++;
    let body = "";
    q.on("data", (c) => (body += c)).on("end", () => {
      const id = JSON.parse(body).id;
      const result = { result: [...Buffer.from(JSON.stringify("7"))], logs: [], block_height: 1, block_hash: "x" };
      res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ jsonrpc: "2.0", id, result }));
    });
  });
  urls = [await listen(limited), await listen(good)];
});
afterAll(() => {
  limited.close();
  good.close();
});

describe("rpc failover (testnet E2E: HTTP 429 from a free RPC)", () => {
  it("a view succeeds through the next endpoint when one rate-limits, whichever endpoint it starts on", async () => {
    for (let i = 0; i < 6; i++) expect(await new ChainView(urls).view("c.testnet", "nft_total_supply")).toBe("7");
    expect(hits.good).toBeGreaterThanOrEqual(6);
  }, 60_000);
  it("a single endpoint still works", async () => {
    expect(await new ChainView(urls[1]!).view("c.testnet", "nft_total_supply")).toBe("7");
  });
});

describe("withRetry", () => {
  it("retries while every endpoint is overloaded, then succeeds", async () => {
    const { withRetry } = await import("../lib/near.ts");
    let n = 0;
    const r = await withRetry(async () => { if (n++ < 2) throw new Error("FailoverRpcError: Exceeded 2 providers to execute request"); return "ok"; }, [1, 1, 1]);
    expect([r, n]).toEqual(["ok", 3]);
  });
  it("does not retry a contract error", async () => {
    const { withRetry } = await import("../lib/near.ts");
    let n = 0;
    await expect(withRetry(async () => { n++; throw new Error("Smart contract panicked: ERR_WRONG_STATUS"); }, [1, 1])).rejects.toThrow(/ERR_WRONG_STATUS/);
    expect(n).toBe(1);
  });
});

describe("errText (testnet E2E: a BigInt in an error broke error handling)", () => {
  it("turns an error carrying BigInts into text instead of throwing", async () => {
    const { errText, chainErrorCode } = await import("../lib/near.ts");
    const e = Object.assign(new Error("fetch failed"), { cause: { nonce: 27000004n }, gas: 300n });
    expect(errText(e)).toMatch(/fetch failed.*27000004/);
    expect(chainErrorCode(Object.assign(new Error("Smart contract panicked: ERR_WRONG_STATUS"), { n: 1n }))).toBe("ERR_WRONG_STATUS");
  });
});

describe("KeySigner: a transaction dropped because another tab used its nonce", () => {
  it("is detected while the RPC is still waiting, and re-signed with a fresh nonce", async () => {
    const ed = await import("@noble/ed25519");
    const { base58 } = await import("@scure/base");
    const { KeySigner } = await import("../lib/near.ts");
    const seed = new Uint8Array(32).fill(9);
    const secret = "ed25519:" + base58.encode(new Uint8Array([...seed, ...(await ed.getPublicKeyAsync(seed))]));
    let akNonce = 100;
    const sends: number[] = [];
    const server = createServer((q, res) => {
      let body = "";
      q.on("data", (c) => (body += c)).on("end", () => {
        const { id, method, params } = JSON.parse(body);
        const ok = (result: unknown) => res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ jsonrpc: "2.0", id, result }));
        if (method === "query") return ok({ nonce: akNonce, permission: "FullAccess", block_height: 1, block_hash: "11111111111111111111111111111111" });
        if (method === "block") return ok({ header: { hash: "11111111111111111111111111111111", height: 1 } });
        if (method === "tx" || method === "EXPERIMENTAL_tx_status")
          return res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ jsonrpc: "2.0", id, error: { name: "HANDLER_ERROR", cause: { name: "UNKNOWN_TRANSACTION" }, code: -32000, message: "Server error", data: "UNKNOWN_TRANSACTION" } }));
        if (method === "send_tx") {
          sends.push(sends.length);
          if (sends.length === 1) {
            akNonce = 101; // the other tab's transaction took nonce 101; ours is dropped and the RPC never answers
            return;
          }
          return ok({ final_execution_status: "EXECUTED_OPTIMISTIC", status: { SuccessValue: "" }, transaction: { hash: "h2" }, transaction_outcome: { id: "h2", outcome: { logs: [], status: { SuccessValue: "" } } }, receipts_outcome: [] });
        }
        ok({});
      });
    });
    const url = await listen(server);
    try {
      const s = new KeySigner("client.testnet", secret, url);
      const t0 = Date.now();
      const r = await s.call("p1.c.testnet", "accept", {});
      expect(r.txHash).toBe("h2");
      expect(sends.length).toBe(2);
      expect(Date.now() - t0).toBeLessThan(20_000);
    } finally {
      server.close();
      server.closeAllConnections();
    }
  }, 30_000);
});
