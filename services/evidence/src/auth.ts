/**
 * NEP-413 request auth for people (artist, owner) and capture-key auth for devices.
 * Header: `Authorization: NEP413 base64(json{accountId, publicKey, signature, message, nonce, recipient})`
 * where `message` = JSON {method, path, bodySha256, ts}. Nonces are single-use; ts within 5 min.
 */
import * as ed from "@noble/ed25519";
import { sha256 } from "@noble/hashes/sha256";
import { Borsh, b64, parseNearPublicKey } from "@soulprint/proof";
import type { ChainReader } from "./chain.ts";

const NEP413_TAG = 2 ** 31 + 413;
export const MAX_SKEW_MS = 5 * 60_000;

export function nep413Payload(p: { message: string; nonce: Uint8Array; recipient: string; callbackUrl?: string }): Uint8Array {
  const w = new Borsh().u32(NEP413_TAG).string(p.message).fixed(p.nonce, 32).string(p.recipient);
  if (p.callbackUrl === undefined) w.u8(0);
  else w.u8(1).string(p.callbackUrl);
  return w.bytes();
}

export function verifyNep413Signature(p: { message: string; nonce: Uint8Array; recipient: string }, sig: Uint8Array, pk: Uint8Array): boolean {
  try {
    return ed.verify(sig, sha256(nep413Payload(p)), pk);
  } catch {
    return false;
  }
}

export class AuthError extends Error {
  constructor(public status: number, public code: string) {
    super(code);
  }
}

export interface AuthDeps {
  chain: ChainReader;
  recipient: string;
  now: () => number;
  useNonce(nonce: Uint8Array): Promise<boolean>;
}

/** Returns the authenticated account id, or throws AuthError. */
export async function authenticate(d: AuthDeps, header: string | undefined, method: string, path: string, rawBody: string): Promise<string> {
  if (!header?.startsWith("NEP413 ")) throw new AuthError(401, "auth_required");
  let a: any;
  try {
    a = JSON.parse(Buffer.from(header.slice(7), "base64").toString("utf8"));
  } catch {
    throw new AuthError(401, "bad_auth");
  }
  const nonce = b64.decode(String(a.nonce ?? ""));
  if (nonce.length !== 32 || a.recipient !== d.recipient) throw new AuthError(401, "bad_auth");
  let m: any;
  try {
    m = JSON.parse(a.message);
  } catch {
    throw new AuthError(401, "bad_auth");
  }
  const bodySha256 = b64.encode(sha256(new TextEncoder().encode(rawBody)));
  if (m.method !== method || m.path !== path || m.bodySha256 !== bodySha256) throw new AuthError(401, "auth_mismatch");
  if (typeof m.ts !== "number" || Math.abs(d.now() - m.ts) > MAX_SKEW_MS) throw new AuthError(401, "auth_expired");
  let pk: Uint8Array;
  try {
    pk = parseNearPublicKey(a.publicKey);
  } catch {
    throw new AuthError(401, "bad_auth");
  }
  if (!verifyNep413Signature({ message: a.message, nonce, recipient: a.recipient }, b64.decode(a.signature), pk)) throw new AuthError(401, "bad_signature");
  if (!(await d.chain.isFullAccessKey(a.accountId, a.publicKey))) throw new AuthError(401, "key_not_full_access");
  if (!(await d.useNonce(nonce))) throw new AuthError(401, "nonce_reused");
  return a.accountId as string;
}
