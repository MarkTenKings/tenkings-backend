import { prisma } from "@tenkings/database";
import { Prisma } from "@prisma/client";
import { computeReferenceEmbeddings } from "./embedding";
import { computeQualityScore } from "./quality";

let loggedMissingEmbeddingServiceWarning = false;

function buildQueuedReferenceWhere(extraWhere?: Prisma.CardVariantReferenceImageWhereInput): Prisma.CardVariantReferenceImageWhereInput {
  const queuedWhere: Prisma.CardVariantReferenceImageWhereInput = {
    OR: [
      { qualityScore: null },
      { cropEmbeddings: { equals: Prisma.JsonNull } },
      { cropEmbeddings: { equals: Prisma.DbNull } },
    ],
  };

  if (!extraWhere) {
    return queuedWhere;
  }

  return {
    AND: [queuedWhere, extraWhere],
  };
}

function warnIfEmbeddingServiceMissing() {
  if (loggedMissingEmbeddingServiceWarning || process.env.VARIANT_EMBEDDING_URL) {
    return;
  }
  loggedMissingEmbeddingServiceWarning = true;
  console.warn(
    "[bytebot-lite] WARNING: VARIANT_EMBEDDING_URL is not configured; reference crop embeddings will be empty and variant matching quality will be degraded."
  );
}

async function fetchQueuedReferences(limit: number) {
  const trusted = await prisma.cardVariantReferenceImage.findMany({
    where: buildQueuedReferenceWhere({
      OR: [{ qaStatus: "keep" }, { ownedStatus: "owned" }],
    }),
    take: limit,
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
  });

  if (trusted.length >= limit) {
    return trusted;
  }

  const trustedIds = trusted.map((reference) => reference.id);
  const backlog = await prisma.cardVariantReferenceImage.findMany({
    where: buildQueuedReferenceWhere(
      trustedIds.length > 0
        ? {
            id: {
              notIn: trustedIds,
            },
          }
        : undefined
    ),
    take: Math.max(0, limit - trusted.length),
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
  });

  return trusted.concat(backlog);
}

export async function processReferenceImage(referenceId: string) {
  const reference = await prisma.cardVariantReferenceImage.findUnique({
    where: { id: referenceId },
  });
  if (!reference) return;

  const quality = await computeQualityScore(reference.rawImageUrl);
  const embeddings = await computeReferenceEmbeddings({
    imageUrl: reference.rawImageUrl,
    referenceId: reference.id,
  });

  await prisma.cardVariantReferenceImage.update({
    where: { id: reference.id },
    data: {
      qualityScore: quality?.score ?? reference.qualityScore ?? null,
      cropUrls: embeddings.cropUrls?.length ? embeddings.cropUrls : reference.cropUrls ?? [],
      cropEmbeddings: embeddings.embeddings.length
        ? embeddings.embeddings
        : reference.cropEmbeddings ?? Prisma.JsonNull,
    },
  });
}

export async function processPendingReferences(limit = 10) {
  warnIfEmbeddingServiceMissing();
  const pending = await fetchQueuedReferences(limit);

  for (const reference of pending) {
    await processReferenceImage(reference.id);
  }

  return pending.length;
}
