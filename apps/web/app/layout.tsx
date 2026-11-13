import type { Metadata } from "next";
import { Cinzel, Cormorant_Garamond, JetBrains_Mono, Spectral } from "next/font/google";
import Link from "next/link";
import { loadConfig } from "@/lib/config";
import { NearProvider } from "@/components/NearProvider";
import { SignIn } from "@/components/SignIn";
import "./globals.css";

const cormorant = Cormorant_Garamond({ subsets: ["latin"], variable: "--font-cormorant", weight: ["400", "500", "600"], style: ["normal", "italic"] });
const cinzel = Cinzel({ subsets: ["latin"], variable: "--font-cinzel", weight: ["400", "600", "700"] });
const spectral = Spectral({ subsets: ["latin"], variable: "--font-spectral", weight: ["300", "400", "500", "600"], style: ["normal", "italic"] });
const jbmono = JetBrains_Mono({ subsets: ["latin"], variable: "--font-jbmono", weight: ["400"] });

export const metadata: Metadata = {
  title: "Manmade — real art, hung with its making",
  description: "A salon of real art. Every work hangs with the record of how it was made.",
};

export const dynamic = "force-dynamic";

export default function RootLayout({ children }: { children: React.ReactNode }) {
  const config = loadConfig();
  return (
    <html lang="en" className={`${cormorant.variable} ${cinzel.variable} ${spectral.variable} ${jbmono.variable}`}>
      <body className="min-h-screen">
        {config ? (
          <NearProvider config={config}>
            <Header networkBadge={config.network !== "mainnet" ? config.network : null} />
            <main className="page pb-28">{children}</main>
            <Footer />
          </NearProvider>
        ) : (
          <>
            <Header networkBadge={null} />
            <main className="page pb-28">
              <div className="card mx-auto mt-16 max-w-xl">
                <p className="font-display text-3xl">The salon is closed</p>
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

/** The picture rail: a gilt moulding running the width of the room, the name lettered above it. */
function Header({ networkBadge }: { networkBadge: string | null }) {
  return (
    <header className="relative">
      <div className="page flex flex-wrap items-end justify-between gap-x-8 gap-y-3 pb-4 pt-6">
        <Link href="/" className="group flex items-baseline gap-3 no-underline">
          <span className="font-display text-[2rem] leading-none tracking-[-0.01em] text-ink sm:text-[2.4rem]">
            Manmade<span className="text-[0.72em] italic text-seal">.works</span>
          </span>
          {networkBadge && (
            <span className="font-plaque border border-rule px-2 py-0.5 text-[0.58rem] uppercase tracking-[0.2em] text-ink-3">{networkBadge}</span>
          )}
        </Link>
        <nav className="flex min-w-0 flex-wrap items-center gap-x-6 gap-y-2 font-plaque text-[0.72rem] uppercase tracking-[0.2em]" aria-label="Main">
          <Link href="/gallery" className="text-ink-2 no-underline hover:text-ink">The gallery</Link>
          <Link href="/notes" className="text-ink-2 no-underline hover:text-ink">Reader questions</Link>
          <Link href="/studio" className="text-ink-2 no-underline hover:text-ink">Studio</Link>
          <span className="normal-case tracking-normal"><SignIn /></span>
        </nav>
      </div>
      <div aria-hidden className="h-px bg-[color:var(--color-rule)]" />
    </header>
  );
}

function Footer() {
  return (
    <footer className="border-t border-rule">
      <div className="page flex flex-wrap items-baseline justify-between gap-6 py-10 text-sm text-ink-3">
        <p className="max-w-2xl">
          Works labelled <i>Example</i> are public-domain classics from The Metropolitan Museum of Art Open Access (CC0), hung to show the
          room. They were not recorded on Manmade.
        </p>
        <p className="flex gap-6">
          <Link href="/limits" className="text-ink-2 hover:text-ink">What a record shows</Link>
          <Link href="/notes" className="text-ink-2 hover:text-ink">How questions work</Link>
        </p>
      </div>
    </footer>
  );
}
