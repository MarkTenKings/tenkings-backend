import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import {
  replaySpeedsterMapFilter,
  type SpeedsterMapFilterReplayCard,
} from "../../frontend/nextjs-app/lib/ai-grader-v2/map-filter-replay";

function argument(name: string) {
  const index = process.argv.indexOf(name);
  const value = index >= 0 ? process.argv[index + 1] : null;
  if (!value || value.startsWith("--")) throw new Error(`${name} is required.`);
  return resolve(value);
}

const manifestPath = argument("--manifest");
const mapsPath = argument("--maps");
const [manifestText, mapsText] = await Promise.all([
  readFile(manifestPath, "utf8"),
  readFile(mapsPath, "utf8"),
]);
const manifest = JSON.parse(manifestText) as { cards: Array<Omit<SpeedsterMapFilterReplayCard, "map"> & {
  mapRevisionId: string | null;
}> };
const mapFixture = JSON.parse(mapsText) as { revisions: SpeedsterMapFilterReplayCard["map"][] };
if (!Array.isArray(manifest.cards) || !Array.isArray(mapFixture.revisions)) {
  throw new Error("Replay inputs are malformed.");
}
const maps = new Map(mapFixture.revisions.flatMap((entry) =>
  entry ? [[entry.revision.revisionId, entry] as const] : []));
const cards = manifest.cards.map(({ mapRevisionId, ...card }) => ({
  ...card,
  map: mapRevisionId ? maps.get(mapRevisionId) ?? null : null,
})) as SpeedsterMapFilterReplayCard[];

process.stdout.write(`${JSON.stringify(replaySpeedsterMapFilter(cards), null, 2)}\n`);
