import type { NextApiRequest, NextApiResponse } from "next";
import { prisma } from "@tenkings/database";
import { requireAdminSession, toErrorResponse } from "../../../../../lib/server/admin";
import { listOcrRegionTemplates, upsertOcrRegionTemplates } from "../../../../../lib/server/ocrRegionTemplates";
import { createOcrRegionTeachEvent, storeOcrRegionSnapshot } from "../../../../../lib/server/ocrRegionTeachEvents";

type RegionTeachResponse =
  | {
      setId: string | null;
      layoutClass: string;
      templatesBySide: Record<"FRONT" | "BACK" | "TILT", Array<Record<string, unknown>>>;
      sampleCountBySide: Record<"FRONT" | "BACK" | "TILT", number>;
      updatedCount?: number;
      warnings?: string[];
    }
  | { message: string };

function getStringValue(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

export default async function handler(req: NextApiRequest, res: NextApiResponse<RegionTeachResponse>) {
  try {
    const admin = await requireAdminSession(req);
    const cardId = getStringValue(req.query.cardId);
    if (!cardId) {
      return res.status(400).json({ message: "cardId is required" });
    }
    const card = await prisma.cardAsset.findFirst({
      where: { id: cardId },
      select: { id: true },
    });
    if (!card) {
      return res.status(404).json({ message: "Card not found" });
    }

    if (req.method === "GET") {
      const setId = getStringValue(req.query.setId);
      if (!setId) {
        return res.status(400).json({ message: "setId is required" });
      }
      const layoutClass = getStringValue(req.query.layoutClass) ?? "base";
      const templates = await listOcrRegionTemplates({ setId, layoutClass });
      return res.status(200).json({
        setId: templates.setId,
        layoutClass: templates.layoutClass,
        templatesBySide: templates.templatesBySide as Record<"FRONT" | "BACK" | "TILT", Array<Record<string, unknown>>>,
        sampleCountBySide: templates.sampleCountBySide,
      });
    }

    if (req.method === "POST") {
      const body = req.body && typeof req.body === "object" ? (req.body as Record<string, unknown>) : {};
      const setId = getStringValue(body.setId);
      if (!setId) {
        return res.status(400).json({ message: "setId is required" });
      }
      const layoutClass = getStringValue(body.layoutClass) ?? "base";
      const templates = Array.isArray(body.templates) ? (body.templates as Array<Record<string, unknown>>) : [];
      if (!templates.length) {
        return res.status(400).json({ message: "templates are required" });
      }
      const result = await upsertOcrRegionTemplates({
        setId,
        layoutClass,
        createdById: admin.user.id,
        templates: templates.map((entry) => ({
          photoSide: getStringValue(entry.photoSide) ?? "",
          regions: Array.isArray(entry.regions) ? entry.regions : [],
        })),
      });
      const warnings: string[] = [];

      const snapshotEntries: Array<Record<string, unknown>> = [];
      if (Array.isArray(body.snapshots)) {
        body.snapshots.forEach((entry) => {
          if (entry && typeof entry === "object") {
            snapshotEntries.push(entry as Record<string, unknown>);
          }
        });
      } else if (body.snapshot && typeof body.snapshot === "object") {
        snapshotEntries.push(body.snapshot as Record<string, unknown>);
      }
      const snapshotsBySide = new Map<
        "FRONT" | "BACK" | "TILT",
        {
          photoSide: "FRONT" | "BACK" | "TILT";
          storageKey: string;
          imageUrl: string;
          width: number | null;
          height: number | null;
          devicePixelRatio: number | null;
        }
      >();
      for (const snapshotInput of snapshotEntries.slice(0, 3)) {
        const dataUrl = getStringValue(snapshotInput.dataUrl);
        const photoSide = getStringValue(snapshotInput.photoSide);
        if (!dataUrl || !photoSide) {
          continue;
        }
        try {
          const stored = await storeOcrRegionSnapshot({
            cardAssetId: cardId,
            snapshot: {
              photoSide,
              dataUrl,
              width: typeof snapshotInput.width === "number" ? snapshotInput.width : null,
              height: typeof snapshotInput.height === "number" ? snapshotInput.height : null,
              devicePixelRatio: typeof snapshotInput.devicePixelRatio === "number" ? snapshotInput.devicePixelRatio : null,
            },
          });
          if (stored) {
            snapshotsBySide.set(stored.photoSide, stored);
          }
        } catch (error) {
          warnings.push(error instanceof Error ? error.message : "snapshot_store_failed");
        }
      }

      const requestedTemplates = templates.map((entry) => ({
        photoSide: getStringValue(entry.photoSide),
        regions: Array.isArray(entry.regions) ? entry.regions.length : 0,
      }));
      await Promise.all(
        requestedTemplates.map(async (entry) => {
          if (!entry.photoSide) {
            return;
          }
          const sideSnapshot = snapshotsBySide.get(entry.photoSide as "FRONT" | "BACK" | "TILT") ?? null;
          await createOcrRegionTeachEvent({
            cardAssetId: cardId,
            setId,
            layoutClass,
            photoSide: entry.photoSide,
            eventType: "TEMPLATE_SAVE",
            regionCount: entry.regions,
            templatesUpdated: result.updatedCount ?? 0,
            snapshotStorageKey: sideSnapshot?.storageKey ?? null,
            snapshotImageUrl: sideSnapshot?.imageUrl ?? null,
            debugPayload: {
              width: sideSnapshot?.width ?? null,
              height: sideSnapshot?.height ?? null,
              devicePixelRatio: sideSnapshot?.devicePixelRatio ?? null,
            },
            createdById: admin.user.id,
          });
        })
      );
      return res.status(200).json({
        setId: result.setId,
        layoutClass: result.layoutClass,
        templatesBySide: result.templatesBySide as Record<"FRONT" | "BACK" | "TILT", Array<Record<string, unknown>>>,
        sampleCountBySide: result.sampleCountBySide,
        updatedCount: result.updatedCount,
        warnings: warnings.length > 0 ? warnings : undefined,
      });
    }

    res.setHeader("Allow", "GET, POST");
    return res.status(405).json({ message: "Method not allowed" });
  } catch (error) {
    const response = toErrorResponse(error);
    return res.status(response.status).json({ message: response.message });
  }
}
