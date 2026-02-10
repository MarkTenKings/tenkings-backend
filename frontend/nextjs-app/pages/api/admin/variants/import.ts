import type { NextApiRequest, NextApiResponse } from "next";
import { prisma } from "@tenkings/database";
import { requireAdminSession, toErrorResponse } from "../../../../lib/server/admin";

type ResponseBody =
  | { ok: true; imported: number; skipped: number }
  | { message: string };

const REQUIRED_HEADERS = ["setId", "cardNumber", "parallelId"];

type ParsedRow = {
  setId: string;
  cardNumber: string;
  parallelId: string;
  parallelFamily?: string | null;
  keywords?: string[];
};

function parseCsv(text: string) {
  const rows: string[][] = [];
  let current: string[] = [];
  let value = "";
  let inQuotes = false;

  const pushValue = () => {
    current.push(value);
    value = "";
  };

  for (let i = 0; i < text.length; i += 1) {
    const char = text[i] ?? "";
    if (char === "\"" && text[i + 1] === "\"") {
      value += "\"";
      i += 1;
      continue;
    }
    if (char === "\"") {
      inQuotes = !inQuotes;
      continue;
    }
    if (char === "," && !inQuotes) {
      pushValue();
      continue;
    }
    if ((char === "\n" || char === "\r") && !inQuotes) {
      if (char === "\r" && text[i + 1] === "\n") {
        i += 1;
      }
      pushValue();
      if (current.length > 1 || current[0]) {
        rows.push(current.map((entry) => entry.trim()));
      }
      current = [];
      continue;
    }
    value += char;
  }
  pushValue();
  if (current.length > 1 || current[0]) {
    rows.push(current.map((entry) => entry.trim()));
  }

  return rows;
}

function normalizeKeywords(value: string | undefined) {
  if (!value) return [];
  return value
    .split(/\s*[|;]\s*|\s*,\s*/g)
    .map((entry) => entry.trim())
    .filter(Boolean);
}

export default async function handler(req: NextApiRequest, res: NextApiResponse<ResponseBody>) {
  try {
    await requireAdminSession(req);

    if (req.method !== "POST") {
      res.setHeader("Allow", "POST");
      return res.status(405).json({ message: "Method not allowed" });
    }

    const { csv, mode } = req.body ?? {};
    const csvText = typeof csv === "string" ? csv.trim() : "";
    if (!csvText) {
      return res.status(400).json({ message: "Missing csv payload." });
    }

    const rows = parseCsv(csvText);
    if (rows.length < 2) {
      return res.status(400).json({ message: "CSV must include a header row and at least one data row." });
    }

    const headers = rows[0].map((h) => h.trim());
    const headerIndex = (name: string) => headers.findIndex((h) => h === name);

    for (const required of REQUIRED_HEADERS) {
      if (headerIndex(required) === -1) {
        return res.status(400).json({ message: `Missing required header: ${required}` });
      }
    }

    const parsed: ParsedRow[] = [];
    for (let i = 1; i < rows.length; i += 1) {
      const row = rows[i];
      if (!row || row.length === 0) continue;
      const setId = row[headerIndex("setId")]?.trim();
      const cardNumber = row[headerIndex("cardNumber")]?.trim();
      const parallelId = row[headerIndex("parallelId")]?.trim();
      if (!setId || !cardNumber || !parallelId) {
        continue;
      }
      const parallelFamily = headerIndex("parallelFamily") !== -1
        ? row[headerIndex("parallelFamily")]?.trim()
        : undefined;
      const keywordsRaw = headerIndex("keywords") !== -1
        ? row[headerIndex("keywords")]?.trim()
        : undefined;
      parsed.push({
        setId,
        cardNumber,
        parallelId,
        parallelFamily: parallelFamily ? parallelFamily : null,
        keywords: normalizeKeywords(keywordsRaw),
      });
    }

    let imported = 0;
    let skipped = 0;

    for (const entry of parsed) {
      try {
        if ((mode ?? "upsert") === "create") {
          await prisma.cardVariant.create({
            data: {
              setId: entry.setId,
              cardNumber: entry.cardNumber,
              parallelId: entry.parallelId,
              parallelFamily: entry.parallelFamily ?? null,
              keywords: entry.keywords ?? [],
            },
          });
        } else {
          await prisma.cardVariant.upsert({
            where: {
              setId_cardNumber_parallelId: {
                setId: entry.setId,
                cardNumber: entry.cardNumber,
                parallelId: entry.parallelId,
              },
            },
            update: {
              parallelFamily: entry.parallelFamily ?? null,
              keywords: entry.keywords ?? [],
            },
            create: {
              setId: entry.setId,
              cardNumber: entry.cardNumber,
              parallelId: entry.parallelId,
              parallelFamily: entry.parallelFamily ?? null,
              keywords: entry.keywords ?? [],
            },
          });
        }
        imported += 1;
      } catch {
        skipped += 1;
      }
    }

    return res.status(200).json({ ok: true, imported, skipped });
  } catch (error) {
    const response = toErrorResponse(error);
    return res.status(response.status).json({ message: response.message });
  }
}
