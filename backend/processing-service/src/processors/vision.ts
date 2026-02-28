import { config } from "../config";

interface VisionResult {
  text: string;
  raw: unknown;
}

export async function extractTextFromImage(imageBase64: string): Promise<VisionResult> {
  if (!config.googleVisionApiKey) {
    return {
      text: "(vision stub) supply GOOGLE_VISION_API_KEY to enable OCR",
      raw: null,
    };
  }

  const response = await fetch(
    `https://vision.googleapis.com/v1/images:annotate?key=${config.googleVisionApiKey}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        requests: [
          {
            image: { content: imageBase64 },
            features: [{ type: "DOCUMENT_TEXT_DETECTION" }],
          },
        ],
      }),
    }
  );

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Vision API failed: ${response.status} ${errorText}`);
  }

  const payload = (await response.json()) as any;
  const fullText = payload?.responses?.[0]?.fullTextAnnotation?.text;
  const annotationText = payload?.responses?.[0]?.textAnnotations?.[0]?.description;
  const text =
    typeof fullText === "string" && fullText.trim()
      ? fullText.trim()
      : typeof annotationText === "string"
      ? annotationText.trim()
      : "";

  return {
    text,
    raw: payload,
  };
}
