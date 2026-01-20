import { enqueueBytebotLiteJob } from "@tenkings/database";

type Args = {
  query?: string;
  sources?: string[];
  cardAssetId?: string;
  maxComps?: number;
  maxAgeDays?: number;
};

function parseArgs(argv: string[]): Args {
  const args: Args = {};
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--query") {
      args.query = argv[i + 1];
      i += 1;
      continue;
    }
    if (arg === "--sources") {
      args.sources = argv[i + 1]?.split(",").map((value) => value.trim());
      i += 1;
      continue;
    }
    if (arg === "--card-asset-id") {
      args.cardAssetId = argv[i + 1];
      i += 1;
      continue;
    }
    if (arg === "--max-comps") {
      args.maxComps = Number(argv[i + 1]);
      i += 1;
      continue;
    }
    if (arg === "--max-age-days") {
      args.maxAgeDays = Number(argv[i + 1]);
      i += 1;
      continue;
    }
  }
  return args;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.query) {
    console.error("Usage: --query \"search terms\" [--sources ebay_sold,tcgplayer]");
    process.exit(1);
  }

  const sources = (args.sources ?? ["ebay_sold", "tcgplayer"]).filter(Boolean);

  const job = await enqueueBytebotLiteJob({
    searchQuery: args.query,
    sources,
    cardAssetId: args.cardAssetId,
    maxComps: args.maxComps,
    maxAgeDays: args.maxAgeDays,
    payload: {
      query: args.query,
      sources,
    },
  });

  console.log(`Enqueued job ${job.id}`);
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : "Unknown error";
  console.error(`Failed to enqueue job: ${message}`);
  process.exit(1);
});
