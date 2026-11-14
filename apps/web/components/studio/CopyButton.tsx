"use client";
import { useState } from "react";

/** Copy a value (and offer the system share sheet where there is one). */
export function CopyButton({ value, label = "Copy", compact = false }: { value: string; label?: string; compact?: boolean }) {
  const [done, setDone] = useState<string | null>(null);
  const canShare = typeof navigator !== "undefined" && typeof navigator.share === "function";
  return (
    <span className="inline-flex gap-2">
      <button type="button" className={compact ? "copy-compact" : "btn-ghost py-1.5"} aria-label={compact ? `${label}: ${value}` : undefined} onClick={async () => {
        let ok = false;
        try { await navigator.clipboard.writeText(value); ok = true; } catch {
          // clipboard API refused (no focus, insecure context): copy through a hidden field
          try {
            const t = document.createElement("textarea");
            t.value = value; t.setAttribute("readonly", ""); t.style.position = "fixed"; t.style.opacity = "0";
            document.body.appendChild(t); t.select(); ok = document.execCommand("copy"); t.remove();
          } catch { ok = false; }
        }
        setDone(ok ? "Copied" : "Select and copy it");
        setTimeout(() => setDone(null), 2200);
      }}>{done ?? label}</button>
      {canShare && !compact && <button type="button" className="btn-ghost py-1.5" onClick={() => navigator.share({ text: value }).catch(() => {})}>Share</button>}
    </span>
  );
}
