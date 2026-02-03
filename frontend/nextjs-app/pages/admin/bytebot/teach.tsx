import Head from "next/head";
import { useMemo, useState } from "react";
import AppShell from "../../../components/AppShell";
import { useSession } from "../../../hooks/useSession";
import { hasAdminAccess, hasAdminPhoneAccess } from "../../../constants/admin";
import { buildAdminHeaders } from "../../../lib/adminHeaders";

type TeachResponse = {
  sessionId: string;
  image: string;
  url: string;
  selector?: string | null;
  viewport: { width: number; height: number };
};

const buildEbaySoldUrl = (query: string) =>
  `https://www.ebay.com/sch/i.html?_nkw=${encodeURIComponent(query)}&LH_Sold=1&LH_Complete=1&_sop=13`;
const buildPriceChartingUrl = (query: string) =>
  `https://www.pricecharting.com/search-products?q=${encodeURIComponent(query)}`;
const buildTcgplayerUrl = (query: string) =>
  `https://www.tcgplayer.com/search/all/product?q=${encodeURIComponent(query)}&view=grid`;

export default function TeachBytebot() {
  const { session, loading, ensureSession, logout } = useSession();
  const [source, setSource] = useState("pricecharting");
  const [query, setQuery] = useState("");
  const [url, setUrl] = useState("");
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [image, setImage] = useState<string | null>(null);
  const [selector, setSelector] = useState<string>("");
  const [status, setStatus] = useState<string>("");
  const [saving, setSaving] = useState(false);

  const isAdmin = useMemo(
    () => hasAdminAccess(session?.user.id) || hasAdminPhoneAccess(session?.user.phone),
    [session?.user.id, session?.user.phone]
  );

  const adminHeaders = useMemo(() => buildAdminHeaders(session?.token), [session?.token]);

  const buildUrl = () => {
    if (!query.trim()) return;
    if (source === "ebay_sold") setUrl(buildEbaySoldUrl(query.trim()));
    if (source === "pricecharting") setUrl(buildPriceChartingUrl(query.trim()));
    if (source === "tcgplayer") setUrl(buildTcgplayerUrl(query.trim()));
  };

  const startSession = async () => {
    if (!url.trim()) return;
    setStatus("Starting session…");
    const res = await fetch("/api/admin/bytebot/teach/start", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...adminHeaders,
      },
      body: JSON.stringify({ url: url.trim() }),
    });
    const payload = (await res.json()) as TeachResponse;
    if (!res.ok) {
      setStatus(payload?.url ?? "Failed to start session");
      return;
    }
    setSessionId(payload.sessionId);
    setImage(payload.image);
    setStatus(`Live on ${payload.url}`);
  };

  const stopSession = async () => {
    if (!sessionId) return;
    await fetch("/api/admin/bytebot/teach/stop", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...adminHeaders,
      },
      body: JSON.stringify({ sessionId }),
    });
    setSessionId(null);
    setImage(null);
    setSelector("");
    setStatus("Session closed.");
  };

  const handleImageClick = async (event: React.MouseEvent<HTMLImageElement>) => {
    if (!sessionId) return;
    const img = event.currentTarget;
    const rect = img.getBoundingClientRect();
    const x = Math.round(((event.clientX - rect.left) / rect.width) * img.naturalWidth);
    const y = Math.round(((event.clientY - rect.top) / rect.height) * img.naturalHeight);

    const res = await fetch("/api/admin/bytebot/teach/click", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...adminHeaders,
      },
      body: JSON.stringify({ sessionId, x, y }),
    });
    const payload = (await res.json()) as TeachResponse;
    if (!res.ok) {
      setStatus("Failed to apply click.");
      return;
    }
    setImage(payload.image);
    setStatus(`Updated: ${payload.url}`);
    if (payload.selector) {
      setSelector(payload.selector);
    }
  };

  const saveRule = async () => {
    if (!selector.trim()) return;
    setSaving(true);
    await fetch("/api/admin/bytebot/playbooks", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...adminHeaders,
      },
      body: JSON.stringify({
        source,
        action: "click",
        selector: selector.trim(),
        urlContains: url.includes("pricecharting") ? "pricecharting.com" : null,
        priority: 10,
        enabled: true,
      }),
    });
    setSaving(false);
    setStatus("Rule saved.");
  };

  if (loading) {
    return (
      <AppShell>
        <div className="flex h-full items-center justify-center text-sm uppercase tracking-[0.3em] text-slate-400">
          Checking access…
        </div>
      </AppShell>
    );
  }

  if (!session) {
    return (
      <AppShell>
        <div className="flex h-full flex-col items-center justify-center gap-5 text-center">
          <p className="text-sm uppercase tracking-[0.32em] text-slate-400">Admin Access Only</p>
          <h1 className="font-heading text-4xl uppercase tracking-[0.18em] text-white">Sign in to continue</h1>
          <button
            type="button"
            onClick={() => ensureSession().catch(() => undefined)}
            className="rounded-full border border-gold-500/60 bg-gold-500 px-8 py-3 text-xs font-semibold uppercase tracking-[0.3em] text-night-900 shadow-glow transition hover:bg-gold-400"
          >
            Sign In
          </button>
        </div>
      </AppShell>
    );
  }

  if (!isAdmin) {
    return (
      <AppShell>
        <div className="flex h-full flex-col items-center justify-center gap-5 text-center">
          <p className="text-sm uppercase tracking-[0.32em] text-rose-300">Access Denied</p>
          <h1 className="font-heading text-4xl uppercase tracking-[0.18em] text-white">
            You do not have admin rights
          </h1>
          <button
            type="button"
            onClick={logout}
            className="rounded-full border border-white/20 px-8 py-3 text-xs uppercase tracking-[0.3em] text-slate-200 transition hover:border-white/40 hover:text-white"
          >
            Sign Out
          </button>
        </div>
      </AppShell>
    );
  }

  return (
    <AppShell>
      <Head>
        <title>Ten Kings · Bytebot Teach</title>
      </Head>
      <div className="flex h-full flex-col gap-6 px-6 py-8">
        <header className="flex items-center justify-between gap-4">
          <p className="text-xs uppercase tracking-[0.3em] text-gold-300">Ten Kings · Bytebot Teach</p>
          <h1 className="font-heading text-3xl uppercase tracking-[0.2em] text-white">Teach Mode</h1>
        </header>

        <div className="grid gap-6 lg:grid-cols-[1fr_1.4fr]">
          <div className="space-y-4 rounded-3xl border border-white/10 bg-night-900/70 p-4">
            <div className="grid gap-3">
              <label className="flex flex-col gap-1 text-[10px] uppercase tracking-[0.3em] text-slate-500">
                Source
                <select
                  value={source}
                  onChange={(event) => setSource(event.target.value)}
                  className="rounded-full border border-white/10 bg-night-800 px-3 py-2 text-[11px] uppercase tracking-[0.3em] text-slate-200"
                >
                  <option value="ebay_sold">eBay Sold</option>
                  <option value="pricecharting">PriceCharting</option>
                  <option value="tcgplayer">TCGplayer</option>
                </select>
              </label>
              <label className="flex flex-col gap-1 text-[10px] uppercase tracking-[0.3em] text-slate-500">
                Search Query
                <input
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  className="rounded-2xl border border-white/10 bg-night-800 px-3 py-2 text-sm text-white"
                />
              </label>
              <button
                type="button"
                onClick={buildUrl}
                className="rounded-full border border-white/20 px-3 py-2 text-[11px] uppercase tracking-[0.3em] text-slate-300"
              >
                Build URL
              </button>
              <label className="flex flex-col gap-1 text-[10px] uppercase tracking-[0.3em] text-slate-500">
                Target URL
                <input
                  value={url}
                  onChange={(event) => setUrl(event.target.value)}
                  className="rounded-2xl border border-white/10 bg-night-800 px-3 py-2 text-sm text-white"
                />
              </label>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={startSession}
                  className="rounded-full border border-gold-400/60 bg-gold-500/20 px-4 py-2 text-[11px] uppercase tracking-[0.3em] text-gold-200"
                >
                  Start Session
                </button>
                <button
                  type="button"
                  onClick={stopSession}
                  className="rounded-full border border-rose-400/60 bg-rose-500/20 px-4 py-2 text-[11px] uppercase tracking-[0.3em] text-rose-200"
                >
                  Stop
                </button>
              </div>
            </div>
            <div className="rounded-2xl border border-white/10 bg-night-950/60 p-3 text-xs text-slate-300">
              Status: {status || "Idle"}
            </div>
            <div className="space-y-2">
              <label className="flex flex-col gap-1 text-[10px] uppercase tracking-[0.3em] text-slate-500">
                Selector (captured)
                <input
                  value={selector}
                  onChange={(event) => setSelector(event.target.value)}
                  className="rounded-2xl border border-white/10 bg-night-800 px-3 py-2 text-sm text-white"
                />
              </label>
              <button
                type="button"
                onClick={saveRule}
                disabled={!selector || saving}
                className="rounded-full border border-sky-400/60 bg-sky-500/20 px-4 py-2 text-[11px] uppercase tracking-[0.3em] text-sky-200 disabled:opacity-60"
              >
                {saving ? "Saving…" : "Save Rule"}
              </button>
            </div>
          </div>

          <div className="rounded-3xl border border-white/10 bg-night-900/70 p-4">
            <p className="text-xs uppercase tracking-[0.3em] text-slate-400">Live Browser</p>
            <div className="mt-3 rounded-2xl border border-white/10 bg-night-950/60 p-3">
              {image ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={image}
                  alt="Teach session"
                  className="w-full cursor-crosshair"
                  onClick={handleImageClick}
                />
              ) : (
                <div className="flex h-64 items-center justify-center text-xs uppercase tracking-[0.3em] text-slate-500">
                  Start a session to see the live page
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </AppShell>
  );
}
