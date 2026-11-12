import type { Metadata } from "next";
import { Fraunces, IBM_Plex_Sans } from "next/font/google";
import Link from "next/link";
import { loadConfig } from "@/lib/config";
import { NearProvider } from "@/components/NearProvider";
import { SignIn } from "@/components/SignIn";
import "./globals.css";

const fraunces = Fraunces({ subsets: ["latin"], variable: "--font-fraunces", axes: ["SOFT", "opsz"] });
const plex = IBM_Plex_Sans({ subsets: ["latin"], weight: ["400", "500", "600"], variable: "--font-plex" });

export const metadata: Metadata = {
  title: "Soulprint",
  description: "Real art, with the making on record.",
};

export const dynamic = "force-dynamic";

export default function RootLayout({ children }: { children: React.ReactNode }) {
  const config = loadConfig();
  return (
    <html lang="en" className={`${fraunces.variable} ${plex.variable}`}>
      <body className="min-h-screen">
        {config ? (
          <NearProvider config={config}>
            <Header networkBadge={config.network !== "mainnet" ? config.network : null} />
            <main className="mx-auto max-w-5xl px-4 pb-24 sm:px-6">{children}</main>
          </NearProvider>
        ) : (
          <>
            <Header networkBadge={null} />
            <main className="mx-auto max-w-5xl px-4 pb-24 sm:px-6">
              <div className="card mt-10">
                <p className="font-display text-2xl">Not set up yet</p>
                <p className="mt-2 text-ink-2">
                  No network settings were found. For a local run, start the demo with <code className="font-mono">make demo</code>.
                </p>
              </div>
            </main>
          </>
        )}
      </body>
    </html>
  );
}

function Header({ networkBadge }: { networkBadge: string | null }) {
  return (
    <header className="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-x-4 gap-y-3 px-4 py-5 sm:px-6">
      <Link href="/" className="flex items-baseline gap-2">
        <span className="inline-block h-3 w-3 translate-y-[-1px] rounded-full bg-seal" aria-hidden />
        <span className="font-display text-xl font-semibold tracking-tight">Soulprint</span>
        {networkBadge && <span className="label rounded-full border border-rule px-2 py-0.5 text-[10px]">{networkBadge}</span>}
      </Link>
      <nav className="flex min-w-0 flex-wrap items-center gap-3 text-sm">
        <Link href="/" className="text-ink-2 hover:text-ink">
          Gallery
        </Link>
        <Link href="/notes" className="text-ink-2 hover:text-ink">
          Rate notes
        </Link>
        <Link href="/studio" className="text-ink-2 hover:text-ink">
          Studio
        </Link>
        <SignIn />
      </nav>
    </header>
  );
}
