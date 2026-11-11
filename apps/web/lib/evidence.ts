"use client";
import { useCallback } from "react";
import { useNear } from "@/components/NearProvider";
import { evidenceBytes, evidenceFetch } from "./auth.ts";

export const EVIDENCE_BASE = "/evidence";

/** Signed (NEP-413) calls to the evidence service as the current person. */
export function useEvidence() {
  const { signer, config } = useNear();
  return useCallback(
    <T = any,>(method: "GET" | "POST", path: string, body?: unknown, opts: { anonymous?: boolean } = {}) =>
      evidenceFetch<T>(EVIDENCE_BASE, config.evidenceRecipient, opts.anonymous ? null : signer, method, path, body),
    [signer, config.evidenceRecipient],
  );
}

/** Authenticated byte download from the evidence service (reference images). */
export function useEvidenceBytes() {
  const { signer, config } = useNear();
  return useCallback((path: string) => evidenceBytes(EVIDENCE_BASE, config.evidenceRecipient, signer, path), [signer, config.evidenceRecipient]);
}

export function bytesToB64(b: Uint8Array) {
  let s = "";
  for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode(...b.subarray(i, i + 0x8000));
  return btoa(s);
}

/**
 * Ask the evidence service to sign the delivered report onto the piece. It reads the chain at
 * `final` finality, a few blocks behind the delivery, so `not_delivered` is retried for a while.
 */
export async function attestWithRetry(call: (m: "POST", p: string) => Promise<unknown>, pieceId: string, tries = 20) {
  for (let i = 0; ; i++) {
    try {
      return await call("POST", `/pieces/${pieceId}/attest`);
    } catch (e: any) {
      if (i >= tries || !["not_delivered", "report_mismatch"].includes(e?.code)) throw e;
      await new Promise((r) => setTimeout(r, 1500));
    }
  }
}
