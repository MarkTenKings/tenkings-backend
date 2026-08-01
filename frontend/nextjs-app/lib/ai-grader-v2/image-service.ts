import { buildAdminHeaders } from "../adminHeaders";
import type { SpeedsterCardSide, SpeedsterPoint, SpeedsterQuad } from "./contracts";

type ImageAction = "geometry" | "prepare";

export type SpeedsterGeometryResponse = {
  width: number;
  height: number;
  corners: SpeedsterQuad | null;
};

export type SpeedsterPrepareResponse = {
  rectified: string;
  width: number;
  height: number;
  transform: readonly number[];
  borders: SpeedsterQuad;
  views: {
    normalized: string;
    microDefect: string;
    directional: string;
  };
};

async function postImageAction<T>(
  token: string,
  action: ImageAction,
  body: { imageUrl: string; corners?: readonly SpeedsterPoint[] },
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
  prepare(token: string, imageUrl: string, corners: SpeedsterQuad) {
    return postImageAction<SpeedsterPrepareResponse>(token, "prepare", { imageUrl, corners });
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

export function webpDataUrl(imageBase64: string): string {
  return `data:image/webp;base64,${imageBase64}`;
}
