import type { NextApiRequest } from "next";
import crypto from "node:crypto";

const HEADER_SECRET = "x-kiosk-secret";
const HEADER_TOKEN = "x-kiosk-token";

export function hashControlToken(token: string): string {
  return crypto.createHash("sha256").update(token).digest("hex");
}

export function generateControlToken(): string {
  return crypto.randomUUID();
}

export function getProvidedSecret(req: NextApiRequest): string | null {
  const headerValue = req.headers[HEADER_SECRET] ?? req.headers["authorization"];
  if (!headerValue) {
    return null;
  }
  if (Array.isArray(headerValue)) {
    return headerValue[0] ?? null;
  }
  const trimmed = headerValue.trim();
  if (trimmed.toLowerCase().startsWith("bearer ")) {
    return trimmed.slice(7).trim();
  }
  return trimmed.length ? trimmed : null;
}

export function ensureKioskSecret(req: NextApiRequest): boolean {
  const expected = process.env.KIOSK_API_SECRET;
  if (!expected) {
    return true;
  }
  const provided = getProvidedSecret(req);
  return provided === expected;
}

export function getControlToken(req: NextApiRequest): string | null {
  const header = req.headers[HEADER_TOKEN];
  if (!header) {
    return null;
  }
  if (Array.isArray(header)) {
    return header[0] ?? null;
  }
  return header.trim() || null;
}

export function hasKioskControl(req: NextApiRequest, controlTokenHash: string | null | undefined): boolean {
  const expected = process.env.KIOSK_API_SECRET;
  if (expected) {
    const provided = getProvidedSecret(req);
    if (provided === expected) {
      return true;
    }
  }

  if (!controlTokenHash) {
    return false;
  }

  const token = getControlToken(req);
  if (!token) {
    return false;
  }

  return hashControlToken(token) === controlTokenHash;
}
