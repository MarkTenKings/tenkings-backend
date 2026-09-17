/** Exact server-configured Preview access; no wildcard host or forwarded-header trust. */
export function providerQualificationPreviewHost(env: Record<string, string | undefined>): string | null {
  const host = env.STAFF_RESEARCH_PROVIDER_QUALIFICATION_PREVIEW_HOST;
  if (env.VERCEL_ENV !== 'preview' || !host || host !== env.VERCEL_BRANCH_URL) return null;
  // Require a single platform branch hostname, without ports, paths or aliases.
  return /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.vercel\.app$/.test(host) ? host : null;
}

export function providerQualificationHost(host: string | undefined, production: boolean, env: Record<string, string | undefined> = {}) {
  return host === 'collect.tenkings.co'
    || !production && /^(?:localhost|127\.0\.0\.1)(?::\d{1,5})?$/.test(host ?? '')
    || Boolean(host && host === providerQualificationPreviewHost(env));
}
