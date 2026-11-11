import { describe, expect, it } from "vitest";
import sharp from "sharp";
import { b64, challengeAckMessage } from "@soulprint/proof";
import { evaluateChallenge, TesseractOcr, CODE_ALPHABET, newCode, type Ocr } from "../src/challenge.ts";
import { nep413, PIECE, world } from "./helpers.ts";

const WINDOW = 10 * 60_000;
const T0 = 1_700_000_000_000;
const codeImage = (text: string) =>
  sharp(Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="900" height="500"><rect width="100%" height="100%" fill="#f3efe6"/>
    <circle cx="700" cy="380" r="90" fill="#c9a"/><text x="70" y="200" font-family="Helvetica" font-size="96" fill="#1d1d1d">${text}</text></svg>`)).jpeg().toBuffer().then((b) => new Uint8Array(b));

class FakeOcr implements Ocr {
  constructor(private byFrame: Map<number, { text: string; confidence: number }[]>) {}
  async words(jpeg: Uint8Array) { return this.byFrame.get(jpeg[0]!) ?? []; }
}
const frame = (tag: number, ts: number) => ({ jpeg: new Uint8Array([tag]), deviceTs: ts });

describe("challenge evaluation (A28)", () => {
  it("codes avoid ambiguous characters", () => {
    for (let i = 0; i < 50; i++) expect(newCode()).toMatch(new RegExp(`^[${CODE_ALPHABET}]{6}$`));
    expect(CODE_ALPHABET).not.toMatch(/[0O1IL]/);
  });

  it("typed_code_detected", async () => {
    const ocr = new TesseractOcr();
    try {
      const frames = [{ jpeg: await codeImage("K7XQ4M"), deviceTs: T0 + 60_000 }];
      expect(await evaluateChallenge(frames, "K7XQ4M", T0, WINDOW, ocr)).toBe("passed");
      expect(await evaluateChallenge(frames, "P3HW9R", T0, WINDOW, ocr)).toBe("inconclusive");
    } finally {
      await ocr.close();
    }
  }, 60_000);

  it("ocr_miss_is_inconclusive", async () => {
    const ocr = new FakeOcr(new Map([[1, [{ text: "K7XQ4M", confidence: 40 }]], [2, [{ text: "smudge", confidence: 90 }]]]));
    // Low confidence or not found: never "failed", only "inconclusive".
    expect(await evaluateChallenge([frame(1, T0 + 1000), frame(2, T0 + 2000)], "K7XQ4M", T0, WINDOW, ocr)).toBe("inconclusive");
    expect(await evaluateChallenge([], "K7XQ4M", T0, WINDOW, ocr)).toBe("inconclusive");
  });

  it("late_frame_expired", async () => {
    const ocr = new FakeOcr(new Map([[3, [{ text: "K7XQ4M", confidence: 95 }]]]));
    expect(await evaluateChallenge([frame(3, T0 + WINDOW + 1)], "K7XQ4M", T0, WINDOW, ocr)).toBe("expired");
    expect(await evaluateChallenge([frame(3, T0 + WINDOW - 1)], "K7XQ4M", T0, WINDOW, ocr)).toBe("passed");
    // Frames before the acknowledgement don't count either.
    expect(await evaluateChallenge([frame(3, T0 - 1)], "K7XQ4M", T0, WINDOW, ocr)).toBe("inconclusive");
  });

  it("split OCR words and lowercase still match", async () => {
    const ocr = new FakeOcr(new Map([[4, [{ text: "k7x", confidence: 88 }, { text: "q4m", confidence: 91 }]]]));
    expect(await evaluateChallenge([frame(4, T0 + 5)], "K7XQ4M", T0, WINDOW, ocr)).toBe("passed");
  });
});

describe("challenge endpoints", () => {
  const call = async (w: any, who: any, method: "GET" | "POST", url: string, body?: unknown) =>
    w.app.inject({ method, url, payload: body as any, headers: who ? { authorization: await nep413(who, method, url, body) } : {} });

  it("code_never_exposed_to_issuer_before_eval", async () => {
    const w = await world();
    const url = `/pieces/${PIECE}/challenges`;
    // The artist cannot challenge their own piece; strangers can't either.
    expect((await call(w, w.artist, "POST", url, {})).statusCode).toBe(403);
    expect((await call(w, w.stranger, "POST", url, {})).statusCode).toBe(403);
    const r = await call(w, w.client, "POST", url, {});
    expect(r.statusCode).toBe(200);
    expect(r.json().code).toBeUndefined();
    const nonceHash = r.json().nonceHash as string;
    // The issuer submits issue_challenge(nonce_hash) from their own wallet; the chain now shows it.
    w.chain.pieces.get(PIECE)!.challenges = [{ id: 0, nonceHash: b64.decode(nonceHash), issuer: w.client.account, issuedAt: T0, ackedAt: null }];
    const asIssuer = (await call(w, w.client, "GET", url)).json().items;
    expect(asIssuer).toHaveLength(1);
    expect(asIssuer[0].code).toBeUndefined();
    const asArtist = (await call(w, w.artist, "GET", url)).json().items;
    expect(asArtist[0]).toMatchObject({ chainId: 0, nonceHash });
    expect(asArtist[0].code).toMatch(new RegExp(`^[${CODE_ALPHABET}]{6}$`));
    // Invited accounts may challenge too.
    w.chain.pieces.get(PIECE)!.invites = [w.stranger.account];
    expect((await call(w, w.stranger, "POST", url, {})).statusCode).toBe(200);
  });

  it("ack is signed by a capture key and relayed by the service (A35)", async () => {
    const w = await world();
    const r = await call(w, w.client, "POST", `/pieces/${PIECE}/challenges`, {});
    const nonceHash = b64.decode(r.json().nonceHash);
    w.chain.pieces.get(PIECE)!.challenges = [{ id: 0, nonceHash, issuer: w.client.account, issuedAt: T0, ackedAt: null }];
    const sig = b64.encode(await w.dev.signer.sign(challengeAckMessage({ pieceId: PIECE, challengeId: 0, nonceHash })));
    const ack = `/pieces/${PIECE}/challenges/0/ack`;
    const bad = b64.encode(await w.dev.signer.sign(challengeAckMessage({ pieceId: PIECE, challengeId: 1, nonceHash })));
    expect((await w.app.inject({ method: "POST", url: ack, payload: { sig: bad } })).statusCode).toBe(401);
    const ok = await w.app.inject({ method: "POST", url: ack, payload: { sig } });
    expect(ok.statusCode).toBe(200);
    expect(w.sender.acks).toEqual([{ pieceId: PIECE, challengeId: 0, sig }]);
  });
});
