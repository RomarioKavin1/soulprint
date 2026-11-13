"use client";
import { useEffect, useState } from "react";
import { useNear } from "@/components/NearProvider";
import { usePoll } from "@/components/ui";
import { newCaptureKey } from "@/lib/keystore";
import { proofPage } from "@/lib/piece";
import { CapturePanel } from "./CapturePanel";

const PAIR = "soulprint.pairing.";

/** Phone/tablet recording: no sign-in. The device makes a key; the artist pairs it from the studio. */
export function PhoneCapture({ pieceId }: { pieceId: string }) {
  const { chain } = useNear();
  const [pairing, setPairing] = useState<string | null>(null);
  const { data: proof, reload } = usePoll(() => proofPage(chain, pieceId), 4000, [pieceId]);

  useEffect(() => {
    if ("serviceWorker" in navigator) navigator.serviceWorker.register("/sw.js").catch(() => {});
    (async () => {
      let k: string | null = null;
      try {
        k = localStorage.getItem(PAIR + pieceId);
      } catch {}
      if (!k) {
        k = (await newCaptureKey()).publicKey;
        try {
          localStorage.setItem(PAIR + pieceId, k);
        } catch {}
      }
      setPairing(k);
    })();
  }, [pieceId]);

  const paired = proof && pairing && proof.segments.some((s) => s.key === pairing);
  return (
    <div className="mx-auto max-w-lg space-y-6 page-top">
      <h1 className="font-display text-3xl">Record piece {pieceId.split(".")[0]?.slice(1)}</h1>
      {!proof ? (
        <p className="text-ink-3">Loading…</p>
      ) : paired ? (
        <CapturePanel pieceId={pieceId} segments={proof.segments} open onChange={reload} />
      ) : (
        <div className="card">
          <p className="label">Pairing key for this device</p>
          <p className="mt-2 break-all font-mono text-sm" data-testid="pairing-key">
            {pairing ?? "…"}
          </p>
          <p className="mt-3 text-sm text-ink-2">In your studio, open this piece, choose &ldquo;Record on a phone or tablet instead&rdquo; and paste this key. This page continues by itself once it is paired.</p>
        </div>
      )}
    </div>
  );
}
