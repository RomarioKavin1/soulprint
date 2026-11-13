"use client";
import { useState } from "react";

/** Copy a value (and offer the system share sheet where there is one). */
export function CopyButton({ value, label = "Copy" }: { value: string; label?: string }) {
  const [done, setDone] = useState(false);
  const canShare = typeof navigator !== "undefined" && typeof navigator.share === "function";
  return (
    <span className="inline-flex gap-2">
      <button type="button" className="btn-ghost py-1.5" onClick={async () => {
        try { await navigator.clipboard.writeText(value); setDone(true); setTimeout(() => setDone(false), 2000); } catch { /* clipboard blocked: the key stays selectable */ }
      }}>{done ? "Copied" : label}</button>
      {canShare && <button type="button" className="btn-ghost py-1.5" onClick={() => navigator.share({ text: value }).catch(() => {})}>Share</button>}
    </span>
  );
}
