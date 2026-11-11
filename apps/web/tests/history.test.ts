import { describe, expect, it } from "vitest";
import { describeEvent, lagNotice } from "../lib/history.ts";

describe("history view", () => {
  it("history_shows_lag_indicator: says it is updating instead of presenting stale figures", () => {
    expect(lagNotice({ updating: true, behindMs: 5 * 60_000 })).toBe("Updating — the last 5 minutes of activity may not show yet. Balances on the piece itself are always current.");
    expect(lagNotice({ updating: false, behindMs: 800 })).toBeNull();
  });
  it("events read as plain sentences", () => {
    expect(describeEvent({ event: "funded", data: { payer: "client.near", amount: "25000000" } }, "Ft", 6)).toBe("client.near paid 25 USDC into the piece");
    expect(describeEvent({ event: "sold", data: { seller: "a", buyer: "b", price: "40000000", royalty: "2000000" } }, "Ft", 6)).toBe("a sold it to b for 40 USDC (2 USDC royalty to the artist)");
    expect(describeEvent({ event: "income", data: { payer: "shop.near", amount: "2000000" } }, "Ft", 6)).toBe("shop.near paid 2 USDC to the holder");
  });
});
