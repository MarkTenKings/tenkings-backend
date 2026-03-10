type ExtraHeaders = Record<string, string | undefined>;

export function buildAdminHeaders(token?: string | null, extra: ExtraHeaders = {}) {
  const headers: Record<string, string> = {};
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }
  for (const [key, value] of Object.entries(extra)) {
    if (typeof value === "string") {
      headers[key] = value;
    }
  }
  return headers;
}
