/** Showcase pivot (12 Nov): make → finish → publish → gallery → collect → tip, through the real UI. */
import { expect, test, type Page } from "@playwright/test";
import { live, view } from "./helpers.ts";

const L = live();
test.skip(!L, "needs the live sandbox (SOULPRINT_CONFIG=config/networks.json)");

// 1×1 PNG.
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==", "base64");

async function person(browser: any, role: "artist" | "buyer" | "shop") {
  const p: Page = await (await browser.newContext()).newPage();
  return { p, id: L!.c.accounts[role].account_id as string };
}
const usdc = async (account: string) => BigInt(await view(L!.rpc, L!.c.currency_token, "ft_balance_of", { account_id: account }) as string);

test("showcase: own piece recorded, finished, published to the gallery, collected, and the artist tipped", async ({ browser }) => {
  test.setTimeout(300_000);
  const artist = await person(browser, "artist");
  const buyer = await person(browser, "buyer");
  const fan = await person(browser, "shop");

  // Make: a piece of the artist's own, no client.
  await artist.p.goto(`/studio/new?mode=standalone&as=${artist.id}`);
  await artist.p.getByRole("button", { name: "Create the piece" }).click();
  await artist.p.waitForURL(/\/studio\/p\d+\./, { timeout: 60_000 });
  const pieceId = decodeURIComponent(artist.p.url().split("/studio/")[1]!.split("?")[0]!);
  await expect(artist.p.getByTestId("status")).toHaveText("Being made", { timeout: 20_000 });

  await artist.p.getByRole("button", { name: "Record with camera" }).click();
  await expect(artist.p.getByText("Recording", { exact: true })).toBeVisible({ timeout: 20_000 });
  for (let i = 0; i < 3; i++) await artist.p.getByRole("button", { name: "Take a frame now" }).click();
  await expect(artist.p.getByText(/^[4-9]\d* of [4-9]\d* frames saved to the record$|^\d{2,} of \d{2,} frames saved/)).toBeVisible({ timeout: 40_000 });
  await artist.p.getByRole("button", { name: "Stop" }).click();
  await expect(artist.p.getByRole("button", { name: "Show to client" })).toHaveCount(0);
  await artist.p.getByRole("button", { name: "Select all" }).click();
  await artist.p.getByRole("button", { name: "Show on the public page" }).click();

  // Finish and seal.
  await artist.p.locator('input[type="file"]').first().setInputFiles({ name: "final.png", mimeType: "image/png", buffer: PNG });
  await artist.p.getByRole("button", { name: "Check the record" }).click();
  await expect(artist.p.getByText("What the public page will say")).toBeVisible({ timeout: 90_000 });
  await artist.p.getByRole("button", { name: "Finish and seal the record" }).click();
  await expect(artist.p.getByTestId("status")).toHaveText("Finished", { timeout: 30_000 });

  // Show: publish with a story; it appears in the gallery and on the artist's page.
  await artist.p.getByLabel("Title").fill("Harbour study");
  await artist.p.getByLabel("Story").fill("Ink first, then washes.");
  await artist.p.getByTestId("publish").click();
  await expect(artist.p.getByTestId("publish-state")).toHaveText("Published", { timeout: 20_000 });
  await artist.p.reload(); // the studio shows what is published (review B8)
  await expect(artist.p.getByLabel("Story")).toHaveValue("Ink first, then washes.", { timeout: 20_000 });
  await expect(artist.p.getByLabel("Title")).toHaveValue("Harbour study");

  await fan.p.goto("/gallery");
  const card = fan.p.getByTestId("gallery-card").filter({ has: fan.p.locator(`a[href="/p/${pieceId}"]`) });
  await expect(card).toBeVisible({ timeout: 20_000 });
  await expect(card).toContainText("Declared"); // a short browser session: honest E0
  await expect(card.getByRole("img", { name: "Harbour study" })).toBeVisible(); // the finished work, not a frame (review B9)
  await expect(card).toContainText("Harbour study");
  await card.getByTestId("card-artist").click();
  await expect(fan.p.getByTestId("artist-name")).toHaveText(artist.id);
  await expect(fan.p.locator(`a[href="/p/${pieceId}"]`).first()).toBeVisible();

  // Offer it to collectors.
  await artist.p.reload();
  await artist.p.getByLabel("Sale price").fill("3");
  await artist.p.getByTestId("list").click();
  await expect(artist.p.getByTestId("listed")).toContainText("3 USDC", { timeout: 30_000 });

  // A supporter tips the artist from the piece's page (straight to the artist, piece unchanged).
  const before = await usdc(artist.id);
  await fan.p.goto(`/p/${pieceId}?as=${fan.id}`);
  await expect(fan.p.getByTestId("holder")).toHaveText("Held by the artist.", { timeout: 20_000 });
  await fan.p.getByTestId("tip-open").click();
  await fan.p.getByLabel("Tip amount").fill("-1");
  await expect(fan.p.getByTestId("tip")).toBeDisabled(); // review B6
  await expect(fan.p.getByTestId("tip-invalid")).toBeVisible();
  await fan.p.getByLabel("Tip amount").fill("1.5");
  await fan.p.getByTestId("tip").click();
  await expect(fan.p.getByTestId("tip-sent")).toContainText(`Sent 1.5 USDC to ${artist.id}`, { timeout: 30_000 });
  expect(await usdc(artist.id)).toBe(before + 1_500_000n);

  // A collector buys it from the same page.
  await buyer.p.goto(`/p/${pieceId}?as=${buyer.id}`);
  await expect(buyer.p.getByTestId("collect-price")).toHaveText("3 USDC", { timeout: 20_000 });
  await buyer.p.getByTestId("collect-buy").click();
  await expect(buyer.p.getByTestId("holder")).toHaveText(`Collected by ${buyer.id}.`, { timeout: 30_000 });
  await expect(buyer.p.getByText("This piece is yours.")).toBeVisible();
  await buyer.p.getByRole("tab", { name: "Rights" }).click();
  await expect(buyer.p.getByText(`Current holder: ${buyer.id}.`)).toBeVisible({ timeout: 20_000 }); // review B7
  expect((await view(L!.rpc, pieceId, "piece_info")).owner).toBe(buyer.id);
});
