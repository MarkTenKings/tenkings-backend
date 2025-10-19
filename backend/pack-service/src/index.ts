import express from "express";
import cors, { CorsOptions } from "cors";
import {
  prisma,
  Prisma,
  ItemStatus,
  PackStatus,
  ListingStatus,
  TransactionSource,
  TransactionType,
  ShippingStatus,
} from "@tenkings/database";
import { z } from "zod";
import Stripe from "stripe";

const stripeSecretKey = process.env.STRIPE_SECRET_KEY;
const stripeClient = stripeSecretKey
  ? new Stripe(stripeSecretKey, {
      apiVersion: "2024-06-20",
    })
  : null;

const houseUserEmail = process.env.HOUSE_USER_EMAIL ?? "tenkings@system.local";
const defaultShippingProcessingFeeMinor = Number(process.env.SHIPPING_PROCESSING_FEE_MINOR ?? "1200");

const app = express();
const port = process.env.PORT ? Number(process.env.PORT) : 8183;
const serviceName = "pack-service";

const corsOptions: CorsOptions = {
  origin: true,
  credentials: false,
  allowedHeaders: [
    "Content-Type",
    "Authorization",
    "X-Operator-Key",
    "X-Requested-With",
  ],
  methods: ["GET", "POST", "PATCH", "OPTIONS"],
};

app.use(cors(corsOptions));
app.options("*", cors(corsOptions));
app.use(express.json());

async function ensureHouseAccount(tx: Prisma.TransactionClient) {
  const user = await tx.user.upsert({
    where: { email: houseUserEmail },
    update: {},
    create: {
      email: houseUserEmail,
      displayName: "TenKings Vault",
    },
  });

  const wallet = await tx.wallet.upsert({
    where: { userId: user.id },
    update: {},
    create: { userId: user.id },
  });

  return { user, wallet };
}

const definitionSchema = z.object({
  name: z.string().min(1),
  description: z.string().optional(),
  price: z.number().int().positive(),
});

app.post("/definitions", async (req, res, next) => {
  try {
    const payload = definitionSchema.parse(req.body);
    const definition = await prisma.packDefinition.create({ data: payload });
    res.status(201).json({ definition });
  } catch (error) {
    next(error);
  }
});

app.get("/definitions", async (_req, res, next) => {
  try {
    const definitions = await prisma.packDefinition.findMany({ orderBy: { createdAt: "desc" } });
    res.json({ definitions });
  } catch (error) {
    next(error);
  }
});

const instanceSchema = z.object({
  ownerId: z.string().uuid().optional(),
  itemIds: z.array(z.string().uuid()).min(1),
});

app.post("/definitions/:definitionId/instances", async (req, res, next) => {
  try {
    const payload = instanceSchema.parse(req.body);
    const { definitionId } = req.params;

    const definition = await prisma.packDefinition.findUnique({ where: { id: definitionId } });
    if (!definition) {
      return res.status(404).json({ message: "Pack definition not found" });
    }

    const pack = await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      const createdPack = await tx.packInstance.create({
        data: {
          packDefinitionId: definitionId,
          ownerId: payload.ownerId,
          slots: {
            create: payload.itemIds.map((itemId: string) => ({ itemId })),
          },
        },
        include: { slots: true },
      });

      await tx.packDefinition.update({
        where: { id: definitionId },
        data: { inventoryCount: { increment: 1 } },
      });

      return createdPack;
    });

    res.status(201).json({ pack });
  } catch (error) {
    next(error);
  }
});

const purchaseSchema = z.object({
  packDefinitionId: z.string().uuid(),
  userId: z.string().uuid(),
  paymentMethod: z.enum(["wallet", "stripe"]).default("wallet"),
  paymentIntentId: z.string().optional(),
});

const createIntentSchema = z.object({
  packDefinitionId: z.string().uuid(),
  userId: z.string().uuid(),
});

const openPackSchema = z.object({
  userId: z.string().uuid(),
});

app.post("/purchase/stripe-intent", async (req, res, next) => {
  try {
    if (!stripeClient) {
      return res.status(503).json({ message: "Stripe not configured" });
    }

    const payload = createIntentSchema.parse(req.body);

    const definition = await prisma.packDefinition.findUnique({ where: { id: payload.packDefinitionId } });
    if (!definition) {
      return res.status(404).json({ message: "Pack definition not found" });
    }

    const intent = await stripeClient.paymentIntents.create({
      amount: definition.price,
      currency: "usd",
      metadata: {
        packDefinitionId: payload.packDefinitionId,
        userId: payload.userId,
      },
      automatic_payment_methods: { enabled: true },
    });

    res.status(201).json({ clientSecret: intent.client_secret, paymentIntentId: intent.id });
  } catch (error) {
    next(error);
  }
});

app.post("/purchase", async (req, res, next) => {
  try {
    const payload = purchaseSchema.parse(req.body);

    const result = await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      const definition = await tx.packDefinition.findUnique({ where: { id: payload.packDefinitionId } });
      if (!definition) {
        throw Object.assign(new Error("pack definition missing"), { statusCode: 404 });
      }

      const pack = await tx.packInstance.findFirst({
        where: { packDefinitionId: payload.packDefinitionId, status: PackStatus.UNOPENED, ownerId: null },
        include: { slots: { include: { item: true } } },
        orderBy: { createdAt: "asc" },
      });

      if (!pack) {
        throw Object.assign(new Error("no inventory available"), { statusCode: 409 });
      }

      let walletBalance: number | null = null;

      if (payload.paymentMethod === "wallet") {
        const wallet = await tx.wallet.findUnique({ where: { userId: payload.userId } });
        if (!wallet) {
          throw Object.assign(new Error("wallet missing"), { statusCode: 404 });
        }

        if (wallet.balance < definition.price) {
          throw Object.assign(new Error("insufficient balance"), { statusCode: 400 });
        }

        const updatedWallet = await tx.wallet.update({
          where: { id: wallet.id },
          data: { balance: { decrement: definition.price } },
        });

        await tx.walletTransaction.create({
          data: {
            walletId: updatedWallet.id,
            amount: definition.price,
            type: TransactionType.DEBIT,
            source: TransactionSource.PACK_PURCHASE,
            referenceId: pack.id,
            note: `Pack purchase ${definition.name}`,
          },
        });

        walletBalance = updatedWallet.balance;
      } else {
        if (!stripeClient) {
          throw Object.assign(new Error("Stripe not configured"), { statusCode: 503 });
        }
        if (!payload.paymentIntentId) {
          throw Object.assign(new Error("paymentIntentId required"), { statusCode: 400 });
        }
        const intent = await stripeClient.paymentIntents.retrieve(payload.paymentIntentId);
        if (intent.status !== "succeeded") {
          throw Object.assign(new Error("payment not completed"), { statusCode: 400 });
        }
        if (intent.amount !== definition.price) {
          throw Object.assign(new Error("payment amount mismatch"), { statusCode: 400 });
        }
        if (
          intent.metadata?.packDefinitionId !== payload.packDefinitionId ||
          intent.metadata?.userId !== payload.userId
        ) {
          throw Object.assign(new Error("payment metadata mismatch"), { statusCode: 400 });
        }
      }

      const claimedPack = await tx.packInstance.update({
        where: { id: pack.id },
        data: { ownerId: payload.userId },
        include: { slots: { include: { item: true } } },
      });

      await tx.packDefinition.update({
        where: { id: definition.id },
        data: { inventoryCount: { decrement: 1 } },
      });

      return { definition, pack: claimedPack, walletBalance };
    });

    res.json(result);
  } catch (error) {
    next(error);
  }
});

app.post("/packs/:packId/open", async (req, res, next) => {
  try {
    const { userId } = openPackSchema.parse(req.body);

    const pack = await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      const existing = await tx.packInstance.findUnique({
        where: { id: req.params.packId },
        include: { packDefinition: true, slots: { include: { item: true } } },
      });

      if (!existing) {
        throw Object.assign(new Error("pack missing"), { statusCode: 404 });
      }
      if (existing.ownerId !== userId) {
        throw Object.assign(new Error("not pack owner"), { statusCode: 403 });
      }
      if (existing.status !== PackStatus.UNOPENED) {
        throw Object.assign(new Error("pack already opened"), { statusCode: 409 });
      }

      const updated = await tx.packInstance.update({
        where: { id: existing.id },
        data: { status: PackStatus.OPENED, openedAt: new Date() },
        include: { packDefinition: true, slots: { include: { item: true } } },
      });

      const slotItemIds = updated.slots.map((slot: { itemId: string }) => slot.itemId);

      await tx.item.updateMany({
        where: { id: { in: slotItemIds } },
        data: { ownerId: existing.ownerId, status: ItemStatus.STORED },
      });

      return updated;
    });

    res.json({ pack });
  } catch (error) {
    next(error);
  }
});

app.get("/users/:userId/packs", async (req, res, next) => {
  try {
    const userId = z.string().uuid().parse(req.params.userId);
    const packs = await prisma.packInstance.findMany({
      where: { ownerId: userId },
      include: {
        packDefinition: true,
        slots: { include: { item: true } },
      },
      orderBy: [{ status: "asc" }, { createdAt: "desc" }],
    });
    res.json({ packs });
  } catch (error) {
    next(error);
  }
});

const buybackSchema = z.object({
  userId: z.string().uuid(),
});

app.post("/items/:itemId/buyback", async (req, res, next) => {
  try {
    const payload = buybackSchema.parse(req.body);
    const { itemId } = req.params;

    const result = await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      const item = await tx.item.findUnique({
        where: { id: itemId },
        include: { listings: true },
      });
      if (!item) {
        throw Object.assign(new Error("item missing"), { statusCode: 404 });
      }
      if (item.ownerId !== payload.userId) {
        throw Object.assign(new Error("item not owned by user"), { statusCode: 409 });
      }

      const listing = item.listings && item.listings.status === ListingStatus.ACTIVE ? item.listings : null;
      const sourceValue = item.estimatedValue ?? listing?.price ?? 0;
      const buybackAmount = Math.floor(sourceValue * 0.75);

      if (buybackAmount <= 0) {
        throw Object.assign(new Error("buyback unavailable"), { statusCode: 400 });
      }

      const userWallet = await tx.wallet.findUnique({ where: { userId: payload.userId } });
      if (!userWallet) {
        throw Object.assign(new Error("wallet missing"), { statusCode: 404 });
      }

      const houseAccount = await ensureHouseAccount(tx);

      const updatedWallet = await tx.wallet.update({
        where: { id: userWallet.id },
        data: { balance: { increment: buybackAmount } },
      });

      await tx.walletTransaction.create({
        data: {
          walletId: updatedWallet.id,
          amount: buybackAmount,
          type: TransactionType.CREDIT,
          source: TransactionSource.BUYBACK,
          referenceId: item.id,
          note: "Instant buyback",
        },
      });

      await tx.item.update({
        where: { id: item.id },
        data: {
          ownerId: houseAccount.user.id,
          status: ItemStatus.STORED,
        },
      });

      await tx.itemOwnership.create({
        data: {
          itemId: item.id,
          ownerId: houseAccount.user.id,
          note: "Instant buyback",
        },
      });

      if (listing && listing.status === ListingStatus.ACTIVE) {
        await tx.listing.update({
          where: { id: listing.id },
          data: { status: ListingStatus.REMOVED },
        });
      }

      return {
        buybackAmount,
        walletBalance: updatedWallet.balance,
      };
    });

    res.json(result);
  } catch (error) {
    next(error);
  }
});

const shippingRequestSchema = z.object({
  userId: z.string().uuid(),
  recipientName: z.string().min(1),
  addressLine1: z.string().min(1),
  addressLine2: z.string().optional(),
  city: z.string().min(1),
  state: z.string().optional(),
  postalCode: z.string().min(1),
  country: z.string().min(1),
  phone: z.string().optional(),
  email: z.string().email().optional(),
  shippingFeeMinor: z.number().int().nonnegative().optional(),
  notes: z.string().optional(),
});

app.post("/items/:itemId/request-shipping", async (req, res, next) => {
  try {
    const payload = shippingRequestSchema.parse(req.body ?? {});
    const { itemId } = req.params;

    const result = await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      const item = await tx.item.findUnique({
        where: { id: itemId },
        include: { shippingRequest: true },
      });
      if (!item) {
        throw Object.assign(new Error("item missing"), { statusCode: 404 });
      }
      if (item.ownerId !== payload.userId) {
        throw Object.assign(new Error("item not owned by user"), { statusCode: 409 });
      }
      if (item.shippingRequest) {
        throw Object.assign(new Error("shipping already requested"), { statusCode: 409 });
      }

      const wallet = await tx.wallet.findUnique({ where: { userId: payload.userId } });
      if (!wallet) {
        throw Object.assign(new Error("wallet missing"), { statusCode: 404 });
      }

      const processingFeeMinor = defaultShippingProcessingFeeMinor;
      const shippingFeeMinor = payload.shippingFeeMinor ?? 0;
      const totalFeeMinor = processingFeeMinor + shippingFeeMinor;

      if (wallet.balance < totalFeeMinor) {
        throw Object.assign(new Error("insufficient balance"), { statusCode: 400 });
      }

      const updatedWallet = await tx.wallet.update({
        where: { id: wallet.id },
        data: { balance: { decrement: totalFeeMinor } },
      });

      await tx.walletTransaction.create({
        data: {
          walletId: updatedWallet.id,
          amount: totalFeeMinor,
          type: TransactionType.DEBIT,
          source: TransactionSource.REDEMPTION,
          referenceId: item.id,
          note: "Shipping request",
        },
      });

      const request = await tx.shippingRequest.create({
        data: {
          itemId: item.id,
          userId: payload.userId,
          status: ShippingStatus.PENDING,
          recipientName: payload.recipientName,
          addressLine1: payload.addressLine1,
          addressLine2: payload.addressLine2 ?? null,
          city: payload.city,
          state: payload.state ?? null,
          postalCode: payload.postalCode,
          country: payload.country,
          phone: payload.phone ?? null,
          email: payload.email ?? null,
          processingFeeMinor,
          shippingFeeMinor,
          totalFeeMinor,
          notes: payload.notes ?? null,
        },
      });

      await tx.item.update({
        where: { id: item.id },
        data: { status: ItemStatus.IN_TRANSFER },
      });

      return { request, walletBalance: updatedWallet.balance };
    });

    res.status(201).json(result);
  } catch (error) {
    next(error);
  }
});

app.get("/shipping/requests", async (req, res, next) => {
  try {
    const statusParam = Array.isArray(req.query.status) ? req.query.status[0] : req.query.status;
    const userId = Array.isArray(req.query.userId) ? req.query.userId[0] : req.query.userId;

    const where: Prisma.ShippingRequestWhereInput = {};
    if (statusParam) {
      if (!Object.values(ShippingStatus).includes(statusParam as ShippingStatus)) {
        return res.status(400).json({ message: "Invalid status" });
      }
      where.status = statusParam as ShippingStatus;
    }
    if (userId) {
      where.userId = userId;
    }

    const requests = await prisma.shippingRequest.findMany({
      where,
      orderBy: { createdAt: "desc" },
      include: {
        item: true,
        user: { select: { id: true, email: true, displayName: true } },
      },
    });

    const payload = requests.map((request) => ({
      id: request.id,
      itemId: request.itemId,
      userId: request.userId,
      status: request.status,
      recipientName: request.recipientName,
      addressLine1: request.addressLine1,
      addressLine2: request.addressLine2,
      city: request.city,
      state: request.state,
      postalCode: request.postalCode,
      country: request.country,
      phone: request.phone,
      email: request.email,
      processingFeeMinor: request.processingFeeMinor,
      shippingFeeMinor: request.shippingFeeMinor,
      totalFeeMinor: request.totalFeeMinor,
      notes: request.notes,
      trackingNumber: request.trackingNumber,
      carrier: request.carrier,
      fulfilledAt: request.fulfilledAt ? request.fulfilledAt.toISOString() : null,
      createdAt: request.createdAt.toISOString(),
      updatedAt: request.updatedAt.toISOString(),
      item: {
        name: request.item.name,
        set: request.item.set,
        status: request.item.status,
        estimatedValue: request.item.estimatedValue,
      },
      user: request.user,
    }));

    res.json({ requests: payload });
  } catch (error) {
    next(error);
  }
});

const updateShippingSchema = z.object({
  status: z.nativeEnum(ShippingStatus).optional(),
  trackingNumber: z.string().min(1).optional(),
  carrier: z.string().min(1).optional(),
  notes: z.string().optional(),
  fulfilledAt: z.string().datetime().optional(),
});

app.patch("/shipping/requests/:requestId", async (req, res, next) => {
  try {
    const { requestId } = req.params;
    const payload = updateShippingSchema.parse(req.body ?? {});

    const request = await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      const existing = await tx.shippingRequest.findUnique({
        where: { id: requestId },
        include: { item: true },
      });
      if (!existing) {
        throw Object.assign(new Error("shipping request missing"), { statusCode: 404 });
      }

      const updates: Prisma.ShippingRequestUpdateInput = {};
      if (payload.status) {
        updates.status = payload.status;
      }
      if (payload.trackingNumber !== undefined) {
        updates.trackingNumber = payload.trackingNumber;
      }
      if (payload.carrier !== undefined) {
        updates.carrier = payload.carrier;
      }
      if (payload.notes !== undefined) {
        updates.notes = payload.notes;
      }
      if (payload.fulfilledAt) {
        updates.fulfilledAt = new Date(payload.fulfilledAt);
      }
      if (payload.status === ShippingStatus.SHIPPED && !payload.fulfilledAt) {
        updates.fulfilledAt = new Date();
      }

      const updated = await tx.shippingRequest.update({
        where: { id: requestId },
        data: updates,
      });

      if (payload.status === ShippingStatus.SHIPPED) {
        await tx.item.update({
          where: { id: existing.itemId },
          data: { status: ItemStatus.REDEEMED },
        });
      } else if (payload.status === ShippingStatus.CANCELLED) {
        await tx.item.update({
          where: { id: existing.itemId },
          data: { status: ItemStatus.STORED },
        });
      }

      return updated;
    });

    res.json({ request });
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
