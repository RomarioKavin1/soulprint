import type { Currency } from "./terms.ts";
import { fromUnits } from "./terms.ts";

export function currencyName(c: Currency) {
  return c === "Near" ? "NEAR" : "USDC";
}
export function decimalsOf(c: Currency, ftDecimals: number) {
  return c === "Near" ? 24 : ftDecimals;
}
export function money(v: string | bigint, c: Currency, ftDecimals: number) {
  return `${fromUnits(v, decimalsOf(c, ftDecimals), c === "Near" ? 3 : 2)} ${currencyName(c)}`;
}
