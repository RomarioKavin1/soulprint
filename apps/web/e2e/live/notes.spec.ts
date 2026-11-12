/** Reader notes (13 Nov): ask about a record → others rate it → shown with the artist's answer. */
import { expect, test, type Page } from "@playwright/test";
import { b64, nearPublicKey, nobleSigner } from "@soulprint/proof";
import { Device } from "../../../../services/evidence/test/helpers.ts";
import { frames as synthFrames, jpeg, painting, target } from "../../../../services/evidence/test/synth.ts";
import { authHeader } from "../../lib/auth.ts";
import { ChainView } from "../../lib/near.ts";
import { createPiece } from "../../lib/piece.ts";
import { licenceHash, type Grant } from "../../lib/terms.ts";
import { as, live, view } from "./helpers.ts";

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

/** A finished, published piece of the artist's own, with a few public frames. */
async function publishedPiece() {
  const seed = new Uint8Array(32).fill(43);
  const capture = nearPublicKey((await nobleSigner(seed)).publicKey);
  const grant: Grant = { kind: "Personal", attribution: true, transferable: true };
  const { pieceId } = await createPiece(new ChainView(L!.rpcs), as("artist"), L!.collection, {
    Standalone: { currency: { Ft: L!.c.currency_token }, royalty_bps: 500, grant, licence_text_hash: b64.encode(licenceHash("", grant)) },
  }, capture);
  const salt = crypto.getRandomValues(new Uint8Array(8));
  const imgs = (await synthFrames(painting())).map((f) => new Uint8Array([...f.jpeg, ...salt]));
  const dev = await Device.make(pieceId, 43);
  dev.capture(imgs.length, imgs, 5 * 60_000);
  for (let i = 0; i < imgs.length; i += 10) {
    const r = await fetch(`${EV}/pieces/${pieceId}/frames`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(await dev.batch(i, Math.min(i + 9, imgs.length - 1))) });
    expect(r.status, await r.text()).toBe(200);
  }
  const final = new Uint8Array([...(await jpeg(target())), ...salt]);
  expect((await ev("artist", "POST", `/pieces/${pieceId}/files`, { kind: "final", name: "final.jpg", data: b64.encode(final) })).status).toBe(200);
  let report: any;
  await expect.poll(async () => ((report = await ev("artist", "POST", `/pieces/${pieceId}/report`, { source: "camera" })).status), { timeout: 60_000, intervals: [2000] }).toBe(200);
  await as("artist").call(pieceId, "settle_standalone", { final_file_hash: report.json.finalFileHash, report_hash: report.json.reportHash }, { deposit: 10n ** 22n, tgas: 100n });
  await expect.poll(async () => (await ev("artist", "POST", `/pieces/${pieceId}/attest`)).status, { timeout: 30_000, intervals: [1500] }).toBe(200);
  await ev("artist", "POST", `/pieces/${pieceId}/visibility`, { indices: [0, 10], level: "public" });
  expect((await ev("artist", "POST", `/pieces/${pieceId}/publish`, { published: true })).status).toBe(200);
  return pieceId;
}

async function open(browser: any, pieceId: string, role?: string) {
  const p: Page = await (await browser.newContext()).newPage();
  await p.goto(`/p/${pieceId}${role ? `?as=${L!.c.accounts[role].account_id}` : ""}`);
  await expect(p.getByTestId("context-notes")).toBeVisible({ timeout: 30_000 });
  return p;
}

test("reader notes: a question is rated into view, the artist answers with more of the making, the gallery flags it — the level is unchanged", async ({ browser }) => {
  test.setTimeout(300_000);
  const pieceId = await publishedPiece();
  const levelBefore = (await view(L!.rpc, pieceId, "piece_info")).evidence_level;

  // A reader asks; it is not shown to visitors until rated.
  const reader = await open(browser, pieceId, "buyer");
  await reader.getByTestId("add-note").click();
  await reader.getByLabel("Concern").selectOption("ai_generated");
  await reader.getByLabel("What you observed").fill("too short");
  await expect(reader.getByTestId("send-note")).toBeDisabled();
  await reader.getByLabel("What you observed").fill("Between the two public frames the whole figure appears finished, with no sketch or blocking-in underneath.");
  await reader.getByTestId("send-note").click();
  await expect(reader.locator('[data-testid=note][data-status=needs_ratings]')).toContainText("No ratings yet", { timeout: 20_000 });
  await expect(reader.getByTestId("add-note")).toHaveCount(0); // one note per person per piece

  const visitor = await open(browser, pieceId);
  await expect(visitor.getByTestId("no-shown-notes")).toBeVisible();

  // The artist cannot rate it but can answer; the reader cannot rate their own note.
  const artist = await open(browser, pieceId, "artist");
  await expect(artist.locator("[data-testid=note]").getByTestId("rate")).toHaveCount(0);
  await expect(reader.locator("[data-testid=note]").getByTestId("rate")).toHaveCount(0);

  // Three other people rate it helpful.
  for (const role of ["client", "shop", "arbitrator"]) {
    const p = await open(browser, pieceId, role);
    const note = p.locator("[data-testid=note]").first();
    await note.getByLabel("Why").selectOption("y:specific_details");
    await note.getByTestId("rate").click();
    await expect(note.getByText("You rated it helpful.")).toBeVisible({ timeout: 20_000 });
  }

  // The artist shows more of the making and answers.
  await ev("artist", "POST", `/pieces/${pieceId}/visibility`, { indices: [2, 4, 6, 8], level: "public" });
  await artist.reload();
  await artist.getByLabel("Your answer").fill("I sketch on paper first; I have made the early frames public so the blocking-in is visible.");
  await artist.getByTestId("answer").click();
  await expect(artist.getByTestId("note-response")).toContainText("I sketch on paper first", { timeout: 20_000 });

  await visitor.reload();
  const shown = visitor.locator('[data-testid=note][data-status=shown]');
  await expect(shown).toContainText("May have been generated by AI", { timeout: 20_000 });
  await expect(shown.getByTestId("note-rating")).toHaveText("Rated helpful by 3 of 3 people");
  await expect(shown.getByTestId("note-response")).toContainText("the artist made 4 more frames of the making public");
  expect(await visitor.locator("body").innerText()).not.toMatch(/\bfake\b/i);

  // The gallery card says readers added context; the evidence level is untouched.
  await visitor.goto("/");
  const card = visitor.getByTestId("gallery-card").filter({ has: visitor.locator(`a[href="/p/${pieceId}"]`) });
  await expect(card.getByTestId("card-notes")).toHaveText("Readers added context", { timeout: 20_000 });
  expect((await view(L!.rpc, pieceId, "piece_info")).evidence_level).toBe(levelBefore);
});
