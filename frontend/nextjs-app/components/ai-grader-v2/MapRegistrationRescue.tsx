"use client";

import { useMemo, useRef, useState } from "react";
import type { SpeedsterCardSide, SpeedsterPoint } from "../../lib/ai-grader-v2/contracts";
import type { SpeedsterMapRegistrationFailure } from "../../lib/ai-grader-v2/card-type-map-contracts";
import styles from "./MapRegistrationRescue.module.css";

type CorrectedAnchor = Readonly<{ anchorId: string; point: SpeedsterPoint }>;

const clampUnit = (value: number) => Math.max(0, Math.min(1, value));

export function MapRegistrationRescue({
  side,
  imageUrl,
  imageRevision = 0,
  imageRefreshError = null,
  imageRefreshing = false,
  failure,
  initialCorrectedAnchors,
  disabled,
  onConfirm,
  onDraftChange,
  onImageError,
  onImageReady,
  onRetryImage,
}: Readonly<{
  side: SpeedsterCardSide;
  imageUrl: string;
  imageRevision?: number;
  imageRefreshError?: string | null;
  imageRefreshing?: boolean;
  failure: SpeedsterMapRegistrationFailure;
  initialCorrectedAnchors?: readonly CorrectedAnchor[];
  disabled: boolean;
  onConfirm: (anchors: readonly CorrectedAnchor[]) => Promise<void>;
  onDraftChange?: (anchors: readonly CorrectedAnchor[]) => void;
  onImageError?: () => void;
  onImageReady?: () => void;
  onRetryImage?: () => void;
}>) {
  const imageRef = useRef<HTMLImageElement | null>(null);
  const failedImageIdentity = useRef<string | null>(null);
  const [dragging, setDragging] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loadedImageIdentity, setLoadedImageIdentity] = useState<string | null>(null);
  const imageIdentity = `${imageRevision}:${imageUrl}`;
  const imageReady = loadedImageIdentity === imageIdentity && !imageRefreshError;
  const [anchors, setAnchors] = useState<readonly CorrectedAnchor[]>(() => (
    initialCorrectedAnchors
    && initialCorrectedAnchors.length === failure.bestCandidate.anchors.length
    && initialCorrectedAnchors.every((anchor, index) => (
      anchor.anchorId === failure.bestCandidate.anchors[index]?.anchorId
      && Number.isFinite(anchor.point.x) && anchor.point.x >= 0 && anchor.point.x <= 1
      && Number.isFinite(anchor.point.y) && anchor.point.y >= 0 && anchor.point.y <= 1
    ))
      ? initialCorrectedAnchors
      : failure.bestCandidate.anchors.map((anchor) => ({
        anchorId: anchor.anchorId,
        point: {
          // Failed/off-card proposals remain unmodified in diagnostics; only the
          // interactive handle is clamped to the visible physical card.
          x: clampUnit(anchor.trackedPoint?.x ?? anchor.expectedPoint.x),
          y: clampUnit(anchor.trackedPoint?.y ?? anchor.expectedPoint.y),
        },
      }))
  ));
  const diagnostics = useMemo(() => new Map(
    failure.bestCandidate.anchors.map((anchor) => [anchor.anchorId, anchor]),
  ), [failure]);
  const allAnchorsIndividuallyCredible = failure.bestCandidate.anchors.every(
    (anchor) => anchor.status === "TRACKED",
  );

  const move = (clientX: number, clientY: number) => {
    if (!dragging || disabled || !imageRef.current) return;
    const bounds = imageRef.current.getBoundingClientRect();
    const point = {
      x: clampUnit((clientX - bounds.left) / bounds.width),
      y: clampUnit((clientY - bounds.top) / bounds.height),
    };
    const next = anchors.map((anchor) => (
      anchor.anchorId === dragging ? { ...anchor, point } : anchor
    ));
    setAnchors(next);
    onDraftChange?.(next);
  };

  return (
    <section className={styles.rescue} aria-label={`${side} Card Map anchor rescue`}>
      <header>
        <span>CARD MAP · HUMAN ANCHOR RESCUE</span>
        <h2>{side === "FRONT" ? "Front" : "Back"} registration needs correction.</h2>
        <p>These are Card Map registration anchors on internal printed landmarks—not the physical card corners you already confirmed. Drag each numbered handle onto the same landmark shown by its expected marker. Nothing applies until the server validates both sides.</p>
      </header>
      <div className={styles.globalFailure} role="status">
        <strong>{failure.failureCode.replaceAll("_", " ")}</strong>
        <span>{failure.message}</span>
        {allAnchorsIndividuallyCredible ? (
          <span>All four proposals look individually credible, but the global registration gate failed. Confirm all four positions; movement is not required.</span>
        ) : null}
      </div>
      <div
        className={styles.canvas}
        onPointerMove={(event) => move(event.clientX, event.clientY)}
        onPointerUp={() => setDragging(null)}
        onPointerCancel={() => setDragging(null)}
      >
        {/* Exact signed evidence dimensions must remain browser-native here. */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          key={imageIdentity}
          ref={imageRef}
          src={imageUrl}
          alt={`${side.toLowerCase()} current card`}
          draggable={false}
          onLoad={(event) => {
            if (event.currentTarget.naturalWidth <= 0 || event.currentTarget.naturalHeight <= 0) {
              failedImageIdentity.current = imageIdentity;
              setLoadedImageIdentity(null);
              onImageError?.();
              return;
            }
            failedImageIdentity.current = null;
            setLoadedImageIdentity(imageIdentity);
            onImageReady?.();
          }}
          onError={() => {
            setLoadedImageIdentity(null);
            if (failedImageIdentity.current === imageIdentity) return;
            failedImageIdentity.current = imageIdentity;
            onImageError?.();
          }}
        />
        {imageReady ? failure.bestCandidate.anchors.map((anchor, index) => (
          <span
            key={`expected:${anchor.anchorId}`}
            className={styles.expected}
            style={{ left: `${anchor.expectedPoint.x * 100}%`, top: `${anchor.expectedPoint.y * 100}%` }}
            title={`Expected ${anchor.anchorId}`}
          >{index + 1}</span>
        )) : null}
        {imageReady ? anchors.map((anchor, index) => {
          const diagnostic = diagnostics.get(anchor.anchorId)!;
          return (
            <button
              type="button"
              key={anchor.anchorId}
              className={`${styles.handle} ${diagnostic.status === "TRACKED" ? styles.tracked : styles.failed}`}
              style={{ left: `${anchor.point.x * 100}%`, top: `${anchor.point.y * 100}%` }}
              onPointerDown={(event) => {
                event.preventDefault();
                event.currentTarget.setPointerCapture(event.pointerId);
                setDragging(anchor.anchorId);
              }}
              disabled={disabled}
              aria-label={`Move anchor ${index + 1}, ${diagnostic.status.toLowerCase()}`}
            >{index + 1}</button>
          );
        }) : null}
        {!imageReady ? (
          <div className={styles.imageStatus} role={imageRefreshError ? "alert" : "status"}>
            <strong>{imageRefreshError ? "Card image unavailable" : imageRefreshing ? "Refreshing card image…" : "Loading card image…"}</strong>
            {imageRefreshError ? <span>{imageRefreshError}</span> : null}
            {imageRefreshError && onRetryImage ? (
              <button type="button" onClick={onRetryImage} disabled={imageRefreshing}>Retry image</button>
            ) : null}
          </div>
        ) : null}
      </div>
      <div className={styles.diagnostics}>
        {failure.bestCandidate.anchors.map((anchor, index) => (
          <span key={anchor.anchorId} data-status={anchor.status}>
            {index + 1} · {anchor.status.replaceAll("_", " ")} · {Math.round(anchor.score * 100)}% · {failure.bestCandidate.perAnchorInlierCounts[index]} of {failure.bestCandidate.perAnchorFeatureCounts[index]} features supported the transform
          </span>
        ))}
      </div>
      {error ? <p role="alert" className={styles.error}>{error}</p> : null}
      <div className={styles.actions}>
        <button
          type="button"
          onClick={() => {
            setError(null);
            void onConfirm(anchors).catch((reason) => {
              setError(reason instanceof Error ? reason.message : "Anchor correction could not be saved. Your corrections are preserved.");
            });
          }}
          disabled={disabled || !imageReady}
        >{disabled ? "Validating…" : !imageReady ? "Image required" : "Confirm corrected anchors"}</button>
      </div>
    </section>
  );
}
