import express from "express";
import cors from "cors";
import {
  prisma,
  Prisma,
  PackStatus,
  TransactionSource,
  TransactionType,
} from "@tenkings/database";
import { z } from "zod";

const app = express();
const port = process.env.PORT ? Number(process.env.PORT) : 8185;
const serviceName = "vending-gw";

app.use(cors());
app.use(express.json());

app.post("/sessions", async (req, res, next) => {
  try {
    const schema = z.object({ userId: z.string().uuid() });
    const payload = schema.parse(req.body);

    const wallet = await prisma.wallet.findUnique({ where: { userId: payload.userId } });
    if (!wallet) {
      return res.status(404).json({ message: "Wallet not found" });
    }

    res.json({ userId: payload.userId, balance: wallet.balance });
  } catch (error) {
    next(error);
  }
});

const vendSchema = z.object({
  userId: z.string().uuid(),
  packDefinitionId: z.string().uuid(),
  machineId: z.string().optional(),
});

app.post("/vend", async (req, res, next) => {
  try {
    const payload = vendSchema.parse(req.body);

    const result = await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      const definition = await tx.packDefinition.findUnique({ where: { id: payload.packDefinitionId } });
      if (!definition) {
        throw Object.assign(new Error("pack definition missing"), { statusCode: 404 });
      }

      const wallet = await tx.wallet.findUnique({ where: { userId: payload.userId } });
      if (!wallet) {
        throw Object.assign(new Error("wallet missing"), { statusCode: 404 });
      }

      if (wallet.balance < definition.price) {
        throw Object.assign(new Error("insufficient balance"), { statusCode: 400 });
      }

      const pack = await tx.packInstance.findFirst({
        where: { packDefinitionId: payload.packDefinitionId, status: PackStatus.UNOPENED, ownerId: null },
        orderBy: { createdAt: "asc" },
      });

      if (!pack) {
        throw Object.assign(new Error("no pack inventory"), { statusCode: 409 });
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
          note: `Vending machine ${payload.machineId ?? "unknown"}`,
        },
      });

      const dispensed = await tx.packInstance.update({
        where: { id: pack.id },
        data: { ownerId: payload.userId },
        include: { slots: true },
      });

      return { pack: dispensed, remainingBalance: updatedWallet.balance };
    });

    res.json(result);
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
