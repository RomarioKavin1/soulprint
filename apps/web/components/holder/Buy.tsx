"use client";
import Link from "next/link";
import { useNear } from "@/components/NearProvider";
import { ErrorNote, Section, Stat, useAction, usePoll } from "@/components/ui";
import { accounting, pieceInfo } from "@/lib/piece";
import { buyCall, type Listing } from "@/lib/resale";
import { GRANT_TEXT } from "@/lib/terms";
import { money } from "@/lib/money";

export function Buy({ pieceId }: { pieceId: string }) {
  const { chain, accountId, signer, config } = useNear();
  const { data, reload } = usePoll(async () => {
    const [piece, acc, listing] = await Promise.all([pieceInfo(chain, pieceId), accounting(chain, pieceId), chain.view<Listing | null>(pieceId, "listing")]);
    return { piece, acc, listing };
  }, 5000, [pieceId]);
  const { busy, error, run } = useAction();
  if (!data) return <p className="page-top text-ink-3">Loading…</p>;
  const { piece, acc, listing } = data;
  const d = config.currencyDecimals;
  const bought = accountId && piece.owner === accountId;
  return (
    <div className="space-y-8 page-top">
      <div>
        <h1 className="title-page">Piece {piece.token_id} by {piece.artist}</h1>
        <p className="mt-3 text-sm text-ink-3">{listing ? "For sale" : bought ? "Yours" : "Not for sale right now"} · {piece.piece_id}</p>
        <Link className="mt-2 inline-block text-sm underline" href={`/p/${pieceId}`}>See how it was made</Link>
      </div>
      {bought ? (
        <div className="card">
          It&apos;s yours. <Link className="underline" href={`/vault/${pieceId}`}>Open your files</Link>
        </div>
      ) : !listing ? (
        <div className="card">This piece is not for sale right now.</div>
      ) : (
        <Section title="Buy">
          <div className="grid gap-6 sm:grid-cols-3">
            <Stat label="Price" value={<span data-testid="listing-price">{money(listing.price, acc.currency, d)}</span>} />
            <Stat label="Income that comes with it" value={money(acc.holder_pool, acc.currency, d)} />
            <Stat label="Rights" value={<span className="text-base">{GRANT_TEXT[piece.grant.kind].title}</span>} />
          </div>
          {listing.reserved_for && listing.reserved_for !== accountId && <p className="mt-3 text-sm text-seal-2">This sale is reserved for {listing.reserved_for}.</p>}
          <button
            className="btn-seal mt-5"
            data-testid="buy"
            disabled={!accountId || !!busy}
            onClick={() => run("Buying", async () => {
              const c = buyCall(pieceId, listing, acc.holder_pool, piece.currency);
              await signer!.call(c.contract, c.method, c.args, { deposit: c.deposit, tgas: c.tgas });
              await reload();
            })}
          >
            {busy ?? `Buy for ${money(listing.price, acc.currency, d)}`}
          </button>
          <p className="mt-2 text-xs text-ink-3">The purchase only goes through at this price, for this listing, with at least this much income included. {piece.royalty_bps / 100}% goes to the artist.</p>
          <ErrorNote error={error} />
        </Section>
      )}
    </div>
  );
}
