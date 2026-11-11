/** Against the running demo stack + relayer: a client funds a commission without paying for the transaction. */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { Account, actions, encodeSignedDelegate } from "near-api-js";

const path = process.env.SOULPRINT_CONFIG;
const c = path ? JSON.parse(readFileSync(path, "utf8")).sandbox : null;
const RL = process.env.RELAYER_URL ?? "http://127.0.0.1:8789";

describe.skipIf(!c)("relayer (live)", () => {
  it("relays a client's USDC payment (ft_transfer_call) as a meta-transaction", async () => {
    process.env.SOULPRINT_CONFIG = path;
    const { newCommission, view } = await import("../../../apps/web/e2e/live/helpers.ts");
    const { fundCall } = await import("../../../apps/web/lib/commission.ts");
    const { pieceId, t } = await newCommission();
    const client = new Account(c.accounts.client.account_id, c.rpc_url, c.accounts.client.secret_key);
    const nearBefore = (await client.getState()).balance.total;
    const call = fundCall({ piece_id: pieceId } as any, t, c.currency_token);
    const { signedDelegate: signedDelegateAction } = await client.createSignedMetaTransaction({
      receiverId: call.contract,
      actions: [actions.functionCall(call.method, new TextEncoder().encode(JSON.stringify(call.args)), call.tgas * 1_000_000_000_000n, call.deposit)],
      blockHeightTtl: 120,
    });
    const r = await fetch(`${RL}/relay`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ signedDelegate: Buffer.from(encodeSignedDelegate(signedDelegateAction)).toString("base64") }) });
    expect(r.status, await r.clone().text()).toBe(200);
    await expect.poll(async () => (await view(c.rpc_url, pieceId, "piece_info")).status, { timeout: 30_000 }).toBe("InProgress");
    // The relayer pays the fee and the attached 1 yocto: the client's NEAR is untouched (hence the deposit caps).
    expect(BigInt((await client.getState()).balance.total)).toBe(BigInt(nearBefore));
  }, 90_000);
});
