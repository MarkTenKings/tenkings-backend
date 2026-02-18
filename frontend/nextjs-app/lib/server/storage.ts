import path from "node:path";
import { promises as fs } from "node:fs";
import { GetObjectCommand, ObjectCannedACL, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

const DEFAULT_MODE = "local";
const DEFAULT_PUBLIC_PREFIX = "/uploads/cards";

const rawMode = (process.env.CARD_STORAGE_MODE ?? DEFAULT_MODE).toLowerCase();
const mode = rawMode === "mock" ? "mock" : rawMode;
const publicPrefix = (process.env.CARD_STORAGE_PUBLIC_PREFIX ?? DEFAULT_PUBLIC_PREFIX).replace(/\/$/, "");
const localRoot = process.env.CARD_STORAGE_LOCAL_ROOT ?? path.join(process.cwd(), "public/uploads/cards");
const s3Bucket = process.env.CARD_STORAGE_BUCKET ?? "";
const s3Region = process.env.CARD_STORAGE_REGION ?? "";
const s3Endpoint = process.env.CARD_STORAGE_ENDPOINT;
const s3PublicBaseUrl = process.env.CARD_STORAGE_PUBLIC_BASE_URL?.replace(/\/$/, "");
const s3AccessKeyId = process.env.CARD_STORAGE_ACCESS_KEY_ID;
const s3SecretAccessKey = process.env.CARD_STORAGE_SECRET_ACCESS_KEY;
const s3ForcePathStyle = String(process.env.CARD_STORAGE_FORCE_PATH_STYLE ?? "false").toLowerCase() === "true";
const s3ObjectAclEnv = process.env.CARD_STORAGE_ACL;
const resolvedAcl = s3ObjectAclEnv ? s3ObjectAclEnv.toLowerCase() : "public-read";
const allowedAcls: ObjectCannedACL[] = [
  "private",
  "public-read",
  "public-read-write",
  "authenticated-read",
  "aws-exec-read",
  "bucket-owner-read",
  "bucket-owner-full-control",
];
const s3ObjectAcl: ObjectCannedACL = allowedAcls.includes(resolvedAcl as ObjectCannedACL)
  ? (resolvedAcl as ObjectCannedACL)
  : "public-read";

let s3Client: S3Client | null = null;

export type StorageMode = "local" | "s3" | "mock";

export interface StoragePlan {
  mode: StorageMode;
  assetId: string;
  storageKey: string;
  uploadUrl: string;
  fields: Record<string, string>;
  publicUrl: string;
}

export function getStorageMode(): StorageMode {
  if (mode === "mock") {
    return "mock";
  }
  return mode === "s3" ? "s3" : "local";
}

export function getS3ObjectAcl(): string | null {
  return getStorageMode() === "s3" ? s3ObjectAcl : null;
}

function getS3Client(): S3Client {
  if (getStorageMode() !== "s3") {
    throw new Error("S3 storage client requested while storage mode is not s3");
  }
  if (!s3Bucket) {
    throw new Error("CARD_STORAGE_BUCKET must be configured for s3 mode");
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

export function getLocalRoot() {
  return localRoot;
}

export function getPublicPrefix() {
  return publicPrefix;
}

export function buildStorageKey(userId: string, assetId: string, fileName: string) {
  const base = sanitizeFileName(fileName);
  const safeAsset = assetId.replace(/[^a-zA-Z0-9_-]/g, "");
  const segments = [userId, safeAsset, base].filter(Boolean);
  return segments.join("/");
}

export async function ensureLocalRoot() {
  if (getStorageMode() !== "local") {
    return;
  }
  await fs.mkdir(localRoot, { recursive: true });
}

export function getLocalFilePath(storageKey: string) {
  const normalized = storageKey.replace(/\\/g, "/");
  return path.join(localRoot, normalized);
}

export async function writeLocalFile(storageKey: string, data: Buffer) {
  const filePath = getLocalFilePath(storageKey);
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, data);
  return filePath;
}

export async function readStorageBuffer(storageKey: string) {
  const mode = getStorageMode();
  if (mode === "s3") {
    const client = getS3Client();
    const response = await client.send(
      new GetObjectCommand({
        Bucket: s3Bucket,
        Key: storageKey,
      })
    );
    const body = response.Body;
    if (!body || typeof (body as any).on !== "function") {
      throw new Error("Unable to read S3 object body");
    }
    const chunks: Buffer[] = [];
    await new Promise<void>((resolve, reject) => {
      (body as any)
        .on("data", (chunk: Buffer) => chunks.push(Buffer.from(chunk)))
        .on("end", () => resolve())
        .on("error", (err: Error) => reject(err));
    });
    return Buffer.concat(chunks);
  }

  const filePath = getLocalFilePath(storageKey);
  return fs.readFile(filePath);
}

export function publicUrlFor(storageKey: string) {
  const cleanedKey = storageKey.replace(/^\/+/, "");
  if (getStorageMode() === "s3") {
    if (s3PublicBaseUrl) {
      return `${s3PublicBaseUrl}/${cleanedKey}`;
    }
    if (!s3Bucket) {
      throw new Error("CARD_STORAGE_BUCKET must be configured for s3 mode");
    }
    if (s3Endpoint) {
      const endpointHost = s3Endpoint.replace(/^https?:\/\//, "").replace(/\/$/, "");
      return `https://${s3Bucket}.${endpointHost}/${cleanedKey}`;
    }
    const regionSegment = s3Region ? `.${s3Region}` : "";
    return `https://${s3Bucket}.s3${regionSegment}.amazonaws.com/${cleanedKey}`;
  }
  return `${publicPrefix}/${cleanedKey}`;
}

export async function presignUploadUrl(storageKey: string, contentType: string) {
  const client = getS3Client();
  const command = new PutObjectCommand({
    Bucket: s3Bucket,
    Key: storageKey,
    ContentType: contentType,
    ACL: s3ObjectAcl,
  });
  return getSignedUrl(client as any, command as any, { expiresIn: 60 * 10 });
}

export async function presignReadUrl(storageKey: string, expiresInSeconds = 60 * 10) {
  const client = getS3Client();
  const command = new GetObjectCommand({
    Bucket: s3Bucket,
    Key: storageKey,
  });
  return getSignedUrl(client as any, command as any, { expiresIn: expiresInSeconds });
}

export async function uploadBuffer(
  storageKey: string,
  buffer: Buffer,
  contentType: string
) {
  const mode = getStorageMode();
  if (mode === "s3") {
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
    return publicUrlFor(storageKey);
  }

  await writeLocalFile(storageKey, buffer);
  return publicUrlFor(storageKey);
}

export function buildThumbnailKey(storageKey: string) {
  const normalized = storageKey.replace(/\\/g, "/");
  const extIndex = normalized.lastIndexOf(".");
  const base = extIndex > -1 ? normalized.slice(0, extIndex) : normalized;
  return `${base}-thumb.png`;
}

export function normalizeStorageUrl(input: string | null | undefined) {
  if (!input) return input ?? null;
  if (!/^https?:\/\//i.test(input)) {
    return input;
  }
  try {
    const url = new URL(input);
    const host = url.host;
    const publicHost = s3PublicBaseUrl ? new URL(s3PublicBaseUrl).host : null;
    const matchesPublicHost = publicHost ? host === publicHost : false;
    const matchesBucketHost =
      s3Bucket && host.startsWith(`${s3Bucket}.`) && host.includes("digitaloceanspaces.com");
    const matchesEndpointHost = s3Endpoint
      ? host === s3Endpoint.replace(/^https?:\/\//, "").replace(/\/$/, "")
      : false;

    if (!matchesPublicHost && !matchesBucketHost && !matchesEndpointHost) {
      return input;
    }

    return url.toString();
  } catch {
    return input;
  }
}

export function isManagedStorageUrl(input: string | null | undefined) {
  if (!input || !/^https?:\/\//i.test(input)) return false;
  try {
    const url = new URL(input);
    const host = url.host;
    const publicHost = s3PublicBaseUrl ? new URL(s3PublicBaseUrl).host : null;
    const matchesPublicHost = publicHost ? host === publicHost : false;
    const matchesBucketHost =
      s3Bucket && host.startsWith(`${s3Bucket}.`) && host.includes("digitaloceanspaces.com");
    const matchesEndpointHost = s3Endpoint
      ? host === s3Endpoint.replace(/^https?:\/\//, "").replace(/\/$/, "")
      : false;
    return Boolean(matchesPublicHost || matchesBucketHost || matchesEndpointHost);
  } catch {
    return false;
  }
}

export function managedStorageKeyFromUrl(input: string | null | undefined) {
  if (!input || !/^https?:\/\//i.test(input)) return null;
  try {
    const url = new URL(input);
    const host = url.host;
    const pathname = url.pathname.replace(/^\/+/, "");
    if (!pathname) return null;

    const publicHost = s3PublicBaseUrl ? new URL(s3PublicBaseUrl).host : null;
    const endpointHost = s3Endpoint ? s3Endpoint.replace(/^https?:\/\//, "").replace(/\/$/, "") : null;
    const isBucketHost =
      Boolean(s3Bucket) && host.startsWith(`${s3Bucket}.`) && host.includes("digitaloceanspaces.com");
    const isPublicHost = publicHost ? host === publicHost : false;
    const isEndpointHost = endpointHost ? host === endpointHost : false;

    if (isBucketHost || isPublicHost) {
      // Virtual-host style: bucket is in host, path is key.
      return pathname;
    }

    if (isEndpointHost && s3Bucket) {
      // Path-style: first segment may be bucket.
      const bucketPrefix = `${s3Bucket}/`;
      if (pathname.startsWith(bucketPrefix)) {
        return pathname.slice(bucketPrefix.length);
      }
      return pathname;
    }

    return null;
  } catch {
    return null;
  }
}

function sanitizeFileName(input: string) {
  const normalized = input.trim().toLowerCase();
  const base = normalized.replace(/[^a-z0-9_.-]+/g, "-");
  const collapsed = base.replace(/-+/g, "-");
  return collapsed.replace(/^-|-$/g, "") || "card";
}
