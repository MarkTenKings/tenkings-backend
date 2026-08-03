import type { SpeedsterPoint } from "./contracts";

export type SpeedsterInspectionFrame = {
  width: number;
  height: number;
  cardBounds: { x: number; y: number; width: number; height: number };
};

export type SpeedsterNormalizedBox = { x: number; y: number; width: number; height: number };

export const SPEEDSTER_CANONICAL_FRAME: SpeedsterInspectionFrame = {
  width: 1270,
  height: 1778,
  cardBounds: { x: 0, y: 0, width: 1270, height: 1778 },
};

const finite = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);

export function parseSpeedsterInspectionFrame(value: unknown): SpeedsterInspectionFrame | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  const bounds = row.cardBounds;
  if (!bounds || typeof bounds !== "object" || Array.isArray(bounds)) return null;
  const box = bounds as Record<string, unknown>;
  if (![row.width, row.height, box.x, box.y, box.width, box.height].every(finite)) return null;
  const frame = {
    width: row.width as number,
    height: row.height as number,
    cardBounds: {
      x: box.x as number,
      y: box.y as number,
      width: box.width as number,
      height: box.height as number,
    },
  };
  const { cardBounds } = frame;
  return frame.width >= 2 && frame.height >= 2 &&
    cardBounds.width >= 2 && cardBounds.height >= 2 &&
    cardBounds.x >= 0 && cardBounds.y >= 0 &&
    cardBounds.x + cardBounds.width <= frame.width &&
    cardBounds.y + cardBounds.height <= frame.height
    ? frame
    : null;
}

function normalizedCardBounds(frame: SpeedsterInspectionFrame) {
  return {
    left: frame.cardBounds.x / (frame.width - 1),
    top: frame.cardBounds.y / (frame.height - 1),
    right: (frame.cardBounds.x + frame.cardBounds.width - 1) / (frame.width - 1),
    bottom: (frame.cardBounds.y + frame.cardBounds.height - 1) / (frame.height - 1),
  };
}

export function canonicalPointToInspection(
  point: SpeedsterPoint,
  frame: SpeedsterInspectionFrame,
): SpeedsterPoint {
  const card = normalizedCardBounds(frame);
  return {
    x: card.left + point.x * (card.right - card.left),
    y: card.top + point.y * (card.bottom - card.top),
  };
}

export function canonicalContourToInspection(
  contour: readonly SpeedsterPoint[],
  frame: SpeedsterInspectionFrame,
) {
  return contour.map((point) => canonicalPointToInspection(point, frame));
}

export function inspectionBoxToCanonical(
  box: SpeedsterNormalizedBox,
  frame: SpeedsterInspectionFrame,
): SpeedsterNormalizedBox | null {
  const card = normalizedCardBounds(frame);
  const left = Math.max(box.x, card.left);
  const top = Math.max(box.y, card.top);
  const right = Math.min(box.x + box.width, card.right);
  const bottom = Math.min(box.y + box.height, card.bottom);
  if (right <= left || bottom <= top) return null;
  const cardWidth = card.right - card.left;
  const cardHeight = card.bottom - card.top;
  return {
    x: (left - card.left) / cardWidth,
    y: (top - card.top) / cardHeight,
    width: (right - left) / cardWidth,
    height: (bottom - top) / cardHeight,
  };
}
