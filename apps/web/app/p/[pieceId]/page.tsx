import Link from "next/link";
import { sha256 } from "@noble/hashes/sha256";
import { b64 } from "@soulprint/proof";
import { loadConfig } from "@/lib/config";
import { ChainView } from "@/lib/near";
import { pieceInfo, proofPage, type PieceInfo, type ProofView } from "@/lib/piece";
import { displayLevel, proofModel } from "@/lib/proof";
import { ACTIVE_TIME_LABEL, BADGE_TEXT, bandText, issuerText, levelSentence } from "@/lib/wording";
import { jcs } from "@/lib/jcs";
import { levelReasons } from "@/lib/levelReason";
import { RecomputeHash } from "@/components/proof/RecomputeHash";
import { Collect } from "@/components/collect/Collect";
import { ContextNotes } from "@/components/notes/ContextNotes";
import { mouldingFor } from "@/components/salon/Frame";
import { PieceRecord } from "@/components/piece/PieceRecord";
import { Provenance } from "@/components/piece/Provenance";

export const dynamic = "force-dynamic";

interface Published {
  public: any;
  reportHash: string;
  frames: { key: string; index: number; deviceTs: number }[];
  story: string | null;
  title?: string | null;
  hasPreview?: boolean;
}

function Unavailable() {
  return (
    <div className="page-top" data-testid="proof-unavailable">
      <h1 className="title-page">The record could not be loaded just now</h1>
      <p className="mt-3 text-ink-2">The network is busy. Reload the page in a moment.</p>
    </div>
  );
}

export default async function ProofPage({ params }: { params: Promise<{ pieceId: string }> }) {
  const { pieceId } = await params;
  const config = loadConfig();
  if (!config) return <p className="page-top">Not set up yet.</p>;
  const chain = new ChainView(config.rpcUrls);
  let piece: PieceInfo, proof: ProofView;
  try {
    [piece, proof] = await Promise.all([pieceInfo(chain, pieceId), proofPage(chain, pieceId)]);
  } catch (e) {
    // Only "that account does not exist" means there is no piece; anything else is the network.
    if (/does not exist|UNKNOWN_ACCOUNT|AccountDoesNotExist|CodeDoesNotExist|NO_CONTRACT_CODE/i.test(`${(e as Error)?.message ?? ""} ${JSON.stringify(e)}`))
      return <p className="page-top text-ink-2">There is no piece at {pieceId}.</p>;
    return <Unavailable />;
  }
  // 404 = not published. Anything else (503 while the network is busy, a timeout) is not "private"
  // (testnet E2E: a published record was shown as private during an RPC rate limit).
  let pub: Published | null = null;
  for (let i = 0; i < 3; i++) {
    const r = await fetch(`${config.evidenceUrl}/pieces/${pieceId}/public`, { cache: "no-store" }).catch(() => null);
    if (r?.ok) {
      pub = (await r.json()) as Published;
      break;
    }
    if (r?.status === 404) break;
    if (i === 2) return <Unavailable />;
    await new Promise((res) => setTimeout(res, 1500 * (i + 1)));
  }
  if (!pub)
    return (
      <div className="page-top" data-testid="proof-private">
        <h1 className="title-page">This page is private</h1>
        <p className="mt-3 text-ink-2">The artist hasn&apos;t published the record for this piece.</p>
      </div>
    );

  const [info, keys, revoked] = await Promise.all([
    chain.view(config.collection, "collection_info"),
    chain.view<any[]>(config.collection, "verifier_keys"),
    chain.view<any[]>(config.collection, "revoked_keys"),
  ]);
  const revokedIds = [...revoked.map((k) => k.id), ...keys.filter((k) => k.revoked_at).map((k) => k.id)];
  const recomputed = b64.encode(sha256(new TextEncoder().encode(jcs(pub.public))));
  const shown = displayLevel(proof.attestation, revokedIds, piece.report_hash, recomputed);
  const cap = pub.public.capture;
  const challenges: { result: string; issuerClass: string; code: string }[] = pub.public.challenges ?? [];
  const m = proofModel({ piece });
  const sentence = levelSentence(shown.level, cap ? { coverage: cap.coverage, activeBand: cap.activeBand, spanDays: cap.spanDays, source: cap.source } : null, challenges);

  // Why the record sits at its level — only when the level shown is the one the report gave.
  const reasons = shown.level === pub.public.level
    ? levelReasons(shown.level, pub.public.thresholds, cap, challenges.filter((c) => c.result === "passed" && c.issuerClass !== "artist").length)
    : [];
  const measured = !!cap && cap.frames > 0;

  const name = pub.title || `Piece ${m.tokenId}`;
  const lastFrame = pub.frames.at(-1);
  const picture = pub.hasPreview
    ? { src: `/evidence/pieces/${pieceId}/preview`, alt: name, testId: "final-image" }
    : lastFrame
      ? { src: `/evidence/pieces/${pieceId}/frames/${encodeURIComponent(lastFrame.key)}/${lastFrame.index}`, alt: `${name}, the last frame of its making`, testId: undefined }
      : null;

  // Questions readers found useful, for the tab label (the tab itself loads the live list).
  const shownQuestions = await fetch(`${config.evidenceUrl}/pieces/${pieceId}/context-notes`, { cache: "no-store" })
    .then((r) => (r.ok ? (r.json() as Promise<{ notes: { status: string }[] }>) : null))
    .then((d) => d?.notes.filter((n) => n.status === "shown").length ?? 0)
    .catch(() => 0);

  const header = (
    <header>
      <h1 className="title-display piece-title" data-testid="piece-title">{name}</h1>
      <p className="mt-3 text-lg text-ink-2">
        by{" "}
        <Link className="text-ink underline" href={`/a/${piece.artist}`} data-testid="artist-link">{m.artist}</Link>
        {pub.title ? <span className="text-ink-3"> · piece {m.tokenId}</span> : null}
      </p>
      <p className="piece-sentence" data-testid="evidence-sentence">{sentence}.</p>
      <div className="mt-4 flex flex-wrap items-center gap-2">
        <span className="font-plaque border border-rule px-3 py-1 text-[0.7rem] uppercase tracking-[0.16em] text-ink-2">Level E{shown.level}</span>
        {m.badge && <span className="chip" data-testid="badge">{BADGE_TEXT}</span>}
      </div>
      {shown.note && <p className="mt-4 border border-[color:var(--color-amber)] px-3 py-2 text-sm">{shown.note}</p>}
      {reasons.map((t) => <p key={t} className="mt-4 max-w-[60ch] text-ink-2" data-testid="level-reason">{t}</p>)}
    </header>
  );

  const record = (
    <div>
      {cap && !measured && (
        <p className="text-ink-2" data-testid="facts-unmeasured">
          {plural(cap.anchoredCount ?? 0, "frame")} of this piece {(cap.anchoredCount ?? 0) === 1 ? "is" : "are"} anchored on-chain, but none could be measured
          {cap.undecodableFrames ? ` (${cap.undecodableFrames} could not be read)` : ""}, so there are no facts about how it built up.
        </p>
      )}
      {!cap && <p className="text-ink-2">No recording of the making was kept with this piece, so the record has no facts about how it built up.</p>}
      {measured && (
        <>
          <dl className="facts">
            <Fact k="Built up gradually" v={`${Math.round(cap.coverage * 100)}%`} bar={cap.coverage} sub="of the finished picture appeared step by step across the frames" />
            <Fact k="Largest single jump" v={`${Math.round(cap.largestJump * 100)}%`} bar={cap.largestJump} sub="the most of the picture that changed between two frames" />
            <Fact k="Active time" v={bandText(cap.activeBand)} sub={ACTIVE_TIME_LABEL} />
            <Fact k="Sessions" v={`${cap.sessions} over ${Math.max(1, Math.round(cap.spanDays))} day${Math.round(cap.spanDays) <= 1 ? "" : "s"}`} sub={`${plural(cap.frames, "frame")} measured, ${cap.anchoredCount} anchored on-chain`} />
          </dl>
          <details className="fold mt-4">
            <summary>How to read these facts</summary>
            <p className="mt-2 text-sm text-ink-2">
              A long session drawn step by step reads high on the first and low on the second. Short recordings, zooming or moving the canvas read as
              large jumps — facts about the recording, not a grade of the work.
            </p>
          </details>
        </>
      )}

      {challenges.length > 0 && (
        <div className="mt-8">
          <h3 className="label">Live checks</h3>
          <ul className="mt-2 space-y-2 text-sm">
            {challenges.map((c, i) => (
              <li key={i}>
                Code <code className="font-mono">{c.code}</code> requested by {issuerText(c.issuerClass)}:{" "}
                <b>{c.result === "passed" ? "appeared in the work in time" : c.result === "inconclusive" ? "could not be read automatically" : c.result === "expired" ? "did not appear in time" : "not acknowledged"}</b>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="mt-8 border-t border-rule pt-5">
        <RecomputeHash report={pub.public} onChain={piece.report_hash} />
        <details className="fold mt-4" id="verify">
          <summary>On-chain details</summary>
          <dl className="mt-4 grid gap-5 text-sm sm:grid-cols-2">
            <V k="Piece account" v={piece.piece_id} />
            <V k="Collection" v={config.collection} />
            <V k="Piece code hash" v={info.piece_code_hash} />
            <V k="Report fingerprint on the piece" v={piece.report_hash ?? "—"} />
            <V k="Final file fingerprint" v={piece.final_file_hash ?? "—"} />
            <V k="Attesting key" v={`#${proof.attestation.key_id}${revokedIds.includes(proof.attestation.key_id) ? " (withdrawn)" : ""}, thresholds ${pub.public.thresholds}`} />
            {proof.segments.map((s, i) => (
              <V key={s.key} k={`Recording device ${i + 1}`} v={`${s.key} — ${plural(s.count, "frame")} anchored, head ${s.head}`} />
            ))}
          </dl>
          <details className="fold mt-4 text-xs">
            <summary>The full public report</summary>
            <pre className="mt-2 max-h-80 overflow-auto bg-paper-2 p-3 font-mono">{JSON.stringify(pub.public, null, 2)}</pre>
          </details>
        </details>
      </div>
      <p className="mt-6 text-sm text-ink-2">
        This is evidence, not proof. <Link className="text-ink underline" href="/limits">What a record does and does not show</Link>.
      </p>
    </div>
  );

  const rights = (
    <div>
      <p className="text-[1.05rem]">{m.rights}</p>
      <p className="mt-2 text-sm text-ink-2">{m.royalty} Current holder: {m.owner}.</p>
    </div>
  );

  return (
    <article className="page-top">
      <PieceRecord
        pieceId={pieceId}
        name={name}
        artist={m.artist}
        moulding={mouldingFor(pieceId)}
        mat={!pub.hasPreview}
        picture={picture}
        frames={pub.frames}
        story={pub.story}
        header={header}
        actions={<Collect pieceId={pieceId} inline />}
        tabs={[
          { id: "record", label: "The record", content: record },
          { id: "provenance", label: "Provenance", content: <Provenance pieceId={pieceId} artist={piece.artist} currency={piece.currency} decimals={config.currencyDecimals} /> },
          { id: "questions", label: shownQuestions > 0 ? `Questions · ${shownQuestions}` : "Questions", content: <ContextNotes pieceId={pieceId} artist={piece.artist} bare /> },
          { id: "rights", label: "Rights", content: rights },
        ]}
      />
    </article>
  );
}

function plural(n: number, word: string) {
  return `${n} ${word}${n === 1 ? "" : "s"}`;
}

function Fact({ k, v, sub, bar }: { k: string; v: string; sub?: string; bar?: number }) {
  return (
    <div className="fact">
      <dt className="label">{k}</dt>
      <dd>
        <span className="fact-figure">{v}</span>
        {bar !== undefined && (
          <span className="fact-bar" aria-hidden><span style={{ width: `${Math.min(100, Math.max(0, bar * 100))}%` }} /></span>
        )}
        {sub && <span className="fact-sub">{sub}</span>}
      </dd>
    </div>
  );
}
function V({ k, v }: { k: string; v: string }) {
  return (
    <div>
      <dt className="label">{k}</dt>
      <dd className="mt-1 break-all font-mono text-xs">{v}</dd>
    </div>
  );
}
