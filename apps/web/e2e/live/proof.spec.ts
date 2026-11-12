import { expect, test } from "@playwright/test";
import { b64, nearPublicKey, nobleSigner } from "@soulprint/proof";
import { Device } from "../../../../services/evidence/test/helpers.ts";
import { frames as synthFrames, jpeg, painting, target } from "../../../../services/evidence/test/synth.ts";
import { authHeader } from "../../lib/auth.ts";
import { as, fund, live, newCommission, view } from "./helpers.ts";

const L = live();
test.skip(!L, "needs the live sandbox (SOULPRINT_CONFIG=config/networks.json)");
const EV = process.env.EVIDENCE_URL ?? "http://127.0.0.1:8787";

async function ev(role: string | null, method: "GET" | "POST", path: string, body?: unknown) {
  const raw = body === undefined ? "" : JSON.stringify(body);
  const headers: Record<string, string> = body === undefined ? {} : { "content-type": "application/json" };
  if (role) headers.authorization = await authHeader(as(role), method, path, raw, "soulprint-evidence");
  const r = await fetch(EV + path, { method, headers, ...(body === undefined ? {} : { body: raw }) });
  return { status: r.status, json: await r.json().catch(() => null) };
}

test("proof page: private until published, then the facts, badge and a matching fingerprint — never the price", async ({ page }) => {
  test.setTimeout(180_000);
  const seed = new Uint8Array(32).fill(42);
  const capture = nearPublicKey((await nobleSigner(seed)).publicKey);
  const { pieceId, t } = await newCommission(25_000_000n, {}, capture);
  await fund(pieceId, t);

  // Record: synthetic painting frames, unique per run (the service refuses reused frames).
  const salt = crypto.getRandomValues(new Uint8Array(8));
  const imgs = (await synthFrames(painting())).map((f) => new Uint8Array([...f.jpeg, ...salt]));
  const dev = await Device.make(pieceId, 42);
  dev.capture(imgs.length, imgs, 5 * 60_000);
  for (let i = 0; i < imgs.length; i += 10) {
    const r = await fetch(`${EV}/pieces/${pieceId}/frames`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(await dev.batch(i, Math.min(i + 9, imgs.length - 1))) });
    expect(r.status, await r.text()).toBe(200);
  }
  const final = new Uint8Array([...(await jpeg(target())), ...salt]);
  expect((await ev("artist", "POST", `/pieces/${pieceId}/files`, { kind: "final", name: "final.jpg", data: b64.encode(final) })).status).toBe(200);
  let report: any;
  await expect.poll(async () => ((report = await ev("artist", "POST", `/pieces/${pieceId}/report`, { source: "camera" })).status), { timeout: 60_000, intervals: [2000] }).toBe(200);
  // Uploaded in one go: the service clock (Plan 2 review C2) refuses to credit hours of device time.
  expect(report.json.level).toBe(0);
  await as("artist").call(pieceId, "deliver", { final_file_hash: report.json.finalFileHash, report_hash: report.json.reportHash }, { deposit: 10n ** 22n, tgas: 100n });
  // The service reads the chain at `final` finality, a few blocks behind: retry like the studio does.
  await expect.poll(async () => (await ev("artist", "POST", `/pieces/${pieceId}/attest`)).status, { timeout: 30_000, intervals: [1500] }).toBe(200);
  await as("client").call(pieceId, "accept", {}, { deposit: 10n ** 22n, tgas: 100n });
  await expect.poll(async () => (await view(L!.rpc, pieceId, "proof_page", { from: 0, limit: 1 })).attestation.report_hash, { timeout: 20_000 }).toBe(report.json.reportHash);

  await page.goto(`/p/${pieceId}`);
  await expect(page.getByTestId("proof-private")).toBeVisible();

  const vis = await ev("artist", "POST", `/pieces/${pieceId}/visibility`, { indices: [0, 10, 20], level: "public" });
  expect([vis.status, vis.json]).toEqual([200, expect.anything()]);
  expect((await ev("artist", "POST", `/pieces/${pieceId}/story`, { text: "A study in three sittings." })).status).toBe(200);
  expect((await ev("artist", "POST", `/pieces/${pieceId}/publish`, { published: true })).status).toBe(200);
  await page.reload();
  await expect(page.getByTestId("evidence-sentence")).toHaveText("Declared by the artist.");
  await expect(page.getByTestId("badge")).toHaveText("Commissioned and accepted");
  await expect(page.getByTestId("recompute")).toContainText("✓ Recomputed in your browser");
  await expect(page.getByRole("img", { name: /Frame/ })).toBeVisible();
  const text = await page.locator("body").innerText();
  expect(text).not.toMatch(/25 USDC|25,000,000|25000000|price/i);
});
