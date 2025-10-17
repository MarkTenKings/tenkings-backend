import path from "node:path";
import { promises as fs } from "node:fs";

const DEFAULT_MODE = "local";
const DEFAULT_PUBLIC_PREFIX = "/uploads/cards";

const rawMode = (process.env.CARD_STORAGE_MODE ?? DEFAULT_MODE).toLowerCase();
const mode = rawMode === "mock" ? "mock" : rawMode;
const publicPrefix = (process.env.CARD_STORAGE_PUBLIC_PREFIX ?? DEFAULT_PUBLIC_PREFIX).replace(/\/$/, "");
const localRoot = process.env.CARD_STORAGE_LOCAL_ROOT ?? path.join(process.cwd(), "public/uploads/cards");

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

export function publicUrlFor(storageKey: string) {
  const cleanedKey = storageKey.replace(/^\/+/, "");
  return `${publicPrefix}/${cleanedKey}`;
}

function sanitizeFileName(input: string) {
  const normalized = input.trim().toLowerCase();
  const base = normalized.replace(/[^a-z0-9_.-]+/g, "-");
  const collapsed = base.replace(/-+/g, "-");
  return collapsed.replace(/^-|-$/g, "") || "card";
}
