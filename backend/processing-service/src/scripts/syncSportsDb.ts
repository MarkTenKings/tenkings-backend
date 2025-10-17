import { syncSportsDb } from "../sportsdb/sync";
import { config } from "../config";

async function main() {
  try {
    await syncSportsDb({ enableStats: config.sportsDbSyncStats });
    // eslint-disable-next-line no-console
    console.log("[sportsdb] sync complete");
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error("[sportsdb] sync failed", error);
    process.exit(1);
  }
}

void main();
