"use client";
import { usePoll } from "@/components/ui";
import { describeEvent, lagNotice } from "@/lib/history";
import { fmtDate, type Currency } from "@/lib/terms";
import { money } from "@/lib/money";

interface E { height: number; at: number; event: string; data: any }

/**
 * Provenance: one dated ledger of everything that happened to the piece on-chain — its making
 * anchored while it was made, then listings, sales and changes of hands. Read from the indexer.
 */
export function Provenance({ pieceId, artist, currency, decimals }: { pieceId: string; artist: string; currency: Currency; decimals: number }) {
  const { data, error } = usePoll(
    () => fetch(`/indexer/pieces/${pieceId}/history`).then((r) => (r.ok ? (r.json() as Promise<{ events: E[]; lag: { updating: boolean; behindMs: number } }>) : Promise.reject(new Error("indexer")))),
    8000,
    [pieceId],
  );
  if (!data) return <p className="text-ink-3">{error ? "The history could not be loaded just now. The piece itself is always current." : "Loading the history…"}</p>;

  const anchors = data.events.filter((e) => e.event === "anchored");
  const rows: { at: number; text: string; key: string }[] = [];
  for (const e of data.events) {
    if (e.event === "anchored" || e.event === "transfer_pending" || e.event === "capture_key_added") continue;
    // A piece of the artist's own settles with nothing to pay: not an event a visitor needs.
    if (e.event === "settled" && BigInt(e.data?.artist_amount ?? 0) === 0n) continue;
    let text = describeEvent(e, currency, decimals);
    if (e.event === "sold" && e.data?.seller === artist) text = `${artist} sold it to ${e.data.buyer} for ${money(e.data.price, currency, decimals)}`;
    rows.push({ at: e.at, text, key: `${e.height}-${e.event}-${rows.length}` });
  }
  if (anchors.length > 0) {
    const first = anchors[0]!.at, last = anchors.at(-1)!.at;
    rows.push({
      at: first,
      key: "making",
      text: anchors.length === 1
        ? "The making was anchored on-chain while it was made"
        : `The making was anchored on-chain ${anchors.length} times while it was made, until ${fmtDate(last)}`,
    });
  }
  rows.sort((a, b) => a.at - b.at);
  const notice = lagNotice(data.lag);
  return (
    <div>
      {notice && <p className="mb-4 text-sm text-ink-2" data-testid="lag-notice">{notice}</p>}
      {rows.length === 0 ? (
        <p className="text-ink-2">Nothing has happened to this piece on-chain yet.</p>
      ) : (
        <ol className="ledger" data-testid="history">
          {rows.map((r) => (
            <li key={r.key}>
              <time dateTime={new Date(r.at).toISOString()}>{fmtDate(r.at, "date")}</time>
              <span>{r.text}</span>
            </li>
          ))}
        </ol>
      )}
      <p className="mt-4 text-sm text-ink-3">Read from the chain: every line comes from the piece account's own transactions.</p>
    </div>
  );
}
