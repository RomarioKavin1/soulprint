import { describe, expect, it } from "vitest";
import { accountUrl, blockUrl, explorerFor, tokenUrl } from "../lib/explorer.ts";

describe("explorer links", () => {
  it("point testnet at NearBlocks", () => {
    const e = explorerFor("testnet");
    expect(accountUrl(e, "p1.soulprint-v1.x.testnet")).toBe("https://testnet.nearblocks.io/address/p1.soulprint-v1.x.testnet");
    expect(tokenUrl(e, "soulprint-v1.x.testnet", "7")).toBe("https://testnet.nearblocks.io/nft-tokens/soulprint-v1.x.testnet/tokens/7");
    expect(blockUrl(e, 123)).toBe("https://testnet.nearblocks.io/blocks/123");
  });
  it("have no explorer on the local chain", () => {
    const e = explorerFor("sandbox");
    expect(accountUrl(e, "a.test.near")).toBeNull();
  });
  it("accept an override", () => expect(accountUrl(explorerFor("sandbox", "http://x/"), "a")).toBe("http://x/address/a"));
});
