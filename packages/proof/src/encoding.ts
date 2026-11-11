/** Byte helpers shared by Rust-compatible encoders. */
import { base58, base64, hex as scureHex } from "@scure/base";

export const hex = { encode: (b: Uint8Array) => scureHex.encode(b), decode: (s: string) => scureHex.decode(s) };
export const b64 = { encode: (b: Uint8Array) => base64.encode(b), decode: (s: string) => base64.decode(s) };
export const b58 = base58;

export function concat(...parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}

export function bytes32(b: Uint8Array, what = "value"): Uint8Array {
  if (b.length !== 32) throw new Error(`${what} must be 32 bytes, got ${b.length}`);
  return b;
}

/** Minimal borsh writer: exactly the types the Soulprint messages use. */
export class Borsh {
  private parts: Uint8Array[] = [];
  u8(n: number): this {
    if (!Number.isInteger(n) || n < 0 || n > 0xff) throw new Error(`u8 out of range: ${n}`);
    this.parts.push(new Uint8Array([n]));
    return this;
  }
  u16(n: number): this {
    if (!Number.isInteger(n) || n < 0 || n > 0xffff) throw new Error(`u16 out of range: ${n}`);
    this.parts.push(new Uint8Array([n & 0xff, n >> 8]));
    return this;
  }
  bool(v: boolean): this {
    return this.u8(v ? 1 : 0);
  }
  u128(n: bigint | number | string): this {
    const v = BigInt(n);
    if (v < 0n || v >= 1n << 128n) throw new Error(`u128 out of range: ${n}`);
    const b = new Uint8Array(16);
    const dv = new DataView(b.buffer);
    dv.setBigUint64(0, v & 0xffff_ffff_ffff_ffffn, true);
    dv.setBigUint64(8, v >> 64n, true);
    this.parts.push(b);
    return this;
  }
  u32(n: number): this {
    if (!Number.isInteger(n) || n < 0 || n > 0xffff_ffff) throw new Error(`u32 out of range: ${n}`);
    const b = new Uint8Array(4);
    new DataView(b.buffer).setUint32(0, n, true);
    this.parts.push(b);
    return this;
  }
  u64(n: bigint | number): this {
    const v = BigInt(n);
    if (v < 0n || v > 0xffff_ffff_ffff_ffffn) throw new Error(`u64 out of range: ${n}`);
    const b = new Uint8Array(8);
    new DataView(b.buffer).setBigUint64(0, v, true);
    this.parts.push(b);
    return this;
  }
  string(s: string): this {
    const b = new TextEncoder().encode(s);
    this.u32(b.length);
    this.parts.push(b);
    return this;
  }
  fixed(b: Uint8Array, len: number): this {
    if (b.length !== len) throw new Error(`expected ${len} bytes, got ${b.length}`);
    this.parts.push(b);
    return this;
  }
  bytes(): Uint8Array {
    return concat(...this.parts);
  }
}
