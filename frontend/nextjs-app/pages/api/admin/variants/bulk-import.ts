import type { NextApiRequest, NextApiResponse } from "next";
import Busboy from "busboy";
import { Prisma } from "@prisma/client";
import AdmZip from "adm-zip";
import path from "node:path";
import { prisma } from "@tenkings/database";
import { requireAdminSession, toErrorResponse } from "../../../../lib/server/admin";
import { uploadBuffer } from "../../../../lib/server/storage";

export const config = {
  api: {
    bodyParser: false,
    sizeLimit: "200mb",
  },
};

type ResponseBody =
  | {
      ok: true;
      variantsUpserted: number;
      imagesImported: number;
      imagesSkipped: number;
      rowsParsed: number;
      rowsSkipped: number;
    }
  | { message: string };

const REQUIRED_HEADERS = ["setId", "cardNumber", "parallelId"];

type ParsedRow = {
  setId: string;
  cardNumber: string;
  parallelId: string;
  parallelFamily?: string | null;
  keywords?: string[];
  sourceUrl?: string | null;
  imageFilename?: string | null;
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

function slugify(input: string) {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

export default async function handler(req: NextApiRequest, res: NextApiResponse<ResponseBody>) {
  try {
    await requireAdminSession(req);

    if (req.method !== "POST") {
      res.setHeader("Allow", "POST");
      return res.status(405).json({ message: "Method not allowed" });
    }

    const csvBuffers: Buffer[] = [];
    const zipBuffers: Buffer[] = [];

    const bb = Busboy({ headers: req.headers, limits: { fileSize: 200 * 1024 * 1024 } });

    const fields: Record<string, string> = {};

    await new Promise<void>((resolve, reject) => {
      bb.on("file", (name, file, info) => {
        const chunks: Buffer[] = [];
        file.on("data", (data) => chunks.push(Buffer.from(data)));
        file.on("limit", () => reject(new Error("File too large")));
        file.on("end", () => {
          const buffer = Buffer.concat(chunks);
          if (name === "csv" || info.filename?.endsWith(".csv")) {
            csvBuffers.push(buffer);
          } else if (name === "zip" || info.filename?.endsWith(".zip")) {
            zipBuffers.push(buffer);
          }
        });
      });
      bb.on("field", (name, value) => {
        fields[name] = value;
      });
      bb.on("error", (err) => reject(err));
      bb.on("finish", () => resolve());
      req.pipe(bb);
    });

    const csvText = fields.csvText?.trim() || (csvBuffers[0] ? csvBuffers[0].toString("utf-8") : "");
    if (!csvText) {
      return res.status(400).json({ message: "CSV is required." });
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
      const sourceUrl = headerIndex("sourceUrl") !== -1
        ? row[headerIndex("sourceUrl")]?.trim()
        : undefined;
      const imageFilename = headerIndex("imageFilename") !== -1
        ? row[headerIndex("imageFilename")]?.trim()
        : undefined;
      parsed.push({
        setId,
        cardNumber,
        parallelId,
        parallelFamily: parallelFamily ? parallelFamily : null,
        keywords: normalizeKeywords(keywordsRaw),
        sourceUrl: sourceUrl ? sourceUrl : null,
        imageFilename: imageFilename ? imageFilename : null,
      });
    }

    let variantsUpserted = 0;
    let rowsSkipped = 0;

    for (const entry of parsed) {
      try {
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
        variantsUpserted += 1;
      } catch {
        rowsSkipped += 1;
      }
    }

    const zipBuffer = zipBuffers[0];
    let imagesImported = 0;
    let imagesSkipped = 0;

    if (zipBuffer) {
      const zip = new AdmZip(zipBuffer);
      const entries = zip.getEntries();
      const rowByFilename = new Map(
        parsed
          .filter((row) => row.imageFilename)
          .map((row) => [row.imageFilename as string, row])
      );

      for (const entry of entries) {
        if (entry.isDirectory) continue;
        const filename = path.basename(entry.entryName);
        const match = rowByFilename.get(filename);
        if (!match) {
          imagesSkipped += 1;
          continue;
        }
        const buffer = entry.getData();
        const ext = path.extname(filename).toLowerCase();
        const contentType = ext === ".png" ? "image/png" : "image/jpeg";

        const storageKey = `variants/${slugify(match.setId)}/${slugify(match.parallelId)}/${filename}`;
        const publicUrl = await uploadBuffer(storageKey, buffer, contentType);

        await prisma.cardVariantReferenceImage.create({
          data: {
            setId: match.setId,
            parallelId: match.parallelId,
            rawImageUrl: publicUrl,
            sourceUrl: match.sourceUrl ?? null,
            cropUrls: [],
            cropEmbeddings: Prisma.JsonNull,
            qualityScore: null,
          },
        });

        imagesImported += 1;
      }
    }

    return res.status(200).json({
      ok: true,
      variantsUpserted,
      imagesImported,
      imagesSkipped,
      rowsParsed: parsed.length,
      rowsSkipped,
    });
  } catch (error) {
    const response = toErrorResponse(error);
    return res.status(response.status).json({ message: response.message });
  }
}
