import { expect, test } from "@playwright/test";
import { deliver, fund, live, newCommission, view } from "./helpers.ts";

const L = live();
test.skip(!L, "needs the live sandbox (SOULPRINT_CONFIG=config/networks.json)");

test("reload_after_fund_shows_funded_from_chain", async ({ page, browser }) => {
  const { pieceId } = await newCommission();
  await page.goto(`/c/${pieceId}?as=${L!.client}`);
  await expect(page.getByTestId("room-status")).toHaveText("Waiting for the client's payment");
  await page.getByTestId("fund").click();
  await expect(page.getByTestId("room-status")).toHaveText("In progress", { timeout: 30_000 });
  await page.reload();
  await expect(page.getByTestId("room-status")).toHaveText("In progress");
  await expect(page.getByTestId("escrow")).toHaveText("25 USDC");
  // A different browser with no local state sees the same thing: it comes from the chain.
  const other = await (await browser.newContext()).newPage();
  await other.goto(`/c/${pieceId}?as=${L!.client}`);
  await expect(other.getByTestId("room-status")).toHaveText("In progress");
  expect((await view(L!.rpc, pieceId, "piece_info")).owner).toBe(L!.client);
});

test("concurrent_accept_reject_shows_chain_result", async ({ browser }) => {
  const { pieceId, t } = await newCommission();
  await fund(pieceId, t);
  await deliver(pieceId);
  const a = await (await browser.newContext()).newPage();
  const b = await (await browser.newContext()).newPage();
  for (const p of [a, b]) await p.goto(`/c/${pieceId}?as=${L!.client}`);
  await a.getByTestId("accept").click();
  await b.getByTestId("reject").click();
  await expect(b.getByTestId("confirm")).toContainText("1.25 USDC"); // reject_shows_bond_amount_before_confirm (5% of 25)
  await Promise.all([a.getByTestId("confirm-yes").click(), b.getByTestId("confirm-yes").click()]);
  await expect.poll(async () => (await view(L!.rpc, pieceId, "piece_info")).status, { timeout: 30_000 }).toMatch(/Settled|Disputed/);
  const final = (await view(L!.rpc, pieceId, "piece_info")).status;
  const label = final === "Settled" ? "Complete" : "In dispute";
  for (const p of [a, b]) await expect(p.getByTestId("room-status")).toHaveText(label, { timeout: 20_000 });
  const loser = final === "Settled" ? b : a;
  // On a public network the loser's own call can still be in flight when polling shows the outcome;
  // a dropped transaction is only known after the signer's read-back (about 40 s).
  await expect(loser.getByTestId("race-notice")).toContainText(final === "Settled" ? "now complete" : "now in dispute", { timeout: 75_000 });
});
