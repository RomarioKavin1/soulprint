"use client";
import { PairingQr } from "./PairingQr";
import { useEffect, useRef, useState } from "react";
import { hex, nearPublicKey, type Signer as KeySigner } from "@soulprint/proof";
import { CaptureSession, IdbFrameStore, INTERVAL_MS, cameraSource, screenSource, type CaptureStatus } from "@soulprint/proof/capture";
import { useNear } from "@/components/NearProvider";
import { ErrorNote, Section, useAction } from "@/components/ui";
import { importSeed, loadCaptureKey, newCaptureKey } from "@/lib/keystore";
import { HttpUploader, captureStatusView } from "@/lib/uploader";
import { EVIDENCE_BASE } from "@/lib/evidence";
import { act, type ProofView } from "@/lib/piece";

/** The first of the piece's capture keys that this device holds. */
export function useDeviceKey(segments: ProofView["segments"] | undefined) {
  const { config } = useNear();
  const [key, setKey] = useState<{ publicKey: string; signer: KeySigner } | null | undefined>(undefined);
  const keys = segments?.map((s) => s.key).join(",") ?? "";
  useEffect(() => {
    if (!segments) return;
    let alive = true;
    (async () => {
      for (const s of segments) {
        const signer = await loadCaptureKey(s.key);
        if (signer) return alive && setKey({ publicKey: s.key, signer });
      }
      // Sandbox: the demo capture key the contracts were set up with.
      if (config.captureTestKey) {
        const demo = await importSeed(hex.decode(config.captureTestKey));
        if (segments.some((s) => s.key === demo.publicKey)) return alive && setKey(demo);
      }
      if (alive) setKey(null);
    })();
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [keys]);
  return [key, setKey] as const;
}

export function CapturePanel({ pieceId, segments, open, onChange }: { pieceId: string; segments: ProofView["segments"]; open: boolean; onChange: () => void }) {
  const { signer, config } = useNear();
  const [key, setKey] = useDeviceKey(segments);
  const session = useRef<CaptureSession | null>(null);
  const [status, setStatus] = useState<CaptureStatus | null>(null);
  const [phoneKey, setPhoneKey] = useState("");
  const { busy, error, run, setError } = useAction();
  const fast = config.network === "sandbox";

  useEffect(() => {
    if (!key) return;
    let alive = true;
    CaptureSession.open({
      pieceId,
      signer: key.signer,
      store: new IdbFrameStore(),
      uploader: new HttpUploader(EVIDENCE_BASE, key.signer),
      onError: (e) => setError(e),
      doc: document,
      wakeLock: (navigator as any).wakeLock,
    }).then((s) => {
      if (!alive) return;
      session.current = s;
      setStatus(s.status());
    });
    const h = setInterval(() => session.current && setStatus(session.current.status()), 1000);
    return () => {
      alive = false;
      clearInterval(h);
      session.current?.stop().catch(() => {});
    };
  }, [key, pieceId, setError]);

  async function start(kind: "screen" | "camera") {
    await run("Starting", async () => {
      try { localStorage.setItem(`soulprint.source.${pieceId}`, kind); } catch { /* storage blocked */ }
      const src = kind === "screen" ? await screenSource() : await cameraSource();
      await session.current!.start(src, { intervalMs: fast ? 5_000 : INTERVAL_MS[kind], pauseWhenHidden: kind === "camera" });
    });
  }

  const v = status ? captureStatusView(status) : null;
  return (
    <Section title="Record your process" aside={v && <span className="text-sm text-ink-3">{v.progress}</span>}>
      {key === undefined ? (
        <p className="text-ink-3">Checking this device…</p>
      ) : key === null ? (
        <div>
          <p className="text-ink-2">This device has no recording key for this piece. Add one to record from here.</p>
          <button
            className="btn-primary mt-3"
            disabled={!!busy || !signer}
            onClick={() =>
              run("Adding", async () => {
                const k = await newCaptureKey();
                await act(signer!, pieceId, "add_capture_key", { key: k.publicKey });
                setKey(k);
                onChange();
              })
            }
          >
            Use this device for recording
          </button>
        </div>
      ) : !open ? (
        <p className="text-ink-2">Recording is closed for this piece.</p>
      ) : (
        <div>
          <div className="flex flex-wrap items-center gap-3">
            <span className={`inline-flex items-center gap-2 text-sm ${status?.capturing ? "text-seal" : "text-ink-2"}`}>
              <span className={`h-2.5 w-2.5 rounded-full ${status?.capturing && !status.paused ? "animate-pulse bg-seal" : "bg-ink-3"}`} />
              {v?.headline}
            </span>
            {!status?.capturing ? (
              <>
                <button className="btn-seal" disabled={!!busy} onClick={() => start("screen")}>
                  Record my screen
                </button>
                <button className="btn-ghost" disabled={!!busy} onClick={() => start("camera")}>
                  Record with camera
                </button>
                {busy === "Starting" && (
                  <span className="text-sm text-ink-2" role="status">Allow the camera or choose a screen in your browser&rsquo;s prompt.</span>
                )}
              </>
            ) : (
              <>
                <button className="btn-ghost" onClick={() => run("Capturing", () => session.current!.captureNow().then(() => session.current!.flush()))}>
                  Take a frame now
                </button>
                <button className="btn-primary" onClick={() => run("Stopping", () => session.current!.stop())}>
                  Stop
                </button>
              </>
            )}
          </div>
          <p className="mt-3 text-xs text-ink-3">
            A frame every {fast ? "5 seconds (demo timing)" : "minute for screens, two minutes for cameras"}. Each frame is signed on this device and chained to the last; nothing can be slipped in later.
          </p>
          {v?.problem && (
            <div role="status" className="mt-3 flex flex-wrap items-center gap-3 rounded-sm border border-amber/40 bg-amber/10 px-3 py-2 text-sm">
              <span>{v.problem}</span>
              {v.showRetry && (
                <button className="btn-ghost py-1" onClick={() => run("Retrying", () => session.current!.flush())}>
                  Retry upload
                </button>
              )}
            </div>
          )}
        </div>
      )}
      {open && (
        <details className="mt-5 text-sm">
          <summary className="cursor-pointer text-ink-2">Record on a phone or tablet instead</summary>
          <PairingQr pieceId={pieceId} />
          <div className="mt-2 flex gap-2">
            <input className="field" placeholder="ed25519:…" value={phoneKey} onChange={(e) => setPhoneKey(e.target.value.trim())} aria-label="Pairing key" />
            <button
              className="btn-primary"
              disabled={!phoneKey || !!busy}
              onClick={() =>
                run("Pairing", async () => {
                  await act(signer!, pieceId, "add_capture_key", { key: phoneKey });
                  setPhoneKey("");
                  onChange();
                })
              }
            >
              Pair device
            </button>
          </div>
          <p className="mt-1 text-xs text-ink-3">Up to four devices per piece. Paired: {segments.length}.</p>
        </details>
      )}
      <ErrorNote error={error} />
    </Section>
  );
}

export { nearPublicKey };
