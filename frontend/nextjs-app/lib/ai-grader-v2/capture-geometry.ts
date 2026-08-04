import type { SpeedsterQuad } from "./contracts";
import type { SpeedsterGeometryResponse } from "./image-service";
import { sanitizeSpeedsterUnitQuad } from "./geometry";

type SpeedsterGeometryStartSideInput = {
  originalStorageKey: string;
  sourceUrl: string;
  geometry: Omit<SpeedsterGeometryResponse, "corners"> & { corners: unknown };
};

type SpeedsterGeometryStartSide = {
  originalStorageKey: string;
  sourceUrl: string;
  corners: SpeedsterQuad;
  automaticGeometry: true;
};

export type SpeedsterGeometryStart = {
  front: SpeedsterGeometryStartSide;
  back: SpeedsterGeometryStartSide;
  stage: "FRONT_GEOMETRY";
  message: string;
};

function requireGeometryQuad(side: "front" | "back", value: unknown): SpeedsterQuad {
  const corners = sanitizeSpeedsterUnitQuad(value);
  if (!corners) {
    throw new Error(
      `Speedster did not return valid ${side} card geometry. Both photos are intact; try Set geometry again.`,
    );
  }
  return corners;
}

export function buildSpeedsterGeometryStart(input: {
  front: SpeedsterGeometryStartSideInput;
  back: SpeedsterGeometryStartSideInput;
}): SpeedsterGeometryStart {
  const frontCorners = requireGeometryQuad("front", input.front.geometry.corners);
  const backCorners = requireGeometryQuad("back", input.back.geometry.corners);
  return {
    front: {
      originalStorageKey: input.front.originalStorageKey,
      sourceUrl: input.front.sourceUrl,
      corners: frontCorners,
      automaticGeometry: true,
    },
    back: {
      originalStorageKey: input.back.originalStorageKey,
      sourceUrl: input.back.sourceUrl,
      corners: backCorners,
      automaticGeometry: true,
    },
    stage: "FRONT_GEOMETRY",
    message: "Both physical cards found. Move only points that need correction.",
  };
}
