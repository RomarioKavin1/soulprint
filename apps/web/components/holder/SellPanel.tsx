"use client";
import { useState } from "react";
import { useNear } from "@/components/NearProvider";
import { ErrorNote, Section, useAction } from "@/components/ui";
import { act, type Accounting, type PieceInfo } from "@/lib/piece";
import type { Listing } from "@/lib/resale";
import { toUnits } from "@/lib/terms";
import { decimalsOf, money } from "@/lib/money";

/** The owner puts a finished piece up for collectors (or takes it off). Used by the vault and the studio. */
export function SellPanel({ piece, acc, listing, onChange, title = "Sell" }: { piece: PieceInfo; acc: Accounting; listing: Listing | null; onChange: () => void; title?: string }) {
  const { signer, config } = useNear();
  const [price, setPrice] = useState("");
  const [reserved, setReserved] = useState("");
  const { busy, error, run } = useAction();
  const d = config.currencyDecimals;
  const firstSale = piece.owner === piece.artist;
  return (
    <Section title={title}>
      {listing ? (
        <div className="flex flex-wrap items-center gap-3">
          <span data-testid="listed">
            Listed at <b>{money(listing.price, acc.currency, d)}</b>
            {listing.reserved_for ? ` for ${listing.reserved_for}` : ""}. Anyone can collect it from the piece&apos;s page.
          </span>
          <button className="btn-ghost" disabled={!!busy} onClick={() => run("Taking it off sale", async () => { await act(signer!, piece.piece_id, "delist"); onChange(); })}>
            Take off sale
          </button>
        </div>
      ) : (
        <div className="flex flex-wrap items-end gap-3">
          <label className="block">
            <span className="label block">Price</span>
            <input className="field mt-1 w-40" inputMode="decimal" value={price} onChange={(e) => setPrice(e.target.value)} aria-label="Sale price" />
          </label>
          <label className="block">
            <span className="label block">Only for (optional)</span>
            <input className="field mt-1 w-56" value={reserved} onChange={(e) => setReserved(e.target.value.trim())} aria-label="Reserved for" />
          </label>
          <button
            className="btn-seal"
            data-testid="list"
            disabled={!price || !!busy}
            onClick={() => run("Listing", async () => {
              await act(signer!, piece.piece_id, "list", { price: toUnits(price, decimalsOf(acc.currency, d)).toString(), reserved_for: reserved || null });
              setPrice("");
              onChange();
            })}
          >
            {busy ?? "List for sale"}
          </button>
          <span className="w-full text-xs text-ink-3">
            {firstSale
              ? `The collector gets the files and the rights shown on the piece's page. Every later resale pays you ${piece.royalty_bps / 100}%.`
              : `The artist receives ${piece.royalty_bps / 100}% of the sale price.`}
          </span>
        </div>
      )}
      <ErrorNote error={error} />
    </Section>
  );
}
