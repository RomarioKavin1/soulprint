import { notFound } from "next/navigation";
import { loadConfig } from "@/lib/config";
import { Faucet } from "@/components/faucet/Faucet";

export const dynamic = "force-dynamic";

/** Test funds: test USDC from the app's own test token, and where to get test NEAR. Never on mainnet. */
export default function FaucetPage() {
  const config = loadConfig();
  if (!config || config.network === "mainnet") notFound();
  return (
    <div className="page-top max-w-3xl">
      <h1 className="title-page">Test funds</h1>
      <p className="mt-4 max-w-[62ch] text-lg text-ink-2">
        Manmade runs on {config.network === "testnet" ? "NEAR testnet" : "a local test chain"}. Everything here is play money: get some, then
        tip, collect and commission as much as you like.
      </p>
      <div className="mt-10 space-y-8">
        <Faucet />
        <section className="card">
          <h2 className="title-section">Test NEAR</h2>
          <p className="mt-2 text-ink-2">
            Small amounts of NEAR pay for network fees and the storage each piece needs.{" "}
            {config.network === "testnet" ? (
              <>Get testnet NEAR from the public faucet run by the NEAR community, then come back here.</>
            ) : (
              <>On the local test chain every demo account already has plenty.</>
            )}
          </p>
          {config.network === "testnet" && (
            <a className="btn-ghost mt-5 no-underline" href="https://near-faucet.io" target="_blank" rel="noopener noreferrer">Open the NEAR testnet faucet</a>
          )}
        </section>
      </div>
    </div>
  );
}
