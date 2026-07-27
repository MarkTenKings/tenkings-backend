import Head from "next/head";
import { useRouter } from "next/router";
import { useCallback, useEffect, useRef, useState } from "react";
import AppShell from "../../../components/AppShell";
import { useSession, type SessionPayload } from "../../../hooks/useSession";

type ClaimState = "loading" | "auth" | "claiming" | "error";

export default function LiveRipClaimPage() {
  const router = useRouter();
  const { session, loading: sessionLoading, ensureSession } = useSession();
  const [claimState, setClaimState] = useState<ClaimState>("loading");
  const [message, setMessage] = useState("Opening your Live Rip claim…");
  const startedRef = useRef(false);

  const submitClaim = useCallback(
    async (activeSession: SessionPayload, token: string) => {
      setClaimState("claiming");
      setMessage("Adding your Live Rip to your collection…");

      const response = await fetch(`/api/live-rip/claims/${encodeURIComponent(token)}`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${activeSession.token}`,
        },
      });
      const payload = (await response.json().catch(() => ({}))) as {
        message?: string;
        claim?: { redirectTo?: string };
      };

      if (!response.ok) {
        throw new Error(payload.message ?? "Unable to claim this Live Rip");
      }

      setMessage("Claim complete. Opening your Live Rips…");
      await router.replace(payload.claim?.redirectTo ?? "/collection?section=live-rips");
    },
    [router]
  );

  const startClaim = useCallback(async () => {
    const token = Array.isArray(router.query.token) ? router.query.token[0] : router.query.token;
    if (!token) {
      setClaimState("error");
      setMessage("This Live Rip claim link is invalid.");
      return;
    }

    try {
      setClaimState("loading");
      setMessage("Checking your Live Rip claim…");
      const validationResponse = await fetch(
        `/api/live-rip/claims/${encodeURIComponent(token)}`,
        {
          method: "GET",
          cache: "no-store",
          headers: { Accept: "application/json" },
        }
      );
      const validationPayload = (await validationResponse.json().catch(() => ({}))) as {
        message?: string;
      };
      if (!validationResponse.ok) {
        throw new Error(validationPayload.message ?? "This Live Rip claim link is unavailable");
      }

      let activeSession = session;
      if (!activeSession) {
        setClaimState("auth");
        setMessage("Sign in or create your Ten Kings account to claim this Live Rip.");
        activeSession = await ensureSession();
      }
      await submitClaim(activeSession, token);
    } catch (error) {
      setClaimState("error");
      setMessage(
        error instanceof Error && error.message !== "Authentication cancelled"
          ? error.message
          : "Sign in to finish claiming your Live Rip."
      );
    }
  }, [ensureSession, router.query.token, session, submitClaim]);

  useEffect(() => {
    if (!router.isReady || sessionLoading || startedRef.current) {
      return;
    }
    startedRef.current = true;
    void startClaim();
  }, [router.isReady, sessionLoading, startClaim]);

  return (
    <AppShell background="black">
      <Head>
        <title>Claim Your Live Rip · Ten Kings</title>
        <meta name="robots" content="noindex,nofollow" />
      </Head>

      <div className="mx-auto flex min-h-[70vh] w-full max-w-2xl items-center px-6 py-16">
        <section className="w-full rounded-[2rem] border border-gold-500/25 bg-night-900/90 p-8 text-center shadow-card">
          <p className="text-xs uppercase tracking-[0.38em] text-gold-300">Ten Kings Live</p>
          <h1 className="mt-4 font-heading text-4xl uppercase tracking-[0.16em] text-white">
            Your Live Rip Is Ready
          </h1>
          <p className="mx-auto mt-5 max-w-lg text-sm leading-6 text-slate-300">{message}</p>

          {(claimState === "loading" || claimState === "auth" || claimState === "claiming") && (
            <div className="mx-auto mt-8 h-10 w-10 animate-spin rounded-full border-2 border-gold-500/20 border-t-gold-400" />
          )}

          {claimState === "error" && (
            <button
              type="button"
              onClick={() => {
                startedRef.current = true;
                void startClaim();
              }}
              className="mt-8 rounded-full border border-gold-500/60 bg-gold-500 px-8 py-3 text-xs font-semibold uppercase tracking-[0.32em] text-night-900 shadow-glow transition hover:bg-gold-400"
            >
              Sign In and Claim
            </button>
          )}
        </section>
      </div>
    </AppShell>
  );
}
