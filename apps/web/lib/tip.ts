/**
 * Tips (showcase pivot): a plain token transfer to the artist, with the piece named in the memo.
 * Not paid into the piece: the piece only takes licence income once finished and licensed
 * commercially, and that income belongs to whoever holds it — a tip is for the artist.
 */
import type { Call } from "./commission.ts";
import type { ChainView } from "./near.ts";

export function tipMemo(pieceId: string) {
  return `Soulprint tip for ${pieceId}`;
}

/** The transfer, preceded by a registration with the token if the artist has never held it (tipper pays). */
export async function tipCalls(chain: ChainView, token: string, artist: string, amount: bigint, pieceId: string): Promise<Call[]> {
  if (amount <= 0n) throw new Error("ERR_WRONG_AMOUNT");
  const calls: Call[] = [];
  const registered = await chain.view<unknown>(token, "storage_balance_of", { account_id: artist });
  if (!registered) {
    const bounds = await chain.view<{ min: string }>(token, "storage_balance_bounds");
    calls.push({ contract: token, method: "storage_deposit", args: { account_id: artist, registration_only: true }, deposit: BigInt(bounds.min), tgas: 30n });
  }
  calls.push({ contract: token, method: "ft_transfer", args: { receiver_id: artist, amount: amount.toString(), memo: tipMemo(pieceId) }, deposit: 1n, tgas: 30n });
  return calls;
}
