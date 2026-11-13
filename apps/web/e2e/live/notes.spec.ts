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

test("reader questions: rated into view only by a clear majority, answered with more of the making, abuse hidden and removable — the level never moves", async ({ browser }) => {
  test.setTimeout(400_000);
  const pieceId = await publishedPiece();
  const levelBefore = (await view(L!.rpc, pieceId, "piece_info")).evidence_level;

  // A reader asks a specific question and asks for more frames. Visitors see nothing yet.
  const reader = await open(browser, pieceId, "buyer");
  await reader.getByTestId("add-note").click();
  await reader.getByLabel("Concern").selectOption("ai_generated");
  await reader.getByLabel("What you observed").fill("too short");
  await expect(reader.getByTestId("send-note")).toBeDisabled();
  await reader.getByLabel("What you observed").fill("Between the two public frames the whole figure appears finished, with no sketch or blocking-in underneath.");
  await reader.getByTestId("send-note").click();
  const mine = reader.locator('[data-testid=note][data-status=needs_ratings]');
  await expect(mine).toContainText("No ratings yet", { timeout: 20_000 });
  await expect(mine.getByTestId("note-request")).toHaveText("Asked for more frames of the making. Waiting for the artist.");
  await expect(reader.getByTestId("add-note")).toHaveCount(0);
  await expect(mine.getByTestId("rate")).toHaveCount(0); // not your own

  const visitor = await open(browser, pieceId);
  await expect(visitor.getByTestId("no-shown-notes")).toBeVisible();
  await visitor.goto("/notes");
  await expect(visitor.getByTestId("queue-signed-out")).toBeVisible(); // review B1
  await expect(visitor.locator("body")).not.toContainText("whole figure appears finished");

  const artist = await open(browser, pieceId, "artist");
  await expect(artist.locator("[data-testid=note]").getByTestId("rate")).toHaveCount(0);

  // Five other readers rate it: four is not enough, five of five shows it.
  const raters = ["client", "shop", "arbitrator", "fallback_arbitrator", "buyer2"];
  for (const [i, role] of raters.entries()) {
    const p = await open(browser, pieceId, role);
    const note = p.locator("[data-testid=note]").filter({ hasText: "whole figure appears finished" });
    await note.getByLabel("Why").selectOption("y:specific_details");
    await note.getByTestId("rate").click();
    await expect(note.getByText("You rated it useful.")).toBeVisible({ timeout: 20_000 });
    if (i === 3) {
      await visitor.goto(`/p/${pieceId}`);
      await expect(visitor.getByTestId("no-shown-notes")).toBeVisible({ timeout: 20_000 });
    }
    await p.context().close();
  }

  // The artist shows more of the making and answers.
  await ev("artist", "POST", `/pieces/${pieceId}/visibility`, { indices: [2, 4, 6, 8], level: "public" });
  await artist.reload();
  await artist.getByLabel("Your answer").fill("I sketch on paper first; I have made the early frames public so the blocking-in is visible.");
  await artist.getByTestId("answer").click();
  await expect(artist.getByTestId("note-response")).toContainText("I sketch on paper first", { timeout: 20_000 });

  await visitor.goto(`/p/${pieceId}`);
  const shown = visitor.locator('[data-testid=note][data-status=shown]');
  await expect(shown.getByTestId("note-question")).toHaveText("Could this have been made with AI?", { timeout: 20_000 });
  await expect(shown.getByTestId("note-rating")).toHaveText("5 of 5 readers found this question useful");
  await expect(shown.getByTestId("note-request")).toHaveText("Asked for more frames of the making. The artist made 4 more frames public.");
  await expect(shown.getByTestId("note-response")).toContainText("I sketch on paper first");

  // An accusation: two "about the person" ratings hide it however many others liked it; an operator removes it.
  const troll = await open(browser, pieceId, "client");
  await troll.getByTestId("add-note").click();
  await troll.getByLabel("What you observed").fill("This is obviously AI. The artist is a fraud and a scammer, do not buy anything from them.");
  await troll.getByTestId("send-note").click();
  await expect(troll.locator("[data-testid=note]").filter({ hasText: "fraud" })).toBeVisible({ timeout: 20_000 });
  for (const role of ["shop", "arbitrator"]) {
    const p = await open(browser, pieceId, role);
    const note = p.locator("[data-testid=note]").filter({ hasText: "fraud" });
    await note.getByLabel("Why").selectOption("n:personal_attack");
    await note.getByTestId("rate").click();
    await expect(note.getByText("You rated it not useful.")).toBeVisible({ timeout: 20_000 });
    if (role === "shop") {
      await note.getByTestId("report").click();
      await note.getByTestId("report-personal_attack").click();
      await expect(p.getByText("Reported to the operators.")).toBeVisible({ timeout: 20_000 });
    }
    await p.context().close();
  }
  // The operator (on the local chain: the governance account, which stays server-side) sees the report and removes it.
  const reported = (await ev("governance", "GET", "/context-notes/reported")).json.notes.find((n: any) => n.pieceId === pieceId);
  expect(reported).toMatchObject({ reports: 1, reasons: ["personal_attack"] });
  expect((await ev("governance", "POST", `/context-notes/${reported.id}/remove`, { reason: "personal_attack" })).status).toBe(200);
  await troll.reload();
  await expect(troll.locator("[data-testid=note]").filter({ hasText: "fraud" })).toHaveCount(0, { timeout: 20_000 });
  await visitor.reload();
  await expect(visitor.locator("body")).not.toContainText("fraud");
  expect(await visitor.locator("body").innerText()).not.toMatch(/\bfake\b/i);

  // The gallery badge is neutral and says the artist answered; the evidence level is untouched.
  await visitor.goto("/gallery");
  const card = visitor.getByTestId("gallery-card").filter({ has: visitor.locator(`a[href="/p/${pieceId}"]`) });
  await expect(card.getByTestId("card-notes")).toHaveText("The artist answered a reader's question", { timeout: 20_000 });
  expect((await view(L!.rpc, pieceId, "piece_info")).evidence_level).toBe(levelBefore);

  // The reader can withdraw their question; it disappears for everyone.
  await reader.goto(`/p/${pieceId}?as=${L!.c.accounts.buyer.account_id}`);
  await reader.getByTestId("withdraw").click();
  await visitor.goto(`/p/${pieceId}`);
  await expect(visitor.getByTestId("no-shown-notes")).toBeVisible({ timeout: 20_000 });
});
