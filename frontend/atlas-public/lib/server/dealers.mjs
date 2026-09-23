import { EMPTY_DEALER_DIRECTORY, activeDealers } from '../dealers.mjs';
/** Server-configured approved locations only. No directory entry is inferred
 * from a generic card-shop search or from Ten Kings inventory locations. */
export function dealerDirectory(env = process.env, now = Date.now()) {
  const source = env.ATLAS_PUBLIC_DEALER_DIRECTORY_JSON;
  if (source && Buffer.byteLength(source) > 512000) throw new Error('DEALER_DIRECTORY_INVALID');
  const document = source ? JSON.parse(source) : EMPTY_DEALER_DIRECTORY;
  const dealers = activeDealers(document,now);
  const apiKey = env.ATLAS_PUBLIC_GOOGLE_MAPS_BROWSER_KEY, mapId = env.ATLAS_PUBLIC_GOOGLE_MAP_ID;
  const map = apiKey && mapId && /^[A-Za-z0-9_-]{20,200}$/.test(apiKey) && /^[A-Za-z0-9_-]{8,100}$/.test(mapId)
    ? {apiKey,mapId} : null;
  return {dealers,updatedAt:document.updatedAt,map};
}
