import { createHash, createHmac, timingSafeEqual } from "node:crypto";

import {
  canonicalEbaySoldCompsV2ListingUrl,
  buildEbaySoldCompsV2Query,
  isApprovedEbaySoldCompsV2ImageUrl,
  mapTenKingsGradeToPsaGrade,
  searchEbaySoldCompsV2,
  type EbaySoldCompV2Candidate,
  type EbaySoldCompsV2SearchInput,
} from "@tenkings/ebay-sold-comps-v2";
import {
  confirmMarketValue,
  prisma,
  saveCompsSnapshot,
  setCompsPublic,
  type Prisma,
} from "@tenkings/database";
export { projectPublicCompsV2, type PublicCompsV2Projection } from "../compsV2Public";

export const COMPS_V2_MAX_CANDIDATES = 60;
export const COMPS_V2_MAX_SNAPSHOT_BYTES = 256 * 1024;
export const COMPS_V2_MAX_CENTS = 2_147_483_647;
const CARD_QUERY_MAX = 160;
const QUERY_MAX = 400;
const soldCompsSecret = () => process.env.SOLDCOMPS_API_KEY ?? "";

export class CompsV2HttpError extends Error {
  constructor(readonly status: number, message: string, readonly code: string) {
    super(message);
    this.name = "CompsV2HttpError";
  }
}

export type CompsV2Candidate = Omit<EbaySoldCompV2Candidate, "source" | "productId" | "soldPriceDisplay"> & {
  included: boolean;
};

export type CompsV2Snapshot = {
  version: 1;
  source: "EBAY_SOLD";
  engineVersion: string;
  query: string;
  retrievedAt: string;
  nextOffset: number;
  hasMore: boolean;
  candidates: CompsV2Candidate[];
  selection: {
    includedCandidateIds: string[];
    includedCount: number;
    averageSoldPriceCents: number | null;
    lowestSoldPriceCents: number | null;
    highestSoldPriceCents: number | null;
  };
  confirmation: { marketValueCents: number; confirmedAt: string; confirmedByAdminId: string } | null;
};

export type CompsV2ReviewProof = {
  version: 1;
  baseCompsStateRevision: string;
  expiresAt: string;
  snapshot: CompsV2Snapshot;
  signature: string;
};

type CompsCardRow = {
  id: string;
  publicToken: string;
  publicReportSlug: string;
  category: "SPORTS" | "POKEMON";
  playerName: string | null;
  cardName: string | null;
  year: string;
  manufacturer: string | null;
  productSet: string;
  parallel: string | null;
  insert: string | null;
  cardNumber: string | null;
  gradeSnapshot: Prisma.JsonValue;
  lifecycleState: string;
  compsSnapshot: Prisma.JsonValue | null;
  marketValueCents: number | null;
  marketValueConfirmedAt: Date | null;
  marketValueConfirmedByAdminId: string | null;
  compsPublic: boolean;
  speedsterSession: { slabFrontKey: string | null; capture: Prisma.JsonValue };
  humanGradeLabel: { certificateNumber: string | null };
};

const cardSelect = {
  id: true,
  publicToken: true,
  publicReportSlug: true,
  category: true,
  playerName: true,
  cardName: true,
  year: true,
  manufacturer: true,
  productSet: true,
  parallel: true,
  insert: true,
  cardNumber: true,
  gradeSnapshot: true,
  lifecycleState: true,
  compsSnapshot: true,
  marketValueCents: true,
  marketValueConfirmedAt: true,
  marketValueConfirmedByAdminId: true,
  compsPublic: true,
  speedsterSession: { select: { slabFrontKey: true, capture: true } },
  humanGradeLabel: { select: { certificateNumber: true } },
} satisfies Prisma.CollectibleCardV2Select;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === "object" && !Array.isArray(value);
const text = (value: unknown, maximum = 500) =>
  typeof value === "string" && value.trim() && value.trim().length <= maximum ? value.trim() : null;
const safePositiveCents = (value: unknown): value is number =>
  Number.isSafeInteger(value) && Number(value) > 0 && Number(value) <= COMPS_V2_MAX_CENTS;
const canonicalSoldDate = (value: unknown) => {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const epoch = Date.parse(`${value}T00:00:00.000Z`);
  return Number.isFinite(epoch) && new Date(epoch).toISOString().slice(0, 10) === value ? value : null;
};
const canonicalTimestamp = (value: unknown) => {
  if (typeof value !== "string" || value.length > 40) return null;
  const epoch = Date.parse(value);
  return Number.isFinite(epoch) && new Date(epoch).toISOString() === value ? value : null;
};

const summarizeSelection = (candidates: readonly CompsV2Candidate[], selectedCandidateIds: readonly string[]) => {
  const includedCandidateIds = [...new Set(selectedCandidateIds)];
  if (!includedCandidateIds.length) return {
    includedCandidateIds: [], includedCount: 0, averageSoldPriceCents: null,
    lowestSoldPriceCents: null, highestSoldPriceCents: null,
  };
  const byId = new Map(candidates.map((candidate) => [candidate.id, candidate]));
  const prices = includedCandidateIds.map((id) => {
    const candidate = byId.get(id);
    if (!candidate || !safePositiveCents(candidate.soldPriceCents)) throw new Error("Invalid selected candidate");
    return candidate.soldPriceCents;
  });
  const divisor = BigInt(prices.length);
  const total = prices.reduce((sum, price) => sum + BigInt(price), 0n);
  return {
    includedCandidateIds,
    includedCount: prices.length,
    averageSoldPriceCents: Number((total + divisor / 2n) / divisor),
    lowestSoldPriceCents: Math.min(...prices),
    highestSoldPriceCents: Math.max(...prices),
  };
};

const canonicalJson = (value: unknown): string => {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, nested]) => `${JSON.stringify(key)}:${canonicalJson(nested)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
};

const revisionFacts = (card: Pick<CompsCardRow,
  "compsSnapshot" | "marketValueCents" | "marketValueConfirmedAt" | "marketValueConfirmedByAdminId" | "compsPublic"
>) => ({
  compsSnapshot: parseCompsV2Snapshot(card.compsSnapshot) ?? card.compsSnapshot,
  marketValueCents: card.marketValueCents,
  marketValueConfirmedAt: card.marketValueConfirmedAt?.toISOString() ?? null,
  marketValueConfirmedByAdminId: card.marketValueConfirmedByAdminId,
  compsPublic: card.compsPublic,
});

export const compsStateRevision = (card: Pick<CompsCardRow,
  "compsSnapshot" | "marketValueCents" | "marketValueConfirmedAt" | "marketValueConfirmedByAdminId" | "compsPublic"
>) => createHash("sha256").update(canonicalJson(revisionFacts(card))).digest("hex");

const parseCandidate = (value: unknown): CompsV2Candidate | null => {
  if (!isRecord(value)) return null;
  const id = text(value.id, 100);
  const title = text(value.title, 500);
  const listingUrl = canonicalEbaySoldCompsV2ListingUrl(value.listingUrl);
  const imageUrl = value.imageUrl === null ? null : isApprovedEbaySoldCompsV2ImageUrl(value.imageUrl) ? value.imageUrl : null;
  if (value.soldPriceCents !== null && !safePositiveCents(value.soldPriceCents)) return null;
  const soldPriceCents = value.soldPriceCents === null ? null : value.soldPriceCents;
  const soldDate = canonicalSoldDate(value.soldDate);
  const grader = value.grader === "PSA" || value.grader === "BGS" || value.grader === "SGC" || value.grader === "CGC" ? value.grader : null;
  const group = value.group === "PSA_TARGET" || value.group === "PSA_OTHER" || value.group === "OTHER_GRADED" || value.group === "RAW" ? value.group : null;
  const parallelMatch = value.parallelMatch === "MATCH" || value.parallelMatch === "CONTRADICTORY" || value.parallelMatch === "UNKNOWN" ? value.parallelMatch : null;
  if (!id || !title || !listingUrl || !group || !parallelMatch) return null;
  const numericGrade = typeof value.numericGrade === "number" && Number.isFinite(value.numericGrade) ? value.numericGrade : null;
  const matchScore = typeof value.matchScore === "number" && Number.isFinite(value.matchScore)
    ? Math.max(0, Math.min(100, Math.round(value.matchScore)))
    : 0;
  return {
    id,
    title,
    listingUrl,
    imageUrl,
    soldPriceCents,
    soldDate,
    condition: text(value.condition, 200),
    grader,
    numericGrade,
    raw: value.raw === true,
    group,
    parallelMatch,
    matchScore,
    matchReason: text(value.matchReason, 500) ?? "Human review required",
    included: value.included === true,
  };
};

export function parseCompsV2Snapshot(value: unknown): CompsV2Snapshot | null {
  if (!isRecord(value) || value.version !== 1 || value.source !== "EBAY_SOLD" || !Array.isArray(value.candidates)) return null;
  if (Buffer.byteLength(JSON.stringify(value), "utf8") > COMPS_V2_MAX_SNAPSHOT_BYTES) return null;
  const query = text(value.query, QUERY_MAX);
  const engineVersion = text(value.engineVersion, 100);
  const retrievedAt = text(value.retrievedAt, 40);
  const nextOffset = Number.isSafeInteger(value.nextOffset) && Number(value.nextOffset) >= 0 ? Number(value.nextOffset) : null;
  if (!query || !engineVersion || !retrievedAt || nextOffset === null || value.candidates.length > COMPS_V2_MAX_CANDIDATES) return null;
  const candidates = value.candidates.map(parseCandidate);
  if (candidates.some((candidate) => !candidate)) return null;
  const rows = candidates as CompsV2Candidate[];
  const ids = new Set<string>();
  if (rows.some(({ id }) => ids.has(id) || !ids.add(id))) return null;
  const includedCandidateIds = rows.filter(({ included }) => included).map(({ id }) => id);
  let selection;
  try {
    selection = summarizeSelection(rows, includedCandidateIds);
  } catch {
    return null;
  }
  const snapshot: CompsV2Snapshot = {
    version: 1,
    source: "EBAY_SOLD",
    engineVersion,
    query,
    retrievedAt,
    nextOffset,
    hasMore: rows.length < COMPS_V2_MAX_CANDIDATES && value.hasMore === true,
    candidates: rows,
    selection,
    confirmation: isRecord(value.confirmation) && safePositiveCents(value.confirmation.marketValueCents) &&
      Boolean(canonicalTimestamp(value.confirmation.confirmedAt)) && Boolean(text(value.confirmation.confirmedByAdminId, 256))
      ? {
        marketValueCents: value.confirmation.marketValueCents,
        confirmedAt: canonicalTimestamp(value.confirmation.confirmedAt)!,
        confirmedByAdminId: text(value.confirmation.confirmedByAdminId, 256)!,
      }
      : null,
  };
  if (Buffer.byteLength(JSON.stringify(snapshot), "utf8") > COMPS_V2_MAX_SNAPSHOT_BYTES) return null;
  return snapshot;
}

const reviewProofPayload = (proof: Omit<CompsV2ReviewProof, "signature">) => canonicalJson(proof);
const reviewSigningKey = (secret: string) => createHash("sha256").update(`ten-kings-comps-v2-review\0${secret}`).digest();

export function createCompsV2ReviewProof(
  snapshot: CompsV2Snapshot,
  baseCompsStateRevision: string,
  secret: string,
  now = new Date(),
): CompsV2ReviewProof {
  const normalizedSnapshot = parseCompsV2Snapshot(snapshot);
  if (!normalizedSnapshot || !/^[a-f0-9]{64}$/.test(baseCompsStateRevision) || !secret.trim() || !Number.isFinite(now.getTime())) {
    throw new CompsV2HttpError(500, "Refresh review could not be secured", "REVIEW_PROOF_UNAVAILABLE");
  }
  const unsigned = {
    version: 1 as const,
    baseCompsStateRevision,
    expiresAt: new Date(now.getTime() + 15 * 60 * 1000).toISOString(),
    snapshot: normalizedSnapshot,
  };
  return {
    ...unsigned,
    signature: createHmac("sha256", reviewSigningKey(secret)).update(reviewProofPayload(unsigned)).digest("hex"),
  };
}

export function verifyCompsV2ReviewProof(
  value: unknown,
  expectedCompsStateRevision: string,
  secret: string,
  now = new Date(),
): CompsV2ReviewProof {
  if (!isRecord(value) || value.version !== 1 || !/^[a-f0-9]{64}$/.test(expectedCompsStateRevision) || !secret.trim()) {
    throw new CompsV2HttpError(400, "Refresh review proof is invalid", "INVALID_REVIEW_PROOF");
  }
  const baseCompsStateRevision = text(value.baseCompsStateRevision, 64);
  const expiresAt = canonicalTimestamp(value.expiresAt);
  const signature = text(value.signature, 64);
  const snapshot = parseCompsV2Snapshot(value.snapshot);
  if (!baseCompsStateRevision || baseCompsStateRevision !== expectedCompsStateRevision || !expiresAt || !signature || !/^[a-f0-9]{64}$/.test(signature) || !snapshot) {
    throw new CompsV2HttpError(400, "Refresh review proof is invalid", "INVALID_REVIEW_PROOF");
  }
  if (Date.parse(expiresAt) <= now.getTime()) throw new CompsV2HttpError(409, "Refresh review expired. Refresh again.", "REVIEW_PROOF_EXPIRED");
  const unsigned = { version: 1 as const, baseCompsStateRevision, expiresAt, snapshot };
  const expected = createHmac("sha256", reviewSigningKey(secret)).update(reviewProofPayload(unsigned)).digest("hex");
  if (!timingSafeEqual(Buffer.from(signature, "hex"), Buffer.from(expected, "hex"))) {
    throw new CompsV2HttpError(400, "Refresh review proof is invalid", "INVALID_REVIEW_PROOF");
  }
  return { ...unsigned, signature };
}

const gradeFrom = (gradeSnapshot: Prisma.JsonValue) => {
  if (!isRecord(gradeSnapshot)) return null;
  const raw = typeof gradeSnapshot.finalGrade === "string" || typeof gradeSnapshot.finalGrade === "number"
    ? Number(gradeSnapshot.finalGrade)
    : Number.NaN;
  return Number.isFinite(raw) && raw >= 1 && raw <= 10 ? raw : null;
};
const psaGradeFrom = (gradeSnapshot: Prisma.JsonValue) => {
  const grade = gradeFrom(gradeSnapshot);
  return grade == null ? null : mapTenKingsGradeToPsaGrade(grade);
};

const reportImageKey = (card: CompsCardRow): string | null => {
  if (card.speedsterSession.slabFrontKey) return card.speedsterSession.slabFrontKey;
  const capture = card.speedsterSession.capture;
  if (!isRecord(capture) || !isRecord(capture.front)) return null;
  return text(capture.front.reportStorageKey, 500) ?? text(capture.front.rectifiedStorageKey, 500);
};

export const publicCardState = (card: CompsCardRow) => ({
  id: card.id,
  publicToken: card.publicToken,
  publicReportSlug: card.publicReportSlug,
  certificateNumber: card.humanGradeLabel.certificateNumber,
  category: card.category,
  playerName: card.playerName,
  cardName: card.cardName,
  year: card.year,
  manufacturer: card.manufacturer,
  productSet: card.productSet,
  parallel: card.parallel,
  insert: card.insert,
  cardNumber: card.cardNumber,
  targetGrade: gradeFrom(card.gradeSnapshot),
  psaTargetGrade: psaGradeFrom(card.gradeSnapshot),
  defaultQuery: buildEbaySoldCompsV2Query(searchInputForCard(card, null)),
  lifecycleState: card.lifecycleState,
  imageStorageKey: reportImageKey(card),
  snapshot: parseCompsV2Snapshot(card.compsSnapshot),
  marketValueCents: card.marketValueCents,
  marketValueConfirmedAt: card.marketValueConfirmedAt?.toISOString() ?? null,
  compsPublic: card.compsPublic,
  compsStateRevision: compsStateRevision(card),
});

export async function listCompsV2Cards(query: string) {
  const q = query.trim();
  if (!q || q.length > CARD_QUERY_MAX) return [];
  return prisma.collectibleCardV2.findMany({
    where: {
      lifecycleState: { not: "VOID" },
      OR: [
        { id: q },
        { publicToken: q },
        { publicReportSlug: q },
        { humanGradeLabel: { certificateNumber: { equals: q, mode: "insensitive" } } },
        { playerName: { contains: q, mode: "insensitive" } },
        { cardName: { contains: q, mode: "insensitive" } },
        { cardNumber: { equals: q, mode: "insensitive" } },
      ],
    },
    orderBy: [{ updatedAt: "desc" }, { id: "asc" }],
    take: 20,
    select: cardSelect,
  });
}

export async function getCompsV2Card(cardId: string) {
  const card = await prisma.collectibleCardV2.findFirst({
    where: { id: cardId, lifecycleState: { not: "VOID" } },
    select: cardSelect,
  });
  return card as CompsCardRow | null;
}

const searchInputForCard = (card: CompsCardRow, queryOverride: string | null): EbaySoldCompsV2SearchInput => ({
  category: card.category,
  playerName: card.playerName,
  cardName: card.cardName,
  year: card.year,
  manufacturer: card.manufacturer,
  productSet: card.productSet,
  parallel: card.parallel,
  insert: card.insert,
  cardNumber: card.cardNumber,
  targetGrade: gradeFrom(card.gradeSnapshot),
  queryOverride,
});

const candidateFromEngine = (candidate: EbaySoldCompV2Candidate): CompsV2Candidate => ({
  id: candidate.id,
  title: candidate.title,
  listingUrl: candidate.listingUrl,
  imageUrl: candidate.imageUrl,
  soldPriceCents: candidate.soldPriceCents,
  soldDate: candidate.soldDate,
  condition: candidate.condition,
  grader: candidate.grader,
  numericGrade: candidate.numericGrade,
  raw: candidate.raw,
  group: candidate.group,
  parallelMatch: candidate.parallelMatch,
  matchScore: candidate.matchScore,
  matchReason: candidate.matchReason,
  included: false,
});

const emptySelection = () => ({
  includedCandidateIds: [], includedCount: 0, averageSoldPriceCents: null,
  lowestSoldPriceCents: null, highestSoldPriceCents: null,
});

const snapshotFromSearch = (result: Awaited<ReturnType<typeof searchEbaySoldCompsV2>>, candidates?: CompsV2Candidate[]): CompsV2Snapshot => {
  const rows = candidates ?? result.candidates.map(candidateFromEngine);
  return {
    version: 1,
    source: "EBAY_SOLD",
    engineVersion: result.engineVersion,
    query: result.query,
    retrievedAt: result.retrievedAt,
    nextOffset: result.nextOffset,
    hasMore: rows.length < COMPS_V2_MAX_CANDIDATES && result.hasMore,
    candidates: rows,
    selection: emptySelection(),
    confirmation: null,
  };
};

async function lockedCard(tx: Prisma.TransactionClient, cardId: string): Promise<CompsCardRow> {
  const locked = await tx.$queryRaw<Array<{ id: string }>>`
    SELECT "id" FROM "CollectibleCardV2"
    WHERE "id" = ${cardId} AND "lifecycleState" <> 'VOID'::"CollectibleCardV2LifecycleState"
    FOR UPDATE
  `;
  if (locked.length !== 1) throw new CompsV2HttpError(404, "Ten Kings V2 card not found", "CARD_NOT_FOUND");
  const card = await tx.collectibleCardV2.findUnique({ where: { id: cardId }, select: cardSelect });
  if (!card || card.lifecycleState === "VOID") throw new CompsV2HttpError(404, "Ten Kings V2 card not found", "CARD_NOT_FOUND");
  return card as CompsCardRow;
}

const assertRevision = (card: CompsCardRow, expected: string) => {
  if (!/^[a-f0-9]{64}$/.test(expected) || compsStateRevision(card) !== expected) {
    throw new CompsV2HttpError(409, "This card changed in another window. Reload before continuing.", "STALE_COMPS_STATE");
  }
};

const publicEligible = (snapshot: CompsV2Snapshot | null) => Boolean(
  snapshot && snapshot.confirmation && safePositiveCents(snapshot.confirmation.marketValueCents) &&
  snapshot.selection.includedCount > 0 && snapshot.selection.averageSoldPriceCents &&
  snapshot.confirmation.marketValueCents === snapshot.selection.averageSoldPriceCents &&
  snapshot.candidates.filter(({ included }) => included).every((candidate) => (
    safePositiveCents(candidate.soldPriceCents) &&
    Boolean(candidate.soldDate && /^\d{4}-\d{2}-\d{2}$/.test(candidate.soldDate)) &&
    Boolean(candidate.imageUrl && isApprovedEbaySoldCompsV2ImageUrl(candidate.imageUrl)) &&
    canonicalEbaySoldCompsV2ListingUrl(candidate.listingUrl) === candidate.listingUrl
  )),
);

export async function runCompsV2Search(input: {
  cardId?: string;
  researchIdentity?: EbaySoldCompsV2SearchInput;
  query: string;
  operation: "FIND" | "REFRESH";
  expectedCompsStateRevision?: string;
  acknowledgeReplaceSelected?: boolean;
  adminId: string;
}, dependencies: {
  getCard?: typeof getCompsV2Card;
  search?: typeof searchEbaySoldCompsV2;
} = {}) {
  const query = text(input.query, QUERY_MAX);
  if (!query) throw new CompsV2HttpError(400, "A visible search query is required", "INVALID_QUERY");
  const getCard = dependencies.getCard ?? getCompsV2Card;
  const search = dependencies.search ?? searchEbaySoldCompsV2;
  if (!input.cardId) {
    if (!input.researchIdentity) throw new CompsV2HttpError(400, "Research identity is required", "INVALID_RESEARCH");
    const result = await search({ ...input.researchIdentity, queryOverride: query }, { apiKey: soldCompsSecret() });
    const snapshot = snapshotFromSearch(result);
    return {
      mode: "RESEARCH" as const,
      result: snapshot,
    };
  }

  const before = await getCard(input.cardId);
  if (!before) throw new CompsV2HttpError(404, "Ten Kings V2 card not found", "CARD_NOT_FOUND");
  if (!input.expectedCompsStateRevision) throw new CompsV2HttpError(400, "Current comps revision is required", "REVISION_REQUIRED");
  assertRevision(before, input.expectedCompsStateRevision);
  const currentSnapshot = parseCompsV2Snapshot(before.compsSnapshot);
  if (currentSnapshot?.selection.includedCount && !input.acknowledgeReplaceSelected) {
    throw new CompsV2HttpError(409, "Confirm that Refresh may replace the selected comp snapshot.", "REPLACE_CONFIRMATION_REQUIRED");
  }
  const result = await search(searchInputForCard(before, null), { apiKey: soldCompsSecret() });

  if (currentSnapshot?.selection.includedCount) {
    const snapshot = snapshotFromSearch(result);
    return {
      mode: "CARD_REVIEW" as const,
      review: createCompsV2ReviewProof(snapshot, input.expectedCompsStateRevision!, soldCompsSecret()),
    };
  }

  return prisma.$transaction(async (tx) => {
    const card = await lockedCard(tx, input.cardId!);
    assertRevision(card, input.expectedCompsStateRevision!);
    const snapshot = snapshotFromSearch(result);
    if (!parseCompsV2Snapshot(snapshot)) throw new CompsV2HttpError(422, "Provider results could not be saved safely", "INVALID_PROVIDER_RESULTS");
    await saveCompsSnapshot(tx, card.id, snapshot as unknown as Prisma.InputJsonValue, input.adminId);
    const updated = await tx.collectibleCardV2.findUniqueOrThrow({ where: { id: card.id }, select: cardSelect });
    return { mode: "CARD" as const, card: publicCardState(updated as CompsCardRow) };
  });
}

export async function confirmCompsV2(input: {
  cardId: string;
  expectedCompsStateRevision: string;
  selectedCandidateIds: string[];
  compsPublic: boolean;
  reviewProof?: unknown;
  adminId: string;
}) {
  return prisma.$transaction(async (tx) => {
    const card = await lockedCard(tx, input.cardId);
    assertRevision(card, input.expectedCompsStateRevision);
    const proof = input.reviewProof
      ? verifyCompsV2ReviewProof(input.reviewProof, input.expectedCompsStateRevision, soldCompsSecret())
      : null;
    const current = proof?.snapshot ?? parseCompsV2Snapshot(card.compsSnapshot);
    if (!current) throw new CompsV2HttpError(409, "Run a sold-comps search before confirming value", "NO_SNAPSHOT");
    const requestedSelectedIds = [...new Set(input.selectedCandidateIds)];
    if (!requestedSelectedIds.length || requestedSelectedIds.length > COMPS_V2_MAX_CANDIDATES) throw new CompsV2HttpError(400, "Select at least one sold comp", "NO_SELECTION");
    const requestedSelectedSet = new Set(requestedSelectedIds);
    const selectedIds = current.candidates.filter(({ id }) => requestedSelectedSet.has(id)).map(({ id }) => id);
    if (selectedIds.length !== requestedSelectedIds.length) {
      throw new CompsV2HttpError(400, "Selected comps are not part of the saved candidate snapshot", "TAMPERED_SELECTION");
    }
    let selection;
    try {
      selection = summarizeSelection(current.candidates, selectedIds);
    } catch {
      throw new CompsV2HttpError(400, "Selected comps are not part of the saved candidate snapshot", "TAMPERED_SELECTION");
    }
    const marketValueCents = selection.averageSoldPriceCents;
    if (!safePositiveCents(marketValueCents)) throw new CompsV2HttpError(400, "Selected comps require one positive arithmetic average", "INVALID_MARKET_VALUE");
    const snapshot: CompsV2Snapshot = {
      ...current,
      candidates: current.candidates.map((candidate) => ({ ...candidate, included: selectedIds.includes(candidate.id) })),
      selection,
      confirmation: {
        marketValueCents,
        confirmedAt: new Date().toISOString(),
        confirmedByAdminId: input.adminId,
      },
    };
    if (input.compsPublic && !publicEligible(snapshot)) {
      throw new CompsV2HttpError(422, "Every public comp needs an image, sold price, sold date, and actual eBay sold-listing link", "PUBLIC_COMPS_INELIGIBLE");
    }
    const selectionUnchanged = current.selection.includedCandidateIds.length === selectedIds.length &&
      current.selection.includedCandidateIds.every((id, index) => id === selectedIds[index]);
    if (
      !proof &&
      selectionUnchanged &&
      card.marketValueCents === marketValueCents &&
      card.marketValueConfirmedByAdminId === input.adminId &&
      card.compsPublic === input.compsPublic
    ) {
      return publicCardState(card);
    }
    const confirmedAt = new Date(snapshot.confirmation!.confirmedAt);
    await saveCompsSnapshot(tx, card.id, snapshot as unknown as Prisma.InputJsonValue, input.adminId, { confirmationMode: "CONFIRM" });
    await confirmMarketValue(tx, card.id, marketValueCents, input.adminId, confirmedAt);
    await setCompsPublic(tx, card.id, input.compsPublic, input.adminId);
    const updated = await tx.collectibleCardV2.findUniqueOrThrow({ where: { id: card.id }, select: cardSelect });
    return publicCardState(updated as CompsCardRow);
  });
}

export async function setCompsV2Public(input: {
  cardId: string;
  expectedCompsStateRevision: string;
  compsPublic: boolean;
  adminId: string;
}) {
  return prisma.$transaction(async (tx) => {
    const card = await lockedCard(tx, input.cardId);
    assertRevision(card, input.expectedCompsStateRevision);
    if (input.compsPublic && !publicEligible(parseCompsV2Snapshot(card.compsSnapshot))) {
      throw new CompsV2HttpError(422, "Every public comp needs an image, sold price, sold date, and actual eBay sold-listing link", "PUBLIC_COMPS_INELIGIBLE");
    }
    if (card.compsPublic === input.compsPublic) return publicCardState(card);
    await setCompsPublic(tx, card.id, input.compsPublic, input.adminId);
    const updated = await tx.collectibleCardV2.findUniqueOrThrow({ where: { id: card.id }, select: cardSelect });
    return publicCardState(updated as CompsCardRow);
  });
}
