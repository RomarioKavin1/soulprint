"use client";
import { b64 } from "@soulprint/proof";
import { Section, when } from "@/components/ui";
import { GRANT_TEXT, fmtNs, termsHash, type TermsJson } from "@/lib/terms";
import { money } from "@/lib/money";
import { bondOf } from "@/lib/commission";

export function TermsCard({ t, decimals }: { t: TermsJson; decimals: number }) {
  const price = BigInt(t.price);
  return (
    <Section title="What was agreed" aside={<span className="text-xs text-ink-3">fixed when paid</span>}>
      <dl className="grid gap-x-8 gap-y-4 text-sm sm:grid-cols-2">
        <Row k="Price" v={money(price, t.currency, decimals)} />
        <Row k="Deadline" v={`${when(t.deadline_ns)} (+${fmtNs(BigInt(t.grace_ns))} grace)`} />
        <Row k="Payment stages" v={t.milestones.map((m, i) => `${i + 1}: ${money((price * BigInt(m.bps)) / 10000n, t.currency, decimals)}`).join(" · ")} />
        <Row k="Review" v={`${fmtNs(BigInt(t.review_window_ns))}, ${t.revision_rounds} revision round${t.revision_rounds === 1 ? "" : "s"} of ${fmtNs(BigInt(t.revision_period_ns))}`} />
        <Row k="Refusal deposit" v={money(bondOf(t), t.currency, decimals)} />
        <Row k="Arbitrators" v={`${t.arbitrator}, then ${t.fallback_arbitrator}; if both stay silent the artist gets ${t.timeout_artist_bps / 100}%`} />
        <Row k="Rights" v={`${GRANT_TEXT[t.grant.kind].title}${t.grant.attribution ? ", with credit" : ""}${t.grant.transferable ? ", passes to the next owner" : ""}. ${GRANT_TEXT[t.grant.kind].plain}`} />
        <Row k="Resale royalty" v={`${t.royalty_bps / 100}% to the artist on every resale`} />
      </dl>
      <p className="mt-4 text-xs text-ink-3">
        Terms fingerprint <code className="break-all font-mono" data-testid="room-terms-hash">{b64.encode(termsHash(t))}</code>
      </p>
    </Section>
  );
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <div>
      <dt className="label">{k}</dt>
      <dd className="mt-1">{v}</dd>
    </div>
  );
}
