import { useEffect, useId, useRef, useState, type ReactNode } from "react";

const PLAY_EVENT = "tenkings:media-play";

/** Decorative previews attach a player only after a visible, deliberate play. */
export default function OnDemandMedia({
  title,
  sourceKey,
  posterUrl,
  children,
}: {
  title: string;
  sourceKey: string;
  posterUrl?: string | null;
  children: ReactNode;
}) {
  const owner = useId();
  const frame = useRef<HTMLDivElement>(null);
  const [selectedSource, setSelectedSource] = useState<string | null>(null);
  const active = selectedSource === sourceKey;

  useEffect(() => {
    const stop = () => setSelectedSource(null);
    const handlePlay = (event: Event) => {
      if ((event as CustomEvent<string>).detail !== owner) stop();
    };
    const handleVisibility = () => {
      if (document.visibilityState !== "visible") stop();
    };
    const observer = new IntersectionObserver(([entry]) => {
      if (!entry?.isIntersecting) stop();
    });
    if (frame.current) observer.observe(frame.current);
    window.addEventListener(PLAY_EVENT, handlePlay);
    document.addEventListener("visibilitychange", handleVisibility);
    return () => {
      observer.disconnect();
      window.removeEventListener(PLAY_EVENT, handlePlay);
      document.removeEventListener("visibilitychange", handleVisibility);
    };
  }, [owner]);

  useEffect(() => setSelectedSource(null), [sourceKey]);

  useEffect(() => {
    if (!active) return;
    const videos = Array.from(frame.current?.querySelectorAll("video") ?? []);
    return () => videos.forEach((video) => {
      video.pause();
      video.removeAttribute("src");
      video.load();
    });
  }, [active]);

  const play = () => {
    const rect = frame.current?.getBoundingClientRect();
    if (
      document.visibilityState !== "visible" || !rect || rect.width <= 0 || rect.height <= 0 ||
      rect.bottom <= 0 || rect.right <= 0 || rect.top >= window.innerHeight || rect.left >= window.innerWidth
    ) return;
    window.dispatchEvent(new CustomEvent(PLAY_EVENT, { detail: owner }));
    setSelectedSource(sourceKey);
  };

  return (
    <div ref={frame} className="absolute inset-0" onEnded={() => setSelectedSource(null)}>
      {active ? (
        <>
          {children}
          <button
            type="button"
            onClick={() => setSelectedSource(null)}
            aria-label={`Close ${title}`}
            className="absolute right-3 top-3 z-10 rounded-full border border-white/20 bg-black/75 px-3 py-2 text-xs text-white"
          >
            Close
          </button>
        </>
      ) : (
        <button
          type="button"
          onClick={play}
          aria-label={`Play ${title}`}
          className="absolute inset-0 flex h-full w-full items-center justify-center bg-night-900 text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-gold-500"
        >
          {posterUrl && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={posterUrl} alt="" loading="lazy" decoding="async" className="absolute inset-0 h-full w-full object-contain" />
          )}
          <span className="relative rounded-full border border-white/30 bg-black/75 px-5 py-3 text-sm uppercase tracking-widest">
            Play video
          </span>
        </button>
      )}
    </div>
  );
}
