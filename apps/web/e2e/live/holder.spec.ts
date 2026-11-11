import { expect, test } from "@playwright/test";
import { b64 } from "@soulprint/proof";
import { authHeader } from "../../lib/auth.ts";
import { as, deliver, fund, live, newCommission, view } from "./helpers.ts";

const L = live();
test.skip(!L, "needs the live sandbox (SOULPRINT_CONFIG=config/networks.json)");
const EV = process.env.EVIDENCE_URL ?? "http://127.0.0.1:8787";

test("vault, resale and income: old_holder_vault_denied_after_transfer, buy pinned to the listing", async ({ browser }) => {
  test.setTimeout(120_000);
  const { pieceId, t } = await newCommission(25_000_000n, { grant: { kind: "CommercialNonExclusive", attribution: true, transferable: true } });
  await fund(pieceId, t);
  const body = JSON.stringify({ kind: "final", name: "final.png", data: Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==", "base64").toString("base64") });
  const path = `/pieces/${pieceId}/files`;
  const up = await fetch(EV + path, { method: "POST", headers: { "content-type": "application/json", authorization: await authHeader(as("artist"), "POST", path, body, "soulprint-evidence") }, body });
  expect(up.status).toBe(200);

  const client = await (await browser.newContext()).newPage();
  await deliver(pieceId);
  await client.goto(`/vault/${pieceId}?as=${L!.client}`);
  await expect(client.getByTestId("vault-denied")).toContainText("open once the commission is complete"); // vault_denied_before_settled
  await as("client").call(pieceId, "accept", {}, { deposit: 10n ** 22n, tgas: 100n });
  await client.reload();
  await expect(client.getByTestId("vault-files")).toContainText("final.png", { timeout: 20_000 });
  const link = await client.getByRole("link", { name: "Download" }).getAttribute("href");
  expect((await client.request.get(link!)).status()).toBe(200);

  // List through the UI; buy through the UI.
  await client.getByLabel("Sale price").fill("40");
  await client.getByRole("button", { name: "List for sale" }).click();
  await expect(client.getByText("Listed at")).toBeVisible({ timeout: 20_000 });
  const buyer = await (await browser.newContext()).newPage();
  await buyer.goto(`/buy/${pieceId}?as=${L!.buyer}`);
  await expect(buyer.getByTestId("listing-price")).toHaveText("40 USDC");
  await buyer.getByTestId("buy").click();
  await expect(buyer.getByText("It's yours")).toBeVisible({ timeout: 30_000 });
  expect((await view(L!.rpc, pieceId, "piece_info")).owner).toBe(L!.buyer);

  // The old holder is out: new requests and the link issued before.
  await client.reload();
  await expect(client.getByTestId("vault-denied")).toContainText("Only the current owner", { timeout: 20_000 });
  expect((await client.request.get(link!)).status()).toBe(403);

  // Income paid to the piece belongs to the new holder.
  const shop = await (await browser.newContext()).newPage();
  await shop.goto(`/pay/${pieceId}?as=${L!.shop}`);
  await shop.getByLabel("Amount").fill("2");
  await shop.getByTestId("pay").click();
  await expect(shop.getByRole("status")).toContainText("Paid 2 USDC", { timeout: 20_000 });
  await buyer.goto(`/vault/${pieceId}?as=${L!.buyer}`);
  await expect(buyer.getByTestId("pool")).toHaveText("2 USDC", { timeout: 20_000 });
  await expect(buyer.getByTestId("vault-files")).toContainText("final.png");
});
