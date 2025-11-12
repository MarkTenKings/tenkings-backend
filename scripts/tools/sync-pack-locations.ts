import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  const labels = await prisma.packLabel.findMany({
    include: {
      packInstance: { select: { id: true, locationId: true } },
      cardQrCode: { select: { id: true, locationId: true } },
      packQrCode: { select: { id: true, locationId: true } },
    },
  });

  let updated = 0;
  for (const label of labels) {
    const targetLocationId = label.packInstance?.locationId ?? null;
    const needsSync =
      label.locationId !== targetLocationId ||
      label.cardQrCode.locationId !== targetLocationId ||
      label.packQrCode.locationId !== targetLocationId;

    if (!needsSync) {
      continue;
    }

    await prisma.$transaction(async (tx) => {
      await tx.packLabel.update({ where: { id: label.id }, data: { locationId: targetLocationId } });
      await tx.qrCode.update({ where: { id: label.cardQrCode.id }, data: { locationId: targetLocationId } });
      await tx.qrCode.update({ where: { id: label.packQrCode.id }, data: { locationId: targetLocationId } });
      if (label.packInstance) {
        await tx.packInstance.update({ where: { id: label.packInstance.id }, data: { locationId: targetLocationId } });
      }
    });
    updated += 1;
  }

  console.log(`Synchronized ${updated} pack labels.`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
