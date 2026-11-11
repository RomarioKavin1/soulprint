"use client";
import { useState } from "react";
import { useNear } from "@/components/NearProvider";
import { ErrorNote, Section, useAction } from "@/components/ui";
import { STORAGE_DEPOSIT, type Accounting } from "@/lib/piece";
import { money } from "@/lib/money";

/** Pull payments: credits wait in the piece until their owner claims them (A16). */
export function Earnings({ pieceId, acc, onChange }: { pieceId: string; acc: Accounting; onChange: () => void }) {
  const { accountId, signer, config } = useNear();
  const [to, setTo] = useState("");
  const { busy, error, run } = useAction();
  const mine = acc.credits.find((c) => c.account === accountId);
  const available = BigInt(mine?.available ?? "0");
  const inFlight = BigInt(mine?.in_flight ?? "0");
  if (!mine || (available === 0n && inFlight === 0n)) return null;
  return (
    <Section title="Money for you">
      <p className="font-display text-3xl">{money(available, acc.currency, config.currencyDecimals)}</p>
      {inFlight > 0n && <p className="mt-1 text-sm text-ink-3">{money(inFlight, acc.currency, config.currencyDecimals)} on its way.</p>}
      {available > 0n && (
        <div className="mt-4 flex flex-wrap items-center gap-3">
          <button className="btn-seal" disabled={!!busy} onClick={() => run("Collecting", async () => { await signer!.call(pieceId, "claim", {}, { tgas: 100n }); onChange(); })}>
            Collect
          </button>
          <span className="text-sm text-ink-3">or send it to</span>
          <input className="field w-56" placeholder="another account" value={to} onChange={(e) => setTo(e.target.value.trim())} aria-label="Send to account" />
          <button className="btn-ghost" disabled={!to || !!busy} onClick={() => run("Sending", async () => { await signer!.call(pieceId, "claim_to", { recipient: to }, { deposit: STORAGE_DEPOSIT, tgas: 100n }); onChange(); })}>
            Send
          </button>
        </div>
      )}
      <ErrorNote error={error} />
    </Section>
  );
}
