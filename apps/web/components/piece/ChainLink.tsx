import type { ReactNode } from "react";

/**
 * A link out to the public explorer, so a visitor can check a value outside Manmade. With no
 * explorer (the local test chain) it is plain text, with the reason on hover.
 */
export function ChainLink({ href, children, className = "" }: { href: string | null; children: ReactNode; className?: string }) {
  if (!href) return <span className={className} title="Local test chain: there is no public explorer">{children}</span>;
  return (
    <a href={href} target="_blank" rel="noopener noreferrer" className={`chain-link ${className}`}>
      {children}
      <svg viewBox="0 0 12 12" width="10" height="10" aria-hidden fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="square">
        <path d="M4 2h6v6M10 2 3 9" />
      </svg>
      <span className="sr-only"> (opens the public explorer in a new tab)</span>
    </a>
  );
}
