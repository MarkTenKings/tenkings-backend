import type { NextApiRequest, NextApiResponse } from "next";
import crypto from "node:crypto";
import { prisma } from "@tenkings/database";
import { requireAdminSession, toErrorResponse } from "../../../../../lib/server/admin";
import { normalizeStorageUrl } from "../../../../../lib/server/storage";
import { runLocalOcr } from "../../../../../lib/server/localOcr";
import { extractCardAttributes } from "@tenkings/shared";

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
const TCG_KEYWORDS = [
  "pokemon",
  "magic",
  "yugioh",
  "yu-gi-oh",
  "lorcana",
  "one piece",
  "digimon",
  "tcg",
  "trading card",
];

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

function buildProxyUrl(req: NextApiRequest, targetUrl: string): string | null {
  const normalizedTarget = normalizeStorageUrl(targetUrl) ?? targetUrl;
  const secret = process.env.OCR_PROXY_SECRET ?? process.env.OPENAI_API_KEY;
  if (!secret) {
    return /^https?:\/\//i.test(normalizedTarget) ? normalizedTarget : null;
  }
  const host = req.headers.host;
  if (!host) {
    return null;
  }
  const protocol = (req.headers["x-forwarded-proto"] as string) || "https";
  const expires = Date.now() + 5 * 60 * 1000;
  const payload = `${normalizedTarget}|${expires}`;
  const signature = crypto.createHmac("sha256", secret).update(payload).digest("base64url");
  const encodedUrl = encodeURIComponent(normalizedTarget);
  return `${protocol}://${host}/api/public/ocr-image?url=${encodedUrl}&exp=${expires}&sig=${signature}`;
}

function pickImageUrl(primary?: string | null, thumbnail?: string | null): string | null {
  const candidate = thumbnail ?? primary ?? null;
  if (!candidate) {
    return null;
  }
  return /^https?:\/\//i.test(candidate) ? candidate : null;
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
    await requireAdminSession(req);
    const { cardId } = req.query;
    if (typeof cardId !== "string" || !cardId.trim()) {
      return res.status(400).json({ message: "cardId is required" });
    }

    const card = await prisma.cardAsset.findFirst({
      where: { id: cardId },
      select: {
        ocrText: true,
        imageUrl: true,
        thumbnailUrl: true,
        photos: {
          where: { kind: { in: ["BACK", "TILT"] } },
          select: { kind: true, imageUrl: true, thumbnailUrl: true },
        },
      },
    });

    if (!card) {
      return res.status(404).json({ message: "Card not found" });
    }

    const frontImageUrl = pickImageUrl(card.imageUrl, card.thumbnailUrl);
    const backPhoto = card.photos.find((photo) => photo.kind === "BACK");
    const tiltPhoto = card.photos.find((photo) => photo.kind === "TILT");
    const backImageUrl = pickImageUrl(backPhoto?.imageUrl, backPhoto?.thumbnailUrl);
    const tiltImageUrl = pickImageUrl(tiltPhoto?.imageUrl, tiltPhoto?.thumbnailUrl);

    const frontProxyUrl = frontImageUrl ? buildProxyUrl(req, frontImageUrl) : null;
    const backProxyUrl = backImageUrl ? buildProxyUrl(req, backImageUrl) : null;
    const tiltProxyUrl = tiltImageUrl ? buildProxyUrl(req, tiltImageUrl) : null;

    if ((!card.ocrText || !card.ocrText.trim()) && !frontProxyUrl && !backProxyUrl && !tiltProxyUrl) {
      return res.status(200).json({
        suggestions: {},
        threshold: DEFAULT_THRESHOLD,
        audit: { source: "local-ocr", model: "paddleocr", createdAt: new Date().toISOString(), fields: {}, confidence: {} },
        status: "pending",
      });
    }

    const images = [
      ...(frontProxyUrl ? [{ id: "front", url: frontProxyUrl }] : []),
      ...(backProxyUrl ? [{ id: "back", url: backProxyUrl }] : []),
      ...(tiltProxyUrl ? [{ id: "tilt", url: tiltProxyUrl }] : []),
    ];

    if (images.length === 0) {
      return res.status(200).json({
        suggestions: {},
        threshold: DEFAULT_THRESHOLD,
        audit: { source: "local-ocr", model: "paddleocr", createdAt: new Date().toISOString(), fields: {}, confidence: {} },
        status: "pending",
      });
    }

    const ocrResponse = await runLocalOcr(images);
    const combinedTextRaw = ocrResponse.combined_text ?? "";
    const combinedText = combinedTextRaw.toLowerCase();
    const normalizedNumberedText = normalizeForNumbered(combinedTextRaw);

    const attributes = extractCardAttributes(combinedTextRaw);
    const fields: SuggestionFields = {
      playerName: attributes.playerName ?? null,
      year: attributes.year ?? null,
      manufacturer: attributes.brand ?? null,
      sport: null,
      game: null,
      cardName: null,
      setName: attributes.setName ?? null,
      cardNumber: null,
      numbered: attributes.numbered ?? null,
      autograph: attributes.autograph ? "true" : null,
      memorabilia: attributes.memorabilia ? "true" : null,
      graded: attributes.gradeCompany && attributes.gradeValue ? "true" : null,
      gradeCompany: attributes.gradeCompany ?? null,
      gradeValue: attributes.gradeValue ?? null,
    };

    const confidence: SuggestionConfidence = FIELD_KEYS.reduce((acc, key) => {
      acc[key] = fields[key] ? 0.9 : null;
      return acc;
    }, {} as SuggestionConfidence);
    if (!fields.sport) {
      const inferredSport =
        combinedText.includes("baseball") || combinedText.includes("mlb")
          ? "Baseball"
          : combinedText.includes("basketball") || combinedText.includes("nba")
          ? "Basketball"
          : combinedText.includes("football") || combinedText.includes("nfl")
          ? "Football"
          : combinedText.includes("hockey") || combinedText.includes("nhl")
          ? "Hockey"
          : combinedText.includes("soccer") || combinedText.includes("fifa")
          ? "Soccer"
          : null;
      if (inferredSport) {
        fields.sport = inferredSport;
        confidence.sport = 0.9;
      }
    }

    if (!fields.game) {
      const match = TCG_KEYWORDS.find((keyword) => combinedText.includes(keyword));
      if (match) {
        fields.game = match
          .replace("yu-gi-oh", "Yu-Gi-Oh!")
          .replace("yugioh", "Yu-Gi-Oh!")
          .replace("pokemon", "Pokemon")
          .replace("magic", "Magic")
          .replace("lorcana", "Lorcana")
          .replace("one piece", "One Piece")
          .replace("digimon", "Digimon");
        confidence.game = 0.8;
      }
    }

    if (!fields.year) {
      const yearMatch = combinedText.match(/\b(19|20)\d{2}\b/);
      if (yearMatch) {
        fields.year = yearMatch[0];
        confidence.year = 0.9;
      }
    }

    if (!fields.numbered) {
      const numberedMatch = normalizedNumberedText.match(/\b\d{1,4}\s*\/\s*\d{1,4}\b/);
      if (numberedMatch) {
        fields.numbered = numberedMatch[0].replace(/\s+/g, "");
        confidence.numbered = 0.9;
      }
    }

    if (!fields.autograph) {
      if (/\bauto(?:graph)?\b/i.test(combinedTextRaw) || /\bsignature\b/i.test(combinedTextRaw) || /\bsigned\b/i.test(combinedTextRaw)) {
        fields.autograph = "true";
        confidence.autograph = 0.9;
      }
    }

    if (!fields.memorabilia) {
      if (
        /\bpatch\b/i.test(combinedTextRaw) ||
        /\bjersey\b/i.test(combinedTextRaw) ||
        /\brelic\b/i.test(combinedTextRaw) ||
        /\bmemorabilia\b/i.test(combinedTextRaw) ||
        /\bgame[-\s]?worn\b/i.test(combinedTextRaw) ||
        /\bplayer[-\s]?worn\b/i.test(combinedTextRaw) ||
        /\b(event|event[-\s]?worn)\b/i.test(combinedTextRaw) ||
        /\bswatch\b/i.test(combinedTextRaw) ||
        /\bmem\b/i.test(combinedTextRaw)
      ) {
        fields.memorabilia = "true";
        confidence.memorabilia = 0.9;
      }
    }

    if (!fields.gradeCompany || !fields.gradeValue || !fields.graded) {
      const rawOcr = combinedTextRaw;
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
          confidence.gradeCompany = 0.9;
        }
        if (!fields.gradeValue) {
          fields.gradeValue = value;
          confidence.gradeValue = 0.9;
        }
        if (!fields.graded) {
          fields.graded = "true";
          confidence.graded = 0.9;
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
      source: "local-ocr",
      model: "paddleocr",
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

    await prisma.cardAsset.update({
      where: { id: cardId },
      data: {
        ocrText: combinedTextRaw,
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
