import express from "express";
import cors from "cors";
import { prisma, Prisma, IngestionStatus } from "@tenkings/database";
import { z } from "zod";

const app = express();
const port = process.env.PORT ? Number(process.env.PORT) : 8184;
const serviceName = "ingestion-service";

app.use(cors());
app.use(express.json());

const createSchema = z.object({
  ownerId: z.string().uuid(),
  externalId: z.string().optional(),
  card: z.object({
    name: z.string().min(1),
    set: z.string().min(1),
    number: z.string().optional(),
    language: z.string().optional(),
    foil: z.boolean().optional(),
    estimatedValue: z.number().int().positive().optional(),
    vaultLocation: z.string().optional(),
  }),
  notes: z.string().optional(),
});

app.post("/ingestions", async (req, res, next) => {
  try {
    const payload = createSchema.parse(req.body);
    const ingestion = await prisma.ingestionTask.create({
      data: {
        externalId: payload.externalId,
        status: IngestionStatus.PENDING,
        ownerId: payload.ownerId,
        rawPayload: payload.card,
        notes: payload.notes,
      },
    });
    res.status(201).json({ ingestion });
  } catch (error) {
    next(error);
  }
});

app.get("/ingestions", async (_req, res, next) => {
  try {
    const ingestions = await prisma.ingestionTask.findMany({ orderBy: { createdAt: "desc" }, take: 100 });
    res.json({ ingestions });
  } catch (error) {
    next(error);
  }
});

const reviewSchema = z.object({
  status: z.nativeEnum(IngestionStatus),
  notes: z.string().optional(),
});

app.post("/ingestions/:ingestionId/review", async (req, res, next) => {
  try {
    const payload = reviewSchema.parse(req.body);
    const updated = await prisma.ingestionTask.update({
      where: { id: req.params.ingestionId },
      data: { status: payload.status, notes: payload.notes },
    });
    res.json({ ingestion: updated });
  } catch (error) {
    next(error);
  }
});

const notesSchema = z.object({ notes: z.string().optional() });

app.post("/ingestions/:ingestionId/approve", async (req, res, next) => {
  try {
    notesSchema.parse(req.body);
    const result = await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      const ingestion = await tx.ingestionTask.findUnique({ where: { id: req.params.ingestionId } });
      if (!ingestion) {
        throw Object.assign(new Error("ingestion missing"), { statusCode: 404 });
      }
      if (ingestion.status === IngestionStatus.APPROVED) {
        throw Object.assign(new Error("already approved"), { statusCode: 409 });
      }

      const payload = (ingestion.rawPayload ?? {}) as Record<string, unknown>;
      const name = typeof payload.name === "string" ? payload.name : undefined;
      const cardSet = typeof payload.set === "string" ? payload.set : undefined;
      if (!name || !cardSet) {
        throw Object.assign(new Error("missing card metadata"), { statusCode: 400 });
      }

      const item = await tx.item.create({
        data: {
          name,
          set: cardSet,
          number: typeof payload.number === "string" ? payload.number : undefined,
          language: typeof payload.language === "string" ? payload.language : undefined,
          foil: typeof payload.foil === "boolean" ? payload.foil : false,
          estimatedValue: typeof payload.estimatedValue === "number" ? payload.estimatedValue : undefined,
          vaultLocation: typeof payload.vaultLocation === "string" ? payload.vaultLocation : undefined,
          imageUrl: typeof payload.imageUrl === "string" ? payload.imageUrl : undefined,
          thumbnailUrl: typeof payload.thumbnailUrl === "string" ? payload.thumbnailUrl : undefined,
          detailsJson: payload.details ? (payload.details as Prisma.JsonValue) : undefined,
          ownerId: ingestion.ownerId,
        },
      });

      await tx.itemOwnership.create({
        data: {
          itemId: item.id,
          ownerId: ingestion.ownerId,
          note: "Ingestion approved",
        },
      });

      const updated = await tx.ingestionTask.update({
        where: { id: ingestion.id },
        data: { status: IngestionStatus.APPROVED, itemId: item.id },
      });

      return { item, ingestion: updated };
    });

    res.json(result);
  } catch (error) {
    next(error);
  }
});

app.post("/ingestions/:ingestionId/reject", async (req, res, next) => {
  try {
    const payload = notesSchema.parse(req.body);
    const updated = await prisma.ingestionTask.update({
      where: { id: req.params.ingestionId },
      data: { status: IngestionStatus.REJECTED, notes: payload.notes },
    });
    res.json({ ingestion: updated });
  } catch (error) {
    next(error);
  }
});

app.get("/health", (_req, res) => {
  res.json({ status: "ok", service: serviceName });
});

app.get("/version", (_req, res) => {
  res.json({ version: "0.1.0" });
});

app.use((err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  const status = typeof err === "object" && err && "statusCode" in err ? Number((err as any).statusCode) : 500;
  const message = err instanceof Error ? err.message : "Unexpected error";
  res.status(status || 500).json({ message });
});

app.listen(port, () => {
  console.log(`(${serviceName}) listening on port ${port}`);
});
