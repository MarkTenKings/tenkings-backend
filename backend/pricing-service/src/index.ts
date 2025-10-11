import express from "express";
import cors from "cors";
import { prisma, ListingStatus } from "@tenkings/database";
import { z } from "zod";

const app = express();
const port = process.env.PORT ? Number(process.env.PORT) : 8181;
const serviceName = "pricing-service";

app.use(cors());
app.use(express.json());

app.get("/items/:itemId/value", async (req, res, next) => {
  try {
    const item = await prisma.item.findUnique({
      where: { id: req.params.itemId },
      include: { listings: true },
    });

    if (!item) {
      return res.status(404).json({ message: "Item not found" });
    }

    const activeListing =
      item.listings && item.listings.status === ListingStatus.ACTIVE
        ? item.listings
        : null;

    const value = item.estimatedValue ?? activeListing?.price ?? 0;
    const buyback = Math.floor(value * 0.8);

    res.json({ itemId: item.id, value, buyback });
  } catch (error) {
    next(error);
  }
});

const valueSchema = z.object({
  value: z.number().int().nonnegative(),
  source: z.string().optional(),
});

app.post("/items/:itemId/value", async (req, res, next) => {
  try {
    const payload = valueSchema.parse(req.body);
    const item = await prisma.item.update({
      where: { id: req.params.itemId },
      data: { estimatedValue: payload.value },
    });

    res.json({ item, buyback: Math.floor(payload.value * 0.8) });
  } catch (error) {
    next(error);
  }
});

app.get("/packs/:packDefinitionId/value", async (req, res, next) => {
  try {
    const pack = await prisma.packDefinition.findUnique({
      where: { id: req.params.packDefinitionId },
    });

    if (!pack) {
      return res.status(404).json({ message: "Pack definition not found" });
    }

    res.json({ packDefinitionId: pack.id, price: pack.price });
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
