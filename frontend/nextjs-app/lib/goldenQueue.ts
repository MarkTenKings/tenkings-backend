export const ADMIN_GOLDEN_QUEUE_ACTIVE_STATUSES = ["COUNTDOWN", "LIVE", "REVEAL"] as const;

export type AdminGoldenQueueStatus = (typeof ADMIN_GOLDEN_QUEUE_ACTIVE_STATUSES)[number];

export interface AdminGoldenQueueSession {
  id: string;
  code: string;
  status: AdminGoldenQueueStatus;
  stageEnteredAt: string;
  countdownStartedAt: string;
  liveStartedAt: string | null;
  revealStartedAt: string | null;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
  muxPlaybackId: string | null;
  videoUrl: string | null;
  thumbnailUrl: string | null;
  watchHref: string;
  winnerName: string;
  ticket: {
    id: string;
    code: string;
    status: string;
    ticketNumber: number;
    ticketLabel: string;
  };
  prize: {
    itemId: string;
    name: string;
    description: string | null;
    estimatedValue: number | null;
    imageUrl: string | null;
    thumbnailUrl: string | null;
  };
}

export interface AdminGoldenQueueResponse {
  polledAt: string;
  sessions: AdminGoldenQueueSession[];
}

export function getAdminGoldenQueueWatchHref(sessionId: string) {
  return `/admin/golden/sessions/${sessionId}`;
}

export function formatAdminGoldenQueueElapsed(stageEnteredAt: string, nowMs = Date.now()) {
  const startedAtMs = Date.parse(stageEnteredAt);
  if (!Number.isFinite(startedAtMs)) {
    return "0:00";
  }

  const totalSeconds = Math.max(0, Math.floor((nowMs - startedAtMs) / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
  }

  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}
