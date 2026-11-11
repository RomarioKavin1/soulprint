"use client";
import Link from "next/link";
import { useNear } from "@/components/NearProvider";
import { Stat, usePoll, when } from "@/components/ui";
import { Earnings } from "@/components/Earnings";
import { STATUS_TEXT, accounting, pieceInfo, proofPage } from "@/lib/piece";
import { money } from "@/lib/money";
import { CapturePanel } from "./CapturePanel";
import { ReviewGrid } from "./ReviewGrid";
import { ChallengesPanel } from "./ChallengesPanel";
import { DeliverPanel } from "./DeliverPanel";
import { PublishPanel } from "./PublishPanel";

const RECORDING = new Set(["Offered", "InProgress", "Delivered", "Disputed"]);

export function Workspace({ pieceId }: { pieceId: string }) {
  const { chain, accountId, config } = useNear();
  const { data, error, reload } = usePoll(
    async () => {
      const [piece, proof, acc] = await Promise.all([pieceInfo(chain, pieceId), proofPage(chain, pieceId), accounting(chain, pieceId)]);
      return { piece, proof, acc };
    },
    4000,
    [pieceId],
  );
  if (error && !data) return <p className="pt-10 text-seal-2">This piece could not be found on the network.</p>;
  if (!data) return <p className="pt-10 text-ink-3">Loading…</p>;
  const { piece, proof, acc } = data;
  if (accountId !== piece.artist)
    return (
      <div className="pt-10">
        <p className="text-ink-2">This is the artist&apos;s workspace for piece {piece.token_id}.</p>
        <Link className="btn-ghost mt-4" href={`/c/${pieceId}`}>
          Open the commission room
        </Link>
      </div>
    );
  const link = typeof window !== "undefined" ? `${location.origin}/c/${pieceId}` : `/c/${pieceId}`;
  const canRecord = RECORDING.has(piece.status) || (piece.mode === "Standalone" && piece.status !== "Settled");
  return (
    <div className="space-y-6 pt-8">
      <div>
        <p className="label">{piece.mode === "Commission" ? "Commission" : "Piece"} · {piece.piece_id}</p>
        <div className="mt-2 flex flex-wrap items-baseline justify-between gap-4">
          <h1 className="font-display text-4xl tracking-tight">Piece {piece.token_id}</h1>
          <span className="rounded-full bg-ink px-4 py-1.5 text-sm text-paper" data-testid="status">
            {STATUS_TEXT[piece.status]}
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
      {canRecord && <CapturePanel pieceId={pieceId} segments={proof.segments} open={canRecord} onChange={reload} />}
      {canRecord && <ChallengesPanel pieceId={pieceId} proof={proof} onChange={reload} />}
      <DeliverPanel piece={piece} onChange={reload} />
      <ReviewGrid pieceId={pieceId} />
      <PublishPanel piece={piece} />
    </div>
  );
}
