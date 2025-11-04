import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import Head from "next/head";
import { useRouter } from "next/router";

interface LocationOption {
  id: string;
  name: string;
  slug: string;
}

interface LocationsResponse {
  locations: LocationOption[];
}

interface StartResponse {
  session: {
    id: string;
    code: string;
  };
  controlToken: string;
}

const SECRET_HEADER = "x-kiosk-secret";

const DEFAULT_COUNTDOWN = Number(process.env.NEXT_PUBLIC_KIOSK_COUNTDOWN_SECONDS ?? "10");
const DEFAULT_LIVE = Number(process.env.NEXT_PUBLIC_KIOSK_LIVE_SECONDS ?? "60");

/**
 * Kiosk control surface used on the SER mini PC. It provides a focused input field that
 * accepts pack QR scans (delivered as keyboard input) and turns them into kiosk sessions.
 *
 * The kiosk API secret is injected from `NEXT_PUBLIC_KIOSK_API_SECRET`; this interface runs
 * on trusted hardware so we prioritise speed of setup over hard security boundaries.
 */
export default function KioskControlPage() {
  const router = useRouter();
  const [packCode, setPackCode] = useState("");
  const [locationId, setLocationId] = useState<string | "auto">("auto");
  const [countdownSeconds, setCountdownSeconds] = useState(DEFAULT_COUNTDOWN);
  const [liveSeconds, setLiveSeconds] = useState(DEFAULT_LIVE);
  const [locations, setLocations] = useState<LocationOption[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    const timer = window.setInterval(() => {
      inputRef.current?.focus();
    }, 2500);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    void (async () => {
      try {
        const response = await fetch("/api/locations");
        if (!response.ok) {
          throw new Error("Failed to load locations");
        }
        const payload = (await response.json()) as LocationsResponse;
        setLocations(payload.locations);
        if (payload.locations.length === 1) {
          setLocationId(payload.locations[0].id);
        }
      } catch (err) {
        console.warn("[kiosk] location fetch failed", err);
      }
    })();
  }, []);

  const sortedLocations = useMemo(
    () => locations.slice().sort((a, b) => a.name.localeCompare(b.name)),
    [locations]
  );

  const kioskSecret = process.env.NEXT_PUBLIC_KIOSK_API_SECRET ?? "";

  const handleSubmit = useCallback(
    async (event?: FormEvent) => {
      event?.preventDefault();
      const trimmed = packCode.trim();
      if (!trimmed) {
        return;
      }
      setLoading(true);
      setError(null);
      setSuccess(null);
      try {
        const headers: Record<string, string> = {
          "Content-Type": "application/json",
        };
        if (kioskSecret) {
          headers[SECRET_HEADER] = kioskSecret;
        }

        const response = await fetch("/api/kiosk/start", {
          method: "POST",
          headers,
          body: JSON.stringify({
            packCode: trimmed,
            locationId: locationId !== "auto" ? locationId : undefined,
            countdownSeconds,
            liveSeconds,
          }),
        });

        if (!response.ok) {
          const payload = await response.json().catch(() => ({}));
          throw new Error(payload?.message ?? "Failed to start kiosk session");
        }

        const payload = (await response.json()) as StartResponse;
        setSuccess(`Session ${payload.session.code} ready`);
        setPackCode("");
        inputRef.current?.focus();
        void router.push(`/kiosk/${payload.session.id}?token=${payload.controlToken}`);
      } catch (err) {
        const message = err instanceof Error ? err.message : "Failed to start kiosk session";
        setError(message);
      } finally {
        setLoading(false);
      }
    },
    [packCode, kioskSecret, locationId, countdownSeconds, liveSeconds, router]
  );

  const handleCodeChange = useCallback((value: string) => {
    setPackCode(value);
    setError(null);
    setSuccess(null);
  }, []);

  return (
    <div className="min-h-screen bg-night-950 text-white">
      <Head>
        <title>Kiosk Control · Ten Kings</title>
      </Head>

      <main className="mx-auto flex min-h-screen w-full max-w-4xl flex-col gap-8 px-6 py-12">
        <header className="flex flex-col gap-3">
          <p className="text-xs uppercase tracking-[0.32em] text-slate-400">Live Rip Ops</p>
          <h1 className="font-heading text-3xl uppercase tracking-[0.18em] text-white">
            Launch Live Sessions
          </h1>
          <p className="max-w-2xl text-sm text-slate-300">
            Scan a sealed pack QR code to kick off a countdown and route OBS to the live rip
            scene. This console runs on the kiosk workstation—keep the focus box active and
            you can trigger sessions hands-free.
          </p>
        </header>

        <section className="rounded-3xl border border-white/10 bg-night-900/70 p-6 shadow-xl">
          <form onSubmit={handleSubmit} className="flex flex-col gap-4">
            <label className="text-xs uppercase tracking-[0.28em] text-slate-400">
              Pack QR Code
              <input
                ref={inputRef}
                value={packCode}
                onChange={(event) => handleCodeChange(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.preventDefault();
                    void handleSubmit();
                  }
                }}
                placeholder="Scan or type the pack QR code"
                className="mt-2 w-full rounded-2xl border border-white/20 bg-night-950 px-4 py-4 text-2xl tracking-[0.32em] text-white focus:border-gold-400 focus:outline-none"
                autoFocus
                autoComplete="off"
                spellCheck={false}
              />
            </label>

            <div className="grid gap-4 lg:grid-cols-3">
              <label className="flex flex-col text-xs uppercase tracking-[0.28em] text-slate-400">
                Countdown Seconds
                <input
                  type="number"
                  min={3}
                  max={120}
                  value={countdownSeconds}
                  onChange={(event) => setCountdownSeconds(Number(event.target.value))}
                  className="mt-2 rounded-2xl border border-white/20 bg-night-950 px-4 py-3 text-base text-white focus:border-gold-400 focus:outline-none"
                />
              </label>

              <label className="flex flex-col text-xs uppercase tracking-[0.28em] text-slate-400">
                Live Seconds
                <input
                  type="number"
                  min={10}
                  max={300}
                  value={liveSeconds}
                  onChange={(event) => setLiveSeconds(Number(event.target.value))}
                  className="mt-2 rounded-2xl border border-white/20 bg-night-950 px-4 py-3 text-base text-white focus:border-gold-400 focus:outline-none"
                />
              </label>

              <label className="flex flex-col text-xs uppercase tracking-[0.28em] text-slate-400">
                Location
                <select
                  value={locationId}
                  onChange={(event) => setLocationId(event.target.value)}
                  className="mt-2 rounded-2xl border border-white/20 bg-night-950 px-4 py-3 text-base text-white focus:border-gold-400 focus:outline-none"
                >
                  <option value="auto">Auto (use pack assignment)</option>
                  {sortedLocations.map((option) => (
                    <option key={option.id} value={option.id}>
                      {option.name}
                    </option>
                  ))}
                </select>
              </label>
            </div>

            <div className="flex items-center gap-3">
              <button
                type="submit"
                className="rounded-full border border-gold-500/60 bg-gold-500 px-6 py-3 text-xs font-semibold uppercase tracking-[0.32em] text-night-900 transition hover:bg-gold-400 disabled:cursor-not-allowed disabled:opacity-50"
                disabled={loading}
              >
                Launch Countdown
              </button>
              <button
                type="button"
                className="rounded-full border border-white/20 px-6 py-3 text-xs uppercase tracking-[0.32em] text-slate-200 transition hover:border-white/40 hover:text-white"
                onClick={() => {
                  setPackCode("");
                  setError(null);
                  setSuccess(null);
                  inputRef.current?.focus();
                }}
              >
                Clear
              </button>
              {loading ? (
                <span className="text-xs uppercase tracking-[0.28em] text-slate-400">Starting…</span>
              ) : null}
            </div>

            {error ? (
              <p className="rounded-xl border border-rose-500/40 bg-rose-500/10 px-4 py-3 text-xs uppercase tracking-[0.28em] text-rose-200">
                {error}
              </p>
            ) : null}

            {success ? (
              <p className="rounded-xl border border-emerald-500/40 bg-emerald-500/10 px-4 py-3 text-xs uppercase tracking-[0.28em] text-emerald-200">
                {success}
              </p>
            ) : null}
          </form>
        </section>

        <section className="rounded-3xl border border-white/10 bg-night-900/40 p-6">
          <header className="mb-3 flex items-center justify-between">
            <h2 className="text-sm uppercase tracking-[0.32em] text-slate-300">Recover Session</h2>
          </header>
          <p className="text-sm text-slate-400">
            Already started a countdown? Enter the pack or session code to jump back in and
            regain control.
          </p>
          <RecoverForm />
        </section>
      </main>
    </div>
  );
}

function RecoverForm() {
  const router = useRouter();
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const handleRecover = useCallback(async () => {
    const trimmed = code.trim();
    if (!trimmed) {
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const response = await fetch(`/api/kiosk/by-code?code=${encodeURIComponent(trimmed)}`);
      if (!response.ok) {
        const payload = await response.json().catch(() => ({}));
        throw new Error(payload?.message ?? "Session not found");
      }
      const { session } = (await response.json()) as { session: { id: string } };
      setCode("");
      void router.push(`/kiosk/${session.id}`);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unable to load session";
      setError(message);
    } finally {
      setLoading(false);
    }
  }, [code, router]);

  return (
    <form
      className="mt-4 flex flex-wrap items-center gap-3"
      onSubmit={(event) => {
        event.preventDefault();
        void handleRecover();
      }}
    >
      <input
        value={code}
        onChange={(event) => setCode(event.target.value)}
        placeholder="Session or pack code"
        className="min-w-[220px] flex-1 rounded-2xl border border-white/20 bg-night-950 px-4 py-3 text-sm text-white focus:border-sky-400 focus:outline-none"
        autoComplete="off"
        spellCheck={false}
      />
      <button
        type="submit"
        disabled={loading}
        className="rounded-full border border-sky-400/60 bg-sky-500 px-5 py-2 text-xs uppercase tracking-[0.3em] text-night-900 transition hover:bg-sky-400 disabled:cursor-not-allowed disabled:opacity-50"
      >
        Open Session
      </button>
      {error ? (
        <span className="w-full rounded-xl border border-rose-500/40 bg-rose-500/10 px-4 py-3 text-xs uppercase tracking-[0.28em] text-rose-200">
          {error}
        </span>
      ) : null}
    </form>
  );
}

