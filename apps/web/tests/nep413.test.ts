import { describe, expect, it } from "vitest";
import * as ed from "@noble/ed25519";
import { nearPublicKey, b58 } from "@soulprint/proof";
import { authenticate } from "../../../services/evidence/src/auth.ts";
import { authHeader } from "../lib/auth.ts";
import { KeySigner } from "../lib/near.ts";

const RECIPIENT = "soulprint-evidence";

async function signer() {
  const seed = new Uint8Array(32).fill(9);
  const pub = await ed.getPublicKeyAsync(seed);
  // near-api-js secret format: ed25519:base58(seed ‖ pub)
  const secret = `ed25519:${b58.encode(new Uint8Array([...seed, ...pub]))}`;
  return { s: new KeySigner("artist.test.near", secret, "http://127.0.0.1:1"), pk: nearPublicKey(pub) };
}

function deps(pk: string, nonces = new Set<string>()) {
  return {
    recipient: RECIPIENT,
    now: Date.now,
    chain: { isFullAccessKey: async (a: string, k: string) => a === "artist.test.near" && k === pk } as any,
    useNonce: async (n: Uint8Array) => {
      const k = Buffer.from(n).toString("hex");
      if (nonces.has(k)) return false;
      nonces.add(k);
      return true;
    },
  };
}

describe("auth", () => {
  it("nep413_roundtrip_verifies_on_server", async () => {
    const { s, pk } = await signer();
    const body = JSON.stringify({ text: "hello" });
    const h = await authHeader(s, "POST", "/pieces/p1.soulprint.test.near/messages", body, RECIPIENT);
    expect(await authenticate(deps(pk), h, "POST", "/pieces/p1.soulprint.test.near/messages", body)).toBe("artist.test.near");
  });

  it("header is bound to method, path and body", async () => {
    const { s, pk } = await signer();
    const h = await authHeader(s, "GET", "/pieces/x/report", "", RECIPIENT);
    await expect(authenticate(deps(pk), h, "GET", "/pieces/y/report", "")).rejects.toMatchObject({ code: "auth_mismatch" });
    await expect(authenticate(deps(pk), h, "POST", "/pieces/x/report", "")).rejects.toMatchObject({ code: "auth_mismatch" });
    await expect(authenticate(deps(pk), h, "GET", "/pieces/x/report", "{}")).rejects.toMatchObject({ code: "auth_mismatch" });
  });
});
