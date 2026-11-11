import { expect, test } from "@playwright/test";
import { live, view } from "./helpers.ts";

const L = live();
test.skip(!L, "needs the live sandbox (SOULPRINT_CONFIG=config/networks.json)");

test("terms_hash_shown_equals_contract_terms_hash (studio creates a commission)", async ({ page }) => {
  await page.goto(`/studio/new?as=${L!.artist}`);
  await page.getByLabel("Client account (optional)").fill(L!.client);
  await page.getByLabel("Price").fill("25");
  const shown = await page.getByTestId("terms-hash").innerText();
  await page.getByRole("button", { name: "Create the commission" }).click();
  await page.waitForURL(/\/studio\/p\d+\./, { timeout: 60_000 });
  const pieceId = decodeURIComponent(page.url().split("/studio/")[1]!);
  await expect(page.getByTestId("status")).toHaveText("Waiting for the client's payment", { timeout: 20_000 });
  const info = await view(L!.rpc, pieceId, "piece_info");
  expect(info.terms_hash).toBe(shown);
  expect(info.artist).toBe(L!.artist);
  await expect(page.getByTestId("client-link")).toContainText(`/c/${pieceId}`);
});
