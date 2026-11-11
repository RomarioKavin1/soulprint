/** Resale and income calls. A buy is pinned to the listing seen (nonce, price) and the pool shown. */
import type { Call } from "./commission.ts";
import type { Currency } from "./terms.ts";

export interface Listing { seller: string; price: string; nonce: string; reserved_for: string | null }

export function buyCall(pieceId: string, l: Listing, poolShown: string, currency: Currency): Call {
  const pinned = { nonce: l.nonce, max_price: l.price, expected_pool_min: poolShown };
  if (currency === "Near") return { contract: pieceId, method: "buy", args: pinned, deposit: BigInt(l.price), tgas: 150n };
  return {
    contract: currency.Ft,
    method: "ft_transfer_call",
    args: { receiver_id: pieceId, amount: l.price, msg: JSON.stringify({ action: "buy", ...pinned }) },
    deposit: 1n,
    tgas: 200n,
  };
}

export function payIncomeCall(pieceId: string, amount: bigint, currency: Currency): Call {
  if (currency === "Near") return { contract: pieceId, method: "pay_income", args: {}, deposit: amount, tgas: 100n };
  return { contract: currency.Ft, method: "ft_transfer_call", args: { receiver_id: pieceId, amount: amount.toString(), msg: JSON.stringify({ action: "pay_income" }) }, deposit: 1n, tgas: 150n };
}
