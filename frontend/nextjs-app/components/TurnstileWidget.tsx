import Script from "next/script";
import { useEffect, useRef, useState } from "react";

export const TURNSTILE_SEND_CODE_ACTION = "send_code";

type TurnstileRenderOptions = {
  sitekey: string;
  action: string;
  theme: "auto" | "light" | "dark";
  size: "flexible";
  appearance: "always";
  callback: (token: string) => void;
  "error-callback": () => void;
  "expired-callback": () => void;
  "timeout-callback": () => void;
};

type TurnstileApi = {
  render: (container: HTMLElement, options: TurnstileRenderOptions) => string;
  reset: (widgetId: string) => void;
  remove: (widgetId: string) => void;
};

declare global {
  interface Window {
    turnstile?: TurnstileApi;
  }
}

type TurnstileWidgetProps = {
  action?: string;
  resetKey: number;
  onTokenChange: (token: string | null) => void;
};

export default function TurnstileWidget({
  action = TURNSTILE_SEND_CODE_ACTION,
  resetKey,
  onTokenChange,
}: TurnstileWidgetProps) {
  const siteKey = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY?.trim() ?? "";
  const containerRef = useRef<HTMLDivElement | null>(null);
  const widgetIdRef = useRef<string | null>(null);
  const previousResetKeyRef = useRef(resetKey);
  const onTokenChangeRef = useRef(onTokenChange);
  const [scriptReady, setScriptReady] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    onTokenChangeRef.current = onTokenChange;
  }, [onTokenChange]);

  useEffect(() => {
    if (window.turnstile) {
      setScriptReady(true);
    }
  }, []);

  useEffect(() => {
    if (!siteKey || !scriptReady || !containerRef.current || !window.turnstile || widgetIdRef.current) {
      return;
    }

    try {
      widgetIdRef.current = window.turnstile.render(containerRef.current, {
        sitekey: siteKey,
        action,
        theme: "dark",
        size: "flexible",
        appearance: "always",
        callback: (token) => {
          setError(null);
          onTokenChangeRef.current(token);
        },
        "error-callback": () => {
          onTokenChangeRef.current(null);
          setError("Human verification could not load. Please try again.");
        },
        "expired-callback": () => {
          onTokenChangeRef.current(null);
        },
        "timeout-callback": () => {
          onTokenChangeRef.current(null);
          setError("Human verification timed out. Please try again.");
        },
      });
    } catch {
      onTokenChangeRef.current(null);
      setError("Human verification could not load. Please refresh the page.");
    }

    return () => {
      if (widgetIdRef.current && window.turnstile) {
        window.turnstile.remove(widgetIdRef.current);
      }
      widgetIdRef.current = null;
      onTokenChangeRef.current(null);
    };
  }, [action, scriptReady, siteKey]);

  useEffect(() => {
    if (previousResetKeyRef.current === resetKey) {
      return;
    }
    previousResetKeyRef.current = resetKey;
    onTokenChangeRef.current(null);
    setError(null);
    if (widgetIdRef.current && window.turnstile) {
      window.turnstile.reset(widgetIdRef.current);
    }
  }, [resetKey]);

  if (!siteKey) {
    return (
      <p role="alert" className="text-sm text-rose-300">
        Human verification is temporarily unavailable.
      </p>
    );
  }

  return (
    <div className="space-y-2">
      <Script
        id="cloudflare-turnstile-api"
        src="https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit"
        strategy="afterInteractive"
        onReady={() => setScriptReady(true)}
        onError={() => {
          onTokenChangeRef.current(null);
          setError("Human verification could not load. Please refresh the page.");
        }}
      />
      <div ref={containerRef} aria-label="Human verification" className="min-h-[65px] w-full" />
      {error ? (
        <p role="alert" className="text-xs text-rose-300">
          {error}
        </p>
      ) : null}
    </div>
  );
}
