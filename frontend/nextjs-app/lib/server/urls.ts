const trimTrailingSlash = (value: string) => value.replace(/\/$/, "");

const ensureProtocol = (value: string) => {
  if (/^https?:\/\//i.test(value)) {
    return value;
  }
  return `https://${value}`;
};

let cachedSiteUrl: string | null = null;

export function resolveSiteUrl(): string {
  if (cachedSiteUrl) {
    return cachedSiteUrl;
  }

  const candidates = [
    process.env.SITE_URL,
    process.env.NEXT_PUBLIC_SITE_URL,
    process.env.TENKINGS_SITE_URL,
    process.env.VERCEL_URL,
  ].filter((value): value is string => typeof value === "string" && value.trim().length > 0);

  const raw = candidates[0]?.trim() ?? "http://localhost:3000";
  const normalized = trimTrailingSlash(ensureProtocol(raw));
  cachedSiteUrl = normalized;
  return normalized;
}

export function buildSiteUrl(path: string): string {
  const base = resolveSiteUrl();
  const suffix = path.startsWith("/") ? path : `/${path}`;
  return `${base}${suffix}`;
}
