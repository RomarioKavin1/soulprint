import { createHash } from "node:crypto";
import Fastify from "fastify";
import { decodeSignedDelegate, encodeDelegateAction, PublicKey, type SignedDelegate } from "near-api-js";
import { budgetUnits, checkDelegate, targetPiece, type DailyCap, type Policy } from "./allowlist.ts";

/** Chain reads the relayer needs (Plan 3 review C1, I3). */
export interface RelayerChain {
  /** Is `publicKey` an access key of `account`? */
  hasKey(account: string, publicKey: string): Promise<boolean>;
  /** Accounts with a role on the piece (artist, owner, named client, arbitrators, invited challengers); null if none. */
  parties(piece: string): Promise<string[] | null>;
}

export interface RelayerDeps {
  policy: Policy;
  chain: RelayerChain;
  /** Relays per sender per UTC day. */
  cap: DailyCap;
  /** Relayer-wide attached-deposit budget per UTC day, in µNEAR (key "relayer"). */
  budget: DailyCap;
  now: () => number;
  submit(sd: SignedDelegate): Promise<{ txHash: string; ok: boolean; failure?: string }>;
}

const sha256 = (b: Uint8Array) => new Uint8Array(createHash("sha256").update(b).digest());

export async function buildRelayer(d: RelayerDeps) {
  const app = Fastify({ bodyLimit: 64 * 1024 });
  app.addHook("onSend", async (_req, reply) => {
    reply.header("access-control-allow-origin", "*").header("access-control-allow-headers", "content-type");
  });
  app.options("/relay", async () => "");
  app.post<{ Body: { signedDelegate?: string } }>("/relay", async (req, reply) => {
    let sd: SignedDelegate;
    try {
      const raw = Buffer.from(String(req.body?.signedDelegate ?? ""), "base64");
      if (!raw.length) throw new Error("empty");
      sd = decodeSignedDelegate(new Uint8Array(raw));
    } catch {
      return reply.code(400).send({ error: "bad_delegate" });
    }
    const refused = checkDelegate(sd, d.policy);
    if (refused) return reply.code(403).send({ error: refused });
    const da = sd.delegateAction;
    // I3: authenticate before any counter moves (the chain would also refuse, but only after we paid).
    let valid = false;
    try {
      const pk = PublicKey.from(da.publicKey.toString());
      valid = pk.verify(sha256(encodeDelegateAction(da)), sd.signature.data) && (await d.chain.hasKey(da.senderId, da.publicKey.toString()));
    } catch {
      valid = false;
    }
    if (!valid) return reply.code(401).send({ error: "bad_signature" });
    // C1: only parties of the piece are relayed.
    const piece = targetPiece(sd, d.policy);
    if (piece !== null) {
      const parties = piece === "invalid" ? null : await d.chain.parties(piece);
      if (!parties) return reply.code(403).send({ error: "unknown_piece" });
      if (!parties.includes(da.senderId)) return reply.code(403).send({ error: "sender_not_party" });
    }
    const units = budgetUnits(BigInt((da.actions[0] as any).functionCall.deposit));
    const now = d.now();
    if (!d.cap.can(da.senderId, now)) return reply.code(429).send({ error: "daily_cap" });
    if (!d.budget.can("relayer", now, units)) return reply.code(429).send({ error: "relayer_budget" });
    let out: Awaited<ReturnType<RelayerDeps["submit"]>>;
    try {
      out = await d.submit(sd);
    } catch (e: any) {
      return reply.code(502).send({ error: "submit_failed", message: String(e?.message ?? e).slice(0, 300) });
    }
    // Only submitted relays count (I3).
    d.cap.take(da.senderId, now);
    d.budget.take("relayer", now, units);
    return out;
  });
  app.get("/health", async () => ({ ok: true }));
  return app;
}
