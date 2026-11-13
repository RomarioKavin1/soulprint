/** The showcase (/gallery): sort, filters, search and the examples toggle all live in the URL. */
import { expect, test } from "@playwright/test";
import { live } from "./helpers.ts";

const L = live();
test.skip(!L, "needs the live sandbox (SOULPRINT_CONFIG=config/networks.json)");

test("gallery: filter, search, sort and the examples toggle are links to the same wall", async ({ page }) => {
  await page.goto("/gallery");
  const count = page.getByTestId("result-count");
  await expect(count).toContainText("works");
  await expect(page.getByTestId("example-card").first()).toBeVisible();

  // Examples off: only artists' works remain, and the URL says so.
  await page.getByLabel("Show examples").uncheck();
  await expect(page).toHaveURL(/examples=hide/);
  await expect(page.getByTestId("example-card")).toHaveCount(0);

  // Search finds an example by artist once examples are back on.
  await page.getByLabel("Show examples").check();
  await expect(page).not.toHaveURL(/examples=hide/);
  await page.getByLabel("Search titles and artists").fill("Vermeer");
  await page.getByRole("button", { name: "Search" }).click();
  await expect(page).toHaveURL(/q=Vermeer/);
  await expect(page.getByTestId("example-card")).toHaveCount(1);
  await expect(page.getByTestId("gallery-card")).toHaveCount(0);

  // A filter that matches nothing explains itself and offers a way back.
  await page.goto("/gallery?q=zzzz-no-such-work");
  await expect(page.getByTestId("no-results")).toBeVisible();
  await page.getByRole("link", { name: "Show every work" }).click();
  await expect(page).toHaveURL(/\/gallery$/);

  // For sale only: every price shown is a price; sorting is in the URL.
  await page.getByLabel("Availability").selectOption("for-sale");
  await expect(page).toHaveURL(/availability=for-sale/);
  for (const price of await page.getByTestId("card-price").allInnerTexts()) expect(price).toMatch(/USDC|NEAR/);
  await page.getByLabel("Sort").selectOption("price-asc");
  await expect(page).toHaveURL(/sort=price-asc/);
  await page.getByRole("button", { name: "Clear filters" }).click();
  await expect(page).toHaveURL(/\/gallery(\?sort=price-asc)?$/);
});
