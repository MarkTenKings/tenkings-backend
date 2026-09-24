import { constants } from 'node:fs';
import { open } from 'node:fs/promises';
import { requireThat } from '@atlas/manual-service/contract';
import { parseDealerDirectory } from '@atlas/report-view/dealer-directory';

export function manualResearchSettings(env) {
  if (env.ATLAS_MANUAL_RESEARCH_ENABLED !== 'true') return null;
  requireThat(env.ATLAS_MANUAL_PRESENTATION_ENABLED === 'true' && env.ATLAS_MANUAL_MARKET_ENABLED === 'true',
    503, 'RESEARCH_PRESENTATION_REQUIRED');
  const key = value => typeof value === 'string' && value.length >= 16 && value.length <= 4096 && !/[\s\x00-\x1f\x7f]/.test(value);
  requireThat(key(env.ATLAS_MANUAL_OPENAI_KEY) && key(env.ATLAS_MANUAL_SOLD_COMPS_API_KEY), 503, 'RESEARCH_CONFIGURATION_INVALID');
  const catalogEnabled = env.ATLAS_MANUAL_CATALOG_ENABLED === 'true';
  requireThat(!catalogEnabled || /^[A-Za-z0-9_-]{43,128}$/.test(env.ATLAS_MANUAL_CATALOG_TOKEN ?? ''),
    503, 'RESEARCH_CATALOG_CONFIGURATION_INVALID');
  return Object.freeze({ openaiApiKey: env.ATLAS_MANUAL_OPENAI_KEY, soldCompsApiKey: env.ATLAS_MANUAL_SOLD_COMPS_API_KEY,
    catalogToken: catalogEnabled ? env.ATLAS_MANUAL_CATALOG_TOKEN : null });
}

// Only an explicitly mounted, root-owned configuration file is admitted. Read
// afresh for each offer decision so revocation does not wait for a deployment.
export async function readDealerOfferFile(path, { openFile = open } = {}) {
  requireThat(path === '/run/atlas-dealers/offers.json', 503, 'DEALER_OFFERS_CONFIGURATION_INVALID');
  let file;
  try {
    file = await openFile(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    const before = await file.stat();
    requireThat(before.isFile() && before.uid === 0 && before.nlink === 1 && !(before.mode & 0o022)
      && before.size > 0 && before.size <= 512 * 1024, 503, 'DEALER_OFFERS_CONFIGURATION_INVALID');
    const bytes = Buffer.alloc(before.size + 1);
    let bytesRead = 0;
    while (bytesRead < bytes.length) {
      const part = await file.read(bytes, bytesRead, bytes.length - bytesRead, bytesRead);
      if (!part.bytesRead) break;
      bytesRead += part.bytesRead;
    }
    const after = await file.stat();
    requireThat(bytesRead === before.size && after.size === before.size && after.mtimeMs === before.mtimeMs
      && after.ctimeMs === before.ctimeMs && after.nlink === 1 && after.uid === before.uid && after.mode === before.mode,
    503, 'DEALER_OFFERS_CONFIGURATION_INVALID');
    return JSON.parse(bytes.subarray(0, bytesRead).toString('utf8'));
  } catch { requireThat(false, 503, 'DEALER_OFFERS_CONFIGURATION_INVALID'); }
  finally { await file?.close().catch(() => {}); }
}

export function manualDealerConfigurationLoader(env, { readOffers = readDealerOfferFile } = {}) {
  if (env.ATLAS_MANUAL_PRESENTATION_ENABLED !== 'true') return null;
  const raw = env.ATLAS_MANUAL_DEALER_DIRECTORY_JSON, path = env.ATLAS_MANUAL_DEALER_OFFERS_PATH;
  if (!raw && !path) return null;
  let directory;
  try {
    requireThat(typeof raw === 'string' && Buffer.byteLength(raw) <= 128 * 1024);
    directory = parseDealerDirectory(JSON.parse(raw));
    requireThat(!path || path === '/run/atlas-dealers/offers.json');
  } catch { requireThat(false, 503, 'DEALER_OFFERS_CONFIGURATION_INVALID'); }
  // No file, network or provider access during service construction.
  return async () => ({ directory: structuredClone(directory), offers: path ? await readOffers(path) : { version: 'atlas-dealer-offers-v1', offers: [] } });
}
