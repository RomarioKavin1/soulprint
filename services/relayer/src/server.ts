import Fastify from "fastify";
import { decodeSignedDelegate, type SignedDelegate } from "near-api-js";
import { checkDelegate, type DailyCap, type Policy } from "./allowlist.ts";

export interface RelayerDeps {
  policy: Policy;
  cap: DailyCap;
  now: () => number;
  submit(sd: SignedDelegate): Promise<{ txHash: string }>;
}

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
    if (!d.cap.take(sd.delegateAction.senderId, d.now())) return reply.code(429).send({ error: "daily_cap" });
    try {
      return await d.submit(sd);
    } catch (e: any) {
      return reply.code(502).send({ error: "submit_failed", message: String(e?.message ?? e).slice(0, 300) });
    }
  });
  app.get("/health", async () => ({ ok: true }));
  return app;
}
