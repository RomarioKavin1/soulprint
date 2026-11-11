/** NEP-413 payload (same bytes as services/evidence/src/auth.ts): sha256 of this is what gets signed. */
import { Borsh } from "@soulprint/proof";

const NEP413_TAG = 2 ** 31 + 413;

export function nep413Payload(p: { message: string; nonce: Uint8Array; recipient: string; callbackUrl?: string }): Uint8Array {
  const w = new Borsh().u32(NEP413_TAG).string(p.message).fixed(p.nonce, 32).string(p.recipient);
  if (p.callbackUrl === undefined) w.u8(0);
  else w.u8(1).string(p.callbackUrl);
  return w.bytes();
}
