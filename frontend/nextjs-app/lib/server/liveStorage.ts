import { PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";

export type LiveStorageMode = "local" | "s3" | "mock";

const DEFAULT_MODE: LiveStorageMode = "local";
const rawMode = (process.env.LIVE_STORAGE_MODE ?? DEFAULT_MODE).toLowerCase();
const storageMode: LiveStorageMode = rawMode === "s3" ? "s3" : rawMode === "mock" ? "mock" : "local";

const localRoot = process.env.LIVE_STORAGE_LOCAL_ROOT ?? path.join(process.cwd(), "public/uploads/live");
const localPublicPrefix = (process.env.LIVE_STORAGE_PUBLIC_PREFIX ?? "/uploads/live").replace(/\/$/, "");

const s3Bucket = process.env.LIVE_STORAGE_BUCKET ?? "";
const s3Region = process.env.LIVE_STORAGE_REGION ?? "";
const s3Endpoint = process.env.LIVE_STORAGE_ENDPOINT;
const s3PublicBaseUrl = process.env.LIVE_STORAGE_PUBLIC_BASE_URL?.replace(/\/$/, "");
const s3AccessKeyId = process.env.LIVE_STORAGE_ACCESS_KEY_ID;
const s3SecretAccessKey = process.env.LIVE_STORAGE_SECRET_ACCESS_KEY;
const s3ForcePathStyle = String(process.env.LIVE_STORAGE_FORCE_PATH_STYLE ?? "false").toLowerCase() === "true";
const s3ObjectAcl = process.env.LIVE_STORAGE_ACL ?? "public-read";

export const LIVE_MAX_UPLOAD_BYTES = Number(process.env.LIVE_UPLOAD_MAX_BYTES ?? 150 * 1024 * 1024);

let s3Client: S3Client | null = null;

function getS3Client(): S3Client {
  if (storageMode !== "s3") {
    throw new Error("S3 storage client requested while storage mode is not s3");
  }
  if (!s3Bucket) {
    throw new Error("LIVE_STORAGE_BUCKET must be configured for s3 mode");
  }
  if (!s3Client) {
    s3Client = new S3Client({
      region: s3Region || "us-east-1",
      endpoint: s3Endpoint,
      forcePathStyle: s3ForcePathStyle,
      credentials:
        s3AccessKeyId && s3SecretAccessKey
          ? {
              accessKeyId: s3AccessKeyId,
              secretAccessKey: s3SecretAccessKey,
            }
          : undefined,
    });
  }
  return s3Client;
}

function sanitizeFileName(input: string) {
  const normalized = input.trim().toLowerCase();
  const base = normalized.replace(/[^a-z0-9_.-]+/g, "-");
  const collapsed = base.replace(/-+/g, "-");
  return collapsed.replace(/^-|-$/g, "") || "live";
}

async function ensureLocalRoot() {
  if (storageMode !== "local") {
    return;
  }
  await fs.mkdir(localRoot, { recursive: true });
}

function buildStorageKey(userId: string, fileName: string) {
  const safeName = sanitizeFileName(fileName);
  const unique = randomUUID().replace(/-/g, "");
  return [userId, unique, safeName].filter(Boolean).join("/");
}

function buildPublicUrl(storageKey: string) {
  const normalizedKey = storageKey.replace(/\\/g, "/").replace(/^\/+/, "");
  if (storageMode === "s3") {
    if (s3PublicBaseUrl) {
      const base = s3PublicBaseUrl.replace(/\/$/, "");
      return `${base}/${normalizedKey}`;
    }
    if (!s3Bucket) {
      throw new Error("LIVE_STORAGE_BUCKET must be configured for s3 mode");
    }
    const regionSegment = s3Region ? `.${s3Region}` : "";
    return `https://${s3Bucket}.s3${regionSegment}.amazonaws.com/${normalizedKey}`;
  }
  if (storageMode === "local") {
    const base = localPublicPrefix.replace(/\/$/, "");
    return `${base}/${normalizedKey}`;
  }
  return `mock://${normalizedKey}`;
}

export interface StoreLiveAssetOptions {
  userId: string;
  fileName: string;
  buffer: Buffer;
  contentType: string;
}

export async function storeLiveAsset(options: StoreLiveAssetOptions) {
  const { userId, fileName, buffer, contentType } = options;
  if (!buffer.length) {
    throw new Error("Upload payload was empty");
  }

  const storageKey = buildStorageKey(userId, fileName || "live");

  if (storageMode === "local" && process.env.VERCEL) {
    throw new Error(
      "Live video uploads require LIVE_STORAGE_MODE=s3 when deployed on Vercel. Configure S3/Spaces credentials to continue."
    );
  }

  if (storageMode === "mock") {
    return {
      storageKey,
      publicUrl: buildPublicUrl(storageKey),
      contentType,
    };
  }

  if (storageMode === "local") {
    await ensureLocalRoot();
    const filePath = path.join(localRoot, storageKey);
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, buffer);
    return {
      storageKey,
      publicUrl: buildPublicUrl(storageKey),
      contentType,
    };
  }

  const client = getS3Client();
  await client.send(
    new PutObjectCommand({
      Bucket: s3Bucket,
      Key: storageKey,
      Body: buffer,
      ContentType: contentType,
      ACL: s3ObjectAcl,
    })
  );

  return {
    storageKey,
    publicUrl: buildPublicUrl(storageKey),
    contentType,
  };
}

export function getLiveStorageMode(): LiveStorageMode {
  return storageMode;
}
