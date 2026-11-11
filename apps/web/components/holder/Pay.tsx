"use client";
import { useState } from "react";
import { useNear } from "@/components/NearProvider";
import { ErrorNote, Section, useAction, usePoll } from "@/components/ui";
import { accounting, pieceInfo } from "@/lib/piece";
import { payIncomeCall } from "@/lib/resale";
import { GRANT_TEXT, toUnits } from "@/lib/terms";
import { decimalsOf, money } from "@/lib/money";

/** Demo step 4: anyone pays income (licence fees, prints) into the piece; it goes to the holder. */
export function Pay({ pieceId }: { pieceId: string }) {
  const { chain, accountId, signer, config } = useNear();
  const { data, reload } = usePoll(async () => ({ piece: await pieceInfo(chain, pieceId), acc: await accounting(chain, pieceId) }), 5000, [pieceId]);
  const [amount, setAmount] = useState("");
  const [done, setDone] = useState<string | null>(null);
  const { busy, error, run } = useAction();
  if (!data) return <p className="pt-10 text-ink-3">Loading…</p>;
  const { piece, acc } = data;
  const d = config.currencyDecimals;
  return (
    <div className="space-y-6 pt-8">
      <div>
        <p className="label">Pay this piece</p>
        <h1 className="mt-2 font-display text-4xl tracking-tight">Piece {piece.token_id} by {piece.artist}</h1>
        <p className="mt-2 text-ink-2">Payments for using this work (licences, prints) go into the piece and belong to whoever holds it.</p>
      </div>
      {piece.grant.kind === "Personal" || !piece.grant_active ? (
        <div className="card" data-testid="pay-closed">This piece is licensed for personal use only, so it does not take licence payments.</div>
      ) : (
      <Section title="Pay">
        <p className="mb-3 text-sm">Rights on this piece: {GRANT_TEXT[piece.grant.kind].title}.</p>
        <div className="flex flex-wrap items-end gap-3">
          <label className="block">
            <span className="label">Amount ({piece.currency === "Near" ? "NEAR" : "USDC"})</span>
            <input className="field mt-1 w-40" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} aria-label="Amount" />
          </label>
          <button
            className="btn-seal"
            data-testid="pay"
            disabled={!accountId || !amount || !!busy}
            onClick={() => run("Paying", async () => {
              const units = toUnits(amount, decimalsOf(piece.currency, d));
              const c = payIncomeCall(pieceId, units, piece.currency);
              await signer!.call(c.contract, c.method, c.args, { deposit: c.deposit, tgas: c.tgas });
              setDone(`Paid ${money(units, piece.currency, d)}. Thank you.`);
              setAmount("");
              await reload();
            })}
          >
            Pay into the piece
          </button>
        </div>
        {done && <p className="mt-3 text-sm text-moss" role="status">{done}</p>}
        <p className="mt-3 text-xs text-ink-3">Held for the holder now: {money(acc.holder_pool, acc.currency, d)}</p>
        <ErrorNote error={error} />
      </Section>
      )}
    </div>
  );
}
