import express from "express";
import cors from "cors";
import {
  prisma,
  Prisma,
  ItemStatus,
  ListingStatus,
  TransactionSource,
  TransactionType,
} from "@tenkings/database";
import { z } from "zod";

const app = express();
const port = process.env.PORT ? Number(process.env.PORT) : 8082;
const serviceName = "marketplace-service";

app.use(cors());
app.use(express.json());

const listingSchema = z.object({
  itemId: z.string().uuid(),
  sellerId: z.string().uuid(),
  price: z.number().int().positive(),
});

app.post("/listings", async (req, res, next) => {
  try {
    const payload = listingSchema.parse(req.body);

    const existing = await prisma.listing.findUnique({ where: { itemId: payload.itemId } });
    if (existing) {
      return res.status(400).json({ message: "Item already listed" });
    }

    const item = await prisma.item.findUnique({ where: { id: payload.itemId } });
    if (!item) {
      return res.status(404).json({ message: "Item not found" });
    }

    if (item.ownerId !== payload.sellerId) {
      return res.status(409).json({ message: "Seller does not own item" });
    }

    const listing = await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      const created = await tx.listing.create({
        data: {
          itemId: payload.itemId,
          sellerId: payload.sellerId,
          price: payload.price,
        },
        include: { item: true },
      });

      await tx.item.update({
        where: { id: payload.itemId },
        data: { status: ItemStatus.LISTED },
      });

      return created;
    });

    res.status(201).json({ listing });
  } catch (error) {
    next(error);
  }
});

app.get("/listings", async (req, res, next) => {
  try {
    const statusParam = typeof req.query.status === "string" ? req.query.status : undefined;
    const listings = await prisma.listing.findMany({
      where: statusParam ? { status: statusParam as ListingStatus } : undefined,
      include: { item: true },
      orderBy: { createdAt: "desc" },
      take: 100,
    });
    res.json({ listings });
  } catch (error) {
    next(error);
  }
});

const purchaseSchema = z.object({
  buyerId: z.string().uuid(),
});

app.post("/listings/:listingId/purchase", async (req, res, next) => {
  try {
    const { buyerId } = purchaseSchema.parse(req.body);
    const { listingId } = req.params;

    const result = await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      const listing = await tx.listing.findUnique({
        where: { id: listingId },
        include: { item: true },
      });

      if (!listing) {
        throw Object.assign(new Error("listing missing"), { statusCode: 404 });
      }

      if (listing.status !== ListingStatus.ACTIVE) {
        throw Object.assign(new Error("listing not active"), { statusCode: 409 });
      }

      if (listing.sellerId === buyerId) {
        throw Object.assign(new Error("seller cannot buy own listing"), { statusCode: 400 });
      }

      const buyerWallet = await tx.wallet.findUnique({ where: { userId: buyerId } });
      const sellerWallet = await tx.wallet.findUnique({ where: { userId: listing.sellerId } });

      if (!buyerWallet || !sellerWallet) {
        throw Object.assign(new Error("wallet missing"), { statusCode: 400 });
      }

      if (buyerWallet.balance < listing.price) {
        throw Object.assign(new Error("insufficient balance"), { statusCode: 400 });
      }

      const updatedBuyerWallet = await tx.wallet.update({
        where: { id: buyerWallet.id },
        data: { balance: { decrement: listing.price } },
      });

      await tx.walletTransaction.create({
        data: {
          walletId: updatedBuyerWallet.id,
          amount: listing.price,
          type: TransactionType.DEBIT,
          source: TransactionSource.SALE,
          referenceId: listing.id,
          note: `Purchase of item ${listing.itemId}`,
        },
      });

      const updatedSellerWallet = await tx.wallet.update({
        where: { id: sellerWallet.id },
        data: { balance: { increment: listing.price } },
      });

      await tx.walletTransaction.create({
        data: {
          walletId: updatedSellerWallet.id,
          amount: listing.price,
          type: TransactionType.CREDIT,
          source: TransactionSource.SALE,
          referenceId: listing.id,
          note: `Sale of item ${listing.itemId}`,
        },
      });

      await tx.listing.update({
        where: { id: listing.id },
        data: { status: ListingStatus.SOLD },
      });

      await tx.item.update({
        where: { id: listing.itemId },
        data: { ownerId: buyerId, status: ItemStatus.SOLD },
      });

      await tx.itemOwnership.create({
        data: {
          itemId: listing.itemId,
          ownerId: buyerId,
          note: `Marketplace purchase ${listing.id}`,
        },
      });

      return { listingId: listing.id, status: ListingStatus.SOLD };
    });

    res.json(result);
  } catch (error) {
    next(error);
  }
});

app.post("/listings/:listingId/close", async (req, res, next) => {
  try {
    const listing = await prisma.listing.update({
      where: { id: req.params.listingId },
      data: { status: ListingStatus.REMOVED },
    });
    await prisma.item.update({
      where: { id: listing.itemId },
      data: { status: ItemStatus.STORED },
    });
    res.json({ listing });
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
