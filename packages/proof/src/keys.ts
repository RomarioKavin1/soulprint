/**
 * Capture keys. The API takes a `Signer`; WebCrypto Ed25519 (non-extractable) where available,
 * else @noble with the seed kept by the caller's keystore.
 */
import * as ed from "@noble/ed25519";
import { sha512 } from "@noble/hashes/sha512";
import { b58, concat } from "./encoding.ts";

ed.etc.sha512Sync = (...m) => sha512(concat(...m));

export interface Signer {
  publicKey: Uint8Array;
  sign(bytes: Uint8Array): Promise<Uint8Array>;
}

export async function nobleSigner(seed: Uint8Array): Promise<Signer> {
  if (seed.length !== 32) throw new Error("ed25519 seed must be 32 bytes");
  const publicKey = await ed.getPublicKeyAsync(seed);
  return { publicKey, sign: (bytes) => ed.signAsync(bytes, seed) };
}

/** Non-extractable WebCrypto key pair, or null where Ed25519 is unsupported. */
export async function webCryptoSigner(): Promise<{ signer: Signer; keyPair: CryptoKeyPair } | null> {
  try {
    const keyPair = (await crypto.subtle.generateKey({ name: "Ed25519" }, false, ["sign", "verify"])) as CryptoKeyPair;
    const raw = new Uint8Array(await crypto.subtle.exportKey("raw", keyPair.publicKey));
    return { keyPair, signer: signerFromKeyPair(keyPair, raw) };
  } catch {
    return null;
  }
}

export function signerFromKeyPair(keyPair: CryptoKeyPair, publicKey: Uint8Array): Signer {
  return {
    publicKey,
    sign: async (bytes) => new Uint8Array(await crypto.subtle.sign({ name: "Ed25519" }, keyPair.privateKey, bytes as BufferSource)),
  };
}

export const verifySig = (sig: Uint8Array, msg: Uint8Array, pk: Uint8Array) => ed.verifyAsync(sig, msg, pk);

export const nearPublicKey = (pk: Uint8Array) => `ed25519:${b58.encode(pk)}`;

export function parseNearPublicKey(s: string): Uint8Array {
  if (!s.startsWith("ed25519:")) throw new Error("only ed25519 keys are supported");
  const b = b58.decode(s.slice(8));
  if (b.length !== 32) throw new Error("bad ed25519 public key length");
  return b;
}
