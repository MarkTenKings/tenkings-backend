import type { NextApiRequest, NextApiResponse } from "next";
import { prisma } from "@tenkings/database";
import { requireAdminSession, toErrorResponse } from "../../../../../lib/server/admin";

type ResponseBody =
  | { inserted: number; skipped: number }
  | { message: string };

type SeedImageRow = {
  rawImageUrl: string;
  sourceUrl: string | null;
  sourceListingId: string | null;
  listingTitle: string | null;
  score: number;
};

const SERPAPI_ENDPOINT = "https://serpapi.com/search.json";
const EBAY_ENGINE = "ebay";
const NOISE_TITLE_TOKENS = [
  "box",
  "blaster",
  "hobby",
  "case",
  "break",
  "pack",
  "lot",
  "mega box",
  "hanger",
];

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function normalizeText(value: string | null | undefined) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9#/\-\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function tokenize(value: string | null | undefined) {
  return normalizeText(value)
    .split(" ")
    .map((token) => token.trim())
    .filter((token) => token.length >= 3);
}

function parseEbayListingId(url: string | null | undefined) {
  const value = String(url || "").trim();
  if (!value) return null;
  const pathMatch = value.match(/\/itm\/(?:[^/?#]+\/)?(\d{8,20})(?:[/?#]|$)/i);
  if (pathMatch?.[1]) return pathMatch[1];
  const queryMatch = value.match(/[?&](?:item|itemId|itm|itm_id)=(\d{8,20})(?:[&#]|$)/i);
  if (queryMatch?.[1]) return queryMatch[1];
  return null;
}

function canonicalEbayListingUrl(url: string | null | undefined) {
  const listingId = parseEbayListingId(url);
  if (!listingId) return null;
  return `https://www.ebay.com/itm/${listingId}`;
}

function pickImageUrl(result: any) {
  const candidates = [
    result?.thumbnail,
    Array.isArray(result?.thumbnails) ? result.thumbnails[0] : null,
    Array.isArray(result?.thumbnail_images) ? result.thumbnail_images[0] : null,
    result?.image,
    result?.main_image,
    result?.original_image,
    result?.image_url,
    result?.img,
    result?.gallery_url,
  ];
  for (const candidate of candidates) {
    const value = String(candidate || "").trim();
    if (value) return value;
  }
  return "";
}

function extractListings(data: any) {
  if (Array.isArray(data?.organic_results)) return data.organic_results;
  if (Array.isArray(data?.search_results)) return data.search_results;
  if (Array.isArray(data?.results)) return data.results;
  if (Array.isArray(data?.items_results)) return data.items_results;
  if (Array.isArray(data?.items)) return data.items;
  return [];
}

function dedupeQueries(values: string[]) {
  const seen = new Set<string>();
  const output: string[] = [];
  for (const value of values) {
    const normalized = String(value || "").replace(/\s+/g, " ").trim();
    if (!normalized) continue;
    const key = normalized.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    output.push(normalized);
  }
  return output;
}

function primaryPlayerLabel(value: string) {
  const raw = String(value || "").split("::")[0]?.trim() || "";
  if (!raw) return "";
  const slashSplit = raw.split("/")[0]?.trim() || raw;
  return slashSplit.replace(/\s+/g, " ").trim();
}

function buildSearchQueries(params: {
  query: string;
  setId: string;
  cardNumber: string;
  parallelId: string;
  playerSeed: string;
}) {
  const baseQuery = String(params.query || "").replace(/\s+/g, " ").trim();
  const setClean = String(params.setId || "")
    .replace(/\bretail\b/gi, "")
    .replace(/\s+/g, " ")
    .trim();
  const player = primaryPlayerLabel(params.playerSeed);
  const parallel = String(params.parallelId || "").trim();
  const card = String(params.cardNumber || "").trim().toUpperCase();
  const cardCompact = card ? card.replace(/[^A-Z0-9]/g, "") : "";
  const cardSpaced = card ? card.replace(/[-_]+/g, " ") : "";
  const cardHash = card && card !== "ALL" ? `#${card}` : "";
  const cardTokens = [cardHash, card, cardCompact, cardSpaced].filter((token) => token && token !== "ALL");
  const mk = (...parts: Array<string | null | undefined>) =>
    parts
      .map((part) => String(part || "").trim())
      .filter(Boolean)
      .join(" ")
      .replace(/\s+/g, " ")
      .trim();

  const candidates = dedupeQueries([
    baseQuery,
    mk(player, setClean, cardHash, parallel),
    mk(player, setClean, cardCompact, parallel),
    mk(player, setClean, parallel),
    mk(setClean, cardHash, parallel),
    mk(setClean, cardCompact, parallel),
  ]);

  return candidates.slice(0, 6);
}

function scoreListing(params: {
  title: string;
  setId: string;
  parallelId: string;
  cardNumber: string;
  playerSeed: string;
}) {
  const title = normalizeText(params.title);
  if (!title) return -100;
  let score = 0;

  const player = normalizeText(params.playerSeed);
  if (player) {
    if (title.includes(player)) {
      score += 10;
    } else {
      const lastName = player.split(" ").filter(Boolean).slice(-1)[0] || "";
      if (lastName && title.includes(lastName)) {
        score += 5;
      } else {
        score -= 3;
      }
    }
  }

  const parallelTokens = tokenize(params.parallelId).slice(0, 5);
  for (const token of parallelTokens) {
    if (title.includes(token)) score += 2;
  }

  const setTokens = tokenize(params.setId).filter((token) =>
    /topps|chrome|prizm|optic|select|basketball|football|baseball|hockey|soccer|wrestling|rookie|\d{2,4}/.test(token)
  );
  for (const token of setTokens.slice(0, 6)) {
    if (title.includes(token)) score += 1;
  }

  const cardNumber = String(params.cardNumber || "").trim();
  if (cardNumber && cardNumber.toUpperCase() !== "ALL") {
    if (title.includes(`#${cardNumber.toLowerCase()}`)) {
      score += 3;
    } else if (new RegExp(`(^|\\s)${cardNumber.toLowerCase()}(\\s|$)`).test(title)) {
      score += 2;
    }
  }

  for (const token of NOISE_TITLE_TOKENS) {
    if (title.includes(token)) score -= 4;
  }

  return score;
}

export default async function handler(req: NextApiRequest, res: NextApiResponse<ResponseBody>) {
  try {
    await requireAdminSession(req);

    if (req.method !== "POST") {
      res.setHeader("Allow", "POST");
      return res.status(405).json({ message: "Method not allowed" });
    }

    const { setId, cardNumber, parallelId, playerSeed, query, limit, tbs, gl, hl } = req.body ?? {};
    if (!setId || !parallelId || !query) {
      return res.status(400).json({ message: "setId, parallelId, and query are required." });
    }

    const apiKey = process.env.SERPAPI_KEY ?? "";
    if (!apiKey) {
      return res.status(500).json({ message: "SERPAPI_KEY is not configured on the server." });
    }

    const safeLimit = Math.min(50, Math.max(1, Number(limit ?? 20) || 20));
    const normalizedSetId = String(setId).trim();
    const normalizedCardNumber = cardNumber ? String(cardNumber).trim() : "ALL";
    const normalizedParallelId = String(parallelId).trim();
    const normalizedPlayerSeed = String(playerSeed || "").trim();
    const normalizedQuery = String(query).trim();

    // Force eBay listing search (not Google image search).
    let data: any = null;
    let requestError = "";
    const searchQueries = buildSearchQueries({
      query: normalizedQuery,
      setId: normalizedSetId,
      cardNumber: normalizedCardNumber,
      parallelId: normalizedParallelId,
      playerSeed: normalizedPlayerSeed,
    });

    for (const searchQuery of searchQueries) {
      const params = new URLSearchParams({
        engine: EBAY_ENGINE,
        _nkw: searchQuery,
        q: searchQuery,
        _sop: "12",
        _ipg: String(Math.max(30, Math.min(240, safeLimit * 3))),
        api_key: apiKey,
      });
      if (tbs) params.set("tbs", String(tbs).trim());
      if (gl) params.set("gl", String(gl).trim());
      if (hl) params.set("hl", String(hl).trim());

      let queryData: any = null;
      let queryNoResults = false;

      for (let attempt = 1; attempt <= 3; attempt += 1) {
        try {
          const response = await fetch(`${SERPAPI_ENDPOINT}?${params.toString()}`);
          if (!response.ok) {
            const bodyText = await response.text().catch(() => "");
            requestError = `SerpApi request failed (${response.status})${bodyText ? `: ${bodyText.slice(0, 180)}` : ""}`;
            if (attempt < 3 && (response.status === 429 || response.status >= 500)) {
              await wait(300 * attempt);
              continue;
            }
            return res.status(502).json({ message: requestError });
          }

          const payload = await response.json();
          const topLevelError = String(
            payload?.error ||
              payload?.message ||
              payload?.errors?.[0]?.message ||
              payload?.errors?.[0] ||
              ""
          ).trim();
          if (topLevelError) {
            const noResults = /hasn'?t returned any results|no results/i.test(topLevelError);
            if (noResults) {
              // Try next query candidate before failing this target.
              queryNoResults = true;
              queryData = { organic_results: [] };
              break;
            }
            requestError = topLevelError;
            const retryable = /rate|limit|timeout|temporar|try again|busy|thrott|quota|capacity/i.test(requestError);
            if (attempt < 3 && retryable) {
              await wait(300 * attempt);
              continue;
            }
            return res.status(502).json({ message: requestError });
          }

          const metadataStatus = String(payload?.search_metadata?.status || "").trim();
          if (metadataStatus && metadataStatus !== "Success") {
            requestError = String(payload?.search_metadata?.error || "SerpApi returned error.").trim();
            const retryable = /rate|limit|timeout|temporar|try again|busy|thrott/i.test(requestError);
            if (attempt < 3 && retryable) {
              await wait(300 * attempt);
              continue;
            }
            return res.status(502).json({ message: requestError || "SerpApi returned error." });
          }

          queryData = payload;
          break;
        } catch (error) {
          requestError = error instanceof Error ? error.message : "SerpApi request failed.";
          if (attempt < 3) {
            continue;
          }
          return res.status(502).json({ message: requestError });
        }
      }

      if (!queryData) continue;
      const queryListings = extractListings(queryData);
      if (queryListings.length > 0) {
        data = queryData;
        break;
      }
      if (queryNoResults) {
        continue;
      }
    }

    if (!data) {
      return res.status(200).json({ inserted: 0, skipped: 1 });
    }

    const listings = extractListings(data);
    const seenListing = new Set<string>();
    const seenImage = new Set<string>();
    const rows: Array<{
      setId: string;
      cardNumber: string;
      parallelId: string;
      sourceListingId: string | null;
      playerSeed: string | null;
      listingTitle: string | null;
      rawImageUrl: string;
      sourceUrl: string | null;
    }> = listings
      .map((result: any) => {
        const sourceUrl = canonicalEbayListingUrl(
          result?.link ||
            result?.product_link ||
            result?.url ||
            result?.item_url ||
            result?.view_item_url ||
            result?.item_web_url ||
            result?.product?.link ||
            null
        );
        const sourceListingId = parseEbayListingId(sourceUrl);
        const rawImageUrl = pickImageUrl(result);
        const listingTitle =
          typeof result?.title === "string" ? String(result.title).trim() : null;
        const score = scoreListing({
          title: listingTitle || "",
          setId: normalizedSetId,
          parallelId: normalizedParallelId,
          cardNumber: normalizedCardNumber,
          playerSeed: normalizedPlayerSeed,
        });
        return {
          sourceUrl,
          sourceListingId,
          rawImageUrl,
          listingTitle,
          score,
        } satisfies SeedImageRow;
      })
      .filter((row: SeedImageRow) => row.sourceUrl && row.sourceListingId && row.rawImageUrl)
      .sort((a: SeedImageRow, b: SeedImageRow) => b.score - a.score)
      .filter((row: SeedImageRow) => {
        // Prefer one row per listing, but allow fallback dedupe by image URL.
        if (row.sourceListingId && seenListing.has(row.sourceListingId)) return false;
        if (seenImage.has(row.rawImageUrl)) return false;
        if (row.sourceListingId) seenListing.add(row.sourceListingId);
        seenImage.add(row.rawImageUrl);
        return true;
      })
      .slice(0, safeLimit)
      .map((row: SeedImageRow) => ({
        setId: normalizedSetId,
        cardNumber: normalizedCardNumber,
        parallelId: normalizedParallelId,
        sourceListingId: row.sourceListingId,
        playerSeed: normalizedPlayerSeed || null,
        listingTitle: row.listingTitle,
        rawImageUrl: row.rawImageUrl,
        sourceUrl: row.sourceUrl,
      }));

    if (rows.length === 0) {
      return res.status(200).json({ inserted: 0, skipped: 1 });
    }

    const existingRows = await prisma.cardVariantReferenceImage.findMany({
      where: {
        setId: normalizedSetId,
        cardNumber: normalizedCardNumber,
        parallelId: normalizedParallelId,
        OR: [
          {
            sourceListingId: {
              in: rows
                .map((row: { sourceListingId: string | null }) => String(row.sourceListingId || "").trim())
                .filter(Boolean),
            },
          },
          {
            rawImageUrl: {
              in: rows.map((row: { rawImageUrl: string }) => row.rawImageUrl),
            },
          },
        ],
      },
      select: {
        sourceListingId: true,
        rawImageUrl: true,
      },
    });
    const existingUrls = new Set(existingRows.map((row: { rawImageUrl: string }) => row.rawImageUrl));
    const existingListingIds = new Set(
      existingRows
        .map((row: { sourceListingId?: string | null }) => String(row.sourceListingId || "").trim())
        .filter(Boolean)
    );
    const rowsToInsert = rows.filter((row: { rawImageUrl: string; sourceListingId: string | null }) => {
      if (existingUrls.has(row.rawImageUrl)) return false;
      const listingId = String(row.sourceListingId || "").trim();
      if (listingId && existingListingIds.has(listingId)) return false;
      return true;
    });

    if (rowsToInsert.length > 0) {
      await prisma.cardVariantReferenceImage.createMany({ data: rowsToInsert });
    }

    const duplicateSkips = rows.length - rowsToInsert.length;
    return res
      .status(200)
      .json({ inserted: rowsToInsert.length, skipped: Math.max(0, safeLimit - rows.length) + duplicateSkips });
  } catch (error) {
    const response = toErrorResponse(error);
    return res.status(response.status).json({ message: response.message });
  }
}
