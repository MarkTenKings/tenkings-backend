import type { NextApiRequest, NextApiResponse } from "next";
import { prisma, TransactionSource, TransactionType, type Prisma } from "@tenkings/database";
import { z } from "zod";
import { requireAdminSession, toErrorResponse } from "../../../../lib/server/admin";

const userIdSchema = z.string().uuid();

const walletMutationSchema = z.object({
  action: z.enum(["credit", "debit"]),
  amount: z.number().int().positive(),
  note: z.string().trim().max(500).optional(),
});

type WalletResponse =
  | {
      wallet: {
        id: string;
        balance: number;
        userId: string;
        transactions: Array<{
          id: string;
          amount: number;
          type: string;
          source: string;
          note: string | null;
          createdAt: string;
        }>;
      };
    }
  | {
      balance: number;
      transaction: {
        id: string;
        amount: number;
        type: string;
        source: string;
        note: string | null;
        createdAt: string;
      };
    }
  | { message: string };

const walletSelect = {
  id: true,
  balance: true,
  userId: true,
  transactions: {
    orderBy: { createdAt: "desc" as const },
    take: 50,
    select: {
      id: true,
      amount: true,
      type: true,
      source: true,
      note: true,
      createdAt: true,
    },
  },
} satisfies Prisma.WalletSelect;

const formatWallet = (wallet: Prisma.WalletGetPayload<{ select: typeof walletSelect }>) => ({
  id: wallet.id,
  balance: wallet.balance,
  userId: wallet.userId,
  transactions: wallet.transactions.map((transaction) => ({
    id: transaction.id,
    amount: transaction.amount,
    type: transaction.type,
    source: transaction.source,
    note: transaction.note,
    createdAt: transaction.createdAt.toISOString(),
  })),
});

export default async function handler(req: NextApiRequest, res: NextApiResponse<WalletResponse>) {
  const parsedUserId = userIdSchema.safeParse(req.query.userId);
  if (!parsedUserId.success) {
    return res.status(400).json({ message: "Valid userId is required" });
  }

  if (req.method !== "GET" && req.method !== "POST") {
    res.setHeader("Allow", "GET, POST");
    return res.status(405).json({ message: "Method not allowed" });
  }

  try {
    await requireAdminSession(req);

    if (req.method === "GET") {
      const wallet = await prisma.wallet.findUnique({
        where: { userId: parsedUserId.data },
        select: walletSelect,
      });

      if (!wallet) {
        return res.status(404).json({ message: "Wallet not found" });
      }

      return res.status(200).json({ wallet: formatWallet(wallet) });
    }

    const mutation = walletMutationSchema.safeParse(req.body);
    if (!mutation.success) {
      return res.status(400).json({ message: "Valid action and positive integer amount are required" });
    }

    const result = await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      const wallet = await tx.wallet.findUnique({
        where: { userId: parsedUserId.data },
      });

      if (!wallet) {
        throw new Error("Wallet not found");
      }

      if (mutation.data.action === "debit" && wallet.balance < mutation.data.amount) {
        const insufficient = new Error("Insufficient balance");
        (insufficient as Error & { statusCode?: number }).statusCode = 400;
        throw insufficient;
      }

      const updated = await tx.wallet.update({
        where: { id: wallet.id },
        data: {
          balance: mutation.data.action === "credit" ? { increment: mutation.data.amount } : { decrement: mutation.data.amount },
        },
      });

      const transaction = await tx.walletTransaction.create({
        data: {
          walletId: wallet.id,
          amount: mutation.data.amount,
          type: mutation.data.action === "credit" ? TransactionType.CREDIT : TransactionType.DEBIT,
          source: TransactionSource.ADJUSTMENT,
          note: mutation.data.note ?? null,
        },
      });

      return {
        balance: updated.balance,
        transaction,
      };
    });

    return res.status(200).json({
      balance: result.balance,
      transaction: {
        id: result.transaction.id,
        amount: result.transaction.amount,
        type: result.transaction.type,
        source: result.transaction.source,
        note: result.transaction.note,
        createdAt: result.transaction.createdAt.toISOString(),
      },
    });
  } catch (error) {
    if (error instanceof Error && error.message === "Wallet not found") {
      return res.status(404).json({ message: error.message });
    }
    if (error instanceof Error && "statusCode" in error && Number((error as { statusCode?: number }).statusCode) === 400) {
      return res.status(400).json({ message: error.message });
    }
    const response = toErrorResponse(error);
    return res.status(response.status).json({ message: response.message });
  }
}
