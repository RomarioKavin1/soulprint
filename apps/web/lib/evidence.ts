"use client";
import { useCallback } from "react";
import { useNear } from "@/components/NearProvider";
import { evidenceFetch } from "./auth.ts";

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

export function bytesToB64(b: Uint8Array) {
  let s = "";
  for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode(...b.subarray(i, i + 0x8000));
  return btoa(s);
}
