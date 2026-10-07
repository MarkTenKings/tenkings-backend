import { createFinancialInventoryReadHandlerV2, exportCardInventoryPageV2, prisma } from '@tenkings/database';

export const config = { api: { bodyParser: false, responseLimit: '10mb' } };

export default createFinancialInventoryReadHandlerV2({
  tokenHash: () => process.env.FINANCIAL_INVENTORY_READ_TOKEN_SHA256,
  readPage: (input) => exportCardInventoryPageV2(prisma, input),
});
