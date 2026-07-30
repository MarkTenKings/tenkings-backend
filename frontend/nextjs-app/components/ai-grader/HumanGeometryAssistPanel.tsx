import React, { useEffect, useState } from "react";
import type {
  AiGraderLocalStationStatus,
  AiGraderRapidCaptureActiveReview,
} from "../../lib/aiGraderLocalStation";
import {
  callAiGraderStationBridge,
  fetchAiGraderQueuedOcrAsset,
} from "../../lib/aiGraderStationBridgeClient";
import HumanGeometryAssistWorkspace from "./HumanGeometryAssistWorkspace";

type Props = {
  baseUrl: string;
  stationToken: string;
  review: AiGraderRapidCaptureActiveReview;
  operatorId: string;
  onStatus: (status: AiGraderLocalStationStatus) => void;
};

export default function HumanGeometryAssistPanel({
  baseUrl,
  stationToken,
  review,
  operatorId,
  onStatus,
}: Props) {
  const geometry = review.manifest.humanGeometryAssist;
  const [images, setImages] = useState<{ front: string; back: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let disposed = false;
    let urls: string[] = [];
    setImages(null);
    setError(null);
    Promise.all((["front", "back"] as const).map(async (side) => {
      const asset = await fetchAiGraderQueuedOcrAsset({
        baseUrl,
        stationToken,
        queueItemId: review.queueItemId,
        gradingSessionId: review.gradingSessionId,
        reportId: review.reportId,
        side,
      });
      const url = URL.createObjectURL(new Blob([asset.bytes], { type: asset.contentType }));
      urls.push(url);
      return [side, url] as const;
    })).then((entries) => {
      if (disposed) return;
      setImages(Object.fromEntries(entries) as { front: string; back: string });
    }).catch((reason) => {
      if (!disposed) setError(reason instanceof Error ? reason.message : "Full-resolution card images are unavailable.");
    });
    return () => {
      disposed = true;
      urls.forEach((url) => URL.revokeObjectURL(url));
    };
  }, [baseUrl, review.gradingSessionId, review.queueItemId, review.reportId, stationToken]);

  if (!geometry || geometry.state !== "geometry_review_required") return null;
  if (error) return <section role="alert">{error}</section>;
  if (!images) return <section aria-busy="true">Loading full-resolution geometry workspace…</section>;

  return (
    <HumanGeometryAssistWorkspace
      key={`${review.queueItemId}:${geometry.receiptVersion}`}
      draft={geometry.draft}
      frontImageUrl={images.front}
      backImageUrl={images.back}
      busy={busy}
      onLock={async (sides) => {
        if (!operatorId) {
          setError("Sign in before locking geometry.");
          return;
        }
        setBusy(true);
        setError(null);
        try {
          const status = await callAiGraderStationBridge({
            baseUrl,
            stationToken,
            action: "lock-human-geometry",
            body: {
              queueItemId: review.queueItemId,
              gradingSessionId: review.gradingSessionId,
              reportId: review.reportId,
              operatorId,
              expectedReceiptVersion: geometry.receiptVersion,
              idempotencyKey: globalThis.crypto.randomUUID(),
              humanGeometrySides: sides,
            },
          });
          onStatus(status);
        } catch (reason) {
          setError(reason instanceof Error ? reason.message : "Geometry could not be locked.");
        } finally {
          setBusy(false);
        }
      }}
    />
  );
}
