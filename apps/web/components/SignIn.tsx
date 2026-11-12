"use client";
import { useNearOptional } from "./useNearOptional";

const ROLE_LABEL: Record<string, string> = {
  artist: "Artist",
  client: "Client",
  buyer: "Buyer",
  buyer2: "Second buyer",
  shop: "Shop",
  arbitrator: "Arbitrator",
  fallback_arbitrator: "Fallback arbitrator",
  governance: "Governance",
  relayer: "Service",
};

export function SignIn() {
  const near = useNearOptional();
  if (!near) return null;
  const { config, accountId, signIn, signOut } = near;
  if (config.network === "sandbox") {
    return (
      <label className="flex items-center gap-2">
        <span className="text-ink-3">Signed in as</span>
        <select
          aria-label="Choose who you are"
          className="wall-select"
          value={accountId ?? ""}
          onChange={(e) => (e.target.value ? signIn(e.target.value) : signOut())}
        >
          <option value="">Nobody</option>
          {config.demoAccounts
            .filter((a) => a.role !== "relayer" && a.role !== "governance")
            .map((a) => (
              <option key={a.accountId} value={a.accountId}>
                {ROLE_LABEL[a.role] ?? a.role} · {a.accountId.split(".")[0]}
              </option>
            ))}
        </select>
      </label>
    );
  }
  return accountId ? (
    <button className="btn-ghost" onClick={() => signOut()}>
      {accountId} · Sign out
    </button>
  ) : (
    <button className="btn-primary" onClick={() => signIn()}>
      Sign in
    </button>
  );
}
