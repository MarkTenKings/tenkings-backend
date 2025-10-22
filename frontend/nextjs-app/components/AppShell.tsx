import Link from "next/link";
import { useState } from "react";
import { useSession } from "../hooks/useSession";
import { formatTkd } from "../lib/formatters";

interface AppShellProps {
  children: React.ReactNode;
  background?: "hero" | "default";
}

export default function AppShell({ children, background = "default" }: AppShellProps) {
  const { session, ensureSession, logout } = useSession();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  const handleToggleMenu = () => {
    setMobileMenuOpen((prev) => !prev);
  };

  const handleCloseMenu = () => {
    setMobileMenuOpen(false);
  };

  return (
    <div
      className={`min-h-screen w-full overflow-x-hidden bg-night-900 text-slate-100 ${
        background === "hero" ? "bg-hero-gradient" : "bg-radial-night"
      }`}
    >
      <div className="relative z-0 flex min-h-screen flex-col">
        <div className="pointer-events-none absolute inset-0 bg-radial-night opacity-80" aria-hidden />
        <header className="sticky top-0 z-20 border-b border-white/5 bg-night-900/70 backdrop-blur">
          <nav className="mx-auto flex w-full max-w-6xl items-center justify-between px-6 py-5">
            <Link href="/" className="font-heading text-3xl tracking-[0.18em] text-gold-500" onClick={handleCloseMenu}>
              TEN KINGS
            </Link>
            <div className="flex items-center gap-3 text-sm uppercase tracking-[0.32em] text-slate-300">
              <Link
                href="/collection"
                onClick={handleCloseMenu}
                className="pointer-events-auto rounded-full border border-white/15 px-4 py-2 text-xs uppercase tracking-[0.25em] text-slate-200 transition hover:border-gold-400 hover:text-gold-200 md:hidden"
              >
                My Collection
              </Link>
              <button
                type="button"
                onClick={handleToggleMenu}
                className="pointer-events-auto rounded-full border border-white/15 px-3 py-2 text-xs uppercase tracking-[0.25em] text-slate-200 transition hover:border-gold-400 hover:text-gold-300 md:hidden"
                aria-expanded={mobileMenuOpen}
                aria-controls="mobile-nav-menu"
                aria-label="Toggle navigation menu"
              >
                Menu
              </button>
              <Link className="hidden transition hover:text-white md:inline" href="/collection" onClick={handleCloseMenu}>
                My Collection
              </Link>
              {session ? (
                <button
                  type="button"
                  onClick={() => {
                    logout();
                    handleCloseMenu();
                  }}
                  className="pointer-events-auto rounded-full border border-white/10 px-4 py-2 text-xs tracking-[0.2em] text-slate-200 transition hover:border-gold-400 hover:text-gold-300"
                >
                  Sign Out
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() => {
                    handleCloseMenu();
                    ensureSession().catch(() => undefined);
                  }}
                  className="pointer-events-auto rounded-full border border-gold-500/60 bg-gold-500 px-4 py-2 text-xs font-semibold uppercase tracking-[0.25em] text-night-900 shadow-glow transition hover:bg-gold-400"
                >
                  Sign In
                </button>
              )}
              <div className="hidden items-center gap-4 md:flex">
                <Link className="transition hover:text-white" href="/" aria-label="Home" onClick={handleCloseMenu}>
                  Home
                </Link>
                <Link className="transition hover:text-white" href="/packs" onClick={handleCloseMenu}>
                  Packs
                </Link>
                <Link className="transition hover:text-white" href="/locations" onClick={handleCloseMenu}>
                  Locations
                </Link>
                <Link className="transition hover:text-white" href="/marketplace" onClick={handleCloseMenu}>
                  Marketplace
                </Link>
                {session && (
                  <Link className="transition hover:text-white" href="/profile" onClick={handleCloseMenu}>
                    Profile
                  </Link>
                )}
              </div>
            </div>
          </nav>
          <div
            id="mobile-nav-menu"
            className={`md:hidden ${mobileMenuOpen ? "max-h-96 border-t border-white/5 bg-night-900/80" : "max-h-0 overflow-hidden"} transition-[max-height] duration-300 ease-in-out`}
          >
            <div className="flex flex-col gap-4 px-6 py-4 text-xs uppercase tracking-[0.32em] text-slate-300">
              <Link className="transition hover:text-white" href="/" aria-label="Home" onClick={handleCloseMenu}>
                Home
              </Link>
              <Link className="transition hover:text-white" href="/packs" onClick={handleCloseMenu}>
                Packs
              </Link>
              <Link className="transition hover:text-white" href="/locations" onClick={handleCloseMenu}>
                Locations
              </Link>
              <Link className="transition hover:text-white" href="/marketplace" onClick={handleCloseMenu}>
                Marketplace
              </Link>
              {session && (
                <Link className="transition hover:text-white" href="/profile" onClick={handleCloseMenu}>
                  Profile
                </Link>
              )}
            </div>
          </div>
          {session && (
            <div className="border-t border-white/5 bg-night-900/60 text-xs uppercase tracking-[0.3em] text-slate-400">
              <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-2">
                <span>Signed in as {session.user.displayName ?? session.user.phone ?? session.user.id}</span>
                <span>Wallet · {formatTkd(session.wallet.balance)}</span>
              </div>
            </div>
          )}
        </header>

        <main className="relative z-10 flex flex-1 flex-col">{children}</main>

        <footer className="border-t border-white/5 bg-night-900/80 py-10 text-xs text-slate-400">
          <div className="mx-auto flex max-w-6xl flex-col gap-2 px-6">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <span className="tracking-[0.24em] uppercase">© {new Date().getFullYear()} Ten Kings</span>
              <div className="flex gap-4">
                <Link className="transition hover:text-white" href="/terms">
                  Terms
                </Link>
                <Link className="transition hover:text-white" href="/privacy">
                  Privacy
                </Link>
                <Link className="transition hover:text-white" href="/admin">
                  Admin Portal
                </Link>
              </div>
            </div>
            <p className="max-w-3xl text-xs text-slate-500">
              Ten Kings is a closed-loop collectible platform. TKD are store credits, non-transferable beyond the Ten Kings ecosystem.
            </p>
          </div>
        </footer>
      </div>
    </div>
  );
}
