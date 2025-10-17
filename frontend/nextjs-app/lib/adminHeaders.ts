const operatorKey = process.env.NEXT_PUBLIC_OPERATOR_KEY;

type ExtraHeaders = Record<string, string | undefined>;

export function buildAdminHeaders(token?: string | null, extra: ExtraHeaders = {}) {
  const headers: Record<string, string> = {};
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }
  if (operatorKey) {
    headers["X-Operator-Key"] = operatorKey;
  }
  for (const [key, value] of Object.entries(extra)) {
    if (typeof value === "string") {
      headers[key] = value;
    }
  }
  return headers;
}
