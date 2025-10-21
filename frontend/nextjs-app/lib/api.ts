const trimTrailingSlash = (input: string) => input.replace(/\/$/, "");

const defaultOrigins = {
  wallet: "http://localhost:8080",
  vault: "http://localhost:8181",
  marketplace: "http://localhost:8082",
  pricing: "http://localhost:8182",
  pack: "http://localhost:8183",
  ingestion: "http://localhost:8184",
  vending: "http://localhost:8185",
  auth: "http://localhost:8088",
};

const serviceOrigins: Record<string, string> = {
  wallet: trimTrailingSlash(process.env.NEXT_PUBLIC_WALLET_SERVICE_URL ?? defaultOrigins.wallet),
  vault: trimTrailingSlash(process.env.NEXT_PUBLIC_VAULT_SERVICE_URL ?? defaultOrigins.vault),
  marketplace: trimTrailingSlash(process.env.NEXT_PUBLIC_MARKETPLACE_SERVICE_URL ?? defaultOrigins.marketplace),
  pricing: trimTrailingSlash(process.env.NEXT_PUBLIC_PRICING_SERVICE_URL ?? defaultOrigins.pricing),
  pack: trimTrailingSlash(process.env.NEXT_PUBLIC_PACK_SERVICE_URL ?? defaultOrigins.pack),
  ingestion: trimTrailingSlash(process.env.NEXT_PUBLIC_INGESTION_SERVICE_URL ?? defaultOrigins.ingestion),
  vending: trimTrailingSlash(process.env.NEXT_PUBLIC_VENDING_SERVICE_URL ?? defaultOrigins.vending),
  auth: trimTrailingSlash(process.env.NEXT_PUBLIC_AUTH_SERVICE_URL ?? defaultOrigins.auth),
};

const fallbackBase = trimTrailingSlash(process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost");

const operatorKey = process.env.NEXT_PUBLIC_OPERATOR_KEY;

let authToken: string | null = null;

export function setAuthToken(token: string | null) {
  authToken = token;
}

type RequestOptions = RequestInit & { skipAuth?: boolean };

const service = (path: string) => {
  const cleaned = path.replace(/^\//, "");
  const [prefix, ...rest] = cleaned.split("/");
  const origin = serviceOrigins[prefix] ?? `${fallbackBase}/${prefix}`;
  const suffix = rest.join("/");
  return suffix ? `${origin}/${suffix}` : origin;
};

async function handle<T>(input: RequestInfo, init: RequestOptions = {}): Promise<T> {
  const headers = new Headers(init.headers ?? {});
  if (authToken && !init.skipAuth) {
    headers.set("Authorization", `Bearer ${authToken}`);
  }
  if (operatorKey) {
    headers.set("X-Operator-Key", operatorKey);
  }
  const res = await fetch(input, { ...init, headers });
  if (!res.ok) {
    const message = await res.text();
    throw new Error(message || res.statusText);
  }
  return res.json() as Promise<T>;
}

export async function createUser(body: { email: string; displayName?: string }) {
  return handle<{ user: any }>(service("wallet/users"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

export async function fetchWallet(userId: string) {
  return handle<{ wallet: any }>(service(`wallet/wallets/${userId}`));
}

export async function creditWallet(userId: string, payload: { amount: number; note?: string; source?: string }) {
  return handle(service(`wallet/wallets/${userId}/credit`), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
}

export async function debitWallet(userId: string, payload: { amount: number; note?: string; source?: string }) {
  return handle(service(`wallet/wallets/${userId}/debit`), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
}

export async function listListings() {
  return handle<{ listings: any[] }>(service("marketplace/listings"));
}

export async function listRecentPulls(params?: { limit?: number }) {
  const query = params?.limit ? `?limit=${encodeURIComponent(String(params.limit))}` : "";
  return handle<{ pulls: any[] }>(service(`pack/pulls/recent${query}`));
}

export async function purchaseListing(listingId: string, buyerId: string) {
  return handle(service(`marketplace/listings/${listingId}/purchase`), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ buyerId }),
  });
}

const fetchLocalPackDefinitions = async () => {
  const base = typeof window === "undefined" ? process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000" : "";
  const response = await fetch(`${base}/api/packs/definitions`, {
    headers: { "Accept": "application/json" },
  });
  if (!response.ok) {
    const message = await response.text();
    throw new Error(message || "Failed to load pack catalog");
  }
  return (await response.json()) as { definitions: any[] };
};

export async function listPacks() {
  try {
    return await handle<{ definitions: any[] }>(service("pack/definitions"));
  } catch (error) {
    try {
      return await fetchLocalPackDefinitions();
    } catch (fallbackError) {
      if (fallbackError instanceof Error) {
        throw fallbackError;
      }
      throw error instanceof Error ? error : new Error("Failed to load pack catalog");
    }
  }
}

export async function createPackDefinition(body: { name: string; description?: string; price: number }) {
  return handle(service("pack/definitions"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

export async function seedPackInstance(definitionId: string, body: { ownerId?: string; itemIds: string[] }) {
  return handle(service(`pack/definitions/${definitionId}/instances`), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

export async function purchasePack(payload: {
  packDefinitionId: string;
  userId: string;
  paymentMethod?: "wallet" | "stripe";
  paymentIntentId?: string;
}) {
  return handle<{ definition: any; pack: any; walletBalance: number | null }>(service("pack/purchase"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
}

export async function createStripePackIntent(packDefinitionId: string, userId: string) {
  return handle<{ clientSecret: string; paymentIntentId: string }>(service("pack/purchase/stripe-intent"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ packDefinitionId, userId }),
  });
}

export async function buybackItem(itemId: string, userId: string) {
  return handle<{ buybackAmount: number; walletBalance: number }>(service(`pack/items/${itemId}/buyback`), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ userId }),
  });
}

export async function listUserPacks(userId: string) {
  return handle<{ packs: any[] }>(service(`pack/users/${userId}/packs`));
}

export async function openPack(packId: string, userId: string) {
  return handle<{ pack: any }>(service(`pack/packs/${packId}/open`), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ userId }),
  });
}

export async function listIngestions() {
  return handle<{ ingestions: any[] }>(service("ingestion/ingestions"));
}

export async function createIngestion(payload: {
  ownerId: string;
  externalId?: string;
  card: {
    name: string;
    set: string;
    number?: string;
    language?: string;
    foil?: boolean;
    estimatedValue?: number;
    vaultLocation?: string;
  };
  notes?: string;
}) {
  return handle(service("ingestion/ingestions"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
}

export async function approveIngestion(id: string) {
  return handle(service(`ingestion/ingestions/${id}/approve`), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({}),
  });
}

export async function rejectIngestion(id: string, notes?: string) {
  return handle(service(`ingestion/ingestions/${id}/reject`), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ notes }),
  });
}

export async function requestLoginCode(phone: string) {
  return handle<{ status: string }>(service("auth/send-code"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ phone }),
    skipAuth: true,
  });
}

export async function verifyLoginCode(payload: { phone: string; code: string }) {
  return handle<{ token: string; expiresAt: string; user: any; wallet: any }>(service("auth/verify"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
    skipAuth: true,
  });
}
