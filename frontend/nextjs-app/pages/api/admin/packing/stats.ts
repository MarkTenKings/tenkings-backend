import type { NextApiRequest, NextApiResponse } from "next";
import { prisma, PackFulfillmentStatus } from "@tenkings/database";
import { requireAdminSession, toErrorResponse } from "../../../../lib/server/admin";

type StatusCounts = {
  ready: number;
  packed: number;
  loaded: number;
};

type LocationStats = {
  id: string | null;
  name: string;
  counts: StatusCounts;
};

const emptyCounts = (): StatusCounts => ({ ready: 0, packed: 0, loaded: 0 });

const mapStatus = (status: PackFulfillmentStatus): keyof StatusCounts | null => {
  switch (status) {
    case PackFulfillmentStatus.READY_FOR_PACKING:
      return "ready";
    case PackFulfillmentStatus.PACKED:
      return "packed";
    case PackFulfillmentStatus.LOADED:
      return "loaded";
    default:
      return null;
  }
};

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ message: "Method not allowed" });
  }

  try {
    await requireAdminSession(req);

    const grouped = await prisma.packInstance.groupBy({
      by: ["locationId", "fulfillmentStatus"],
      where: {
        fulfillmentStatus: {
          in: [
            PackFulfillmentStatus.READY_FOR_PACKING,
            PackFulfillmentStatus.PACKED,
            PackFulfillmentStatus.LOADED,
          ],
        },
      },
      _count: {
        _all: true,
      },
    });

    const locationIds = Array.from(
      new Set(grouped.map((row) => row.locationId).filter((value): value is string => Boolean(value)))
    );

    const locations = await prisma.location.findMany({
      where: { id: { in: locationIds } },
      select: { id: true, name: true },
    });

    const locationNameMap = new Map<string, string>();
    locations.forEach((location) => {
      locationNameMap.set(location.id, location.name);
    });

    const totals = emptyCounts();
    const byLocation = new Map<string | null, StatusCounts>();

    for (const row of grouped) {
      const key = row.locationId ?? null;
      const mapped = mapStatus(row.fulfillmentStatus as PackFulfillmentStatus);
      if (!mapped) {
        continue;
      }
      if (!byLocation.has(key)) {
        byLocation.set(key, emptyCounts());
      }
      const counts = byLocation.get(key)!;
      counts[mapped] += row._count._all;
      totals[mapped] += row._count._all;
    }

    const payload: LocationStats[] = Array.from(byLocation.entries()).map(([locationId, counts]) => {
      const name = locationId ? locationNameMap.get(locationId) ?? "Assigned Location" : "Online / Unassigned";
      return {
        id: locationId,
        name,
        counts,
      };
    });

    payload.sort((a, b) => {
      if (a.id === b.id) {
        return 0;
      }
      if (a.id === null) {
        return 1;
      }
      if (b.id === null) {
        return -1;
      }
      return a.name.localeCompare(b.name);
    });

    return res.status(200).json({
      totals,
      locations: payload,
    });
  } catch (error) {
    const response = toErrorResponse(error);
    return res.status(response.status).json({ message: response.message });
  }
}
