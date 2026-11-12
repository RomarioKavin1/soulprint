"use client";
/**
 * `useNear()`: the signed-in person and how to act as them. Sandbox: pick a demo person (keys from
 * config). Testnet/mainnet: NEAR Connect. Shape per Plan 3 Task 1:
 * {accountId, signIn(), signOut(), call(contract, method, args, deposit, gas)} plus signNep413.
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import type { PublicConfig } from "@/lib/config";
import { ChainView, ConnectSigner, KeySigner, type CallOutcome, type Signer } from "@/lib/near";

export interface NearCtx {
  config: PublicConfig;
  accountId: string | null;
  signer: Signer | null;
  chain: ChainView;
  signIn(role?: string): Promise<void>;
  signOut(): Promise<void>;
  call(contract: string, method: string, args: Record<string, unknown>, deposit?: bigint, tgas?: bigint): Promise<CallOutcome>;
  signNep413(message: string, nonce: Uint8Array, recipient: string): Promise<{ signature: string; publicKey: string; accountId: string }>;
}

const Ctx = createContext<NearCtx | null>(null);
const SANDBOX_KEY = "soulprint.sandbox.account";

export function NearProvider({ config, children }: { config: PublicConfig; children: ReactNode }) {
  const [signer, setSigner] = useState<Signer | null>(null);
  const chain = useMemo(() => new ChainView(config.rpcUrls), [config.rpcUrls.join(",")]);
  const [connector, setConnector] = useState<any>(null);

  const useDemo = useCallback(
    (accountId: string | null) => {
      const a = config.demoAccounts.find((d) => d.accountId === accountId || d.role === accountId);
      setSigner(a ? new KeySigner(a.accountId, a.secretKey, config.rpcUrls) : null);
      try {
        if (a) localStorage.setItem(SANDBOX_KEY, a.accountId);
        else localStorage.removeItem(SANDBOX_KEY);
      } catch {}
    },
    [config],
  );

  useEffect(() => {
    if (config.network === "sandbox") {
      let saved: string | null = null;
      try {
        saved = new URLSearchParams(location.search).get("as") ?? localStorage.getItem(SANDBOX_KEY);
      } catch {}
      if (saved) useDemo(saved);
      return;
    }
    let cancelled = false;
    (async () => {
      const { NearConnector } = await import("@hot-labs/near-connect");
      const c = new NearConnector({ network: config.network === "mainnet" ? "mainnet" : "testnet" });
      c.on("wallet:signIn", async (t: any) => setSigner(new ConnectSigner(t.accounts[0].accountId, await c.wallet())));
      c.on("wallet:signOut", () => setSigner(null));
      if (cancelled) return;
      setConnector(c);
      try {
        const { wallet, accounts } = await c.getConnectedWallet();
        if (accounts[0]) setSigner(new ConnectSigner(accounts[0].accountId, wallet));
      } catch {}
    })();
    return () => {
      cancelled = true;
    };
  }, [config, useDemo]);

  const value: NearCtx = {
    config,
    accountId: signer?.accountId ?? null,
    signer,
    chain,
    async signIn(role) {
      if (config.network === "sandbox") return useDemo(role ?? config.demoAccounts[0]?.accountId ?? null);
      await connector?.connect();
    },
    async signOut() {
      if (config.network === "sandbox") return useDemo(null);
      await connector?.disconnect();
      setSigner(null);
    },
    async call(contract, method, args, deposit, tgas) {
      if (!signer) throw new Error("not_signed_in");
      return signer.call(contract, method, args, { ...(deposit === undefined ? {} : { deposit }), ...(tgas === undefined ? {} : { tgas }) });
    },
    async signNep413(message, nonce, recipient) {
      if (!signer) throw new Error("not_signed_in");
      return signer.signNep413({ message, nonce, recipient });
    },
  };
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useNear(): NearCtx {
  const c = useContext(Ctx);
  if (!c) throw new Error("useNear outside NearProvider");
  return c;
}

/** `useNear()` that returns null outside the provider (the unconfigured shell). */
export function useNearOptional(): NearCtx | null {
  return useContext(Ctx);
}
