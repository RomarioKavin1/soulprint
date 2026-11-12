"use client";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { ChainError } from "@/lib/near";
import { EvidenceError } from "@/lib/auth";

export function Section({ title, aside, children }: { title: string; aside?: ReactNode; children: ReactNode }) {
  return (
    <section className="card">
      <div className="mb-4 flex items-baseline justify-between gap-4">
        <h2 className="font-display text-xl">{title}</h2>
        {aside}
      </div>
      {children}
    </section>
  );
}

export function Stat({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div>
      <p className="label">{label}</p>
      <p className="mt-1 text-lg">{value}</p>
    </div>
  );
}

/** Plain-language messages for contract and service errors people can hit. */
const MESSAGES: Record<string, string> = {
  ERR_NOT_CONFIRMED: "The network did not confirm this step in time. It may still go through — refresh in a minute before trying again.",
  ERR_WRONG_STATUS: "That step is not available any more — the piece has moved on. The page now shows where it stands.",
  ERR_NOT_OWNER: "Only the current owner of the piece can do that.",
  ERR_NOT_ARTIST: "Only the artist can do that.",
  ERR_STORAGE: "The piece needs a small storage top-up for this step. Try again; the deposit is refunded if unused.",
  ERR_TERMS_CHANGED: "The terms changed since you opened them. Reload and check them again.",
  ERR_WRONG_AMOUNT: "The amount sent does not match what this step needs.",
  ERR_CHALLENGE_OPEN: "There is already an open code request. Wait until it is answered or expires.",
  ERR_TRANSFER_PENDING: "A transfer of this piece is in progress. Try again in a moment.",
  ERR_INCOME_NOT_LICENSED: "This piece's rights do not allow licence payments.",
  ERR_LISTING_CHANGED: "The listing changed since you opened it. Check the new price and try again.",
  ERR_PRICE_TOO_HIGH: "The price went up since you opened it. Nothing was bought.",
  ERR_POOL_BELOW_EXPECTED: "The income included with the piece went down since you opened it. Nothing was bought.",
  ERR_PRICE_TOO_LOW: "That price is below the minimum for this currency.",
  ERR_INCOME_TOO_SMALL: "That payment is below the minimum.",
  ERR_CHALLENGE_TOO_SOON: "Codes can only be asked for every so often. Try again a little later.",
  ERR_REVIEW_CLOSED: "The review window has closed.",
  ERR_RESERVED: "This sale is reserved for someone else.",
  not_published: "Questions can only be asked and rated on a published piece.",
  artist_cannot_note_own_piece: "You can answer questions about your own piece, but not ask one.",
  already_noted: "You already asked about this piece. Withdraw that question to ask a different one.",
  too_many_notes: "You have asked a lot of questions today. Try again tomorrow.",
  note_too_short: "Say a little more about what you saw in the record.",
  note_too_long: "That is too long. Keep it to what you noticed and what would settle it.",
  cannot_rate_own_note: "You cannot rate your own question.",
  artist_cannot_rate: "Artists cannot rate questions about their own work.",
  not_your_note: "Only the person who asked can withdraw a question.",
  not_an_operator: "Only the operators can remove a question.",
  unknown_note: "That question was withdrawn or removed.",
  bad_request: "Choose what would help settle it.",
  anchor_pending: "Your latest frames are being anchored. This takes a few seconds — try again shortly.",
  final_file_missing: "Upload the final file first.",
  not_an_image: "That file could not be read as an image. Upload the finished artwork as JPEG or PNG.",
  not_delivered: "The report can only be signed after delivery.",
  auth_expired: "Your sign-in proof expired. Try again.",
};
export function explain(e: unknown): string {
  if (e instanceof ChainError) return MESSAGES[e.code] ?? `The network refused this step (${e.code}).`;
  if (e instanceof EvidenceError) return MESSAGES[e.code] ?? `The evidence service refused this step (${e.code}).`;
  if (e instanceof Error) return MESSAGES[e.message] ?? e.message;
  return String(e);
}

export function ErrorNote({ error }: { error: unknown }) {
  if (!error) return null;
  return (
    <p role="alert" className="mt-3 rounded-sm border border-seal/30 bg-seal/5 px-3 py-2 text-sm text-seal-2">
      {explain(error)}
    </p>
  );
}

/** Run an action with busy/error state. */
export function useAction() {
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<unknown>(null);
  const run = useCallback(async <T,>(label: string, f: () => Promise<T>): Promise<T | undefined> => {
    setBusy(label);
    setError(null);
    try {
      return await f();
    } catch (e) {
      setError(e);
      return undefined;
    } finally {
      setBusy(null);
    }
  }, []);
  return { busy, error, run, setError };
}

/** Poll a loader; `reload()` forces a refresh. */
export function usePoll<T>(load: () => Promise<T>, ms: number, deps: unknown[]) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<unknown>(null);
  const loadRef = useRef(load);
  loadRef.current = load;
  const reload = useCallback(async () => {
    try {
      setData(await loadRef.current());
      setError(null);
    } catch (e) {
      setError(e);
    }
  }, []);
  useEffect(() => {
    let alive = true;
    // A hidden tab does not poll (each open page costs public-RPC calls); it refreshes on return.
    const visible = () => typeof document === "undefined" || document.visibilityState !== "hidden";
    const tick = () => alive && visible() && reload();
    const onShow = () => visible() && tick();
    tick();
    const h = setInterval(tick, ms);
    if (typeof document !== "undefined") document.addEventListener("visibilitychange", onShow);
    return () => {
      alive = false;
      clearInterval(h);
      if (typeof document !== "undefined") document.removeEventListener("visibilitychange", onShow);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  return { data, error, reload };
}

export function nsToDate(ns: string | bigint | null | undefined): Date | null {
  if (ns === null || ns === undefined) return null;
  return new Date(Number(BigInt(ns) / 1_000_000n));
}
export function when(ns: string | null | undefined) {
  const d = nsToDate(ns);
  return d ? d.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" }) : "—";
}
export function duration(ns: bigint) {
  const s = Number(ns / 1_000_000_000n);
  if (s < 120) return `${s} seconds`;
  if (s < 7200) return `${Math.round(s / 60)} minutes`;
  if (s < 172800) return `${Math.round(s / 3600)} hours`;
  return `${Math.round(s / 86400)} days`;
}
