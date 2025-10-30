import { useEffect, useMemo, useRef } from "react";

type ParsedMedia =
  | { type: "youtube"; id: string; embedUrl: string }
  | { type: "video"; src: string }
  | { type: "link"; href: string };

const parseMedia = (videoUrl: string): ParsedMedia => {
  if (/youtu\.be|youtube\.com/.test(videoUrl)) {
    try {
      const url = new URL(videoUrl);
      const directId = url.searchParams.get("v") ?? videoUrl.split("/").pop() ?? "";
      const id = directId.replace(/[^\w-]/g, "");
      if (id) {
        const params = new URLSearchParams({
          autoplay: "1",
          mute: "1",
          loop: "1",
          playlist: id,
          controls: "0",
          modestbranding: "1",
          rel: "0",
          playsinline: "1",
          enablejsapi: "1",
        });
        return {
          type: "youtube",
          id,
          embedUrl: `https://www.youtube.com/embed/${id}?${params.toString()}`,
        };
      }
    } catch (error) {
      // fall through
    }
  }

  if (/\.mp4($|\?)/.test(videoUrl)) {
    return { type: "video", src: videoUrl };
  }

  return { type: "link", href: videoUrl };
};

const formatViews = (value: number) =>
  new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 }).format(value);

export interface LiveRipPreviewProps {
  id: string;
  title: string;
  videoUrl: string;
  thumbnailUrl?: string | null;
  muted: boolean;
  onToggleMute: () => void;
  viewCount?: number | null;
  className?: string;
  aspectClassName?: string;
  showMuteToggle?: boolean;
}

export default function LiveRipPreview({
  id,
  title,
  videoUrl,
  thumbnailUrl,
  muted,
  onToggleMute,
  viewCount,
  className = "",
  aspectClassName = "pb-[56.25%]",
  showMuteToggle = true,
}: LiveRipPreviewProps) {
  const media = useMemo(() => parseMedia(videoUrl), [videoUrl]);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const iframeRef = useRef<HTMLIFrameElement | null>(null);

  useEffect(() => {
    if (media.type !== "video" || !videoRef.current) {
      return;
    }
    const element = videoRef.current;
    element.muted = muted;
    element.loop = true;
    element.playsInline = true;
    element.preload = "auto";
    const playPromise = element.play();
    if (playPromise) {
      playPromise.catch(() => undefined);
    }
  }, [muted, media]);

  useEffect(() => {
    if (media.type !== "youtube" || !iframeRef.current?.contentWindow) {
      return;
    }
    const frame = iframeRef.current;
    const send = (func: string, args: unknown[] = []) => {
      frame.contentWindow?.postMessage(
        JSON.stringify({ event: "command", func, args }),
        "*"
      );
    };
    const timer = window.setTimeout(() => {
      if (muted) {
        send("mute");
      } else {
        send("unMute");
        send("playVideo");
      }
    }, 200);
    return () => window.clearTimeout(timer);
  }, [muted, media]);

  useEffect(() => {
    if (media.type !== "youtube" || !iframeRef.current?.contentWindow) {
      return;
    }
    const frame = iframeRef.current;
    const timer = window.setTimeout(() => {
      frame.contentWindow?.postMessage(
        JSON.stringify({ event: "command", func: "mute" }),
        "*"
      );
    }, 200);
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [media.type, id]);

  const renderMedia = () => {
    switch (media.type) {
      case "video":
        return (
          <video
            ref={videoRef}
            src={media.src}
            className="absolute inset-0 h-full w-full object-cover"
            autoPlay
            loop
            muted={muted}
            playsInline
            preload="auto"
            poster={thumbnailUrl ?? undefined}
            crossOrigin="anonymous"
            aria-label={title}
          />
        );
      case "youtube":
        return (
          <iframe
            ref={iframeRef}
            className="absolute inset-0 h-full w-full"
            src={media.embedUrl}
            allow="autoplay; encrypted-media; picture-in-picture"
            loading="eager"
            allowFullScreen
            title={title}
          />
        );
      default:
        return (
          <a
            href={media.href}
            target="_blank"
            rel="noreferrer"
            className="absolute inset-0 flex items-center justify-center bg-night-900/70 text-xs uppercase tracking-[0.28em] text-slate-200 transition hover:text-gold-200"
          >
            Open clip →
          </a>
        );
    }
  };

  const showMuteControl = showMuteToggle && (media.type === "video" || media.type === "youtube");

  return (
    <div className={`relative overflow-hidden rounded-3xl border border-white/10 bg-night-900/70 shadow-card ${className}`}>
      <div className={`relative h-0 w-full ${aspectClassName}`}>
        <div className="absolute inset-0">{renderMedia()}</div>
      </div>
      {typeof viewCount === "number" && viewCount >= 0 && (
        <span className="absolute left-3 top-3 rounded-full bg-black/60 px-3 py-1 text-[11px] uppercase tracking-[0.3em] text-slate-200">
          {formatViews(viewCount)} views
        </span>
      )}
      {showMuteControl && (
        <button
          type="button"
          onClick={onToggleMute}
          className="absolute bottom-3 right-3 rounded-full border border-white/20 bg-black/60 px-3 py-2 text-[11px] uppercase tracking-[0.32em] text-slate-200 transition hover:border-white/40 hover:text-white"
          aria-pressed={!muted}
          aria-label={muted ? `Unmute ${title}` : `Mute ${title}`}
        >
          {muted ? "Unmute" : "Mute"}
        </button>
      )}
    </div>
  );
}
