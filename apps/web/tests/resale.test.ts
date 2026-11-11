import { describe, expect, it } from "vitest";
import { buyCall, payIncomeCall } from "../lib/resale.ts";

const listing = { seller: "client.test.near", price: "40000000", nonce: "7", reserved_for: null };

describe("resale", () => {
  it("buy_sends_nonce_max_price_pool_min (FT)", () => {
    const c = buyCall("p1.x", listing, "1500000", { Ft: "usdc.test.near" });
    expect(c).toMatchObject({ contract: "usdc.test.near", method: "ft_transfer_call", deposit: 1n });
    expect(c.args).toMatchObject({ receiver_id: "p1.x", amount: "40000000" });
    expect(JSON.parse(c.args.msg as string)).toEqual({ action: "buy", nonce: "7", max_price: "40000000", expected_pool_min: "1500000" });
  });
  it("buy_sends_nonce_max_price_pool_min (NEAR)", () => {
    const c = buyCall("p1.x", { ...listing, price: "2000000000000000000000000" }, "0", "Near");
    expect(c).toMatchObject({ contract: "p1.x", method: "buy", deposit: 2_000_000_000_000_000_000_000_000n });
    expect(c.args).toEqual({ nonce: "7", max_price: "2000000000000000000000000", expected_pool_min: "0" });
  });
  it("pay income", () => {
    expect(JSON.parse(payIncomeCall("p1.x", 5n, { Ft: "usdc.test.near" }).args.msg as string)).toEqual({ action: "pay_income" });
    expect(payIncomeCall("p1.x", 5n, "Near")).toMatchObject({ contract: "p1.x", method: "pay_income", deposit: 5n });
  });
});
