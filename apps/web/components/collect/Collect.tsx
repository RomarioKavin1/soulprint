"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useNear } from "@/components/NearProvider";
import { ErrorNote, useAction, usePoll } from "@/components/ui";
import { accounting, pieceInfo } from "@/lib/piece";
import { buyCall, type Listing } from "@/lib/resale";
import { GRANT_TEXT } from "@/lib/terms";
import { money } from "@/lib/money";
import { parseTip, tipCalls } from "@/lib/tip";

/**
 * On the piece's public page: collect it if the holder put it up for sale, or send the artist a tip.
 * Everything is read from the piece account; the buy is pinned to the listing shown.
 */
export function Collect({ pieceId }: { pieceId: string }) {
  const { chain, accountId, signer, config } = useNear();
  const router = useRouter();
  const { data, reload } = usePoll(async () => {
    const [piece, acc, listing] = await Promise.all([pieceInfo(chain, pieceId), accounting(chain, pieceId), chain.view<Listing | null>(pieceId, "listing")]);
    return { piece, acc, listing };
  }, 6000, [pieceId]);
  const buy = useAction();
  const tip = useAction();
  const [amount, setAmount] = useState("");
  const [thanks, setThanks] = useState<string | null>(null);
  if (!data) return null;
  const { piece, acc, listing } = data;
  const d = config.currencyDecimals;
  const tipUnits = parseTip(amount, d);
  const mine = accountId === piece.owner;
  const isArtist = accountId === piece.artist;
  const held = piece.owner === piece.artist ? "Held by the artist" : `Collected by ${piece.owner}`;

  return (
    <section className="card grid gap-8 sm:grid-cols-2" data-testid="collect">
      <div>
        <h2 className="font-display text-xl">Collect</h2>
        <p className="mt-1 text-sm text-ink-2" data-testid="holder">{held}.</p>
        {mine ? (
          <p className="mt-3 text-sm">
            This piece is yours. <Link className="underline" href={`/vault/${pieceId}`}>Open your files and sale settings</Link>
          </p>
        ) : listing && piece.status === "Settled" ? (
          <div className="mt-3">
            <p className="text-2xl" data-testid="collect-price">{money(listing.price, acc.currency, d)}</p>
            <p className="mt-1 text-sm text-ink-2">
              Comes with the files and {GRANT_TEXT[piece.grant.kind].title.toLowerCase()} rights
              {BigInt(acc.holder_pool) > 0n ? `, plus ${money(acc.holder_pool, acc.currency, d)} of income held in the piece` : ""}.
            </p>
            {listing.reserved_for && listing.reserved_for !== accountId ? (
              <p className="mt-3 text-sm text-seal-2">This sale is reserved for {listing.reserved_for}.</p>
            ) : (
              <button
                className="btn-seal mt-4"
                data-testid="collect-buy"
                disabled={!accountId || !!buy.busy}
                onClick={() => buy.run("Collecting", async () => {
                  const c = buyCall(pieceId, listing, acc.holder_pool, piece.currency);
                  await signer!.call(c.contract, c.method, c.args, { deposit: c.deposit, tgas: c.tgas });
                  await reload();
                  router.refresh(); // the server-rendered parts (rights, current holder) too (review B7)
                })}
              >
                {buy.busy ?? (accountId ? `Collect for ${money(listing.price, acc.currency, d)}` : "Sign in to collect")}
              </button>
            )}
            <p className="mt-2 text-xs text-ink-3">If it is resold later, {piece.royalty_bps / 100}% goes to the artist.</p>
            <ErrorNote error={buy.error} />
          </div>
        ) : (
          <p className="mt-3 text-sm text-ink-2">Not for sale right now.</p>
        )}
      </div>

      <div>
        <h2 className="font-display text-xl">Support the artist</h2>
        <p className="mt-1 text-sm text-ink-2">A tip goes straight to {piece.artist}, whether or not the piece is for sale.</p>
        {isArtist ? (
          <p className="mt-3 text-sm text-ink-3">People who visit this page can send you tips here.</p>
        ) : (
          <>
            <div className="mt-3 flex flex-wrap items-end gap-3">
              <label className="block">
                <span className="label block">Amount (USDC)</span>
                <input className="field mt-1 w-32" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} aria-label="Tip amount" />
              </label>
              <button
                className="btn-primary"
                data-testid="tip"
                disabled={!accountId || tipUnits === null || !!tip.busy}
                onClick={() => tip.run("Sending", async () => {
                  setThanks(null);
                  const units = tipUnits!;
                  for (const c of await tipCalls(chain, config.currencyToken, piece.artist, units, pieceId)) await signer!.call(c.contract, c.method, c.args, { deposit: c.deposit, tgas: c.tgas });
                  setThanks(`Sent ${money(units, { Ft: config.currencyToken }, d)} to ${piece.artist}. Thank you.`);
                  setAmount("");
                })}
              >
                {tip.busy ?? (accountId ? "Send a tip" : "Sign in to send a tip")}
              </button>
            </div>
            {amount.trim() !== "" && tipUnits === null && (
              <p className="mt-2 text-xs text-seal-2" data-testid="tip-invalid">Enter an amount above zero, with at most {d} decimal places.</p>
            )}
            {thanks && <p className="mt-3 text-sm text-moss" role="status" data-testid="tip-sent">{thanks}</p>}
            <ErrorNote error={tip.error} />
          </>
        )}
      </div>
    </section>
  );
}

