import type { Currency } from "./terms.ts";
import { fromUnits } from "./terms.ts";

export function currencyName(c: Currency) {
  return c === "Near" ? "NEAR" : "USDC";
}
export function decimalsOf(c: Currency, ftDecimals: number) {
  return c === "Near" ? 24 : ftDecimals;
}
export function money(v: string | bigint, c: Currency, ftDecimals: number) {
  // Full precision, trailing zeros trimmed: a deposit of 1.255 USDC is shown as 1.255 (review minor 8).
  return `${fromUnits(v, decimalsOf(c, ftDecimals))} ${currencyName(c)}`;
}
