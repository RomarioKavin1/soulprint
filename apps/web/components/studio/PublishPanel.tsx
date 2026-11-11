"use client";
import Link from "next/link";
import type { PieceInfo } from "@/lib/piece";
import { Section } from "@/components/ui";

/** Proof page publishing is wired in Plan 3 Task 4. */
export function PublishPanel({ piece }: { piece: PieceInfo }) {
  if (!piece.report_hash) return null;
  return (
    <Section title="Proof page">
      <Link className="btn-ghost" href={`/p/${piece.piece_id}`}>
        Open the proof page
      </Link>
    </Section>
  );
}
