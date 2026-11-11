"use client";
import { Section, usePoll } from "@/components/ui";
import { describeEvent, lagNotice } from "@/lib/history";
import type { Currency } from "@/lib/terms";

interface H { events: { height: number; at: number; event: string; data: any }[]; lag: { updating: boolean; behindMs: number } }

const QUIET = new Set(["anchored", "transfer_pending", "capture_key_added"]);

export function History({ pieceId, currency, decimals }: { pieceId: string; currency: Currency; decimals: number }) {
  const { data, error } = usePoll(() => fetch(`/indexer/pieces/${pieceId}/history`).then((r) => (r.ok ? (r.json() as Promise<H>) : Promise.reject(new Error("indexer")))), 6000, [pieceId]);
  if (error && !data) return null; // history is optional; the piece itself is the truth
  if (!data) return null;
  const notice = lagNotice(data.lag);
  const shown = data.events.filter((e) => !QUIET.has(e.event));
  return (
    <Section title="History">
      {notice && (
        <p className="mb-3 rounded-lg border border-amber/40 bg-amber/10 px-3 py-2 text-sm" data-testid="lag-notice">
          {notice}
        </p>
      )}
      <ol className="space-y-2 text-sm" data-testid="history">
        {shown.map((e) => (
          <li key={`${e.height}-${e.event}-${JSON.stringify(e.data).length}`} className="flex gap-3">
            <span className="w-36 shrink-0 text-ink-3">{new Date(e.at).toLocaleString(undefined, { dateStyle: "short", timeStyle: "short" })}</span>
            <span>{describeEvent(e, currency, decimals)}</span>
          </li>
        ))}
      </ol>
    </Section>
  );
}
