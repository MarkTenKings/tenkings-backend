import { buildAdminHeaders } from "../adminHeaders";
import type {
  SpeedsterCardSide,
  SpeedsterDefectType,
  SpeedsterMeasuredDefect,
  SpeedsterPoint,
  SpeedsterQuad,
} from "./contracts";
import type { SpeedsterInspectionFrame } from "./inspection-frame";

type ImageAction = "geometry" | "prepare" | "detect" | "measure";
type SpeedsterCornerShape = "ROUNDED_3_18_MM" | "SQUARE";

export type SpeedsterGeometryResponse = {
  width: number;
  height: number;
  corners: SpeedsterQuad | null;
};

export type SpeedsterPrepareResponse = {
  width: number;
  height: number;
  transform: readonly number[];
  borders: SpeedsterQuad;
  detectedBorders: readonly ("top" | "right" | "bottom" | "left")[];
  inspectionFrame: SpeedsterInspectionFrame;
};

type PreparedArtifact = "RECTIFIED" | "INSPECTION" | "NORMALIZED" | "MICRO_DEFECT" | "DIRECTIONAL";
type ArtifactPlan = { storageKey: string; uploadUrl: string; readUrl: string };
export type SpeedsterPreparedOutputPlan = Readonly<Record<PreparedArtifact, ArtifactPlan>>;

async function postImageAction<T>(
  token: string,
  action: ImageAction,
  body: Record<string, unknown>,
): Promise<T> {
  const response = await fetch(`/api/admin/ai-grader-v2/image/${action}`, {
    method: "POST",
    headers: buildAdminHeaders(token, { "Content-Type": "application/json" }),
    body: JSON.stringify(body),
  });
  const payload = (await response.json().catch(() => ({}))) as T & { message?: string; detail?: string };
  if (!response.ok) {
    throw new Error(payload.message ?? payload.detail ?? `Speedster ${action} failed.`);
  }
  return payload;
}

export const speedsterImageService = {
  proposeGeometry(token: string, imageUrl: string) {
    return postImageAction<SpeedsterGeometryResponse>(token, "geometry", { imageUrl });
  },
  prepare(
    token: string,
    imageUrl: string,
    corners: SpeedsterQuad,
    outputPlan: SpeedsterPreparedOutputPlan,
  ) {
    return postImageAction<SpeedsterPrepareResponse>(token, "prepare", {
      imageUrl,
      corners,
      outputUploads: {
        rectified: outputPlan.RECTIFIED.uploadUrl,
        inspection: outputPlan.INSPECTION.uploadUrl,
        normalized: outputPlan.NORMALIZED.uploadUrl,
        microDefect: outputPlan.MICRO_DEFECT.uploadUrl,
        directional: outputPlan.DIRECTIONAL.uploadUrl,
      },
    });
  },
  detect(
    token: string,
    input: {
      side: SpeedsterCardSide;
      cornerShape: SpeedsterCornerShape;
      views: readonly { id: string; imageUrl: string }[];
    },
  ) {
    return postImageAction<{
      detectorVersion: string;
      defects: SpeedsterMeasuredDefect[];
    }>(token, "detect", input);
  },
  measure(
    token: string,
    input: {
      side: SpeedsterCardSide;
      cornerShape: SpeedsterCornerShape;
      marks: readonly {
        id: string;
        defectType: SpeedsterDefectType;
        canonicalContour: readonly SpeedsterPoint[];
        sourceViewId: string;
      }[];
    },
  ) {
    return postImageAction<{ defects: SpeedsterMeasuredDefect[] }>(token, "measure", input);
  },
};

export async function uploadSpeedsterOriginal(input: {
  token: string;
  sessionId: string;
  side: SpeedsterCardSide;
  file: File;
}): Promise<{ storageKey: string; readUrl: string }> {
  const planResponse = await fetch("/api/admin/ai-grader-v2/upload-plan", {
    method: "POST",
    headers: buildAdminHeaders(input.token, { "Content-Type": "application/json" }),
    body: JSON.stringify({
      sessionId: input.sessionId,
      side: input.side,
      kind: "ORIGINAL",
      contentType: input.file.type,
    }),
  });
  const plan = (await planResponse.json().catch(() => ({}))) as {
    storageKey?: string;
    uploadUrl?: string;
    readUrl?: string;
    message?: string;
  };
  if (!planResponse.ok || !plan.storageKey || !plan.uploadUrl || !plan.readUrl) {
    throw new Error(plan.message ?? "Speedster upload could not be prepared.");
  }

  const uploadResponse = await fetch(plan.uploadUrl, {
    method: "PUT",
    mode: "cors",
    credentials: "omit",
    headers: { "Content-Type": input.file.type },
    body: input.file,
  });
  if (!uploadResponse.ok) throw new Error(`Speedster upload failed (HTTP ${uploadResponse.status}).`);
  return { storageKey: plan.storageKey, readUrl: plan.readUrl };
}

export async function planSpeedsterPreparedOutputs(input: {
  token: string;
  sessionId: string;
  side: SpeedsterCardSide;
}): Promise<SpeedsterPreparedOutputPlan> {
  const response = await fetch("/api/admin/ai-grader-v2/upload-plan", {
    method: "POST",
    headers: buildAdminHeaders(input.token, { "Content-Type": "application/json" }),
    body: JSON.stringify({ sessionId: input.sessionId, side: input.side, kind: "PREPARED" }),
  });
  const payload = (await response.json().catch(() => ({}))) as {
    outputs?: SpeedsterPreparedOutputPlan;
    message?: string;
  };
  if (!response.ok || !payload.outputs) {
    throw new Error(payload.message ?? "Speedster output storage could not be prepared.");
  }
  return payload.outputs;
}
