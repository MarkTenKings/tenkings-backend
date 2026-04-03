import Head from "next/head";
import Link from "next/link";
import { useRouter } from "next/router";
import { useEffect, useState } from "react";
import AppShell from "../../components/AppShell";

type AutoDetectStatus = "loading" | "denied" | "error";

export default function KingsHuntAutoDetectPage() {
  const router = useRouter();
  const [status, setStatus] = useState<AutoDetectStatus>("loading");

  useEffect(() => {
    let cancelled = false;

    if (!navigator.geolocation) {
      setStatus("denied");
      return () => {
        cancelled = true;
      };
    }

    navigator.geolocation.getCurrentPosition(
      async (position) => {
        if (cancelled) {
          return;
        }

        try {
          const response = await fetch("/api/kingshunt/detect", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              lat: position.coords.latitude,
              lng: position.coords.longitude,
            }),
          });

          if (!response.ok) {
            throw new Error("Detect request failed");
          }

          const payload = (await response.json()) as { location?: { slug: string } | null };
          if (payload.location?.slug) {
            void router.replace(`/kingshunt/${payload.location.slug}?entry=gps`);
            return;
          }

          void router.replace("/locations");
        } catch (error) {
          console.error("Kings Hunt auto-detect failed", error);
          if (!cancelled) {
            setStatus("error");
          }
        }
      },
      () => {
        if (!cancelled) {
          setStatus("denied");
        }
      },
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 10000 },
    );

    return () => {
      cancelled = true;
    };
  }, [router]);

  return (
    <AppShell hideHeader hideFooter background="black">
      <Head>
        <title>Ten Kings · Kings Hunt</title>
        <meta name="description" content="Auto-detect the nearest Ten Kings venue and launch the Kings Hunt experience." />
      </Head>

      <div className="flex min-h-screen items-center justify-center px-4 py-10 [background:radial-gradient(circle_at_top,rgba(212,168,67,0.14),transparent_30%),radial-gradient(circle_at_bottom,rgba(59,130,246,0.08),transparent_28%),#050505]">
        <div className="w-full max-w-md rounded-[32px] border border-white/10 bg-[linear-gradient(180deg,rgba(255,255,255,0.05),rgba(255,255,255,0.02))] p-8 text-center shadow-[0_30px_90px_rgba(0,0,0,0.48)]">
          <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full border border-[rgba(212,168,67,0.24)] bg-[rgba(212,168,67,0.1)] text-[#d4a843]">
            <span className={`text-2xl ${status === "loading" ? "animate-pulse" : ""}`} aria-hidden>
              K
            </span>
          </div>
          <h1 className="mt-6 text-[2rem] font-semibold tracking-[-0.02em] text-[#f7f7f8]">Kings Hunt</h1>
          <p className="mt-3 text-sm text-[#9d9da6]">
            {status === "loading"
              ? "Checking your venue so we can guide you straight to the Ten Kings machine."
              : status === "denied"
                ? "Location access is off. Use a venue QR code or browse all Ten Kings destinations."
                : "We couldn't confirm your venue from GPS. You can still browse locations manually."}
          </p>

          {status !== "loading" ? (
            <div className="mt-8 space-y-3">
              <Link
                href="/locations"
                className="flex w-full items-center justify-center rounded-[18px] bg-[#d4a843] px-4 py-3 text-sm font-semibold text-[#16130b] transition hover:bg-[#e0b84e]"
              >
                View All Locations
              </Link>
              <Link
                href="/kingshunt/folsom-premium-outlets"
                className="flex w-full items-center justify-center rounded-[18px] border border-white/10 px-4 py-3 text-sm font-medium text-[#f4f4f6] transition hover:border-white/20 hover:bg-white/[0.03]"
              >
                Preview Folsom Kings Hunt
              </Link>
            </div>
          ) : null}
        </div>
      </div>
    </AppShell>
  );
}
