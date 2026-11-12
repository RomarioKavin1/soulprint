import { createServer, type Server } from "node:http";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ChainUnavailable, RpcChainReader } from "../src/chain.ts";

/** Testnet E2E: a rate-limited RPC made the service answer "unknown piece" for a live piece. */
const servers: Server[] = [];
const serve = (h: (body: any) => [number, unknown]) =>
  new Promise<string>((r) => {
    const s = createServer((q, res) => {
      let b = "";
      q.on("data", (c) => (b += c)).on("end", () => {
        const [code, json] = h(JSON.parse(b));
        res.writeHead(code, { "content-type": "application/json" }).end(JSON.stringify(json));
      });
    });
    servers.push(s);
    s.listen(0, "127.0.0.1", () => r(`http://127.0.0.1:${(s.address() as any).port}`));
  });
let limited = "", good = "", absent = "";
beforeAll(async () => {
  limited = await serve(() => [429, { jsonrpc: "2.0", id: 1, error: { code: -429, message: "Rate limits exceeded" } }]);
  good = await serve((b) => [200, { jsonrpc: "2.0", id: b.id, result: { result: [...Buffer.from(JSON.stringify({ owner: "a.testnet" }))], logs: [] } }]);
  absent = await serve((b) => [200, { jsonrpc: "2.0", id: b.id, error: { name: "HANDLER_ERROR", cause: { name: "UNKNOWN_ACCOUNT" } } }]);
});
afterAll(() => servers.forEach((s) => s.close()));

describe("RpcChainReader", () => {
  it("fails over past a rate-limited endpoint", async () => {
    expect(await new RpcChainReader([limited, good], 4).view("p1.c.testnet", "piece_info", {})).toEqual({ owner: "a.testnet" });
  });
  it("an account that does not exist is null (unknown piece)", async () => {
    expect(await new RpcChainReader(absent, 2).view("p9.c.testnet", "piece_info", {})).toBeNull();
  });
  it("an RPC that keeps failing is 'chain unavailable' (503), not an unknown piece", async () => {
    await expect(new RpcChainReader(limited, 2).view("p1.c.testnet", "piece_info", {})).rejects.toBeInstanceOf(ChainUnavailable);
  });
});
