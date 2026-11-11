/**
 * Public wording (DESIGN §5 table, A28 issuer classes, A38 active-time label). Facts, not a score;
 * never "proven not AI".
 */
export type Level = 0 | 2 | 3;

export interface CaptureFacts { coverage: number; activeBand: string; spanDays: number; source?: "screen" | "camera" }
export interface ChallengeFact { result: string; issuerClass: string }

export const BADGE_TEXT = "Commissioned and accepted";
export const DECLARED_TEXT = "Declared by the artist";
export const ACTIVE_TIME_LABEL = "device-reported, bounded by on-chain anchors";

function days(n: number) {
  const d = Math.max(1, Math.round(n));
  return `${d} day${d === 1 ? "" : "s"}`;
}

export function issuerText(cls: string) {
  return cls === "Client" || cls === "client" ? "the client" : "an account the artist invited";
}

/** E2: "Recorded while made: 94% built up on camera, 20–30h over 9 days". */
export function recordedSentence(c: CaptureFacts) {
  const pct = Math.round(c.coverage * 100);
  return `Recorded while made: ${pct}% built up on ${c.source === "screen" ? "screen" : "camera"}, ${c.activeBand} over ${days(c.spanDays)}`;
}

/** E3 suffix: "…and passed 2 live checks requested by the client". */
export function challengeSentence(passed: ChallengeFact[]) {
  const n = passed.length;
  const classes = [...new Set(passed.map((p) => issuerText(p.issuerClass)))];
  return `and passed ${n} live check${n === 1 ? "" : "s"} requested by ${classes.join(" and ")}`;
}

export function levelSentence(level: Level, capture: CaptureFacts | null, challenges: ChallengeFact[] = []): string {
  if (level === 0 || !capture) return DECLARED_TEXT;
  const base = recordedSentence(capture);
  if (level === 3) return `${base}, ${challengeSentence(challenges.filter((c) => c.result === "passed" && c.issuerClass !== "artist"))}`;
  return base;
}

/** Short labels used in the studio before delivery. */
export const LEVEL_TEXT: Record<Level, { badge: string; summary: string; detail: string }> = {
  0: { badge: "Declared", summary: DECLARED_TEXT, detail: "Not enough signed, anchored process was recorded to say more than that." },
  2: { badge: "Recorded", summary: "Recorded while made", detail: "Signed frames, anchored as you worked, build up to the final file." },
  3: { badge: "Recorded, live checks passed", summary: "Recorded while made, with live checks passed", detail: "Codes asked for by others appeared in the work while you recorded." },
};
