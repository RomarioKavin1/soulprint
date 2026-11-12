/**
 * Every run starts with enough test USDC: a long-lived sandbox (or testnet) is drained by earlier
 * runs — each commission costs the client 25 USDC (found when the client was down to 16.25).
 */
import { as, live, view } from "./live/helpers.ts";

export default async function globalSetup() {
  const L = live();
  if (!L) return;
  // Each run creates about a dozen pieces (~0.08 NEAR each from the artist): say so plainly instead
  // of failing deep inside a test (testnet: the artist ran down to 0.30 NEAR).
  for (const role of ["artist", "client", "buyer"]) {
    const id = L.c.accounts[role]?.account_id;
    if (!id) continue;
    const r: any = await (await fetch(L.rpc, { method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "query", params: { request_type: "view_account", finality: "final", account_id: id } }) })).json();
    const near = Number(BigInt(r?.result?.amount ?? "0") / 10n ** 21n) / 1000;
    if (near < 1.5) throw new Error(`demo account ${id} has ${near} NEAR; top it up (≥ 1.5 NEAR) before running the E2E`);
  }
  for (const role of ["client", "buyer", "shop"]) {
    if (!L.c.accounts[role]) continue;
    const id = L.c.accounts[role].account_id;
    const bal = BigInt(await view(L.rpc, L.c.currency_token, "ft_balance_of", { account_id: id }));
    if (bal < 500_000_000n) await as(role).call(L.c.currency_token, "faucet", { amount: "1000000000" }, { tgas: 30n });
  }
}
