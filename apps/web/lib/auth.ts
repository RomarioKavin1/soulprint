/**
 * `Authorization: NEP413 …` for the evidence service (Plan 2): the signed message binds method,
 * path, body hash and time; the nonce is single-use server-side.
 */
import { sha256 } from "@noble/hashes/sha256";
import { b64 } from "@soulprint/proof";
import type { Signer } from "./near.ts";

function base64Utf8(s: string): string {
  return b64.encode(new TextEncoder().encode(s));
}

export async function authHeader(signer: Signer, method: string, path: string, rawBody: string, recipient: string): Promise<string> {
  const bodySha256 = b64.encode(sha256(new TextEncoder().encode(rawBody)));
  const message = JSON.stringify({ method, path, bodySha256, ts: Date.now() });
  const nonce = crypto.getRandomValues(new Uint8Array(32));
  const s = await signer.signNep413({ message, nonce, recipient });
  const auth = { accountId: s.accountId, publicKey: s.publicKey, signature: s.signature, message, nonce: b64.encode(nonce), recipient };
  return `NEP413 ${base64Utf8(JSON.stringify(auth))}`;
}

/** fetch() against the evidence service with NEP-413 auth. Throws `EvidenceError` on non-2xx. */
export class EvidenceError extends Error {
  constructor(public status: number, public code: string, public body?: unknown) {
    super(code);
  }
}

export async function evidenceFetch<T = any>(
  base: string,
  recipient: string,
  signer: Signer | null,
  method: "GET" | "POST",
  path: string,
  body?: unknown,
): Promise<T> {
  const raw = body === undefined ? "" : JSON.stringify(body);
  const headers: Record<string, string> = {};
  if (body !== undefined) headers["content-type"] = "application/json";
  if (signer) headers.authorization = await authHeader(signer, method, path, raw, recipient);
  const r = await fetch(base + path, { method, headers, ...(body === undefined ? {} : { body: raw }) });
  const text = await r.text();
  const json = text ? JSON.parse(text) : undefined;
  if (!r.ok) throw new EvidenceError(r.status, json?.error ?? `http_${r.status}`, json);
  return json as T;
}
