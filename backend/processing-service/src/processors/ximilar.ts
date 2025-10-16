import { config } from "../config";

interface ClassificationResult {
  labels: Array<{ label: string; score: number }>;
  endpoint: string | null;
  bestMatch: Record<string, unknown> | null;
  tags: string[];
  raw: unknown;
}

const COLLECTIBLES_BASE_URL = "https://api.ximilar.com/collectibles";

type EndpointDescriptor = {
  name: string;
  path: string;
  bodyExtras?: Record<string, unknown>;
  recordExtras?: Record<string, unknown>;
};

const ENDPOINTS: EndpointDescriptor[] = [
  {
    name: "sport_id",
    path: "/v2/sport_id",
    bodyExtras: {
      slab_id: true,
      slab_grade: true,
      pricing: false,
    },
    recordExtras: {
      "Top Category": "Card",
      Category: "Card/Sport Card",
      Side: "front",
    },
  },
  {
    name: "tcg_id",
    path: "/v2/tcg_id",
    bodyExtras: {
      slab_id: true,
      slab_grade: true,
      pricing: false,
    },
    recordExtras: {
      "Top Category": "Card",
      Category: "Card/Trading Card Game",
      Side: "front",
    },
  },
  {
    name: "comics_id",
    path: "/v2/comics_id",
    bodyExtras: {
      slab_id: true,
      pricing: false,
    },
    recordExtras: {
      Category: "Comics",
      Side: "front",
    },
  },
  {
    name: "analyze",
    path: "/v2/analyze",
  },
];

function extractClassification(payload: any, endpoint: string): ClassificationResult | null {
  const record = payload?.records?.[0];
  if (!record) {
    return null;
  }

  const objects: any[] = Array.isArray(record?._objects) ? record._objects : [];
  const targetObject =
    objects.find((obj) => obj?._identification?.best_match) ??
    objects.find((obj) => Array.isArray(obj?._tags_simple) && obj._tags_simple.length > 0) ??
    objects[0] ??
    null;

  if (!targetObject) {
    return {
      endpoint,
      labels: [],
      bestMatch: null,
      tags: [],
      raw: payload,
    };
  }

  const bestMatch = targetObject?._identification?.best_match ?? null;
  const tags: string[] = Array.isArray(targetObject?._tags_simple) ? targetObject._tags_simple : [];
  const probability = typeof targetObject?.prob === "number" ? targetObject.prob : 1;

  const labels: Array<{ label: string; score: number }> = [];
  if (bestMatch) {
    const preferredFields = ["full_name", "name", "title"];
    for (const field of preferredFields) {
      const value = (bestMatch as Record<string, unknown>)[field];
      if (typeof value === "string" && value.trim().length > 0) {
        labels.push({ label: value.trim(), score: probability });
        break;
      }
    }
  }

  if (labels.length === 0 && tags.length > 0) {
    const tagScore = probability / tags.length || probability;
    for (const tag of tags) {
      labels.push({ label: String(tag), score: tagScore });
    }
  }

  return {
    endpoint,
    labels,
    bestMatch: bestMatch ?? null,
    tags,
    raw: payload,
  };
}

async function callEndpoint(
  endpoint: EndpointDescriptor,
  options: { imageBase64: string; ocrText: string | null },
  approxBytes: number,
  maxBytes: number
): Promise<ClassificationResult | null> {
  const record: Record<string, unknown> = {
    _base64: options.imageBase64,
  };

  if (options.ocrText) {
    record._text = options.ocrText;
  }

  if (endpoint.recordExtras) {
    Object.assign(record, endpoint.recordExtras);
  }

  const body = {
    records: [record],
    ...(endpoint.bodyExtras ?? {}),
  };

  const response = await fetch(`${COLLECTIBLES_BASE_URL}${endpoint.path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Token ${config.ximilarApiKey}`,
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const errorText = await response.text();
    if (response.status === 404 || response.status === 422 || response.status === 400) {
      console.warn(
        `[processing-service] Ximilar ${endpoint.name} endpoint returned ${response.status}: ${errorText.slice(0, 160)}`
      );
      return null;
    }
    if (response.status === 413) {
      console.warn(
        `[processing-service] Ximilar ${endpoint.name} rejected payload even after compression (approx=${approxBytes} limit=${maxBytes})`
      );
      return {
        endpoint: endpoint.name,
        labels: [{ label: "image_too_large", score: 1 }],
        bestMatch: null,
        tags: [],
        raw: {
          error: "payload_too_large",
          status: response.status,
          body: errorText,
        },
      };
    }
    throw new Error(`Ximilar ${endpoint.name} failed: ${response.status} ${errorText}`);
  }

  const payload = await response.json();
  return extractClassification(payload, endpoint.name);
}

export async function classifyAsset(options: {
  imageBase64: string;
  ocrText: string | null;
}): Promise<ClassificationResult> {
  if (!config.ximilarApiKey) {
    return {
      labels: [{ label: "classification_stub", score: 1 }],
      endpoint: null,
      bestMatch: null,
      tags: [],
      raw: null,
    };
  }

  const approxBytes = Math.ceil((options.imageBase64.length * 3) / 4);
  const maxBytes = Number.isFinite(config.ximilarMaxImageBytes) && config.ximilarMaxImageBytes > 0
    ? config.ximilarMaxImageBytes
    : 2_500_000;

  if (approxBytes > maxBytes) {
    console.warn(
      `[processing-service] Ximilar classification skipped (image too large: ${approxBytes} bytes, limit ${maxBytes} bytes)`
    );
    return {
      labels: [{ label: "image_too_large", score: 1 }],
      endpoint: null,
      bestMatch: null,
      tags: [],
      raw: {
        skipped: true,
        reason: "image_too_large",
        sizeBytes: approxBytes,
        limitBytes: maxBytes,
      },
    };
  }

  if (options.ocrText) {
    console.log(
      `[processing-service] Ximilar text hint: ${options.ocrText.replace(/\s+/g, " ").slice(0, 120)}`
    );
  }

  for (const endpoint of ENDPOINTS) {
    const classification = await callEndpoint(endpoint, options, approxBytes, maxBytes);
    if (!classification) {
      continue;
    }

    if (
      classification.labels.length > 0 ||
      classification.bestMatch !== null ||
      classification.tags.length > 0
    ) {
      return classification;
    }
  }

  return {
    labels: [{ label: "classification_unavailable", score: 1 }],
    endpoint: null,
    bestMatch: null,
    tags: [],
    raw: null,
  };
}
