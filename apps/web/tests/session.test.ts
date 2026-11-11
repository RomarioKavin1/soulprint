/** Plan 3 review I2: one wallet signature per session, not one per request. */
import { afterEach, describe, expect, it, vi } from "vitest";
import { PIECE, world } from "../../../services/evidence/test/helpers.ts";
import { evidenceFetch, forgetSessions } from "../lib/auth.ts";
import type { Signer } from "../lib/near.ts";

const closers: (() => Promise<unknown>)[] = [];
afterEach(async () => {
  vi.useRealTimers();
  forgetSessions();
  while (closers.length) await closers.pop()!();
});

/** A signer backed by the test user's key that counts wallet prompts. */
function counting(u: { account: string; seed: Uint8Array }, prompts: { n: number }): Signer {
  return {
    accountId: u.account,
    async signNep413(p) {
      prompts.n++;
      const ed = await import("@noble/ed25519");
      const { nep413Payload } = await import("../../../services/evidence/src/auth.ts");
      const { sha256 } = await import("@noble/hashes/sha256");
      const { b64, nearPublicKey } = await import("@soulprint/proof");
      const sig = await ed.signAsync(sha256(nep413Payload(p)), u.seed);
      return { accountId: u.account, publicKey: nearPublicKey(await ed.getPublicKeyAsync(u.seed)), signature: b64.encode(sig) };
    },
    async call() { throw new Error("unused"); },
  };
}

describe("evidence sessions", () => {
  it("many requests, one prompt; an expired session re-signs once", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    const w = await world({ now: () => Date.now() });
    await w.app.listen({ port: 0, host: "127.0.0.1" });
    closers.push(() => w.app.close());
    const base = `http://127.0.0.1:${(w.app.server.address() as { port: number }).port}`;
    const prompts = { n: 0 };
    const s = counting(w.client, prompts);
    const url = `/pieces/${PIECE}/messages`;
    await evidenceFetch(base, "soulprint-evidence", s, "POST", url, { text: "one" });
    for (let i = 0; i < 5; i++) await evidenceFetch(base, "soulprint-evidence", s, "GET", url);
    expect(prompts.n).toBe(1);
    vi.setSystemTime(Date.now() + 31 * 60_000);
    await evidenceFetch(base, "soulprint-evidence", s, "GET", url);
    expect(prompts.n).toBe(2);
  });
});
