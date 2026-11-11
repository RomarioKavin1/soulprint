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

/**
 * Plan 3 review I2: one wallet signature opens a 30-minute session with the evidence service;
 * requests then carry `Session <token>`. Cached per (service, account) in memory only.
 */
const sessions = new Map<string, { token: string; expiresAt: number }>();
const pendingSessions = new Map<string, Promise<string>>();

export function forgetSessions() {
  sessions.clear();
  pendingSessions.clear();
}

async function sessionToken(base: string, recipient: string, signer: Signer, fresh = false): Promise<string> {
  const k = `${base}|${recipient}|${signer.accountId}`;
  const cached = sessions.get(k);
  if (!fresh && cached && cached.expiresAt - 60_000 > Date.now()) return cached.token;
  if (fresh) sessions.delete(k);
  let p = pendingSessions.get(k);
  if (!p) {
    p = (async () => {
      const raw = "{}";
      const r = await fetch(base + "/session", {
        method: "POST",
        headers: { "content-type": "application/json", authorization: await authHeader(signer, "POST", "/session", raw, recipient) },
        body: raw,
      });
      const j = await r.json().catch(() => undefined);
      if (!r.ok) throw new EvidenceError(r.status, j?.error ?? `http_${r.status}`, j);
      sessions.set(k, { token: j.token, expiresAt: j.expiresAt });
      return j.token as string;
    })().finally(() => pendingSessions.delete(k));
    pendingSessions.set(k, p);
  }
  return p;
}

const SESSION_RETRY = new Set(["session_expired", "bad_auth"]);

export async function evidenceFetch<T = any>(
  base: string,
  recipient: string,
  signer: Signer | null,
  method: "GET" | "POST",
  path: string,
  body?: unknown,
): Promise<T> {
  const raw = body === undefined ? "" : JSON.stringify(body);
  for (let attempt = 0; ; attempt++) {
    const headers: Record<string, string> = {};
    if (body !== undefined) headers["content-type"] = "application/json";
    if (signer) headers.authorization = `Session ${await sessionToken(base, recipient, signer, attempt > 0)}`;
    const r = await fetch(base + path, { method, headers, ...(body === undefined ? {} : { body: raw }) });
    const text = await r.text();
    const json = text ? JSON.parse(text) : undefined;
    if (r.status === 401 && signer && attempt === 0 && SESSION_RETRY.has(json?.error)) continue;
    if (!r.ok) throw new EvidenceError(r.status, json?.error ?? `http_${r.status}`, json);
    return json as T;
  }
}

/** GET raw bytes with NEP-413 auth (reference images; Plan 3 review I5). */
export async function evidenceBytes(base: string, recipient: string, signer: Signer | null, path: string): Promise<Uint8Array> {
  const headers: Record<string, string> = {};
  if (signer) headers.authorization = `Session ${await sessionToken(base, recipient, signer)}`;
  const r = await fetch(base + path, { headers });
  if (!r.ok) throw new EvidenceError(r.status, `http_${r.status}`);
  return new Uint8Array(await r.arrayBuffer());
}
