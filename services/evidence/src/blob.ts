/**
 * Encrypted blob store. Each piece has a random AES-256-GCM data key, stored wrapped by the
 * service master key. Blobs are `iv(12) ‖ ciphertext+tag` on disk (S3 adapter can replace FS).
 */
import { mkdirSync, readFileSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import type { Db } from "./db.ts";

const subtle = globalThis.crypto.subtle;
const aes = (raw: Uint8Array, use: KeyUsage[]) => subtle.importKey("raw", raw as BufferSource, "AES-GCM", false, use);

async function seal(keyRaw: Uint8Array, data: Uint8Array): Promise<Uint8Array> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(await subtle.encrypt({ name: "AES-GCM", iv }, await aes(keyRaw, ["encrypt"]), data as BufferSource));
  const out = new Uint8Array(12 + ct.length);
  out.set(iv);
  out.set(ct, 12);
  return out;
}
async function open(keyRaw: Uint8Array, sealed: Uint8Array): Promise<Uint8Array> {
  const iv = sealed.slice(0, 12);
  return new Uint8Array(await subtle.decrypt({ name: "AES-GCM", iv }, await aes(keyRaw, ["decrypt"]), sealed.slice(12) as BufferSource));
}

export class BlobStore {
  private keys = new Map<string, Uint8Array>();
  constructor(private dir: string, private master: Uint8Array, private db: Db) {
    if (master.length !== 32) throw new Error("master key must be 32 bytes");
    mkdirSync(dir, { recursive: true });
  }

  private async dataKey(pieceId: string): Promise<Uint8Array> {
    const cached = this.keys.get(pieceId);
    if (cached) return cached;
    const row = (await this.db.query<{ wrapped: Uint8Array }>("SELECT wrapped FROM piece_keys WHERE piece_id = $1", [pieceId])).rows[0];
    let key: Uint8Array;
    if (row) key = await open(this.master, row.wrapped);
    else {
      key = crypto.getRandomValues(new Uint8Array(32));
      await this.db.query("INSERT INTO piece_keys (piece_id, wrapped) VALUES ($1, $2) ON CONFLICT DO NOTHING", [pieceId, await seal(this.master, key)]);
      // Another writer may have won the race: re-read.
      const again = (await this.db.query<{ wrapped: Uint8Array }>("SELECT wrapped FROM piece_keys WHERE piece_id = $1", [pieceId])).rows[0]!;
      key = await open(this.master, again.wrapped);
    }
    this.keys.set(pieceId, key);
    return key;
  }

  async put(pieceId: string, name: string, data: Uint8Array): Promise<string> {
    const key = `${encodeURIComponent(pieceId)}__${name}`;
    writeFileSync(join(this.dir, key), await seal(await this.dataKey(pieceId), data));
    return key;
  }

  async get(pieceId: string, key: string): Promise<Uint8Array | null> {
    const p = join(this.dir, key);
    if (!existsSync(p)) return null;
    return open(await this.dataKey(pieceId), new Uint8Array(readFileSync(p)));
  }

  del(key: string) {
    rmSync(join(this.dir, key), { force: true });
  }
}
