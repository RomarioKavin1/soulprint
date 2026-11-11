"use client";
import Link from "next/link";
import { useNearOptional } from "@/components/useNearOptional";
import { usePoll, when } from "@/components/ui";
import { STATUS_TEXT, piecesFor } from "@/lib/piece";
import { money } from "@/lib/money";

export function StudioHome() {
  const near = useNearOptional();
  return (
    <div className="pt-8">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <h1 className="font-display text-4xl tracking-tight">Studio</h1>
        {near?.accountId && (
          <div className="flex gap-2">
            <Link href="/studio/new" className="btn-seal">
              New commission
            </Link>
            <Link href="/studio/new?mode=standalone" className="btn-ghost">
              New piece without a client
            </Link>
          </div>
        )}
      </div>
      {!near?.accountId ? <p className="mt-4 text-ink-2">Sign in to see your commissions and start a new one.</p> : <PieceList />}
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
      <Group title="Your work" pieces={mine} empty="Nothing yet. Start a commission and send the client the link." hrefFor={(id) => `/studio/${id}`} decimals={config.currencyDecimals} />
      {owned.length > 0 && <Group title="Pieces you own" pieces={owned} empty="" hrefFor={(id) => `/c/${id}`} decimals={config.currencyDecimals} />}
    </div>
  );
}

function Group({ title, pieces, empty, hrefFor, decimals }: { title: string; pieces: Awaited<ReturnType<typeof piecesFor>>; empty: string; hrefFor: (id: string) => string; decimals: number }) {
  return (
    <section>
      <h2 className="label">{title}</h2>
      {pieces.length === 0 ? (
        <p className="mt-3 text-ink-2">{empty}</p>
      ) : (
        <ul className="mt-3 divide-y divide-rule rounded-2xl border border-rule bg-white/60">
          {pieces.map((p) => (
            <li key={p.piece_id}>
              <Link href={hrefFor(p.piece_id)} className="flex flex-wrap items-center justify-between gap-3 px-5 py-4 hover:bg-paper-2/60">
                <span>
                  <span className="font-display text-lg">Piece {p.token_id}</span>
                  <span className="ml-3 text-sm text-ink-3">{p.mode === "Commission" ? `for ${p.owner === p.artist ? "an open client" : p.owner}` : "no client"}</span>
                </span>
                <span className="text-sm text-ink-2">
                  {p.mode === "Commission" && <span className="mr-4">{money(p.price, p.currency, decimals)}</span>}
                  <span className="rounded-full bg-paper-2 px-3 py-1">{STATUS_TEXT[p.status]}</span>
                  <span className="ml-4 text-ink-3">{when(p.created_at)}</span>
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
