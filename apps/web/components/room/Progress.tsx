"use client";
import { Section, usePoll } from "@/components/ui";
import { useEvidence } from "@/lib/evidence";

/** Frames the artist chose to show the client. */
export function Progress({ pieceId }: { pieceId: string }) {
  const evidence = useEvidence();
  // Plan 3 review I6: the newest shared frames, not the first 200 forever.
  const { data } = usePoll(
    () => evidence<{ total: number; frames: { index: number; key: string; jpeg: string | null; deviceTs: number }[] }>("GET", `/pieces/${pieceId}/progress?order=desc&limit=24`),
    20000,
    [pieceId],
  );
  const frames = (data?.frames ?? []).filter((f) => f.jpeg).reverse();
  return (
    <Section title="Work in progress" aside={<span className="text-sm text-ink-3">{data?.total ?? frames.length} shared with you{(data?.total ?? 0) > frames.length ? " · latest shown" : ""}</span>}>
      {frames.length === 0 ? (
        <p className="text-sm text-ink-2">The artist hasn&apos;t shared progress frames yet.</p>
      ) : (
        <ul className="grid grid-cols-3 gap-2 sm:grid-cols-6">
          {frames.map((f) => (
            <li key={`${f.key}${f.index}`} className="aspect-[4/3] overflow-hidden rounded-lg bg-paper-2">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={`data:image/jpeg;base64,${f.jpeg}`} alt={`Progress frame ${f.index + 1}`} className="h-full w-full object-cover" />
            </li>
          ))}
        </ul>
      )}
    </Section>
  );
}
