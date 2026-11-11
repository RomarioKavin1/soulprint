/**
 * Copy rule (Plan 3 Global Constraints, v2.2 amendment): creator and client screens never show
 * "NFT", "mint", "gas" or "wallet" in rendered text. Scans what a person sees, not source code.
 */
import { expect, test } from "@playwright/test";
import { CREATOR_CLIENT_ROUTES } from "./routes.ts";

const FORBIDDEN = /\b(nfts?|mint(ed|ing|s)?|gas|wallets?)\b/i;

test("copy_lint_forbidden_words_absent_in_creator_client_routes", async ({ page }) => {
  expect(CREATOR_CLIENT_ROUTES.length).toBeGreaterThan(0);
  for (const route of CREATOR_CLIENT_ROUTES) {
    await page.goto(route);
    await page.waitForLoadState("networkidle");
    const text = await page.locator("body").innerText();
    const title = await page.title();
    const attrs = await page.$$eval("[aria-label],[title],[placeholder],img[alt]", (els) =>
      els.map((e) => [e.getAttribute("aria-label"), e.getAttribute("title"), e.getAttribute("placeholder"), e.getAttribute("alt")].filter(Boolean).join(" ")),
    );
    for (const chunk of [text, title, ...attrs]) {
      const m = FORBIDDEN.exec(chunk);
      expect(m, `route ${route} shows forbidden word "${m?.[0]}" in: ${chunk.slice(Math.max(0, (m?.index ?? 0) - 40), (m?.index ?? 0) + 40)}`).toBeNull();
    }
  }
});
