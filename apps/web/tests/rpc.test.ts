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
