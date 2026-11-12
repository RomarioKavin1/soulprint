"use client";
import { useState } from "react";
import { b64, challengeAckMessage } from "@soulprint/proof";
import { useNear } from "@/components/NearProvider";
import { ErrorNote, Section, useAction, usePoll, when } from "@/components/ui";
import { useEvidence } from "@/lib/evidence";
import { act, type ProofView } from "@/lib/piece";
import { useDeviceKey } from "./CapturePanel";

interface Item { chainId: number; nonceHash: string; issuer: string; issuedAt: string; ackedAt: string | null; code?: string }

/** A28: someone asks for a code; the artist works it into the piece, on camera, within the window. */
export function ChallengesPanel({ pieceId, proof, onChange }: { pieceId: string; proof: ProofView; onChange: () => void }) {
  const { signer } = useNear();
  const evidence = useEvidence();
  const [key] = useDeviceKey(proof.segments);
  const [invitee, setInvitee] = useState("");
  const { busy, error, run } = useAction();
  const { data, reload } = usePoll(() => evidence<{ items: Item[] }>("GET", `/pieces/${pieceId}/challenges`), 5_000, [pieceId, proof.challenges.length]);
  const items = data?.items ?? [];
  const open = items.filter((i) => !i.ackedAt);

  async function ack(i: Item) {
    await run("Confirming", async () => {
      if (!key) throw new Error("Confirm from a device that is recording this piece.");
      const sig = await key.signer.sign(challengeAckMessage({ pieceId, challengeId: i.chainId, nonceHash: b64.decode(i.nonceHash) }));
      await evidence("POST", `/pieces/${pieceId}/challenges/${i.chainId}/ack`, { sig: b64.encode(sig) }, { anonymous: true });
      await reload();
      onChange();
    });
  }

  return (
    <Section title="Live codes" aside={<span className="text-sm text-ink-3">{proof.challenges_total} requested</span>}>
      {open.length === 0 ? (
        <p className="text-ink-2">When your client (or someone you invite) asks for a code, it appears here. Write or type it into the work while recording.</p>
      ) : (
        <ul className="space-y-3">
          {open.map((i) => (
            <li key={i.chainId} className="flex flex-wrap items-center justify-between gap-4 rounded-sm border border-seal/40 bg-seal/5 p-4">
              <div>
                <p className="label">Code from {i.issuer}</p>
                <p className="mt-1 font-mono text-4xl tracking-[0.3em] text-seal" data-testid="challenge-code">
                  {i.code}
                </p>
                <p className="mt-1 text-xs text-ink-3">Asked {when(i.issuedAt)}. Put it in the work now — it must show up in the next frames.</p>
              </div>
              <button className="btn-seal" disabled={!!busy} onClick={() => ack(i)}>
                It&apos;s in the work
              </button>
            </li>
          ))}
        </ul>
      )}
      <details className="mt-4 text-sm">
        <summary className="cursor-pointer text-ink-2">Invite someone else to ask for codes</summary>
        <div className="mt-2 flex gap-2">
          <input className="field" placeholder="their account" value={invitee} onChange={(e) => setInvitee(e.target.value.trim())} aria-label="Account to invite" />
          <button className="btn-primary" disabled={!invitee || !!busy} onClick={() => run("Inviting", async () => { await act(signer!, pieceId, "invite_challenger", { account: invitee }); setInvitee(""); onChange(); })}>
            Invite
          </button>
        </div>
        {proof.invites.length > 0 && <p className="mt-1 text-xs text-ink-3">Invited: {proof.invites.join(", ")}</p>}
      </details>
      <ErrorNote error={error} />
    </Section>
  );
}
