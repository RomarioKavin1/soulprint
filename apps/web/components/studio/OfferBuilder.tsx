"use client";
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
    if (r) router.push(`/studio/${r.pieceId}`);
  }

  if (!accountId) return <p className="mt-6 text-ink-2">Sign in to create a piece.</p>;
  return (
    <div className="mt-6 grid gap-6 lg:grid-cols-[1fr_340px]">
      <div className="space-y-6">
        {mode === "commission" && (
          <Section title="Who and how much">
            <div className="grid gap-4 sm:grid-cols-2">
              <label className="block sm:col-span-2">
                <span className="label">Client account (optional)</span>
                <input className="field mt-1" placeholder="Leave empty to let anyone with the link take the commission" value={offer.client ?? ""} onChange={(e) => set({ client: e.target.value.trim() || null })} />
              </label>
              <label className="block">
                <span className="label">Price</span>
                <input className="field mt-1" inputMode="decimal" placeholder="250" value={priceText} onChange={(e) => setPriceText(e.target.value)} aria-label="Price" />
              </label>
              <label className="block">
                <span className="label">Paid in</span>
                <select className="field mt-1" value={offer.currency === "Near" ? "near" : "usdc"} onChange={(e) => set({ currency: e.target.value === "near" ? "Near" : usdc })}>
                  <option value="usdc">USDC</option>
                  <option value="near">NEAR</option>
                </select>
              </label>
              <label className="block">
                <span className="label">Deadline</span>
                <input
                  className="field mt-1"
                  type="datetime-local"
                  value={new Date(Number(offer.deadlineNs / 1_000_000n) - new Date().getTimezoneOffset() * 60_000).toISOString().slice(0, 16)}
                  onChange={(e) => set({ deadlineNs: BigInt(new Date(e.target.value).getTime()) * 1_000_000n })}
                />
              </label>
              <DurationInput label="Grace after the deadline" value={offer.graceNs} onChange={(v) => set({ graceNs: v })} hint="Before the client can ask for a refund." />
            </div>
          </Section>
        )}

        {mode === "commission" && (
          <Section title="Payment stages">
            <p className="mb-3 text-sm text-ink-2">The client releases each stage when they are happy with progress. The last stage releases on acceptance.</p>
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
              </label>
              <DurationInput label="Time per revision" value={offer.revisionPeriodNs} onChange={(v) => set({ revisionPeriodNs: v })} />
            </div>
          </Section>
        )}

        {mode === "commission" && (
          <Section title="If you disagree">
            <div className="grid gap-4 sm:grid-cols-2">
              <Pct label="Refusal deposit" bps={offer.rejectBondBps} max={1000} onChange={(v) => set({ rejectBondBps: v })} hint="Paid by the client to refuse a delivery; returned if they are right." />
              <Pct label="Your share if nobody decides" bps={offer.timeoutArtistBps} max={BPS} onChange={(v) => set({ timeoutArtistBps: v })} hint="Only if both arbitrators stay silent." />
              <label className="block">
                <span className="label">Arbitrator</span>
                <input className="field mt-1" value={offer.arbitrator} onChange={(e) => set({ arbitrator: e.target.value.trim() })} />
              </label>
              <label className="block">
                <span className="label">Fallback arbitrator</span>
                <input className="field mt-1" value={offer.fallbackArbitrator} onChange={(e) => set({ fallbackArbitrator: e.target.value.trim() })} />
              </label>
            </div>
          </Section>
        )}

        <Section title={mode === "commission" ? "Rights the buyer gets" : "Rights a collector would get"}>
          {mode === "standalone" && (
            <label className="mb-4 block max-w-xs">
              <span className="label">Sold in</span>
              <select className="field mt-1" value={offer.currency === "Near" ? "near" : "usdc"} onChange={(e) => set({ currency: e.target.value === "near" ? "Near" : usdc })}>
                <option value="usdc">USDC</option>
                <option value="near">NEAR</option>
              </select>
            </label>
          )}
          <div className="grid gap-2">
            {(Object.keys(GRANT_TEXT) as GrantKind[]).map((k) => (
              <label key={k} className={`flex cursor-pointer gap-3 rounded-xl border p-3 ${offer.grant.kind === k ? "border-ink bg-paper-2" : "border-rule"}`}>
                <input type="radio" name="grant" checked={offer.grant.kind === k} onChange={() => set({ grant: { ...offer.grant, kind: k } })} />
                <span>
                  <span className="font-medium">{GRANT_TEXT[k].title}</span>
                  <span className="block text-sm text-ink-2">{GRANT_TEXT[k].plain}</span>
                </span>
              </label>
            ))}
          </div>
          <div className="mt-4 flex flex-wrap gap-6 text-sm">
            <label className="flex items-center gap-2">
              <input type="checkbox" checked={offer.grant.attribution} onChange={(e) => set({ grant: { ...offer.grant, attribution: e.target.checked } })} /> Credit me when it is used
            </label>
            <label className="flex items-center gap-2">
              <input type="checkbox" checked={offer.grant.transferable} onChange={(e) => set({ grant: { ...offer.grant, transferable: e.target.checked } })} /> Rights pass to whoever owns the piece next
            </label>
          </div>
          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            <Pct label="Resale royalty" bps={offer.royaltyBps} max={1500} onChange={(v) => set({ royaltyBps: v })} hint="Paid to you every time the piece is resold (0–15%)." />
          </div>
          <label className="mt-4 block">
            <span className="label">Licence notes (optional)</span>
            <textarea className="field mt-1 min-h-24" value={offer.licenceText} onChange={(e) => set({ licenceText: e.target.value })} placeholder="Anything specific about how the work may be used." />
          </label>
        </Section>
      </div>

      <aside className="lg:sticky lg:top-6 lg:self-start">
        <div className="card">
          <p className="label">{mode === "commission" ? "The offer, in plain words" : "The piece"}</p>
          {mode === "commission" ? (
            <ul className="mt-3 space-y-2 text-sm">
              <li>
                {offer.client ? <b>{offer.client}</b> : "Whoever pays first"} pays <b>{priceText || "—"} {currencyName(offer.currency)}</b>, held in the piece until each stage is released.
              </li>
              <li>Delivered by {new Date(Number(offer.deadlineNs / 1_000_000n)).toLocaleDateString(undefined, { dateStyle: "medium" })}, plus {fmtNs(offer.graceNs)} grace.</li>
              <li>
                {fmtNs(offer.reviewWindowNs)} to review, {offer.revisionRounds} revision round{offer.revisionRounds === 1 ? "" : "s"}.
              </li>
              <li>
                Refusing a delivery costs a {fromUnits(bond, decimals)} {currencyName(offer.currency)} deposit; arbitrators decide.
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
