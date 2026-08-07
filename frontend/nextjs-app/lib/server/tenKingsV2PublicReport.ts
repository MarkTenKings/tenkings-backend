import type { Prisma } from "@tenkings/database";

export const nonVoidSpeedsterCardFilter: Prisma.AiGraderV2SessionWhereInput = {
  OR: [
    { collectibleCardV2: { is: null } },
    { collectibleCardV2: { is: { lifecycleState: { not: "VOID" } } } },
  ],
};

export const activeSpeedsterPublicReportWhere = (
  publicReportSlug: string,
): Prisma.AiGraderV2SessionWhereInput => ({
  publicReportSlug,
  workflowState: "COMPLETED",
  ...nonVoidSpeedsterCardFilter,
});
