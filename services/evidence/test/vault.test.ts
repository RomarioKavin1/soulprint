import { describe, expect, it } from "vitest";
import { b64 } from "@soulprint/proof";
import { nep413, PIECE, tinyImage, user, world } from "./helpers.ts";

async function setup() {
  let now = Date.now();
  const w = await world({ now: () => now });
  const call = async (who: any, method: "GET" | "POST", url: string, body?: unknown) =>
    w.app.inject({ method, url, payload: body as any, headers: who ? { authorization: await nep413(who, method, url, body) } : {} });
  const img = await tinyImage();
  await call(w.artist, "POST", `/pieces/${PIECE}/files`, { kind: "final", name: "final.png", data: b64.encode(img) });
  const p = w.chain.pieces.get(PIECE)!;
  p.status = "Settled";
  p.rotationSeq = 1;
  w.chain.index.set("1", w.client.account);
  return { ...w, call, p, img, tick: (ms: number) => (now += ms) };
}
const open = (w: Awaited<ReturnType<typeof setup>>, who: any) => w.call(who, "POST", `/pieces/${PIECE}/vault`, {});

describe("holder vault", () => {
  it("owner gets short-lived links bound to the rotation; the file downloads", async () => {
    const w = await setup();
    const r = await open(w, w.client);
    expect(r.statusCode).toBe(200);
    const f = r.json().files[0];
    expect(f).toMatchObject({ kind: "final", name: "final.png" });
    expect(r.json().expiresIn).toBe(300);
    const d = await w.app.inject({ method: "GET", url: f.url });
    expect(d.statusCode).toBe(200);
    expect([...d.rawPayload]).toEqual([...w.img]);
    w.tick(301_000);
    expect((await w.app.inject({ method: "GET", url: f.url })).json().error).toBe("link_expired");
    expect((await w.app.inject({ method: "GET", url: f.url.replace(/sig=[^&]+/, "sig=AAAA") })).statusCode).toBe(403);
  });

  it("vault_denied_before_settled", async () => {
    const w = await setup();
    w.p.status = "Delivered";
    expect((await open(w, w.client)).json().error).toBe("not_settled");
  });

  it("vault_denied_during_transfer_pending", async () => {
    const w = await setup();
    w.p.transferPending = true;
    const r = await open(w, w.client);
    expect(r.statusCode).toBe(409);
    expect(r.json().error).toBe("transfer_pending");
  });

  it("old_holder_vault_denied_after_transfer: new requests and links already issued", async () => {
    const w = await setup();
    const url = (await open(w, w.client)).json().files[0].url;
    const buyer = await user("buyer.test.near", 21, w.chain);
    w.p.owner = buyer.account;
    w.p.rotationSeq = 2;
    w.chain.index.set("1", buyer.account);
    expect((await open(w, w.client)).json().error).toBe("not_owner");
    expect((await w.app.inject({ method: "GET", url })).json().error).toBe("owner_changed");
    expect((await open(w, buyer)).statusCode).toBe(200);
  });

  it("lagging_index_triggers_sync_not_deny", async () => {
    const w = await setup();
    w.chain.index.set("1", "someone.else.near"); // collection index behind the piece
    const r = await open(w, w.client);
    expect(r.statusCode).toBe(200);
    expect(w.sender.syncs).toEqual([{ collection: "soulprint.test.near", tokenId: "1" }]);
  });

  it("strangers and the unsigned are refused", async () => {
    const w = await setup();
    expect((await open(w, w.stranger)).json().error).toBe("not_owner");
    expect((await w.app.inject({ method: "POST", url: `/pieces/${PIECE}/vault`, payload: {} })).statusCode).toBe(401);
  });
});
