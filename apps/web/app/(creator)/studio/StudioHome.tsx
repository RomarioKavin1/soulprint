"use client";
import Link from "next/link";
import { useNearOptional } from "@/components/useNearOptional";
import { usePoll, when } from "@/components/ui";
import { statusText, piecesFor } from "@/lib/piece";
import { money } from "@/lib/money";

export function StudioHome() {
  const near = useNearOptional();
  return (
    <div className="page-top">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <h1 className="title-page">Studio</h1>
        {near?.accountId && (
          <div className="flex gap-2">
            <Link href="/studio/new?mode=standalone" className="btn-seal">
              New piece
            </Link>
            <Link href="/studio/new" className="btn-ghost">
              Take a commission
            </Link>
          </div>
        )}
      </div>
      {!near?.accountId ? <p className="mt-4 text-ink-2">Sign in to see your work and start a new piece.</p> : <PieceList />}
    </div>
  );
}

function PieceList() {
  const { chain, config, accountId } = useNearOptional()!;
  const { data, error } = usePoll(() => piecesFor(chain, config.collection, accountId!), 8000, [accountId]);
  if (error) return <p className="mt-6 text-seal-2">Could not reach the network.</p>;
  if (!data) return <p className="mt-6 text-ink-3">Loading…</p>;
  const mine = data.filter((p) => p.artist === accountId);
  const owned = data.filter((p) => p.artist !== accountId);
  return (
    <div className="mt-8 space-y-10">
      <Group title="Your work" pieces={mine} empty="Nothing yet. Start a piece and record how you make it." hrefFor={(p) => `/studio/${p.piece_id}`} decimals={config.currencyDecimals} />
      {owned.length > 0 && <Group title="Pieces you collected" pieces={owned} empty="" hrefFor={(p) => (p.mode === "Commission" && p.status !== "Settled" ? `/c/${p.piece_id}` : `/vault/${p.piece_id}`)} decimals={config.currencyDecimals} />}
    </div>
  );
}

function Group({ title, pieces, empty, hrefFor, decimals }: { title: string; pieces: Awaited<ReturnType<typeof piecesFor>>; empty: string; hrefFor: (p: Awaited<ReturnType<typeof piecesFor>>[number]) => string; decimals: number }) {
  return (
    <section>
      <h2 className="label">{title}</h2>
      {pieces.length === 0 ? (
        <p className="mt-3 text-ink-2">{empty}</p>
      ) : (
        <ul className="card mt-3 divide-y divide-rule !p-0">
          {pieces.map((p) => (
            <li key={p.piece_id}>
              <Link href={hrefFor(p)} className="grid items-center gap-x-6 gap-y-1 px-5 py-4 no-underline hover:bg-paper-2/60 sm:grid-cols-[minmax(0,1fr)_7rem_11rem_9rem]">
                <span>
                  <span className="font-display text-lg">Piece {p.token_id}</span>
                  <span className="ml-3 text-sm text-ink-3">{p.mode === "Commission" ? `for ${p.owner === p.artist ? "an open client" : p.owner}` : "your own piece"}</span>
                </span>
                <span className="tabular text-sm text-ink-2 sm:text-right">{p.mode === "Commission" ? money(p.price, p.currency, decimals) : ""}</span>
                <span><span className="chip">{statusText(p)}</span></span>
                <span className="tabular text-sm text-ink-3 sm:text-right">{when(p.created_at)}</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
