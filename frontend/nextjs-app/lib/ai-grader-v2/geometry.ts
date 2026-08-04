import type {
  SpeedsterCardProfile,
  SpeedsterConditionZone,
  SpeedsterPoint,
  SpeedsterQuad,
} from "./contracts";

export const SPEEDSTER_CARD_WIDTH_MM = 63.5;
export const SPEEDSTER_CARD_HEIGHT_MM = 88.9;
export const SPEEDSTER_CORNER_SIZE_MM = 5;
export const SPEEDSTER_EDGE_DEPTH_MM = 2;

export type SpeedsterCardDimensions = {
  widthMm: number;
  heightMm: number;
};

export type SpeedsterRect = {
  xMm: number;
  yMm: number;
  widthMm: number;
  heightMm: number;
};

export type SpeedsterCornerName =
  | "TOP_LEFT"
  | "TOP_RIGHT"
  | "BOTTOM_RIGHT"
  | "BOTTOM_LEFT";

export type SpeedsterCornerZone = SpeedsterRect & {
  corner: SpeedsterCornerName;
};

const STANDARD_CARD_DIMENSIONS: SpeedsterCardDimensions = Object.freeze({
  widthMm: SPEEDSTER_CARD_WIDTH_MM,
  heightMm: SPEEDSTER_CARD_HEIGHT_MM,
});

export const SPEEDSTER_CARD_DIMENSIONS: Readonly<
  Record<SpeedsterCardProfile, SpeedsterCardDimensions>
> = Object.freeze({
  POKEMON: STANDARD_CARD_DIMENSIONS,
  SPORTS: STANDARD_CARD_DIMENSIONS,
});

export function getSpeedsterCardDimensions(
  profile: SpeedsterCardProfile,
): SpeedsterCardDimensions {
  return SPEEDSTER_CARD_DIMENSIONS[profile];
}

function requireFinitePoint(point: SpeedsterPoint): void {
  if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) {
    throw new TypeError("Speedster point coordinates must be finite numbers");
  }
}

function clampUnitCoordinate(value: number): number {
  return Math.min(1, Math.max(0, value));
}

export function sanitizeSpeedsterUnitQuad(value: unknown): SpeedsterQuad | null {
  if (!Array.isArray(value) || value.length !== 4) return null;

  const points = value.map((point): SpeedsterPoint | null => {
    if (!point || typeof point !== "object" || Array.isArray(point)) return null;
    const candidate = point as Record<string, unknown>;
    if (
      typeof candidate.x !== "number"
      || typeof candidate.y !== "number"
      || !Number.isFinite(candidate.x)
      || !Number.isFinite(candidate.y)
    ) {
      return null;
    }
    return {
      x: clampUnitCoordinate(candidate.x),
      y: clampUnitCoordinate(candidate.y),
    };
  });
  const [topLeft, topRight, bottomRight, bottomLeft] = points;
  if (!topLeft || !topRight || !bottomRight || !bottomLeft) return null;
  return [topLeft, topRight, bottomRight, bottomLeft];
}

function requirePositiveDisplaySize(widthPx: number, heightPx: number): void {
  if (!Number.isFinite(widthPx) || !Number.isFinite(heightPx) || widthPx <= 0 || heightPx <= 0) {
    throw new RangeError("Display dimensions must be positive finite numbers");
  }
}

export function isCanonicalPoint(
  point: SpeedsterPoint,
  profile: SpeedsterCardProfile,
): boolean {
  const { widthMm, heightMm } = getSpeedsterCardDimensions(profile);
  return (
    Number.isFinite(point.x) &&
    Number.isFinite(point.y) &&
    point.x >= 0 &&
    point.x <= widthMm &&
    point.y >= 0 &&
    point.y <= heightMm
  );
}

export function clampCanonicalPoint(
  point: SpeedsterPoint,
  profile: SpeedsterCardProfile,
): SpeedsterPoint {
  requireFinitePoint(point);
  const { widthMm, heightMm } = getSpeedsterCardDimensions(profile);
  return {
    x: Math.min(widthMm, Math.max(0, point.x)),
    y: Math.min(heightMm, Math.max(0, point.y)),
  };
}

export function canonicalPointToUnitPoint(
  point: SpeedsterPoint,
  profile: SpeedsterCardProfile,
): SpeedsterPoint {
  if (!isCanonicalPoint(point, profile)) {
    throw new RangeError("Point is outside the canonical card grid");
  }
  const { widthMm, heightMm } = getSpeedsterCardDimensions(profile);
  return { x: point.x / widthMm, y: point.y / heightMm };
}

export function unitPointToCanonicalPoint(
  point: SpeedsterPoint,
  profile: SpeedsterCardProfile,
): SpeedsterPoint {
  requireFinitePoint(point);
  const { widthMm, heightMm } = getSpeedsterCardDimensions(profile);
  return clampCanonicalPoint(
    { x: point.x * widthMm, y: point.y * heightMm },
    profile,
  );
}

export function canonicalPointToDisplayPoint(
  point: SpeedsterPoint,
  profile: SpeedsterCardProfile,
  displayWidthPx: number,
  displayHeightPx: number,
): SpeedsterPoint {
  requirePositiveDisplaySize(displayWidthPx, displayHeightPx);
  const unit = canonicalPointToUnitPoint(point, profile);
  return { x: unit.x * displayWidthPx, y: unit.y * displayHeightPx };
}

export function displayPointToCanonicalPoint(
  point: SpeedsterPoint,
  profile: SpeedsterCardProfile,
  displayWidthPx: number,
  displayHeightPx: number,
): SpeedsterPoint {
  requireFinitePoint(point);
  requirePositiveDisplaySize(displayWidthPx, displayHeightPx);
  return unitPointToCanonicalPoint(
    { x: point.x / displayWidthPx, y: point.y / displayHeightPx },
    profile,
  );
}

export function getCornerZones(
  profile: SpeedsterCardProfile,
): readonly SpeedsterCornerZone[] {
  const { widthMm, heightMm } = getSpeedsterCardDimensions(profile);
  const size = SPEEDSTER_CORNER_SIZE_MM;
  return [
    { corner: "TOP_LEFT", xMm: 0, yMm: 0, widthMm: size, heightMm: size },
    {
      corner: "TOP_RIGHT",
      xMm: widthMm - size,
      yMm: 0,
      widthMm: size,
      heightMm: size,
    },
    {
      corner: "BOTTOM_RIGHT",
      xMm: widthMm - size,
      yMm: heightMm - size,
      widthMm: size,
      heightMm: size,
    },
    {
      corner: "BOTTOM_LEFT",
      xMm: 0,
      yMm: heightMm - size,
      widthMm: size,
      heightMm: size,
    },
  ];
}

export function getEdgeZones(
  profile: SpeedsterCardProfile,
): readonly SpeedsterRect[] {
  const { widthMm, heightMm } = getSpeedsterCardDimensions(profile);
  const corner = SPEEDSTER_CORNER_SIZE_MM;
  const depth = SPEEDSTER_EDGE_DEPTH_MM;
  return [
    {
      xMm: corner,
      yMm: 0,
      widthMm: widthMm - corner * 2,
      heightMm: depth,
    },
    {
      xMm: widthMm - depth,
      yMm: corner,
      widthMm: depth,
      heightMm: heightMm - corner * 2,
    },
    {
      xMm: corner,
      yMm: heightMm - depth,
      widthMm: widthMm - corner * 2,
      heightMm: depth,
    },
    {
      xMm: 0,
      yMm: corner,
      widthMm: depth,
      heightMm: heightMm - corner * 2,
    },
  ];
}

export function classifyCanonicalPoint(
  point: SpeedsterPoint,
  profile: SpeedsterCardProfile,
): SpeedsterConditionZone {
  if (!isCanonicalPoint(point, profile)) {
    throw new RangeError("Point is outside the canonical card grid");
  }

  const { widthMm, heightMm } = getSpeedsterCardDimensions(profile);
  const corner = SPEEDSTER_CORNER_SIZE_MM;
  const inHorizontalCorner = point.x <= corner || point.x >= widthMm - corner;
  const inVerticalCorner = point.y <= corner || point.y >= heightMm - corner;
  if (inHorizontalCorner && inVerticalCorner) {
    return "CORNERS";
  }

  const edge = SPEEDSTER_EDGE_DEPTH_MM;
  if (point.x <= edge || point.x >= widthMm - edge || point.y <= edge || point.y >= heightMm - edge) {
    return "EDGES";
  }

  return "SURFACE";
}
