import type { NextApiRequest, NextApiResponse } from "next";
import crypto from "node:crypto";
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
  numbered: string | null;
  autograph: string | null;
  memorabilia: string | null;
  graded: string | null;
  gradeCompany: string | null;
  gradeValue: string | null;
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
  "numbered",
  "autograph",
  "memorabilia",
  "graded",
  "gradeCompany",
  "gradeValue",
];

const SYSTEM_PROMPT = `You are extracting structured trading card fields from OCR text.
Return only JSON that matches the provided schema.`;

function buildProxyUrl(req: NextApiRequest, targetUrl: string): string | null {
  const secret = process.env.OCR_PROXY_SECRET ?? process.env.OPENAI_API_KEY;
  if (!secret) {
    return null;
  }
  const host = req.headers.host;
  if (!host) {
    return null;
  }
  const protocol = (req.headers["x-forwarded-proto"] as string) || "https";
  const expires = Date.now() + 5 * 60 * 1000;
  const payload = `${targetUrl}|${expires}`;
  const signature = crypto.createHmac("sha256", secret).update(payload).digest("base64url");
  const encodedUrl = encodeURIComponent(targetUrl);
  return `${protocol}://${host}/api/public/ocr-image?url=${encodedUrl}&exp=${expires}&sig=${signature}`;
}

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

function normalizeForNumbered(input: string): string {
  return input
    .toUpperCase()
    .replace(/(?<=\d)[O]/g, "0")
    .replace(/[O](?=\d)/g, "0")
    .replace(/(?<=\d)[IL]/g, "1")
    .replace(/[IL](?=\d)/g, "1")
    .replace(/(?<=\d)S/g, "5")
    .replace(/S(?=\d)/g, "5");
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
      select: {
        ocrText: true,
        photos: {
          where: { kind: "BACK" },
          select: { imageUrl: true },
          take: 1,
        },
      },
    });

    if (!card) {
      return res.status(404).json({ message: "Card not found" });
    }

    const rawBackImageUrl = card.photos?.[0]?.imageUrl ?? null;
    const backImageUrl =
      rawBackImageUrl && /^https?:\/\//i.test(rawBackImageUrl) ? rawBackImageUrl : null;
    const backProxyUrl = backImageUrl ? buildProxyUrl(req, backImageUrl) : null;
    if ((!card.ocrText || !card.ocrText.trim()) && !backImageUrl) {
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
          required: FIELD_KEYS,
        },
        confidence: {
          type: "object",
          additionalProperties: false,
          properties: Object.fromEntries(
            FIELD_KEYS.map((key) => [key, { type: ["number", "null"] }])
          ),
          required: FIELD_KEYS,
        },
      },
      required: ["fields", "confidence"],
    };

    const frontText = card.ocrText ?? "";
    const prompt = `OCR TEXT (FRONT):\n${frontText}\n\nRules:\n- Prefer the player name over variant names.\n- Manufacturer is the brand (Topps, Panini, Upper Deck, Leaf, etc.).\n- Year should be a 4-digit year if present.\n- For TCG, use cardName and game; for sports, use playerName and sport.\n- Always attempt sport if OCR includes Baseball/MLB, Basketball/NBA, Football/NFL, Hockey/NHL, Soccer/FIFA.\n- Autograph=true if OCR shows AUTO/AUTOGRAPH/SIGNATURE.\n- Patch=true if OCR shows PATCH/JERSEY/RELIC/MEM.\n- Numbered should be like "3/10" when present.\n- If slab label shows grading (PSA, BGS, SGC, CGC), set graded=true and extract gradeCompany + gradeValue. Accept formats like "PSA 9" or "9 PSA".\n- A back image may be provided; use it for year/numbered/grade if needed.`;

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
            content: [
              { type: "input_text", text: prompt },
              ...(backProxyUrl ? [{ type: "input_image", image_url: backProxyUrl }] : []),
            ],
          },
        ],
        text: {
          format: {
            type: "json_schema",
            name: "card_ocr",
            strict: true,
            schema,
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

    const combinedText = frontText.toLowerCase();
    const normalizedNumberedText = normalizeForNumbered(frontText);
    if (!fields.sport) {
      const text = combinedText;
      const inferredSport =
        text.includes("baseball") || text.includes("mlb")
          ? "Baseball"
          : text.includes("basketball") || text.includes("nba")
          ? "Basketball"
          : text.includes("football") || text.includes("nfl")
          ? "Football"
          : text.includes("hockey") || text.includes("nhl")
          ? "Hockey"
          : text.includes("soccer") || text.includes("fifa")
          ? "Soccer"
          : text.includes("qb") || text.includes("wr") || text.includes("rb") || text.includes("te")
          ? "Football"
          : text.includes("pg") || text.includes("sg") || text.includes("sf") || text.includes("pf")
          ? "Basketball"
          : text.includes("2b") || text.includes("3b") || text.includes("ss") || text.includes("of")
          ? "Baseball"
          : null;
      if (inferredSport) {
        fields.sport = inferredSport;
        confidence.sport = Math.max(confidence.sport ?? 0, DEFAULT_THRESHOLD);
      }
    }

    if (!fields.year) {
      const yearMatch = combinedText.match(/\b(19|20)\d{2}\b/);
      if (yearMatch) {
        fields.year = yearMatch[0];
        confidence.year = Math.max(confidence.year ?? 0, DEFAULT_THRESHOLD);
      }
    }

    if (!fields.numbered) {
      const numberedMatch = normalizedNumberedText.match(/\b\d{1,4}\s*\/\s*\d{1,4}\b/);
      if (numberedMatch) {
        fields.numbered = numberedMatch[0].replace(/\s+/g, "");
        confidence.numbered = Math.max(confidence.numbered ?? 0, DEFAULT_THRESHOLD);
      }
    }

    if (!fields.autograph) {
      if (/\bauto(?:graph)?\b/i.test(frontText) || /\bsignature\b/i.test(frontText) || /\bsigned\b/i.test(frontText)) {
        fields.autograph = "true";
        confidence.autograph = Math.max(confidence.autograph ?? 0, DEFAULT_THRESHOLD);
      }
    }

    if (!fields.memorabilia) {
      if (
        /\bpatch\b/i.test(frontText) ||
        /\bjersey\b/i.test(frontText) ||
        /\brelic\b/i.test(frontText) ||
        /\bmemorabilia\b/i.test(frontText) ||
        /\bgame[-\s]?worn\b/i.test(frontText) ||
        /\bplayer[-\s]?worn\b/i.test(frontText) ||
        /\b(event|event[-\s]?worn)\b/i.test(frontText) ||
        /\bswatch\b/i.test(frontText) ||
        /\bmem\b/i.test(frontText)
      ) {
        fields.memorabilia = "true";
        confidence.memorabilia = Math.max(confidence.memorabilia ?? 0, DEFAULT_THRESHOLD);
      }
    }

    if (!fields.gradeCompany || !fields.gradeValue || !fields.graded) {
      const rawOcr = card.ocrText ?? "";
      const normalizedOcr = rawOcr
        .replace(/\bP\s*5\s*A\b/gi, "PSA")
        .replace(/\bP\s*S\s*A\b/gi, "PSA")
        .replace(/\bS\s*G\s*C\b/gi, "SGC")
        .replace(/\bC\s*G\s*C\b/gi, "CGC")
        .replace(/\bB\s*G\s*S\b/gi, "BGS");
      const directMatch = normalizedOcr.match(/\b(PSA|BGS|SGC|CGC)\b[\s:\-]*([0-9]{1,2}(?:\.[0-9])?)/i);
      const reversedMatch = normalizedOcr.match(/([0-9]{1,2}(?:\.[0-9])?)\s*(PSA|BGS|SGC|CGC)\b/i);
      const inlineMatch = normalizedOcr.match(/\b(PSA|BGS|SGC|CGC)\s*([0-9]{1,2}(?:\.[0-9])?)\b/i);
      const company = directMatch?.[1] ?? reversedMatch?.[2] ?? null;
      const value = directMatch?.[2] ?? reversedMatch?.[1] ?? inlineMatch?.[2] ?? null;
      if (company && value) {
        const normalizedCompany = company.toUpperCase();
        if (!fields.gradeCompany) {
          fields.gradeCompany = normalizedCompany;
          confidence.gradeCompany = Math.max(confidence.gradeCompany ?? 0, DEFAULT_THRESHOLD);
        }
        if (!fields.gradeValue) {
          fields.gradeValue = value;
          confidence.gradeValue = Math.max(confidence.gradeValue ?? 0, DEFAULT_THRESHOLD);
        }
        if (!fields.graded) {
          fields.graded = "true";
          confidence.graded = Math.max(confidence.graded ?? 0, DEFAULT_THRESHOLD);
        }
      }
    }

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
