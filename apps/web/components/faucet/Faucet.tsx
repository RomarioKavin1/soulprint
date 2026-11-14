"use client";
import { useState } from "react";
import { useNear } from "@/components/NearProvider";
import { ErrorNote, useAction, usePoll } from "@/components/ui";
import { money } from "@/lib/money";

const AMOUNTS = [100, 500, 1000]; // the test token gives at most 1000 per request

/** Test USDC for testing Manmade: the app's own test token mints to whoever asks (testnet and local only). */
export function Faucet() {
  const { accountId, signer, signIn, chain, config } = useNear();
  const d = config.currencyDecimals;
  const token = config.currencyToken;
  const [amount, setAmount] = useState(100);
  const [done, setDone] = useState<string | null>(null);
  const { busy, error, run } = useAction();
  const { data: balance, reload } = usePoll(
    async () => (accountId ? BigInt((await chain.view<string>(token, "ft_balance_of", { account_id: accountId })) ?? "0") : null),
    8000,
    [accountId, token],
  );

  return (
    <section className="card" data-testid="faucet">
      <h2 className="title-section">Test USDC</h2>
      <p className="mt-2 text-ink-2">
        Use it to tip artists, collect pieces and pay commissions while you try Manmade. It is a test token with no value, made for
        this site, and works only here.
      </p>
      {!accountId ? (
        <button className="btn-seal mt-5" onClick={() => signIn()}>Sign in to get test USDC</button>
      ) : (
        <>
          <p className="mt-4 text-sm text-ink-2">
            Signed in as <b>{accountId}</b>
            {balance !== null && balance !== undefined && <> · you hold <span data-testid="faucet-balance">{money(balance.toString(), { Ft: token }, d)}</span></>}
          </p>
          <div className="mt-4 flex flex-wrap items-center gap-3">
            <div role="radiogroup" aria-label="Amount" className="flex gap-2">
              {AMOUNTS.map((a) => (
                <button key={a} type="button" role="radio" aria-checked={amount === a} className={amount === a ? "btn-primary" : "btn-ghost"} onClick={() => setAmount(a)}>
                  {a} USDC
                </button>
              ))}
            </div>
            <button
              className="btn-seal"
              data-testid="faucet-get"
              disabled={!!busy || !signer}
              onClick={() => run("Sending", async () => {
                setDone(null);
                await signer!.call(token, "faucet", { amount: (BigInt(amount) * 10n ** BigInt(d)).toString() }, { tgas: 30n });
                await reload();
                setDone(`${amount} test USDC added to ${accountId}.`);
              })}
            >
              {busy ?? `Get ${amount} test USDC`}
            </button>
          </div>
          <p className="mt-2 text-xs text-ink-3">Your account confirms one small request; it covers the network fee in test NEAR. Up to 1000 per request; ask again whenever you need more.</p>
          {done && <p className="mt-3 text-sm text-moss" role="status" data-testid="faucet-done">{done}</p>}
          <ErrorNote error={error} />
        </>
      )}
    </section>
  );
}
