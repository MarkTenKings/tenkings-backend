import express, { type RequestHandler } from "express";
import cors from "cors";
import {
  prisma as defaultPrisma,
  type Prisma,
  TransactionSource,
  TransactionType,
} from "@tenkings/database";
import { z } from "zod";

const serviceName = "wallet-service";

const CREDIT_SOURCES = new Set<TransactionSource>([
  TransactionSource.BUYBACK,
  TransactionSource.SALE,
  TransactionSource.ADJUSTMENT,
]);

const DEBIT_SOURCES = new Set<TransactionSource>([
  TransactionSource.PACK_PURCHASE,
  TransactionSource.REDEMPTION,
  TransactionSource.SALE,
  TransactionSource.ADJUSTMENT,
]);

const TRANSFER_SOURCES = new Set<TransactionSource>([
  TransactionSource.SALE,
  TransactionSource.ADJUSTMENT,
]);

const createUserSchema = z.object({
  email: z.string().email(),
  displayName: z.string().min(1).optional(),
});

const ledgerSchema = z.object({
  amount: z.number().int().positive(),
  note: z.string().optional(),
  source: z.nativeEnum(TransactionSource),
  referenceId: z.string().optional(),
});

type PrismaLike = Pick<
  typeof defaultPrisma,
  "$transaction" | "user" | "wallet" | "walletTransaction"
>;

const transferSchema = ledgerSchema.extend({
  fromUserId: z.string().uuid(),
  toUserId: z.string().uuid(),
});

interface AppDependencies {
  prisma?: PrismaLike;
  operatorKey?: string | null;
}

const createHttpError = (statusCode: number, message: string) =>
  Object.assign(new Error(message), { statusCode });

function ensureAllowedSource(
  source: TransactionSource,
  allowed: Set<TransactionSource>,
  action: "credit" | "debit" | "transfer",
) {
  if (!allowed.has(source)) {
    throw createHttpError(400, `source ${source} not permitted for ${action}`);
  }
}

export function createApp(deps: AppDependencies = {}) {
  const prisma: PrismaLike = (deps.prisma as PrismaLike) ?? defaultPrisma;
  const operatorKey = deps.operatorKey ?? process.env.OPERATOR_API_KEY ?? undefined;

  const app = express();

  app.use(cors());
  app.use(express.json());

  const requireOperator: RequestHandler = (req, res, next) => {
    if (!operatorKey) {
      return next();
    }
    const provided = req.header("x-operator-key");
    if (provided !== operatorKey) {
      return res.status(401).json({ message: "Operator key required" });
    }
    return next();
  };

  app.post("/users", async (req, res, next) => {
    try {
      const payload = createUserSchema.parse(req.body);
      const user = await prisma.user.upsert({
        where: { email: payload.email },
        update: { displayName: payload.displayName ?? undefined },
        create: {
          email: payload.email,
          displayName: payload.displayName,
          wallet: { create: {} },
        },
        include: { wallet: true },
      });
      res.status(201).json({ user });
    } catch (error) {
      next(error);
    }
  });

  app.get("/wallets/:userId", requireOperator, async (req, res, next) => {
    try {
      const wallet = await prisma.wallet.findUnique({
        where: { userId: req.params.userId },
        include: {
          user: true,
          transactions: { orderBy: { createdAt: "desc" }, take: 50 },
        },
      });
      if (!wallet) {
        return res.status(404).json({ message: "Wallet not found" });
      }
      res.json({ wallet });
    } catch (error) {
      next(error);
    }
  });

  app.post("/wallets/:userId/credit", requireOperator, async (req, res, next) => {
    try {
      const { userId } = req.params;
      const payload = ledgerSchema.parse(req.body);
      ensureAllowedSource(payload.source, CREDIT_SOURCES, "credit");
      const result = await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
        const wallet = await tx.wallet.findUnique({ where: { userId } });
        if (!wallet) {
          throw createHttpError(404, "wallet missing");
        }
        const updated = await tx.wallet.update({
          where: { id: wallet.id },
          data: { balance: { increment: payload.amount } },
        });
        const transaction = await tx.walletTransaction.create({
          data: {
            walletId: updated.id,
            amount: payload.amount,
            type: TransactionType.CREDIT,
            source: payload.source,
            note: payload.note,
            referenceId: payload.referenceId,
          },
        });
        return { balance: updated.balance, transaction };
      });
      res.status(201).json(result);
    } catch (error) {
      next(error);
    }
  });

  app.post("/wallets/:userId/debit", requireOperator, async (req, res, next) => {
    try {
      const { userId } = req.params;
      const payload = ledgerSchema.parse(req.body);
      ensureAllowedSource(payload.source, DEBIT_SOURCES, "debit");
      const result = await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
        const wallet = await tx.wallet.findUnique({ where: { userId } });
        if (!wallet) {
          throw createHttpError(404, "wallet missing");
        }
        if (wallet.balance < payload.amount) {
          throw createHttpError(400, "insufficient balance");
        }
        const updated = await tx.wallet.update({
          where: { id: wallet.id },
          data: { balance: { decrement: payload.amount } },
        });
        const transaction = await tx.walletTransaction.create({
          data: {
            walletId: updated.id,
            amount: payload.amount,
            type: TransactionType.DEBIT,
            source: payload.source,
            note: payload.note,
            referenceId: payload.referenceId,
          },
        });
        return { balance: updated.balance, transaction };
      });
      res.status(201).json(result);
    } catch (error) {
      next(error);
    }
  });

  app.post("/wallets/transfer", requireOperator, async (req, res, next) => {
    try {
      const payload = transferSchema.parse(req.body);
      if (payload.fromUserId === payload.toUserId) {
        throw createHttpError(400, "cannot transfer within the same wallet");
      }
      ensureAllowedSource(payload.source, TRANSFER_SOURCES, "transfer");
      const result = await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
        const fromWallet = await tx.wallet.findUnique({ where: { userId: payload.fromUserId } });
        if (!fromWallet) {
          throw createHttpError(404, "source wallet missing");
        }
        const toWallet = await tx.wallet.findUnique({ where: { userId: payload.toUserId } });
        if (!toWallet) {
          throw createHttpError(404, "destination wallet missing");
        }
        if (fromWallet.balance < payload.amount) {
          throw createHttpError(400, "insufficient balance");
        }
        const updatedFrom = await tx.wallet.update({
          where: { id: fromWallet.id },
          data: { balance: { decrement: payload.amount } },
        });
        const debitTransaction = await tx.walletTransaction.create({
          data: {
            walletId: updatedFrom.id,
            amount: payload.amount,
            type: TransactionType.DEBIT,
            source: payload.source,
            note: payload.note,
            referenceId: payload.referenceId,
          },
        });
        const updatedTo = await tx.wallet.update({
          where: { id: toWallet.id },
          data: { balance: { increment: payload.amount } },
        });
        const creditTransaction = await tx.walletTransaction.create({
          data: {
            walletId: updatedTo.id,
            amount: payload.amount,
            type: TransactionType.CREDIT,
            source: payload.source,
            note: payload.note,
            referenceId: payload.referenceId,
          },
        });
        return {
          amount: payload.amount,
          source: payload.source,
          referenceId: payload.referenceId,
          note: payload.note,
          from: {
            userId: payload.fromUserId,
            walletId: updatedFrom.id,
            balance: updatedFrom.balance,
            transaction: debitTransaction,
          },
          to: {
            userId: payload.toUserId,
            walletId: updatedTo.id,
            balance: updatedTo.balance,
            transaction: creditTransaction,
          },
        };
      });
      res.status(201).json({ transfer: result });
    } catch (error) {
      next(error);
    }
  });

  app.get("/wallets/:userId/transactions", requireOperator, async (req, res, next) => {
    try {
      const wallet = await prisma.wallet.findUnique({
        where: { userId: req.params.userId },
        select: {
          transactions: { orderBy: { createdAt: "desc" }, take: 100 },
        },
      });
      if (!wallet) {
        return res.status(404).json({ message: "Wallet not found" });
      }
      res.json(wallet);
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

  return app;
}
