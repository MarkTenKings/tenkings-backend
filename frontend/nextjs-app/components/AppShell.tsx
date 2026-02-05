import Link from "next/link";
import { useState } from "react";
import { useSession } from "../hooks/useSession";
import { formatTkd } from "../lib/formatters";

interface AppShellProps {
  children: React.ReactNode;
  background?: "hero" | "default";
  hideHeader?: boolean;
  hideFooter?: boolean;
}

export default function AppShell({ children, background = "default", hideHeader = false, hideFooter = false }: AppShellProps) {
  const { session, ensureSession, logout } = useSession();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  const handleToggleMenu = () => {
    setMobileMenuOpen((prev) => !prev);
  };

  const handleCloseMenu = () => {
    setMobileMenuOpen(false);
  };

  const menuBaseClasses =
    "overflow-hidden transition-all duration-300 ease-in-out md:absolute md:right-6 md:top-[calc(100%+12px)] md:w-64 md:rounded-3xl md:bg-night-900/90 md:shadow-card md:backdrop-blur md:[box-shadow:0_20px_50px_rgba(15,23,42,0.45)] md:overflow-visible";

  const menuStateClasses = mobileMenuOpen
    ? "max-h-[420px] border-t border-white/5 bg-night-900/85 opacity-100 pointer-events-auto md:max-h-[80vh] md:border md:border-white/10 md:opacity-100 md:pointer-events-auto"
    : "max-h-0 opacity-0 pointer-events-none md:max-h-0 md:opacity-0 md:pointer-events-none";

  return (
    <div
      className={`min-h-screen w-full overflow-x-hidden bg-night-900 text-slate-100 ${
        background === "hero" ? "bg-hero-gradient" : "bg-radial-night"
      }`}
    >
      <div className="relative z-0 flex min-h-screen flex-col">
        <div className="pointer-events-none absolute inset-0 bg-radial-night opacity-80" aria-hidden />
        {!hideHeader && (
          <header className="sticky top-0 z-20 border-b border-white/5 bg-night-900/70 backdrop-blur">
            <nav className="mx-auto flex w-full max-w-6xl items-center justify-between px-6 py-5">
              <Link href="/" className="font-heading text-3xl tracking-[0.18em] text-gold-500" onClick={handleCloseMenu}>
                TEN KINGS
              </Link>
              <div className="flex items-center gap-3 text-slate-300">
                <button
                  type="button"
                  onClick={handleToggleMenu}
                  className="pointer-events-auto inline-flex items-center justify-center rounded-full border border-white/15 p-2 text-slate-200 transition hover:border-gold-400 hover:text-gold-300"
                  aria-expanded={mobileMenuOpen}
                  aria-controls="nav-menu"
                  aria-label="Toggle navigation menu"
                >
                  <span className="sr-only">Toggle navigation</span>
                  <svg
                    className="h-5 w-5"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth={1.6}
                    strokeLinecap="round"
                  >
                    <path d="M4 6h16" />
                    <path d="M4 12h16" />
                    <path d="M4 18h16" />
                  </svg>
                </button>
              </div>
            </nav>
            <div id="nav-menu" className={`${menuBaseClasses} ${menuStateClasses}`}>
              <div className="flex flex-col gap-3 px-6 py-4 text-xs uppercase tracking-[0.3em] text-slate-300 md:px-5 md:py-5">
                <Link className="transition hover:text-white" href="/" aria-label="Home" onClick={handleCloseMenu}>
                  Home
                </Link>
                <Link className="transition hover:text-white" href="/packs" onClick={handleCloseMenu}>
                  Packs
                </Link>
                <Link className="transition hover:text-white" href="/locations" onClick={handleCloseMenu}>
                  Locations
                </Link>
                <Link className="transition hover:text-white" href="/live" onClick={handleCloseMenu}>
                  Live Rips
                </Link>
                <Link className="transition hover:text-white" href="/marketplace" onClick={handleCloseMenu}>
                  Marketplace
                </Link>
                <Link className="transition hover:text-white" href="/collection" onClick={handleCloseMenu}>
                  My Collection
                </Link>
                {session && (
                  <Link className="transition hover:text-white" href="/profile" onClick={handleCloseMenu}>
                    Profile
                  </Link>
                )}
                <div className="h-px bg-white/10" aria-hidden />
                {session ? (
                  <button
                    type="button"
                    onClick={() => {
                      logout();
                      handleCloseMenu();
                    }}
                    className="text-left uppercase tracking-[0.3em] text-slate-200 transition hover:text-gold-200"
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
                    className="text-left uppercase tracking-[0.3em] text-slate-200 transition hover:text-gold-200"
                  >
                    Sign In · Sign Up
                  </button>
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
        )}

        <main className="relative z-10 flex flex-1 flex-col">{children}</main>

        {!hideFooter && (
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
        )}
      </div>
    </div>
  );
}
