/* eslint-disable @next/next/no-img-element */
import type { ReactElement } from "react";
import { ImageResponse } from "@vercel/og";
import { formatGoldenTicketLabel } from "../../../../lib/goldenTicketLabel";

export const config = { runtime: "edge" };

const CARD_WIDTH = 1200;
const CARD_HEIGHT = 630;
const CARD_PADDING = 32;
const LOGO_SIZE = 120;
const REACTION_CACHE_CONTROL = "public, max-age=31536000, s-maxage=31536000, immutable";
const FALLBACK_CACHE_CONTROL = "public, max-age=60, s-maxage=60";
const NOT_FOUND_CACHE_CONTROL = "public, max-age=300, s-maxage=300";
const MUX_THUMBNAIL_TIME_SECONDS = 3;
const MUX_FETCH_TIMEOUT_MS = 2000;
const PRIZE_IMAGE_TIMEOUT_MS = 1200;
const FONT_CSS_URL = "https://fonts.googleapis.com/css2?family=Bebas+Neue&display=swap";
const LOGO_PATH = "/brand/tenkings-logo.png";

type GoldenTicketWinnerDetail = {
  ticketNumber: number;
  displayName: string;
  claimedAt: string | null;
  publishedAt: string;
  prize: {
    name: string;
    imageUrl: string | null;
    thumbnailUrl: string | null;
  };
  liveRip: {
    muxPlaybackId: string | null;
  } | null;
};

type GoldenTicketWinnerApiResponse = {
  winner: GoldenTicketWinnerDetail;
};

let bebasFontPromise: Promise<ArrayBuffer | null> | null = null;
const logoDataUrlPromises = new Map<string, Promise<string | null>>();
const muxThumbnailDataUrls = new Map<string, string>();
const secondaryImageDataUrls = new Map<string, string>();

function extractTicketNumber(request: Request) {
  const url = new URL(request.url);
  const match = url.pathname.match(/\/api\/golden\/(\d+)\/share-card$/);
  if (!match?.[1]) {
    return null;
  }
  const ticketNumber = Number.parseInt(match[1], 10);
  return Number.isFinite(ticketNumber) && ticketNumber > 0 ? ticketNumber : null;
}

function extractFirstName(displayName: string) {
  const [firstToken] = displayName.trim().split(/\s+/);
  return firstToken || displayName;
}

function resolveAbsoluteUrl(value: string | null, origin: string) {
  if (!value) {
    return null;
  }
  try {
    return new URL(value, origin).toString();
  } catch (error) {
    return null;
  }
}

function inferImageContentType(url: string) {
  const normalized = url.toLowerCase();
  if (normalized.endsWith(".png")) {
    return "image/png";
  }
  if (normalized.endsWith(".webp")) {
    return "image/webp";
  }
  return "image/jpeg";
}

function arrayBufferToBase64(buffer: ArrayBuffer) {
  const bytes = new Uint8Array(buffer);
  const chunkSize = 0x8000;
  let binary = "";
  for (let index = 0; index < bytes.length; index += chunkSize) {
    const chunk = bytes.subarray(index, Math.min(index + chunkSize, bytes.length));
    binary += String.fromCharCode(...chunk);
  }
  return btoa(binary);
}

function toDataUrl(buffer: ArrayBuffer, contentType: string) {
  return `data:${contentType};base64,${arrayBufferToBase64(buffer)}`;
}

async function fetchArrayBuffer(
  url: string,
  {
    timeoutMs,
    cache = "force-cache",
  }: {
    timeoutMs: number;
    cache?: RequestCache;
  }
) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      signal: controller.signal,
      cache,
    });
    if (!response.ok) {
      return null;
    }
    return {
      buffer: await response.arrayBuffer(),
      contentType: response.headers.get("content-type") || inferImageContentType(url),
    };
  } catch (error) {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

async function getBebasFontData() {
  if (!bebasFontPromise) {
    bebasFontPromise = (async () => {
      try {
        const cssResponse = await fetch(FONT_CSS_URL, {
          cache: "force-cache",
          headers: {
            "User-Agent":
              "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
          },
        });
        if (!cssResponse.ok) {
          return null;
        }

        const css = await cssResponse.text();
        const fontUrlMatch = css.match(/src: url\(([^)]+)\) format\('(woff2|woff|opentype|truetype)'\)/i);
        if (!fontUrlMatch?.[1]) {
          return null;
        }

        const fontResponse = await fetch(fontUrlMatch[1], { cache: "force-cache" });
        if (!fontResponse.ok) {
          return null;
        }

        return await fontResponse.arrayBuffer();
      } catch (error) {
        return null;
      }
    })();
  }

  const data = await bebasFontPromise;
  if (!data) {
    bebasFontPromise = null;
  }
  return data;
}

async function getLogoDataUrl(origin: string) {
  const absoluteUrl = new URL(LOGO_PATH, origin).toString();
  if (!logoDataUrlPromises.has(absoluteUrl)) {
    logoDataUrlPromises.set(
      absoluteUrl,
      (async () => {
        const asset = await fetchArrayBuffer(absoluteUrl, { timeoutMs: MUX_FETCH_TIMEOUT_MS });
        if (!asset) {
          return null;
        }
        return toDataUrl(asset.buffer, asset.contentType);
      })()
    );
  }

  const value = await logoDataUrlPromises.get(absoluteUrl)!;
  if (!value) {
    logoDataUrlPromises.delete(absoluteUrl);
  }
  return value;
}

function buildMuxThumbnailUrl(playbackId: string) {
  return `https://image.mux.com/${encodeURIComponent(
    playbackId
  )}/thumbnail.jpg?time=${MUX_THUMBNAIL_TIME_SECONDS}&width=${CARD_WIDTH}&height=${CARD_HEIGHT}&fit_mode=smartcrop`;
}

async function getMuxReactionFrameDataUrl(playbackId: string) {
  if (muxThumbnailDataUrls.has(playbackId)) {
    return muxThumbnailDataUrls.get(playbackId)!;
  }

  const asset = await fetchArrayBuffer(buildMuxThumbnailUrl(playbackId), {
    timeoutMs: MUX_FETCH_TIMEOUT_MS,
  });
  if (!asset) {
    return null;
  }

  const dataUrl = toDataUrl(asset.buffer, asset.contentType);
  muxThumbnailDataUrls.set(playbackId, dataUrl);
  return dataUrl;
}

async function getSecondaryImageDataUrl(url: string | null, origin: string) {
  const absoluteUrl = resolveAbsoluteUrl(url, origin);
  if (!absoluteUrl) {
    return null;
  }

  if (secondaryImageDataUrls.has(absoluteUrl)) {
    return secondaryImageDataUrls.get(absoluteUrl)!;
  }

  const asset = await fetchArrayBuffer(absoluteUrl, {
    timeoutMs: PRIZE_IMAGE_TIMEOUT_MS,
  });
  if (!asset) {
    return null;
  }

  const dataUrl = toDataUrl(asset.buffer, asset.contentType);
  secondaryImageDataUrls.set(absoluteUrl, dataUrl);
  return dataUrl;
}

async function getWinnerDetail(origin: string, ticketNumber: number) {
  const response = await fetch(`${origin}/api/golden/winners/${ticketNumber}`, {
    cache: "no-store",
    headers: {
      accept: "application/json",
    },
  });

  if (response.status === 404) {
    return null;
  }

  if (!response.ok) {
    throw new Error(`Winner lookup failed with status ${response.status}`);
  }

  const payload = (await response.json()) as GoldenTicketWinnerApiResponse;
  return payload.winner ?? null;
}

function createNotFoundResponse() {
  return new Response("Not found", {
    status: 404,
    headers: {
      "Cache-Control": NOT_FOUND_CACHE_CONTROL,
    },
  });
}

async function buildImageResponse(markup: ReactElement, cacheControl: string, fontData: ArrayBuffer | null) {
  const response = new ImageResponse(markup, {
    width: CARD_WIDTH,
    height: CARD_HEIGHT,
    fonts: fontData
      ? [
          {
            name: "Bebas Neue",
            data: fontData,
            weight: 400,
            style: "normal",
          },
        ]
      : [],
  });

  response.headers.set("Cache-Control", cacheControl);
  return response;
}

function renderLogo(logoDataUrl: string | null) {
  if (!logoDataUrl) {
    return null;
  }

  return (
    <img
      src={logoDataUrl}
      alt=""
      width={LOGO_SIZE}
      height={LOGO_SIZE}
      style={{
        position: "absolute",
        right: CARD_PADDING,
        bottom: CARD_PADDING,
        width: LOGO_SIZE,
        height: LOGO_SIZE,
      }}
    />
  );
}

function ReactionFrameCard({
  winner,
  ticketLabel,
  winnerFirstName,
  reactionFrameUrl,
  prizeImageUrl,
  logoDataUrl,
}: {
  winner: GoldenTicketWinnerDetail;
  ticketLabel: string;
  winnerFirstName: string;
  reactionFrameUrl: string;
  prizeImageUrl: string | null;
  logoDataUrl: string | null;
}) {
  return (
    <div
      style={{
        position: "relative",
        display: "flex",
        width: "100%",
        height: "100%",
        overflow: "hidden",
        background: "#05060a",
        color: "#f8fafc",
        fontFamily: '"Bebas Neue", sans-serif',
      }}
    >
      <img
        src={reactionFrameUrl}
        alt=""
        width={CARD_WIDTH}
        height={CARD_HEIGHT}
        style={{
          position: "absolute",
          inset: 0,
          width: "100%",
          height: "100%",
          objectFit: "cover",
        }}
      />
      <div
        style={{
          position: "absolute",
          inset: 0,
          background:
            "linear-gradient(180deg, rgba(5,6,10,0.82) 0%, rgba(5,6,10,0.18) 34%, rgba(5,6,10,0.84) 100%), radial-gradient(circle at center, rgba(5,6,10,0.06) 0%, rgba(5,6,10,0.62) 100%)",
        }}
      />

      {renderLogo(logoDataUrl)}

      <div
        style={{
          position: "relative",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          width: "100%",
          height: "100%",
          padding: CARD_PADDING,
        }}
      >
        <div
          style={{
            display: "flex",
            width: "100%",
            fontSize: 28,
            letterSpacing: 2.8,
            color: "#f5d37a",
          }}
        >
          TEN KINGS · GOLDEN TICKET FOUND
        </div>

        <div
          style={{
            display: "flex",
            width: "100%",
            justifyContent: "space-between",
            alignItems: "flex-end",
            gap: 24,
          }}
        >
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              alignItems: "flex-start",
              maxWidth: "58%",
              gap: 14,
            }}
          >
            <div
              style={{
                display: "flex",
                fontSize: 112,
                lineHeight: 0.9,
                color: "#fce7b2",
                textShadow: "0 6px 32px rgba(0,0,0,0.6)",
              }}
            >
              {winnerFirstName}
            </div>
            <div
              style={{
                display: "flex",
                borderRadius: 999,
                padding: "8px 18px",
                background: "rgba(5,6,10,0.74)",
                border: "1px solid rgba(245,211,122,0.55)",
                fontSize: 28,
                letterSpacing: 2.8,
                color: "#f5d37a",
              }}
            >
              {ticketLabel}
            </div>
          </div>

          <div
            style={{
              display: "flex",
              flexDirection: "column",
              alignItems: "flex-end",
              justifyContent: "flex-end",
              gap: 12,
              paddingRight: LOGO_SIZE + CARD_PADDING / 2,
              paddingBottom: 10,
              maxWidth: "42%",
            }}
          >
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 12,
                maxWidth: "100%",
                padding: "10px 12px",
                borderRadius: 22,
                background: "rgba(5,6,10,0.76)",
                border: "1px solid rgba(255,255,255,0.14)",
              }}
            >
              {prizeImageUrl ? (
                <img
                  src={prizeImageUrl}
                  alt=""
                  width={54}
                  height={54}
                  style={{
                    width: 54,
                    height: 54,
                    borderRadius: 12,
                    objectFit: "cover",
                    border: "1px solid rgba(245,211,122,0.35)",
                    flexShrink: 0,
                  }}
                />
              ) : null}
              <div
                style={{
                  display: "flex",
                  fontSize: 28,
                  lineHeight: 1,
                  color: "#ffffff",
                  textAlign: "right",
                  maxWidth: 320,
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                }}
              >
                {winner.prize.name}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function TextFallbackCard({
  ticketLabel,
  winnerFirstName,
  logoDataUrl,
}: {
  ticketLabel: string;
  winnerFirstName: string;
  logoDataUrl: string | null;
}) {
  return (
    <div
      style={{
        position: "relative",
        display: "flex",
        width: "100%",
        height: "100%",
        overflow: "hidden",
        background:
          "radial-gradient(circle at top, rgba(233,189,72,0.22), transparent 48%), linear-gradient(135deg, #05060a 0%, #080b14 48%, #05060a 100%)",
        color: "#f8fafc",
        fontFamily: '"Bebas Neue", sans-serif',
      }}
    >
      <div
        style={{
          position: "absolute",
          inset: 24,
          borderRadius: 28,
          border: "1px solid rgba(245,211,122,0.32)",
          background:
            "linear-gradient(115deg, rgba(233,189,72,0.06), rgba(252,231,178,0.12), rgba(233,189,72,0.04))",
        }}
      />

      {renderLogo(logoDataUrl)}

      <div
        style={{
          position: "relative",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          width: "100%",
          height: "100%",
          padding: "48px 56px 64px",
          textAlign: "center",
        }}
      >
        <div
          style={{
            display: "flex",
            fontSize: 30,
            letterSpacing: 3,
            color: "#f5d37a",
          }}
        >
          TEN KINGS · GOLDEN TICKET FOUND
        </div>
        <div
          style={{
            display: "flex",
            marginTop: 36,
            fontSize: 122,
            lineHeight: 0.9,
            color: "#fce7b2",
            textShadow: "0 10px 34px rgba(0,0,0,0.45)",
          }}
        >
          {winnerFirstName}
        </div>
        <div
          style={{
            display: "flex",
            marginTop: 22,
            borderRadius: 999,
            padding: "10px 20px",
            background: "rgba(5,6,10,0.72)",
            border: "1px solid rgba(245,211,122,0.5)",
            fontSize: 28,
            letterSpacing: 3,
            color: "#f5d37a",
          }}
        >
          {ticketLabel}
        </div>
      </div>
    </div>
  );
}

export default async function handler(request: Request) {
  if (request.method !== "GET") {
    return new Response("Method not allowed", {
      status: 405,
      headers: {
        Allow: "GET",
      },
    });
  }

  const ticketNumber = extractTicketNumber(request);
  if (!ticketNumber) {
    return createNotFoundResponse();
  }

  const origin = new URL(request.url).origin;

  let winner: GoldenTicketWinnerDetail | null = null;
  try {
    winner = await getWinnerDetail(origin, ticketNumber);
  } catch (error) {
    return createNotFoundResponse();
  }

  if (!winner) {
    return createNotFoundResponse();
  }

  const winnerFirstName = extractFirstName(winner.displayName);
  const ticketLabel = formatGoldenTicketLabel(winner.ticketNumber);

  try {
    const [fontData, logoDataUrl] = await Promise.all([getBebasFontData(), getLogoDataUrl(origin)]);

    const muxPlaybackId = winner.liveRip?.muxPlaybackId ?? null;
    const reactionFrameUrl = muxPlaybackId ? await getMuxReactionFrameDataUrl(muxPlaybackId) : null;

    if (reactionFrameUrl) {
      const prizeImageUrl = await getSecondaryImageDataUrl(winner.prize.thumbnailUrl ?? winner.prize.imageUrl, origin);
      return buildImageResponse(
        <ReactionFrameCard
          winner={winner}
          ticketLabel={ticketLabel}
          winnerFirstName={winnerFirstName}
          reactionFrameUrl={reactionFrameUrl}
          prizeImageUrl={prizeImageUrl}
          logoDataUrl={logoDataUrl}
        />,
        REACTION_CACHE_CONTROL,
        fontData
      );
    }

    return buildImageResponse(
      <TextFallbackCard ticketLabel={ticketLabel} winnerFirstName={winnerFirstName} logoDataUrl={logoDataUrl} />,
      FALLBACK_CACHE_CONTROL,
      fontData
    );
  } catch (error) {
    const [fontData, logoDataUrl] = await Promise.all([
      getBebasFontData().catch(() => null),
      getLogoDataUrl(origin).catch(() => null),
    ]);

    return buildImageResponse(
      <TextFallbackCard ticketLabel={ticketLabel} winnerFirstName={winnerFirstName} logoDataUrl={logoDataUrl} />,
      FALLBACK_CACHE_CONTROL,
      fontData
    );
  }
}
