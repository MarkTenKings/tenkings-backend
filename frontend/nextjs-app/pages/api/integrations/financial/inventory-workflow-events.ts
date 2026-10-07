import { createFinancialWorkflowReadHandlerV2, exportInventoryWorkflowPageV2, prisma } from '@tenkings/database';
export const config = { api: { bodyParser: false, responseLimit: '10mb' } };
export default createFinancialWorkflowReadHandlerV2({ tokenHash: () => process.env.FINANCIAL_INVENTORY_READ_TOKEN_SHA256, readPage: input => exportInventoryWorkflowPageV2(prisma, input) });
