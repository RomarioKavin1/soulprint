/**
 * Offer builder model: defaults (DESIGN §6 + A22), conversion to the contract's `Terms` JSON,
 * client-side validation mirroring `Terms::validate`, and `terms_hash = sha256(borsh(Terms))`.
 */
import { sha256 } from "@noble/hashes/sha256";
import { Borsh, b64 } from "@soulprint/proof";

export const HOUR = 3_600_000_000_000n; // ns
export const DAY = 24n * HOUR;
export const BPS = 10_000;

export type Currency = "Near" | { Ft: string };
export type GrantKind = "Personal" | "CommercialNonExclusive" | "CommercialExclusive" | "FullAssignment";
export interface Grant { kind: GrantKind; attribution: boolean; transferable: boolean }

export interface Offer {
  price: bigint; // smallest unit
  currency: Currency;
  decimals: number;
  milestones: number[]; // bps, sum 10000, ≤ 5
  deadlineNs: bigint; // absolute, ns
  graceNs: bigint;
  reviewWindowNs: bigint;
  revisionPeriodNs: bigint;
  revisionRounds: number;
  arbitrator: string;
  fallbackArbitrator: string;
  timeoutArtistBps: number;
  rejectBondBps: number;
  royaltyBps: number;
  grant: Grant;
  licenceText: string;
  client: string | null;
}

/** The JSON the contract takes (`common::Terms`). */
export interface TermsJson {
  price: string;
  currency: Currency;
  milestones: { bps: number }[];
  deadline_ns: string;
  grace_ns: string;
  review_window_ns: string;
  revision_period_ns: string;
  revision_rounds: number;
  arbitrator: string;
  fallback_arbitrator: string;
  timeout_artist_bps: number;
  reject_bond_bps: number;
  royalty_bps: number;
  grant: Grant;
  licence_text_hash: string; // base64 32 bytes
  client: string | null;
}

export const GRANT_TEXT: Record<GrantKind, { title: string; plain: string }> = {
  Personal: { title: "Personal use", plain: "The owner may keep, display and share the work privately. No commercial use." },
  CommercialNonExclusive: {
    title: "Commercial, non-exclusive",
    plain: "The owner may use the work commercially. The artist may still use and license it to others.",
  },
  CommercialExclusive: {
    title: "Commercial, exclusive",
    plain: "The owner may use the work commercially and the artist will not license it to anyone else. The artist keeps authorship.",
  },
  FullAssignment: { title: "Full assignment", plain: "Copyright passes to the owner. The artist may keep it in their portfolio only if attribution is on." },
};

/**
 * Defaults (DESIGN §6, A22): grace 48h, review 7 days, 2 revision rounds, timeout split 75% to the
 * artist, 5% refusal deposit, 5% resale royalty. Not fixed by the spec (Plan 3 ruling): one milestone
 * of 100%, revision period 3 days, deadline 30 days, personal-use grant with attribution, transferable.
 */
export function defaultOffer(o: { now: number; currency: Currency; decimals: number }): Offer {
  const nowNs = BigInt(o.now) * 1_000_000n;
  return {
    price: 0n,
    currency: o.currency,
    decimals: o.decimals,
    milestones: [BPS],
    deadlineNs: nowNs + 30n * DAY,
    graceNs: 48n * HOUR,
    reviewWindowNs: 7n * DAY,
    revisionPeriodNs: 3n * DAY,
    revisionRounds: 2,
    arbitrator: "",
    fallbackArbitrator: "",
    timeoutArtistBps: 7500,
    rejectBondBps: 500,
    royaltyBps: 500,
    grant: { kind: "Personal", attribution: true, transferable: true },
    licenceText: "",
    client: null,
  };
}

export function licenceHash(text: string, grant: Grant): Uint8Array {
  return sha256(new TextEncoder().encode(`${grant.kind}|attribution=${grant.attribution}|transferable=${grant.transferable}\n${text}`));
}

export function offerToTerms(o: Offer): TermsJson {
  return {
    price: o.price.toString(),
    currency: o.currency,
    milestones: o.milestones.map((bps) => ({ bps })),
    deadline_ns: o.deadlineNs.toString(),
    grace_ns: o.graceNs.toString(),
    review_window_ns: o.reviewWindowNs.toString(),
    revision_period_ns: o.revisionPeriodNs.toString(),
    revision_rounds: o.revisionRounds,
    arbitrator: o.arbitrator,
    fallback_arbitrator: o.fallbackArbitrator,
    timeout_artist_bps: o.timeoutArtistBps,
    reject_bond_bps: o.rejectBondBps,
    royalty_bps: o.royaltyBps,
    grant: o.grant,
    licence_text_hash: b64.encode(licenceHash(o.licenceText, o.grant)),
    client: o.client || null,
  };
}

const GRANT_ORDER: GrantKind[] = ["Personal", "CommercialNonExclusive", "CommercialExclusive", "FullAssignment"];

function borshCurrency(w: Borsh, c: Currency) {
  if (c === "Near") w.u8(0);
  else w.u8(1).string(c.Ft);
}

/** sha256(borsh(Terms)) — identical to `common::Terms::hash`. */
export function termsHash(t: TermsJson): Uint8Array {
  const w = new Borsh().u128(t.price);
  borshCurrency(w, t.currency);
  w.u32(t.milestones.length);
  for (const m of t.milestones) w.u16(m.bps);
  w.u64(BigInt(t.deadline_ns)).u64(BigInt(t.grace_ns)).u64(BigInt(t.review_window_ns)).u64(BigInt(t.revision_period_ns));
  w.u8(t.revision_rounds).string(t.arbitrator).string(t.fallback_arbitrator);
  w.u16(t.timeout_artist_bps).u16(t.reject_bond_bps).u16(t.royalty_bps);
  w.u8(GRANT_ORDER.indexOf(t.grant.kind)).bool(t.grant.attribution).bool(t.grant.transferable);
  w.fixed(b64.decode(t.licence_text_hash), 32);
  if (t.client === null) w.u8(0);
  else w.u8(1).string(t.client);
  return sha256(w.bytes());
}

export function rejectBond(price: bigint, bps: number): bigint {
  return (price * BigInt(bps)) / BigInt(BPS);
}

export interface TimeLimits { reviewMin: bigint; revisionPeriodMin: bigint; graceMax: bigint; deadlineMinLead: bigint; deadlineMax: bigint }
export const PRODUCTION_LIMITS: TimeLimits = { reviewMin: 3n * DAY, revisionPeriodMin: DAY, graceMax: 14n * DAY, deadlineMinLead: DAY, deadlineMax: 365n * DAY };
export function limitsFrom(time: Record<string, string>): TimeLimits {
  return {
    reviewMin: BigInt(time.review_min ?? PRODUCTION_LIMITS.reviewMin),
    revisionPeriodMin: BigInt(time.revision_period_min ?? PRODUCTION_LIMITS.revisionPeriodMin),
    graceMax: BigInt(time.grace_max ?? PRODUCTION_LIMITS.graceMax),
    deadlineMinLead: BigInt(time.deadline_min_lead ?? PRODUCTION_LIMITS.deadlineMinLead),
    deadlineMax: BigInt(time.deadline_max ?? PRODUCTION_LIMITS.deadlineMax),
  };
}

/** Plain-language problems; empty when the contract would accept the terms. */
export function validateOffer(o: Offer, artist: string, lim: TimeLimits = PRODUCTION_LIMITS, nowMs?: number): string[] {
  const e: string[] = [];
  if (o.price <= 0n) e.push("Set a price.");
  if (!o.milestones.length || o.milestones.length > 5) e.push("Use between one and five payment stages.");
  if (o.milestones.some((m) => m <= 0)) e.push("Every payment stage needs a share above zero.");
  if (o.milestones.reduce((a, m) => a + m, 0) !== BPS) e.push("Payment stages must add up to 100%.");
  if (o.royaltyBps < 0 || o.royaltyBps > 1500) e.push("Resale royalty can be 0–15%.");
  if (o.rejectBondBps < 0 || o.rejectBondBps > 1000) e.push("The refusal deposit can be 0–10% of the price.");
  if (o.currency !== "Near" && rejectBond(o.price, o.rejectBondBps) === 0n) e.push("A refusal deposit above zero is needed when paying in USDC.");
  if (o.timeoutArtistBps < 0 || o.timeoutArtistBps > BPS) e.push("The fallback split must be between 0% and 100%.");
  if (o.reviewWindowNs < lim.reviewMin || o.reviewWindowNs > lim.deadlineMax) e.push(`The review window must be at least ${fmtNs(lim.reviewMin)}.`);
  if (o.revisionPeriodNs < lim.revisionPeriodMin || o.revisionPeriodNs > lim.deadlineMax) e.push(`Give yourself at least ${fmtNs(lim.revisionPeriodMin)} per revision.`);
  if (o.graceNs > lim.graceMax) e.push(`The grace period can be at most ${fmtNs(lim.graceMax)}.`);
  if (nowMs !== undefined) {
    const now = BigInt(nowMs) * 1_000_000n;
    if (o.deadlineNs <= now + lim.deadlineMinLead || o.deadlineNs > now + lim.deadlineMax) e.push(`The deadline must be at least ${fmtNs(lim.deadlineMinLead)} from now and within a year.`);
  }
  if (o.revisionRounds > 10) e.push("At most 10 revision rounds.");
  if (!o.arbitrator || !o.fallbackArbitrator) e.push("Name an arbitrator and a fallback arbitrator.");
  const parties = [artist, o.client].filter(Boolean);
  if (parties.includes(o.arbitrator) || parties.includes(o.fallbackArbitrator) || (o.arbitrator && o.arbitrator === o.fallbackArbitrator))
    e.push("The arbitrators must be someone other than you and the client.");
  if (o.client && o.client === artist) e.push("You cannot commission yourself.");
  return e;
}

/** "1.50" ⇄ smallest units. */
export function toUnits(s: string, decimals: number): bigint {
  const [i = "0", f = ""] = s.trim().split(".");
  if (!/^\d*$/.test(i) || !/^\d*$/.test(f)) return 0n;
  return BigInt(i || "0") * 10n ** BigInt(decimals) + BigInt((f + "0".repeat(decimals)).slice(0, decimals) || "0");
}
export function fromUnits(v: bigint | string, decimals: number, maxFrac = decimals): string {
  const n = BigInt(v);
  const d = 10n ** BigInt(decimals);
  const frac = (n % d).toString().padStart(decimals, "0").slice(0, maxFrac).replace(/0+$/, "");
  return `${(n / d).toLocaleString("en-US")}${frac ? "." + frac : ""}`;
}

export function fmtNs(ns: bigint): string {
  const s = Number(ns / 1_000_000_000n);
  if (s % 86400 === 0) return `${s / 86400} day${s === 86400 ? "" : "s"}`;
  if (s % 3600 === 0) return `${s / 3600} hour${s === 3600 ? "" : "s"}`;
  if (s % 60 === 0) return `${s / 60} minute${s === 60 ? "" : "s"}`;
  return `${s} seconds`;
}

/**
 * Dates shown on the site: one fixed locale and time zone, so the server and the browser render the
 * same text (a browser-locale date broke hydration on piece pages) and every reader sees the same time.
 */
export function fmtDate(ms: number, style: "date" | "datetime" = "datetime"): string {
  const d = new Date(ms);
  if (Number.isNaN(d.getTime())) return "—";
  const opts: Intl.DateTimeFormatOptions =
    style === "date" ? { dateStyle: "medium", timeZone: "UTC" } : { dateStyle: "medium", timeStyle: "short", timeZone: "UTC" };
  return new Intl.DateTimeFormat("en-GB", opts).format(d) + (style === "datetime" ? " UTC" : "");
}
