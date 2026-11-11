import { describe, expect, it } from "vitest";
import { Account, KeyPairSigner } from "near-api-js";
import { signMessage } from "near-api-js/nep413";
import * as ed from "@noble/ed25519";
import { sha256 } from "@noble/hashes/sha256";
import { b58, b64 } from "@soulprint/proof";
import { nep413, PIECE, world } from "./helpers.ts";
import { nep413Payload, verifyNep413Signature } from "../src/auth.ts";

describe("NEP-413", () => {
  it("verifies messages signed by near-api-js (wallet wire format)", async () => {
    const seed = new Uint8Array(32).fill(5);
    const pub = await ed.getPublicKeyAsync(seed);
    const secret = `ed25519:${b58.encode(new Uint8Array([...seed, ...pub]))}`;
    const acc = new Account("artist.test.near", "http://127.0.0.1:1", KeyPairSigner.fromSecretKey(secret as `ed25519:${string}`));
    const nonce = crypto.getRandomValues(new Uint8Array(32));
    const signed = await signMessage({ signerAccount: acc, payload: { message: "hello", recipient: "soulprint-evidence", nonce } });
    expect(verifyNep413Signature({ message: "hello", nonce, recipient: "soulprint-evidence" }, signed.signature, pub)).toBe(true);
    expect(verifyNep413Signature({ message: "hellO", nonce, recipient: "soulprint-evidence" }, signed.signature, pub)).toBe(false);
    expect(b64.encode(sha256(nep413Payload({ message: "hello", nonce, recipient: "x" }))).length).toBeGreaterThan(0);
  });

  it("rejects replayed nonces, wrong paths, stale timestamps and non-full-access keys", async () => {
    const { app, artist, chain } = await world();
    const body = { indices: [0], level: "client" };
    const url = `/pieces/${PIECE}/visibility`;
    const h = await nep413(artist, "POST", url, body);
    expect((await app.inject({ method: "POST", url, payload: body, headers: { authorization: h } })).statusCode).toBe(200);
    expect((await app.inject({ method: "POST", url, payload: body, headers: { authorization: h } })).json().error).toBe("nonce_reused");
    const wrongPath = await nep413(artist, "POST", `/pieces/${PIECE}/story`, body);
    expect((await app.inject({ method: "POST", url, payload: body, headers: { authorization: wrongPath } })).statusCode).toBe(401);
    const tampered = await nep413(artist, "POST", url, { ...body, level: "public" });
    expect((await app.inject({ method: "POST", url, payload: body, headers: { authorization: tampered } })).statusCode).toBe(401);
    // A signature from more than 5 minutes ago (server clock ahead) is refused.
    const late = await world({ now: () => Date.now() + 6 * 60_000 });
    const hl = await nep413(late.artist, "POST", url, body);
    expect((await late.app.inject({ method: "POST", url, payload: body, headers: { authorization: hl } })).json().error).toBe("auth_expired");
    chain.fullKeys.set(artist.account, []); // key removed / function-call key only
    const h2 = await nep413(artist, "POST", url, body);
    expect((await app.inject({ method: "POST", url, payload: body, headers: { authorization: h2 } })).statusCode).toBe(401);
  });

  it("one signature opens a short session: no wallet prompt per request (Plan 3 review I2)", async () => {
    const clock = { t: Date.now() };
    const w = await world({ now: () => clock.t });
    const url = `/pieces/${PIECE}/messages`;
    // Sessions are minted only with a NEP-413 signature.
    const s = await w.app.inject({ method: "POST", url: "/session", payload: {}, headers: { authorization: await nep413(w.client, "POST", "/session", {}) } });
    expect(s.statusCode).toBe(200);
    const { token, account, expiresAt } = s.json();
    expect(account).toBe(w.client.account);
    expect(expiresAt).toBeGreaterThan(clock.t);
    const auth = { authorization: `Session ${token}` };
    expect((await w.app.inject({ method: "POST", url, payload: { text: "hi" }, headers: auth })).statusCode).toBe(200);
    const list = await w.app.inject({ method: "GET", url, headers: auth });
    expect(list.json().items.map((m: any) => m.author)).toEqual([w.client.account]);
    // A session cannot mint another one, a tampered token is refused, and it expires.
    expect((await w.app.inject({ method: "POST", url: "/session", payload: {}, headers: auth })).statusCode).toBe(401);
    const forged = token.replace(/^[^.]+/, Buffer.from(JSON.stringify({ a: w.artist.account, e: expiresAt })).toString("base64url"));
    expect((await w.app.inject({ method: "GET", url, headers: { authorization: `Session ${forged}` } })).statusCode).toBe(401);
    clock.t = expiresAt + 1;
    const late = await w.app.inject({ method: "GET", url, headers: auth });
    expect([late.statusCode, late.json().error]).toEqual([401, "session_expired"]);
  });
});
