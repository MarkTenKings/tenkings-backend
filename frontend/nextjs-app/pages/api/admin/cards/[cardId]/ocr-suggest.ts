import type { NextApiRequest, NextApiResponse } from "next";
import { prisma } from "@tenkings/database";
import { requireAdminSession, toErrorResponse } from "../../../../../lib/server/admin";

type SuggestResponse =
  | {
      suggestions: Record<string, string>;
      threshold: number;
      audit: Record<string, unknown>;
      status?: "pending" | "ok";
    }
  | { message: string };

type SuggestionFields = {
  playerName: string | null;
  year: string | null;
  manufacturer: string | null;
  sport: string | null;
  game: string | null;
  cardName: string | null;
  setName: string | null;
  cardNumber: string | null;
  serialNumber: string | null;
};

type SuggestionConfidence = Record<keyof SuggestionFields, number | null>;

const DEFAULT_THRESHOLD = 0.7;
const MODEL_NAME = "gpt-4o-2024-08-06";

const FIELD_KEYS: (keyof SuggestionFields)[] = [
  "playerName",
  "year",
  "manufacturer",
  "sport",
  "game",
  "cardName",
  "setName",
  "cardNumber",
  "serialNumber",
];

const SYSTEM_PROMPT = `You are extracting structured trading card fields from OCR text.
Return only JSON that matches the provided schema.`;

function sanitizeString(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length ? trimmed : null;
}

function sanitizeConfidence(value: unknown): number | null {
  if (typeof value !== "number" || Number.isNaN(value)) {
    return null;
  }
  if (value < 0) return 0;
  if (value > 1) return 1;
  return value;
}

function extractOutputText(payload: any): string | null {
  if (payload && typeof payload.output_text === "string") {
    return payload.output_text;
  }
  if (Array.isArray(payload?.output)) {
    for (const item of payload.output) {
      const content = item?.content;
      if (!Array.isArray(content)) {
        continue;
      }
      for (const entry of content) {
        if (entry?.type === "output_text" && typeof entry.text === "string") {
          return entry.text;
        }
        if (entry?.type === "output_json" && entry.json) {
          return JSON.stringify(entry.json);
        }
        if (typeof entry?.text === "string") {
          return entry.text;
        }
      }
    }
  }
  return null;
}

export default async function handler(req: NextApiRequest, res: NextApiResponse<SuggestResponse>) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ message: "Method not allowed" });
  }

  try {
    const admin = await requireAdminSession(req);
    const { cardId } = req.query;
    if (typeof cardId !== "string" || !cardId.trim()) {
      return res.status(400).json({ message: "cardId is required" });
    }

    const card = await prisma.cardAsset.findFirst({
      where: { id: cardId, batch: { uploadedById: admin.user.id } },
      select: { ocrText: true },
    });

    if (!card) {
      return res.status(404).json({ message: "Card not found" });
    }

    if (!card.ocrText || !card.ocrText.trim()) {
      return res.status(200).json({
        suggestions: {},
        threshold: DEFAULT_THRESHOLD,
        audit: { source: "openai", model: MODEL_NAME, createdAt: new Date().toISOString(), fields: {}, confidence: {} },
        status: "pending",
      });
    }

    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      return res.status(503).json({ message: "OPENAI_API_KEY is not configured" });
    }

    const schema = {
      type: "object",
      additionalProperties: false,
      properties: {
        fields: {
          type: "object",
          additionalProperties: false,
          properties: Object.fromEntries(
            FIELD_KEYS.map((key) => [key, { type: ["string", "null"] }])
          ),
          required: [],
        },
        confidence: {
          type: "object",
          additionalProperties: false,
          properties: Object.fromEntries(
            FIELD_KEYS.map((key) => [key, { type: ["number", "null"] }])
          ),
          required: [],
        },
      },
      required: ["fields", "confidence"],
    };

    const prompt = `OCR TEXT:\n${card.ocrText}\n\nRules:\n- Prefer the player name over variant names.\n- Manufacturer is the brand (Topps, Panini, Upper Deck, Leaf, etc.).\n- Year should be a 4-digit year if present.\n- For TCG, use cardName and game; for sports, use playerName and sport.`;

    const openaiRes = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: MODEL_NAME,
        input: [
          {
            role: "system",
            content: [{ type: "input_text", text: SYSTEM_PROMPT }],
          },
          {
            role: "user",
            content: [{ type: "input_text", text: prompt }],
          },
        ],
        text: {
          format: {
            type: "json_schema",
            json_schema: {
              name: "card_ocr",
              strict: true,
              schema,
            },
          },
        },
      }),
    });

    if (!openaiRes.ok) {
      const message = await openaiRes.text().catch(() => "");
      return res.status(502).json({ message: message || "OCR suggestion request failed" });
    }

    const payload = await openaiRes.json();
    const outputText = extractOutputText(payload);
    if (!outputText) {
      return res.status(502).json({ message: "OCR suggestion response was empty" });
    }

    const parsed = JSON.parse(outputText);
    const rawFields = parsed?.fields ?? {};
    const rawConfidence = parsed?.confidence ?? {};

    const fields = FIELD_KEYS.reduce((acc, key) => {
      acc[key] = sanitizeString(rawFields[key]);
      return acc;
    }, {} as SuggestionFields);

    const confidence = FIELD_KEYS.reduce((acc, key) => {
      acc[key] = sanitizeConfidence(rawConfidence[key]);
      return acc;
    }, {} as SuggestionConfidence);

    const suggestions: Record<string, string> = {};
    FIELD_KEYS.forEach((key) => {
      const value = fields[key];
      const score = confidence[key];
      if (value && score != null && score >= DEFAULT_THRESHOLD) {
        suggestions[key] = value;
      }
    });

    const audit = {
      source: "openai",
      model: MODEL_NAME,
      threshold: DEFAULT_THRESHOLD,
      createdAt: new Date().toISOString(),
      fields,
      confidence,
    };

    await prisma.cardAsset.update({
      where: { id: cardId },
      data: {
        ocrSuggestionJson: audit,
        ocrSuggestionUpdatedAt: new Date(),
      },
    });

    return res.status(200).json({
      suggestions,
      threshold: DEFAULT_THRESHOLD,
      audit,
      status: "ok",
    });
  } catch (error) {
    const response = toErrorResponse(error);
    return res.status(response.status).json({ message: response.message });
  }
}
