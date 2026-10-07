import { prisma } from "@tenkings/database";
import { Prisma } from "@prisma/client";
import { computeReferenceEmbeddings, hasUsableEmbeddings } from "./embedding";
import { computeQualityScore } from "./quality";
import { fetchReferenceBytes, REFERENCE_ATTEMPT_TIMEOUT_MS } from "./request";

export const REFERENCE_RETRY_DELAY_MS = 5 * 60_000;
export const REFERENCE_MIN_POLL_INTERVAL_MS = 15_000;
const MAX_BATCH_SIZE = 8;
let loggedMissingEmbeddingServiceWarning = false;

function embeddingServiceReady() {
  if (process.env.VARIANT_EMBEDDING_URL?.trim()) {
    loggedMissingEmbeddingServiceWarning = false;
    return true;
  }
  if (!loggedMissingEmbeddingServiceWarning) {
    console.warn("[bytebot-lite] reference processing deferred: VARIANT_EMBEDDING_URL is not configured");
    loggedMissingEmbeddingServiceWarning = true;
  }
  return false;
}

function queuedWhere(): Prisma.CardVariantReferenceImageWhereInput {
  return {
    OR: [
      { qualityScore: null },
      { cropEmbeddings: { equals: Prisma.JsonNull } },
      { cropEmbeddings: { equals: Prisma.DbNull } },
      { cropEmbeddings: { equals: [] } },
    ],
  };
}

export async function processReferenceImage(referenceId: string): Promise<boolean> {
  if (!embeddingServiceReady()) return false;
  const reference = await prisma.cardVariantReferenceImage.findUnique({ where: { id: referenceId } });
  if (!reference) return false;
  const startedAt = new Date();
  if (reference.updatedAt.getTime() > startedAt.getTime() - REFERENCE_RETRY_DELAY_MS) return false;
  if (reference.qualityScore !== null && hasUsableEmbeddings(reference.cropEmbeddings)) return false;

  // Existing updatedAt supplies a durable cooldown and an atomic claim without a migration.
  // The final write is also fenced against a concurrent reference edit or another worker.
  const claim = await prisma.cardVariantReferenceImage.updateMany({
    where: { AND: [queuedWhere(), { id: reference.id, updatedAt: reference.updatedAt }] },
    data: { updatedAt: startedAt },
  });
  if (claim.count !== 1) return false;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REFERENCE_ATTEMPT_TIMEOUT_MS);
  let image: Promise<Buffer> | undefined;
  const loadImage = () => image ??= fetchReferenceBytes(reference.rawImageUrl, { signal: controller.signal });
  try {
    const embeddings = hasUsableEmbeddings(reference.cropEmbeddings)
      ? { cropUrls: reference.cropUrls, embeddings: reference.cropEmbeddings }
      : await computeReferenceEmbeddings({ imageUrl: reference.rawImageUrl, referenceId: reference.id, loadImage, signal: controller.signal });
    if (!hasUsableEmbeddings(embeddings.embeddings)) return true;

    const quality = reference.qualityScore === null ? await computeQualityScore(await loadImage()) : null;
    controller.signal.throwIfAborted();
    await prisma.cardVariantReferenceImage.updateMany({
      where: { id: reference.id, updatedAt: startedAt, rawImageUrl: reference.rawImageUrl },
      data: {
        qualityScore: reference.qualityScore ?? quality?.score ?? null,
        cropUrls: embeddings.cropUrls.length ? embeddings.cropUrls : reference.cropUrls,
        cropEmbeddings: embeddings.embeddings,
      },
    });
    return true;
  } catch {
    // The durable claim already defers this row. A failed row must not starve later references.
    console.warn("[bytebot-lite] reference attempt deferred; later references may continue");
    return true;
  } finally {
    controller.abort();
    clearTimeout(timer);
  }
}

export async function processPendingReferences(limit = MAX_BATCH_SIZE): Promise<number> {
  // Guard before DB claims, image downloads, crop uploads and provider requests.
  if (!embeddingServiceReady()) return 0;
  const take = Number.isFinite(limit) ? Math.max(0, Math.min(MAX_BATCH_SIZE, Math.floor(limit))) : MAX_BATCH_SIZE;
  if (take === 0) return 0;
  const eligible: Prisma.CardVariantReferenceImageWhereInput = {
    AND: [queuedWhere(), { updatedAt: { lte: new Date(Date.now() - REFERENCE_RETRY_DELAY_MS) } }],
  };
  // Preserve the existing trusted/owned priority, with oldest eligible work first.
  const pending = await prisma.cardVariantReferenceImage.findMany({
    where: { AND: [eligible, { OR: [{ qaStatus: "keep" }, { ownedStatus: "owned" }] }] },
    take,
    orderBy: [{ updatedAt: "asc" }, { id: "asc" }],
    select: { id: true },
  });
  if (pending.length < take) {
    const backlog = await prisma.cardVariantReferenceImage.findMany({
      where: { AND: [eligible, { id: { notIn: pending.map(({ id }) => id) } }] },
      take: take - pending.length,
      orderBy: [{ updatedAt: "asc" }, { id: "asc" }],
      select: { id: true },
    });
    pending.push(...backlog);
  }
  let attempted = 0;
  for (const reference of pending) {
    if (await processReferenceImage(reference.id)) attempted++;
  }
  return attempted;
}
