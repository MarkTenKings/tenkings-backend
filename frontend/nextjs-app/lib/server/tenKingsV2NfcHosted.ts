import {
  createHash,
  createPrivateKey,
  createPublicKey,
  type KeyObject,
} from "node:crypto";
import {
  markNfcVerified,
  parseAiGraderNfcWorkstationPublicKeys,
  prisma,
} from "@tenkings/database";
import type { Prisma } from "@prisma/client";
import {
  issueTenKingsV2NfcJob,
  tenKingsV2NfcJobEnvelopeSha256,
  tenKingsV2NfcKeyId,
  TenKingsV2NfcProtocolError,
  verifyTenKingsV2NfcCompletion,
  type TenKingsV2NfcSignedJob,
  type TenKingsV2NfcSignedResult,
  type TenKingsV2NfcTrustedKeys,
} from "./tenKingsV2NfcProtocol";

export const TEN_KINGS_V2_NFC_PROGRAMMING_ENABLED_ENV = "TEN_KINGS_V2_NFC_PROGRAMMING_ENABLED";
export const TEN_KINGS_V2_NFC_SIGNING_PRIVATE_KEY_ENV = "TEN_KINGS_V2_NFC_JOB_SIGNING_PRIVATE_KEY_PKCS8_BASE64";
export const TEN_KINGS_V2_NFC_PRIOR_TRUST_ENV = "TEN_KINGS_V2_NFC_JOB_PRIOR_PUBLIC_KEYS_JSON";
export const TEN_KINGS_V2_NFC_WORKSTATION_KEYS_ENV = "AI_GRADER_NFC_WORKSTATION_PUBLIC_KEYS_JSON";
export const TEN_KINGS_V2_NFC_HELPER_VERSION = "tenkings-ai-grader-nfc-helper-v4";
export const TEN_KINGS_V2_NFC_HELPER_PROTOCOL = "tenkings-ai-grader-nfc-loopback-v2";
export const TEN_KINGS_V2_NFC_HELPER_CAPABILITY = "ten-kings-v2-f8215-static-url-v1";

const PRIVATE_KEY_MAX_BYTES = 512;
const PRIOR_TRUST_MAX_BYTES = 4096;
const MAX_PRIOR_KEYS = 1;
const STANDARD_BASE64 = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;
const SHA256 = /^[a-f0-9]{64}$/;
const SAFE_QUERY = /^[^\u0000-\u001f\u007f]{1,160}$/;

type EnvLike = Record<string, string | undefined>;

export class TenKingsV2NfcHostedError extends Error {
  constructor(
    public readonly code: string,
    public readonly statusCode: number,
    message: string,
  ) {
    super(message);
    this.name = "TenKingsV2NfcHostedError";
  }
}

const unavailable = (code: string, message: string): never => {
  throw new TenKingsV2NfcHostedError(code, 503, message);
};

const canonicalStandardBase64 = (value: unknown, minimum: number, maximum: number) => {
  if (typeof value !== "string" || !STANDARD_BASE64.test(value)) {
    return unavailable("TEN_KINGS_V2_NFC_CONFIGURATION_INVALID", "NFC V2 trust is not configured.");
  }
  const bytes = Buffer.from(value, "base64");
  if (bytes.length < minimum || bytes.length > maximum || bytes.toString("base64") !== value) {
    return unavailable("TEN_KINGS_V2_NFC_CONFIGURATION_INVALID", "NFC V2 trust is not configured.");
  }
  return bytes;
};

const requireP256PublicKey = (der: Buffer) => {
  try {
    const key = createPublicKey({ key: der, type: "spki", format: "der" });
    const exported = Buffer.from(key.export({ type: "spki", format: "der" }));
    if (
      key.asymmetricKeyType !== "ec" ||
      key.asymmetricKeyDetails?.namedCurve !== "prime256v1" ||
      !exported.equals(der)
    ) {
      throw new Error("invalid key");
    }
    return key;
  } catch {
    return unavailable("TEN_KINGS_V2_NFC_CONFIGURATION_INVALID", "NFC V2 trust is not configured.");
  }
};

const parseCurrentSigner = (raw: unknown) => {
  const bytes = canonicalStandardBase64(raw, 96, PRIVATE_KEY_MAX_BYTES);
  try {
    const privateKey = createPrivateKey({ key: bytes, type: "pkcs8", format: "der" });
    if (
      privateKey.asymmetricKeyType !== "ec" ||
      privateKey.asymmetricKeyDetails?.namedCurve !== "prime256v1"
    ) {
      throw new Error("invalid signer");
    }
    const publicKey = createPublicKey(privateKey);
    return { privateKey, publicKey, keyId: tenKingsV2NfcKeyId(publicKey) };
  } catch {
    return unavailable("TEN_KINGS_V2_NFC_CONFIGURATION_INVALID", "NFC V2 signing is not configured.");
  } finally {
    bytes.fill(0);
  }
};

const parsePriorTrust = (raw: unknown): Record<string, KeyObject> => {
  const source = typeof raw === "string" ? raw : "";
  if (!source.trim()) return {};
  if (Buffer.byteLength(source, "utf8") > PRIOR_TRUST_MAX_BYTES) {
    return unavailable("TEN_KINGS_V2_NFC_CONFIGURATION_INVALID", "NFC V2 prior trust is invalid.");
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(source);
  } catch {
    return unavailable("TEN_KINGS_V2_NFC_CONFIGURATION_INVALID", "NFC V2 prior trust is invalid.");
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return unavailable("TEN_KINGS_V2_NFC_CONFIGURATION_INVALID", "NFC V2 prior trust is invalid.");
  }
  const entries = Object.entries(parsed as Record<string, unknown>);
  if (entries.length > MAX_PRIOR_KEYS) {
    return unavailable("TEN_KINGS_V2_NFC_CONFIGURATION_INVALID", "NFC V2 prior trust is invalid.");
  }
  const trust: Record<string, KeyObject> = {};
  for (const [keyId, unknownEntry] of entries) {
    if (!SHA256.test(keyId) || !unknownEntry || typeof unknownEntry !== "object" || Array.isArray(unknownEntry)) {
      return unavailable("TEN_KINGS_V2_NFC_CONFIGURATION_INVALID", "NFC V2 prior trust is invalid.");
    }
    const entry = unknownEntry as Record<string, unknown>;
    if (Object.keys(entry).sort().join("|") !== "algorithm|publicSpkiDerBase64") {
      return unavailable("TEN_KINGS_V2_NFC_CONFIGURATION_INVALID", "NFC V2 prior trust is invalid.");
    }
    if (entry.algorithm !== "ecdsa-p256-sha256-p1363") {
      return unavailable("TEN_KINGS_V2_NFC_CONFIGURATION_INVALID", "NFC V2 prior trust is invalid.");
    }
    const der = canonicalStandardBase64(entry.publicSpkiDerBase64, 64, 512);
    const publicKey = requireP256PublicKey(der);
    const actualKeyId = createHash("sha256").update(der).digest("hex");
    der.fill(0);
    if (actualKeyId !== keyId || tenKingsV2NfcKeyId(publicKey) !== keyId) {
      return unavailable("TEN_KINGS_V2_NFC_CONFIGURATION_INVALID", "NFC V2 prior trust is invalid.");
    }
    trust[keyId] = publicKey;
  }
  return trust;
};

export function tenKingsV2NfcRuntime(env: EnvLike = process.env) {
  const current = parseCurrentSigner(env[TEN_KINGS_V2_NFC_SIGNING_PRIVATE_KEY_ENV]);
  const prior = parsePriorTrust(env[TEN_KINGS_V2_NFC_PRIOR_TRUST_ENV]);
  if (Object.hasOwn(prior, current.keyId)) {
    return unavailable("TEN_KINGS_V2_NFC_CONFIGURATION_INVALID", "NFC V2 prior trust duplicates the current signer.");
  }
  const tenantId = env.AI_GRADER_PRODUCTION_TENANT_ID?.trim() || "ten-kings";
  const workstationEntries = parseAiGraderNfcWorkstationPublicKeys(
    env[TEN_KINGS_V2_NFC_WORKSTATION_KEYS_ENV],
  );
  const workstationTrust: Record<string, KeyObject> = {};
  for (const [keyId, entry] of workstationEntries) {
    if (entry.tenantId === tenantId) workstationTrust[keyId] = entry.publicKey;
  }
  if (!Object.keys(workstationTrust).length) {
    return unavailable("TEN_KINGS_V2_NFC_CONFIGURATION_INVALID", "NFC workstation trust is not configured.");
  }
  const jobTrust: Record<string, KeyObject> = { [current.keyId]: current.publicKey, ...prior };
  return {
    enabled: env[TEN_KINGS_V2_NFC_PROGRAMMING_ENABLED_ENV] === "true",
    current,
    jobTrust: jobTrust as TenKingsV2NfcTrustedKeys,
    workstationTrust: workstationTrust as TenKingsV2NfcTrustedKeys,
    jobKeyIds: Object.keys(jobTrust),
    workstationKeyIds: Object.keys(workstationTrust),
  };
}

export function tenKingsV2NfcReadiness(env: EnvLike = process.env) {
  try {
    const runtime = tenKingsV2NfcRuntime(env);
    return {
      configured: true,
      programmingEnabled: runtime.enabled,
      currentJobSigningKeyId: runtime.current.keyId,
      trustedJobSigningKeyIds: runtime.jobKeyIds,
      trustedJobSigningKeyCount: runtime.jobKeyIds.length,
      workstationKeyIds: runtime.workstationKeyIds,
      workstationKeyCount: runtime.workstationKeyIds.length,
      expectedHelperVersion: TEN_KINGS_V2_NFC_HELPER_VERSION,
      expectedHelperProtocolVersion: TEN_KINGS_V2_NFC_HELPER_PROTOCOL,
      expectedHelperCapability: TEN_KINGS_V2_NFC_HELPER_CAPABILITY,
      v1Compatible: true,
    };
  } catch {
    return {
      configured: false,
      programmingEnabled: false,
      currentJobSigningKeyId: null,
      trustedJobSigningKeyIds: [] as string[],
      trustedJobSigningKeyCount: 0,
      workstationKeyIds: [] as string[],
      workstationKeyCount: 0,
      expectedHelperVersion: TEN_KINGS_V2_NFC_HELPER_VERSION,
      expectedHelperProtocolVersion: TEN_KINGS_V2_NFC_HELPER_PROTOCOL,
      expectedHelperCapability: TEN_KINGS_V2_NFC_HELPER_CAPABILITY,
      v1Compatible: true,
    };
  }
}

const publicCard = (card: {
  id: string;
  publicToken: string;
  lifecycleState: string;
  category: string;
  playerName: string | null;
  cardName: string | null;
  year: string;
  manufacturer: string | null;
  productSet: string;
  parallel: string | null;
  cardNumber: string | null;
  nfcVerifiedAt: Date | null;
  nfcVerifiedByWorkstationId: string | null;
  humanGradeLabel: { certificateNumber: string | null; grade: { toString(): string } };
}) => ({
  id: card.id,
  publicToken: card.publicToken,
  permanentUrl: `https://collect.tenkings.co/c/${card.publicToken}`,
  lifecycleState: card.lifecycleState,
  category: card.category,
  displayName: card.playerName ?? card.cardName ?? "Ten Kings card",
  year: card.year,
  manufacturer: card.manufacturer,
  productSet: card.productSet,
  parallel: card.parallel,
  cardNumber: card.cardNumber,
  certificateNumber: card.humanGradeLabel.certificateNumber,
  grade: card.humanGradeLabel.grade.toString(),
  nfcVerifiedAt: card.nfcVerifiedAt?.toISOString() ?? null,
  nfcVerifiedByWorkstationId: card.nfcVerifiedByWorkstationId,
});

const cardSelect = {
  id: true,
  publicToken: true,
  lifecycleState: true,
  category: true,
  playerName: true,
  cardName: true,
  year: true,
  manufacturer: true,
  productSet: true,
  parallel: true,
  cardNumber: true,
  nfcVerifiedAt: true,
  nfcVerifiedByWorkstationId: true,
  humanGradeLabel: { select: { certificateNumber: true, grade: true } },
} as const;

export async function searchTenKingsV2NfcCards(query: string) {
  const normalized = query.trim();
  if (!SAFE_QUERY.test(normalized)) return [];
  const cards = await prisma.collectibleCardV2.findMany({
    where: {
      lifecycleState: { not: "VOID" },
      OR: [
        { id: normalized },
        { publicToken: normalized },
        { humanGradeLabel: { certificateNumber: { contains: normalized, mode: "insensitive" } } },
        { playerName: { contains: normalized, mode: "insensitive" } },
        { cardName: { contains: normalized, mode: "insensitive" } },
        { cardNumber: { contains: normalized, mode: "insensitive" } },
      ],
    },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: 20,
    select: cardSelect,
  });
  return cards.map(publicCard);
}

export async function getTenKingsV2NfcCard(cardId: string) {
  const card = await prisma.collectibleCardV2.findFirst({
    where: { id: cardId, lifecycleState: { not: "VOID" } },
    select: cardSelect,
  });
  return card ? publicCard(card) : null;
}

export async function getTenKingsV2NfcRecoveryCardFact(cardId: string) {
  const card = await prisma.collectibleCardV2.findUnique({
    where: { id: cardId },
    select: { id: true, nfcVerifiedAt: true },
  });
  return card ? { id: card.id, nfcVerifiedAt: card.nfcVerifiedAt?.toISOString() ?? null } : null;
}

export async function issueTenKingsV2NfcCardJob(cardId: string, env: EnvLike = process.env) {
  const runtime = tenKingsV2NfcRuntime(env);
  if (!runtime.enabled) {
    throw new TenKingsV2NfcHostedError("TEN_KINGS_V2_NFC_PROGRAMMING_DISABLED", 503, "NFC V2 programming is disabled.");
  }
  const card = await prisma.collectibleCardV2.findFirst({
    where: { id: cardId, lifecycleState: { not: "VOID" } },
    select: { id: true, publicToken: true },
  });
  if (!card) throw new TenKingsV2NfcHostedError("TEN_KINGS_V2_NFC_CARD_NOT_FOUND", 404, "Permanent card not found.");
  const job = issueTenKingsV2NfcJob({
    cardId: card.id,
    publicToken: card.publicToken,
    privateKey: runtime.current.privateKey,
  });
  return { job, jobEnvelopeSha256: tenKingsV2NfcJobEnvelopeSha256(job) };
}

export async function completeTenKingsV2NfcCardJob(input: {
  job: TenKingsV2NfcSignedJob;
  result: TenKingsV2NfcSignedResult;
  adminId: string;
  now?: Date;
  env?: EnvLike;
}) {
  const runtime = tenKingsV2NfcRuntime(input.env ?? process.env);
  if (!runtime.enabled) {
    throw new TenKingsV2NfcHostedError("TEN_KINGS_V2_NFC_PROGRAMMING_DISABLED", 503, "NFC V2 programming is disabled.");
  }
  let verified: ReturnType<typeof verifyTenKingsV2NfcCompletion>;
  try {
    verified = verifyTenKingsV2NfcCompletion({
      job: input.job,
      result: input.result,
      trustedJobSigningKeys: runtime.jobTrust,
      trustedWorkstationKeys: runtime.workstationTrust,
    });
  } catch (error) {
    if (error instanceof TenKingsV2NfcProtocolError) {
      throw new TenKingsV2NfcHostedError(error.code, 409, "The signed NFC completion was permanently rejected.");
    }
    throw error;
  }
  const now = input.now ?? new Date();
  const observedAt = new Date(verified.result.observedAt);
  if (
    !Number.isFinite(now.getTime()) ||
    observedAt.getTime() > now.getTime() + 30_000
  ) {
    throw new TenKingsV2NfcHostedError("TEN_KINGS_V2_NFC_RESULT_TIME_REJECTED", 409, "NFC terminal result is outside the accepted completion window.");
  }
  try {
    return await prisma.$transaction((tx: Prisma.TransactionClient) => markNfcVerified(
      tx,
      verified.job.cardId,
      {
        publicToken: verified.job.publicToken,
        jobIssuedAt: verified.job.issuedAt,
        workstationKeyId: verified.result.workstationKeyId,
      },
      input.adminId,
    ));
  } catch (error) {
    if (error instanceof Error && error.message === "Permanent Ten Kings V2 card was not found") {
      throw new TenKingsV2NfcHostedError(
        "TEN_KINGS_V2_NFC_CARD_NO_LONGER_RECORDABLE",
        409,
        "The permanent card is no longer eligible to record this NFC result.",
      );
    }
    if (error instanceof Error && error.message === "NFC verification no longer matches the permanent card token") {
      throw new TenKingsV2NfcHostedError(
        "TEN_KINGS_V2_NFC_CARD_TOKEN_CHANGED",
        409,
        "The permanent card token no longer matches this NFC result.",
      );
    }
    throw error;
  }
}
