import MuxPlayer from "@mux/mux-player-react";

type AdminGoldenQueuePlayerProps = {
  title: string;
  muxPlaybackId: string | null;
  videoUrl: string | null;
  thumbnailUrl?: string | null;
  live?: boolean;
  muted?: boolean;
  interactive?: boolean;
  autoPlay?: boolean | "muted";
  emptyLabel?: string;
  className?: string;
};

export default function AdminGoldenQueuePlayer({
  title,
  muxPlaybackId,
  videoUrl,
  thumbnailUrl = null,
  live = true,
  muted = true,
  interactive = false,
  autoPlay = "muted",
  emptyLabel = "Waiting for stream",
  className = "h-full w-full object-cover",
}: AdminGoldenQueuePlayerProps) {
  const interactionClass = interactive ? "" : "pointer-events-none";

  if (muxPlaybackId) {
    return (
      <MuxPlayer
        playbackId={muxPlaybackId}
        streamType={live ? "live" : "on-demand"}
        metadataVideoTitle={title}
        title={title}
        poster={thumbnailUrl ?? undefined}
        autoPlay={autoPlay}
        muted={muted}
        loop={!live}
        playsInline
        className={`${interactionClass} ${className}`.trim()}
      />
    );
  }

  if (videoUrl) {
    return (
      <video
        src={videoUrl}
        title={title}
        autoPlay={Boolean(autoPlay)}
        muted={muted}
        loop={!live}
        playsInline
        controls={interactive}
        preload="metadata"
        poster={thumbnailUrl ?? undefined}
        className={`${interactionClass} ${className}`.trim()}
      />
    );
  }

  return (
    <div
      className={`flex h-full w-full items-center justify-center bg-black px-3 text-center font-heading text-sm uppercase tracking-[0.14em] text-[#b99839] ${className}`.trim()}
    >
      {emptyLabel}
    </div>
  );
}
