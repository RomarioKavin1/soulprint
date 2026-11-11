"use client";
import { useNearOptional } from "@/components/useNearOptional";

export function StudioHome() {
  const near = useNearOptional();
  return (
    <div className="pt-8">
      <h1 className="font-display text-4xl tracking-tight">Studio</h1>
      {!near?.accountId ? (
        <p className="mt-4 text-ink-2">Sign in to see your commissions and start a new one.</p>
      ) : (
        <p className="mt-4 text-ink-2">Signed in as {near.accountId}.</p>
      )}
    </div>
  );
}
