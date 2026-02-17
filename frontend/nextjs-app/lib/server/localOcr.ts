export type LocalOcrImage = {
  id?: string;
  url?: string;
  base64?: string;
};

export type LocalOcrResult = {
  id?: string;
  text: string;
  confidence: number;
  tokens?: LocalOcrToken[];
};

export type LocalOcrResponse = {
  results: LocalOcrResult[];
  combined_text: string;
};

export type LocalOcrToken = {
  text: string;
  confidence: number;
  image_id?: string;
  bbox?: Array<{ x: number; y: number }>;
};

export async function runLocalOcr(images: LocalOcrImage[]): Promise<LocalOcrResponse> {
  const serviceUrl = (process.env.OCR_SERVICE_URL ?? "https://ocr.api.tenkings.co/ocr").trim();
  const token = (process.env.OCR_SERVICE_TOKEN ?? "").trim();

  if (!serviceUrl) {
    throw new Error("OCR_SERVICE_URL is not configured");
  }

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }

  const res = await fetch(serviceUrl, {
    method: "POST",
    headers,
    body: JSON.stringify({ images }),
  });

  if (!res.ok) {
    const message = await res.text().catch(() => "");
    throw new Error(message || `Local OCR failed (${res.status})`);
  }

  return (await res.json()) as LocalOcrResponse;
}
