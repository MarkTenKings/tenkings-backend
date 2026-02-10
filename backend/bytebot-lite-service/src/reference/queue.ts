import { prisma } from "@tenkings/database";
import { computeReferenceEmbeddings } from "./embedding";
import { computeQualityScore } from "./quality";

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
      cropEmbeddings: embeddings.embeddings.length ? embeddings.embeddings : reference.cropEmbeddings ?? null,
    },
  });
}

export async function processPendingReferences(limit = 10) {
  const pending = await prisma.cardVariantReferenceImage.findMany({
    where: {
      OR: [{ qualityScore: null }, { cropEmbeddings: null }],
    },
    take: limit,
    orderBy: [{ createdAt: "asc" }],
  });

  for (const reference of pending) {
    await processReferenceImage(reference.id);
  }

  return pending.length;
}
