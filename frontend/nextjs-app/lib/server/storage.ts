import path from "node:path";
import { promises as fs } from "node:fs";
import { createReadStream } from "node:fs";
import { createHash } from "node:crypto";
import {
  DeleteObjectsCommand,
  GetObjectCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
  ObjectCannedACL,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
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

export interface UploadBufferOptions {
  cacheControl?: string;
}

export interface PresignUploadOptions {
  /** Lowercase or uppercase 64-character SHA-256 hex digest of the exact PUT body. */
  checksumSha256?: string;
}

export type StorageObjectHead = {
  storageKey: string;
  byteSize?: number;
  contentType?: string;
  metadata: Record<string, string>;
  /** Provider-native SHA-256 only; never ETag, object metadata, or a caller-supplied digest. */
  checksumSha256: string | null;
  /** Distinguishes an absent native checksum from a malformed provider response. */
  nativeChecksumPresent?: boolean;
  checksumSource?: "provider_native";
};

export type StorageObjectRead = {
  storageKey: string;
  byteSize?: number;
  body: AsyncIterable<Uint8Array> & { destroy?: () => void };
};

export type StorageObjectIntegrityResult = {
  ok: boolean;
  byteSize?: number;
  contentType?: string;
  checksumSha256: string | null;
  checksumSource: "provider_native" | "server_stream" | null;
  message?: string;
};

export type StorageObjectIntegrityDependencies = {
  headObject?: (storageKey: string) => Promise<StorageObjectHead>;
  openRead?: (storageKey: string) => Promise<StorageObjectRead>;
};

export type StoragePrefixDeleteResult = {
  storagePrefix: string;
  listedObjectCount: number;
  deletedObjectCount: number;
};

const SHA256_HEX_PATTERN = /^[a-f0-9]{64}$/i;
const SHA256_BASE64_PATTERN = /^[A-Za-z0-9+/]{43}=$/;
export const AI_GRADER_STORAGE_MAX_OBJECT_BYTES = 50 * 1024 * 1024;

export function sha256HexToBase64(value: string) {
  const normalized = value.trim();
  if (!SHA256_HEX_PATTERN.test(normalized)) {
    throw new Error("SHA-256 checksum must be a 64-character hex digest.");
  }
  return Buffer.from(normalized, "hex").toString("base64");
}

export function sha256Base64ToHex(value: string | null | undefined) {
  const normalized = String(value ?? "").trim();
  if (!SHA256_BASE64_PATTERN.test(normalized)) return null;
  const decoded = Buffer.from(normalized, "base64");
  if (decoded.byteLength !== 32 || decoded.toString("base64") !== normalized) return null;
  return decoded.toString("hex");
}

function stopStorageRead(body: StorageObjectRead["body"] | null | undefined) {
  try {
    body?.destroy?.();
  } catch {
    // Verification is already stopping. Never replace the bounded integrity error
    // with a provider-specific stream teardown error.
  }
}

async function sha256StorageObjectRead(input: {
  read: StorageObjectRead;
  expectedByteSize: number;
  maxByteSize: number;
}) {
  if (input.read.byteSize !== undefined) {
    if (!Number.isSafeInteger(input.read.byteSize) || input.read.byteSize < 0) {
      stopStorageRead(input.read.body);
      throw new Error("Storage object read returned an invalid byte size.");
    }
    if (input.read.byteSize > input.maxByteSize) {
      stopStorageRead(input.read.body);
      throw new Error("Storage object read exceeded the configured upload-size limit.");
    }
    if (input.read.byteSize !== input.expectedByteSize) {
      stopStorageRead(input.read.body);
      throw new Error("Storage object read byte size did not match the expected byte length.");
    }
  }
  if (!input.read.body || typeof input.read.body[Symbol.asyncIterator] !== "function") {
    stopStorageRead(input.read.body);
    throw new Error("Storage object read did not return a stream.");
  }

  const digest = createHash("sha256");
  let receivedBytes = 0;
  try {
    for await (const rawChunk of input.read.body) {
      if (!(rawChunk instanceof Uint8Array)) {
        throw new Error("invalid storage stream chunk");
      }
      const chunk = Buffer.from(rawChunk.buffer, rawChunk.byteOffset, rawChunk.byteLength);
      receivedBytes += chunk.byteLength;
      if (receivedBytes > input.maxByteSize) {
        stopStorageRead(input.read.body);
        throw new Error("Storage object stream exceeded the configured upload-size limit.");
      }
      if (receivedBytes > input.expectedByteSize) {
        stopStorageRead(input.read.body);
        throw new Error("Storage object stream exceeded the expected byte length.");
      }
      digest.update(chunk);
    }
  } catch (error) {
    stopStorageRead(input.read.body);
    if (
      error instanceof Error &&
      (error.message === "Storage object stream exceeded the configured upload-size limit." ||
        error.message === "Storage object stream exceeded the expected byte length.")
    ) {
      throw error;
    }
    throw new Error("Storage object read failed during SHA-256 verification.");
  }
  if (receivedBytes !== input.expectedByteSize) {
    throw new Error("Storage object stream ended before the expected byte length.");
  }
  return digest.digest("hex");
}

export async function verifyStorageObjectIntegrity(input: {
  storageKey: string;
  expectedByteSize: number;
  expectedChecksumSha256: string;
  maxByteSize?: number;
}, dependencies: StorageObjectIntegrityDependencies = {}): Promise<StorageObjectIntegrityResult> {
  const storageKey = String(input.storageKey ?? "");
  if (!storageKey) throw new Error("Storage object identity is required for integrity verification.");
  const requestedMaxByteSize = input.maxByteSize ?? AI_GRADER_STORAGE_MAX_OBJECT_BYTES;
  if (!Number.isSafeInteger(requestedMaxByteSize) || requestedMaxByteSize < 1) {
    throw new Error("Storage integrity upload-size limit is invalid.");
  }
  const maxByteSize = Math.min(requestedMaxByteSize, AI_GRADER_STORAGE_MAX_OBJECT_BYTES);
  if (!Number.isSafeInteger(input.expectedByteSize) || input.expectedByteSize < 1) {
    throw new Error("Expected storage object byte length is invalid.");
  }
  if (input.expectedByteSize > maxByteSize) {
    throw new Error("Expected storage object byte length exceeds the configured upload-size limit.");
  }
  const expectedChecksum = String(input.expectedChecksumSha256 ?? "").trim().toLowerCase();
  if (!SHA256_HEX_PATTERN.test(expectedChecksum)) {
    throw new Error("Expected SHA-256 checksum is invalid.");
  }

  let head: StorageObjectHead;
  try {
    head = await (dependencies.headObject ?? headStorageObject)(storageKey);
  } catch {
    throw new Error("Storage object metadata read failed during integrity verification.");
  }
  if (head.storageKey !== storageKey) {
    throw new Error("Storage object identity mismatch during integrity verification.");
  }
  const actualByteSize = head.byteSize;
  if (!Number.isSafeInteger(actualByteSize) || (actualByteSize ?? -1) < 0) {
    throw new Error("Storage object metadata did not return a valid byte size.");
  }
  if ((actualByteSize as number) > maxByteSize) {
    throw new Error("Storage object exceeds the configured upload-size limit.");
  }
  if (actualByteSize !== input.expectedByteSize) {
    return {
      ok: false,
      byteSize: actualByteSize,
      contentType: head.contentType,
      checksumSha256: null,
      checksumSource: null,
      message: "Storage byte size did not match the expected byte length.",
    };
  }

  if (head.nativeChecksumPresent === true) {
    const actualNativeChecksum =
      typeof head.checksumSha256 === "string" && SHA256_HEX_PATTERN.test(head.checksumSha256)
        ? head.checksumSha256.toLowerCase()
        : null;
    if (!actualNativeChecksum) {
      throw new Error("Storage provider returned an invalid native SHA-256 checksum.");
    }
    const checksumMatches = actualNativeChecksum === expectedChecksum;
    return {
      ok: checksumMatches,
      byteSize: actualByteSize,
      contentType: head.contentType,
      checksumSha256: actualNativeChecksum,
      checksumSource: head.checksumSource ?? "provider_native",
      message: checksumMatches ? undefined : "Storage-provided SHA-256 checksum mismatch.",
    };
  }

  let read: StorageObjectRead;
  try {
    read = await (dependencies.openRead ?? openStorageObjectRead)(storageKey);
  } catch {
    throw new Error("Storage object read failed during SHA-256 verification.");
  }
  if (read.storageKey !== storageKey) {
    stopStorageRead(read.body);
    throw new Error("Storage object identity mismatch during integrity verification.");
  }
  const streamedChecksum = await sha256StorageObjectRead({
    read,
    expectedByteSize: input.expectedByteSize,
    maxByteSize,
  });
  const checksumMatches = streamedChecksum === expectedChecksum;
  return {
    ok: checksumMatches,
    byteSize: actualByteSize,
    contentType: head.contentType,
    checksumSha256: streamedChecksum,
    checksumSource: "server_stream",
    message: checksumMatches ? undefined : "Server-streamed SHA-256 checksum mismatch.",
  };
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

export function normalizeStorageKeyCandidate(value: string | null | undefined) {
  const withoutLeadingSlash = String(value || "").replace(/^\/+/, "");
  if (!withoutLeadingSlash) return null;
  try {
    return decodeURIComponent(withoutLeadingSlash);
  } catch {
    return withoutLeadingSlash;
  }
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

function controlledStoragePrefix(value: string) {
  const normalized = String(value ?? "").replace(/\\/g, "/").replace(/^\/+/, "");
  if (
    !normalized.endsWith("/") ||
    normalized.includes("..") ||
    !/^[a-zA-Z0-9][a-zA-Z0-9._/-]*\/$/.test(normalized)
  ) {
    throw new Error("Storage deletion prefix is invalid.");
  }
  return normalized;
}

export async function deleteStoragePrefix(storagePrefix: string): Promise<StoragePrefixDeleteResult> {
  const prefix = controlledStoragePrefix(storagePrefix);
  const storageMode = getStorageMode();
  if (storageMode === "s3") {
    const client = getS3Client();
    let listedObjectCount = 0;
    let deletedObjectCount = 0;
    while (true) {
      const listed = await client.send(new ListObjectsV2Command({
        Bucket: s3Bucket,
        Prefix: prefix,
      }));
      const keys = (listed.Contents ?? [])
        .map((entry) => entry.Key)
        .filter((key): key is string => Boolean(key && key.startsWith(prefix)));
      listedObjectCount += keys.length;
      if (!keys.length) break;
      const deleted = await client.send(new DeleteObjectsCommand({
        Bucket: s3Bucket,
        Delete: {
          Objects: keys.map((Key) => ({ Key })),
          Quiet: false,
        },
      }));
      if (deleted.Errors?.length) {
        const error = new Error("Storage prefix deletion stopped after the provider rejected one or more objects.") as Error & {
          partialResult?: StoragePrefixDeleteResult;
        };
        error.partialResult = {
          storagePrefix: prefix,
          listedObjectCount,
          deletedObjectCount: deletedObjectCount + (deleted.Deleted?.length ?? 0),
        };
        throw error;
      }
      deletedObjectCount += deleted.Deleted?.length ?? keys.length;
    }
    return { storagePrefix: prefix, listedObjectCount, deletedObjectCount };
  }

  const root = path.resolve(localRoot);
  const target = path.resolve(root, ...prefix.split("/").filter(Boolean));
  if (target === root || !target.startsWith(`${root}${path.sep}`)) {
    throw new Error("Local storage deletion target is outside the configured storage root.");
  }
  let listedObjectCount = 0;
  const countFiles = async (directory: string): Promise<void> => {
    for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
      const child = path.join(directory, entry.name);
      if (entry.isDirectory()) await countFiles(child);
      else listedObjectCount += 1;
    }
  };
  try {
    await countFiles(target);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return { storagePrefix: prefix, listedObjectCount: 0, deletedObjectCount: 0 };
    }
    throw error;
  }
  await fs.rm(target, { recursive: true, force: true });
  return { storagePrefix: prefix, listedObjectCount, deletedObjectCount: listedObjectCount };
}

export async function writeLocalFile(storageKey: string, data: Buffer) {
  const filePath = getLocalFilePath(storageKey);
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, data);
  return filePath;
}

export async function readStorageBodyBuffer(body: unknown) {
  if (!body) {
    throw new Error("Unable to read S3 object body");
  }
  if (typeof (body as any).transformToByteArray === "function") {
    return Buffer.from(await (body as any).transformToByteArray());
  }
  if (typeof (body as any).on !== "function") {
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
    return readStorageBodyBuffer(response.Body);
  }

  const filePath = getLocalFilePath(storageKey);
  return fs.readFile(filePath);
}

export async function openStorageObjectRead(storageKey: string): Promise<StorageObjectRead> {
  const mode = getStorageMode();
  if (mode === "s3") {
    const response = await getS3Client().send(
      new GetObjectCommand({
        Bucket: s3Bucket,
        Key: storageKey,
      }),
    );
    const body = response.Body as StorageObjectRead["body"] | undefined;
    if (!body || typeof body[Symbol.asyncIterator] !== "function") {
      throw new Error("Storage object read did not return a stream.");
    }
    return {
      storageKey,
      byteSize: response.ContentLength,
      body,
    };
  }

  const filePath = getLocalFilePath(storageKey);
  const stats = await fs.stat(filePath);
  return {
    storageKey,
    byteSize: stats.size,
    body: createReadStream(filePath),
  };
}

export async function readStoragePrefix(storageKey: string, maxBytes = 256 * 1024) {
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 1 || maxBytes > 1024 * 1024) {
    throw new Error("Storage prefix read limit must be between 1 byte and 1 MiB.");
  }
  const mode = getStorageMode();
  if (mode === "s3") {
    const response = await getS3Client().send(
      new GetObjectCommand({
        Bucket: s3Bucket,
        Key: storageKey,
        Range: `bytes=0-${maxBytes - 1}`,
      }),
    );
    const body = response.Body;
    if (!body) throw new Error("Unable to read S3 object prefix.");
    if (typeof (body as any).transformToByteArray === "function") {
      return Buffer.from(await (body as any).transformToByteArray());
    }
    if (typeof (body as any).on !== "function") throw new Error("Unable to read S3 object prefix.");
    const chunks: Buffer[] = [];
    await new Promise<void>((resolve, reject) => {
      (body as any)
        .on("data", (chunk: Buffer) => chunks.push(Buffer.from(chunk)))
        .on("end", resolve)
        .on("error", reject);
    });
    return Buffer.concat(chunks).subarray(0, maxBytes);
  }

  const file = await fs.open(getLocalFilePath(storageKey), "r");
  try {
    const buffer = Buffer.alloc(maxBytes);
    const { bytesRead } = await file.read(buffer, 0, maxBytes, 0);
    return buffer.subarray(0, bytesRead);
  } finally {
    await file.close();
  }
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

export async function presignUploadUrl(storageKey: string, contentType: string, options: PresignUploadOptions = {}) {
  const client = getS3Client();
  const command = new PutObjectCommand({
    Bucket: s3Bucket,
    Key: storageKey,
    ContentType: contentType,
    ACL: s3ObjectAcl,
    ChecksumSHA256: options.checksumSha256 ? sha256HexToBase64(options.checksumSha256) : undefined,
  });
  return getSignedUrl(client as any, command as any, {
    expiresIn: 60 * 10,
    // Keep the provider-native checksum in the signed request headers. DigitalOcean
    // Spaces accepts a query-hoisted checksum but does not persist a checksum that
    // HeadObject can round-trip, so the browser must send this exact signed header.
    unhoistableHeaders: options.checksumSha256
      ? new Set(["x-amz-checksum-sha256"])
      : undefined,
  });
}

export type PrivateDesignReferencePresignDependencies = {
  client?: S3Client;
  bucket?: string;
  sign?: typeof getSignedUrl;
};

export function createPrivateDesignReferenceUploadCommand(input: {
  storageKey: string;
  contentType: "image/png" | "image/jpeg";
  checksumSha256: string;
}, bucket = s3Bucket) {
  if (!bucket) throw new Error("CARD_STORAGE_BUCKET must be configured for private design-reference uploads.");
  const storageKey = normalizeStorageKeyCandidate(input.storageKey);
  if (!storageKey) {
    throw new Error("Private design-reference upload key is required.");
  }
  if (!storageKey.startsWith("ai-grader/design-references/imports/")) {
    throw new Error("Private design-reference upload key is outside its controlled prefix.");
  }
  if (input.contentType !== "image/png" && input.contentType !== "image/jpeg") {
    throw new Error("Private design-reference upload type must be PNG or JPEG.");
  }
  return new PutObjectCommand({
    Bucket: bucket,
    Key: storageKey,
    ContentType: input.contentType,
    ACL: "private",
    ChecksumSHA256: sha256HexToBase64(input.checksumSha256),
  });
}

export async function presignPrivateDesignReferenceUploadUrl(
  input: {
    storageKey: string;
    contentType: "image/png" | "image/jpeg";
    checksumSha256: string;
  },
  dependencies: PrivateDesignReferencePresignDependencies = {},
) {
  const client = dependencies.client ?? getS3Client();
  const command = createPrivateDesignReferenceUploadCommand(input, dependencies.bucket ?? s3Bucket);
  return (dependencies.sign ?? getSignedUrl)(client as any, command as any, {
    expiresIn: 60 * 5,
    unhoistableHeaders: new Set([
      "x-amz-acl",
      "x-amz-checksum-sha256",
    ]),
  });
}

export async function headStorageObject(storageKey: string): Promise<StorageObjectHead> {
  const mode = getStorageMode();
  if (mode !== "s3") {
    const filePath = getLocalFilePath(storageKey);
    const stats = await fs.stat(filePath);
    return {
      storageKey,
      byteSize: stats.size,
      contentType: undefined as string | undefined,
      metadata: {} as Record<string, string>,
      checksumSha256: null,
      nativeChecksumPresent: false,
    };
  }
  const client = getS3Client();
  const response = await client.send(
    new HeadObjectCommand({
      Bucket: s3Bucket,
      Key: storageKey,
      ChecksumMode: "ENABLED",
    })
  );
  const nativeChecksumPresent =
    typeof response.ChecksumSHA256 === "string" && response.ChecksumSHA256.trim().length > 0;
  const checksumSha256 = sha256Base64ToHex(response.ChecksumSHA256);
  return {
    storageKey,
    byteSize: response.ContentLength,
    contentType: response.ContentType,
    metadata: response.Metadata ?? {},
    checksumSha256,
    nativeChecksumPresent,
    ...(checksumSha256 ? { checksumSource: "provider_native" as const } : {}),
  };
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
  contentType: string,
  options: UploadBufferOptions = {}
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
        CacheControl: options.cacheControl,
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

export function sanitizeListImageUrl(input: string | null | undefined) {
  if (typeof input !== "string") {
    return null;
  }
  const trimmed = input.trim();
  if (!trimmed || /^data:/i.test(trimmed)) {
    return null;
  }
  return normalizeStorageUrl(trimmed) ?? trimmed;
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
    const pathname = normalizeStorageKeyCandidate(url.pathname);
    if (!pathname) return null;

    const publicBase = s3PublicBaseUrl ? new URL(s3PublicBaseUrl) : null;
    const publicHost = publicBase ? publicBase.host : null;
    const publicBasePath = publicBase ? publicBase.pathname.replace(/^\/+|\/+$/g, "") : "";
    const endpointHost = s3Endpoint ? s3Endpoint.replace(/^https?:\/\//, "").replace(/\/$/, "") : null;
    const isBucketHost =
      Boolean(s3Bucket) && host.startsWith(`${s3Bucket}.`) && host.includes("digitaloceanspaces.com");
    const isPublicHost = publicHost ? host === publicHost : false;
    const isEndpointHost = endpointHost ? host === endpointHost : false;

    if (isBucketHost || isPublicHost) {
      // Virtual-host style: bucket is in host, path is key.
      // Also handle public base URLs that include a path prefix (e.g. /bucket-name).
      if (publicBasePath) {
        const prefixed = `${publicBasePath}/`;
        if (pathname === publicBasePath) return "";
        if (pathname.startsWith(prefixed)) {
          return pathname.slice(prefixed.length);
        }
      }
      if (s3Bucket) {
        const bucketPrefix = `${s3Bucket}/`;
        if (pathname.startsWith(bucketPrefix)) {
          return pathname.slice(bucketPrefix.length);
        }
      }
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
