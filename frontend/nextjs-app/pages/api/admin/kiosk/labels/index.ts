import type { NextApiRequest, NextApiResponse } from "next";
import { prisma } from "@tenkings/database";
import {
  kioskSessionInclude,
  serializeKioskSession,
  type KioskSessionWithRelations,
} from "../../../../../lib/server/kioskSession";
import { requireAdminSession, toErrorResponse } from "../../../../../lib/server/admin";

interface LabelResponse {
  id: string;
  code: string;
  serial: string | null;
  resetVersion: number;
  location: {
    id: string;
    name: string;
    slug: string;
  } | null;
  pack: {
    id: string;
    name: string | null;
    price: number | null;
    status: string;
  } | null;
  latestSession: ReturnType<typeof serializeKioskSession> | null;
}

export default async function handler(req: NextApiRequest, res: NextApiResponse<{ labels: LabelResponse[] } | { message: string }>) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ message: "Method not allowed" });
  }

  try {
    await requireAdminSession(req);

    const query = typeof req.query.q === "string" ? req.query.q.trim() : "";

    const labels: LabelResponse[] = [];

    const addFromSession = (session: Awaited<ReturnType<typeof prisma.kioskSession.findMany>>[number]) => {
      if (!session.packQrCode) {
        return;
      }
      if (labels.find((entry) => entry.id === session.packQrCode!.id)) {
        return;
      }
      labels.push({
        id: session.packQrCode.id,
        code: session.packQrCode.code,
        serial: session.packQrCode.serial,
        resetVersion: session.packQrCode.resetVersion ?? 0,
        location: session.location
          ? {
              id: session.location.id,
              name: session.location.name,
              slug: session.location.slug,
            }
          : null,
        pack: session.packInstance
          ? {
              id: session.packInstance.id,
              name: session.packInstance.packDefinition?.name ?? null,
              price: session.packInstance.packDefinition?.price ?? null,
              status: session.packInstance.status,
            }
          : null,
        latestSession: serializeKioskSession(session),
      });
    };

    const sessions = (await prisma.kioskSession.findMany({
      where: query
        ? {
            packQrCode: {
              OR: [
                { code: query },
                query.startsWith("TK") ? { serial: query } : undefined,
              ].filter(Boolean) as [{ code: string } | { serial: string }],
            },
          }
        : { packQrCodeId: { not: null } },
      orderBy: { updatedAt: "desc" },
      take: query ? 20 : 50,
      include: kioskSessionInclude,
    })) as KioskSessionWithRelations[];

    sessions.forEach(addFromSession);

    if (query && labels.length === 0) {
      const qr = await prisma.qrCode.findFirst({
        where: {
          OR: [
            { code: query },
            query.startsWith("TK") ? { serial: query } : undefined,
          ].filter(Boolean) as [{ code: string } | { serial: string }],
        },
        include: {
          packInstance: {
            include: {
              packDefinition: true,
            },
          },
          location: true,
        },
      });

      if (qr) {
        labels.push({
          id: qr.id,
          code: qr.code,
          serial: qr.serial,
          resetVersion: qr.resetVersion ?? 0,
          location: qr.location
            ? { id: qr.location.id, name: qr.location.name, slug: qr.location.slug }
            : null,
          pack: qr.packInstance
            ? {
                id: qr.packInstance.id,
                name: qr.packInstance.packDefinition?.name ?? null,
                price: qr.packInstance.packDefinition?.price ?? null,
                status: qr.packInstance.status,
              }
            : null,
          latestSession: null,
        });
      }
    }

    return res.status(200).json({ labels });
  } catch (error) {
    const response = toErrorResponse(error);
    return res.status(response.status).json({ message: response.message });
  }
}
