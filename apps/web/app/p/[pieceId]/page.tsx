import Link from "next/link";
import { sha256 } from "@noble/hashes/sha256";
import { b64 } from "@soulprint/proof";
import { loadConfig } from "@/lib/config";
import { ChainView } from "@/lib/near";
import { pieceInfo, proofPage, type PieceInfo, type ProofView } from "@/lib/piece";
import { displayLevel, proofModel } from "@/lib/proof";
import { ACTIVE_TIME_LABEL, BADGE_TEXT, issuerText, levelSentence } from "@/lib/wording";
import { jcs } from "@/lib/jcs";
import { RecomputeHash } from "@/components/proof/RecomputeHash";
import { Timeline } from "@/components/proof/Timeline";
import { Collect } from "@/components/collect/Collect";

export const dynamic = "force-dynamic";

interface Published {
  public: any;
  reportHash: string;
  frames: { key: string; index: number; deviceTs: number }[];
  story: string | null;
}

function Unavailable() {
  return (
    <div className="pt-16" data-testid="proof-unavailable">
      <p className="label">Proof page</p>
      <h1 className="mt-2 font-display text-4xl">The record could not be loaded just now</h1>
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
        <p className="label">Proof page</p>
        <h1 className="mt-2 font-display text-4xl">This page is private</h1>
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

  return (
    <article className="space-y-8 pt-10">
      <header>
        <p className="label">
          Piece {m.tokenId} by{" "}
          <Link className="underline" href={`/a/${piece.artist}`} data-testid="artist-link">
            {m.artist}
          </Link>
        </p>
        <h1 className="mt-3 max-w-3xl font-display text-3xl leading-tight sm:text-4xl" data-testid="evidence-sentence">
          {sentence}.
        </h1>
        <div className="mt-4 flex flex-wrap gap-2">
          {m.badge && (
            <span className="rounded-full bg-seal px-3 py-1 text-sm text-paper" data-testid="badge">
              {BADGE_TEXT}
            </span>
          )}
          <span className="rounded-full border border-rule px-3 py-1 text-sm">Level E{shown.level}</span>
        </div>
        {shown.note && <p className="mt-3 rounded-lg border border-amber/40 bg-amber/10 px-3 py-2 text-sm">{shown.note}</p>}
      </header>

      {cap && (
        <section className="card grid gap-6 sm:grid-cols-4">
          <Fact k="Built up gradually" v={`${Math.round(cap.coverage * 100)}%`} bar={cap.coverage} />
          <Fact k="Largest single jump" v={`${Math.round(cap.largestJump * 100)}%`} bar={cap.largestJump} />
          <Fact k="Active time" v={cap.activeBand} sub={ACTIVE_TIME_LABEL} />
          <Fact k="Sessions" v={`${cap.sessions} over ${Math.max(1, Math.round(cap.spanDays))} day${Math.round(cap.spanDays) <= 1 ? "" : "s"}`} sub={`${cap.frames} frames, ${cap.anchoredCount} anchored`} />
        </section>
      )}

      <section className="card">
        <h2 className="font-display text-xl">The making</h2>
        <div className="mt-4">
          <Timeline pieceId={pieceId} frames={pub.frames} />
        </div>
        {pub.story && (
          <blockquote className="mt-6 border-l-2 border-seal pl-4 font-display text-lg italic text-ink-2">{pub.story}</blockquote>
        )}
      </section>

      <Collect pieceId={pieceId} />

      {challenges.length > 0 && (
        <section className="card">
          <h2 className="font-display text-xl">Live checks</h2>
          <ul className="mt-3 space-y-2 text-sm">
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
        <h2 className="font-display text-xl">Rights</h2>
        <p className="mt-2 text-sm">{m.rights}</p>
        <p className="mt-1 text-sm text-ink-2">{m.royalty} Current holder: {m.owner}.</p>
      </section>

      <section className="card" id="verify">
        <h2 className="font-display text-xl">Verify on-chain</h2>
        <dl className="mt-3 grid gap-4 text-sm sm:grid-cols-2">
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
        <div className="mt-4">
          <RecomputeHash report={pub.public} onChain={piece.report_hash} />
        </div>
        <details className="mt-3 text-xs">
          <summary className="cursor-pointer text-ink-2">The full public report</summary>
          <pre className="mt-2 max-h-80 overflow-auto rounded-lg bg-paper-2 p-3">{JSON.stringify(pub.public, null, 2)}</pre>
        </details>
      </section>

      <p className="text-sm text-ink-2">
        This is evidence, not proof. <Link className="underline" href="/limits">What a record does and does not show</Link>.
      </p>
    </article>
  );
}

function Fact({ k, v, sub, bar }: { k: string; v: string; sub?: string; bar?: number }) {
  return (
    <div>
      <p className="label">{k}</p>
      <p className="mt-1 font-display text-2xl">{v}</p>
      {bar !== undefined && (
        <div className="mt-2 h-1.5 rounded-full bg-paper-2">
          <div className="h-1.5 rounded-full bg-seal" style={{ width: `${Math.min(100, Math.max(2, bar * 100))}%` }} />
        </div>
      )}
      {sub && <p className="mt-1 text-xs text-ink-3">{sub}</p>}
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
