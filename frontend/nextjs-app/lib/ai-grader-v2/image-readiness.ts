export type SpeedsterImageReadiness = "LOADING" | "READY" | "FAILED";

type SpeedsterLayoutRect = {
  left: number;
  top: number;
  right: number;
  bottom: number;
  width: number;
  height: number;
};

export type SpeedsterImageLayoutSnapshot = {
  complete: boolean;
  naturalWidth: number;
  naturalHeight: number;
  clientWidth: number;
  clientHeight: number;
  frameClientWidth: number;
  frameClientHeight: number;
  imageRect: SpeedsterLayoutRect;
  frameRect: SpeedsterLayoutRect;
};

export type SpeedsterImageReadinessResult =
  | { ready: true }
  | { ready: false; reason: string };

const isPositiveFinite = (value: number): boolean => Number.isFinite(value) && value > 0;

function hasPositiveRect(rect: SpeedsterLayoutRect): boolean {
  return [rect.left, rect.top, rect.right, rect.bottom, rect.width, rect.height].every(Number.isFinite)
    && rect.right > rect.left
    && rect.bottom > rect.top
    && isPositiveFinite(rect.width)
    && isPositiveFinite(rect.height);
}

export function evaluateSpeedsterImageReadiness(
  snapshot: SpeedsterImageLayoutSnapshot,
): SpeedsterImageReadinessResult {
  if (!snapshot.complete) return { ready: false, reason: "image loading is incomplete" };
  if (!isPositiveFinite(snapshot.naturalWidth) || !isPositiveFinite(snapshot.naturalHeight)) {
    return { ready: false, reason: "decoded image dimensions are zero" };
  }
  if (!isPositiveFinite(snapshot.clientWidth) || !isPositiveFinite(snapshot.clientHeight)) {
    return { ready: false, reason: "rendered image dimensions are zero" };
  }
  if (!isPositiveFinite(snapshot.frameClientWidth) || !isPositiveFinite(snapshot.frameClientHeight)) {
    return { ready: false, reason: "usable frame dimensions are zero" };
  }
  if (!hasPositiveRect(snapshot.imageRect)) {
    return { ready: false, reason: "rendered image bounds are invalid" };
  }
  if (!hasPositiveRect(snapshot.frameRect)) {
    return { ready: false, reason: "usable frame bounds are invalid" };
  }

  const intersectionWidth = Math.max(
    0,
    Math.min(snapshot.imageRect.right, snapshot.frameRect.right)
      - Math.max(snapshot.imageRect.left, snapshot.frameRect.left),
  );
  const intersectionHeight = Math.max(
    0,
    Math.min(snapshot.imageRect.bottom, snapshot.frameRect.bottom)
      - Math.max(snapshot.imageRect.top, snapshot.frameRect.top),
  );
  const intersectionArea = intersectionWidth * intersectionHeight;
  const imageArea = snapshot.imageRect.width * snapshot.imageRect.height;
  if (intersectionArea / imageArea < 0.5) {
    return { ready: false, reason: "rendered image is outside the usable frame" };
  }
  return { ready: true };
}

export function speedsterGeometryInteractionState(readiness: SpeedsterImageReadiness) {
  const actionable = readiness === "READY";
  return {
    overlayVisible: actionable,
    continueEnabled: actionable,
  };
}
