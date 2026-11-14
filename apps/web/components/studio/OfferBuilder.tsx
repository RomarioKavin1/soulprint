"use client";
import { fmtDate } from "@/lib/terms";
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { b64 } from "@soulprint/proof";
import { useNear } from "@/components/NearProvider";
import { ErrorNote, Section, useAction } from "@/components/ui";
import { newCaptureKey } from "@/lib/keystore";
import { createPiece } from "@/lib/piece";
import { currencyName } from "@/lib/money";
import {
  BPS, DAY, GRANT_TEXT, HOUR, PRODUCTION_LIMITS, defaultOffer, fmtNs, fromUnits, licenceHash, limitsFrom, offerToTerms, rejectBond,
  termsHash, toUnits, validateOffer, type Currency, type GrantKind, type Offer, type TimeLimits,
} from "@/lib/terms";

const MIN = 60_000_000_000n;
const UNITS: [string, bigint][] = [["minutes", MIN], ["hours", HOUR], ["days", DAY]];

function DurationInput({ label, value, onChange, hint }: { label: string; value: bigint; onChange: (v: bigint) => void; hint?: string }) {
  const best = [...UNITS].reverse().find(([, u]) => value % u === 0n) ?? UNITS[0]!;
  const [unit, setUnit] = useState(best[0]);
  const u = UNITS.find(([n]) => n === unit)![1];
  return (
    <label className="block">
      <span className="label">{label}</span>
      <div className="mt-1 flex gap-2">
        <input className="field" type="number" min={0} step="any" value={Number(value) / Number(u)} onChange={(e) => onChange(BigInt(Math.round(Number(e.target.value) * Number(u))))} />
        <select className="field w-28" value={unit} onChange={(e) => setUnit(e.target.value)} aria-label={`${label} unit`}>
          {UNITS.map(([n]) => (
            <option key={n}>{n}</option>
          ))}
        </select>
      </div>
      {hint && <span className="mt-1 block text-xs text-ink-3">{hint}</span>}
    </label>
  );
}

function Pct({ label, bps, onChange, max, hint }: { label: string; bps: number; onChange: (v: number) => void; max: number; hint?: string }) {
  return (
    <label className="block">
      <span className="label">{label}</span>
      <div className="mt-1 flex items-center gap-2">
        <input className="field" type="number" min={0} max={max / 100} step="0.5" value={bps / 100} onChange={(e) => onChange(Math.round(Number(e.target.value) * 100))} />
        <span className="text-ink-3">%</span>
      </div>
      {hint && <span className="mt-1 block text-xs text-ink-3">{hint}</span>}
    </label>
  );
}

export function OfferBuilder({ mode }: { mode: "commission" | "standalone" }) {
  const { config, accountId, signer, chain } = useNear();
  const router = useRouter();
  const { busy, error, run } = useAction();
  const usdc: Currency = { Ft: config.currencyToken };
  const [offer, setOffer] = useState<Offer>(() => defaultOffer({ now: Date.now(), currency: usdc, decimals: config.currencyDecimals }));
  const [priceText, setPriceText] = useState("");
  const [title, setTitle] = useState("");
  const [limits, setLimits] = useState<TimeLimits>(PRODUCTION_LIMITS);
  const set = (p: Partial<Offer>) => setOffer((o) => ({ ...o, ...p }));
  const decimals = offer.currency === "Near" ? 24 : config.currencyDecimals;

  useEffect(() => {
    chain.view(config.collection, "collection_info").then((i: any) => setLimits(limitsFrom(i.time))).catch(() => {});
    if (config.network === "sandbox") {
      const arb = config.demoAccounts.find((a) => a.role === "arbitrator")?.accountId ?? "";
      const fb = config.demoAccounts.find((a) => a.role === "fallback_arbitrator")?.accountId ?? "";
      set({ arbitrator: arb, fallbackArbitrator: fb });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [config]);

  const priced = { ...offer, price: toUnits(priceText, decimals) };
  const problems = mode === "commission" ? validateOffer(priced, accountId ?? "", limits, Date.now()) : [];
  const t = useMemo(() => offerToTerms(priced), [JSON.stringify(priced, (_k, v) => (typeof v === "bigint" ? v.toString() : v))]);
  const fingerprint = b64.encode(termsHash(t));
  const bond = rejectBond(priced.price, offer.rejectBondBps);

  async function create() {
    if (!signer) return;
    const r = await run("Creating", async () => {
      const key = await newCaptureKey();
      const kind =
        mode === "commission"
          ? { Commission: t }
          : { Standalone: { currency: offer.currency, royalty_bps: offer.royaltyBps, grant: offer.grant, licence_text_hash: b64.encode(licenceHash(offer.licenceText, offer.grant)) } };
      return createPiece(chain, signer, config.collection, kind, key.publicKey);
    });
    if (r) {
      // the working title waits on this device until the artist publishes the page (it prefills the title there)
      if (title.trim()) try { localStorage.setItem(`soulprint.title.${r.pieceId}`, title.trim()); } catch { /* storage blocked */ }
      router.push(`/studio/${r.pieceId}`);
    }
  }

  if (!accountId) return <p className="mt-6 text-ink-2">Sign in to create a piece.</p>;
  return (
    <div className="mt-6 grid gap-6 lg:grid-cols-[1fr_340px]">
      <div className="space-y-6">
        {mode === "standalone" && (
          <Section title="The piece">
            <label className="block max-w-xl">
              <span className="label">Working title</span>
              <input className="field mt-1" value={title} maxLength={120} onChange={(e) => setTitle(e.target.value)} placeholder="Harbour at dusk" aria-label="Working title" />
              <span className="mt-1 block text-xs text-ink-3">You can change it when you publish. Next you record how you make it — on this screen, a camera, or a phone.</span>
            </label>
          </Section>
        )}
        {mode === "commission" && (
          <Section title="Who and how much">
            <div className="grid gap-4 sm:grid-cols-2">
              <label className="block sm:col-span-2">
                <span className="label">Client account (optional)</span>
                <input className="field mt-1" placeholder="Leave empty to let anyone with the link take the commission" value={offer.client ?? ""} onChange={(e) => set({ client: e.target.value.trim() || null })} />
                <span className="mt-1 block text-xs text-ink-3">The NEAR account of the person paying, e.g. alice.testnet. Only they can pay in; leave it empty to share an open link.</span>
              </label>
              <label className="block">
                <span className="label">Price</span>
                <input className="field mt-1" inputMode="decimal" placeholder="250" value={priceText} onChange={(e) => setPriceText(e.target.value)} aria-label="Price" />
                <span className="mt-1 block text-xs text-ink-3">The whole fee. The client pays it into the piece up front; it waits there until stages are released.</span>
              </label>
              <label className="block">
                <span className="label">Paid in</span>
                <select className="field mt-1" value={offer.currency === "Near" ? "near" : "usdc"} onChange={(e) => set({ currency: e.target.value === "near" ? "Near" : usdc })}>
                  <option value="usdc">USDC</option>
                  <option value="near">NEAR</option>
                </select>
                <span className="mt-1 block text-xs text-ink-3">USDC is a dollar-pegged token; NEAR is the network's own currency.</span>
              </label>
              <label className="block">
                <span className="label">Deadline</span>
                <input
                  className="field mt-1"
                  type="datetime-local"
                  value={new Date(Number(offer.deadlineNs / 1_000_000n) - new Date().getTimezoneOffset() * 60_000).toISOString().slice(0, 16)}
                  onChange={(e) => set({ deadlineNs: BigInt(new Date(e.target.value).getTime()) * 1_000_000n })}
                />
                <span className="mt-1 block text-xs text-ink-3">When you promise to deliver.</span>
              </label>
              <DurationInput label="Grace after the deadline" value={offer.graceNs} onChange={(v) => set({ graceNs: v })} hint="Extra time after the deadline before the client may take their money back undelivered." />
            </div>
          </Section>
        )}

        {mode === "commission" && (
          <Section title="Payment stages">
            <p className="mb-3 text-sm text-ink-2">Split the fee into parts paid as the work progresses (e.g. 30% after the sketch, 70% on delivery). The client releases each stage when they are happy with progress; the last stage is paid when they accept the finished piece. The stages must add up to 100%.</p>
            <div className="flex flex-wrap items-end gap-3">
              {offer.milestones.map((m, i) => (
                <label key={i} className="block w-28">
                  <span className="label">Stage {i + 1}</span>
                  <div className="mt-1 flex items-center gap-1">
                    <input className="field" type="number" min={1} max={100} value={m / 100} onChange={(e) => set({ milestones: offer.milestones.map((x, j) => (j === i ? Math.round(Number(e.target.value) * 100) : x)) })} />
                    <span className="text-ink-3">%</span>
                  </div>
                </label>
              ))}
              {offer.milestones.length < 5 && (
                <button className="btn-ghost" onClick={() => set({ milestones: [...offer.milestones.slice(0, -1).map((x) => x), Math.floor(offer.milestones.at(-1)! / 2), Math.ceil(offer.milestones.at(-1)! / 2)] })}>
                  Add stage
                </button>
              )}
              {offer.milestones.length > 1 && (
                <button className="btn-ghost" onClick={() => set({ milestones: [...offer.milestones.slice(0, -2), offer.milestones.at(-2)! + offer.milestones.at(-1)!] })}>
                  Remove stage
                </button>
              )}
            </div>
          </Section>
        )}

        {mode === "commission" && (
          <Section title="Review and revisions">
            <div className="grid gap-4 sm:grid-cols-2">
              <DurationInput label="Review window" value={offer.reviewWindowNs} onChange={(v) => set({ reviewWindowNs: v })} hint="If the client says nothing, the piece completes when this ends." />
              <label className="block">
                <span className="label">Revision rounds</span>
                <input className="field mt-1" type="number" min={0} max={10} value={offer.revisionRounds} onChange={(e) => set({ revisionRounds: Number(e.target.value) })} />
                <span className="mt-1 block text-xs text-ink-3">How many times the client may ask for changes after a delivery.</span>
              </label>
              <DurationInput label="Time per revision" value={offer.revisionPeriodNs} onChange={(v) => set({ revisionPeriodNs: v })} hint="How long you have to redeliver after changes are asked for." />
            </div>
          </Section>
        )}

        {mode === "commission" && (
          <Section title="If you disagree">
            <div className="grid gap-4 sm:grid-cols-2">
              <Pct label="Refusal deposit" bps={offer.rejectBondBps} max={1000} onChange={(v) => set({ rejectBondBps: v })} hint="A share of the fee the client must put up to refuse a delivery, so refusals are serious. They get it back if the arbitrator agrees with them." />
              <Pct label="Your share if nobody decides" bps={offer.timeoutArtistBps} max={BPS} onChange={(v) => set({ timeoutArtistBps: v })} hint="What you receive if there is a dispute and neither arbitrator decides in time; the rest goes back to the client." />
              <label className="block">
                <span className="label">Arbitrator</span>
                <input className="field mt-1" value={offer.arbitrator} onChange={(e) => set({ arbitrator: e.target.value.trim() })} />
                <span className="mt-1 block text-xs text-ink-3">A NEAR account you both trust to settle a refused delivery.</span>
              </label>
              <label className="block">
                <span className="label">Fallback arbitrator</span>
                <input className="field mt-1" value={offer.fallbackArbitrator} onChange={(e) => set({ fallbackArbitrator: e.target.value.trim() })} />
                <span className="mt-1 block text-xs text-ink-3">Decides only if the first arbitrator does not answer in time.</span>
              </label>
            </div>
          </Section>
        )}

        <RightsWrap standalone={mode === "standalone"} summary={`${GRANT_TEXT[offer.grant.kind].title}${offer.grant.attribution ? ", with credit" : ""} · ${offer.royaltyBps / 100}% resale royalty · sold in ${currencyName(offer.currency)}`}>
        <Section title={mode === "commission" ? "Rights the buyer gets" : "Rights a collector would get"}>
          {mode === "standalone" && (
            <label className="mb-4 block max-w-xs">
              <span className="label">Sold in</span>
              <select className="field mt-1" value={offer.currency === "Near" ? "near" : "usdc"} onChange={(e) => set({ currency: e.target.value === "near" ? "Near" : usdc })}>
                <option value="usdc">USDC</option>
                <option value="near">NEAR</option>
              </select>
              <span className="mt-1 block text-xs text-ink-3">The currency a collector pays in if you later offer it for sale. You set the price then.</span>
            </label>
          )}
          <p className="mb-3 text-sm text-ink-2">What the person who owns the piece may do with the image. You always remain its author.</p>
          <div className="grid gap-2">
            {(Object.keys(GRANT_TEXT) as GrantKind[]).map((k) => (
              <label key={k} className={`flex cursor-pointer gap-3 rounded-sm border p-3 ${offer.grant.kind === k ? "border-ink bg-paper-2" : "border-rule"}`}>
                <input type="radio" name="grant" aria-label={GRANT_TEXT[k].title} checked={offer.grant.kind === k} onChange={() => set({ grant: { ...offer.grant, kind: k } })} />
                <span>
                  <span className="font-medium">{GRANT_TEXT[k].title}</span>
                  <span className="block text-sm text-ink-2">{GRANT_TEXT[k].guide}</span>
                </span>
              </label>
            ))}
          </div>
          <div className="mt-4 flex flex-wrap gap-6 text-sm">
            <label className="flex items-center gap-2">
              <input type="checkbox" checked={offer.grant.attribution} onChange={(e) => set({ grant: { ...offer.grant, attribution: e.target.checked } })} /> Credit me when it is used
              <span className="text-xs text-ink-3">(your name shown wherever the image is used)</span>
            </label>
            <label className="flex items-center gap-2">
              <input type="checkbox" checked={offer.grant.transferable} onChange={(e) => set({ grant: { ...offer.grant, transferable: e.target.checked } })} /> Rights pass to whoever owns the piece next
              <span className="text-xs text-ink-3">(if it is resold, the new owner gets these rights; untick to keep them with the first owner only)</span>
            </label>
          </div>
          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            <Pct label="Resale royalty" bps={offer.royaltyBps} max={1500} onChange={(v) => set({ royaltyBps: v })} hint="Your cut of every later sale of the piece, paid automatically (0–15%)." />
          </div>
          <label className="mt-4 block">
            <span className="label">Licence notes (optional)</span>
            <textarea className="field mt-1 min-h-24" value={offer.licenceText} onChange={(e) => set({ licenceText: e.target.value })} placeholder="Anything specific, e.g. “no use in political campaigns”." />
            <span className="mt-1 block text-xs text-ink-3">Fingerprinted into the piece with the rights above, so it cannot be changed later.</span>
          </label>
        </Section>
        </RightsWrap>
      </div>

      <aside className="lg:sticky lg:top-6 lg:self-start">
        <div className="card">
          <p className="label">{mode === "commission" ? "The offer, in plain words" : "The piece"}</p>
          {mode === "commission" ? (
            <ul className="mt-3 space-y-2 text-sm">
              <li>
                {offer.client ? <b>{offer.client}</b> : "Whoever pays first"} pays {priceText ? <b>{priceText} {currencyName(offer.currency)}</b> : <i>the price you set</i>}, held in the piece until each stage is released.
              </li>
              <li>Delivered by {fmtDate(Number(offer.deadlineNs / 1_000_000n), "date")}, plus {fmtNs(offer.graceNs)} grace.</li>
              <li>
                {fmtNs(offer.reviewWindowNs)} to review, {offer.revisionRounds} revision round{offer.revisionRounds === 1 ? "" : "s"}.
              </li>
              <li>
                Refusing a delivery costs a deposit of {priceText ? `${fromUnits(bond, decimals)} ${currencyName(offer.currency)}` : `${offer.rejectBondBps / 100}% of the price`}; arbitrators decide.
              </li>
              <li>
                Rights: {GRANT_TEXT[offer.grant.kind].title.toLowerCase()}
                {offer.grant.attribution ? ", with credit" : ""}. Resale royalty {offer.royaltyBps / 100}%.
              </li>
            </ul>
          ) : (
            <p className="mt-3 text-sm text-ink-2">
              Your own piece: record your process, finish it and publish its page. Selling it is optional — if you put it up for collectors, they get these rights: {GRANT_TEXT[offer.grant.kind].title.toLowerCase()}. Resale royalty {offer.royaltyBps / 100}%.
            </p>
          )}
          {mode === "commission" && (
            <p className="mt-4 text-xs text-ink-3">
              Terms fingerprint <code className="break-all font-mono" data-testid="terms-hash">{fingerprint}</code> — the client&apos;s payment only goes through if the terms still match this.
            </p>
          )}
          {problems.length > 0 && priceText && (
            <ul className="mt-4 list-disc space-y-1 pl-5 text-sm text-seal-2">
              {problems.map((p) => (
                <li key={p}>{p}</li>
              ))}
            </ul>
          )}
          <button className="btn-seal mt-5 w-full" disabled={!!busy || (mode === "commission" && problems.length > 0)} onClick={create}>
            {busy ? "Creating…" : mode === "commission" ? "Create the commission" : "Create the piece"}
          </button>
          <p className="mt-2 text-xs text-ink-3">This device gets a recording key for the piece. Creating it sets aside a small NEAR amount for the piece&apos;s storage.</p>
          <ErrorNote error={error} />
        </div>
      </aside>
    </div>
  );
}

/** For a piece of one's own the rights start as a sensible default, one line, opened only to change them. */
function RightsWrap({ standalone, summary, children }: { standalone: boolean; summary: string; children: React.ReactNode }) {
  if (!standalone) return <>{children}</>;
  return (
    <details className="card !p-0 [&[open]>summary]:border-b [&[open]>summary]:border-rule">
      <summary className="flex cursor-pointer flex-wrap items-baseline justify-between gap-2 px-6 py-4 sm:px-8">
        <span><span className="label block">If you offer it to collectors</span><span className="mt-1 block text-ink">{summary}</span></span>
        <span className="text-sm text-ink-2 underline">Change</span>
      </summary>
      <div className="[&>.card]:shadow-none [&>.card]:border-0">{children}</div>
    </details>
  );
}
