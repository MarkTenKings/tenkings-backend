import { prisma, type Prisma } from "@tenkings/database";
import {
  collectOrphanedInventoryArtifacts,
  deleteOrphanedInventoryArtifacts,
} from "../frontend/nextjs-app/lib/server/inventoryReadyPurge";

function hasFlag(flag: string) {
  return process.argv.slice(2).includes(flag);
}

function logSection(title: string) {
  console.log(`\n${title}`);
}

async function main() {
  if (hasFlag("--help")) {
    console.log("Usage: ts-node --project tsconfig.scripts.json scripts/cleanup-orphaned-inventory.ts [--confirm]");
    console.log("Runs a dry scan by default. Pass --confirm to delete orphaned inventory artifacts.");
    return;
  }

  const confirm = hasFlag("--confirm");

  const report = await collectOrphanedInventoryArtifacts(prisma);

  console.log("Inventory orphan cleanup scan");
  console.log(`- orphaned card IDs: ${report.cardIds.length}`);
  console.log(`- orphaned Items: ${report.items.length}`);
  console.log(`- orphaned ItemOwnership rows: ${report.itemOwnerships.length}`);
  console.log(`- orphaned PackLabel rows: ${report.packLabels.length}`);
  console.log(`- orphaned QrCode rows: ${report.qrCodes.length}`);

  if (report.items.length === 0) {
    console.log("\nNo orphaned inventory artifacts found.");
    return;
  }

  logSection("Items");
  for (const item of report.items) {
    console.log(`- item ${item.id} number=${item.number ?? "null"} cardQrCodeId=${item.cardQrCodeId ?? "null"}`);
  }

  logSection("ItemOwnership");
  for (const ownership of report.itemOwnerships) {
    console.log(
      `- ownership ${ownership.id} itemId=${ownership.itemId} ownerId=${ownership.ownerId} note=${ownership.note ?? ""}`
    );
  }

  logSection("PackLabel");
  for (const label of report.packLabels) {
    console.log(
      `- label ${label.id} pairId=${label.pairId} itemId=${label.itemId ?? "null"} cardQrCodeId=${label.cardQrCodeId} packQrCodeId=${label.packQrCodeId}`
    );
  }

  logSection("QrCode");
  for (const qrCode of report.qrCodes) {
    console.log(
      `- qr ${qrCode.id} type=${qrCode.type} code=${qrCode.code} serial=${qrCode.serial ?? "null"}`
    );
  }

  if (!confirm) {
    console.log("\nDry run only. Re-run with --confirm to delete these orphaned records.");
    return;
  }

  const deleted = await prisma.$transaction(async (tx: Prisma.TransactionClient) => deleteOrphanedInventoryArtifacts(tx));

  logSection("Deleted");
  console.log(`- deleted Items: ${deleted.deletedItems}`);
  console.log(`- deleted ItemOwnership rows: ${deleted.deletedItemOwnerships}`);
  console.log(`- deleted PackLabel rows: ${deleted.deletedPackLabels}`);
  console.log(`- deleted QrCode rows: ${deleted.deletedQrCodes}`);
}

main()
  .catch((error) => {
    console.error("cleanup-orphaned-inventory failed");
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
