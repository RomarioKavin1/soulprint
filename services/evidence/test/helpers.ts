import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { sha256 } from "@noble/hashes/sha256";
import * as ed from "@noble/ed25519";
import {
  anchorMessage, b64, batchMessage, frameRecordHash, genesis, linkHash, nearPublicKey, nobleSigner, type Signer,
} from "@soulprint/proof";
import { buildApp, type Deps } from "../src/server.ts";
import type { ChainChallenge, ChainReader, PieceView } from "../src/chain.ts";
import type { Sender } from "../src/sender.ts";
import { nep413Payload } from "../src/auth.ts";

export const PIECE = "p1.soulprint.test.near";
export const PIECE2 = "p2.soulprint.test.near";

export class FakeChain implements ChainReader {
  pieces = new Map<string, PieceView & { keys: Uint8Array[]; invites?: string[]; challenges?: ChainChallenge[] }>();
  fullKeys = new Map<string, string[]>(); // account → ed25519:… keys
  async piece(id: string) {
    const p = this.pieces.get(id);
    if (!p) return null;
    return { ...p, invites: p.invites ?? [], challenges: p.challenges ?? [], segments: p.keys.map((k) => ({ key: k, genesis: genesis(id, k) })) };
  }
  async isFullAccessKey(account: string, pk: string) {
    return this.fullKeys.get(account)?.includes(pk) ?? false;
  }
}

export class FakeSender implements Sender {
  anchors: unknown[] = [];
  acks: unknown[] = [];
  async anchor(a: unknown) {
    this.anchors.push(a);
    return { txHash: `tx${this.anchors.length}` };
  }
  async ackChallenge(a: unknown) { this.acks.push(a); return { txHash: "ack" }; }
  async attest() { return { txHash: "attest" }; }
}

export interface User { account: string; seed: Uint8Array; pk: string }
export async function user(account: string, n: number, chain: FakeChain): Promise<User> {
  const seed = new Uint8Array(32).fill(n);
  const pk = nearPublicKey(await ed.getPublicKeyAsync(seed));
  chain.fullKeys.set(account, [pk]);
  return { account, seed, pk };
}

/** NEP-413 Authorization header for a request, signed the way wallets do. */
export async function nep413(u: User, method: string, path: string, body: unknown, recipient = "soulprint-evidence") {
  const bodySha256 = b64.encode(sha256(new TextEncoder().encode(body === undefined ? "" : JSON.stringify(body))));
  const message = JSON.stringify({ method, path, bodySha256, ts: Date.now() });
  const nonce = crypto.getRandomValues(new Uint8Array(32));
  const sig = await ed.signAsync(sha256(nep413Payload({ message, nonce, recipient })), u.seed);
  const auth = { accountId: u.account, publicKey: u.pk, signature: b64.encode(sig), message, nonce: b64.encode(nonce), recipient };
  return `NEP413 ${Buffer.from(JSON.stringify(auth)).toString("base64")}`;
}

export interface Frame { index: number; sessionId: string; deviceTs: number; jpegHash: Uint8Array; link: Uint8Array; jpeg: Uint8Array | null; width: number; height: number }

/** A capture device: produces a chain for (piece, key) and signs batches like CaptureSession. */
export class Device {
  frames: Frame[] = [];
  constructor(public pieceId: string, public signer: Signer, private salt = 0) {}
  static async make(pieceId: string, seed: number, salt = 0) {
    return new Device(pieceId, await nobleSigner(new Uint8Array(32).fill(seed)), salt);
  }
  capture(n: number) {
    for (let i = 0; i < n; i++) {
      const index = this.frames.length;
      const jpeg = new Uint8Array([0xff, 0xd8, this.salt, index, 0xff, 0xd9]);
      const jpegHash = sha256(jpeg);
      const deviceTs = 1_700_000_000_000 + index * 60_000;
      const prev = index === 0 ? genesis(this.pieceId, this.signer.publicKey) : this.frames[index - 1]!.link;
      this.frames.push({ index, sessionId: "s1", deviceTs, jpegHash, link: linkHash(prev, frameRecordHash(jpegHash, index, deviceTs)), jpeg, width: 4, height: 3 });
    }
    return this;
  }
  async batch(from: number, to: number, tamper?: (b: any) => void) {
    const fr = this.frames.slice(from, to + 1);
    const head = fr.at(-1)!.link;
    const key = this.signer.publicKey;
    const body: any = {
      key: nearPublicKey(key), fromIndex: from, toIndex: to,
      sig: b64.encode(await this.signer.sign(batchMessage({ pieceId: this.pieceId, key, fromIndex: from, toIndex: to, head }))),
      anchorSig: b64.encode(await this.signer.sign(anchorMessage({ pieceId: this.pieceId, head, count: to + 1 }))),
      frames: fr.map((f) => ({ ...f, jpegHash: b64.encode(f.jpegHash), link: b64.encode(f.link), jpeg: f.jpeg && b64.encode(f.jpeg) })),
    };
    tamper?.(body);
    return body;
  }
}

export async function world(over: Partial<Deps> = {}) {
  const chain = new FakeChain();
  const sender = new FakeSender();
  const artist = await user("artist.test.near", 11, chain);
  const client = await user("client.test.near", 12, chain);
  const stranger = await user("stranger.test.near", 13, chain);
  const dev = await Device.make(PIECE, 42);
  chain.pieces.set(PIECE, { pieceId: PIECE, artist: artist.account, owner: client.account, status: "InProgress", mode: "Commission", keys: [dev.signer.publicKey] });
  const app = await buildApp({
    chain, sender, dataDir: mkdtempSync(join(tmpdir(), "evidence-")), masterKey: new Uint8Array(32).fill(7),
    recipient: "soulprint-evidence", now: () => Date.now(), ...over,
  });
  return { app, chain, sender, artist, client, stranger, dev };
}
