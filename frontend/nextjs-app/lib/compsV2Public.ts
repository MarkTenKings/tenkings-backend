export type PublicCompsV2Projection = {
  averageSoldPriceCents: number;
  comps: Array<{ id: string; imageUrl: string; soldPriceCents: number; soldDate: string; listingUrl: string }>;
};

const record = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === "object" && !Array.isArray(value);
const MAX_CENTS = 2_147_483_647;

const canonicalListing = (value: unknown) => {
  if (typeof value !== "string" || value.length > 500) return null;
  try {
    const url = new URL(value);
    const host = url.hostname.toLowerCase();
    const match = url.pathname.match(/^\/itm\/(\d{6,20})\/?$/);
    return url.protocol === "https:" && !url.username && !url.password &&
      (host === "ebay.com" || host.endsWith(".ebay.com")) && match?.[1] && !url.search && !url.hash
      ? `https://www.ebay.com/itm/${match[1]}`
      : null;
  } catch {
    return null;
  }
};

const approvedImage = (value: unknown) => {
  if (typeof value !== "string" || value.length > 1000) return null;
  try {
    const url = new URL(value);
    const host = url.hostname.toLowerCase();
    const allowed = host === "ebayimg.com" || host.endsWith(".ebayimg.com") || host === "ebaystatic.com" || host.endsWith(".ebaystatic.com");
    return url.protocol === "https:" && !url.username && !url.password && allowed ? url.toString() : null;
  } catch {
    return null;
  }
};
const canonicalSoldDate = (value: unknown) => {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const epoch = Date.parse(`${value}T00:00:00.000Z`);
  return Number.isFinite(epoch) && new Date(epoch).toISOString().slice(0, 10) === value ? value : null;
};

export function projectPublicCompsV2(input: { compsPublic?: boolean; compsSnapshot?: unknown }): PublicCompsV2Projection | null {
  if (!input.compsPublic || !record(input.compsSnapshot) || !Array.isArray(input.compsSnapshot.candidates) || input.compsSnapshot.candidates.length > 60) return null;
  if (!record(input.compsSnapshot.confirmation) || !Number.isSafeInteger(input.compsSnapshot.confirmation.marketValueCents) || Number(input.compsSnapshot.confirmation.marketValueCents) <= 0 || Number(input.compsSnapshot.confirmation.marketValueCents) > MAX_CENTS ||
    typeof input.compsSnapshot.confirmation.confirmedByAdminId !== "string" || !input.compsSnapshot.confirmation.confirmedByAdminId.trim() || input.compsSnapshot.confirmation.confirmedByAdminId.length > 256 ||
    typeof input.compsSnapshot.confirmation.confirmedAt !== "string" || !Number.isFinite(Date.parse(input.compsSnapshot.confirmation.confirmedAt)) ||
    new Date(Date.parse(input.compsSnapshot.confirmation.confirmedAt)).toISOString() !== input.compsSnapshot.confirmation.confirmedAt) return null;
  const selected = input.compsSnapshot.candidates.filter((candidate) => record(candidate) && candidate.included === true);
  if (!selected.length) return null;
  const comps = selected.map((candidate) => {
    const row = candidate as Record<string, unknown>;
    const id = typeof row.id === "string" && row.id.length <= 100 ? row.id : null;
    const listingUrl = canonicalListing(row.listingUrl);
    const imageUrl = approvedImage(row.imageUrl);
    const soldPriceCents = Number.isSafeInteger(row.soldPriceCents) && Number(row.soldPriceCents) > 0 && Number(row.soldPriceCents) <= MAX_CENTS ? Number(row.soldPriceCents) : null;
    const soldDate = canonicalSoldDate(row.soldDate);
    return id && listingUrl && imageUrl && soldPriceCents && soldDate
      ? { id, listingUrl, imageUrl, soldPriceCents, soldDate }
      : null;
  });
  if (comps.some((comp) => !comp)) return null;
  const safeComps = comps as PublicCompsV2Projection["comps"];
  const divisor = BigInt(safeComps.length);
  const total = safeComps.reduce((sum, comp) => sum + BigInt(comp.soldPriceCents), 0n);
  const averageSoldPriceCents = Number((total + divisor / 2n) / divisor);
  if (input.compsSnapshot.confirmation.marketValueCents !== averageSoldPriceCents) return null;
  return {
    averageSoldPriceCents,
    comps: safeComps,
  };
}
