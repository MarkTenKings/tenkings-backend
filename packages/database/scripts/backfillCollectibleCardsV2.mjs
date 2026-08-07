import { createRequire } from "node:module";

import { PrismaClient } from "@prisma/client";

const require = createRequire(import.meta.url);
const {
  createCardFromSpeedster,
  listSpeedsterCardBackfillCandidates,
} = require("../dist/database/src/cardPlatformV2.js");

const CONFIRMATION = "APPLY_APPROVED_TEN_KINGS_V2_CARD_BACKFILL";

function parseArgs(argv) {
  const result = { apply: false, confirmation: null, approvedSessionIds: [] };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--apply") {
      result.apply = true;
      continue;
    }
    if (arg === "--approved-session-id") {
      const value = argv[index + 1]?.trim();
      if (!value) throw new Error("--approved-session-id requires an exact session ID");
      result.approvedSessionIds.push(value);
      index += 1;
      continue;
    }
    if (arg.startsWith("--approved-session-id=")) {
      const value = arg.slice("--approved-session-id=".length).trim();
      if (!value) throw new Error("--approved-session-id requires an exact session ID");
      result.approvedSessionIds.push(value);
      continue;
    }
    if (arg === "--confirm") {
      result.confirmation = argv[index + 1] ?? null;
      index += 1;
      continue;
    }
    if (arg.startsWith("--confirm=")) {
      result.confirmation = arg.slice("--confirm=".length);
      continue;
    }
    if (arg === "--help" || arg === "-h") return { ...result, help: true };
    throw new Error(`Unknown argument: ${arg}`);
  }
  result.approvedSessionIds = [...new Set(result.approvedSessionIds)];
  return result;
}

function usage() {
  console.log(`Usage:
  pnpm --filter @tenkings/database backfill:v2:cards
  pnpm --filter @tenkings/database backfill:v2:cards --apply \\
    --approved-session-id <reviewed-session-id> \\
    --confirm ${CONFIRMATION}

Default mode is zero-write dry-run. It prints every technically eligible historical Speedster session. Each ID must then be manually reviewed to exclude abandoned, discarded, fixture, demo, or known test sessions. Apply mode accepts only explicitly approved IDs and requires the exact typed confirmation.`);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    usage();
    return;
  }
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required");
  if (!args.apply && (args.approvedSessionIds.length || args.confirmation)) {
    throw new Error("Approval arguments are accepted only with --apply");
  }
  if (args.apply && !args.approvedSessionIds.length) {
    throw new Error("--apply requires at least one exact --approved-session-id reviewed by Mark");
  }
  if (args.apply && args.confirmation !== CONFIRMATION) {
    throw new Error(`--apply requires --confirm ${CONFIRMATION}`);
  }

  const prisma = new PrismaClient();
  try {
    const candidates = await listSpeedsterCardBackfillCandidates(prisma);
    console.log(JSON.stringify({
      mode: args.apply ? "apply" : "dry-run",
      technicallyEligibleCount: candidates.length,
      technicallyEligible: candidates,
      reviewRequired: "Every ID requires owner review; demo/test/fixture/abandoned/discarded sessions must be omitted.",
    }, null, 2));
    if (!args.apply) return;

    const targetsById = new Map(candidates.map((candidate) => [candidate.sessionId, candidate]));
    const existingCards = await prisma.collectibleCardV2.findMany({
      where: {
        speedsterSessionId: {
          in: args.approvedSessionIds.filter((id) => !targetsById.has(id)),
        },
      },
      select: {
        speedsterSessionId: true,
        humanGradeLabelId: true,
        publicReportSlug: true,
      },
    });
    for (const card of existingCards) {
      targetsById.set(card.speedsterSessionId, {
        sessionId: card.speedsterSessionId,
        humanGradeLabelId: card.humanGradeLabelId,
        publicReportSlug: card.publicReportSlug,
      });
    }
    const unapprovedOrIneligible = args.approvedSessionIds.filter((id) => !targetsById.has(id));
    if (unapprovedOrIneligible.length) {
      throw new Error(`Approved IDs are not in the current dry-run candidate set: ${unapprovedOrIneligible.join(", ")}`);
    }

    const created = await prisma.$transaction(async (tx) => {
      const rows = [];
      for (const sessionId of args.approvedSessionIds) {
        const candidate = targetsById.get(sessionId);
        rows.push(await createCardFromSpeedster(tx, sessionId, candidate.humanGradeLabelId));
      }
      return rows;
    });
    console.log(JSON.stringify({
      mode: "apply-complete",
      appliedCount: created.length,
      cards: created.map(({ id, speedsterSessionId, publicToken }) => ({ id, speedsterSessionId, publicToken })),
    }, null, 2));
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : "Unknown V2 card backfill failure");
  process.exitCode = 1;
});
