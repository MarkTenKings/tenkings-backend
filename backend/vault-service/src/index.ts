import express from "express";
import cors from "cors";
import { prisma, Prisma, ItemStatus } from "@tenkings/database";
import { z } from "zod";

const app = express();
const port = process.env.PORT ? Number(process.env.PORT) : 8181;
const serviceName = "vault-service";

app.use(cors());
app.use(express.json());

const itemSchema = z.object({
  name: z.string().min(1),
  set: z.string().min(1),
  ownerId: z.string().uuid(),
  number: z.string().optional(),
  language: z.string().optional(),
  foil: z.boolean().optional(),
  estimatedValue: z.number().int().positive().optional(),
  vaultLocation: z.string().optional(),
});

app.post("/items", async (req, res, next) => {
  try {
    const payload = itemSchema.parse(req.body);
    const owner = await prisma.user.findUnique({ where: { id: payload.ownerId } });
    if (!owner) {
      return res.status(404).json({ message: "Owner not found" });
    }
    const result = await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      const item = await tx.item.create({
        data: {
          name: payload.name,
          set: payload.set,
          number: payload.number,
          language: payload.language,
          foil: payload.foil ?? false,
          estimatedValue: payload.estimatedValue,
          vaultLocation: payload.vaultLocation,
          ownerId: payload.ownerId,
        },
      });
      await tx.itemOwnership.create({
        data: {
          itemId: item.id,
          ownerId: payload.ownerId,
          note: "Initial intake",
        },
      });
      return item;
    });
    res.status(201).json({ item: result });
  } catch (error) {
    next(error);
  }
});

app.get("/items/:itemId", async (req, res, next) => {
  try {
    const item = await prisma.item.findUnique({
      where: { id: req.params.itemId },
      include: { owner: true, ownerships: { orderBy: { acquiredAt: "desc" } } },
    });
    if (!item) {
      return res.status(404).json({ message: "Item not found" });
    }
    res.json({ item });
  } catch (error) {
    next(error);
  }
});

app.get("/owners/:ownerId/items", async (req, res, next) => {
  try {
    const items = await prisma.item.findMany({
      where: { ownerId: req.params.ownerId },
      orderBy: { createdAt: "desc" },
    });
    res.json({ items });
  } catch (error) {
    next(error);
  }
});

const statusSchema = z.object({
  status: z.nativeEnum(ItemStatus),
  vaultLocation: z.string().optional(),
});

app.patch("/items/:itemId/status", async (req, res, next) => {
  try {
    const payload = statusSchema.parse(req.body);
    const item = await prisma.item.update({
      where: { id: req.params.itemId },
      data: {
        status: payload.status,
        vaultLocation: payload.vaultLocation ?? undefined,
      },
    });
    res.json({ item });
  } catch (error) {
    next(error);
  }
});

const transferSchema = z.object({
  newOwnerId: z.string().uuid(),
  note: z.string().optional(),
  status: z.nativeEnum(ItemStatus).default(ItemStatus.IN_TRANSFER),
});

app.post("/items/:itemId/transfer", async (req, res, next) => {
  try {
    const payload = transferSchema.parse(req.body);
    const transfer = await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      const item = await tx.item.findUnique({ where: { id: req.params.itemId } });
      if (!item) {
        throw Object.assign(new Error("item missing"), { statusCode: 404 });
      }
      const newOwner = await tx.user.findUnique({ where: { id: payload.newOwnerId } });
      if (!newOwner) {
        throw Object.assign(new Error("new owner missing"), { statusCode: 404 });
      }
      const updated = await tx.item.update({
        where: { id: item.id },
        data: { ownerId: payload.newOwnerId, status: payload.status },
      });
      await tx.itemOwnership.create({
        data: {
          itemId: updated.id,
          ownerId: payload.newOwnerId,
          note: payload.note ?? "Ownership transfer",
        },
      });
      return updated;
    });
    res.json({ item: transfer });
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
