"use client";
import Link from "next/link";
import { useState } from "react";

import { useNear } from "@/components/NearProvider";
import { ErrorNote, Section, Stat, usePoll, when } from "@/components/ui";
import { Earnings } from "@/components/Earnings";
import { History } from "@/components/History";
import { accounting, act, pieceInfo, terms as termsView, STATUS_TEXT, STORAGE_DEPOSIT, type PieceInfo } from "@/lib/piece";
import { actionsFor, explainRace, extendDeadlineNs, fundCall, rejectCall, rejectConfirmText, tokenOf, type Action, type Call } from "@/lib/commission";
import { GRANT_TEXT, licenceHash, type GrantKind } from "@/lib/terms";
import { b64 } from "@soulprint/proof";
import { money } from "@/lib/money";
import { useEvidence } from "@/lib/evidence";
import { TermsCard } from "./TermsCard";
import { Notes } from "./Notes";
import { Progress } from "./Progress";

export function Room({ pieceId }: { pieceId: string }) {
  const { chain, accountId, signer, config } = useNear();
  const evidence = useEvidence();
  const { data, error: loadError, reload } = usePoll(
    async () => {
      const [piece, t, acc] = await Promise.all([pieceInfo(chain, pieceId), termsView(chain, pieceId), accounting(chain, pieceId)]);
      const balance =
        accountId && t && tokenOf(t.currency) ? BigInt(await chain.view<string>(tokenOf(t.currency)!, "ft_balance_of", { account_id: accountId })) : null;
      return { piece, t, acc, balance };
    },
    4000,
    [pieceId, accountId],
  );
  const [confirm, setConfirm] = useState<Action | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [splitPct, setSplitPct] = useState(50);
  const [newDate, setNewDate] = useState("");
  const [addKind, setAddKind] = useState<GrantKind>("CommercialNonExclusive");
  const [addText, setAddText] = useState("");
  // Arbitrator award: empty or out of range is not a decision (Plan 3 review, minor 1 re-graded).
  const [award, setAward] = useState("");
  const awardNum = award.trim() === "" ? NaN : Number(award);
  const awardBps = Number.isFinite(awardNum) && awardNum >= 0 && awardNum <= 100 ? Math.round(awardNum * 100) : null;

  if (loadError && !data) return <p className="pt-10 text-seal-2">This piece could not be found on the network.</p>;
  if (!data) return <p className="pt-10 text-ink-3">Loading…</p>;
  const { piece, t, acc, balance } = data;
  const d = config.currencyDecimals;
  const actions = actionsFor(piece, t, accountId, Date.now());
  const isParty = accountId === piece.owner || accountId === piece.artist;

  async function step(label: string, f: () => Promise<unknown>) {
    const before = piece.status;
    setBusy(label);
    setError(null);
    setNotice(null);
    try {
      await f();
      setConfirm(null);
    } catch (e) {
      const fresh: PieceInfo | null = await pieceInfo(chain, pieceId).catch(() => null);
      const race = fresh && explainRace(e, fresh, before);
      if (race) setNotice(race);
      else setError(e);
      setConfirm(null);
    } finally {
      setBusy(null);
      await reload();
    }
  }
  const send = (c: Call) => signer!.call(c.contract, c.method, c.args, { deposit: c.deposit, tgas: c.tgas });

  const price = BigInt(piece.price);
  const short = balance !== null && balance < price;
  const stage = piece.released_milestones;

  return (
    <div className="space-y-8 pt-12">
      <div>
        <div className="flex flex-wrap items-baseline justify-between gap-4">
          <h1 className="font-display text-[clamp(2.2rem,4vw,3.4rem)] leading-none tracking-[-0.015em]">Piece {piece.token_id}</h1>
          <span className="chip" data-testid="room-status">
            {STATUS_TEXT[piece.status]}
          </span>
        </div>
        <p className="mt-3 text-sm text-ink-3">Commission from {piece.artist}</p>
        {accountId === piece.artist && (
          <Link className="mt-3 inline-block text-sm underline" href={`/studio/${pieceId}`}>
            Open your workspace for this piece
          </Link>
        )}
      </div>

      <div className="card grid gap-6 sm:grid-cols-4">
        <Stat label="Price" value={money(price, piece.currency, d)} />
        <Stat label="Held in the piece" value={<span data-testid="escrow">{money(acc.escrow, acc.currency, d)}</span>} />
        <Stat label={piece.status === "Delivered" ? "Review ends" : "Deadline"} value={when(piece.status === "Delivered" ? piece.review_ends_at : piece.deadline)} />
        <Stat label="Owner" value={<span className="break-all text-base">{piece.owner === piece.artist ? "the artist (until paid)" : piece.owner}</span>} />
      </div>

      {notice && (
        <p role="status" className="rounded-sm border border-amber/40 bg-amber/10 px-4 py-3 text-sm" data-testid="race-notice">
          {notice}
        </p>
      )}

      {!accountId && <div className="card">Sign in to pay, follow progress and talk to the artist.</div>}

      {actions.length > 0 && t && (
        <Section title="What you can do now">
          <div className="flex flex-wrap gap-3">
            {actions.includes("fund") && (
              <>
                {short && config.network !== "mainnet" && tokenOf(piece.currency) === config.currencyToken && (
                  <button className="btn-ghost" disabled={!!busy} onClick={() => step("Getting test USDC", () => signer!.call(config.currencyToken, "faucet", { amount: (1000n * 10n ** BigInt(d)).toString() }, { tgas: 30n }))}>
                    Get test USDC
                  </button>
                )}
                <button className="btn-seal" data-testid="fund" disabled={!!busy || short} onClick={() => step("Paying", () => send(fundCall(piece, t, tokenOf(piece.currency) ?? "")))}>
                  Pay {money(price, piece.currency, d)} into the piece
                </button>
                {balance !== null && <span className="self-center text-sm text-ink-3">You have {money(balance, piece.currency, d)}</span>}
              </>
            )}
            {actions.includes("accept") &&
              (confirm === "accept" ? (
                <Confirm text="Accepting releases the rest of the payment to the artist and makes the piece and its rights yours." yes="Accept the piece" busy={busy} onYes={() => step("Accepting", () => act(signer!, pieceId, "accept"))} onNo={() => setConfirm(null)} />
              ) : (
                <button className="btn-seal" data-testid="accept" disabled={!!busy} onClick={() => setConfirm("accept")}>
                  Accept
                </button>
              ))}
            {actions.includes("request_changes") && (
              <button className="btn-ghost" disabled={!!busy} onClick={() => step("Requesting changes", () => act(signer!, pieceId, "request_changes"))}>
                Ask for changes ({t.revision_rounds - piece.revisions_used} left)
              </button>
            )}
            {actions.includes("reject") &&
              (confirm === "reject" ? (
                <Confirm text={rejectConfirmText(piece, t, d)} yes="Refuse and send the deposit" busy={busy} danger onYes={() => step("Refusing", () => send(rejectCall(piece, t, tokenOf(piece.currency) ?? "")))} onNo={() => setConfirm(null)} />
              ) : (
                <button className="btn-ghost text-seal-2" data-testid="reject" disabled={!!busy} onClick={() => setConfirm("reject")}>
                  Refuse the delivery
                </button>
              ))}
            {actions.includes("release_milestone") && (
              <button className="btn-ghost" disabled={!!busy} onClick={() => step("Releasing", () => act(signer!, pieceId, "release_milestone", { index: stage }))}>
                Release stage {stage + 1} ({money((price * BigInt(t.milestones[stage]!.bps)) / 10000n, piece.currency, d)})
              </button>
            )}
            {actions.includes("challenge") && (
              <button
                className="btn-ghost"
                disabled={!!busy}
                onClick={() =>
                  step("Asking for a code", async () => {
                    const { nonceHash } = await evidence<{ nonceHash: string }>("POST", `/pieces/${pieceId}/challenges`);
                    await signer!.call(pieceId, "issue_challenge", { nonce_hash: nonceHash }, { deposit: STORAGE_DEPOSIT, tgas: 50n });
                    setNotice("Code requested. The artist sees it now and has a few minutes to put it in the work while recording.");
                  })
                }
              >
                Ask for a live code
              </button>
            )}
            {actions.includes("settle") && (
              <button className="btn-ghost" disabled={!!busy} onClick={() => step("Completing", () => signer!.call(pieceId, "settle", {}, { tgas: 100n }))}>
                Complete (review time is over)
              </button>
            )}
            {actions.includes("refund") && (
              <button className="btn-seal" data-testid="refund" disabled={!!busy} onClick={() => step("Refunding", () => act(signer!, pieceId, "claim_refund"))}>
                Get a refund — the deadline passed without delivery
              </button>
            )}
            {actions.includes("propose_split") && (
              <span className="flex items-center gap-2">
                <input className="field w-20" type="number" min={0} max={100} value={splitPct} onChange={(e) => setSplitPct(Number(e.target.value))} aria-label="Artist share" />
                <span className="text-sm">% to the artist</span>
                <button className="btn-ghost" disabled={!!busy} onClick={() => step("Proposing", () => act(signer!, pieceId, "propose_split", { artist_bps: splitPct * 100 }))}>
                  Propose this split
                </button>
              </span>
            )}
            {actions.includes("accept_split") && piece.split && (
              <button className="btn-seal" disabled={!!busy} onClick={() => step("Agreeing", () => act(signer!, pieceId, "accept_split", { expected_artist_bps: piece.split!.artist_bps, proposal_nonce: piece.split!.nonce }))}>
                Agree: {piece.split.artist_bps / 100}% to the artist, the rest back to the client
              </button>
            )}
            {actions.includes("resolve") &&
              (confirm === "resolve" && awardBps !== null ? (
                <Confirm
                  text={`You award ${money((BigInt(acc.escrow) * BigInt(awardBps)) / 10000n, piece.currency, d)} to the artist and ${money(BigInt(acc.escrow) - (BigInt(acc.escrow) * BigInt(awardBps)) / 10000n, piece.currency, d)} to the client. This decision is final.`}
                  yes="Decide"
                  busy={busy}
                  onYes={() => step("Deciding", () => act(signer!, pieceId, "resolve", { artist_bps: awardBps }))}
                  onNo={() => setConfirm(null)}
                />
              ) : (
                <span className="flex items-center gap-2">
                  <span className="text-sm">As arbitrator, award</span>
                  <input className="field w-20" type="number" min={0} max={100} value={award} onChange={(e) => setAward(e.target.value)} aria-label="Award to the artist" />
                  <span className="text-sm">% to the artist</span>
                  <button className="btn-seal" disabled={!!busy || awardBps === null} onClick={() => setConfirm("resolve")}>
                    Decide
                  </button>
                </span>
              ))}
            {actions.includes("timeout_resolve") && (
              <button className="btn-ghost" disabled={!!busy} onClick={() => step("Closing", () => signer!.call(pieceId, "timeout_resolve", {}, { deposit: STORAGE_DEPOSIT, tgas: 100n }))}>
                Close the dispute with the agreed fallback split ({t.timeout_artist_bps / 100}% to the artist)
              </button>
            )}
            {actions.includes("cancel_offer") &&
              (confirm === "cancel_offer" ? (
                <Confirm text="Cancel this offer? Nobody has paid yet; the piece closes and cannot be paid for." yes="Cancel the offer" busy={busy} danger onYes={() => step("Cancelling", () => act(signer!, pieceId, "cancel"))} onNo={() => setConfirm(null)} />
              ) : (
                <button className="btn-ghost text-ink-3" disabled={!!busy} onClick={() => setConfirm("cancel_offer")}>
                  Cancel this offer
                </button>
              ))}
            {actions.includes("extend") && (
              <span className="flex items-center gap-2">
                <input className="field w-44" type="date" value={newDate} onChange={(e) => setNewDate(e.target.value)} aria-label="New deadline" />
                <button className="btn-ghost" disabled={!newDate || !!busy} onClick={() => step("Proposing", async () => { await act(signer!, pieceId, "consent_extend", { new_deadline: extendDeadlineNs(newDate).toString() }); setNotice("Saved. The deadline moves once the other side picks the same date."); })}>
                  Agree a new deadline
                </button>
              </span>
            )}
            {actions.includes("propose_addendum") && (
              <span className="flex w-full flex-wrap items-center gap-2">
                <select className="field w-auto" value={addKind} onChange={(e) => setAddKind(e.target.value as GrantKind)} aria-label="Wider rights">
                  {(Object.keys(GRANT_TEXT) as GrantKind[]).map((k) => <option key={k} value={k}>{GRANT_TEXT[k].title}</option>)}
                </select>
                <input className="field w-64" placeholder="What changes (optional)" value={addText} onChange={(e) => setAddText(e.target.value)} aria-label="Rights note" />
                <button className="btn-ghost" disabled={!!busy} onClick={() => step("Proposing", () => { const grant = { ...piece.grant, kind: addKind }; return act(signer!, pieceId, "propose_addendum", { grant, text_hash: b64.encode(licenceHash(addText, grant)) }); })}>
                  Offer wider rights
                </button>
              </span>
            )}
            {actions.includes("accept_addendum") && !!piece.pending_addendum && (
              <button className="btn-seal" disabled={!!busy} onClick={() => step("Accepting", () => act(signer!, pieceId, "accept_addendum", { expected_hash: (piece.pending_addendum as any).text_hash }))}>
                Accept wider rights: {GRANT_TEXT[(piece.pending_addendum as any).grant.kind as GrantKind].title}
              </button>
            )}
            {actions.includes("mutual_cancel") && (
              <button className="btn-ghost text-ink-3" disabled={!!busy} onClick={() => step("Cancelling", () => act(signer!, pieceId, "consent_mutual_cancel"))}>
                Agree to cancel (both must agree)
              </button>
            )}
          </div>
          {busy && <p className="mt-3 text-sm text-ink-3">{busy}…</p>}
          <ErrorNote error={error} />
        </Section>
      )}
      {/* The actions box closes when the piece moves on; a failed step must still say so (testnet E2E). */}
      {!(actions.length > 0 && t) && error ? <ErrorNote error={error} /> : null}

      {piece.status === "Disputed" && (
        <div className="card text-sm">
          In dispute since {when(piece.disputed_at)} · stage: {piece.dispute_stage ?? "negotiation"}. {piece.split ? `${piece.split.by} proposed ${piece.split.artist_bps / 100}% to the artist.` : ""}
        </div>
      )}
      {piece.status === "Settled" && accountId === piece.owner && (
        <div className="card flex flex-wrap items-center justify-between gap-3">
          <span>The piece and its rights are yours.</span>
          <span className="flex gap-2">
            <Link className="btn-primary" href={`/vault/${pieceId}`}>Open your files</Link>
            <Link className="btn-ghost" href={`/p/${pieceId}`}>Proof page</Link>
            <button className="btn-ghost" onClick={() => window.print()}>Print a receipt</button>
          </span>
        </div>
      )}

      <Earnings pieceId={pieceId} acc={acc} onChange={reload} />
      {isParty && piece.owner !== piece.artist && <Progress pieceId={pieceId} />}
      {t && <TermsCard t={t} decimals={d} />}
      <History pieceId={pieceId} currency={piece.currency} decimals={d} />
      {isParty && piece.owner !== piece.artist && <Notes pieceId={pieceId} artist={piece.artist} />}
    </div>
  );
}

function Confirm({ text, yes, onYes, onNo, busy, danger }: { text: string; yes: string; onYes: () => void; onNo: () => void; busy: string | null; danger?: boolean }) {
  return (
    <div className="w-full rounded-sm border border-rule bg-paper-2/70 p-4" data-testid="confirm">
      <p className="text-sm">{text}</p>
      <div className="mt-3 flex gap-2">
        <button className={danger ? "btn-seal" : "btn-primary"} disabled={!!busy} onClick={onYes} data-testid="confirm-yes">
          {yes}
        </button>
        <button className="btn-ghost" onClick={onNo}>
          Not now
        </button>
      </div>
    </div>
  );
}

