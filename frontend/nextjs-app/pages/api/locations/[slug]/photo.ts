import type { NextApiRequest, NextApiResponse } from "next";
import { prisma } from "@tenkings/database";

type PhotoResponse = {
  photoUrl: string | null;
  source: "custom" | "google" | "none";
};

export default async function handler(req: NextApiRequest, res: NextApiResponse<PhotoResponse | { error: string }>) {
  if (req.method !== "GET") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const slug = Array.isArray(req.query.slug) ? req.query.slug[0] : req.query.slug;
  if (!slug) {
    return res.status(400).json({ error: "Missing slug" });
  }

  const location = await prisma.location.findUnique({
    where: { slug },
    select: {
      slug: true,
      name: true,
      address: true,
      machinePhotoUrl: true,
    },
  });

  if (!location) {
    return res.status(404).json({ error: "Not found" });
  }

  if (location.machinePhotoUrl) {
    res.setHeader("Cache-Control", "public, s-maxage=3600, stale-while-revalidate=86400");
    return res.status(200).json({ photoUrl: location.machinePhotoUrl, source: "custom" });
  }

  const apiKey = process.env.GOOGLE_MAPS_API_KEY ?? process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY;
  if (!apiKey) {
    return res.status(200).json({ photoUrl: null, source: "none" });
  }

  try {
    const searchQuery = `${location.name} ${location.address}`;
    const searchResponse = await fetch("https://places.googleapis.com/v1/places:searchText", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Goog-Api-Key": apiKey,
        "X-Goog-FieldMask": "places.photos",
      },
      body: JSON.stringify({
        textQuery: searchQuery,
        maxResultCount: 1,
      }),
    });

    if (!searchResponse.ok) {
      return res.status(200).json({ photoUrl: null, source: "none" });
    }

    const searchData = (await searchResponse.json()) as {
      places?: Array<{
        photos?: Array<{
          name?: string;
        }>;
      }>;
    };

    const photoName = searchData.places?.[0]?.photos?.[0]?.name;
    if (!photoName) {
      return res.status(200).json({ photoUrl: null, source: "none" });
    }

    const photoUrl = `https://places.googleapis.com/v1/${photoName}/media?maxWidthPx=800&key=${encodeURIComponent(apiKey)}`;
    res.setHeader("Cache-Control", "public, s-maxage=3600, stale-while-revalidate=86400");
    return res.status(200).json({ photoUrl, source: "google" });
  } catch {
    return res.status(200).json({ photoUrl: null, source: "none" });
  }
}
