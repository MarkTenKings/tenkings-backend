export type YouTubePlayer = {
  mute(): void;
  unMute(): void;
  getPlayerState(): number;
  destroy(): void;
};

type YouTubeEvent = { target: YouTubePlayer; data?: number };
export type YouTubeApi = {
  Player: new (frame: HTMLIFrameElement, options: {
    events: { onReady(event: YouTubeEvent): void; onStateChange(event: YouTubeEvent): void };
  }) => YouTubePlayer;
};

declare global {
  interface Window {
    YT?: YouTubeApi;
    onYouTubeIframeAPIReady?: () => void;
  }
}

let pending: Promise<YouTubeApi | null> | undefined;

/** Loaded only by an intentionally mounted player; concurrent callers share one script. */
export function loadYouTubeIframeApi(): Promise<YouTubeApi | null> {
  if (window.YT?.Player) return Promise.resolve(window.YT);
  if (pending) return pending;
  pending = new Promise<YouTubeApi | null>((resolve) => {
    const script = document.createElement("script");
    const previous = window.onYouTubeIframeAPIReady;
    let settled = false;
    const finish = (api: YouTubeApi | null) => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timer);
      script.onerror = null;
      if (window.onYouTubeIframeAPIReady === ready) window.onYouTubeIframeAPIReady = previous;
      if (!api) script.remove();
      resolve(api);
    };
    const ready = () => {
      try { previous?.(); } finally { finish(window.YT?.Player ? window.YT : null); }
    };
    const timer = window.setTimeout(() => finish(null), 15_000);
    window.onYouTubeIframeAPIReady = ready;
    script.src = "https://www.youtube.com/iframe_api";
    script.async = true;
    script.onerror = () => finish(null);
    document.head.appendChild(script);
  }).then((api) => { pending = undefined; return api; });
  return pending;
}
