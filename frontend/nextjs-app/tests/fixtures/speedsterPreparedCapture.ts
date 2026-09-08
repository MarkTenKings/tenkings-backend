import { preparationManifestReference, type PreparationManifest } from "../../lib/server/speedsterPreparationAuthority";
import { issueSpeedsterColorGeometryReceipt } from "../../lib/server/speedsterColorGeometryAuthority";
import { fixturePreparationColor } from "./speedsterPreparation";
import type { SpeedsterColorGeometryMode } from "../../lib/ai-grader-v2/color-geometry";

export const preparedCaptureReceiptEnv: NodeJS.ProcessEnv = { NODE_ENV: "test", SPEEDSTER_COLOR_GEOMETRY_RECEIPT_HMAC_KEY: "c".repeat(64), SPEEDSTER_COLOR_GEOMETRY_RECEIPT_HMAC_KEY_ID: "capture-fixture" };
export const preparedCaptureIdentity = { playerName: "Synthetic fixture", year: "2021", manufacturer: "Fixture", productSet: "Synthetic", parallel: "Base", insert: null, cardNumber: "1" };
export function preparedCaptureSide(manifest: PreparationManifest, now = Date.now()) {
  const body = manifest.body;
  const centeringQuad = [{ x: .05, y: .05 }, { x: .95, y: .05 }, { x: .95, y: .95 }, { x: .05, y: .95 }];
  const evidence = (mode: SpeedsterColorGeometryMode) => {
    const result = { ...fixturePreparationColor, mode, matColor: body.input.matColor,
      contrastFloorDeltaE: mode === "PHYSICAL_OUTER" ? 18 : 12, minimumSideSupport: mode === "PHYSICAL_OUTER" ? .7 : .55 };
    return { side: manifest.side, mode, sourceImageStorageKey: body.input.source.originalStorageKey, matColor: body.input.matColor,
      result, confirmedQuad: mode === "PHYSICAL_OUTER" ? body.input.physicalQuad : centeringQuad,
      serverReceipt: issueSpeedsterColorGeometryReceipt({ operatorAdminId: manifest.createdByUserId, sessionId: manifest.sessionId, side: manifest.side, mode,
        sourceImageStorageKey: body.input.source.originalStorageKey, sourceImageSha256: body.input.source.sha256, matColor: body.input.matColor,
        physicalQuadSha256: mode === "PHYSICAL_OUTER" ? null : body.input.physicalQuadSha256, result }, { env: preparedCaptureReceiptEnv, now }) };
  };
  return { preparation: preparationManifestReference(manifest), originalStorageKey: body.input.source.originalStorageKey, sourceCorners: body.input.physicalQuad,
    rectifiedStorageKey: body.artifacts.RECTIFIED.storageKey, inspectionStorageKey: body.artifacts.INSPECTION.storageKey,
    inspectionFrame: body.inspectionFrame, transform: body.transform,
    viewStorageKeys: { NORMALIZED: body.artifacts.NORMALIZED.storageKey, MICRO_DEFECT: body.artifacts.MICRO_DEFECT.storageKey, DIRECTIONAL: body.artifacts.DIRECTIONAL.storageKey },
    centeringQuad, centeringBorders: { leftMm: 0, rightMm: 0, topMm: 0, bottomMm: 0 }, colorGeometryEvidence: [evidence("PHYSICAL_OUTER"), evidence("PRINTED_FRAME")] };
}
