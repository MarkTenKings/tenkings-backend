#!/usr/bin/env node
const { prisma } = require("../packages/database/dist");
const { mintAssignedCardAssets } = require("../packages/database/dist/mint");

async function main() {
  const packDefinitionId = process.argv[2];
  if (!packDefinitionId) {
    console.error("Usage: pnpm packs:mint <pack-definition-id> [seller-email]");
    process.exit(1);
  }

  const sellerEmail = process.argv[3] || process.env.PACK_INVENTORY_SELLER_EMAIL || process.env.PACK_SELLER_EMAIL;

  const result = await mintAssignedCardAssets({
    packDefinitionId,
    sellerEmail,
    prismaClient: prisma,
  });

  if (result.createdPacks === 0 && result.mintedItems === 0) {
    console.log(`No card assets assigned to pack ${packDefinitionId}. Nothing to mint.`);
    return;
  }

  const definition = await prisma.packDefinition.findUnique({
    where: { id: packDefinitionId },
    select: { inventoryCount: true },
  });

  console.log(
    `Minted ${result.mintedItems} item(s), created ${result.createdPacks} pack(s), skipped ${result.skippedCards} card(s). Current inventory: ${definition?.inventoryCount ?? 0}.`
  );
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
