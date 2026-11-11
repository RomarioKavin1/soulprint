"use client";
import Link from "next/link";
import { useState } from "react";
import { useNear } from "@/components/NearProvider";
import { ErrorNote, Section, Stat, useAction, usePoll } from "@/components/ui";
import { Earnings } from "@/components/Earnings";
import { EvidenceError } from "@/lib/auth";
import { EVIDENCE_BASE, useEvidence } from "@/lib/evidence";
import { accounting, act, pieceInfo } from "@/lib/piece";
import { GRANT_TEXT, toUnits } from "@/lib/terms";
import { decimalsOf, money } from "@/lib/money";

const GATE: Record<string, string> = {
  not_owner: "Only the current owner of this piece can open its files.",
  not_settled: "The files open once the commission is complete.",
  transfer_pending: "A transfer of this piece is in progress. The files open again when it finishes.",
};

export function Vault({ pieceId }: { pieceId: string }) {
  const { chain, accountId, signer, config } = useNear();
  const evidence = useEvidence();
  const { data, reload } = usePoll(async () => {
    const [piece, acc, listing] = await Promise.all([pieceInfo(chain, pieceId), accounting(chain, pieceId), chain.view<any>(pieceId, "listing")]);
    return { piece, acc, listing };
  }, 5000, [pieceId]);
  const files = usePoll(
    () => (accountId ? evidence<{ files: { id: number; kind: string; name: string; url: string; sha256: string }[]; expiresIn: number }>("POST", `/pieces/${pieceId}/vault`, {}) : Promise.resolve(null)),
    240_000, // links last 300 s; refresh before they expire
    [pieceId, accountId, data?.piece.rotation_seq],
  );
  const [price, setPrice] = useState("");
  const [reserved, setReserved] = useState("");
  const { busy, error, run } = useAction();
  if (!data) return <p className="pt-10 text-ink-3">Loading…</p>;
  const { piece, acc, listing } = data;
  const d = config.currencyDecimals;
  const isOwner = accountId === piece.owner;
  const gate = files.error instanceof EvidenceError ? (GATE[files.error.code] ?? files.error.code) : null;

  return (
    <div className="space-y-6 pt-8">
      <div>
        <p className="label">Your piece · {piece.piece_id}</p>
        <h1 className="mt-2 font-display text-4xl tracking-tight">Piece {piece.token_id}</h1>
        <p className="mt-2 text-sm text-ink-2">
          By {piece.artist} · <Link className="underline" href={`/p/${pieceId}`}>proof page</Link>
        </p>
      </div>
      {!accountId && <div className="card">Sign in as the owner to open the files.</div>}
      {gate && (
        <div className="card border-seal/40" data-testid="vault-denied">
          {gate}
        </div>
      )}
      {files.data && (
        <Section title="Files" aside={<span className="text-xs text-ink-3">links last {Math.round(files.data.expiresIn / 60)} minutes</span>}>
          <ul className="space-y-2" data-testid="vault-files">
            {files.data.files.map((f) => (
              <li key={f.id} className="flex flex-wrap items-center justify-between gap-3">
                <span>
                  {f.name} <span className="text-xs text-ink-3">({f.kind === "final" ? "final file" : "source"})</span>
                </span>
                <a className="btn-ghost py-1" href={EVIDENCE_BASE + f.url}>
                  Download
                </a>
              </li>
            ))}
          </ul>
        </Section>
      )}
      <Section title="Your rights">
        <p className="text-sm">
          <b>{GRANT_TEXT[piece.grant.kind].title}</b>
          {piece.grant.attribution ? ", with credit to the artist" : ""}. {GRANT_TEXT[piece.grant.kind].plain}
        </p>
        {piece.addenda.length > 0 && <p className="mt-2 text-sm text-ink-2">{piece.addenda.length} later addition(s) to the rights are recorded on the piece.</p>}
        <p className="mt-2 text-sm text-ink-2">{piece.grant.transferable ? "These rights pass to whoever owns the piece next." : "These rights stay with you; they do not pass on with the piece."}</p>
      </Section>

      {isOwner && (
        <Section title="Income held for the holder">
          <div className="grid gap-6 sm:grid-cols-3">
            <Stat label="In the piece" value={<span data-testid="pool">{money(acc.holder_pool, acc.currency, d)}</span>} />
          </div>
          {BigInt(acc.holder_pool) > 0n && !listing && (
            <button className="btn-primary mt-4" disabled={!!busy} onClick={() => run("Withdrawing", async () => { await act(signer!, pieceId, "withdraw"); await reload(); })}>
              Withdraw to my credit
            </button>
          )}
          <p className="mt-2 text-xs text-ink-3">Income paid to the piece stays with it; whoever holds it can withdraw. While listed for sale it travels to the buyer.</p>
        </Section>
      )}

      {isOwner && piece.status === "Settled" && (
        <Section title="Sell">
          {listing ? (
            <div className="flex flex-wrap items-center gap-3">
              <span>
                Listed at <b>{money(listing.price, acc.currency, d)}</b>
                {listing.reserved_for ? ` for ${listing.reserved_for}` : ""}. Buy link: <code className="font-mono text-xs">/buy/{pieceId}</code>
              </span>
              <button className="btn-ghost" disabled={!!busy} onClick={() => run("Delisting", async () => { await act(signer!, pieceId, "delist"); await reload(); })}>
                Take off sale
              </button>
            </div>
          ) : (
            <div className="flex flex-wrap items-end gap-3">
              <label className="block">
                <span className="label">Price</span>
                <input className="field mt-1 w-40" inputMode="decimal" value={price} onChange={(e) => setPrice(e.target.value)} aria-label="Sale price" />
              </label>
              <label className="block">
                <span className="label">Only for (optional)</span>
                <input className="field mt-1 w-56" value={reserved} onChange={(e) => setReserved(e.target.value.trim())} aria-label="Reserved for" />
              </label>
              <button
                className="btn-seal"
                disabled={!price || !!busy}
                onClick={() => run("Listing", async () => {
                  await act(signer!, pieceId, "list", { price: toUnits(price, decimalsOf(acc.currency, d)).toString(), reserved_for: reserved || null });
                  await reload();
                })}
              >
                List for sale
              </button>
              <span className="w-full text-xs text-ink-3">The artist receives {piece.royalty_bps / 100}% of the sale price.</span>
            </div>
          )}
        </Section>
      )}
      <Earnings pieceId={pieceId} acc={acc} onChange={reload} />
      <ErrorNote error={error} />
    </div>
  );
}
