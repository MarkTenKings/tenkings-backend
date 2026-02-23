export type OcrImageInput = {
  id?: string;
  url?: string;
  base64?: string;
};

export type OcrToken = {
  text: string;
  confidence: number;
  image_id?: string;
  bbox?: Array<{ x: number; y: number }>;
};

export type OcrResult = {
  id?: string;
  text: string;
  confidence: number;
  tokens?: OcrToken[];
};

export type OcrResponse = {
  results: OcrResult[];
  combined_text: string;
};

const GOOGLE_VISION_ENDPOINT = "https://vision.googleapis.com/v1/images:annotate";

const clampConfidence = (value: unknown): number => {
  if (typeof value !== "number" || Number.isNaN(value)) {
    return 0;
  }
  if (value < 0) {
    return 0;
  }
  if (value > 1) {
    return 1;
  }
  return value;
};

const normalizeBase64Input = (input: string): string => {
  const trimmed = input.trim();
  if (!trimmed) {
    return "";
  }
  const markerIndex = trimmed.indexOf("base64,");
  if (markerIndex >= 0) {
    return trimmed.slice(markerIndex + "base64,".length).trim();
  }
  return trimmed;
};

const toWordText = (word: any): string => {
  const symbols = Array.isArray(word?.symbols) ? word.symbols : [];
  return symbols
    .map((symbol: any) => (typeof symbol?.text === "string" ? symbol.text : ""))
    .join("")
    .trim();
};

const toBoundingBox = (word: any): Array<{ x: number; y: number }> => {
  const vertices = Array.isArray(word?.boundingBox?.vertices) ? word.boundingBox.vertices : [];
  return vertices
    .map((vertex: any) => {
      const x = typeof vertex?.x === "number" && Number.isFinite(vertex.x) ? vertex.x : 0;
      const y = typeof vertex?.y === "number" && Number.isFinite(vertex.y) ? vertex.y : 0;
      return { x, y };
    })
    .slice(0, 8);
};

const parseVisionTokens = (response: any, imageId: string | undefined): OcrToken[] => {
  const pages = Array.isArray(response?.fullTextAnnotation?.pages) ? response.fullTextAnnotation.pages : [];
  const tokens: OcrToken[] = [];

  pages.forEach((page: any) => {
    const blocks = Array.isArray(page?.blocks) ? page.blocks : [];
    blocks.forEach((block: any) => {
      const paragraphs = Array.isArray(block?.paragraphs) ? block.paragraphs : [];
      paragraphs.forEach((paragraph: any) => {
        const words = Array.isArray(paragraph?.words) ? paragraph.words : [];
        words.forEach((word: any) => {
          const text = toWordText(word);
          if (!text) {
            return;
          }
          tokens.push({
            text,
            confidence: clampConfidence(word?.confidence),
            image_id: imageId,
            bbox: toBoundingBox(word),
          });
        });
      });
    });
  });

  return tokens;
};

const extractResponseText = (response: any): string => {
  if (typeof response?.fullTextAnnotation?.text === "string" && response.fullTextAnnotation.text.trim()) {
    return response.fullTextAnnotation.text.trim();
  }
  const textAnnotations = Array.isArray(response?.textAnnotations) ? response.textAnnotations : [];
  const first = textAnnotations.find((entry: any) => typeof entry?.description === "string" && entry.description.trim());
  if (first?.description) {
    return first.description.trim();
  }
  return "";
};

const extractResultConfidence = (tokens: OcrToken[]): number => {
  if (!tokens.length) {
    return 0;
  }
  const sum = tokens.reduce((total, token) => total + clampConfidence(token.confidence), 0);
  return clampConfidence(sum / tokens.length);
};

const toImageContent = async (image: OcrImageInput): Promise<string> => {
  if (typeof image.base64 === "string" && image.base64.trim()) {
    return normalizeBase64Input(image.base64);
  }
  if (typeof image.url === "string" && image.url.trim()) {
    const response = await fetch(image.url, { method: "GET" });
    if (!response.ok) {
      const body = await response.text().catch(() => "");
      throw new Error(`Failed to fetch OCR image (${response.status})${body ? `: ${body.slice(0, 160)}` : ""}`);
    }
    const bytes = await response.arrayBuffer();
    return Buffer.from(bytes).toString("base64");
  }
  throw new Error("OCR image requires `url` or `base64`.");
};

export async function runGoogleVisionOcr(images: OcrImageInput[]): Promise<OcrResponse> {
  const apiKey = (process.env.GOOGLE_VISION_API_KEY ?? "").trim();
  if (!apiKey) {
    throw new Error("GOOGLE_VISION_API_KEY is not configured");
  }
  if (!Array.isArray(images) || images.length === 0) {
    return { results: [], combined_text: "" };
  }

  const prepared = await Promise.all(
    images.map(async (image) => ({
      id: typeof image.id === "string" ? image.id : undefined,
      content: await toImageContent(image),
    }))
  );

  const response = await fetch(`${GOOGLE_VISION_ENDPOINT}?key=${encodeURIComponent(apiKey)}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      requests: prepared.map((entry) => ({
        image: { content: entry.content },
        features: [{ type: "DOCUMENT_TEXT_DETECTION" }],
      })),
    }),
  });

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(`Google Vision request failed (${response.status})${body ? `: ${body.slice(0, 200)}` : ""}`);
  }

  const payload = (await response.json()) as {
    error?: { message?: string };
    responses?: Array<Record<string, unknown>>;
  };

  if (payload?.error?.message) {
    throw new Error(payload.error.message);
  }

  const responses = Array.isArray(payload.responses) ? payload.responses : [];
  const results = prepared.map((entry, index) => {
    const raw = responses[index] as any;
    const tokens = parseVisionTokens(raw, entry.id);
    const text = extractResponseText(raw);
    return {
      id: entry.id,
      text,
      confidence: extractResultConfidence(tokens),
      tokens,
    };
  });

  const combinedText = results
    .map((result) => (typeof result.text === "string" ? result.text.trim() : ""))
    .filter(Boolean)
    .join("\n\n");

  return {
    results,
    combined_text: combinedText,
  };
}
