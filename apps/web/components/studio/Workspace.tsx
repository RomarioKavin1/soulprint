"use client";
import Link from "next/link";
import { useNear } from "@/components/NearProvider";
import { Stat, usePoll, when } from "@/components/ui";
import { Earnings } from "@/components/Earnings";
import { statusText, accounting, pieceInfo, proofPage } from "@/lib/piece";
import { money } from "@/lib/money";
import { canRecord } from "@/lib/commission";
import { CapturePanel } from "./CapturePanel";
import { ReviewGrid } from "./ReviewGrid";
import { ChallengesPanel } from "./ChallengesPanel";
import { DeliverPanel } from "./DeliverPanel";
import { PublishPanel } from "./PublishPanel";
import { AttestPanel } from "./AttestPanel";
import { SellPanel } from "@/components/holder/SellPanel";
import { ContextNotes } from "@/components/notes/ContextNotes";
import type { Listing } from "@/lib/resale";


export function Workspace({ pieceId }: { pieceId: string }) {
  const { chain, accountId, config } = useNear();
  const { data, error, reload } = usePoll(
    async () => {
      const [piece, proof, acc, listing] = await Promise.all([pieceInfo(chain, pieceId), proofPage(chain, pieceId), accounting(chain, pieceId), chain.view<Listing | null>(pieceId, "listing")]);
      return { piece, proof, acc, listing };
    },
    4000,
    [pieceId],
  );
  if (error && !data) return <p className="pt-10 text-seal-2">This piece could not be found on the network.</p>;
  if (!data) return <p className="pt-10 text-ink-3">Loading…</p>;
  const { piece, proof, acc, listing } = data;
  if (accountId !== piece.artist)
    return (
      <div className="pt-10">
        <p className="text-ink-2">This is the artist&apos;s workspace for piece {piece.token_id}.</p>
        <Link className="btn-ghost mt-4" href={piece.mode === "Commission" ? `/c/${pieceId}` : `/p/${pieceId}`}>
          {piece.mode === "Commission" ? "Open the commission room" : "See the piece"}
        </Link>
      </div>
    );
  const link = typeof window !== "undefined" ? `${location.origin}/c/${pieceId}` : `/c/${pieceId}`;
  const recording = canRecord(piece);
  return (
    <div className="space-y-6 pt-8">
      <div>
        <p className="label">{piece.mode === "Commission" ? "Commission" : "Piece"} · {piece.piece_id}</p>
        <div className="mt-2 flex flex-wrap items-baseline justify-between gap-4">
          <h1 className="font-display text-4xl tracking-tight">Piece {piece.token_id}</h1>
          <span className="rounded-full bg-ink px-4 py-1.5 text-sm text-paper" data-testid="status">
            {statusText(piece)}
          </span>
        </div>
      </div>

      <div className="card grid gap-6 sm:grid-cols-4">
        {piece.mode === "Commission" && <Stat label="Price" value={money(piece.price, piece.currency, config.currencyDecimals)} />}
        {piece.mode === "Commission" && <Stat label="Held in the piece" value={money(acc.escrow, acc.currency, config.currencyDecimals)} />}
        {piece.mode === "Commission" && <Stat label="Deadline" value={when(piece.deadline)} />}
        <Stat label="Frames anchored" value={proof.segments.reduce((a, s) => a + s.count, 0)} />
      </div>

      {piece.mode === "Commission" && piece.status === "Offered" && (
        <div className="card border-seal/40">
          <p className="label">Send this link to your client</p>
          <div className="mt-2 flex flex-wrap items-center gap-3">
            <code className="break-all font-mono text-sm" data-testid="client-link">{link}</code>
            <button className="btn-ghost py-1" onClick={() => navigator.clipboard?.writeText(link)}>
              Copy
            </button>
          </div>
          <p className="mt-2 text-sm text-ink-3">You can start recording now; the work is yours until they pay.</p>
        </div>
      )}
      {piece.status === "Delivered" && piece.review_ends_at && (
        <div className="card">The client is reviewing. If they say nothing, the piece completes on {when(piece.review_ends_at)}.</div>
      )}
      {piece.status === "Disputed" && <div className="card border-seal/40">The client refused this delivery. The arbitrators will decide; you can also agree a split with the client.</div>}

      <Earnings pieceId={pieceId} acc={acc} onChange={reload} />
      {recording && <CapturePanel pieceId={pieceId} segments={proof.segments} open={recording} onChange={reload} />}
      {recording && <ChallengesPanel pieceId={pieceId} proof={proof} onChange={reload} />}
      <DeliverPanel piece={piece} onChange={reload} />
      <AttestPanel piece={piece} proof={proof} onChange={reload} />
      <ReviewGrid pieceId={pieceId} commission={piece.mode === "Commission"} />
      <PublishPanel piece={piece} />
      {piece.report_hash && <ContextNotes pieceId={pieceId} artist={piece.artist} />}
      {piece.mode === "Standalone" && piece.status === "Settled" && piece.owner === accountId && (
        <SellPanel piece={piece} acc={acc} listing={listing} onChange={reload} title="Offer it to collectors (optional)" />
      )}
      {piece.mode === "Standalone" && piece.status === "Settled" && piece.owner !== accountId && (
        <div className="card text-sm">Collected by {piece.owner}. Resales pay you {piece.royalty_bps / 100}%.</div>
      )}
    </div>
  );
}
