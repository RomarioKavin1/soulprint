/** DESIGN §10 flows through the real UI against the sandbox (seconds-scale TimeConfig). */
import { expect, test, type Page } from "@playwright/test";
import { as, deliver, fund, live, newCommission, view } from "./helpers.ts";

const L = live();
test.skip(!L, "needs the live sandbox (SOULPRINT_CONFIG=config/networks.json)");

// 1×1 PNG.
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==", "base64");

async function person(browser: any, role: "artist" | "client" | "buyer" | "arbitrator") {
  const p: Page = await (await browser.newContext()).newPage();
  return { p, id: L!.c.accounts[role].account_id as string };
}

test("commission_happy_path: offer → pay → record in the browser → deliver → accept → proof page", async ({ browser }) => {
  test.setTimeout(240_000);
  const artist = await person(browser, "artist");
  const client = await person(browser, "client");

  await artist.p.goto(`/studio/new?as=${artist.id}`);
  await artist.p.getByLabel("Client account (optional)").fill(client.id);
  await artist.p.getByLabel("Price").fill("25");
  await artist.p.getByRole("button", { name: "Create the commission" }).click();
  await artist.p.waitForURL(/\/studio\/p\d+\./, { timeout: 60_000 });
  const pieceId = decodeURIComponent(artist.p.url().split("/studio/")[1]!.split("?")[0]!);

  await client.p.goto(`/c/${pieceId}?as=${client.id}`);
  await client.p.getByTestId("fund").click();
  await expect(client.p.getByTestId("room-status")).toHaveText("In progress", { timeout: 30_000 });

  // Record with the (fake) camera; take a few frames on demand.
  await expect(artist.p.getByTestId("status")).toHaveText("In progress", { timeout: 20_000 });
  await artist.p.getByRole("button", { name: "Record with camera" }).click();
  await expect(artist.p.getByText("Recording", { exact: true })).toBeVisible({ timeout: 20_000 });
  for (let i = 0; i < 3; i++) await artist.p.getByRole("button", { name: "Take a frame now" }).click();
  await expect(artist.p.getByText(/^[4-9]\d* of [4-9]\d* frames saved to the record$|^\d{2,} of \d{2,} frames saved/)).toBeVisible({ timeout: 40_000 });
  await artist.p.getByRole("button", { name: "Stop" }).click();

  // Share progress with the client.
  await artist.p.getByRole("button", { name: "Select all" }).click();
  await artist.p.getByRole("button", { name: "Show to client" }).click();
  await client.p.reload();
  await expect(client.p.getByRole("img", { name: /Progress frame/ }).first()).toBeVisible({ timeout: 20_000 });

  // Deliver.
  await artist.p.locator('input[type="file"]').first().setInputFiles({ name: "final.png", mimeType: "image/png", buffer: PNG });
  await artist.p.getByRole("button", { name: "Check the record" }).click();
  await expect(artist.p.getByText("What the proof page will say")).toBeVisible({ timeout: 90_000 });
  await artist.p.getByRole("button", { name: "Deliver to the client" }).click();
  await expect(artist.p.getByTestId("status")).toHaveText("Delivered — client reviewing", { timeout: 30_000 });

  await client.p.reload();
  await client.p.getByTestId("accept").click();
  await client.p.getByTestId("confirm-yes").click();
  await expect(client.p.getByTestId("room-status")).toHaveText("Complete", { timeout: 30_000 });
  await expect.poll(async () => (await view(L!.rpc, pieceId, "proof_page", { from: 0, limit: 1 })).attestation.report_hash, { timeout: 40_000 }).toBe((await view(L!.rpc, pieceId, "piece_info")).report_hash);

  await artist.p.reload();
  await artist.p.getByTestId("publish").click();
  await expect(artist.p.getByText("Published.")).toBeVisible({ timeout: 20_000 });
  await client.p.goto(`/p/${pieceId}`);
  await expect(client.p.getByTestId("evidence-sentence")).toBeVisible();
  await expect(client.p.getByTestId("badge")).toHaveText("Commissioned and accepted");
  await expect(client.p.getByTestId("recompute")).toContainText("✓");
});

test("refund_after_deadline: the refund button appears only once the deadline and grace have passed", async ({ browser }) => {
  test.setTimeout(120_000);
  const { pieceId, t } = await newCommission(25_000_000n, { deadline_ns: String(BigInt(Date.now() + 15_000) * 1_000_000n), grace_ns: "0" });
  await fund(pieceId, t);
  const client = await person(browser, "client");
  await client.p.goto(`/c/${pieceId}?as=${client.id}`);
  await expect(client.p.getByTestId("room-status")).toHaveText("In progress");
  await expect(client.p.getByTestId("refund")).toHaveCount(0);
  await expect(client.p.getByTestId("refund")).toBeVisible({ timeout: 60_000 });
  await client.p.getByTestId("refund").click();
  await expect(client.p.getByTestId("room-status")).toHaveText("Refunded", { timeout: 30_000 });
});

test("dispute_each_stage: refuse → negotiation → arbitrator decides in the room", async ({ browser }) => {
  test.setTimeout(150_000);
  const { pieceId, t } = await newCommission();
  await fund(pieceId, t);
  await deliver(pieceId);
  const client = await person(browser, "client");
  await client.p.goto(`/c/${pieceId}?as=${client.id}`);
  await client.p.getByTestId("reject").click();
  await client.p.getByTestId("confirm-yes").click();
  await expect(client.p.getByTestId("room-status")).toHaveText("In dispute", { timeout: 30_000 });
  await expect(client.p.getByRole("button", { name: "Propose this split" })).toBeVisible(); // negotiation stage
  const arb = await person(browser, "arbitrator");
  await arb.p.goto(`/c/${pieceId}?as=${arb.id}`);
  await expect(arb.p.getByRole("button", { name: "Decide" })).toBeVisible({ timeout: 60_000 }); // after the negotiation window
  await arb.p.getByLabel("Award to the artist").fill("");
  await expect(arb.p.getByRole("button", { name: "Decide" })).toBeDisabled(); // an empty field is not 0%
  await arb.p.getByLabel("Award to the artist").fill("60");
  await arb.p.getByRole("button", { name: "Decide" }).click();
  await expect(arb.p.getByTestId("confirm")).toContainText("15 USDC to the artist and 10 USDC to the client");
  await arb.p.getByTestId("confirm-yes").click();
  await expect(arb.p.getByTestId("room-status")).toHaveText("Complete", { timeout: 30_000 });
  const acc = await view(L!.rpc, pieceId, "accounting");
  const credit = (who: string) => BigInt(acc.credits.find((c: any) => c.account === who)?.available ?? "0");
  // 60% of 25 USDC, plus the refusal deposit the client forfeits when the decision goes to the artist.
  expect(credit(L!.artist)).toBe(15_000_000n + 1_250_000n);
  void as;
});

test("revision_then_accept: changes requested in the room, redelivered, accepted", async ({ browser }) => {
  test.setTimeout(120_000);
  const { pieceId, t } = await newCommission();
  await fund(pieceId, t);
  await deliver(pieceId);
  const client = await person(browser, "client");
  await client.p.goto(`/c/${pieceId}?as=${client.id}`);
  await client.p.getByRole("button", { name: /Ask for changes \(2 left\)/ }).click();
  await expect(client.p.getByTestId("room-status")).toHaveText("In progress", { timeout: 30_000 });
  expect((await view(L!.rpc, pieceId, "piece_info")).revisions_used).toBe(1);
  await deliver(pieceId);
  await client.p.reload();
  await expect(client.p.getByRole("button", { name: /Ask for changes \(1 left\)/ })).toBeVisible({ timeout: 20_000 });
  await client.p.getByTestId("accept").click();
  await client.p.getByTestId("confirm-yes").click();
  await expect(client.p.getByTestId("room-status")).toHaveText("Complete", { timeout: 30_000 });
});
