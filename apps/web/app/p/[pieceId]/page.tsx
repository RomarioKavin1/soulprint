import Link from "next/link";
import { sha256 } from "@noble/hashes/sha256";
import { b64 } from "@soulprint/proof";
import { loadConfig } from "@/lib/config";
import { ChainView } from "@/lib/near";
import { pieceInfo, proofPage, type PieceInfo, type ProofView } from "@/lib/piece";
import { displayLevel, proofModel } from "@/lib/proof";
import { ACTIVE_TIME_LABEL, BADGE_TEXT, bandText, issuerText, levelSentence } from "@/lib/wording";
import { jcs } from "@/lib/jcs";
import { RecomputeHash } from "@/components/proof/RecomputeHash";
import { Timeline } from "@/components/proof/Timeline";
import { Collect } from "@/components/collect/Collect";
import { ContextNotes } from "@/components/notes/ContextNotes";
import { Hung, mouldingFor, Plaque } from "@/components/salon/Frame";

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
    <div className="pt-16" data-testid="proof-unavailable">
      <h1 className="font-display text-[clamp(2.2rem,4vw,3.4rem)] leading-none tracking-[-0.015em]">The record could not be loaded just now</h1>
      <p className="mt-3 text-ink-2">The network is busy. Reload the page in a moment.</p>
    </div>
  );
}

export default async function ProofPage({ params }: { params: Promise<{ pieceId: string }> }) {
  const { pieceId } = await params;
  const config = loadConfig();
  if (!config) return <p className="pt-10">Not set up yet.</p>;
  const chain = new ChainView(config.rpcUrls);
  let piece: PieceInfo, proof: ProofView;
  try {
    [piece, proof] = await Promise.all([pieceInfo(chain, pieceId), proofPage(chain, pieceId)]);
  } catch (e) {
    // Only "that account does not exist" means there is no piece; anything else is the network.
    if (/does not exist|UNKNOWN_ACCOUNT|AccountDoesNotExist|CodeDoesNotExist|NO_CONTRACT_CODE/i.test(`${(e as Error)?.message ?? ""} ${JSON.stringify(e)}`))
      return <p className="pt-10 text-ink-2">There is no piece at {pieceId}.</p>;
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
      <div className="pt-16" data-testid="proof-private">
        <h1 className="font-display text-[clamp(2.2rem,4vw,3.4rem)] leading-none tracking-[-0.015em]">This page is private</h1>
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

  const name = pub.title || `Piece ${m.tokenId}`;
  const lastFrame = pub.frames.at(-1);
  const picture = pub.hasPreview
    ? { src: `/evidence/pieces/${pieceId}/preview`, alt: name, testId: "final-image" }
    : lastFrame
      ? { src: `/evidence/pieces/${pieceId}/frames/${encodeURIComponent(lastFrame.key)}/${lastFrame.index}`, alt: `${name}, the last frame of its making`, testId: undefined }
      : null;

  return (
    <article className="pt-12 sm:pt-16">
      <div className="grid items-start gap-x-14 gap-y-14 lg:grid-cols-12">
        <div className="piece-hang flex justify-center lg:col-span-7 lg:pt-6">
          <Hung
            moulding={mouldingFor(pieceId)}
            mat={!pub.hasPreview}
            testId={picture?.testId}
            plaque={<Plaque title={name} line={m.artist} level={`Level E${shown.level}`} />}
          >
            {picture ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={picture.src} alt={picture.alt} className="piece-img" />
            ) : (
              <span className="piece-img hang-blank">The artist kept the frames private</span>
            )}
          </Hung>
        </div>

        <header className="lg:col-span-5">
          <h1 className="font-display text-[clamp(2.4rem,4.6vw,4.4rem)] leading-[1] tracking-[-0.015em]" data-testid="piece-title">{name}</h1>
          <p className="mt-4 text-lg text-ink-2">
            by{" "}
            <Link className="text-ink underline" href={`/a/${piece.artist}`} data-testid="artist-link">{m.artist}</Link>
            {pub.title ? <span className="text-ink-3"> · piece {m.tokenId}</span> : null}
          </p>
          <p className="mt-8 font-display text-[1.65rem] italic leading-snug text-seal" data-testid="evidence-sentence">{sentence}.</p>
          <div className="mt-5 flex flex-wrap gap-2">
            {m.badge && <span className="chip" data-testid="badge">{BADGE_TEXT}</span>}
            <span className="font-plaque border border-rule px-3 py-1 text-[0.7rem] uppercase tracking-[0.16em] text-ink-2">Level E{shown.level}</span>
          </div>
          {shown.note && <p className="mt-4 border border-[color:var(--color-amber)] px-3 py-2 text-sm">{shown.note}</p>}
          {cap && (
            <dl className="card mt-8 grid gap-6 sm:grid-cols-2">
              <Fact k="Built up gradually" v={`${Math.round(cap.coverage * 100)}%`} bar={cap.coverage} sub="of the finished picture appeared step by step across the frames" />
              <Fact k="Largest single jump" v={`${Math.round(cap.largestJump * 100)}%`} bar={cap.largestJump} sub="the most of the picture that changed between two frames" />
              <Fact k="Active time" v={bandText(cap.activeBand)} sub={ACTIVE_TIME_LABEL} />
              <Fact k="Sessions" v={`${cap.sessions} over ${Math.max(1, Math.round(cap.spanDays))} day${Math.round(cap.spanDays) <= 1 ? "" : "s"}`} sub={`${cap.frames} frames measured, ${cap.anchoredCount} in the chain anchored on-chain`} />
              <p className="text-xs text-ink-3 sm:col-span-2">
                A long session drawn step by step reads high on the first and low on the second. Short recordings, zooming or moving the canvas read as
                large jumps — facts about the recording, not a grade of the work.
              </p>
            </dl>
          )}
        </header>
      </div>

      <div className="mx-auto mt-24 max-w-5xl space-y-12">
        <section className="card">
          <h2 className="font-display text-3xl">The making</h2>
          <div className="mt-6">
            <Timeline pieceId={pieceId} frames={pub.frames} />
          </div>
          {pub.story && (
            <blockquote className="pull-quote mt-8 font-display text-xl italic leading-relaxed text-ink-2">{pub.story}</blockquote>
          )}
        </section>

        <Collect pieceId={pieceId} />

        <ContextNotes pieceId={pieceId} artist={piece.artist} />

        {challenges.length > 0 && (
          <section className="card">
            <h2 className="font-display text-3xl">Live checks</h2>
            <ul className="mt-4 space-y-2 text-sm">
              {challenges.map((c, i) => (
                <li key={i}>
                  Code <code className="font-mono">{c.code}</code> requested by {issuerText(c.issuerClass)}:{" "}
                  <b>{c.result === "passed" ? "appeared in the work in time" : c.result === "inconclusive" ? "could not be read automatically" : c.result === "expired" ? "did not appear in time" : "not acknowledged"}</b>
                </li>
              ))}
            </ul>
          </section>
        )}

        <section className="card">
          <h2 className="font-display text-3xl">Rights</h2>
          <p className="mt-3">{m.rights}</p>
          <p className="mt-1 text-sm text-ink-2">{m.royalty} Current holder: {m.owner}.</p>
        </section>

        <section className="card" id="verify">
          <h2 className="font-display text-3xl">Verify on-chain</h2>
          <dl className="mt-5 grid gap-5 text-sm sm:grid-cols-2">
            <V k="Piece account" v={piece.piece_id} />
            <V k="Collection" v={config.collection} />
            <V k="Piece code hash" v={info.piece_code_hash} />
            <V k="Report fingerprint on the piece" v={piece.report_hash ?? "—"} />
            <V k="Final file fingerprint" v={piece.final_file_hash ?? "—"} />
            <V k="Attesting key" v={`#${proof.attestation.key_id}${revokedIds.includes(proof.attestation.key_id) ? " (withdrawn)" : ""}, thresholds ${pub.public.thresholds}`} />
            {proof.segments.map((s, i) => (
              <V key={s.key} k={`Recording device ${i + 1}`} v={`${s.key} — ${s.count} frames anchored, head ${s.head}`} />
            ))}
          </dl>
          <div className="mt-5">
            <RecomputeHash report={pub.public} onChain={piece.report_hash} />
          </div>
          <details className="mt-4 text-xs">
            <summary className="cursor-pointer text-ink-2">The full public report</summary>
            <pre className="mt-2 max-h-80 overflow-auto bg-paper-2 p-3 font-mono">{JSON.stringify(pub.public, null, 2)}</pre>
          </details>
        </section>

        <p className="text-center text-sm text-ink-2">
          This is evidence, not proof. <Link className="text-ink underline" href="/limits">What a record does and does not show</Link>.
        </p>
      </div>
    </article>
  );
}

function Fact({ k, v, sub, bar }: { k: string; v: string; sub?: string; bar?: number }) {
  return (
    <div>
      <dt className="label">{k}</dt>
      <dd className="mt-1 font-display text-3xl">{v}</dd>
      {bar !== undefined && (
        <div className="mt-2 h-1 bg-paper-2" aria-hidden>
          <div className="h-1 bg-ink-3" style={{ width: `${Math.min(100, Math.max(2, bar * 100))}%` }} />
        </div>
      )}
      {sub && <dd className="mt-1 text-xs text-ink-3">{sub}</dd>}
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
