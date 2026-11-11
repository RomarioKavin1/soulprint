import { describe, expect, it } from "vitest";
import { anchorMessage, hex, nearPublicKey, parseNearPublicKey, nobleSigner, verifySig } from "../src/index.ts";

describe("keys", () => {
  it("noble signer signs messages that verify, and NEAR key strings round-trip", async () => {
    const s = await nobleSigner(new Uint8Array(32).fill(42));
    const msg = anchorMessage({ pieceId: "p1.x.near", head: new Uint8Array(32), count: 1 });
    const sig = await s.sign(msg);
    expect(sig.length).toBe(64);
    expect(await verifySig(sig, msg, s.publicKey)).toBe(true);
    expect(await verifySig(sig, msg.slice(1), s.publicKey)).toBe(false);
    const str = nearPublicKey(s.publicKey);
    expect(str.startsWith("ed25519:")).toBe(true);
    expect(parseNearPublicKey(str)).toEqual(s.publicKey);
  });
  it("matches RFC 8032 test 1 (same derivation as ed25519-dalek)", async () => {
    const s = await nobleSigner(hex.decode("9d61b19deffd5a60ba844af492ec2cc44449c5697b326919703bac031cae7f60"));
    expect(hex.encode(s.publicKey)).toBe("d75a980182b10ab7d54bfed3c964073a0ee172f3daa62325af021a68f707511a");
    expect(hex.encode(await s.sign(new Uint8Array()))).toBe(
      "e5564300c360ac729086e2cc806e828a84877f1eb8e5d974d873e065224901555fb8821590a33bacc61e39701cf9b46bd25bf5f0595bbe24655141438e7a100b",
    );
  });
});
